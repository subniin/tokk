import { describe, expect, it } from 'vitest';
import type { SoundModel } from '../core/types';
import { buildModel } from './helpers/engine-fixture';
import { MODEL_REL_TOLERANCE, compareModels, describeDifferences } from './helpers/model-compare';

// Test-only values.
const RATE_HZ = 48000;
const LAST_BIT_FACTOR = 1 + 1e-13;        // well inside MODEL_REL_TOLERANCE
const VISIBLE_FACTOR = 1 + 1e-6;          // far outside MODEL_REL_TOLERANCE
const DIM = 2;

const base = (): SoundModel => buildModel(['low', 'mid'], RATE_HZ);
const copy = (m: SoundModel): SoundModel => JSON.parse(JSON.stringify(m)) as SoundModel;

describe('compareModels', () => {
  it('has a tolerance of 1e-9', () => {
    expect(MODEL_REL_TOLERANCE).toBe(1e-9);
  });

  it('passes for equal models', () => {
    expect(compareModels(base(), copy(base()))).toEqual([]);
  });

  it('passes when floats differ in the last bits', () => {
    const m = copy(base());
    m.mean[DIM] *= LAST_BIT_FACTOR;
    m.std[DIM] *= LAST_BIT_FACTOR;
    m.examples[0].v[DIM] *= LAST_BIT_FACTOR;
    expect(compareModels(base(), m)).toEqual([]);
  });

  it('fails for a relative change of 1e-6 and names the path', () => {
    const m = copy(base());
    m.mean[DIM] *= VISIBLE_FACTOR;
    const d = compareModels(base(), m);
    expect(d[0].path).toBe(`$.mean[${DIM}]`);
    expect(describeDifferences(d)).toContain(`$.mean[${DIM}]`);
  });

  it('fails for a changed example id, label, key order or threshold key', () => {
    const id = copy(base());
    id.examples[0].id += 'x';
    expect(compareModels(base(), id)[0].path).toBe('$.examples[0].id');
    const label = copy(base());
    label.examples[1].label = 'other';
    expect(compareModels(base(), label)[0].path).toBe('$.examples[1].label');
    const order = JSON.parse(JSON.stringify(base()), (_k, v: unknown) => v) as Record<string, unknown>;
    const { version, ...rest } = order;
    expect(compareModels(base(), { ...rest, version } as unknown as SoundModel)[0].reason).toBe('keys or key order');
    const threshold = copy(base());
    threshold.thresholds = { renamed: Object.values(threshold.thresholds)[0] };
    expect(compareModels(base(), threshold)).not.toEqual([]);
  });

  it('fails when pitch is present in one model only, or sampleRate differs', () => {
    const pitch = { ...copy(base()), pitch: { baselineHz: 150 } };
    expect(compareModels(base(), pitch)).not.toEqual([]);
    const rate = copy(base());
    rate.sampleRate += 1;
    expect(compareModels(base(), rate)[0].path).toBe('$.sampleRate');
  });
});
