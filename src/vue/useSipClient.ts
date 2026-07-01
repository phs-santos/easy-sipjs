import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { SipClient, type SipClientOptions } from "../index.js";
import type { SipCredentials, SipConnectionState, SipInvitation, ISipSession } from "../index.js";

export interface UseSipClientOptions extends SipClientOptions {
  /** When true, connects automatically on mount. Defaults to true. */
  autoConnect?: boolean;
}

export function useSipClient(credentials: SipCredentials, options: UseSipClientOptions = {}) {
  const client = shallowRef(new SipClient(credentials, options));
  const connectionState = ref<SipConnectionState>("disconnected");
  const incomingInvitation = shallowRef<SipInvitation>();
  const sessions = ref<ISipSession[]>([]);
  const activeSession = computed(() => client.value.activeSession);

  const refreshSessions = () => {
    sessions.value = client.value.getSessions();
  };

  const bindClient = (nextClient: SipClient) => {
    nextClient.onConnectionStateChange = state => {
      connectionState.value = state;
    };

    nextClient.on("invite", invitation => {
      incomingInvitation.value = invitation;
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

  const dial = async (destination: string, callOptions = {}) => {
    const session = await client.value.dial(destination, callOptions as never);
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

  if (options.autoConnect ?? true) {
    connect().catch(error => {
      console.error("[easy-sipjs/vue] connect failed:", error);
    });
  }

  onBeforeUnmount(() => {
    disconnect().catch(() => undefined);
  });

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
    refreshSessions,
  };
}
