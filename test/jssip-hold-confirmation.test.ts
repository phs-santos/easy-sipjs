// JsSIP: hold()/unhold() só resolvem quando o PBX aceita o re-INVITE (paridade com o SIP.js).
import { describe, expect, it, vi } from "vitest";
import { JsSIPSession } from "../src/core/jssip-provider.js";

function call(onHold = false) {
    let done: (() => void) | undefined;
    const raw = {
        id: "s1",
        on: vi.fn(),
        terminate: vi.fn(),
        isOnHold: () => ({ local: onHold, remote: false }),
        isReadyToReOffer: () => true,
        hold: vi.fn((_o: unknown, cb?: () => void) => { done = cb; return true; }),
        unhold: vi.fn((_o: unknown, cb?: () => void) => { done = cb; return true; }),
    };
    return { session: new JsSIPSession(raw as any), raw, confirm: () => done?.() };
}

describe("JsSIP hold/unhold esperam a confirmação do PBX", () => {
    it("hold() fica pendente até o PBX aceitar o re-INVITE", async () => {
        const { session, confirm } = call();
        let settled = false;
        const holding = session.hold().then(() => { settled = true; });

        await Promise.resolve();
        expect(settled).toBe(false);

        confirm();
        await holding;
        expect(settled).toBe(true);
    });

    it("unhold() também espera a confirmação", async () => {
        const { session, raw, confirm } = call(true);
        const resuming = session.unhold();
        expect(raw.unhold).toHaveBeenCalled();
        confirm();
        await expect(resuming).resolves.toBeUndefined();
    });

    it("rejeita se a chamada termina antes da resposta (ex.: re-INVITE sem resposta)", async () => {
        const { session } = call();
        const holding = session.hold();

        await session.bye();

        await expect(holding).rejects.toMatchObject({ code: "session-terminated" });
    });
});
