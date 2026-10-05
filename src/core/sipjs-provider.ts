import {
    UserAgent,
    Registerer,
    RegistererRegisterOptions,
    RegistererState,
    UserAgentDelegate,
    Inviter,
    Session,
    Invitation,
    Messager,
    Web,
    SessionState,
    SessionInviteOptions,
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
    SipRegisterResult,
    SipSessionDefaults,
} from "./types.js";
import { SipError } from "./errors.js";
import { assignStream, releaseElement, setElementSink, setElementVolume } from "./media.js";
import { CallStatsSampler, emptyCallStats, ensureSipPrefix } from "./utils.js";
import { createCallQualitySnapshot } from "./call-quality.js";
import { SessionEventBus, SessionListener } from "./session-event-bus.js";
import { parsePresenceBody } from "./presence.js";

const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 1000;
// Above SIP Timer F (32s), after which the stack itself fails the request with a 408.
const REGISTER_TIMEOUT_MS = 40000;
const FORCED_DISCONNECT_TIMEOUT_MS = 2000;
const textEncoder = new TextEncoder();

const DEFAULT_MEDIA_RECOVERY_ATTEMPTS = 2;
const DEFAULT_DISCONNECTED_GRACE_MS = 3000;

function registerError(response: Core.IncomingResponse): SipError {
    const { statusCode, reasonPhrase } = response.message;
    return new SipError(
        'register-rejected',
        `REGISTER rejected with SIP ${statusCode ?? 'error'}${reasonPhrase ? ` ${reasonPhrase}` : ''}.`,
        { statusCode, reasonPhrase, response },
    );
}

/**
 * The app decides what to do with a message, not whether the sender gets an answer:
 * reply 200 OK right away, and leave `accept()` as a harmless no-op for apps that
 * still call it (a second real accept would throw).
 */
function acknowledgeMessage(message: { accept(): Promise<void> }): void {
    message.accept().catch(() => {});
    message.accept = () => Promise.resolve();
}

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

    private localElement?: HTMLMediaElement;
    private remoteElement?: HTMLMediaElement;
    private originalVideoTrack?: MediaStreamTrack;
    private screenTrack?: MediaStreamTrack;
    private _muted = false;
    private reinviteInProgress = false;
    private terminated = false;
    private failure?: SipFailureEvent;
    private localHoldState = false;
    private remoteHoldState = false;
    private bus = new SessionEventBus();
    private stats = new CallStatsSampler();
    private recoveryBoundTo?: RTCPeerConnection;
    private recoveryAttempts = 0;
    private recoveryTimer?: ReturnType<typeof setTimeout>;
    private recovering = false;

    constructor(private session: Session, private settings: SipSessionDefaults = {}) {
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
        this.attachMedia();
    }

    setLocalElement(el: HTMLMediaElement) {
        this.localElement = el;
        this.attachMedia();
    }

    getRawSession(): Session {
        return this.session;
    }

    emitProgress(event?: SipSessionProgressEvent): void {
        this.onProgress?.();
        this.bus.emit('progress', event);
    }

    emitFailed(event: SipFailureEvent): void {
        this.failure = event;
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
        if (this.session.state !== SessionState.Established || this.localHoldState) return;
        this.assertNoReinviteInProgress();
        this.reinviteInProgress = true;
        try {
            await this.reinvite(this.holdOptions(true));
            this.toggleAudioTracks(false);
            this.localHoldState = true;
            this.onHold?.();
            this.bus.emit('hold', { originator: 'local' });
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async unhold(): Promise<void> {
        if (this.session.state !== SessionState.Established || !this.localHoldState) return;
        this.assertNoReinviteInProgress();
        this.reinviteInProgress = true;
        try {
            await this.reinvite(this.holdOptions(false));
            if (!this._muted) this.toggleAudioTracks(true);
            this.localHoldState = false;
            this.onUnhold?.();
            this.bus.emit('unhold', { originator: 'local' });
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async upgradeToVideo(): Promise<void> {
        if (this.session.state !== SessionState.Established) return;
        const pc = this.getPeerConnection();
        if (pc?.getSenders().some(s => s.track?.kind === 'video')) return;

        this.assertNoReinviteInProgress();
        this.reinviteInProgress = true;
        try {
            // sip.js's default SessionDescriptionHandler acquires the camera itself and
            // adds the resulting track to the peer connection when `constraints.video`
            // flips to true on a re-INVITE — no manual getUserMedia/addTrack needed here.
            await this.reinvite({
                sessionDescriptionHandlerOptions: { constraints: { audio: true, video: true } },
            });
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async downgradeToAudio(): Promise<void> {
        if (this.session.state !== SessionState.Established) return;
        const pc = this.getPeerConnection();
        const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
        const track = sender?.track;
        if (!sender || !track) return;

        this.assertNoReinviteInProgress();
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
                await this.reinvite({
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
            if (!uri) throw new SipError('invalid-uri', `Invalid transfer target URI: ${raw}`);
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
        await setElementSink(this.remoteElement, deviceId);
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

    /** 0–1 sets the element volume; above 1 amplifies through a gain node. */
    setRemoteVolume(volume: number): void {
        if (!this.remoteElement) return;
        setElementVolume(this.remoteElement, volume);
    }

    async sendDTMF(tone: string, options: DtmfOptions = {}): Promise<void> {
        const mode = options.mode ?? this.settings.dtmfMode ?? 'sip-info';
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
        if (!pc) return emptyCallStats();
        return this.stats.sample(pc);
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
                    this.attachMedia();
                    this.bindPeerConnectionRecovery();
                    break;
                case SessionState.Terminating:
                    this.bus.emit('terminating');
                    break;
                case SessionState.Terminated:
                    this.cleanupMedia();
                    if (this.session instanceof Inviter && !this.startedAt) {
                        // sip.js moves an unanswered call to Terminated *before* handing the
                        // final response to the INVITE's onReject. Waiting one microtask lets
                        // 'failed' go out first, so 'terminated' carries the status code.
                        queueMicrotask(() => this.emitTerminatedOnce(this.failure));
                    } else {
                        this.emitTerminatedOnce(this.failure);
                    }
                    break;
            }
        });
    }

    /**
     * Wires the SIP stack's media streams to the app's elements. Runs as soon as
     * the session description handler exists — the streams are created with it and
     * tracks are added to those same objects later — so early media (183) plays
     * and answered audio starts without waiting for the Established transition.
     */
    private attachMedia(handler: unknown = this.session.sessionDescriptionHandler): void {
        if (!(handler instanceof Web.SessionDescriptionHandler)) return;
        if (this.localElement) assignStream(handler.localMediaStream, this.localElement);
        if (this.remoteElement) assignStream(handler.remoteMediaStream, this.remoteElement);
    }

    private assertNoReinviteInProgress(): void {
        if (this.reinviteInProgress) {
            throw new SipError('reinvite-in-progress', "Another re-INVITE is still in progress on this session.");
        }
    }

    private holdOptions(hold: boolean): SessionInviteOptions {
        const strategy = this.settings.holdStrategy ?? 'asterisk-inactive';
        if (strategy === 'sipjs-default') {
            // sip.js keeps these options for later re-INVITEs, so the flag has to be
            // written back as false on unhold rather than just left out.
            return {
                sessionDescriptionHandlerOptions: {
                    ...this.session.sessionDescriptionHandlerOptionsReInvite,
                    hold,
                } as Web.SessionDescriptionHandlerOptions,
                sessionDescriptionHandlerModifiers: [],
            };
        }
        if (!hold) return { sessionDescriptionHandlerModifiers: [] };
        return {
            sessionDescriptionHandlerModifiers: [
                strategy === 'asterisk-sendonly' ? SipJSSession.holdSendonlySdpModifier : SipJSSession.holdSdpModifier,
            ],
        };
    }

    /** `session.invite()` resolves once the re-INVITE is sent; this waits for the peer's final answer. */
    private reinvite(options: SessionInviteOptions = {}): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.session.invite({
                ...options,
                requestDelegate: {
                    onAccept: () => resolve(),
                    onReject: (response) => reject(new SipError(
                        'reinvite-rejected',
                        `re-INVITE rejected with SIP ${response.message.statusCode ?? 'error'}.`,
                        { statusCode: response.message.statusCode, reasonPhrase: response.message.reasonPhrase, response },
                    )),
                },
            }).catch(reject);
        });
    }

    private bindSessionDelegate(): void {
        const currentDelegate = this.session.delegate ?? {};
        this.session.delegate = {
            ...currentDelegate,
            onSessionDescriptionHandler: (handler, provisional) => {
                currentDelegate.onSessionDescriptionHandler?.(handler, provisional);
                this.attachMedia(handler);
            },
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
                acknowledgeMessage(message);
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
        if (!pc || this.recoveryBoundTo === pc) return;
        this.recoveryBoundTo = pc;

        const recovery = this.settings.mediaRecovery ?? {};
        const graceMs = recovery.disconnectedGraceMs ?? DEFAULT_DISCONNECTED_GRACE_MS;

        pc.addEventListener('connectionstatechange', () => this.emitMediaState(pc));
        pc.addEventListener('iceconnectionstatechange', () => {
            this.emitMediaState(pc);
            if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
            this.recoveryTimer = undefined;

            const state = pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') {
                this.recoveryAttempts = 0;
                return;
            }
            if (recovery.enabled === false) {
                if (state === 'failed') this.bus.emit('media-failed', { reason: 'ICE connection failed.' });
                return;
            }
            if (state === 'failed') {
                void this.attemptMediaRecovery();
            } else if (state === 'disconnected') {
                // Browsers take 15–30s to go from `disconnected` to `failed`. Past a short
                // grace period (blips recover by themselves) it's not worth the silence.
                this.recoveryTimer = setTimeout(() => void this.attemptMediaRecovery(), graceMs);
            }
        });
    }

    async recoverMedia(): Promise<void> {
        this.recoveryAttempts = 0;
        await this.attemptMediaRecovery();
    }

    private emitMediaState(pc: RTCPeerConnection): void {
        this.bus.emit('media-state', {
            iceConnectionState: pc.iceConnectionState,
            connectionState: pc.connectionState,
            recoveryAttempt: this.recoveryAttempts,
        });
    }

    private async attemptMediaRecovery(): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc || this.terminated || this.session.state !== SessionState.Established) return;
        if (pc.iceConnectionState !== 'failed' && pc.iceConnectionState !== 'disconnected') return;
        if (this.recovering || this.reinviteInProgress) return;

        const recovery = this.settings.mediaRecovery ?? {};
        if (this.recoveryAttempts >= (recovery.maxAttempts ?? DEFAULT_MEDIA_RECOVERY_ATTEMPTS)) {
            this.bus.emit('media-failed', { reason: 'ICE failed and media recovery limit reached.' });
            return;
        }

        this.recovering = true;
        this.recoveryAttempts += 1;
        // sip.js remembers the options of a re-INVITE for the next ones; ICE restart is
        // only wanted on this one.
        const previousOptions = this.session.sessionDescriptionHandlerOptionsReInvite;
        try {
            const restartIce = recovery.restartIceOnFailure !== false;
            await this.reinvite(restartIce ? {
                // Telling sip.js about the restart makes it wait for the new candidates
                // instead of sending the offer with the old gathering already "complete".
                sessionDescriptionHandlerOptions: {
                    ...previousOptions,
                    offerOptions: { iceRestart: true },
                } as Web.SessionDescriptionHandlerOptions,
            } : {});
            this.emitMediaState(pc);
        } catch (error) {
            this.bus.emit('media-failed', { reason: 'ICE restart/re-INVITE failed.', cause: error });
        } finally {
            this.session.sessionDescriptionHandlerOptionsReInvite = previousOptions;
            this.recovering = false;
        }
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
        if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
        this.recoveryTimer = undefined;
        this.screenTrack?.stop();
        this.screenTrack = undefined;
        this.originalVideoTrack = undefined;
        releaseElement(this.remoteElement);
        releaseElement(this.localElement);
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

    private static holdSendonlySdpModifier = (desc: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
        if (!desc.sdp || desc.type !== 'offer') return Promise.resolve(desc);
        const sdp = desc.sdp
            .replace(/a=sendrecv\r\n/g, 'a=sendonly\r\n')
            .replace(/a=recvonly\r\n/g, 'a=inactive\r\n');
        return Promise.resolve({ ...desc, sdp });
    };
}

export class SipJSProvider implements ISipProvider {
    // sip.js's Registerer renews the binding itself, based on the expiry the registrar granted.
    public readonly managesRegistrationRefresh = true;

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
    private sessionDefaults: SipSessionDefaults = {};

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
            iceGatheringTimeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS,
            contactParams = { transport: "ws" },
            uniqueContact = false,
            debug = false,
            authorizationUsername,
        } = credentials;

        this.domain = domain;
        this.sessionDefaults = {
            dtmfMode: credentials.dtmfMode,
            holdStrategy: credentials.holdStrategy,
            mediaRecovery: credentials.mediaRecovery,
        };

        if (this.userAgent) {
            await this.unregister();
        }

        const uri = UserAgent.makeURI(`sip:${phone}@${domain}`);
        if (!uri) throw new SipError('invalid-uri', "Invalid SIP URI");

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
            onMessage: (message) => {
                acknowledgeMessage(message);
                onUserAgent.onMessage?.(message);
            },
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
            ...(uniqueContact ? {} : { contactName: phone, viaHost: domain }),
            transportOptions: { server, traceSip: debug },
            userAgentString,
            contactParams,
            delegate: userAgentDelegate,
            logLevel: debug ? "log" : "error",
            logConnector: debug
                ? (level: string, category: string, label: string | undefined, content: string) => {
                    onSipLog?.(level, category, label || "", content);
                }
                : undefined,
            sessionDescriptionHandlerFactoryOptions: {
                iceGatheringTimeout: iceGatheringTimeoutMs,
                ...(iceServers ? { peerConnectionConfiguration: { iceServers } } : {}),
            }
        });

        if (!uniqueContact) {
            this.userAgent.contact.pubGruu = uri;
            this.userAgent.contact.tempGruu = uri;
        }

        await this.userAgent.start();
        this.patchContentLengthForModifiedSipBodies();

        const registerer = new Registerer(this.userAgent, { expires: 3600 });
        this.registerer = registerer;

        // The Registerer's own state is the source of truth: it also covers the
        // refreshes it sends by itself and a binding that expires because one failed.
        registerer.stateChange.addListener((state) => {
            if (this.registerer !== registerer) return;
            const wasRegistered = this.registered;
            this.registered = state === RegistererState.Registered;
            if (wasRegistered && state === RegistererState.Unregistered) onRegister.onUnregistered?.();
        });

        await this.sendRegister(onRegister);
    }

    async refreshRegistration(): Promise<void> {
        await this.sendRegister();
    }

    async reconnect(options: { force?: boolean } = {}): Promise<void> {
        if (!this.userAgent) throw new SipError('not-initialized', "UserAgent not initialized.");
        if (options.force && this.userAgent.isConnected()) {
            // A half-open socket still reports "connected", so `reconnect()` alone would
            // keep using it. Drop it first; a dead peer may never complete the close
            // handshake, hence the cap on how long to wait for it.
            await Promise.race([
                this.userAgent.transport.disconnect(),
                new Promise(resolve => setTimeout(resolve, FORCED_DISCONNECT_TIMEOUT_MS)),
            ]).catch(() => {});
        }
        await this.userAgent.reconnect();
        if (this.registerer) await this.sendRegister();
    }

    /** Sends a REGISTER and resolves only when the registrar accepts it. */
    private sendRegister(delegate?: ISipRegisterDelegate): Promise<void> {
        const registerer = this.registerer;
        if (!registerer) return Promise.reject(new SipError('not-initialized', "Registerer not initialized."));

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new SipError('register-timeout', "REGISTER timed out.")), REGISTER_TIMEOUT_MS);
            const requestDelegate: Core.OutgoingRequestDelegate = {
                onAccept: (response) => {
                    clearTimeout(timeout);
                    delegate?.onAccept?.(response);
                    resolve();
                },
                onReject: (response) => {
                    clearTimeout(timeout);
                    delegate?.onReject?.(response);
                    reject(registerError(response));
                },
                onTrying: delegate?.onTrying,
                onRedirect: delegate?.onRedirect,
            };
            registerer.register({ requestDelegate } as RegistererRegisterOptions).catch((error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
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
        if (!this.userAgent) throw new SipError('not-initialized', "UserAgent not initialized.");
        const uri = UserAgent.makeURI(this.resolveURI(target));
        if (!uri) throw new SipError('invalid-uri', `Invalid presence target URI: ${target}`);

        const key = `${options.event ?? 'presence'}:${uri.toString()}`;
        await this.unsubscribePresence(key);

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
            if (state === SubscriptionState.Terminated && this.subscribers.get(key) === subscriber) {
                this.subscribers.delete(key);
            }
        });

        this.subscribers.set(key, subscriber);
        await subscriber.subscribe();
    }

    /** `target` is an extension/URI (every event package subscribed for it) or an exact `event:uri` key. */
    async unsubscribePresence(target: string): Promise<void> {
        let keys: string[] = [];
        if (this.subscribers.has(target)) {
            keys = [target];
        } else {
            const uri = UserAgent.makeURI(this.resolveURI(target))?.toString();
            if (uri) keys = [...this.subscribers.keys()].filter(key => key.endsWith(`:${uri}`));
        }

        await Promise.all(keys.map(async (key) => {
            const subscriber = this.subscribers.get(key);
            this.subscribers.delete(key);
            await subscriber?.unsubscribe().catch(() => {});
        }));
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new SipError('not-initialized', "UserAgent not initialized.");

        const { destination, localElement, remoteElement, video, extraHeaders, earlyMedia } = options;
        const target = UserAgent.makeURI(this.resolveURI(destination));
        if (!target) throw new SipError('invalid-uri', "Invalid destination URI");

        const inviter = new Inviter(this.userAgent, target, {
            extraHeaders: extraHeaders || [],
            earlyMedia: !!earlyMedia,
        });
        const sipSession = new SipJSSession(inviter, this.sessionDefaults);
        if (localElement) sipSession.setLocalElement(localElement);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

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
        if (!this.userAgent) throw new SipError('not-initialized', "UserAgent not initialized.");

        const { localElement, remoteElement, video, extraHeaders } = options;
        const rawInvitation = invitation.raw as Invitation;
        const sipSession = new SipJSSession(rawInvitation, this.sessionDefaults);
        if (localElement) sipSession.setLocalElement(localElement);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        await rawInvitation.accept({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
            extraHeaders: extraHeaders || []
        });

        return sipSession;
    }

    async unregister(): Promise<void> {
        const subscribers = [...this.subscribers.values()];
        this.subscribers.clear();
        await Promise.all(subscribers.map(subscriber => subscriber.unsubscribe().catch(() => {})));

        // Cleared first so the state listener ignores this deliberate unregister.
        const registerer = this.registerer;
        this.registerer = undefined;
        this.registered = false;
        if (registerer) {
            try {
                await registerer.unregister();
            } catch (_) {}
        }
        if (this.userAgent) {
            await this.userAgent.stop();
            this.userAgent = undefined;
        }
    }

    async sendMessage(destination: string, body: string): Promise<void> {
        if (!this.userAgent) throw new SipError('not-initialized', "UserAgent not initialized.");
        const target = UserAgent.makeURI(this.resolveURI(destination));
        if (!target) throw new SipError('invalid-uri', "Invalid destination URI");
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
        if (!this.userAgent || !this.credentials) throw new SipError('not-initialized', "UserAgent not initialized.");
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
            const actualBodyLen = textEncoder.encode(body).length;
            const patched = raw.replace(/Content-Length:\s*\d+\r\n/i, `Content-Length: ${actualBodyLen}\r\n`);
            origOnMessage(patched);
        };
    }

    getRegisterResult(): SipRegisterResult {
        return { userAgent: this.userAgent, registerer: this.registerer };
    }

    public getUserAgent() { return this.userAgent; }
    public getRegisterer() { return this.registerer; }
}
