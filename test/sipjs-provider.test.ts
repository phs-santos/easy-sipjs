import { describe, expect, it, vi } from "vitest";
import { SipJSSession } from "../src/core/sipjs-provider.js";

function createFakeSession(peerConnection?: unknown) {
    return {
        id: "session-1",
        stateChange: { addListener: vi.fn() },
        delegate: undefined,
        remoteIdentity: { uri: { host: "example.com" } },
        sessionDescriptionHandler: peerConnection ? { peerConnection } : undefined,
    } as any;
}

describe("SipJSSession.getLocalStream", () => {
    it("returns undefined when there is no peer connection", () => {
        const session = new SipJSSession(createFakeSession());
        expect(session.getLocalStream()).toBeUndefined();
    });

    it("returns undefined when there is no local audio track", () => {
        const pc = { getSenders: () => [{ track: { kind: "video" } }] };
        const session = new SipJSSession(createFakeSession(pc));
        expect(session.getLocalStream()).toBeUndefined();
    });

    it("returns a MediaStream with the local audio track", () => {
        const audioTrack = { kind: "audio" };
        const pc = { getSenders: () => [{ track: audioTrack }, { track: { kind: "video" } }] };
        const session = new SipJSSession(createFakeSession(pc));

        const stream = session.getLocalStream();

        expect(stream).toBeDefined();
        expect(stream!.getTracks()).toEqual([audioTrack]);
    });
});
