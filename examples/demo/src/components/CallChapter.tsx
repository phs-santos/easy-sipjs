import React from 'react';
import { ConnectionState, ManagedSession } from '../types';
import { Invitation, SipClient } from 'easy-sipjs';

interface CallChapterProps {
    connectionState: ConnectionState;
    destination: string;
    setDestination: (dest: string) => void;
    handleCall: (options?: { withVideo?: boolean }) => void;
    handleHangup: () => void;
    callActive: boolean;
    incomingInvitation: Invitation | null;
    handleAnswer: (options?: { withVideo?: boolean }) => void;
    masterRemoteVideoRef: React.RefObject<HTMLVideoElement>;
    masterLocalVideoRef: React.RefObject<HTMLVideoElement>;
    sessions: ManagedSession[];
    activeSessionId: string | null;
    switchSession: (sid: string) => void;
    isMuted: boolean;
    isMutedVideo: boolean;
    isOnHold: boolean;
    onMute: () => void;
    onMuteVideo: () => void;
    onHold: () => void;
}

/**
 * CallChapter Component (Playground)
 * 
 * Responsabilidades:
 * 1. Interface de discagem (Dial Pad).
 * 2. Gestão de chamadas entrantes.
 * 3. Gerenciamento de múltiplas sessões (Multi-call).
 * 4. Controles de mídia (Mute/Hold).
 * 
 * Integração:
 * - O método `call()` inicia uma nova sessão.
 * - O método `answer()` aceita um Invitation.
 * - Múltiplas sessões são gerenciadas através de um Array, onde o desenvolvedor
 *   coordena qual sessão está ativa e quais estão em espera (`hold()`).
 */
import { useSip } from '../services/useSip';

export const CallChapter: React.FC<CallChapterProps> = ({
    connectionState, destination, setDestination, handleCall, handleHangup,
    callActive, incomingInvitation, handleAnswer, masterRemoteVideoRef, masterLocalVideoRef,
    sessions, activeSessionId, switchSession, isMuted, isMutedVideo, isOnHold, onMute, onMuteVideo, onHold
}) => {
    const { audioDevices, selectedOutputDeviceId, refreshAudioDevices, setAudioOutputDevice } = useSip();
    const activeSession = sessions.find(s => s.id === activeSessionId);

    const viewRemoteRef = React.useRef<HTMLVideoElement>(null);
    const viewLocalRef = React.useRef<HTMLVideoElement>(null);

    // Mirror streams from master elements to chapter views
    React.useEffect(() => {
        const sync = () => {
            if (viewRemoteRef.current && masterRemoteVideoRef.current) {
                if (viewRemoteRef.current.srcObject !== masterRemoteVideoRef.current.srcObject) {
                    viewRemoteRef.current.srcObject = masterRemoteVideoRef.current.srcObject;
                }
            }
            if (viewLocalRef.current && masterLocalVideoRef.current) {
                if (viewLocalRef.current.srcObject !== masterLocalVideoRef.current.srcObject) {
                    viewLocalRef.current.srcObject = masterLocalVideoRef.current.srcObject;
                }
            }
        };

        const interval = setInterval(sync, 500);
        sync();
        return () => clearInterval(interval);
    }, [callActive, masterRemoteVideoRef, masterLocalVideoRef]);

    React.useEffect(() => {
        if (callActive) refreshAudioDevices();
    }, [callActive]);

    const incomingHasVideo = incomingInvitation ? ((SipClient as any).isVideoCall?.(incomingInvitation) || false) : false;

    return (
        <section className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-2">
                <span className="text-[#8be9fd] font-bold uppercase tracking-[0.2em] text-xs">Capítulo 4</span>
                <h2 className="text-5xl font-black tracking-tight leading-none">Dialogo em <span className="text-[#ff79c6]">Tempo Real</span></h2>
                <p className="text-[#6272a4] text-lg font-light">Chamadas, Mute e Gestão Multi-Sessão. O Playground definitivo para seu ramal.</p>
            </div>

            <div className="grid grid-cols-12 gap-8">
                {/* Dial Pad Area */}
                <div className="col-span-12 lg:col-span-5 bg-[#1e1f29] rounded-[2.5rem] p-10 border border-[#6272a4]/20 shadow-2xl space-y-8 self-start">
                    <div className="bg-[#282a36] rounded-3xl p-6 border border-[#6272a4]/30 shadow-inner group">
                        <label className="text-[9px] text-[#6272a4] uppercase font-black block mb-3 tracking-[0.3em] text-center group-hover:text-[#8be9fd] transition-colors">Discar Para</label>
                        <input
                            className="w-full bg-transparent text-5xl text-center font-black text-[#f8f8f2] outline-none placeholder:text-[#44475a]"
                            value={destination}
                            onChange={e => setDestination(e.target.value)}
                            placeholder="200"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => handleCall()}
                            disabled={connectionState !== 'registered' && connectionState !== 'in-call'}
                            className="bg-[#bd93f9] text-[#282a36] font-black py-6 rounded-[1.5rem] shadow-xl shadow-[#bd93f9]/20 transition-all hover:scale-[1.03] active:scale-95 disabled:grayscale text-xs uppercase tracking-widest"
                        >
                            ÁUDIO 🔊
                        </button>
                        <button
                            onClick={() => handleCall({ withVideo: true })}
                            disabled={connectionState !== 'registered' && connectionState !== 'in-call'}
                            className="bg-[#ff79c6] text-[#282a36] font-black py-6 rounded-[1.5rem] shadow-xl shadow-[#ff79c6]/20 transition-all hover:scale-[1.03] active:scale-95 disabled:grayscale text-xs uppercase tracking-widest"
                        >
                            VÍDEO 📹
                        </button>
                        {callActive && (
                            <button
                                onClick={handleHangup}
                                className="col-span-2 bg-[#ff5555] text-white font-black py-6 rounded-[1.5rem] shadow-xl shadow-[#ff5555]/30 transition-all hover:scale-[1.03] active:scale-95 text-sm uppercase tracking-widest"
                            >
                                ENCERRAR 🛑
                            </button>
                        )}
                    </div>

                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[9px] text-[#6272a4] uppercase font-black tracking-widest">Saída de Áudio</label>
                            <button onClick={() => refreshAudioDevices()} className="text-[8px] text-[#bd93f9] hover:underline font-bold uppercase transition-all">Refresh 🔄</button>
                        </div>
                        <select
                            className="w-full bg-[#282a36] border border-[#6272a4]/30 rounded-xl px-4 py-3 text-[11px] text-[#f8f8f2] outline-none focus:border-[#bd93f9] shadow-inner appearance-none cursor-pointer"
                            value={selectedOutputDeviceId}
                            onChange={(e) => setAudioOutputDevice(e.target.value)}
                        >
                            <option value="default">Alto-falante Padrão</option>
                            {audioDevices.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.substring(0, 5)}`}</option>
                            ))}
                        </select>
                    </div>

                    <div className="bg-[#282a36]/50 p-6 rounded-2xl font-mono text-[11px] text-[#6272a4] leading-relaxed border border-[#6272a4]/10">
                        <div className="text-[#ff79c6] mb-1 italic">// Apenas um comando</div>
                        <div className="text-[#bd93f9]">await <span className="text-[#f8f8f2]">client</span>.<span className="text-[#8be9fd]">call</span>({'{'}</div>
                        <div className="pl-6">destination: <span className="text-[#f1fa8c]">"sip:200@host"</span>,</div>
                        <div className="pl-6">remoteElement: <span className="text-[#f8f8f2]">audioRef</span></div>
                        <div className="text-[#bd93f9]">{'}'});</div>
                    </div>
                </div>

                {/* Call Management Info */}
                <div className="col-span-12 lg:col-span-7 space-y-6">
                    {incomingInvitation && (
                        <div className="bg-gradient-to-r from-[#bd93f9] to-[#ff79c6] text-[#282a36] p-8 rounded-[2rem] animate-[bounce_2s_infinite] flex items-center justify-between shadow-2xl border-4 border-white/20">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Chamada Entrante</div>
                                    {incomingHasVideo && (
                                        <span className="bg-[#282a36] text-[#ff79c6] text-[8px] px-2 py-0.5 rounded-full font-black animate-pulse">VÍDEO 📹</span>
                                    )}
                                </div>
                                <div className="font-black text-2xl tracking-tighter italic">"{incomingInvitation.remoteIdentity.uri.user}"</div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleAnswer()} className="bg-[#282a36] text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-black transition-colors">ÁUDIO 🔊</button>
                                {incomingHasVideo && (
                                    <button onClick={() => handleAnswer({ withVideo: true })} className="bg-white text-[#282a36] px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-[#f8f8f2] transition-colors">VÍDEO 📹</button>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="bg-[#282a36] rounded-[2.5rem] border border-[#6272a4]/30 overflow-hidden shadow-2xl min-h-[400px] flex flex-col relative group/video">
                        {/* Video Stage (Conditional) */}
                        {callActive && activeSession?.withVideo && (
                            <div className="relative w-full aspect-video bg-black/40 overflow-hidden border-b border-[#6272a4]/20 flex items-center justify-center">
                                {/* Remote Video */}
                                <video
                                    ref={viewRemoteRef}
                                    autoPlay
                                    className="max-w-full max-h-full w-auto h-auto object-contain"
                                />

                                {/* Local PIP Preview */}
                                <div className="absolute bottom-4 right-4 w-32 h-44 bg-[#1e1f29] rounded-2xl border-2 border-[#bd93f9] overflow-hidden shadow-2xl z-10 transition-transform hover:scale-110">
                                    <video
                                        ref={viewLocalRef}
                                        autoPlay
                                        muted
                                        className={`w-full h-full object-cover ${isMutedVideo ? 'opacity-0' : 'opacity-100'}`}
                                    />
                                    {isMutedVideo && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-[#282a36]">
                                            <span className="text-2xl">🚫</span>
                                        </div>
                                    )}
                                </div>

                                {/* Privacy Overlays */}
                                {isOnHold && (
                                    <div className="absolute inset-0 bg-[#282a36]/90 backdrop-blur-md flex flex-col items-center justify-center z-20">
                                        <div className="text-6xl mb-4 animate-bounce">⏸️</div>
                                        <div className="text-xs font-black uppercase tracking-[0.3em] text-[#ffb86c]">Chamada em Espera</div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="p-6 border-b border-[#6272a4]/20 bg-[#44475a]/10 flex items-center justify-between z-10 relative backdrop-blur-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#8be9fd]" />
                                <span className="text-[10px] font-black text-[#8be9fd] uppercase tracking-[0.2em]">Call Switcher (Multi-Sessão)</span>
                            </div>
                            <span className="text-[10px] font-bold text-[#6272a4] uppercase bg-[#1e1f29] px-3 py-1 rounded-full">{sessions.length} LINHAS</span>
                        </div>
                        <div className="flex-1 p-8 space-y-4">
                            {sessions.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[#6272a4] space-y-6 opacity-40">
                                    <div className="text-7xl">🔭</div>
                                    <p className="text-sm font-medium italic text-center leading-relaxed">
                                        Nenhuma sessão ativa. <br /> Use o 'Dial Pad' à esquerda para testar.
                                    </p>
                                </div>
                            ) : (
                                sessions.map(s => (
                                    <div
                                        key={s.id}
                                        onClick={() => switchSession(s.id)}
                                        className={`group p-6 rounded-[1.5rem] border transition-all duration-300 cursor-pointer flex items-center justify-between ${s.id === activeSessionId ? 'bg-gradient-to-br from-[#bd93f9]/20 to-[#bd93f9]/5 border-[#bd93f9] shadow-xl' : 'bg-[#1e1f29] border-[#6272a4]/20 hover:border-[#bd93f9]/40 translate-y-0 active:scale-95'}`}
                                    >
                                        <div className="flex items-center gap-5">
                                            <div className={`w-4 h-4 rounded-full border-4 border-[#282a36] ${s.status === 'active' ? 'bg-[#50fa7b] shadow-[0_0_15px_rgba(80,250,123,0.5)]' : 'bg-[#ffb86c] animate-pulse'}`} />
                                            <div>
                                                <div className="font-black text-lg tracking-tight text-[#f8f8f2]">{s.remoteUser}</div>
                                                <div className={`text-[9px] uppercase font-black tracking-widest ${s.status === 'active' ? 'text-[#50fa7b]' : 'text-[#ffb86c]'}`}>{s.status} ( {s.withVideo ? 'VÍDEO' : 'ÁUDIO'} )</div>
                                            </div>
                                        </div>
                                        <div className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all ${s.id === activeSessionId ? 'text-[#bd93f9]' : 'text-[#6272a4] opacity-0 group-hover:opacity-100 italic'}`}>
                                            {s.id === activeSessionId ? 'No Ar 🔊' : 'Alternar →'}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        {sessions.length > 0 && (
                            <div className="p-8 bg-[#1e1f29]/50 border-t border-[#6272a4]/10 backdrop-blur-sm">
                                <div className="gap-3 grid grid-cols-3">
                                    <button
                                        onClick={onMute}
                                        className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${isMuted ? 'bg-[#ffb86c] text-[#282a36]' : 'bg-[#44475a] text-[#f8f8f2] hover:bg-[#6272a4]/20 border border-[#6272a4]/30'}`}
                                    >
                                        {isMuted ? '🎙️On' : '🔇 Mute'}
                                    </button>
                                    <button
                                        onClick={onMuteVideo}
                                        disabled={!activeSession?.withVideo}
                                        className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${isMutedVideo ? 'bg-[#ffb86c] text-[#282a36]' : 'bg-[#44475a] text-[#f8f8f2] hover:bg-[#6272a4]/20 border border-[#6272a4]/30'}`}
                                    >
                                        {isMutedVideo ? '📹On' : '🎥 Off'}
                                    </button>
                                    <button
                                        onClick={onHold}
                                        className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${isOnHold ? 'bg-[#ffb86c] text-[#282a36]' : 'bg-[#44475a] text-[#f8f8f2] hover:bg-[#6272a4]/20 border border-[#6272a4]/30'}`}
                                    >
                                        {isOnHold ? '▶️ Resume' : '⏸️ Hold'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
