// Task 26, the slide deck case (cases/slides). Stage 1 has two tests, with no microphone and no Tokk code:
//   E0  the deck on the dev server at /cases/slides/index.html
//   E5  the same deck from a site build under /tokk/cases/slides/, served as the Task 21 tests serve the site
// The current slide is read from the DOM: reveal.js 6.0.2 puts the class `present` on the section that is shown.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../scripts/build-site';
import { makeFixtureApps, removeFixtureApps } from '../helpers/fixture-apps';
import { startSiteServer } from '../helpers/static-site-server';
import type { SiteServer } from '../helpers/static-site-server';
import { REPO_ROOT } from './paths';

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
