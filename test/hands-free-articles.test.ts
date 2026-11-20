// Task 22, U9: the article data (requirement 10.4) and the style of index.html (requirement 9.1, 9.2, 2.2, 1.8).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTICLES } from '../apps/hands-free/src/articles';
import { FOCUS_OUTLINE_PX, SCAN_FRAME_PX, STATE_BANNER_FONT_SCALE } from '../apps/hands-free/src/constants';
import { contrastRatio } from './helpers/contrast';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const HTML_PATH = join(REPO_ROOT, 'apps', 'hands-free', 'index.html');
const TEXT_CONTRAST_MIN = 4.5;
const GRAPHIC_CONTRAST_MIN = 3;
const ARTICLE_COUNT = 3;
const PARAGRAPHS_MIN = 8;
const PARAGRAPHS_MAX = 10;
const PARAGRAPH_WORDS_MIN = 30;
const PARAGRAPH_WORDS_MAX = 50;
const ARTICLE_WORDS_MIN = 280;
const ARTICLE_WORDS_MAX = 420;
const IDS = ['bread-rises', 'vanishing-puddles', 'houseplant-basics'];
const PRIVACY = 'Your audio never leaves this device. Nothing is recorded or uploaded.';
const words = (s: string): number => s.trim().split(/\s+/).length;
const html = (): string => readFileSync(HTML_PATH, 'utf8');
const style = (): string => /<style>([\s\S]*?)<\/style>/.exec(html())?.[1] ?? '';

function colours(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of style().matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

describe('the article data (U9)', () => {
  it('there are three articles with the three ids, in order', () => {
    expect(ARTICLES).toHaveLength(ARTICLE_COUNT);
    expect(ARTICLES.map((a) => a.id)).toEqual(IDS);
    expect(new Set(ARTICLES.map((a) => a.id)).size).toBe(ARTICLE_COUNT);
  });

  it('every field is a non-empty string and the ids are URL safe', () => {
    for (const a of ARTICLES) {
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
      for (const field of [a.id, a.title, a.summary, ...a.paragraphs]) {
        expect(typeof field).toBe('string');
        expect(field.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('each article has 8 to 10 paragraphs of 30 to 50 words and 280 to 420 words in all', () => {
    for (const a of ARTICLES) {
      expect(a.paragraphs.length, a.id).toBeGreaterThanOrEqual(PARAGRAPHS_MIN);
      expect(a.paragraphs.length, a.id).toBeLessThanOrEqual(PARAGRAPHS_MAX);
      a.paragraphs.forEach((p, i) => {
        expect(words(p), `${a.id} paragraph ${i + 1}`).toBeGreaterThanOrEqual(PARAGRAPH_WORDS_MIN);
        expect(words(p), `${a.id} paragraph ${i + 1}`).toBeLessThanOrEqual(PARAGRAPH_WORDS_MAX);
      });
      const total = a.paragraphs.reduce((n, p) => n + words(p), 0);
      expect(total, a.id).toBeGreaterThanOrEqual(ARTICLE_WORDS_MIN);
      expect(total, a.id).toBeLessThanOrEqual(ARTICLE_WORDS_MAX);
    }
  });

  it('the summary is one sentence', () => {
    for (const a of ARTICLES) expect((a.summary.match(/[.!?](\s|$)/g) ?? []).length, a.id).toBe(1);
  });

  it('no markup, no link and no digit-only trick in any text', () => {
    for (const a of ARTICLES) {
      for (const text of [a.title, a.summary, ...a.paragraphs]) {
        expect(text).not.toMatch(/[<>]/);
        expect(text.toLowerCase()).not.toContain('http');
        expect(text).not.toMatch(/["“”]/);   // no quotation
      }
    }
  });

  it('the texts stay plain: no money, health or law advice words and no capitalised name inside a sentence', () => {
    const advice = /\b(doctor|medicine|medical|dollar|invest|lawyer|legal|lawsuit|prescription|diagnos\w*)\b/i;
    for (const a of ARTICLES) {
      for (const p of a.paragraphs) {
        expect(p, a.id).not.toMatch(advice);
        // A capital letter after a lowercase word in the middle of a sentence would be a name or a brand.
        expect(p.replace(/([.!?]\s+)[A-Z]/g, '$1'), `${a.id}: ${p.slice(0, 30)}`).not.toMatch(/[a-z,]\s+[A-Z]/);
      }
    }
  });
});

describe('the style and the text of index.html (U9)', () => {
  it('has lang="en", the privacy sentence, the two start buttons and the module script', () => {
    const h = html();
    expect(h).toContain('<html lang="en">');
    expect(h).toContain(PRIVACY);
    expect(h).toContain('Start with the microphone');
    expect(h).toContain('Use the keyboard only');
    expect(h).toContain('<script type="module" src="./dist/app.js"></script>');
    expect(h.match(/<script\b/g)).toHaveLength(1);
  });

  it('has no transition, animation, smooth scrolling or external resource', () => {
    const h = html();
    expect(h).not.toMatch(/transition|animation|@keyframes|smooth/i);
    expect(h).not.toMatch(/<link\b|<img\b|<iframe\b|@import|url\(/i);
    expect(h).not.toMatch(/https?:/i);
  });

  it('the text colours reach 4.5 to 1 and the graphics 3 to 1', () => {
    const c = colours();
    for (const name of ['bg', 'fg', 'link', 'visited', 'frame', 'focus', 'border', 'button-bg']) expect(c[name], name).toBeDefined();
    for (const name of ['fg', 'link', 'visited']) expect(contrastRatio(c[name], c.bg), `${name} on bg`).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    expect(contrastRatio(c.fg, c['button-bg'])).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    for (const name of ['frame', 'focus', 'border']) {
      expect(contrastRatio(c[name], c.bg), `${name} on bg`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    }
    for (const name of ['frame', 'focus']) expect(contrastRatio(c[name], c.link), `${name} on link`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
    expect(contrastRatio(c.border, c['button-bg'])).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST_MIN);
  });

  it('the scan frame and the focus outline have the widths of the constants, and the banner has its scale', () => {
    const css = style();
    expect(css).toMatch(new RegExp(String.raw`\[data-scan="current"\]\s*\{[^}]*outline:\s*${SCAN_FRAME_PX}px solid`));
    expect(css).toMatch(new RegExp(String.raw`:focus-visible\s*\{[^}]*outline:\s*${FOCUS_OUTLINE_PX}px solid`));
    expect(css).toMatch(new RegExp(String.raw`#state[^{]*\{[^}]*font-size:\s*${STATE_BANNER_FONT_SCALE}rem`));
  });

  it('the layout works at narrow widths: a column in rem and wrapping text', () => {
    const css = style();
    expect(css).toMatch(/max-width:\s*\d+(\.\d+)?rem/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
