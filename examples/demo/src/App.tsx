import { useEffect, useRef, useState } from "react";
import { Chapter, Credentials } from "./types";

// Componentes Modularizados
import { Sidebar } from "./components/Sidebar";
import { IntroChapter } from "./components/IntroChapter";
import { ConfigChapter } from "./components/ConfigChapter";
import { RegisterChapter } from "./components/RegisterChapter";
import { CallChapter } from "./components/CallChapter";
import { DebugChapter } from "./components/DebugChapter";

// Hooks & Services
import { useSip } from "./services/useSip";

export default function App() {
	// UI State
	const [currentChapter, setCurrentChapter] = useState<Chapter>("intro");

	// SIP State & Actions (De-coupled Service)
	const {
		state, logs, sessions, activeSessionId, incomingInvitation,
		isMuted, isMutedVideo, isOnHold, callActive,
		register, call, answer, hangup, switchSession,
		mute, muteVideo, hold, clearLogs
	} = useSip();

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

	// --- Logger Auto-Scroll ---
	useEffect(() => {
		logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logs]);

	// --- SIP Actions (Integration) ---

	const handleRegister = async () => {
		await register(credentials);
		// Auto-advance if registered successfully (via side effect of state change)
	};

	useEffect(() => {
		if (state === 'registered' && currentChapter === 'register') {
			setCurrentChapter("calls");
		}
	}, [state, currentChapter]);

	const handleCall = async (options?: { withVideo?: boolean }) => {
		if (!masterRemoteVideoRef.current) return;
		await call(destination, credentials.domain, masterRemoteVideoRef.current, masterLocalVideoRef.current || undefined, options);
	};

	const handleAnswer = async (options?: { withVideo?: boolean }) => {
		if (!incomingInvitation || !masterRemoteVideoRef.current) return;
		await answer(incomingInvitation, masterRemoteVideoRef.current, masterLocalVideoRef.current || undefined, options);
	};

	// --- Template Composition ---

	return (
		<div className="h-screen bg-[#1e1f29] text-[#f8f8f2] flex overflow-hidden selection:bg-[#bd93f9]/30 font-sans">
			<Sidebar
				currentChapter={currentChapter}
				setCurrentChapter={setCurrentChapter}
				connectionState={state}
			/>

			<main className="flex-1 flex flex-col min-w-0 bg-[#282a36]/30">
				<div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-[#44475a]">
					<div className="mx-auto space-y-6">
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
								connectionState={state}
								onRegister={handleRegister}
							/>
						)}

						{currentChapter === "calls" && (
							<CallChapter
								connectionState={state}
								destination={destination}
								setDestination={setDestination}
								handleCall={handleCall}
								handleHangup={hangup}
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
								onMute={mute}
								onMuteVideo={muteVideo}
								onHold={hold}
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

				<footer className="px-16 py-6 border-t border-[#44475a]/30 flex items-center justify-between text-[11px] font-bold text-[#6272a4] uppercase tracking-[0.3em] bg-[#21222c]">
					<div className="flex items-center gap-3">
						<span className="w-2 h-2 rounded-full bg-[#50fa7b] shadow-[0_0_8px_#50fa7b]" />
						© phs-santos | laboratory engine v2.0
					</div>
					<div className="flex gap-8">
						<a href="https://github.com/phs-santos" target="_blank" rel="noopener noreferrer" className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">Autor</a>
						<a href="https://github.com/phs-santos/easy-sipjs" target="_blank" rel="noopener noreferrer" className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">Código Fonte</a>
						{/* <a href="https://phs-santos.github.io/easy-sipjs/" target="_blank" rel="noopener noreferrer" className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">Documentação</a> */}
						{/* <span className="hover:text-[#bd93f9] cursor-pointer transition-colors border-b border-transparent hover:border-[#bd93f9]">PBX Spec</span> */}
					</div>
				</footer>
			</main>

			{/* Master Media Elements (Hidden, used for SIP connection persistence) */}
			<video ref={masterRemoteVideoRef} autoPlay style={{ display: 'none' }} />
			<video ref={masterLocalVideoRef} autoPlay muted style={{ display: 'none' }} />
		</div>
	);
}
