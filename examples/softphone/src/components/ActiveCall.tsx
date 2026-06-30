import { useEffect, useState } from "react";
import {
  Mic, MicOff, Pause, Play, Hash, Monitor, ArrowRightLeft,
  BarChart2, PhoneOff, Volume2, VolumeX, Phone, Terminal, ChevronDown, ChevronRight,
} from "lucide-react";
import type { CallStats } from "easy-sipjs";
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
}

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export function ActiveCall({
  sessionState, callRecord, sipLogs,
  onHangup, onToggleMute, onToggleHold,
  onSendDTMF, onTransfer, onToggleScreenShare, onSetVolume, onFetchStats,
}: Props) {
  const [duration, setDuration] = useState(0);
  const [showDTMF, setShowDTMF] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [transferTarget, setTransferTarget] = useState("");
  const [volume, setVolumeState] = useState(1);
  const [stats, setStats] = useState<CallStats | undefined>();
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setDuration(sessionState.session.getCallDuration()), 1000);
    return () => clearInterval(t);
  }, [sessionState.session]);

  useEffect(() => {
    if (!showStats) return;
    const t = setInterval(() => onFetchStats().then(setStats), 1500);
    onFetchStats().then(setStats);
    return () => clearInterval(t);
  }, [showStats, onFetchStats]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const handleVolume = (v: number) => { setVolumeState(v); onSetVolume(v); };

  const handleTransfer = () => {
    if (!transferTarget.trim()) return;
    onTransfer(transferTarget.trim());
    setTransferTarget("");
    setShowTransfer(false);
  };

  return (
    <div className={`flex gap-4 h-full ${showTrace ? "" : "max-w-md mx-auto"}`}>
      {/* ── Left: call controls ── */}
      <div className={`bg-sp-surface border border-sp-border rounded-2xl p-6 text-center flex flex-col ${showTrace ? "w-72 shrink-0" : "flex-1"}`}>
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-sp-green/10 border-2 border-sp-green mx-auto mb-3">
          {sessionState.isOnHold
            ? <Pause size={24} className="text-sp-green" />
            : <Phone size={24} className="text-sp-green" />}
        </div>
        <p className="text-sp-text text-xl font-bold truncate">
          {callRecord?.displayName || callRecord?.number || "Chamada ativa"}
        </p>
        <p className="text-sp-muted text-sm mt-1">
          {sessionState.isOnHold ? "Em espera" : fmt(duration)}
        </p>

        <div className="flex justify-center gap-3 mt-6 flex-wrap">
          <ControlButton active={sessionState.isMuted} onClick={onToggleMute}
            icon={sessionState.isMuted ? <MicOff size={18} /> : <Mic size={18} />} label="Mudo" />
          <ControlButton active={sessionState.isOnHold} onClick={onToggleHold}
            icon={sessionState.isOnHold ? <Play size={18} /> : <Pause size={18} />} label="Espera" />
          <ControlButton active={showDTMF} onClick={() => setShowDTMF(v => !v)}
            icon={<Hash size={18} />} label="DTMF" />
          <ControlButton active={sessionState.isSharingScreen} onClick={onToggleScreenShare}
            icon={<Monitor size={18} />} label="Tela" />
          <ControlButton active={showTransfer} onClick={() => setShowTransfer(v => !v)}
            icon={<ArrowRightLeft size={18} />} label="Transfer" />
          <ControlButton active={showStats} onClick={() => setShowStats(v => !v)}
            icon={<BarChart2 size={18} />} label="Stats" />
          <ControlButton active={showTrace} onClick={() => setShowTrace(v => !v)}
            icon={<Terminal size={18} />} label="SIP" />
        </div>

        <div className="flex items-center gap-2 mt-5 px-2">
          <VolumeX size={14} className="text-sp-muted shrink-0" />
          <input
            type="range" min={0} max={2} step={0.05} value={volume}
            onChange={e => handleVolume(parseFloat(e.target.value))}
            className="flex-1 accent-sp-green"
          />
          <Volume2 size={14} className="text-sp-muted shrink-0" />
        </div>

        {showDTMF && (
          <div className="grid grid-cols-3 gap-1.5 mt-5">
            {DTMF_KEYS.map(k => (
              <button key={k} onClick={() => onSendDTMF(k)}
                className="aspect-square rounded-lg bg-sp-bg border border-sp-border text-sp-text hover:bg-white/5 active:scale-95 transition-all text-sm">
                {k}
              </button>
            ))}
          </div>
        )}

        {showTransfer && (
          <div className="flex gap-2 mt-5">
            <input className="sp-input" placeholder="Destino do transfer"
              value={transferTarget} onChange={e => setTransferTarget(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleTransfer()} autoFocus />
            <button onClick={handleTransfer}
              className="px-3 rounded-lg bg-sp-blue text-white text-sm font-medium">
              <ArrowRightLeft size={14} />
            </button>
          </div>
        )}

        {showStats && stats && (
          <div className="mt-5 text-left bg-sp-bg border border-sp-border rounded-lg p-3 text-xs text-sp-muted space-y-1">
            <Stat label="Codec" value={stats.codec || "—"} />
            <Stat label="Jitter" value={`${(stats.jitter * 1000).toFixed(1)} ms`} />
            <Stat label="Perda" value={`${stats.packetLoss.toFixed(2)}%`} />
            <Stat label="RTT" value={`${(stats.roundTripTime * 1000).toFixed(0)} ms`} />
            <Stat label="TX" value={`${(stats.bytesSent / 1024).toFixed(1)} KB`} />
            <Stat label="RX" value={`${(stats.bytesReceived / 1024).toFixed(1)} KB`} />
          </div>
        )}

        <button onClick={onHangup}
          className="w-full mt-auto pt-5 py-3 rounded-lg bg-sp-red hover:bg-red-400 text-white font-semibold transition-colors flex items-center justify-center gap-2">
          <PhoneOff size={16} />
          Desligar
        </button>
      </div>

      {/* ── Right: SIP trace panel ── */}
      {showTrace && (
        <div className="flex-1 flex flex-col bg-[#0c0c0c] border border-sp-border rounded-2xl overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-[#111]">
            <Terminal size={13} className="text-green-400" />
            <span className="text-green-400 font-mono text-xs font-semibold tracking-wide">SIP TRACE</span>
            <span className="ml-auto text-[10px] text-white/30 font-mono">{sipLogs.length} msgs</span>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5 bg-[#0f0f0f]">
            <span className="font-mono text-[10px] text-white/20 w-4 shrink-0"></span>
            <span className="font-mono text-[10px] text-white/20 w-24 shrink-0">MÉTODO / STATUS</span>
            <span className="font-mono text-[10px] text-white/20 flex-1">DESCRIÇÃO</span>
            <span className="font-mono text-[10px] text-white/20 w-16 text-right shrink-0">HORA</span>
          </div>

          {/* Log rows */}
          <div className="flex-1 overflow-y-auto">
            {sipLogs.length === 0 && (
              <div className="flex items-center justify-center h-full text-white/20 font-mono text-xs">
                aguardando mensagens SIP...
              </div>
            )}
            {sipLogs.map(entry => (
              <SipRow
                key={entry.id}
                entry={entry}
                expanded={expandedLog === entry.id}
                onToggle={() => setExpandedLog(prev => prev === entry.id ? null : entry.id)}
              />
            ))}
          </div>
        </div>
      )}
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
          <pre className="font-mono text-[10px] text-green-300/70 whitespace-pre-wrap break-all leading-5 max-h-64 overflow-y-auto">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function ControlButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
        active ? "bg-sp-green text-black" : "bg-sp-bg border border-sp-border text-sp-text hover:bg-white/5"
      }`}>
        {icon}
      </div>
      <span className="text-[10px] text-sp-muted">{label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="text-sp-text">{value}</span>
    </div>
  );
}
