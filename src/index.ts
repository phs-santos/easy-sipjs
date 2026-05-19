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

    constructor(private credentials: SipCredentials, options?: { provider?: 'sipjs' | 'jssip', customProvider?: ISipProvider }) {
        if (options?.customProvider) {
            this.provider = options.customProvider;
        } else if (options?.provider === 'jssip') {
            this.provider = new JsSIPProvider();
        } else {
            this.provider = new SipJSProvider();
        }
    }

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
        this.setConnectionState('connecting');

        const originalOnConnect = this.onUserAgent.onConnect;
        this.onUserAgent.onConnect = (data) => {
            this.setConnectionState('connected');
            if (originalOnConnect) originalOnConnect(data);
        };

        const originalOnDisconnect = this.onUserAgent.onDisconnect;
        this.onUserAgent.onDisconnect = (error) => {
            this.setConnectionState('disconnected');
            if (originalOnDisconnect) originalOnDisconnect(error);
        };

        const originalOnAccept = this.onRegister.onAccept;
        this.onRegister.onAccept = (data) => {
            this.setConnectionState('registered');
            if (originalOnAccept) originalOnAccept(data);
        };

        const originalOnReject = this.onRegister.onReject;
        this.onRegister.onReject = (error) => {
            this.setConnectionState('error');
            if (originalOnReject) originalOnReject(error);
        };

        try {
            await this.provider.register(
                this.credentials,
                this.onUserAgent,
                this.onRegister,
                this.onSipLog
            );
        } catch (error) {
            this.setConnectionState('error');
            throw error;
        }

        // For backward compatibility if needed, but discouraged
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
        const session = await this.provider.call(options);
        this.trackSession(session);
        return session;
    }

    /**
     * Answers an incoming call (invitation).
     * @param invitation The generic library invitation object.
     * @param options Media elements and video options for the call.
     */
    async answer(invitation: SipInvitation, options: AnswerOptions) {
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
