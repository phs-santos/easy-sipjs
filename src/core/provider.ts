import { SipCredentials, CallOptions, MediaElements } from "./types";

export interface ISipProvider {
    register(
        credentials: SipCredentials,
        onUserAgent: any,
        onRegister: any
    ): Promise<void>;

    call(options: CallOptions): Promise<ISipSession>;

    unregister(): Promise<void>;
}

export interface ISipSession {
    bye(): Promise<void>;
    // In the future, we can add more implementation-agnostic methods here
    // like mute(), hold(), etc.
}
