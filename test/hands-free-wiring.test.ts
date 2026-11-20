// Task 22, U8: the wiring honesty of the app (requirement 1.3, 1.5, 1.6 and 12). The number of wiring lines is reported,
// not limited.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countWiring } from '../scripts/count-wiring';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const APP_DIR = join(REPO_ROOT, 'apps', 'hands-free');
const SRC_DIR = join(APP_DIR, 'src');
const PURE_MODULES = ['constants', 'bindings', 'history', 'hum-scroll', 'nav', 'keys', 'text', 'steps', 'articles'];
const DATA_MODULES = ['articles'];   // plain text for readers: it may say \
const START = '// tokk:start';
const END = '// tokk:end';
const NETWORK_AND_UNSAFE = ['fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'onEnvelope', 'localStorage', 'sessionStorage', 'indexedDB', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval', 'document.write'];

const read = (name: string): string => readFileSync(join(SRC_DIR, name), 'utf8');
const sourceFiles = (): string[] => (existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts')).sort() : []);

// The text outside every marked block, and the text inside. The markers are read before comments are removed.
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

// Removes comments, so that a sentence in a comment is not mistaken for code.
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');

describe('wiring honesty (U8)', () => {
  it('the app has the entry src/main.ts and an index.html, and no sounds.json and no sounds folder', () => {
    expect(existsSync(join(SRC_DIR, 'main.ts'))).toBe(true);
    expect(existsSync(join(APP_DIR, 'index.html'))).toBe(true);
    expect(existsSync(join(APP_DIR, 'sounds.json'))).toBe(false);
    expect(existsSync(join(APP_DIR, 'sounds'))).toBe(false);
  });

  it('the markers exist, are closed, and count lines', () => {
    let blocks = 0;
    let lines = 0;
    for (const f of sourceFiles()) {
      const c = countWiring(read(f));   // throws when a block is not closed
      blocks += c.blocks;
      lines += c.lines;
    }
    expect(blocks).toBeGreaterThan(0);
    expect(lines).toBeGreaterThan(0);
    expect(Number.isInteger(lines)).toBe(true);
    console.log(`Hands-Free wiring: ${lines} counted lines in ${blocks} block(s)`);
  });

  it('every value import from tokk and every use of ears is inside a marked block', () => {
    for (const f of sourceFiles()) {
      const { outside } = split(read(f));
      const valueImport = outside.split('\n').filter((l) => /from\s+['"]tokk['"]/.test(l) && !/^\s*import\s+type\b/.test(l));
      expect(valueImport, `${f}: a value import from 'tokk' outside the markers`).toEqual([]);
      expect(/\bears\b/.test(outside), `${f}: "ears" outside the markers`).toBe(false);
    }
  });

  it('the code that does not use Tokk is outside the markers', () => {
    for (const f of sourceFiles()) {
      const { inside } = split(read(f));
      expect(/\bdocument\b|\bwindow\b|\.textContent\b|\.innerText\b|scrollBy|scrollIntoView/.test(inside), `${f}: DOM code inside a block`).toBe(false);
    }
  });

  it('an app imports from tokk or from its own files only', () => {
    for (const f of sourceFiles()) {
      for (const m of read(f).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        expect(spec === 'tokk' || /^\.\/[a-z-]+$/.test(spec), `${f}: ${spec}`).toBe(true);
      }
    }
  });

  it('the pure modules have no DOM, no Tokk import, no timer and no global clock', () => {
    for (const name of PURE_MODULES) {
      const text = code(read(`${name}.ts`));
      if (!DATA_MODULES.includes(name)) expect(text, name).not.toMatch(/\bdocument\b|\bwindow\b|\bHTML[A-Za-z]*Element\b|\bElement\b|\bEvent\b\s*[,;)]|\blocation\b|\bnavigator\b/);
      expect(text, name).not.toMatch(/from\s+['"]tokk['"]/);
      expect(text, name).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|performance\.now|Date\.now|new Date\b/);
    }
  });

  it('no network call, no audio output, no storage of the app and no HTML string', () => {
    for (const f of sourceFiles()) {
      const text = code(read(f));
      for (const word of NETWORK_AND_UNSAFE) {
        expect(new RegExp(`(^|[^A-Za-z0-9_])${word.replace('.', '\\.')}([^A-Za-z0-9_]|$)`).test(text), `${f}: ${word}`).toBe(false);
      }
    }
  });

  it('every URL in the page is relative', () => {
    const html = readFileSync(join(APP_DIR, 'index.html'), 'utf8');
    expect(html).not.toMatch(/(?:href|src|action)\s*=\s*["'](?:\/|[a-z]+:)/i);
    expect(html).toContain('<script type="module" src="./dist/app.js"></script>');
  });
});
