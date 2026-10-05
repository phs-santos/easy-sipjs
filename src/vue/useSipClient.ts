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
    connect,
    disconnect,
    dial,
    answer,
    reject,
    setActiveSession,
    refreshSessions,
  };
}
