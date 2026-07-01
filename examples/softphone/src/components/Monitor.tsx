import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Wifi, WifiOff, User, Phone, Server, Clock, Filter, Trash2 } from "lucide-react";
import type { SipConnectionState } from "easy-sipjs";
import type { StoredCredentials, SipLogEntry } from "../types";
import type { SessionState } from "../hooks/useSoftphone";

interface Props {
  connectionState: SipConnectionState;
  credentials: StoredCredentials;
  sipLogs: SipLogEntry[];
  sessionStates: SessionState[];
  callHistoryCount: number;
  onReconnect: () => void;
}

const STATE_COLOR: Record<SipConnectionState, string> = {
  registered:    "text-sp-green",
  connected:     "text-sp-amber",
  connecting:    "text-sp-amber",
  disconnected:  "text-sp-red",
  error:         "text-sp-red",
};
const STATE_BG: Record<SipConnectionState, string> = {
  registered:   "bg-sp-green/10 border-sp-green/30",
  connected:    "bg-sp-amber/10 border-sp-amber/30",
  connecting:   "bg-sp-amber/10 border-sp-amber/30",
  disconnected: "bg-sp-red/10 border-sp-red/30",
  error:        "bg-sp-red/10 border-sp-red/30",
};
const STATE_LABEL: Record<SipConnectionState, string> = {
  registered:   "Registrado",
  connected:    "Conectado",
  connecting:   "Conectando…",
  disconnected: "Desconectado",
  error:        "Erro",
};

type DirFilter = "all" | "sent" | "received";

export function Monitor({ connectionState, credentials, sipLogs, sessionStates, callHistoryCount, onReconnect }: Props) {
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [methodFilter, setMethodFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localLogs, setLocalLogs] = useState<SipLogEntry[]>(sipLogs);
  const [connectedAt, setConnectedAt] = useState<Date | null>(null);
  const [uptime, setUptime] = useState("");

  // keep local copy so we can clear independently
  useEffect(() => { setLocalLogs(sipLogs); }, [sipLogs]);

  useEffect(() => {
    if (connectionState === "registered" && !connectedAt) {
      setConnectedAt(new Date());
    } else if (connectionState === "disconnected" || connectionState === "error") {
      setConnectedAt(null);
      setUptime("");
    }
  }, [connectionState]);

  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - connectedAt.getTime()) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setUptime(h > 0
        ? `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`
        : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    }, 1000);
    return () => clearInterval(t);
  }, [connectedAt]);

  const filtered = localLogs.filter(e => {
    if (dirFilter !== "all" && e.direction !== dirFilter) return false;
    if (methodFilter) {
      const q = methodFilter.toUpperCase();
      const label = e.method ?? (e.statusCode ? String(e.statusCode) : "");
      if (!label.includes(q)) return false;
    }
    return true;
  });

  const isOk = connectionState === "registered";

  return (
    <div className="h-full flex flex-col gap-4">
      {/* ── Status cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Conexão */}
        <div className={`rounded-xl border p-4 ${STATE_BG[connectionState]}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-sp-muted font-medium uppercase tracking-wide">Conexão</span>
            {isOk
              ? <Wifi size={14} className="text-sp-green" />
              : <WifiOff size={14} className="text-sp-red" />}
          </div>
          <p className={`text-sm font-bold ${STATE_COLOR[connectionState]}`}>{STATE_LABEL[connectionState]}</p>
          <p className="text-[11px] text-sp-muted mt-1 break-all">{credentials.server}</p>
          {uptime && (
            <div className="flex items-center gap-1 mt-2 text-[10px] text-sp-muted">
              <Clock size={10} />
              <span>Uptime {uptime}</span>
            </div>
          )}
          {!isOk && (
            <button
              onClick={onReconnect}
              className="mt-2 w-full text-[11px] py-1 rounded bg-sp-blue/20 text-sp-blue hover:bg-sp-blue/30 transition-colors"
            >
              Reconectar
            </button>
          )}
        </div>

        {/* Conta */}
        <div className="rounded-xl border border-sp-border bg-sp-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-sp-muted font-medium uppercase tracking-wide">Conta SIP</span>
            <User size={14} className="text-sp-muted" />
          </div>
          <InfoRow label="Ramal" value={credentials.phone} mono />
          {credentials.authorizationUsername && credentials.authorizationUsername !== credentials.phone && (
            <InfoRow label="Auth user" value={credentials.authorizationUsername} mono />
          )}
          <InfoRow label="Domínio" value={credentials.domain} mono />
          {credentials.nameexten && <InfoRow label="Nome" value={credentials.nameexten} />}
          <InfoRow label="Provider" value={credentials.provider ?? "sipjs"} />
        </div>

        {/* Sessões & histórico */}
        <div className="rounded-xl border border-sp-border bg-sp-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-sp-muted font-medium uppercase tracking-wide">Sessões</span>
            <Phone size={14} className="text-sp-muted" />
          </div>
          <div className="flex items-end gap-2 mb-1">
            <span className={`text-2xl font-bold ${sessionStates.length > 0 ? "text-sp-green" : "text-sp-muted"}`}>
              {sessionStates.length}
            </span>
            <span className="text-xs text-sp-muted mb-1">ativa(s)</span>
          </div>
          {sessionStates.map(ss => (
            <div key={ss.session.id} className="flex items-center gap-1 text-[11px] text-sp-muted mt-1">
              <span className={`w-1.5 h-1.5 rounded-full ${ss.isOnHold ? "bg-sp-amber" : "bg-sp-green"}`} />
              <span className="font-mono truncate">{ss.session.id.slice(0, 12)}…</span>
              {ss.isOnHold && <span className="text-sp-amber">(hold)</span>}
              {ss.isMuted && <span className="text-sp-red">(mudo)</span>}
            </div>
          ))}
          <div className="mt-3 pt-3 border-t border-sp-border/50">
            <InfoRow label="Log de chamadas" value={`${callHistoryCount} registros`} />
            <InfoRow label="Msgs SIP capturadas" value={`${localLogs.length}`} />
          </div>
        </div>
      </div>

      {/* ── SIP Trace ── */}
      <div className="flex-1 flex flex-col bg-[#0c0c0c] border border-sp-border rounded-2xl overflow-hidden min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-[#111] shrink-0">
          <Server size={13} className="text-green-400" />
          <span className="text-green-400 font-mono text-xs font-semibold tracking-wide">SIP TRACE</span>
          <span className="text-[10px] text-white/30 font-mono">{filtered.length}/{localLogs.length} msgs</span>

          <div className="ml-auto flex items-center gap-2">
            {/* Direction filter */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
              {(["all", "sent", "received"] as DirFilter[]).map(d => (
                <button key={d} onClick={() => setDirFilter(d)}
                  className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
                    dirFilter === d ? "bg-white/15 text-white" : "text-white/40 hover:text-white/60"
                  }`}>
                  {d === "all" ? "todos" : d === "sent" ? "→ env" : "← rec"}
                </button>
              ))}
            </div>

            {/* Method filter */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-0.5">
              <Filter size={10} className="text-white/30" />
              <input
                value={methodFilter}
                onChange={e => setMethodFilter(e.target.value)}
                placeholder="INVITE, 200…"
                className="bg-transparent text-[10px] font-mono text-white/70 placeholder:text-white/20 outline-none w-24"
              />
            </div>

            <button onClick={() => setLocalLogs([])}
              className="text-white/30 hover:text-white/60 transition-colors" title="Limpar trace">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5 bg-[#0f0f0f] shrink-0">
          <span className="font-mono text-[10px] text-white/20 w-4 shrink-0"></span>
          <span className="font-mono text-[10px] text-white/20 w-24 shrink-0">MÉTODO / STATUS</span>
          <span className="font-mono text-[10px] text-white/20 flex-1">DESCRIÇÃO</span>
          <span className="font-mono text-[10px] text-white/20 w-16 text-right shrink-0">HORA</span>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center h-full text-white/20 font-mono text-xs">
              {localLogs.length === 0 ? "aguardando mensagens SIP…" : "nenhuma mensagem corresponde ao filtro"}
            </div>
          )}
          {filtered.map(entry => (
            <SipRow
              key={entry.id}
              entry={entry}
              expanded={expanded === entry.id}
              onToggle={() => setExpanded(prev => prev === entry.id ? null : entry.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center text-[11px] mt-1 gap-2">
      <span className="text-sp-muted shrink-0">{label}</span>
      <span className={`text-sp-text truncate ${mono ? "font-mono" : ""}`} title={value}>{value}</span>
    </div>
  );
}

function SipRow({ entry, expanded, onToggle }: {
  entry: SipLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = entry.method || (entry.statusCode ? `${entry.statusCode}` : "?");
  const desc = entry.statusText || entry.method || "";
  const timeStr = new Date(entry.timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const labelColor = entry.method
    ? entry.direction === "sent" ? "text-cyan-400" : "text-blue-400"
    : entry.statusCode && entry.statusCode >= 200 && entry.statusCode < 300
      ? "text-green-400"
      : entry.statusCode && entry.statusCode >= 400
        ? "text-red-400"
        : "text-yellow-400";

  const arrow = entry.direction === "sent" ? "→" : "←";
  const arrowColor = entry.direction === "sent" ? "text-cyan-600" : "text-blue-600";

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors text-left border-b border-white/[0.04] group"
      >
        <span className={`font-mono text-xs w-4 shrink-0 ${arrowColor}`}>{arrow}</span>
        <span className={`font-mono text-xs font-bold w-24 shrink-0 ${labelColor}`}>{label}</span>
        <span className="font-mono text-[11px] text-white/40 flex-1 truncate">{desc}</span>
        <span className="font-mono text-[10px] text-white/25 w-16 text-right shrink-0">{timeStr}</span>
        <span className="text-white/20 group-hover:text-white/40 ml-1 shrink-0">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-3 bg-[#080808] border-b border-white/[0.06]">
          <pre className="font-mono text-[10px] text-green-300/70 whitespace-pre-wrap break-all leading-5 max-h-72 overflow-y-auto">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  );
}
