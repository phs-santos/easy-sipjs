import {
    SipCredentials,
    CallOptions,
    AnswerOptions,
    SipInvitation,
    CallStats,
    CallQualitySnapshot,
    DtmfOptions,
    SipSessionEventMap,
    PresenceEvent,
    PresenceSubscribeOptions,
    SipHealthStatus,
} from "./types.js";

export interface ISipProvider {
    register(
        credentials: SipCredentials,
        onUserAgent: ISipUserAgentDelegate,
        onRegister: ISipRegisterDelegate,
        onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void>;

    call(options: CallOptions): Promise<ISipSession>;
    answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession>;
    unregister(): Promise<void>;
    sendMessage(destination: string, body: string): Promise<void>;

    /** Refreshes REGISTER without recreating the underlying UserAgent when supported. */
    refreshRegistration?(): Promise<void>;

    /** Reconnects the WebSocket/signaling layer without a full client teardown when supported. */
    reconnect?(): Promise<void>;

    /** Lightweight provider health snapshot. */
    getHealth?(): Partial<SipHealthStatus>;

    /** SIP/application-level ping. Provider may implement this as SIP OPTIONS or transport ping. */
    ping?(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

    subscribePresence?(target: string, options?: PresenceSubscribeOptions): Promise<void>;
    unsubscribePresence?(target: string): Promise<void>;
}

export interface ISipSession {
    readonly id: string;
    readonly startedAt?: Date;

    /** Backward-compatible callback style. Prefer session.on('terminated', ...). */
    onConfirm?: () => void;
    onTerminate?: () => void;
    onReject?: (statusCode: number) => void;
    onDTMF?: (tone: string) => void;
    onProgress?: () => void;
    onHold?: () => void;
    onUnhold?: () => void;

    on?<K extends keyof SipSessionEventMap>(event: K, listener: (...args: SipSessionEventMap[K]) => void): () => void;
    off?<K extends keyof SipSessionEventMap>(event: K, listener: (...args: SipSessionEventMap[K]) => void): void;

    getCallDuration(): number;

    bye(): Promise<void>;
    mute(): void;
    unmute(): void;
    muteVideo(): void;
    unmuteVideo(): void;
    hold(): Promise<void>;
    unhold(): Promise<void>;
    transfer(target: string | ISipSession): Promise<void>;

    setAudioOutput(deviceId: string): Promise<void>;
    setAudioInput(deviceId: string): Promise<void>;
    setRemoteVolume(volume: number): void;

    sendDTMF(tone: string, options?: DtmfOptions): Promise<void>;
    shareScreen(): Promise<void>;
    stopScreenSharing(): Promise<void>;
    getStats(): Promise<CallStats>;
    getQuality(): Promise<CallQualitySnapshot>;

    /** Stream local (mic) já em uso pela chamada — útil pra gravação/análise
     * externa sem precisar abrir uma segunda captura própria do microfone
     * (que em vários headsets Bluetooth simplesmente não funciona em
     * paralelo com a captura que a própria chamada já mantém). */
    getLocalStream?(): MediaStream | undefined;

    /** Current hold status, split by who initiated it. */
    isOnHold?(): { local: boolean; remote: boolean };

    /** Adds a local video track to an already-established call and renegotiates. No-op if video is already active. */
    upgradeToVideo?(): Promise<void>;
    /** Stops sending the local video track on an already-established call and renegotiates. No-op if there is no active video. */
    downgradeToAudio?(): Promise<void>;
}

export interface ISipUserAgentDelegate {
    onConnect?: (data?: unknown) => void;
    onDisconnect?: (error?: Error) => void;
    onInvite?: (invitation: SipInvitation) => void;
    onMessage?: (message: unknown) => void;
    onNotify?: (notification: unknown) => void;
    onRefer?: (referral: unknown) => void;
    onRegister?: (registration: unknown) => void;
    onSubscribe?: (subscription: unknown) => void;
    onPresence?: (presence: PresenceEvent) => void;
}

export interface ISipRegisterDelegate {
    onAccept?: (data?: unknown) => void;
    onReject?: (error?: unknown) => void;
    onTrying?: () => void;
    onRedirect?: (data?: unknown) => void;
    onExpiring?: () => void;
}
