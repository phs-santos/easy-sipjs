import { SipCredentials, CallOptions, AnswerOptions, SipInvitation } from "./types";

export interface ISipProvider {
    register(
        credentials: SipCredentials,
        onUserAgent: ISipUserAgentDelegate,
        onRegister: ISipRegisterDelegate,
        onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void>;

    call(options: CallOptions): Promise<ISipSession>;
    answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession>;
    unregister(): Promise<void>;
}

export interface ISipSession {
    onTerminate?: () => void;
    onDTMF?: (tone: string) => void;
    bye(): Promise<void>;
    mute(): void;
    unmute(): void;
    muteVideo(): void;
    unmuteVideo(): void;
    hold(): Promise<void>;
    unhold(): Promise<void>;
    transfer(target: string | ISipSession): Promise<void>;
    setAudioOutput(deviceId: string): Promise<void>;
    sendDTMF(tone: string): Promise<void>;
}

export interface ISipUserAgentDelegate {
    onConnect?: (data?: any) => void;
    onDisconnect?: (error?: Error) => void;
    onInvite?: (invitation: SipInvitation) => void;
    onMessage?: (message: any) => void;
    onNotify?: (notification: any) => void;
    onRefer?: (referral: any) => void;
    onRegister?: (registration: any) => void;
    onSubscribe?: (subscription: any) => void;
}

export interface ISipRegisterDelegate {
    onAccept?: (data?: any) => void;
    onReject?: (error?: any) => void;
    onTrying?: () => void;
    onRedirect?: (data?: any) => void;
}
