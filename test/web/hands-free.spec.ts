// Task 22 (requirement 13): the Hands-Free app in Chrome with the fake microphone.
// E1 to E4 and E7 are one serial block that shares one Chrome and one stream (the WAV plays once from the moment the
// stream opens). They are declared in the order of the stream: S1 (E1), S2 (E3), S3 (E2), S4 to S7 (E4), then E7.
// E5 (keyboard only) and E6 (the landing link under /tokk/) use the default Chrome of the project.
// The sounds are synthetic stand-ins (test/web/hands-free-fixture.ts). They show the logic and the wiring of the app,
// not the recognition of a real mouth. The test never calls `ears` and never opens a dialog itself: the app does.
import { chromium, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildSite } from '../../scripts/build-site';
import { FAVICON_PATH, startSiteServer } from '../helpers/static-site-server';
import type { SiteServer } from '../helpers/static-site-server';
import { HANDS_FREE_GAP_A_MS, HANDS_FREE_GAP_B_MS, HANDS_FREE_GAP_C_MS } from './hands-free-fixture';
import type { HandsFreeTimes } from './hands-free-fixture';
import { FIXTURE_HANDS_FREE_TIMES_PATH, FIXTURE_HANDS_FREE_WAV_PATH, HANDS_FREE_PAGE_URL, REPO_ROOT, fakeMicArgs } from './paths';

// Test-only values.
const SYNC_TOLERANCE_MS = 100;                  // the offset of micStartMs from the stream start that E1 accepts (design.md)
const HUM_STOP_SETTLE_MS = 1500;                // after the end of a hum the scroll position must stop changing
const ARTICLE_SCROLL_MIN_PX = 600;              // an article is taller than the window by at least this much
const SCREENSHOT_MAX_BYTES = 300_000;
const SCREENSHOT_WIDTH_PX = 1000;
const SCREENSHOT_HEIGHT_PX = 760;
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 720;
const SERIAL_TEST_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 30_000;                 // a wait on a state of the page
const STREAM_SLACK_MS = 15_000;                 // added to a stream time for a wait
const SETTLE_MS = 1500;                         // wait to show that nothing more happens
const EXAMPLES_SETTLE_MS = 1500;
const TAB_LIMIT = 12;                           // a count: most Tab presses allowed to reach a control
const FOCUS_OUTLINE_MIN_PX = 2;
const SCAN_STEP_MIN_MS = 600;
const SCAN_PAUSE_BEFORE_CLICK_MS = 1500;        // design.md "The arrangement of S1"
const SCAN_RESUME_BEFORE_CLICK_MS = 425;
const SCAN_READ_BEFORE_CLICK_MS = 1000;
const SCAN_READ_AFTER_MOVE_MS = 300;
const ARRANGEMENT_LEAD_MS = 500;                // the arrangement must be set up at least this long before its first timer
const DONE_AFTER_PART_MS = 1000;                // Done is pressed this long after a teaching part ended
const SCROLL_FALLING_MIN_PX = 100;
const KEY_PRESSES_PAGE_DOWN = 3;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const SCREENSHOT_PATH = resolve(REPO_ROOT, 'docs', 'images', 'hands-free.png');
const SITE_PREFIX = '/tokk/';
const SITE_BUILD_TIMEOUT_MS = 180_000;
const STORAGE_KEY = 'tokk:hands-free';

const DIALOG = '[data-tokk-teach]';
const dialogAction = (name: string): string => `${DIALOG} [data-action="${name}"]`;
const TIMES: HandsFreeTimes = JSON.parse(readFileSync(FIXTURE_HANDS_FREE_TIMES_PATH, 'utf8')) as HandsFreeTimes;

type TestWindow = Window & { __micStartMs?: number; __arranged?: Record<string, unknown> };

// Records what must not happen: a request to another origin, a failed request, a console error, a page error.
function watch(page: Page, origin: string, prefix = ''): { requests: string[]; problems: string[]; check(): void } {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    requests.push(r.url());
    if (u.origin !== origin) problems.push(`request to another origin: ${r.url()}`);
    else if (prefix !== '' && !u.pathname.startsWith(prefix) && u.pathname !== FAVICON_PATH) problems.push(`request outside ${prefix}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return { requests, problems, check: () => expect(problems).toEqual([]) };
}

// Stores performance.now() when the first microphone stream opens. The fake microphone starts to play its file then.
const MIC_START_SCRIPT = (): void => {
  const md = navigator.mediaDevices;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original(constraints);
    const w = window as unknown as TestWindow;
    if (w.__micStartMs === undefined) w.__micStartMs = performance.now();
    return stream;
  };
};

// Waits until the stream has played for `streamMs` (a stream time of the fixture), on the clock of the page.
async function untilStream(page: Page, streamMs: number, extraMs = 0): Promise<void> {
  await page.waitForFunction(
    (ms) => { const s = (window as unknown as TestWindow).__micStartMs; return s !== undefined && performance.now() >= s + ms; },
    streamMs + extraMs,
    { timeout: streamMs + STREAM_SLACK_MS + STEP_TIMEOUT_MS, polling: 50 },
  );
}
const streamNowMs = (page: Page): Promise<number> => page.evaluate(() => performance.now() - ((window as unknown as TestWindow).__micStartMs ?? Number.NaN));

const scrollY = (page: Page): Promise<number> => page.evaluate(() => window.scrollY);
const highlighted = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('[data-scan="current"]')?.textContent?.trim() ?? null);

// One teaching step through the real dialog: the app opened it and the test presses the dialog's own buttons.
async function finishDialog(page: Page, title: string): Promise<void> {
  await expect(page.locator(`${DIALOG} h2`)).toHaveText(title, { timeout: STEP_TIMEOUT_MS });
}
async function doneAndSave(page: Page): Promise<void> {
  await expect(page.locator(dialogAction('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('done'));
  await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('save'));
}

test.describe.serial('Hands-Free with the generated stream', () => {
  test.setTimeout(SERIAL_TEST_TIMEOUT_MS);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let seen: ReturnType<typeof watch>;

  test.beforeAll(async ({ baseURL }) => {
    browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_HANDS_FREE_WAV_PATH) });
    context = await browser.newContext({ baseURL, viewport: { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX } });
    await context.addInitScript(MIC_START_SCRIPT);
    page = await context.newPage();
    seen = watch(page, new URL(baseURL as string).origin);
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('first run teaches click, hum and background, then a click opens the highlighted article link', async () => {
    await page.goto(HANDS_FREE_PAGE_URL);
    await expect(page.locator('#privacy')).toHaveText('Your audio never leaves this device. Nothing is recorded or uploaded.');
    await page.getByRole('button', { name: 'Start with the microphone' }).click();

    // Step 1: ten clicks.
    await finishDialog(page, 'Step 1 of 3: your click');
    await expect(page.locator('#progress')).toContainText('Teaching: step 1 of 3, click');
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.clickTeach.startsMs.length, { timeout: STEP_TIMEOUT_MS + TIMES.clickTeach.endMs });
    await page.waitForTimeout(EXAMPLES_SETTLE_MS);
    await expect(page.locator(`${DIALOG} li[data-example]`), 'the dialog must find exactly the ten clicks of the file').toHaveCount(TIMES.clickTeach.startsMs.length);
    const handlingA = Date.now();
    await doneAndSave(page);

    // Step 2: the app opens the next dialog by itself, with no press of Close.
    await finishDialog(page, 'Step 2 of 3: your hum');
    console.log(`E1: Done to the hum dialog ready: ${Date.now() - handlingA} ms (gap A is ${HANDS_FREE_GAP_A_MS} ms)`);
    await expect(page.locator('#progress')).toContainText('Teaching: step 2 of 3, hum');
    await untilStream(page, TIMES.humTeach.endMs, DONE_AFTER_PART_MS);
    const handlingB = Date.now();
    await doneAndSave(page);

    // Step 3.
    await finishDialog(page, 'Step 3 of 3: the room');
    console.log(`E1: Done to the background dialog ready: ${Date.now() - handlingB} ms (gap B is ${HANDS_FREE_GAP_B_MS} ms)`);
    await expect(page.locator('#progress')).toContainText('Teaching: step 3 of 3, background');
    await untilStream(page, TIMES.backgroundTeach.endMs, DONE_AFTER_PART_MS);
    const handlingC = Date.now();
    await doneAndSave(page);
    await expect(page.locator(`${DIALOG} [data-role="saved"]`)).toHaveText('Saved. Press Close to start using the page.');
    await page.click(dialogAction('close'));
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator('#state')).toContainText('Listening is ON');
    console.log(`E1: Done to Close and Listening is ON: ${Date.now() - handlingC} ms (gap C is ${HANDS_FREE_GAP_C_MS} ms)`);

    // The model is stored under the app's own key, as feature vectors only.
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).not.toBeNull();
    const entry = JSON.parse(stored as string) as { model: { examples: { id: string; label: string; v: number[] }[]; pitch?: { baselineHz: number } } };
    const labels = new Set(entry.model.examples.map((e) => e.label));
    expect([...labels]).toEqual(expect.arrayContaining(['click', 'background']));
    expect(entry.model.pitch?.baselineHz).toBeGreaterThan(0);
    for (const e of entry.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect(await page.evaluate(() => localStorage.length)).toBe(1);

    // The scan step to its minimum with the keyboard.
    await page.focus('#step');
    await page.keyboard.press('Home');
    await expect(page.locator('#step')).toHaveValue(String(SCAN_STEP_MIN_MS));

    // The arrangement of S1 (design.md): pause and resume at computed page times, from timers inside the page.
    const clickAtMs = TIMES.s1.atMs[0];
    const setup = await page.evaluate(({ clickAtMs: c, pauseBefore, resumeBefore, readBefore, readAfter, lead }) => {
      const w = window as unknown as TestWindow;
      const micStart = w.__micStartMs as number;
      const s = micStart + c;
      const now = performance.now();
      const result: Record<string, unknown> = { micStart, s, now, lateByMs: now - (s - pauseBefore - lead) };
      if (now > s - pauseBefore - lead) return result;
      const press = (): void => (document.querySelector('#pause') as HTMLButtonElement).click();
      const at = (t: number, f: () => void): void => { setTimeout(f, Math.max(0, t - performance.now())); };
      const targets = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('main a[href], main button:not([disabled])')];
      w.__arranged = result;
      at(s - pauseBefore, press);
      at(s - readBefore, () => {
        const list = targets();
        const x = document.querySelector('[data-scan="current"]') as HTMLElement | null;
        const i = x === null ? -1 : list.indexOf(x);
        result.x = x?.textContent?.trim() ?? null;
        result.y = i < 0 ? null : list[(i + 1) % list.length].textContent?.trim() ?? null;
      });
      at(s - resumeBefore, press);
      at(s + readAfter, () => { result.atMatch = document.querySelector('[data-scan="current"]')?.textContent?.trim() ?? null; });
      return result;
    }, { clickAtMs, pauseBefore: SCAN_PAUSE_BEFORE_CLICK_MS, resumeBefore: SCAN_RESUME_BEFORE_CLICK_MS, readBefore: SCAN_READ_BEFORE_CLICK_MS, readAfter: SCAN_READ_AFTER_MOVE_MS, lead: ARRANGEMENT_LEAD_MS });
    expect(setup.lateByMs, `the arrangement was set ${String(setup.lateByMs)} ms too late: gap C of the fixture is too short for the handling`).toBeLessThan(0);
    console.log(`E1: stream time at the arrangement ${(await streamNowMs(page)).toFixed(0)} ms, the click at ${clickAtMs} ms`);

    await expect(page.locator('#did')).toContainText('Did: opened', { timeout: clickAtMs + STREAM_SLACK_MS });
    const arranged = await page.evaluate(() => (window as unknown as TestWindow).__arranged as { x: string; y: string; atMatch: string; s: number });
    expect(arranged.x, 'X is the link highlighted when the sound was made').toBeTruthy();
    expect(arranged.y).toBeTruthy();
    expect(arranged.y).not.toBe(arranged.x);
    expect(arranged.atMatch, 'at the time the match arrives the highlight is on Y, not X').toBe(arranged.y);
    await expect(page.locator('#content h2')).toHaveText(arranged.x);
    await expect(page.locator('#did')).toHaveText(`Did: opened "${arranged.x}"`);
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/article\/[a-z0-9-]+$/);

    // The self-check: the page time of the lookup is within SYNC_TOLERANCE_MS of the page time of the sound.
    const lookup = Number(await page.getAttribute('#did', 'data-lookup-page-ms'));
    const offsetMs = lookup - arranged.s;
    console.log(`E1: lookup page time minus the arranged sound time: ${offsetMs.toFixed(1)} ms`);
    expect(Math.abs(offsetMs), `the lookup is ${offsetMs.toFixed(1)} ms from the arranged sound time ${arranged.s.toFixed(1)}: the clock sync of the arrangement (micStartMs), not the app, is out`).toBeLessThanOrEqual(SYNC_TOLERANCE_MS);
    seen.check();
  });

  test('a falling hum scrolls the page down and stops when the hum ends, and a steady hum scrolls nothing', async () => {
    // The scan would scroll the page by itself to its far link, so it is paused here.
    if ((await page.textContent('#pause'))?.includes('Pause')) await page.click('#pause');
    await page.evaluate(() => window.scrollTo(0, 0));
    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(room, 'an article must be taller than the window').toBeGreaterThanOrEqual(ARTICLE_SCROLL_MIN_PX);

    await untilStream(page, TIMES.s2Steady.startMs - SETTLE_MS);
    const before = await scrollY(page);
    await untilStream(page, TIMES.s2Steady.endMs, HUM_STOP_SETTLE_MS);
    expect(await scrollY(page), 'a steady hum inside the dead zone scrolls nothing').toBe(before);

    await untilStream(page, TIMES.s2Falling.startMs + SETTLE_MS);
    await expect.poll(() => scrollY(page), { timeout: STEP_TIMEOUT_MS }).toBeGreaterThan(before + SCROLL_FALLING_MIN_PX);
    await expect(page.locator('#heard')).toContainText('hum ↓');
    await untilStream(page, TIMES.s2Falling.endMs, HUM_STOP_SETTLE_MS);
    const stopped = await scrollY(page);
    expect(stopped).toBeGreaterThan(before + SCROLL_FALLING_MIN_PX);
    await page.waitForTimeout(SETTLE_MS);
    expect(await scrollY(page), 'the scroll stops after the hum ended').toBe(stopped);
    await expect(page.locator('#did')).toContainText('Did: scrolled down');
    seen.check();
  });

  test('"click click" goes back to the article list', async () => {
    const lastClick = TIMES.s3.atMs[TIMES.s3.atMs.length - 1];
    await untilStream(page, lastClick);
    await expect(page.locator('#did')).toHaveText('Did: went back to the list', { timeout: STEP_TIMEOUT_MS });
    expect(await page.evaluate(() => location.hash)).toBe('#/');
    await expect(page.locator('#content h2')).toHaveText('Reading list');
    seen.check();
  });

  test('"click click click" turns listening off, a click then does nothing, and "click click click" turns it on', async () => {
    // S4: the speech-like probe fires nothing while listening is on.
    const didBefore = await page.textContent('#did');
    await untilStream(page, TIMES.s4.endMs, HUM_STOP_SETTLE_MS * 2);
    expect(await page.textContent('#did'), 'the speech-like probe sound did something').toBe(didBefore);
    expect(await page.evaluate(() => location.hash)).toBe('#/');
    await expect(page.locator('#state')).toContainText('Listening is ON');

    // S5: three clicks turn listening off.
    await expect(page.locator('#state')).toContainText('Listening is OFF', { timeout: TIMES.s5.atMs[2] + STREAM_SLACK_MS });
    await expect(page.locator('#did')).toHaveText('Did: listening is now off');
    await expect(page.locator('#heard')).toHaveText('Heard: click click click ✓');
    expect(await page.locator('[data-scan="current"]').count(), 'the frame is hidden while listening is off').toBe(0);

    // S6: one click does nothing, and the text says it was ignored.
    await untilStream(page, TIMES.s6.atMs[0], HUM_STOP_SETTLE_MS * 2);
    expect(await page.evaluate(() => location.hash)).toBe('#/');
    await expect(page.locator('#heard')).toHaveText('Heard: click ✓ (ignored: listening is off)');
    await expect(page.locator('#state')).toContainText('Listening is OFF');

    // S7: three clicks turn it on again.
    await expect(page.locator('#state')).toContainText('Listening is ON', { timeout: TIMES.s7.atMs[2] + STREAM_SLACK_MS });
    await expect(page.locator('#did')).toHaveText('Did: listening is now on');
    await expect(page.locator('#heard')).toHaveText('Heard: click click click ✓');
    seen.check();
  });

  test('the screenshot of Hands-Free is a small PNG, written only with TOKK_WRITE_SCREENSHOT=1', async () => {
    await page.setViewportSize({ width: SCREENSHOT_WIDTH_PX, height: SCREENSHOT_HEIGHT_PX });
    await page.evaluate(() => window.scrollTo(0, 0));
    // The scan runs again after listening was turned on, unless the user paused it (E3 did): resume it for the picture.
    if ((await page.textContent('#pause'))?.includes('Resume')) await page.click('#pause');
    await expect(page.locator('[data-scan="current"]')).toHaveCount(1, { timeout: STEP_TIMEOUT_MS });
    const first = await highlighted(page);
    await expect.poll(() => highlighted(page), { timeout: STEP_TIMEOUT_MS }).not.toBe(first);   // one more move of the frame
    await expect(page.locator('#heard')).not.toBeEmpty();
    await expect(page.locator('#did')).not.toBeEmpty();
    await expect(page.locator('#privacy')).toBeVisible();
    await expect(page.locator('#state')).toContainText('Listening is ON');
    const png = await page.screenshot();
    expect([...png.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    expect(png.length).toBeLessThan(SCREENSHOT_MAX_BYTES);
    if (process.env.TOKK_WRITE_SCREENSHOT === '1') {
      mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
      writeFileSync(SCREENSHOT_PATH, png);
    }
    seen.check();
  });
});

test('keyboard alone can do every action', async ({ page, baseURL }) => {
  test.setTimeout(SERIAL_TEST_TIMEOUT_MS);
  const seen = watch(page, new URL(baseURL as string).origin);
  await page.setViewportSize({ width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX });
  await page.goto(HANDS_FREE_PAGE_URL);
  const focusedText = (): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
  const focusedId = (): Promise<string> => page.evaluate(() => document.activeElement?.id ?? '');
  const tabTo = async (matches: () => Promise<boolean>, key = 'Tab'): Promise<void> => {
    for (let i = 0; i < TAB_LIMIT; i++) {
      await page.keyboard.press(key);
      const outline = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement as Element).outlineWidth));
      expect(outline, 'a focused control shows an outline').toBeGreaterThanOrEqual(FOCUS_OUTLINE_MIN_PX);
      if (await matches()) return;
    }
    throw new Error('Tab did not reach the control');
  };

  await tabTo(async () => (await focusedText()) === 'Use the keyboard only');
  await page.keyboard.press('Enter');
  await expect(page.locator('#state')).toContainText('Microphone not in use (keyboard only)');
  await expect(page.locator('#privacy')).toBeVisible();
  await expect(page.locator('[data-scan="current"]')).toHaveCount(1);

  // P pauses: the frame stays where it is.
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toHaveText('Resume scan');
  const held = await highlighted(page);
  await page.waitForTimeout(SETTLE_MS * 2);
  expect(await highlighted(page)).toBe(held);

  // The slider, with Home.
  // The focus is on the heading of the view, so Shift+Tab reaches the controls above it.
  await tabTo(async () => (await focusedId()) === 'step', 'Shift+Tab');
  await page.keyboard.press('Home');
  await expect(page.locator('#step')).toHaveValue(String(SCAN_STEP_MIN_MS));
  await expect(page.locator('#step-value')).toHaveText('0.6 s');
  await page.keyboard.press('Tab');

  // P resumes: the frame moves.
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toHaveText('Pause scan');
  await expect.poll(() => highlighted(page), { timeout: STEP_TIMEOUT_MS }).not.toBe(held);
  await page.keyboard.press('p');
  const target = await highlighted(page);
  expect(target).toBeTruthy();

  // K opens the highlighted article.
  await page.keyboard.press('k');
  await expect(page.locator('#content h2')).toHaveText(target as string);
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/article\//);
  await expect(page.locator('#did')).toHaveText(`Did: opened "${target as string}" (key K)`);

  // A scroll key scrolls, and the article is taller than the window.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThanOrEqual(ARTICLE_SCROLL_MIN_PX);
  for (let i = 0; i < KEY_PRESSES_PAGE_DOWN; i++) await page.keyboard.press('PageDown');
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0);

  // B goes back, L says it needs the microphone.
  await page.keyboard.press('b');
  await expect(page.locator('#did')).toHaveText('Did: went back to the list (key B)');
  expect(await page.evaluate(() => location.hash)).toBe('#/');
  await expect(page.locator('#content h2')).toHaveText('Reading list');   // the view is rendered and the focus is on its heading
  await page.keyboard.press('l');
  await expect(page.locator('#did')).toContainText('listening needs the microphone');

  // The shortcuts button turns the letter keys off and on.
  await tabTo(async () => (await focusedId()) === 'shortcuts', 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#shortcuts')).toHaveText('Keyboard shortcuts: off');
  const didOff = await page.textContent('#did');
  await page.keyboard.press('k');
  await page.waitForTimeout(SETTLE_MS);
  expect(await page.textContent('#did')).toBe(didOff);
  expect(await page.evaluate(() => location.hash)).toBe('#/');
  expect(await focusedId(), 'the focus stays on the shortcuts button').toBe('shortcuts');
  await page.keyboard.press('Enter');
  await expect(page.locator('#shortcuts')).toHaveText('Keyboard shortcuts: on');

  // T starts the microphone and the teaching, Esc cancels it with the cancel text.
  await page.keyboard.press('t');
  await expect(page.locator(`${DIALOG} h2`)).toHaveText('Step 1 of 3: your click', { timeout: STEP_TIMEOUT_MS });
  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(page.locator('#notice')).toHaveText('Teaching was cancelled. Press Teach again to continue.');
  seen.check();
});

test.describe('under /tokk/', () => {
  let outDir = '';
  let server: SiteServer;

  test.beforeAll(async () => {
    test.setTimeout(SITE_BUILD_TIMEOUT_MS);
    outDir = mkdtempSync(join(tmpdir(), 'tokk-hands-free-site-'));
    await buildSite({ outDir });   // the real apps folder: the dead knock-once link prints the warning of Task 21 until Task 23
    server = await startSiteServer(outDir, SITE_PREFIX);
  });
  test.afterAll(async () => {
    await server?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  test('the landing page link opens Hands-Free under /tokk/', async ({ page }) => {
    test.setTimeout(SERIAL_TEST_TIMEOUT_MS);
    const seen = watch(page, new URL(server.url).origin, SITE_PREFIX);
    await page.goto(`${server.url}${SITE_PREFIX}`);
    await page.locator('a[href="apps/hands-free/"]').click();
    await expect(page).toHaveURL(`${server.url}${SITE_PREFIX}apps/hands-free/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hands-Free reader');
    await expect(page.locator('#privacy')).toHaveText('Your audio never leaves this device. Nothing is recorded or uploaded.');
    await page.getByRole('button', { name: 'Start with the microphone' }).click();
    await expect(page.locator(`${DIALOG} h2`)).toHaveText('Step 1 of 3: your click', { timeout: STEP_TIMEOUT_MS });
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    expect(seen.requests.length).toBeGreaterThan(0);
    expect(seen.requests.some((u) => u.endsWith('/apps/hands-free/dist/app.js'))).toBe(true);
    seen.check();
  });
});
