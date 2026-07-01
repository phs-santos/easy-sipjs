import { useState } from "react";
import { Activity, PhoneOff, ShieldCheck, Wifi } from "lucide-react";
import type { SipConnectionState } from "easy-sipjs";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useSoftphone } from "./hooks/useSoftphone";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { IncomingCall } from "./components/IncomingCall";
import { Dialer } from "./components/Dialer";
import { ActiveCall } from "./components/ActiveCall";
import { History } from "./components/History";
import { Messages } from "./components/Messages";
import { Settings } from "./components/Settings";
import { Monitor } from "./components/Monitor";
import type { ActiveView, DevicePrefs, StoredCredentials } from "./types";

export default function App() {
  const [credentials, setCredentials] = useLocalStorage<StoredCredentials | null>("sp:credentials", null);
  const [devicePrefs, setDevicePrefs] = useLocalStorage<DevicePrefs>("sp:device-prefs", {});
  const [activeView, setActiveView] = useState<ActiveView>("dialer");

  if (!credentials) {
    return <Login onConnect={setCredentials} />;
  }

  return (
    <Softphone
      credentials={credentials}
      devicePrefs={devicePrefs}
      activeView={activeView}
      onChangeView={setActiveView}
      onSaveDevicePrefs={setDevicePrefs}
      onUpdateCredentials={setCredentials}
      onLogout={() => setCredentials(null)}
    />
  );
}

function Softphone({
  credentials,
  devicePrefs,
  activeView,
  onChangeView,
  onSaveDevicePrefs,
  onUpdateCredentials,
  onLogout,
}: {
  credentials: StoredCredentials;
  devicePrefs: DevicePrefs;
  activeView: ActiveView;
  onChangeView: (v: ActiveView) => void;
  onSaveDevicePrefs: (p: DevicePrefs) => void;
  onUpdateCredentials: (c: StoredCredentials) => void;
  onLogout: () => void;
}) {
  const sp = useSoftphone(credentials, devicePrefs);

  const handleLogout = async () => {
    await sp.client.unregister().catch(() => {});
    onLogout();
  };

  const handleUpdateCredentials = async (newCreds: StoredCredentials) => {
    await sp.updateCredentials(newCreds);
    onUpdateCredentials(newCreds);
  };

  return (
    <div className="min-h-screen bg-soft-radial text-sp-text overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-45 [background-image:linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative flex h-screen">
        <Sidebar
          activeView={activeView}
          onChangeView={onChangeView}
          connectionState={sp.connectionState}
          unreadMessages={sp.unreadMessages}
          phone={credentials.phone}
          nameexten={credentials.nameexten}
          onLogout={handleLogout}
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 lg:p-8">
          <TopBar
            connectionState={sp.connectionState}
            activeView={activeView}
            phone={credentials.phone}
            displayName={credentials.nameexten}
            activeSessions={sp.sessionStates.length}
            sipLogs={sp.sipLogs.length}
          />

          <section className="mt-5 min-h-[calc(100vh-9rem)]">
            {sp.activeSessionState ? (
              <>
                {sp.sessionStates.length > 1 && (
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {sp.sessionStates.map(ss => {
                      const rec = sp.callHistory.find(r => r.id === ss.callRecordId);
                      const isActive = ss.session.id === sp.activeSessionState?.session.id;
                      return (
                        <button
                          key={ss.session.id}
                          onClick={() => sp.switchSession(ss.session.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm border transition-all ${
                            isActive
                              ? "bg-sp-blue/12 border-sp-blue/50 text-sp-text shadow-glow"
                              : "bg-white/[0.04] border-white/10 text-sp-muted hover:border-sp-blue/40 hover:text-sp-text"
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${ss.isOnHold ? "bg-sp-amber" : "bg-sp-green"}`} />
                          <span className="font-medium">{rec?.number ?? "—"}</span>
                          {ss.isOnHold && <span className="text-sp-amber text-xs">Em espera</span>}
                          {isActive && !ss.isOnHold && <span className="text-sp-green text-xs">Ativa</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <ActiveCall
                  sessionState={sp.activeSessionState}
                  callRecord={sp.callHistory.find(r => r.id === sp.activeSessionState?.callRecordId)}
                  sipLogs={sp.sipLogs}
                  onHangup={sp.hangup}
                  onToggleMute={sp.toggleMute}
                  onToggleHold={sp.toggleHold}
                  onSendDTMF={sp.sendDTMFTone}
                  onTransfer={sp.doTransfer}
                  onToggleScreenShare={sp.toggleScreenShare}
                  onSetVolume={sp.setVolume}
                  onFetchStats={sp.fetchStats}
                  onFetchQuality={sp.fetchQuality}
                  onNewCall={sp.activeSessionState.isOnHold ? sp.dial : undefined}
                />
              </>
            ) : (
              <div className="mx-auto max-w-6xl">
                {activeView === "dialer" && (
                  <Dialer onCall={sp.dial} recentNumbers={sp.callHistory} disabled={sp.connectionState !== "registered"} />
                )}
                {activeView === "history" && (
                  <History history={sp.callHistory} onCall={sp.dial} onClear={sp.clearHistory} />
                )}
                {activeView === "messages" && (
                  <Messages
                    messages={sp.messages}
                    onSend={sp.sendSipMessage}
                    onMarkRead={sp.markMessagesRead}
                    onClear={sp.clearMessages}
                  />
                )}
                {activeView === "settings" && (
                  <Settings
                    credentials={credentials}
                    devicePrefs={devicePrefs}
                    client={sp.client}
                    onSaveDevicePrefs={onSaveDevicePrefs}
                    onUpdateCredentials={handleUpdateCredentials}
                    onLogout={handleLogout}
                  />
                )}
                {activeView === "monitor" && (
                  <Monitor
                    connectionState={sp.connectionState}
                    credentials={credentials}
                    sipLogs={sp.sipLogs}
                    sessionStates={sp.sessionStates}
                    callHistoryCount={sp.callHistory.length}
                    onReconnect={() => sp.client.reconnect().catch(() => sp.client.connect().catch(() => {}))}
                    onCheckHealth={() => sp.client.checkHealth()}
                    onDiagnose={() => sp.client.diagnose()}
                  />
                )}
              </div>
            )}
          </section>
        </main>

        {sp.invitation && sp.callerInfo && (
          <IncomingCall callerInfo={sp.callerInfo} onAnswer={sp.answerIncoming} onReject={sp.rejectIncoming} />
        )}

        {sp.callEndReason && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
            <div className="flex items-center gap-3 bg-sp-surface/95 border border-sp-red/40 text-sp-text px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium backdrop-blur-xl">
              <div className="w-8 h-8 rounded-full bg-sp-red/20 flex items-center justify-center shrink-0">
                <PhoneOff size={15} className="text-sp-red" />
              </div>
              {sp.callEndReason}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({
  connectionState,
  activeView,
  phone,
  displayName,
  activeSessions,
  sipLogs,
}: {
  connectionState: SipConnectionState;
  activeView: ActiveView;
  phone: string;
  displayName?: string;
  activeSessions: number;
  sipLogs: number;
}) {
  const ok = connectionState === "registered";
  const title: Record<ActiveView, string> = {
    dialer: "Central de chamadas",
    history: "Histórico de chamadas",
    messages: "Mensagens SIP",
    settings: "Ajustes do softphone",
    monitor: "Monitor técnico",
  };

  return (
    <header className="sp-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs text-sp-muted uppercase tracking-[0.22em] font-semibold">
          <ShieldCheck size={13} className="text-sp-blue" />
          Experiência WebRTC segura
        </div>
        <h1 className="text-xl md:text-2xl font-bold mt-1">{title[activeView]}</h1>
        <p className="text-sm text-sp-muted mt-1">{displayName || phone} · SDK fácil por fora, SIP.js robusto por baixo.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Metric icon={<Wifi size={14} />} label={ok ? "Registrado" : "Atenção"} value={connectionState} tone={ok ? "green" : "amber"} />
        <Metric icon={<Activity size={14} />} label="Sessões" value={String(activeSessions)} tone="blue" />
        <Metric icon={<Activity size={14} />} label="Trace SIP" value={String(sipLogs)} tone="violet" />
      </div>
    </header>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "green" | "amber" | "blue" | "violet" }) {
  const toneMap = {
    green: "bg-sp-green/10 text-sp-green border-sp-green/25",
    amber: "bg-sp-amber/10 text-sp-amber border-sp-amber/25",
    blue: "bg-sp-blue/10 text-sp-blue border-sp-blue/25",
    violet: "bg-sp-violet/10 text-sp-violet border-sp-violet/25",
  }[tone];

  return (
    <div className={`min-w-28 rounded-2xl border px-3 py-2 ${toneMap}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-90">
        {icon}{label}
      </div>
      <div className="text-sm font-bold mt-0.5 capitalize">{value}</div>
    </div>
  );
}
