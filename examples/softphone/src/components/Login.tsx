import { useState } from "react";
import { Eye, EyeOff, Lock, RadioTower, ShieldCheck, Sparkles, Wifi } from "lucide-react";
import type { StoredCredentials } from "../types";

interface Props { onConnect: (credentials: StoredCredentials) => void; }

export function Login({ onConnect }: Props) {
  const [form, setForm] = useState<StoredCredentials>({ domain: "", phone: "", secret: "", nameexten: "", server: "", debug: false, provider: "sipjs" });
  const [showPassword, setShowPassword] = useState(false);

  const set = (key: keyof StoredCredentials, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.domain || !form.phone || !form.secret || !form.server) return;
    onConnect(form);
  };

  return (
    <div className="min-h-screen bg-soft-radial relative overflow-hidden flex items-center justify-center p-5">
      <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="absolute -top-28 -left-24 w-96 h-96 bg-sp-blue/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-0 w-[32rem] h-[32rem] bg-sp-green/14 rounded-full blur-3xl" />

      <div className="relative w-full max-w-6xl grid lg:grid-cols-[1fr_28rem] gap-6 items-stretch">
        <section className="hidden lg:flex sp-card p-9 flex-col justify-between min-h-[680px]">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-13 h-13 rounded-3xl bg-gradient-to-br from-sp-blue to-sp-green flex items-center justify-center shadow-glow">
                <Wifi size={24} className="text-[#04111d]" />
              </div>
              <div>
                <h1 className="font-black text-2xl">SoftPhone Experience</h1>
                <p className="text-xs text-sp-muted uppercase tracking-[0.24em] font-bold">Easy SIP.js Softphone</p>
              </div>
            </div>

            <div className="mt-16 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sp-blue/10 border border-sp-blue/20 text-sp-blue text-xs font-bold uppercase tracking-wider">
                <Sparkles size={13} /> pronto para cliente testar
              </div>
              <h2 className="text-5xl font-black leading-tight mt-5">Conecte, teste e sinta confiança na chamada.</h2>
              <p className="text-sp-muted leading-relaxed mt-5 text-base">
                Interface escura para reduzir fadiga, azul para confiança técnica, verde para ação segura e vermelho reservado apenas para risco/desligamento.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Feature icon={<ShieldCheck size={17}/>} title="Seguro" desc="Logs sensíveis redigidos" />
            <Feature icon={<RadioTower size={17}/>} title="Resiliente" desc="Reconnect + health check" />
            <Feature icon={<Lock size={17}/>} title="Privado" desc="Credenciais locais" />
          </div>
        </section>

        <section className="sp-card p-6 md:p-7">
          <div className="mb-7">
            <div className="lg:hidden flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-sp-blue to-sp-green flex items-center justify-center"><Wifi size={17} className="text-[#04111d]" /></div>
              <span className="font-black text-lg">SoftPhone</span>
            </div>
            <p className="text-xs text-sp-blue uppercase tracking-[0.24em] font-black">Acesso SIP/WebRTC</p>
            <h1 className="text-2xl font-black mt-1">Conectar ao servidor</h1>
            <p className="text-sp-muted text-sm mt-2">Informe apenas o essencial. A biblioteca cuida de registro, refresh, reconexão e mídia.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Domínio"><input className="sp-input" value={form.domain} onChange={e => set("domain", e.target.value)} placeholder="pbx.example.com" required /></Field>
              <Field label="Ramal"><input className="sp-input" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="1001" required /></Field>
            </div>

            <Field label="Usuário de auth" hint="Opcional. Use quando o endpoint PJSIP difere do ramal.">
              <input className="sp-input" value={form.authorizationUsername || ""} onChange={e => set("authorizationUsername", e.target.value || undefined)} placeholder="normalmente igual ao ramal" />
            </Field>

            <Field label="Nome de exibição"><input className="sp-input" value={form.nameexten} onChange={e => set("nameexten", e.target.value)} placeholder="Atendimento PxTalk" /></Field>

            <Field label="Senha SIP">
              <div className="relative">
                <input className="sp-input pr-11" type={showPassword ? "text" : "password"} value={form.secret} onChange={e => set("secret", e.target.value)} required />
                <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </Field>

            <Field label="WebSocket WSS"><input className="sp-input" value={form.server} onChange={e => set("server", e.target.value)} placeholder="wss://pbx.example.com:8089/ws" required /></Field>

            <Field label="Engine SIP">
              <div className="grid grid-cols-2 gap-2">
                {(["sipjs", "jssip"] as const).map(p => (
                  <button key={p} type="button" onClick={() => set("provider", p)} className={`py-3 rounded-2xl text-sm font-bold border transition-all ${
                    (form.provider || "sipjs") === p ? "bg-sp-blue/12 border-sp-blue/40 text-sp-blue shadow-glow" : "bg-white/[0.04] border-white/10 text-sp-muted hover:text-sp-text"
                  }`}>{p === "sipjs" ? "SIP.js recomendado" : "JsSIP fallback"}</button>
                ))}
              </div>
            </Field>

            <label className="flex items-center gap-2 text-sm text-sp-muted cursor-pointer rounded-2xl bg-white/[0.035] border border-white/10 p-3">
              <input type="checkbox" className="accent-sp-blue" checked={form.debug} onChange={e => set("debug", e.target.checked)} />
              Capturar trace SIP para diagnóstico
            </label>

            <button type="submit" className="w-full sp-button-primary py-3.5 flex items-center justify-center gap-2 text-base">
              <Wifi size={17} /> Conectar e abrir softphone
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-sp-muted mb-1.5 font-semibold">{label}</label>{children}{hint && <p className="text-[11px] text-sp-muted/70 mt-1.5">{hint}</p>}</div>;
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return <div className="rounded-3xl bg-white/[0.045] border border-white/10 p-4"><div className="text-sp-blue mb-2">{icon}</div><div className="text-sm font-bold">{title}</div><div className="text-xs text-sp-muted mt-1">{desc}</div></div>;
}
