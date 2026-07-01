import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { SipClient } from "easy-sipjs";
import type { SipConnectionState, SipInvitation, CallStats, ISipSession } from "easy-sipjs";
import { useLocalStorage } from "./useLocalStorage";
import type { StoredCredentials, DevicePrefs, CallRecord, MessageRecord, SipLogEntry } from "../types";

export interface CallerInfo {
  number: string;
  name?: string;
}

export interface SessionState {
  session: ISipSession;
  isMuted: boolean;
  isOnHold: boolean;
  isSharingScreen: boolean;
  callRecordId: string;
}

export function useSoftphone(credentials: StoredCredentials, devicePrefs: DevicePrefs) {
  const client = useMemo(
    () =>
      new SipClient(credentials, {
        provider: credentials.provider || 'sipjs',
        sounds: {
          ringtone: devicePrefs.ringtone || undefined,
          ringback: devicePrefs.ringback || undefined,
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [connectionState, setConnectionState] = useState<SipConnectionState>("disconnected");
  const [sessionStates, setSessionStates] = useState<SessionState[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [invitation, setInvitation] = useState<SipInvitation | undefined>();
  const [callerInfo, setCallerInfo] = useState<CallerInfo | undefined>();
  const [callHistory, setCallHistory] = useLocalStorage<CallRecord[]>("sp:history", []);
  const [messages, setMessages] = useLocalStorage<MessageRecord[]>("sp:messages", []);
  const [sipLogs, setSipLogs] = useState<SipLogEntry[]>([]);
  const [callEndReason, setCallEndReason] = useState<string | null>(null);
  const intentionalHangupRef = useRef<Set<string>>(new Set());

  const remoteAudio = useRef<HTMLAudioElement>(new Audio());
  remoteAudio.current.autoplay = true;

  // ─── helpers ──────────────────────────────────────────────────────────────

  const addCallRecord = useCallback((record: CallRecord) => {
    setCallHistory(prev => [record, ...prev].slice(0, 200));
  }, [setCallHistory]);

  const updateCallRecord = useCallback((id: string, patch: Partial<CallRecord>) => {
    setCallHistory(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }, [setCallHistory]);

  const pushSessionState = useCallback((ss: SessionState) => {
    setSessionStates(prev => [...prev, ss]);
  }, []);

  const patchSessionState = useCallback((id: string, patch: Partial<SessionState>) => {
    setSessionStates(prev => prev.map(s => (s.session.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeSessionState = useCallback((id: string) => {
    setSessionStates(prev => prev.filter(s => s.session.id !== id));
  }, []);

  const rejectMessage = (code: number): string => {
    switch (code) {
      case 486: return "Ocupado — destino rejeitou a chamada";
      case 480: return "Temporariamente indisponível";
      case 404: return "Número não encontrado";
      case 403: return "Acesso negado";
      case 503: return "Serviço indisponível";
      case 408: return "Sem resposta (timeout)";
      default:  return code ? `Chamada encerrada (${code})` : "Chamada não atendida";
    }
  };

  const wireSession = useCallback(
    (session: ISipSession, direction: "inbound" | "outbound", peer: string, displayName?: string) => {
      const recordId = crypto.randomUUID();

      addCallRecord({
        id: recordId,
        direction,
        number: peer,
        displayName,
        startedAt: new Date().toISOString(),
        duration: 0,
        status: direction === "outbound" ? "calling" : "answered",
      });

      const ss: SessionState = {
        session,
        isMuted: false,
        isOnHold: false,
        isSharingScreen: false,
        callRecordId: recordId,
      };

      // Chain — never overwrite callbacks SipClient already set (e.g. stopRingback)
      const prevConfirm = session.onConfirm;
      session.onConfirm = () => {
        prevConfirm?.();
        updateCallRecord(recordId, { status: "answered" });
        setActiveSessionId(session.id);
        if (devicePrefs.audioOutput) {
          session.setAudioOutput(devicePrefs.audioOutput).catch(() => {});
        }
        if (devicePrefs.audioInput) {
          session.setAudioInput(devicePrefs.audioInput).catch(() => {});
        }
      };

      const prevHold = session.onHold;
      session.onHold = () => {
        prevHold?.();
        patchSessionState(session.id, { isOnHold: true });
      };

      const prevUnhold = session.onUnhold;
      session.onUnhold = () => {
        prevUnhold?.();
        patchSessionState(session.id, { isOnHold: false });
      };

      const prevReject = session.onReject;
      session.onReject = (statusCode: number) => {
        prevReject?.(statusCode);
        if (intentionalHangupRef.current.has(session.id)) return;
        const statusForRecord = statusCode === 486 ? "busy" : "failed";
        updateCallRecord(recordId, { status: statusForRecord });
        setCallEndReason(rejectMessage(statusCode));
      };

      const prevTerminate = session.onTerminate;
      session.onTerminate = () => {
        prevTerminate?.();
        intentionalHangupRef.current.delete(session.id);
        // Stop remote audio regardless of provider
        try {
          remoteAudio.current.pause();
          remoteAudio.current.srcObject = null;
        } catch (_) {}
        const duration = session.getCallDuration();
        updateCallRecord(recordId, {
          endedAt: new Date().toISOString(),
          duration,
          // Only overwrite status if onReject didn't already set it
          ...(duration > 0 ? { status: "answered" as const } : {}),
        });
        removeSessionState(session.id);
        setActiveSessionId(prev => (prev === session.id ? undefined : prev));
      };

      pushSessionState(ss);
      setActiveSessionId(session.id);
    },
    [addCallRecord, updateCallRecord, pushSessionState, patchSessionState, removeSessionState, devicePrefs]
  );

  // ─── lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!callEndReason) return;
    const t = setTimeout(() => setCallEndReason(null), 5000);
    return () => clearTimeout(t);
  }, [callEndReason]);

  useEffect(() => {
    client.onConnectionStateChange = setConnectionState;
    client.onRegister.onExpiring = () => { client.register().catch(() => {}); };

    client.onSipLog = (_level, _category, _label, content) => {
      // SIP.js 0.21.x format: "Sending WebSocket message:\n\n<SIP>" / "Received WebSocket text message:\n\n<SIP>"
      let direction: "sent" | "received" | null = null;
      let sipMessage = "";
      if (content.includes("Sending WebSocket message:")) {
        direction = "sent";
        sipMessage = content.replace(/^[\s\S]*?Sending WebSocket message:\s*\n+/, "").trim();
      } else if (content.includes("Received WebSocket") && content.includes("message:")) {
        direction = "received";
        sipMessage = content.replace(/^[\s\S]*?Received WebSocket[^\n]*message:\s*\n+/, "").trim();
      }
      if (!direction || !sipMessage) return;

      const firstLine = sipMessage.split(/\r?\n/)[0].trim();
      let method: string | undefined;
      let statusCode: number | undefined;
      let statusText: string | undefined;
      if (firstLine.startsWith("SIP/2.0 ")) {
        const parts = firstLine.slice(8).split(" ");
        statusCode = parseInt(parts[0]);
        statusText = parts.slice(1).join(" ");
      } else {
        method = firstLine.split(" ")[0];
        if (!method || !/^[A-Z]{2,10}$/.test(method)) return;
      }

      const entry: SipLogEntry = {
        id: Math.random().toString(36).slice(2),
        timestamp: Date.now(),
        direction,
        method,
        statusCode,
        statusText,
        content: sipMessage,
      };
      setSipLogs(prev => [entry, ...prev].slice(0, 200));
    };

    const handleInvite = (inv: SipInvitation) => {
      console.log(`[easy-sipjs][3] useSoftphone.handleInvite fired — from=${inv.remoteIdentity?.uri?.user}`);
      const number = inv.remoteIdentity.uri.user;
      const name = inv.remoteIdentity.displayName || undefined;
      console.log('[easy-sipjs][3] calling setInvitation + setCallerInfo');
      setInvitation(inv);
      setCallerInfo({ number, name });

      const origTerminate = inv.onTerminate;
      inv.onTerminate = () => {
        setInvitation(undefined);
        setCallerInfo(undefined);
        if (origTerminate) origTerminate();
      };
    };

    const handleMessage = (raw: any) => {
      const body = raw?.body || raw?.data?.body || String(raw);
      const from = raw?.from?.uri?.user || raw?.remote_identity?.uri?.user || "unknown";
      const record: MessageRecord = {
        id: crypto.randomUUID(),
        direction: "inbound",
        peer: from,
        body,
        timestamp: new Date().toISOString(),
        read: false,
      };
      setMessages(prev => [record, ...prev].slice(0, 500));
    };

    client.on("invite", handleInvite);
    client.on("message", handleMessage);

    client.register().catch(err => console.error("[softphone] registration failed:", err));

    return () => {
      client.off("invite", handleInvite);
      client.off("message", handleMessage);
      client.unregister().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── derived ──────────────────────────────────────────────────────────────

  const activeSessionState = useMemo(
    () => sessionStates.find(s => s.session.id === activeSessionId),
    [sessionStates, activeSessionId]
  );

  const unreadMessages = useMemo(() => messages.filter(m => !m.read).length, [messages]);

  // ─── actions ──────────────────────────────────────────────────────────────

  const dial = useCallback(
    async (destination: string) => {
      const session = await client.call({
        destination,
        remoteElement: remoteAudio.current,
      });
      wireSession(session, "outbound", destination);
    },
    [client, wireSession]
  );

  const answerIncoming = useCallback(async () => {
    if (!invitation) return;
    const number = invitation.remoteIdentity.uri.user;
    const name = invitation.remoteIdentity.displayName || undefined;
    // Put the currently active call on hold before answering
    if (activeSessionState && !activeSessionState.isOnHold) {
      await activeSessionState.session.hold().catch(() => {});
    }
    const session = await client.answer(invitation, {
      remoteElement: remoteAudio.current,
    });
    wireSession(session, "inbound", number, name);
    setInvitation(undefined);
    setCallerInfo(undefined);
  }, [client, invitation, wireSession, activeSessionState]);

  const rejectIncoming = useCallback(async () => {
    if (!invitation) return;
    const number = invitation.remoteIdentity.uri.user;
    await invitation.reject();
    addCallRecord({
      id: crypto.randomUUID(),
      direction: "inbound",
      number,
      displayName: invitation.remoteIdentity.displayName || undefined,
      startedAt: new Date().toISOString(),
      duration: 0,
      status: "rejected",
    });
    setInvitation(undefined);
    setCallerInfo(undefined);
  }, [invitation, addCallRecord]);

  const hangup = useCallback(async () => {
    const active = activeSessionState?.session;
    if (active) {
      intentionalHangupRef.current.add(active.id);
      await active.bye();
    }
  }, [activeSessionState]);

  const toggleMute = useCallback(async () => {
    const ss = activeSessionState;
    if (!ss) return;
    if (ss.isMuted) {
      ss.session.unmute();
    } else {
      ss.session.mute();
    }
    patchSessionState(ss.session.id, { isMuted: !ss.isMuted });
  }, [activeSessionState, patchSessionState]);

  const toggleHold = useCallback(async () => {
    const ss = activeSessionState;
    if (!ss) return;
    if (ss.isOnHold) {
      await ss.session.unhold();
    } else {
      await ss.session.hold();
    }
  }, [activeSessionState]);

  const sendDTMFTone = useCallback(
    async (tone: string) => {
      await activeSessionState?.session.sendDTMF(tone);
    },
    [activeSessionState]
  );

  const doTransfer = useCallback(
    async (target: string) => {
      await activeSessionState?.session.transfer(target);
    },
    [activeSessionState]
  );

  const toggleScreenShare = useCallback(async () => {
    const ss = activeSessionState;
    if (!ss) return;
    if (ss.isSharingScreen) {
      await ss.session.stopScreenSharing();
      patchSessionState(ss.session.id, { isSharingScreen: false });
    } else {
      await ss.session.shareScreen();
      patchSessionState(ss.session.id, { isSharingScreen: true });
    }
  }, [activeSessionState, patchSessionState]);

  const setVolume = useCallback(
    (volume: number) => {
      activeSessionState?.session.setRemoteVolume(volume);
    },
    [activeSessionState]
  );

  const setOutputDevice = useCallback(
    async (deviceId: string) => {
      await activeSessionState?.session.setAudioOutput(deviceId);
    },
    [activeSessionState]
  );

  const setInputDevice = useCallback(
    async (deviceId: string) => {
      await activeSessionState?.session.setAudioInput(deviceId);
    },
    [activeSessionState]
  );

  const fetchStats = useCallback(async (): Promise<CallStats | undefined> => {
    return activeSessionState?.session.getStats();
  }, [activeSessionState]);

  const sendSipMessage = useCallback(
    async (to: string, body: string) => {
      await client.sendMessage(to, body);
      const record: MessageRecord = {
        id: crypto.randomUUID(),
        direction: "outbound",
        peer: to,
        body,
        timestamp: new Date().toISOString(),
        read: true,
      };
      setMessages(prev => [record, ...prev].slice(0, 500));
    },
    [client, setMessages]
  );

  const markMessagesRead = useCallback(
    (peer: string) => {
      setMessages(prev => prev.map(m => (m.peer === peer ? { ...m, read: true } : m)));
    },
    [setMessages]
  );

  const clearHistory = useCallback(() => setCallHistory([]), [setCallHistory]);
  const clearMessages = useCallback(() => setMessages([]), [setMessages]);

  const selectSession = useCallback((id: string | undefined) => {
    setActiveSessionId(id);
  }, []);

  const switchSession = useCallback(async (targetId: string) => {
    if (targetId === activeSessionId) return;
    const current = activeSessionState;
    const target = sessionStates.find(s => s.session.id === targetId);
    if (!target) return;
    // Hold current if active and not already on hold
    if (current && !current.isOnHold) {
      await current.session.hold().catch(() => {});
    }
    // Unhold target if it was on hold
    if (target.isOnHold) {
      await target.session.unhold().catch(() => {});
    }
    setActiveSessionId(targetId);
  }, [activeSessionId, activeSessionState, sessionStates]);

  const updateCredentials = useCallback(
    async (newCredentials: StoredCredentials) => {
      await client.updateCredentials(newCredentials);
    },
    [client]
  );

  return {
    client,
    connectionState,
    sessionStates,
    activeSessionState,
    invitation,
    callerInfo,
    callHistory,
    messages,
    unreadMessages,
    sipLogs,
    callEndReason,
    dial,
    answerIncoming,
    rejectIncoming,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMFTone,
    doTransfer,
    toggleScreenShare,
    setVolume,
    setOutputDevice,
    setInputDevice,
    fetchStats,
    sendSipMessage,
    markMessagesRead,
    clearHistory,
    clearMessages,
    selectSession,
    switchSession,
    updateCredentials,
  };
}
