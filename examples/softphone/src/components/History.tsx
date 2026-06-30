import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff, AlertTriangle, Trash2 } from "lucide-react";
import type { CallRecord } from "../types";

interface Props {
  history: CallRecord[];
  onCall: (number: string) => void;
  onClear: () => void;
}

const STATUS_ICON: Record<CallRecord["status"], React.ReactNode> = {
  answered:  <Phone size={14} className="text-sp-green" />,
  missed:    <PhoneMissed size={14} className="text-sp-red" />,
  rejected:  <PhoneOff size={14} className="text-sp-red" />,
  failed:    <AlertTriangle size={14} className="text-sp-amber" />,
  busy:      <PhoneOff size={14} className="text-sp-amber" />,
  calling:   <Phone size={14} className="text-sp-muted" />,
};

export function History({ history, onCall, onClear }: Props) {
  const fmtDuration = (s: number) => {
    if (s === 0) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="max-w-2xl mx-auto pt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-sp-text">Histórico de chamadas</h2>
        {history.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 text-xs text-sp-muted hover:text-sp-red">
            <Trash2 size={13} /> Limpar
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="text-sp-muted text-sm text-center py-12">Nenhuma chamada ainda.</p>
      ) : (
        <div className="space-y-1">
          {history.map(r => (
            <div key={r.id}
              className="flex items-center justify-between px-4 py-3 rounded-lg bg-sp-surface border border-sp-border hover:bg-white/5">
              <div className="flex items-center gap-3 min-w-0">
                {r.direction === "inbound"
                  ? <PhoneIncoming size={15} className="text-sp-green shrink-0" />
                  : <PhoneOutgoing size={15} className="text-sp-muted shrink-0" />}
                {STATUS_ICON[r.status]}
                <div className="min-w-0">
                  <p className="text-sp-text text-sm truncate">{r.displayName || r.number}</p>
                  <p className="text-sp-muted text-xs">{fmtDate(r.startedAt)} · {fmtDuration(r.duration)}</p>
                </div>
              </div>
              <button onClick={() => onCall(r.number)}
                className="text-sp-green hover:text-green-400 shrink-0 ml-2" title="Ligar novamente">
                <Phone size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
