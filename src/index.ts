import {
    SipCredentials,
    CallOptions,
    SipRegisterResult,
    SipInvitation,
    AnswerOptions,
    SipConnectionState,
} from "./core/types";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./core/provider";
import { SipJSProvider } from "./core/sipjs-provider";
import { JsSIPProvider } from "./core/jssip-provider";
import { SipAudioSynthesizer } from "./core/audio-synthesizer";
import { SipEventEmitter, SipEventMap } from "./core/event-emitter";

export interface SipClientOptions {
    provider?: 'sipjs' | 'jssip';
    customProvider?: ISipProvider;
    sounds?: {
        ringtone?: string;
        ringback?: string;
    };
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    maxReconnectDelay?: number;
    registrationExpiringBuffer?: number;
}

export class SipClient {
    private sessions: ISipSession[] = [];
    private activeSessionId?: string;
    private connectionState: SipConnectionState = 'disconnected';
    private provider: ISipProvider;
    private emitter = new SipEventEmitter();

    public onUserAgent: ISipUserAgentDelegate = {};
    public onRegister: ISipRegisterDelegate = {};

    public onConnectionStateChange?: (state: SipConnectionState) => void;
    public onSipLog?: (level: string, category: string, label: string, content: string) => void;

    private intentionalDisconnect = false;
    private reconnectTimer?: any;
    private reconnectAttempt = 0;
    private maxReconnectAttempts: number;
    private reconnectDelay: number;
    private maxReconnectDelay: number;

    private registrationExpiryTimer?: any;
    private registrationExpiringBuffer: number;

    private ringtoneAudio?: HTMLAudioElement;
    private ringbackAudio?: HTMLAudioElement;
    private synthesizer = new SipAudioSynthesizer();

    private operationLock: Promise<void> = Promise.resolve();

    public static isVideoCall(invitation: SipInvitation): boolean {
        const raw = invitation.raw;
        if (raw.request && raw.request.body) {
            const body = raw.request.body;
            return body.includes("m=video") && !body.includes("m=video 0");
        }
        return false;
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

    constructor(private credentials: SipCredentials, private options?: SipClientOptions) {
        if (options?.customProvider) {
            this.provider = options.customProvider;
        } else if (options?.provider === 'jssip') {
            this.provider = new JsSIPProvider();
        } else {
            this.provider = new SipJSProvider();
        }

        this.maxReconnectAttempts = options?.maxReconnectAttempts ?? 10;
        this.reconnectDelay = options?.reconnectDelay ?? 5000;
        this.maxReconnectDelay = options?.maxReconnectDelay ?? 60000;
        this.registrationExpiringBuffer = options?.registrationExpiringBuffer ?? 30;

        this.setupNetworkMonitoring();
    }

    // ─── EventEmitter ─────────────────────────────────────────────────────────

    on<K extends keyof SipEventMap>(event: K, listener: (...args: SipEventMap[K]) => void): this {
        this.emitter.on(event, listener);
        return this;
    }

    off<K extends keyof SipEventMap>(event: K, listener: (...args: SipEventMap[K]) => void): this {
        this.emitter.off(event, listener);
        return this;
    }

    // ─── Network monitoring ───────────────────────────────────────────────────

    private setupNetworkMonitoring() {
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('online', this.handleOnline);
        }
    }

    private cleanupNetworkMonitoring() {
        if (typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('online', this.handleOnline);
        }
    }

    private handleOnline = () => {
        if (!this.intentionalDisconnect && this.connectionState === 'disconnected') {
            this.onSipLog?.("info", "sip.Client", "", "Conectividade de rede restaurada. Tentando reconectar...");
            this.triggerReconnection();
        }
    };

    // ─── Session management ───────────────────────────────────────────────────

    public get activeSession(): ISipSession | undefined {
        if (this.activeSessionId) {
            const session = this.sessions.find(s => s.id === this.activeSessionId);
            if (session) return session;
        }
        return this.sessions[this.sessions.length - 1];
    }

    public getSessions(): ISipSession[] {
        return this.sessions;
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

    // ─── Operation locking ──────────────────────────────────────────────────
    // register()/unregister() mutate shared provider state (UserAgent, Registerer).
    // If they overlap — e.g. a React effect cleanup firing unregister() while a
    // prior register() is still awaiting transport setup — the provider can be
    // torn down mid-construction, crashing with errors like "Cannot read
    // properties of undefined". Serializing them here makes that impossible.
    private enqueue<T>(op: () => Promise<T>): Promise<T> {
        const result = this.operationLock.then(op, op);
        this.operationLock = result.then(() => undefined, () => undefined);
        return result;
    }

    // ─── Register ─────────────────────────────────────────────────────────────

    async register(): Promise<SipRegisterResult> {
        return this.enqueue(() => this.doRegister());
    }

    private async doRegister(): Promise<SipRegisterResult> {
        this.intentionalDisconnect = false;
        this.setConnectionState('connecting');

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
                if (!this.intentionalDisconnect) {
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
                    if (originalOnTerminate) originalOnTerminate();
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
            onRefer: (r) => this.onUserAgent.onRefer?.(r),
            onRegister: (r) => this.onUserAgent.onRegister?.(r),
            onSubscribe: (s) => this.onUserAgent.onSubscribe?.(s),
        };

        const internalRegisterDelegate: ISipRegisterDelegate = {
            onAccept: (data) => {
                this.setConnectionState('registered');
                this.reconnectAttempt = 0;
                this.scheduleRegistrationExpiry();
                this.onRegister.onAccept?.(data);
                this.emitter.emit('registered');
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
                this.onSipLog
            );
        } catch (error) {
            this.setConnectionState('error');
            throw error;
        }

        if (this.provider instanceof SipJSProvider) {
            return {
                userAgent: this.provider.getUserAgent()!,
                registerer: this.provider.getRegisterer()!,
            };
        }

        return {
            userAgent: (this.provider as any).getUA?.() || this.provider,
            registerer: (this.provider as any).getRegisterer?.() || null,
        };
    }

    /**
     * Applies new SIP credentials and reconnects, without tearing down event
     * listeners or session bookkeeping the way a full unregister()/register()
     * cycle would. Any in-flight calls are terminated first since they belong
     * to the identity being replaced.
     */
    async updateCredentials(credentials: SipCredentials): Promise<SipRegisterResult> {
        return this.enqueue(async () => {
            for (const session of this.sessions) {
                try { await session.bye(); } catch (_) { }
            }
            this.sessions = [];
            this.activeSessionId = undefined;

            this.intentionalDisconnect = true;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }
            if (this.registrationExpiryTimer) {
                clearTimeout(this.registrationExpiryTimer);
                this.registrationExpiryTimer = undefined;
            }
            this.reconnectAttempt = 0;

            try { await this.provider.unregister(); } catch (_) { }

            this.credentials = credentials;
            return this.doRegister();
        });
    }

    private scheduleRegistrationExpiry() {
        if (this.registrationExpiryTimer) clearTimeout(this.registrationExpiryTimer);
        const delay = (3600 - this.registrationExpiringBuffer) * 1000;
        this.registrationExpiryTimer = setTimeout(() => {
            this.registrationExpiryTimer = undefined;
            this.onRegister.onExpiring?.();
            this.emitter.emit('registration-expiring');
        }, delay);
    }

    // ─── Reconnect with exponential backoff ───────────────────────────────────

    private getReconnectDelay(): number {
        return Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempt - 1),
            this.maxReconnectDelay
        );
    }

    private triggerReconnection() {
        if (this.reconnectTimer) return;
        if (this.reconnectAttempt >= this.maxReconnectAttempts) {
            this.onSipLog?.("error", "sip.Client", "", `Número máximo de tentativas de reconexão atingido (${this.maxReconnectAttempts}).`);
            return;
        }

        const delay = this.getReconnectDelay();
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            this.reconnectAttempt++;
            this.onSipLog?.("info", "sip.Client", "", `Tentativa de reconexão ${this.reconnectAttempt}/${this.maxReconnectAttempts} (delay: ${delay}ms)...`);
            try {
                try { await this.provider.unregister(); } catch (_) {}
                await this.register();
            } catch (error) {
                this.onSipLog?.("error", "sip.Client", "", `Falha na tentativa de reconexão: ${error}`);
                this.triggerReconnection();
            }
        }, delay);
    }

    // ─── Sounds ───────────────────────────────────────────────────────────────

    private playRingtone() {
        if (typeof window === 'undefined') return;
        if (this.options?.sounds?.ringtone) {
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
        if (this.options?.sounds?.ringback) {
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

    // ─── Session tracking ─────────────────────────────────────────────────────

    private trackSession(session: ISipSession) {
        this.sessions.push(session);
        const originalOnTerminate = session.onTerminate;
        session.onTerminate = () => {
            this.sessions = this.sessions.filter(s => s.id !== session.id);
            if (this.activeSessionId === session.id) {
                this.activeSessionId = undefined;
            }
            if (originalOnTerminate) originalOnTerminate();
        };
    }

    // ─── Call control ─────────────────────────────────────────────────────────

    async call(options: CallOptions): Promise<ISipSession> {
        this.playRingback();
        try {
            const session = await this.provider.call(options);

            const originalOnTerminate = session.onTerminate;
            session.onTerminate = () => {
                this.stopRingback();
                if (originalOnTerminate) originalOnTerminate();
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

    /**
     * Attended transfer: places `firstSession` on hold, then transfers it
     * to replace `secondSession`, and terminates `secondSession`.
     */
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

    async sendDTMF(tone: string): Promise<void> {
        await this.activeSession?.sendDTMF(tone);
    }

    async hangup(): Promise<void> {
        const active = this.activeSession;
        if (active) await active.bye();
    }

    async sendMessage(destination: string, body: string): Promise<void> {
        await this.provider.sendMessage(destination, body);
    }

    // ─── Unregister / cleanup ─────────────────────────────────────────────────

    async unregister(): Promise<void> {
        return this.enqueue(() => this.doUnregister());
    }

    private async doUnregister(): Promise<void> {
        this.intentionalDisconnect = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.registrationExpiryTimer) {
            clearTimeout(this.registrationExpiryTimer);
            this.registrationExpiryTimer = undefined;
        }
        this.reconnectAttempt = 0;
        this.stopAllSounds();
        this.cleanupNetworkMonitoring();

        await this.provider.unregister();
        this.sessions = [];
        this.activeSessionId = undefined;
        this.setConnectionState('disconnected');
    }
}

export * from "./core/types";
export * from "./core/provider";
export * from "./core/sipjs-provider";
export * from "./core/jssip-provider";
export * from "./core/event-emitter";
