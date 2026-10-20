// Sprint 3 (continuação) — troca de microfone (doc/SPRINT-3-CONTINUACAO.md).
// A entrega original não tinha testes para estes casos.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionState } from "sip.js";
import { SipJSSession } from "../src/core/sipjs-provider.js";
import { JsSIPSession } from "../src/core/jssip-provider.js";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

function fakeTrack(kind = "audio") {
    return { kind, stop: vi.fn(), enabled: true };
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
    return { getAudioTracks: () => tracks.filter((t) => t.kind === "audio"), getTracks: () => tracks } as unknown as MediaStream;
}

function sipJsSession() {
    const sender = { track: fakeTrack() as unknown, replaceTrack: vi.fn(async (t: unknown) => { sender.track = t; }) };
    const pc = { getSenders: () => [sender], addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const raw = {
        id: "s1",
        state: SessionState.Established,
        stateChange: { addListener: vi.fn() },
        delegate: undefined,
        remoteIdentity: { uri: { host: "example.com" } },
        sessionDescriptionHandler: { peerConnection: pc },
        bye: vi.fn().mockResolvedValue(undefined),
    } as any;
    return { session: new SipJSSession(raw), sender };
}

function jsSipSession() {
    const sender = { track: fakeTrack() as unknown, replaceTrack: vi.fn(async (t: unknown) => { sender.track = t; }) };
    const raw = { id: "s1", on: vi.fn(), terminate: vi.fn(), connection: { getSenders: () => [sender] } };
    return { session: new JsSIPSession(raw as any), sender };
}

const providers = [
    ["SIP.js", sipJsSession],
    ["JsSIP", jsSipSession],
] as const;

afterEach(() => { vi.restoreAllMocks(); });

describe.each(providers)("Sprint 3 — setAudioInput (%s)", (_name, create) => {
    it("caso 1: não instala o microfone se a chamada termina com a permissão pendente", async () => {
        const { session, sender } = create();
        const pending = deferred<MediaStream>();
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(pending.promise);
        const newTrack = fakeTrack();

        const changing = session.setAudioInput("mic-2");
        await session.bye();
        pending.resolve(fakeStream([newTrack]));

        await expect(changing).rejects.toThrow();
        expect(sender.replaceTrack).not.toHaveBeenCalled();
        expect(newTrack.stop).toHaveBeenCalled();
    });

    it("caso 2: recusa uma segunda troca enquanto a primeira está pendente", async () => {
        const { session } = create();
        const pending = deferred<MediaStream>();
        const getUserMedia = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(pending.promise);

        const first = session.setAudioInput("mic-2");
        await expect(session.setAudioInput("mic-3")).rejects.toThrow(/in progress/);
        pending.resolve(fakeStream([fakeTrack()]));
        await first;

        expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it("caso 3: rejeita e libera as tracks quando o dispositivo não entrega áudio", async () => {
        const { session, sender } = create();
        const videoOnly = fakeTrack("video");
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(fakeStream([videoOnly]));

        await expect(session.setAudioInput("mic-2")).rejects.toThrow(/No audio track/);
        expect(videoOnly.stop).toHaveBeenCalled();
        expect(sender.replaceTrack).not.toHaveBeenCalled();
    });
});
