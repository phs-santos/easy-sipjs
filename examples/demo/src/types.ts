import { SipClient, Invitation } from "easy-sipjs";

export type ConnectionState = "idle" | "connecting" | "registered" | "calling" | "in-call" | "error";
export type Chapter = "intro" | "config" | "register" | "calls" | "debug";

export interface LogEntry {
    time: string;
    message: string;
    type: 'info' | 'sip-in' | 'sip-out' | 'error' | 'ws';
}

export interface ManagedSession {
    id: string;
    remoteUser: string;
    status: 'calling' | 'active' | 'on-hold';
    withVideo: boolean;
    dtmfHistory: string[];
}

export interface Credentials {
    domain: string;
    phone: string;
    secret: string;
    server: string;
    audioOutputDeviceId?: string;
}
