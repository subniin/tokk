// Task 26, the slide deck case (cases/slides). Stage 1 has two tests, with no microphone and no Tokk code:
//   E0  the deck on the dev server at /cases/slides/index.html
//   E5  the same deck from a site build under /tokk/cases/slides/, served as the Task 21 tests serve the site
// The current slide is read from the DOM: reveal.js 6.0.2 puts the class `present` on the section that is shown.
import { chromium, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildSite } from '../../scripts/build-site';
import { makeFixtureApps, removeFixtureApps } from '../helpers/fixture-apps';
import { startSiteServer } from '../helpers/static-site-server';
import type { SiteServer } from '../helpers/static-site-server';
import { SLIDES_GAP_A_MS, SLIDES_GAP_B_MS, SLIDES_GAP_C_MS } from './slides-fixture';
import type { SlidesTimes } from './slides-fixture';
import { FIXTURE_SLIDES_TIMES_PATH, FIXTURE_SLIDES_WAV_PATH, REPO_ROOT, SLIDES_PAGE_URL, fakeMicArgs } from './paths';

// Test-only values.
const SITE_PREFIX = '/tokk/';
const SITE_BUILD_TIMEOUT_MS = 180_000;
const SLIDES_TEST_TIMEOUT_MS = 60_000;
const SLIDES_ELEMENT_TIMEOUT_MS = 15_000;
const CURRENT_SLIDE = '.reveal .slides > section.present';   // the marker recorded in design.md, "Measured values"
const FIRST_HEADING = 'Tokk';
const SLIDE_COUNT_MIN = 5;
const SLIDE_COUNT_MAX = 6;

const current = (page: Page) => page.locator(CURRENT_SLIDE);
const headingOfCurrent = (page: Page) => page.locator(`${CURRENT_SLIDE} h1, ${CURRENT_SLIDE} h2`).first();

// Collects everything that must not happen on the page (requirements 6.2 and 6.3).
function watch(page: Page, origin: string, prefix: string): { requests: string[]; problems: string[] } {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    requests.push(r.url());
    if (u.origin !== origin) problems.push(`request to another origin: ${r.url()}`);
    else if (prefix !== '' && !u.pathname.startsWith(prefix)) problems.push(`request outside ${prefix}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`status ${r.status()}: ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return { requests, problems };
}

// The body of E0 and E5. `pageUrl` is the full URL of the deck.
async function checkDeck(page: Page, pageUrl: string, prefix: string): Promise<string[]> {
  const seen = watch(page, new URL(pageUrl).origin, prefix);
  const response = await page.goto(pageUrl);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/\S/);
  expect(await page.title()).not.toMatch(/reveal/i);
  await expect(current(page)).toHaveCount(1, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
  await expect(headingOfCurrent(page)).toHaveText(FIRST_HEADING);
  const count = await page.locator('.reveal .slides > section').count();
  expect(count).toBeGreaterThanOrEqual(SLIDE_COUNT_MIN);
  expect(count).toBeLessThanOrEqual(SLIDE_COUNT_MAX);
  expect(await page.locator('html').getAttribute('lang')).toBe('en');

  // The arrow keys move the deck, and the deck does not leave the first slide backwards.
  await page.keyboard.press('ArrowLeft');
  await expect(headingOfCurrent(page)).toHaveText(FIRST_HEADING);
  await page.keyboard.press('ArrowRight');
  await expect(headingOfCurrent(page)).not.toHaveText(FIRST_HEADING);
  const second = await headingOfCurrent(page).innerText();
  await page.keyboard.press('ArrowRight');
  await expect(headingOfCurrent(page)).not.toHaveText(second);
  await page.keyboard.press('ArrowLeft');
  await expect(headingOfCurrent(page)).toHaveText(second);
  await page.keyboard.press('ArrowLeft');
  await expect(headingOfCurrent(page)).toHaveText(FIRST_HEADING);
  await expect(current(page)).toHaveCount(1);

  // No animation or transition is running after a slide change, with and without reduced motion (requirement 3.4).
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.keyboard.press('ArrowRight');
    await expect(headingOfCurrent(page)).not.toHaveText(FIRST_HEADING);
    expect(await page.evaluate(() => document.getAnimations().length), `running animations with reducedMotion ${reducedMotion}`).toBe(0);
    await page.keyboard.press('ArrowLeft');
    await expect(headingOfCurrent(page)).toHaveText(FIRST_HEADING);
  }

  expect(seen.requests.length).toBeGreaterThan(0);
  expect(seen.problems).toEqual([]);
  return seen.requests;
}

test('E0: the deck loads on the dev server, shows the first slide and the arrow keys move it', async ({ page, baseURL }) => {
  test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
  const requests = await checkDeck(page, new URL('/cases/slides/index.html', baseURL).href, '');
  expect(requests.some((u) => u.endsWith('/cases/slides/dist/app.js'))).toBe(true);
  expect(requests.some((u) => u.endsWith('/cases/slides/dist/app.css'))).toBe(true);
});

test.describe('E5: the deck from a site build under /tokk/', () => {
  let appsDir = '';
  let outDir = '';
  let server: SiteServer;

  test.beforeAll(async () => {
    test.setTimeout(SITE_BUILD_TIMEOUT_MS);
    appsDir = makeFixtureApps();
    outDir = mkdtempSync(join(tmpdir(), 'tokk-slides-e2e-'));
    const result = await buildSite({ outDir, appsDir, casesDir: join(REPO_ROOT, 'cases') });
    expect(result.warnings).toEqual([]);
    server = await startSiteServer(outDir, SITE_PREFIX);
  });

  test.afterAll(async () => {
    await server?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    if (appsDir) removeFixtureApps(appsDir);
  });

  test('E5: the deck works under /tokk/cases/slides/ and every request stays below /tokk/', async ({ page }) => {
    test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
    const requests = await checkDeck(page, `${server.url}${SITE_PREFIX}cases/slides/`, SITE_PREFIX);
    expect(requests.some((u) => u.endsWith('/tokk/cases/slides/dist/app.js'))).toBe(true);
    expect(requests.some((u) => u.endsWith('/tokk/cases/slides/dist/app.css'))).toBe(true);
  });

  test('E5: the landing page links the deck, and the site has the licence copy and nothing the rule forbids', async ({ page }) => {
    test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
    const landing = `${server.url}${SITE_PREFIX}`;
    await page.goto(landing);
    const link = page.locator('a[href="cases/slides/"]');
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(`${landing}cases/slides/`);
    await expect(current(page)).toHaveCount(1, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
    const licence = await page.request.get(`${landing}cases/slides/LICENSE-revealjs.txt`);
    expect(licence.status()).toBe(200);
    expect(await licence.text()).toMatch(/Hakim El Hattab/);
    for (const forbidden of ['sounds.json', 'src/main.ts', 'README.md', 'sounds/', 'recordings/']) {
      expect((await page.request.get(`${landing}cases/slides/${forbidden}`)).status(), forbidden).toBe(404);
    }
  });
});


// ---- Stage 2c: sound control (E1 to E4 and E6) ----
// E1 and E2 are one serial block that shares one Chrome and one stream (the WAV plays once from the moment the stream opens).
// The claps are synthetic stand-ins (test/web/slides-fixture.ts). They show the logic and the wiring of the case, not the
// recognition of a real clap. The test never calls `ears` and never opens a dialog itself: the page does. The current slide is
// read from the DOM marker, never from a global, and the page has no test hook.

// Test-only values.
const SERIAL_TEST_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 30_000;                 // a wait on a state of the page
const STREAM_SLACK_MS = 15_000;                 // added to a stream time for a wait
const EXAMPLES_SETTLE_MS = 1500;                // wait to show that the dialog counts no more than the ten claps
const SETTLE_AFTER_CLAP_MS = 2500;              // after a lone clap: its sequence has timed out and nothing has changed
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 720;
const NARROW_WIDTH_PX = 320;
const NARROW_HEIGHT_PX = 640;
const ZOOM_WIDTH_PX = 640;
const ZOOM_HEIGHT_PX = 360;
const SCREENSHOT_MAX_BYTES = 300_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const SCREENSHOT_PATH = resolve(REPO_ROOT, 'docs', 'images', 'slides.png');
const FOCUS_OUTLINE_MIN_PX = 2;
const STORAGE_KEY = 'tokk:slides';
const STILL_OBSERVE_MS = 1000;                  // nothing may change for this long (the keyboard on the start button)
const CAPTION = '#caption';
const START_BUTTON = '#start-sound';
const DIALOG = '[data-tokk-teach]';
const dialogAction = (name: string): string => `${DIALOG} [data-action="${name}"]`;
const OFF_TEXT = 'Sound control is off. Press Start sound control.';
const TEACHING_TEXT = 'Teach your clap in the dialog.';
const LISTENING_TEXT = 'Listening. Clap twice for the next slide, three times for the previous slide.';
const HEARD_NEXT_TEXT = 'Heard: clap clap. Next slide.';
const HEARD_PREVIOUS_TEXT = 'Heard: clap clap clap. Previous slide.';
const KEYBOARD_TEXT = 'The keyboard still works.';
const TIMES: SlidesTimes = JSON.parse(readFileSync(FIXTURE_SLIDES_TIMES_PATH, 'utf8')) as SlidesTimes;

interface Mark { atMs: number; value: string }
type TestWindow = Window & { __micStartMs?: number; __captions?: Mark[] };

// The index of the current slide, read from the DOM marker of design.md "Measured values".
const slideIndex = (page: Page): Promise<number> => page.evaluate(
  (sel) => [...document.querySelectorAll('.reveal .slides > section')].indexOf(document.querySelector(sel) as Element),
  CURRENT_SLIDE,
);
const captionText = (page: Page): Promise<string> => page.locator(CAPTION).innerText();

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

// E2: records every text that the caption shows, with the page time (the in-page recorder of design.md).
const CAPTION_RECORDER_SCRIPT = (): void => {
  const w = window as unknown as TestWindow;
  w.__captions = [];
  let last: string | null = null;
  const read = (): void => {
    const el = document.getElementById('caption');
    if (!el) return;
    const text = el.textContent ?? '';
    if (text !== last) { last = text; w.__captions?.push({ atMs: performance.now(), value: text }); }
  };
  new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
};

// A microphone that is refused: getUserMedia rejects the way Chrome does when the permission is denied.
const REFUSED_MIC_SCRIPT = (): void => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
};

async function untilStream(page: Page, streamMs: number, extraMs = 0): Promise<void> {
  await page.waitForFunction(
    (ms) => { const s = (window as unknown as TestWindow).__micStartMs; return s !== undefined && performance.now() >= s + ms; },
    streamMs + extraMs,
    { timeout: streamMs + STREAM_SLACK_MS + STEP_TIMEOUT_MS, polling: 50 },
  );
}
const streamNow = (page: Page): Promise<number> => page.evaluate(() => performance.now() - ((window as unknown as TestWindow).__micStartMs as number));
const marks = (page: Page): Promise<Mark[]> => page.evaluate(() => ((window as unknown as TestWindow).__captions ?? []).slice());

test.describe.serial('the deck with sound control and the generated stream', () => {
  test.setTimeout(SERIAL_TEST_TIMEOUT_MS);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let seen: ReturnType<typeof watch>;
  let micStartMs = 0;

  test.beforeAll(async ({ baseURL }) => {
    browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_SLIDES_WAV_PATH) });
    context = await browser.newContext({ baseURL, viewport: { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX } });
    await context.addInitScript(MIC_START_SCRIPT);
    await context.addInitScript(CAPTION_RECORDER_SCRIPT);
    page = await context.newPage();
    seen = watch(page, new URL(baseURL as string).origin, '');
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('E1: teach the claps, one clap stays, two claps go forward, three claps go back', async () => {
    await page.goto(SLIDES_PAGE_URL);
    await expect(current(page)).toHaveCount(1, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
    await expect(page.locator(CAPTION)).toHaveText(OFF_TEXT);
    expect(await slideIndex(page)).toBe(0);
    await page.getByRole('button', { name: 'Start sound control' }).click();

    // The teaching, through the dialog's own buttons.
    await expect(page.locator(CAPTION)).toHaveText(TEACHING_TEXT, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(`${DIALOG} h2`)).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.teach.startsMs.length, { timeout: STEP_TIMEOUT_MS + TIMES.teach.endMs });
    micStartMs = await page.evaluate(() => (window as unknown as TestWindow).__micStartMs as number);
    await page.waitForTimeout(EXAMPLES_SETTLE_MS);
    await expect(page.locator(`${DIALOG} li[data-example]`), 'the dialog must find exactly the ten claps of the file').toHaveCount(TIMES.teach.startsMs.length);
    const lastTeach = TIMES.teach.startsMs[TIMES.teach.startsMs.length - 1];
    await expect(page.locator(dialogAction('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
    console.log(`E1: last teaching clap to Done ready: ${((await streamNow(page)) - lastTeach).toFixed(0)} ms`);
    const doneAt = Date.now();
    await page.click(dialogAction('done'));
    await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
    console.log(`E1: Done to Save ready: ${Date.now() - doneAt} ms`);
    const saveAt = Date.now();
    await page.click(dialogAction('save'));
    await expect(page.locator(`${DIALOG} [data-role="saved"]`)).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    await page.click(dialogAction('close'));
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator(CAPTION)).toHaveText(LISTENING_TEXT, { timeout: STEP_TIMEOUT_MS });
    console.log(`E1: Save to the caption "Listening": ${Date.now() - saveAt} ms; the whole handling from Done: ${Date.now() - doneAt} ms (gap A is ${SLIDES_GAP_A_MS} ms)`);
    const lateBy = (await streamNow(page)) - TIMES.s0[0];
    console.log(`E1: stream time when "Listening" showed: ${(await streamNow(page)).toFixed(0)} ms, S0 at ${TIMES.s0[0]} ms`);
    expect(lateBy, 'the caption said "Listening" after the lone clap was played: gap A is too short').toBeLessThan(0);

    // The model is stored by the library under the key of the case, as feature vectors, and the case stores nothing else.
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).not.toBeNull();
    const entry = JSON.parse(stored as string) as { model: { examples: { id: string; label: string; v: number[] }[] } };
    expect([...new Set(entry.model.examples.map((e) => e.label))]).toEqual(['clap']);
    for (const e of entry.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect(await page.evaluate(() => localStorage.length)).toBe(1);

    // S0: one clap changes nothing.
    await untilStream(page, TIMES.s0[0], SETTLE_AFTER_CLAP_MS);
    expect(await slideIndex(page), 'one clap must not move the deck').toBe(0);
    await expect(page.locator(CAPTION)).toHaveText(LISTENING_TEXT);

    // S1: two claps go to slide 2, and the caption says so.
    await expect(page.locator(CAPTION)).toHaveText(HEARD_NEXT_TEXT, { timeout: TIMES.s1[1] + STREAM_SLACK_MS });
    const nextAt = await streamNow(page);
    console.log(`E1: second clap to the caption and the slide change: ${(nextAt - TIMES.s1[1]).toFixed(0)} ms (gap B is ${SLIDES_GAP_B_MS} ms)`);
    expect(await slideIndex(page)).toBe(1);
    expect(nextAt, 'the slide changed after the three claps were played: gap B is too short').toBeLessThan(TIMES.s2[0]);

    // The screenshot: slide 2 with the caption "Heard: clap clap. Next slide.", written only with TOKK_WRITE_SCREENSHOT=1.
    await expect(page.locator(CAPTION)).toBeVisible();
    const png = await page.screenshot();
    expect([...png.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    expect(png.length).toBeLessThan(SCREENSHOT_MAX_BYTES);
    console.log(`E1: screenshot ${png.length} bytes`);
    if (process.env.TOKK_WRITE_SCREENSHOT === '1') {
      mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
      writeFileSync(SCREENSHOT_PATH, png);
    }

    // S2: three claps go back to slide 1.
    await expect(page.locator(CAPTION)).toHaveText(HEARD_PREVIOUS_TEXT, { timeout: TIMES.s2[2] + STREAM_SLACK_MS });
    console.log(`E1: third clap to the caption and the slide change: ${((await streamNow(page)) - TIMES.s2[2]).toFixed(0)} ms (gap C is ${SLIDES_GAP_C_MS} ms)`);
    expect(await slideIndex(page)).toBe(0);
    await untilStream(page, TIMES.s2[2], SETTLE_AFTER_CLAP_MS);
    expect(await slideIndex(page), 'nothing may move the deck after the three claps').toBe(0);
    expect(seen.problems).toEqual([]);
  });

  test('E2: the caption never shows "clap clap" for three claps', async () => {
    const all = await marks(page);
    const texts = all.map((m) => m.value);
    expect(texts[0]).toBe(OFF_TEXT);
    expect(texts).toContain(LISTENING_TEXT);
    // The caption showed the two-clap text once, for S1.
    expect(texts.filter((t) => t === HEARD_NEXT_TEXT)).toHaveLength(1);
    // From the first clap of S2 on, the caption shows the three-clap text and never the two-clap text.
    const s2Start = micStartMs + TIMES.s2[0] - SYNC_BEFORE_MS;
    const during = all.filter((m) => m.atMs >= s2Start);
    expect(during.map((m) => m.value)).toEqual([HEARD_PREVIOUS_TEXT]);
    // The recorder itself catches a flash: the texts it saw are in order and each one appears.
    expect(texts.indexOf(HEARD_NEXT_TEXT)).toBeLessThan(texts.indexOf(HEARD_PREVIOUS_TEXT));
    expect(seen.problems).toEqual([]);
  });

  test('E3: the keyboard still works after the start and the teaching', async () => {
    expect(await slideIndex(page)).toBe(0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => slideIndex(page)).toBe(1);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => slideIndex(page)).toBe(0);
    expect(seen.problems).toEqual([]);
  });
});

const SYNC_BEFORE_MS = 200;                     // the recorder times of S2 start this long before its first clap

// E3 (second part): a refused microphone leaves the deck usable, says so in text, and Enter and Space on the start button
// do not also move a slide.
test.describe('E3: a refused microphone', () => {
  for (const key of ['Enter', 'Space'] as const) {
    test(`E3: ${key} on the focused start button starts once, moves no slide, and the keyboard still works after a refusal`, async ({ page, baseURL }) => {
      test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
      await page.addInitScript(REFUSED_MIC_SCRIPT);
      const seen = watch(page, new URL(baseURL as string).origin, '');
      await page.goto(SLIDES_PAGE_URL);
      await expect(current(page)).toHaveCount(1, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
      await expect(page.locator(CAPTION)).toHaveText(OFF_TEXT);
      // Without the start button the deck works as in stage 1.
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => slideIndex(page)).toBe(1);
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => slideIndex(page)).toBe(0);
      // The button is reached by Tab, has an accessible name and a visible focus outline.
      const button = page.getByRole('button', { name: 'Start sound control' });
      let reached = false;
      for (let i = 0; i < 20 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate((id) => document.activeElement?.id === id, START_BUTTON.slice(1));
      }
      expect(reached, 'Tab reaches the start button').toBe(true);
      await expect(button).toBeFocused();
      expect(await button.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(FOCUS_OUTLINE_MIN_PX);
      await page.keyboard.press(key);
      // The refusal is shown as text and the deck stays on its slide.
      await expect(page.locator(CAPTION)).toContainText(KEYBOARD_TEXT, { timeout: STEP_TIMEOUT_MS });
      expect(await captionText(page)).not.toBe(OFF_TEXT);
      await page.waitForTimeout(STILL_OBSERVE_MS);
      expect(await slideIndex(page), `${key} on the button must not move a slide`).toBe(0);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => slideIndex(page)).toBe(1);
      expect(seen.problems.filter((p) => !/NotAllowed|Permission denied|getUserMedia/i.test(p))).toEqual([]);
    });
  }
});

// E3 (layout): the caption and the start button stay inside the window and do not cover the reveal.js controls, at 1280 px,
// at 640 px (the width of 200 per cent zoom on 1280 px) and at 320 px (reveal.js shows its scroll view there and has no controls).
test('E3: the caption and the start button do not cover the controls, at 1280, 640 and 320 px', async ({ page, baseURL }) => {
  test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
  const seen = watch(page, new URL(baseURL as string).origin, '');
  const sizes: [number, number][] = [[WINDOW_WIDTH_PX, WINDOW_HEIGHT_PX], [ZOOM_WIDTH_PX, ZOOM_HEIGHT_PX], [NARROW_WIDTH_PX, NARROW_HEIGHT_PX]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto(SLIDES_PAGE_URL);
    await expect(page.locator(CAPTION)).toHaveText(OFF_TEXT, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
    const boxes = await page.evaluate(() => {
      const rect = (e: Element): number[] => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const own = ['#caption', '#start-sound'].map((s) => ({ name: s, box: rect(document.querySelector(s) as Element) }));
      const controls = [...document.querySelectorAll('.reveal .controls button, .reveal .slide-number, .reveal .progress')]
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; })
        .map((e) => ({ name: e.className.toString(), box: rect(e) }));
      return { own, controls, width: innerWidth, height: innerHeight };
    });
    for (const o of boxes.own) {
      expect(o.box[0], `${o.name} inside the window at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(o.box[2], `${o.name} inside the window at ${width} px`).toBeLessThanOrEqual(boxes.width);
      expect(o.box[1], `${o.name} inside the window at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(o.box[3], `${o.name} inside the window at ${width} px`).toBeLessThanOrEqual(boxes.height);
      for (const c of boxes.controls) {
        const apart = o.box[2] <= c.box[0] || c.box[2] <= o.box[0] || o.box[3] <= c.box[1] || c.box[3] <= o.box[1];
        expect(apart, `${o.name} overlaps ${c.name} at ${width} px`).toBe(true);
      }
    }
  }
  expect(seen.problems).toEqual([]);
});

// E4: no animation or transition runs on the page, with and without reduced motion, after a slide change and a caption change.
test('E4: no animation or transition runs, with and without reduced motion', async ({ page, baseURL }) => {
  test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
  await page.addInitScript(REFUSED_MIC_SCRIPT);
  const seen = watch(page, new URL(baseURL as string).origin, '');
  await page.goto(SLIDES_PAGE_URL);
  await expect(current(page)).toHaveCount(1, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
  const durations = (): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll('*')].flatMap((el) => {
    const s = getComputedStyle(el);
    const bad = [s.transitionDuration, s.animationDuration].some((d) => d.split(',').some((x) => parseFloat(x) !== 0));
    return bad ? [`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`] : [];
  }));
  let started = false;
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => slideIndex(page)).toBe(1);
    expect(await page.evaluate(() => document.getAnimations().length), `animations after a slide change, ${reducedMotion}`).toBe(0);
    expect(await durations(), `elements with a transition or animation duration, ${reducedMotion}`).toEqual([]);
    if (!started) {
      await page.click(START_BUTTON);
      started = true;
      await expect(page.locator(CAPTION)).toContainText(KEYBOARD_TEXT, { timeout: STEP_TIMEOUT_MS });
    }
    expect(await page.evaluate(() => document.getAnimations().length), `animations after a caption change, ${reducedMotion}`).toBe(0);
    expect(await durations(), `elements with a transition or animation duration after the caption change, ${reducedMotion}`).toEqual([]);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => slideIndex(page)).toBe(0);
  }
  expect(seen.problems.filter((p) => !/NotAllowed|Permission denied|getUserMedia/i.test(p))).toEqual([]);
});

// E6: the finished site build under /tokk/ starts, shows the dialog and makes no request outside /tokk/.
test.describe('E6: the finished deck from a site build under /tokk/', () => {
  let appsDir = '';
  let outDir = '';
  let server: SiteServer;

  test.beforeAll(async () => {
    test.setTimeout(SITE_BUILD_TIMEOUT_MS);
    appsDir = makeFixtureApps();
    outDir = mkdtempSync(join(tmpdir(), 'tokk-slides-e6-'));
    const result = await buildSite({ outDir, appsDir, casesDir: join(REPO_ROOT, 'cases') });
    expect(result.warnings).toEqual([]);
    server = await startSiteServer(outDir, SITE_PREFIX);
  });
  test.afterAll(async () => {
    await server?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    if (appsDir) removeFixtureApps(appsDir);
  });

  test('E6: the start button opens the teaching dialog, and every request stays below /tokk/', async ({ page }) => {
    test.setTimeout(SLIDES_TEST_TIMEOUT_MS);
    const seen = watch(page, new URL(server.url).origin, SITE_PREFIX);
    await page.goto(`${server.url}${SITE_PREFIX}cases/slides/`);
    await expect(current(page)).toHaveCount(1, { timeout: SLIDES_ELEMENT_TIMEOUT_MS });
    await expect(page.locator(CAPTION)).toHaveText(OFF_TEXT);
    await page.getByRole('button', { name: 'Start sound control' }).click();
    await expect(page.locator(`${DIALOG} h2`)).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(CAPTION)).toHaveText(TEACHING_TEXT);
    expect(seen.requests.every((u) => new URL(u).pathname.startsWith(SITE_PREFIX) || new URL(u).pathname === '/favicon.ico')).toBe(true);
    expect(seen.problems).toEqual([]);
  });
});
