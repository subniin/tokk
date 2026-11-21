// Task 34 run B: Click Talk in Chrome.
// The first run (teaching), the two-sound flow, the one-sound mode and the lost microphone use the fake microphone, which plays
// a WAV once from the moment its stream opens (test/web/click-talk-fixture.ts). Every test of these groups has its own context,
// so each stream starts at 0. The other tests use keys only (the microphone is denied) and a fake speechSynthesis that records
// what is said. The sounds are synthetic stand-ins: they show the wiring and the rules, not how well Tokk hears a real mouth.
// A key is pressed once and the test then waits for the result (a press inside a poll would repeat).
// Test-only page parameter (apps/click-talk/src/test-params.ts): ?room=short records the room sound for 10 s instead of 30 s.
import { chromium, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CATEGORIES, EMPTY_FREQUENT_TEXT, PHRASE_COUNT_MESSAGE } from '../../apps/click-talk/src/phrases';
import { DEFAULT_SETTINGS, saveSettings } from '../../apps/click-talk/src/settings';
import type { Settings } from '../../apps/click-talk/src/settings';
import { NO_VOICE_TEXT } from '../../apps/click-talk/src/speech';
import { BACKGROUND_LINE, MODE_TEXT, TEACH_LINE, TEACH_TITLE, WELCOME_TEXT } from '../../apps/click-talk/src/teach-texts';
import { FAKE_SPEECH_SCRIPT, TALK_FIRST, TALK_ONE, TALK_PLAY } from './click-talk-fixture';
import type { FakeSpeechConfig, SpeechWindow, TalkTimes } from './click-talk-fixture';
import {
  FIXTURE_TALK_FIRST_WAV_PATH, FIXTURE_TALK_ONE_WAV_PATH, FIXTURE_TALK_PLAY_WAV_PATH, FIXTURE_TALK_STORED_PATH, FIXTURE_TALK_TIMES_PATH,
  REPO_ROOT, TALK_PAGE_URL, fakeMicArgs,
} from './paths';

// Test-only values.
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 720;
const NARROW_WIDTH_PX = 320;
const NARROW_HEIGHT_PX = 640;
const SCREENSHOT_WIDTH_PX = 1000;
const SCREENSHOT_HEIGHT_PX = 640;
const SCREENSHOT_MAX_BYTES = 400_000;
const SCREENSHOT_PATH = resolve(REPO_ROOT, 'docs', 'images', 'click-talk.png');
const FIRST_RUN_TIMEOUT_MS = 180_000;
const MIC_TEST_TIMEOUT_MS = 120_000;
const KEYS_TEST_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;
const STREAM_SLACK_MS = 15_000;
const SETTLE_AFTER_SOUND_MS = 1200;              // from the start of a sound to the moment its result is on the screen
const SPEECH_SHOWN_MS = 3000;                    // SPEAK_SHOW_MS of the app
const FAKE_SPEECH_MS = 400;
const HELP_GUARD_WAIT_MS = 500;                  // the app ignores a key in the first 300 ms of help (HELP_ARM_MS)
const NO_REPEAT_WAIT_MS = 1500;                  // how long a test waits to see that something does NOT happen again
const CONTRAST_MIN_RATIO = 4.5;                  // WCAG AA for text
const CATEGORY_TEXT_MIN_PX = 30;
const PHRASE_TEXT_MIN_PX = 25;
const RING_MIN_PX = 6;
const STORAGE_KEYS = ['click-talk:settings', 'tokk:click-talk'];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const TIMES: TalkTimes = JSON.parse(readFileSync(FIXTURE_TALK_TIMES_PATH, 'utf8')) as TalkTimes;
const STORED = readFileSync(FIXTURE_TALK_STORED_PATH, 'utf8');
const NEEDS = CATEGORIES[0].phrases;
const BODY = CATEGORIES[1].phrases;

const DIALOG = '[data-tokk-teach]';
const dialogAction = (name: string): string => `${DIALOG} [data-action="${name}"]`;
const settingsText = (over: Partial<Settings> = {}): string => saveSettings({ ...DEFAULT_SETTINGS, ...over });

interface MicWindow { __micStartMs?: number; __gum?: number; __tracks?: MediaStreamTrack[] }

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
const storeScript = (o: { model: string | null; settings: string | null }): void => {
  // Only when nothing is there yet, so that a reload keeps what the app stored.
  if (o.model !== null && localStorage.getItem('tokk:click-talk') === null) localStorage.setItem('tokk:click-talk', o.model);
  if (o.settings !== null && localStorage.getItem('click-talk:settings') === null) localStorage.setItem('click-talk:settings', o.settings);
};

async function untilStream(page: Page, streamMs: number): Promise<void> {
  await page.waitForFunction(
    (ms) => { const s = (window as unknown as MicWindow).__micStartMs; return s !== undefined && performance.now() >= s + ms; },
    streamMs,
    { timeout: streamMs + STREAM_SLACK_MS + STEP_TIMEOUT_MS, polling: 50 },
  );
}

// Chrome starts a page's AudioContext only after a key or click (the tests run with the user-gesture policy). A returning user
// has made no gesture yet, so the test presses Shift once, which the app does not use, after the microphone has opened.
async function gesture(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as MicWindow).__micStartMs !== undefined, undefined, { timeout: STEP_TIMEOUT_MS });
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift');
}

const app = (page: Page) => page.locator('#app');
const board = (page: Page) => page.locator('#board');
const said = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as SpeechWindow).__said ?? []);
const heardCount = async (page: Page): Promise<number> => Number(await page.locator('#sounds').getAttribute('data-heard'));

async function expectBoard(page: Page, level: string, category?: string, index?: number, timeout = STEP_TIMEOUT_MS): Promise<void> {
  await expect(board(page)).toHaveAttribute('data-level', level, { timeout });
  if (category !== undefined) await expect(board(page)).toHaveAttribute('data-category', category, { timeout });
  if (index !== undefined) await expect(board(page)).toHaveAttribute('data-index', String(index), { timeout });
}

// Presses one key and waits for the result. The key goes through the Worker, so the board changes a moment later.
async function press(page: Page, key: string, level: string, category: string, index: number): Promise<void> {
  await page.keyboard.press(key);
  await expectBoard(page, level, category, index);
}

// The app ignores a key in the first 300 ms of help, so the test waits a little, presses the key once, and waits for the result.
async function stopHelpWith(page: Page, key: string): Promise<void> {
  await page.waitForTimeout(HELP_GUARD_WAIT_MS);
  await page.keyboard.press(key);
  await expect(page.locator('#help')).toBeHidden();
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
      const name = (e.textContent ?? '').trim().slice(0, 30);
      if (r.left < -1 || r.right > width + 1) out.push(`"${name}" is outside the window (${Math.round(r.left)} to ${Math.round(r.right)} of ${width})`);
      if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1) out.push(`"${name}" is wider than its box (${e.scrollWidth} > ${e.clientWidth})`);
    }
    return out;
  });
  expect(report, where).toEqual([]);
}

// The contrast of every visible text against what it is drawn on: its own background and the ones behind it, mixed with the
// opacity of its ancestors (the tiles that step back to 72 %). Text that another element covers is not counted.
async function contrastProblems(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    interface Rgba { r: number; g: number; b: number; a: number }
    const parse = (c: string): Rgba => { const m = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const mix = (top: Rgba, under: Rgba, a: number): Rgba => ({ r: a * top.r + (1 - a) * under.r, g: a * top.g + (1 - a) * under.g, b: a * top.b + (1 - a) * under.b, a: 1 });
    const channel = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c: Rgba): number => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const page = parse(getComputedStyle(document.documentElement).backgroundColor);
    const out: string[] = [];
    for (const e of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      if (e.closest('svg') !== null || e.closest('[hidden]') !== null) continue;
      if (!Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1));
      if (top === null || !(e.contains(top) || top.contains(e))) continue;
      let opacity = 1;
      const layers: Rgba[] = [];
      for (let n: HTMLElement | null = e; n !== null; n = n.parentElement) {
        const cs = getComputedStyle(n);
        opacity *= Number(cs.opacity);
        const bg = parse(cs.backgroundColor);
        if (bg.a > 0) layers.push(bg);
      }
      let background = page;
      for (const l of layers.reverse()) background = mix(l, background, l.a);
      const foreground = mix(parse(getComputedStyle(e).color), background, 1);
      const fg = mix(foreground, page, opacity);
      const bg = mix(background, page, opacity);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < min) out.push(`"${(e.textContent ?? '').trim().slice(0, 30)}" has contrast ${ratio.toFixed(2)}`);
    }
    return out;
  }, CONTRAST_MIN_RATIO);
}

async function expectContrast(page: Page, where: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await contrastProblems(page), `${where}, ${scheme} theme`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

// The sizes the screen rules ask for, read from the page.
async function expectBoardRules(page: Page, where: string): Promise<void> {
  const r = await page.evaluate(() => {
    const px = (e: Element): number => parseFloat(getComputedStyle(e).fontSize);
    const level = document.getElementById('board')?.dataset.level ?? '';
    const onPhrases = level !== 'categories';
    const texts = Array.from(document.querySelectorAll<HTMLElement>(onPhrases ? '#g-phr .tile strong' : '#g-cats .tile strong')).map(px);
    const on = document.querySelector<HTMLElement>('#g-cats:not([hidden]) .tile.on, #g-phr:not([hidden]) .tile.on');
    const cs = on === null ? null : getComputedStyle(on);
    const rect = on?.getBoundingClientRect();
    const spreads = cs === null ? [] : (cs.boxShadow.match(/(\d+(?:\.\d+)?)px(?=,|$)/g) ?? []).map(parseFloat);
    return {
      onPhrases, minText: Math.min(...texts), count: texts.length,
      ringPx: Math.max(0, ...spreads), transition: cs?.transitionDuration ?? '', animation: cs?.animationName ?? '',
      ringInside: rect === undefined ? true : rect.left - Math.max(0, ...spreads) >= 0 && rect.right + Math.max(0, ...spreads) <= document.documentElement.clientWidth,
    };
  });
  expect(r.count, where).toBeGreaterThan(0);
  expect(r.minText, `${where}: cell text`).toBeGreaterThanOrEqual(r.onPhrases ? PHRASE_TEXT_MIN_PX : CATEGORY_TEXT_MIN_PX);
  expect(r.ringPx, `${where}: scan ring`).toBeGreaterThanOrEqual(RING_MIN_PX);
  expect(r.transition, `${where}: the frame moves at once`).toMatch(/^0s(, 0s)*$/);
  expect(r.animation, `${where}: the frame has no animation`).toBe('none');
  expect(r.ringInside, `${where}: the ring is inside the window`).toBe(true);
}

async function doneAndSave(page: Page): Promise<void> {
  await expect(page.locator(dialogAction('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('done'));
  await saveAndClose(page);
}
async function saveAndClose(page: Page, last = false): Promise<void> {
  await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('save'));
  await page.click(dialogAction('close'));
  if (last) await expect(page.locator(DIALOG)).toHaveCount(0);
}

// ---- Contexts ----
interface Options { model?: string | null; settings?: string | null; speech?: FakeSpeechConfig; deny?: boolean; mic?: boolean; width?: number; height?: number }

async function open(browser: Browser, baseURL: string | undefined, o: Options = {}): Promise<{ page: Page; seen: ReturnType<typeof watch>; context: BrowserContext }> {
  const context = await browser.newContext({ baseURL, viewport: { width: o.width ?? WINDOW_WIDTH_PX, height: o.height ?? WINDOW_HEIGHT_PX } });
  if (o.mic === true) await context.addInitScript(MIC_SCRIPT);
  if (o.deny === true) await context.addInitScript(DENY_SCRIPT);
  await context.addInitScript(FAKE_SPEECH_SCRIPT, o.speech ?? { voices: true, durationMs: FAKE_SPEECH_MS });
  if ((o.model ?? null) !== null || (o.settings ?? null) !== null) await context.addInitScript(storeScript, { model: o.model ?? null, settings: o.settings ?? null });
  const page = await context.newPage();
  const seen = watch(page, new URL(baseURL as string).origin);
  return { page, seen, context };
}

// A returning user without a microphone: the card appears, "Use keys" opens the board.
async function keysBoard(browser: Browser, baseURL: string | undefined, o: Options = {}): Promise<{ page: Page; seen: ReturnType<typeof watch>; context: BrowserContext }> {
  const r = await open(browser, baseURL, { model: STORED, settings: settingsText(), deny: true, ...o });
  await r.page.goto(TALK_PAGE_URL);
  await expect(r.page.locator('#mic')).toBeVisible();
  await r.page.getByRole('button', { name: 'Use keys' }).click();
  await expect(r.page.locator('#mic')).toBeHidden();
  await expectBoard(r.page, 'categories', 'needs', 0);
  return r;
}

// ---- The first run: mode, click, pop, the room sound for 10 s, then the board ----
test.describe.serial('first run with the fake microphone', () => {
  test.setTimeout(FIRST_RUN_TIMEOUT_MS);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let seen: ReturnType<typeof watch>;

  test.beforeAll(async ({ baseURL }) => {
    browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_TALK_FIRST_WAV_PATH) });
    ({ page, seen, context } = await open(browser, baseURL, { mic: true }));
  });
  test.afterAll(async () => { await browser?.close(); });

  test('welcome, mode, teach click, pop and the room, then the board hears the new sounds', async () => {
    await page.goto(`${TALK_PAGE_URL}?room=short`);
    await expect(page.locator('#welcome-title')).toHaveText(WELCOME_TEXT.title);
    await expect(page.locator('#welcome-lead')).toHaveText(WELCOME_TEXT.lead);
    await expect(page.locator('#welcome-setup')).toHaveText(WELCOME_TEXT.setup);
    await expect(page.locator('#welcome-privacy')).toHaveText(WELCOME_TEXT.privacy);
    await page.getByRole('button', { name: WELCOME_TEXT.button }).click();

    await expect(page.locator('#mode-question')).toHaveText(MODE_TEXT.question);
    await expect(page.locator('#mode-one-body')).toHaveText(MODE_TEXT.one.body);
    await page.locator('#mode-two').click();

    // 1. The click, taught 10 times with the app's words.
    await expect(page.locator(`${DIALOG} h2`)).toHaveText(TEACH_TITLE.click, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(DIALOG)).toContainText(TEACH_LINE.click);
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.first.clickStartsMs.length, { timeout: STEP_TIMEOUT_MS + TALK_FIRST.popAtMs });
    await doneAndSave(page);

    // 2. The pop.
    await expect(page.locator(`${DIALOG} h2`)).toHaveText(TEACH_TITLE.pop, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(DIALOG)).toContainText(TEACH_LINE.pop);
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.first.popStartsMs.length, { timeout: STEP_TIMEOUT_MS + TALK_FIRST.roomNoiseAtMs });
    await doneAndSave(page);

    // 3. The room (30 s of the plan, 10 s with the test parameter). It finishes by itself. Close it after the room sound of the
    // stream has ended.
    await expect(page.locator(`${DIALOG} h2`)).toHaveText(TEACH_TITLE.background, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(DIALOG)).toContainText(BACKGROUND_LINE);
    await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS + TALK_FIRST.roomNoiseAtMs + TALK_FIRST.roomNoiseMs });
    await untilStream(page, TIMES.first.roomNoiseEndMs + TALK_FIRST.roomSettleMs);
    await saveAndClose(page, true);

    // 4. The board, with the model stored as feature vectors under the app's key, and nothing else but the settings.
    await expect(app(page)).toHaveAttribute('data-screen', 'board');
    await expectBoard(page, 'categories', 'needs', 0);
    const stored = await page.evaluate((k) => localStorage.getItem(k), 'tokk:click-talk');
    const entry = JSON.parse(stored as string) as { model: { examples: { id: string; label: string; v: number[] }[] } };
    expect([...new Set(entry.model.examples.map((e) => e.label))].sort()).toEqual(['background', 'click', 'pop']);
    for (const e of entry.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect((await page.evaluate(() => Object.keys(localStorage))).sort()).toEqual(STORAGE_KEYS);

    // 5. The click of the stream moves to Body and the pop chooses it: the new model hears both.
    await untilStream(page, TIMES.first.boardClickMs + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'categories', 'body', 0);
    await untilStream(page, TIMES.first.boardPopMs + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'phrases', 'body', 0);
    seen.check();
    await context.close();
  });
});

// ---- Two sounds, returning user, the play stream ----
test.describe('two-sound mode with the play stream', () => {
  test.setTimeout(MIC_TEST_TIMEOUT_MS);
  let browser: Browser;

  test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_TALK_PLAY_WAV_PATH) }); });
  test.afterAll(async () => { await browser?.close(); });

  test('click moves, pop chooses, the phrase is spoken, two pops choose once, three pops start help and a click stops it', async ({ baseURL }) => {
    const { page, seen, context } = await open(browser, baseURL, { mic: true, model: STORED, settings: settingsText() });
    let dialogSeen = false;
    await page.goto(TALK_PAGE_URL);
    await expect(app(page)).toHaveAttribute('data-screen', 'board');
    await expectBoard(page, 'categories', 'needs', 0);
    await gesture(page);
    await expect(app(page)).toHaveAttribute('data-source', 'mic');
    await expect(page.locator('#live-text')).toHaveText('Listening');

    // click moves to Body, pop opens it, click moves to the first phrase.
    await untilStream(page, TALK_PLAY.clickMs[0] + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'categories', 'body', 0);
    await expect(page.locator('#sounds .snd[data-sound="click"]')).toBeVisible();
    await untilStream(page, TALK_PLAY.popMs[0] + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'phrases', 'body', 0);
    await expect(page.locator('#crumb')).toHaveText('Body');
    await untilStream(page, TALK_PLAY.clickMs[1] + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'phrases', 'body', 1);
    dialogSeen ||= (await page.locator(DIALOG).count()) > 0;

    // pop chooses the phrase: it is shown large, spoken with the local voice, and listening is paused meanwhile.
    await untilStream(page, TALK_PLAY.popMs[1] + SETTLE_AFTER_SOUND_MS);
    await expect(page.locator('#spoken')).toBeVisible();
    await expect(page.locator('#say-text')).toHaveText(BODY[0]);
    await expect(page.locator('#spoken')).toContainText('Speaking. Listening is paused.');
    await expect(app(page)).toHaveAttribute('data-listening', 'paused');
    expect(await said(page)).toEqual([BODY[0]]);
    expect(await page.evaluate(() => (window as unknown as SpeechWindow).__saidWith)).toEqual(['Test Local']);
    // The click of the stream during the speech is not heard: listening is paused.
    await untilStream(page, TALK_PLAY.duringSpeechClickMs - 500);
    const heardBefore = await heardCount(page);
    await untilStream(page, TALK_PLAY.duringSpeechClickMs + SETTLE_AFTER_SOUND_MS);
    expect(await heardCount(page)).toBe(heardBefore);
    await expect(page.locator('#spoken')).toBeVisible();
    // After 3 s and the end of the speech the board is back on the categories, listening again.
    await expect(page.locator('#spoken')).toBeHidden({ timeout: STEP_TIMEOUT_MS });
    await expectBoard(page, 'categories', 'body', 0);
    await expect(app(page)).toHaveAttribute('data-listening', 'on');
    await expect(page.locator('#g-cats .tile.freq small')).toHaveText(`Last said: ${BODY[0]}`);

    // two pops then silence: exactly one choose (a second one would choose Back and leave the phrase board).
    await untilStream(page, TALK_PLAY.twoPopsAtMs + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'phrases', 'body', 0);
    await page.waitForTimeout(NO_REPEAT_WAIT_MS);
    await expectBoard(page, 'phrases', 'body', 0);

    // pop pop pop: help, the whole screen red, the alarm, listening paused.
    await untilStream(page, TALK_PLAY.threePopsAtMs + SETTLE_AFTER_SOUND_MS);
    await expect(page.locator('#help')).toBeVisible();
    await expect(page.locator('#help h1')).toHaveText('I need help now.');
    await expect(page.locator('#help')).toContainText('Press any key or click to stop the alarm.');
    await expect(app(page)).toHaveAttribute('data-listening', 'paused');
    const heardInHelp = await heardCount(page);
    await untilStream(page, TALK_PLAY.duringAlarmClickMs + SETTLE_AFTER_SOUND_MS);
    expect(await heardCount(page)).toBe(heardInHelp);
    await expect(page.locator('#help')).toBeVisible();
    // A click stops it, back to the phrase board it came from.
    await page.locator('#help').click();
    await expect(page.locator('#help')).toBeHidden();
    await expectBoard(page, 'phrases', 'body', 0);
    await expect(app(page)).toHaveAttribute('data-listening', 'on');
    expect(dialogSeen, 'no teach dialog for a returning user').toBe(false);
    expect(await page.evaluate((k) => localStorage.getItem(k), 'tokk:click-talk')).toBe(STORED);   // the model was not stored again
    seen.check();
    await context.close();
  });

  test('a returning user skips every teach step', async ({ baseURL }) => {
    const { page, seen, context } = await open(browser, baseURL, { mic: true, model: STORED, settings: settingsText() });
    await page.goto(TALK_PAGE_URL);
    await expect(app(page)).toHaveAttribute('data-screen', 'board');
    await expect(page.locator('#welcome')).toBeHidden();
    await expect(page.locator('#mode')).toBeHidden();
    await gesture(page);
    await untilStream(page, TALK_PLAY.clickMs[0] + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'categories', 'body', 0);
    expect(await page.locator(DIALOG).count(), 'no teach dialog for a returning user').toBe(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), 'tokk:click-talk')).toBe(STORED);
    seen.check();
    await context.close();
  });

  test('a lost microphone shows the card, keys keep working, Reconnect listens again', async ({ baseURL }) => {
    const { page, seen, context } = await open(browser, baseURL, { mic: true, model: STORED, settings: settingsText() });
    await page.goto(TALK_PAGE_URL);
    await gesture(page);
    await expect(page.locator('#live-text')).toHaveText('Listening');
    await page.evaluate(() => { for (const t of (window as unknown as MicWindow).__tracks ?? []) { t.stop(); t.dispatchEvent(new Event('ended')); } });
    const card = page.locator('#mic');
    await expect(card).toBeVisible();
    await expect(page.locator('#mic-title')).toHaveText('The microphone went quiet.');
    await expect(page.locator('#mic-body')).toHaveText('It may have been unplugged or taken by another app.');
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    await expect(app(page)).toHaveAttribute('data-source', 'keys');
    await expect(page.locator('#sounds .snd.mode')).toHaveText('Keyboard mode');
    await expect(page.locator('#sounds .hint')).toHaveText('Space next / Enter choose');
    // The card does not take the focus: the keys go to the board.
    await expectBoard(page, 'categories', 'needs', 0);
    await press(page, ' ', 'categories', 'body', 0);
    await press(page, 'Enter', 'phrases', 'body', 0);
    await press(page, ' ', 'phrases', 'body', 1);
    await page.getByRole('button', { name: 'Reconnect' }).click();
    await expect(card).toBeHidden();
    await expect(app(page)).toHaveAttribute('data-source', 'mic');
    await expect(page.locator('#live-text')).toHaveText('Listening');
    await expect(page.locator('#sounds .snd.mode')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as MicWindow).__gum)).toBeGreaterThanOrEqual(2);
    seen.check();
    await context.close();
  });
});

// ---- One sound: the frame moves by itself ----
test.describe('one-sound mode with the one-sound stream', () => {
  test.setTimeout(MIC_TEST_TIMEOUT_MS);
  let browser: Browser;

  test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_TALK_ONE_WAV_PATH) }); });
  test.afterAll(async () => { await browser?.close(); });

  test('the frame moves by itself, a click chooses, click click click starts help, click click chooses once', async ({ baseURL }) => {
    const { page, seen, context } = await open(browser, baseURL, { mic: true, model: STORED, settings: settingsText({ mode: 'one', scanMs: 5000 }) });
    await page.goto(TALK_PAGE_URL);
    await expectBoard(page, 'categories', 'needs', 0);
    await expect(page.locator('#g-cats .tile.on .cue')).toHaveText('click to choose');
    await gesture(page);
    await expect(page.locator('#sounds .snd[data-sound="click"]')).toContainText('choose');
    await expect(page.locator('#sounds .snd[data-sound="pop"]')).toHaveCount(0);

    // A click chooses the category the frame is on.
    await untilStream(page, TALK_ONE.clickAtMs + SETTLE_AFTER_SOUND_MS);
    await expectBoard(page, 'phrases', 'needs', 0);
    // Then, with no key and no sound, the frame goes to the next cell by itself.
    await expectBoard(page, 'phrases', 'needs', 1, 3 * STEP_TIMEOUT_MS / 2);

    // click click click: help; a click of the mouse stops it.
    await untilStream(page, TALK_ONE.threeClicksAtMs + SETTLE_AFTER_SOUND_MS);
    await expect(page.locator('#help')).toBeVisible();
    await expect(app(page)).toHaveAttribute('data-listening', 'paused');
    await page.locator('#help').click();
    await expect(page.locator('#help')).toBeHidden();
    await expectBoard(page, 'phrases', 'needs', 1);

    // click click then silence: one choose, so exactly one phrase is spoken.
    await untilStream(page, TALK_ONE.twoClicksAtMs + SETTLE_AFTER_SOUND_MS);
    await expect(page.locator('#spoken')).toBeVisible();
    await expect(page.locator('#say-text')).toHaveText(NEEDS[0]);
    await expect(page.locator('#spoken')).toBeHidden({ timeout: STEP_TIMEOUT_MS });
    expect(await said(page)).toEqual([NEEDS[0]]);
    seen.check();
    await context.close();
  });
});

// ---- Keys only ----
test.describe('keys only', () => {
  test.setTimeout(KEYS_TEST_TIMEOUT_MS);

  test('the microphone is denied at the start: the card, Use keys, then Space and Enter run the whole board', async ({ browser, baseURL }) => {
    const { page, seen, context } = await open(browser, baseURL, { deny: true });
    await page.goto(TALK_PAGE_URL);
    await page.getByRole('button', { name: WELCOME_TEXT.button }).click();
    await page.locator('#mode-two').click();
    await expect(page.locator('#mic')).toBeVisible();
    await expect(page.locator('#mic-title')).toHaveText('Click Talk cannot hear the microphone.');
    await expect(page.locator('#mic-body')).toHaveText('Allow microphone access in the address bar, or use keys: Space moves, Enter chooses. Many switch devices send these keys.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.getByRole('button', { name: 'Use keys' }).click();

    await expectBoard(page, 'categories', 'needs', 0);
    await expect(app(page)).toHaveAttribute('data-source', 'keys');
    await expect(page.locator('#sounds .snd').first()).toHaveText('Keyboard mode');
    await expect(page.locator('#sounds .hint')).toHaveText('Space next / Enter choose');
    await expect(page.locator('#live-text')).toHaveText('Not listening');
    expect(await page.locator(DIALOG).count(), 'no teach dialog without a microphone').toBe(0);

    await press(page, ' ', 'categories', 'body', 0);
    await press(page, 'Enter', 'phrases', 'body', 0);
    await press(page, ' ', 'phrases', 'body', 1);
    await page.keyboard.press('Enter');
    await expect(page.locator('#spoken')).toBeVisible();
    await expect(page.locator('#say-text')).toHaveText(BODY[0]);
    await expect(page.locator('#spoken')).toBeHidden({ timeout: STEP_TIMEOUT_MS });
    await expectBoard(page, 'categories', 'body', 0);
    expect(await said(page)).toEqual([BODY[0]]);

    // Frequent now holds the phrase. Help is the sixth cell.
    await expect(page.locator('#g-cats .tile.freq small')).toHaveText(`Last said: ${BODY[0]}`);
    await press(page, ' ', 'categories', 'people', 0);
    await press(page, ' ', 'categories', 'talk', 0);
    await press(page, ' ', 'categories', 'frequent', 0);
    await press(page, ' ', 'categories', 'help', 0);
    await page.keyboard.press('Enter');
    await expect(page.locator('#help')).toBeVisible();
    await expect(app(page)).toHaveAttribute('data-listening', 'paused');
    await stopHelpWith(page, 'a');
    await expectBoard(page, 'categories', 'help', 0);
    await expect(app(page)).toHaveAttribute('data-listening', 'off');
    expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('tokk:click-talk');   // no teaching without a microphone
    seen.check();
    await context.close();
  });

  test('Try again after a refusal asks for the microphone again', async ({ browser, baseURL }) => {
    const { page, context } = await open(browser, baseURL, { deny: true });
    await page.goto(TALK_PAGE_URL);
    await page.getByRole('button', { name: WELCOME_TEXT.button }).click();
    await page.locator('#mode-one').click();
    await expect(page.locator('#mic')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#mic')).toBeVisible();   // refused again
    await context.close();
  });

  test('two Enter presses then silence choose once, three open help', async ({ browser, baseURL }) => {
    const { page, seen, context } = await keysBoard(browser, baseURL);
    // Enter is pop. Two presses, then silence: one choose.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expectBoard(page, 'phrases', 'needs', 0);
    await page.waitForTimeout(NO_REPEAT_WAIT_MS);
    await expectBoard(page, 'phrases', 'needs', 0);
    // Three presses in a row: help, from the phrase board.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#help')).toBeVisible();
    await stopHelpWith(page, 'Escape');
    await expectBoard(page, 'phrases', 'needs', 0);
    seen.check();
    await context.close();
  });

  test('one sound with keys: Space and Enter are both a click that chooses', async ({ browser, baseURL }) => {
    const { page, seen, context } = await keysBoard(browser, baseURL, { settings: settingsText({ mode: 'one', scanMs: 5000 }) });
    await expect(page.locator('#sounds .hint')).toHaveText('Space or Enter choose');
    await press(page, ' ', 'phrases', 'needs', 0);
    await press(page, 'Enter', 'categories', 'needs', 0);
    seen.check();
    await context.close();
  });

  test('the Help cell opens help and any key stops it', async ({ browser, baseURL }) => {
    const { page, seen, context } = await keysBoard(browser, baseURL);
    for (const id of ['body', 'people', 'talk', 'frequent', 'help']) await press(page, ' ', 'categories', id, 0);
    await page.keyboard.press('Enter');
    await expect(page.locator('#help')).toBeVisible();
    await stopHelpWith(page, 'Enter');
    await expectBoard(page, 'categories', 'help', 0);
    seen.check();
    await context.close();
  });
});

// ---- No offline voice ----
test('with no offline voice the phrase is shown for 3 s and the note appears once', async ({ browser, baseURL }) => {
  test.setTimeout(KEYS_TEST_TIMEOUT_MS);
  const { page, seen, context } = await keysBoard(browser, baseURL, { speech: { voices: false, durationMs: FAKE_SPEECH_MS } });
  await press(page, 'Enter', 'phrases', 'needs', 0);
  await press(page, ' ', 'phrases', 'needs', 1);
  await page.keyboard.press('Enter');
  const shownAt = Date.now();
  await expect(page.locator('#say-text')).toHaveText(NEEDS[0]);
  await expect(page.locator('#say-note')).toHaveText(NO_VOICE_TEXT);
  await expect(page.locator('#spoken')).toBeHidden({ timeout: STEP_TIMEOUT_MS });
  expect(Date.now() - shownAt, 'the phrase is shown for 3 s').toBeGreaterThanOrEqual(SPEECH_SHOWN_MS - 300);
  expect(await said(page)).toEqual([]);
  await expectBoard(page, 'categories', 'needs', 0);
  // The second phrase: shown again, but the note is not.
  await press(page, 'Enter', 'phrases', 'needs', 0);
  await press(page, ' ', 'phrases', 'needs', 1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#say-text')).toHaveText(NEEDS[0]);
  await expect(page.locator('#say-note')).toBeHidden();
  await expect(page.locator('#spoken')).toBeHidden({ timeout: STEP_TIMEOUT_MS });
  seen.check();
  await context.close();
});

test('online voices are not used while they are off', async ({ browser, baseURL }) => {
  // The fake lists "Test Online" first (English, not local) and "Test Local" second: only the local one may speak.
  const { page, seen, context } = await keysBoard(browser, baseURL);
  await press(page, 'Enter', 'phrases', 'needs', 0);
  await press(page, ' ', 'phrases', 'needs', 1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#spoken')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as SpeechWindow).__saidWith)).toEqual(['Test Local']);
  seen.check();
  await context.close();
});

// ---- The caregiver ----
test.describe('caregiver settings', () => {
  test.setTimeout(KEYS_TEST_TIMEOUT_MS);

  test('an edited phrase shows on the board and stays after a reload', async ({ browser, baseURL }) => {
    const { page, seen, context } = await keysBoard(browser, baseURL);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('#settings-title')).toHaveText('Settings');
    await expect(page.locator('#settings')).toContainText('For the caregiver');
    await expect(page.locator('#settings')).toContainText('Click Talk is not a medical device. Do not rely on it in an emergency.');
    await expect(page.locator('#settings')).toContainText('Online voices send the text, not the audio, to the browser\'s speech service.');
    await expect(page.locator('#online')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Test the alarm' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Teach the sounds again' })).toBeDisabled();   // no microphone
    // The voice list shows the local voice with its label, and no online voice while they are off.
    await expect(page.locator('#voice option')).toHaveText(['Automatic', 'Test Local (on this device)']);
    await page.locator('#online').check();
    await expect(page.locator('#voice option')).toHaveText(['Automatic', 'Test Online (online)', 'Test Local (on this device)']);
    await page.locator('#online').uncheck();
    // Edit the first phrase of Needs.
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.getByLabel('Edit phrase 1').fill('I am very thirsty.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.phrase-row').first()).toContainText('I am very thirsty.');
    await expect(page.locator('#phrase-message')).toBeHidden();
    await page.getByRole('button', { name: 'Back to the board' }).click();
    await expectBoard(page, 'categories', 'needs', 0);
    await press(page, 'Enter', 'phrases', 'needs', 0);
    await expect(page.locator('#g-phr .grid .tile strong').first()).toHaveText('I am very thirsty.');
    const settings = JSON.parse(await page.evaluate(() => localStorage.getItem('click-talk:settings') ?? '{}')) as Settings;
    expect(settings.phrases[0].phrases[0]).toBe('I am very thirsty.');
    await page.reload();
    await page.getByRole('button', { name: 'Use keys' }).click();
    await press(page, 'Enter', 'phrases', 'needs', 0);
    await expect(page.locator('#g-phr .grid .tile strong').first()).toHaveText('I am very thirsty.');
    seen.check();
    await context.close();
  });

  test('a list of 7 phrases shows the message and the board keeps the last valid list', async ({ browser, baseURL }) => {
    const { page, seen, context } = await keysBoard(browser, baseURL);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'People' }).click();
    await expect(page.locator('.phrase-row')).toHaveCount(6);
    await page.getByRole('button', { name: 'Add phrase' }).click();
    await page.getByLabel('New phrase').fill('Open the window.');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.phrase-row')).toHaveCount(7);
    await expect(page.locator('#phrase-message')).toHaveText(PHRASE_COUNT_MESSAGE);
    let stored = JSON.parse(await page.evaluate(() => localStorage.getItem('click-talk:settings') ?? '{}')) as Settings;
    expect(stored.phrases[2].phrases).toHaveLength(6);
    // The board keeps the six phrases.
    await page.getByRole('button', { name: 'Back to the board' }).click();
    await press(page, ' ', 'categories', 'body', 0);
    await press(page, ' ', 'categories', 'people', 0);
    await press(page, 'Enter', 'phrases', 'people', 0);
    await expect(page.locator('#g-phr .tile:not(.back)')).toHaveCount(6);
    // Back in the settings the draft is gone. Adding two phrases makes 8, which is valid and is saved.
    await press(page, 'Enter', 'categories', 'people', 0);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'People' }).click();
    for (const text of ['Open the window.', 'Close the door.']) {
      await page.getByRole('button', { name: 'Add phrase' }).click();
      await page.getByLabel('New phrase').fill(text);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.locator('.phrase-row')).toHaveCount(8);
    await expect(page.locator('#phrase-message')).toBeHidden();
    stored = JSON.parse(await page.evaluate(() => localStorage.getItem('click-talk:settings') ?? '{}')) as Settings;
    expect(stored.phrases[2].phrases).toHaveLength(8);
    // Remove one: 7 again, the message, and the saved list stays at 8. Another removal: 6, valid.
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.locator('#phrase-message')).toHaveText(PHRASE_COUNT_MESSAGE);
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.locator('#phrase-message')).toBeHidden();
    stored = JSON.parse(await page.evaluate(() => localStorage.getItem('click-talk:settings') ?? '{}')) as Settings;
    expect(stored.phrases[2].phrases).toHaveLength(6);
    // An empty phrase is refused too.
    await page.getByRole('button', { name: 'Add phrase' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('#phrase-message')).toHaveText('A phrase cannot be empty.');
    seen.check();
    await context.close();
  });

  test('the mode and the speed are kept, and the alarm test pauses listening', async ({ browser, baseURL }) => {
    const { page, seen, context } = await keysBoard(browser, baseURL);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'One sound' }).click();
    await expect(page.getByRole('button', { name: 'One sound' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#scan').fill('3000');
    await expect(page.locator('#scan-text')).toContainText('3.0 s per step');
    await page.locator('#rate').fill('1.5');
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('click-talk:settings') ?? '{}')) as Settings;
    expect(stored.mode).toBe('one');
    expect(stored.scanMs).toBe(3000);
    expect(stored.rate).toBe(1.5);
    await page.getByRole('button', { name: 'Test the alarm' }).click();
    await expect(app(page)).toHaveAttribute('data-listening', 'paused');
    await expect(app(page)).toHaveAttribute('data-listening', 'off', { timeout: STEP_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Back to the board' }).click();
    await expect(app(page)).toHaveAttribute('data-mode', 'one');
    await expect(page.locator('#sounds .hint')).toHaveText('Space or Enter choose');
    seen.check();
    await context.close();
  });
});

// ---- Screen rules ----
test.describe('screen rules at two widths', () => {
  test.setTimeout(KEYS_TEST_TIMEOUT_MS);

  for (const [width, height] of [[WINDOW_WIDTH_PX, WINDOW_HEIGHT_PX], [NARROW_WIDTH_PX, NARROW_HEIGHT_PX]]) {
    test(`${width} px: nothing is clipped, the text and the ring are big enough, the contrast is AA in both themes`, async ({ browser, baseURL }) => {
      const { page, seen, context } = await open(browser, baseURL, { deny: true, width, height });
      const check = async (where: string): Promise<void> => {
        await expectNoClipping(page, `${where} at ${width} px`);
        await expectContrast(page, `${where} at ${width} px`);
        if (where.startsWith('categories') || where.startsWith('phrases')) await expectBoardRules(page, `${where} at ${width} px`);
      };
      await page.goto(TALK_PAGE_URL);
      await expect(page.locator('#welcome-start')).toBeVisible();
      await check('welcome');
      await page.locator('#welcome-start').click();
      await expect(page.locator('#mode-two')).toBeVisible();
      await check('mode');
      await page.locator('#mode-two').click();
      await expect(page.locator('#mic')).toBeVisible();
      await check('microphone card');
      await page.locator('#mic-keys').click();
      await expectBoard(page, 'categories', 'needs', 0);
      await check('categories');
      await press(page, ' ', 'categories', 'body', 0);
      await check('categories, Body');
      await press(page, 'Enter', 'phrases', 'body', 0);
      await check('phrases, Back');
      await press(page, ' ', 'phrases', 'body', 1);
      await check('phrases, first');
      for (let i = 2; i <= BODY.length; i++) await press(page, ' ', 'phrases', 'body', i);
      await check('phrases, last');
      await page.keyboard.press('Enter');
      await expect(page.locator('#spoken')).toBeVisible();
      await check('speaking');
      await expect(page.locator('#spoken')).toBeHidden({ timeout: STEP_TIMEOUT_MS });
      await expectBoard(page, 'categories', 'body', 0);
      await check('categories, with Last said');
      for (const id of ['people', 'talk', 'frequent', 'help']) await press(page, ' ', 'categories', id, 0);
      await page.keyboard.press('Enter');
      await expect(page.locator('#help')).toBeVisible();
      await check('help');
      await stopHelpWith(page, 'a');
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.locator('#settings-title')).toBeVisible();
      await check('settings');
      await page.getByRole('button', { name: 'Add phrase' }).click();
      await check('settings, a new phrase');
      seen.check();
      await context.close();
    });
  }

  test('with reduced motion the welcome board and the speaking bar stand still', async ({ browser, baseURL }) => {
    const { page, context } = await keysBoard(browser, baseURL);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await press(page, 'Enter', 'phrases', 'needs', 0);
    await press(page, ' ', 'phrases', 'needs', 1);
    await page.keyboard.press('Enter');
    await expect(page.locator('#spoken')).toBeVisible();
    expect(await page.locator('#say-bar').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    await context.close();
    const welcome = await open(browser, baseURL, { deny: true });
    await welcome.page.emulateMedia({ reducedMotion: 'reduce' });
    await welcome.page.goto(TALK_PAGE_URL);
    for (const i of [1, 2, 3, 4]) {
      expect(await welcome.page.locator(`.demo .tile:nth-child(${i})`).evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    }
    await welcome.context.close();
    const moving = await open(browser, baseURL, { deny: true });
    await moving.page.emulateMedia({ reducedMotion: 'no-preference' });
    await moving.page.goto(TALK_PAGE_URL);
    expect(await moving.page.locator('.demo .tile:nth-child(1)').evaluate((e) => getComputedStyle(e).animationName)).not.toBe('none');
    await moving.context.close();
  });
});

// ---- Screenshot for the README: only when TOKK_WRITE_SCREENSHOT=1 ----
test('writes docs/images/click-talk.png only when asked', async ({ browser, baseURL }) => {
  test.skip(process.env.TOKK_WRITE_SCREENSHOT !== '1', 'set TOKK_WRITE_SCREENSHOT=1 to write the screenshot');
  const { page, context } = await keysBoard(browser, baseURL, { width: SCREENSHOT_WIDTH_PX, height: SCREENSHOT_HEIGHT_PX });
  await press(page, ' ', 'categories', 'body', 0);
  await press(page, 'Enter', 'phrases', 'body', 0);
  await press(page, ' ', 'phrases', 'body', 1);
  await press(page, ' ', 'phrases', 'body', 2);
  const png = await page.screenshot({ type: 'png' });
  expect(Array.from(png.subarray(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
  expect(png.length).toBeLessThan(SCREENSHOT_MAX_BYTES);
  mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
  writeFileSync(SCREENSHOT_PATH, png);
  await context.close();
});

// The text for the tests that show "nothing to say yet".
test('the Frequent board of a new user says what it is for', async ({ browser, baseURL }) => {
  const { page, seen, context } = await keysBoard(browser, baseURL);
  await expect(page.locator('#g-cats .tile.freq small')).toHaveText(EMPTY_FREQUENT_TEXT);
  for (const id of ['body', 'people', 'talk', 'frequent']) await press(page, ' ', 'categories', id, 0);
  await press(page, 'Enter', 'phrases', 'frequent', 0);
  await expect(page.locator('#g-phr .empty')).toHaveText(EMPTY_FREQUENT_TEXT);
  seen.check();
  await context.close();
});
