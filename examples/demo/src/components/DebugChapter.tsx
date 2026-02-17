import React from 'react';
import { LogEntry } from '../types';

interface DebugChapterProps {
    logs: LogEntry[];
    clearLogs: () => void;
    logsEndRef: React.RefObject<HTMLDivElement>;
}

/**
 * DebugChapter Component
 * 
 * Responsabilidade:
 * Oferecer visibilidade total sobre as entranhas do protocolo SIP (Signaling).
 * 
 * Integração:
 * Demonstra como utilizar o hook `onSipLog` do SipClient para capturar
 * e exibir o tráfego de rede (WSS) bruto. Fundamental para resolver problemas
 * de SDP ou autenticação.
 */
export const DebugChapter: React.FC<DebugChapterProps> = ({ logs, clearLogs, logsEndRef }) => {
    const [searchTerm, setSearchTerm] = React.useState("");

    const filteredLogs = logs.filter(log =>
        log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.type.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <section className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-2">
                <span className="text-[#f1fa8c] font-bold uppercase tracking-[0.2em] text-xs">Capítulo 5</span>
                <h2 className="text-5xl font-black tracking-tight leading-none">Visão <span className="text-[#bd93f9]">Raio-X</span></h2>
                <p className="text-[#6272a4] text-lg font-light">Analise cada bit de sinalização. O 'Trace' automático captura mensagens SIP brutas para depuração profunda.</p>
            </div>

            <div className="bg-[#1c1d26] rounded-[2.5rem] border border-[#6272a4]/30 flex flex-col h-[700px] shadow-2xl relative overflow-hidden ring-1 ring-white/5">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#bd93f9] to-transparent animate-pulse" />
                <div className="p-6 bg-[#282a36] border-b border-[#6272a4]/20 flex items-center justify-between shrink-0 gap-4">
                    <div className="flex gap-2 shrink-0">
                        <div className="w-3 h-3 rounded-full bg-[#ff5555] shadow-[0_0_8px_rgba(255,85,85,0.4)]" />
                        <div className="w-3 h-3 rounded-full bg-[#f1fa8c] shadow-[0_0_8px_rgba(241,250,140,0.4)]" />
                        <div className="w-3 h-3 rounded-full bg-[#50fa7b] shadow-[0_0_8px_rgba(80,250,123,0.4)]" />
                    </div>

                    <div className="flex-1 max-w-md">
                        <div className="relative group">
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Buscar evento SIP (INVITE, BYE, etc)..."
                                className="w-full bg-[#1e1f29] border border-[#6272a4]/40 rounded-full px-6 py-2 text-[11px] text-[#f8f8f2] placeholder-[#6272a4] focus:outline-none focus:border-[#bd93f9] focus:ring-1 focus:ring-[#bd93f9]/50 transition-all font-mono"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 group-focus-within:opacity-100 transition-opacity">🔍</span>
                        </div>
                    </div>

                    <div className="flex gap-4 shrink-0">
                        <button onClick={clearLogs} className="text-[10px] font-black uppercase text-[#bd93f9] hover:text-[#f8f8f2] tracking-widest transition-colors px-4 py-2 bg-[#1e1f29] rounded-full border border-[#6272a4]/20 shadow-inner">Reset Trace</button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-10 font-mono text-[12px] leading-[1.8] scrollbar-thin scrollbar-thumb-[#44475a] bg-[#1a1b24]">
                    {filteredLogs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-[#6272a4] opacity-30 space-y-4 text-center">
                            <div className="text-6xl italic tracking-tighter">{searchTerm ? 'empty set' : 'void'}</div>
                            <p className="text-xs font-black uppercase tracking-widest leading-relaxed">
                                {searchTerm ? `Nenhum evento encontrado para "${searchTerm}"` : 'Aguardando pacotes...'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {filteredLogs.map((log, i) => (
                                <div key={i} className="group relative border-l-2 border-[#44475a] hover:border-[#bd93f9] pl-8 transition-colors duration-300">
                                    <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-[#44475a] group-hover:bg-[#bd93f9] transition-all shadow-[0_0_5px_rgba(0,0,0,0.5)]" />
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="bg-[#282a36] px-3 py-1 rounded-md shadow-inner">
                                            <span className="text-[#6272a4] text-[9px] font-bold tracking-widest">{log.time}</span>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] shadow-lg ${log.type === 'sip-in' ? 'bg-[#bd93f9] text-[#282a36] shadow-[#bd93f9]/10' : log.type === 'sip-out' ? 'bg-[#50fa7b] text-[#282a36] shadow-[#50fa7b]/10' : 'bg-[#ff5555] text-white shadow-[#ff5555]/10'}`}>
                                            {log.type === 'sip-in' ? 'RECEIVING' : log.type === 'sip-out' ? 'SENDING' : log.type}
                                        </span>
                                    </div>
                                    <pre className="whitespace-pre overflow-x-auto text-[#f8f8f2] max-w-full bg-[#282a36]/30 p-6 rounded-3xl border border-white/5 shadow-inner leading-relaxed selection:bg-[#bd93f9]/40">{log.message}</pre>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};
