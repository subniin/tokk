import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareToBaseline, matchEvents, scoreDir, type LabelScore, type ScoreReport } from '../node/score';
import { buildModel, type Hit } from './helpers/engine-fixture';
import {
  FIXTURE_SAMPLE_RATE_HZ, LEAD_MS, removeTempDirs, tempDir, wav24Bytes, writeFixture, type RecordingSpec,
} from './helpers/score-fixture';

// Test-only values.
const GAIN_DB = -6;
const SPACING_MS = 700;
const TAIL_MS = 1000;
const SHORT_OFFSET_MS = 40;
const LONG_OFFSET_MS = 80;
const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const EARLY_EVENT_S = 0.4;
const EXACT_WARMUP_S = 1.0;
const OTHER_SAMPLE_RATE_HZ = 48000;
const EPS = 1e-9;

afterEach(removeTempDirs);

const model = buildModel(['low', 'mid'], FIXTURE_SAMPLE_RATE_HZ);

function hitsOf(cls: 'low' | 'mid', count: number, startMs = LEAD_MS): Hit[] {
  return Array.from({ length: count }, (_, i) => ({ atMs: startMs + i * SPACING_MS, cls, gainDb: GAIN_DB }));
}

function lengthFor(hits: Hit[]): number {
  return Math.max(...hits.map((h) => h.atMs)) + TAIL_MS;
}

function spec(name: string, hits: Hit[], seed: number, extra: Partial<RecordingSpec> = {}): RecordingSpec {
  return { name, hits, seed, totalMs: lengthFor(hits), ...extra };
}

async function score(recs: RecordingSpec[]): Promise<ScoreReport> {
  const dir = await tempDir();
  await writeFixture(dir, recs);
  return scoreDir(dir, model);
}

function row(r: ScoreReport, label: string): LabelScore {
  const found = r.perLabel.find((l) => l.label === label);
  if (!found) throw new Error(`no row for ${label}`);
  return found;
}

describe('matchEvents', () => {
  it('takes the nearest pair first and is one-to-one', () => {
    const truths = [{ label: 'a', t: 0.2 }, { label: 'a', t: 0.26 }];
    const m = matchEvents(truths, [{ label: 'a', t: 0.24 }]);
    expect(m.pairs).toEqual([[1, 0]]);
    expect(m.unmatchedTruths).toEqual([0]);
    expect(m.unmatchedPredictions).toEqual([]);
  });

  it('matches only equal labels by default and only different labels on request', () => {
    const truths = [{ label: 'a', t: 1 }];
    const preds = [{ label: 'b', t: 1.01 }];
    expect(matchEvents(truths, preds).pairs).toEqual([]);
    expect(matchEvents(truths, preds, true).pairs).toEqual([[0, 0]]);
  });

  it('accepts exactly the tolerance and rejects more', () => {
    expect(matchEvents([{ label: 'a', t: 1 }], [{ label: 'a', t: 1.05 }]).pairs).toEqual([[0, 0]]);
    expect(matchEvents([{ label: 'a', t: 1 }], [{ label: 'a', t: 1.051 }]).pairs).toEqual([]);
  });
});

describe('scoreDir matching', () => {
  it('gives precision and recall 1 and a diagonal confusion table for perfect predictions', async () => {
    const r = await score([
      spec('a', [...hitsOf('low', 3), ...hitsOf('mid', 3, LEAD_MS + 3 * SPACING_MS)], 1),
      spec('b', hitsOf('mid', 2), 2),
    ]);
    expect(row(r, 'low')).toMatchObject({ truths: 3, tp: 3, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(row(r, 'mid')).toMatchObject({ truths: 5, tp: 5, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(r.confusion).toEqual({ low: { low: 3 }, mid: { mid: 5 } });
    expect(r.warnings).toEqual([]);
  });

  it('counts a label 80 ms off as one fp and one fn', async () => {
    const hits = hitsOf('low', 1);
    const r = await score([spec('a', hits, 3, { events: [{ label: 'low', t: LEAD_MS / MS_PER_SECOND + LONG_OFFSET_MS / MS_PER_SECOND }] })]);
    expect(row(r, 'low')).toMatchObject({ truths: 1, tp: 0, fp: 1, fn: 1, precision: 0, recall: 0 });
  });

  it('matches a label 40 ms off', async () => {
    const hits = hitsOf('low', 1);
    const r = await score([spec('a', hits, 3, { events: [{ label: 'low', t: LEAD_MS / MS_PER_SECOND + SHORT_OFFSET_MS / MS_PER_SECOND }] })]);
    expect(row(r, 'low')).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });
});

describe('scoreDir report', () => {
  it('scales falsePositivesPerHour with totalSeconds', async () => {
    const hits = hitsOf('low', 1);
    const short = await score([spec('a', hits, 4, { events: [] })]);
    const long = await score([spec('a', hits, 4, { events: [], totalMs: lengthFor(hits) * 2 })]);
    expect(short.falsePositivesPerHour).toBeCloseTo((SECONDS_PER_HOUR * 1) / short.totalSeconds, 6);
    expect(long.falsePositivesPerHour).toBeCloseTo((SECONDS_PER_HOUR * 1) / long.totalSeconds, 6);
    expect(long.totalSeconds).toBeCloseTo(short.totalSeconds * 2, 3);
    expect(long.falsePositivesPerHour).toBeLessThan(short.falsePositivesPerHour);
  });

  it('puts a wrong label into [truth][predicted] and a spurious prediction into [none][predicted]', async () => {
    const hits = [...hitsOf('low', 1), ...hitsOf('mid', 2, LEAD_MS + SPACING_MS)];
    const r = await score([spec('a', hits, 5, {
      events: [{ label: 'low', t: 1.2 }, { label: 'low', t: (LEAD_MS + SPACING_MS) / MS_PER_SECOND }],
    })]);
    expect(r.confusion).toEqual({ low: { low: 1, mid: 1 }, none: { mid: 1 } });
    expect(row(r, 'low')).toMatchObject({ tp: 1, fp: 0, fn: 1 });
    expect(row(r, 'mid')).toMatchObject({ tp: 0, fp: 2, fn: 0 });
  });

  it('uses the precision and recall conventions for zero denominators', async () => {
    const r = await score([spec('a', hitsOf('low', 1), 6, { events: [{ label: 'mid', t: 5 }] })]);
    expect(row(r, 'mid')).toMatchObject({ tp: 0, fp: 0, fn: 1, precision: 1, recall: 0 });
    expect(row(r, 'low')).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0, recall: 1 });
  });

  it('lists labels sorted and is identical on a second run', async () => {
    const dir = await tempDir();
    await writeFixture(dir, [spec('a', [...hitsOf('mid', 1), ...hitsOf('low', 1, LEAD_MS + SPACING_MS)], 7)]);
    const a = await scoreDir(dir, model);
    const b = await scoreDir(dir, model);
    expect(a.perLabel.map((l) => l.label)).toEqual(['low', 'mid']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('scoreDir calibration lead', () => {
  it('counts a truth at 0.4 s as in calibration, warns, and leaves it out of recall', async () => {
    const r = await score([spec('early', hitsOf('low', 1), 8, {
      events: [{ label: 'low', t: EARLY_EVENT_S }, { label: 'low', t: LEAD_MS / MS_PER_SECOND }],
    })]);
    expect(row(r, 'low')).toMatchObject({ truths: 1, tp: 1, fn: 0, inCalibration: 1, recall: 1 });
    expect(r.inCalibration).toBe(1);
    const w = r.warnings.filter((x) => x.code === 'in-calibration');
    expect(w).toHaveLength(1);
    expect(w[0].file).toBe('early.json');
    expect(w[0].message).toContain('0.4');
  });

  it('scores a truth at exactly 1.0 s', async () => {
    const r = await score([spec('edge', hitsOf('low', 1), 9, { events: [{ label: 'low', t: EXACT_WARMUP_S }] })]);
    expect(row(r, 'low').inCalibration).toBe(0);
    expect(row(r, 'low').truths).toBe(1);
    expect(r.warnings.filter((x) => x.code === 'in-calibration')).toEqual([]);
  });

  it('gives truths 0 and recall 1 to a label with only calibration events', async () => {
    const r = await score([spec('a', hitsOf('low', 1), 10, {
      events: [{ label: 'low', t: LEAD_MS / MS_PER_SECOND }, { label: 'mid', t: EARLY_EVENT_S }],
    })]);
    expect(row(r, 'mid')).toMatchObject({ truths: 0, tp: 0, fn: 0, inCalibration: 1, recall: 1 });
  });
});

describe('scoreDir files', () => {
  it('skips a wav without json with no-labels and does not count its duration', async () => {
    const r = await score([spec('a', hitsOf('low', 1), 11), spec('nolabels', hitsOf('low', 1), 12, { labelFile: false })]);
    expect(r.warnings).toEqual([{ file: 'nolabels.wav', code: 'no-labels', message: expect.any(String) }]);
    expect(r.totalSeconds).toBeCloseTo((lengthFor(hitsOf('low', 1))) / MS_PER_SECOND, 3);
  });

  it('ignores a json without wav with no-recording', async () => {
    const r = await score([spec('a', hitsOf('low', 1), 13), spec('norec', hitsOf('low', 1), 14, { wav: false })]);
    expect(r.warnings.map((w) => [w.file, w.code])).toEqual([['norec.json', 'no-recording']]);
  });

  it('warns about a json sampleRate that differs from the header and uses the header', async () => {
    const r = await score([spec('a', hitsOf('low', 2), 15, { labelFile: { sampleRate: OTHER_SAMPLE_RATE_HZ } })]);
    const w = r.warnings.filter((x) => x.code === 'sample-rate-mismatch');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain(String(OTHER_SAMPLE_RATE_HZ));
    expect(w[0].message).toContain(String(FIXTURE_SAMPLE_RATE_HZ));
    expect(row(r, 'low')).toMatchObject({ tp: 2, fp: 0, fn: 0 });
  });

  it('rejects bad JSON, a missing events array and a negative t with the file name', async () => {
    const bad = (labelFile: string): Promise<unknown> => score([spec('bad', hitsOf('low', 1), 16, { labelFile })]);
    await expect(bad('{not json')).rejects.toThrow(/^bad\.json/);
    await expect(bad('{"device":"x"}')).rejects.toThrow(/^bad\.json.*events/);
    await expect(bad('{"events":[{"label":"low","t":-1}]}')).rejects.toThrow(/^bad\.json/);
    await expect(bad('{"events":[{"t":1}]}')).rejects.toThrow(/^bad\.json/);
    await expect(bad('{"events":[{"label":5,"t":1}]}')).rejects.toThrow(/^bad\.json/);
  });

  it('rejects a 24-bit wav with the file name and 16-bit PCM', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'deep.wav'), wav24Bytes(FIXTURE_SAMPLE_RATE_HZ, 100));
    await writeFile(join(dir, 'deep.json'), JSON.stringify({ events: [] }));
    const err = await scoreDir(dir, model).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^deep\.wav/);
    expect((err as Error).message).toContain('16-bit PCM');
    expect((err as Error).cause).toBeInstanceOf(Error);
  });

  it('rejects a missing directory with ENOENT', async () => {
    const dir = await tempDir();
    await expect(scoreDir(join(dir, 'missing'), model)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns an empty report for an empty directory', async () => {
    const dir = await tempDir();
    const r = await scoreDir(dir, model);
    expect(r).toEqual({ perLabel: [], falsePositivesPerHour: 0, totalSeconds: 0, inCalibration: 0, confusion: {}, warnings: [] });
  });
});

function label(l: string, tp: number, fn: number, fp = 0): LabelScore {
  return {
    label: l, truths: tp + fn, tp, fp, fn, inCalibration: 0,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}

function report(...labels: LabelScore[]): ScoreReport {
  return { perLabel: labels, falsePositivesPerHour: 0, totalSeconds: 100, inCalibration: 0, confusion: {}, warnings: [] };
}

function verdict(base: LabelScore, now: LabelScore): boolean {
  return compareToBaseline(report(now), report(base))[0].regression;
}

describe('compareToBaseline', () => {
  it('flags a recall drop of 0.1 at 60 truths', () => {
    expect(verdict(label('a', 60, 0), label('a', 54, 6))).toBe(true);
  });

  it('does not flag a drop of exactly 0.02 at 50 truths but flags 0.03', () => {
    expect(verdict(label('a', 50, 0), label('a', 49, 1))).toBe(false);
    expect(verdict(label('a', 100, 0), label('a', 97, 3))).toBe(true);
    const exact = compareToBaseline(report({ ...label('a', 50, 0), recall: 1 }), report({ ...label('a', 50, 0), recall: 0.98 + EPS / 10 }));
    expect(exact[0].regression).toBe(false);
  });

  it('uses the tp count under 50 truths: one more miss passes, two fail', () => {
    expect(verdict(label('a', 20, 0), label('a', 19, 1))).toBe(false);
    expect(verdict(label('a', 20, 0), label('a', 18, 2))).toBe(true);
  });

  it('never flags a new label and flags a lost label that had truths', () => {
    const newOnly = compareToBaseline(report(label('a', 10, 0), label('new', 3, 1)), report(label('a', 10, 0)));
    expect(newOnly.map((c) => [c.label, c.regression])).toEqual([['a', false], ['new', false]]);
    const lost = compareToBaseline(report(label('a', 10, 0)), report(label('a', 10, 0), label('gone', 1, 0)));
    expect(lost.find((c) => c.label === 'gone')).toMatchObject({ regression: true, tpDelta: -1, recallDelta: -1, baselineTruths: 1 });
  });

  it('reports the deltas, the baseline truths and sorts by label', () => {
    const c = compareToBaseline(
      report(label('b', 8, 2, 1), label('a', 9, 1)),
      report(label('b', 9, 1), label('a', 9, 1)),
    );
    expect(c.map((x) => x.label)).toEqual(['a', 'b']);
    expect(c[1].tpDelta).toBe(-1);
    expect(c[1].baselineTruths).toBe(10);
    expect(c[1].recallDelta).toBeCloseTo(0.8 - 0.9, 9);
    expect(c[1].precisionDelta).toBeCloseTo(8 / 9 - 1, 9);
  });
});
