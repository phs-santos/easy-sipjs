import JsSIP from "jssip";
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider.js";
import { SipCredentials, CallOptions, AnswerOptions, SipInvitation, CallStats } from "./types.js";
import { assignStream } from "./media.js";
import { ensureSipPrefix, parseRTCStats } from "./utils.js";

export class JsSIPSession implements ISipSession {
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
    private screenTrack?: MediaStreamTrack;
    private audioCtx?: AudioContext;
    private gainNode?: GainNode;

    constructor(private session: any) {
        this.id = session.id || Math.random().toString(36).substring(2, 11);

        this.session.on("progress", () => { this.onProgress?.(); });

        this.session.on("accepted", () => {
            this.startedAt = new Date();
            this.onConfirm?.();
        });

        this.session.on("hold", () => { this.onHold?.(); });
        this.session.on("unhold", () => { this.onUnhold?.(); });

        this.session.on("peerconnection", (data: any) => {
            const pc = data.peerconnection;
            pc.addEventListener("addtrack", (event: any) => {
                if (this.remoteElement && event.streams?.[0]) {
                    assignStream(event.streams[0], this.remoteElement);
                }
            });
        });

        const cleanupAudio = () => {
            if (this.remoteElement) {
                try { this.remoteElement.pause(); } catch (_) {}
                this.remoteElement.srcObject = null;
            }
        };

        this.session.on("ended", () => { cleanupAudio(); this.onTerminate?.(); });
        this.session.on("failed", (data: any) => {
            cleanupAudio();
            if (data?.originator !== "local") {
                this.onReject?.(data?.message?.status_code ?? 0);
            }
            this.onTerminate?.();
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

    getRawSession(): any {
        return this.session;
    }

    getCallDuration(): number {
        if (!this.startedAt) return 0;
        return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    }

    async bye(): Promise<void> {
        this.session.terminate();
    }

    mute(): void { this.session.mute({ audio: true }); }
    unmute(): void { this.session.unmute({ audio: true }); }
    muteVideo(): void { this.session.mute({ video: true }); }
    unmuteVideo(): void { this.session.unmute({ video: true }); }

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
            const rawSession = (target as JsSIPSession).getRawSession();
            if (!rawSession) throw new Error("Cannot access raw session for attended transfer");
            this.session.refer(rawSession.remote_identity.uri.toString(), { replaces: rawSession });
        }
    }

    async setAudioOutput(deviceId: string): Promise<void> {
        if (!this.remoteElement) return;
        if (typeof (this.remoteElement as any).setSinkId === 'function') {
            await (this.remoteElement as any).setSinkId(deviceId);
        }
    }

    async setAudioInput(deviceId: string): Promise<void> {
        const pc = this.session.connection as RTCPeerConnection | undefined;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (!sender) return;
        const previousTrack = sender.track;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        const [newTrack] = stream.getAudioTracks();
        if (!newTrack) { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
        await sender.replaceTrack(newTrack);
        previousTrack?.stop();
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
        this.session.sendDTMF(tone);
    }

    async shareScreen(): Promise<void> {
        const pc = this.session.connection as RTCPeerConnection | undefined;
        if (!pc) throw new Error("No active peer connection");
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) throw new Error("No video sender available for screen sharing");
        const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
        const [track] = stream.getVideoTracks();
        if (!track) { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); throw new Error("No screen video track available"); }
        this.originalVideoTrack = sender.track ?? undefined;
        this.screenTrack = track;
        await sender.replaceTrack(track);
        track.onended = () => { this.stopScreenSharing().catch(() => {}); };
    }

    async stopScreenSharing(): Promise<void> {
        const pc = this.session.connection as RTCPeerConnection | undefined;
        if (!pc) return;
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && this.originalVideoTrack) {
            await sender.replaceTrack(this.originalVideoTrack);
        }
        this.screenTrack?.stop();
        this.screenTrack = undefined;
        this.originalVideoTrack = undefined;
    }

    async getStats(): Promise<CallStats> {
        const pc = this.session.connection as RTCPeerConnection | undefined;
        if (!pc) return { jitter: 0, packetLoss: 0, roundTripTime: 0, codec: '', bytesSent: 0, bytesReceived: 0 };
        return parseRTCStats(pc);
    }
}

export class JsSIPProvider implements ISipProvider {
    private ua?: any;
    private domain?: string;

    async register(
        credentials: SipCredentials,
        onUserAgent: ISipUserAgentDelegate,
        onRegister: ISipRegisterDelegate,
        _onSipLog?: (level: string, category: string, label: string, content: string) => void
    ): Promise<void> {
        const { domain, phone, secret, nameexten, server, iceServers, authorizationUsername } = credentials;

        if (!server) throw new Error("'server' (WebSocket URL) is required for the JsSIP provider.");

        this.domain = domain;
        const socket = new JsSIP.WebSocketInterface(server);
        const configuration = {
            sockets: [socket],
            uri: `sip:${phone}@${domain}`,
            authorization_user: authorizationUsername ?? phone,
            password: secret,
            display_name: nameexten ?? phone,
            register: true,
            pcConfig: iceServers ? { iceServers } : undefined
        };

        this.ua = new JsSIP.UA(configuration);

        this.ua.on("registered", (data: any) => { onRegister.onAccept?.(data); });
        this.ua.on("registrationFailed", (data: any) => { onRegister.onReject?.(data); });
        this.ua.on("connected", (data: any) => { onUserAgent.onConnect?.(data); });
        this.ua.on("disconnected", (data: any) => { onUserAgent.onDisconnect?.(data); });

        this.ua.on("newRTCSession", (data: any) => {
            if (data.originator === "remote") {
                const invitation = this.mapToInvitation(data.session);

                data.session.on("ended", () => { invitation.onTerminate?.(); });
                data.session.on("failed", () => { invitation.onTerminate?.(); });

                onUserAgent.onInvite?.(invitation);
            }
        });

        this.ua.on("newMessage", (data: any) => { onUserAgent.onMessage?.(data); });

        this.ua.start();
    }

    private resolveURI(destination: string): string {
        const withPrefix = ensureSipPrefix(destination);
        if (!withPrefix.includes('@') && this.domain) {
            return `sip:${destination.replace(/^sip:/i, '')}@${this.domain}`;
        }
        return withPrefix;
    }

    async call(options: CallOptions): Promise<ISipSession> {
        if (!this.ua) throw new Error("UA not initialized");

        const { destination, remoteElement, video, extraHeaders } = options;

        const session = this.ua.call(this.resolveURI(destination), {
            mediaConstraints: { audio: true, video: !!video },
            rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: !!video },
            extraHeaders: extraHeaders || []
        });

        const jsSipSession = new JsSIPSession(session);
        if (remoteElement) jsSipSession.setRemoteElement(remoteElement);

        return jsSipSession;
    }

    async answer(invitation: SipInvitation, options: AnswerOptions): Promise<ISipSession> {
        const { remoteElement, video, extraHeaders } = options;

        const rawSession = invitation.raw;
        rawSession.answer({
            mediaConstraints: { audio: true, video: !!video },
            extraHeaders: extraHeaders || []
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

    async sendMessage(destination: string, body: string): Promise<void> {
        if (!this.ua) throw new Error("UA not initialized");
        this.ua.sendMessage(this.resolveURI(destination), body);
    }

    private mapToInvitation(session: any): SipInvitation {
        return {
            remoteIdentity: {
                uri: { user: session.remote_identity.uri.user },
                displayName: session.remote_identity.display_name
            },
            accept: async (options) => { session.answer(options); },
            reject: async (options) => { session.terminate(options); },
            raw: session
        };
    }

    public getUA() { return this.ua; }
}
