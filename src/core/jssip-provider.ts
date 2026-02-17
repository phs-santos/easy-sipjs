import JsSIP from "jssip";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider";
import { SipCredentials, CallOptions, AnswerOptions, SipInvitation } from "./types";
import { assignStream } from "./media";

export class JsSIPSession implements ISipSession {
    public onTerminate?: () => void;
    public onDTMF?: (tone: string) => void;
    private remoteElement?: HTMLMediaElement;

    constructor(private session: any) {
        this.session.on("peerconnection", (data: any) => {
            const pc = data.peerconnection;
            pc.addEventListener("addtrack", (event: any) => {
                if (this.remoteElement && event.streams && event.streams[0]) {
                    assignStream(event.streams[0], this.remoteElement);
                }
            });
        });

        this.session.on("ended", () => {
            if (this.onTerminate) this.onTerminate();
        });

        this.session.on("failed", () => {
            if (this.onTerminate) this.onTerminate();
        });

        this.session.on("newDTMF", (data: any) => {
            if (this.onDTMF && data.dtmf) {
                this.onDTMF(data.dtmf.tone);
            }
        });
    }

    setRemoteElement(el: HTMLMediaElement) {
        this.remoteElement = el;
    }

    async bye(): Promise<void> {
        this.session.terminate();
    }

    mute(): void {
        this.session.mute({ audio: true });
    }

    unmute(): void {
        this.session.unmute({ audio: true });
    }

    muteVideo(): void {
        this.session.mute({ video: true });
    }

    unmuteVideo(): void {
        this.session.unmute({ video: true });
    }

    async hold(): Promise<void> {
        this.session.hold();
    }

    async unhold(): Promise<void> {
        this.session.unhold();
    }

    async transfer(target: string | ISipSession): Promise<void> {
        if (typeof target === "string") {
            this.session.refer(target);
        } else {
            console.warn("Transfer to session object is not directly supported in JsSIP provider wrapper yet.");
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
        this.session.sendDTMF(tone);
    }
}

export class JsSIPProvider implements ISipProvider {
    private ua?: any;

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
        } = credentials;

        const socket = new JsSIP.WebSocketInterface(server!);
        const configuration = {
            sockets: [socket],
            uri: `sip:${phone}@${domain}`,
            password: secret,
            display_name: nameexten ?? phone,
            register: true
        };

        // Fixing "UA is not a constructor" by using JsSIP.UA
        this.ua = new JsSIP.UA(configuration);

        this.ua.on("registered", (data: any) => {
            if (onRegister && onRegister.onAccept) onRegister.onAccept(data);
        });

        this.ua.on("registrationFailed", (data: any) => {
            if (onRegister && onRegister.onReject) onRegister.onReject(data);
        });

        this.ua.on("connected", (data: any) => {
            if (onUserAgent && onUserAgent.onConnect) onUserAgent.onConnect(data);
        });

        this.ua.on("disconnected", (data: any) => {
            if (onUserAgent && onUserAgent.onDisconnect) onUserAgent.onDisconnect(data);
        });

        this.ua.on("newRTCSession", (data: any) => {
            if (data.originator === "remote") {
                const invitation = this.mapToInvitation(data.session);

                data.session.on("ended", () => {
                    if (invitation.onTerminate) invitation.onTerminate();
                });
                data.session.on("failed", () => {
                    if (invitation.onTerminate) invitation.onTerminate();
                });

                if (onUserAgent && onUserAgent.onInvite) {
                    onUserAgent.onInvite(invitation);
                }
            }
        });

        this.ua.start();
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.ua) throw new Error("UA not initialized");

        const { destination, remoteElement, video } = options;

        const session = this.ua.call(`sip:${destination}`, {
            mediaConstraints: { audio: true, video: !!video },
            rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: !!video }
        });

        const jsSipSession = new JsSIPSession(session);
        if (remoteElement) jsSipSession.setRemoteElement(remoteElement);

        return jsSipSession;
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        const { remoteElement, video } = options;

        const rawSession = invitation.raw;
        rawSession.answer({
            mediaConstraints: { audio: true, video: !!video }
        });

        const jsSipSession = new JsSIPSession(rawSession);
        if (remoteElement) jsSipSession.setRemoteElement(remoteElement);

        return jsSipSession;
    }

    async unregister(): Promise<void> {
        if (this.ua) {
            this.ua.stop();
            this.ua = undefined;
        }
    }

    private mapToInvitation(session: any): SipInvitation {
        return {
            remoteIdentity: {
                uri: {
                    user: session.remote_identity.uri.user
                },
                displayName: session.remote_identity.display_name
            },
            accept: async (options) => { session.answer(options); },
            reject: async (options) => { session.terminate(options); },
            raw: session
        };
    }

    public getUA() { return this.ua; }
}
