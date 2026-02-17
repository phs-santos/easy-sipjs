import { useEffect, useRef, useState } from "react";
import { SipClient, Invitation } from "easy-sipjs";
import { ConnectionState, Chapter, LogEntry, ManagedSession, Credentials } from "./types";

// Componentes Modularizados
import { Sidebar } from "./components/Sidebar";
import { IntroChapter } from "./components/IntroChapter";
import { ConfigChapter } from "./components/ConfigChapter";
import { RegisterChapter } from "./components/RegisterChapter";
import { CallChapter } from "./components/CallChapter";
import { DebugChapter } from "./components/DebugChapter";

/**
 * App Maestro (Orchestrator)
 * 
 * Este é o componente principal que gerencia o estado global e a integração
 * direta com o SipClient da biblioteca easy-sipjs. 
 * 
 * Responsabilidade:
 * 1. Gerenciamento de Estado (Sessões, Credenciais, Logs, Conexão).
 * 2. Orquestração da biblioteca easy-sipjs.
 * 3. Composição da UI modular.
 */
export default function App() {
	// UI State
	const [currentChapter, setCurrentChapter] = useState<Chapter>("intro");
	const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
	const [logs, setLogs] = useState<LogEntry[]>([]);

	// SIP Core State
	const [sipClient, setSipClient] = useState<SipClient | null>(null);
	const [callActive, setCallActive] = useState(false);
	const [incomingInvitation, setIncomingInvitation] = useState<Invitation | null>(null);
	const [isMuted, setIsMuted] = useState(false);
	const [isMutedVideo, setIsMutedVideo] = useState(false);
	const [isOnHold, setIsOnHold] = useState(false);

	// Multi-call and Session Management
	const [sessions, setSessions] = useState<ManagedSession[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const sessionRefs = useRef<Map<string, any>>(new Map());

	// User Data
	const [credentials, setCredentials] = useState<Credentials>({
		domain: import.meta.env.VITE_SIP_DOMAIN || "",
		phone: import.meta.env.VITE_SIP_PHONE || "",
		secret: import.meta.env.VITE_SIP_SECRET || "",
		server: import.meta.env.VITE_SIP_SERVER || ""
	});
	const [destination, setDestination] = useState(import.meta.env.VITE_SIP_DESTINATION || "");

	// HTML Media Elements & Master Refs (Persistent)
	const masterRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
	const masterLocalVideoRef = useRef<HTMLVideoElement | null>(null);
	const logsEndRef = useRef<HTMLDivElement | null>(null);

	// --- Logger Logic ---
	const addLog = (message: string, type: LogEntry['type'] = 'info') => {
		setLogs(prev => [...prev, {
			time: new Date().toLocaleTimeString(),
			message,
			type
		}]);
	};

	const clearLogs = () => setLogs([]);

	useEffect(() => {
		logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logs]);

	// --- SIP Actions (Integration) ---

	/**
	 * Handle Registration
	 * Utiliza o SipClient para conectar ao WebSocket e registrar o ramal.
	 */
	const handleRegister = async () => {
		try {
			if (sipClient) await sipClient.unregister();
			setConnectionState("connecting");
			addLog("Iniciando registro...", 'info');

			const client = new SipClient({
				domain: credentials.domain,
				phone: credentials.phone,
				secret: credentials.secret,
				nameexten: credentials.phone,
				server: credentials.server
			});

			// Captura de Logs SIP brutos para o Debugger
			client.onSipLog = (level, category, label, content) => {
				if (category === "sip.Transport") {
					addLog(content, content.startsWith("Sending") ? 'sip-out' : 'sip-in');
				} else if (category === "sip.UserAgent" || category === "sip.Registerer") {
					addLog(`[${category}] ${content}`, 'ws');
				}
			};

			client.onUserAgent.onConnect = () => addLog("WebSocket conectado", 'ws');
			client.onUserAgent.onInvite = (invitation: Invitation) => {
				addLog(`Chamada recebida de: ${invitation.remoteIdentity.uri.user}`, 'info');
				setIncomingInvitation(invitation);
				invitation.stateChange.addListener(s => { if (s === 'Terminated') setIncomingInvitation(null); });
			};

			await client.register();
			client.onRegister.onAccept = () => {
				addLog("Registro aceito", 'info');
				setConnectionState("registered");
				setCurrentChapter("calls"); // Avança para o playground automaticamente
			};
			client.onRegister.onReject = () => {
				addLog("Registro rejeitado", 'error');
				setConnectionState("error");
			};
			setSipClient(client);
		} catch (error) {
			addLog(`Erro crítico no registro: ${error}`, 'error');
			setConnectionState("error");
		}
	};

	/**
	 * Handle Call
	 * Inicia uma nova sessão de chamada e gerencia o hold automático de outras sessões.
	 */
	const handleCall = async (options?: { withVideo?: boolean }) => {
		if (!sipClient || !masterRemoteVideoRef.current) return;
		try {
			const video = options?.withVideo || false;
			const dest = `sip:${destination}@${credentials.domain}`;
			const session = await sipClient.call({
				destination: dest,
				video,
				remoteElement: masterRemoteVideoRef.current,
				localElement: video ? masterLocalVideoRef.current || undefined : undefined
			});

			const sid = Math.random().toString(36).substr(2, 9);
			sessionRefs.current.set(sid, session);

			// AUTO-HOLD: Coloca todas as outras chamadas em espera ao iniciar uma nova
			for (const [id, s] of sessionRefs.current.entries()) {
				if (id !== sid) try { await s.hold(); } catch (e) { }
			}

			setSessions(prev => [
				...prev.map(s => ({ ...s, status: 'on-hold' as const })),
				{ id: sid, remoteUser: destination, status: 'calling' }
			]);
			setActiveSessionId(sid);
			setCallActive(true);
			setConnectionState("in-call");

			session.onTerminate = () => {
				addLog(`Chamada com ${destination} encerrada`, 'info');
				sessionRefs.current.delete(sid);
				setSessions(prev => {
					const next = prev.filter(s => s.id !== sid);
					if (next.length === 0) {
						setCallActive(false);
						setConnectionState("registered");
						setActiveSessionId(null);
					} else {
						setActiveSessionId(curr => (curr === sid ? next[0].id : curr));
					}
					return next;
				});
			};
		} catch (error) {
			addLog(`Falha ao iniciar chamada: ${error}`, 'error');
		}
	};

	/**
	 * Handle Answer
	 * Aceita uma chamada recebida (Invitation).
	 */
	const handleAnswer = async (options?: { withVideo?: boolean }) => {
		if (!sipClient || !incomingInvitation || !masterRemoteVideoRef.current) return;
		try {
			const user = incomingInvitation.remoteIdentity.uri.user || "Unknown";
			const video = options?.withVideo || false;
			const session = await sipClient.answer(incomingInvitation, {
				remoteElement: masterRemoteVideoRef.current,
				localElement: video ? masterLocalVideoRef.current || undefined : undefined,
				video
			});
			const sid = Math.random().toString(36).substr(2, 9);
			sessionRefs.current.set(sid, session);

			// AUTO-HOLD: Garante privacidade ao atender uma nova linha
			for (const [id, s] of sessionRefs.current.entries()) {
				if (id !== sid) try { await s.hold(); } catch (e) { }
			}

			setSessions(prev => [
				...prev.map(s => ({ ...s, status: 'on-hold' as const })),
				{ id: sid, remoteUser: user, status: 'active' }
			]);
			setActiveSessionId(sid);
			setCallActive(true);
			setConnectionState("in-call");
			setIncomingInvitation(null);

			session.onTerminate = () => {
				sessionRefs.current.delete(sid);
				setSessions(prev => {
					const next = prev.filter(s => s.id !== sid);
					if (next.length === 0) {
						setCallActive(false);
						setConnectionState("registered");
						setActiveSessionId(null);
					} else {
						setActiveSessionId(curr => (curr === sid ? next[0].id : curr));
					}
					return next;
				});
			};
		} catch (error) {
			addLog("Erro ao atender chamada", 'error');
		}
	};

	const handleHangup = async () => {
		const active = activeSessionId ? sessionRefs.current.get(activeSessionId) : null;
		if (active) await active.bye();
	};

	/**
	 * Multi-Call Switcher
	 * Alterna entre chamadas ativas colocando a atual em HOLD e a destino em UNHOLD.
	 */
	const switchSession = async (sid: string) => {
		if (sid === activeSessionId) return;
		try {
			if (activeSessionId) {
				const curr = sessionRefs.current.get(activeSessionId);
				if (curr) await curr.hold();
			}
			const target = sessionRefs.current.get(sid);
			if (target) await target.unhold();

			setSessions(prev => prev.map(s => {
				if (s.id === sid) return { ...s, status: 'active' };
				if (s.id === activeSessionId) return { ...s, status: 'on-hold' };
				return s;
			}));
			setActiveSessionId(sid);
			setIsOnHold(false);
		} catch (e) { addLog("Erro ao alternar sessões", 'error'); }
	};

	const handleMute = () => {
		const active = activeSessionId ? sessionRefs.current.get(activeSessionId) : null;
		if (active) {
			if (isMuted) active.unmute(); else active.mute();
			setIsMuted(!isMuted);
		}
	};

	const handleMuteVideo = () => {
		const active = activeSessionId ? sessionRefs.current.get(activeSessionId) : null;
		if (active) {
			if (isMutedVideo) active.unmuteVideo(); else active.muteVideo();
			setIsMutedVideo(!isMutedVideo);
		}
	};

	const handleHold = async () => {
		const active = activeSessionId ? sessionRefs.current.get(activeSessionId) : null;
		if (active) {
			try {
				if (isOnHold) await active.unhold(); else await active.hold();
				setIsOnHold(!isOnHold);
				setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, status: isOnHold ? 'active' : 'on-hold' } : s));
			} catch (e) { addLog("Erro ao alterar espera", 'error'); }
		}
	};

	// --- Template Composition ---

	return (
		<div className="h-screen bg-[#1e1f29] text-[#f8f8f2] flex overflow-hidden selection:bg-[#bd93f9]/30 font-sans">
			<Sidebar
				currentChapter={currentChapter}
				setCurrentChapter={setCurrentChapter}
				connectionState={connectionState}
			/>

			<main className="flex-1 flex flex-col min-w-0 bg-[#282a36]/30">
				<div className="flex-1 overflow-y-auto p-12 scrollbar-thin scrollbar-thumb-[#44475a]">
					<div className="mx-auto space-y-12">
						{currentChapter === "intro" && (
							<IntroChapter onStart={setCurrentChapter} />
						)}

						{currentChapter === "config" && (
							<ConfigChapter
								credentials={credentials}
								setCredentials={setCredentials}
								onNext={setCurrentChapter}
							/>
						)}

						{currentChapter === "register" && (
							<RegisterChapter
								connectionState={connectionState}
								onRegister={handleRegister}
							/>
						)}

						{currentChapter === "calls" && (
							<CallChapter
								connectionState={connectionState}
								destination={destination}
								setDestination={setDestination}
								handleCall={handleCall}
								handleHangup={handleHangup}
								callActive={callActive}
								incomingInvitation={incomingInvitation}
								handleAnswer={handleAnswer}
								masterRemoteVideoRef={masterRemoteVideoRef}
								masterLocalVideoRef={masterLocalVideoRef}
								sessions={sessions}
								activeSessionId={activeSessionId}
								switchSession={switchSession}
								isMuted={isMuted}
								isMutedVideo={isMutedVideo}
								isOnHold={isOnHold}
								onMute={handleMute}
								onMuteVideo={handleMuteVideo}
								onHold={handleHold}
							/>
						)}

						{currentChapter === "debug" && (
							<DebugChapter
								logs={logs}
								clearLogs={clearLogs}
								logsEndRef={logsEndRef}
							/>
						)}
					</div>
				</div>

				<footer className="px-16 py-8 border-t border-[#44475a]/30 flex items-center justify-between text-[11px] font-bold text-[#6272a4] uppercase tracking-[0.3em] bg-[#21222c]">
					<div className="flex items-center gap-3">
						<span className="w-2 h-2 rounded-full bg-[#50fa7b] shadow-[0_0_8px_#50fa7b]" />
						© phs-santos | laboratory engine v1.2
					</div>
					<div className="flex gap-8">
						<span className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">Documentation</span>
						<span className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">GitHub Source</span>
						<span className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">PBX Spec</span>
					</div>
				</footer>
			</main>

			{/* Master Media Elements (Hidden, used for SIP connection persistence) */}
			<video ref={masterRemoteVideoRef} autoPlay style={{ display: 'none' }} />
			<video ref={masterLocalVideoRef} autoPlay muted style={{ display: 'none' }} />
		</div>
	);
}
