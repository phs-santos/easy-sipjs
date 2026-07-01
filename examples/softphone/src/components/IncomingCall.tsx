import { Phone, PhoneOff } from "lucide-react";
import type { CallerInfo } from "../hooks/useSoftphone";

interface Props {
  callerInfo: CallerInfo;
  onAnswer: () => void;
  onReject: () => void;
}

export function IncomingCall({ callerInfo, onAnswer, onReject }: Props) {
  console.log(`[easy-sipjs][4] IncomingCall RENDERED — from=${callerInfo.number}`);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-sp-surface border border-sp-border rounded-2xl p-8 w-80 text-center shadow-2xl">
        <div className="animate-ring flex items-center justify-center w-16 h-16 rounded-full bg-sp-green/10 border-2 border-sp-green mx-auto mb-4">
          <Phone size={28} className="text-sp-green" />
        </div>
        <p className="text-sp-muted text-sm mb-1">Chamada recebida</p>
        <p className="text-sp-text text-2xl font-bold mb-1 truncate">
          {callerInfo.name || callerInfo.number}
        </p>
        {callerInfo.name && (
          <p className="text-sp-muted text-sm mb-6">{callerInfo.number}</p>
        )}
        {!callerInfo.name && <div className="mb-6" />}

        <div className="flex gap-6 justify-center">
          <button onClick={onReject} className="flex flex-col items-center gap-1 group">
            <div className="w-16 h-16 rounded-full bg-sp-red flex items-center justify-center group-hover:bg-red-400 transition-colors">
              <PhoneOff size={24} className="text-white" />
            </div>
            <span className="text-xs text-sp-muted">Rejeitar</span>
          </button>

          <button onClick={onAnswer} className="flex flex-col items-center gap-1 group">
            <div className="w-16 h-16 rounded-full bg-sp-green flex items-center justify-center group-hover:bg-green-400 transition-colors">
              <Phone size={24} className="text-black" />
            </div>
            <span className="text-xs text-sp-muted">Atender</span>
          </button>
        </div>
      </div>
    </div>
  );
}
