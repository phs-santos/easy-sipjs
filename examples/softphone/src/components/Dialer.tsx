import { useState } from "react";
import { Phone, Delete, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { CallRecord } from "../types";

interface Props {
  onCall: (destination: string) => void;
  recentNumbers: CallRecord[];
  disabled?: boolean;
}

const KEYS: { digit: string; letters?: string }[] = [
  { digit: "1" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*" },
  { digit: "0", letters: "+" },
  { digit: "#" },
];

export function Dialer({ onCall, recentNumbers, disabled }: Props) {
  const [value, setValue] = useState("");

  const handleCall = () => {
    if (!value.trim()) return;
    onCall(value.trim());
    setValue("");
  };

  return (
    <div className="flex flex-col items-center h-full pt-4">
      <div className="w-full max-w-xs">
        {/* Input */}
        <div className="relative mb-5">
          <input
            className="w-full bg-transparent text-center text-3xl font-light text-sp-text tracking-widest py-2 border-b border-sp-border focus:border-sp-green outline-none placeholder:text-sp-border placeholder:text-2xl transition-colors"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCall()}
            placeholder="_ _ _"
            autoFocus
          />
          {value && (
            <button
              onClick={() => setValue(v => v.slice(0, -1))}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text transition-colors"
            >
              <Delete size={18} />
            </button>
          )}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {KEYS.map(k => (
            <button
              key={k.digit}
              onClick={() => setValue(v => v + k.digit)}
              className="flex flex-col items-center justify-center py-3 rounded-xl bg-sp-surface border border-sp-border hover:bg-white/5 active:scale-95 transition-all select-none"
            >
              <span className="text-sp-text text-xl font-medium leading-none">{k.digit}</span>
              {k.letters && (
                <span className="text-[9px] text-sp-muted tracking-widest mt-0.5">{k.letters}</span>
              )}
            </button>
          ))}
        </div>

        {/* Call button */}
        <button
          onClick={handleCall}
          disabled={disabled || !value.trim()}
          className="w-full py-3.5 rounded-2xl bg-sp-green text-black font-semibold hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-base"
        >
          <Phone size={18} />
          Ligar
        </button>

        {/* Recents */}
        {recentNumbers.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-semibold text-sp-muted uppercase tracking-widest mb-2 px-1">Recentes</p>
            <div className="space-y-0.5">
              {recentNumbers.slice(0, 4).map(r => (
                <button
                  key={r.id}
                  onClick={() => onCall(r.number)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-sp-surface transition-colors text-left group"
                >
                  <span className="text-sp-muted">
                    {r.direction === "inbound"
                      ? <ArrowDownLeft size={14} className="text-sp-green" />
                      : <ArrowUpRight size={14} className="text-sp-muted" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-sp-text truncate">{r.displayName || r.number}</p>
                    {r.displayName && (
                      <p className="text-[11px] text-sp-muted truncate">{r.number}</p>
                    )}
                  </div>
                  <Phone size={14} className="text-sp-muted group-hover:text-sp-green transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
