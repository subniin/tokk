// Task 33 run B: Shoo! in Chrome.
// The first run (teaching), a returning player, the boss rhythm and the lost microphone use the fake microphone, which plays
// a WAV once from the moment its stream opens (test/web/shoo-fixture.ts). Every test of this group has its own browser, so
// each stream starts at 0. The other tests play with keys and use the default Chrome.
// The sounds are synthetic stand-ins: they show the wiring and the rules, not how well Tokk hears a real mouth or hand.
// Test-only page parameters (apps/shoo/src/test-params.ts): ?speed=N runs the game clock and the waits N times faster and
// shortens the room sound to 10 s, ?wave=N starts at wave N, ?lives=N gives N candles.
import { chromium, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { countWiring } from '../../scripts/count-wiring';
import { BOSS_PATTERN } from '../../apps/shoo/src/monsters';
import { INTRO_TEXT, READY_TEXT, ROOM_TEXT, TEACH_LINE } from '../../apps/shoo/src/teach-texts';
import { SHOO_ROOM_NOISE_AT_MS, SHOO_ROOM_NOISE_MS } from './shoo-fixture';
import type { ShooTimes } from './shoo-fixture';
import {
  FIXTURE_SHOO_FIRST_WAV_PATH, FIXTURE_SHOO_PLAY_WAV_PATH, FIXTURE_SHOO_STORED_PATH, FIXTURE_SHOO_TIMES_PATH, REPO_ROOT, SHOO_PAGE_URL, fakeMicArgs,
} from './paths';

// Test-only values.
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 720;
const NARROW_WIDTH_PX = 320;
const NARROW_HEIGHT_PX = 640;
const HUD_WIDTH_PX = 1024;
const HUD_HEIGHT_PX = 768;
const CANDLE_WIDTH_PX = 26;                       // apps/shoo/src/style.css .candles svg
const CANDLE_GAP_PX = 8;
const SCREENSHOT_WIDTH_PX = 1000;
const SCREENSHOT_HEIGHT_PX = 760;
const SCREENSHOT_MAX_BYTES = 400_000;
const SCREENSHOT_PATH = resolve(REPO_ROOT, 'docs', 'images', 'shoo.png');
const FIRST_RUN_TIMEOUT_MS = 180_000;
const MIC_TEST_TIMEOUT_MS = 120_000;
const KEYS_TEST_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;
const STREAM_SLACK_MS = 15_000;
const ROOM_NOISE_SETTLE_MS = 1500;               // after the room sound of the stream, before the click dialog may open
const POLL_MS = 100;
const REDUCED_WORD_GONE_MS = 1500;                 // the word of a reduced-motion hit lasts 600 ms
const MOVE_OBSERVE_MS = 1500;
const STORAGE_KEY = 'tokk:shoo';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const TIMES: ShooTimes = JSON.parse(readFileSync(FIXTURE_SHOO_TIMES_PATH, 'utf8')) as ShooTimes;
const STORED = readFileSync(FIXTURE_SHOO_STORED_PATH, 'utf8');

const DIALOG = '[data-tokk-teach]';
const dialogAction = (name: string): string => `${DIALOG} [data-action="${name}"]`;
const stage = (page: Page) => page.locator('#stage');

interface MicWindow { __micStartMs?: number; __gum?: number; __tracks?: MediaStreamTrack[]; __added?: string[] }

// Records what must not happen: a request to another origin, a failed request, a console error, a page error.
function watch(page: Page, origin: string): { problems: string[]; check(): void } {
  const problems: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.protocol !== 'blob:' && u.origin !== origin) problems.push(`request to another origin: ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return { problems, check: () => expect(problems).toEqual([]) };
}

// Stores performance.now() when the first microphone stream opens (the fake microphone starts to play then), counts the
// streams and keeps the tracks, so that a test can end one.
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
// Counts the elements of the hit effect that are ever added to the page.
const EFFECT_COUNT_SCRIPT = (): void => {
  const w = window as unknown as MicWindow;
  w.__added = [];
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && /\b(arc|exit|seed)\b/.test(n.className)) w.__added?.push(n.className);
      });
    }
  }).observe(document, { subtree: true, childList: true });
};
const storeModel = (text: string): void => { localStorage.setItem('tokk:shoo', text); };

async function untilStream(page: Page, streamMs: number): Promise<void> {
  await page.waitForFunction(
    (ms) => { const s = (window as unknown as MicWindow).__micStartMs; return s !== undefined && performance.now() >= s + ms; },
    streamMs,
    { timeout: streamMs + STREAM_SLACK_MS + STEP_TIMEOUT_MS, polling: 50 },
  );
}

const shooed = async (page: Page): Promise<number> => Number(await stage(page).getAttribute('data-shooed'));
const warden = (page: Page) => page.locator('.mon[data-kind="warden"]');
const bat = (page: Page) => page.locator('.mon[data-kind="bat"]');

// Presses '1' once and waits for a bat of the field to be shooed. The key goes through the Worker, so the count grows a
// moment later. A second press inside that moment would shoo a second bat, so the press is repeated only after a pause
// longer than the Worker round trip (a press that found no bat is lost).
async function shooABat(page: Page): Promise<void> {
  const before = await shooed(page);
  await expect(bat(page).first()).toBeVisible({ timeout: STEP_TIMEOUT_MS });
  await page.keyboard.press('1');
  await expect.poll(async () => shooed(page), { timeout: STEP_TIMEOUT_MS, intervals: [POLL_MS] }).toBeGreaterThan(before);
}

// Nothing is wider than the window, and no text sticks out of the window or of its own box.
async function expectNoClipping(page: Page, where: string): Promise<void> {
  const report = await page.evaluate(() => {
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`);
    for (const e of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      if (e.closest('svg') !== null || e.closest('[hidden]') !== null) continue;
      const hasText = Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!hasText) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -1 || r.right > width + 1) out.push(`"${(e.textContent ?? '').trim().slice(0, 30)}" is outside the window (${Math.round(r.left)} to ${Math.round(r.right)} of ${width})`);
      if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1) out.push(`"${(e.textContent ?? '').trim().slice(0, 30)}" is wider than its box (${e.scrollWidth} > ${e.clientWidth})`);
    }
    return out;
  });
  expect(report, where).toEqual([]);
}

async function doneAndSave(page: Page): Promise<void> {
  await expect(page.locator(dialogAction('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('done'));
  await saveAndClose(page);
}
async function saveAndClose(page: Page, last = true): Promise<void> {
  await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('save'));
  await page.click(dialogAction('close'));
  if (last) await expect(page.locator(DIALOG)).toHaveCount(0);   // the room dialog is followed by the click dialog at once
}

// ---- The first run: the room sound for 10 s, then the click, then a bat is shooed by a click from the stream ----
test.describe.serial('first run with the fake microphone', () => {
  test.setTimeout(FIRST_RUN_TIMEOUT_MS);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let seen: ReturnType<typeof watch>;

  test.beforeAll(async ({ baseURL }) => {
    browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_SHOO_FIRST_WAV_PATH) });
    context = await browser.newContext({ baseURL, viewport: { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX } });
    await context.addInitScript(MIC_SCRIPT);
    page = await context.newPage();
    seen = watch(page, new URL(baseURL as string).origin);
  });
  test.afterAll(async () => { await browser?.close(); });

  test('teaches the room sound, then the click, and a click of the stream shoos a bat', async () => {
    await page.goto(`${SHOO_PAGE_URL}?speed=1.5&lives=9`);
    await expect(page.locator('#title')).toContainText('Your audio stays on this device.');
    await page.getByRole('button', { name: 'Start listening' }).click();

    // 1. The room sound (the 30 s of the plan, 10 s with the test speed), through the library's dialog in the app's words.
    await expect(page.locator('#room-title')).toHaveText(ROOM_TEXT.title);
    await expect(page.locator('#room-body')).toHaveText(ROOM_TEXT.body);
    await page.getByRole('button', { name: ROOM_TEXT.button }).click();
    await expect(page.locator(`${DIALOG} h2`)).toHaveText(ROOM_TEXT.title, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(DIALOG)).toContainText(ROOM_TEXT.body);
    // The dialog finishes by itself (Done is hidden). Close it only after the room sound of the stream has ended, so that the
    // click dialog does not hear it.
    await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS + SHOO_ROOM_NOISE_AT_MS + SHOO_ROOM_NOISE_MS });
    await untilStream(page, SHOO_ROOM_NOISE_AT_MS + SHOO_ROOM_NOISE_MS + ROOM_NOISE_SETTLE_MS);
    await saveAndClose(page, false);

    // 2. The bat: its line, and the click taught 10 times with the app's text.
    await expect(page.locator('#intro-title')).toHaveText('A bat!', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#intro-line')).toHaveText(INTRO_TEXT.bat.replace('A bat! ', ''));
    await expect(page.locator('#intro-sub')).toHaveText(TEACH_LINE.click);
    await expect(page.locator(`${DIALOG} h2`)).toHaveText('Teach "click"', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(DIALOG)).toContainText(TEACH_LINE.click);
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.first.teachStartsMs.length, { timeout: STEP_TIMEOUT_MS + TIMES.first.teachEndMs });
    await doneAndSave(page);

    // 3. Wave 1: the fight. The model is stored as feature vectors under the app's key, and nothing else is stored.
    await expect(page.locator('#banner')).toHaveText('Wave 1', { timeout: STEP_TIMEOUT_MS });
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    const entry = JSON.parse(stored as string) as { model: { examples: { id: string; label: string; v: number[] }[] } };
    expect([...new Set(entry.model.examples.map((e) => e.label))].sort()).toEqual(['background', 'click']);
    for (const e of entry.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect(await page.evaluate(() => localStorage.length)).toBe(1);

    const lastClick = TIMES.first.fightClicksMs[TIMES.first.fightClicksMs.length - 1];
    await untilStream(page, lastClick);
    await expect(stage(page)).toHaveAttribute('data-shooed', /^[1-9]/, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#heard')).toContainText('Heard: click');
    await expect(page.locator('#heard b')).toHaveText('click');
    seen.check();
  });
});

// ---- A returning player, the boss rhythm and the lost microphone: a stored model and the play stream ----
test.describe('stored model and the play stream', () => {
  test.setTimeout(MIC_TEST_TIMEOUT_MS);
  let browser: Browser;

  test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_SHOO_PLAY_WAV_PATH) }); });
  test.afterAll(async () => { await browser?.close(); });

  async function returning(baseURL: string | undefined, query: string): Promise<{ page: Page; seen: ReturnType<typeof watch>; context: BrowserContext }> {
    const context = await browser.newContext({ baseURL, viewport: { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX } });
    await context.addInitScript(MIC_SCRIPT);
    await context.addInitScript(storeModel, STORED);
    const page = await context.newPage();
    const seen = watch(page, new URL(baseURL as string).origin);
    await page.goto(`${SHOO_PAGE_URL}${query}`);
    return { page, seen, context };
  }

  test('a returning player skips every teach step and a click of the stream shoos a bat', async ({ baseURL }) => {
    const { page, seen, context } = await returning(baseURL, '');
    let dialogSeen = false;
    page.on('framenavigated', () => undefined);
    await page.getByRole('button', { name: 'Start listening' }).click();
    await expect(page.locator('#intro-sub')).toHaveText(READY_TEXT);
    await expect(page.locator('#intro-title')).toHaveText('A bat!');
    dialogSeen ||= (await page.locator(DIALOG).count()) > 0;
    await expect(page.locator('#room')).toBeHidden();
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    await expect(stage(page)).toHaveAttribute('data-source', 'mic');
    await expect(page.locator('#candles')).toHaveAttribute('data-lives', '3');
    await untilStream(page, TIMES.play.clickMs + 1500);
    dialogSeen ||= (await page.locator(DIALOG).count()) > 0;
    expect(dialogSeen, 'no teach dialog for a returning player').toBe(false);
    await expect(stage(page)).toHaveAttribute('data-shooed', /^[1-9]/, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#heard b')).toHaveText('click');
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(STORED);   // nothing was stored again
    seen.check();
    await context.close();
  });

  test('the boss rhythm knock knock _ knock hits the warden three times', async ({ baseURL }) => {
    const { page, seen, context } = await returning(baseURL, '?wave=5&lives=9');
    await page.getByRole('button', { name: 'Start listening' }).click();
    await expect(page.locator('#intro-title')).toHaveText('The Grave Warden!');
    await expect(page.locator('#intro-line')).toContainText('knock knock, pause, knock');
    await expect(stage(page)).toHaveAttribute('data-mode', 'battle');
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    await expect(stage(page)).toHaveAttribute('data-mode', 'boss');
    await expect(warden(page)).toBeVisible();
    await expect(warden(page).locator('.hp i:not(.off)')).toHaveCount(3);
    expect(BOSS_PATTERN).toBe('knock knock _ knock');
    await expect(warden(page)).toContainText('knock knock _ knock');

    const left = (n: number) => expect(warden(page).locator('.hp i:not(.off)')).toHaveCount(n, { timeout: STEP_TIMEOUT_MS });
    await untilStream(page, TIMES.play.rhythmsMs[0] + 2500);
    await left(2);
    await expect(page.locator('.burst', { hasText: 'KNOCK!' }).first()).toBeAttached();
    await untilStream(page, TIMES.play.rhythmsMs[1] + 2500);
    await left(1);
    const before = await shooed(page);
    await untilStream(page, TIMES.play.rhythmsMs[2] + 2500);
    await expect(warden(page)).toHaveCount(0, { timeout: STEP_TIMEOUT_MS });
    expect(await shooed(page)).toBeGreaterThan(before);
    seen.check();
    await context.close();
  });

  test('a lost microphone shows the card, keys keep working, Reconnect listens again', async ({ baseURL }) => {
    const { page, seen, context } = await returning(baseURL, '?lives=9');
    await page.getByRole('button', { name: 'Start listening' }).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    await expect(stage(page)).toHaveAttribute('data-source', 'mic');
    expect(await page.evaluate(() => (window as unknown as MicWindow).__gum)).toBe(1);

    // The track ends (unplugged, or taken by another app).
    await page.evaluate(() => { for (const t of (window as unknown as MicWindow).__tracks ?? []) { t.stop(); t.dispatchEvent(new Event('ended')); } });
    await expect(page.locator('#mic-title')).toHaveText('The microphone went quiet.');
    await expect(page.locator('#mic-body')).toHaveText('It may have been unplugged or taken by another app.');
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-source', 'keys');
    await expect(page.locator('#keys-line')).toHaveText('1 click · 2 clap · 3 knock · 4 pop');
    await shooABat(page);   // the keys still shoo monsters while the card is up
    await expect(page.locator('#heard b')).toHaveText('click');
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle');

    await page.getByRole('button', { name: 'Reconnect' }).click();
    await expect(page.locator('#mic')).toBeHidden();
    await expect(stage(page)).toHaveAttribute('data-source', 'mic');
    expect(await page.evaluate(() => (window as unknown as MicWindow).__gum)).toBe(2);
    await expect(page.locator('#keys-line')).toBeHidden();
    await shooABat(page);   // keys also work with the microphone
    seen.check();
    await context.close();
  });
});

// ---- Keys only: no microphone ----
test.describe('playing with keys', () => {
  test.setTimeout(KEYS_TEST_TIMEOUT_MS);

  test('a denied microphone shows the card, Play with keys plays and 1 to 4 shoo monsters', async ({ page, baseURL }) => {
    const seen = watch(page, new URL(baseURL as string).origin);
    await page.addInitScript(DENY_SCRIPT);
    await page.goto(`${SHOO_PAGE_URL}?speed=2`);
    await page.getByRole('button', { name: 'Start listening' }).click();
    await expect(page.locator('#mic-title')).toHaveText('The house cannot hear you.');
    await expect(page.locator('#mic-body')).toHaveText('Microphone access is blocked. Allow it in the address bar, or play with keys: 1 click, 2 clap, 3 knock, 4 pop.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();   // still denied: the card stays
    await expect(page.locator('#mic-title')).toHaveText('The house cannot hear you.');
    await page.getByRole('button', { name: 'Play with keys' }).last().click();
    await expect(page.locator('#mic')).toBeHidden();

    // No teaching: "Get ready." and the keys line at the bottom.
    await expect(page.locator('#intro-sub')).toHaveText(READY_TEXT);
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator('#keys-line')).toHaveText('1 click · 2 clap · 3 knock · 4 pop');
    await expect(page.locator('#listening-text')).toHaveText('Keys only');
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });

    await shooABat(page);
    expect(await shooed(page)).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#heard')).toContainText('Heard: click');
    await expect(page.locator('.burst', { hasText: 'CLICK!' }).first()).toBeAttached();
    await expect(page.locator('.plus', { hasText: '+1' }).first()).toBeAttached();
    expect(await page.locator('.arc').count()).toBeGreaterThan(0);

    // No monster of the sound: the word and a note in text.
    const note = async (key: string, heard: string, text: string): Promise<void> => {
      await page.keyboard.press(key);
      await expect(page.locator('#heard b')).toHaveText(heard);
      await expect(page.locator('.note', { hasText: text }).first()).toBeAttached();
    };
    await note('2', 'clap', 'No ghosts here');
    await note('3', 'knock', 'No skeletons here');
    await note('4', 'pop', 'No pumpkins here');

    // Escape pauses, and again resumes. Listening is off while paused.
    await page.keyboard.press('Escape');
    await expect(stage(page)).toHaveAttribute('data-phase', 'paused');
    await expect(page.locator('#paused')).toContainText('Paused');
    await expect(page.locator('#paused')).toContainText('Listening is off.');
    const heardBefore = await page.locator('#heard').textContent();
    await page.keyboard.press('1');
    await page.waitForTimeout(POLL_MS * 5);
    expect(await page.locator('#heard').textContent()).toBe(heardBefore);
    await page.keyboard.press('Escape');
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle');
    await expect(page.locator('#paused')).toBeHidden();
    seen.check();
  });

  test('a missed monster puts a candle out, three of them end the game, Play again starts over', async ({ page, baseURL }) => {
    const seen = watch(page, new URL(baseURL as string).origin);
    await page.goto(`${SHOO_PAGE_URL}?speed=4`);
    await page.getByRole('button', { name: 'Play with keys' }).click();
    await expect(page.locator('#candles')).toHaveAttribute('data-lives', '3');
    await expect(page.locator('#candles')).toHaveAttribute('data-lives', '2', { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('.caption', { hasText: '[a candle goes out]' })).toBeVisible();
    await expect(page.locator('#lost')).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#lost h1')).toHaveText('The monsters got in.');
    await expect(page.locator('#lost-body')).toHaveText('You shooed 0 monsters.');
    await page.getByRole('button', { name: 'Play again' }).first().click();
    await expect(page.locator('#lost')).toBeHidden();
    await expect(page.locator('#candles')).toHaveAttribute('data-lives', '3');
    await expect(stage(page)).toHaveAttribute('data-wave', '1');
    await expect(page.locator('#intro-title')).toHaveText('A bat!');
    seen.check();
  });

  test('sounds during the intro and between waves are ignored', async ({ page, baseURL }) => {
    const seen = watch(page, new URL(baseURL as string).origin);
    await page.goto(`${SHOO_PAGE_URL}?speed=2`);
    await page.getByRole('button', { name: 'Play with keys' }).click();
    await expect(page.locator('#intro')).toBeVisible();
    for (const k of ['1', '2', '3', '4']) await page.keyboard.press(k);
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    expect(await shooed(page)).toBe(0);
    await expect(page.locator('#heard')).toHaveText('');
    expect(await page.locator('.note').count()).toBe(0);

    // Shoo every bat of wave 1, then press keys while "Wave 1 cleared." is on screen.
    await expect.poll(async () => {
      if (await page.locator('#cleared').isVisible()) return true;
      await page.keyboard.press('1');
      return false;
    }, { timeout: KEYS_TEST_TIMEOUT_MS - STEP_TIMEOUT_MS, intervals: [POLL_MS] }).toBe(true);
    await expect(page.locator('#cleared-title')).toHaveText('Wave 1 cleared.');
    await expect(page.locator('#cleared-body')).toHaveText('6 monsters shooed.');
    const heard = await page.locator('#heard').textContent();
    const notes = await page.locator('.note').count();
    for (const k of ['2', '1', '3']) await page.keyboard.press(k);
    await page.waitForTimeout(POLL_MS * 5);
    expect(await shooed(page)).toBe(6);
    expect(await page.locator('#heard').textContent()).toBe(heard);
    expect(await page.locator('.note').count(), 'no new note: the sounds were ignored').toBeLessThanOrEqual(notes);

    // The next wave: the ghost, and the intro ignores keys again.
    await expect(page.locator('#intro-title')).toHaveText('A ghost!', { timeout: STEP_TIMEOUT_MS });
    await page.keyboard.press('2');
    await expect(stage(page)).toHaveAttribute('data-wave', '2');
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    expect(await shooed(page)).toBe(6);
    seen.check();
  });

  test('settings: sound effects switch, no teaching in keys mode, Esc closes', async ({ page, baseURL }) => {
    const seen = watch(page, new URL(baseURL as string).origin);
    await page.goto(`${SHOO_PAGE_URL}?speed=2`);
    await page.getByRole('button', { name: 'Play with keys' }).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'paused');
    await expect(page.locator('#settings-card')).toBeVisible();
    await expect(page.locator('#teach-group')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sound effects: on' })).toBeVisible();
    await page.getByRole('button', { name: 'Sound effects: on' }).click();
    await expect(page.getByRole('button', { name: 'Sound effects: off' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-card')).toBeHidden();
    await expect(page.locator('#paused')).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'battle');
    seen.check();
  });

  test('with reduced motion monsters still move, and a hit shows its word and +1 without arcs or an exit', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', viewport: { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX } });
    await context.addInitScript(EFFECT_COUNT_SCRIPT);
    const page = await context.newPage();
    const seen = watch(page, new URL(baseURL as string).origin);
    await page.goto(`${SHOO_PAGE_URL}?speed=2`);
    await page.getByRole('button', { name: 'Play with keys' }).click();
    await expect(bat(page).first()).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    const top = async (): Promise<number> => (await bat(page).first().boundingBox())?.y ?? 0;
    const y0 = await top();
    await page.waitForTimeout(MOVE_OBSERVE_MS);
    expect(await top(), 'monsters still move').not.toBe(y0);

    await shooABat(page);
    await expect(page.locator('.burst', { hasText: 'CLICK!' })).toBeVisible();
    await expect(page.locator('.plus', { hasText: '+1' })).toBeVisible();
    await expect(page.locator('.burst')).toHaveCount(0, { timeout: REDUCED_WORD_GONE_MS });
    expect(await page.evaluate(() => (window as unknown as MicWindow).__added)).toEqual([]);
    const animations = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? 'script'));
    expect(animations, 'no CSS animation and no script animation under reduced motion').toEqual([]);
    seen.check();
    await context.close();
  });

  // Every box of the HUD (candles, wave, Keys only / Listening, Pause, Settings) is inside the window, and the candles box is as
  // wide as its candles. 1024 x 768 with 3 lives is the case of the operator's report; the other rows are the widths and lives
  // the game can have (?lives= goes up to 9).
  const HUD_CASES = [
    { width: HUD_WIDTH_PX, height: HUD_HEIGHT_PX, lives: 3 },
    { width: NARROW_WIDTH_PX, height: NARROW_HEIGHT_PX, lives: 3 },
    { width: NARROW_WIDTH_PX, height: NARROW_HEIGHT_PX, lives: 9 },
    { width: HUD_WIDTH_PX, height: HUD_HEIGHT_PX, lives: 9 },
    { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX, lives: 3 },
  ];
  for (const { width, height, lives } of HUD_CASES) {
    test(`in keys mode at ${width} x ${height} with ${lives} lives every HUD box is inside the window`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport: { width, height } });
      const page = await context.newPage();
      await page.goto(`${SHOO_PAGE_URL}?lives=${lives}`);
      await page.getByRole('button', { name: 'Play with keys' }).click();
      await expect(stage(page)).toHaveAttribute('data-phase', 'battle');
      await expect(page.locator('#candles')).toHaveAttribute('data-lives', String(lives));
      const outside = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const h = document.documentElement.clientHeight;
        const out: string[] = [];
        for (const e of Array.from(document.querySelectorAll('#hud, #hud *'))) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.left < 0 || r.top < 0 || r.right > w || r.bottom > h) out.push(`${e.id || e.tagName} ${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)}`);
        }
        return out;
      });
      expect(outside, 'HUD boxes outside the window').toEqual([]);
      const candles = await page.locator('#candles').boundingBox();
      const own = lives * CANDLE_WIDTH_PX + (lives - 1) * CANDLE_GAP_PX;
      if (width > NARROW_WIDTH_PX || lives <= 3) expect(candles?.width ?? 0, 'the candles box is as wide as its candles').toBeLessThanOrEqual(own + 1);
      await context.close();
    });
  }
  for (const width of [NARROW_WIDTH_PX, WINDOW_WIDTH_PX]) {
    test(`at ${width} px the page has no horizontal scroll and no clipped text`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport: { width, height: width === NARROW_WIDTH_PX ? NARROW_HEIGHT_PX : WINDOW_HEIGHT_PX } });
      await context.addInitScript(DENY_SCRIPT);
      const page = await context.newPage();
      const seen = watch(page, new URL(baseURL as string).origin);
      await page.goto(`${SHOO_PAGE_URL}?speed=2`);
      await expectNoClipping(page, 'title');
      await page.getByRole('button', { name: 'Start listening' }).click();
      await expect(page.locator('#mic')).toBeVisible();
      await expectNoClipping(page, 'microphone card');
      await page.getByRole('button', { name: 'Play with keys' }).last().click();
      await expect(page.locator('#intro')).toBeVisible();
      await expectNoClipping(page, 'intro');
      await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
      await expect(bat(page).first()).toBeVisible({ timeout: STEP_TIMEOUT_MS });
      await page.keyboard.press('2');
      await expect(page.locator('.note').first()).toBeAttached();
      await expectNoClipping(page, 'battle');
      await page.getByRole('button', { name: 'Settings' }).click();
      await expectNoClipping(page, 'settings');
      await page.keyboard.press('Escape');
      await expectNoClipping(page, 'paused');
      await page.keyboard.press('Escape');
      await expect(page.locator('#lost')).toBeVisible({ timeout: KEYS_TEST_TIMEOUT_MS - STEP_TIMEOUT_MS });
      await expectNoClipping(page, 'game over');
      seen.check();
      await context.close();
    });
  }

  test('the screenshot of Shoo! is a small PNG, written only with TOKK_WRITE_SCREENSHOT=1', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: SCREENSHOT_WIDTH_PX, height: SCREENSHOT_HEIGHT_PX });
    await page.goto(`${SHOO_PAGE_URL}?speed=3&lives=9`);
    await page.getByRole('button', { name: 'Play with keys' }).click();
    await expect(page.locator('.mon')).toHaveCount(4, { timeout: STEP_TIMEOUT_MS });
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await expect(page.locator('#heard')).toContainText('Heard: clap');
    const png = await page.screenshot();
    expect([...png.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    expect(png.length).toBeLessThan(SCREENSHOT_MAX_BYTES);
    if (process.env.TOKK_WRITE_SCREENSHOT === '1') {
      mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
      writeFileSync(SCREENSHOT_PATH, png);
    }
    expect(baseURL).toBeTruthy();
  });
});

// ---- Task 38: Under the hood and the Built with Tokk link ----
const OVERLAY_HOST = '[data-tokk-overlay]';

test('Under the hood toggles the debug overlay, in keys mode too, and the state is not stored', async ({ page, baseURL }) => {
  const seen = watch(page, new URL(baseURL as string).origin);
  await page.goto(`${SHOO_PAGE_URL}?speed=2`);
  await page.getByRole('button', { name: 'Play with keys' }).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
  const hood = page.getByRole('button', { name: 'Under the hood' });
  await expect(hood).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(OVERLAY_HOST)).toHaveCount(0);

  await hood.click();
  await expect(hood).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(OVERLAY_HOST)).toHaveCount(1);
  await page.keyboard.press('1');
  await expect(page.locator(`${OVERLAY_HOST} li.event`)).toHaveCount(1, { timeout: STEP_TIMEOUT_MS });

  await hood.click();
  await expect(hood).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(OVERLAY_HOST)).toHaveCount(0);

  await hood.click();
  await page.reload();
  await expect(page.locator(OVERLAY_HOST)).toHaveCount(0);
  seen.check();
});

test('?debug=1 starts with Under the hood on', async ({ page }) => {
  await page.goto(`${SHOO_PAGE_URL}?speed=2&debug=1`);
  await page.getByRole('button', { name: 'Play with keys' }).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'battle', { timeout: STEP_TIMEOUT_MS });
  await expect(page.getByRole('button', { name: 'Under the hood' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(OVERLAY_HOST)).toHaveCount(1);
});

test('the Built with Tokk link has the line count and the line range of main.ts', async ({ page }) => {
  await page.goto(SHOO_PAGE_URL);
  const main = readFileSync(resolve(REPO_ROOT, 'apps', 'shoo', 'src', 'main.ts'), 'utf8').split(/\r?\n/);
  const start = main.findIndex((l) => l.startsWith('// tokk:start')) + 1;
  const end = main.findIndex((l) => l.startsWith('// tokk:end')) + 1;
  const link = page.getByRole('link', { name: /^Built with Tokk/ });
  await expect(link).toHaveText(`Built with Tokk \u00b7 ${countWiring(main.join('\n')).lines} lines`);
  await expect(link).toHaveAttribute('href', `https://github.com/subniin/tokk/blob/main/apps/shoo/src/main.ts#L${start}-L${end}`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
});
