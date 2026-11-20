// Task 23, U11 (requirement 2.4): the steering file halloween-ui.md, and Halloween only in apps/knock-once/.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const STEERING = join(REPO_ROOT, '.kiro', 'steering', 'halloween-ui.md');
const UI_STEERING = join(REPO_ROOT, '.kiro', 'steering', 'ui.md');
const SCANNED = ['web', 'teach.html', 'examples', join('apps', 'hands-free')];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'sounds']);
const SCANNED_EXTENSIONS = ['.ts', '.html', '.css', '.js', '.json', '.md'];
const HALLOWEEN_WORDS = /\b(candles?|s[eé]ances?|ghosts?|spirits?|ectoplasm|pumpkins?|haunt\w*|spooky|halloween)\b/i;
// Key words of the rules of requirement 2.2, one group per rule; every word of a group must be in the file.
const RULE_WORDS: Record<string, string[]> = {
  look: ['candlelight', 'near-black', 'table', 'ectoplasm', 'serif'],
  voice: ['text', 'speech synthesis', 'gory', 'Edison', 'quote'],
  captions: ['captions', 'always on'],
  motion: ['prefers-reduced-motion', 'once per second', 'flicker'],
  contrast: ['4.5 to 1', '3 to 1', '--tokk-'],
  effects: ['Web Audio', 'faded', 'loop', 'ears.pause()', 'jump scare', 'flash'],
  scope: ['apps/knock-once/', 'web/', 'teach.html', 'examples/', 'apps/hands-free/', 'core/'],
  pointers: ['ui.md', 'web-audio.md', 'privacy.md'],
};

function files(path: string, out: string[]): string[] {
  if (!existsSync(path)) return out;
  if (statSync(path).isFile()) {
    if (SCANNED_EXTENSIONS.some((e) => path.endsWith(e))) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    files(join(path, entry.name), out);
  }
  return out;
}

const frontMatter = (text: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';

describe('the Halloween steering file and its scope (U11)', () => {
  it('halloween-ui.md exists and loads only for files of apps/knock-once/', () => {
    expect(existsSync(STEERING)).toBe(true);
    const front = frontMatter(readFileSync(STEERING, 'utf8'));
    expect(front).toContain('inclusion: fileMatch');
    expect(front).toMatch(/fileMatchPattern:\s*\[?\s*"?apps\/knock-once\/\*\*"?\s*\]?/);
    expect(front).not.toMatch(/inclusion:\s*always/);
  });

  it('names every rule of requirement 2.2 by its key words', () => {
    const text = existsSync(STEERING) ? readFileSync(STEERING, 'utf8') : '';
    for (const [rule, words] of Object.entries(RULE_WORDS)) {
      for (const w of words) expect(text, `rule "${rule}" lacks "${w}"`).toContain(w);
    }
  });

  it('no Halloween word in web/, teach.html, examples/ or apps/hands-free/', () => {
    const hits: string[] = [];
    for (const p of SCANNED) {
      for (const f of files(join(REPO_ROOT, p), [])) {
        readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
          const m = HALLOWEEN_WORDS.exec(line);
          if (m) hits.push(`${relative(REPO_ROOT, f)}:${i + 1}: ${m[0]}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });

  it('the scan finds a word when there is one (the check can fail)', () => {
    expect(HALLOWEEN_WORDS.test('A candle burns.')).toBe(true);
    expect(HALLOWEEN_WORDS.test('the Séance table')).toBe(true);
    expect(HALLOWEEN_WORDS.test('Reading list')).toBe(false);
  });

  it('ui.md keeps its Halloween rule and its pattern, which leaves apps/knock-once/ out', () => {
    const ui = readFileSync(UI_STEERING, 'utf8');
    expect(ui).toContain('Put no Halloween elements in the template (`web/`, `teach.html`) or in app 1. Halloween styling lives in app 2\'s `halloween-ui.md` only.');
    // Task 26 (named update): the pattern also covers the slides case, and still leaves apps/knock-once/ out.
    expect(frontMatter(ui)).toBe('inclusion: fileMatch\nfileMatchPattern: ["web/**/*", "teach.html", "examples/**/*", "apps/hands-free/**/*", "cases/slides/**/*"]');
  });
});
