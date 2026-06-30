import { useMemo, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import type { MessageRecord } from "../types";

interface Props {
  messages: MessageRecord[];
  onSend: (to: string, body: string) => void;
  onMarkRead: (peer: string) => void;
  onClear: () => void;
}

export function Messages({ messages, onSend, onMarkRead, onClear }: Props) {
  const peers = useMemo(() => {
    const map = new Map<string, MessageRecord[]>();
    for (const m of messages) {
      if (!map.has(m.peer)) map.set(m.peer, []);
      map.get(m.peer)!.push(m);
    }
    return Array.from(map.entries()).sort(
      (a, b) => new Date(b[1][0].timestamp).getTime() - new Date(a[1][0].timestamp).getTime()
    );
  }, [messages]);

  const [selectedPeer, setSelectedPeer] = useState<string | undefined>(peers[0]?.[0]);
  const [newPeer, setNewPeer] = useState("");
  const [body, setBody] = useState("");

  const thread = selectedPeer ? messages.filter(m => m.peer === selectedPeer).reverse() : [];

  const handleSelectPeer = (peer: string) => {
    setSelectedPeer(peer);
    onMarkRead(peer);
  };

  const handleSend = () => {
    const target = selectedPeer || newPeer.trim();
    if (!target || !body.trim()) return;
    onSend(target, body.trim());
    setBody("");
    if (!selectedPeer) { setSelectedPeer(target); setNewPeer(""); }
  };

  return (
    <div className="max-w-4xl mx-auto pt-6 flex gap-4 h-[calc(100vh-8rem)]">
      <div className="w-64 shrink-0 border-r border-sp-border pr-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-sp-text">Mensagens</h2>
          {messages.length > 0 && (
            <button onClick={onClear} className="flex items-center gap-1 text-xs text-sp-muted hover:text-sp-red">
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <input className="sp-input mb-3 text-sm" placeholder="Nova conversa (ramal)"
          value={newPeer} onChange={e => { setNewPeer(e.target.value); setSelectedPeer(undefined); }} />

        {peers.map(([peer, msgs]) => {
          const unread = msgs.some(m => !m.read);
          return (
            <button key={peer} onClick={() => handleSelectPeer(peer)}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${
                selectedPeer === peer ? "bg-sp-green/10 text-sp-green" : "hover:bg-white/5 text-sp-text"
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm truncate">{peer}</span>
                {unread && <span className="w-2 h-2 rounded-full bg-sp-red" />}
              </div>
              <p className="text-xs text-sp-muted truncate">{msgs[0].body}</p>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col">
        {selectedPeer || newPeer ? (
          <>
            <div className="flex-1 overflow-y-auto space-y-2 pb-4">
              {thread.map(m => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                    m.direction === "outbound"
                      ? "bg-sp-green text-black"
                      : "bg-sp-surface border border-sp-border text-sp-text"
                  }`}>
                    {m.body}
                  </div>
                </div>
              ))}
              {thread.length === 0 && <p className="text-sp-muted text-sm text-center mt-12">Nenhuma mensagem ainda.</p>}
            </div>

            <div className="flex gap-2">
              <input className="sp-input" placeholder="Digite uma mensagem..."
                value={body} onChange={e => setBody(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()} />
              <button onClick={handleSend}
                className="px-4 rounded-lg bg-sp-green text-black font-medium flex items-center gap-1">
                <Send size={16} />
              </button>
            </div>
          </>
        ) : (
          <p className="text-sp-muted text-sm text-center mt-12">Selecione ou inicie uma conversa.</p>
        )}
      </div>
    </div>
  );
}
