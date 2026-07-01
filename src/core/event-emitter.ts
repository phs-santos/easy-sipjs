import { PresenceEvent, SipConnectionState, SipHealthStatus, SipInvitation, SipResponseEvent, SipSessionEventMap, SipSessionStatus } from './types.js';
import { ISipSession } from './provider.js';

export type SipEventMap = {
    connect: [];
    disconnect: [error?: Error];
    registered: [];
    'register-failed': [error?: any];
    'registration-expiring': [];
    invite: [invitation: SipInvitation];
    message: [message: any];
    notify: [notification: any];
    refer: [referral: any];
    subscribe: [subscription: any];
    presence: [presence: PresenceEvent];
    health: [status: SipHealthStatus];
    response: [event: SipResponseEvent];
    session: [session: ISipSession];
    'session-state': [session: ISipSession, state: SipSessionStatus];
    'session-progress': [session: ISipSession, event?: SipSessionEventMap['progress'][0]];
    'session-established': [session: ISipSession];
    'session-terminated': [session: ISipSession, event?: SipSessionEventMap['terminated'][0]];
    'session-failed': [session: ISipSession, event: SipSessionEventMap['failed'][0]];
    'connection-state': [state: SipConnectionState];
};

type Listener<Args extends any[]> = (...args: Args) => void;

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
        for (const listener of [...arr] as Listener<any[]>[]) {
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
