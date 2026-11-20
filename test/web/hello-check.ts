// The body of the hello check, shared by hello.spec.ts (dev server) and site.spec.ts (the site under /tokk/) so the two cannot drift.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIXTURE_LABELS_PATH } from './paths';

// Test-only values.
const HELLO_PATTERN = 'low _ mid';                 // the pattern of the page that the fixture sequence matches
const HELLO_PATTERN_WAIT_MS = 30_000;             // the line can come after the engine's wait for a longer pattern
const HELLO_SINGLE_SOUND = 'ring';                // the last sound of the fixture, recognised as a single sound
const HELLO_SETTLE_MS = 500;
export const HELLO_TEST_TIMEOUT_MS = 60_000;

export async function checkHelloPage(page: Page, baseURL: string, pagePath: string): Promise<void> {
  const allowedOrigin = new URL(baseURL).origin;
  const foreign: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.protocol !== 'blob:' && u.origin !== allowedOrigin) foreign.push(r.url());
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  const info = JSON.parse(await readFile(FIXTURE_LABELS_PATH, 'utf8')) as { labels: string[] };
  expect(info.labels).toContain(HELLO_SINGLE_SOUND);

  await page.goto(new URL(pagePath, baseURL).href);
  await page.getByRole('button', { name: 'Start listening' }).click();
  const results = page.locator('#results');
  await expect(results).toContainText(HELLO_PATTERN, { timeout: HELLO_PATTERN_WAIT_MS });
  await expect(results).toContainText(HELLO_SINGLE_SOUND, { timeout: HELLO_PATTERN_WAIT_MS });
  await page.waitForTimeout(HELLO_SETTLE_MS);

  expect(await page.locator('[data-tokk-overlay]').count()).toBeGreaterThan(0);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
}
