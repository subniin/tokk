// Task 21: scripts/build-site.ts (tests S1 to S7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildSite, SITE_DENY_LIST } from '../scripts/build-site';
import { contrastRatio } from './helpers/contrast';
import { FIXTURE_APP_NAMES, makeFixtureApps } from './helpers/fixture-apps';
import { hrefsOf, scanHtml, scanScriptOrCss, scanSiteFile } from './helpers/relative-urls';
import { REPO_ROOT } from './web/paths';

const SITE_BUILD_TIMEOUT_MS = 180_000;
const TEXT_CONTRAST_MIN = 4.5;
const FOCUS_OUTLINE_MIN_PX = 2;
const LANDING_HREFS = ['teach.html', 'examples/hello/', 'apps/hands-free/', 'apps/knock-once/'];
const SCRIPT = join(REPO_ROOT, 'scripts', 'build-site.ts');
const TSX_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const temps: string[] = [];
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); temps.push(d); return d; };
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full); else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}
const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');

const EXPECTED_FILES = [
  'index.html', 'teach.html', 'dist/tokk.js', 'dist/teach-page.js',
  'examples/hello/index.html', 'examples/hello/sounds.json',
  ...FIXTURE_APP_NAMES.flatMap((n) => [`apps/${n}/index.html`, `apps/${n}/asset.txt`, `apps/${n}/dist/app.js`]),
].sort();

describe('the site build (Task 21)', () => {
  let appsDir = '';
  let outDir = '';
  let firstFiles: string[] = [];
  let warnings: string[] = [];

  beforeAll(async () => {
    appsDir = makeFixtureApps();
    temps.push(appsDir);
    // Extras that the deny list must keep out, one for each entry of the list.
    for (const name of FIXTURE_APP_NAMES) {
      const app = join(appsDir, name);
      for (const folder of SITE_DENY_LIST.folders) {
        mkdirSync(join(app, folder), { recursive: true });
        writeFileSync(join(app, folder, 'deny.txt'), 'x');
      }
      for (const ext of SITE_DENY_LIST.extensions) writeFileSync(join(app, `deny${ext}`), 'x');
      writeFileSync(join(app, '.hidden'), 'x');
      mkdirSync(join(app, '.dotdir'), { recursive: true });
      writeFileSync(join(app, '.dotdir', 'x.txt'), 'x');
    }
    outDir = tempDir('tokk-site-');
    const result = await buildSite({ outDir, appsDir });
    warnings = result.warnings;
    firstFiles = result.files.map((f) => f.path);
  }, SITE_BUILD_TIMEOUT_MS);

  it('S1: the output holds exactly the expected files, and the result lists them with sizes', async () => {
    expect(listFiles(outDir)).toEqual(EXPECTED_FILES);
    expect([...firstFiles].sort()).toEqual(EXPECTED_FILES);
    expect(warnings).toEqual([]);
    for (const f of EXPECTED_FILES) expect(statSync(join(outDir, f)).size, f).toBeGreaterThan(0);
  });

  it('S2: every entry of the deny list has a case, and nothing denied is in the output', () => {
    expect([...SITE_DENY_LIST.folders].sort()).toEqual(['dist', 'extension', 'node_modules', 'sounds', 'src', 'test']);
    expect([...SITE_DENY_LIST.extensions].sort()).toEqual(['.map', '.md', '.ts', '.tsx', '.wav']);
    const files = listFiles(outDir);
    expect(files.filter((f) => /\.(wav|ts|tsx|map|md)$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.split('/').some((p) => p.startsWith('.')))).toEqual([]);
    expect(files.filter((f) => /(^|\/)(sounds|src|node_modules|extension|test)\//.test(f))).toEqual([]);
    expect(files.filter((f) => f.includes('deny'))).toEqual([]);
    expect(files.filter((f) => f.includes('/dist/') && !f.endsWith('/dist/app.js') && !f.startsWith('dist/'))).toEqual([]);
  });

  it('S3: the relative-URL scan finds every bad form in samples first, then finds nothing in the output', () => {
    const badHtml = [
      '<a href="/abs">', '<a href="//host/x">', '<script src="https://cdn.example/x.js"></script>', '<link href="http://x/y.css">',
      '<form action="/post">', '<img src="file:///c/x.png">', '<img srcset="/a.png 1x">', '<video poster="/p.png">',
      '<meta http-equiv="refresh" content="0; url=/home">', '<script src="data:text/javascript,1"></script>',
      '<script type="importmap">{"imports":{"tokk":"/dist/tokk.js"}}</script>',
      '<script type="importmap">{"imports":{"tokk":"https://x/y.js"}}</script>',
    ];
    for (const sample of badHtml) expect(scanHtml(sample), sample).not.toEqual([]);
    expect(scanHtml('<img src="data:image/png;base64,AAAA"><a href="a/">x</a><script src="./x.js"></script>')).toEqual([]);
    const badJs = [
      'a{background:url(/x.png)}', "@import '/x.css';", "import x from '/x.js';", "import '/x.js';", "import('/x.js')",
      "fetch('/x.json')", "new Worker('/w.js')", "new URL('/x', base)", "fetch('http://localhost:5173/x')", 'import{a}from"/x.js"',
    ];
    for (const sample of badJs) expect(scanScriptOrCss(sample), sample).not.toEqual([]);
    expect(scanScriptOrCss("import x from './x.js'; fetch('a.json'); new URL('b', import.meta.url); url(a.png)")).toEqual([]);
    expect(scanSiteFile('x.html', '<script type="module">import a from "/x.js";</script>')).not.toEqual([]);

    const problems = listFiles(outDir).flatMap((f) => scanSiteFile(f, readFileSync(join(outDir, f), 'utf8')));
    expect(problems).toEqual([]);
  });

  it('S4: the landing page follows the requirements', () => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta name="viewport"/);
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(hrefsOf(html)).toEqual(LANDING_HREFS);
    expect(html).not.toMatch(/<script|<link|<img|@import|https?:|transition|animation|<iframe/i);
    expect(html).toContain('Audio stays on your device');
    const rules = new Map<string, string>();
    for (const m of html.matchAll(/([^{}<>]+)\{([^}]*)\}/g)) rules.set(m[1].trim(), m[2]);
    const decl = (sel: string, prop: string): string => {
      const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(rules.get(sel) ?? '');
      if (!m) throw new Error(`no ${prop} colour in ${sel}`);
      return m[1];
    };
    const bg = decl('body', 'background');
    for (const fg of [decl('body', 'color'), decl('a', 'color'), decl('a:visited', 'color')]) {
      expect(contrastRatio(fg, bg), fg).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    }
    const focus = [...rules].find(([sel]) => sel.includes(':focus-visible'));
    expect(focus, 'a :focus-visible rule').toBeDefined();
    expect(Number(/outline\s*:\s*(\d+)px/.exec(focus?.[1] ?? '')?.[1])).toBeGreaterThanOrEqual(FOCUS_OUTLINE_MIN_PX);
    expect(html).toMatch(/max-width/);
  });

  it('S5: the hello page maps tokk to the local build, teach.html loads a relative script, and no source has an absolute URL', () => {
    const hello = read('examples/hello/index.html');
    expect(hello).toMatch(/<script type="importmap">\s*\{\s*"imports"\s*:\s*\{\s*"tokk"\s*:\s*"\.\.\/\.\.\/dist\/tokk\.js"\s*\}\s*\}\s*<\/script>/);
    expect(hello.indexOf('type="importmap"')).toBeLessThan(hello.indexOf('type="module"'));
    const inMarkers = hello.slice(hello.indexOf('// tokk:start'), hello.indexOf('// tokk:end'));
    expect(inMarkers).toContain("from 'tokk'");
    expect(inMarkers).not.toContain('importmap');
    expect(hello).not.toContain('/dist/tokk.js\'');
    const teach = read('teach.html');
    expect(teach).toContain('src="dist/teach-page.js"');
    for (const [name, text] of [['hello', hello], ['teach', teach]]) expect(scanSiteFile(`${name}.html`, text), name).toEqual([]);
  });

  it('S6: the guards refuse the repository root, its parent and a folder with .git before deleting anything', async () => {
    const withGit = tempDir('tokk-guard-');
    mkdirSync(join(withGit, '.git'));
    writeFileSync(join(withGit, 'keep.txt'), 'keep');
    for (const bad of [REPO_ROOT, dirname(REPO_ROOT), withGit]) {
      await expect(buildSite({ outDir: bad, appsDir: join(REPO_ROOT, 'no-such-apps') }), bad).rejects.toThrow();
    }
    expect(existsSync(join(withGit, 'keep.txt'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'package.json'))).toBe(true);
    // A stale file in an ordinary output folder is removed.
    const out = tempDir('tokk-stale-');
    writeFileSync(join(out, 'stale.txt'), 'x');
    await buildSite({ outDir: out, appsDir: join(REPO_ROOT, 'no-such-apps') });
    expect(existsSync(join(out, 'stale.txt'))).toBe(false);
  }, SITE_BUILD_TIMEOUT_MS);

  it('S7: a missing app gives one warning per dead link and no failure; two builds are byte-identical; the CLI takes --out and --apps-dir', async () => {
    const onlyOne = makeFixtureApps(['hands-free']);
    temps.push(onlyOne);
    const out = tempDir('tokk-one-');
    const result = await buildSite({ outDir: out, appsDir: onlyOne });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('apps/knock-once/');
    const none = await buildSite({ outDir: tempDir('tokk-none-'), appsDir: join(REPO_ROOT, 'no-such-apps') });
    expect(none.warnings).toHaveLength(2);

    const second = tempDir('tokk-second-');
    await buildSite({ outDir: second, appsDir });
    for (const f of EXPECTED_FILES) expect(readFileSync(join(second, f)).equals(readFileSync(join(outDir, f))), f).toBe(true);

    const cliOut = tempDir('tokk-cli-');
    const r = spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT, '--out', cliOut, '--apps-dir', onlyOne], { encoding: 'utf8', timeout: SITE_BUILD_TIMEOUT_MS });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('index.html');
    expect(r.stdout).toMatch(/total/i);
    expect(`${r.stdout}${r.stderr}`).toContain('apps/knock-once/');
    expect(listFiles(cliOut)).toContain('apps/hands-free/dist/app.js');
  }, SITE_BUILD_TIMEOUT_MS);
});
