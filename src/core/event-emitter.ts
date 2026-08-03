import { PresenceEvent, SipConnectionState, SipHealthStatus, SipInvitation, SipResponseEvent, SipSessionEventMap, SipSessionStatus } from './types.js';
import { ISipSession } from './provider.js';

export type SipEventMap = {
    connect: [];
    disconnect: [error?: Error];
    registered: [];
    'register-failed': [error?: unknown];
    'registration-expiring': [];
    invite: [invitation: SipInvitation];
    message: [message: unknown];
    notify: [notification: unknown];
    refer: [referral: unknown];
    subscribe: [subscription: unknown];
    presence: [presence: PresenceEvent];
    health: [status: SipHealthStatus];
    response: [event: SipResponseEvent];
    session: [session: ISipSession];
    'session-state': [session: ISipSession, state: SipSessionStatus];
    'session-progress': [session: ISipSession, event?: SipSessionEventMap['progress'][0]];
    'session-established': [session: ISipSession];
    'session-terminated': [session: ISipSession, event?: SipSessionEventMap['terminated'][0]];
    'session-failed': [session: ISipSession, event: SipSessionEventMap['failed'][0]];
    'session-hold': [session: ISipSession, event?: SipSessionEventMap['hold'][0]];
    'session-unhold': [session: ISipSession, event?: SipSessionEventMap['unhold'][0]];
    'session-dtmf': [session: ISipSession, event: SipSessionEventMap['dtmf'][0]];
    'session-refer': [session: ISipSession, event: SipSessionEventMap['refer'][0]];
    'session-transfer-progress': [session: ISipSession, event: SipSessionEventMap['transfer-progress'][0]];
    'session-media-state': [session: ISipSession, event: SipSessionEventMap['media-state'][0]];
    'session-media-failed': [session: ISipSession, event: SipSessionEventMap['media-failed'][0]];
    'session-quality': [session: ISipSession, snapshot: SipSessionEventMap['quality'][0]];
    'connection-state': [state: SipConnectionState];
};

type Listener<Args extends unknown[]> = (...args: Args) => void;

export class SipEventEmitter {
    private listeners: Partial<{ [K in keyof SipEventMap]: Listener<SipEventMap[K]>[] }> = {};

    on<K extends keyof SipEventMap>(event: K, listener: Listener<SipEventMap[K]>): this {
        if (!this.listeners[event]) this.listeners[event] = [];
        (this.listeners[event] as Listener<SipEventMap[K]>[]).push(listener);
        return this;
    }

    off<K extends keyof SipEventMap>(event: K, listener: Listener<SipEventMap[K]>): this {
        const arr = this.listeners[event] as Listener<SipEventMap[K]>[] | undefined;
        if (arr) {
            this.listeners[event] = arr.filter(l => l !== listener) as any;
        }
        return this;
    }

    emit<K extends keyof SipEventMap>(event: K, ...args: SipEventMap[K]): void {
        const arr = this.listeners[event];
        if (!arr) return;
        for (const listener of [...arr] as Listener<unknown[]>[]) {
            try {
                listener(...args);
            } catch (err) {
                queueMicrotask(() => { throw err; });
            }
        }
    }

    removeAllListeners(event?: keyof SipEventMap): void {
        if (event) {
            delete this.listeners[event];
        } else {
            this.listeners = {};
        }
    }
}
