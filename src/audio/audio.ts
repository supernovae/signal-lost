export type SoundName = 'startup' | 'interference' | 'success' | 'error';

export interface GameAudio {
  /** Call from a user gesture. Nothing can sound before this. */
  unlock(): void;
  play(name: SoundName): void;
  setMuted(muted: boolean): void;
}

interface Tone {
  frequency: number;
  endFrequency?: number;
  start: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

const TONES: Record<Exclude<SoundName, 'interference'>, Tone[]> = {
  startup: [
    { frequency: 110, endFrequency: 440, start: 0, duration: 0.5, type: 'square', gain: 0.03 },
    { frequency: 880, start: 0.55, duration: 0.08, type: 'square', gain: 0.03 },
    { frequency: 660, start: 0.7, duration: 0.12, type: 'square', gain: 0.03 },
  ],
  success: [
    { frequency: 523, start: 0, duration: 0.1, type: 'triangle', gain: 0.1 },
    { frequency: 784, start: 0.12, duration: 0.22, type: 'triangle', gain: 0.1 },
  ],
  error: [
    { frequency: 140, endFrequency: 90, start: 0, duration: 0.22, type: 'sawtooth', gain: 0.05 },
  ],
};

/** All sound is synthesized here. There are no audio files. */
export function createAudio(): GameAudio {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let noise: AudioBuffer | undefined;
  let muted = false;

  const applyMute = (): void => {
    if (context && master) master.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
  };

  const startAmbient = (ctx: AudioContext, output: AudioNode): void => {
    // Two slightly detuned low oscillators beat slowly, like old equipment humming.
    const gain = ctx.createGain();
    gain.gain.value = 0.018;
    gain.connect(output);
    for (const frequency of [55, 55.4, 110.3]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
    }
  };

  return {
    unlock() {
      if (context) return;
      context = new AudioContext();
      master = context.createGain();
      master.connect(context.destination);
      applyMute();
      noise = context.createBuffer(1, context.sampleRate / 4, context.sampleRate);
      const samples = noise.getChannelData(0);
      let state = 12345;
      for (let i = 0; i < samples.length; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        samples[i] = state / 0x3fffffff - 1;
      }
      startAmbient(context, master);
    },
    play(name) {
      if (!context || !master || !noise) return;
      const now = context.currentTime;
      if (name === 'interference') {
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = noise;
        gain.gain.setValueAtTime(0.025, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        source.connect(gain).connect(master);
        source.start(now, 0, 0.12);
        return;
      }
      for (const tone of TONES[name]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = now + tone.start;
        oscillator.type = tone.type;
        oscillator.frequency.setValueAtTime(tone.frequency, at);
        if (tone.endFrequency) {
          oscillator.frequency.linearRampToValueAtTime(tone.endFrequency, at + tone.duration);
        }
        gain.gain.setValueAtTime(tone.gain, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.duration);
        oscillator.connect(gain).connect(master);
        oscillator.start(at);
        oscillator.stop(at + tone.duration);
      }
    },
    setMuted(next) {
      muted = next;
      applyMute();
    },
  };
}
