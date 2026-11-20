// Task 23, U10 (requirement 3): the wiring honesty of the app. The number of wiring lines is reported, not limited.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countWiring } from '../scripts/count-wiring';
import { STORAGE_KEY } from '../apps/knock-once/src/constants';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const APP_DIR = join(REPO_ROOT, 'apps', 'knock-once');
const SRC_DIR = join(APP_DIR, 'src');
const PURE_MODULES = ['constants', 'bindings', 'story', 'flow', 'captions', 'effects', 'effect-recipes', 'ectoplasm', 'keys', 'teach-texts'];
const DOM_MODULES = ['ui', 'canvas', 'audio', 'main'];
const START = '// tokk:start';
const END = '// tokk:end';
const FORBIDDEN = ['fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval', 'speechSynthesis', 'localStorage', 'sessionStorage', 'indexedDB', 'document.write', 'toPageTime', 'debug'];

const read = (name: string): string => readFileSync(join(SRC_DIR, name), 'utf8');
const sourceFiles = (): string[] => (existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts')).sort() : []);
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');

function split(source: string): { outside: string; inside: string } {
  const outside: string[] = [];
  const inside: string[] = [];
  let open = false;
  for (const line of source.split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith(START)) { open = true; continue; }
    if (text.startsWith(END)) { open = false; continue; }
    (open ? inside : outside).push(line);
  }
  return { outside: code(outside.join('\n')), inside: code(inside.join('\n')) };
}

describe('wiring honesty (U10)', () => {
  it('the folder: index.html, story.json, src/main.ts, the DOM modules, no sounds.json and no sounds folder', () => {
    for (const f of ['index.html', 'story.json', join('src', 'main.ts')]) expect(existsSync(join(APP_DIR, f)), f).toBe(true);
    for (const m of [...PURE_MODULES, ...DOM_MODULES]) expect(existsSync(join(SRC_DIR, `${m}.ts`)), m).toBe(true);
    expect(existsSync(join(APP_DIR, 'sounds.json'))).toBe(false);
    expect(existsSync(join(APP_DIR, 'sounds'))).toBe(false);
  });

  it('the markers exist, are closed, and count lines (reported, not limited)', () => {
    let blocks = 0;
    let lines = 0;
    for (const f of sourceFiles()) {
      const c = countWiring(read(f));
      blocks += c.blocks;
      lines += c.lines;
    }
    expect(blocks).toBeGreaterThan(0);
    expect(lines).toBeGreaterThan(0);
    console.log(`Knock Once wiring: ${lines} counted lines in ${blocks} block(s)`);
  });

  it('every value import from tokk and every use of ears is inside a marked block, and no DOM code is', () => {
    expect(sourceFiles()).toContain('main.ts');
    for (const f of sourceFiles()) {
      const { outside, inside } = split(read(f));
      const valueImport = outside.split('\n').filter((l) => /from\s+['"]tokk['"]/.test(l) && !/^\s*import\s+type\b/.test(l));
      expect(valueImport, `${f}: a value import from 'tokk' outside the markers`).toEqual([]);
      expect(/\bears\b/.test(outside), `${f}: "ears" outside the markers`).toBe(false);
      expect(/\blisten\s*\(/.test(outside), `${f}: listen() outside the markers`).toBe(false);
      expect(/\bdocument\b|\bwindow\b|\.textContent\b|scrollIntoView|getContext/.test(inside), `${f}: DOM code inside a block`).toBe(false);
    }
  });

  it('an app file imports from tokk, from its own files or the story only', () => {
    for (const f of sourceFiles()) {
      for (const m of read(f).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        expect(m[1] === 'tokk' || /^\.\/[a-z-]+$/.test(m[1]) || m[1] === '../story.json', `${f}: ${m[1]}`).toBe(true);
      }
    }
  });

  it('the pure modules have no DOM, no Tokk import, no timer and no clock', () => {
    for (const name of PURE_MODULES) {
      expect(existsSync(join(SRC_DIR, `${name}.ts`)), name).toBe(true);
      const text = code(read(`${name}.ts`));
      expect(text, name).not.toMatch(/\bdocument\b|\bwindow\b|\bHTML[A-Za-z]*Element\b|\bAudioContext\b|\bnavigator\b|\blocation\b/);
      expect(text, name).not.toMatch(/['"]tokk['"]/);
      expect(text, name).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|performance\.now|Date\.now|new Date\b|Math\.random/);
    }
  });

  it('no network call, no storage of the app, no HTML string, no speech, no debug and no toPageTime', () => {
    for (const f of sourceFiles()) {
      const text = code(read(f));
      for (const word of FORBIDDEN) {
        expect(new RegExp(`(^|[^A-Za-z0-9_])${word.replace('.', '\\.')}([^A-Za-z0-9_]|$)`).test(text), `${f}: ${word}`).toBe(false);
      }
    }
  });

  it('the story is imported, and the storage key is the app\'s own', () => {
    expect(read('main.ts')).toMatch(/import\s+\w+\s+from\s+'\.\.\/story\.json'/);
    expect(STORAGE_KEY).toBe('tokk:knock-once');
    expect(split(read('main.ts')).inside).toMatch(/storageKey:\s*STORAGE_KEY/);
  });

  it('every URL in the page is relative', () => {
    const html = existsSync(join(APP_DIR, 'index.html')) ? readFileSync(join(APP_DIR, 'index.html'), 'utf8') : '';
    expect(html).not.toMatch(/(?:href|src|action)\s*=\s*["'](?:\/|[a-z]+:)/i);
    expect(html).toContain('<script type="module" src="./dist/app.js"></script>');
  });
});
