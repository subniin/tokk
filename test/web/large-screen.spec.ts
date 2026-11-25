// The larger sizes of a large screen (the video sizes): the site, Click Talk, Shoo! and the slide deck case.
// At 1920 x 1080 the chosen elements have the video size. At 1280 x 720 they are not smaller than before the change, and at
// 1920 x 1080, 1280 x 720 and 390 x 844 no page scrolls sideways. The sizes are read as computed styles. The pages play with
// keys (the microphone is denied), so the test needs no sound.
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, saveSettings } from '../../apps/click-talk/src/settings';
import { FIXTURE_TALK_STORED_PATH, SHOO_PAGE_URL, SLIDES_PAGE_URL, TALK_PAGE_URL } from './paths';

// Test-only values.
const SITE_PAGE_URL = '/site-src/index.html';
const LARGE = { width: 1920, height: 1080 };
const MEDIUM = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };
const VIEWPORTS = [LARGE, MEDIUM, PHONE];
const TOLERANCE_PX = 0.05;
const PHONE_MAX_WIDTH_PX = 640;       // the max-width of the phone block of apps/shoo/src/style.css
const STEP_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 90_000;
const STORED = readFileSync(FIXTURE_TALK_STORED_PATH, 'utf8');

// The sizes of the same elements at 1280 x 720 before this change (the small values at their clamp, in px).
const BEFORE_MEDIUM = {
  heroH1: 55.04,        // clamp(2.4rem, 4.3vw, 3.7rem)
  links: 16,
  talkCategoryTile: 48.64,   // clamp(2.1rem, 3.8vw, 3.3rem)
  talkPhraseTile: 29.44,     // clamp(1.6rem, 2.3vw, 2.2rem)
  talkBuilt: 12,
  shooWave: 21.6,
  shooTag: 13,
  shooCandleWidth: 26,
  shooBuilt: 12,
  slidesCaption: 16,
};

const MIC_DENIED = (): void => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
};
const STORE = (o: { model: string; settings: string }): void => {
  localStorage.setItem('tokk:click-talk', o.model);
  localStorage.setItem('click-talk:settings', o.settings);
};

async function context(browser: Browser, baseURL: string | undefined, size: { width: number; height: number }): Promise<BrowserContext> {
  const c = await browser.newContext({ baseURL, viewport: size });
  await c.addInitScript(MIC_DENIED);
  return c;
}

const px = (page: Page, selector: string, property: string): Promise<number> =>
  page.locator(selector).first().evaluate((e, p) => parseFloat(getComputedStyle(e).getPropertyValue(p)), property);

async function expectPx(page: Page, selector: string, property: string, expected: number, where: string): Promise<void> {
  const actual = await px(page, selector, property);
  expect(Math.abs(actual - expected), `${where}: ${selector} ${property} is ${actual}px, expected ${expected}px`).toBeLessThanOrEqual(TOLERANCE_PX);
}
async function expectAtLeast(page: Page, selector: string, property: string, before: number, where: string): Promise<void> {
  const actual = await px(page, selector, property);
  expect(actual, `${where}: ${selector} ${property} is ${actual}px, it was ${before}px before`).toBeGreaterThanOrEqual(before - TOLERANCE_PX);
}

async function expectNoSideScroll(page: Page, where: string, extra: string[] = []): Promise<void> {
  const widths = await page.evaluate((selectors) => {
    const out: string[] = [];
    const check = (name: string, e: Element | null): void => {
      if (e !== null && e.scrollWidth > e.clientWidth + 1) out.push(`${name} scrolls sideways (${e.scrollWidth} > ${e.clientWidth})`);
    };
    check('html', document.documentElement);
    check('body', document.body);
    for (const s of selectors) check(s, document.querySelector(s));
    return out;
  }, extra);
  expect(widths, where).toEqual([]);
}

// ---- The site ----
test.describe('large screen: the site', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('1920 x 1080 uses the video sizes', async ({ browser, baseURL }) => {
    const c = await context(browser, baseURL, LARGE);
    const page = await c.newPage();
    await page.goto(SITE_PAGE_URL);
    await expectPx(page, '.hero h1', 'font-size', 76, 'site');
    await expectPx(page, '.links', 'font-size', 24, 'site');
    await expectPx(page, '.logo', 'font-size', 30, 'site');
    await expectPx(page, '.btn', 'font-size', 24, 'site');
    await expectPx(page, '.wrap', 'max-width', 1600, 'site');
    await c.close();
  });

  test('1280 x 720 is not smaller than before', async ({ browser, baseURL }) => {
    const c = await context(browser, baseURL, MEDIUM);
    const page = await c.newPage();
    await page.goto(SITE_PAGE_URL);
    await expectAtLeast(page, '.hero h1', 'font-size', BEFORE_MEDIUM.heroH1, 'site 1280');
    await expectAtLeast(page, '.links', 'font-size', BEFORE_MEDIUM.links, 'site 1280');
    await c.close();
  });

  test('no horizontal scroll', async ({ browser, baseURL }) => {
    for (const size of VIEWPORTS) {
      const c = await context(browser, baseURL, size);
      const page = await c.newPage();
      await page.goto(SITE_PAGE_URL);
      await expectNoSideScroll(page, `site ${size.width}`);
      await c.close();
    }
  });
});

// ---- Click Talk ----
async function talkBoard(browser: Browser, baseURL: string | undefined, size: { width: number; height: number }): Promise<{ page: Page; close(): Promise<void> }> {
  const c = await context(browser, baseURL, size);
  await c.addInitScript(STORE, { model: STORED, settings: saveSettings({ ...DEFAULT_SETTINGS }) });
  const page = await c.newPage();
  await page.goto(TALK_PAGE_URL);
  await page.getByRole('button', { name: 'Use keys' }).click();
  await expect(page.locator('#mic')).toBeHidden();
  await expect(page.locator('#board')).toHaveAttribute('data-level', 'categories', { timeout: STEP_TIMEOUT_MS });
  return { page, close: () => c.close() };
}

test.describe('large screen: Click Talk', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('1920 x 1080 uses the video sizes', async ({ browser, baseURL }) => {
    const { page, close } = await talkBoard(browser, baseURL, LARGE);
    await expectPx(page, '#g-cats .tile strong', 'font-size', 76, 'Click Talk');
    await expectPx(page, '.built', 'font-size', 20, 'Click Talk');
    await page.keyboard.press('Enter');
    await expect(page.locator('#board')).toHaveAttribute('data-level', 'phrases', { timeout: STEP_TIMEOUT_MS });
    await expectPx(page, '#g-phr .tile:not(.back) strong', 'font-size', 40, 'Click Talk phrases');
    await close();
  });

  test('1280 x 720 is not smaller than before', async ({ browser, baseURL }) => {
    const { page, close } = await talkBoard(browser, baseURL, MEDIUM);
    await expectAtLeast(page, '#g-cats .tile strong', 'font-size', BEFORE_MEDIUM.talkCategoryTile, 'Click Talk 1280');
    await expectAtLeast(page, '.built', 'font-size', BEFORE_MEDIUM.talkBuilt, 'Click Talk 1280');
    await page.keyboard.press('Enter');
    await expect(page.locator('#board')).toHaveAttribute('data-level', 'phrases', { timeout: STEP_TIMEOUT_MS });
    await expectAtLeast(page, '#g-phr .tile:not(.back) strong', 'font-size', BEFORE_MEDIUM.talkPhraseTile, 'Click Talk phrases 1280');
    await close();
  });

  test('no horizontal scroll, on the categories and on the phrases', async ({ browser, baseURL }) => {
    for (const size of VIEWPORTS) {
      const { page, close } = await talkBoard(browser, baseURL, size);
      await expectNoSideScroll(page, `Click Talk categories ${size.width}`, ['main', '#board']);
      await page.keyboard.press('Enter');
      await expect(page.locator('#board')).toHaveAttribute('data-level', 'phrases', { timeout: STEP_TIMEOUT_MS });
      await expectNoSideScroll(page, `Click Talk phrases ${size.width}`, ['main', '#board']);
      await close();
    }
  });
});

// ---- Shoo! ----
async function shooField(browser: Browser, baseURL: string | undefined, size: { width: number; height: number }): Promise<{ page: Page; close(): Promise<void> }> {
  const c = await context(browser, baseURL, size);
  const page = await c.newPage();
  await page.goto(`${SHOO_PAGE_URL}?speed=2&lives=9`);
  await page.getByRole('button', { name: 'Play with keys' }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
  await expect(page.locator('.mon .tag').first()).toBeVisible({ timeout: STEP_TIMEOUT_MS });
  return { page, close: () => c.close() };
}

test.describe('large screen: Shoo!', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('1920 x 1080 uses the video sizes', async ({ browser, baseURL }) => {
    const { page, close } = await shooField(browser, baseURL, LARGE);
    await expectPx(page, '.wave', 'font-size', 40, 'Shoo!');
    await expectPx(page, '.candles svg', 'width', 40, 'Shoo!');
    await expectPx(page, '.mon .tag', 'font-size', 22, 'Shoo!');
    await expectPx(page, '.built', 'font-size', 20, 'Shoo!');
    await close();
  });

  test('1280 x 720 is not smaller than before', async ({ browser, baseURL }) => {
    const { page, close } = await shooField(browser, baseURL, MEDIUM);
    await expectAtLeast(page, '.wave', 'font-size', BEFORE_MEDIUM.shooWave, 'Shoo! 1280');
    await expectAtLeast(page, '.candles svg', 'width', BEFORE_MEDIUM.shooCandleWidth, 'Shoo! 1280');
    await expectAtLeast(page, '.mon .tag', 'font-size', BEFORE_MEDIUM.shooTag, 'Shoo! 1280');
    await expectAtLeast(page, '.built', 'font-size', BEFORE_MEDIUM.shooBuilt, 'Shoo! 1280');
    await close();
  });

  test('no horizontal scroll, and the biggest monster fits between the HUD and the sides', async ({ browser, baseURL }) => {
    for (const size of VIEWPORTS) {
      const { page, close } = await shooField(browser, baseURL, size);
      await expectNoSideScroll(page, `Shoo! ${size.width}`);
      // A probe of the biggest sprite (a warden with its tag and hit points) at the top and at the bottom of its path.
      const report = await page.evaluate(() => {
        const field = document.querySelector<HTMLElement>('.field') as HTMLElement;
        const probe = document.createElement('div');
        probe.className = 'mon big';
        probe.style.visibility = 'hidden';
        probe.style.left = '50%';
        probe.style.top = '0%';
        probe.innerHTML = '<svg viewBox="0 0 10 10"></svg><span class="tag t-knock">warden</span><span class="hp"><i></i><i></i><i></i></span>';
        field.append(probe);
        const sprite = probe.getBoundingClientRect();
        probe.remove();
        const fieldRect = field.getBoundingClientRect();
        let hudBottom = 0;
        for (const e of Array.from(document.querySelector('.hud')?.children ?? [])) {
          const r = e.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) hudBottom = Math.max(hudBottom, r.bottom);
        }
        return { spriteTop: sprite.top, spriteWidth: sprite.width, hudBottom, fieldTop: fieldRect.top, windowWidth: document.documentElement.clientWidth };
      });
      // A phone looks as it did before this change (its warden already starts under the HUD), so only the larger windows are held to it.
      if (size.width > PHONE_MAX_WIDTH_PX) expect(report.spriteTop, `Shoo! ${size.width}: a warden at the start of the path stays below the HUD`).toBeGreaterThanOrEqual(report.hudBottom - 1);
      expect(report.spriteWidth, `Shoo! ${size.width}: the warden is narrower than the window`).toBeLessThan(report.windowWidth / 2);
      await close();
    }
  });
});

// ---- The slide deck case ----
test.describe('large screen: the slide deck', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('1920 x 1080 uses the video sizes', async ({ browser, baseURL }) => {
    const c = await context(browser, baseURL, LARGE);
    const page = await c.newPage();
    await page.goto(SLIDES_PAGE_URL);
    await expect(page.locator('#caption')).toBeAttached({ timeout: STEP_TIMEOUT_MS });
    await expectPx(page, '#caption', 'font-size', 22, 'slides');
    await c.close();
  });

  test('1280 x 720 is not smaller than before', async ({ browser, baseURL }) => {
    const c = await context(browser, baseURL, MEDIUM);
    const page = await c.newPage();
    await page.goto(SLIDES_PAGE_URL);
    await expect(page.locator('#caption')).toBeAttached({ timeout: STEP_TIMEOUT_MS });
    await expectAtLeast(page, '#caption', 'font-size', BEFORE_MEDIUM.slidesCaption, 'slides 1280');
    await c.close();
  });

  test('no horizontal scroll', async ({ browser, baseURL }) => {
    for (const size of VIEWPORTS) {
      const c = await context(browser, baseURL, size);
      const page = await c.newPage();
      await page.goto(SLIDES_PAGE_URL);
      await expect(page.locator('#caption')).toBeAttached({ timeout: STEP_TIMEOUT_MS });
      await expectNoSideScroll(page, `slides ${size.width}`);
      await c.close();
    }
  });
});
