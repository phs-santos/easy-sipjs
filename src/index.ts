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

export interface SipClientOptions {
    provider?: 'sipjs' | 'jssip';
    customProvider?: ISipProvider;
    sounds?: {
        ringtone?: string;
        ringback?: string;
    };
}

/**
 * SipClient is the main entry point for the library.
 * It provides a high-level API to interact with SIP providers (SIP.js or JsSIP).
 */
export class SipClient {
    private sessions: ISipSession[] = [];
    private activeSessionId?: string;
    private connectionState: SipConnectionState = 'disconnected';
    private provider: ISipProvider;

    public onUserAgent: ISipUserAgentDelegate = {};
    public onRegister: ISipRegisterDelegate = {};

    public onConnectionStateChange?: (state: SipConnectionState) => void;

    /**
     * Callback for SIP signaling logs.
     */
    public onSipLog?: (level: string, category: string, label: string, content: string) => void;

    // Resiliência de rede
    private intentionalDisconnect = false;
    private reconnectTimer?: any;
    private reconnectAttempt = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 5000;

    // Elementos de som
    private ringtoneAudio?: HTMLAudioElement;
    private ringbackAudio?: HTMLAudioElement;
    private synthesizer = new SipAudioSynthesizer();

    /**
     * Factory to check if an invitation has video (Static helper)
     */
    public static isVideoCall(invitation: SipInvitation): boolean {
        const raw = invitation.raw;
        if (raw.request && raw.request.body) {
            const body = raw.request.body;
            return body.includes("m=video") && !body.includes("m=video 0");
        }
        return false;
    }

    /**
     * Requests microphone and/or camera permission from the browser.
     */
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

    /**
     * Lists all available audio output devices (speakers).
     */
    public static async getAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'audiooutput');
        } catch (error) {
            console.error("Failed to enumerate audio output devices:", error);
            return [];
        }
    }

    /**
     * Lists all available audio input devices (microphones).
     */
    public static async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'audioinput');
        } catch (error) {
            console.error("Failed to enumerate audio input devices:", error);
            return [];
        }
    }

    /**
     * Lists all available video input devices (cameras).
     */
    public static async getVideoInputDevices(): Promise<MediaDeviceInfo[]> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'videoinput');
        } catch (error) {
            console.error("Failed to enumerate video input devices:", error);
            return [];
        }
    }

    constructor(private credentials: SipCredentials, private options?: SipClientOptions) {
        if (options?.customProvider) {
            this.provider = options.customProvider;
        } else if (options?.provider === 'jssip') {
            this.provider = new JsSIPProvider();
        } else {
            this.provider = new SipJSProvider();
        }
        this.setupNetworkMonitoring();
    }

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
            this.onSipLog?.("info", "sip.Client", "", "Conectividade de rede restaurada (browser online). Tentando reconectar...");
            this.triggerReconnection();
        }
    };

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
            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(state);
            }
        }
    }

    /**
     * Initializes the user agent and performs registration.
     */
    async register(): Promise<SipRegisterResult> {
        this.intentionalDisconnect = false;
        this.setConnectionState('connecting');

        const internalUserAgentDelegate: ISipUserAgentDelegate = {
            onConnect: (data) => {
                this.setConnectionState('connected');
                this.reconnectAttempt = 0;
                this.onUserAgent.onConnect?.(data);
            },
            onDisconnect: (error) => {
                this.setConnectionState('disconnected');
                this.onUserAgent.onDisconnect?.(error);
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
            },
            onMessage: (msg) => this.onUserAgent.onMessage?.(msg),
            onNotify: (n) => this.onUserAgent.onNotify?.(n),
            onRefer: (r) => this.onUserAgent.onRefer?.(r),
            onRegister: (r) => this.onUserAgent.onRegister?.(r),
            onSubscribe: (s) => this.onUserAgent.onSubscribe?.(s),
        };

        const internalRegisterDelegate: ISipRegisterDelegate = {
            onAccept: (data) => {
                this.setConnectionState('registered');
                this.reconnectAttempt = 0;
                this.onRegister.onAccept?.(data);
            },
            onReject: (error) => {
                this.setConnectionState('error');
                this.onRegister.onReject?.(error);
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

    private triggerReconnection() {
        if (this.reconnectTimer) return;
        if (this.reconnectAttempt >= this.maxReconnectAttempts) {
            this.onSipLog?.("error", "sip.Client", "", `Número máximo de tentativas de reconexão atingido (${this.maxReconnectAttempts}).`);
            return;
        }

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            this.reconnectAttempt++;
            this.onSipLog?.("info", "sip.Client", "", `Tentativa de reconexão ${this.reconnectAttempt}/${this.maxReconnectAttempts}...`);
            try {
                try {
                    await this.provider.unregister();
                } catch (e) {}
                await this.register();
            } catch (error) {
                this.onSipLog?.("error", "sip.Client", "", `Falha na tentativa de reconexão: ${error}`);
                this.triggerReconnection();
            }
        }, this.reconnectDelay);
    }

    private playRingtone() {
        if (typeof window === 'undefined') return;
        if (this.options?.sounds?.ringtone) {
            try {
                if (!this.ringtoneAudio) {
                    this.ringtoneAudio = new Audio(this.options.sounds.ringtone);
                    this.ringtoneAudio.loop = true;
                }
                this.ringtoneAudio.currentTime = 0;
                this.ringtoneAudio.play().catch(err => {
                    this.onSipLog?.("warn", "sip.Client", "", `Falha ao reproduzir ringtone mp3 (bloqueio de autoplay?): ${err}. Usando sintetizador de fallback.`);
                    this.synthesizer.playRingtone();
                });
            } catch (err) {
                this.synthesizer.playRingtone();
            }
        } else {
            this.synthesizer.playRingtone();
        }
    }

    private stopRingtone() {
        this.synthesizer.stop();
        if (this.ringtoneAudio) {
            try {
                this.ringtoneAudio.pause();
                this.ringtoneAudio.currentTime = 0;
            } catch (e) {}
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
                this.ringbackAudio.play().catch(err => {
                    this.onSipLog?.("warn", "sip.Client", "", `Falha ao reproduzir ringback mp3 (bloqueio de autoplay?): ${err}. Usando sintetizador de fallback.`);
                    this.synthesizer.playRingback();
                });
            } catch (err) {
                this.synthesizer.playRingback();
            }
        } else {
            this.synthesizer.playRingback();
        }
    }

    private stopRingback() {
        this.synthesizer.stop();
        if (this.ringbackAudio) {
            try {
                this.ringbackAudio.pause();
                this.ringbackAudio.currentTime = 0;
            } catch (e) {}
        }
    }

    private stopAllSounds() {
        this.stopRingtone();
        this.stopRingback();
    }

    private trackSession(session: ISipSession) {
        this.sessions.push(session);
        const originalOnTerminate = session.onTerminate;
        session.onTerminate = () => {
            this.sessions = this.sessions.filter(s => s.id !== session.id);
            if (this.activeSessionId === session.id) {
                this.activeSessionId = undefined;
            }
            if (originalOnTerminate) {
                originalOnTerminate();
            }
        };
    }

    /**
     * Initiates an outgoing call.
     * @param options Call configuration including destination and HTML media elements.
     */
    async call(options: CallOptions) {
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

    /**
     * Answers an incoming call (invitation).
     * @param invitation The generic library invitation object.
     * @param options Media elements and video options for the call.
     */
    async answer(invitation: SipInvitation, options: AnswerOptions) {
        this.stopRingtone();
        const session = await this.provider.answer(invitation, options);
        this.trackSession(session);
        return session;
    }

    async mute() {
        this.activeSession?.mute();
    }

    async unmute() {
        this.activeSession?.unmute();
    }

    async muteVideo() {
        this.activeSession?.muteVideo();
    }

    async unmuteVideo() {
        this.activeSession?.unmuteVideo();
    }

    async hold() {
        await this.activeSession?.hold();
    }

    async unhold() {
        await this.activeSession?.unhold();
    }

    async transfer(target: string | ISipSession) {
        await this.activeSession?.transfer(target);
    }

    async setAudioOutput(deviceId: string) {
        await this.activeSession?.setAudioOutput(deviceId);
    }

    async sendDTMF(tone: string) {
        await this.activeSession?.sendDTMF(tone);
    }

    async hangup() {
        const active = this.activeSession;
        if (active) {
            await active.bye();
        }
    }

    async unregister() {
        this.intentionalDisconnect = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
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
