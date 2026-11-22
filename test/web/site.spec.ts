// Task 21 (requirement 12, tests E1 to E5): the built site served under /tokk/ by a small static server.
// The server answers 404 outside /tokk/, so a root-absolute URL in the site fails these tests.
import { chromium, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildSite } from '../../scripts/build-site';
import { FIXTURE_APP_NAMES, FIXTURE_PROOF_TEXT, makeFixtureApps, removeFixtureApps } from '../helpers/fixture-apps';
import { FIXTURE_SITE_FIRST_WAV_PATH, FIXTURE_SITE_PLAY_WAV_PATH, FIXTURE_SITE_STORED_PATH, FIXTURE_SITE_TIMES_PATH, REPO_ROOT, fakeMicArgs } from './paths';
import { SITE_ROOM_NOISE_AT_MS, SITE_ROOM_NOISE_MS } from './site-fixture';
import type { SiteTimes } from './site-fixture';
import { FAVICON_PATH, startSiteServer } from '../helpers/static-site-server';
import type { SiteServer } from '../helpers/static-site-server';
import { checkHelloPage, HELLO_TEST_TIMEOUT_MS } from './hello-check';

// Test-only values.
const SITE_PREFIX = '/tokk/';
const SITE_BUILD_TIMEOUT_MS = 180_000;
const SITE_TEST_TIMEOUT_MS = 60_000;
const SITE_ELEMENT_TIMEOUT_MS = 15_000;
// Task 35: the new landing page. The build below uses the fixture apps click-talk and shoo and the real cases/ folder (slides).
const GITHUB = 'https://github.com/subniin/tokk';
const LANDING_HREFS = ['#top', '#demo', '#apps', '#build', '#how', GITHUB, GITHUB, '#apps', 'apps/click-talk/', 'apps/shoo/', 'cases/slides/', `${GITHUB}/blob/main/docs/kiro.md`, GITHUB, 'teach.html'];
const VIEWPORT_WIDTHS_PX = [320, 1280];
// The demo box is also measured at widths where the layout changes (one column, two columns).
const DEMO_WIDTHS_PX = [320, 480, 600, 901, 1000, 1280];
const VIEWPORT_HEIGHT_PX = 900;
// The demo box states (test hook), and the stage element that each one shows.
const DEMO_STATES_SHOWN: [string, string][] = [['idle', '.s-idle'], ['teach', '.s-teach'], ['room', '.s-room'], ['live', '.s-live'], ['rec', '.s-live'], ['fail', '.s-fail']];
const ALL_STATE_CLASSES = ['.s-idle', '.s-teach', '.s-room', '.s-live', '.s-fail'];

let appsDir = '';
let outDir = '';
let server: SiteServer;

test.beforeAll(async () => {
  test.setTimeout(SITE_BUILD_TIMEOUT_MS);
  appsDir = makeFixtureApps();
  outDir = mkdtempSync(join(tmpdir(), 'tokk-site-e2e-'));
  await buildSite({ outDir, appsDir, casesDir: join(REPO_ROOT, 'cases') });
  server = await startSiteServer(outDir, SITE_PREFIX);
});

test.afterAll(async () => {
  await server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  if (appsDir) removeFixtureApps(appsDir);
});

// Records the requests of a page and the things that must not happen (requirement 12.3).
function watch(page: Page): { requests: string[]; problems: string[]; check(): void } {
  const origin = new URL(server.url).origin;
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    requests.push(r.url());
    if (r.method() !== 'GET' || r.postData() !== null) problems.push(`a request with a body or a method other than GET: ${r.method()} ${r.url()}`);
    if (u.origin !== origin) problems.push(`request to another origin: ${r.url()}`);
    else if (!u.pathname.startsWith(SITE_PREFIX)) problems.push(`request outside ${SITE_PREFIX}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`status ${r.status()}: ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return { requests, problems, check: () => expect(problems, `server saw: ${server.requests.join(', ')}`).toEqual([]) };
}

test('site: the landing page opens at /tokk/, has every section, and each of its links opens a page', async ({ page }) => {
  test.setTimeout(SITE_TEST_TIMEOUT_MS);
  const seen = watch(page);
  const landing = `${server.url}${SITE_PREFIX}`;
  const response = await page.goto(landing);
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText('Teach a web page a new sound.', { timeout: SITE_ELEMENT_TIMEOUT_MS });
  for (const id of ['demo', 'apps', 'build', 'how', 'kiro']) await expect(page.locator(`#${id}`), id).toBeVisible();
  for (const name of ['Two apps, one template.', 'Build your own in four steps.', 'How it works', 'Built with Kiro.']) {
    await expect(page.getByRole('heading', { level: 2, name }), name).toBeVisible();
  }
  await expect(page.locator('.privacy')).toContainText('Audio stays on the device.');
  await expect(page.locator('footer')).toContainText('MIT licence');
  await expect(page.locator('article.app')).toHaveCount(2);
  await expect(page.locator('pre')).toHaveCount(2);
  const hrefs = await page.locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).toEqual(LANDING_HREFS);
  for (const href of new Set(hrefs.filter((h): h is string => h !== null && !h.startsWith('#') && !h.startsWith('https://')))) {
    const r = await page.goto(new URL(href, landing).href);
    expect(r?.status(), href).toBe(200);
  }
  expect(seen.requests.some((u) => u.endsWith(`${SITE_PREFIX}dist/landing.js`))).toBe(true);
  expect(seen.requests.some((u) => u.endsWith(`${SITE_PREFIX}dist/landing.css`))).toBe(true);
  seen.check();
});

for (const width of VIEWPORT_WIDTHS_PX) {
  test(`site: the landing page has no horizontal scroll at ${width} px, in the light and the dark theme`, async ({ page }) => {
    test.setTimeout(SITE_TEST_TIMEOUT_MS);
    const seen = watch(page);
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT_PX });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${server.url}${SITE_PREFIX}`);
      await expect(page.locator('h1')).toBeVisible({ timeout: SITE_ELEMENT_TIMEOUT_MS });
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(widths.scroll, `${scheme} ${width}`).toBeLessThanOrEqual(widths.client);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).toBe(scheme === 'light' ? 'rgb(246, 246, 243)' : 'rgb(17, 19, 21)');
    }
    seen.check();
  });
}

for (const width of DEMO_WIDTHS_PX) {
  test(`site: the demo box keeps its height and the title keeps its place in all six states at ${width} px`, async ({ page }) => {
    test.setTimeout(SITE_TEST_TIMEOUT_MS);
    const seen = watch(page);
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT_PX });
    await page.goto(`${server.url}${SITE_PREFIX}?test`);
    await expect(page.locator('#demo[data-st="idle"]')).toBeVisible({ timeout: SITE_ELEMENT_TIMEOUT_MS });
    const measures: { state: string; box: number; title: number; width: number }[] = [];
    for (const [state, shown] of DEMO_STATES_SHOWN) {
      await page.evaluate((s) => window.dispatchEvent(new CustomEvent('tokk-demo-state', { detail: s })), state);
      await expect(page.locator('#demo')).toHaveAttribute('data-st', state);
      await expect(page.locator(shown), `${state} shows ${shown}`).toBeVisible();
      for (const other of ALL_STATE_CLASSES.filter((c) => c !== shown && !(state === 'rec' && c === '.s-live'))) await expect(page.locator(other), `${state} hides ${other}`).toBeHidden();
      await expect(page.locator('.rec-note')).toBeVisible({ visible: state === 'rec' });
      const box = await page.locator('#demo').boundingBox();
      // The position in the document, so a scroll caused by a click does not count.
      const title = await page.evaluate(() => (document.querySelector('h1') as Element).getBoundingClientRect().top + window.scrollY);
      measures.push({ state, box: box?.height ?? -1, title, width: box?.width ?? -1 });
    }
    expect(measures).toHaveLength(6);
    expect(new Set(measures.map((m) => m.box)), JSON.stringify(measures)).toHaveProperty('size', 1);
    expect(new Set(measures.map((m) => m.title)), JSON.stringify(measures)).toHaveProperty('size', 1);
    expect(new Set(measures.map((m) => m.width))).toHaveProperty('size', 1);
    expect(measures[0].box).toBeGreaterThan(0);
    seen.check();
  });
}

test('site: without ?test the state event is ignored, and with reduced motion nothing moves', async ({ page }) => {
  test.setTimeout(SITE_TEST_TIMEOUT_MS);
  const seen = watch(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${server.url}${SITE_PREFIX}`);
  await expect(page.locator('#demo[data-st="idle"]')).toBeVisible({ timeout: SITE_ELEMENT_TIMEOUT_MS });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('tokk-demo-state', { detail: 'live' })));
  await expect(page.locator('#demo')).toHaveAttribute('data-st', 'idle');
  const names = await page.evaluate(() => [...document.querySelectorAll('.wave i, .flow .lane i')].map((e) => getComputedStyle(e).animationName));
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(['none']));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const moving = await page.evaluate(() => getComputedStyle(document.querySelector('.wave i') as Element).animationName);
  expect(moving).toBe('amp');
  seen.check();
});

test('site: the hello example works under /tokk/ with the fake microphone', async ({ page }) => {
  test.setTimeout(HELLO_TEST_TIMEOUT_MS);
  const seen = watch(page);
  const before = server.requests.length;
  await checkHelloPage(page, server.url, `${SITE_PREFIX}examples/hello/`);
  expect(server.requests.slice(before).filter((p) => !p.startsWith(SITE_PREFIX) && p !== FAVICON_PATH)).toEqual([]);
  expect(server.requests.slice(before)).toContain(`${SITE_PREFIX}dist/tokk.js`);
  expect(server.requests.slice(before)).toContain(`${SITE_PREFIX}examples/hello/sounds.json`);
  seen.check();
});

test('site: each fixture app page shows its proof text under /tokk/apps/<name>/', async ({ page }) => {
  test.setTimeout(SITE_TEST_TIMEOUT_MS);
  const seen = watch(page);
  for (const name of FIXTURE_APP_NAMES) {
    const r = await page.goto(`${server.url}${SITE_PREFIX}apps/${name}/`);
    expect(r?.status(), name).toBe(200);
    await expect(page.locator('#out')).toHaveText(FIXTURE_PROOF_TEXT, { timeout: SITE_ELEMENT_TIMEOUT_MS });
  }
  expect(seen.requests.some((u) => u.endsWith('/dist/app.js'))).toBe(true);
  seen.check();
});

test('site: teach.html opens under /tokk/ and loads dist/teach-page.js', async ({ page }) => {
  test.setTimeout(SITE_TEST_TIMEOUT_MS);
  const seen = watch(page);
  const script = page.waitForResponse((r) => r.url() === `${server.url}${SITE_PREFIX}dist/teach-page.js`);
  const r = await page.goto(`${server.url}${SITE_PREFIX}teach.html`);
  expect(r?.status()).toBe(200);
  expect((await script).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Teach a sound', level: 1 })).toBeVisible({ timeout: SITE_ELEMENT_TIMEOUT_MS });
  seen.check();
});

test('site: the built folder holds no .wav file except media/clap-demo.wav, and no sounds folder', () => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const rel = relative(outDir, full);
      if (e.name.toLowerCase().endsWith('.wav') || (e.isDirectory() && e.name === 'sounds')) found.push(rel);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(outDir);
  expect(found).toEqual([join('media', 'clap-demo.wav')]);
});

// ---- Task 35 run B: the live demo box ----
// The fake microphone plays a WAV once from the moment its stream opens (test/web/site-fixture.ts). Each group has its own
// browser, and each test its own context, so each stream starts at 0. The claps are synthetic stand-ins.
const TIMES: SiteTimes = JSON.parse(readFileSync(FIXTURE_SITE_TIMES_PATH, 'utf8')) as SiteTimes;
const STORED = readFileSync(FIXTURE_SITE_STORED_PATH, 'utf8');
const STORAGE_KEY = 'tokk:site-demo';
const FIRST_RUN_TIMEOUT_MS = 180_000;
const MIC_TEST_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;
const STREAM_SLACK_MS = 15_000;
const ROOM_NOISE_SETTLE_MS = 1500;                 // after the room sound of the stream, before the dialog may be saved
const RESULT_WAIT_MS = 8000;                       // a pattern waits for a possible third clap, then the Worker answers
const RECORDING_END_MS = 10800;                    // clap-demo.wav is 10.8 s long
const RECORDING_TIMEOUT_MS = RECORDING_END_MS + 8000;
const LAYOUT_TOLERANCE_PX = 0.1;
const SYNC_AFTER_MAX_S = 1.0;                      // the text is on the page within this time after its time in the recording
const BLOCKED_TEXT = 'The microphone is blocked. Allow it in the address bar, or hear a recording instead.';
// Times of the matches in clap-demo.wav (the last clap of each pattern), as the Node test checks them.
const RECORDING_MATCHES: [string, number][] = [['clap clap', 2.65], ['clap clap clap', 5.7], ['clap clap', 8.45]];
const DIALOG = '[data-tokk-teach]';
const dialogAction = (name: string): string => `${DIALOG} [data-action="${name}"]`;
const landingUrl = (): string => `${server.url}${SITE_PREFIX}`;

interface MicWindow { __micStartMs?: number; __gum?: number; __tracks?: MediaStreamTrack[] }
const MIC_SCRIPT = (): void => {
  const md = navigator.mediaDevices;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original(constraints);
    const w = window as unknown as MicWindow;
    if (w.__micStartMs === undefined) w.__micStartMs = performance.now();
    w.__gum = (w.__gum ?? 0) + 1;
    w.__tracks = [...(w.__tracks ?? []), ...stream.getAudioTracks()];
    return stream;
  };
};
const DENY_SCRIPT = (): void => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
};
const storeModel = ([key, text]: [string, string]): void => { localStorage.setItem(key, text); };

async function untilStream(page: Page, streamMs: number): Promise<void> {
  await page.waitForFunction(
    (ms) => { const s = (window as unknown as MicWindow).__micStartMs; return s !== undefined && performance.now() >= s + ms; },
    streamMs,
    { timeout: streamMs + STREAM_SLACK_MS + STEP_TIMEOUT_MS, polling: 50 },
  );
}

interface Layout { state: string; box: number; width: number; title: number }
const demo = (page: Page) => page.locator('#demo');
const big = (page: Page) => page.locator('#demo-big');
async function layoutOf(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const d = document.getElementById('demo') as HTMLElement;
    const r = d.getBoundingClientRect();
    return { state: d.dataset.st ?? '', box: r.height, width: r.width, title: (document.querySelector('h1') as Element).getBoundingClientRect().top + window.scrollY };
  });
}
function expectSameLayout(layouts: Layout[]): void {
  // The layout engine rounds to 1/64 px, so a box may differ by that much between two states.
  for (const key of ['box', 'width', 'title'] as const) {
    const values = layouts.map((l) => l[key]);
    expect(Math.max(...values) - Math.min(...values), `${key} of ${JSON.stringify(layouts)}`).toBeLessThan(LAYOUT_TOLERANCE_PX);
  }
}
async function newVisitor(browser: Browser, options: { stored?: boolean; deny?: boolean; reducedMotion?: 'reduce'; width?: number } = {}): Promise<{ context: BrowserContext; page: Page; seen: ReturnType<typeof watch> }> {
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: VIEWPORT_HEIGHT_PX }, ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}) });
  await context.addInitScript(MIC_SCRIPT);
  if (options.deny) await context.addInitScript(DENY_SCRIPT);
  if (options.stored) await context.addInitScript(storeModel, [STORAGE_KEY, STORED] as [string, string]);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(landingUrl());
  await expect(demo(page)).toHaveAttribute('data-st', 'idle', { timeout: SITE_ELEMENT_TIMEOUT_MS });
  return { context, page, seen };
}

// After the recording starts: each match shows at its time in the recording, in order, synced to audio.currentTime.
async function expectRecordingInSync(page: Page): Promise<void> {
  await expect(demo(page)).toHaveAttribute('data-st', 'rec', { timeout: STEP_TIMEOUT_MS });
  await expect(page.locator('.rec-note')).toBeVisible();
  for (const [text, atS] of RECORDING_MATCHES) {
    await expect(big(page)).toHaveText(text, { timeout: RECORDING_TIMEOUT_MS });
    const nowS = await page.evaluate(() => (document.getElementById('demo-audio') as HTMLAudioElement).currentTime);
    expect(nowS, `${text} appears after its time ${atS} s in the recording`).toBeGreaterThanOrEqual(atS);
    expect(nowS, `${text} appears within ${SYNC_AFTER_MAX_S} s of its time`).toBeLessThan(atS + SYNC_AFTER_MAX_S);
  }
  await expect(page.locator('#demo-events span.m').last()).toHaveText('clap clap');
}

// ---- The first visit: teach 5 claps, 10 s of the room through the real flow, then clap clap ----
test.describe.serial('demo box: first visit with the fake microphone', () => {
  test.setTimeout(FIRST_RUN_TIMEOUT_MS);
  let browser: Browser;
  test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_SITE_FIRST_WAV_PATH) }); });
  test.afterAll(async () => { await browser?.close(); });

  test('teaches clap 5 times, listens to the room for 10 s, then shows clap clap', async () => {
    const { context, page, seen } = await newVisitor(browser);
    const layouts: Layout[] = [await layoutOf(page)];
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();

    // 1. The clap: the box shows the teach state behind the library's dialog.
    await expect(demo(page)).toHaveAttribute('data-st', 'teach', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('.s-teach .big')).toHaveText('Clap 5 times');
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.first.teachStartsMs.length, { timeout: STEP_TIMEOUT_MS + TIMES.first.teachEndMs });
    layouts.push(await layoutOf(page));
    await expect(page.locator(dialogAction('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
    await page.click(dialogAction('done'));
    await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
    await page.click(dialogAction('save'));

    // 2. The room: 10 s of recording, the box shows the room state. The dialog finishes by itself.
    await expect(demo(page)).toHaveAttribute('data-st', 'room', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('.s-room p').first()).toHaveText('Now 10 seconds of the room. Talk or type as usual.');
    await expect(page.locator(`${DIALOG} h2`)).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    layouts.push(await layoutOf(page));
    await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS + TIMES.first.teachEndMs + 25_000 });
    await untilStream(page, SITE_ROOM_NOISE_AT_MS + SITE_ROOM_NOISE_MS + ROOM_NOISE_SETTLE_MS);
    await page.click(dialogAction('save'));
    await page.click(dialogAction('close'));
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // 3. Live: the model is stored as feature vectors under the key of the box, and nothing else is stored.
    await expect(demo(page)).toHaveAttribute('data-st', 'live', { timeout: STEP_TIMEOUT_MS });
    layouts.push(await layoutOf(page));
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    const entry = JSON.parse(stored as string) as { model: { examples: { id: string; label: string; v: number[] }[] } };
    expect([...new Set(entry.model.examples.map((e) => e.label))].sort()).toEqual(['background', 'clap']);
    for (const e of entry.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect(await page.evaluate(() => localStorage.length)).toBe(1);

    // 4. Two claps of the stream: the big text, the accent ring and the Heard list.
    await untilStream(page, TIMES.first.clapsMs[1] + RESULT_WAIT_MS);
    await expect(big(page)).toHaveText('clap clap', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#demo-events span.m')).toHaveText('clap clap');
    await expect(page.locator('#demo-events span').first()).toContainText(/^clap \d+\.\d\d s$/);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('demo') as HTMLElement).boxShadow)).toContain('4px');
    layouts.push(await layoutOf(page));
    expectSameLayout(layouts);
    seen.check();
    await context.close();
  });
});

// ---- A returning visitor, the lost microphone, and "Hear a recording" while the microphone is on ----
test.describe('demo box: returning visitor with the stored model', () => {
  test.setTimeout(MIC_TEST_TIMEOUT_MS);
  let browser: Browser;
  test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_SITE_PLAY_WAV_PATH) }); });
  test.afterAll(async () => { await browser?.close(); });

  test('goes straight to live and shows clap clap, then clap clap clap', async () => {
    const { context, page, seen } = await newVisitor(browser, { stored: true });
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await expect(demo(page)).toHaveAttribute('data-st', 'live', { timeout: STEP_TIMEOUT_MS });
    expect(await page.locator(DIALOG).count()).toBe(0);
    await expect(big(page)).toHaveText('clap clap', { timeout: STEP_TIMEOUT_MS });
    await expect(big(page)).toHaveText('clap clap clap', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#demo-events span.m').last()).toHaveText('clap clap clap');
    expect(await page.locator(DIALOG).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as MicWindow).__gum)).toBe(1);
    seen.check();
    await context.close();
  });

  test('a microphone track that ends gives the failure state, and Hear a recording is highlighted', async () => {
    const { context, page, seen } = await newVisitor(browser, { stored: true });
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await expect(demo(page)).toHaveAttribute('data-st', 'live', { timeout: STEP_TIMEOUT_MS });
    await page.evaluate(() => { for (const t of (window as unknown as MicWindow).__tracks ?? []) { t.stop(); t.dispatchEvent(new Event('ended')); } });
    await expect(demo(page)).toHaveAttribute('data-st', 'fail', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('.s-fail .fail')).toHaveText(BLOCKED_TEXT);
    await expect(page.locator('#demo-fail-recording')).toHaveClass(/primary/);
    seen.check();
    await context.close();
  });

  test('Hear a recording stops the microphone first, then plays the recording in time', async () => {
    const { context, page, seen } = await newVisitor(browser, { stored: true });
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await expect(demo(page)).toHaveAttribute('data-st', 'live', { timeout: STEP_TIMEOUT_MS });
    await page.locator('#demo-live-recording').click();
    await expect(demo(page)).toHaveAttribute('data-st', 'rec', { timeout: STEP_TIMEOUT_MS });
    const states = await page.evaluate(() => ((window as unknown as MicWindow).__tracks ?? []).map((t) => t.readyState));
    expect(states).toEqual(['ended']);
    await expectRecordingInSync(page);
    await expect(demo(page)).toHaveAttribute('data-st', 'idle', { timeout: RECORDING_TIMEOUT_MS });
    seen.check();
    await context.close();
  });

  test('with reduced motion the text still changes and nothing animates', async () => {
    const { context, page, seen } = await newVisitor(browser, { stored: true, reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await expect(big(page)).toHaveText('clap clap', { timeout: STEP_TIMEOUT_MS });
    const names = await page.evaluate(() => [document.getElementById('demo-big'), ...document.querySelectorAll('.wave i')].map((e) => getComputedStyle(e as Element).animationName));
    expect(new Set(names)).toEqual(new Set(['none']));
    seen.check();
    await context.close();
  });
});

// ---- Microphone denied, then Hear a recording, at the two widths ----
test.describe('demo box: microphone denied', () => {
  test.setTimeout(MIC_TEST_TIMEOUT_MS);
  let browser: Browser;
  test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_SITE_PLAY_WAV_PATH) }); });
  test.afterAll(async () => { await browser?.close(); });

  for (const width of VIEWPORT_WIDTHS_PX) {
    test(`shows the reason, and Hear a recording shows the same reaction in time with the audio at ${width} px`, async () => {
      const { context, page, seen } = await newVisitor(browser, { deny: true, width });
      const layouts: Layout[] = [await layoutOf(page)];
      await page.getByRole('button', { name: 'Turn on the microphone' }).click();
      await expect(demo(page)).toHaveAttribute('data-st', 'fail', { timeout: STEP_TIMEOUT_MS });
      await expect(page.locator('.s-fail .fail')).toHaveText(BLOCKED_TEXT);
      await expect(page.locator('#demo-fail-recording')).toHaveClass(/primary/);
      layouts.push(await layoutOf(page));
      await page.locator('#demo-fail-recording').click();
      await expectRecordingInSync(page);
      layouts.push(await layoutOf(page));
      expect(await page.evaluate(() => (window as unknown as MicWindow).__gum ?? 0)).toBe(0);
      expect(await page.evaluate(() => (document.getElementById('demo-audio') as HTMLAudioElement).getAttribute('src'))).toBe('media/clap-demo.wav');
      expectSameLayout(layouts);
      await expect(demo(page)).toHaveAttribute('data-st', 'idle', { timeout: RECORDING_TIMEOUT_MS });
      layouts.push(await layoutOf(page));
      expectSameLayout(layouts);
      seen.check();
      await context.close();
    });
  }
});

test('site: the app cards and the deck open from the page', async ({ page }) => {
  test.setTimeout(SITE_TEST_TIMEOUT_MS);
  const seen = watch(page);
  for (const [name, path] of [['Open Click Talk', 'apps/click-talk/'], ['Open Shoo!', 'apps/shoo/'], ['Open the slide deck', 'cases/slides/']]) {
    await page.goto(landingUrl());
    await page.getByRole('link', { name }).click();
    await expect(page).toHaveURL(`${landingUrl()}${path}`, { timeout: SITE_ELEMENT_TIMEOUT_MS });
    await expect(page.locator('body')).not.toBeEmpty();
  }
  seen.check();
});
