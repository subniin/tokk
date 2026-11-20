// Task 19, test H1: the hello example page on Chrome's fake microphone.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIXTURE_LABELS_PATH } from './paths';

// Test-only values.
const HELLO_PAGE_URL = '/examples/hello/index.html';
const HELLO_PATTERN = 'low _ mid';                 // the pattern of the page that the fixture sequence matches
const HELLO_PATTERN_WAIT_MS = 30_000;             // the line can come after the engine's wait for a longer pattern
const HELLO_SINGLE_SOUND = 'ring';                // the last sound of the fixture, recognised as a single sound
const HELLO_SETTLE_MS = 500;
const HELLO_TEST_TIMEOUT_MS = 60_000;

test('hello page: the fake microphone gives the pattern and the sounds as text, with no request leaving localhost', async ({ page, baseURL }) => {
  test.setTimeout(HELLO_TEST_TIMEOUT_MS);
  const allowedOrigin = new URL(baseURL as string).origin;
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

  await page.goto(HELLO_PAGE_URL);
  await page.getByRole('button', { name: 'Start listening' }).click();
  const results = page.locator('#results');
  await expect(results).toContainText(HELLO_PATTERN, { timeout: HELLO_PATTERN_WAIT_MS });
  await expect(results).toContainText(HELLO_SINGLE_SOUND, { timeout: HELLO_PATTERN_WAIT_MS });
  await page.waitForTimeout(HELLO_SETTLE_MS);

  expect(await page.locator('[data-tokk-overlay]').count()).toBeGreaterThan(0);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});
