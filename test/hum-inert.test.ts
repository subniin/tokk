import { describe, expect, it } from 'vitest';
import { runSamples } from '../core/engine';
import { place, synthTone } from '../core/synth';
import type { SoundModel } from '../core/types';
import { buildModel, LEAD_MS, TRAIL_MS } from './helpers/engine-fixture';

// Test-only values (Task 20, U6).
const SR_HZ = 44100;
const HUM_GAIN_DB = -12;
const HUM_BASELINE_HZ = 150;
const GLIDE_MS = 2000;
const GLIDE_UP_HZ = 300;
const PATTERNS = ['hum.rise', 'hum.fall', 'low'];

function risingHum(): Float32Array {
  const tone = synthTone({ f0Hz: HUM_BASELINE_HZ, durationMs: GLIDE_MS, gainDb: HUM_GAIN_DB, glideToHz: GLIDE_UP_HZ }, SR_HZ);
  return place([{ atMs: LEAD_MS, samples: tone }], LEAD_MS + GLIDE_MS + TRAIL_MS, SR_HZ);
}

describe('hum patterns without a baseline (U6)', () => {
  it('the same rising hum gives equal continuous events, no match without a baseline and hum.rise with one', () => {
    const x = risingHum();
    const without: SoundModel = buildModel(['low', 'mid'], SR_HZ);
    const withPitch: SoundModel = { ...without, pitch: { baselineHz: HUM_BASELINE_HZ } };
    const a = runSamples(x, SR_HZ, without, PATTERNS);
    const b = runSamples(x, SR_HZ, withPitch, PATTERNS);
    const continuous = (events: typeof a.events) => events.filter((e) => e.kind === 'continuous');
    expect(continuous(a.events).length).toBeGreaterThan(0);
    expect(continuous(a.events)).toEqual(continuous(b.events));
    expect(a.matches).toEqual([]);
    expect(b.matches.length).toBeGreaterThan(0);
    expect(b.matches.every((m) => m.pattern === 'hum.rise')).toBe(true);
  });
});
