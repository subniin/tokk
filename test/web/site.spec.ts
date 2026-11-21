// Task 21 (requirement 12, tests E1 to E5): the built site served under /tokk/ by a small static server.
// The server answers 404 outside /tokk/, so a root-absolute URL in the site fails these tests.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildSite } from '../../scripts/build-site';
import { FIXTURE_APP_NAMES, FIXTURE_PROOF_TEXT, makeFixtureApps, removeFixtureApps } from '../helpers/fixture-apps';
import { REPO_ROOT } from './paths';
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
    // Run A: the idle state shows and its buttons do nothing.
    await page.getByRole('button', { name: 'Turn on the microphone' }).click();
    await page.getByRole('button', { name: 'Hear a recording' }).click();
    await expect(page.locator('#demo')).toHaveAttribute('data-st', 'idle');
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

test('site: the built folder holds no .wav file and no sounds folder', () => {
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
  expect(found).toEqual([]);
});
