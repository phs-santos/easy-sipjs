// Sprint 1 — limpeza de recursos ao encerrar sessões (doc/CHANGELOG-FIXES.md, FIX-001 a FIX-005).
// Regressões de limpeza de recursos e recuperação do provider SIP.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionState } from "sip.js";
import { SipJSSession } from "../src/core/sipjs-provider.js";
import { SipClient } from "../src/index.js";
import type {
    ISipProvider,
    ISipRegisterDelegate,
    ISipUserAgentDelegate,
} from "../src/index.js";

const credentials = {
    domain: "example.com",
    phone: "1000",
    secret: "x",
    server: "wss://example.com/ws",
};

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/** Sessão SIP.js estabelecida, com um RTCPeerConnection falso que registra os listeners. */
function createSipJsSession(settings = {}) {
    const listeners = new Map<string, () => void>();
    const pc = {
        iceConnectionState: "connected",
        connectionState: "connected",
        getSenders: () => [],
        addEventListener: vi.fn((event: string, listener: () => void) =>
            listeners.set(event, listener)
        ),
        removeEventListener: vi.fn((event: string, listener: () => void) => {
            if (listeners.get(event) === listener) listeners.delete(event);
        }),
    };
    const rawSession = {
        id: "session-1",
        state: SessionState.Established,
        stateChange: { addListener: vi.fn() },
        delegate: undefined,
        remoteIdentity: { uri: { host: "example.com" } },
        sessionDescriptionHandler: { peerConnection: pc },
        sessionDescriptionHandlerOptionsReInvite: {
            constraints: { audio: true },
        },
        bye: vi.fn().mockResolvedValue(undefined),
        invite: vi.fn(
            (options?: { requestDelegate?: { onAccept?: () => void } }) => {
                options?.requestDelegate?.onAccept?.();
                return Promise.resolve();
            }
        ),
    } as any;
    const session = new SipJSSession(rawSession, settings);
    const onStateChange = rawSession.stateChange.addListener.mock
        .calls[0][0] as (state: SessionState) => void;
    onStateChange(SessionState.Established);
    // Simula um evento do browser: chama o listener que estiver registrado, se houver.
    const fireIce = (state: string) => {
        pc.iceConnectionState = state;
        listeners.get("iceconnectionstatechange")?.();
    };
    return { pc, rawSession, session, fireIce, listeners };
}

describe("FIX-002 (SIP.js) listeners do RTCPeerConnection", () => {
    it("remove os listeners de mídia quando a sessão termina", async () => {
        const { pc, session } = createSipJsSession();
        expect(pc.addEventListener).toHaveBeenCalledTimes(2);

        await session.bye();

        expect(pc.removeEventListener).toHaveBeenCalledTimes(2);
        for (const [name, handler] of pc.addEventListener.mock.calls) {
            expect(pc.removeEventListener).toHaveBeenCalledWith(name, handler);
        }
    });

    it("não emite media-state depois do encerramento", async () => {
        const { session, fireIce } = createSipJsSession();
        const mediaState = vi.fn();
        session.on("media-state", mediaState);

        await session.bye();
        fireIce("disconnected");

        expect(mediaState).not.toHaveBeenCalled();
    });
});

describe("FIX-004 (SIP.js) recuperação ICE depois do encerramento", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("não faz re-INVITE se a sessão termina durante a carência de 'disconnected'", async () => {
        const { rawSession, session, fireIce } = createSipJsSession({
            mediaRecovery: { disconnectedGraceMs: 3000 },
        });

        fireIce("disconnected");
        await vi.advanceTimersByTimeAsync(1000);
        await session.bye();
        await vi.advanceTimersByTimeAsync(10000);

        expect(rawSession.invite).not.toHaveBeenCalled();
    });

    it("ignora 'failed' que chega depois do encerramento", async () => {
        const { rawSession, session, fireIce } = createSipJsSession();
        const failed = vi.fn();
        session.on("media-failed", failed);

        await session.bye();
        fireIce("failed");
        await vi.advanceTimersByTimeAsync(10000);

        expect(rawSession.invite).not.toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
    });
});

describe("FIX-005 unregister() com a fila ocupada", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("cancela a reconexão agendada mesmo antes do unregister sair da fila", async () => {
        const slowRefresh = deferred();
        const delegates: {
            userAgent?: ISipUserAgentDelegate;
            register?: ISipRegisterDelegate;
        } = {};
        const provider = {
            managesRegistrationRefresh: true,
            register: vi.fn(
                async (
                    _c: unknown,
                    ua: ISipUserAgentDelegate,
                    reg: ISipRegisterDelegate
                ) => {
                    delegates.userAgent = ua;
                    delegates.register = reg;
                    ua.onConnect?.();
                    reg.onAccept?.();
                }
            ),
            unregister: vi.fn().mockResolvedValue(undefined),
            call: vi.fn(),
            answer: vi.fn(),
            sendMessage: vi.fn(),
            reconnect: vi.fn().mockResolvedValue(undefined),
            refreshRegistration: vi.fn(() => slowRefresh.promise),
        } satisfies ISipProvider;
        const client = new SipClient(credentials, {
            customProvider: provider,
            reconnectDelay: 1000,
        });
        await client.connect();

        // Uma operação lenta ocupa a fila; a conexão cai e agenda reconexão em 500 ms.
        const refreshing = client.refreshRegistration();
        await vi.advanceTimersByTimeAsync(0);
        delegates.userAgent!.onDisconnect?.(new Error("socket closed"));
        const disconnecting = client.disconnect();

        await vi.advanceTimersByTimeAsync(5000);
        slowRefresh.resolve();
        await refreshing;
        await disconnecting;
        await vi.advanceTimersByTimeAsync(60000);

        expect(provider.reconnect).not.toHaveBeenCalled();
        expect(client.getConnectionState()).toBe("disconnected");
    });
});
