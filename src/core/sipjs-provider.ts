import {
    UserAgent,
    Registerer,
    RegistererRegisterOptions,
    UserAgentDelegate,
    Inviter,
    Session,
    Invitation,
    Messager,
    Web,
    SessionState,
    Subscriber,
    SubscriptionState,
    Notification,
    InvitationAcceptOptions,
    InvitationRejectOptions,
    Core,
} from "sip.js";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider.js";
import {
    SipCredentials,
    CallOptions,
    SipInvitation,
    AnswerOptions,
    CallStats,
    CallQualitySnapshot,
    DtmfOptions,
    SipSessionEventMap,
    SipSessionStatus,
    SipFailureEvent,
    PresenceEvent,
    PresenceSubscribeOptions,
    SipHealthStatus,
    SipSessionProgressEvent,
} from "./types.js";
import { handleStateChanges } from "./media.js";
import { ensureSipPrefix, parseRTCStats } from "./utils.js";
import { createCallQualitySnapshot } from "./call-quality.js";
import { SessionEventBus, SessionListener } from "./session-event-bus.js";
import { parsePresenceBody } from "./presence.js";

function toSessionStatus(state: SessionState): SipSessionStatus {
    switch (state) {
        case SessionState.Initial: return 'initial';
        case SessionState.Establishing: return 'establishing';
        case SessionState.Established: return 'established';
        case SessionState.Terminating: return 'terminating';
        case SessionState.Terminated: return 'terminated';
        default: return 'initial';
    }
}

function responseToProgressEvent(response: Core.IncomingResponse, fallbackStatus = 180): SipSessionProgressEvent {
    const message = response.message;
    const statusCode = message.statusCode ?? fallbackStatus;
    const body = message.body ?? '';
    return {
        method: 'INVITE',
        statusCode,
        reasonPhrase: message?.reasonPhrase,
        raw: response,
        hasEarlyMedia: statusCode === 183 && typeof body === 'string' && body.includes('m=audio'),
    };
}

export class SipJSSession implements ISipSession {
    public readonly id: string;
    public startedAt?: Date;
    public onConfirm?: () => void;
    public onTerminate?: () => void;
    public onReject?: (statusCode: number) => void;
    public onDTMF?: (tone: string) => void;
    public onProgress?: () => void;
    public onHold?: () => void;
    public onUnhold?: () => void;

    private remoteElement?: HTMLMediaElement;
    private originalVideoTrack?: MediaStreamTrack;
    private screenTrack?: MediaStreamTrack;
    private audioCtx?: AudioContext;
    private gainNode?: GainNode;
    private _muted = false;
    private reinviteInProgress = false;
    private terminated = false;
    private localHoldState = false;
    private remoteHoldState = false;
    private bus = new SessionEventBus();

    constructor(private session: Session) {
        this.id = session.id;
        this.bindStateChanges();
        this.bindSessionDelegate();
    }

    on<K extends keyof SipSessionEventMap>(event: K, listener: (...args: SipSessionEventMap[K]) => void): () => void {
        return this.bus.on(event, listener as SessionListener<K>);
    }

    off<K extends keyof SipSessionEventMap>(event: K, listener: (...args: SipSessionEventMap[K]) => void): void {
        this.bus.off(event, listener as SessionListener<K>);
    }

    setRemoteElement(el: HTMLMediaElement) {
        this.remoteElement = el;
    }

    getRawSession(): Session {
        return this.session;
    }

    emitProgress(event?: SipSessionProgressEvent): void {
        this.onProgress?.();
        this.bus.emit('progress', event);
    }

    emitFailed(event: SipFailureEvent): void {
        this.onReject?.(event.statusCode ?? 0);
        this.bus.emit('failed', event);
    }

    getCallDuration(): number {
        if (!this.startedAt) return 0;
        return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    }

    async bye(): Promise<void> {
        try {
            switch (this.session.state) {
                case SessionState.Initial:
                case SessionState.Establishing:
                    if (this.session instanceof Inviter) {
                        await this.session.cancel();
                    } else if (this.session instanceof Invitation) {
                        await this.session.reject();
                    }
                    break;
                case SessionState.Established:
                    await this.session.bye();
                    break;
                case SessionState.Terminating:
                case SessionState.Terminated:
                    break;
            }
        } finally {
            // A ação local de desligar precisa refletir imediatamente na UI,
            // mesmo se o peer/proxy demorar para devolver o estado final.
            this.cleanupMedia();
            this.emitTerminatedOnce();
        }
    }

    mute(): void { this._muted = true; this.toggleAudioTracks(false); }
    unmute(): void { this._muted = false; this.toggleAudioTracks(true); }
    muteVideo(): void { this.toggleVideoTracks(false); }
    unmuteVideo(): void { this.toggleVideoTracks(true); }

    async hold(): Promise<void> {
        if (this.reinviteInProgress || this.session.state !== SessionState.Established) return;
        this.reinviteInProgress = true;
        try {
            await this.session.invite({
                sessionDescriptionHandlerModifiers: [SipJSSession.holdSdpModifier],
            });
            this.toggleAudioTracks(false);
            this.localHoldState = true;
            this.onHold?.();
            this.bus.emit('hold', { originator: 'local' });
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async unhold(): Promise<void> {
        if (this.reinviteInProgress || this.session.state !== SessionState.Established) return;
        this.reinviteInProgress = true;
        try {
            await this.session.invite({
                sessionDescriptionHandlerModifiers: [],
            });
            if (!this._muted) this.toggleAudioTracks(true);
            this.localHoldState = false;
            this.onUnhold?.();
            this.bus.emit('unhold', { originator: 'local' });
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async upgradeToVideo(): Promise<void> {
        if (this.reinviteInProgress || this.session.state !== SessionState.Established) return;
        const pc = this.getPeerConnection();
        if (pc?.getSenders().some(s => s.track?.kind === 'video')) return;

        this.reinviteInProgress = true;
        try {
            // sip.js's default SessionDescriptionHandler acquires the camera itself and
            // adds the resulting track to the peer connection when `constraints.video`
            // flips to true on a re-INVITE — no manual getUserMedia/addTrack needed here.
            await this.session.invite({
                sessionDescriptionHandlerOptions: { constraints: { audio: true, video: true } },
            });
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async downgradeToAudio(): Promise<void> {
        if (this.reinviteInProgress || this.session.state !== SessionState.Established) return;
        const pc = this.getPeerConnection();
        const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
        const track = sender?.track;
        if (!sender || !track) return;

        this.reinviteInProgress = true;
        try {
            // The default SessionDescriptionHandler only adds/replaces tracks on
            // re-INVITE, it doesn't remove them when constraints go back to `video:
            // false` — so the sender is cleared manually first. This stops the
            // outgoing video; it doesn't renegotiate the video m-line to inactive.
            // The track itself is only stopped after the re-INVITE succeeds, so a
            // failed renegotiation can restore it instead of leaving it unusable.
            await sender.replaceTrack(null);
            try {
                await this.session.invite({
                    sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
                });
                track.stop();
            } catch (error) {
                await sender.replaceTrack(track).catch(() => {});
                throw error;
            }
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async transfer(target: string | ISipSession): Promise<void> {
        const onNotify = (notification: Notification) => {
            notification.accept().catch(() => {});
            const body = notification.request.body ?? '';
            const match = body.match(/^SIP\/2\.0\s+(\d{3})\s*(.*)$/m);
            if (!match) return;
            const subscriptionState = notification.request.getHeader('Subscription-State') ?? '';
            const statusCode = Number(match[1]);
            this.bus.emit('transfer-progress', {
                statusCode,
                reasonPhrase: match[2]?.trim() || undefined,
                final: /terminated/i.test(subscriptionState) || statusCode >= 200,
            });
        };

        if (typeof target === "string") {
            let raw = target.trim();
            if (!raw.startsWith("sip:") && !raw.startsWith("sips:")) raw = `sip:${raw}`;
            if (!raw.includes("@")) {
                const domain = this.session.remoteIdentity?.uri?.host;
                if (!domain) throw new Error(`Cannot resolve domain for transfer target: ${raw}`);
                raw = `${raw}@${domain}`;
            }
            const uri = UserAgent.makeURI(raw);
            if (!uri) throw new Error(`Invalid transfer target URI: ${raw}`);
            await this.session.refer(uri, {
                onNotify,
                requestDelegate: {
                    onReject: (response) => this.emitFailed({
                        statusCode: response.message.statusCode,
                        reasonPhrase: response.message.reasonPhrase,
                        cause: response,
                    }),
                },
            });
        } else {
            const otherSession = (target as SipJSSession).getRawSession?.();
            if (!otherSession) throw new Error("Invalid transfer target session");
            await this.session.refer(otherSession, { onNotify });
        }
    }

    async setAudioOutput(deviceId: string): Promise<void> {
        if (!this.remoteElement) return;
        if (typeof this.remoteElement.setSinkId === 'function') {
            await this.remoteElement.setSinkId(deviceId);
        }
    }

    async setAudioInput(deviceId: string): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (!sender) return;

        const previousTrack = sender.track;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        const [newTrack] = stream.getAudioTracks();

        if (!newTrack) {
            stream.getTracks().forEach(track => track.stop());
            throw new Error("No audio track found for selected input device");
        }

        try {
            await sender.replaceTrack(newTrack);
        } catch (error) {
            newTrack.stop();
            throw error;
        }
        previousTrack?.stop();
    }

    setRemoteVolume(volume: number): void {
        if (!this.remoteElement) return;
        if (!this.audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                this.remoteElement.volume = Math.min(1, Math.max(0, volume));
                return;
            }
            this.audioCtx = new AudioCtx();
            const source = this.audioCtx.createMediaElementSource(this.remoteElement);
            this.gainNode = this.audioCtx.createGain();
            source.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
        if (this.gainNode) this.gainNode.gain.value = Math.max(0, volume);
    }

    async sendDTMF(tone: string, options: DtmfOptions = {}): Promise<void> {
        const mode = options.mode ?? 'sip-info';
        const durationMs = options.durationMs ?? 160;

        if (mode === 'rtp-event') {
            return this.sendDtmfRtp(tone, durationMs);
        }

        if (mode === 'auto') {
            try {
                return await this.sendDtmfRtp(tone, durationMs);
            } catch {
                return this.sendDtmfInfo(tone, durationMs);
            }
        }

        return this.sendDtmfInfo(tone, durationMs);
    }

    async shareScreen(): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc) throw new Error("No active peer connection");
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) throw new Error("No video sender available for screen sharing");

        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const [track] = stream.getVideoTracks();
        if (!track) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error("No screen video track available");
        }

        this.originalVideoTrack = sender.track ?? undefined;
        this.screenTrack = track;
        await sender.replaceTrack(track);
        track.onended = () => { this.stopScreenSharing().catch(() => {}); };
    }

    async stopScreenSharing(): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && this.originalVideoTrack) {
            await sender.replaceTrack(this.originalVideoTrack);
        }
        this.screenTrack?.stop();
        this.screenTrack = undefined;
        this.originalVideoTrack = undefined;
    }

    getLocalStream(): MediaStream | undefined {
        const pc = this.getPeerConnection();
        if (!pc) return undefined;
        const tracks = pc.getSenders().map(sender => sender.track).filter((t): t is MediaStreamTrack => !!t && t.kind === 'audio');
        if (!tracks.length) return undefined;
        return new MediaStream(tracks);
    }

    /**
     * `remote` is best-effort: sip.js doesn't report it natively, so it's inferred
     * from the SDP direction (`a=sendonly`/`a=inactive`) on incoming re-INVITEs.
     */
    isOnHold(): { local: boolean; remote: boolean } {
        return { local: this.localHoldState, remote: this.remoteHoldState };
    }

    async getStats(): Promise<CallStats> {
        const pc = this.getPeerConnection();
        if (!pc) return { jitter: 0, packetLoss: 0, roundTripTime: 0, codec: '', bytesSent: 0, bytesReceived: 0 };
        return parseRTCStats(pc);
    }

    async getQuality(): Promise<CallQualitySnapshot> {
        const snapshot = createCallQualitySnapshot(await this.getStats());
        this.bus.emit('quality', snapshot);
        return snapshot;
    }

    private bindStateChanges(): void {
        this.session.stateChange.addListener((state: SessionState) => {
            const status = toSessionStatus(state);
            this.bus.emit('state', status);

            switch (state) {
                case SessionState.Establishing:
                    this.bus.emit('establishing');
                    this.emitProgress();
                    break;
                case SessionState.Established:
                    this.startedAt = new Date();
                    this.onConfirm?.();
                    this.bus.emit('established');
                    this.bindPeerConnectionRecovery();
                    break;
                case SessionState.Terminating:
                    this.bus.emit('terminating');
                    break;
                case SessionState.Terminated:
                    this.cleanupMedia();
                    this.emitTerminatedOnce();
                    break;
            }
        });
    }

    private bindSessionDelegate(): void {
        const currentDelegate = this.session.delegate ?? {};
        this.session.delegate = {
            ...currentDelegate,
            onInvite: (request, response, statusCode) => {
                currentDelegate.onInvite?.(request, response, statusCode);
                const body = request.body ?? '';
                const holding = /a=(sendonly|inactive)\r?\n/i.test(body);
                const active = /a=(sendrecv|recvonly)\r?\n/i.test(body);
                if (!holding && !active) return;
                const isHold = holding && !active;
                if (isHold === this.remoteHoldState) return;
                this.remoteHoldState = isHold;
                if (isHold) {
                    this.bus.emit('hold', { originator: 'remote' });
                } else {
                    this.bus.emit('unhold', { originator: 'remote' });
                }
            },
            onInfo: (info) => {
                currentDelegate.onInfo?.(info);
                const contentType = info.request.getHeader('Content-Type') ?? '';
                if (contentType.includes('dtmf-relay')) {
                    const body = info.request.body ?? '';
                    const match = body.match(/Signal=\s*([0-9#*A-D])/i);
                    const durationMatch = body.match(/Duration=\s*(\d+)/i);
                    if (match) {
                        const event = {
                            tone: match[1],
                            durationMs: durationMatch ? Number(durationMatch[1]) : undefined,
                            mode: 'sip-info' as const,
                        };
                        this.onDTMF?.(event.tone);
                        this.bus.emit('dtmf', event);
                    }
                    info.accept().catch(() => {});
                }
            },
            onRefer: (referral) => {
                currentDelegate.onRefer?.(referral);
                this.bus.emit('refer', { referral, raw: referral });
            },
            onMessage: (message) => {
                currentDelegate.onMessage?.(message);
                this.bus.emit('message', {
                    message,
                    body: message.request.body,
                    contentType: message.request.getHeader('Content-Type') ?? undefined,
                });
            },
            onNotify: (notification) => {
                currentDelegate.onNotify?.(notification);
                this.bus.emit('notify', notification);
            },
            onBye: (bye) => {
                currentDelegate.onBye?.(bye);
                this.emitTerminatedOnce();
            },
        };
    }

    private bindPeerConnectionRecovery(): void {
        const pc = this.getPeerConnection();
        if (!pc || (pc as any).__easySipjsRecoveryBound) return;
        (pc as any).__easySipjsRecoveryBound = true;

        let attempts = 0;
        const maxAttempts = 2;

        const emitState = () => {
            this.bus.emit('media-state', {
                iceConnectionState: pc.iceConnectionState,
                connectionState: pc.connectionState,
                recoveryAttempt: attempts,
            });
        };

        pc.addEventListener('connectionstatechange', emitState);
        pc.addEventListener('iceconnectionstatechange', async () => {
            emitState();

            if (pc.iceConnectionState !== 'failed') return;
            if (attempts >= maxAttempts) {
                this.bus.emit('media-failed', { reason: 'ICE failed and media recovery limit reached.' });
                return;
            }

            attempts += 1;
            try {
                pc.restartIce?.();
                if (this.session.state === SessionState.Established) {
                    await this.session.invite({ requestDelegate: {} });
                }
                this.bus.emit('media-state', {
                    iceConnectionState: pc.iceConnectionState,
                    connectionState: pc.connectionState,
                    recoveryAttempt: attempts,
                });
            } catch (error) {
                this.bus.emit('media-failed', { reason: 'ICE restart/re-INVITE failed.', cause: error });
            }
        });
    }

    private async sendDtmfInfo(tone: string, durationMs: number): Promise<void> {
        const options = {
            requestOptions: {
                body: {
                    contentDisposition: "render",
                    contentType: "application/dtmf-relay",
                    content: `Signal=${tone}\r\nDuration=${durationMs}`,
                },
            },
        };
        await this.session.info(options);
        this.bus.emit('dtmf', { tone, durationMs, mode: 'sip-info' });
    }

    private async sendDtmfRtp(tone: string, durationMs: number): Promise<void> {
        const pc = this.getPeerConnection();
        const sender = pc?.getSenders().find(s => s.track?.kind === 'audio');
        const dtmf = sender?.dtmf;
        if (!dtmf) throw new Error("RTCRtpSender.dtmf is not supported by this browser/session.");
        dtmf.insertDTMF(tone, durationMs);
        this.bus.emit('dtmf', { tone, durationMs, mode: 'rtp-event' });
    }

    private getPeerConnection(): RTCPeerConnection | undefined {
        const handler = this.session.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
        return handler?.peerConnection;
    }

    private cleanupMedia(): void {
        this.screenTrack?.stop();
        this.screenTrack = undefined;
        this.originalVideoTrack = undefined;
        if (this.remoteElement) {
            try { this.remoteElement.pause(); } catch (_) {}
            this.remoteElement.srcObject = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = undefined;
            this.gainNode = undefined;
        }
    }

    private emitTerminatedOnce(event?: SipFailureEvent): void {
        if (this.terminated) return;
        this.terminated = true;
        this.onTerminate?.();
        this.bus.emit('terminated', event);
    }

    private toggleAudioTracks(enabled: boolean): void {
        const handler = this.session.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
        if (!handler) return;
        handler.localMediaStream?.getAudioTracks().forEach(t => { t.enabled = enabled; });
        handler.peerConnection?.getSenders().forEach(s => { if (s.track?.kind === 'audio') s.track.enabled = enabled; });
    }

    private toggleVideoTracks(enabled: boolean): void {
        const handler = this.session.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
        if (!handler) return;
        handler.localMediaStream?.getVideoTracks().forEach(t => { t.enabled = enabled; });
        handler.peerConnection?.getSenders().forEach(s => { if (s.track?.kind === 'video') s.track.enabled = enabled; });
    }

    // Asterisk/PxTalk-friendly hold strategy. Many Asterisk paths mirror direction
    // attributes in re-INVITE answers; `inactive` is self-consistent and stable.
    private static holdSdpModifier = (desc: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
        if (!desc.sdp || desc.type !== 'offer') return Promise.resolve(desc);
        const sdp = desc.sdp
            .replace(/a=sendrecv\r\n/g, 'a=inactive\r\n')
            .replace(/a=sendonly\r\n/g, 'a=inactive\r\n')
            .replace(/a=recvonly\r\n/g, 'a=inactive\r\n');
        return Promise.resolve({ ...desc, sdp });
    };
}

export class SipJSProvider implements ISipProvider {
    private userAgent?: UserAgent;
    private registerer?: Registerer;
    private domain?: string;
    private credentials?: SipCredentials;
    private registered = false;
    private subscribers = new Map<string, Subscriber>();
    private lastPingOkAt?: Date;
    private lastPingLatencyMs?: number;
    private lastPingError?: string;
    private onUserAgent?: ISipUserAgentDelegate;

    async register(
        credentials: SipCredentials,
        onUserAgent: ISipUserAgentDelegate,
        onRegister: ISipRegisterDelegate,
        onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void> {
        this.credentials = credentials;
        this.onUserAgent = onUserAgent;

        const {
            domain,
            phone,
            secret,
            nameexten,
            server,
            userAgentString = "easy-sipjs",
            iceServers,
            debug = false,
            authorizationUsername,
        } = credentials;

        this.domain = domain;

        if (this.userAgent) {
            await this.unregister();
        }

        const uri = UserAgent.makeURI(`sip:${phone}@${domain}`);
        if (!uri) throw new Error("Invalid SIP URI");

        const userAgentDelegate: UserAgentDelegate = {
            onConnect: onUserAgent.onConnect,
            onDisconnect: onUserAgent.onDisconnect,
            onInvite: (invitation: Invitation) => {
                const sipInvitation = this.mapToInvitation(invitation);

                invitation.progress().catch(() => {});
                invitation.stateChange.addListener((state) => {
                    if (state === SessionState.Terminated) sipInvitation.onTerminate?.();
                });

                onUserAgent.onInvite?.(sipInvitation);
            },
            onMessage: onUserAgent.onMessage,
            onNotify: onUserAgent.onNotify,
            onRefer: onUserAgent.onRefer,
            onRegister: onUserAgent.onRegister,
            onSubscribe: onUserAgent.onSubscribe,
        };

        this.userAgent = new UserAgent({
            displayName: nameexten ?? phone,
            authorizationUsername: authorizationUsername ?? phone,
            authorizationPassword: secret,
            uri,
            contactName: phone,
            viaHost: domain,
            transportOptions: { server, traceSip: debug },
            userAgentString,
            contactParams: { transport: "wss" },
            delegate: userAgentDelegate,
            logLevel: debug ? "log" : "error",
            logConnector: debug
                ? (level: string, category: string, label: string | undefined, content: string) => {
                    onSipLog?.(level, category, label || "", content);
                }
                : undefined,
            sessionDescriptionHandlerFactoryOptions: iceServers ? {
                peerConnectionConfiguration: { iceServers }
            } : undefined
        });

        this.userAgent.contact.pubGruu = uri;
        this.userAgent.contact.tempGruu = uri;

        await this.userAgent.start();
        this.patchContentLengthForModifiedSipBodies();

        this.registerer = new Registerer(this.userAgent, { expires: 3600 });

        const registerDelegate: Core.OutgoingRequestDelegate = {
            onAccept: (response) => {
                this.registered = true;
                onRegister.onAccept?.(response);
            },
            onReject: (response) => {
                this.registered = false;
                onRegister.onReject?.(response);
            },
            onTrying: onRegister.onTrying,
            onRedirect: onRegister.onRedirect,
        };

        await this.registerer.register({ requestDelegate: registerDelegate } as RegistererRegisterOptions);
    }

    async refreshRegistration(): Promise<void> {
        if (!this.registerer) throw new Error("Registerer not initialized.");
        await this.registerer.register();
        this.registered = true;
    }

    async reconnect(): Promise<void> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");
        await this.userAgent.reconnect();
        if (this.registerer) await this.refreshRegistration();
    }

    async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
        const startedAt = performance.now?.() ?? Date.now();
        try {
            await this.sendOptionsPing();
            const latencyMs = (performance.now?.() ?? Date.now()) - startedAt;
            this.lastPingOkAt = new Date();
            this.lastPingLatencyMs = latencyMs;
            this.lastPingError = undefined;
            return { ok: true, latencyMs };
        } catch (error) {
            this.lastPingError = error instanceof Error ? error.message : String(error);
            return { ok: false, error: this.lastPingError };
        }
    }

    getHealth(): Partial<SipHealthStatus> {
        return {
            websocketConnected: this.userAgent?.isConnected() ?? false,
            registered: this.registered,
            lastPingOkAt: this.lastPingOkAt,
            lastPingLatencyMs: this.lastPingLatencyMs,
            lastPingError: this.lastPingError,
        };
    }

    async subscribePresence(target: string, options: PresenceSubscribeOptions = {}): Promise<void> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");
        const uri = UserAgent.makeURI(this.resolveURI(target));
        if (!uri) throw new Error(`Invalid presence target URI: ${target}`);

        const key = `${options.event ?? 'presence'}:${uri.toString()}`;
        await this.unsubscribePresence(key).catch(() => {});

        const subscriber = new Subscriber(this.userAgent, uri, options.event ?? 'presence', {
            expires: options.expires ?? 3600,
            extraHeaders: options.extraHeaders,
        });

        subscriber.delegate = {
            onNotify: (notification) => {
                notification.accept().catch(() => {});
                const presence = this.parsePresenceNotification(target, notification);
                this.onUserAgent?.onPresence?.(presence);
            },
        };

        subscriber.stateChange.addListener((state) => {
            if (state === SubscriptionState.Terminated) {
                this.subscribers.delete(key);
            }
        });

        this.subscribers.set(key, subscriber);
        await subscriber.subscribe();
    }

    async unsubscribePresence(target: string): Promise<void> {
        const direct = this.subscribers.get(target);
        if (direct) {
            await direct.unsubscribe().catch(() => {});
            this.subscribers.delete(target);
            return;
        }

        for (const [key, subscriber] of [...this.subscribers.entries()]) {
            if (key.includes(target)) {
                await subscriber.unsubscribe().catch(() => {});
                this.subscribers.delete(key);
            }
        }
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");

        const { destination, localElement, remoteElement, video, extraHeaders } = options;
        const target = UserAgent.makeURI(this.resolveURI(destination));
        if (!target) throw new Error("Invalid destination URI");

        const inviter = new Inviter(this.userAgent, target, {
            extraHeaders: extraHeaders || []
        });
        const sipSession = new SipJSSession(inviter);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(inviter, localElement, remoteElement);

        await inviter.invite({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
            requestDelegate: {
                onTrying: (response) => sipSession.emitProgress(responseToProgressEvent(response, 100)),
                onProgress: (response) => sipSession.emitProgress(responseToProgressEvent(response)),
                onAccept: () => undefined,
                onReject: (response) => {
                    sipSession.emitFailed({
                        statusCode: response.message.statusCode ?? 0,
                        reasonPhrase: response.message.reasonPhrase,
                        cause: response,
                        originator: 'remote',
                    });
                },
            },
        });

        return sipSession;
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");

        const { localElement, remoteElement, video, extraHeaders } = options;
        const rawInvitation = invitation.raw as Invitation;
        const sipSession = new SipJSSession(rawInvitation);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(rawInvitation, localElement, remoteElement);

        await rawInvitation.accept({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
            extraHeaders: extraHeaders || []
        });

        return sipSession;
    }

    async unregister(): Promise<void> {
        for (const subscriber of this.subscribers.values()) {
            await subscriber.unsubscribe().catch(() => {});
        }
        this.subscribers.clear();

        if (this.registerer) {
            try {
                await this.registerer.unregister();
            } catch (_) {}
            this.registerer = undefined;
        }
        this.registered = false;
        if (this.userAgent) {
            await this.userAgent.stop();
            this.userAgent = undefined;
        }
    }

    async sendMessage(destination: string, body: string): Promise<void> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");
        const target = UserAgent.makeURI(this.resolveURI(destination));
        if (!target) throw new Error("Invalid destination URI");
        const messager = new Messager(this.userAgent, target, body);
        await messager.message();
    }

    private resolveURI(destination: string): string {
        const withPrefix = ensureSipPrefix(destination);
        if (!withPrefix.includes('@') && this.domain) {
            return `sip:${destination.replace(/^sip:/i, '')}@${this.domain}`;
        }
        return withPrefix;
    }

    private async sendOptionsPing(): Promise<void> {
        if (!this.userAgent || !this.credentials) throw new Error("UserAgent not initialized.");
        const aor = UserAgent.makeURI(`sip:${this.credentials.phone}@${this.credentials.domain}`);
        if (!aor) throw new Error("Invalid SIP AOR for OPTIONS ping.");
        const requestURI = aor.clone();
        requestURI.user = undefined;
        const fromURI = aor.clone();
        const toURI = aor.clone();
        const core = this.userAgent.userAgentCore;
        const message = core.makeOutgoingRequestMessage("OPTIONS", requestURI, fromURI, toURI, {});

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("OPTIONS ping timed out.")), 7000);
            const request = core.request(message, {
                onAccept: () => { clearTimeout(timeout); request.dispose(); resolve(); },
                onReject: (response) => {
                    clearTimeout(timeout);
                    request.dispose();
                    const statusCode = response.message.statusCode;
                    if (statusCode === 408 || statusCode === 503) {
                        reject(new Error(`OPTIONS ping failed with SIP ${statusCode}.`));
                    } else {
                        resolve();
                    }
                },
            });
        });
    }

    private parsePresenceNotification(target: string, notification: Notification): PresenceEvent {
        const body = notification.request.body ?? '';
        const contentType = notification.request.getHeader('Content-Type') ?? undefined;
        return parsePresenceBody(target, body, contentType, notification);
    }

    private mapToInvitation(invitation: Invitation): SipInvitation {
        return {
            remoteIdentity: {
                uri: { user: invitation.remoteIdentity.uri.user! },
                displayName: invitation.remoteIdentity.displayName
            },
            accept: async (options) => { await invitation.accept(options as InvitationAcceptOptions | undefined); },
            reject: async (options) => { await invitation.reject(options as InvitationRejectOptions | undefined); },
            raw: invitation
        };
    }

    private patchContentLengthForModifiedSipBodies(): void {
        const transport = this.userAgent?.transport;
        if (!transport || typeof transport.onMessage !== 'function') return;
        const origOnMessage = transport.onMessage.bind(transport);
        transport.onMessage = (raw: string) => {
            const sep = raw.indexOf('\r\n\r\n');
            if (sep === -1) return origOnMessage(raw);
            const body = raw.slice(sep + 4);
            const actualBodyLen = new TextEncoder().encode(body).length;
            const patched = raw.replace(/Content-Length:\s*\d+\r\n/i, `Content-Length: ${actualBodyLen}\r\n`);
            origOnMessage(patched);
        };
    }

    public getUserAgent() { return this.userAgent; }
    public getRegisterer() { return this.registerer; }
}
