// Troca de microfone e compartilhamento de tela, como o cockpit (henrilgrim-phone) usa.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionState } from "sip.js";
import { SipJSSession } from "../src/core/sipjs-provider.js";
import { JsSIPSession } from "../src/core/jssip-provider.js";

function fakeTrack(kind: string) {
    return {
        kind,
        stop: vi.fn(),
        enabled: true,
        onended: null as null | (() => void),
    };
}

function streamOf(...tracks: ReturnType<typeof fakeTrack>[]) {
    return {
        getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
        getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
        getTracks: () => tracks,
    } as unknown as MediaStream;
}

function sender(track: unknown) {
    const s = {
        track,
        replaceTrack: vi.fn(async (t: unknown) => {
            s.track = t;
        }),
    };
    return s;
}

/** Chamada SIP.js só de áudio, já estabelecida. `accept` decide se o re-INVITE é aceito. */
function sipJsAudioCall(accept = true) {
    const audio = sender(fakeTrack("audio"));
    const senders: Array<ReturnType<typeof sender>> = [audio];
    const localTracks: unknown[] = [audio.track];
    const pc = {
        getSenders: () => senders,
        addTrack: vi.fn((track: unknown) => {
            const s = sender(track);
            senders.push(s);
            return s;
        }),
        removeTrack: vi.fn((s: unknown) => {
            senders.splice(senders.indexOf(s as never), 1);
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    const raw = {
        id: "s1",
        state: SessionState.Established,
        stateChange: { addListener: vi.fn() },
        delegate: undefined,
        remoteIdentity: { uri: { host: "example.com" } },
        sessionDescriptionHandler: {
            peerConnection: pc,
            localMediaStream: {
                addTrack: (t: unknown) => localTracks.push(t),
                removeTrack: (t: unknown) =>
                    localTracks.splice(localTracks.indexOf(t), 1),
                getAudioTracks: () =>
                    localTracks.filter(
                        (t) => (t as { kind: string }).kind === "audio"
                    ),
            },
        },
        bye: vi.fn().mockResolvedValue(undefined),
        invite: vi.fn(
            (options?: {
                requestDelegate?: {
                    onAccept?: () => void;
                    onReject?: (r: unknown) => void;
                };
            }) => {
                if (accept) options?.requestDelegate?.onAccept?.();
                else
                    options?.requestDelegate?.onReject?.({
                        message: {
                            statusCode: 488,
                            reasonPhrase: "Not Acceptable Here",
                        },
                    });
                return Promise.resolve();
            }
        ),
    } as any;
    return {
        session: new SipJSSession(raw),
        raw,
        pc,
        audio,
        senders,
        localTracks,
    };
}

function jsSipAudioCall(muted = false) {
    const audio = sender(fakeTrack("audio"));
    const senders: Array<ReturnType<typeof sender>> = [audio];
    const pc = {
        getSenders: () => senders,
        addTrack: vi.fn((track: unknown) => {
            const s = sender(track);
            senders.push(s);
            return s;
        }),
        removeTrack: vi.fn(),
    };
    const raw = {
        id: "s1",
        on: vi.fn(),
        terminate: vi.fn(),
        connection: pc,
        isMuted: () => ({ audio: muted, video: false }),
        isReadyToReOffer: vi.fn().mockReturnValue(true),
        renegotiate: vi.fn((_o: unknown, done?: () => void) => {
            done?.();
            return true;
        }),
    };
    return { session: new JsSIPSession(raw as any), raw, pc, audio };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("setAudioInput", () => {
    it("SIP.js: id vazio volta ao microfone padrão em vez de pedir o dispositivo ''", async () => {
        const { session } = sipJsAudioCall();
        const getUserMedia = vi
            .spyOn(navigator.mediaDevices, "getUserMedia")
            .mockResolvedValue(streamOf(fakeTrack("audio")));

        await session.setAudioInput("");

        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    it("SIP.js: troca com a chamada no mudo continua no mudo", async () => {
        const { session, audio } = sipJsAudioCall();
        const newTrack = fakeTrack("audio");
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(
            streamOf(newTrack)
        );
        session.mute();

        await session.setAudioInput("mic-2");

        expect(audio.track).toBe(newTrack);
        expect(newTrack.enabled).toBe(false);
    });

    it("SIP.js: atualiza o stream local do sip.js com o microfone novo", async () => {
        const { session, localTracks } = sipJsAudioCall();
        const newTrack = fakeTrack("audio");
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(
            streamOf(newTrack)
        );

        await session.setAudioInput("mic-2");

        expect(localTracks).toEqual([newTrack]);
    });

    it("SIP.js: ativar vídeo depois de trocar o microfone mantém o microfone escolhido", async () => {
        const { session, raw } = sipJsAudioCall();
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(
            streamOf(fakeTrack("audio"))
        );
        await session.setAudioInput("mic-2");

        await session.upgradeToVideo();

        expect(raw.invite).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionDescriptionHandlerOptions: {
                    constraints: {
                        audio: { deviceId: { exact: "mic-2" } },
                        video: true,
                    },
                },
            })
        );
    });

    it("JsSIP: id vazio volta ao padrão e o mudo é mantido", async () => {
        const { session } = jsSipAudioCall(true);
        const newTrack = fakeTrack("audio");
        const getUserMedia = vi
            .spyOn(navigator.mediaDevices, "getUserMedia")
            .mockResolvedValue(streamOf(newTrack));

        await session.setAudioInput("default");

        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(newTrack.enabled).toBe(false);
    });
});

describe("shareScreen numa chamada só de áudio", () => {
    it("SIP.js: adiciona a tela como vídeo e renegocia; parar e compartilhar de novo reaproveita o stream", async () => {
        const { session, raw, pc, senders } = sipJsAudioCall();
        const first = fakeTrack("video");
        const second = fakeTrack("video");
        vi.spyOn(navigator.mediaDevices, "getDisplayMedia")
            .mockResolvedValueOnce(streamOf(first))
            .mockResolvedValueOnce(streamOf(second));

        await session.shareScreen();
        expect(pc.addTrack).toHaveBeenCalledWith(first, expect.anything());
        expect(raw.invite).toHaveBeenCalledTimes(1);

        await session.stopScreenSharing();
        expect(first.stop).toHaveBeenCalled();
        expect(senders[1].track).toBeNull();

        await session.shareScreen();
        expect(senders[1].track).toBe(second);
        expect(pc.addTrack).toHaveBeenCalledTimes(1);
        expect(raw.invite).toHaveBeenCalledTimes(1);
    });

    it("SIP.js: se o outro lado recusa o re-INVITE, desfaz e libera a captura de tela", async () => {
        const { session, pc } = sipJsAudioCall(false);
        const screen = fakeTrack("video");
        vi.spyOn(navigator.mediaDevices, "getDisplayMedia").mockResolvedValue(
            streamOf(screen)
        );

        await expect(session.shareScreen()).rejects.toThrow(/488/);
        expect(pc.removeTrack).toHaveBeenCalled();
        expect(screen.stop).toHaveBeenCalled();
    });

    it("JsSIP: adiciona a tela como vídeo e renegocia", async () => {
        const { session, raw, pc } = jsSipAudioCall();
        const screen = fakeTrack("video");
        vi.spyOn(navigator.mediaDevices, "getDisplayMedia").mockResolvedValue(
            streamOf(screen)
        );

        await session.shareScreen();

        expect(pc.addTrack).toHaveBeenCalledWith(screen, expect.anything());
        expect(raw.renegotiate).toHaveBeenCalledTimes(1);
    });

    it("SIP.js: encerrar a chamada durante o compartilhamento para a captura", async () => {
        const { session } = sipJsAudioCall();
        const screen = fakeTrack("video");
        vi.spyOn(navigator.mediaDevices, "getDisplayMedia").mockResolvedValue(
            streamOf(screen)
        );
        await session.shareScreen();

        await session.bye();

        expect(screen.stop).toHaveBeenCalled();
    });
});
