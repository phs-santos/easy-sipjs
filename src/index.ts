import type {
    SipCredentials,
    CallOptions,
    SipRegisterResult,
    Invitation,
    Message,
    Notification,
    Referral,
    Subscription,
} from "./core/types";
import {
    IncomingReferRequest,
    IncomingRegisterRequest,
    IncomingSubscribeRequest,
    OutgoingRequestDelegate,
} from "sip.js/lib/core";
import { UserAgentDelegate } from "sip.js";
import { ISipProvider, ISipSession } from "./core/provider";
import { SipJSProvider } from "./core/sipjs-provider";

export class SipClient {
    private session?: ISipSession;
    private provider: ISipProvider;

    public onUserAgent: UserAgentDelegate = {
        onConnect: () => { },
        onDisconnect: (error: Error) => { },
        onInvite: (invitation: Invitation) => {
            // This is specific to SIP.js provider for now to maintain compatibility
            // but the internal session is managed via ISipSession
        },
        onMessage: (message: Message) => { },
        onNotify: (notification: Notification) => { },
        onRefer: (referral: Referral) => { },
        onReferRequest: (request: IncomingReferRequest) => { },
        onRegister: (registration: unknown) => { },
        onRegisterRequest: (request: IncomingRegisterRequest) => { },
        onSubscribe: (subscription: Subscription) => { },
        onSubscribeRequest: (request: IncomingSubscribeRequest) => { },
    };

    public onRegister: OutgoingRequestDelegate = {
        onAccept: () => { },
        onReject: () => { },
        onTrying: () => { },
        onRedirect: () => { },
    };

    /**
     * Callback for SIP signaling logs.
     * Useful for debugging and showing messages in a console.
     */
    public onSipLog?: (level: string, category: string, label: string, content: string) => void;

    constructor(private credentials: SipCredentials, provider?: ISipProvider) {
        this.provider = provider ?? new SipJSProvider();
    }

    async register(): Promise<SipRegisterResult> {
        await this.provider.register(
            this.credentials,
            this.onUserAgent,
            this.onRegister,
            this.onSipLog
        );

        // Return compatibility object for legacy use
        const sipjsProvider = this.provider as SipJSProvider;
        return {
            userAgent: sipjsProvider.getUserAgent()!,
            registerer: sipjsProvider.getRegisterer()!,
        };
    }

    async call(options: Omit<CallOptions, "userAgent">) {
        const session = await this.provider.call(options);
        this.session = session;
        return session;
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
