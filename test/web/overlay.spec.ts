import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runSamples } from '../../core/engine';
import { readWav } from '../../core/wav';
import type { SoundModel } from '../../core/types';
import { OVERLAY_COLOURS } from '../../web/overlay/theme';
import { WEB_TEST_LABELS } from './fixture';
import { instrument, readInstrumentation } from './instrument';
import {
  FIXTURE_LABELS_PATH, FIXTURE_MISMATCH_MODEL_URL, FIXTURE_MODEL_PATH, FIXTURE_MODEL_URL, FIXTURE_WAV_PATH, FIXTURE_WAV_URL, PAGE_URL, REPO_ROOT,
} from './paths';

// Test-only values.
const WEB_TEST_WAIT_SLACK_MS = 15_000;          // added to the length of the fixture for a wait
const WEB_TEST_SETTLE_MS = 1500;                // wait to show that no extra row arrives
const WEB_TEST_SCREENSHOT_MAX_BYTES = 100_000;
const WEB_TEST_TAB_LIMIT = 10;                  // a count: most Tab presses allowed to reach the button
const WEB_TEST_PAGE_H1_FONT_SIZE = '41px';
const WEB_TEST_PAGE_BODY_FONT_SIZE = '27px';
const WEB_TEST_PAGE_BODY_COLOUR = 'rgb(255, 0, 0)';
const WEB_TEST_MIN_BOLD_WEIGHT = 700;
const WEB_TEST_SCREENSHOT_PATH = resolve(REPO_ROOT, 'docs', 'images', 'overlay.png');
const WEB_TEST_PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const HOST = '[data-tokk-overlay]';
const EVENT_ROWS = `${HOST} li.event`;
const MATCH_ROWS = `${HOST} li.match`;

interface Info { labels: string[]; sampleRate: number; durationMs: number }

async function info(): Promise<Info> {
  return JSON.parse(await readFile(FIXTURE_LABELS_PATH, 'utf8')) as Info;
}

// Counts from the Node engine for the same WAV and model, so no number is typed here.
async function expectedCounts(): Promise<{ events: number; matches: number }> {
  const wav = readWav(new Uint8Array(await readFile(FIXTURE_WAV_PATH)));
  const model = JSON.parse(await readFile(FIXTURE_MODEL_PATH, 'utf8')) as SoundModel;
  const r = runSamples(wav.samples, wav.sampleRate, model, WEB_TEST_LABELS);
  return { events: r.events.filter((e) => e.kind === 'sound').length + r.unknowns.length, matches: r.matches.length };
}

function url(o: { debug?: boolean; model?: string }): string {
  const model = o.model ?? FIXTURE_MODEL_URL;
  return `${PAGE_URL}?model=${encodeURIComponent(model)}&source=${encodeURIComponent(FIXTURE_WAV_URL)}${o.debug === false ? '' : '&debug=1'}`;
}

async function start(page: Page): Promise<void> {
  await page.click('#start');
  await page.waitForFunction(() => (window as unknown as { tokkTest: { ready: boolean } }).tokkTest.ready);
}

async function open(page: Page, o: { debug?: boolean; model?: string } = {}): Promise<void> {
  await page.goto(url(o));
  await start(page);
}

async function waitForRows(page: Page, counts: { events: number; matches: number }, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    // document.querySelectorAll does not enter a shadow root, so the function reads the root of the host.
    ({ ev, ma }) => {
      const root = document.querySelector('[data-tokk-overlay]')?.shadowRoot;
      return root !== undefined && root !== null && root.querySelectorAll('li.event').length >= ev && root.querySelectorAll('li.match').length >= ma;
    },
    { ev: counts.events, ma: counts.matches },
    { timeout: timeoutMs, polling: 100 },
  );
}

async function waitAll(page: Page): Promise<{ events: number; matches: number }> {
  const counts = await expectedCounts();
  await waitForRows(page, counts, (await info()).durationMs + WEB_TEST_WAIT_SLACK_MS);
  return counts;
}

const style = (l: Locator, prop: 'fontSize' | 'fontWeight' | 'color'): Promise<string> =>
  l.evaluate((el, p) => getComputedStyle(el)[p as 'fontSize'], prop);

const h1Style = (page: Page) => page.evaluate(() => {
  const s = getComputedStyle(document.getElementById('page-title') as HTMLElement);
  return { fontSize: s.fontSize, fontWeight: s.fontWeight };
});

test('debug: true shows one row per fixture event and a bold match row', async ({ page }) => {
  await open(page);
  const counts = await waitAll(page);
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  await expect(page.locator(EVENT_ROWS)).toHaveCount(counts.events);
  await expect(page.locator(MATCH_ROWS)).toHaveCount(counts.matches);

  const matches = page.locator(MATCH_ROWS);
  for (let i = 0; i < counts.matches; i++) {
    expect(Number(await style(matches.nth(i), 'fontWeight'))).toBeGreaterThanOrEqual(WEB_TEST_MIN_BOLD_WEIGHT);
    expect((await matches.nth(i).textContent()) ?? '').toMatch(/^Pattern/);
  }
  const first = (await page.locator(EVENT_ROWS).first().textContent()) ?? '';
  expect(first).toMatch(/confidence/);
  expect(first).toMatch(/nearest/);
  expect(first).toMatch(/distance/);
  expect(first).toMatch(new RegExp(WEB_TEST_LABELS.join('|')));
  await expect(page.locator(`${HOST} .badge`)).toHaveText('Listening');
  await expect(page.locator(`${HOST} .warning`)).toHaveCount(0);
});

test('overlay styles do not leak: a page h1 keeps its computed font size', async ({ page }) => {
  await page.goto(url({}));
  const before = await h1Style(page);
  expect(before.fontSize).toBe(WEB_TEST_PAGE_H1_FONT_SIZE);
  await start(page);
  await waitAll(page);
  expect(await h1Style(page)).toEqual(before);

  for (const selector of [`${HOST} .title`, `${HOST} .badge`, EVENT_ROWS]) {
    const el = page.locator(selector).first();
    expect(await style(el, 'fontSize'), selector).not.toBe(WEB_TEST_PAGE_BODY_FONT_SIZE);
    expect(await style(el, 'color'), selector).not.toBe(WEB_TEST_PAGE_BODY_COLOUR);
  }
  const hex = OVERLAY_COLOURS.text.slice(1);
  const rgb = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ');
  expect(await style(page.locator(`${HOST} .title`), 'color')).toBe(`rgb(${rgb})`);
});

test('the sample-rate warning appears when the model rate differs from the context rate', async ({ page }) => {
  await open(page, { model: FIXTURE_MISMATCH_MODEL_URL });
  const warning = page.locator(`${HOST} .warning`);
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('role', 'status');
  const text = (await warning.textContent()) ?? '';
  expect(text).toContain('48000 Hz');
  expect(text).toContain('44100 Hz');

  await page.goto(url({}));
  await start(page);
  await expect(page.locator(`${HOST} .badge`)).toBeVisible();
  await expect(page.locator(`${HOST} .warning`)).toHaveCount(0);
});

test('reduced motion still shows rows', async ({ page }) => {
  await instrument(page, { countAnimationFrames: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await waitAll(page);
  await expect(page.locator(MATCH_ROWS).first()).toBeVisible();
  await expect(page.locator(`${HOST} .badge`)).toHaveText('Listening');
  await expect(page.locator(`${HOST} canvas`)).toHaveCount(1);
  expect((await readInstrumentation(page)).animationFrames).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page);
  await waitAll(page);
  expect((await readInstrumentation(page)).animationFrames).toBeGreaterThan(0);
});

test('the collapse button works from the keyboard and has an accessible name', async ({ page }) => {
  await open(page);
  await waitAll(page);
  const button = page.getByRole('button', { name: 'Collapse debug panel' });
  await expect(button).toHaveCount(1);
  const focused = (): Promise<boolean> => page.evaluate(() => {
    const host = document.querySelector('[data-tokk-overlay]');
    return host?.shadowRoot?.activeElement?.tagName === 'BUTTON';
  });
  let reached = false;
  for (let i = 0; i < WEB_TEST_TAB_LIMIT && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await focused();
  }
  expect(reached).toBe(true);
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Enter');
  const collapsed = page.getByRole('button', { name: 'Expand debug panel' });
  await expect(collapsed).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(EVENT_ROWS).first()).toBeHidden();

  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Collapse debug panel' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(EVENT_ROWS).first()).toBeVisible();
});

test('pause() sets the badge to Paused and stop() removes the panel', async ({ page }) => {
  await open(page);
  const badge = page.locator(`${HOST} .badge`);
  await expect(badge).toHaveText('Listening');
  await page.evaluate(() => (window as unknown as { tokkTest: { ears: { pause(): void } } }).tokkTest.ears.pause());
  await expect(badge).toHaveText('Paused');
  await page.evaluate(() => (window as unknown as { tokkTest: { ears: { resume(): void } } }).tokkTest.ears.resume());
  await expect(badge).toHaveText('Listening');
  await page.evaluate(() => (window as unknown as { tokkTest: { ears: { stop(): Promise<void> } } }).tokkTest.ears.stop());
  await expect(page.locator(HOST)).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('[data-tokk-overlay]'))).toBeNull();
});

test('no overlay without debug', async ({ page }) => {
  await open(page, { debug: false });
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  expect(await page.evaluate(() => ({
    hosts: document.querySelectorAll('[data-tokk-overlay]').length,
    canvases: document.querySelectorAll('canvas').length,
    shadows: [...document.querySelectorAll('*')].filter((el) => el.shadowRoot !== null).length,
  }))).toEqual({ hosts: 0, canvases: 0, shadows: 0 });
});

test('the screenshot of the overlay is a small PNG, written only with TOKK_WRITE_SCREENSHOT=1', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await open(page);
  await waitAll(page);
  const box = await page.locator(HOST).boundingBox();
  expect(box).not.toBeNull();
  const png = await page.screenshot({ clip: box as { x: number; y: number; width: number; height: number } });
  expect([...png.subarray(0, WEB_TEST_PNG_SIGNATURE.length)]).toEqual(WEB_TEST_PNG_SIGNATURE);
  expect(png.length).toBeLessThan(WEB_TEST_SCREENSHOT_MAX_BYTES);
  if (process.env.TOKK_WRITE_SCREENSHOT === '1') {
    await mkdir(dirname(WEB_TEST_SCREENSHOT_PATH), { recursive: true });
    await writeFile(WEB_TEST_SCREENSHOT_PATH, png);
  }
});
