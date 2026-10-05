import { CallStats } from "./types.js";

interface RTCRtpStreamStatsLike extends RTCStats {
    kind?: string;
    jitter?: number;
    packetsLost?: number;
    packetsReceived?: number;
    bytesReceived?: number;
    bytesSent?: number;
    roundTripTime?: number;
    mimeType?: string;
    codecId?: string;
}

export function ensureSipPrefix(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith("sip:") ? uri : `sip:${uri}`;
}

export function stripSipPrefix(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith("sip:") ? uri.substring(4) : uri;
}

export function emptyCallStats(): CallStats {
    return { jitter: 0, packetLoss: 0, roundTripTime: 0, codec: '', bytesSent: 0, bytesReceived: 0 };
}

/**
 * Reads call stats from a peer connection. WebRTC reports packet counters
 * accumulated since the call started, so the sampler keeps the previous
 * reading and reports loss over the interval between samples — otherwise one
 * bad minute would drag the percentage for the rest of the call.
 */
export class CallStatsSampler {
    private previous?: { lost: number; received: number };
    private packetLoss = 0;

    async sample(pc: RTCPeerConnection): Promise<CallStats> {
        const stats = await pc.getStats();
        const result = emptyCallStats();
        let inboundCodecId: string | undefined;
        let fallbackCodec = '';

        stats.forEach((s: RTCRtpStreamStatsLike) => {
            if (s.type === 'inbound-rtp' && s.kind === 'audio') {
                result.jitter = s.jitter ?? 0;
                result.bytesReceived = s.bytesReceived ?? 0;
                inboundCodecId = s.codecId;
                this.updatePacketLoss(s.packetsLost ?? 0, s.packetsReceived ?? 0);
            }
            if (s.type === 'outbound-rtp' && s.kind === 'audio') {
                result.bytesSent = s.bytesSent ?? 0;
            }
            if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') {
                result.roundTripTime = s.roundTripTime ?? 0;
            }
            if (s.type === 'codec' && s.mimeType) {
                if (!fallbackCodec || s.mimeType.startsWith('audio/')) fallbackCodec = s.mimeType;
            }
        });

        const inboundCodec = inboundCodecId
            ? (stats as unknown as Map<string, RTCRtpStreamStatsLike>).get?.(inboundCodecId)
            : undefined;
        result.codec = inboundCodec?.mimeType ?? fallbackCodec;
        result.packetLoss = this.packetLoss;
        return result;
    }

    private updatePacketLoss(lost: number, received: number): void {
        const previous = this.previous;
        this.previous = { lost, received };

        const deltaLost = previous ? Math.max(0, lost - previous.lost) : lost;
        const deltaReceived = previous ? Math.max(0, received - previous.received) : received;
        const total = deltaLost + deltaReceived;
        // No packets since the last sample (e.g. two reads in a row): keep the last value.
        if (total > 0) this.packetLoss = (deltaLost / total) * 100;
    }
}

/** One-off read; loss is accumulated since the call started. Prefer `CallStatsSampler` for repeated reads. */
export async function parseRTCStats(pc: RTCPeerConnection): Promise<CallStats> {
    return new CallStatsSampler().sample(pc);
}
