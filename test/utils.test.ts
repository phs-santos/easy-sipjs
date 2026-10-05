import { describe, expect, it } from "vitest";
import { CallStatsSampler } from "../src/core/utils.js";

function fakePeerConnection(samples: Array<{ lost: number; received: number }>) {
    let index = 0;
    return {
        getStats: async () => {
            const sample = samples[Math.min(index++, samples.length - 1)];
            return new Map<string, unknown>([
                ["in", { type: "inbound-rtp", kind: "audio", packetsLost: sample.lost, packetsReceived: sample.received, codecId: "c-audio" }],
                ["c-video", { type: "codec", mimeType: "video/VP8" }],
                ["c-audio", { type: "codec", mimeType: "audio/opus" }],
            ]);
        },
    } as unknown as RTCPeerConnection;
}

describe("CallStatsSampler", () => {
    it("reports packet loss over the interval between samples, not since the call started", async () => {
        const pc = fakePeerConnection([
            { lost: 100, received: 900 },   // a bad start: 10%
            { lost: 100, received: 1900 },  // then 1000 clean packets
            { lost: 150, received: 2850 },  // then 50 lost out of 1000
        ]);
        const sampler = new CallStatsSampler();

        expect((await sampler.sample(pc)).packetLoss).toBeCloseTo(10);
        expect((await sampler.sample(pc)).packetLoss).toBe(0);
        expect((await sampler.sample(pc)).packetLoss).toBeCloseTo(5);
    });

    it("keeps the last value when no packets arrived between two samples", async () => {
        const pc = fakePeerConnection([{ lost: 100, received: 900 }, { lost: 100, received: 900 }]);
        const sampler = new CallStatsSampler();

        await sampler.sample(pc);
        expect((await sampler.sample(pc)).packetLoss).toBeCloseTo(10);
    });

    it("reports the codec of the inbound audio stream, not whichever codec is listed last", async () => {
        const sampler = new CallStatsSampler();
        expect((await sampler.sample(fakePeerConnection([{ lost: 0, received: 1 }]))).codec).toBe("audio/opus");
    });
});
