import { UserAgent, Registerer, RegistererRegisterOptions, UserAgentDelegate, Inviter, Session, Invitation } from "sip.js";
import { OutgoingRequestDelegate } from "sip.js/lib/core";
import { ISipProvider, ISipSession } from "./provider";
import { SipCredentials, CallOptions, SipRegisterResult, MediaElements } from "./types";
import { handleStateChanges } from "./media";

export class SipJSSession implements ISipSession {
    public onTerminate?: () => void;
    constructor(private session: Session) { }

    async bye(): Promise<void> {
        await this.session.bye();
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

    async answer(invitation: Invitation, options: MediaElements): Promise<ISipSession> {
        if (!this.userAgent) {
            throw new Error("UserAgent not initialized. Call register() first.");
        }

        const { localElement, remoteElement } = options;
        const sipSession = new SipJSSession(invitation);

        handleStateChanges(
            invitation,
            localElement,
            remoteElement,
            () => { if (sipSession.onTerminate) sipSession.onTerminate(); }
        );

        await invitation.accept({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
        });

        return sipSession;
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
