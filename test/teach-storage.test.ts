import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_VERSION } from '../core/constants';
import type { SoundModel } from '../core/types';
import { WEB_STORAGE_KEY_DEFAULT, WEB_STORAGE_VERSION } from '../web/constants';
import { loadSounds } from '../web/load-sounds';
import { canonicalJson, fingerprint, loadStoredModel, saveStoredModel } from '../web/teach-ui/storage';
import type { StorageLike } from '../web/teach-ui/storage';

// Test-only values.
const KEY = 'tokk:test';
const VECTOR_LENGTH = 32;                 // numbers per feature vector
const EXAMPLE_COUNT = 10;
const SAMPLE_RATE_HZ = 48000;
const ONE_SECOND_OF_SAMPLES_BYTES = SAMPLE_RATE_HZ * 2;   // a single second of samples would be larger than this as text
const OTHER_VERSION = MODEL_VERSION + 1;
const MODEL_URL = 'https://example.test/sounds.json';

function model(label = 'tap'): SoundModel {
  return {
    version: MODEL_VERSION, k: 3, sampleRate: SAMPLE_RATE_HZ,
    mean: Array.from({ length: VECTOR_LENGTH }, () => 0), std: Array.from({ length: VECTOR_LENGTH }, () => 1),
    examples: Array.from({ length: EXAMPLE_COUNT }, (_, i) => ({ id: `${label}/teach.wav#${i}`, label, v: Array.from({ length: VECTOR_LENGTH }, (_, j) => (i + j) / 100) })),
    thresholds: { [label]: 2.5 },
  };
}

function stub(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

const BASE = fingerprint(model('old'));

afterEach(() => { vi.restoreAllMocks(); });

describe('fingerprint', () => {
  it('is a short deterministic hex text that ignores key order', () => {
    expect(BASE).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint(model('old'))).toBe(BASE);
    expect(fingerprint(model('other'))).not.toBe(BASE);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const m = model('old');
    const reordered = JSON.parse(JSON.stringify({ thresholds: m.thresholds, examples: m.examples, std: m.std, mean: m.mean, sampleRate: m.sampleRate, k: m.k, version: m.version })) as SoundModel;
    expect(fingerprint(reordered)).toBe(BASE);
  });
});

describe('teach storage', () => {
  it('round-trips a model with its base', () => {
    const s = stub();
    expect(saveStoredModel(KEY, BASE, model(), s)).toEqual({ ok: true });
    const entry = JSON.parse(s.data[KEY]) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(['base', 'model', 'version']);
    expect(entry.version).toBe(WEB_STORAGE_VERSION);
    expect(entry.base).toBe(BASE);
    expect(loadStoredModel(KEY, BASE, s)).toEqual(model());
  });

  it('returns null without a warning when there is no entry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStoredModel(KEY, BASE, stub())).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores an entry written for another shipped sounds.json, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = stub();
    saveStoredModel(KEY, fingerprint(model('older')), model(), s);
    expect(loadStoredModel(KEY, BASE, s)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(KEY);
    expect(String(warn.mock.calls[0][0])).toMatch(/sounds\.json/);
  });

  it.each([
    ['text that is not JSON', 'not json{'],
    ['a JSON array', '[1,2]'],
    ['null', 'null'],
    ['a wrong storage version', JSON.stringify({ version: WEB_STORAGE_VERSION + 1, base: BASE, model: model() })],
    ['a missing base', JSON.stringify({ version: WEB_STORAGE_VERSION, model: model() })],
    ['a wrong model shape', JSON.stringify({ version: WEB_STORAGE_VERSION, base: BASE, model: { version: MODEL_VERSION } })],
    ['a wrong model version', JSON.stringify({ version: WEB_STORAGE_VERSION, base: BASE, model: { ...model(), version: OTHER_VERSION } })],
    ['a bare model without the wrapper', JSON.stringify(model())],
  ])('ignores %s with one warning that names the key', (_name, text) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStoredModel(KEY, BASE, stub({ [KEY]: text }))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(KEY);
  });

  it('returns null with a warning when reading throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s: StorageLike = { getItem: () => { throw new DOMException('blocked', 'SecurityError'); }, setItem: () => {} };
    expect(loadStoredModel(KEY, BASE, s)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns null with a warning when there is no localStorage at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStoredModel(KEY, BASE)).toBeNull();   // vitest runs in Node: no localStorage
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result, warns and does not throw when saving throws (full store)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s: StorageLike = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    const r = saveStoredModel(KEY, BASE, model(), s);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/full/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('writes feature vectors only: the text has no sample-sized array', () => {
    const s = stub();
    saveStoredModel(KEY, BASE, model(), s);
    expect(s.data[KEY].length).toBeLessThan(ONE_SECOND_OF_SAMPLES_BYTES);
    const longest = (v: unknown): number => (Array.isArray(v) ? Math.max(v.length, ...v.map(longest)) : (typeof v === 'object' && v !== null ? Math.max(0, ...Object.values(v).map(longest)) : 0));
    expect(longest(JSON.parse(s.data[KEY]))).toBeLessThanOrEqual(Math.max(VECTOR_LENGTH, EXAMPLE_COUNT));
  });

  it('uses the default key text', () => {
    expect(WEB_STORAGE_KEY_DEFAULT).toBe('tokk:sounds');
  });
});

describe('one validation for loadSounds and storage', () => {
  it('a model that loadSounds accepts is accepted by storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(model()) }) as unknown as Response));
    const loaded = await loadSounds(MODEL_URL);
    vi.unstubAllGlobals();
    const s = stub();
    saveStoredModel(KEY, BASE, loaded, s);
    expect(loadStoredModel(KEY, BASE, s)).toEqual(loaded);
  });
});
