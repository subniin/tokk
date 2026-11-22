// Task 23, U11 (requirement 2.4), updated by Task 36: Halloween words stay out of the template and the example.
// Task 36 deleted the first Halloween app and its steering file halloween-ui.md, so only the template-side checks remain.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const STEERING = join(REPO_ROOT, '.kiro', 'steering', 'halloween-ui.md');
const UI_STEERING = join(REPO_ROOT, '.kiro', 'steering', 'ui.md');
const SCANNED = ['web', 'teach.html', 'examples'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'sounds']);
const SCANNED_EXTENSIONS = ['.ts', '.html', '.css', '.js', '.json', '.md'];
const HALLOWEEN_WORDS = /\b(candles?|s[eé]ances?|ghosts?|spirits?|ectoplasm|pumpkins?|haunt\w*|spooky|halloween)\b/i;

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

describe('Halloween scope (U11, Task 36)', () => {
  it('the steering file of the replaced app is gone', () => {
    expect(existsSync(STEERING)).toBe(false);
  });

  it('no Halloween word in web/, teach.html or examples/', () => {
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

  it('ui.md keeps its Halloween rule and a pattern that names no replaced app', () => {
    const ui = readFileSync(UI_STEERING, 'utf8');
    expect(ui).toContain('Put no Halloween elements in the template (`web/`, `teach.html`) or in `examples/`. Halloween styling lives in the apps only.');
    expect(frontMatter(ui)).toBe('inclusion: fileMatch\nfileMatchPattern: ["web/**/*", "teach.html", "examples/**/*", "cases/slides/**/*"]');
  });
});
