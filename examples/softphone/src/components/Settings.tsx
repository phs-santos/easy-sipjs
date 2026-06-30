import { useEffect, useState } from "react";
import { Eye, EyeOff, Save, RefreshCw, Mic, Volume2, Music, AlertTriangle } from "lucide-react";
import { SipClient } from "easy-sipjs";
import type { DevicePrefs, StoredCredentials } from "../types";

interface Props {
  credentials: StoredCredentials;
  devicePrefs: DevicePrefs;
  onSaveDevicePrefs: (prefs: DevicePrefs) => void;
  onUpdateCredentials: (credentials: StoredCredentials) => Promise<void>;
  onLogout: () => void;
}

export function Settings({ credentials, devicePrefs, onSaveDevicePrefs, onUpdateCredentials, onLogout }: Props) {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState<DevicePrefs>(devicePrefs);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const [credForm, setCredForm] = useState<StoredCredentials>(credentials);
  const [showPassword, setShowPassword] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credError, setCredError] = useState<string | undefined>();
  const [credSaved, setCredSaved] = useState(false);

  useEffect(() => { setCredForm(credentials); }, [credentials]);

  useEffect(() => {
    SipClient.getAudioInputDevices().then(setAudioInputs);
    SipClient.getAudioOutputDevices().then(setAudioOutputs);
  }, [permissionGranted]);

  const setCred = (key: keyof StoredCredentials, value: any) =>
    setCredForm(prev => ({ ...prev, [key]: value }));

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

  const requestPermissions = async () => {
    const ok = await SipClient.requestPermissions({ audio: true });
    setPermissionGranted(ok);
  };

  const save = () => onSaveDevicePrefs(prefs);

  return (
    <div className="max-w-lg mx-auto pt-6 space-y-6">
      <h2 className="text-lg font-bold text-sp-text">Ajustes</h2>

      {/* ── Conta SIP ── */}
      <Section title="Conta SIP">
        <Field label="Domínio">
          <input className="sp-input" value={credForm.domain}
            onChange={e => setCred("domain", e.target.value)} placeholder="pbx.example.com" />
        </Field>
        <Field label="Ramal / Usuário">
          <input className="sp-input" value={credForm.phone}
            onChange={e => setCred("phone", e.target.value)} placeholder="1001" />
        </Field>
        <Field label="Nome de exibição">
          <input className="sp-input" value={credForm.nameexten || ""}
            onChange={e => setCred("nameexten", e.target.value)} placeholder="João Silva" />
        </Field>
        <Field label="Senha">
          <div className="relative">
            <input className="sp-input pr-10" type={showPassword ? "text" : "password"}
              value={credForm.secret} onChange={e => setCred("secret", e.target.value)} />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text">
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>
        <Field label="WebSocket Server">
          <input className="sp-input" value={credForm.server}
            onChange={e => setCred("server", e.target.value)} placeholder="wss://pbx.example.com:8089/ws" />
        </Field>

        <Field label="Provider SIP">
          <div className="flex gap-2">
            {(["sipjs", "jssip"] as const).map(p => (
              <button key={p} onClick={() => setCred("provider", p)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  (credForm.provider || "sipjs") === p
                    ? "bg-sp-blue/20 border-sp-blue text-sp-blue"
                    : "bg-sp-bg border-sp-border text-sp-muted hover:text-sp-text"
                }`}>
                {p === "sipjs" ? "SIP.js" : "JsSIP"}
              </button>
            ))}
          </div>
          <p className="text-xs text-sp-muted mt-1">
            SIP.js — padrão recomendado. JsSIP — alternativa em caso de incompatibilidade.
          </p>
        </Field>

        <label className="flex items-center gap-2 text-sm text-sp-muted cursor-pointer">
          <input type="checkbox" className="accent-sp-green" checked={!!credForm.debug}
            onChange={e => setCred("debug", e.target.checked)} />
          Modo debug (logs SIP no console)
        </label>

        {credError && <p className="text-xs text-sp-red flex items-center gap-1"><AlertTriangle size={12}/>{credError}</p>}
        {credSaved && <p className="text-xs text-sp-green">Reconectado com as novas credenciais.</p>}

        <button onClick={saveCredentials} disabled={savingCreds}
          className="w-full py-2.5 rounded-lg bg-sp-blue text-white font-semibold hover:bg-blue-400 disabled:opacity-50 flex items-center justify-center gap-2">
          {savingCreds ? <><RefreshCw size={15} className="animate-spin" />Reconectando...</> : <><Save size={15} />Salvar e reconectar</>}
        </button>
      </Section>

      {/* ── Dispositivos ── */}
      <Section title="Dispositivos de áudio" icon={<Mic size={14} />}>
        {audioInputs.length === 0 && (
          <button onClick={requestPermissions} className="text-sm text-sp-green hover:underline">
            Conceder permissão de microfone para listar dispositivos
          </button>
        )}
        <Field label="Microfone">
          <select className="sp-input" value={prefs.audioInput || ""}
            onChange={e => setPrefs(p => ({ ...p, audioInput: e.target.value }))}>
            <option value="">Padrão do sistema</option>
            {audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
          </select>
        </Field>
        <Field label="Alto-falante">
          <select className="sp-input" value={prefs.audioOutput || ""}
            onChange={e => setPrefs(p => ({ ...p, audioOutput: e.target.value }))}>
            <option value="">Padrão do sistema</option>
            {audioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
          </select>
        </Field>
      </Section>

      {/* ── Sons ── */}
      <Section title="Sons" icon={<Music size={14} />}>
        <Field label="URL do ringtone (opcional)">
          <input className="sp-input" placeholder="https://.../ringtone.mp3"
            value={prefs.ringtone || ""} onChange={e => setPrefs(p => ({ ...p, ringtone: e.target.value }))} />
        </Field>
        <Field label="URL do ringback (opcional)">
          <input className="sp-input" placeholder="https://.../ringback.mp3"
            value={prefs.ringback || ""} onChange={e => setPrefs(p => ({ ...p, ringback: e.target.value }))} />
        </Field>
        <p className="text-xs text-sp-muted">Deixe em branco para usar o sintetizador nativo de toques.</p>
      </Section>

      <button onClick={save}
        className="w-full py-2.5 rounded-lg bg-sp-green text-black font-semibold hover:bg-green-400 flex items-center justify-center gap-2">
        <Volume2 size={15} /> Salvar preferências de áudio
      </button>

      <section className="bg-sp-surface border border-sp-red/30 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-sp-red mb-2">Zona de risco</h3>
        <button onClick={onLogout} className="text-sm text-sp-red hover:underline">
          Desconectar e apagar credenciais salvas
        </button>
      </section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-sp-surface border border-sp-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-sp-text flex items-center gap-1.5">{icon}{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-sp-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
