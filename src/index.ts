import {
    SipCredentials,
    CallOptions,
    SipRegisterResult,
    SipInvitation,
    AnswerOptions,
} from "./core/types";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./core/provider";
import { SipJSProvider } from "./core/sipjs-provider";
import { JsSIPProvider } from "./core/jssip-provider";

/**
 * SipClient is the main entry point for the library.
 * It provides a high-level API to interact with SIP providers (SIP.js or JsSIP).
 */
export class SipClient {
    private session?: ISipSession;
    private provider: ISipProvider;

    public onUserAgent: ISipUserAgentDelegate = {};
    public onRegister: ISipRegisterDelegate = {};

    /**
     * Callback for SIP signaling logs.
     */
    public onSipLog?: (level: string, category: string, label: string, content: string) => void;

    /**
     * Factory to check if an invitation has video (Static helper)
     */
    public static isVideoCall(invitation: SipInvitation): boolean {
        // This is a bit tricky now that it's generic. 
        // We can inspect the raw object or let the provider handle it.
        const raw = invitation.raw;
        if (raw.request && raw.request.body) {
            const body = raw.request.body;
            return body.includes("m=video") && !body.includes("m=video 0");
        }
        return false;
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

    /**
     * Initializes the user agent and performs registration.
     * @returns A promise that resolves to the provider-specific UA and Registerer (for backward compatibility).
     */
    async register(): Promise<SipRegisterResult> {
        await this.provider.register(
            this.credentials,
            this.onUserAgent,
            this.onRegister,
            this.onSipLog
        );

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

    /**
     * Initiates an outgoing call.
     * @param options Call configuration including destination and HTML media elements.
     */
    async call(options: CallOptions) {
        const session = await this.provider.call(options);
        this.session = session;
        return session;
    }

    /**
     * Answers an incoming call (invitation).
     * @param invitation The generic library invitation object.
     * @param options Media elements and video options for the call.
     */
    async answer(invitation: SipInvitation, options: AnswerOptions) {
        const session = await this.provider.answer(invitation, options);
        this.session = session;
        return session;
    }

    async mute() {
        this.session?.mute();
    }

    async unmute() {
        this.session?.unmute();
    }

    async muteVideo() {
        this.session?.muteVideo();
    }

    async unmuteVideo() {
        this.session?.unmuteVideo();
    }

    async hold() {
        await this.session?.hold();
    }

    async unhold() {
        await this.session?.unhold();
    }

    async transfer(target: string | ISipSession) {
        await this.session?.transfer(target);
    }

    async setAudioOutput(deviceId: string) {
        await this.session?.setAudioOutput(deviceId);
    }

    async sendDTMF(tone: string) {
        await this.session?.sendDTMF(tone);
    }

    async hangup() {
        if (this.session) {
            await this.session.bye();
            this.session = undefined;
        }
    }

    async unregister() {
        await this.provider.unregister();
        this.session = undefined;
    }
}

export * from "./core/types";
export * from "./core/provider";
export * from "./core/sipjs-provider";
export * from "./core/jssip-provider";
