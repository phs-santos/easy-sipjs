export interface SipCredentials {
    domain: string;
    phone: string;
    secret: string;
    nameexten?: string;
    /** Auth username for the SIP REGISTER. Defaults to `phone` if omitted.
     *  Set this when the SIP/PJSIP endpoint auth username differs from the
     *  phone/DID number (common with Asterisk PJSIP endpoints). */
    authorizationUsername?: string;
    server?: string;
    userAgentString?: string;
    iceServers?: RTCIceServer[];
    debug?: boolean;
}

export interface MediaElements {
    localElement?: HTMLMediaElement;
    remoteElement?: HTMLMediaElement;
}

export interface AnswerOptions extends MediaElements {
    video?: boolean;
    extraHeaders?: string[];
}

export interface CallOptions extends MediaElements {
    destination: string;
    video?: boolean;
    extraHeaders?: string[];
}

export type SipConnectionState = 'connecting' | 'connected' | 'registered' | 'disconnected' | 'error';

export type SipSessionStatus =
    | 'initial'
    | 'establishing'
    | 'established'
    | 'terminating'
    | 'terminated'
    | 'failed';

export type DtmfMode = 'sip-info' | 'rtp-event' | 'auto';

export interface DtmfOptions {
    /** Defaults to `sip-info` because it is the most predictable mode with SIP PBXs. */
    mode?: DtmfMode;
    /** Defaults to 160ms. */
    durationMs?: number;
}

export interface SipFailureEvent {
    statusCode?: number;
    reasonPhrase?: string;
    cause?: unknown;
    originator?: 'local' | 'remote' | 'system' | string;
}

export interface SipResponseEvent {
    method: 'REGISTER' | 'INVITE' | 'REFER' | 'MESSAGE' | 'INFO' | 'OPTIONS' | string;
    statusCode: number;
    reasonPhrase?: string;
    raw?: unknown;
}

export interface SipSessionProgressEvent extends SipResponseEvent {
    method: 'INVITE';
    /** 183 with SDP usually means remote early media should replace local ringback. */
    hasEarlyMedia?: boolean;
}

export interface SipDtmfEvent {
    tone: string;
    durationMs?: number;
    mode?: DtmfMode;
}

export interface SipReferEvent {
    referral: unknown;
    raw?: unknown;
}

export interface SipMessageEvent {
    message: unknown;
    body?: string;
    contentType?: string;
}

export interface SipSessionEventMap {
    state: [state: SipSessionStatus];
    progress: [event?: SipSessionProgressEvent];
    establishing: [];
    established: [];
    terminating: [];
    terminated: [event?: SipFailureEvent];
    failed: [event: SipFailureEvent];
    dtmf: [event: SipDtmfEvent];
    hold: [];
    unhold: [];
    refer: [event: SipReferEvent];
    message: [event: SipMessageEvent];
    notify: [notification: unknown];
}

export interface PresenceEvent {
    target: string;
    extension?: string;
    status: 'available' | 'busy' | 'ringing' | 'offline' | 'unknown';
    note?: string;
    body?: string;
    contentType?: string;
    raw?: unknown;
}

export interface PresenceSubscribeOptions {
    /** SIP event package. Defaults to `presence`. Use `dialog` for BLF/dialog-info. */
    event?: 'presence' | 'dialog' | string;
    expires?: number;
    extraHeaders?: string[];
}

export interface SipHealthStatus {
    websocketConnected: boolean;
    registered: boolean;
    connectionState: SipConnectionState;
    activeSessions: number;
    lastPingOkAt?: Date;
    lastPingLatencyMs?: number;
    lastPingError?: string;
    checkedAt: Date;
}

export interface CallStats {
    jitter: number;
    packetLoss: number;
    roundTripTime: number;
    codec: string;
    bytesSent: number;
    bytesReceived: number;
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
    raw: any;
}

export interface SipRegisterResult {
    userAgent: any;
    registerer: any;
}
