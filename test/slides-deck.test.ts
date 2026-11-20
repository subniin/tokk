// Task 26 (tests U4, U5 and U10): the slide deck case, cases/slides. These tests read files only.
// What is NOT here: the stage 1 rule "no Tokk in the case" is a one-time check (tasks.md step 4.4), because stage 2 changes it on purpose.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { contrastRatio } from './helpers/contrast';
import { REPO_ROOT } from './web/paths';

const CASE_DIR = join(REPO_ROOT, 'cases', 'slides');
const REVEAL_VERSION = '6.0.2';
const REVEAL_PACKAGE_DIR = join(REPO_ROOT, 'node_modules', 'reveal.js');
const LICENSE_COPY_NAME = 'LICENSE-revealjs.txt';
const THEME_NAME = 'serif';
const SLIDES_MIN = 5;
const SLIDES_MAX = 6;
const TEXT_CONTRAST_MIN = 4.5;
const read = (...parts: string[]): string => readFileSync(join(CASE_DIR, ...parts), 'utf8');

// Every source file of the case that can hold an import (the same extensions as scripts/check-public-api.ts).
function caseFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(full); }
      else if (extensions.some((x) => e.name.endsWith(x))) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

// The module specifiers that a source text imports (static, dynamic and side-effect imports, and `require`).
function importedSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const spec = String.raw`(['"\x60])([^'"\x60]+)\1`;
  for (const re of [new RegExp(String.raw`\bfrom\s*${spec}`, 'g'), new RegExp(String.raw`\bimport\s*\(?\s*${spec}`, 'g'), new RegExp(String.raw`\brequire\s*\(\s*${spec}`, 'g')]) {
    for (const m of source.matchAll(re)) specs.push(m[2]);
  }
  return specs;
}

// The rule of requirement 1.2: a specifier that names reveal.js must be an export of its `exports` map.
// `exports` is read from the installed package, so the rule follows the real package.
function allowedRevealSpecifier(spec: string, exportsMap: Record<string, unknown>): boolean {
  if (spec !== 'reveal.js' && !spec.startsWith('reveal.js/')) return true;       // not reveal.js at all
  const key = spec === 'reveal.js' ? '.' : `./${spec.slice('reveal.js/'.length)}`;
  return Object.keys(exportsMap).some((pattern) => {
    if (pattern === key) return true;
    const star = pattern.indexOf('*');
    return star >= 0 && key.startsWith(pattern.slice(0, star)) && key.length > star && key.endsWith(pattern.slice(star + 1));
  });
}

// The text between `// tokk:start` and `// tokk:end` lines (empty when there is no marker).
function markerBlocks(source: string): string[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of source.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('// tokk:start')) current = [];
    else if (t.startsWith('// tokk:end')) { if (current) blocks.push(current.join('\n')); current = null; }
    else if (current) current.push(line);
  }
  return blocks;
}

describe('the deck page (Task 26, U4)', () => {
  const html = (): string => read('index.html');
  const slideSections = (): string[] => {
    const slides = /<div class="slides">([\s\S]*?)<\/div>\s*<\/div>/.exec(html());
    expect(slides, 'a .reveal > .slides structure').not.toBeNull();
    return [...(slides?.[1] ?? '').matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((m) => m[1]);
  };

  it('U4: the document has lang="en", a title that is not reveal.js, a viewport tag and no inline handler', () => {
    const page = html();
    expect(page).toMatch(/<html lang="en"/);
    const title = /<title>([^<]+)<\/title>/.exec(page)?.[1] ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(title.toLowerCase()).not.toContain('reveal');
    expect(page).toMatch(/<meta name="viewport"/);
    expect(page).not.toMatch(/\son[a-z]+\s*=/i);
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);     // no inline script
  });

  it('U4: the deck has five or six sections inside the reveal structure, each with a real heading and text', () => {
    const sections = slideSections();
    expect(sections.length).toBeGreaterThanOrEqual(SLIDES_MIN);
    expect(sections.length).toBeLessThanOrEqual(SLIDES_MAX);
    for (const s of sections) {
      expect(s).toMatch(/<h[12]\b[^>]*>[^<]+<\/h[12]>/);
      expect(s.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0);
    }
    expect(html()).toMatch(/<div class="reveal">\s*<div class="slides">/);
  });

  it('U4: the title slide says Tokk, no heading says reveal.js, and the deck has no image', () => {
    const sections = slideSections();
    expect(sections[0]).toMatch(/<h1\b[^>]*>\s*Tokk\s*<\/h1>/);
    const headings = [...html().matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => m[1]);
    for (const h of headings) expect(h.toLowerCase()).not.toContain('reveal');
    expect(html()).not.toMatch(/<img\b|<svg\b|<picture\b|<canvas\b|<video\b/i);
  });

  it('U4: the page loads only its own bundle, by relative URLs, and has no external resource', () => {
    const page = html();
    expect(page).toMatch(/<script type="module" src="\.\/dist\/app\.js"><\/script>/);
    expect(page).toMatch(/<link rel="stylesheet" href="\.\/dist\/app\.css"\s*\/?>/);
    expect(page).not.toMatch(/https?:\/\/|\/\/[a-z]/i);
    for (const m of page.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)) expect(m[1].startsWith('./') || m[1].startsWith('#'), m[1]).toBe(true);
  });

  it('U4: the stock theme text and background meet the contrast rule (4.5 to 1)', () => {
    const css = readFileSync(join(REVEAL_PACKAGE_DIR, 'dist', 'theme', `${THEME_NAME}.css`), 'utf8');
    const variable = (name: string): string => {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(css);
      if (!m) throw new Error(`no --${name} colour in the ${THEME_NAME} theme`);
      const hex = m[1];
      return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
    };
    const background = variable('r-background-color');
    for (const name of ['r-main-color', 'r-heading-color', 'r-link-color']) expect(contrastRatio(variable(name), background), name).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    // The check itself catches a bad pair.
    expect(contrastRatio('#777777', '#888888')).toBeLessThan(TEXT_CONTRAST_MIN);
  });

  it('U4: the stylesheet of the case sets no transition and no animation, except `none` as the override', () => {
    const cssPath = join(CASE_DIR, 'src', 'style.css');
    const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
    for (const m of css.matchAll(/(transition|animation)[a-z-]*\s*:\s*([^;}]*)/g)) expect(m[2].replace(/!important/, '').trim(), m[0]).toBe('none');
  });
});

describe('reveal.js as a dependency (Task 26, U5)', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

  it('U5: reveal.js is an exact devDependency and nothing else of the kind is a runtime dependency', () => {
    expect(pkg.devDependencies?.['reveal.js']).toBe(REVEAL_VERSION);
    expect(pkg.dependencies).toBeUndefined();
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean; license?: string }> };
    expect(lock.packages['node_modules/reveal.js']).toMatchObject({ version: REVEAL_VERSION, dev: true, license: 'MIT' });
  });

  it('U5: the LICENSE copy is byte for byte the LICENSE of the installed package', () => {
    const copy = readFileSync(join(CASE_DIR, LICENSE_COPY_NAME));
    expect(copy.length).toBeGreaterThan(0);
    expect(copy.toString('utf8')).toMatch(/Hakim El Hattab/);
    const original = join(REVEAL_PACKAGE_DIR, 'LICENSE');
    if (existsSync(original)) expect(copy.equals(readFileSync(original))).toBe(true);
  });

  it('U5: the README names reveal.js, its author, the version, the MIT licence and the home page of the package', () => {
    const readme = read('README.md');
    expect(readme).toContain('reveal.js');
    expect(readme).toContain(REVEAL_VERSION);
    expect(readme).toMatch(/\bMIT\b/);
    expect(readme).toContain(LICENSE_COPY_NAME);
    const installed = join(REVEAL_PACKAGE_DIR, 'package.json');
    if (existsSync(installed)) {
      const meta = JSON.parse(readFileSync(installed, 'utf8')) as { author: { name: string }; homepage: string; version: string; license: string };
      expect(meta.version).toBe(REVEAL_VERSION);
      expect(meta.license).toBe('MIT');
      expect(readme).toContain(meta.author.name);
      expect(readme).toContain(meta.homepage);
    }
  });

  it('U5: the case imports reveal.js only through an export of its exports map', () => {
    const installed = join(REVEAL_PACKAGE_DIR, 'package.json');
    const exportsMap = existsSync(installed)
      ? (JSON.parse(readFileSync(installed, 'utf8')) as { exports: Record<string, unknown> }).exports
      : { '.': {}, './reveal.css': '', './reset.css': '', './theme/*': '' };
    // The rule itself first: it must accept the exports and reject a path inside the package.
    for (const ok of ['reveal.js', 'reveal.js/reveal.css', 'reveal.js/reset.css', 'reveal.js/theme/serif.css', 'tokk', './constants']) expect(allowedRevealSpecifier(ok, exportsMap), ok).toBe(true);
    for (const bad of ['reveal.js/dist/reveal.mjs', 'reveal.js/dist/reveal.css', 'reveal.js/js/reveal.js', 'reveal.js/css/reveal.scss', 'reveal.js/package.json', 'reveal.js/theme/']) expect(allowedRevealSpecifier(bad, exportsMap), bad).toBe(false);
    expect(importedSpecifiers("import Reveal from 'reveal.js';\nimport 'reveal.js/reveal.css';\nconst x = await import('reveal.js/dist/x.js');")).toEqual(['reveal.js', 'reveal.js/reveal.css', 'reveal.js/dist/x.js']);
    // Then the real files of every case.
    const all = caseFiles(join(REPO_ROOT, 'cases'), ['.ts', '.tsx', '.js', '.mjs', '.css', '.html']);
    expect(all.length).toBeGreaterThan(0);
    const bad = all.flatMap((f) => importedSpecifiers(readFileSync(f, 'utf8')).filter((s) => !allowedRevealSpecifier(s, exportsMap)).map((s) => `${relative(REPO_ROOT, f)}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('U5: no case file patches or copies reveal.js code, and nothing under node_modules is part of the repository', () => {
    const files = caseFiles(CASE_DIR, ['.ts', '.js', '.mjs', '.html', '.css']);
    for (const f of files) expect(readFileSync(f, 'utf8'), relative(REPO_ROOT, f)).not.toMatch(/node_modules/);
    const tracked = spawnSync('git', ['ls-files', 'node_modules'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
    expect(tracked).toBe('');
  });
});

describe('the shape of cases/slides/src (Task 26, U10)', () => {
  const sources = (): { path: string; text: string }[] => caseFiles(join(CASE_DIR, 'src'), ['.ts', '.tsx', '.js', '.mjs']).map((p) => ({ path: relative(REPO_ROOT, p), text: readFileSync(p, 'utf8') }));

  it('U10: main.ts keeps the deck in a module-level constant named deck and starts it once', () => {
    const main = read('src', 'main.ts');
    expect(main).toMatch(/^const deck\b/m);
    expect(main.match(/\bdeck\.initialize\(/g) ?? []).toHaveLength(1);
    expect(existsSync(join(CASE_DIR, 'src', 'constants.ts'))).toBe(true);
  });

  it('U10: the source calls no network API, writes no storage and does not use onEnvelope', () => {
    const forbidden = /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|onEnvelope|localStorage|sessionStorage)\b/;
    expect(sources().length).toBeGreaterThan(0);
    for (const s of sources()) {
      const code = s.text.split(/\r?\n/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(code, s.path).not.toMatch(forbidden);
    }
    expect('const r = fetch(url);').toMatch(forbidden);     // the pattern itself catches a call
  });

  it('U10: every Tokk import is exactly \'tokk\', and reveal.js is not imported inside a marker block', () => {
    for (const s of sources()) {
      for (const spec of importedSpecifiers(s.text)) {
        if (spec.startsWith('tokk')) expect(spec, s.path).toBe('tokk');
      }
      for (const block of markerBlocks(s.text)) expect(importedSpecifiers(block).filter((x) => x.startsWith('reveal.js')), s.path).toEqual([]);
    }
    const sample = ["import Reveal from 'reveal.js';", '// tokk:start', "import Reveal2 from 'reveal.js';", '// tokk:end'].join('\n');
    expect(markerBlocks(sample).flatMap(importedSpecifiers)).toEqual(['reveal.js']);
  });

  it('U10: the case has no hard-coded sample count and keeps its constants in constants.ts', () => {
    for (const s of sources()) expect(s.text, s.path).not.toMatch(/\b(sampleCount|samples?)\s*=\s*\d{3,}/i);
  });
});

describe('git housekeeping of the case (Task 26)', () => {
  const ignored = (p: string): boolean => spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO_ROOT }).status === 0;
  it('the bundle folder and the site folder are ignored, the sources and the README are not', () => {
    expect(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')).toMatch(/^cases\/\*\/dist\/\s*$/m);
    expect(ignored('cases/slides/dist/app.js')).toBe(true);
    expect(ignored('cases/anything/dist/app.css')).toBe(true);
    expect(ignored('site/index.html')).toBe(true);
    expect(ignored('cases/slides/src/main.ts')).toBe(false);
    expect(ignored('cases/slides/index.html')).toBe(false);
    expect(ignored(`cases/slides/${LICENSE_COPY_NAME}`)).toBe(false);
  });
  it('the web tsconfig includes the case sources, and the steering file for the UI covers the case', () => {
    expect(readFileSync(join(REPO_ROOT, 'tsconfig.web.json'), 'utf8')).toContain('cases/*/src/**/*.ts');
    expect(readFileSync(join(REPO_ROOT, '.kiro', 'steering', 'ui.md'), 'utf8')).toContain('cases/slides/**/*');
  });
});
