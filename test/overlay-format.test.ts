import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SegmentReport } from '../core/engine';
import { formatEventRow, formatInjectedRow, formatMatchRow, sampleRateWarning, stateLabel } from '../web/overlay/format';

// Test-only values.
const PBT_RUNS = Number(process.env.PBT_RUNS ?? '100');
const MIC_RATE_HZ = 48000;
const MODEL_RATE_HZ = 44100;
const LOW_RATE_HZ = 16000;

const THRESHOLDS = { low: 5.870243, ring: 5.078914 };

function sound(label: string, distance: number): SegmentReport {
  return {
    t: 1.7, durationMs: 120,
    result: { kind: 'match', label, confidence: 0.9, nearest: { id: `${label}/${label}-01.wav#3`, label, distance } },
  };
}

describe('formatEventRow', () => {
  it('shows a sound with time, label, confidence, nearest id, distance and the threshold of its label', () => {
    const row = formatEventRow(sound('low', 2.5), THRESHOLDS);
    expect(row.kind).toBe('sound');
    expect(row.label).toBe('low');
    expect(row.text).toBe('1.70 s  low  confidence 0.90  nearest low/low-01.wav#3  distance 2.500 / threshold 5.870');
    expect(row).toMatchObject({ time: '1.70 s', confidence: '0.90', nearestId: 'low/low-01.wav#3', distance: '2.500', threshold: '5.870' });
  });

  it('shows unknown with the nearest id and the threshold of nearest.label, and no confidence', () => {
    const report: SegmentReport = { t: 3.456, durationMs: 90, result: { kind: 'unknown', nearest: { id: 'ring/ring-02.wav#1', label: 'ring', distance: 9 } } };
    const row = formatEventRow(report, THRESHOLDS);
    expect(row.kind).toBe('unknown');
    expect(row.label).toBe('unknown');
    expect(row.confidence).toBe('');
    expect(row.text).toBe('3.46 s  unknown  nearest ring/ring-02.wav#1  distance 9.000 / threshold 5.079');
  });

  it('shows background as "background (no event)" with the background threshold', () => {
    const row = formatEventRow(sound('background', 1), { ...THRESHOLDS, background: 2 });
    expect(row.kind).toBe('background');
    expect(row.label).toBe('background');
    expect(row.text).toBe('1.70 s  background (no event)  nearest background/background-01.wav#3  distance 1.000 / threshold 2.000');
  });

  it('gives n/a for a missing threshold, a missing record, NaN and infinite numbers', () => {
    expect(formatEventRow(sound('mid', 1), THRESHOLDS).threshold).toBe('n/a');
    expect(formatEventRow(sound('low', 1), undefined).threshold).toBe('n/a');
    expect(formatEventRow(sound('low', 1), { low: Number.NaN }).threshold).toBe('n/a');
    expect(formatEventRow(sound('low', Number.NaN), THRESHOLDS).distance).toBe('n/a');
    expect(formatEventRow(sound('low', Infinity), THRESHOLDS).distance).toBe('n/a');
    for (const d of [Number.NaN, Infinity, -Infinity]) {
      expect(formatEventRow(sound('low', d), { low: d }).text).toMatch(/distance n\/a \/ threshold n\/a$/);
    }
  });

  it('never prints NaN, undefined or Infinity, and always contains the label (property)', () => {
    const num = fc.oneof(fc.double({ noNaN: false }), fc.constantFrom(Infinity, -Infinity, Number.NaN, 0));
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    const report = fc.oneof(
      fc.record({ t: num, label: word, id: word, conf: num, dist: num }).map((r): SegmentReport => ({
        t: r.t, durationMs: 100,
        result: { kind: 'match', label: r.label, confidence: r.conf, nearest: { id: r.id, label: r.label, distance: r.dist } },
      })),
      fc.record({ t: num, label: word, id: word, dist: num }).map((r): SegmentReport => ({
        t: r.t, durationMs: 100, result: { kind: 'unknown', nearest: { id: r.id, label: r.label, distance: r.dist } },
      })),
    );
    const thresholds = fc.option(fc.dictionary(word, num), { nil: undefined });
    fc.assert(fc.property(report, thresholds, (r, th) => {
      const row = formatEventRow(r, th);
      expect(row.text).not.toMatch(/NaN|undefined|Infinity/);
      expect(row.text).toContain(row.label);
      expect(row.text.startsWith(row.time)).toBe(true);
    }), { numRuns: PBT_RUNS });
  });
});

describe('formatMatchRow', () => {
  it('is bold, starts with Pattern, and adds speed only when it is defined', () => {
    const plain = formatMatchRow('low mid', { pattern: 'low mid', t: 2.5 });
    expect(plain.kind).toBe('match');
    expect(plain.bold).toBe(true);
    expect(plain.text).toBe('Pattern "low mid" matched at 2.50 s');
    const fast = formatMatchRow('hum.rise', { pattern: 'hum.rise', t: 1, speed: 2.5 });
    expect(fast.text).toBe('Pattern "hum.rise" matched at 1.00 s  speed 2.500');
  });

  it('starts with Pattern for any name and time (property)', () => {
    fc.assert(fc.property(fc.stringMatching(/^[a-z ]{1,12}$/), fc.double(), fc.option(fc.double(), { nil: undefined }), (name, t, speed) => {
      const row = formatMatchRow(name, { pattern: name, t, speed });
      expect(row.text.startsWith('Pattern')).toBe(true);
      expect(row.text).not.toMatch(/NaN|undefined|Infinity/);
    }), { numRuns: PBT_RUNS });
  });
});

describe('sampleRateWarning', () => {
  it('is null for equal rates', () => {
    expect(sampleRateWarning(MIC_RATE_HZ, MIC_RATE_HZ)).toBeNull();
  });

  it('names both rates when they differ, without the 16000 Hz sentence', () => {
    const text = sampleRateWarning(MIC_RATE_HZ, MODEL_RATE_HZ) as string;
    expect(text).toBe('Sample rate warning: the input runs at 48000 Hz but the sounds were taught at 44100 Hz. '
      + 'Recognition can be less accurate. Teach the sounds again at this rate.');
    expect(text).not.toContain('high-frequency features are empty');
  });

  it('adds the 16000 Hz sentence when the input is 16000 Hz', () => {
    const text = sampleRateWarning(LOW_RATE_HZ, MIC_RATE_HZ) as string;
    expect(text).toContain('the input runs at 16000 Hz but the sounds were taught at 48000 Hz');
    expect(text).toContain('At 16000 Hz the high-frequency features are empty, so sounds that differ mostly in the high frequencies look alike.');
    expect(sampleRateWarning(MIC_RATE_HZ, LOW_RATE_HZ)).not.toContain('high-frequency features are empty');
  });

  it('is null for a rate that is not a positive finite number', () => {
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(sampleRateWarning(bad, MODEL_RATE_HZ)).toBeNull();
      expect(sampleRateWarning(MIC_RATE_HZ, bad)).toBeNull();
    }
  });
});

describe('stateLabel', () => {
  it('gives the three badge texts', () => {
    expect(stateLabel('listening')).toBe('Listening');
    expect(stateLabel('paused')).toBe('Paused');
    expect(stateLabel('teaching')).toBe('Teaching');
  });
});

describe('formatInjectedRow', () => {
  it('shows the time, the label and the word injected as text', () => {
    expect(formatInjectedRow('click', 2.5)).toBe('2.50 s  click  injected');
  });
});
