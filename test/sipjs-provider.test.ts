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
        // sip.js resolves invite() when the re-INVITE is sent; the peer's answer arrives through requestDelegate.
        invite: vi.fn((options?: { requestDelegate?: { onAccept?: () => void } }) => {
            options?.requestDelegate?.onAccept?.();
            return Promise.resolve();
        }),
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

        expect(rawSession.invite).toHaveBeenCalledWith(expect.objectContaining({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: true } },
        }));
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
        expect(rawSession.invite).toHaveBeenCalledWith(expect.objectContaining({
            sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
        }));
    });
});

describe("SipJSSession.hold / unhold (wait for the peer's answer to the re-INVITE)", () => {
    it("only reports the hold once the re-INVITE is accepted", async () => {
        const rawSession = createFakeSession();
        let accept: (() => void) | undefined;
        rawSession.invite = vi.fn((options: { requestDelegate: { onAccept: () => void } }) => {
            accept = options.requestDelegate.onAccept;
            return Promise.resolve();
        });
        const session = new SipJSSession(rawSession);
        const hold = vi.fn();
        session.on("hold", hold);

        const pending = session.hold();
        await Promise.resolve();
        expect(session.isOnHold().local).toBe(false);
        expect(hold).not.toHaveBeenCalled();

        accept!();
        await pending;
        expect(session.isOnHold().local).toBe(true);
        expect(hold).toHaveBeenCalledWith({ originator: "local" });
    });

    it("rejects and stays off hold when the peer refuses the re-INVITE", async () => {
        const rawSession = createFakeSession();
        rawSession.invite = vi.fn((options: { requestDelegate: { onReject: (r: unknown) => void } }) => {
            options.requestDelegate.onReject({ message: { statusCode: 488 } });
            return Promise.resolve();
        });
        const session = new SipJSSession(rawSession);

        await expect(session.hold()).rejects.toThrow(/488/);
        expect(session.isOnHold().local).toBe(false);
    });

    it("refuses a second re-INVITE while one is still in progress instead of silently doing nothing", async () => {
        const rawSession = createFakeSession();
        rawSession.invite = vi.fn(() => Promise.resolve()); // never answered
        const session = new SipJSSession(rawSession);

        void session.hold();
        await expect(session.upgradeToVideo()).rejects.toThrow(/in progress/i);
    });

    it("unhold() is a no-op when the call isn't on hold", async () => {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession);

        await session.unhold();

        expect(rawSession.invite).not.toHaveBeenCalled();
    });
});

describe("SipJSSession failure ordering", () => {
    it("carries the failure reported by the INVITE into 'terminated'", () => {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession);
        const terminated = vi.fn();
        session.on("terminated", terminated);

        session.emitFailed({ statusCode: 486, reasonPhrase: "Busy Here" });
        const onStateChange = rawSession.stateChange.addListener.mock.calls[0][0] as (state: SessionState) => void;
        onStateChange(SessionState.Terminated);

        expect(terminated).toHaveBeenCalledWith({ statusCode: 486, reasonPhrase: "Busy Here" });
    });
});

describe("SipJSSession hold strategies", () => {
    async function holdModifiers(holdStrategy?: "asterisk-inactive" | "asterisk-sendonly") {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession, { holdStrategy });
        await session.hold();
        const [modifier] = rawSession.invite.mock.calls[0][0].sessionDescriptionHandlerModifiers;
        return (await modifier({ type: "offer", sdp: "m=audio 1 RTP/AVP 0\r\na=sendrecv\r\n" })).sdp as string;
    }

    it("holds with a=inactive by default (Asterisk-friendly)", async () => {
        expect(await holdModifiers()).toContain("a=inactive");
    });

    it("holds with a=sendonly for 'asterisk-sendonly'", async () => {
        expect(await holdModifiers("asterisk-sendonly")).toContain("a=sendonly");
    });

    it("uses sip.js's own hold flag for 'sipjs-default', and clears it on unhold", async () => {
        const rawSession = createFakeSession();
        rawSession.sessionDescriptionHandlerOptionsReInvite = { constraints: { audio: true } };
        const session = new SipJSSession(rawSession, { holdStrategy: "sipjs-default" });

        await session.hold();
        await session.unhold();

        const [holdCall, unholdCall] = rawSession.invite.mock.calls.map(([options]: [any]) => options.sessionDescriptionHandlerOptions);
        expect(holdCall).toEqual({ constraints: { audio: true }, hold: true });
        expect(unholdCall).toEqual({ constraints: { audio: true }, hold: false });
    });
});

describe("SipJSSession DTMF default mode", () => {
    it("uses the session's configured mode when sendDTMF() doesn't name one", async () => {
        const insertDTMF = vi.fn();
        const pc = { getSenders: () => [{ track: { kind: "audio" }, dtmf: { insertDTMF } }] };
        const rawSession = createFakeSession(pc);
        rawSession.info = vi.fn().mockResolvedValue(undefined);
        const session = new SipJSSession(rawSession, { dtmfMode: "rtp-event" });

        await session.sendDTMF("5");

        expect(insertDTMF).toHaveBeenCalledWith("5", 160);
        expect(rawSession.info).not.toHaveBeenCalled();
    });
});

describe("SipJSSession media recovery", () => {
    function createRecoverableSession(settings = {}) {
        const listeners = new Map<string, () => void>();
        const pc = {
            iceConnectionState: "connected",
            connectionState: "connected",
            getSenders: () => [],
            addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
        };
        const rawSession = createFakeSession(pc);
        rawSession.sessionDescriptionHandlerOptionsReInvite = { constraints: { audio: true } };
        const session = new SipJSSession(rawSession, settings);
        // The recovery listeners are bound when the call is established.
        const onStateChange = rawSession.stateChange.addListener.mock.calls[0][0] as (state: SessionState) => void;
        onStateChange(SessionState.Established);
        const setIceState = (state: string) => {
            pc.iceConnectionState = state;
            listeners.get("iceconnectionstatechange")!();
        };
        return { rawSession, session, setIceState };
    }

    it("restarts ICE after a short grace period on 'disconnected', without waiting for 'failed'", async () => {
        vi.useFakeTimers();
        try {
            const { rawSession, setIceState } = createRecoverableSession({ mediaRecovery: { disconnectedGraceMs: 3000 } });

            setIceState("disconnected");
            await vi.advanceTimersByTimeAsync(2999);
            expect(rawSession.invite).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(rawSession.invite).toHaveBeenCalledWith(expect.objectContaining({
                sessionDescriptionHandlerOptions: { constraints: { audio: true }, offerOptions: { iceRestart: true } },
            }));
            // The ICE-restart flag must not leak into later re-INVITEs (hold, video...).
            expect(rawSession.sessionDescriptionHandlerOptionsReInvite).toEqual({ constraints: { audio: true } });
        } finally {
            vi.useRealTimers();
        }
    });

    it("does nothing when the connection comes back within the grace period", async () => {
        vi.useFakeTimers();
        try {
            const { rawSession, setIceState } = createRecoverableSession();

            setIceState("disconnected");
            await vi.advanceTimersByTimeAsync(1000);
            setIceState("connected");
            await vi.advanceTimersByTimeAsync(10000);

            expect(rawSession.invite).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("only reports the failure when recovery is disabled", async () => {
        const { rawSession, session, setIceState } = createRecoverableSession({ mediaRecovery: { enabled: false } });
        const failed = vi.fn();
        session.on("media-failed", failed);

        setIceState("failed");
        await Promise.resolve();

        expect(failed).toHaveBeenCalledTimes(1);
        expect(rawSession.invite).not.toHaveBeenCalled();
    });

    it("recoverMedia() is a no-op while media is flowing", async () => {
        const { rawSession, session } = createRecoverableSession();

        await session.recoverMedia();

        expect(rawSession.invite).not.toHaveBeenCalled();
    });
});

describe("SipJSSession in-dialog MESSAGE", () => {
    it("answers 200 OK by itself and leaves accept() harmless for apps that still call it", async () => {
        const rawSession = createFakeSession();
        const session = new SipJSSession(rawSession);
        const received = vi.fn();
        session.on("message", received);
        const accept = vi.fn().mockResolvedValue(undefined);
        const message = { accept, request: { body: "oi", getHeader: () => "text/plain" } };

        rawSession.delegate.onMessage(message);
        await message.accept();

        expect(accept).toHaveBeenCalledTimes(1);
        expect(received).toHaveBeenCalledWith(expect.objectContaining({ body: "oi", contentType: "text/plain" }));
    });
});
