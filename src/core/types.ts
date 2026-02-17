import type { UserAgent, Registerer, Inviter } from "sip.js";
export {
    Invitation,
    Message,
    Notification,
    Referral,
    Subscription,
    Session,
    Inviter,
} from "sip.js";

export interface SipCredentials {
    domain: string;
    phone: string;
    secret: string;
    nameexten?: string;
    server?: string;
    userAgentString?: string;
}

export interface MediaElements {
    localElement?: HTMLMediaElement;
    remoteElement?: HTMLMediaElement;
}

export interface AnswerOptions extends MediaElements {
    video?: boolean;
}

export interface CallOptions extends MediaElements {
    destination: string;
    video?: boolean;
    category?: string;
    formData?: string;
    tag?: string;
}

export interface SipSession {
    inviter: Inviter;
}

export interface SipRegisterResult {
    userAgent: UserAgent;
    registerer: Registerer;
    // registererDelegate: OutgoingRequestDelegate;
}
