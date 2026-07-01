import { Activity, Clock, LogOut, MessageSquare, Phone, Settings, Sparkles } from "lucide-react";
import type { SipConnectionState } from "easy-sipjs";
import type { ActiveView } from "../types";

interface Props {
  activeView: ActiveView;
  onChangeView: (v: ActiveView) => void;
  connectionState: SipConnectionState;
  unreadMessages: number;
  phone: string;
  nameexten?: string;
  onLogout: () => void;
}

const STATE_COLOR: Record<SipConnectionState, string> = {
  registered: "bg-sp-green text-sp-green",
  connected: "bg-sp-amber text-sp-amber",
  connecting: "bg-sp-amber text-sp-amber",
  disconnected: "bg-sp-red text-sp-red",
  error: "bg-sp-red text-sp-red",
};

const STATE_LABEL: Record<SipConnectionState, string> = {
  registered: "Pronto para ligar",
  connected: "Conectado",
  connecting: "Conectando…",
  disconnected: "Desconectado",
  error: "Atenção necessária",
};

const NAV: { view: ActiveView; icon: React.ReactNode; label: string; hint: string }[] = [
  { view: "dialer",   icon: <Phone size={17} />,         label: "Discador",  hint: "Ligações" },
  { view: "history",  icon: <Clock size={17} />,         label: "Histórico", hint: "Registro" },
  { view: "messages", icon: <MessageSquare size={17} />, label: "Mensagens", hint: "SIP MESSAGE" },
  { view: "monitor",  icon: <Activity size={17} />,      label: "Monitor",   hint: "Saúde" },
  { view: "settings", icon: <Settings size={17} />,      label: "Ajustes",   hint: "Áudio" },
];

export function Sidebar({ activeView, onChangeView, connectionState, unreadMessages, phone, nameexten, onLogout }: Props) {
  const status = STATE_COLOR[connectionState];
  return (
    <aside className="w-[17rem] hidden md:flex flex-col border-r border-white/10 bg-[#07111f]/82 backdrop-blur-2xl">
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sp-blue to-sp-green flex items-center justify-center shadow-glow">
            <Phone size={20} className="text-[#03131d]" />
          </div>
          <div>
            <span className="font-black text-sp-text text-lg leading-none">SoftPhone</span>
            <div className="text-[10px] text-sp-muted uppercase tracking-[0.18em] font-bold mt-1">WebRTC SDK</div>
          </div>
        </div>

        <div className="mt-5 sp-panel p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className={`sp-status-dot ${status.split(" ")[0]}`} />
            <span className={`font-bold ${status.split(" ")[1]}`}>{STATE_LABEL[connectionState]}</span>
          </div>
          <div className="text-sp-text text-sm font-semibold mt-2 truncate">{nameexten || phone}</div>
          <div className="text-[11px] text-sp-muted truncate">Ramal {phone}</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1.5">
        {NAV.map(item => (
          <button
            key={item.view}
            onClick={() => onChangeView(item.view)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all relative ${
              activeView === item.view
                ? "bg-sp-blue/12 text-sp-text border border-sp-blue/25 shadow-glow"
                : "text-sp-muted border border-transparent hover:bg-white/[0.055] hover:text-sp-text"
            }`}
          >
            <span className={activeView === item.view ? "text-sp-blue" : "text-sp-muted"}>{item.icon}</span>
            <span className="flex-1 text-left">
              <span className="block font-semibold leading-none">{item.label}</span>
              <span className="block text-[10px] text-sp-muted mt-1">{item.hint}</span>
            </span>
            {item.view === "messages" && unreadMessages > 0 && (
              <span className="ml-auto bg-sp-red text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">{unreadMessages}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 text-xs text-sp-muted leading-relaxed">
          <div className="flex items-center gap-1.5 text-sp-blue font-bold mb-1"><Sparkles size={13}/> UX pronta para demonstração</div>
          Azul transmite confiança, verde confirma ação segura e vermelho fica reservado para risco/desligar.
        </div>
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm text-sp-muted hover:bg-sp-red/10 hover:text-sp-red transition-colors">
          <LogOut size={16} />
          <span>Desconectar</span>
        </button>
      </div>
    </aside>
  );
}
