// Sprint 2 — registro e reconexão (doc/SPRINT-2-REGISTRO-RECONEXAO.md).
// Casos 1 e 2 já estão em client.test.ts ("SipClient lifecycle regression"); aqui ficam
// os casos 3 e 4, que estavam só como teste manual, e efeitos colaterais da correção.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SipClient } from "../src/index.js";
import type {
    ISipProvider,
    ISipRegisterDelegate,
    ISipUserAgentDelegate,
    ISipSession,
    SipInvitation,
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

function createFakeProvider(overrides: Partial<ISipProvider> = {}) {
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
        getHealth: vi.fn().mockReturnValue({ websocketConnected: false }),
        ...overrides,
    } satisfies ISipProvider;
    return { provider, delegates };
}

describe("Sprint 2 — caso 3: health check atrasado", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("um ping que falha depois do disconnect não dispara reconexão", async () => {
        const pings: Array<ReturnType<typeof deferred<{ ok: boolean }>>> = [];
        const ping = vi.fn(() => {
            const d = deferred<{ ok: boolean }>();
            pings.push(d);
            return d.promise;
        });
        const { provider } = createFakeProvider({ ping });
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();

        const first = client.checkHealth();
        const second = client.checkHealth();
        await vi.advanceTimersByTimeAsync(0);
        await client.disconnect();
        pings.forEach((p) => p.resolve({ ok: false }));
        await Promise.all([first, second]);
        await vi.advanceTimersByTimeAsync(60000);

        expect(provider.reconnect).not.toHaveBeenCalled();
        expect(client.getConnectionState()).toBe("disconnected");
    });

    it("um ping da conexão anterior não conta como falha da conexão nova", async () => {
        const pings: Array<ReturnType<typeof deferred<{ ok: boolean }>>> = [];
        const ping = vi.fn(() => {
            const d = deferred<{ ok: boolean }>();
            pings.push(d);
            return d.promise;
        });
        const { provider } = createFakeProvider({ ping });
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();

        const stale = client.checkHealth();
        await vi.advanceTimersByTimeAsync(0);
        await client.disconnect();
        await client.connect();
        pings[0].resolve({ ok: false }); // resposta atrasada da conexão antiga
        await stale;

        // Uma única falha na conexão nova não pode derrubar o socket (o limite é 2).
        const fresh = client.checkHealth();
        await vi.advanceTimersByTimeAsync(0);
        pings[1].resolve({ ok: false });
        await fresh;
        await vi.advanceTimersByTimeAsync(60000);

        expect(provider.reconnect).not.toHaveBeenCalled();
        expect(client.getConnectionState()).toBe("registered");
        await client.disconnect();
    });
});

describe("Sprint 2 — caso 4: reconexão em andamento", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("disconnect() durante um reconnect lento deixa o cliente desconectado", async () => {
        const slowReconnect = deferred();
        const { provider, delegates } = createFakeProvider({
            reconnect: vi.fn(() => slowReconnect.promise),
        });
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        const recoverMedia = vi.fn().mockResolvedValue(undefined);
        (client as unknown as { sessions: ISipSession[] }).sessions.push({
            id: "s1",
            recoverMedia,
        } as unknown as ISipSession);
        const registered = vi.fn();
        client.on("registered", registered);

        delegates.userAgent!.onDisconnect?.(new Error("socket closed"));
        await vi.advanceTimersByTimeAsync(500); // reconexão começou e está esperando o provider
        expect(provider.reconnect).toHaveBeenCalledTimes(1);

        const disconnecting = client.disconnect();
        slowReconnect.resolve();
        await disconnecting;
        await vi.advanceTimersByTimeAsync(60000);

        expect(registered).not.toHaveBeenCalled();
        expect(recoverMedia).not.toHaveBeenCalled();
        expect(client.getConnectionState()).toBe("disconnected");
        expect(provider.reconnect).toHaveBeenCalledTimes(1);
    });
});

describe("Sprint 2 — convites atrasados", () => {
    it("recusa um INVITE que chega pelo registro antigo depois do disconnect", async () => {
        const { provider, delegates } = createFakeProvider();
        const client = new SipClient(credentials, {
            customProvider: provider,
            sounds: false,
        });
        await client.connect();
        const oldAgent = delegates.userAgent!;
        await client.disconnect();
        const invite = vi.fn();
        client.on("invite", invite);

        const invitation = {
            remoteIdentity: { uri: { user: "2000" }, displayName: "" },
            accept: vi.fn(),
            reject: vi.fn().mockResolvedValue(undefined),
            raw: {},
        } satisfies SipInvitation;
        oldAgent.onInvite?.(invitation);

        expect(invite).not.toHaveBeenCalled();
        expect(invitation.reject).toHaveBeenCalled();
    });
});

describe("Sprint 2 — efeitos colaterais da correção", () => {
    it("connect() depois de disconnect() registra de novo", async () => {
        const { provider } = createFakeProvider();
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        await client.disconnect();

        await client.connect();

        expect(provider.register).toHaveBeenCalledTimes(2);
        expect(client.getConnectionState()).toBe("registered");
        await client.disconnect();
    });

    it("updateCredentials() depois de disconnect() registra com as credenciais novas", async () => {
        const { provider } = createFakeProvider();
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        await client.disconnect();

        await client.updateCredentials({ ...credentials, phone: "1001" });

        expect(provider.register).toHaveBeenCalledTimes(2);
        expect(provider.register.mock.calls[1][0]).toMatchObject({
            phone: "1001",
        });
        expect(client.getConnectionState()).toBe("registered");
        await client.disconnect();
    });

    it("reconnect() manual depois de disconnect() volta a registrar", async () => {
        const { provider } = createFakeProvider({ reconnect: undefined });
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        await client.disconnect();

        await client.reconnect();

        expect(provider.register).toHaveBeenCalledTimes(2);
        expect(client.getConnectionState()).toBe("registered");
        await client.disconnect();
    });
});
