import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Filter, Phone, RefreshCw, Server, Stethoscope, Trash2, User, Wifi, WifiOff } from "lucide-react";
import type { SipConnectionState, SipHealthStatus, SoftphoneDiagnostics } from "easy-sipjs";
import type { SessionState } from "../hooks/useSoftphone";
import type { SipLogEntry, StoredCredentials } from "../types";

interface Props {
  connectionState: SipConnectionState;
  credentials: StoredCredentials;
  sipLogs: SipLogEntry[];
  sessionStates: SessionState[];
  callHistoryCount: number;
  onReconnect: () => void;
  onCheckHealth: () => Promise<SipHealthStatus>;
  onDiagnose: () => Promise<SoftphoneDiagnostics>;
}

const STATE_LABEL: Record<SipConnectionState, string> = { registered: "Registrado", connected: "Conectado", connecting: "Conectando…", disconnected: "Desconectado", error: "Erro" };
type DirFilter = "all" | "sent" | "received";

export function Monitor({ connectionState, credentials, sipLogs, sessionStates, callHistoryCount, onReconnect, onCheckHealth, onDiagnose }: Props) {
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [methodFilter, setMethodFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localLogs, setLocalLogs] = useState<SipLogEntry[]>(sipLogs);
  const [health, setHealth] = useState<SipHealthStatus | undefined>();
  const [diagnostics, setDiagnostics] = useState<SoftphoneDiagnostics | undefined>();
  const [connectedAt, setConnectedAt] = useState<Date | null>(null);
  const [uptime, setUptime] = useState("");

  useEffect(() => { setLocalLogs(sipLogs); }, [sipLogs]);
  useEffect(() => {
    if (connectionState === "registered" && !connectedAt) setConnectedAt(new Date());
    if (connectionState === "disconnected" || connectionState === "error") { setConnectedAt(null); setUptime(""); }
  }, [connectionState, connectedAt]);
  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - connectedAt.getTime()) / 1000);
      const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60;
      setUptime(h > 0 ? `${h}h ${m.toString().padStart(2,"0")}m ${s.toString().padStart(2,"0")}s` : `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`);
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
  const runHealth = async () => setHealth(await onCheckHealth());
  const runDiagnostics = async () => setDiagnostics(await onDiagnose());

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="grid md:grid-cols-3 gap-3">
        <StatusCard title="Conexão" icon={isOk ? <Wifi size={16}/> : <WifiOff size={16}/>} tone={isOk ? "green" : "amber"}>
          <p className="text-lg font-black">{STATE_LABEL[connectionState]}</p>
          <p className="text-[11px] text-sp-muted mt-1 break-all">{credentials.server}</p>
          {uptime && <div className="flex items-center gap-1 mt-2 text-[11px] text-sp-muted"><Clock size={11}/> Uptime {uptime}</div>}
          {!isOk && <button onClick={onReconnect} className="mt-3 w-full sp-button-secondary py-2 text-xs font-bold">Reconectar</button>}
        </StatusCard>

        <StatusCard title="Conta SIP" icon={<User size={16}/>} tone="blue">
          <InfoRow label="Ramal" value={credentials.phone} mono />
          {credentials.authorizationUsername && credentials.authorizationUsername !== credentials.phone && <InfoRow label="Auth" value={credentials.authorizationUsername} mono />}
          <InfoRow label="Domínio" value={credentials.domain} mono />
          <InfoRow label="Provider" value={credentials.provider ?? "sipjs"} />
        </StatusCard>

        <StatusCard title="Operação" icon={<Phone size={16}/>} tone="violet">
          <div className="flex items-end gap-2 mb-1"><span className="text-3xl font-black">{sessionStates.length}</span><span className="text-xs text-sp-muted mb-1">sessões</span></div>
          <InfoRow label="Histórico" value={`${callHistoryCount} registros`} />
          <InfoRow label="Trace SIP" value={`${localLogs.length} msgs`} />
        </StatusCard>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <section className="sp-panel p-4">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-black"><Server size={15} className="text-sp-blue"/> Health check</div><button onClick={runHealth} className="sp-button-secondary px-3 py-2 text-xs font-bold flex items-center gap-1"><RefreshCw size={13}/> Testar</button></div>
          {health ? <div className="grid grid-cols-2 gap-2 mt-3 text-xs"><Info label="WebSocket" ok={health.websocketConnected}/><Info label="Registro" ok={health.registered}/><InfoText label="Ping" value={health.lastPingLatencyMs ? `${health.lastPingLatencyMs.toFixed(0)} ms` : health.lastPingError || "—"}/><InfoText label="Sessões" value={String(health.activeSessions)}/></div> : <p className="text-sm text-sp-muted mt-3">Teste a saúde do registro, websocket e SIP OPTIONS.</p>}
        </section>
        <section className="sp-panel p-4">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-black"><Stethoscope size={15} className="text-sp-green"/> Diagnóstico</div><button onClick={runDiagnostics} className="sp-button-secondary px-3 py-2 text-xs font-bold flex items-center gap-1"><RefreshCw size={13}/> Rodar</button></div>
          {diagnostics ? <div className="grid grid-cols-2 gap-2 mt-3 text-xs"><Info label="HTTPS" ok={diagnostics.secureContext}/><Info label="Mic" ok={diagnostics.hasMicrophonePermission}/><Info label="Saída" ok={diagnostics.hasSpeakerSelection}/><Info label="SIP" ok={diagnostics.sipRegistered}/></div> : <p className="text-sm text-sp-muted mt-3">Valida permissões, browser e requisitos WebRTC.</p>}
        </section>
      </div>

      <div className="flex-1 flex flex-col bg-[#050914]/95 border border-white/10 rounded-3xl overflow-hidden min-h-[28rem] shadow-soft">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/[0.035] shrink-0">
          <Server size={14} className="text-sp-green" />
          <span className="text-sp-green font-mono text-xs font-semibold tracking-wide">SIP TRACE</span>
          <span className="text-[10px] text-white/35 font-mono">{filtered.length}/{localLogs.length} msgs</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/5 rounded-xl p-0.5">
              {(["all", "sent", "received"] as DirFilter[]).map(d => <button key={d} onClick={() => setDirFilter(d)} className={`text-[10px] px-2 py-1 rounded-lg font-mono transition-colors ${dirFilter === d ? "bg-white/15 text-white" : "text-white/45 hover:text-white/70"}`}>{d === "all" ? "todos" : d === "sent" ? "→ env" : "← rec"}</button>)}
            </div>
            <div className="flex items-center gap-1 bg-white/5 rounded-xl px-2 py-1"><Filter size={10} className="text-white/35" /><input value={methodFilter} onChange={e => setMethodFilter(e.target.value)} placeholder="INVITE, 200…" className="bg-transparent text-[10px] font-mono text-white/70 placeholder:text-white/25 outline-none w-24" /></div>
            <button onClick={() => setLocalLogs([])} className="text-white/35 hover:text-white/70" title="Limpar trace"><Trash2 size={14} /></button>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-black/15 shrink-0"><span className="font-mono text-[10px] text-white/25 w-4"/><span className="font-mono text-[10px] text-white/25 w-24">MÉTODO</span><span className="font-mono text-[10px] text-white/25 flex-1">DESCRIÇÃO</span><span className="font-mono text-[10px] text-white/25 w-16 text-right">HORA</span></div>
        <div className="flex-1 overflow-y-auto">{filtered.length === 0 ? <div className="flex items-center justify-center h-full text-white/25 font-mono text-xs">{localLogs.length === 0 ? "aguardando mensagens SIP…" : "nenhuma mensagem corresponde ao filtro"}</div> : filtered.map(entry => <SipRow key={entry.id} entry={entry} expanded={expanded === entry.id} onToggle={() => setExpanded(prev => prev === entry.id ? null : entry.id)} />)}</div>
      </div>
    </div>
  );
}

function StatusCard({ title, icon, tone, children }: { title: string; icon: React.ReactNode; tone: "green" | "amber" | "blue" | "violet"; children: React.ReactNode }) {
  const color = tone === "green" ? "text-sp-green bg-sp-green/10 border-sp-green/25" : tone === "amber" ? "text-sp-amber bg-sp-amber/10 border-sp-amber/25" : tone === "blue" ? "text-sp-blue bg-sp-blue/10 border-sp-blue/25" : "text-sp-violet bg-sp-violet/10 border-sp-violet/25";
  return <section className={`rounded-3xl border p-4 ${color}`}><div className="flex items-center justify-between mb-3"><span className="text-xs text-sp-muted font-black uppercase tracking-wide">{title}</span>{icon}</div>{children}</section>;
}
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="flex justify-between gap-2 text-xs mt-1"><span className="text-sp-muted">{label}</span><span className={`text-sp-text font-semibold truncate ${mono ? "font-mono" : ""}`}>{value}</span></div>; }
function Info({ label, ok }: { label: string; ok: boolean }) { return <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2 flex justify-between"><span className="text-sp-muted">{label}</span><span className={ok ? "text-sp-green font-bold" : "text-sp-red font-bold"}>{ok ? "OK" : "Falha"}</span></div>; }
function InfoText({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2 flex justify-between"><span className="text-sp-muted">{label}</span><span className="text-sp-text font-bold truncate">{value}</span></div>; }

function SipRow({ entry, expanded, onToggle }: { entry: SipLogEntry; expanded: boolean; onToggle: () => void }) {
  const label = entry.method || (entry.statusCode ? `${entry.statusCode}` : "?");
  const desc = entry.statusText || entry.method || "";
  const timeStr = new Date(entry.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const labelColor = entry.method ? entry.direction === "sent" ? "text-cyan-300" : "text-sp-blue" : entry.statusCode && entry.statusCode >= 200 && entry.statusCode < 300 ? "text-sp-green" : entry.statusCode && entry.statusCode >= 400 ? "text-sp-red" : "text-sp-amber";
  const arrow = entry.direction === "sent" ? "→" : "←";
  return <div><button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.045] transition-colors text-left border-b border-white/[0.04] group"><span className="font-mono text-xs w-4 shrink-0 text-white/35">{arrow}</span><span className={`font-mono text-xs font-bold w-24 shrink-0 ${labelColor}`}>{label}</span><span className="font-mono text-[11px] text-white/50 flex-1 truncate">{desc}</span><span className="font-mono text-[10px] text-white/30 w-16 text-right shrink-0">{timeStr}</span><span className="text-white/25 group-hover:text-white/50 ml-1 shrink-0">{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span></button>{expanded && <div className="px-3 py-3 bg-black/35 border-b border-white/[0.06]"><pre className="font-mono text-[10px] text-green-200/75 whitespace-pre-wrap break-all leading-5 max-h-64 overflow-y-auto">{entry.content}</pre></div>}</div>;
}
