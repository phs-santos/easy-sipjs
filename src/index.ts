import {
    SipCredentials,
    CallOptions,
    SipRegisterResult,
    SipInvitation,
    AnswerOptions,
    SipConnectionState,
    SipHealthStatus,
    PresenceSubscribeOptions,
    PresenceEvent,
    DtmfOptions,
    SoftphonePreset,
    SoftphoneSounds,
    CreateSoftphoneConfig,
    SoftphoneDiagnostics,
} from "./core/types.js";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./core/provider.js";
import { SipAudioSynthesizer } from "./core/audio-synthesizer.js";
import { SipEventEmitter, SipEventMap } from "./core/event-emitter.js";
import { DeviceManager } from "./core/device-manager.js";
import { redactSipLog } from "./core/logger.js";
import { SipError, SipLogCode } from "./core/errors.js";
import type { DtmfMode, HoldStrategy, MediaRecoveryOptions, SipSessionDefaults } from "./core/types.js";

export interface SipClientOptions {
    /**
     * Picks the session defaults that suit a kind of server, so app developers do not need
     * to know SIP internals: `asterisk` and `kamailio` send DTMF as SIP INFO and hold with
     * `a=inactive`; `generic` lets DTMF fall back automatically (RTP, then INFO) and uses the
     * standard hold. Without a preset the client behaves like `asterisk`.
     */
    preset?: SoftphonePreset;
    /** Overrides the preset's DTMF mode for `sendDTMF()` calls that don't name one. */
    dtmfMode?: DtmfMode;
    /** Overrides the preset's hold signalling (`sipjs` provider). */
    holdStrategy?: HoldStrategy;
    /** Overrides how a broken media path is recovered mid-call. */
    mediaRecovery?: MediaRecoveryOptions;
    /** Defaults to `sipjs`. The SIP stack is loaded on demand, so only the chosen one ends up in the app's bundle. */
    provider?: 'sipjs' | 'jssip';
    customProvider?: ISipProvider;
    /** Ringtone/ringback. `false` (for everything or per sound) leaves the sounds to the app. */
    sounds?: SoftphoneSounds;
    /** Defaults to true. Keeps REGISTER alive without forcing the app to know about SIP timers. */
    autoRefreshRegistration?: boolean;
    /** Defaults to true. Reconnects after unexpected transport/network disconnects. */
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    /** Base of the exponential backoff, in ms. The first retry after a drop is always quick (≤500ms). */
    reconnectDelay?: number;
    maxReconnectDelay?: number;
    /** Only used with a custom provider that doesn't renew REGISTER by itself. */
    registrationExpiringBuffer?: number;
    /** Defaults to true. Redacts Authorization, nonce, usernames and secrets before forwarding SIP logs. */
    logRedaction?: boolean;
    /**
     * Optional periodic health check (SIP OPTIONS ping). Disabled by default; pass e.g. 30000.
     * Two failed pings in a row drop the socket and reconnect, which is how a half-open
     * WebSocket (still "connected", but dead) gets noticed.
     */
    healthCheckIntervalMs?: number;
}

const PRESET_DEFAULTS: Record<SoftphonePreset, Required<Pick<SipSessionDefaults, 'dtmfMode' | 'holdStrategy'>>> = {
    asterisk: { dtmfMode: 'sip-info', holdStrategy: 'asterisk-inactive' },
    kamailio: { dtmfMode: 'sip-info', holdStrategy: 'asterisk-inactive' },
    generic: { dtmfMode: 'auto', holdStrategy: 'sipjs-default' },
};

const FIRST_RECONNECT_DELAY_MS = 500;
const PING_FAILURES_BEFORE_RECONNECT = 2;

export class SipClient {
    private sessions: ISipSession[] = [];
    private activeSessionId?: string;
    private connectionState: SipConnectionState = 'disconnected';
    private provider?: ISipProvider;
    private providerReady: Promise<ISipProvider>;
    private emitter = new SipEventEmitter();
    public readonly devices = new DeviceManager();

    public onUserAgent: ISipUserAgentDelegate = {};
    public onRegister: ISipRegisterDelegate = {};

    public onConnectionStateChange?: (state: SipConnectionState) => void;
    public onSipLog?: (level: string, category: string, label: string, content: string) => void;

    private started = false;
    private intentionalDisconnect = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private reconnectAttempt = 0;
    private reconnecting = false;
    private forceNextReconnect = false;
    private pingFailures = 0;
    private maxReconnectAttempts: number;
    private reconnectDelay: number;
    private maxReconnectDelay: number;
    private autoReconnect: boolean;
    private autoRefreshRegistration: boolean;

    private registrationExpiryTimer?: ReturnType<typeof setTimeout>;
    private registrationExpiringBuffer: number;
    private networkMonitoringEnabled = false;

    private soundElements: { ringtone?: HTMLAudioElement; ringback?: HTMLAudioElement } = {};
    // One per sound, so answering a call doesn't cut the ringtone of a second one and vice versa.
    private synthesizers = { ringtone: new SipAudioSynthesizer(), ringback: new SipAudioSynthesizer() };

    private operationLock: Promise<void> = Promise.resolve();
    private presenceSubscriptions = new Map<string, PresenceSubscribeOptions | undefined>();
    private healthTimer?: ReturnType<typeof setInterval>;

    public static isVideoCall(invitation: SipInvitation): boolean {
        const raw = invitation.raw as { request?: { body?: unknown } } | undefined;
        const body = raw?.request?.body;
        return typeof body === 'string' && body.includes("m=video") && !body.includes("m=video 0");
    }

    public static async requestPermissions(options: { audio?: boolean, video?: boolean } = { audio: true }): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(options);
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error("Failed to acquire media permissions:", error);
            return false;
        }
    }

    public static async getAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'audiooutput');
        } catch { return []; }
    }

    public static async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'audioinput');
        } catch { return []; }
    }

    public static async getVideoInputDevices(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'videoinput');
        } catch { return []; }
    }

    constructor(private credentials: SipCredentials, private options: SipClientOptions = {}) {
        this.provider = options.customProvider;
        this.providerReady = this.loadProvider();
        this.providerReady.catch(() => undefined); // surfaced by whichever call awaits it

        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
        this.reconnectDelay = options.reconnectDelay ?? 5000;
        this.maxReconnectDelay = options.maxReconnectDelay ?? 60000;
        this.registrationExpiringBuffer = options.registrationExpiringBuffer ?? 30;
        this.autoReconnect = options.autoReconnect ?? true;
        this.autoRefreshRegistration = options.autoRefreshRegistration ?? true;

        this.setupNetworkMonitoring();
    }

    /**
     * Each SIP stack is a separate chunk loaded on demand: an app that only uses
     * `sipjs` never downloads JsSIP, and the other way around.
     */
    private async loadProvider(): Promise<ISipProvider> {
        if (this.provider) return this.provider;
        if (this.options.provider === 'jssip') {
            const { JsSIPProvider } = await import("./core/jssip-provider.js");
            this.provider = new JsSIPProvider();
        } else {
            const { SipJSProvider } = await import("./core/sipjs-provider.js");
            this.provider = new SipJSProvider();
        }
        return this.provider;
    }

    private async getProvider(): Promise<ISipProvider> {
        return this.provider ?? this.providerReady;
    }

    /** Explicit client option, then whatever came with the credentials, then the preset. */
    private providerCredentials(): SipCredentials {
        const preset = PRESET_DEFAULTS[this.options.preset ?? 'asterisk'];
        return {
            ...this.credentials,
            dtmfMode: this.options.dtmfMode ?? this.credentials.dtmfMode ?? preset.dtmfMode,
            holdStrategy: this.options.holdStrategy ?? this.credentials.holdStrategy ?? preset.holdStrategy,
            mediaRecovery: this.options.mediaRecovery ?? this.credentials.mediaRecovery,
        };
    }

    // ─── Friendly aliases ────────────────────────────────────────────────────

    async connect(): Promise<SipRegisterResult> { return this.register(); }
    async disconnect(): Promise<void> { return this.unregister(); }

    async dial(destination: string, options: Omit<CallOptions, 'destination'> = {}): Promise<ISipSession> {
        return this.call({ ...options, destination });
    }

    async accept(invitation: SipInvitation, options: AnswerOptions = {}): Promise<ISipSession> {
        return this.answer(invitation, options);
    }

    async reject(invitation?: SipInvitation): Promise<void> {
        if (invitation) {
            this.stopRingtone();
            await invitation.reject();
            return;
        }
        await this.hangup();
    }

    // ─── EventEmitter ────────────────────────────────────────────────────────

    on<K extends keyof SipEventMap>(event: K, listener: (...args: SipEventMap[K]) => void): this {
        this.emitter.on(event, listener);
        return this;
    }

    off<K extends keyof SipEventMap>(event: K, listener: (...args: SipEventMap[K]) => void): this {
        this.emitter.off(event, listener);
        return this;
    }

    // ─── Network monitoring ──────────────────────────────────────────────────

    private setupNetworkMonitoring() {
        if (this.networkMonitoringEnabled) return;
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('online', this.handleOnline);
            this.networkMonitoringEnabled = true;
        }
    }

    private cleanupNetworkMonitoring() {
        if (!this.networkMonitoringEnabled) return;
        if (typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('online', this.handleOnline);
        }
        this.networkMonitoringEnabled = false;
    }

    private handleOnline = () => {
        if (!this.started || this.intentionalDisconnect) return;

        if (this.connectionState === 'connected' || this.connectionState === 'registered') {
            // The network changed under a socket that still looks fine; make sure it really is.
            // One failed ping is enough here, there is no point waiting for a second one.
            this.pingFailures = PING_FAILURES_BEFORE_RECONNECT - 1;
            this.checkHealth().catch(() => undefined);
            return;
        }
        if (this.connectionState !== 'disconnected') return;

        // Being back online is new information: retry right away, even if the previous
        // outage had already used up every attempt.
        this.onSipLog?.("info", "sip.Client", SipLogCode.NetworkOnline, "Conectividade de rede restaurada. Tentando reconectar...");
        this.reconnectAttempt = 0;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.triggerReconnection();
    };

    // ─── Session management ──────────────────────────────────────────────────

    public get activeSession(): ISipSession | undefined {
        if (this.activeSessionId) {
            const session = this.sessions.find(s => s.id === this.activeSessionId);
            if (session) return session;
        }
        return this.sessions[this.sessions.length - 1];
    }

    public getSessions(): ISipSession[] {
        return [...this.sessions];
    }

    public setActiveSession(sessionOrId: ISipSession | string | undefined) {
        if (!sessionOrId) {
            this.activeSessionId = undefined;
        } else if (typeof sessionOrId === "string") {
            this.activeSessionId = sessionOrId;
        } else {
            this.activeSessionId = sessionOrId.id;
        }
    }

    public getConnectionState(): SipConnectionState {
        return this.connectionState;
    }

    private setConnectionState(state: SipConnectionState) {
        if (this.connectionState !== state) {
            this.connectionState = state;
            this.onConnectionStateChange?.(state);
            this.emitter.emit('connection-state', state);
        }
    }

    private enqueue<T>(op: () => Promise<T>): Promise<T> {
        const result = this.operationLock.then(op, op);
        this.operationLock = result.then(() => undefined, () => undefined);
        return result;
    }

    private handleSipLog = (level: string, category: string, label: string, content: string) => {
        const safeContent = this.options.logRedaction === false ? content : redactSipLog(content);
        this.onSipLog?.(level, category, label, safeContent);
    };

    // ─── Register / connect ──────────────────────────────────────────────────

    async register(): Promise<SipRegisterResult> {
        return this.enqueue(() => this.doRegister());
    }

    private async doRegister(): Promise<SipRegisterResult> {
        const provider = await this.getProvider();
        this.setupNetworkMonitoring();
        this.intentionalDisconnect = false;
        this.started = true;
        this.startHealthTimer();

        if (this.connectionState === 'registered' && provider.refreshRegistration) {
            await provider.refreshRegistration();
            this.scheduleRegistrationExpiry();
            return this.getRegisterResult();
        }

        this.setConnectionState('connecting');

        try {
            if (this.connectionState !== 'disconnected') {
                await provider.unregister();
            }
        } catch (_) { /* no active UA yet */ }

        const internalUserAgentDelegate: ISipUserAgentDelegate = {
            onConnect: (data) => {
                this.setConnectionState('connected');
                this.reconnectAttempt = 0;
                this.onUserAgent.onConnect?.(data);
                this.emitter.emit('connect');
            },
            onDisconnect: (error) => {
                this.setConnectionState('disconnected');
                this.onUserAgent.onDisconnect?.(error);
                this.emitter.emit('disconnect', error);
                // While a reconnect attempt is running it owns the retry (it may be the one dropping the socket).
                if (!this.intentionalDisconnect && this.autoReconnect && !this.reconnecting) {
                    this.onSipLog?.("warn", "sip.Client", SipLogCode.TransportDisconnected, "Desconexão inesperada do WebSocket. Iniciando tentativas de reconexão...");
                    this.triggerReconnection();
                }
            },
            onInvite: (invitation) => {
                this.playRingtone();

                const originalAccept = invitation.accept.bind(invitation);
                invitation.accept = async (opt) => {
                    this.stopRingtone();
                    await originalAccept(opt);
                };

                const originalReject = invitation.reject.bind(invitation);
                invitation.reject = async (opt) => {
                    this.stopRingtone();
                    await originalReject(opt);
                };

                const originalOnTerminate = invitation.onTerminate;
                invitation.onTerminate = () => {
                    this.stopRingtone();
                    originalOnTerminate?.();
                };

                this.onUserAgent.onInvite?.(invitation);
                this.emitter.emit('invite', invitation);
            },
            onMessage: (msg) => {
                this.onUserAgent.onMessage?.(msg);
                this.emitter.emit('message', msg);
            },
            onNotify: (n) => {
                this.onUserAgent.onNotify?.(n);
                this.emitter.emit('notify', n);
            },
            onRefer: (r) => {
                this.onUserAgent.onRefer?.(r);
                this.emitter.emit('refer', r);
            },
            onRegister: (r) => this.onUserAgent.onRegister?.(r),
            onSubscribe: (s) => {
                this.onUserAgent.onSubscribe?.(s);
                this.emitter.emit('subscribe', s);
            },
            onPresence: (presence) => {
                this.onUserAgent.onPresence?.(presence);
                this.emitter.emit('presence', presence);
            },
        };

        const internalRegisterDelegate: ISipRegisterDelegate = {
            onAccept: (data) => this.handleRegistered(data),
            onReject: (error) => {
                this.setConnectionState('error');
                this.onRegister.onReject?.(error);
                this.emitter.emit('register-failed', error);
            },
            onTrying: () => this.onRegister.onTrying?.(),
            onRedirect: (data) => this.onRegister.onRedirect?.(data),
            onUnregistered: () => {
                if (this.intentionalDisconnect) return;
                if (this.connectionState === 'registered') this.setConnectionState('connected');
                this.onRegister.onUnregistered?.();
                this.emitter.emit('unregistered');
                if (this.autoReconnect && !this.reconnecting) {
                    // The binding lapsed on a socket that still looks connected, which usually
                    // means the socket is dead: replace it instead of registering over it.
                    this.onSipLog?.("warn", "sip.Client", SipLogCode.RegistrationLost, "Registro SIP perdido. Iniciando tentativas de reconexão...");
                    this.triggerReconnection(true);
                }
            },
        };

        try {
            await provider.register(
                this.providerCredentials(),
                internalUserAgentDelegate,
                internalRegisterDelegate,
                this.handleSipLog
            );
        } catch (error) {
            this.setConnectionState('error');
            throw error;
        }

        return this.getRegisterResult();
    }

    /**
     * Presence subscriptions die with the registration/socket they were created on, so
     * they are restored whenever the client goes from not registered to registered —
     * but not on the periodic refreshes of a registration that never dropped.
     */
    private handleRegistered(data?: unknown) {
        const wasRegistered = this.connectionState === 'registered';
        this.setConnectionState('registered');
        this.reconnectAttempt = 0;
        this.pingFailures = 0;
        this.scheduleRegistrationExpiry();
        this.onRegister.onAccept?.(data);
        this.emitter.emit('registered');
        if (wasRegistered) return;
        this.restorePresenceSubscriptions().catch(error => {
            this.onSipLog?.('warn', 'sip.Client', SipLogCode.PresenceRestoreFailed, `Falha ao restaurar inscrições de presença: ${error}`);
        });
    }

    async refreshRegistration(): Promise<void> {
        return this.enqueue(async () => {
            const provider = await this.getProvider();
            if (provider.refreshRegistration) {
                await provider.refreshRegistration();
            } else {
                await this.doRegister();
                return;
            }
            this.setConnectionState('registered');
            this.scheduleRegistrationExpiry();
        });
    }

    async updateCredentials(credentials: SipCredentials): Promise<SipRegisterResult> {
        return this.enqueue(async () => {
            for (const session of this.sessions) {
                try { await session.bye(); } catch (_) { }
            }
            this.sessions = [];
            this.activeSessionId = undefined;
            this.clearTimers();
            try { await (await this.getProvider()).unregister(); } catch (_) { }
            this.credentials = credentials;
            this.connectionState = 'disconnected';
            return this.doRegister();
        });
    }

    /**
     * Fallback for custom providers only. The built-in ones renew REGISTER themselves, timed
     * by the expiry the registrar actually granted; a second timer here would just send a
     * duplicate REGISTER that can collide with theirs.
     */
    private scheduleRegistrationExpiry() {
        if (this.registrationExpiryTimer) clearTimeout(this.registrationExpiryTimer);
        this.registrationExpiryTimer = undefined;
        if (this.provider?.managesRegistrationRefresh) return;
        const delay = Math.max(5, 3600 - this.registrationExpiringBuffer) * 1000;
        this.registrationExpiryTimer = setTimeout(() => {
            this.registrationExpiryTimer = undefined;
            this.onRegister.onExpiring?.();
            this.emitter.emit('registration-expiring');

            if (this.autoRefreshRegistration && !this.intentionalDisconnect) {
                this.refreshRegistration().catch(error => {
                    this.onSipLog?.("error", "sip.Client", SipLogCode.RegistrationRefreshFailed, `Falha ao renovar registro SIP: ${error}`);
                    if (this.autoReconnect) this.triggerReconnection();
                });
            }
        }, delay);
    }

    private getRegisterResult(): SipRegisterResult {
        return this.provider?.getRegisterResult?.() ?? { userAgent: this.provider, registerer: null };
    }

    // ─── Reconnect / health ──────────────────────────────────────────────────

    async reconnect(): Promise<void> {
        this.intentionalDisconnect = false;
        return this.enqueue(() => this.doReconnect());
    }

    private async doReconnect(): Promise<void> {
        if (this.intentionalDisconnect) return;
        const force = this.forceNextReconnect;
        this.forceNextReconnect = false;
        const provider = await this.getProvider();
        this.reconnecting = true;

        try {
            this.setConnectionState('connecting');
            if (!provider.reconnect) {
                await provider.unregister().catch(() => {});
                await this.doRegister();
                return;
            }
            // Resolves only once registered again. Providers that report it through the
            // register delegate have already moved the state by now.
            await provider.reconnect({ force });
            if (this.connectionState !== 'registered') this.handleRegistered();
            // The signaling path is back; calls that lost their media path while it was
            // down (e.g. the device changed networks) can renegotiate now.
            for (const session of this.sessions) {
                session.recoverMedia?.().catch(() => undefined);
            }
        } catch (error) {
            const websocketUp = provider.getHealth?.().websocketConnected ?? false;
            this.setConnectionState(websocketUp ? 'connected' : 'disconnected');
            throw error;
        } finally {
            this.reconnecting = false;
        }
    }

    private startHealthTimer() {
        const interval = this.options.healthCheckIntervalMs;
        if (!interval || this.healthTimer) return;
        this.healthTimer = setInterval(() => {
            this.checkHealth().catch(() => undefined);
        }, interval);
    }

    async checkHealth(): Promise<SipHealthStatus> {
        const provider = await this.getProvider();
        const providerHealth = provider.getHealth?.() ?? {};
        let pingResult: { ok: boolean; latencyMs?: number; error?: string } | undefined;

        const online = this.connectionState === 'connected' || this.connectionState === 'registered';
        if (provider.ping && online && !this.reconnecting) {
            pingResult = await provider.ping();
            this.handlePingResult(pingResult.ok);
        }

        const status: SipHealthStatus = {
            websocketConnected: providerHealth.websocketConnected ?? (this.connectionState === 'connected' || this.connectionState === 'registered'),
            registered: providerHealth.registered ?? this.connectionState === 'registered',
            connectionState: this.connectionState,
            activeSessions: this.sessions.length,
            lastPingOkAt: pingResult?.ok ? new Date() : providerHealth.lastPingOkAt,
            lastPingLatencyMs: pingResult?.latencyMs ?? providerHealth.lastPingLatencyMs,
            lastPingError: pingResult?.ok ? undefined : pingResult?.error ?? providerHealth.lastPingError,
            checkedAt: new Date(),
        };

        this.emitter.emit('health', status);
        return status;
    }

    private handlePingResult(ok: boolean) {
        if (ok) {
            this.pingFailures = 0;
            return;
        }
        this.pingFailures += 1;
        if (this.pingFailures < PING_FAILURES_BEFORE_RECONNECT) return;
        this.pingFailures = 0;
        if (!this.started || this.intentionalDisconnect || !this.autoReconnect) return;
        this.onSipLog?.("warn", "sip.Client", SipLogCode.HealthPingFailed, "PBX não responde ao ping SIP. Refazendo a conexão...");
        this.triggerReconnection(true);
    }

    /**
     * The first retry is quick, since most drops are short blips. After that the wait
     * doubles from `reconnectDelay` up to `maxReconnectDelay`, with jitter so a PBX
     * restart doesn't bring every client back in the same instant.
     */
    private getReconnectDelay(attempt: number): number {
        if (attempt <= 1) return Math.min(this.reconnectDelay, FIRST_RECONNECT_DELAY_MS);
        const backoff = Math.min(this.reconnectDelay * Math.pow(2, attempt - 2), this.maxReconnectDelay);
        return Math.min(this.maxReconnectDelay, Math.round(backoff * (0.85 + Math.random() * 0.3)));
    }

    private triggerReconnection(force = false) {
        if (force) this.forceNextReconnect = true;
        if (this.reconnectTimer || this.reconnecting || !this.autoReconnect || this.intentionalDisconnect) return;
        if (this.reconnectAttempt >= this.maxReconnectAttempts) {
            this.onSipLog?.("error", "sip.Client", SipLogCode.ReconnectExhausted, `Número máximo de tentativas de reconexão atingido (${this.maxReconnectAttempts}).`);
            this.emitter.emit('reconnect-failed', this.reconnectAttempt);
            return;
        }

        const nextAttempt = this.reconnectAttempt + 1;
        const delay = this.getReconnectDelay(nextAttempt);
        this.emitter.emit('reconnecting', nextAttempt, delay);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            if (this.intentionalDisconnect) return;
            this.reconnectAttempt = nextAttempt;
            this.onSipLog?.("info", "sip.Client", SipLogCode.ReconnectAttempt, `Tentativa de reconexão ${this.reconnectAttempt}/${this.maxReconnectAttempts} (delay: ${delay}ms)...`);
            try {
                await this.enqueue(() => this.doReconnect());
            } catch (error) {
                this.onSipLog?.("error", "sip.Client", SipLogCode.ReconnectAttemptFailed, `Falha na tentativa de reconexão: ${error}`);
                this.triggerReconnection();
            }
        }, delay);
    }

    // ─── Presence / BLF ──────────────────────────────────────────────────────

    async subscribePresence(target: string, options?: PresenceSubscribeOptions): Promise<void> {
        const provider = await this.getProvider();
        if (!provider.subscribePresence) {
            throw new SipError('unsupported', "Presence subscription is not supported by the selected SIP provider.");
        }
        this.presenceSubscriptions.set(target, options);
        await provider.subscribePresence(target, options);
    }

    async unsubscribePresence(target: string): Promise<void> {
        this.presenceSubscriptions.delete(target);
        const provider = await this.getProvider();
        await provider.unsubscribePresence?.(target);
    }

    private async restorePresenceSubscriptions(): Promise<void> {
        const provider = await this.getProvider();
        if (!provider.subscribePresence || this.presenceSubscriptions.size === 0) return;
        await Promise.all([...this.presenceSubscriptions.entries()].map(
            ([target, options]) => provider.subscribePresence!(target, options).catch(() => undefined)
        ));
    }

    onPresence(listener: (presence: PresenceEvent) => void): this {
        return this.on('presence', listener);
    }

    // ─── Sounds ──────────────────────────────────────────────────────────────

    private playRingtone() { this.playSound('ringtone'); }
    private stopRingtone() { this.stopSound('ringtone'); }
    private playRingback() { this.playSound('ringback'); }
    private stopRingback() { this.stopSound('ringback'); }

    private playSound(kind: 'ringtone' | 'ringback') {
        if (typeof window === 'undefined') return;
        const sounds = this.options.sounds;
        const source = sounds === false ? false : sounds?.[kind];
        if (source === false) return;

        const synthesizer = this.synthesizers[kind];
        const synthesize = () => kind === 'ringtone' ? synthesizer.playRingtone() : synthesizer.playRingback();
        if (!source) {
            synthesize();
            return;
        }

        try {
            let audio = this.soundElements[kind];
            if (!audio) {
                audio = new Audio(source);
                audio.loop = true;
                this.soundElements[kind] = audio;
            }
            audio.currentTime = 0;
            audio.play().catch(synthesize);
        } catch {
            synthesize();
        }
    }

    private stopSound(kind: 'ringtone' | 'ringback') {
        this.synthesizers[kind].stop();
        const audio = this.soundElements[kind];
        if (audio) {
            try { audio.pause(); audio.currentTime = 0; } catch (_) {}
        }
    }

    private stopAllSounds() {
        this.stopRingtone();
        this.stopRingback();
    }

    // ─── Session tracking ────────────────────────────────────────────────────

    private trackSession(session: ISipSession) {
        this.sessions.push(session);
        this.activeSessionId = session.id;
        this.emitter.emit('session', session);

        const removeSession = () => {
            this.sessions = this.sessions.filter(s => s.id !== session.id);
            if (this.activeSessionId === session.id) {
                this.activeSessionId = this.sessions[this.sessions.length - 1]?.id;
            }
        };

        session.on?.('state', state => this.emitter.emit('session-state', session, state));
        session.on?.('progress', event => this.emitter.emit('session-progress', session, event));
        session.on?.('established', () => this.emitter.emit('session-established', session));
        session.on?.('failed', event => this.emitter.emit('session-failed', session, event));
        session.on?.('terminated', event => {
            removeSession();
            this.emitter.emit('session-terminated', session, event);
        });
        session.on?.('hold', event => this.emitter.emit('session-hold', session, event));
        session.on?.('unhold', event => this.emitter.emit('session-unhold', session, event));
        session.on?.('dtmf', event => this.emitter.emit('session-dtmf', session, event));
        session.on?.('refer', event => this.emitter.emit('session-refer', session, event));
        session.on?.('transfer-progress', event => this.emitter.emit('session-transfer-progress', session, event));
        session.on?.('media-state', event => this.emitter.emit('session-media-state', session, event));
        session.on?.('media-failed', event => this.emitter.emit('session-media-failed', session, event));
        session.on?.('quality', snapshot => this.emitter.emit('session-quality', session, snapshot));

        let userOnTerminate = session.onTerminate;
        const internalCleanup = () => {
            removeSession();
            userOnTerminate?.();
        };
        Object.defineProperty(session, 'onTerminate', {
            get: () => internalCleanup,
            set: (fn: (() => void) | undefined) => { userOnTerminate = fn; },
            configurable: true,
            enumerable: true,
        });
    }

    // ─── Call control ────────────────────────────────────────────────────────

    async call(options: CallOptions): Promise<ISipSession> {
        this.playRingback();
        try {
            const session = await (await this.getProvider()).call(options);
            if (session.on) {
                session.on('progress', event => {
                    if (event?.hasEarlyMedia || event?.statusCode === 183) this.stopRingback();
                });
                session.on('established', () => this.stopRingback());
                session.on('failed', () => this.stopRingback());
                session.on('terminated', () => this.stopRingback());
            } else {
                // Custom providers without an event bus only have the legacy callbacks.
                const originalOnTerminate = session.onTerminate;
                session.onTerminate = () => {
                    this.stopRingback();
                    originalOnTerminate?.();
                };
                session.onConfirm = () => {
                    this.stopRingback();
                };
            }

            this.trackSession(session);
            return session;
        } catch (error) {
            this.stopRingback();
            throw error;
        }
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        this.stopRingtone();
        const session = await (await this.getProvider()).answer(invitation, options);
        this.trackSession(session);
        return session;
    }

    mute(): void { this.activeSession?.mute(); }
    unmute(): void { this.activeSession?.unmute(); }
    muteVideo(): void { this.activeSession?.muteVideo(); }
    unmuteVideo(): void { this.activeSession?.unmuteVideo(); }

    async hold(): Promise<void> { await this.activeSession?.hold(); }
    async unhold(): Promise<void> { await this.activeSession?.unhold(); }
    isOnHold(): { local: boolean; remote: boolean } { return this.activeSession?.isOnHold?.() ?? { local: false, remote: false }; }

    async upgradeToVideo(): Promise<void> { await this.activeSession?.upgradeToVideo?.(); }
    async downgradeToAudio(): Promise<void> { await this.activeSession?.downgradeToAudio?.(); }

    async transfer(target: string | ISipSession): Promise<void> {
        await this.activeSession?.transfer(target);
    }

    async attendedTransfer(firstSession: ISipSession, secondSession: ISipSession): Promise<void> {
        await firstSession.hold();
        await firstSession.transfer(secondSession);
        await secondSession.bye();
    }

    async setAudioOutput(deviceId: string): Promise<void> {
        await this.activeSession?.setAudioOutput(deviceId);
    }

    async setAudioInput(deviceId: string): Promise<void> {
        await this.activeSession?.setAudioInput(deviceId);
    }

    async setRemoteVolume(volume: number): Promise<void> {
        this.activeSession?.setRemoteVolume(volume);
    }

    async sendDTMF(tone: string, options?: DtmfOptions): Promise<void> {
        await this.activeSession?.sendDTMF(tone, options);
    }

    async hangup(): Promise<void> {
        const active = this.activeSession;
        if (active) await active.bye();
    }

    async getQuality() {
        return this.activeSession?.getQuality();
    }

    async diagnose(): Promise<SoftphoneDiagnostics> {
        const warnings: string[] = [];
        const secureContext = typeof window === 'undefined' ? true : window.isSecureContext;
        const hasMediaDevices = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
        const hasSpeakerSelection = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';
        let hasMicrophonePermission = false;

        if (!secureContext) warnings.push('WebRTC exige HTTPS ou localhost para microfone/câmera funcionar corretamente.');
        if (!hasMediaDevices) warnings.push('Browser não expõe navigator.mediaDevices.getUserMedia.');
        if (!hasSpeakerSelection) warnings.push('Este browser não permite selecionar saída de áudio via setSinkId.');

        try {
            const devices = await this.devices.list();
            hasMicrophonePermission = devices.some(device => device.kind === 'microphone' && !device.label.includes('sem permissão'));
        } catch {
            warnings.push('Não foi possível listar dispositivos de mídia.');
        }

        const health = await this.checkHealth().catch(() => undefined);
        const diagnostics: SoftphoneDiagnostics = {
            browser: typeof navigator === 'undefined' ? 'server' : navigator.userAgent,
            secureContext,
            hasMediaDevices,
            hasMicrophonePermission,
            hasSpeakerSelection,
            websocketConfigured: !!this.credentials.server,
            websocketReachable: health?.websocketConnected,
            sipRegistered: health?.registered ?? this.connectionState === 'registered',
            iceServersConfigured: !!this.credentials.iceServers?.length,
            warnings,
            checkedAt: new Date(),
        };

        return diagnostics;
    }

    async sendMessage(destination: string, body: string): Promise<void> {
        await (await this.getProvider()).sendMessage(destination, body);
    }

    // ─── Unregister / cleanup ────────────────────────────────────────────────

    async unregister(): Promise<void> {
        return this.enqueue(() => this.doUnregister());
    }

    private async doUnregister(): Promise<void> {
        this.intentionalDisconnect = true;
        this.started = false;
        this.clearTimers();
        this.stopAllSounds();
        this.cleanupNetworkMonitoring();

        for (const session of [...this.sessions]) {
            try { await session.bye(); } catch (_) { /* continue */ }
        }

        await (await this.getProvider()).unregister();
        this.sessions = [];
        this.activeSessionId = undefined;
        this.setConnectionState('disconnected');
    }

    private clearTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.registrationExpiryTimer) {
            clearTimeout(this.registrationExpiryTimer);
            this.registrationExpiryTimer = undefined;
        }
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = undefined;
        }
        this.reconnectAttempt = 0;
        this.forceNextReconnect = false;
        this.pingFailures = 0;
    }
}

export * from "./core/types.js";
export * from "./core/provider.js";
// Types only: the provider classes live in their own entry points (`easy-sipjs/sipjs`,
// `easy-sipjs/jssip`) so this one doesn't pull both SIP stacks into every bundle.
export type { SipJSProvider, SipJSSession } from "./core/sipjs-provider.js";
export type { JsSIPProvider, JsSIPSession } from "./core/jssip-provider.js";
export * from "./core/event-emitter.js";
export * from "./core/device-manager.js";
export * from "./core/call-quality.js";
export * from "./core/logger.js";
export * from "./core/errors.js";
export { CallStatsSampler } from "./core/utils.js";

export function createSoftphone(config: CreateSoftphoneConfig): SipClient {
    const preset = config.preset ?? 'asterisk';
    const isGeneric = preset === 'generic';

    return new SipClient(
        {
            domain: config.domain,
            phone: config.extension,
            secret: config.password,
            nameexten: config.displayName,
            authorizationUsername: config.authUsername,
            server: config.websocketUrl,
            iceServers: config.iceServers,
            iceGatheringTimeoutMs: config.iceGatheringTimeoutMs,
            debug: config.debug ?? false,
            userAgentString: `easy-sipjs/${preset}`,
        },
        {
            preset,
            provider: config.provider ?? 'sipjs',
            sounds: config.sounds,
            autoReconnect: true,
            autoRefreshRegistration: true,
            logRedaction: true,
            healthCheckIntervalMs: isGeneric ? undefined : 30000,
            registrationExpiringBuffer: 45,
        }
    );
}
