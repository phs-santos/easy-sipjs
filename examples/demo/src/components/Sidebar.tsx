import React from 'react';
import { Chapter, ConnectionState } from '../types';

interface SidebarProps {
    currentChapter: Chapter;
    setCurrentChapter: (chapter: Chapter) => void;
    connectionState: ConnectionState;
}

/**
 * Sidebar Component
 * 
 * Responsabilidades:
 * 1. Navegação entre os capítulos da documentação.
 * 2. Exibição do status global da conexão SIP.
 * 
 * Dica para o Desenvolvedor:
 * O status da conexão é derivado dos eventos emitidos pelo SipClient 
 * (onRegister.onAccept, onRegister.onReject, etc).
 */
export const Sidebar: React.FC<SidebarProps> = ({ currentChapter, setCurrentChapter, connectionState }) => {
    const statusBadge = (state: ConnectionState) => {
        const colors = {
            idle: "bg-zinc-600",
            connecting: "bg-amber-500",
            registered: "bg-emerald-500",
            calling: "bg-sky-500",
            "in-call": "bg-indigo-600",
            error: "bg-rose-600"
        };
        return (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${colors[state]} bg-opacity-20 text-white border border-white/10`}>
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${colors[state]}`} />
                {state}
            </div>
        );
    };

    return (
        <aside className="w-72 bg-[#282a36] border-r border-[#44475a]/50 flex flex-col p-6 shrink-0 h-full">
            <div className="mb-10">
                <h1 className="text-xl font-black text-[#bd93f9] tracking-tighter flex items-center gap-2">
                    <span className="text-2xl">⚡</span> EASY-SIPJS
                </h1>
                <p className="text-[10px] font-bold text-[#6272a4] uppercase tracking-widest mt-1">Interactive Guide</p>
            </div>

            <nav className="flex-1 space-y-2">
                {[
                    { id: "intro", label: "Boas-vindas", icon: "🏠" },
                    { id: "config", label: "O Motor (Config)", icon: "⚙️" },
                    { id: "register", label: "Conexão (Register)", icon: "🔌" },
                    { id: "calls", label: "Playground (Calls)", icon: "📞" },
                    { id: "debug", label: "Raio-X (Debugger)", icon: "🧪" }
                ].map(chapter => (
                    <button
                        key={chapter.id}
                        onClick={() => setCurrentChapter(chapter.id as Chapter)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${currentChapter === chapter.id ? 'bg-[#bd93f9] text-[#282a36] shadow-lg shadow-[#bd93f9]/20' : 'text-[#6272a4] hover:bg-[#44475a]/50 hover:text-[#f8f8f2]'}`}
                    >
                        <span className="text-lg">{chapter.icon}</span>
                        {chapter.label}
                    </button>
                ))}
            </nav>

            <div className="mt-auto pt-6 border-t border-[#44475a]/30">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold text-[#6272a4] uppercase">Status Atual</span>
                    {statusBadge(connectionState)}
                </div>
            </div>
        </aside>
    );
};
