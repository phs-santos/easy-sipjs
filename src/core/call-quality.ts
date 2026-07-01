import { CallQualitySnapshot, CallStats } from "./types.js";

export function createCallQualitySnapshot(stats: CallStats): CallQualitySnapshot {
    const jitterMs = (stats.jitter || 0) * 1000;
    const rttMs = (stats.roundTripTime || 0) * 1000;
    const packetLossPercent = stats.packetLoss || 0;

    let score = 100;
    score -= Math.min(35, packetLossPercent * 4);
    score -= Math.min(25, Math.max(0, jitterMs - 10) * 0.5);
    score -= Math.min(30, Math.max(0, rttMs - 80) * 0.08);
    score = Math.max(0, Math.round(score));

    const level: CallQualitySnapshot["level"] =
        packetLossPercent >= 8 || rttMs >= 500 || jitterMs >= 80 || score < 45
            ? "bad"
            : packetLossPercent >= 4 || rttMs >= 250 || jitterMs >= 40 || score < 65
                ? "warning"
                : packetLossPercent >= 1.5 || rttMs >= 150 || jitterMs >= 25 || score < 82
                    ? "good"
                    : "excellent";

    const recommendation = getRecommendation(level, { jitterMs, rttMs, packetLossPercent });

    return {
        ...stats,
        score,
        level,
        jitterMs,
        rttMs,
        packetLossPercent,
        recommendation,
        sampledAt: new Date(),
    };
}

function getRecommendation(
    level: CallQualitySnapshot["level"],
    metrics: { jitterMs: number; rttMs: number; packetLossPercent: number }
): string {
    if (level === "excellent") return "Áudio estável. Condição ideal para atendimento.";
    if (metrics.packetLossPercent >= 4) return "Perda de pacotes alta. Verifique Wi‑Fi, VPN, firewall ou rota até o PBX.";
    if (metrics.jitterMs >= 40) return "Jitter alto. Prefira cabo/rede estável e evite concorrência de banda.";
    if (metrics.rttMs >= 250) return "Latência elevada. Verifique distância/rota até o servidor SIP/WebRTC.";
    return "Chamada utilizável, mas com sinais de degradação. Monitorar se houver cortes.";
}
