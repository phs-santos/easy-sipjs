import { UserAgent, Registerer, RegistererRegisterOptions, UserAgentDelegate, Inviter, Session, Invitation, Messager } from "sip.js";
import { OutgoingRequestDelegate } from "sip.js/lib/core";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider";
import { SipCredentials, CallOptions, SipInvitation, AnswerOptions, CallStats } from "./types";
import { handleStateChanges } from "./media";
import { ensureSipPrefix, parseRTCStats } from "./utils";


export class SipJSSession implements ISipSession {
    public readonly id: string;
    public startedAt?: Date;
    public onConfirm?: () => void;
    public onTerminate?: () => void;
    public onReject?: (statusCode: number) => void;
    public onDTMF?: (tone: string) => void;
    public onProgress?: () => void;
    public onHold?: () => void;
    public onUnhold?: () => void;

    private remoteElement?: HTMLMediaElement;
    private originalVideoTrack?: MediaStreamTrack;
    private audioCtx?: AudioContext;
    private gainNode?: GainNode;

    constructor(private session: Session) {
        this.id = session.id;

        this.session.stateChange.addListener((state) => {
            if (state === "Establishing") {
                this.onProgress?.();
            } else if (state === "Established") {
                this.startedAt = new Date();
                this.onConfirm?.();
            }
        });

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

    getCallDuration(): number {
        if (!this.startedAt) return 0;
        return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
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

    mute(): void { this.toggleAudioTracks(false); }
    unmute(): void { this.toggleAudioTracks(true); }
    muteVideo(): void { this.toggleVideoTracks(false); }
    unmuteVideo(): void { this.toggleVideoTracks(true); }

    async hold(): Promise<void> {
        await this.session.invite({ sessionDescriptionHandlerOptions: { hold: true } } as any);
        this.toggleAudioTracks(false);
        this.onHold?.();
    }

    async unhold(): Promise<void> {
        await this.session.invite({ sessionDescriptionHandlerOptions: { hold: false } } as any);
        this.toggleAudioTracks(true);
        this.onUnhold?.();
    }

    async transfer(target: string | ISipSession): Promise<void> {
        if (typeof target === "string") {
            const uri = UserAgent.makeURI(target);
            if (!uri) throw new Error("Invalid transfer target URI");
            await this.session.refer(uri);
        } else {
            const otherSession = (target as SipJSSession).session;
            if (!otherSession) throw new Error("Invalid transfer target session");
            await this.session.refer(otherSession);
        }
    }

    async setAudioOutput(deviceId: string): Promise<void> {
        if (!this.remoteElement) return;
        if (typeof (this.remoteElement as any).setSinkId === 'function') {
            await (this.remoteElement as any).setSinkId(deviceId);
        }
    }

    async setAudioInput(deviceId: string): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        const newTrack = stream.getAudioTracks()[0];
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(newTrack);
    }

    setRemoteVolume(volume: number): void {
        if (!this.remoteElement) return;
        if (!this.audioCtx) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            this.audioCtx = new AudioCtx();
            const source = this.audioCtx.createMediaElementSource(this.remoteElement);
            this.gainNode = this.audioCtx.createGain();
            source.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
        }
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, volume);
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

    async shareScreen(): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc) throw new Error("No active peer connection");
        const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            this.originalVideoTrack = sender.track ?? undefined;
            await sender.replaceTrack(screenTrack);
            screenTrack.onended = () => this.stopScreenSharing();
        }
    }

    async stopScreenSharing(): Promise<void> {
        const pc = this.getPeerConnection();
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && this.originalVideoTrack) {
            await sender.replaceTrack(this.originalVideoTrack);
            this.originalVideoTrack = undefined;
        }
    }

    async getStats(): Promise<CallStats> {
        const pc = this.getPeerConnection();
        if (!pc) return { jitter: 0, packetLoss: 0, roundTripTime: 0, codec: '', bytesSent: 0, bytesReceived: 0 };
        return parseRTCStats(pc);
    }

    private getPeerConnection(): RTCPeerConnection | undefined {
        const handler = this.session.sessionDescriptionHandler as any;
        return handler?.peerConnection as RTCPeerConnection | undefined;
    }

    private toggleAudioTracks(enabled: boolean): void {
        const handler = this.session.sessionDescriptionHandler as any;
        if (!handler) return;
        if (handler.localMediaStream) {
            (handler.localMediaStream as MediaStream).getAudioTracks().forEach(t => { t.enabled = enabled; });
        }
        const pc = handler.peerConnection as RTCPeerConnection | undefined;
        if (pc) {
            pc.getSenders().forEach(s => { if (s.track?.kind === 'audio') s.track.enabled = enabled; });
        }
    }

    private toggleVideoTracks(enabled: boolean): void {
        const handler = this.session.sessionDescriptionHandler as any;
        if (!handler) return;
        if (handler.localMediaStream) {
            (handler.localMediaStream as MediaStream).getVideoTracks().forEach(t => { t.enabled = enabled; });
        }
        const pc = handler.peerConnection as RTCPeerConnection | undefined;
        if (pc) {
            pc.getSenders().forEach(s => { if (s.track?.kind === 'video') s.track.enabled = enabled; });
        }
    }
}

export class SipJSProvider implements ISipProvider {
    private userAgent?: UserAgent;
    private registerer?: Registerer;
    private domain?: string;

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
            iceServers,
            debug = false,
        } = credentials;

        this.domain = domain;

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
            logLevel: "debug",
            logConnector: (level: string, category: string, label: string | undefined, content: string) => {
                onSipLog?.(level, category, label || "", content);
            },
            sessionDescriptionHandlerFactoryOptions: iceServers ? {
                peerConnectionConfiguration: { iceServers }
            } : undefined
        });

        await this.userAgent.start();

        this.registerer = new Registerer(this.userAgent, { expires: 3600 });

        const registerDelegate: OutgoingRequestDelegate = {
            onAccept: onRegister.onAccept,
            onReject: onRegister.onReject,
            onTrying: onRegister.onTrying,
            onRedirect: onRegister.onRedirect,
        };

        await this.registerer.register({ requestDelegate: registerDelegate } as RegistererRegisterOptions);
    }

    private resolveURI(destination: string): string {
        const withPrefix = ensureSipPrefix(destination);
        // If no host part (e.g. "sip:1001"), append the registered domain
        if (!withPrefix.includes('@') && this.domain) {
            return `sip:${destination.replace(/^sip:/i, '')}@${this.domain}`;
        }
        return withPrefix;
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");

        const { destination, localElement, remoteElement, video, extraHeaders } = options;
        const target = UserAgent.makeURI(this.resolveURI(destination));
        if (!target) throw new Error("Invalid destination URI");

        const inviter = new Inviter(this.userAgent, target, {
            extraHeaders: extraHeaders || []
        });
        const sipSession = new SipJSSession(inviter);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(
            inviter,
            localElement,
            remoteElement,
            () => { sipSession.onTerminate?.(); }
        );

        await inviter.invite({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
            requestDelegate: {
                onReject: (response) => {
                    sipSession.onReject?.(response.message.statusCode ?? 0);
                },
            },
        });

        return sipSession;
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");

        const { localElement, remoteElement, video, extraHeaders } = options;
        const rawInvitation = invitation.raw as Invitation;
        const sipSession = new SipJSSession(rawInvitation);
        if (remoteElement) sipSession.setRemoteElement(remoteElement);

        handleStateChanges(
            rawInvitation,
            localElement,
            remoteElement,
            () => { sipSession.onTerminate?.(); }
        );

        await rawInvitation.accept({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: !!video } },
            extraHeaders: extraHeaders || []
        });

        return sipSession;
    }

    async unregister(): Promise<void> {
        if (this.registerer) {
            try {
                await this.registerer.unregister();
            } catch (_) {
                // The server may reject the unregister REGISTER (e.g. 401 on a
                // stale/expired challenge). The transport is torn down right
                // after regardless, so a failed "polite" unregister is non-fatal.
            }
            this.registerer = undefined;
        }
        if (this.userAgent) {
            await this.userAgent.stop();
            this.userAgent = undefined;
        }
    }

    async sendMessage(destination: string, body: string): Promise<void> {
        if (!this.userAgent) throw new Error("UserAgent not initialized.");
        const target = UserAgent.makeURI(this.resolveURI(destination));
        if (!target) throw new Error("Invalid destination URI");
        const messager = new Messager(this.userAgent, target, body);
        await messager.message();
    }

    private mapToInvitation(invitation: Invitation): SipInvitation {
        return {
            remoteIdentity: {
                uri: { user: invitation.remoteIdentity.uri.user! },
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
