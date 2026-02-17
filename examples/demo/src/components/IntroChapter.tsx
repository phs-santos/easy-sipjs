import React from 'react';
import { Chapter } from '../types';

interface IntroChapterProps {
    onStart: (chapter: Chapter) => void;
}

/**
 * IntroChapter Component
 * 
 * Responsabilidade:
 * Oferecer uma visão geral da biblioteca easy-sipjs e motivar o desenvolvedor.
 * 
 * Integração:
 * Aqui focamos na proposta de valor: simplificar o SIP.js para menos de 10%
 * do boilerplate original.
 */
export const IntroChapter: React.FC<IntroChapterProps> = ({ onStart }) => {
    return (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="space-y-2">
                <span className="text-[#bd93f9] font-bold uppercase tracking-[0.2em] text-xs">Capítulo 1</span>
                <h2 className="text-6xl font-black tracking-tight leading-none">O Poder do SIP, <br /><span className="text-[#8be9fd] italic">Simplificado.</span></h2>
            </div>
            <p className="text-[#6272a4] text-xl leading-relaxed max-w-2xl font-light">
                Bem-vindo ao Guia Interativo do <span className="text-[#f1fa8c] font-medium">easy-sipjs</span>.
                Esta biblioteca foi desenhada para remover a complexidade do protocolo SIP e WebRTC,
                permitindo que você foque na experiência do usuário.
            </p>
            <div className="grid grid-cols-2 gap-4 mt-8">
                <div className="p-8 bg-[#44475a]/30 rounded-3xl border border-[#6272a4]/20 hover:border-[#bd93f9]/40 transition-colors">
                    <h3 className="font-bold text-[#ff79c6] mb-2 uppercase text-[10px] tracking-widest">O que é?</h3>
                    <p className="text-sm text-[#f8f8f2]/70 leading-relaxed font-light">Uma camada de abstração de alto nível para SIP.js moderna, focada em produtividade.</p>
                </div>
                <div className="p-8 bg-[#44475a]/30 rounded-3xl border border-[#6272a4]/20 hover:border-[#50fa7b]/40 transition-colors">
                    <h3 className="font-bold text-[#50fa7b] mb-2 uppercase text-[10px] tracking-widest">Objetivo</h3>
                    <p className="text-sm text-[#f8f8f2]/70 leading-relaxed font-light">Reduzir centenas de linhas de boilerplate em um set de comandos semânticos e fluídos.</p>
                </div>
            </div>
            <button
                onClick={() => onStart("config")}
                className="bg-[#bd93f9] text-[#282a36] px-10 py-5 rounded-2xl font-black text-sm uppercase tracking-widest hover:scale-105 transition-all shadow-2xl shadow-[#bd93f9]/30 flex items-center gap-3 mt-4"
            >
                Começar Jornada <span>🚀</span>
            </button>
        </section>
    );
};
