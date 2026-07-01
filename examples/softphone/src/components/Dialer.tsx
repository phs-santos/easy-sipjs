import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Delete, Phone, ShieldCheck } from "lucide-react";
import type { CallRecord } from "../types";

interface Props { onCall: (destination: string) => void; recentNumbers: CallRecord[]; disabled?: boolean; }

const KEYS: { digit: string; letters?: string }[] = [
  { digit: "1" }, { digit: "2", letters: "ABC" }, { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" }, { digit: "5", letters: "JKL" }, { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" }, { digit: "8", letters: "TUV" }, { digit: "9", letters: "WXYZ" },
  { digit: "*" }, { digit: "0", letters: "+" }, { digit: "#" },
];

export function Dialer({ onCall, recentNumbers, disabled }: Props) {
  const [value, setValue] = useState("");

  const handleCall = () => { if (!value.trim()) return; onCall(value.trim()); setValue(""); };

  return (
    <div className="grid lg:grid-cols-[26rem_minmax(0,1fr)] gap-5 items-start">
      <section className="sp-card p-6 md:p-7">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-3xl bg-sp-blue/12 border border-sp-blue/20 flex items-center justify-center text-sp-blue shadow-glow">
            <Phone size={24} />
          </div>
          <h2 className="text-xl font-black mt-4">Digite o ramal ou número</h2>
          <p className="text-sm text-sp-muted mt-1">Discador limpo para teste rápido de chamada.</p>
        </div>

        <div className="relative mb-5">
          <input
            className="w-full bg-white/[0.035] border border-white/10 rounded-3xl text-center text-4xl font-light text-sp-text tracking-[0.22em] py-5 focus:border-sp-blue focus:ring-4 focus:ring-sp-blue/10 outline-none placeholder:text-sp-border placeholder:text-2xl transition-all"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCall()}
            placeholder="_ _ _"
            autoFocus
          />
          {value && <button onClick={() => setValue(v => v.slice(0, -1))} className="absolute right-5 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text transition-colors"><Delete size={20} /></button>}
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {KEYS.map(k => (
            <button key={k.digit} onClick={() => setValue(v => v + k.digit)} className="sp-kbd-button flex flex-col items-center justify-center py-4">
              <span className="text-sp-text text-2xl font-bold leading-none">{k.digit}</span>
              {k.letters && <span className="text-[9px] text-sp-muted tracking-[0.24em] mt-1 font-bold">{k.letters}</span>}
            </button>
          ))}
        </div>

        <button onClick={handleCall} disabled={disabled || !value.trim()} className="w-full sp-button-primary py-4 flex items-center justify-center gap-2 text-lg">
          <Phone size={19} /> Ligar agora
        </button>

        {disabled && <p className="text-xs text-sp-amber mt-3 text-center">Aguardando registro SIP para liberar chamadas.</p>}
      </section>

      <section className="sp-card p-6 md:p-7 min-h-[32rem]">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <p className="text-xs text-sp-blue uppercase tracking-[0.22em] font-black">Atalhos inteligentes</p>
            <h3 className="text-lg font-black mt-1">Recentes</h3>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-sp-green/10 border border-sp-green/20 flex items-center justify-center text-sp-green"><ShieldCheck size={18}/></div>
        </div>

        {recentNumbers.length === 0 ? (
          <div className="h-80 rounded-3xl border border-dashed border-white/10 flex flex-col items-center justify-center text-center p-6">
            <Phone size={28} className="text-sp-muted mb-3" />
            <p className="font-bold">Sem chamadas recentes</p>
            <p className="text-sm text-sp-muted mt-1">Após o primeiro teste, os contatos aparecem aqui para rediscagem rápida.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentNumbers.slice(0, 8).map(r => (
              <button key={r.id} onClick={() => onCall(r.number)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.035] border border-white/10 hover:bg-white/[0.07] hover:border-sp-blue/30 transition-all text-left group">
                <span className="w-10 h-10 rounded-2xl bg-white/[0.06] flex items-center justify-center">
                  {r.direction === "inbound" ? <ArrowDownLeft size={16} className="text-sp-green" /> : <ArrowUpRight size={16} className="text-sp-blue" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-sp-text font-semibold truncate">{r.displayName || r.number}</p>
                  <p className="text-[11px] text-sp-muted truncate">{r.status} · {new Date(r.startedAt).toLocaleString("pt-BR")}</p>
                </div>
                <Phone size={15} className="text-sp-muted group-hover:text-sp-green transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
