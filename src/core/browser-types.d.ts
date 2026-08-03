/**
 * Ambient augmentations for browser APIs missing from TypeScript's lib.dom.d.ts:
 * `setSinkId` (Audio Output Devices API) and the WebKit-prefixed `AudioContext`.
 */
declare global {
    interface HTMLMediaElement {
        setSinkId?(sinkId: string): Promise<void>;
    }

    interface Window {
        webkitAudioContext?: typeof AudioContext;
    }
}

export {};
