/**
 * Stable, machine-readable reasons for the errors this library throws, so apps
 * can branch on `error.code` instead of matching message text.
 */
export type SipErrorCode =
    | 'not-initialized'
    | 'invalid-uri'
    | 'register-rejected'
    | 'register-timeout'
    | 'reinvite-rejected'
    | 'reinvite-in-progress'
    | 'transport-not-ready'
    | 'media-unavailable'
    | 'unsupported';

export interface SipErrorDetails {
    statusCode?: number;
    reasonPhrase?: string;
    /** The underlying SIP response or stack event, when there is one. */
    response?: unknown;
    cause?: unknown;
}

export class SipError extends Error {
    readonly statusCode?: number;
    readonly reasonPhrase?: string;
    readonly response?: unknown;
    readonly cause?: unknown;

    constructor(public readonly code: SipErrorCode, message: string, details: SipErrorDetails = {}) {
        super(message);
        this.name = 'SipError';
        this.statusCode = details.statusCode;
        this.reasonPhrase = details.reasonPhrase;
        this.response = details.response;
        this.cause = details.cause;
    }
}

/**
 * Codes passed as the `label` of the client's own `onSipLog` lines (category
 * `sip.Client`). The text of those lines is meant for people and may change;
 * the code is what to match on.
 */
export const SipLogCode = {
    NetworkOnline: 'network.online',
    TransportDisconnected: 'transport.disconnected',
    RegistrationLost: 'registration.lost',
    RegistrationRefreshFailed: 'registration.refresh-failed',
    ReconnectAttempt: 'reconnect.attempt',
    ReconnectAttemptFailed: 'reconnect.attempt-failed',
    ReconnectExhausted: 'reconnect.exhausted',
    HealthPingFailed: 'health.ping-failed',
    PresenceRestoreFailed: 'presence.restore-failed',
} as const;
