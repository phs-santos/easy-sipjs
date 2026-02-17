import { UserAgent, Registerer, RegistererRegisterOptions, UserAgentDelegate, Inviter, Session } from "sip.js";
import { OutgoingRequestDelegate } from "sip.js/lib/core";
import { ISipProvider, ISipSession } from "./provider";
import { SipCredentials, CallOptions, SipRegisterResult } from "./types";
import { handleStateChanges } from "./media";

export class SipJSSession implements ISipSession {
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
        onRegister: OutgoingRequestDelegate
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
            logLevel: "debug",
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

        handleStateChanges(inviter, localElement, remoteElement);

        await inviter.invite({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
        });

        return new SipJSSession(inviter);
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
