import { CallStats } from "./types.js";

export function ensureSipPrefix(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith("sip:") ? uri : `sip:${uri}`;
}

export function stripSipPrefix(uri: string): string {
    if (!uri) return uri;
    return uri.startsWith("sip:") ? uri.substring(4) : uri;
}

export async function parseRTCStats(pc: RTCPeerConnection): Promise<CallStats> {
    const stats = await pc.getStats();
    const result: CallStats = { jitter: 0, packetLoss: 0, roundTripTime: 0, codec: '', bytesSent: 0, bytesReceived: 0 };

    stats.forEach((s: any) => {
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
            result.jitter = s.jitter ?? 0;
            const lost = s.packetsLost ?? 0;
            const received = s.packetsReceived ?? 0;
            result.packetLoss = received + lost > 0 ? (lost / (received + lost)) * 100 : 0;
            result.bytesReceived = s.bytesReceived ?? 0;
        }
        if (s.type === 'outbound-rtp' && s.kind === 'audio') {
            result.bytesSent = s.bytesSent ?? 0;
        }
        if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') {
            result.roundTripTime = s.roundTripTime ?? 0;
        }
        if (s.type === 'codec') {
            result.codec = s.mimeType ?? '';
        }
    });

    return result;
}
