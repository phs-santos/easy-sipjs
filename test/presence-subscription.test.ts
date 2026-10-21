import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionState } from "sip.js";
import { SipJSProvider } from "../src/core/sipjs-provider.js";

const fake = vi.hoisted(() => ({ subscribers: [] as any[] }));
vi.mock("sip.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("sip.js")>();
    return {
        ...actual,
        Subscriber: class {
            delegate: any;
            listener: any;
            options: any;
            stateChange = {
                addListener: (fn: any) => {
                    this.listener = fn;
                },
            };
            subscribe = vi.fn().mockResolvedValue(undefined);
            unsubscribe = vi.fn(async () => {
                this.listener?.(actual.SubscriptionState.Terminated);
            });
            dispose = vi.fn().mockResolvedValue(undefined);
            constructor(
                _ua: unknown,
                _uri: unknown,
                _event: unknown,
                options: unknown
            ) {
                this.options = options;
                fake.subscribers.push(this);
            }
        },
    };
});
function provider() {
    const instance = new SipJSProvider();
    const onPresence = vi.fn();
    Object.assign(instance, {
        userAgent: {},
        domain: "example.com",
        onUserAgent: { onPresence },
    });
    return { instance, onPresence };
}
function notify(subscriber: any, state = "active;expires=3600") {
    subscriber.delegate.onNotify({
        accept: vi.fn().mockResolvedValue(undefined),
        request: {
            body: "<dialog-info><dialog><state>confirmed</state></dialog></dialog-info>",
            getHeader: (name: string) =>
                name === "Content-Type" ? "application/dialog-info+xml" : state,
        },
    });
}
afterEach(() => {
    fake.subscribers.length = 0;
    vi.useRealTimers();
});

describe("presence subscription confirmation", () => {
    it("announces the BLF format and waits for NOTIFY rather than send completion", async () => {
        const { instance, onPresence } = provider();
        let done = false;
        const pending = instance
            .subscribePresence("2004", { event: "dialog" })
            .then(() => {
                done = true;
            });
        await vi.waitFor(() => expect(fake.subscribers).toHaveLength(1));
        expect(done).toBe(false);
        expect(fake.subscribers[0].options.extraHeaders).toContain(
            "Accept: application/dialog-info+xml"
        );
        notify(fake.subscribers[0]);
        await pending;
        expect(onPresence).toHaveBeenCalledWith(
            expect.objectContaining({ target: "2004", status: "busy" })
        );
    });
    it("announces PIDF for presence and retains an explicitly supplied Accept", async () => {
        const { instance } = provider();
        const first = instance.subscribePresence("2004");
        await vi.waitFor(() => expect(fake.subscribers).toHaveLength(1));
        expect(fake.subscribers[0].options.extraHeaders).toContain(
            "Accept: application/pidf+xml"
        );
        notify(fake.subscribers[0]);
        await first;
        const next = instance.subscribePresence("2005", {
            extraHeaders: ["Accept: application/custom+xml"],
        });
        await vi.waitFor(() => expect(fake.subscribers).toHaveLength(2));
        expect(fake.subscribers[1].options.extraHeaders).toEqual([
            "Accept: application/custom+xml",
        ]);
        notify(fake.subscribers[1]);
        await next;
    });
    it("rejects when the server refuses instead of reporting subscription success", async () => {
        const { instance } = provider();
        const pending = instance.subscribePresence("2004");
        const assertion = expect(pending).rejects.toMatchObject({
            code: "subscription-failed",
        });
        await vi.waitFor(() => expect(fake.subscribers).toHaveLength(1));
        fake.subscribers[0].listener(SubscriptionState.Terminated);
        await assertion;
    });
    it("times out and disposes if the first NOTIFY never arrives", async () => {
        vi.useFakeTimers();
        const { instance } = provider();
        const pending = instance.subscribePresence("2004");
        const assertion = expect(pending).rejects.toMatchObject({
            code: "subscription-timeout",
        });
        await vi.advanceTimersByTimeAsync(32000);
        await assertion;
        expect(fake.subscribers[0].dispose).toHaveBeenCalled();
    });
    it("does not report a terminated NOTIFY as an active subscription", async () => {
        const { instance, onPresence } = provider();
        const pending = instance.subscribePresence("2004");
        const assertion = expect(pending).rejects.toMatchObject({
            code: "subscription-failed",
        });
        await vi.waitFor(() => expect(fake.subscribers).toHaveLength(1));
        notify(fake.subscribers[0], "terminated;reason=noresource");
        await assertion;
        expect(onPresence).toHaveBeenCalledWith(
            expect.objectContaining({ status: "unknown" })
        );
    });
});
