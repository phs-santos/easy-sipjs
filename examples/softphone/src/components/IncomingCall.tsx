import { Phone, PhoneOff, Waves } from "lucide-react";
import type { CallerInfo } from "../hooks/useSoftphone";

interface Props { callerInfo: CallerInfo; onAnswer: () => void; onReject: () => void; }

export function IncomingCall({ callerInfo, onAnswer, onReject }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/72 backdrop-blur-xl p-5">
      <div className="relative w-full max-w-sm sp-card p-7 text-center overflow-hidden">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-sp-green/20 rounded-full blur-3xl" />
        <div className="relative">
          <div className="mx-auto mb-5 w-20 h-20 rounded-[2rem] bg-sp-green/12 border border-sp-green/25 flex items-center justify-center text-sp-green animate-ring">
            <Phone size={32} />
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sp-blue/10 border border-sp-blue/20 text-sp-blue text-xs font-black uppercase tracking-wider">
            <Waves size={13}/> Chamada recebida
          </div>
          <p className="text-sp-text text-3xl font-black mt-4 truncate">{callerInfo.name || callerInfo.number}</p>
          {callerInfo.name && <p className="text-sp-muted text-sm mt-1">{callerInfo.number}</p>}
          <p className="text-sp-muted text-sm mt-4">Atenda para iniciar áudio WebRTC seguro.</p>

          <div className="grid grid-cols-2 gap-4 mt-7">
            <button onClick={onReject} className="group flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-[1.7rem] bg-sp-red text-white flex items-center justify-center group-hover:bg-red-400 transition-all shadow-lg shadow-sp-red/25">
                <PhoneOff size={25} />
              </div>
              <span className="text-xs text-sp-muted font-semibold">Rejeitar</span>
            </button>
            <button onClick={onAnswer} className="group flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-[1.7rem] bg-gradient-to-br from-sp-emerald to-sp-green text-[#04130a] flex items-center justify-center group-hover:brightness-110 transition-all shadow-success">
                <Phone size={25} />
              </div>
              <span className="text-xs text-sp-muted font-semibold">Atender</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
