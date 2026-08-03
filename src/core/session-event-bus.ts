import { SipSessionEventMap } from "./types.js";

export type SessionListener<K extends keyof SipSessionEventMap> = (...args: SipSessionEventMap[K]) => void;

/**
 * Shared session-level event bus used by every provider so `ISipSession.on/off`
 * behaves identically regardless of which underlying SIP stack (sip.js or JsSIP)
 * is active.
 */
export class SessionEventBus {
    private listeners: Partial<{ [K in keyof SipSessionEventMap]: SessionListener<K>[] }> = {};

    on<K extends keyof SipSessionEventMap>(event: K, listener: SessionListener<K>): () => void {
        if (!this.listeners[event]) this.listeners[event] = [];
        (this.listeners[event] as SessionListener<K>[]).push(listener);
        return () => this.off(event, listener);
    }

    off<K extends keyof SipSessionEventMap>(event: K, listener: SessionListener<K>): void {
        const arr = this.listeners[event] as SessionListener<K>[] | undefined;
        if (!arr) return;
        // TS can't verify a homomorphic mapped-type assignment through a generic index `K`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.listeners[event] = arr.filter(l => l !== listener) as any;
    }

    emit<K extends keyof SipSessionEventMap>(event: K, ...args: SipSessionEventMap[K]): void {
        const arr = this.listeners[event] as SessionListener<K>[] | undefined;
        if (!arr) return;
        for (const listener of [...arr]) {
            try {
                listener(...args);
            } catch (error) {
                queueMicrotask(() => { throw error; });
            }
        }
    }
}
