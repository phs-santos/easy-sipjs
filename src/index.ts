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
    CreateSoftphoneConfig,
    SoftphoneDiagnostics,
} from "./core/types.js";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./core/provider.js";
import { SipJSProvider } from "./core/sipjs-provider.js";
import { JsSIPProvider } from "./core/jssip-provider.js";
import { SipAudioSynthesizer } from "./core/audio-synthesizer.js";
import { SipEventEmitter, SipEventMap } from "./core/event-emitter.js";
import { DeviceManager } from "./core/device-manager.js";
import { redactSipLog } from "./core/logger.js";

export interface SipClientOptions {
    /** Use a preset so app developers do not need to know SIP.js internals. */
    preset?: SoftphonePreset;
    provider?: 'sipjs' | 'jssip';
    customProvider?: ISipProvider;
    sounds?: {
        ringtone?: string;
        ringback?: string;
    };
    /** Defaults to true. Keeps REGISTER alive without forcing the app to know about SIP timers. */
    autoRefreshRegistration?: boolean;
    /** Defaults to true. Reconnects after unexpected transport/network disconnects. */
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    maxReconnectDelay?: number;
    registrationExpiringBuffer?: number;
    /** Defaults to true. Redacts Authorization, nonce, usernames and secrets before forwarding SIP logs. */
    logRedaction?: boolean;
    /** Optional periodic health check. Disabled by default; pass e.g. 30000. */
    healthCheckIntervalMs?: number;
}

export class SipClient {
    private sessions: ISipSession[] = [];
    private activeSessionId?: string;
    private connectionState: SipConnectionState = 'disconnected';
    private provider: ISipProvider;
    private emitter = new SipEventEmitter();
    public readonly devices = new DeviceManager();

    public onUserAgent: ISipUserAgentDelegate = {};
    public onRegister: ISipRegisterDelegate = {};

    public onConnectionStateChange?: (state: SipConnectionState) => void;
    public onSipLog?: (level: string, category: string, label: string, content: string) => void;

    private intentionalDisconnect = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private reconnectAttempt = 0;
    private maxReconnectAttempts: number;
    private reconnectDelay: number;
    private maxReconnectDelay: number;
    private autoReconnect: boolean;
    private autoRefreshRegistration: boolean;

    private registrationExpiryTimer?: ReturnType<typeof setTimeout>;
    private registrationExpiringBuffer: number;
    private networkMonitoringEnabled = false;

    private ringtoneAudio?: HTMLAudioElement;
    private ringbackAudio?: HTMLAudioElement;
    private synthesizer = new SipAudioSynthesizer();

    private operationLock: Promise<void> = Promise.resolve();
    private presenceSubscriptions = new Map<string, PresenceSubscribeOptions | undefined>();
    private healthTimer?: ReturnType<typeof setInterval>;

    public static isVideoCall(invitation: SipInvitation): boolean {
        const raw = invitation.raw;
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
        if (options.customProvider) {
            this.provider = options.customProvider;
        } else if ((options.provider ?? (options.preset === 'generic' ? 'sipjs' : 'sipjs')) === 'jssip') {
            this.provider = new JsSIPProvider();
        } else {
            this.provider = new SipJSProvider();
        }

        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
        this.reconnectDelay = options.reconnectDelay ?? 5000;
        this.maxReconnectDelay = options.maxReconnectDelay ?? 60000;
        this.registrationExpiringBuffer = options.registrationExpiringBuffer ?? 30;
        this.autoReconnect = options.autoReconnect ?? true;
        this.autoRefreshRegistration = options.autoRefreshRegistration ?? true;

        this.setupNetworkMonitoring();
        if (options.healthCheckIntervalMs) {
            this.healthTimer = setInterval(() => {
                this.checkHealth().catch(() => undefined);
            }, options.healthCheckIntervalMs);
        }
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
        if (!this.intentionalDisconnect && this.connectionState === 'disconnected') {
            this.onSipLog?.("info", "sip.Client", "", "Conectividade de rede restaurada. Tentando reconectar...");
            this.triggerReconnection();
        }
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
        this.setupNetworkMonitoring();
        this.intentionalDisconnect = false;

        if (this.connectionState === 'registered' && this.provider.refreshRegistration) {
            await this.provider.refreshRegistration();
            this.scheduleRegistrationExpiry();
            return this.getRegisterResult();
        }

        this.setConnectionState('connecting');

        try {
            if (this.connectionState !== 'disconnected') {
                await this.provider.unregister();
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
                if (!this.intentionalDisconnect && this.autoReconnect) {
                    this.onSipLog?.("warn", "sip.Client", "", "Desconexão inesperada do WebSocket. Iniciando tentativas de reconexão...");
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
            onAccept: (data) => {
                this.setConnectionState('registered');
                this.reconnectAttempt = 0;
                this.scheduleRegistrationExpiry();
                this.onRegister.onAccept?.(data);
                this.emitter.emit('registered');
                this.restorePresenceSubscriptions().catch(error => {
                    this.onSipLog?.('warn', 'sip.Client', '', `Falha ao restaurar inscrições de presença: ${error}`);
                });
            },
            onReject: (error) => {
                this.setConnectionState('error');
                this.onRegister.onReject?.(error);
                this.emitter.emit('register-failed', error);
            },
            onTrying: () => this.onRegister.onTrying?.(),
            onRedirect: (data) => this.onRegister.onRedirect?.(data),
        };

        try {
            await this.provider.register(
                this.credentials,
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

    async refreshRegistration(): Promise<void> {
        return this.enqueue(async () => {
            if (this.provider.refreshRegistration) {
                await this.provider.refreshRegistration();
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
            try { await this.provider.unregister(); } catch (_) { }
            this.credentials = credentials;
            this.connectionState = 'disconnected';
            return this.doRegister();
        });
    }

    private scheduleRegistrationExpiry() {
        if (this.registrationExpiryTimer) clearTimeout(this.registrationExpiryTimer);
        const delay = Math.max(5, 3600 - this.registrationExpiringBuffer) * 1000;
        this.registrationExpiryTimer = setTimeout(() => {
            this.registrationExpiryTimer = undefined;
            this.onRegister.onExpiring?.();
            this.emitter.emit('registration-expiring');

            if (this.autoRefreshRegistration && !this.intentionalDisconnect) {
                this.refreshRegistration().catch(error => {
                    this.onSipLog?.("error", "sip.Client", "", `Falha ao renovar registro SIP: ${error}`);
                    if (this.autoReconnect) this.triggerReconnection();
                });
            }
        }, delay);
    }

    private getRegisterResult(): SipRegisterResult {
        if (this.provider instanceof SipJSProvider) {
            return {
                userAgent: this.provider.getUserAgent(),
                registerer: this.provider.getRegisterer(),
            };
        }

        return {
            userAgent: (this.provider as any).getUA?.() || this.provider,
            registerer: (this.provider as any).getRegisterer?.() || null,
        };
    }

    // ─── Reconnect / health ──────────────────────────────────────────────────

    async reconnect(): Promise<void> {
        return this.enqueue(() => this.doReconnect());
    }

    private async doReconnect(): Promise<void> {
        this.intentionalDisconnect = false;
        this.setConnectionState('connecting');
        if (this.provider.reconnect) {
            await this.provider.reconnect();
            this.setConnectionState('registered');
            this.reconnectAttempt = 0;
            this.scheduleRegistrationExpiry();
            return;
        }
        await this.provider.unregister().catch(() => {});
        await this.doRegister();
    }

    async checkHealth(): Promise<SipHealthStatus> {
        const providerHealth = this.provider.getHealth?.() ?? {};
        let pingResult: { ok: boolean; latencyMs?: number; error?: string } | undefined;

        if (this.provider.ping && this.connectionState !== 'disconnected') {
            pingResult = await this.provider.ping();
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

    private getReconnectDelay(attempt: number): number {
        return Math.min(
            this.reconnectDelay * Math.pow(2, attempt - 1),
            this.maxReconnectDelay
        );
    }

    private triggerReconnection() {
        if (this.reconnectTimer || !this.autoReconnect) return;
        if (this.reconnectAttempt >= this.maxReconnectAttempts) {
            this.onSipLog?.("error", "sip.Client", "", `Número máximo de tentativas de reconexão atingido (${this.maxReconnectAttempts}).`);
            return;
        }

        const nextAttempt = this.reconnectAttempt + 1;
        const delay = this.getReconnectDelay(nextAttempt);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            this.reconnectAttempt = nextAttempt;
            this.onSipLog?.("info", "sip.Client", "", `Tentativa de reconexão ${this.reconnectAttempt}/${this.maxReconnectAttempts} (delay: ${delay}ms)...`);
            try {
                await this.reconnect();
            } catch (error) {
                this.onSipLog?.("error", "sip.Client", "", `Falha na tentativa de reconexão: ${error}`);
                this.triggerReconnection();
            }
        }, delay);
    }

    // ─── Presence / BLF ──────────────────────────────────────────────────────

    async subscribePresence(target: string, options?: PresenceSubscribeOptions): Promise<void> {
        if (!this.provider.subscribePresence) {
            throw new Error("Presence subscription is not supported by the selected SIP provider.");
        }
        this.presenceSubscriptions.set(target, options);
        await this.provider.subscribePresence(target, options);
    }

    async unsubscribePresence(target: string): Promise<void> {
        this.presenceSubscriptions.delete(target);
        if (!this.provider.unsubscribePresence) return;
        await this.provider.unsubscribePresence(target);
    }

    private async restorePresenceSubscriptions(): Promise<void> {
        if (!this.provider.subscribePresence || this.presenceSubscriptions.size === 0) return;
        for (const [target, options] of this.presenceSubscriptions.entries()) {
            await this.provider.subscribePresence(target, options).catch(() => undefined);
        }
    }

    onPresence(listener: (presence: PresenceEvent) => void): this {
        return this.on('presence', listener);
    }

    // ─── Sounds ──────────────────────────────────────────────────────────────

    private playRingtone() {
        if (typeof window === 'undefined') return;
        if (this.options.sounds?.ringtone) {
            try {
                if (!this.ringtoneAudio) {
                    this.ringtoneAudio = new Audio(this.options.sounds.ringtone);
                    this.ringtoneAudio.loop = true;
                }
                this.ringtoneAudio.currentTime = 0;
                this.ringtoneAudio.play().catch(() => this.synthesizer.playRingtone());
            } catch {
                this.synthesizer.playRingtone();
            }
        } else {
            this.synthesizer.playRingtone();
        }
    }

    private stopRingtone() {
        this.synthesizer.stop();
        if (this.ringtoneAudio) {
            try { this.ringtoneAudio.pause(); this.ringtoneAudio.currentTime = 0; } catch (_) {}
        }
    }

    private playRingback() {
        if (typeof window === 'undefined') return;
        if (this.options.sounds?.ringback) {
            try {
                if (!this.ringbackAudio) {
                    this.ringbackAudio = new Audio(this.options.sounds.ringback);
                    this.ringbackAudio.loop = true;
                }
                this.ringbackAudio.currentTime = 0;
                this.ringbackAudio.play().catch(() => this.synthesizer.playRingback());
            } catch {
                this.synthesizer.playRingback();
            }
        } else {
            this.synthesizer.playRingback();
        }
    }

    private stopRingback() {
        this.synthesizer.stop();
        if (this.ringbackAudio) {
            try { this.ringbackAudio.pause(); this.ringbackAudio.currentTime = 0; } catch (_) {}
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
            const session = await this.provider.call(options);
            session.on?.('progress', event => {
                if (event?.hasEarlyMedia || event?.statusCode === 183) this.stopRingback();
            });
            session.on?.('established', () => this.stopRingback());
            session.on?.('failed', () => this.stopRingback());
            session.on?.('terminated', () => this.stopRingback());

            const originalOnTerminate = session.onTerminate;
            session.onTerminate = () => {
                this.stopRingback();
                originalOnTerminate?.();
            };

            session.onConfirm = () => {
                this.stopRingback();
            };

            this.trackSession(session);
            return session;
        } catch (error) {
            this.stopRingback();
            throw error;
        }
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        this.stopRingtone();
        const session = await this.provider.answer(invitation, options);
        this.trackSession(session);
        return session;
    }

    mute(): void { this.activeSession?.mute(); }
    unmute(): void { this.activeSession?.unmute(); }
    muteVideo(): void { this.activeSession?.muteVideo(); }
    unmuteVideo(): void { this.activeSession?.unmuteVideo(); }

    async hold(): Promise<void> { await this.activeSession?.hold(); }
    async unhold(): Promise<void> { await this.activeSession?.unhold(); }

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
        const hasSpeakerSelection = typeof HTMLMediaElement !== 'undefined' && typeof (HTMLMediaElement.prototype as any).setSinkId === 'function';
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
        await this.provider.sendMessage(destination, body);
    }

    // ─── Unregister / cleanup ────────────────────────────────────────────────

    async unregister(): Promise<void> {
        return this.enqueue(() => this.doUnregister());
    }

    private async doUnregister(): Promise<void> {
        this.intentionalDisconnect = true;
        this.clearTimers();
        this.stopAllSounds();
        this.cleanupNetworkMonitoring();

        for (const session of [...this.sessions]) {
            try { await session.bye(); } catch (_) { /* continue */ }
        }

        await this.provider.unregister();
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
    }
}

export * from "./core/types.js";
export * from "./core/provider.js";
export * from "./core/sipjs-provider.js";
export * from "./core/jssip-provider.js";
export * from "./core/event-emitter.js";
export * from "./core/device-manager.js";
export * from "./core/call-quality.js";
export * from "./core/logger.js";

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
