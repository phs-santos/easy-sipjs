interface Tone {
    frequencies: number[];
    volume: number;
    onMs: number;
    offMs: number;
}

// US/standard ringback: 440Hz + 480Hz, 2 seconds on, 4 seconds off.
const RINGBACK: Tone = { frequencies: [440, 480], volume: 0.08, onMs: 2000, offMs: 4000 };
// Dual-tone ring (400Hz + 450Hz), 1.5 seconds on, 3 seconds off.
const RINGTONE: Tone = { frequencies: [400, 450], volume: 0.12, onMs: 1500, offMs: 3000 };

// One context for every synthesizer: creating an AudioContext per ring spins up
// an audio thread each time and browsers cap how many may exist. It is
// suspended while nothing plays so the audio thread goes idle.
let sharedContext: AudioContext | undefined;
let activeVoices = 0;

function acquireContext(): AudioContext | undefined {
    if (sharedContext) return sharedContext;
    if (typeof window === "undefined") return undefined;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) sharedContext = new AudioCtx();
    return sharedContext;
}

/**
 * Synthesizes telephone tones natively in the browser using the Web Audio API.
 * This completely eliminates the need for hosting/loading heavy sound files (.mp3/.wav) in basic scenarios.
 */
export class SipAudioSynthesizer {
    private oscillators: OscillatorNode[] = [];
    private gainNode?: GainNode;
    private timer?: ReturnType<typeof setTimeout>;
    private isPlaying = false;

    public playRingback() { this.play(RINGBACK); }
    public playRingtone() { this.play(RINGTONE); }

    public stop() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
                osc.disconnect();
            } catch (e) {}
        });
        this.oscillators = [];
        try { this.gainNode?.disconnect(); } catch (e) {}
        this.gainNode = undefined;

        activeVoices = Math.max(0, activeVoices - 1);
        if (activeVoices === 0 && sharedContext?.state === "running") {
            void sharedContext.suspend().catch(() => {});
        }
    }

    private play(tone: Tone) {
        if (this.isPlaying) return;
        const ctx = acquireContext();
        if (!ctx) return;
        this.isPlaying = true;
        activeVoices += 1;
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});

        // The oscillators run for the whole ring; the cadence is just the gain
        // opening and closing, so there is a single timer to cancel on stop().
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        this.gainNode = gain;
        this.oscillators = tone.frequencies.map(frequency => {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = frequency;
            osc.connect(gain);
            osc.start();
            return osc;
        });

        const cycle = () => {
            if (!this.isPlaying) return;
            const now = ctx.currentTime;
            gain.gain.setValueAtTime(tone.volume, now);
            gain.gain.setValueAtTime(0, now + tone.onMs / 1000);
            this.timer = setTimeout(cycle, tone.onMs + tone.offMs);
        };
        cycle();
    }
}
