import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as core from '../core/index';
import { MODEL_VERSION } from '../core/constants';
import { loadSounds } from '../web/load-sounds';

const MODEL_URL = 'https://example.test/sounds.json';
const HTTP_NOT_FOUND = 404;
const OTHER_VERSION = MODEL_VERSION + 1;

function validModel(): Record<string, unknown> {
  return {
    version: MODEL_VERSION,
    k: 3,
    sampleRate: 48000,
    mean: [0, 1],
    std: [1, 1],
    examples: [{ id: 'clap/a.wav#0', label: 'clap', v: [0.5, 0.5] }],
    thresholds: { clap: 2 },
  };
}

function stubFetch(response: Partial<Response> & { text?: () => Promise<string> }) {
  const stub = vi.fn(async (..._args: unknown[]) => response as Response);
  vi.stubGlobal('fetch', stub);
  return stub;
}

function okText(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    return e as Error;
  }
  throw new Error('expected loadSounds to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadSounds', () => {
  it('resolves with the parsed model', async () => {
    const model = validModel();
    stubFetch(okText(JSON.stringify(model)));
    await expect(loadSounds(MODEL_URL)).resolves.toEqual(model);
  });

  it('rejects with the URL and the status on a 404', async () => {
    stubFetch({ ok: false, status: HTTP_NOT_FOUND, text: async () => '' });
    const err = await rejection(loadSounds(MODEL_URL));
    expect(err.message).toContain(MODEL_URL);
    expect(err.message).toContain(String(HTTP_NOT_FOUND));
  });

  it('rejects with the URL and a cause when the body is not JSON', async () => {
    stubFetch(okText('<html>not json'));
    const err = await rejection(loadSounds(MODEL_URL));
    expect(err.message).toContain(MODEL_URL);
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('rejects with both versions when the version differs', async () => {
    stubFetch(okText(JSON.stringify({ ...validModel(), version: OTHER_VERSION })));
    const err = await rejection(loadSounds(MODEL_URL));
    expect(err.message).toContain(MODEL_URL);
    expect(err.message).toContain(String(OTHER_VERSION));
    expect(err.message).toContain(String(MODEL_VERSION));
  });

  it('rejects a value that is not a model', async () => {
    for (const body of ['null', '[]', '"text"', '42', '{}', JSON.stringify({ version: MODEL_VERSION }),
      JSON.stringify({ ...validModel(), examples: 'no' })]) {
      stubFetch(okText(body));
      const err = await rejection(loadSounds(MODEL_URL));
      expect(err.message).toContain(MODEL_URL);
    }
  });

  it('rejects with the URL and a cause when fetch rejects', async () => {
    const original = new TypeError('network down');
    vi.stubGlobal('fetch', vi.fn(async () => { throw original; }));
    const err = await rejection(loadSounds(MODEL_URL));
    expect(err.message).toContain(MODEL_URL);
    expect(err.cause).toBe(original);
  });

  it('sends only a URL and no request body', async () => {
    const stub = stubFetch(okText(JSON.stringify(validModel())));
    await loadSounds(MODEL_URL);
    expect(stub).toHaveBeenCalledTimes(1);
    const args = stub.mock.calls[0];
    expect(args[0]).toBe(MODEL_URL);
    const init = args[1] as { body?: unknown; method?: string } | undefined;
    expect(init?.body).toBeUndefined();
    expect(init?.method === undefined || init.method === 'GET').toBe(true);
  });
});

// Task 14: web/index.ts now exports listen, which pulls DOM types into the base tsc, so this test reads the
// file as text. The names of dist/tokk.js are checked in test/build.test.ts.
describe('web/index.ts names', () => {
  it('lists the core names plus loadSounds and listen as runtime exports', () => {
    const text = readFileSync(new URL('../web/index.ts', import.meta.url), 'utf8');
    const names = [...text.matchAll(/^export\s*\{([^}]*)\}\s*from/gm)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter((s) => s !== ''));
    expect(names.sort()).toEqual([...Object.keys(core), 'loadSounds', 'listen'].sort());
  });
});