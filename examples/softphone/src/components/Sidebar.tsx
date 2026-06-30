import { Phone, Clock, MessageSquare, Settings, LogOut } from "lucide-react";
import type { SipConnectionState } from "easy-sipjs";
import type { ActiveView } from "../types";

interface Props {
  activeView: ActiveView;
  onChangeView: (v: ActiveView) => void;
  connectionState: SipConnectionState;
  unreadMessages: number;
  phone: string;
  onLogout: () => void;
}

const STATE_COLOR: Record<SipConnectionState, string> = {
  registered: "bg-sp-green",
  connected: "bg-sp-amber",
  connecting: "bg-sp-amber",
  disconnected: "bg-sp-red",
  error: "bg-sp-red",
};

const STATE_LABEL: Record<SipConnectionState, string> = {
  registered: "Registrado",
  connected: "Conectado",
  connecting: "Conectando...",
  disconnected: "Desconectado",
  error: "Erro",
};

const NAV: { view: ActiveView; icon: React.ReactNode; label: string }[] = [
  { view: "dialer",   icon: <Phone size={16} />,         label: "Discador"  },
  { view: "history",  icon: <Clock size={16} />,         label: "Histórico" },
  { view: "messages", icon: <MessageSquare size={16} />, label: "Mensagens" },
  { view: "settings", icon: <Settings size={16} />,      label: "Ajustes"   },
];

export function Sidebar({ activeView, onChangeView, connectionState, unreadMessages, phone, onLogout }: Props) {
  return (
    <aside className="w-56 bg-sp-surface border-r border-sp-border flex flex-col">
      <div className="p-4 border-b border-sp-border">
        <div className="flex items-center gap-2">
          <Phone size={18} className="text-sp-green" />
          <span className="font-bold text-sp-text">SoftPhone</span>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${STATE_COLOR[connectionState]}`} />
          <span className="text-sp-muted">{STATE_LABEL[connectionState]}</span>
        </div>
        <div className="text-sp-muted text-xs mt-1 truncate">Ramal {phone}</div>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(item => (
          <button
            key={item.view}
            onClick={() => onChangeView(item.view)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors relative ${
              activeView === item.view
                ? "bg-sp-green/10 text-sp-green"
                : "text-sp-muted hover:bg-white/5 hover:text-sp-text"
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.view === "messages" && unreadMessages > 0 && (
              <span className="ml-auto bg-sp-red text-white text-[10px] rounded-full px-1.5 py-0.5">
                {unreadMessages}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-2 border-t border-sp-border">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sp-muted hover:bg-sp-red/10 hover:text-sp-red transition-colors"
        >
          <LogOut size={16} />
          <span>Desconectar</span>
        </button>
      </div>
    </aside>
  );
}
