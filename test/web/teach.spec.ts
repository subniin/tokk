import { chromium, expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { SoundModel } from '../../core/types';
import { OVERLAY_COLOURS } from '../../web/overlay/theme';
import {
  WEB_TEST_PHASE_AFTER_COPIES, WEB_TEST_PHASE_BEFORE_COPIES, WEB_TEST_PITCH_BASELINE_HZ, WEB_TEST_TAP_COPIES, WEB_TEST_TEACH_COPIES, WEB_TEST_TEACH_FEW_COPIES,
} from './fixture';
import type { TeachFixtureInfo } from './fixture';
import { instrument, readInstrumentation } from './instrument';
import {
  FIXTURE_MODEL_PATH, FIXTURE_MODEL_URL, FIXTURE_PHASE_WAV_URL, FIXTURE_TAP_WAV_URL, FIXTURE_TEACH_BASE_MODEL_URL,
  FIXTURE_TEACH_FEW_WAV_PATH, FIXTURE_TEACH_INFO_PATH, FIXTURE_TEACH_PITCH_MODEL_URL, FIXTURE_TEACH_WAV_PATH, TEACH_PAGE_URL, fakeMicArgs,
} from './paths';

// Test-only values.
const WEB_TEST_WAIT_SLACK_MS = 20_000;          // added to the length of a fixture for a wait
const WEB_TEST_SETTLE_MS = 1500;                // wait to show that no extra example or call arrives
const WEB_TEST_TAB_LIMIT = 10;                  // a count: most Tab presses allowed to reach a button
const WEB_TEST_PAGE_H1_FONT_SIZE = '41px';
const WEB_TEST_PAGE_BODY_FONT_SIZE = '27px';
const WEB_TEST_PAGE_BODY_COLOUR = 'rgb(255, 0, 0)';
const WEB_TEST_TEACH_TIMEOUT_MS = 90_000;
const WEB_TEST_TRAINING_WAIT_MS = 30_000;
const WEB_TEST_BEFORE_EXAMPLES_MIN = 3;
const WEB_TEST_BASE_LABELS = ['low', 'mid'];
const WEB_TEST_FULL_LABELS = ['high', 'low', 'mid', 'ring'];

const HOST = '[data-tokk-teach]';
const EXAMPLES = `${HOST} li[data-example]`;
const action = (name: string): string => `${HOST} [data-action="${name}"]`;

interface Outcome { settled: boolean; ok: boolean | null; name: string | null; message: string | null; report: { labels: { label: string }[] } | null }
type TestWindow = Window & {
  tokkTest: {
    ready: boolean; calls: { pattern: string; t: number }[]; warnings: string[]; teach: Outcome;
    ears: { sounds: SoundModel; stop(): Promise<void>; pause(): void; resume(): void; exportSounds(): string; importSounds(json: string): void };
    start(o?: Record<string, string>): Promise<{ ok: boolean; message?: string }>;
    teachStart(label: string, options?: unknown): void;
    teachOutcome(label: string, options?: unknown): Promise<{ ok: boolean; name?: string; message?: string }>;
  };
};

// A test that needs its own fake microphone file gets its own Chrome (launch arguments belong to the browser).
// The browser is closed after the test, also when it fails.
const test = base.extend<{ micWav: string; micPage: Page }>({
  micWav: [FIXTURE_TEACH_WAV_PATH, { option: true }],
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
const uniqueKey = (): string => `tokk:test-${Date.now()}-${keyCounter++}`;

async function info(): Promise<TeachFixtureInfo> {
  return JSON.parse(await readFile(FIXTURE_TEACH_INFO_PATH, 'utf8')) as TeachFixtureInfo;
}

interface PageOptions { model?: string; storageKey?: string; source?: string; patterns?: string }

function pageUrl(o: PageOptions): string {
  const q = new URLSearchParams({ model: o.model ?? FIXTURE_TEACH_BASE_MODEL_URL });
  if (o.storageKey) q.set('storageKey', o.storageKey);
  if (o.source) q.set('source', o.source);
  if (o.patterns) q.set('patterns', o.patterns);
  return `${TEACH_PAGE_URL}?${q.toString()}`;
}

async function open(page: Page, o: PageOptions): Promise<void> {
  await page.goto(pageUrl(o));
  await page.click('#start');
  await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.ready);
}

const labelsOf = (page: Page): Promise<string[]> => page.evaluate(() => Object.keys((window as unknown as TestWindow).tokkTest.ears.sounds.thresholds).sort());
const storedItem = (page: Page, key: string): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), key);
const exported = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as TestWindow).tokkTest.ears.exportSounds());
const outcome = (page: Page): Promise<Outcome> => page.evaluate(() => (window as unknown as TestWindow).tokkTest.teach);

async function waitForOutcome(page: Page): Promise<Outcome> {
  await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.teach?.settled === true);
  return outcome(page);
}

async function openDialog(page: Page): Promise<void> {
  await page.click('#teach');
  await expect(page.locator(HOST)).toHaveCount(1);
}

// Teaches `tap` from the fake microphone: waits for all examples, Done, then Save.
async function teachTen(page: Page, copies: number): Promise<void> {
  const { teachDurationMs } = await info();
  await openDialog(page);
  await expect(page.locator(EXAMPLES)).toHaveCount(copies, { timeout: teachDurationMs + WEB_TEST_WAIT_SLACK_MS });
  await page.waitForTimeout(WEB_TEST_SETTLE_MS);
  await expect(page.locator(EXAMPLES), 'the dialog must find exactly the copies in the teaching file').toHaveCount(copies);
  await expect(page.locator(action('done'))).toHaveAttribute('aria-disabled', 'false');
  await page.click(action('done'));
  await expect(page.locator(action('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: WEB_TEST_TRAINING_WAIT_MS });
  await page.click(action('save'));
  expect((await waitForOutcome(page)).ok).toBe(true);
}

async function waitForCalls(page: Page, count: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction((n) => (window as unknown as TestWindow).tokkTest.calls.length >= n, count, { timeout: timeoutMs, polling: 100 });
}

const callCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as TestWindow).tokkTest.calls.length);

test.describe('with the fake microphone playing the teaching file', () => {
  test.use({ micWav: FIXTURE_TEACH_WAV_PATH });
  test.setTimeout(WEB_TEST_TEACH_TIMEOUT_MS);

  test('teach("tap") on the fake microphone adds the label, and a following run recognises it', async ({ micPage: page }) => {
    const key = uniqueKey();
    await open(page, { storageKey: key });
    expect(await labelsOf(page)).toEqual(WEB_TEST_BASE_LABELS);
    await teachTen(page, WEB_TEST_TEACH_COPIES);

    const done = await outcome(page);
    expect(done.report?.labels.map((l) => l.label)).toContain('tap');
    expect(await labelsOf(page)).toEqual([...WEB_TEST_BASE_LABELS, 'tap'].sort());
    const entry = JSON.parse((await storedItem(page, key)) as string) as { model: SoundModel };
    expect(Object.keys(entry.model.thresholds).sort()).toEqual([...WEB_TEST_BASE_LABELS, 'tap'].sort());
    await expect(page.locator(`${HOST} [data-role="saved"]`)).toHaveText('Saved.');
    await page.click(action('close'));
    await expect(page.locator(HOST)).toHaveCount(0);

    // A following run: the shipped model has no `tap`, so the handler works only if the stored model replaced it.
    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.ears.stop());
    await page.evaluate((u) => (window as unknown as TestWindow).tokkTest.start({ source: u, patterns: 'tap' }), FIXTURE_TAP_WAV_URL);
    const { tapDurationMs } = await info();
    await waitForCalls(page, WEB_TEST_TAP_COPIES, tapDurationMs + WEB_TEST_WAIT_SLACK_MS);
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    expect(await callCount(page)).toBe(WEB_TEST_TAP_COPIES);
  });

  // Task 22, requirement 16 (E8): sequential teaching.
  test('teach closes a finished dialog and starts the next, and still rejects while a dialog is recording', async ({ micPage: page }) => {
    await open(page, { storageKey: uniqueKey() });
    await teachTen(page, WEB_TEST_TEACH_COPIES);
    // The first dialog shows only its saved screen. The next teach closes it and opens its own dialog.
    await expect(page.locator(`${HOST} [data-role="saved"]`)).toHaveCount(1);
    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.teachStart('tap'));
    await expect(page.locator(HOST)).toHaveCount(1);
    await expect(page.locator(`${HOST} [data-role="saved"]`)).toHaveCount(0);
    await expect(page.locator(action('done'))).toHaveCount(1);
    expect((await outcome(page)).settled).toBe(false);

    // This dialog is recording: it keeps rejecting with the existing error and stays as it is.
    const call = (label: string) => page.evaluate((l) => (window as unknown as TestWindow).tokkTest.teachOutcome(l, { ui: true }), label);
    expect(await call('clap')).toMatchObject({ ok: false, name: 'Error', message: expect.stringContaining('already open') });
    await expect(page.locator(HOST)).toHaveCount(1);
    await expect(page.locator(action('done'))).toHaveCount(1);
    expect((await outcome(page)).settled).toBe(false);

    await page.click(action('cancel'));
    expect(await waitForOutcome(page)).toMatchObject({ ok: false, name: 'AbortError' });
    await expect(page.locator(HOST)).toHaveCount(0);
  });

  test('a reload with the same storageKey restores tap, another key and another shipped model do not', async ({ micPage: page }) => {
    const key = uniqueKey();
    await open(page, { storageKey: key });
    await teachTen(page, WEB_TEST_TEACH_COPIES);

    await page.goto(pageUrl({ storageKey: key, source: FIXTURE_TAP_WAV_URL }));
    await page.click('#start');
    await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.ready);
    expect(await labelsOf(page)).toEqual([...WEB_TEST_BASE_LABELS, 'tap'].sort());
    const exportedLabels = Object.keys((JSON.parse(await exported(page)) as SoundModel).thresholds).sort();
    expect(exportedLabels).toEqual([...WEB_TEST_BASE_LABELS, 'tap'].sort());

    await open(page, { storageKey: uniqueKey(), source: FIXTURE_TAP_WAV_URL });
    expect(await labelsOf(page)).toEqual(WEB_TEST_BASE_LABELS);

    // The developer ships another sounds.json: the old personal model is ignored with a warning.
    await page.goto(pageUrl({ storageKey: key, source: FIXTURE_TAP_WAV_URL, model: FIXTURE_MODEL_URL }));
    await page.click('#start');
    await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.ready);
    expect(await labelsOf(page)).toEqual(WEB_TEST_FULL_LABELS);
    const warnings = await page.evaluate(() => (window as unknown as TestWindow).tokkTest.warnings);
    expect(warnings.some((w) => w.includes(key) && w.includes('sounds.json'))).toBe(true);
  });
});

test.describe('with the fake microphone playing a file with too few sounds', () => {
  test.use({ micWav: FIXTURE_TEACH_FEW_WAV_PATH });
  test.setTimeout(WEB_TEST_TEACH_TIMEOUT_MS);

  test('Done is aria-disabled below 5 examples, with the reason shown, and does nothing', async ({ micPage: page }) => {
    await open(page, { storageKey: uniqueKey() });
    await openDialog(page);
    const { teachFewDurationMs } = await info();
    await expect(page.locator(EXAMPLES)).toHaveCount(WEB_TEST_TEACH_FEW_COPIES, { timeout: teachFewDurationMs + WEB_TEST_WAIT_SLACK_MS });
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    const done = page.locator(action('done'));
    await expect(done).toHaveAttribute('aria-disabled', 'true');
    expect(await done.getAttribute('disabled')).toBeNull();
    const reason = page.locator(`${HOST} [data-role="reason"]`);
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(`Keep at least 5 examples. You have ${WEB_TEST_TEACH_FEW_COPIES}.`);
    const describedBy = await done.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(await reason.getAttribute('id')).toBe(describedBy);
    await done.click({ force: true });   // Playwright treats aria-disabled as disabled and would wait
    await expect(page.locator(`${HOST} [data-role="step"]`)).not.toHaveText('Training...');
    await expect(page.locator(action('save'))).toHaveCount(0);
    await page.click(action('cancel'));
    expect((await waitForOutcome(page)).name).toBe('AbortError');
  });
});

test.describe('with a WAV file as the source', () => {
  test.setTimeout(WEB_TEST_TEACH_TIMEOUT_MS);

  test('Cancel rejects with AbortError, keeps the model and stores nothing', async ({ page }) => {
    const key = uniqueKey();
    await open(page, { storageKey: key, source: FIXTURE_TAP_WAV_URL });
    const before = await exported(page);
    await openDialog(page);
    await page.click(action('cancel'));
    const result = await waitForOutcome(page);
    expect(result.ok).toBe(false);
    expect(result.name).toBe('AbortError');
    expect(await exported(page)).toBe(before);
    expect(await storedItem(page, key)).toBeNull();
    await expect(page.locator(HOST)).toHaveCount(0);
  });

  test('stop() while the dialog is open rejects with AbortError and removes it', async ({ page }) => {
    const key = uniqueKey();
    await open(page, { storageKey: key, source: FIXTURE_TAP_WAV_URL });
    await openDialog(page);
    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.ears.stop());
    expect((await waitForOutcome(page)).name).toBe('AbortError');
    await expect(page.locator(HOST)).toHaveCount(0);
    expect(await storedItem(page, key)).toBeNull();
  });

  test('keyboard: focus is inside, Tab reaches Cancel, Esc cancels and focus returns', async ({ page }) => {
    await open(page, { storageKey: uniqueKey(), source: FIXTURE_TAP_WAV_URL });
    await page.focus('#teach');
    await page.keyboard.press('Enter');
    await expect(page.locator(HOST)).toHaveCount(1);
    const active = (): Promise<string | null> => page.evaluate(() => {
      const el = document.querySelector('[data-tokk-teach]')?.shadowRoot?.activeElement;
      return el ? (el.getAttribute('data-action') ?? el.tagName.toLowerCase()) : null;
    });
    expect(await active()).toBe('h2');
    const seen: (string | null)[] = [];
    for (let i = 0; i < WEB_TEST_TAB_LIMIT && seen[seen.length - 1] !== 'cancel'; i++) {
      await page.keyboard.press('Tab');
      seen.push(await active());
    }
    expect(seen).toContain('done');
    expect(seen[seen.length - 1]).toBe('cancel');
    await expect(page.locator(action('cancel'))).toHaveText('Cancel (Esc)');
    await page.keyboard.press('Escape');
    expect((await waitForOutcome(page)).name).toBe('AbortError');
    await expect(page.locator(HOST)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('teach');
  });

  test('no handler fires while the dialog is open, and handlers fire again after Cancel', async ({ page }) => {
    await open(page, { model: FIXTURE_MODEL_URL, storageKey: uniqueKey(), source: FIXTURE_PHASE_WAV_URL, patterns: 'high' });
    await openDialog(page);
    await expect(page.locator(EXAMPLES).nth(WEB_TEST_BEFORE_EXAMPLES_MIN - 1)).toBeVisible({ timeout: WEB_TEST_WAIT_SLACK_MS });
    expect(await callCount(page)).toBe(0);
    await page.click(action('cancel'));
    await waitForOutcome(page);
    await waitForCalls(page, WEB_TEST_PHASE_AFTER_COPIES, (await info()).phaseDurationMs + WEB_TEST_WAIT_SLACK_MS);
    await page.waitForTimeout(WEB_TEST_SETTLE_MS);
    expect(await callCount(page)).toBe(WEB_TEST_PHASE_AFTER_COPIES);
    expect(WEB_TEST_PHASE_BEFORE_COPIES).toBeGreaterThanOrEqual(WEB_TEST_BEFORE_EXAMPLES_MIN);
  });

  test('style isolation: a page h1 keeps its size and a page body rule does not reach the dialog', async ({ page }) => {
    await page.goto(pageUrl({ storageKey: uniqueKey(), source: FIXTURE_TAP_WAV_URL }));
    const h1 = (): Promise<string> => page.evaluate(() => getComputedStyle(document.getElementById('page-title') as HTMLElement).fontSize);
    expect(await h1()).toBe(WEB_TEST_PAGE_H1_FONT_SIZE);
    await page.click('#start');
    await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.ready);
    await openDialog(page);
    expect(await h1()).toBe(WEB_TEST_PAGE_H1_FONT_SIZE);
    const style = (selector: string, prop: 'fontSize' | 'color') => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p as 'fontSize'], prop);
    for (const selector of [`${HOST} h2`, `${HOST} [data-role="step"]`, action('cancel')]) {
      expect(await style(selector, 'fontSize'), selector).not.toBe(WEB_TEST_PAGE_BODY_FONT_SIZE);
      expect(await style(selector, 'color'), selector).not.toBe(WEB_TEST_PAGE_BODY_COLOUR);
    }
    const hex = OVERLAY_COLOURS.text.slice(1);
    const rgb = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ');
    expect(await style(`${HOST} h2`, 'color')).toBe(`rgb(${rgb})`);
    await page.click(action('cancel'));
  });

  test('reduced motion: no animation, no transition and no requestAnimationFrame call from the bundle', async ({ page }) => {
    await instrument(page, { countAnimationFrames: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { storageKey: uniqueKey(), source: FIXTURE_TAP_WAV_URL });
    await openDialog(page);
    await expect(page.locator(EXAMPLES).first()).toBeVisible({ timeout: WEB_TEST_WAIT_SLACK_MS });
    for (const selector of [`${HOST} dialog`, action('cancel'), `${HOST} progress`, `${HOST} li[data-example] canvas`]) {
      const s = await page.locator(selector).first().evaluate((el) => {
        const c = getComputedStyle(el);
        return { animationName: c.animationName, transitionDuration: c.transitionDuration };
      });
      expect(s.animationName, selector).toBe('none');
      expect(s.transitionDuration, selector).toBe('0s');
    }
    expect((await readInstrumentation(page)).animationFrames).toBe(0);
    await page.click(action('cancel'));
  });

  test('importSounds of invalid text throws and changes nothing; a valid text replaces, stores and survives a reload', async ({ page }) => {
    const key = uniqueKey();
    // Changed by Task 20 (requirement 4.6): a hum pattern without a baseline is inert, so a model without a pitch is imported.
    const options = { model: FIXTURE_TEACH_PITCH_MODEL_URL, storageKey: key, source: FIXTURE_TAP_WAV_URL, patterns: 'hum.rise' };
    await open(page, options);
    const before = await exported(page);
    const full = JSON.parse(await readFile(FIXTURE_MODEL_PATH, 'utf8')) as SoundModel;
    const fullWithPitch = JSON.stringify({ ...full, pitch: { baselineHz: WEB_TEST_PITCH_BASELINE_HZ } });
    const tryImport = (text: string): Promise<string> => page.evaluate((t) => {
      try { (window as unknown as TestWindow).tokkTest.ears.importSounds(t); return 'ok'; } catch (e) { return (e as Error).message; }
    }, text);
    for (const bad of ['not json', '{}', JSON.stringify({ ...full, version: 99 })]) {
      const message = await tryImport(bad);
      expect(message, bad.slice(0, 20)).not.toBe('ok');
      expect(message.length).toBeGreaterThan(0);
      expect(await exported(page)).toBe(before);
      expect(await storedItem(page, key)).toBeNull();
    }
    expect(await tryImport(JSON.stringify(full))).toBe('ok');   // no baseline: imported, stored, and hum.rise stays inert
    expect(JSON.parse(await exported(page))).toEqual(full);
    expect(await storedItem(page, key)).not.toBeNull();
    expect(await callCount(page)).toBe(0);
    expect(await tryImport(fullWithPitch)).toBe('ok');
    expect(await labelsOf(page)).toEqual(WEB_TEST_FULL_LABELS);
    expect(JSON.parse(await exported(page))).toEqual(JSON.parse(fullWithPitch));
    expect(await storedItem(page, key)).not.toBeNull();

    await page.goto(pageUrl(options));
    await page.click('#start');
    await page.waitForFunction(() => (window as unknown as TestWindow).tokkTest.ready);
    expect(await labelsOf(page)).toEqual(WEB_TEST_FULL_LABELS);
  });
  test('teach rejects bad arguments and bad states with a message that says what to do', async ({ page }) => {
    await open(page, { storageKey: uniqueKey(), source: FIXTURE_TAP_WAV_URL });
    const call = (label: string, options: unknown) => page.evaluate(([l, o]) => (window as unknown as TestWindow).tokkTest.teachOutcome(l as string, o), [label, options] as const);
    expect(await call('Tap!', { ui: true })).toMatchObject({ ok: false, name: 'RangeError', message: expect.stringContaining('^[a-z][a-z0-9-]{0,31}$') });
    expect(await call('tap', { ui: true, examples: 4 })).toMatchObject({ ok: false, name: 'RangeError', message: expect.stringContaining('5') });
    expect(await call('tap', {})).toMatchObject({ ok: false, name: 'Error', message: expect.stringContaining('{ ui: true }') });
    await expect(page.locator(HOST)).toHaveCount(0);

    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.ears.pause());
    expect(await call('tap', { ui: true })).toMatchObject({ ok: false, name: 'Error', message: expect.stringContaining('resume') });
    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.ears.resume());

    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.teachStart('tap'));
    await expect(page.locator(HOST)).toHaveCount(1);
    expect(await call('clap', { ui: true })).toMatchObject({ ok: false, name: 'Error', message: expect.stringContaining('already open') });
    await page.click(action('cancel'));
    await waitForOutcome(page);

    await page.evaluate(() => (window as unknown as TestWindow).tokkTest.ears.stop());
    expect(await call('tap', { ui: true })).toMatchObject({ ok: false, name: 'Error', message: expect.stringContaining('stopped') });
  });
});
