import { SipClient, Invitation, ISipSession } from "easy-sipjs";
import { ConnectionState, LogEntry, ManagedSession, Credentials } from "../types";

export type SipServiceListener = () => void;

class EasySipService {
    private client: SipClient | null = null;
    private state: ConnectionState = "idle";
    private logs: LogEntry[] = [];
    private sessions: ManagedSession[] = [];
    private activeSessionId: string | null = null;
    private incomingInvitation: Invitation | null = null;
    private sessionMap = new Map<string, ISipSession>();
    private listeners = new Set<SipServiceListener>();
    private audioDevices: MediaDeviceInfo[] = [];
    private selectedOutputDeviceId: string = 'default';

    // Media properties
    public isMuted = false;
    public isMutedVideo = false;
    public isOnHold = false;

    // --- State Management ---

    private notify() {
        this.listeners.forEach(l => l());
    }

    public subscribe(listener: SipServiceListener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public getState() {
        return {
            state: this.state,
            logs: this.logs,
            sessions: this.sessions,
            activeSessionId: this.activeSessionId,
            incomingInvitation: this.incomingInvitation,
            isMuted: this.isMuted,
            isMutedVideo: this.isMutedVideo,
            isOnHold: this.isOnHold,
            audioDevices: this.audioDevices,
            selectedOutputDeviceId: this.selectedOutputDeviceId,
            callActive: this.sessions.length > 0
        };
    }

    private addLog(message: string, type: LogEntry['type'] = 'info') {
        this.logs = [...this.logs, {
            time: new Date().toLocaleTimeString(),
            message,
            type
        }];
        this.notify();
    }

    public clearLogs() {
        this.logs = [];
        this.notify();
    }

    // --- SIP Actions ---

    public async register(credentials: Credentials) {
        try {
            if (this.client) await this.client.unregister();

            this.state = "connecting";
            this.addLog("Iniciando registro...", 'info');

            this.client = new SipClient({
                domain: credentials.domain,
                phone: credentials.phone,
                secret: credentials.secret,
                nameexten: credentials.phone,
                server: credentials.server
            });

            this.client.onSipLog = (level, category, label, content) => {
                if (category === "sip.Transport") {
                    this.addLog(content, content.startsWith("Sending") ? 'sip-out' : 'sip-in');
                } else if (category === "sip.UserAgent" || category === "sip.Registerer") {
                    this.addLog(`[${category}] ${content}`, 'ws');
                }
            };

            this.client.onUserAgent.onConnect = () => this.addLog("WebSocket conectado", 'ws');
            this.client.onUserAgent.onInvite = (invitation: Invitation) => {
                this.addLog(`Chamada recebida de: ${invitation.remoteIdentity.uri.user}`, 'info');
                this.incomingInvitation = invitation;

                invitation.stateChange.addListener(s => {
                    if (s === 'Terminated') {
                        this.incomingInvitation = null;
                        this.notify();
                    }
                });
                this.notify();
            };

            await this.client.register();

            this.client.onRegister.onAccept = () => {
                this.addLog("Registro aceito", 'info');
                this.state = "registered";
                this.notify();
            };

            this.client.onRegister.onReject = () => {
                this.addLog("Registro rejeitado", 'error');
                this.state = "error";
                this.notify();
            };

        } catch (error) {
            this.addLog(`Erro crítico no registro: ${error}`, 'error');
            this.state = "error";
            this.notify();
        }
    }

    public async call(destination: string, domain: string, remoteElement: HTMLVideoElement, localElement?: HTMLVideoElement, options?: { withVideo?: boolean }) {
        if (!this.client) return;
        try {
            const video = options?.withVideo || false;
            const dest = `sip:${destination}@${domain}`;
            const session = await this.client.call({
                destination: dest,
                video,
                remoteElement,
                localElement
            });

            const sid = Math.random().toString(36).substr(2, 9);
            this.sessionMap.set(sid, session);

            // AUTO-HOLD
            for (const [id, s] of this.sessionMap.entries()) {
                if (id !== sid) try { await s.hold(); } catch (e) { }
            }

            this.sessions = [
                ...this.sessions.map(s => ({ ...s, status: 'on-hold' as const })),
                { id: sid, remoteUser: destination, status: 'calling', withVideo: video, dtmfHistory: [] }
            ];
            this.activeSessionId = sid;
            this.state = "in-call";
            this.notify();

            session.onTerminate = () => {
                this.addLog(`Chamada com ${destination} encerrada`, 'info');
                this.sessionMap.delete(sid);
                this.updateSessionsAfterTerminate(sid);
            };

            session.onDTMF = (tone) => {
                this.addLog(`DTMF Recebido na sessão ${sid}: ${tone}`, 'info');
                this.sessions = this.sessions.map(s =>
                    s.id === sid ? { ...s, dtmfHistory: [...s.dtmfHistory, tone].slice(-10) } : s
                );
                this.notify();
            };
        } catch (error) {
            this.addLog(`Falha ao iniciar chamada: ${error}`, 'error');
        }
    }

    public async answer(invitation: Invitation, remoteElement: HTMLVideoElement, localElement?: HTMLVideoElement, options?: { withVideo?: boolean }) {
        if (!this.client) return;
        try {
            const user = invitation.remoteIdentity.uri.user || "Unknown";
            const video = options?.withVideo || false;
            const session = await this.client.answer(invitation, {
                remoteElement,
                localElement,
                video
            });
            const sid = Math.random().toString(36).substr(2, 9);
            this.sessionMap.set(sid, session);

            // AUTO-HOLD
            for (const [id, s] of this.sessionMap.entries()) {
                if (id !== sid) try { await s.hold(); } catch (e) { }
            }

            this.sessions = [
                ...this.sessions.map(s => ({ ...s, status: 'on-hold' as const })),
                { id: sid, remoteUser: user, status: 'active', withVideo: video, dtmfHistory: [] }
            ];
            this.activeSessionId = sid;
            this.state = "in-call";
            this.incomingInvitation = null;
            this.notify();

            session.onTerminate = () => {
                this.sessionMap.delete(sid);
                this.updateSessionsAfterTerminate(sid);
            };

            session.onDTMF = (tone) => {
                this.addLog(`DTMF Recebido na sessão ${sid}: ${tone}`, 'info');
                this.sessions = this.sessions.map(s =>
                    s.id === sid ? { ...s, dtmfHistory: [...s.dtmfHistory, tone].slice(-10) } : s
                );
                this.notify();
            };
        } catch (error) {
            this.addLog("Erro ao atender chamada", 'error');
        }
    }

    public async sendDTMF(tone: string) {
        if (this.activeSessionId) {
            const session = this.sessionMap.get(this.activeSessionId);
            if (session) {
                this.addLog(`Enviando DTMF: ${tone}`, 'info');
                await session.sendDTMF(tone);
            }
        }
    }

    public async setAudioOutputDevice(deviceId: string) {
        this.selectedOutputDeviceId = deviceId;
        this.addLog(`Saída de áudio alterada para: ${deviceId}`, 'info');

        // Aplica à sessão ativa se houver
        if (this.activeSessionId) {
            const session = this.sessionMap.get(this.activeSessionId);
            if (session) await session.setAudioOutput(deviceId);
        }
        this.notify();
    }

    public async refreshAudioDevices() {
        try {
            // Solicita permissão primeiro para garantir que os labels apareçam
            await navigator.mediaDevices.getUserMedia({ audio: true });

            const devices = await navigator.mediaDevices.enumerateDevices();
            this.audioDevices = devices.filter(d => d.kind === 'audiooutput');
            this.notify();
        } catch (e) {
            this.addLog("Não foi possível listar dispositivos de áudio", 'error');
        }
    }

    private updateSessionsAfterTerminate(sid: string) {
        this.sessions = this.sessions.filter(s => s.id !== sid);
        if (this.sessions.length === 0) {
            this.state = "registered";
            this.activeSessionId = null;
        } else {
            this.activeSessionId = this.activeSessionId === sid ? this.sessions[0].id : this.activeSessionId;
        }
        this.notify();
    }

    public async hangup() {
        const active = this.activeSessionId ? this.sessionMap.get(this.activeSessionId) : null;
        if (active) await active.bye();
    }

    public async switchSession(sid: string) {
        if (sid === this.activeSessionId) return;
        try {
            if (this.activeSessionId) {
                const curr = this.sessionMap.get(this.activeSessionId);
                if (curr) await curr.hold();
            }
            const target = this.sessionMap.get(sid);
            if (target) await target.unhold();

            this.sessions = this.sessions.map(s => {
                if (s.id === sid) return { ...s, status: 'active' };
                if (s.id === this.activeSessionId) return { ...s, status: 'on-hold' };
                return s;
            });
            this.activeSessionId = sid;
            this.isOnHold = false;
            this.notify();
        } catch (e) {
            this.addLog("Erro ao alternar sessões", 'error');
        }
    }

    public mute() {
        const active = this.activeSessionId ? this.sessionMap.get(this.activeSessionId) : null;
        if (active) {
            if (this.isMuted) active.unmute(); else active.mute();
            this.isMuted = !this.isMuted;
            this.notify();
        }
    }

    public muteVideo() {
        const active = this.activeSessionId ? this.sessionMap.get(this.activeSessionId) : null;
        if (active) {
            if (this.isMutedVideo) active.unmuteVideo(); else active.muteVideo();
            this.isMutedVideo = !this.isMutedVideo;
            this.notify();
        }
    }

    public async hold() {
        const active = this.activeSessionId ? this.sessionMap.get(this.activeSessionId) : null;
        if (active) {
            try {
                if (this.isOnHold) await active.unhold(); else await active.hold();
                this.isOnHold = !this.isOnHold;
                this.sessions = this.sessions.map(s => s.id === this.activeSessionId ? { ...s, status: this.isOnHold ? 'on-hold' : 'active' } : s);
                this.notify();
            } catch (e) {
                this.addLog("Erro ao alterar espera", 'error');
            }
        }
    }
}

export const easySipService = new EasySipService();
