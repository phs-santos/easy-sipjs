import { computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef } from "vue";
import { SipClient, type SipClientOptions } from "../index.js";
import type { CallOptions, SipCredentials, SipConnectionState, SipInvitation, ISipSession } from "../index.js";

export interface UseSipClientOptions extends SipClientOptions {
  /** When true, connects automatically on mount. Defaults to true. */
  autoConnect?: boolean;
}

export function useSipClient(credentials: SipCredentials, options: UseSipClientOptions = {}) {
  const client = shallowRef(new SipClient(credentials, options));
  const connectionState = ref<SipConnectionState>("disconnected");
  const incomingInvitation = shallowRef<SipInvitation>();
  // Shallow on purpose: sessions wrap the SIP stack's own objects, and a deep ref would
  // make Vue proxy and track that whole graph.
  const sessions = shallowRef<ISipSession[]>([]);
  // `client.activeSession` isn't reactive by itself; reading `sessions` ties it to every refresh.
  const activeSession = computed(() => (sessions.value, client.value.activeSession));
  // Mute and hold of the active session. Bumped by the session's own events, so they
  // also follow a hold started by the other side.
  const callStateVersion = ref(0);
  const mutedSessions = new WeakSet<ISipSession>();
  const isMuted = computed(() => {
    void callStateVersion.value;
    const session = activeSession.value;
    return !!session && mutedSessions.has(session);
  });
  const isOnHold = computed(() => {
    void callStateVersion.value;
    return activeSession.value?.isOnHold?.() ?? { local: false, remote: false };
  });

  const refreshSessions = () => {
    sessions.value = client.value.getSessions();
  };

  const bindClient = (nextClient: SipClient) => {
    nextClient.on("connection-state", state => {
      connectionState.value = state;
    });

    nextClient.on("invite", invitation => {
      incomingInvitation.value = invitation;
      // The caller may give up before the call is answered.
      const previousOnTerminate = invitation.onTerminate;
      invitation.onTerminate = () => {
        previousOnTerminate?.();
        if (incomingInvitation.value === invitation) incomingInvitation.value = undefined;
      };
    });

    nextClient.on("session", () => refreshSessions());
    nextClient.on("session-terminated", () => refreshSessions());
    nextClient.on("session-hold", () => { callStateVersion.value += 1; });
    nextClient.on("session-unhold", () => { callStateVersion.value += 1; });
  };

  bindClient(client.value);

  const connect = async () => {
    await client.value.connect();
    refreshSessions();
  };

  const disconnect = async () => {
    await client.value.disconnect();
    refreshSessions();
  };

  const dial = async (destination: string, callOptions: Omit<CallOptions, "destination"> = {}) => {
    const session = await client.value.dial(destination, callOptions);
    refreshSessions();
    return session;
  };

  const answer = async (invitation = incomingInvitation.value) => {
    if (!invitation) return undefined;
    const session = await client.value.accept(invitation);
    incomingInvitation.value = undefined;
    refreshSessions();
    return session;
  };

  const reject = async (invitation = incomingInvitation.value) => {
    if (!invitation) return;
    await client.value.reject(invitation);
    incomingInvitation.value = undefined;
  };

  const setMuted = (muted: boolean, session = activeSession.value) => {
    if (!session) return;
    if (muted) {
      session.mute();
      mutedSessions.add(session);
    } else {
      session.unmute();
      mutedSessions.delete(session);
    }
    callStateVersion.value += 1;
  };

  const setHeld = async (held: boolean, session = activeSession.value) => {
    if (!session) return;
    await (held ? session.hold() : session.unhold());
    callStateVersion.value += 1;
  };

  const hangup = async (session = activeSession.value) => {
    await session?.bye();
    refreshSessions();
  };

  const setActiveSession = (sessionOrId: ISipSession | string | undefined) => {
    client.value.setActiveSession(sessionOrId);
    refreshSessions();
  };

  if (options.autoConnect ?? true) {
    connect().catch(error => {
      console.error("[easy-sipjs/vue] connect failed:", error);
    });
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      disconnect().catch(() => undefined);
    });
  }

  return {
    client,
    connectionState,
    incomingInvitation,
    sessions,
    activeSession,
    isMuted,
    isOnHold,
    connect,
    disconnect,
    dial,
    answer,
    reject,
    hangup,
    setMuted,
    setHeld,
    setActiveSession,
    refreshSessions,
  };
}
