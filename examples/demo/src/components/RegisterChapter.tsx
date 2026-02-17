import React from 'react';
import { ConnectionState } from '../types';

interface RegisterChapterProps {
    connectionState: ConnectionState;
    onRegister: () => void;
}

/**
 * RegisterChapter Component
 * 
 * Responsabilidade:
 * Orquestrar o processo de Handshake (Registro) com o servidor.
 * 
 * Integração:
 * Explica o uso do método `register()` e como capturar o aceite do servidor
 * através do evento `onRegister.onAccept`.
 */
export const RegisterChapter: React.FC<RegisterChapterProps> = ({ connectionState, onRegister }) => {
    return (
        <section className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-2">
                <span className="text-[#50fa7b] font-bold uppercase tracking-[0.2em] text-xs">Capítulo 3</span>
                <h2 className="text-5xl font-black tracking-tight">O Aperto de Mão</h2>
                <p className="text-[#6272a4] text-lg font-light">O método <code className="text-[#f1fa8c] bg-[#1e1f29] px-2 py-1 rounded font-normal">register()</code> constrói o túnel WSS e negocia a entrada segura no seu PBX.</p>
            </div>

            <div className="grid grid-cols-5 gap-8">
                <div className="col-span-3 space-y-6">
                    <div className={`rounded-[2rem] p-10 border transition-all duration-500 shadow-2xl flex items-center justify-between ${connectionState === 'registered' ? 'bg-[#50fa7b]/5 border-[#50fa7b]/30' : 'bg-[#1e1f29] border-[#6272a4]/20'}`}>
                        <div>
                            <h3 className="font-black text-xl mb-1 uppercase tracking-tight">Status</h3>
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${connectionState === 'registered' ? 'bg-[#50fa7b] shadow-[0_0_10px_#50fa7b]' : 'bg-zinc-600 animate-pulse'}`} />
                                <span className="text-xs font-bold text-[#6272a4] uppercase tracking-widest">{connectionState}</span>
                            </div>
                        </div>
                        <button
                            onClick={onRegister}
                            disabled={connectionState === 'connecting' || connectionState === 'registered'}
                            className={`px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all ${connectionState === 'registered' ? 'bg-transparent border border-[#50fa7b] text-[#50fa7b] cursor-default' : 'bg-[#50fa7b] text-[#282a36] hover:scale-105 active:scale-95 shadow-xl shadow-[#50fa7b]/20 hover:shadow-[#50fa7b]/40'}`}
                        >
                            {connectionState === 'registered' ? 'REGISTRADO ✓' : 'ATIVAR REGISTRO ⚡'}
                        </button>
                    </div>
                    <div className="p-8 bg-[#282a36]/50 rounded-[2rem] border border-[#6272a4]/10 shadow-xl space-y-4">
                        <h4 className="text-[10px] font-black text-[#6272a4] uppercase tracking-widest text-center">Promises & Callbacks</h4>
                        <div className="bg-[#1e1f29] p-6 rounded-2xl font-mono text-[12px] leading-relaxed shadow-inner">
                            <div className="text-[#6272a4] mb-2 italic">// Simples e direto</div>
                            <div className="text-[#bd93f9]">await <span className="text-[#f8f8f2]">client</span>.<span className="text-[#50fa7b]">register</span>();</div>
                            <div className="mt-4 text-[#6272a4] italic">// Ouça o aceite (200 OK)</div>
                            <div><span className="text-[#f8f8f2]">client</span>.onRegister.onAccept = () ={">"} {'{'}</div>
                            <div className="pl-6 text-[#8be9fd]">console.<span className="text-[#50fa7b]">log</span>(<span className="text-[#f1fa8c]">"Estou Online! 🎉"</span>);</div>
                            <div>{'}'};</div>
                        </div>
                    </div>
                </div>
                <div className="col-span-2 flex flex-col justify-center text-center p-10 bg-[#bd93f9]/5 rounded-[2.5rem] border border-[#bd93f9]/10 space-y-6">
                    <div className="text-6xl filter drop-shadow-[0_0_15px_rgba(189,147,249,0.3)]">🔓</div>
                    <div className="space-y-4">
                        <h4 className="font-black text-[#bd93f9] uppercase text-xs tracking-widest">Automatic Keep-Alive</h4>
                        <p className="text-[13px] text-[#6272a4] leading-relaxed font-light px-4 italic">
                            "O Easy-SIP cuida do tráfego NAT, enviando 'OPTIONS' silenciosos para manter a porta aberta e re-registrando se o Wi-Fi oscilar."
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};
