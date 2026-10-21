// Troca de microfone e compartilhamento de tela, como o cockpit (henrilgrim-phone) usa.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionState } from "sip.js";
import { SipJSSession } from "../src/core/sipjs-provider.js";

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
                getVideoTracks: () =>
                    localTracks.filter(
                        (t) => (t as { kind: string }).kind === "video"
                    ),
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

        expect(getUserMedia).toHaveBeenCalledWith({
            audio: expect.objectContaining({
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }),
        });
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
                        audio: expect.objectContaining({
                            deviceId: { exact: "mic-2" },
                        }),
                        video: true,
                    },
                },
            })
        );
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

describe("video lifecycle regression", () => {
    it("SIP.js: liga a câmera novamente depois de só áudio sem recapturar o microfone", async () => {
        const { session, senders, raw, audio, localTracks } = sipJsAudioCall();
        const old = fakeTrack("video");
        const video = sender(old);
        senders.push(video);
        localTracks.push(old);
        const next = fakeTrack("video");
        const capture = vi
            .spyOn(navigator.mediaDevices, "getUserMedia")
            .mockResolvedValue(streamOf(next));
        await session.downgradeToAudio();
        await session.upgradeToVideo();
        expect(capture).toHaveBeenCalledWith({ video: true });
        expect(video.track).toBe(next);
        expect(audio.track).not.toBeNull();
        expect(localTracks).toContain(next);
        expect(localTracks).not.toContain(old);
        expect(raw.invite).toHaveBeenCalledTimes(1);
    });

    it("SIP.js: libera a câmera se retomar o sender falhar e permite tentar de novo", async () => {
        const { session, senders } = sipJsAudioCall();
        const video = sender(fakeTrack("video"));
        senders.push(video);
        await session.downgradeToAudio();
        const next = fakeTrack("video");
        vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(
            streamOf(next)
        );
        video.replaceTrack.mockRejectedValueOnce(new Error("replace failed"));
        await expect(session.upgradeToVideo()).rejects.toThrow(
            "replace failed"
        );
        expect(next.stop).toHaveBeenCalled();
        await session.upgradeToVideo();
        expect(video.track).toBe(next);
    });

    for (const provider of ["SIP.js"]) {
        it(`${provider}: libera a tela se substituir a câmera falhar`, async () => {
            const call = sipJsAudioCall();
            const camera = sender(fakeTrack("video"));
            call.pc.getSenders().push(camera);
            const screen = fakeTrack("video");
            vi.spyOn(
                navigator.mediaDevices,
                "getDisplayMedia"
            ).mockResolvedValue(streamOf(screen));
            camera.replaceTrack.mockRejectedValueOnce(
                new Error("replace failed")
            );
            await expect(call.session.shareScreen()).rejects.toThrow(
                "replace failed"
            );
            expect(screen.stop).toHaveBeenCalled();
        });

        it(`${provider}: não abre duas capturas de tela enquanto o seletor está aberto`, async () => {
            const call = sipJsAudioCall();
            const screen = fakeTrack("video");
            let finish!: (stream: MediaStream) => void;
            const capture = vi
                .spyOn(navigator.mediaDevices, "getDisplayMedia")
                .mockReturnValue(
                    new Promise((resolve) => {
                        finish = resolve;
                    })
                );
            const first = call.session.shareScreen();
            await expect(call.session.shareScreen()).rejects.toThrow(
                "already being selected"
            );
            finish(streamOf(screen));
            await first;
            expect(capture).toHaveBeenCalledTimes(1);
            await call.session.stopScreenSharing();
        });
    }
});
