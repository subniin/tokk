// DOM: Web Audio rendering of the effect recipes. The context is made in a click handler (a user gesture) and resumed there.
// play() only schedules nodes and returns at once; the game waits with a timer, never on the audio clock. Nothing is
// recorded, loaded or sent: every sound is made here from oscillators, noise and gain envelopes.
import type { EffectName } from './captions';
import { RECIPES } from './effect-recipes';
import type { Voice } from './effect-recipes';

const MS_PER_SECOND = 1000;
const DB_AMPLITUDE_DIVISOR = 20;
const SILENT_GAIN = 0.0001;          // a near-silent gain: every fade ramps up from it and back down to it
const FILTER_Q = 1.2;

export interface EffectsAudio { play(name: EffectName): void }

// Returns null when the browser has no AudioContext or cannot make one: the effects are then treated as muted.
export function createEffectsAudio(): EffectsAudio | null {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  void ctx.resume().catch(() => undefined);

  // White noise for one voice. The length is the voice's duration in ms times the context's rate, divided by 1000.
  const noiseBuffer = (lengthMs: number): AudioBuffer => {
    const length = Math.max(1, Math.round((lengthMs * ctx.sampleRate) / MS_PER_SECOND));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  const schedule = (v: Voice, at: number): void => {
    const start = at + v.startMs / MS_PER_SECOND;
    const end = start + v.lengthMs / MS_PER_SECOND;
    const peak = Math.pow(10, v.gainDb / DB_AMPLITUDE_DIVISOR);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT_GAIN, start);
    gain.gain.linearRampToValueAtTime(peak, start + v.fadeInMs / MS_PER_SECOND);
    gain.gain.setValueAtTime(peak, end - v.fadeOutMs / MS_PER_SECOND);
    gain.gain.linearRampToValueAtTime(SILENT_GAIN, end);
    gain.connect(ctx.destination);
    let source: AudioScheduledSourceNode;
    if (v.kind === 'sine') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(v.fromHz, start);
      osc.frequency.exponentialRampToValueAtTime(v.toHz, end);
      osc.connect(gain);
      source = osc;
    } else {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(v.lengthMs);
      const filter = ctx.createBiquadFilter();
      filter.type = v.filter ?? 'lowpass';
      filter.Q.value = FILTER_Q;
      filter.frequency.setValueAtTime(v.fromHz, start);
      filter.frequency.exponentialRampToValueAtTime(v.toHz, end);
      noise.connect(filter);
      filter.connect(gain);
      source = noise;
    }
    source.start(start);
    source.stop(end);
    source.onended = () => gain.disconnect();
  };

  return {
    play(name: EffectName): void {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const at = ctx.currentTime;
      for (const v of RECIPES[name].voices) schedule(v, at);
    },
  };
}
