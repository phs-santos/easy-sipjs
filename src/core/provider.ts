import { SipCredentials, CallOptions, MediaElements, AnswerOptions } from "./types";

export interface ISipProvider {
    register(
        credentials: SipCredentials,
        onUserAgent: any,
        onRegister: any,
        onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void>;

    call(options: CallOptions): Promise<ISipSession>;
    answer(invitation: any, options: AnswerOptions): Promise<ISipSession>;
    unregister(): Promise<void>;
}


export interface ISipSession {
    onTerminate?: () => void;
    bye(): Promise<void>;
    mute(): void;
    unmute(): void;
    muteVideo(): void;
    unmuteVideo(): void;
    hold(): Promise<void>;
    unhold(): Promise<void>;
    transfer(target: string | ISipSession): Promise<void>;
}
