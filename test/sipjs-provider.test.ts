import { describe, expect, it, vi } from "vitest";
import { SessionState } from "sip.js";
import { SipJSSession } from "../src/core/sipjs-provider.js";

function createFakeSession(peerConnection?: unknown) {
    return {
        id: "session-1",
        state: SessionState.Established,
        stateChange: { addListener: vi.fn() },
        delegate: undefined,
        remoteIdentity: { uri: { host: "example.com" } },
        sessionDescriptionHandler: peerConnection ? { peerConnection } : undefined,
        refer: vi.fn().mockResolvedValue(undefined),
        invite: vi.fn().mockResolvedValue(undefined),
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

describe("SipJSSession.isOnHold (remote hold inferred from re-INVITE SDP direction)", () => {
    it("starts with neither side on hold", () => {
        const session = new SipJSSession(createFakeSession());
        expect(session.isOnHold()).toEqual({ local: false, remote: false });
    });

    it("detects a remote-initiated hold from a=sendonly/inactive on an incoming re-INVITE", () => {
        const session = new SipJSSession(createFakeSession());
        const hold = vi.fn();
        session.on("hold", hold);

        const onInvite = session.getRawSession().delegate!.onInvite!;
        onInvite({ body: "v=0\r\nm=audio 1 RTP/AVP 0\r\na=sendonly\r\n" } as any, "", 200);

        expect(session.isOnHold()).toEqual({ local: false, remote: true });
        expect(hold).toHaveBeenCalledWith({ originator: "remote" });
    });

    it("clears remote hold once a=sendrecv/recvonly comes back", () => {
        const session = new SipJSSession(createFakeSession());
        const unhold = vi.fn();
        session.on("unhold", unhold);

        const onInvite = session.getRawSession().delegate!.onInvite!;
        onInvite({ body: "a=inactive\r\n" } as any, "", 200);
        onInvite({ body: "a=sendrecv\r\n" } as any, "", 200);

        expect(session.isOnHold()).toEqual({ local: false, remote: false });
        expect(unhold).toHaveBeenCalledWith({ originator: "remote" });
    });

    it("ignores re-INVITEs with no direction attribute (e.g. adding video)", () => {
        const session = new SipJSSession(createFakeSession());
        const hold = vi.fn();
        const unhold = vi.fn();
        session.on("hold", hold);
        session.on("unhold", unhold);

        const onInvite = session.getRawSession().delegate!.onInvite!;
        onInvite({ body: "v=0\r\nm=video 1 RTP/AVP 96\r\n" } as any, "", 200);

        expect(hold).not.toHaveBeenCalled();
        expect(unhold).not.toHaveBeenCalled();
    });
});

describe("SipJSSession.transfer (progress via REFER's implicit-subscription NOTIFYs)", () => {
    function fakeNotification(statusLine: string, subscriptionState = "active") {
        return {
            accept: vi.fn().mockResolvedValue(undefined),
            request: {
                body: statusLine,
                getHeader: vi.fn().mockReturnValue(subscriptionState),
            },
        };
    }

    it("reports non-final progress (e.g. 100 Trying) without marking the transfer done", async () => {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession);
        const progress = vi.fn();
        session.on("transfer-progress", progress);

        await session.transfer("1000");
        const onNotify = rawSession.refer.mock.calls[0][1].onNotify as (n: unknown) => void;
        const notification = fakeNotification("SIP/2.0 100 Trying", "active");
        onNotify(notification);

        expect(notification.accept).toHaveBeenCalled();
        expect(progress).toHaveBeenCalledWith({ statusCode: 100, reasonPhrase: "Trying", final: false });
    });

    it("marks the transfer final on a 200 OK sipfrag", async () => {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession);
        const progress = vi.fn();
        session.on("transfer-progress", progress);

        await session.transfer("1000");
        const onNotify = rawSession.refer.mock.calls[0][1].onNotify as (n: unknown) => void;
        onNotify(fakeNotification("SIP/2.0 200 OK", "terminated;reason=noresource"));

        expect(progress).toHaveBeenCalledWith({ statusCode: 200, reasonPhrase: "OK", final: true });
    });

    it("marks the transfer final when the subscription terminates even without a clean 2xx", async () => {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession);
        const progress = vi.fn();
        session.on("transfer-progress", progress);

        await session.transfer("1000");
        const onNotify = rawSession.refer.mock.calls[0][1].onNotify as (n: unknown) => void;
        onNotify(fakeNotification("SIP/2.0 487 Request Terminated", "terminated"));

        expect(progress).toHaveBeenCalledWith({ statusCode: 487, reasonPhrase: "Request Terminated", final: true });
    });
});

describe("SipJSSession.upgradeToVideo / downgradeToAudio", () => {
    it("upgradeToVideo() is a no-op if a video sender is already active", async () => {
        const pc = { getSenders: () => [{ track: { kind: "video" } }] };
        const rawSession = createFakeSession(pc);
        const session = new SipJSSession(rawSession);

        await session.upgradeToVideo();

        expect(rawSession.invite).not.toHaveBeenCalled();
    });

    it("upgradeToVideo() re-invites with video:true, letting sip.js acquire the camera itself", async () => {
        const pc = { getSenders: () => [{ track: { kind: "audio" } }] };
        const rawSession = createFakeSession(pc);
        const session = new SipJSSession(rawSession);

        await session.upgradeToVideo();

        expect(rawSession.invite).toHaveBeenCalledWith({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: true } },
        });
    });

    it("downgradeToAudio() is a no-op if there is no active video sender", async () => {
        const pc = { getSenders: () => [{ track: { kind: "audio" } }] };
        const rawSession = createFakeSession(pc);
        const session = new SipJSSession(rawSession);

        await session.downgradeToAudio();

        expect(rawSession.invite).not.toHaveBeenCalled();
    });

    it("downgradeToAudio() stops and clears the video sender's track, then re-invites with video:false", async () => {
        const videoTrack = { kind: "video", stop: vi.fn() };
        const replaceTrack = vi.fn().mockResolvedValue(undefined);
        const pc = { getSenders: () => [{ track: videoTrack, replaceTrack }] };
        const rawSession = createFakeSession(pc);
        const session = new SipJSSession(rawSession);

        await session.downgradeToAudio();

        expect(videoTrack.stop).toHaveBeenCalled();
        expect(replaceTrack).toHaveBeenCalledWith(null);
        expect(rawSession.invite).toHaveBeenCalledWith({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
        });
    });
});
