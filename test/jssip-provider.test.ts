import { describe, expect, it, vi } from "vitest";
import { JsSIPSession, JsSIPProvider } from "../src/core/jssip-provider.js";

function createFakeSession(connection?: unknown) {
    return {
        id: "session-1",
        on: vi.fn(),
        sendDTMF: vi.fn(),
        terminate: vi.fn(),
        hold: vi.fn(),
        unhold: vi.fn(),
        connection,
        isReadyToReOffer: vi.fn().mockReturnValue(true),
        renegotiate: vi.fn((_options?: unknown, done?: () => void) => { done?.(); return true; }),
    };
}

function trigger(rawSession: ReturnType<typeof createFakeSession>, event: string, payload?: unknown) {
    const call = rawSession.on.mock.calls.find(([e]) => e === event);
    expect(call, `expected a listener registered for "${event}"`).toBeDefined();
    (call![1] as (payload?: unknown) => void)(payload);
}

describe("JsSIPSession remote media wiring", () => {
    it("attaches the remote stream via the peer connection's 'track' event, not 'addtrack'", () => {
        const rawSession = createFakeSession();
        new JsSIPSession(rawSession);

        const peerConnectionCall = rawSession.on.mock.calls.find(([event]) => event === "peerconnection");
        expect(peerConnectionCall).toBeDefined();
        const peerConnectionHandler = peerConnectionCall![1] as (event: { peerconnection: unknown }) => void;

        const addEventListener = vi.fn();
        peerConnectionHandler({ peerconnection: { addEventListener } });

        expect(addEventListener).toHaveBeenCalledWith("track", expect.any(Function));
        expect(addEventListener).not.toHaveBeenCalledWith("addtrack", expect.any(Function));
    });

    it("assigns the incoming track's stream to the remote element", () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const remoteElement = {
            autoplay: false,
            srcObject: null,
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
        } as unknown as HTMLMediaElement;
        session.setRemoteElement(remoteElement);

        const peerConnectionHandler = rawSession.on.mock.calls.find(([event]) => event === "peerconnection")![1] as (event: { peerconnection: unknown }) => void;
        const addEventListener = vi.fn();
        peerConnectionHandler({ peerconnection: { addEventListener } });

        const trackHandler = addEventListener.mock.calls.find(([event]) => event === "track")![1] as (event: { streams: MediaStream[] }) => void;
        const stream = new MediaStream() as unknown as MediaStream;
        trackHandler({ streams: [stream] });

        expect(remoteElement.srcObject).toBe(stream);
    });
});

describe("JsSIPSession event bus (parity with SipJSSession's on/off)", () => {
    it("emits 'established' and 'state' when the call is accepted", () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const established = vi.fn();
        const state = vi.fn();
        session.on("established", established);
        session.on("state", state);

        trigger(rawSession, "accepted");

        expect(established).toHaveBeenCalledTimes(1);
        expect(state).toHaveBeenCalledWith("established");
    });

    it("emits 'terminating' then 'terminated' when bye() is called", async () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const terminating = vi.fn();
        const terminated = vi.fn();
        session.on("terminating", terminating);
        session.on("terminated", terminated);

        await session.bye();

        expect(rawSession.terminate).toHaveBeenCalled();
        expect(terminating).toHaveBeenCalledTimes(1);
        expect(terminated).toHaveBeenCalledTimes(1);
    });

    it("only emits 'terminated' once even if bye() and the session's own 'ended' event both fire", async () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const terminated = vi.fn();
        session.on("terminated", terminated);

        rawSession.terminate.mockImplementation(() => trigger(rawSession, "ended", { originator: "local", cause: "Terminated" }));
        await session.bye();

        expect(terminated).toHaveBeenCalledTimes(1);
    });

    it("emits 'hold' and 'unhold' with the originator jssip reports", () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const hold = vi.fn();
        const unhold = vi.fn();
        session.on("hold", hold);
        session.on("unhold", unhold);

        trigger(rawSession, "hold", { originator: "remote" });
        trigger(rawSession, "unhold", { originator: "local" });

        expect(hold).toHaveBeenCalledWith({ originator: "remote" });
        expect(unhold).toHaveBeenCalledWith({ originator: "local" });
    });

    it("isOnHold() delegates directly to jssip's native isOnHold()", () => {
        const rawSession = { ...createFakeSession(), isOnHold: vi.fn().mockReturnValue({ local: true, remote: false }) };
        const session = new JsSIPSession(rawSession);

        expect(session.isOnHold()).toEqual({ local: true, remote: false });
    });

    it("emits 'dtmf' for both incoming DTMF and sendDTMF()", async () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const dtmf = vi.fn();
        session.on("dtmf", dtmf);

        trigger(rawSession, "newDTMF", { dtmf: { tone: "5", duration: 100 } });
        await session.sendDTMF("7");

        expect(dtmf).toHaveBeenCalledWith({ tone: "5", durationMs: 100 });
        expect(dtmf).toHaveBeenCalledWith({ tone: "7", durationMs: undefined, mode: undefined });
    });

    it("off() stops further notifications", () => {
        const rawSession = createFakeSession();
        const session = new JsSIPSession(rawSession);

        const established = vi.fn();
        session.on("established", established);
        session.off("established", established);

        trigger(rawSession, "accepted");

        expect(established).not.toHaveBeenCalled();
    });
});

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

function createFakeSubscriber() {
    return {
        on: vi.fn(),
        subscribe: vi.fn(),
        terminate: vi.fn(),
    };
}

describe("JsSIPProvider.subscribePresence (parity with SipJSProvider)", () => {
    it("subscribes and reports presence updates parsed from the NOTIFY body", async () => {
        const provider = new JsSIPProvider();
        const subscriber = createFakeSubscriber();
        const fakeUa = { subscribe: vi.fn().mockReturnValue(subscriber) };
        (provider as unknown as { ua: unknown }).ua = fakeUa;
        (provider as unknown as { domain: string }).domain = "example.com";

        const onPresence = vi.fn();
        (provider as unknown as { onUserAgent: { onPresence: typeof onPresence } }).onUserAgent = { onPresence };

        await provider.subscribePresence("1000");

        expect(fakeUa.subscribe).toHaveBeenCalledWith(
            "sip:1000@example.com",
            "presence",
            "application/pidf+xml",
            expect.objectContaining({ expires: 3600 })
        );
        expect(subscriber.subscribe).toHaveBeenCalled();

        const notifyHandler = subscriber.on.mock.calls.find(([event]) => event === "notify")![1] as
            (isFinal: boolean, request: unknown, body: string, contentType: string) => void;
        notifyHandler(false, {}, "<basic>open</basic>", "application/pidf+xml");

        expect(onPresence).toHaveBeenCalledWith(expect.objectContaining({ target: "1000", status: "available" }));
    });

    it("unsubscribes by terminating the matching subscriber", async () => {
        const provider = new JsSIPProvider();
        const subscriber = createFakeSubscriber();
        const fakeUa = { subscribe: vi.fn().mockReturnValue(subscriber) };
        (provider as unknown as { ua: unknown }).ua = fakeUa;
        (provider as unknown as { domain: string }).domain = "example.com";

        await provider.subscribePresence("1000");
        await provider.unsubscribePresence("1000");

        expect(subscriber.terminate).toHaveBeenCalled();
    });
});

describe("JsSIPSession.upgradeToVideo / downgradeToAudio", () => {
    it("upgradeToVideo() is a no-op if a video sender is already active", async () => {
        const pc = { getSenders: () => [{ track: { kind: "video" } }] };
        const rawSession = createFakeSession(pc);
        const session = new JsSIPSession(rawSession);

        await session.upgradeToVideo();

        expect(rawSession.renegotiate).not.toHaveBeenCalled();
    });

    it("upgradeToVideo() throws without touching the camera if the session can't re-offer", async () => {
        const pc = { getSenders: () => [{ track: { kind: "audio" } }] };
        const rawSession = { ...createFakeSession(pc), isReadyToReOffer: vi.fn().mockReturnValue(false) };
        const session = new JsSIPSession(rawSession);
        const getUserMedia = vi.spyOn(navigator.mediaDevices, "getUserMedia");

        await expect(session.upgradeToVideo()).rejects.toThrow(/not ready/i);
        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it("upgradeToVideo() adds the camera track to the peer connection and renegotiates", async () => {
        const addTrack = vi.fn();
        const pc = { getSenders: () => [{ track: { kind: "audio" } }], addTrack };
        const rawSession = createFakeSession(pc);
        const session = new JsSIPSession(rawSession);

        const videoTrack = { kind: "video", stop: vi.fn() };
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue({
            getVideoTracks: () => [videoTrack],
            getTracks: () => [videoTrack],
        } as any);

        await session.upgradeToVideo();

        expect(addTrack).toHaveBeenCalledWith(videoTrack, expect.anything());
        expect(rawSession.renegotiate).toHaveBeenCalled();
    });

    it("downgradeToAudio() is a no-op if there is no active video sender", async () => {
        const pc = { getSenders: () => [{ track: { kind: "audio" } }] };
        const rawSession = createFakeSession(pc);
        const session = new JsSIPSession(rawSession);

        await session.downgradeToAudio();

        expect(rawSession.renegotiate).not.toHaveBeenCalled();
    });

    it("downgradeToAudio() stops and clears the video sender's track, then renegotiates", async () => {
        const videoTrack = { kind: "video", stop: vi.fn() };
        const replaceTrack = vi.fn().mockResolvedValue(undefined);
        const pc = { getSenders: () => [{ track: videoTrack, replaceTrack }] };
        const rawSession = createFakeSession(pc);
        const session = new JsSIPSession(rawSession);

        await session.downgradeToAudio();

        expect(videoTrack.stop).toHaveBeenCalled();
        expect(replaceTrack).toHaveBeenCalledWith(null);
        expect(rawSession.renegotiate).toHaveBeenCalled();
    });
});
