import { useEffect, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Headphones, LogOut, Mic, Music, RefreshCw, Save, ShieldCheck, Stethoscope, Volume2 } from "lucide-react";
import type { SipClient, SoftphoneDevice, SoftphoneDiagnostics } from "easy-sipjs";
import type { DevicePrefs, StoredCredentials } from "../types";

interface Props {
  credentials: StoredCredentials;
  devicePrefs: DevicePrefs;
  client: SipClient;
  onSaveDevicePrefs: (prefs: DevicePrefs) => void;
  onUpdateCredentials: (credentials: StoredCredentials) => Promise<void>;
  onLogout: () => void;
}

export function Settings({ credentials, devicePrefs, client, onSaveDevicePrefs, onUpdateCredentials, onLogout }: Props) {
  const [devices, setDevices] = useState<SoftphoneDevice[]>([]);
  const [prefs, setPrefs] = useState<DevicePrefs>(devicePrefs);
  const [diagnostics, setDiagnostics] = useState<SoftphoneDiagnostics | undefined>();
  const [credForm, setCredForm] = useState<StoredCredentials>(credentials);
  const [showPassword, setShowPassword] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credError, setCredError] = useState<string | undefined>();
  const [credSaved, setCredSaved] = useState(false);

  useEffect(() => { setCredForm(credentials); }, [credentials]);

  useEffect(() => {
    const load = () => client.devices.list().then(setDevices).catch(() => setDevices([]));
    void load();
    const off = client.devices.onChanged(setDevices);
    const stop = client.devices.watch();
    return () => { off(); stop(); };
  }, [client]);

  const microphones = devices.filter(d => d.kind === "microphone");
  const speakers = devices.filter(d => d.kind === "speaker");
  const cameras = devices.filter(d => d.kind === "camera");

  const setCred = (key: keyof StoredCredentials, value: any) => setCredForm(prev => ({ ...prev, [key]: value }));

  const requestPermissions = async () => {
    await client.devices.requestPermissions({ audio: true, video: false });
    setDevices(await client.devices.list());
  };

  const runDiagnostics = async () => setDiagnostics(await client.diagnose());

  const save = () => {
    onSaveDevicePrefs(prefs);
  };

  const saveCredentials = async () => {
    if (!credForm.domain || !credForm.phone || !credForm.secret || !credForm.server) {
      setCredError("Preencha domínio, ramal, senha e servidor.");
      return;
    }
    setCredError(undefined);
    setCredSaved(false);
    setSavingCreds(true);
    try {
      await onUpdateCredentials(credForm);
      setCredSaved(true);
      setTimeout(() => setCredSaved(false), 3000);
    } catch {
      setCredError("Falha ao reconectar com as novas credenciais.");
    } finally {
      setSavingCreds(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem] gap-5">
      <div className="space-y-5">
        <Section title="Conta SIP" icon={<ShieldCheck size={15} />}>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Domínio"><input className="sp-input" value={credForm.domain} onChange={e => setCred("domain", e.target.value)} placeholder="pbx.example.com" /></Field>
            <Field label="Ramal / usuário"><input className="sp-input" value={credForm.phone} onChange={e => setCred("phone", e.target.value)} placeholder="1001" /></Field>
          </div>
          <Field label="Usuário de autenticação" hint="Deixe em branco se igual ao ramal. Use quando o login SIP difere do número.">
            <input className="sp-input" value={credForm.authorizationUsername || ""} onChange={e => setCred("authorizationUsername", e.target.value || undefined)} placeholder="opcional" />
          </Field>
          <Field label="Nome de exibição"><input className="sp-input" value={credForm.nameexten || ""} onChange={e => setCred("nameexten", e.target.value)} placeholder="Atendimento" /></Field>
          <Field label="Senha"><div className="relative"><input className="sp-input pr-10" type={showPassword ? "text" : "password"} value={credForm.secret} onChange={e => setCred("secret", e.target.value)} /><button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text">{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field>
          <Field label="WebSocket Server"><input className="sp-input" value={credForm.server} onChange={e => setCred("server", e.target.value)} placeholder="wss://pbx.example.com:8089/ws" /></Field>
          <Field label="Engine SIP"><div className="grid grid-cols-2 gap-2">{(["sipjs", "jssip"] as const).map(p => <button key={p} onClick={() => setCred("provider", p)} className={`py-2.5 rounded-2xl text-sm font-bold border transition-all ${(credForm.provider || "sipjs") === p ? "bg-sp-blue/12 border-sp-blue/40 text-sp-blue" : "bg-white/[0.04] border-white/10 text-sp-muted hover:text-sp-text"}`}>{p === "sipjs" ? "SIP.js" : "JsSIP"}</button>)}</div></Field>
          <label className="flex items-center gap-2 text-sm text-sp-muted cursor-pointer rounded-2xl bg-white/[0.035] border border-white/10 p-3"><input type="checkbox" className="accent-sp-blue" checked={!!credForm.debug} onChange={e => setCred("debug", e.target.checked)} /> Trace SIP para diagnóstico</label>
          {credError && <p className="text-xs text-sp-red flex items-center gap-1"><AlertTriangle size={12}/>{credError}</p>}
          {credSaved && <p className="text-xs text-sp-green">Reconectado com as novas credenciais.</p>}
          <button onClick={saveCredentials} disabled={savingCreds} className="w-full sp-button-secondary py-3 flex items-center justify-center gap-2 font-bold">{savingCreds ? <><RefreshCw size={15} className="animate-spin" />Reconectando...</> : <><Save size={15} />Salvar e reconectar</>}</button>
        </Section>

        <Section title="Dispositivos de áudio" icon={<Headphones size={15} />}>
          {microphones.length === 0 && <button onClick={requestPermissions} className="w-full sp-button-primary py-3 text-sm">Conceder permissão e listar headsets</button>}
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Microfone"><select className="sp-input" value={prefs.audioInput || ""} onChange={e => setPrefs(p => ({ ...p, audioInput: e.target.value }))}><option value="">Padrão do sistema</option>{microphones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
            <Field label="Alto-falante"><select className="sp-input" value={prefs.audioOutput || ""} onChange={e => setPrefs(p => ({ ...p, audioOutput: e.target.value }))}><option value="">Padrão do sistema</option>{speakers.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-sp-muted">
            <DeviceCount label="Mics" value={microphones.length} />
            <DeviceCount label="Saídas" value={speakers.length} />
            <DeviceCount label="Câmeras" value={cameras.length} />
          </div>
        </Section>

        <Section title="Sons da experiência" icon={<Music size={15} />}>
          <Field label="URL do ringtone"><input className="sp-input" placeholder="https://.../ringtone.mp3" value={prefs.ringtone || ""} onChange={e => setPrefs(p => ({ ...p, ringtone: e.target.value }))} /></Field>
          <Field label="URL do ringback"><input className="sp-input" placeholder="https://.../ringback.mp3" value={prefs.ringback || ""} onChange={e => setPrefs(p => ({ ...p, ringback: e.target.value }))} /></Field>
          <p className="text-xs text-sp-muted">Em branco, a biblioteca usa sintetizador nativo. Menos arquivos, menos fricção no teste.</p>
        </Section>

        <button onClick={save} className="w-full sp-button-primary py-3 flex items-center justify-center gap-2"><Volume2 size={16} /> Salvar preferências de áudio</button>
      </div>

      <aside className="space-y-5">
        <section className="sp-card p-5">
          <div className="flex items-center gap-2 text-sp-blue font-black"><Stethoscope size={16} /> Diagnóstico rápido</div>
          <p className="text-sm text-sp-muted mt-2">Valida HTTPS, mídia, seleção de speaker, registro SIP e health check.</p>
          <button onClick={runDiagnostics} className="w-full sp-button-secondary py-3 mt-4 font-bold flex items-center justify-center gap-2"><RefreshCw size={15}/> Rodar diagnóstico</button>
          {diagnostics && <div className="mt-4 space-y-2 text-xs"><Info label="HTTPS" ok={diagnostics.secureContext} /><Info label="MediaDevices" ok={diagnostics.hasMediaDevices} /><Info label="Permissão mic" ok={diagnostics.hasMicrophonePermission} /><Info label="Speaker select" ok={diagnostics.hasSpeakerSelection} /><Info label="SIP registrado" ok={diagnostics.sipRegistered} />{diagnostics.warnings.map(w => <p key={w} className="text-sp-amber bg-sp-amber/10 border border-sp-amber/20 rounded-xl p-2">{w}</p>)}</div>}
        </section>

        <section className="sp-card p-5 border-sp-red/25">
          <h3 className="text-sm font-black text-sp-red mb-2 flex items-center gap-2"><LogOut size={15}/> Zona de risco</h3>
          <p className="text-xs text-sp-muted mb-3">Remove credenciais salvas neste navegador.</p>
          <button onClick={onLogout} className="w-full py-2.5 rounded-2xl bg-sp-red/10 border border-sp-red/30 text-sp-red hover:bg-sp-red/15 text-sm font-bold">Desconectar e apagar</button>
        </section>
      </aside>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <section className="sp-card p-5 space-y-4"><h3 className="text-sm font-black text-sp-text flex items-center gap-2">{icon}<span>{title}</span></h3>{children}</section>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><label className="block text-xs text-sp-muted mb-1.5 font-semibold">{label}</label>{children}{hint && <p className="text-[11px] text-sp-muted/70 mt-1">{hint}</p>}</div>;
}

function DeviceCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-white/[0.035] border border-white/10 p-3"><div className="text-lg font-black text-sp-text">{value}</div><div>{label}</div></div>;
}

function Info({ label, ok }: { label: string; ok: boolean }) {
  return <div className="flex items-center justify-between rounded-xl bg-white/[0.035] border border-white/10 px-3 py-2"><span className="text-sp-muted">{label}</span><span className={ok ? "text-sp-green font-bold" : "text-sp-red font-bold"}>{ok ? "OK" : "Atenção"}</span></div>;
}
