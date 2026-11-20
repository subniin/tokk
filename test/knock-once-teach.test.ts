// Task 23, U9 (requirement 5.1, 5.2, 13.1, 13.2, 4.3): the dialog texts pass the library's own check, the theme and the
// style have readable contrast, and the page has no motion outside the no-preference media block.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTeachText } from '../web/teach-ui/text';
import { CANCEL_TEXT, TEACH_TEXT, THEME_PROPERTIES } from '../apps/knock-once/src/teach-texts';
import {
  COLOR_BUTTON_BG, COLOR_BUTTON_BORDER, COLOR_CANDLE, COLOR_ECTO, COLOR_FOCUS, COLOR_ROOM, COLOR_TEXT, FOCUS_OUTLINE_PX, THEME_ACCENT,
  THEME_BG, THEME_FG, THEME_FONT, THEME_RADIUS_PX,
} from '../apps/knock-once/src/constants';
import { contrastRatio } from './helpers/contrast';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const INDEX_PATH = join(REPO_ROOT, 'apps', 'knock-once', 'index.html');
const TEXT_CONTRAST_MIN = 4.5;
const GRAPHIC_CONTRAST_MIN = 3;
const DIALOG_CANVAS_BG = '#0d1117';   // the thumbnail background of the dialog, not themable (web/overlay/theme.ts)
const PRIVACY = 'Your audio never leaves this device. Nothing is recorded or uploaded.';

const html = (): string => (existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : '');
const style = (): string => /<style>([\s\S]*?)<\/style>/.exec(html())?.[1] ?? '';
function vars(): Record<string, string> {
  const out: Record<string, string> = {};
  const root = /:root\s*\{([^}]*)\}/.exec(style())?.[1] ?? '';
  for (const m of root.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
// The style without the @media (prefers-reduced-motion: no-preference) block (its braces are balanced).
function outsideNoPreference(css: string): string {
  const start = css.search(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/);
  if (start < 0) return css;
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(0, start) + outsideNoPreference(css.slice(i + 1));
  }
  return css.slice(0, start);
}

describe('the teach dialog texts (U9)', () => {
  it('every text passes the library check and keeps the defaults of the other keys', () => {
    const resolved = resolveTeachText(TEACH_TEXT);
    for (const [k, v] of Object.entries(TEACH_TEXT)) expect(resolved[k as keyof typeof resolved]).toBe(v);
    expect(Object.keys(TEACH_TEXT).sort()).toEqual(['record', 'quiet', 'save', 'saved', 'title', 'training'].sort());
  });

  it('the texts of the design', () => {
    expect(TEACH_TEXT.title).toBe('The spirits are listening');
    expect(TEACH_TEXT.quiet).toBe('Hold your breath. Let the room fall silent for one moment.');
    expect(TEACH_TEXT.record).toContain('Knock on the table so the spirits can hear you.');
    expect(TEACH_TEXT.record).toContain('{count}');
    expect(TEACH_TEXT.training).toBe('The spirits are learning your knock...');
    expect(TEACH_TEXT.save).toBe('Seal the knock');
    expect(TEACH_TEXT.saved).toBe('The spirits know your knock. Press Close to enter the room.');
    expect(CANCEL_TEXT).toBe('The spirits did not hear your knock. Press Teach again to try once more.');
  });

  it('the theme: five properties from the constants, with readable pairs of what the dialog draws', () => {
    expect(THEME_PROPERTIES).toEqual({
      '--tokk-bg': THEME_BG, '--tokk-fg': THEME_FG, '--tokk-accent': THEME_ACCENT, '--tokk-font': THEME_FONT, '--tokk-radius': `${THEME_RADIUS_PX}px`,
    });
    expect(contrastRatio(THEME_FG, THEME_BG), 'text on the dialog').toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    expect(contrastRatio(THEME_ACCENT, THEME_BG), 'the progress bar').toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    expect(contrastRatio(THEME_ACCENT, DIALOG_CANVAS_BG), 'the thumbnail waveform').toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
  });
});

describe('the style and the text of index.html (U9)', () => {
  it('the colours of the style are the constants, and the theme is set on :root', () => {
    const c = vars();
    expect(c).toMatchObject({
      room: COLOR_ROOM, text: COLOR_TEXT, candle: COLOR_CANDLE, ecto: COLOR_ECTO, 'button-bg': COLOR_BUTTON_BG,
      'button-border': COLOR_BUTTON_BORDER, focus: COLOR_FOCUS,
    });
    for (const [k, v] of Object.entries(THEME_PROPERTIES)) expect(c[k.slice(2)], k).toBe(v);
  });

  it('text 4.5 to 1 and graphics 3 to 1', () => {
    const c = vars();
    expect(contrastRatio(c.text, c.room)).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    expect(contrastRatio(c.text, c['button-bg'])).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    expect(contrastRatio(c.candle, c.room)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    expect(contrastRatio(c.ecto, c.room)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    expect(contrastRatio(c['button-border'], c['button-bg'])).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    expect(contrastRatio(c['button-border'], c.room)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    for (const bg of [c.room, c['button-bg']]) expect(contrastRatio(c.focus, bg)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
  });

  it('a focus outline of at least FOCUS_OUTLINE_PX, and no motion outside the no-preference block', () => {
    const css = style();
    expect(css).toMatch(new RegExp(String.raw`:focus-visible\s*\{[^}]*outline:\s*${FOCUS_OUTLINE_PX}px solid var\(--focus\)`));
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    const outside = outsideNoPreference(css);
    expect(outside).not.toMatch(/transition|animation|@keyframes|smooth/);
    expect(html()).not.toMatch(/<audio|<img|<link|https?:/i);
  });

  it('lang="en", the privacy sentence, the microphone note and the one script', () => {
    const page = html();
    expect(page).toContain('<html lang="en">');
    expect(page).toContain(`<p id="privacy">${PRIVACY}</p>`);
    expect(page).toMatch(/microphone stays on while this page is open/);
    expect(page).toMatch(/Closing or reloading the page stops it/);
    expect([...page.matchAll(/<script\b/g)]).toHaveLength(1);
    expect(page).toContain('<script type="module" src="./dist/app.js"></script>');
  });
});
