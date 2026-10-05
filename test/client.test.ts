import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SipClient, SipLogCode } from "../src/index.js";
import type { ISipProvider, ISipRegisterDelegate, ISipUserAgentDelegate } from "../src/index.js";

const credentials = { domain: "example.com", phone: "1000", secret: "x", server: "wss://example.com/ws" };

function createFakeProvider(overrides: Partial<ISipProvider> = {}) {
    const delegates: { userAgent?: ISipUserAgentDelegate; register?: ISipRegisterDelegate } = {};
    const provider = {
        managesRegistrationRefresh: true,
        register: vi.fn(async (_credentials: unknown, onUserAgent: ISipUserAgentDelegate, onRegister: ISipRegisterDelegate) => {
            delegates.userAgent = onUserAgent;
            delegates.register = onRegister;
            onUserAgent.onConnect?.();
            onRegister.onAccept?.();
        }),
        unregister: vi.fn().mockResolvedValue(undefined),
        call: vi.fn(),
        answer: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        reconnect: vi.fn().mockResolvedValue(undefined),
        getHealth: vi.fn().mockReturnValue({ websocketConnected: false }),
        subscribePresence: vi.fn().mockResolvedValue(undefined),
        unsubscribePresence: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } satisfies ISipProvider;
    return { provider, delegates };
}

describe("SipClient reconnection", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("retries quickly after an unexpected drop and comes back registered", async () => {
        const { provider, delegates } = createFakeProvider();
        const client = new SipClient(credentials, { customProvider: provider, reconnectDelay: 5000 });
        await client.connect();
        const registered = vi.fn();
        client.on("registered", registered);

        delegates.userAgent!.onDisconnect?.(new Error("socket closed"));
        expect(client.getConnectionState()).toBe("disconnected");

        await vi.advanceTimersByTimeAsync(500);

        expect(provider.reconnect).toHaveBeenCalledWith({ force: false });
        expect(client.getConnectionState()).toBe("registered");
        expect(registered).toHaveBeenCalledTimes(1);
    });

    it("backs off between failed attempts and reports when it gives up", async () => {
        const { provider, delegates } = createFakeProvider({ reconnect: vi.fn().mockRejectedValue(new Error("still down")) });
        const client = new SipClient(credentials, { customProvider: provider, reconnectDelay: 1000, maxReconnectAttempts: 3 });
        await client.connect();
        const reconnecting = vi.fn();
        const gaveUp = vi.fn();
        client.on("reconnecting", reconnecting);
        client.on("reconnect-failed", gaveUp);

        delegates.userAgent!.onDisconnect?.(new Error("socket closed"));
        await vi.advanceTimersByTimeAsync(60000);

        expect(provider.reconnect).toHaveBeenCalledTimes(3);
        const delays = reconnecting.mock.calls.map(([, delay]) => delay as number);
        expect(delays[0]).toBe(500);
        expect(delays[1]).toBeGreaterThanOrEqual(850);
        expect(delays[2]).toBeGreaterThan(delays[1]);
        expect(gaveUp).toHaveBeenCalledWith(3);
        expect(client.getConnectionState()).toBe("disconnected");
    });

    it("does not reconnect after an intentional disconnect", async () => {
        const { provider, delegates } = createFakeProvider();
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        await client.disconnect();

        delegates.userAgent!.onDisconnect?.();
        await vi.advanceTimersByTimeAsync(60000);

        expect(provider.reconnect).not.toHaveBeenCalled();
    });

    it("replaces the socket when the registration is lost on a connection that still looks up", async () => {
        const { provider, delegates } = createFakeProvider();
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        const unregistered = vi.fn();
        client.on("unregistered", unregistered);

        delegates.register!.onUnregistered?.();
        expect(client.getConnectionState()).toBe("connected");
        await vi.advanceTimersByTimeAsync(500);

        expect(unregistered).toHaveBeenCalledTimes(1);
        expect(provider.reconnect).toHaveBeenCalledWith({ force: true });
        expect(client.getConnectionState()).toBe("registered");
    });
});

describe("SipClient health check", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("forces a reconnect after two failed pings in a row, and not after one", async () => {
        const ping = vi.fn().mockResolvedValue({ ok: false, error: "OPTIONS ping timed out." });
        const { provider } = createFakeProvider({ ping });
        const client = new SipClient(credentials, { customProvider: provider, healthCheckIntervalMs: 30000 });
        await client.connect();

        await vi.advanceTimersByTimeAsync(30000);
        await vi.advanceTimersByTimeAsync(1000);
        expect(provider.reconnect).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(29500);
        expect(provider.reconnect).toHaveBeenCalledWith({ force: true });
        await client.disconnect();
    });

    it("keeps checking after the client is disconnected and connected again", async () => {
        const ping = vi.fn().mockResolvedValue({ ok: true, latencyMs: 12 });
        const { provider } = createFakeProvider({ ping });
        const client = new SipClient(credentials, { customProvider: provider, healthCheckIntervalMs: 30000 });
        await client.connect();
        await client.disconnect();
        await client.connect();

        await vi.advanceTimersByTimeAsync(30000);

        expect(ping).toHaveBeenCalledTimes(1);
        await client.disconnect();
    });
});

describe("SipClient presence", () => {
    it("restores subscriptions when registration comes back, but not on a plain refresh", async () => {
        const { provider, delegates } = createFakeProvider();
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        await client.subscribePresence("1001");
        await client.subscribePresence("1002", { event: "dialog" });
        provider.subscribePresence.mockClear();

        delegates.register!.onAccept?.(); // periodic refresh while still registered
        await Promise.resolve();
        expect(provider.subscribePresence).not.toHaveBeenCalled();

        delegates.userAgent!.onDisconnect?.();
        delegates.register!.onAccept?.(); // registered again after a drop
        await vi.waitFor(() => expect(provider.subscribePresence).toHaveBeenCalledTimes(2));
        expect(provider.subscribePresence).toHaveBeenCalledWith("1002", { event: "dialog" });
        await client.disconnect();
    });
});

describe("SipClient connect()", () => {
    it("rejects and reports 'error' when the provider cannot register", async () => {
        const { provider } = createFakeProvider({ register: vi.fn().mockRejectedValue(new Error("REGISTER rejected with SIP 403 Forbidden.")) });
        const client = new SipClient(credentials, { customProvider: provider });

        await expect(client.connect()).rejects.toThrow(/403/);
        expect(client.getConnectionState()).toBe("error");
    });

    it("loads only the chosen SIP stack, on demand", async () => {
        const client = new SipClient(credentials, { provider: "jssip" });
        const provider = await (client as unknown as { providerReady: Promise<{ constructor: { name: string } }> }).providerReady;
        expect(provider.constructor.name).toBe("JsSIPProvider");
    });
});

describe("SipClient presets", () => {
    const sessionDefaults = async (options: ConstructorParameters<typeof SipClient>[1], extraCredentials = {}) => {
        const { provider } = createFakeProvider();
        const client = new SipClient({ ...credentials, ...extraCredentials }, { ...options, customProvider: provider });
        await client.connect();
        const { dtmfMode, holdStrategy } = provider.register.mock.calls[0][0] as { dtmfMode?: string; holdStrategy?: string };
        await client.disconnect();
        return { dtmfMode, holdStrategy };
    };

    it("behaves like Asterisk when no preset is given", async () => {
        expect(await sessionDefaults({})).toEqual({ dtmfMode: "sip-info", holdStrategy: "asterisk-inactive" });
    });

    it("uses automatic DTMF and the standard hold for 'generic'", async () => {
        expect(await sessionDefaults({ preset: "generic" })).toEqual({ dtmfMode: "auto", holdStrategy: "sipjs-default" });
    });

    it("lets explicit options win over the preset", async () => {
        expect(await sessionDefaults({ preset: "generic", dtmfMode: "rtp-event" }, { holdStrategy: "asterisk-sendonly" }))
            .toEqual({ dtmfMode: "rtp-event", holdStrategy: "asterisk-sendonly" });
    });
});

describe("SipClient log codes and media recovery", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("tags its own log lines with a stable code in the label", async () => {
        const { provider, delegates } = createFakeProvider({ reconnect: vi.fn().mockRejectedValue(new Error("down")) });
        const client = new SipClient(credentials, { customProvider: provider, maxReconnectAttempts: 1 });
        await client.connect();
        const labels: string[] = [];
        client.onSipLog = (_level, _category, label) => { labels.push(label); };

        delegates.userAgent!.onDisconnect?.(new Error("socket closed"));
        await vi.advanceTimersByTimeAsync(1000);

        expect(labels).toEqual([
            SipLogCode.TransportDisconnected,
            SipLogCode.ReconnectAttempt,
            SipLogCode.ReconnectAttemptFailed,
            SipLogCode.ReconnectExhausted,
        ]);
    });

    it("asks ongoing calls to recover their media once signaling is back", async () => {
        const recoverMedia = vi.fn().mockResolvedValue(undefined);
        const fakeSession = { id: "s1", on: vi.fn(), recoverMedia };
        const { provider, delegates } = createFakeProvider({ call: vi.fn().mockResolvedValue(fakeSession) });
        const client = new SipClient(credentials, { customProvider: provider });
        await client.connect();
        await client.dial("1001");

        delegates.userAgent!.onDisconnect?.(new Error("socket closed"));
        await vi.advanceTimersByTimeAsync(500);

        expect(recoverMedia).toHaveBeenCalledTimes(1);
    });
});
