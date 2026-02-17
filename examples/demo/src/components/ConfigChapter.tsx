import React from 'react';
import { Chapter, Credentials } from '../types';

interface ConfigChapterProps {
    credentials: Credentials;
    setCredentials: (creds: Credentials) => void;
    onNext: (chapter: Chapter) => void;
}

/**
 * ConfigChapter Component
 * 
 * Responsabilidade:
 * Coleta de dados de autenticação e demonstração da herança de instanciamento.
 * 
 * Integração:
 * Mostra ao dev como o objeto de configuração do SipClient é mapeado
 * diretamente para os inputs da UI.
 */
export const ConfigChapter: React.FC<ConfigChapterProps> = ({ credentials, setCredentials, onNext }) => {
    return (
        <section className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="space-y-2">
                <span className="text-[#ff79c6] font-bold uppercase tracking-[0.2em] text-xs">Capítulo 2</span>
                <h2 className="text-5xl font-black tracking-tighter">O Coração da Máquina</h2>
                <p className="text-[#6272a4] text-lg font-light">Tudo começa com as credenciais. Sem elas, o SIP não sabe para onde ir.</p>
            </div>

            <div className="bg-[#1e1f29] rounded-[2.5rem] p-10 border border-[#6272a4]/20 shadow-2xl space-y-10">
                <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <div>
                            <label className="text-[10px] text-[#6272a4] uppercase font-bold block mb-3 tracking-widest">Domínio / Host</label>
                            <input className="w-full bg-[#282a36] border border-[#6272a4]/40 rounded-2xl px-5 py-4 text-sm focus:border-[#bd93f9] outline-none transition-all shadow-inner" value={credentials.domain} onChange={e => setCredentials({ ...credentials, domain: e.target.value })} />
                        </div>
                        <div>
                            <label className="text-[10px] text-[#6272a4] uppercase font-bold block mb-3 tracking-widest">Ramal / Usuário</label>
                            <input className="w-full bg-[#282a36] border border-[#6272a4]/40 rounded-2xl px-5 py-4 text-sm focus:border-[#bd93f9] outline-none transition-all shadow-inner" value={credentials.phone} onChange={e => setCredentials({ ...credentials, phone: e.target.value })} />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div>
                            <label className="text-[10px] text-[#6272a4] uppercase font-bold block mb-3 tracking-widest">Senha / Secret</label>
                            <input type="password" className="w-full bg-[#282a36] border border-[#6272a4]/40 rounded-2xl px-5 py-4 text-sm focus:border-[#bd93f9] outline-none transition-all shadow-inner" value={credentials.secret} onChange={e => setCredentials({ ...credentials, secret: e.target.value })} />
                        </div>
                        <div>
                            <label className="text-[10px] text-[#6272a4] uppercase font-bold block mb-3 tracking-widest">WebSocket Server (WSS)</label>
                            <input className="w-full bg-[#282a36] border border-[#6272a4]/40 rounded-2xl px-5 py-4 text-sm focus:border-[#bd93f9] outline-none transition-all shadow-inner" value={credentials.server} onChange={e => setCredentials({ ...credentials, server: e.target.value })} />
                        </div>
                    </div>
                </div>

                <div className="p-8 bg-[#282a36] rounded-3xl font-mono text-[13px] leading-relaxed text-[#6272a4] border border-[#6272a4]/10 shadow-inner relative overflow-hidden group">
                    <div className="absolute top-4 right-6 text-[10px] font-bold text-[#44475a]">TYPESCRIPT</div>
                    <div className="text-[#ff79c6]">const <span className="text-[#f8f8f2]">client</span> = <span className="text-[#bd93f9]">new</span> <span className="text-[#8be9fd]">SipClient</span>({'{'}</div>
                    <div className="pl-6 pt-1">domain: <span className="text-[#f1fa8c]">"{credentials.domain}"</span>,</div>
                    <div className="pl-6">phone: <span className="text-[#f1fa8c]">"{credentials.phone}"</span>,</div>
                    <div className="pl-6">secret: <span className="text-[#f1fa8c]">"********"</span>,</div>
                    <div className="pl-6 pb-1">server: <span className="text-[#f1fa8c]">"{credentials.server}"</span></div>
                    <div className="text-[#ff79c6]">{'}'});</div>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={() => onNext("register")}
                        className="text-xs font-black text-[#bd93f9] uppercase tracking-[0.2em] hover:text-[#f8f8f2] transition-colors flex items-center gap-2"
                    >
                        ESTABELECER CONEXÃO <span className="text-lg">→</span>
                    </button>
                </div>
            </div>
        </section>
    );
};
