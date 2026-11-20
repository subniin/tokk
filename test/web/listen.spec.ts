import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { SAMPLE_RATE_MAX_HZ, SAMPLE_RATE_MIN_HZ } from '../../core/constants';
import { runSamples } from '../../core/engine';
import { WEB_RESUME_TIMEOUT_MS } from '../../web/constants';
import { readWav } from '../../core/wav';
import type { SoundModel } from '../../core/types';
import { WEB_TEST_LABELS } from './fixture';
import { instrument, readInstrumentation } from './instrument';
import { FIXTURE_LABELS_PATH, FIXTURE_MODEL_PATH, FIXTURE_MODEL_URL, FIXTURE_WAV_PATH, FIXTURE_WAV_URL, PAGE_URL } from './paths';

// Test-only values.
const WEB_TEST_WAIT_SLACK_MS = 15_000;          // added to the length of the fixture for a wait
const WEB_TEST_SETTLE_MS = 1500;                // wait to show that no extra match arrives
const WEB_TEST_NO_GESTURE_MARGIN_MS = 3000;     // added to WEB_RESUME_TIMEOUT_MS
const WEB_TEST_SMOKE_BUDGET_MS = 20_000;
const WEB_TEST_PAUSE_AFTER_MS = 500;            // the file is still in its quiet lead then
const WEB_TEST_PAUSE_FOR_MS = 400;
const WEB_TEST_STOP_AFTER_MS = 1000;
const GESTURE_SENTENCE = 'call listen() from a user gesture such as a click';

interface Info { labels: string[]; sampleRate: number; durationMs: number }

async function fixtureInfo(): Promise<Info> {
  return JSON.parse(await readFile(FIXTURE_LABELS_PATH, 'utf8')) as Info;
}

function pageUrl(extra = ''): string {
  return `${PAGE_URL}?model=${encodeURIComponent(FIXTURE_MODEL_URL)}${extra}`;
}

async function callsOf(page: Page): Promise<{ pattern: string; t: number }[]> {
  return page.evaluate(() => (window as unknown as { tokkTest: { calls: { pattern: string; t: number }[] } }).tokkTest.calls.slice());
}

async function waitForCalls(page: Page, count: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    (n) => (window as unknown as { tokkTest: { calls: unknown[] } }).tokkTest.calls.length >= n,
    count,
    { timeout: timeoutMs, polling: 100 },
  );
}

test('smoke: listen() on the fake microphone fires the patterns of the fixture labels in order', async ({ page }) => {
  await instrument(page);
  test.setTimeout(WEB_TEST_SMOKE_BUDGET_MS);
  const info = await fixtureInfo();
  await page.goto(pageUrl());
  await page.click('#start');
  await page.waitForFunction(() => (window as unknown as { tokkTest: { ready: boolean; rejection: string | null } }).tokkTest.ready
    || (window as unknown as { tokkTest: { rejection: string | null } }).tokkTest.rejection !== null);
  const rejection = await page.evaluate(() => (window as unknown as { tokkTest: { rejection: string | null } }).tokkTest.rejection);
  expect(rejection).toBeNull();

  const { contexts } = await readInstrumentation(page);
  expect(contexts.length).toBe(1);
  expect(contexts[0].sampleRate).toBeGreaterThanOrEqual(SAMPLE_RATE_MIN_HZ);
  expect(contexts[0].sampleRate).toBeLessThanOrEqual(SAMPLE_RATE_MAX_HZ);

  await waitForCalls(page, info.labels.length, info.durationMs + WEB_TEST_WAIT_SLACK_MS);
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  expect((await callsOf(page)).map((c) => c.pattern)).toEqual(info.labels);
  expect(info.labels).toEqual(WEB_TEST_LABELS);
});

test('listen({ source: wav }) gives the same patterns and times as runSamples in Node', async ({ page }) => {
  await instrument(page);
  const info = await fixtureInfo();
  const wav = readWav(new Uint8Array(await readFile(FIXTURE_WAV_PATH)));
  const model = JSON.parse(await readFile(FIXTURE_MODEL_PATH, 'utf8')) as SoundModel;
  const expected = runSamples(wav.samples, wav.sampleRate, model, WEB_TEST_LABELS).matches.map((m) => ({ pattern: m.pattern, t: m.t }));
  expect(expected.length).toBe(info.labels.length);

  await page.goto(pageUrl(`&source=${encodeURIComponent(FIXTURE_WAV_URL)}`));
  await page.click('#start');
  await page.waitForFunction(() => (window as unknown as { tokkTest: { ready: boolean } }).tokkTest.ready);
  expect((await readInstrumentation(page)).contexts).toEqual([]);   // a WAV source creates no AudioContext

  await page.waitForTimeout(WEB_TEST_PAUSE_AFTER_MS);
  await page.evaluate(() => (window as unknown as { tokkTest: { ears: { pause(): void } } }).tokkTest.ears.pause());
  await page.waitForTimeout(WEB_TEST_PAUSE_FOR_MS);
  await page.evaluate(() => (window as unknown as { tokkTest: { ears: { resume(): void } } }).tokkTest.ears.resume());

  await waitForCalls(page, expected.length, info.durationMs + WEB_TEST_WAIT_SLACK_MS);
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  expect(await callsOf(page)).toEqual(expected);
});

test('listen() without a user gesture rejects with the gesture message', async ({ page }) => {
  await instrument(page, { suspendWithoutGesture: true });
  // The page calls listen() on load. A page.evaluate call would not do: Playwright runs it as a user gesture.
  await page.goto(pageUrl('&autostart=1'));
  await page.waitForFunction(
    () => (window as unknown as { tokkTest: { rejection: string | null } }).tokkTest.rejection !== null,
    undefined,
    { timeout: WEB_RESUME_TIMEOUT_MS + WEB_TEST_NO_GESTURE_MARGIN_MS },
  );
  const rejection = await page.evaluate(() => (window as unknown as { tokkTest: { rejection: string } }).tokkTest.rejection);
  expect(rejection).toContain(GESTURE_SENTENCE);
});
test('stop() closes the microphone track, the context and the Worker, and no handler fires afterwards', async ({ page }) => {
  await instrument(page);
  await page.goto(pageUrl());
  await page.click('#start');
  await page.waitForFunction(() => (window as unknown as { tokkTest: { ready: boolean } }).tokkTest.ready);
  await page.waitForTimeout(WEB_TEST_STOP_AFTER_MS);

  const before = await readInstrumentation(page);
  expect(before.tracks.length).toBeGreaterThan(0);
  expect(before.tracks.every((t) => t.readyState === 'live')).toBe(true);

  await page.evaluate(() => (window as unknown as { tokkTest: { ears: { stop(): Promise<void> } } }).tokkTest.ears.stop());
  const after = await readInstrumentation(page);
  expect(after.tracks.every((t) => t.readyState === 'ended')).toBe(true);
  expect(after.contexts.every((c) => c.state === 'closed')).toBe(true);
  expect(after.terminateCalls).toBeGreaterThan(0);

  const callsAtStop = (await callsOf(page)).length;
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  expect((await callsOf(page)).length).toBe(callsAtStop);
});
