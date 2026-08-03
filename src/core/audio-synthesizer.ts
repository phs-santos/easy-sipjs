/**
 * Synthesizes telephone tones natively in the browser using the Web Audio API.
 * This completely eliminates the need for hosting/loading heavy sound files (.mp3/.wav) in basic scenarios.
 */
export class SipAudioSynthesizer {
    private ctx?: AudioContext;
    private oscillators: OscillatorNode[] = [];
    private gainNode?: GainNode;
    private timer?: ReturnType<typeof setTimeout>;
    private isPlaying = false;

    constructor() {}

    private initContext() {
        if (typeof window === "undefined") return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            this.ctx = new AudioCtx();
        }
    }

    public playRingback() {
        if (this.isPlaying) return;
        this.initContext();
        if (!this.ctx) return;
        this.isPlaying = true;

        const playTone = () => {
            if (!this.ctx || !this.isPlaying) return;
            
            if (this.ctx.state === "suspended") {
                this.ctx.resume();
            }

            // Create oscillators for 440Hz and 480Hz (US/Standard Ringback frequencies)
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc1.type = "sine";
            osc1.frequency.value = 440;

            osc2.type = "sine";
            osc2.frequency.value = 480;

            // Reduce volume so it's a pleasant background sound
            gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
            
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(this.ctx.destination);

            osc1.start();
            osc2.start();

            this.oscillators = [osc1, osc2];
            this.gainNode = gain;

            // US Ringback: 2 seconds on, 4 seconds off
            setTimeout(() => {
                this.stopOscillators();
                if (this.isPlaying) {
                    this.timer = setTimeout(playTone, 4000);
                }
            }, 2000);
        };

        playTone();
    }

    public playRingtone() {
        if (this.isPlaying) return;
        this.initContext();
        if (!this.ctx) return;
        this.isPlaying = true;

        const playTone = () => {
            if (!this.ctx || !this.isPlaying) return;
            
            if (this.ctx.state === "suspended") {
                this.ctx.resume();
            }

            // Dual tone European/US ring tone (400Hz + 450Hz) repeating cadence
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc1.type = "sine";
            osc1.frequency.value = 400;

            osc2.type = "sine";
            osc2.frequency.value = 450;

            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(this.ctx.destination);

            osc1.start();
            osc2.start();

            this.oscillators = [osc1, osc2];
            this.gainNode = gain;

            // Ring tone cadence: 1.5 seconds on, 3 seconds off
            setTimeout(() => {
                this.stopOscillators();
                if (this.isPlaying) {
                    this.timer = setTimeout(playTone, 3000);
                }
            }, 1500);
        };

        playTone();
    }

    public stop() {
        this.isPlaying = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.stopOscillators();
    }

    private stopOscillators() {
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
                osc.disconnect();
            } catch (e) {}
        });
        this.oscillators = [];
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {}
            this.gainNode = undefined;
        }
    }
}
