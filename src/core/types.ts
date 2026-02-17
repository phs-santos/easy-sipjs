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
}

/**
 * Generic SIP invitation abstraction.
 * Represents an incoming call from any provider.
 */
export interface SipInvitation {
    remoteIdentity: {
        uri: {
            user: string;
        };
        displayName: string;
    };
    accept(options?: any): Promise<void>;
    reject(options?: any): Promise<void>;
    onTerminate?: () => void;
    // Allow access to the raw internal object if needed
    raw: any;
}

export interface SipRegisterResult {
    userAgent: any;
    registerer: any;
}

export type SipConnectionState = 'connecting' | 'connected' | 'registered' | 'disconnected' | 'error';
