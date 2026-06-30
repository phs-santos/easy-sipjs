import { SipConnectionState, SipInvitation } from './types';

export type SipEventMap = {
    connect: [];
    disconnect: [error?: Error];
    registered: [];
    'register-failed': [error?: any];
    'registration-expiring': [];
    invite: [invitation: SipInvitation];
    message: [message: any];
    notify: [notification: any];
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
        if (arr) (arr as Listener<any[]>[]).forEach(l => l(...args));
    }

    removeAllListeners(event?: keyof SipEventMap): void {
        if (event) {
            delete this.listeners[event];
        } else {
            this.listeners = {};
        }
    }
}
