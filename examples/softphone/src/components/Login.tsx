import { useState } from "react";
import { Eye, EyeOff, Wifi } from "lucide-react";
import type { StoredCredentials } from "../types";

interface Props {
  onConnect: (credentials: StoredCredentials) => void;
}

export function Login({ onConnect }: Props) {
  const [form, setForm] = useState<StoredCredentials>({
    domain: "", phone: "", secret: "", nameexten: "", server: "", debug: false, provider: "sipjs",
  });
  const [showPassword, setShowPassword] = useState(false);

  const set = (key: keyof StoredCredentials, value: any) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.domain || !form.phone || !form.secret || !form.server) return;
    onConnect(form);
  };

  return (
    <div className="min-h-screen bg-sp-bg flex">
      {/* left panel */}
      <div className="hidden lg:flex flex-col justify-between w-80 bg-sp-surface border-r border-sp-border p-10">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-xl bg-sp-green flex items-center justify-center">
              <Wifi size={18} className="text-black" />
            </div>
            <span className="font-bold text-sp-text text-lg">SoftPhone</span>
          </div>
          <p className="text-sp-muted text-sm leading-relaxed">
            Softphone WebRTC sobre SIP. Suporta chamadas de voz, mensagens, transferência, hold e mais.
          </p>
        </div>
        <div className="space-y-3 text-xs text-sp-muted">
          <Pill>Baseado em SIP.js / JsSIP</Pill>
          <Pill>Compatível com Asterisk, FreePBX, Kamailio</Pill>
          <Pill>Dados persistidos localmente</Pill>
        </div>
      </div>

      {/* right panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1 lg:hidden">
              <div className="w-7 h-7 rounded-lg bg-sp-green flex items-center justify-center">
                <Wifi size={14} className="text-black" />
              </div>
              <span className="font-bold text-sp-text">SoftPhone</span>
            </div>
            <h1 className="text-2xl font-bold text-sp-text">Conectar ao servidor SIP</h1>
            <p className="text-sp-muted text-sm mt-1">
              As credenciais ficam salvas para reconexão automática.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Domínio">
                <input className="sp-input" value={form.domain}
                  onChange={e => set("domain", e.target.value)}
                  placeholder="pbx.example.com" required />
              </Field>
              <Field label="Ramal">
                <input className="sp-input" value={form.phone}
                  onChange={e => set("phone", e.target.value)}
                  placeholder="1001" required />
              </Field>
            </div>

            <Field label="Usuário de auth (opcional)">
              <input className="sp-input" value={form.authorizationUsername || ""}
                onChange={e => set("authorizationUsername", e.target.value || undefined)}
                placeholder="Igual ao ramal (PJSIP: use o nome do endpoint)" />
            </Field>

            <Field label="Nome de exibição (opcional)">
              <input className="sp-input" value={form.nameexten}
                onChange={e => set("nameexten", e.target.value)} placeholder="João Silva" />
            </Field>

            <Field label="Senha">
              <div className="relative">
                <input className="sp-input pr-10" type={showPassword ? "text" : "password"}
                  value={form.secret} onChange={e => set("secret", e.target.value)} required />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text">
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>

            <Field label="WebSocket Server">
              <input className="sp-input" value={form.server}
                onChange={e => set("server", e.target.value)}
                placeholder="wss://pbx.example.com:8089/ws" required />
            </Field>

            <Field label="Provider SIP">
              <div className="flex gap-2">
                {(["sipjs", "jssip"] as const).map(p => (
                  <button key={p} type="button" onClick={() => set("provider", p)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      (form.provider || "sipjs") === p
                        ? "bg-sp-blue/20 border-sp-blue text-sp-blue"
                        : "bg-sp-surface border-sp-border text-sp-muted hover:text-sp-text"
                    }`}>
                    {p === "sipjs" ? "SIP.js" : "JsSIP"}
                  </button>
                ))}
              </div>
            </Field>

            <label className="flex items-center gap-2 text-sm text-sp-muted cursor-pointer">
              <input type="checkbox" className="accent-sp-green" checked={form.debug}
                onChange={e => set("debug", e.target.checked)} />
              Modo debug
            </label>

            <button type="submit"
              className="w-full bg-sp-green hover:bg-green-400 text-black font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-2">
              <Wifi size={16} /> Conectar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-sp-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-sp-green shrink-0" />
      {children}
    </div>
  );
}
