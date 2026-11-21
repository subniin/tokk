// The sound effects of Shoo!, made with Web Audio only (no files). They play between waves, at game over and at dawn, never
// during a fight. The app calls ears.pause() before and ears.resume() after each one (main.ts), so the microphone does not
// hear them. Nothing is recorded, loaded or sent. The context is made inside a click, as the browser asks.
import { EFFECT_CLEARED_MS, EFFECT_DAWN_MS, EFFECT_LEVEL_DB, EFFECT_LOST_MS } from './constants';

export type EffectName = 'cleared' | 'lost' | 'dawn';

interface Note { startMs: number; lengthMs: number; fromHz: number; toHz: number; type: OscillatorType }

const MS_PER_SECOND = 1000;
const DB_AMPLITUDE_DIVISOR = 20;
const SILENT_GAIN = 0.0001;
const FADE_IN_MS = 15;

// Hz values of the notes (A4 = 440 Hz).
const A3_HZ = 220;
const C4_HZ = 261.63;
const E4_HZ = 329.63;
const G4_HZ = 392;
const A4_HZ = 440;
const C5_HZ = 523.25;
const E5_HZ = 659.25;
const G5_HZ = 783.99;
const LOW_HZ = 110;
const LOWER_HZ = 55;

const RECIPES: Record<EffectName, { lengthMs: number; notes: Note[] }> = {
  cleared: {
    lengthMs: EFFECT_CLEARED_MS,
    notes: [
      { startMs: 0, lengthMs: 300, fromHz: E4_HZ, toHz: E4_HZ, type: 'triangle' },
      { startMs: 220, lengthMs: 360, fromHz: G4_HZ, toHz: G4_HZ, type: 'triangle' },
      { startMs: 440, lengthMs: 460, fromHz: C5_HZ, toHz: C5_HZ, type: 'triangle' },
    ],
  },
  lost: {
    lengthMs: EFFECT_LOST_MS,
    notes: [
      { startMs: 0, lengthMs: 700, fromHz: A3_HZ, toHz: LOW_HZ, type: 'sawtooth' },
      { startMs: 500, lengthMs: 900, fromHz: LOW_HZ, toHz: LOWER_HZ, type: 'sine' },
    ],
  },
  dawn: {
    lengthMs: EFFECT_DAWN_MS,
    notes: [
      { startMs: 0, lengthMs: 500, fromHz: C4_HZ, toHz: C4_HZ, type: 'sine' },
      { startMs: 350, lengthMs: 500, fromHz: E4_HZ, toHz: E4_HZ, type: 'sine' },
      { startMs: 700, lengthMs: 500, fromHz: A4_HZ, toHz: A4_HZ, type: 'sine' },
      { startMs: 1050, lengthMs: 750, fromHz: E5_HZ, toHz: G5_HZ, type: 'sine' },
    ],
  },
};

export interface ShooAudio {
  // Plays the effect and resolves when it has ended.
  play(name: EffectName): Promise<void>;
}

// Returns null when the browser has no AudioContext or cannot make one: the effects are then off.
export function createShooAudio(): ShooAudio | null {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  void ctx.resume().catch(() => undefined);
  const peak = Math.pow(10, EFFECT_LEVEL_DB / DB_AMPLITUDE_DIVISOR);

  const schedule = (n: Note, at: number): void => {
    const start = at + n.startMs / MS_PER_SECOND;
    const end = start + n.lengthMs / MS_PER_SECOND;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT_GAIN, start);
    gain.gain.linearRampToValueAtTime(peak, start + FADE_IN_MS / MS_PER_SECOND);
    gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, end);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.fromHz, start);
    osc.frequency.exponentialRampToValueAtTime(n.toHz, end);
    osc.connect(gain);
    osc.start(start);
    osc.stop(end);
    osc.onended = () => gain.disconnect();
  };

  return {
    play(name: EffectName): Promise<void> {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const recipe = RECIPES[name];
      const at = ctx.currentTime;
      for (const n of recipe.notes) schedule(n, at);
      return new Promise((resolve) => { setTimeout(resolve, recipe.lengthMs); });
    },
  };
}
