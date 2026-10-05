/**
 * DOM-only media helpers shared by every provider. Keep this file free of
 * SIP-stack imports so each provider chunk stays independent.
 */

export function assignStream(stream: MediaStream, element: HTMLMediaElement): void {
    element.autoplay = true;
    if (element.srcObject !== stream) {
        element.srcObject = stream;
    }
    element.play().catch(err => console.error("Media play failed:", err));

    stream.onaddtrack = () => element.play().catch(console.error);
    stream.onremovetrack = () => element.play().catch(console.error);
}

export function releaseElement(element?: HTMLMediaElement): void {
    if (!element) return;
    try { element.pause(); } catch (_) {}
    element.srcObject = null;
}

// `createMediaElementSource` binds an element to its AudioContext for good, so
// the boost graph lives as long as the element does and is never torn down per
// call — closing the context would leave the element silent on the next call.
let boostContext: AudioContext | undefined;
const boosts = new WeakMap<HTMLMediaElement, GainNode>();

function createBoost(element: HTMLMediaElement): GainNode | undefined {
    if (typeof window === "undefined") return undefined;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return undefined;
    boostContext ??= new AudioCtx();
    const gain = boostContext.createGain();
    boostContext.createMediaElementSource(element).connect(gain);
    gain.connect(boostContext.destination);
    boosts.set(element, gain);
    return gain;
}

/**
 * 0–1 uses the element's own volume. Above 1 amplifies through a Web Audio
 * gain node, created once per element and only when first needed.
 */
export function setElementVolume(element: HTMLMediaElement, volume: number): void {
    const value = Math.max(0, volume);
    const gain = boosts.get(element) ?? (value > 1 ? createBoost(element) : undefined);
    if (!gain) {
        element.volume = Math.min(1, value);
        return;
    }
    if (boostContext?.state === "suspended") void boostContext.resume().catch(() => {});
    element.volume = 1;
    gain.gain.value = value;
}

export async function setElementSink(element: HTMLMediaElement, deviceId: string): Promise<void> {
    if (typeof element.setSinkId === "function") {
        await element.setSinkId(deviceId);
    }
    // A boosted element plays through the shared context, not its own sink.
    const context = boostContext as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined;
    if (boosts.has(element) && typeof context?.setSinkId === "function") {
        await context.setSinkId(deviceId);
    }
}
