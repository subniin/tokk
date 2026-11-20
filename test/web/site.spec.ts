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
// Task 26 (named update): the landing page also links cases/slides/, which the build below copies from the real cases/ folder.
const LANDING_HREFS = ['teach.html', 'examples/hello/', 'apps/hands-free/', 'apps/knock-once/', 'cases/slides/'];

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

test('site: the landing page opens at /tokk/ and each of its four links opens a page', async ({ page }) => {
  test.setTimeout(SITE_TEST_TIMEOUT_MS);
  const seen = watch(page);
  const landing = `${server.url}${SITE_PREFIX}`;
  const response = await page.goto(landing);
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible({ timeout: SITE_ELEMENT_TIMEOUT_MS });
  const hrefs = await page.locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).toEqual(LANDING_HREFS);
  for (const href of LANDING_HREFS) {
    const r = await page.goto(new URL(href as string, landing).href);
    expect(r?.status(), href).toBe(200);
  }
  expect(seen.requests.length).toBeGreaterThan(0);
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
