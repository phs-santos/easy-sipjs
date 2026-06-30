import { useState } from "react";
import { PhoneOff } from "lucide-react";
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
    <div className="flex h-screen bg-sp-bg">
      <Sidebar
        activeView={activeView}
        onChangeView={onChangeView}
        connectionState={sp.connectionState}
        unreadMessages={sp.unreadMessages}
        phone={credentials.phone}
        onLogout={handleLogout}
      />

      <main className="flex-1 overflow-y-auto p-6">
        {sp.activeSessionState ? (
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
          />
        ) : (
          <>
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
                onSaveDevicePrefs={onSaveDevicePrefs}
                onUpdateCredentials={handleUpdateCredentials}
                onLogout={handleLogout}
              />
            )}
          </>
        )}
      </main>

      {sp.invitation && sp.callerInfo && (
        <IncomingCall callerInfo={sp.callerInfo} onAnswer={sp.answerIncoming} onReject={sp.rejectIncoming} />
      )}

      {sp.callEndReason && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-3 bg-sp-surface border border-sp-red/40 text-sp-text px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium">
            <div className="w-8 h-8 rounded-full bg-sp-red/20 flex items-center justify-center shrink-0">
              <PhoneOff size={15} className="text-sp-red" />
            </div>
            {sp.callEndReason}
          </div>
        </div>
      )}
    </div>
  );
}
