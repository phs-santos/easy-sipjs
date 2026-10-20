import { describe, expect, it } from "vitest";
import { voiceCaptureConstraints } from "../src/core/audio-constraints.js";

describe("voiceCaptureConstraints", () => {
    it("solicita processamento de voz sem exigir deviceId", () => {
        expect(voiceCaptureConstraints()).toEqual({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        });
    });
    it("preserva seleção explícita de microfone", () => {
        expect(voiceCaptureConstraints("microphone-1")).toMatchObject({
            deviceId: { exact: "microphone-1" },
            echoCancellation: true,
        });
    });
    it("não fixa o dispositivo padrão", () => {
        expect(voiceCaptureConstraints("default")).not.toHaveProperty(
            "deviceId"
        );
    });
});
