import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft, BarChart2, ChevronDown, ChevronRight, Hash, Mic, MicOff,
  Monitor, Pause, Phone, PhoneCall, PhoneOff, Play, Signal, Terminal, Volume2, VolumeX,
} from "lucide-react";
import type { CallQualitySnapshot, CallStats } from "easy-sipjs";
import type { SessionState } from "../hooks/useSoftphone";
import type { CallRecord, SipLogEntry } from "../types";

interface Props {
  sessionState: SessionState;
  callRecord?: CallRecord;
  sipLogs: SipLogEntry[];
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onSendDTMF: (tone: string) => void;
  onTransfer: (target: string) => void;
  onToggleScreenShare: () => void;
  onSetVolume: (v: number) => void;
  onFetchStats: () => Promise<CallStats | undefined>;
  onFetchQuality?: () => Promise<CallQualitySnapshot | undefined>;
  onNewCall?: (destination: string) => void;
}

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export function ActiveCall({
  sessionState, callRecord, sipLogs,
  onHangup, onToggleMute, onToggleHold,
  onSendDTMF, onTransfer, onToggleScreenShare, onSetVolume, onFetchStats, onFetchQuality,
  onNewCall,
}: Props) {
  const [duration, setDuration] = useState(0);
  const [showDTMF, setShowDTMF] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showNewCall, setShowNewCall] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [transferTarget, setTransferTarget] = useState("");
  const [newCallTarget, setNewCallTarget] = useState("");
  const [volume, setVolumeState] = useState(1);
  const [stats, setStats] = useState<CallStats | undefined>();
  const [quality, setQuality] = useState<CallQualitySnapshot | undefined>();
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setDuration(sessionState.session.getCallDuration()), 1000);
    return () => clearInterval(t);
  }, [sessionState.session]);

  useEffect(() => {
    if (!showStats) return;
    const refresh = async () => {
      setStats(await onFetchStats());
      if (onFetchQuality) setQuality(await onFetchQuality());
    };
    const t = setInterval(refresh, 1500);
    void refresh();
    return () => clearInterval(t);
  }, [showStats, onFetchStats, onFetchQuality]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const peerLabel = callRecord?.displayName || callRecord?.number || "Chamada ativa";
  const qualityTone = useMemo(() => getQualityTone(quality?.level), [quality]);

  const handleVolume = (v: number) => { setVolumeState(v); onSetVolume(v); };

  const handleTransfer = () => {
    if (!transferTarget.trim()) return;
    onTransfer(transferTarget.trim());
    setTransferTarget("");
    setShowTransfer(false);
  };

  const handleNewCall = () => {
    if (!newCallTarget.trim() || !onNewCall) return;
    onNewCall(newCallTarget.trim());
    setNewCallTarget("");
    setShowNewCall(false);
  };

  return (
    <div className={`grid gap-4 h-full ${showTrace ? "xl:grid-cols-[23rem_minmax(0,1fr)]" : "max-w-xl mx-auto"}`}>
      <div className="sp-card p-5 md:p-6 text-center flex flex-col min-h-[680px]">
        <div className="relative mx-auto mb-4">
          <div className="absolute inset-0 rounded-full bg-sp-green/25 blur-xl" />
          <div className="relative flex items-center justify-center w-20 h-20 rounded-[2rem] bg-gradient-to-br from-sp-emerald to-sp-green shadow-success text-[#04130a]">
            {sessionState.isOnHold ? <Pause size={30} /> : <Phone size={30} />}
          </div>
        </div>

        <p className="text-sp-muted text-xs uppercase tracking-[0.24em] font-semibold">
          {sessionState.isOnHold ? "Chamada em espera" : "Chamada conectada"}
        </p>
        <p className="text-sp-text text-2xl font-black truncate mt-1">{peerLabel}</p>
        <p className="text-sp-blue text-3xl font-mono font-bold mt-3">{sessionState.isOnHold ? "hold" : fmt(duration)}</p>

        <div className={`mt-5 rounded-2xl border px-4 py-3 text-left ${qualityTone.box}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Signal size={16} className={qualityTone.text} />
              <span className="text-sm font-bold">Qualidade da chamada</span>
            </div>
            <span className={`text-xs font-black uppercase ${qualityTone.text}`}>{quality?.level ?? "medindo"}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-black/20 overflow-hidden">
            <div className={`h-full rounded-full ${qualityTone.bar}`} style={{ width: `${quality?.score ?? 62}%` }} />
          </div>
          <p className="text-xs text-sp-muted mt-2 line-clamp-2">{quality?.recommendation ?? "Coletando jitter, perda e latência via WebRTC stats."}</p>
        </div>

        <div className="grid grid-cols-4 gap-3 mt-6">
          <ControlButton active={sessionState.isMuted} onClick={onToggleMute}
            icon={sessionState.isMuted ? <MicOff size={18} /> : <Mic size={18} />} label="Mudo" tone="red" />
          <ControlButton active={sessionState.isOnHold} onClick={onToggleHold}
            icon={sessionState.isOnHold ? <Play size={18} /> : <Pause size={18} />} label="Espera" tone="amber" />
          <ControlButton active={showDTMF} onClick={() => setShowDTMF(v => !v)} icon={<Hash size={18} />} label="DTMF" />
          <ControlButton active={sessionState.isSharingScreen} onClick={onToggleScreenShare} icon={<Monitor size={18} />} label="Tela" />
          <ControlButton active={showTransfer} onClick={() => setShowTransfer(v => !v)} icon={<ArrowRightLeft size={18} />} label="Transfer" />
          {onNewCall && <ControlButton active={showNewCall} onClick={() => setShowNewCall(v => !v)} icon={<PhoneCall size={18} />} label="Nova" />}
          <ControlButton active={showStats} onClick={() => setShowStats(v => !v)} icon={<BarChart2 size={18} />} label="Stats" />
          <ControlButton active={showTrace} onClick={() => setShowTrace(v => !v)} icon={<Terminal size={18} />} label="SIP" />
        </div>

        <div className="flex items-center gap-2 mt-5 px-1">
          <VolumeX size={14} className="text-sp-muted shrink-0" />
          <input type="range" min={0} max={2} step={0.05} value={volume} onChange={e => handleVolume(parseFloat(e.target.value))} className="flex-1 accent-sp-blue" />
          <Volume2 size={14} className="text-sp-muted shrink-0" />
        </div>

        {showDTMF && (
          <div className="grid grid-cols-3 gap-2 mt-5">
            {DTMF_KEYS.map(k => (
              <button key={k} onClick={() => onSendDTMF(k)} className="sp-kbd-button aspect-square text-lg font-bold text-sp-text">
                {k}
              </button>
            ))}
          </div>
        )}

        {showTransfer && <InlineAction value={transferTarget} setValue={setTransferTarget} placeholder="Destino da transferência" onSubmit={handleTransfer} icon={<ArrowRightLeft size={14} />} />}
        {showNewCall && onNewCall && <InlineAction value={newCallTarget} setValue={setNewCallTarget} placeholder="Número para nova chamada" onSubmit={handleNewCall} icon={<Phone size={14} />} />}

        {showStats && stats && (
          <div className="mt-5 text-left sp-panel p-3 text-xs text-sp-muted space-y-1.5">
            <Stat label="Codec" value={stats.codec || "—"} />
            <Stat label="Jitter" value={`${(stats.jitter * 1000).toFixed(1)} ms`} />
            <Stat label="Perda" value={`${stats.packetLoss.toFixed(2)}%`} />
            <Stat label="RTT" value={`${(stats.roundTripTime * 1000).toFixed(0)} ms`} />
            <Stat label="TX" value={`${(stats.bytesSent / 1024).toFixed(1)} KB`} />
            <Stat label="RX" value={`${(stats.bytesReceived / 1024).toFixed(1)} KB`} />
          </div>
        )}

        <button onClick={onHangup} className="w-full mt-auto py-3.5 rounded-2xl bg-sp-red hover:bg-red-400 text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-sp-red/20 active:scale-[0.99]">
          <PhoneOff size={17} />
          Desligar chamada
        </button>
      </div>

      {showTrace && (
        <div className="flex-1 flex flex-col bg-[#050914]/95 border border-white/10 rounded-3xl overflow-hidden shadow-soft min-h-[680px]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/[0.035]">
            <Terminal size={14} className="text-sp-green" />
            <span className="text-sp-green font-mono text-xs font-semibold tracking-wide">SIP TRACE SEGURO</span>
            <span className="ml-auto text-[10px] text-white/35 font-mono">{sipLogs.length} msgs</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-black/15">
            <span className="font-mono text-[10px] text-white/25 w-4 shrink-0" />
            <span className="font-mono text-[10px] text-white/25 w-24 shrink-0">MÉTODO</span>
            <span className="font-mono text-[10px] text-white/25 flex-1">DESCRIÇÃO</span>
            <span className="font-mono text-[10px] text-white/25 w-16 text-right shrink-0">HORA</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sipLogs.length === 0 && <div className="flex items-center justify-center h-full text-white/25 font-mono text-xs">aguardando mensagens SIP...</div>}
            {sipLogs.map(entry => <SipRow key={entry.id} entry={entry} expanded={expandedLog === entry.id} onToggle={() => setExpandedLog(prev => prev === entry.id ? null : entry.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function InlineAction({ value, setValue, placeholder, onSubmit, icon }: { value: string; setValue: (v: string) => void; placeholder: string; onSubmit: () => void; icon: React.ReactNode }) {
  return (
    <div className="flex gap-2 mt-5">
      <input className="sp-input" placeholder={placeholder} value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === "Enter" && onSubmit()} autoFocus />
      <button onClick={onSubmit} className="px-4 rounded-xl bg-sp-blue text-[#03131d] text-sm font-black">{icon}</button>
    </div>
  );
}

function SipRow({ entry, expanded, onToggle }: { entry: SipLogEntry; expanded: boolean; onToggle: () => void }) {
  const label = entry.method || (entry.statusCode ? `${entry.statusCode}` : "?");
  const desc = entry.statusText || entry.method || "";
  const timeStr = new Date(entry.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const labelColor = entry.method
    ? entry.direction === "sent" ? "text-cyan-300" : "text-sp-blue"
    : entry.statusCode && entry.statusCode >= 200 && entry.statusCode < 300 ? "text-sp-green" : entry.statusCode && entry.statusCode >= 400 ? "text-sp-red" : "text-sp-amber";
  const arrow = entry.direction === "sent" ? "→" : "←";
  const arrowColor = entry.direction === "sent" ? "text-cyan-500" : "text-sp-blue";

  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.045] transition-colors text-left border-b border-white/[0.04] group">
        <span className={`font-mono text-xs w-4 shrink-0 ${arrowColor}`}>{arrow}</span>
        <span className={`font-mono text-xs font-bold w-24 shrink-0 ${labelColor}`}>{label}</span>
        <span className="font-mono text-[11px] text-white/48 flex-1 truncate">{desc}</span>
        <span className="font-mono text-[10px] text-white/30 w-16 text-right shrink-0">{timeStr}</span>
        <span className="text-white/25 group-hover:text-white/50 ml-1 shrink-0">{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
      </button>
      {expanded && (
        <div className="px-3 py-3 bg-black/35 border-b border-white/[0.06]">
          <pre className="font-mono text-[10px] text-green-200/75 whitespace-pre-wrap break-all leading-5 max-h-64 overflow-y-auto">{entry.content}</pre>
        </div>
      )}
    </div>
  );
}

function ControlButton({ active, onClick, icon, label, tone = "green" }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; tone?: "green" | "red" | "amber" }) {
  const activeClass = tone === "red" ? "bg-sp-red text-white" : tone === "amber" ? "bg-sp-amber text-[#1c1200]" : "bg-sp-green text-[#04130a]";
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 group">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${active ? activeClass : "bg-white/[0.055] border border-white/10 text-sp-text group-hover:bg-white/[0.09] group-hover:border-sp-blue/30"}`}>{icon}</div>
      <span className="text-[10px] text-sp-muted font-medium">{label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span>{label}</span><span className="text-sp-text font-medium">{value}</span></div>;
}

function getQualityTone(level?: CallQualitySnapshot["level"]) {
  if (level === "bad") return { box: "bg-sp-red/10 border-sp-red/30", text: "text-sp-red", bar: "bg-sp-red" };
  if (level === "warning") return { box: "bg-sp-amber/10 border-sp-amber/30", text: "text-sp-amber", bar: "bg-sp-amber" };
  if (level === "good") return { box: "bg-sp-blue/10 border-sp-blue/30", text: "text-sp-blue", bar: "bg-sp-blue" };
  return { box: "bg-sp-green/10 border-sp-green/30", text: "text-sp-green", bar: "bg-sp-green" };
}
