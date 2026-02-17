import { UserAgent, Registerer, RegistererRegisterOptions, UserAgentDelegate, Inviter, Session, Invitation } from "sip.js";
import { OutgoingRequestDelegate } from "sip.js/lib/core";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider";
import { SipCredentials, CallOptions, SipInvitation, AnswerOptions } from "./types";
import { handleStateChanges } from "./media";

export class SipJSSession implements ISipSession {
    public onTerminate?: () => void;
    public onDTMF?: (tone: string) => void;
    private remoteElement?: HTMLMediaElement;

    constructor(private session: Session) {
        this.session.delegate = {
            onInfo: (info) => {
                const contentType = info.request.getHeader('Content-Type');
                if (contentType && contentType.includes('dtmf-relay')) {
                    const body = info.request.body;
                    const match = body.match(/Signal=\s*([0-9#*])/i);
                    if (match && this.onDTMF) {
                        this.onDTMF(match[1]);
                    }
                    info.accept();
                }
            }
        };
    }

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
        this.toggleAudioTracks(false);
    }

    async unhold(): Promise<void> {
        const options: any = {
            sessionDescriptionHandlerOptions: {
                hold: false
            }
        };
        await this.session.invite(options);
        this.toggleAudioTracks(true);
    }

    async transfer(target: string | ISipSession): Promise<void> {
        if (typeof target === "string") {
            const uri = UserAgent.makeURI(target);
            if (!uri) throw new Error("Invalid transfer target URI");
            await this.session.refer(uri);
        } else {
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

    async sendDTMF(tone: string): Promise<void> {
        const options = {
            requestOptions: {
                body: {
                    contentDisposition: "render",
                    contentType: "application/dtmf-relay",
                    content: `Signal=${tone}\r\nDuration=100`
                }
            }
        };
        return (this.session as any).info(options);
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
        onUserAgent: ISipUserAgentDelegate,
        onRegister: ISipRegisterDelegate,
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

        const userAgentDelegate: UserAgentDelegate = {
            onConnect: onUserAgent.onConnect,
            onDisconnect: onUserAgent.onDisconnect,
            onInvite: (invitation: Invitation) => {
                if (onUserAgent.onInvite) {
                    const sipInvitation = this.mapToInvitation(invitation);

                    invitation.stateChange.addListener((state) => {
                        if (state === "Terminated" && sipInvitation.onTerminate) {
                            sipInvitation.onTerminate();
                        }
                    });

                    onUserAgent.onInvite(sipInvitation);
                }
            },
            onMessage: onUserAgent.onMessage,
            onNotify: onUserAgent.onNotify,
            onRefer: onUserAgent.onRefer,
            onRegister: onUserAgent.onRegister,
            onSubscribe: onUserAgent.onSubscribe,
        };

        this.userAgent = new UserAgent({
            displayName: nameexten ?? phone,
            authorizationUsername: phone,
            authorizationPassword: secret,
            uri,
            transportOptions: { server, traceSip: true },
            userAgentString,
            contactParams: { transport: "wss" },
            delegate: userAgentDelegate,
            logLevel: "error",
            logConnector: (level: string, category: string, label: string | undefined, content: string) => {
                if (onSipLog) {
                    onSipLog(level, category, label || "", content);
                }
            }
        });

        this.userAgent.contact.pubGruu = uri;
        this.userAgent.contact.tempGruu = uri;

        await this.userAgent.start();

        this.registerer = new Registerer(this.userAgent, {
            expires: 3600,
            extraHeaders: ["Organization: @phs-santos616"],
        });

        const registerDelegate: OutgoingRequestDelegate = {
            onAccept: onRegister.onAccept,
            onReject: onRegister.onReject,
            onTrying: onRegister.onTrying,
            onRedirect: onRegister.onRedirect,
        };

        const options: RegistererRegisterOptions = {
            requestDelegate: registerDelegate,
        };

        await this.registerer.register(options);
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");

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

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");

        const { localElement, remoteElement, video } = options;
        const rawInvitation = invitation.raw as Invitation;
        const sipSession = new SipJSSession(rawInvitation);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(
            rawInvitation,
            localElement,
            remoteElement,
            () => { if (sipSession.onTerminate) sipSession.onTerminate(); }
        );

        await rawInvitation.accept({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
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

    private mapToInvitation(invitation: Invitation): SipInvitation {
        return {
            remoteIdentity: {
                uri: {
                    user: invitation.remoteIdentity.uri.user!
                },
                displayName: invitation.remoteIdentity.displayName
            },
            accept: async (options) => { await invitation.accept(options); },
            reject: async (options) => { await invitation.reject(options); },
            raw: invitation
        };
    }

    public getUserAgent() { return this.userAgent; }
    public getRegisterer() { return this.registerer; }
}
