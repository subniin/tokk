// Speech-like noise for the browser fixtures of Shoo!, Click Talk and the site demo (moved here in Task 36 from the fixture of a replaced app).
// A STAND-IN made by core/synth, not a recording: it shows the logic and the wiring, not how a real room sounds.

import { rng, synthNoise } from '../../core/synth';

const MS_PER_SECOND = 1000;
const DB_AMPLITUDE_DIVISOR = 20;
const DB_POWER_DIVISOR = 10;
const SYLLABLE_RATE_HZ = 4;
const SPEECH_DEPTH_MIN = 0.6;      // 60 to 100 per cent deep
const SPEECH_DEPTH_MAX = 1;
const SPEECH_PAUSE_EVERY_MS = 1000;
const SPEECH_PAUSE_MIN_MS = 100;
const SPEECH_PAUSE_MAX_MS = 300;
const SPEECH_PAUSE_EDGE_MS = 10;

const rmsDb = (x: Float32Array): number => {
  let s = 0;
  for (const v of x) s += v * v;
  return DB_POWER_DIVISOR * Math.log10(s / Math.max(1, x.length) + Number.MIN_VALUE);
};

// Speech-like noise: pink noise, a raised-cosine envelope at the syllable rate (60 to 100 per cent deep, full at the start)
// and a short pause about every second, from a seeded generator, scaled to the requested RMS level.
export function speechLikeNoise(durationMs: number, seed: number, rmsDbfs: number, sampleRate: number): Float32Array {
  const rand = rng(seed);
  const noise = synthNoise('pink', durationMs, rmsDbfs, sampleRate, rng(seed + 1));
  const depth = SPEECH_DEPTH_MIN + rand() * (SPEECH_DEPTH_MAX - SPEECH_DEPTH_MIN);
  const pauses: { startS: number; endS: number }[] = [];
  for (let at = SPEECH_PAUSE_EVERY_MS * (0.5 + rand()); at < durationMs; at += SPEECH_PAUSE_EVERY_MS * (0.8 + 0.4 * rand())) {
    const length = SPEECH_PAUSE_MIN_MS + rand() * (SPEECH_PAUSE_MAX_MS - SPEECH_PAUSE_MIN_MS);
    pauses.push({ startS: at / MS_PER_SECOND, endS: (at + length) / MS_PER_SECOND });
  }
  const edgeS = SPEECH_PAUSE_EDGE_MS / MS_PER_SECOND;
  const out = new Float32Array(noise.length);
  for (let i = 0; i < noise.length; i++) {
    const t = i / sampleRate;
    const syllable = 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * SYLLABLE_RATE_HZ * t));
    let gate = 1;
    for (const p of pauses) {
      if (t >= p.startS - edgeS && t <= p.endS + edgeS) {
        const fade = Math.min(1, Math.min(t - (p.startS - edgeS), p.endS + edgeS - t) / edgeS);
        gate = Math.min(gate, 1 - fade);
      }
    }
    out[i] = noise[i] * syllable * gate;
  }
  const gain = Math.pow(10, (rmsDbfs - rmsDb(out)) / DB_AMPLITUDE_DIVISOR);
  return out.map((v) => v * gain);
}
