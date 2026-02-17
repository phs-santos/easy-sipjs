import { register } from "./core/register";
import { call } from "./core/call";
import type {
    SipCredentials,
    CallOptions,
    SipRegisterResult,
    Invitation,
    Message,
    Notification,
    Referral,
    Subscription,
    Session,
} from "./core/types";
import {
    IncomingReferRequest,
    IncomingRegisterRequest,
    IncomingSubscribeRequest,
    OutgoingRequestDelegate,
} from "sip.js/lib/core";
import { UserAgentDelegate } from "sip.js";

export class SipClient {
    private userAgent?: SipRegisterResult["userAgent"];
    private registerer?: SipRegisterResult["registerer"];
    private session?: Session;

    public onUserAgent: UserAgentDelegate = {
        onConnect: () => { },
        onDisconnect: (error: Error) => { },
        onInvite: (invitation: Invitation) => {
            this.session = invitation;
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

    constructor(private credentials: SipCredentials) { }

    async register(): Promise<SipRegisterResult> {
        const result = await register(
            this.credentials,
            this.onUserAgent,
            this.onRegister
        );
        this.userAgent = result.userAgent;
        this.registerer = result.registerer;
        return result;
    }

    async call(options: Omit<CallOptions, "userAgent">) {
        if (!this.userAgent)
            throw new Error(
                "UserAgent not initialized. Call register() first."
            );
        const inviter = await call(this.userAgent, options);
        this.session = inviter;
        return inviter;
    }

    async hangup() {
        if (this.session) {
            await this.session.bye();
            this.session = undefined;
        }
    }

    async unregister() {
        if (this.registerer) {
            await this.registerer.unregister();
            this.registerer = undefined;
        }
        if (this.userAgent) {
            await this.userAgent.stop();
            this.userAgent = undefined;
        }
    }
}

export * from "./core/types";
