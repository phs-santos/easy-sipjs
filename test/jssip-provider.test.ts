import { describe, expect, it, vi } from "vitest";
import { JsSIPSession } from "../src/core/jssip-provider.js";

function createFakeSession() {
    return {
        id: "session-1",
        on: vi.fn(),
        sendDTMF: vi.fn(),
    };
}

describe("JsSIPSession.sendDTMF", () => {
    it("maps mode 'sip-info' to the INFO transport", async () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        await session.sendDTMF("1", { mode: "sip-info", durationMs: 200 });

        expect(rawSession.sendDTMF).toHaveBeenCalledWith("1", { duration: 200, transportType: "INFO" });
    });

    it("maps mode 'rtp-event' to the RFC2833 transport", async () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        await session.sendDTMF("2", { mode: "rtp-event" });

        expect(rawSession.sendDTMF).toHaveBeenCalledWith("2", { transportType: "RFC2833" });
    });

    it("leaves transportType unset when no mode is given, letting jssip pick its default", async () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        await session.sendDTMF("3");

        expect(rawSession.sendDTMF).toHaveBeenCalledWith("3", {});
    });
});
