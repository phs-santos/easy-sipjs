import { UserAgent, Registerer, RegistererRegisterOptions, UserAgentDelegate, Inviter, Session, Invitation } from "sip.js";
import { OutgoingRequestDelegate } from "sip.js/lib/core";
import { ISipProvider, ISipSession } from "./provider";
import { SipCredentials, CallOptions, SipRegisterResult, MediaElements, AnswerOptions } from "./types";
import { handleStateChanges } from "./media";

export class SipJSSession implements ISipSession {
    public onTerminate?: () => void;
    private remoteElement?: HTMLMediaElement;

    constructor(private session: Session) { }

    /** @internal */
    setRemoteElement(el: HTMLMediaElement) {
        this.remoteElement = el;
    }

    async bye(): Promise<void> {
        const state = this.session.state;
        if (state === "Initial" || state === "Establishing") {
            if (this.session instanceof Inviter) {
                await this.session.cancel();
            } else if (this.session instanceof Invitation) {
                await this.session.reject();
            }
        } else if (state === "Established") {
            await this.session.bye();
        }
    }

    mute(): void {
        this.toggleAudioTracks(false);
    }

    unmute(): void {
        this.toggleAudioTracks(true);
    }

    muteVideo(): void {
        this.toggleVideoTracks(false);
    }

    unmuteVideo(): void {
        this.toggleVideoTracks(true);
    }

    async hold(): Promise<void> {
        const options: any = {
            sessionDescriptionHandlerOptions: {
                hold: true
            }
        };
        await this.session.invite(options);
        this.toggleAudioTracks(false); // Silencia localmente também
    }

    async unhold(): Promise<void> {
        const options: any = {
            sessionDescriptionHandlerOptions: {
                hold: false
            }
        };
        await this.session.invite(options);
        this.toggleAudioTracks(true); // Reativa localmente
    }

    async transfer(target: string | ISipSession): Promise<void> {
        if (typeof target === "string") {
            const uri = UserAgent.makeURI(target);
            if (!uri) throw new Error("Invalid transfer target URI");
            await this.session.refer(uri);
        } else {
            // Supondo que target seja uma instância de SipJSSession
            const otherSession = (target as any).session;
            if (!otherSession) throw new Error("Invalid transfer target session");
            await this.session.refer(otherSession);
        }
    }

    async setAudioOutput(deviceId: string): Promise<void> {
        if (!this.remoteElement) return;
        if (typeof (this.remoteElement as any).setSinkId === 'function') {
            await (this.remoteElement as any).setSinkId(deviceId);
        } else {
            console.warn("setSinkId is not supported in this browser");
        }
    }

    private toggleAudioTracks(enabled: boolean): void {
        const handler = this.session.sessionDescriptionHandler;
        if (handler && (handler as any).localMediaStream) {
            const stream = (handler as any).localMediaStream as MediaStream;
            stream.getAudioTracks().forEach(track => {
                track.enabled = enabled;
            });
        }
    }

    private toggleVideoTracks(enabled: boolean): void {
        const handler = this.session.sessionDescriptionHandler;
        if (handler && (handler as any).localMediaStream) {
            const stream = (handler as any).localMediaStream as MediaStream;
            stream.getVideoTracks().forEach(track => {
                track.enabled = enabled;
            });
        }
    }
}

export class SipJSProvider implements ISipProvider {
    private userAgent?: UserAgent;
    private registerer?: Registerer;

    async register(
        credentials: SipCredentials,
        onUserAgent: UserAgentDelegate,
        onRegister: OutgoingRequestDelegate,
        onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void> {
        const {
            domain,
            phone,
            secret,
            nameexten,
            server,
            userAgentString = "sipjs-simple",
        } = credentials;

        const uri = UserAgent.makeURI(`sip:${phone}@${domain}`);
        if (!uri) throw new Error("Invalid SIP URI");

        this.userAgent = new UserAgent({
            displayName: nameexten ?? phone,
            authorizationUsername: phone,
            authorizationPassword: secret,
            uri,
            transportOptions: { server, traceSip: true },
            userAgentString,
            contactParams: { transport: "wss" },
            delegate: onUserAgent,
            logLevel: "error",
            // logLevel: "debug",
            logConnector: (level: string, category: string, label: string | undefined, content: string) => {
                if (onSipLog) {
                    onSipLog(level, category, label || "", content);
                }
            }
        });

        // Forçar o Contact a ser o mesmo da AOR (uri) ajuda o SIP.js a reconhecer 
        // a resposta 200 OK do Asterisk quando ele reescreve o cabeçalho Contact (NAT).
        this.userAgent.contact.pubGruu = uri;
        this.userAgent.contact.tempGruu = uri;

        await this.userAgent.start();

        this.registerer = new Registerer(this.userAgent, {
            expires: 3600,
            extraHeaders: ["Organization: @phs-santos616"],
        });

        const options: RegistererRegisterOptions = {
            requestDelegate: onRegister,
        };

        await this.registerer.register(options);
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.userAgent) {
            throw new Error("UserAgent not initialized. Call register() first.");
        }

        const { destination, localElement, remoteElement, video } = options;

        const target = UserAgent.makeURI(destination);
        if (!target) throw new Error("Invalid destination URI");

        const inviter = new Inviter(this.userAgent, target);
        const sipSession = new SipJSSession(inviter);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(
            inviter,
            localElement,
            remoteElement,
            () => { if (sipSession.onTerminate) sipSession.onTerminate(); }
        );

        await inviter.invite({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
        });

        return sipSession;
    }

    async answer(invitation: Invitation, options: AnswerOptions): Promise<ISipSession> {
        if (!this.userAgent) {
            throw new Error("UserAgent not initialized. Call register() first.");
        }

        const { localElement, remoteElement, video } = options;
        const sipSession = new SipJSSession(invitation);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(
            invitation,
            localElement,
            remoteElement,
            () => { if (sipSession.onTerminate) sipSession.onTerminate(); }
        );

        await invitation.accept({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
        });

        return sipSession;
    }

    /**
     * Helper to identify if an invitation has video
     */
    public static isVideoCall(invitation: Invitation): boolean {
        const body = invitation.request.body;
        if (!body) return false;
        // Check if SDP contains m=video and it's not disabled (port 0)
        return body.includes("m=video") && !body.includes("m=video 0");
    }

    async unregister(): Promise<void> {
        if (this.registerer) {
            await this.registerer.unregister();
            this.registerer = undefined;
        }
        if (this.userAgent) {
            await this.userAgent.stop();
            this.userAgent = undefined;
        }
    }

    // Helper to get raw objects if needed internally
    public getUserAgent() { return this.userAgent; }
    public getRegisterer() { return this.registerer; }
}
