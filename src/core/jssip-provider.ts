import JsSIP from "jssip";
import type { DTMF_TRANSPORT } from "jssip/lib/Constants.js";
import type { RTCSession, EndEvent, IncomingEvent, OutgoingEvent, IncomingDTMFEvent, OutgoingDTMFEvent, ReferEvent, HoldEvent, AnswerOptions as JsSipAnswerOptions, TerminateOptions as JsSipTerminateOptions, DTMFOptions as JsSipDtmfOptions } from "jssip/lib/RTCSession.js";
import type { UA, RTCSessionEvent, IncomingMessageEvent, OutgoingMessageEvent } from "jssip/lib/UA.js";
import type { IncomingRequest } from "jssip/lib/SIPMessage.js";
import type { Subscriber } from "jssip/lib/Subscriber.js";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider.js";
import { SipCredentials, CallOptions, AnswerOptions, SipInvitation, CallStats, CallQualitySnapshot, DtmfOptions, SipSessionEventMap, SipFailureEvent, SipHealthStatus, PresenceSubscribeOptions, SipRegisterResult } from "./types.js";
import { assignStream, releaseElement, setElementSink, setElementVolume } from "./media.js";
import { CallStatsSampler, emptyCallStats, ensureSipPrefix } from "./utils.js";
import { createCallQualitySnapshot } from "./call-quality.js";
import { SessionEventBus, SessionListener } from "./session-event-bus.js";
import { parsePresenceBody } from "./presence.js";

const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 1000;
// Above SIP Timer F (32s), after which the stack itself fails the request.
const REGISTER_TIMEOUT_MS = 40000;

interface JsSipNotifyEvent {
    event: string;
    params?: Record<string, unknown>;
}

export class JsSIPSession implements ISipSession {
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
    private terminated = false;
    private bus = new SessionEventBus();
    private stats = new CallStatsSampler();

    constructor(private session: RTCSession, iceGatheringTimeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS) {
        this.id = session.id || Math.random().toString(36).substring(2, 11);

        if (iceGatheringTimeoutMs > 0) {
            // JsSIP waits for ICE gathering to finish before sending the SDP, which stalls
            // the call for many seconds when a STUN/TURN server doesn't answer. `ready()`
            // tells it to go ahead with the candidates gathered so far.
            const scheduled = new WeakSet<() => void>();
            this.session.on("icecandidate", (event: { ready: () => void }) => {
                if (scheduled.has(event.ready)) return;
                scheduled.add(event.ready);
                setTimeout(() => event.ready(), iceGatheringTimeoutMs);
            });
        }

        this.session.on("progress", (event: IncomingEvent | OutgoingEvent) => {
            this.onProgress?.();
            this.bus.emit('state', 'establishing');
            this.bus.emit('establishing');
            const response = 'response' in event ? event.response : undefined;
            this.bus.emit('progress', {
                method: 'INVITE',
                statusCode: response?.status_code ?? 180,
                reasonPhrase: response?.reason_phrase,
                raw: event,
            });
        });

        this.session.on("accepted", () => {
            this.startedAt = new Date();
            this.onConfirm?.();
            this.bus.emit('state', 'established');
            this.bus.emit('established');
        });

        this.session.on("hold", (event: HoldEvent) => {
            this.onHold?.();
            this.bus.emit('hold', { originator: event.originator as unknown as 'local' | 'remote' | 'system' });
        });
        this.session.on("unhold", (event: HoldEvent) => {
            this.onUnhold?.();
            this.bus.emit('unhold', { originator: event.originator as unknown as 'local' | 'remote' | 'system' });
        });

        this.session.on("refer", (event) => {
            this.bus.emit('refer', { referral: event, raw: event });
        });

        this.session.on("peerconnection", (event) => {
            const pc = event.peerconnection;
            pc.addEventListener("track", (trackEvent) => {
                if (this.remoteElement && trackEvent.streams?.[0]) {
                    assignStream(trackEvent.streams[0], this.remoteElement);
                }
            });

            const emitMediaState = () => {
                this.bus.emit('media-state', {
                    iceConnectionState: pc.iceConnectionState,
                    connectionState: pc.connectionState,
                });
            };
            pc.addEventListener('connectionstatechange', emitMediaState);
            pc.addEventListener('iceconnectionstatechange', () => {
                emitMediaState();
                if (pc.iceConnectionState === 'failed') {
                    this.bus.emit('media-failed', { reason: 'ICE connection failed.' });
                }
            });
        });

        this.session.on("ended", (event: EndEvent) => {
            this.cleanupAudio();
            this.emitTerminatedOnce({
                reasonPhrase: event.cause,
                cause: event,
                originator: event.originator,
            });
        });

        this.session.on("failed", (event: EndEvent) => {
            this.cleanupAudio();
            const statusCode = "status_code" in event.message ? (event.message as { status_code?: number }).status_code : undefined;
            if (event.originator !== "local") {
                this.onReject?.(statusCode ?? 0);
            }
            this.bus.emit('failed', {
                statusCode,
                reasonPhrase: event.cause,
                cause: event,
                originator: event.originator,
            });
            this.emitTerminatedOnce({
                statusCode,
                reasonPhrase: event.cause,
                cause: event,
                originator: event.originator,
            });
        });

        this.session.on("newDTMF", (event: IncomingDTMFEvent | OutgoingDTMFEvent) => {
            if (event.dtmf) {
                this.onDTMF?.(event.dtmf.tone);
                this.bus.emit('dtmf', { tone: event.dtmf.tone, durationMs: event.dtmf.duration });
            }
        });
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

    getRawSession(): RTCSession {
        return this.session;
    }

    getCallDuration(): number {
        if (!this.startedAt) return 0;
        return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    }

    async bye(): Promise<void> {
        this.bus.emit('state', 'terminating');
        this.bus.emit('terminating');
        try {
            this.session.terminate();
        } finally {
            this.cleanupAudio();
            this.emitTerminatedOnce();
        }
    }

    mute(): void { this.session.mute({ audio: true }); }
    unmute(): void { this.session.unmute({ audio: true }); }
    muteVideo(): void { this.session.mute({ video: true }); }
    unmuteVideo(): void { this.session.unmute({ video: true }); }

    async hold(): Promise<void> {
        this.session.hold();
    }

    async unhold(): Promise<void> {
        this.session.unhold();
    }

    async upgradeToVideo(): Promise<void> {
        const pc = this.session.connection;
        if (!pc) throw new Error("No active peer connection");
        if (pc.getSenders().some(s => s.track?.kind === 'video')) return;
        if (!this.session.isReadyToReOffer()) {
            throw new Error("Session is not ready for a new offer (renegotiation already in progress, or call not established).");
        }

        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const [videoTrack] = stream.getVideoTracks();
        if (!videoTrack) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error("No video track available");
        }

        try {
            pc.addTrack(videoTrack, stream);
            // On failure JsSIP's own `renegotiate()` terminates the whole call
            // (see RTCSession's internal `failed` handler) — that's jssip's behavior,
            // not something layered on here.
            await new Promise<void>((resolve, reject) => {
                const started = this.session.renegotiate({}, () => resolve());
                if (!started) reject(new Error("Unable to renegotiate: session not ready for a new offer."));
            });
        } catch (error) {
            videoTrack.stop();
            throw error;
        }
    }

    async downgradeToAudio(): Promise<void> {
        const pc = this.session.connection;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender?.track) return;

        sender.track.stop();
        await sender.replaceTrack(null);
        await new Promise<void>((resolve, reject) => {
            const started = this.session.renegotiate({}, () => resolve());
            if (!started) reject(new Error("Unable to renegotiate: session not ready for a new offer."));
        });
    }

    async transfer(target: string | ISipSession): Promise<void> {
        if (typeof target === "string") {
            this.session.refer(target);
        } else {
            const rawSession = (target as unknown as JsSIPSession).getRawSession();
            if (!rawSession) throw new Error("Cannot access raw session for attended transfer");
            this.session.refer(rawSession.remote_identity.uri.toString(), { replaces: rawSession });
        }
    }

    getLocalStream(): MediaStream | undefined {
        const pc = this.session.connection;
        if (!pc) return undefined;
        const tracks = pc.getSenders().map(sender => sender.track).filter((t): t is MediaStreamTrack => !!t && t.kind === 'audio');
        if (!tracks.length) return undefined;
        return new MediaStream(tracks);
    }

    isOnHold(): { local: boolean; remote: boolean } {
        return this.session.isOnHold();
    }

    async setAudioOutput(deviceId: string): Promise<void> {
        if (!this.remoteElement) return;
        await setElementSink(this.remoteElement, deviceId);
    }

    async setAudioInput(deviceId: string): Promise<void> {
        const pc = this.session.connection;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (!sender) return;
        const previousTrack = sender.track;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        const [newTrack] = stream.getAudioTracks();
        if (!newTrack) { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
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
        const dtmfOptions: JsSipDtmfOptions & { transportType?: DTMF_TRANSPORT } = {};
        if (options.durationMs !== undefined) dtmfOptions.duration = options.durationMs;
        if (options.mode === 'sip-info') dtmfOptions.transportType = JsSIP.C.DTMF_TRANSPORT.INFO;
        else if (options.mode === 'rtp-event') dtmfOptions.transportType = JsSIP.C.DTMF_TRANSPORT.RFC2833;
        this.session.sendDTMF(tone, dtmfOptions);
        this.bus.emit('dtmf', { tone, durationMs: options.durationMs, mode: options.mode });
    }

    async shareScreen(): Promise<void> {
        const pc = this.session.connection;
        if (!pc) throw new Error("No active peer connection");
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) throw new Error("No video sender available for screen sharing");
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const [track] = stream.getVideoTracks();
        if (!track) { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); throw new Error("No screen video track available"); }
        this.originalVideoTrack = sender.track ?? undefined;
        this.screenTrack = track;
        await sender.replaceTrack(track);
        track.onended = () => { this.stopScreenSharing().catch(() => {}); };
    }

    async stopScreenSharing(): Promise<void> {
        const pc = this.session.connection;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && this.originalVideoTrack) {
            await sender.replaceTrack(this.originalVideoTrack);
        }
        this.screenTrack?.stop();
        this.screenTrack = undefined;
        this.originalVideoTrack = undefined;
    }

    async getStats(): Promise<CallStats> {
        const pc = this.session.connection;
        if (!pc) return emptyCallStats();
        return this.stats.sample(pc);
    }

    async getQuality(): Promise<CallQualitySnapshot> {
        const snapshot = createCallQualitySnapshot(await this.getStats());
        this.bus.emit('quality', snapshot);
        return snapshot;
    }

    private cleanupAudio(): void {
        releaseElement(this.remoteElement);
    }

    private emitTerminatedOnce(event?: SipFailureEvent): void {
        if (this.terminated) return;
        this.terminated = true;
        this.onTerminate?.();
        this.bus.emit('state', 'terminated');
        this.bus.emit('terminated', event);
    }
}

export class JsSIPProvider implements ISipProvider {
    // JsSIP's Registrator renews the binding itself before it expires.
    public readonly managesRegistrationRefresh = true;

    private ua?: UA;
    private iceGatheringTimeoutMs?: number;
    private domain?: string;
    private onUserAgent?: ISipUserAgentDelegate;
    private subscribers = new Map<string, Subscriber>();

    async register(
        credentials: SipCredentials,
        onUserAgent: ISipUserAgentDelegate,
        onRegister: ISipRegisterDelegate,
        _onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void> {
        const { domain, phone, secret, nameexten, server, iceServers, authorizationUsername } = credentials;

        if (!server) throw new Error("'server' (WebSocket URL) is required for the JsSIP provider.");

        this.domain = domain;
        this.onUserAgent = onUserAgent;
        this.iceGatheringTimeoutMs = credentials.iceGatheringTimeoutMs;
        const socket = new JsSIP.WebSocketInterface(server);
        const configuration = {
            sockets: [socket],
            uri: `sip:${phone}@${domain}`,
            authorization_user: authorizationUsername ?? phone,
            password: secret,
            display_name: nameexten ?? phone,
            register: true,
            pcConfig: iceServers ? { iceServers } : undefined
        };

        const ua = new JsSIP.UA(configuration);
        this.ua = ua;

        ua.on("registered", (event) => { onRegister.onAccept?.(event); });
        ua.on("registrationFailed", (event) => { onRegister.onReject?.(event); });
        ua.on("unregistered", () => {
            // `unregister()` clears `this.ua` first, so a deliberate stop isn't reported as a loss.
            if (this.ua === ua) onRegister.onUnregistered?.();
        });
        ua.on("connected", (event) => { onUserAgent.onConnect?.(event); });
        ua.on("disconnected", (event) => { onUserAgent.onDisconnect?.(); });

        this.ua.on("newRTCSession", (event: RTCSessionEvent) => {
            if (event.originator === "remote") {
                const invitation = this.mapToInvitation(event.session);

                event.session.on("ended", () => { invitation.onTerminate?.(); });
                event.session.on("failed", () => { invitation.onTerminate?.(); });

                onUserAgent.onInvite?.(invitation);
            }
        });

        this.ua.on("newMessage", (event: IncomingMessageEvent | OutgoingMessageEvent) => { onUserAgent.onMessage?.(event); });

        // NOTIFY fora de diálogo (ex: MWI/voicemail via `Event: message-summary`,
        // presence/BLF) chegava até o JsSIP mas nunca era repassado pra cima —
        // o UA emite 'sipEvent' com { event, request }, e não existia nenhum
        // listener pra isso.
        this.ua.on("sipEvent", <T,>(event: { event: T; request: IncomingRequest }) => {
            const notifyEvent = event.event as unknown as JsSipNotifyEvent;
            onUserAgent.onNotify?.({
                event: notifyEvent?.event,
                params: notifyEvent?.params,
                body: event.request?.body,
                from: event.request?.from?.uri?.toString?.(),
                raw: event
            });
        });

        const registered = this.waitForRegistration(ua);
        registered.catch(() => {}); // awaited below; avoids an unhandled rejection if start() throws
        ua.start();
        await registered;
    }

    /** Resolves on the next successful REGISTER, rejects if it is refused or never answered. */
    private waitForRegistration(ua: UA): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                ua.removeListener("registered", onRegistered);
                ua.removeListener("registrationFailed", onFailed);
            };
            const onRegistered = () => { cleanup(); resolve(); };
            const onFailed = (event: { cause?: string; response?: { status_code?: number; reason_phrase?: string } }) => {
                cleanup();
                reject(Object.assign(new Error(`REGISTER failed: ${event?.cause ?? 'unknown cause'}.`), {
                    statusCode: event?.response?.status_code,
                    reasonPhrase: event?.response?.reason_phrase,
                    cause: event?.cause,
                }));
            };
            const timeout = setTimeout(() => { cleanup(); reject(new Error("REGISTER timed out.")); }, REGISTER_TIMEOUT_MS);
            ua.on("registered", onRegistered);
            ua.on("registrationFailed", onFailed);
        });
    }

    private resolveURI(destination: string): string {
        const withPrefix = ensureSipPrefix(destination);
        if (!withPrefix.includes('@') && this.domain) {
            return `sip:${destination.replace(/^sip:/i, '')}@${this.domain}`;
        }
        return withPrefix;
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.ua) throw new Error("UA not initialized");

        const { destination, remoteElement, video, extraHeaders } = options;

        const session = this.ua.call(this.resolveURI(destination), {
            mediaConstraints: { audio: true, video: !!video },
            rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: !!video },
            extraHeaders: extraHeaders || []
        });

        const jsSipSession = new JsSIPSession(session, this.iceGatheringTimeoutMs);
        if (remoteElement) jsSipSession.setRemoteElement(remoteElement);

        return jsSipSession;
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        const { remoteElement, video, extraHeaders } = options;

        const rawSession = invitation.raw as RTCSession;
        // Wrapped before answering: `answer()` creates the peer connection synchronously,
        // and the wrapper has to be listening by then to wire the remote audio.
        const jsSipSession = new JsSIPSession(rawSession, this.iceGatheringTimeoutMs);
        if (remoteElement) jsSipSession.setRemoteElement(remoteElement);

        rawSession.answer({
            mediaConstraints: { audio: true, video: !!video },
            extraHeaders: extraHeaders || []
        });

        return jsSipSession;
    }

    async unregister(): Promise<void> {
        for (const subscriber of this.subscribers.values()) {
            try { subscriber.terminate(); } catch (_) {}
        }
        this.subscribers.clear();

        const ua = this.ua;
        this.ua = undefined;
        ua?.stop();
    }

    async subscribePresence(target: string, options: PresenceSubscribeOptions = {}): Promise<void> {
        if (!this.ua) throw new Error("UA not initialized");

        const eventName = options.event ?? 'presence';
        const resolvedTarget = this.resolveURI(target);
        const key = `${eventName}:${resolvedTarget}`;
        await this.unsubscribePresence(key);

        const accept = eventName === 'dialog' ? 'application/dialog-info+xml' : 'application/pidf+xml';
        const subscriber = this.ua.subscribe(resolvedTarget, eventName, accept, {
            expires: options.expires ?? 3600,
            extraHeaders: options.extraHeaders,
        });

        subscriber.on('notify', (_isFinal, _request, body, contentType) => {
            const presence = parsePresenceBody(target, body, contentType, { body, contentType });
            this.onUserAgent?.onPresence?.(presence);
        });

        subscriber.on('terminated', () => {
            if (this.subscribers.get(key) === subscriber) this.subscribers.delete(key);
        });

        this.subscribers.set(key, subscriber);
        subscriber.subscribe();
    }

    /** `target` is an extension/URI (every event package subscribed for it) or an exact `event:uri` key. */
    async unsubscribePresence(target: string): Promise<void> {
        const uri = this.resolveURI(target);
        const keys = this.subscribers.has(target)
            ? [target]
            : [...this.subscribers.keys()].filter(key => key.endsWith(`:${uri}`));

        for (const key of keys) {
            const subscriber = this.subscribers.get(key);
            this.subscribers.delete(key);
            try { subscriber?.terminate(); } catch (_) {}
        }
    }

    async sendMessage(destination: string, body: string): Promise<void> {
        if (!this.ua) throw new Error("UA not initialized");
        this.ua.sendMessage(this.resolveURI(destination), body);
    }

    private mapToInvitation(session: RTCSession): SipInvitation {
        return {
            remoteIdentity: {
                uri: { user: session.remote_identity.uri.user },
                displayName: session.remote_identity.display_name
            },
            accept: async (options) => { session.answer(options as JsSipAnswerOptions | undefined); },
            reject: async (options) => { session.terminate(options as JsSipTerminateOptions | undefined); },
            raw: session
        };
    }

    getHealth(): Partial<SipHealthStatus> {
        return {
            websocketConnected: this.ua?.isConnected() ?? false,
            registered: this.ua?.isRegistered() ?? false,
        };
    }

    /**
     * JsSIP's own Transport already retries the WebSocket in the background after an
     * unexpected disconnect (`connection_recovery_min/max_interval`, on by default).
     * Tearing the UA down and rebuilding it here (like `unregister()` + `register()`)
     * would race that internal recovery — both could reconnect the same credentials
     * at once. So this just re-registers once the socket is back, and otherwise
     * throws so the caller's own retry loop (`SipClient`) tries again later without
     * touching the UA.
     */
    async reconnect(): Promise<void> {
        const ua = this.ua;
        if (!ua) throw new Error("UA not initialized.");
        if (!ua.isConnected()) {
            throw new Error("WebSocket not reconnected yet (JsSIP auto-recovery in progress).");
        }
        if (ua.isRegistered()) return;

        const registered = this.waitForRegistration(ua);
        registered.catch(() => {});
        ua.register();
        await registered;
    }

    getRegisterResult(): SipRegisterResult {
        return { userAgent: this.ua ?? this, registerer: null };
    }

    public getUA(): UA | undefined { return this.ua; }
}
