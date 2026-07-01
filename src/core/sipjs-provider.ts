import { UserAgent, Registerer, RegistererRegisterOptions, UserAgentDelegate, Inviter, Session, Invitation, Messager, Web } from "sip.js";

// sip.js/lib/core is a deep subpath not exported via the package's exports map,
// so we declare the minimal shape we need rather than importing it directly.
interface OutgoingRequestDelegate {
    onAccept?: (response: any) => void;
    onProgress?: (response: any) => void;
    onRedirect?: (response: any) => void;
    onReject?: (response: any) => void;
    onTrying?: (response: any) => void;
}
import { ISipProvider, ISipSession, ISipUserAgentDelegate, ISipRegisterDelegate } from "./provider.js";
import { SipCredentials, CallOptions, SipInvitation, AnswerOptions, CallStats } from "./types.js";
import { handleStateChanges } from "./media.js";
import { ensureSipPrefix, parseRTCStats } from "./utils.js";


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
    private screenTrack?: MediaStreamTrack;
    private audioCtx?: AudioContext;
    private gainNode?: GainNode;
    private _muted = false;

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

    mute(): void { this._muted = true; this.toggleAudioTracks(false); }
    unmute(): void { this._muted = false; this.toggleAudioTracks(true); }
    muteVideo(): void { this.toggleVideoTracks(false); }
    unmuteVideo(): void { this.toggleVideoTracks(true); }

    private reinviteInProgress = false;

    // Asterisk (Pxtalk) mirrors the direction attribute in re-INVITE answers
    // instead of complementing it (RFC 3264 §6.1).  This means:
    //   offer sendonly  → answer sendonly  (wrong, should be recvonly)  → "Incompatible receive direction"
    //   offer recvonly  → answer recvonly  (wrong, should be sendonly)  → "Incompatible send direction"
    //   offer inactive  → answer inactive  (mirrors correctly, both agree nobody sends)
    // Using `inactive` is the only direction value Asterisk mirrors that is
    // self-consistent and that WebRTC accepts.  Hold music still plays from the
    // PBX's MOH source regardless of the direction negotiated here.
    private static holdSdpModifier = (desc: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
        if (!desc.sdp || desc.type !== 'offer') return Promise.resolve(desc);
        const sdp = desc.sdp
            .replace(/a=sendrecv\r\n/g, 'a=inactive\r\n')
            .replace(/a=sendonly\r\n/g, 'a=inactive\r\n')
            .replace(/a=recvonly\r\n/g, 'a=inactive\r\n');
        return Promise.resolve({ ...desc, sdp });
    };

    async hold(): Promise<void> {
        if (this.reinviteInProgress) return;
        this.reinviteInProgress = true;
        try {
            await (this.session as any).invite({
                sessionDescriptionHandlerModifiers: [SipJSSession.holdSdpModifier],
            });
            this.toggleAudioTracks(false);
            this.onHold?.();
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async unhold(): Promise<void> {
        if (this.reinviteInProgress) return;
        this.reinviteInProgress = true;
        try {
            await (this.session as any).invite({
                sessionDescriptionHandlerModifiers: [],
            });
            // Restore pre-hold mute state — don't re-enable tracks if the user
            // had muted before putting the call on hold.
            if (!this._muted) this.toggleAudioTracks(true);
            this.onUnhold?.();
        } finally {
            this.reinviteInProgress = false;
        }
    }

    async transfer(target: string | ISipSession): Promise<void> {
        if (typeof target === "string") {
            // Accept bare extensions ("5001"), "sip:5001", or full URIs.
            // Fall back to the remote party's domain so the proxy routes correctly.
            let raw = target.trim();
            if (!raw.startsWith("sip:") && !raw.startsWith("sips:")) raw = `sip:${raw}`;
            if (!raw.includes("@")) {
                const domain = this.session.remoteIdentity?.uri?.host ?? "";
                raw = `${raw}@${domain}`;
            }
            const uri = UserAgent.makeURI(raw);
            if (!uri) throw new Error(`Invalid transfer target URI: ${raw}`);
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
            if (!AudioCtx) {
                // Fallback: just set the element volume directly (0–1 range only)
                this.remoteElement.volume = Math.min(1, Math.max(0, volume));
                return;
            }
            this.audioCtx = new AudioCtx();
            const source = this.audioCtx.createMediaElementSource(this.remoteElement);
            this.gainNode = this.audioCtx.createGain();
            source.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
        }
        // Resume the context — browsers suspend it until a user-gesture triggers audio
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
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
        const pc = this.getPeerConnection();
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
            authorizationUsername,
        } = credentials;

        this.domain = domain;

        const uri = UserAgent.makeURI(`sip:${phone}@${domain}`);
        if (!uri) throw new Error("Invalid SIP URI");

        const userAgentDelegate: UserAgentDelegate = {
            onConnect: onUserAgent.onConnect,
            onDisconnect: onUserAgent.onDisconnect,
            onInvite: (invitation: Invitation) => {
                console.log(`[easy-sipjs][1] SipJSProvider.onInvite fired — state=${invitation.state} from=${invitation.remoteIdentity?.uri?.toString()}`);
                if (onUserAgent.onInvite) {
                    const sipInvitation = this.mapToInvitation(invitation);

                    // Send 180 Ringing immediately so the calling side knows the phone is alerting.
                    // Without this, the INVITE may be CANCELed by the far end before the app answers.
                    invitation.progress().catch((e) => {
                        console.warn('[easy-sipjs][1] progress() rejected:', e);
                    });

                    invitation.stateChange.addListener((state) => {
                        console.log(`[easy-sipjs][1] invitation.stateChange → ${state}`);
                        if (state === "Terminated" && sipInvitation.onTerminate) {
                            sipInvitation.onTerminate();
                        }
                    });

                    console.log('[easy-sipjs][1] calling onUserAgent.onInvite(sipInvitation)');
                    onUserAgent.onInvite(sipInvitation);
                } else {
                    console.warn('[easy-sipjs][1] onUserAgent.onInvite is NOT set — invite dropped here');
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
            authorizationUsername: authorizationUsername ?? phone,
            authorizationPassword: secret,
            uri,
            // Use the phone number as the Contact user part and the SIP domain as
            // the host so the registered contact becomes sip:<phone>@<domain> instead
            // of the SIP.js default sip:<random>@<random>.invalid.  Pxtalk (Kamailio)
            // preserves the domain in the x-ast-orig-host parameter it passes to
            // Asterisk, which is then used to route incoming INVITEs back through the
            // correct WebSocket connection.
            contactName: phone,
            viaHost: domain,
            transportOptions: { server, traceSip: debug },
            userAgentString,
            contactParams: { transport: "wss" },
            delegate: userAgentDelegate,
            logLevel: debug ? "log" : "error",
            logConnector: debug
                ? (level: string, category: string, label: string | undefined, content: string) => {
                    onSipLog?.(level, category, label || "", content);
                }
                : undefined,
            sessionDescriptionHandlerFactoryOptions: iceServers ? {
                peerConnectionConfiguration: { iceServers }
            } : undefined
        });

        // Publish the real SIP URI as the Contact so the proxy can route
        // incoming INVITEs back to this WebSocket connection.
        this.userAgent.contact.pubGruu = uri;
        this.userAgent.contact.tempGruu = uri;

        await this.userAgent.start();

        // Pxtalk 16 (and some other proxies) send SIP responses where the
        // Content-Length header is larger than the actual body (they modify ICE
        // lines in transit without recalculating the length).  SIP.js drops any
        // message whose body is shorter than Content-Length, leaving re-INVITEs
        // (hold/unhold) permanently pending.  Patch the transport right after
        // start() so every incoming message has its Content-Length corrected
        // before SIP.js parses it.
        const transport = (this.userAgent as any).transport;
        if (transport && typeof transport.onMessage === 'function') {
            const origOnMessage = transport.onMessage.bind(transport);
            transport.onMessage = (raw: string) => {
                const sep = raw.indexOf('\r\n\r\n');
                if (sep !== -1) {
                    const body = raw.slice(sep + 4);
                    const actualBodyLen = new TextEncoder().encode(body).length;
                    const patched = raw.replace(/Content-Length:\s*\d+\r\n/i, `Content-Length: ${actualBodyLen}\r\n`);
                    origOnMessage(patched);
                } else {
                    origOnMessage(raw);
                }
            };
        }

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
