// Task 23 (requirement 17): Knock Once for Yes in Chrome.
// E1 to E3 and E7 are one serial block that shares one Chrome and one stream (the WAV plays once from the moment the stream
// opens). E4 (keyboard only), E5 (reduced motion) and E6 (the landing link under /tokk/) use the default Chrome.
// The knocks are synthetic stand-ins (test/web/knock-once-fixture.ts, an impact of core/synth). They show the logic and the
// wiring of the app, not the recognition of a real knock on a real table. The test never calls `ears` and never opens a
// dialog itself: the app does. The test reads story.json and follows its edges, so no question text is written here.
import { chromium, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildSite } from '../../scripts/build-site';
import { FAVICON_PATH, startSiteServer } from '../helpers/static-site-server';
import type { SiteServer } from '../helpers/static-site-server';
import { KNOCK_ONCE_GAP_A_MS, KNOCK_ONCE_GAP_C_MS, KNOCK_ONCE_GAP_D_MS } from './knock-once-fixture';
import type { KnockOnceTimes } from './knock-once-fixture';
import { FIXTURE_KNOCK_ONCE_TIMES_PATH, FIXTURE_KNOCK_ONCE_WAV_PATH, KNOCK_ONCE_PAGE_URL, REPO_ROOT, fakeMicArgs } from './paths';

// Test-only values.
const SYNC_TOLERANCE_MS = 100;                  // the offset of micStartMs from the stream start that E1 accepts
const DECOY_MARGIN_MS = 250;                    // the decoy must lie this far inside the paused window
const STILL_OBSERVE_MS = 1500;                  // reduced motion: nothing is drawn or scheduled for this long
const IMAGE_CHANGE_WAIT_MS = 1000;              // two pictures of the canvas this far apart
const KNOCK_LEVEL_MIN = 0.1;                    // data-level during a knock is above this (step 10.2)
const QUIET_LEVEL_MAX = 0.02;                   // data-level in a quiet window is below this (step 10.2)
const KNOCK_LEVEL_WINDOW_MS = 400;              // the window after a knock's start in which its level is read
const QUIET_FROM_AFTER_LONE_MS = 3000;          // the quiet window of E3: from this long after the lone knock
const QUIET_WINDOW_MS = 3000;
const LONE_SETTLE_MS = 2500;                    // after the lone knock: its sequence has timed out
const SCREENSHOT_MAX_BYTES = 300_000;
const SCREENSHOT_WIDTH_PX = 1000;
const SCREENSHOT_HEIGHT_PX = 760;
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 720;
const SERIAL_TEST_TIMEOUT_MS = 240_000;
const KEYBOARD_TEST_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 30_000;                 // a wait on a state of the page
const STREAM_SLACK_MS = 15_000;                 // added to a stream time for a wait
const EXAMPLES_SETTLE_MS = 1500;
const SETTLE_MS = 1500;                         // wait to show that nothing more happens
const TAB_LIMIT = 20;                           // a count: most Tab presses allowed to reach a control
const FOCUS_OUTLINE_MIN_PX = 2;
const HEARD_KNOCKS_AFTER_TEACHING = 7;          // the lone knock, three summon knocks, one yes knock, two no knocks
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const SCREENSHOT_PATH = resolve(REPO_ROOT, 'docs', 'images', 'knock-once.png');
const SITE_PREFIX = '/tokk/';
const SITE_BUILD_TIMEOUT_MS = 180_000;
const STORAGE_KEY = 'tokk:knock-once';
const PRIVACY = 'Your audio never leaves this device. Nothing is recorded or uploaded.';
const DIALOG_TITLE = 'The spirits are listening';
const RECORD_TEXT = 'Knock on the table so the spirits can hear you.';
const CANCEL_TEXT = 'The spirits did not hear your knock. Press Teach again to try once more.';
const SUMMON_HELP = 'Knock, knock, pause, knock. Summon the spirit.';
const QUESTION_HELP = 'One knock for yes. Two knocks for no.';
const ENDING_HELP = 'The spirit has gone. Knock, knock, pause, knock to call it again.';
const HEARD_KNOCK = 'Heard: knock ✓';

const DIALOG = '[data-tokk-teach]';
const dialogAction = (name: string): string => `${DIALOG} [data-action="${name}"]`;
const TIMES: KnockOnceTimes = JSON.parse(readFileSync(FIXTURE_KNOCK_ONCE_TIMES_PATH, 'utf8')) as KnockOnceTimes;

interface Question { type: 'question'; text: string; yes: string; no: string }
interface Ending { type: 'ending'; title: string; text: string }
interface StoryFile { start: string; nodes: Record<string, Question | Ending> }
// Read on use, so that a missing story fails the tests that need it and not the whole run.
let storyCache: StoryFile | null = null;
const story = (): StoryFile => (storyCache ??= JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'knock-once', 'story.json'), 'utf8')) as StoryFile);
const question = (id: string): Question => story().nodes[id] as Question;

interface Mark { atMs: number; value: string }
type TestWindow = Window & { __micStartMs?: number; __effects?: Mark[]; __levels?: Mark[]; __raf?: number };

// Records what must not happen: a request to another origin, a failed request, a console error, a page error.
function watch(page: Page, origin: string, prefix = ''): { requests: string[]; problems: string[]; check(): void } {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    requests.push(r.url());
    if (u.origin !== origin) problems.push(`request to another origin: ${r.url()}`);
    else if (prefix !== '' && !u.pathname.startsWith(prefix) && u.pathname !== FAVICON_PATH) problems.push(`request outside ${prefix}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return { requests, problems, check: () => expect(problems).toEqual([]) };
}

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

// Records the page time of every change of data-effect (on the body) and data-level (on the canvas).
const OBSERVER_SCRIPT = (): void => {
  const w = window as unknown as TestWindow;
  w.__effects = [];
  w.__levels = [];
  new MutationObserver((records) => {
    const now = performance.now();
    for (const r of records) {
      const value = (r.target as Element).getAttribute(r.attributeName as string) ?? '';
      if (r.attributeName === 'data-effect') w.__effects?.push({ atMs: now, value });
      else w.__levels?.push({ atMs: now, value });
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-effect', 'data-level'] });
};

// Counts the calls of requestAnimationFrame by the page.
const RAF_COUNT_SCRIPT = (): void => {
  const w = window as unknown as TestWindow;
  w.__raf = 0;
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    w.__raf = (w.__raf ?? 0) + 1;
    return original(cb);
  };
};

async function untilStream(page: Page, streamMs: number, extraMs = 0): Promise<void> {
  await page.waitForFunction(
    (ms) => { const s = (window as unknown as TestWindow).__micStartMs; return s !== undefined && performance.now() >= s + ms; },
    streamMs + extraMs,
    { timeout: streamMs + STREAM_SLACK_MS + STEP_TIMEOUT_MS, polling: 50 },
  );
}
const micStart = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as TestWindow).__micStartMs as number);
const marks = (page: Page, which: '__effects' | '__levels'): Promise<Mark[]> => page.evaluate((k) => ((window as unknown as TestWindow)[k] ?? []).slice(), which);
const captionTexts = (page: Page, kind?: string): Promise<string[]> => page.locator(kind === undefined ? '#caption-list li' : `#caption-list li[data-kind="${kind}"]`).allTextContents();
const nodeOnScreen = (page: Page): Promise<string | null> => page.getAttribute('#question', 'data-node');
const maxLevel = (levels: Mark[], fromMs: number, toMs: number): number => Math.max(0, ...levels.filter((m) => m.atMs >= fromMs && m.atMs <= toMs).map((m) => Number(m.value)));

async function doneAndSave(page: Page): Promise<void> {
  await expect(page.locator(dialogAction('done'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('done'));
  await expect(page.locator(dialogAction('save'))).toHaveAttribute('aria-disabled', 'false', { timeout: STEP_TIMEOUT_MS });
  await page.click(dialogAction('save'));
}

test.describe.serial('Knock Once for Yes with the generated stream', () => {
  test.setTimeout(SERIAL_TEST_TIMEOUT_MS);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let seen: ReturnType<typeof watch>;

  test.beforeAll(async ({ baseURL }) => {
    browser = await chromium.launch({ channel: 'chrome', args: fakeMicArgs(FIXTURE_KNOCK_ONCE_WAV_PATH) });
    context = await browser.newContext({ baseURL, viewport: { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX } });
    await context.addInitScript(MIC_START_SCRIPT);
    await context.addInitScript(OBSERVER_SCRIPT);
    page = await context.newPage();
    seen = watch(page, new URL(baseURL as string).origin);
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('teach knock, summon the spirit, answer yes then no, and reach the next questions', async () => {
    await page.goto(KNOCK_ONCE_PAGE_URL);
    await expect(page.locator('#privacy')).toHaveText(PRIVACY);
    await page.getByRole('button', { name: 'Enter the room (use the microphone)' }).click();

    // The teaching, in the séance's words, through the dialog's own buttons.
    await expect(page.locator(`${DIALOG} h2`)).toHaveText(DIALOG_TITLE, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(DIALOG)).toContainText(RECORD_TEXT, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator(`${DIALOG} li[data-example]`)).toHaveCount(TIMES.teach.startsMs.length, { timeout: STEP_TIMEOUT_MS + TIMES.teach.endMs });
    await page.waitForTimeout(EXAMPLES_SETTLE_MS);
    await expect(page.locator(`${DIALOG} li[data-example]`), 'the dialog must find exactly the ten knocks of the file').toHaveCount(TIMES.teach.startsMs.length);
    const doneAt = Date.now();
    await doneAndSave(page);
    await expect(page.locator(`${DIALOG} [data-role="saved"]`)).toHaveText('The spirits know your knock. Press Close to enter the room.');
    await page.click(dialogAction('close'));
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator('#help')).toHaveText(SUMMON_HELP);
    console.log(`E1: Done to the start screen ready: ${Date.now() - doneAt} ms (gap A is ${KNOCK_ONCE_GAP_A_MS} ms)`);
    const lateBy = (await page.evaluate(() => performance.now())) - (await micStart(page)) - TIMES.lone;
    expect(lateBy, 'the start screen was ready after the lone knock was played: gap A is too short').toBeLessThan(0);

    // The model is stored under the app's own key, as feature vectors with the label knock, and nothing else is stored.
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).not.toBeNull();
    const entry = JSON.parse(stored as string) as { model: { examples: { id: string; label: string; v: number[] }[] } };
    expect([...new Set(entry.model.examples.map((e) => e.label))]).toEqual(['knock']);
    for (const e of entry.model.examples) expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
    expect(await page.evaluate(() => localStorage.length)).toBe(1);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

    // The lone knock is heard and does not summon.
    await untilStream(page, TIMES.lone, LONE_SETTLE_MS);
    expect(await captionTexts(page, 'heard')).toEqual([HEARD_KNOCK]);
    expect(await nodeOnScreen(page)).toBeNull();
    await expect(page.locator('#help')).toHaveText(SUMMON_HELP);
    const start = await micStart(page);
    const firstLoud = (await marks(page, '__levels')).find((m) => m.atMs >= start + TIMES.lone - SYNC_TOLERANCE_MS && Number(m.value) >= KNOCK_LEVEL_MIN);
    expect(firstLoud, 'the level of the lone knock was never seen').toBeDefined();
    const offsetMs = (firstLoud as Mark).atMs - (start + TIMES.lone);
    console.log(`E1: offset of the lone knock's level from micStartMs + its stream time: ${offsetMs.toFixed(1)} ms`);
    expect(Math.abs(offsetMs), 'the clock sync of the arrangement (micStartMs), not the app, is out').toBeLessThanOrEqual(SYNC_TOLERANCE_MS);

    // The summon pattern summons, and the first question of story.json appears after the effect.
    await expect(page.locator('#question')).toHaveAttribute('data-node', story().start, { timeout: TIMES.summon[2] + STREAM_SLACK_MS });
    await expect(page.locator('#question')).toHaveText(question(story().start).text);
    await expect(page.locator('#help')).toHaveText(QUESTION_HELP);
    const summonEffect = (await marks(page, '__effects')).filter((m) => m.value === 'summon');
    expect(summonEffect.length).toBe(1);
    console.log(`E1: summon effect started ${(summonEffect[0].atMs - start - TIMES.summon[2]).toFixed(0)} ms after the third knock; gap C is ${KNOCK_ONCE_GAP_C_MS} ms`);
    expect((await page.evaluate(() => performance.now())) - start, 'the first question came after the yes knock was played: gap C is too short').toBeLessThan(TIMES.yes);

    // One knock answers yes; the decoy falls inside the paused window and is never heard.
    const yesTarget = question(story().start).yes;
    await expect(page.locator('#question')).toHaveAttribute('data-node', yesTarget, { timeout: TIMES.yes + STREAM_SLACK_MS });
    const all = await marks(page, '__effects');
    const iStart = all.findIndex((m) => m.value === 'between' && m.atMs > start + TIMES.yes);
    expect(iStart, 'no effect started after the yes knock').toBeGreaterThanOrEqual(0);
    const end = all.slice(iStart + 1).find((m) => m.value === '');
    expect(end, 'the effect after yes never ended').toBeDefined();
    const windowStart = all[iStart].atMs;
    const windowEnd = (end as Mark).atMs;
    const decoyAt = start + TIMES.decoy;
    console.log(`E1: paused window after yes ${(windowStart - start).toFixed(0)} to ${(windowEnd - start).toFixed(0)} ms (stream time), decoy at ${TIMES.decoy} ms`);
    const why = `window ${windowStart.toFixed(0)} to ${windowEnd.toFixed(0)} ms, decoy ${decoyAt.toFixed(0)} ms (page times): the arrangement, not the app, is out`;
    expect(decoyAt - windowStart, why).toBeGreaterThanOrEqual(DECOY_MARGIN_MS);
    expect(windowEnd - decoyAt, why).toBeGreaterThanOrEqual(DECOY_MARGIN_MS);
    await untilStream(page, TIMES.no[0], -SETTLE_MS);
    expect(await nodeOnScreen(page), 'the decoy answered').toBe(yesTarget);
    expect((await captionTexts(page, 'action')).filter((t) => t.startsWith('You answered:'))).toEqual(['You answered: yes (one knock)']);
    expect(await captionTexts(page, 'heard')).toHaveLength(5);
    expect((await page.evaluate(() => performance.now())) - start, 'the next question came after the no knocks were played: gap D is too short').toBeLessThan(TIMES.no[0]);
    console.log(`E1: gap D is ${KNOCK_ONCE_GAP_D_MS} ms`);

    // Two knocks answer no.
    const noTarget = question(yesTarget).no;
    await expect(page.locator('#question')).toHaveAttribute('data-node', noTarget, { timeout: TIMES.no[1] + STREAM_SLACK_MS });
    // After the effect the page says that it listens again, and Teach again is enabled.
    await expect(page.locator('#state')).toHaveText('Listening for knocks.');
    await expect(page.locator('#teach')).toBeEnabled();
    seen.check();
  });

  test('captions show every recognised knock as text', async () => {
    const yesTarget = question(story().start).yes;
    const noTarget = question(yesTarget).no;
    await expect(page.locator('#caption-list li[data-kind="spirit"]')).toHaveCount(3);
    expect(await captionTexts(page, 'heard')).toEqual(Array.from({ length: HEARD_KNOCKS_AFTER_TEACHING }, () => HEARD_KNOCK));
    const actions = await captionTexts(page, 'action');
    expect(actions.filter((t) => t.startsWith('You answered:'))).toEqual(['You answered: yes (one knock)', 'You answered: no (two knocks)']);
    expect(actions).toContain('The circle is open: knock, knock, pause, knock.');
    expect(await captionTexts(page, 'spirit')).toEqual([story().start, yesTarget, noTarget].map((id) => `The spirit asks: ${question(id).text}`));
    const effects = await captionTexts(page, 'effect');
    expect(effects.length).toBe(3);
    for (const e of effects) expect(e).toMatch(/^\[.+\]$/);
    await expect(page.locator('#captions')).toBeVisible();
    expect(await page.locator('button', { hasText: /caption/i }).count(), 'no control hides the captions').toBe(0);
    seen.check();
  });

  test('the ectoplasm follows the envelope', async () => {
    await expect(page.locator('#ecto')).toHaveAttribute('data-mode', 'flowing');
    const levels = await marks(page, '__levels');
    const start = await micStart(page);
    const heardKnocks = [TIMES.lone, ...TIMES.summon, TIMES.yes, ...TIMES.no];
    const knockLevels = heardKnocks.map((t) => maxLevel(levels, start + t, start + t + KNOCK_LEVEL_WINDOW_MS));
    const quietFrom = start + TIMES.lone + QUIET_FROM_AFTER_LONE_MS;
    const quiet = maxLevel(levels, quietFrom, quietFrom + QUIET_WINDOW_MS);
    console.log(`E3: knock levels ${knockLevels.map((l) => l.toFixed(2)).join(', ')}; quiet window ${quiet.toFixed(3)}`);
    for (const l of knockLevels) expect(l).toBeGreaterThan(KNOCK_LEVEL_MIN);
    expect(quiet).toBeLessThan(QUIET_LEVEL_MAX);
    seen.check();
  });

  test('the screenshot of Knock Once for Yes is a small PNG, written only with TOKK_WRITE_SCREENSHOT=1', async () => {
    await page.setViewportSize({ width: SCREENSHOT_WIDTH_PX, height: SCREENSHOT_HEIGHT_PX });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#question')).not.toBeEmpty();
    await expect(page.locator('#ecto')).toHaveAttribute('data-mode', 'flowing');
    await expect(page.locator('#candle')).toBeVisible();
    await expect(page.locator('#privacy')).toBeVisible();
    await expect(page.locator('#caption-list li').first()).toBeVisible();
    for (const id of ['#question', '#candle', '#privacy', '#caption-list', '#ecto']) {
      const box = await page.locator(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect((box as { y: number }).y, `${id} is inside the screenshot`).toBeLessThan(SCREENSHOT_HEIGHT_PX);
    }
    const png = await page.screenshot();
    expect([...png.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    expect(png.length).toBeLessThan(SCREENSHOT_MAX_BYTES);
    if (process.env.TOKK_WRITE_SCREENSHOT === '1') {
      mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
      writeFileSync(SCREENSHOT_PATH, png);
    }
    seen.check();
  });
});

// The answers that lead from the start to an ending, found by a search of story.json.
function walkTo(ending: string): { node: string; answer: 'y' | 'n' }[] {
  const search = (id: string): { node: string; answer: 'y' | 'n' }[] | null => {
    const n = story().nodes[id];
    if (n.type === 'ending') return id === ending ? [] : null;
    for (const [answer, next] of [['y', n.yes], ['n', n.no]] as ['y' | 'n', string][]) {
      const rest = search(next);
      if (rest !== null) return [{ node: id, answer }, ...rest];
    }
    return null;
  };
  const path = search(story().start);
  if (path === null) throw new Error(`story.json has no path to ${ending}`);
  return path;
}

test('keyboard alone plays the whole game to every ending', async ({ page, baseURL }) => {
  test.setTimeout(KEYBOARD_TEST_TIMEOUT_MS);
  const seen = watch(page, new URL(baseURL as string).origin);
  await page.setViewportSize({ width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX });
  await page.goto(KNOCK_ONCE_PAGE_URL);
  const focusedText = (): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
  const focusedId = (): Promise<string> => page.evaluate(() => document.activeElement?.id ?? '');
  const tabTo = async (matches: () => Promise<boolean>, key = 'Tab'): Promise<void> => {
    for (let i = 0; i < TAB_LIMIT; i++) {
      await page.keyboard.press(key);
      const outline = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement as Element).outlineWidth));
      expect(outline, 'a focused control shows an outline').toBeGreaterThanOrEqual(FOCUS_OUTLINE_MIN_PX);
      if (await matches()) return;
    }
    throw new Error('Tab did not reach the control');
  };

  await tabTo(async () => (await focusedText()) === 'Play with the keyboard');
  await page.keyboard.press('Enter');
  await expect(page.locator('#state')).toHaveText('Microphone not in use (keyboard and buttons)');
  await expect(page.locator('#privacy')).toBeVisible();
  await expect(page.locator('#help')).toHaveText(SUMMON_HELP);

  const endings = Object.entries(story().nodes).filter(([, n]) => n.type === 'ending').map(([id]) => id);
  for (const [i, ending] of endings.entries()) {
    if (i === 1) {
      // M mutes: the effect caption still appears and the hold passes.
      await page.keyboard.press('m');
      await expect(page.locator('#mute')).toHaveText('Sound effects: off');
      await expect(page.locator('#caption-list li[data-kind="system"]').last()).toHaveText('Sound effects are off.');
    }
    const effectsBefore = (await captionTexts(page, 'effect')).length;
    await page.keyboard.press('s');
    for (const step of walkTo(ending)) {
      await expect(page.locator('#question')).toHaveAttribute('data-node', step.node, { timeout: STEP_TIMEOUT_MS });
      await expect(page.locator('#help')).toHaveText(QUESTION_HELP);
      await page.keyboard.press(step.answer);
    }
    await expect(page.locator('#question')).toHaveAttribute('data-node', ending, { timeout: STEP_TIMEOUT_MS });
    await expect(page.locator('#help')).toHaveText(ENDING_HELP);
    const e = story().nodes[ending] as Ending;
    const spirit = await captionTexts(page, 'spirit');
    expect(spirit[spirit.length - 1]).toBe(`The spirit says: ${e.title}. ${e.text}`);
    for (const step of walkTo(ending)) expect(spirit).toContain(`The spirit asks: ${question(step.node).text}`);
    expect((await captionTexts(page, 'effect')).length, 'every effect is captioned, muted or not').toBe(effectsBefore + walkTo(ending).length + 1);
    const answers = (await captionTexts(page, 'action')).filter((t) => t.startsWith('You answered:'));
    expect(answers[answers.length - 1]).toMatch(/^You answered: (yes \(key Y\)|no \(key N\))$/);
    if (i > 0) expect(await captionTexts(page, 'action')).toContain('A new séance begins.');
  }

  // The shortcuts button turns the letter keys off and on.
  await tabTo(async () => (await focusedId()) === 'shortcuts');
  await page.keyboard.press('Enter');
  await expect(page.locator('#shortcuts')).toHaveText('Keyboard shortcuts: off');
  const nodeBefore = await nodeOnScreen(page);
  const linesBefore = (await captionTexts(page)).length;
  await page.keyboard.press('s');
  await page.waitForTimeout(SETTLE_MS);
  expect(await nodeOnScreen(page)).toBe(nodeBefore);
  expect((await captionTexts(page)).length).toBe(linesBefore);
  expect(await focusedId(), 'the focus stays on the shortcuts button').toBe('shortcuts');
  await page.keyboard.press('Enter');
  await expect(page.locator('#shortcuts')).toHaveText('Keyboard shortcuts: on');

  // T starts the microphone and the teaching, Esc cancels it with the cancel text.
  await page.keyboard.press('t');
  await expect(page.locator(`${DIALOG} h2`)).toHaveText(DIALOG_TITLE, { timeout: STEP_TIMEOUT_MS });
  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(page.locator('#notice')).toHaveText(CANCEL_TEXT);
  seen.check();
});

test('reduced motion shows a still ectoplasm', async ({ page, browser, baseURL }) => {
  const seen = watch(page, new URL(baseURL as string).origin);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(RAF_COUNT_SCRIPT);
  await page.goto(KNOCK_ONCE_PAGE_URL);
  await expect(page.locator('#ecto')).toHaveAttribute('data-mode', 'still');
  await expect(page.locator('#ecto')).toHaveAttribute('aria-label', 'A still pale glowing ribbon');
  const rafBefore = await page.evaluate(() => (window as unknown as TestWindow).__raf ?? 0);
  const first = await page.evaluate(() => (document.getElementById('ecto') as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(STILL_OBSERVE_MS);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__raf ?? 0), 'no animation frame after the first draw').toBe(rafBefore);
  expect(rafBefore).toBe(0);
  expect(await page.evaluate(() => (document.getElementById('ecto') as HTMLCanvasElement).toDataURL()), 'the still image does not change').toBe(first);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const moving = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    return s.animationName !== 'none' || s.transitionDuration.split(',').some((d) => parseFloat(d) !== 0);
  }).map((el) => el.tagName + (el.id ? `#${el.id}` : '')));
  expect(moving).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  seen.check();

  // The same page without the emulation flows.
  const context = await browser.newContext({ baseURL });
  const flowing = await context.newPage();
  const seenFlowing = watch(flowing, new URL(baseURL as string).origin);
  await flowing.addInitScript(RAF_COUNT_SCRIPT);
  await flowing.emulateMedia({ reducedMotion: 'no-preference' });
  await flowing.goto(KNOCK_ONCE_PAGE_URL);
  await expect(flowing.locator('#ecto')).toHaveAttribute('data-mode', 'flowing');
  await expect(flowing.locator('#ecto')).toHaveAttribute('aria-label', 'A pale glowing ribbon that moves with the sounds in the room');
  const r0 = await flowing.evaluate(() => (window as unknown as TestWindow).__raf ?? 0);
  const a = await flowing.evaluate(() => (document.getElementById('ecto') as HTMLCanvasElement).toDataURL());
  await flowing.waitForTimeout(IMAGE_CHANGE_WAIT_MS);
  expect(await flowing.evaluate(() => (window as unknown as TestWindow).__raf ?? 0)).toBeGreaterThan(r0);
  expect(await flowing.evaluate(() => (document.getElementById('ecto') as HTMLCanvasElement).toDataURL()), 'the idle drift moves the ribbon').not.toBe(a);
  expect(await flowing.evaluate(() => document.getAnimations().length), 'the candle flickers').toBeGreaterThan(0);
  seenFlowing.check();
  await context.close();
});

test.describe('under /tokk/', () => {
  let outDir = '';
  let server: SiteServer;
  let warnings: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(SITE_BUILD_TIMEOUT_MS);
    outDir = mkdtempSync(join(tmpdir(), 'tokk-knock-once-site-'));
    warnings = (await buildSite({ outDir })).warnings;   // the real apps folder
    server = await startSiteServer(outDir, SITE_PREFIX);
  });
  test.afterAll(async () => {
    await server?.close();
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  test('the site address opens Knock Once for Yes under /tokk/', async ({ page }) => {
    test.setTimeout(SERIAL_TEST_TIMEOUT_MS);
    expect(warnings, 'the site build with the real apps folder has no dead link').toEqual([]);
    const seen = watch(page, new URL(server.url).origin, SITE_PREFIX);
    page.on('response', (r) => { if (r.status() >= 400) seen.problems.push(`status ${r.status()}: ${r.url()}`); });
    // The new landing page (Task 35) does not link the old apps, so the app is opened by its address (they go in Task 36).
    await page.goto(`${server.url}${SITE_PREFIX}apps/knock-once/`);
    await expect(page).toHaveURL(`${server.url}${SITE_PREFIX}apps/knock-once/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Knock Once for Yes');
    await expect(page.locator('#privacy')).toHaveText(PRIVACY);
    await page.getByRole('button', { name: 'Enter the room (use the microphone)' }).click();
    await expect(page.locator(`${DIALOG} h2`)).toHaveText(DIALOG_TITLE, { timeout: STEP_TIMEOUT_MS });
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator('#notice')).toHaveText(CANCEL_TEXT);
    expect(seen.requests.some((u) => u.endsWith('/tokk/apps/knock-once/dist/app.js'))).toBe(true);
    const storyRequests = seen.requests.filter((u) => u.endsWith('story.json'));
    expect(storyRequests.every((u) => new URL(u).pathname === `${SITE_PREFIX}apps/knock-once/story.json`), 'the story is bundled or read under the app').toBe(true);
    seen.check();
  });
});
