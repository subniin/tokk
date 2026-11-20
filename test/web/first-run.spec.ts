import { chromium, expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyModel } from '../../core/classify/knn';
import { createEngine } from '../../core/engine';
import type { EngineEvent } from '../../core/engine';
import type { SegmentReport } from '../../core/engine';
import type { SoundModel } from '../../core/types';
import { readWav } from '../../core/wav';
import { WEB_CHUNK_MS, WEB_ENVELOPE_RESOLUTION_MS } from '../../web/constants';
import { OVERLAY_COLOURS } from '../../web/overlay/theme';
import { msToSamples } from '../../web/protocol';
import {
  HUM_MIC_TIMES, HUM_STEADY_DURATION_MS, TWO_HUM_TIMES, WEB_TEST_HUM_BASELINE_HZ, WEB_TEST_HUM_PITCH_TOLERANCE, WEB_TEST_HUM_STEADY_MS,
  WEB_TEST_IMPACT_SPACING_MS, WEB_TEST_LABELS, WEB_TEST_LEAD_MS, WEB_TEST_MISMATCH_SAMPLE_RATE_HZ, WEB_TEST_SAMPLE_RATE_HZ, WEB_TEST_TAP_COPIES,
  WEB_TEST_TEACH_COPIES,
} from './fixture';
import type { FixtureInfo, TeachFixtureInfo } from './fixture';
import {
  FIRST_RUN_PAGE_URL, FIXTURE_HUM_MIC_WAV_PATH, FIXTURE_HUM_STEADY_WAV_PATH, FIXTURE_HUM_STEADY_WAV_URL, FIXTURE_LABELS_PATH, FIXTURE_MODEL_PATH,
  FIXTURE_MODEL_URL, FIXTURE_PITCH_ONLY_MODEL_PATH, FIXTURE_TAP_WAV_URL, FIXTURE_TEACH_INFO_PATH, FIXTURE_TEACH_WAV_URL,
  FIXTURE_TWO_HUM_WAV_URL, FIXTURE_WAV_PATH, FIXTURE_WAV_URL, fakeMicArgs,
} from './paths';

// Test-only values (Task 20).
// Largest error of toPageTime. The target of requirement 6.7 is 50 ms; design.md "Measured values" has the measured error.
const WEB_TEST_PAGE_TIME_BOUND_MS = 50;
const WEB_TEST_PAUSE_MS = 200;                  // length of each pause in the pause and resume test
const WEB_TEST_PAUSE_AFTER_CALLS = [1, 2];      // counts of handler calls after which the page pauses
const WEB_TEST_STREAM_LEAD_MS = 300;            // the stream starts this long after it is built
const WEB_TEST_SETTLE_MS = 1500;                // wait to show that no extra call arrives
const WEB_TEST_WAIT_SLACK_MS = 20_000;          // added to the length of a fixture for a wait
const WEB_TEST_TRAINING_WAIT_MS = 30_000;
const WEB_TEST_TEST_TIMEOUT_MS = 120_000;
const WEB_TEST_DONE_AFTER_HUM_MS = 500;         // Done is pressed this long after the steady hum ended
const WEB_TEST_BASE_MISMATCH = '00000000';      // a base fingerprint that no model has
const MS_PER_SECOND = 1000;
const WEB_TEST_FLOAT_DIGITS = 9;            // significant digits of a confidence or a distance in the onEvent comparison
const THEME = {
  '--tokk-bg': 'rgb(10, 20, 30)', '--tokk-fg': 'rgb(240, 230, 220)', '--tokk-accent': 'rgb(200, 100, 0)',
  '--tokk-font': 'Georgia, serif', '--tokk-radius': '9px',
};
const THEME_ACCENT_RGB = [200, 100, 0];
const PAGE_BUTTON_BACKGROUND = 'rgb(0, 255, 0)';
const PAGE_BUTTON_RADIUS = '17px';
const PAGE_H1_FONT_SIZE = '41px';
const PAGE_BODY_FONT_SIZE = '27px';
const DEFAULT_FONT = 'system-ui, sans-serif';
const DEFAULT_RADIUS = '4px';

const HOST = '[data-tokk-teach]';
const EXAMPLES = `${HOST} li[data-example]`;
const action = (name: string): string => `${HOST} [data-action="${name}"]`;

interface Call { pattern: string; t: number; pageMs: number | null; nowMs: number }
interface EnvelopeCall { t0: number; binMs: number; bins: number; maxBins: number; typed: boolean; arrivalMs: number }
interface Outcome { settled: boolean; ok: boolean | null; name: string | null; message: string | null }
interface StreamInfo { startPageMs: number; rateHz: number; baseLatencyS: number; outputLatencyS: number }
interface StartOptions {
  model?: string | SoundModel; source?: string; streamWav?: string; streamLeadMs?: number; storageKey?: string; patterns?: string[];
  debug?: boolean; pauseAfter?: number[]; pauseMs?: number;
}
type TestWindow = Window & {
  tokkTest: {
    ready: boolean; readyMs: number; calls: Call[]; events: EngineEvent[]; envelopes: EnvelopeCall[]; warnings: string[]; teach: Outcome;
    stream: StreamInfo | null; pauses: { atMs: number; resumedMs?: number }[];
    ears: {
      sounds: SoundModel; labels: string[]; stop(): Promise<void>; pause(): void; resume(): void; exportSounds(): string;
      importSounds(json: string): void; toPageTime(t: number): number;
    };
    start(o: StartOptions): Promise<{ ok: boolean; message?: string }>;
    teachStart(label: string, options?: unknown): void;
    teachOutcome(label: string, options?: unknown): Promise<{ ok: boolean; name?: string; message?: string }>;
    setTheme(props: Record<string, string | null>): void;
  };
};
const tt = (): TestWindow['tokkTest'] => (window as unknown as TestWindow).tokkTest;

// A test that needs its own fake microphone file gets its own Chrome, closed after the test.
const test = base.extend<{ micWav: string; micPage: Page }>({
  micWav: [FIXTURE_HUM_MIC_WAV_PATH, { option: true }],
  micPage: async ({ micWav, baseURL }, use) => {
    const browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(micWav) });
    try {
      const context = await browser.newContext({ baseURL });
      await use(await context.newPage());
    } finally {
      await browser.close();
    }
  },
});

let keyCounter = 0;
const uniqueKey = (): string => `tokk:first-run-${Date.now()}-${keyCounter++}`;

const teachInfo = async (): Promise<TeachFixtureInfo> => JSON.parse(await readFile(FIXTURE_TEACH_INFO_PATH, 'utf8')) as TeachFixtureInfo;
const listenInfo = async (): Promise<FixtureInfo> => JSON.parse(await readFile(FIXTURE_LABELS_PATH, 'utf8')) as FixtureInfo;

async function start(page: Page, o: StartOptions): Promise<void> {
  if (!page.url().endsWith(FIRST_RUN_PAGE_URL)) await page.goto(FIRST_RUN_PAGE_URL);
  expect(await page.evaluate((opts) => (window as unknown as TestWindow).tokkTest.start(opts), o)).toEqual({ ok: true });
}

const labels = (page: Page): Promise<string[]> => page.evaluate(() => tt().ears.labels);
const calls = (page: Page): Promise<Call[]> => page.evaluate(() => tt().calls.slice());
const events = (page: Page): Promise<EngineEvent[]> => page.evaluate(() => tt().events.slice());
const envelopes = (page: Page): Promise<EnvelopeCall[]> => page.evaluate(() => tt().envelopes.slice());
const warnings = (page: Page): Promise<string[]> => page.evaluate(() => tt().warnings.slice());
const storedItem = (page: Page, key: string): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), key);

async function waitForCalls(page: Page, count: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction((n) => (window as unknown as TestWindow).tokkTest.calls.length >= n, count, { timeout: timeoutMs, polling: 100 });
}

async function waitForOutcome(page: Page): Promise<Outcome> {
  await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.teach?.settled === true, undefined, { timeout: WEB_TEST_TRAINING_WAIT_MS });
  return page.evaluate(() => tt().teach);
}

// Waits until `ms` have passed since listen() resolved, on the page's clock.
async function waitSinceReady(page: Page, ms: number): Promise<void> {
  await page.waitForFunction((m) => performance.now() - (window as unknown as TestWindow).tokkTest.readyMs >= m, ms, { timeout: ms + WEB_TEST_WAIT_SLACK_MS, polling: 50 });
}

// Teaches a sound label from the source that is playing: all copies, Done, Save, Close.
async function teachCopies(page: Page, label: string, copies: number, options: Record<string, unknown> = {}): Promise<void> {
  const { teachDurationMs } = await teachInfo();
  await page.evaluate(([l, o]) => tt().teachStart(l as string, { ui: true, ...(o as object) }), [label, options] as const);
  await expect(page.locator(HOST)).toHaveCount(1);
  await expect(page.locator(EXAMPLES)).toHaveCount(copies, { timeout: teachDurationMs + WEB_TEST_WAIT_SLACK_MS });
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  await expect(page.locator(EXAMPLES), 'the dialog must find exactly the copies in the teaching file').toHaveCount(copies);
  await page.click(action('done'));
  await expect(page.locator(action('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: WEB_TEST_TRAINING_WAIT_MS });
  await page.click(action('save'));
  expect((await waitForOutcome(page)).ok).toBe(true);
}

async function closeDialog(page: Page): Promise<void> {
  await page.click(action('close'));
  await expect(page.locator(HOST)).toHaveCount(0);
}

// Teaches `hum` from a source whose steady hum ends `humEndMs` after listen() resolved.
async function teachHum(page: Page, humEndMs: number): Promise<void> {
  await page.evaluate(() => tt().teachStart('hum', { ui: true }));
  await expect(page.locator(action('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: humEndMs + WEB_TEST_WAIT_SLACK_MS });
  await waitSinceReady(page, humEndMs + WEB_TEST_DONE_AFTER_HUM_MS);
  await page.click(action('done'));
  await expect(page.locator(action('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: WEB_TEST_TRAINING_WAIT_MS });
  await page.click(action('save'));
  expect((await waitForOutcome(page)).ok).toBe(true);
  await closeDialog(page);
}

function rgbOf(hex: string): string {
  const h = hex.slice(1);
  return `rgb(${[0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
}

const styleOf = (page: Page, selector: string, props: string[]): Promise<Record<string, string>> => page.locator(selector).first().evaluate(
  (el, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])), props,
);

// The true page times of the impacts of the tap WAV when it is played as a stream that starts at `startPageMs`.
const tapTruthMs = (startPageMs: number): number[] => Array.from({ length: WEB_TEST_TAP_COPIES }, (_, i) => startPageMs + WEB_TEST_LEAD_MS + i * WEB_TEST_IMPACT_SPACING_MS);
const nearestError = (mappedMs: number, truths: number[]): number => truths.map((x) => mappedMs - x).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));

function summary(errorsMs: number[]): { largestMs: number; meanMs: number; meanAbsMs: number; n: number } {
  const abs = errorsMs.map(Math.abs);
  return {
    largestMs: Math.max(...abs), meanMs: errorsMs.reduce((a, b) => a + b, 0) / errorsMs.length,
    meanAbsMs: abs.reduce((a, b) => a + b, 0) / abs.length, n: errorsMs.length,
  };
}

function gaps(env: EnvelopeCall[]): { perSecond: number; smallestMs: number; meanMs: number; largestMs: number } {
  const g = env.slice(1).map((e, i) => e.arrivalMs - env[i].arrivalMs);
  const spanMs = env[env.length - 1].arrivalMs - env[0].arrivalMs;
  return { perSecond: ((env.length - 1) * MS_PER_SECOND) / spanMs, smallestMs: Math.min(...g), meanMs: spanMs / g.length, largestMs: Math.max(...g) };
}

// An event with its confidence and nearest distance rounded to WEB_TEST_FLOAT_DIGITS significant digits.
function rounded(e: EngineEvent): EngineEvent {
  const r = (x: number): number => Number(x.toPrecision(WEB_TEST_FLOAT_DIGITS));
  if (e.kind === 'sound') return { ...e, confidence: r(e.confidence) };
  if (e.kind === 'unknown') return { ...e, nearest: { ...e.nearest, distance: r(e.nearest.distance) } };
  return e;
}

async function chromeVersion(page: Page): Promise<string> {
  return page.context().browser()?.version() ?? 'unknown';
}

test.describe('first run without sounds (Task 20)', () => {
  test.setTimeout(WEB_TEST_TEST_TIMEOUT_MS);

  test('listen with an empty model starts, and teach("click") makes "click" fire', async ({ page }) => {
    const key = uniqueKey();
    await start(page, { source: FIXTURE_TEACH_WAV_URL, storageKey: key, patterns: ['click'] });
    expect(await labels(page)).toEqual([]);
    const sounds = await page.evaluate(() => tt().ears.sounds);
    expect(sounds).toEqual(emptyModel(WEB_TEST_SAMPLE_RATE_HZ));
    expect(JSON.parse(await page.evaluate(() => tt().ears.exportSounds()))).toEqual(emptyModel(WEB_TEST_SAMPLE_RATE_HZ));
    await teachCopies(page, 'click', WEB_TEST_TEACH_COPIES);
    await expect(page.locator(`${HOST} [data-role="replace"]`)).toHaveCount(0);
    await closeDialog(page);
    expect(await labels(page)).toEqual(['click']);

    await page.evaluate(() => tt().ears.stop());
    await page.evaluate(() => { tt().calls.length = 0; });
    await start(page, { source: FIXTURE_TAP_WAV_URL, storageKey: key, patterns: ['click'] });
    expect(await labels(page)).toEqual(['click']);
    const { tapDurationMs } = await teachInfo();
    await waitForCalls(page, WEB_TEST_TAP_COPIES, tapDurationMs + WEB_TEST_WAIT_SLACK_MS);
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    expect((await calls(page)).map((c) => c.pattern)).toEqual(Array.from({ length: WEB_TEST_TAP_COPIES }, () => 'click'));
  });

  test('teach("hum") first on an empty model sets the pitch and lists hum', async ({ page }) => {
    await start(page, { source: FIXTURE_HUM_STEADY_WAV_URL, storageKey: uniqueKey(), patterns: ['hum.rise'] });
    await teachHum(page, WEB_TEST_LEAD_MS + WEB_TEST_HUM_STEADY_MS);
    expect(await labels(page)).toEqual(['hum']);
    const sounds = await page.evaluate(() => tt().ears.sounds);
    expect(sounds.examples).toEqual([]);
    expect(Math.abs((sounds.pitch?.baselineHz ?? 0) - WEB_TEST_HUM_BASELINE_HZ)).toBeLessThan(WEB_TEST_HUM_BASELINE_HZ * WEB_TEST_HUM_PITCH_TOLERANCE);
    expect(HUM_STEADY_DURATION_MS).toBeGreaterThan(WEB_TEST_LEAD_MS + WEB_TEST_HUM_STEADY_MS);
  });

  test('a model taught on the first run is there after a reload', async ({ page }) => {
    const key = uniqueKey();
    await start(page, { source: FIXTURE_TEACH_WAV_URL, storageKey: key });
    await teachCopies(page, 'click', WEB_TEST_TEACH_COPIES);
    await closeDialog(page);

    await page.reload();
    await start(page, { source: FIXTURE_TAP_WAV_URL, storageKey: key });
    expect(await labels(page)).toEqual(['click']);

    // The same base and another rate: ignored with a warning, not deleted.
    const text = (await storedItem(page, key)) as string;
    const entry = JSON.parse(text) as { version: number; base: string; model: SoundModel };
    const otherRate = JSON.stringify({ ...entry, model: { ...entry.model, sampleRate: WEB_TEST_MISMATCH_SAMPLE_RATE_HZ } });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, otherRate] as const);
    await page.reload();
    await start(page, { source: FIXTURE_TAP_WAV_URL, storageKey: key });
    expect(await labels(page)).toEqual([]);
    const w = (await warnings(page)).filter((x) => x.includes(key));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain(String(WEB_TEST_MISMATCH_SAMPLE_RATE_HZ));
    expect(w[0]).toContain(String(WEB_TEST_SAMPLE_RATE_HZ));
    expect(await storedItem(page, key)).toBe(otherRate);

    // Another base: ignored.
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify({ ...entry, base: WEB_TEST_BASE_MISMATCH })] as const);
    await page.reload();
    await start(page, { source: FIXTURE_TAP_WAV_URL, storageKey: key });
    expect(await labels(page)).toEqual([]);
    expect((await warnings(page)).some((x) => x.includes(key))).toBe(true);
  });
});

test.describe('inert hum patterns (Task 20)', () => {
  test.setTimeout(WEB_TEST_TEST_TIMEOUT_MS);

  test('a hum.rise pattern without a baseline is inert, and fires after teach("hum")', async ({ page }) => {
    // Part (a): a WAV with two rising hums. The import of a model with a pitch happens in the gap.
    const pitchOnly = await readFile(FIXTURE_PITCH_ONLY_MODEL_PATH, 'utf8');
    await start(page, { source: FIXTURE_TWO_HUM_WAV_URL, storageKey: uniqueKey(), patterns: ['hum.rise'] });
    await page.waitForFunction(
      () => (window as unknown as TestWindow).tokkTest.events.some((e) => e.kind === 'continuous' && e.phase === 'end'),
      undefined, { timeout: TWO_HUM_TIMES.firstEndMs + WEB_TEST_WAIT_SLACK_MS, polling: 50 },
    );
    const first = await events(page);
    expect(first.filter((e) => e.kind === 'continuous' && e.phase === 'update').length).toBeGreaterThan(0);
    expect(await calls(page)).toEqual([]);
    expect(await page.evaluate((t) => { try { tt().ears.importSounds(t); return 'ok'; } catch (e) { return (e as Error).message; } }, pitchOnly)).toBe('ok');
    expect(await labels(page)).toEqual(['hum']);
    await waitForCalls(page, 1, TWO_HUM_TIMES.durationMs + WEB_TEST_WAIT_SLACK_MS);
    expect((await calls(page)).every((c) => c.pattern === 'hum.rise')).toBe(true);
  });

  test.describe('with the fake microphone playing a steady hum, then a rising hum', () => {
    test.use({ micWav: FIXTURE_HUM_MIC_WAV_PATH });

    test('teach("hum") on the microphone, then the rising hum fires hum.rise', async ({ micPage: page }) => {
      await start(page, { storageKey: uniqueKey(), patterns: ['hum.rise'] });
      expect(await labels(page)).toEqual([]);
      await teachHum(page, HUM_MIC_TIMES.firstEndMs);
      expect(await labels(page)).toEqual(['hum']);
      const pitch = await page.evaluate(() => tt().ears.sounds.pitch?.baselineHz ?? 0);
      expect(Math.abs(pitch - WEB_TEST_HUM_BASELINE_HZ)).toBeLessThan(WEB_TEST_HUM_BASELINE_HZ * WEB_TEST_HUM_PITCH_TOLERANCE);
      expect(await calls(page), 'the save must happen before the rising hum starts').toEqual([]);
      await waitForCalls(page, 1, HUM_MIC_TIMES.durationMs + WEB_TEST_WAIT_SLACK_MS);
      expect((await calls(page)).every((c) => c.pattern === 'hum.rise')).toBe(true);
    });
  });
});

test.describe('onEvent and onEnvelope (Task 20)', () => {
  test.setTimeout(WEB_TEST_TEST_TIMEOUT_MS);

  // The fixture model with `low` taught as background and `ring` left out: the low impact is a background segment
  // (no event) and the ring impact is unknown.
  async function eventModel(): Promise<SoundModel> {
    const m = JSON.parse(await readFile(FIXTURE_MODEL_PATH, 'utf8')) as SoundModel;
    return {
      ...m,
      examples: m.examples.filter((e) => e.label !== 'ring').map((e) => (e.label === 'low' ? { ...e, label: 'background' } : e)),
      thresholds: Object.fromEntries(Object.entries(m.thresholds).filter(([k]) => k !== 'ring').map(([k, v]) => [k === 'low' ? 'background' : k, v])),
    };
  }

  function nodeRun(model: SoundModel, wavBytes: Buffer): { events: EngineEvent[]; segments: SegmentReport[] } {
    const wav = readWav(new Uint8Array(wavBytes));
    const out = { events: [] as EngineEvent[], segments: [] as SegmentReport[] };
    const engine = createEngine({ sounds: model, sampleRate: wav.sampleRate, on: {}, onEvent: (e) => out.events.push(e), onSegment: (r) => out.segments.push(r) });
    engine.push(wav.samples);
    engine.flush();
    return out;
  }

  test('onEvent receives sound events, continuous events, and unknown events with nearest, and none for background', async ({ page }) => {
    const model = await eventModel();
    const expected = nodeRun(model, await readFile(FIXTURE_WAV_PATH));
    const backgroundAt = expected.segments.filter((s) => s.result.kind === 'match' && s.result.label === 'background').map((s) => s.t);
    expect(backgroundAt.length).toBeGreaterThan(0);
    expect(expected.events.some((e) => e.kind === 'unknown')).toBe(true);
    expect(expected.events.some((e) => e.kind === 'sound')).toBe(true);

    await start(page, { model, source: FIXTURE_WAV_URL, patterns: ['mid', 'high'] });
    const { durationMs } = await listenInfo();
    await page.waitForFunction((n) => (window as unknown as TestWindow).tokkTest.events.length >= n, expected.events.length, { timeout: durationMs + WEB_TEST_WAIT_SLACK_MS });
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    const got = await events(page);
    // Kinds, labels, times and ids are exact. Confidence and distance can differ in the last digit between Chrome and Node
    // (the feature maths of two V8 builds), so they are compared to WEB_TEST_FLOAT_DIGITS significant digits.
    expect(got.map(rounded)).toEqual(expected.events.map(rounded));
    for (const e of got) if (e.kind === 'unknown') expect(e.nearest.id.length).toBeGreaterThan(0);
    for (const t of backgroundAt) expect(got.some((e) => e.t === t)).toBe(false);
    expect(WEB_TEST_LABELS).toContain('low');

    // Continuous events: a steady hum without any sounds.
    await page.evaluate(() => tt().ears.stop());
    await page.evaluate(() => { tt().events.length = 0; });
    const hum = nodeRun(emptyModel(WEB_TEST_SAMPLE_RATE_HZ), await readFile(FIXTURE_HUM_STEADY_WAV_PATH));
    expect(hum.events.length).toBeGreaterThan(0);
    expect(hum.events.every((e) => e.kind === 'continuous')).toBe(true);
    await start(page, { source: FIXTURE_HUM_STEADY_WAV_URL });
    await page.waitForFunction((n) => (window as unknown as TestWindow).tokkTest.events.length >= n, hum.events.length, { timeout: HUM_STEADY_DURATION_MS + WEB_TEST_WAIT_SLACK_MS });
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    expect(await events(page)).toEqual(hum.events);
  });

  test('onEnvelope delivers blocks of 10 ms bins in order', async ({ page }) => {
    const wav = readWav(new Uint8Array(await readFile(FIXTURE_WAV_PATH)));
    const binSamples = msToSamples(WEB_ENVELOPE_RESOLUTION_MS, wav.sampleRate);
    const totalBins = Math.floor(wav.samples.length / binSamples);
    await start(page, { model: FIXTURE_MODEL_URL, source: FIXTURE_WAV_URL, patterns: WEB_TEST_LABELS, debug: true });
    await expect(page.locator('[data-tokk-overlay]')).toHaveCount(1);
    const { durationMs } = await listenInfo();
    await page.waitForFunction((n) => (window as unknown as TestWindow).tokkTest.envelopes.reduce((a, e) => a + e.bins, 0) >= n, totalBins, { timeout: durationMs + WEB_TEST_WAIT_SLACK_MS });
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    const env = await envelopes(page);
    let bins = 0;
    for (const e of env) {
      expect(e.binMs).toBe(WEB_ENVELOPE_RESOLUTION_MS);
      expect(e.typed).toBe(true);
      expect(e.bins).toBe(e.maxBins);
      expect(e.bins).toBeGreaterThan(0);
      expect(e.bins).toBeLessThanOrEqual(Math.ceil(WEB_CHUNK_MS / WEB_ENVELOPE_RESOLUTION_MS));
      expect(e.t0).toBe((bins * binSamples) / wav.sampleRate);
      bins += e.bins;
    }
    expect(bins).toBe(totalBins);
    expect((await calls(page)).map((c) => c.pattern)).toEqual(WEB_TEST_LABELS);   // the overlay and the handlers work at the same time
    console.log(`MEASURED envelope messages (WAV source): ${JSON.stringify(gaps(env))}`);

    // No callback while a dialog is open; they come again after Cancel.
    await page.evaluate(() => tt().ears.stop());
    await start(page, { model: FIXTURE_MODEL_URL, source: FIXTURE_TEACH_WAV_URL, patterns: WEB_TEST_LABELS });
    await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.envelopes.length > 0);
    await page.evaluate(() => tt().teachStart('tap', { ui: true }));
    await expect(page.locator(HOST)).toHaveCount(1);
    const counts = (): Promise<number[]> => page.evaluate(() => [tt().envelopes.length, tt().events.length]);
    const atOpen = await counts();
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    expect(await counts()).toEqual(atOpen);
    await page.click(action('cancel'));
    await waitForOutcome(page);
    await page.waitForFunction((n) => (window as unknown as TestWindow).tokkTest.envelopes.length > n, atOpen[0], { timeout: WEB_TEST_WAIT_SLACK_MS });
  });
});

test.describe('toPageTime (Task 20)', () => {
  test.setTimeout(WEB_TEST_TEST_TIMEOUT_MS);
  const streamOptions = (extra: Partial<StartOptions> = {}): StartOptions => ({
    model: FIXTURE_MODEL_URL, source: 'stream', streamWav: FIXTURE_TAP_WAV_URL, streamLeadMs: WEB_TEST_STREAM_LEAD_MS, patterns: ['high'], ...extra,
  });
  const streamInfo = (page: Page): Promise<StreamInfo> => page.evaluate(() => tt().stream as StreamInfo);

  test('toPageTime maps the fixture impact times to page times within the measured bound', async ({ page }) => {
    await start(page, streamOptions());
    const { tapDurationMs } = await teachInfo();
    await waitForCalls(page, WEB_TEST_TAP_COPIES, tapDurationMs + WEB_TEST_STREAM_LEAD_MS + WEB_TEST_WAIT_SLACK_MS);
    const s = await streamInfo(page);
    const truths = tapTruthMs(s.startPageMs);
    const got = await calls(page);
    expect(got.every((c) => c.pageMs !== null)).toBe(true);
    const errors = got.map((c) => nearestError(c.pageMs as number, truths));
    const env = await envelopes(page);
    console.log(`MEASURED toPageTime no pause: ${JSON.stringify(summary(errors))} errors ${JSON.stringify(errors.map((e) => +e.toFixed(2)))} `
      + `chrome ${await chromeVersion(page)} stream ${JSON.stringify(s)} envelopes ${JSON.stringify(gaps(env))}`);
    for (const e of errors) expect(Math.abs(e)).toBeLessThanOrEqual(WEB_TEST_PAGE_TIME_BOUND_MS);
    expect(got).toHaveLength(WEB_TEST_TAP_COPIES);
  });

  test('toPageTime stays within the bound after pause() and resume()', async ({ page }) => {
    await start(page, streamOptions({ pauseAfter: WEB_TEST_PAUSE_AFTER_CALLS, pauseMs: WEB_TEST_PAUSE_MS }));
    const { tapDurationMs } = await teachInfo();
    await waitForCalls(page, WEB_TEST_PAUSE_AFTER_CALLS.length + 1, tapDurationMs + WEB_TEST_STREAM_LEAD_MS + WEB_TEST_WAIT_SLACK_MS);
    await waitSinceReady(page, tapDurationMs + WEB_TEST_STREAM_LEAD_MS);
    const s = await streamInfo(page);
    const truths = tapTruthMs(s.startPageMs);
    const got = await calls(page);
    const pauses = await page.evaluate(() => tt().pauses);
    expect(pauses).toHaveLength(WEB_TEST_PAUSE_AFTER_CALLS.length);
    expect(pauses.every((p) => p.resumedMs !== undefined)).toBe(true);
    const errors = got.map((c) => nearestError(c.pageMs as number, truths));
    // The first call again, now that two later stretches exist: it must use its own stretch.
    const again = await page.evaluate((t) => tt().ears.toPageTime(t), got[0].t);
    const againError = nearestError(again, truths);
    const afterOne = errors.slice(1, 2);
    const afterTwo = errors.slice(2);
    console.log(`MEASURED toPageTime pause: after one ${JSON.stringify(summary(afterOne))} after two ${JSON.stringify(summary(afterTwo))} `
      + `first call again ${againError.toFixed(2)} all ${JSON.stringify(errors.map((e) => +e.toFixed(2)))} pauses ${JSON.stringify(pauses)}`);
    expect(afterTwo.length).toBeGreaterThan(0);
    for (const e of [...errors, againError]) expect(Math.abs(e)).toBeLessThanOrEqual(WEB_TEST_PAGE_TIME_BOUND_MS);
  });

  test('toPageTime after a rebuild throws until audio of the new engine arrives, then maps within the bound', async ({ page }) => {
    await start(page, streamOptions());
    const { tapDurationMs } = await teachInfo();
    await waitForCalls(page, 1, tapDurationMs + WEB_TEST_WAIT_SLACK_MS);
    const thrown = await page.evaluate(() => {
      tt().ears.importSounds(tt().ears.exportSounds());
      try { tt().ears.toPageTime(0); return null; } catch (e) { return { name: (e as Error).name, message: (e as Error).message }; }
    });
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toMatch(/no audio/i);
    await waitForCalls(page, 2, tapDurationMs + WEB_TEST_WAIT_SLACK_MS);
    await waitSinceReady(page, tapDurationMs + WEB_TEST_STREAM_LEAD_MS);
    const s = await streamInfo(page);
    const truths = tapTruthMs(s.startPageMs);
    const after = (await calls(page)).slice(1);
    const errors = after.map((c) => nearestError(c.pageMs as number, truths));
    console.log(`MEASURED toPageTime after rebuild: ${JSON.stringify(summary(errors))} first ${errors[0].toFixed(2)}`);
    for (const e of errors) expect(Math.abs(e)).toBeLessThanOrEqual(WEB_TEST_PAGE_TIME_BOUND_MS);
  });
});

test.describe('dialog text and theme (Task 20)', () => {
  test.setTimeout(WEB_TEST_TEST_TIMEOUT_MS);

  test('--tokk-accent set on the page changes the dialog accent colour', async ({ page }) => {
    await start(page, { source: FIXTURE_TAP_WAV_URL, storageKey: uniqueKey() });
    const read = async () => ({
      dialog: await styleOf(page, `${HOST} dialog`, ['background-color', 'color', 'font-family', 'border-top-left-radius']),
      button: await styleOf(page, action('cancel'), ['background-color', 'color', 'border-top-color', 'font-family', 'border-top-left-radius']),
      progress: await styleOf(page, `${HOST} progress`, ['accent-color']),
    });
    const focusOutline = async (): Promise<string> => {
      await page.keyboard.press('Tab');
      return page.evaluate(() => {
        const el = document.querySelector('[data-tokk-teach]')?.shadowRoot?.activeElement;
        return el ? getComputedStyle(el).outlineColor : '';
      });
    };
    const accentPixels = (rgb: number[]): Promise<number> => page.evaluate((c) => {
      const canvas = document.querySelector('[data-tokk-teach]')?.shadowRoot?.querySelector('li[data-example] canvas') as HTMLCanvasElement | null;
      if (!canvas) return -1;
      const d = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2]) n++;
      return n;
    }, rgb);

    // Defaults.
    await page.evaluate(() => tt().teachStart('tap', { ui: true }));
    await expect(page.locator(HOST)).toHaveCount(1);
    const plain = await read();
    expect(plain.dialog).toEqual({
      'background-color': rgbOf(OVERLAY_COLOURS.panelBackground), color: rgbOf(OVERLAY_COLOURS.text), 'font-family': DEFAULT_FONT,
      'border-top-left-radius': DEFAULT_RADIUS,
    });
    expect(plain.button).toEqual({
      'background-color': rgbOf(OVERLAY_COLOURS.headerBackground), color: rgbOf(OVERLAY_COLOURS.text), 'border-top-color': rgbOf(OVERLAY_COLOURS.text),
      'font-family': DEFAULT_FONT, 'border-top-left-radius': DEFAULT_RADIUS,
    });
    expect(plain.progress).toEqual({ 'accent-color': rgbOf(OVERLAY_COLOURS.waveform) });
    expect(plain.button['background-color']).not.toBe(PAGE_BUTTON_BACKGROUND);
    expect(plain.button['border-top-left-radius']).not.toBe(PAGE_BUTTON_RADIUS);
    const defaultOutline = await focusOutline();
    expect(defaultOutline).toBe(rgbOf(OVERLAY_COLOURS.focusOutline));
    await page.click(action('cancel'));
    await waitForOutcome(page);

    // Themed.
    await page.evaluate((p) => tt().setTheme(p), THEME);
    await page.evaluate(() => tt().teachStart('tap', { ui: true }));
    await expect(page.locator(HOST)).toHaveCount(1);
    const themed = await read();
    expect(themed.dialog).toEqual({
      'background-color': THEME['--tokk-bg'], color: THEME['--tokk-fg'], 'font-family': THEME['--tokk-font'], 'border-top-left-radius': THEME['--tokk-radius'],
    });
    expect(themed.button).toEqual({
      'background-color': THEME['--tokk-bg'], color: THEME['--tokk-fg'], 'border-top-color': THEME['--tokk-fg'], 'font-family': THEME['--tokk-font'],
      'border-top-left-radius': THEME['--tokk-radius'],
    });
    expect(themed.progress).toEqual({ 'accent-color': THEME['--tokk-accent'] });
    expect(await focusOutline()).toBe(defaultOutline);
    await expect(page.locator(EXAMPLES).first()).toBeVisible({ timeout: WEB_TEST_WAIT_SLACK_MS });
    expect(await accentPixels(THEME_ACCENT_RGB)).toBeGreaterThan(0);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('page-title') as HTMLElement).fontSize)).toBe(PAGE_H1_FONT_SIZE);
    expect((await styleOf(page, `${HOST} h2`, ['font-size']))['font-size']).not.toBe(PAGE_BODY_FONT_SIZE);
    await page.click(action('cancel'));
    await waitForOutcome(page);
  });

  test('TeachOptions.text replaces the dialog title and prompts', async ({ page }) => {
    await start(page, { source: FIXTURE_TEACH_WAV_URL, storageKey: uniqueKey() });
    const call = (options: unknown) => page.evaluate((o) => tt().teachOutcome('knock', o), options);
    expect(await call({ ui: true, text: { heading: 'x' } })).toMatchObject({ ok: false, name: 'RangeError', message: expect.stringContaining('title') });
    expect(await call({ ui: true, text: { title: '  ' } })).toMatchObject({ ok: false, name: 'RangeError' });
    expect(await call({ ui: true, text: { quiet: 'Wait {count}' } })).toMatchObject({ ok: false, name: 'RangeError' });
    await expect(page.locator(HOST)).toHaveCount(0);

    const text = {
      title: 'Summon {label}', quiet: 'Silence, mortal.', record: 'Knock <b>{count}</b> times', count: '{kept} of {target} kept',
      done: 'Finish', save: 'Bind', cancel: 'Flee', saved: 'Bound.',
    };
    await page.evaluate((t) => tt().teachStart('knock', { ui: true, text: t }), text);
    await expect(page.locator(`${HOST} h2`)).toHaveText('Summon knock');
    await expect(page.locator(`${HOST} [data-role="step"]`)).toHaveText('Silence, mortal.');
    await expect(page.locator(action('cancel'))).toHaveText('Flee');
    await expect(page.locator(action('done'))).toHaveText('Finish');
    await expect(page.locator(`${HOST} [data-role="step"]`)).toHaveText('Knock <b>10</b> times', { timeout: WEB_TEST_WAIT_SLACK_MS });
    expect(await page.locator(`${HOST} [data-role="step"] b`).count()).toBe(0);
    const { teachDurationMs } = await teachInfo();
    await expect(page.locator(EXAMPLES)).toHaveCount(WEB_TEST_TEACH_COPIES, { timeout: teachDurationMs + WEB_TEST_WAIT_SLACK_MS });
    await expect(page.locator(`${HOST} [data-role="count"]`)).toHaveText(`${WEB_TEST_TEACH_COPIES} of ${WEB_TEST_TEACH_COPIES} kept`);
    await page.click(action('done'));
    await expect(page.locator(action('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: WEB_TEST_TRAINING_WAIT_MS });
    await expect(page.locator(action('save'))).toHaveText('Bind');
    await page.click(action('save'));
    expect((await waitForOutcome(page)).ok).toBe(true);
    await expect(page.locator(`${HOST} [data-role="saved"]`)).toHaveText('Bound.');
    await expect(page.locator(`${HOST} [data-role="step"]`)).toHaveText('Bound.');
    await closeDialog(page);

    await page.evaluate(() => tt().teachStart('knock', { ui: true }));
    await expect(page.locator(`${HOST} h2`)).toHaveText('Teach "knock"');
    await expect(page.locator(action('cancel'))).toHaveText('Cancel (Esc)');
    await page.click(action('cancel'));
    await waitForOutcome(page);
  });
});
