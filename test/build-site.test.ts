// Task 21: scripts/build-site.ts (tests S1 to S7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildSite, SITE_DENY_LIST } from '../scripts/build-site';
import { FIXTURE_APP_NAMES, makeFixtureApps } from './helpers/fixture-apps';
import { hrefsOf, scanHtml, scanScriptOrCss, scanSiteFile } from './helpers/relative-urls';
import { REPO_ROOT } from './web/paths';

const SITE_BUILD_TIMEOUT_MS = 180_000;
const CASE_LINK_WARNING = 'index.html links to "cases/slides/"';
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
  'index.html', 'teach.html', 'dist/tokk.js', 'dist/teach-page.js', 'dist/landing.js', 'dist/landing.css',
  'examples/hello/index.html', 'examples/hello/sounds.json', 'media/clap-demo.wav', 'media/clap-demo-sounds.json',
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
    // Task 26 (named update): with only an appsDir no case is copied, so the one dead link is the cases/slides/ link of the landing page.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CASE_LINK_WARNING);
    for (const f of EXPECTED_FILES) expect(statSync(join(outDir, f)).size, f).toBeGreaterThan(0);
  });

  it('S2: every entry of the deny list has a case, and nothing denied is in the output', () => {
    expect([...SITE_DENY_LIST.folders].sort()).toEqual(['dist', 'extension', 'node_modules', 'sounds', 'src', 'test']);
    expect([...SITE_DENY_LIST.extensions].sort()).toEqual(['.map', '.md', '.ts', '.tsx', '.wav']);
    const files = listFiles(outDir);
    expect(files.filter((f) => !f.startsWith('media/') && /\.(wav|ts|tsx|map|md)$/.test(f))).toEqual([]);
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
    // Task 35: a link to this repository on GitHub is the one allowed external URL, and only in an <a>.
    expect(scanHtml('<a href="https://github.com/subniin/tokk">x</a><a href="https://github.com/subniin/tokk/blob/main/docs/kiro.md">x</a>')).toEqual([]);
    for (const sample of ['<a href="https://github.com/other/tokk">', '<a href="https://github.com/subniin/tokk-evil">', '<link href="https://github.com/subniin/tokk">', '<img src="https://github.com/subniin/tokk/x.png">']) expect(scanHtml(sample), sample).not.toEqual([]);
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

  it('S4: the landing page of the output follows the requirements (the copy and the style are checked in test/landing.test.ts)', () => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta name="viewport"/);
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(hrefsOf(html)).toContain('apps/click-talk/');
    expect(hrefsOf(html)).toContain('apps/shoo/');
    expect(hrefsOf(html)).toContain('cases/slides/');
    expect(hrefsOf(html)).toContain('teach.html');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).toContain('Audio stays on the device');
    expect(html).toContain('src="dist/landing.js"');
    expect(html).toContain('href="dist/landing.css"');
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
    const onlyOne = makeFixtureApps(['click-talk']);
    temps.push(onlyOne);
    const out = tempDir('tokk-one-');
    const result = await buildSite({ outDir: out, appsDir: onlyOne });
    // Task 26 (named update): one more dead link, cases/slides/, because no casesDir is given.
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.filter((w) => w.includes('apps/shoo/'))).toHaveLength(1);
    expect(result.warnings.filter((w) => w.includes(CASE_LINK_WARNING))).toHaveLength(1);
    const none = await buildSite({ outDir: tempDir('tokk-none-'), appsDir: join(REPO_ROOT, 'no-such-apps') });
    expect(none.warnings).toHaveLength(3);

    const second = tempDir('tokk-second-');
    await buildSite({ outDir: second, appsDir });
    for (const f of EXPECTED_FILES) expect(readFileSync(join(second, f)).equals(readFileSync(join(outDir, f))), f).toBe(true);

    const cliOut = tempDir('tokk-cli-');
    const r = spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT, '--out', cliOut, '--apps-dir', onlyOne], { encoding: 'utf8', timeout: SITE_BUILD_TIMEOUT_MS });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('index.html');
    expect(r.stdout).toMatch(/total/i);
    expect(`${r.stdout}${r.stderr}`).toContain('apps/shoo/');
    expect(listFiles(cliOut)).toContain('apps/click-talk/dist/app.js');
  }, SITE_BUILD_TIMEOUT_MS);
});

// Task 26 (U3): cases/<name> is copied and bundled like an app, without sounds.json.
describe('the site build and cases (Task 26, U3)', () => {
  const CASE_NAME = 'slides';
  const LICENSE_NAME = 'LICENSE-revealjs.txt';
  const EXPECTED_CASE_FILES = [
    `cases/${CASE_NAME}/${LICENSE_NAME}`, `cases/${CASE_NAME}/dist/app.css`, `cases/${CASE_NAME}/dist/app.js`, `cases/${CASE_NAME}/index.html`,
  ];
  let casesDir = '';
  let appsDir = '';
  let outDir = '';
  let withCases: string[] = [];

  // A fixture case: real source that imports CSS, and extras that the site must not contain.
  function makeFixtureCases(): string {
    const dir = tempDir('tokk-cases-');
    const put = (rel: string, text: string): void => {
      mkdirSync(dirname(join(dir, CASE_NAME, rel)), { recursive: true });
      writeFileSync(join(dir, CASE_NAME, rel), text);
    };
    put('index.html', ['<!doctype html>', '<html lang="en"><head><meta charset="utf-8"><title>Fixture case</title>', '<link rel="stylesheet" href="./dist/app.css"></head>', '<body><h1>Case</h1><script type="module" src="./dist/app.js"></script></body></html>', ''].join('\n'));
    put('src/main.ts', "import './style.css';\nimport { NAME } from './constants';\ndocument.title = NAME;\n");
    put('src/constants.ts', "export const NAME = 'fixture case';\n");
    put('src/style.css', 'h1 { color: #111111; }\n');
    put(LICENSE_NAME, 'Copyright (C) fixture\n');
    put('sounds.json', '{"labels":{}}\n');
    put('sounds/clap/clap-01.wav', 'RIFF');
    put('recordings/clap-x2.wav', 'RIFF');
    put('test/x.txt', 'x');
    put('notes.md', '# notes\n');
    put('README.md', '# readme\n');
    put('extra.wav', 'RIFF');
    put('.hidden', 'x');
    return dir;
  }

  beforeAll(async () => {
    casesDir = makeFixtureCases();
    appsDir = makeFixtureApps();
    temps.push(appsDir);
    outDir = tempDir('tokk-site-cases-');
    withCases = (await buildSite({ outDir, appsDir, casesDir })).files.map((f) => f.path);
  }, SITE_BUILD_TIMEOUT_MS);

  it('U3: a case is copied without sounds.json, src, recordings, test, .wav, .md and dot files, and the LICENSE copy stays', () => {
    const files = listFiles(outDir).filter((f) => f.startsWith('cases/'));
    expect(files).toEqual(EXPECTED_CASE_FILES);
    expect([...withCases].filter((f) => f.startsWith('cases/')).sort()).toEqual(EXPECTED_CASE_FILES);
    expect(files.filter((f) => /sounds|recordings|\/src\/|\.wav$|\.md$|\.ts$|\.map$/.test(f))).toEqual([]);
    // Not even an empty recordings folder is left behind (requirement 4.4).
    expect(existsSync(join(outDir, 'cases', CASE_NAME, 'recordings'))).toBe(false);
    expect(readFileSync(join(outDir, 'cases', CASE_NAME, LICENSE_NAME), 'utf8')).toBe('Copyright (C) fixture\n');
  });

  it('U3: the bundle and its CSS are written, minified, and the CSS holds the imported rule', () => {
    const js = readFileSync(join(outDir, 'cases', CASE_NAME, 'dist', 'app.js'), 'utf8');
    expect(js).toContain('fixture case');
    expect(js.split('\n').length).toBeLessThan(5);
    expect(readFileSync(join(outDir, 'cases', CASE_NAME, 'dist', 'app.css'), 'utf8')).toMatch(/h1\s*\{\s*color:\s*#111/);
  });

  it('U3: every URL of the case output is relative, and the apps are still there', () => {
    const problems = listFiles(outDir).filter((f) => f.startsWith('cases/')).flatMap((f) => scanSiteFile(f, readFileSync(join(outDir, f), 'utf8')));
    expect(problems).toEqual([]);
    expect(scanSiteFile('x.html', '<link rel="stylesheet" href="/dist/app.css">')).not.toEqual([]);
    expect(listFiles(outDir)).toContain('apps/click-talk/dist/app.js');
  });

  it('U3: no case is copied when only appsDir is given, and the file list is the one of the app-only build', async () => {
    const out = tempDir('tokk-site-nocases-');
    await buildSite({ outDir: out, appsDir });
    expect(listFiles(out)).toEqual(EXPECTED_FILES);
    expect(listFiles(outDir).filter((f) => !f.startsWith('cases/'))).toEqual(EXPECTED_FILES);
  }, SITE_BUILD_TIMEOUT_MS);

  it('U3: a missing casesDir copies no case and does not fail', async () => {
    const out = tempDir('tokk-site-nocasesdir-');
    await buildSite({ outDir: out, appsDir, casesDir: join(REPO_ROOT, 'no-such-cases') });
    expect(listFiles(out)).toEqual(EXPECTED_FILES);
  }, SITE_BUILD_TIMEOUT_MS);

  it('U3: a case that does not build names the case and fails', async () => {
    const dir = makeFixtureCases();
    writeFileSync(join(dir, CASE_NAME, 'src', 'main.ts'), "import { nothing } from './missing-file';\nconsole.log(nothing);\n");
    await expect(buildSite({ outDir: tempDir('tokk-site-broken-'), appsDir, casesDir: dir })).rejects.toThrow(/Case "slides" failed to build/);
  }, SITE_BUILD_TIMEOUT_MS);

  it('U3: the CLI takes --cases-dir', () => {
    const out = tempDir('tokk-cli-cases-');
    const r = spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT, '--out', out, '--apps-dir', appsDir, '--cases-dir', casesDir], { encoding: 'utf8', timeout: SITE_BUILD_TIMEOUT_MS });
    expect(r.status, r.stderr).toBe(0);
    expect(listFiles(out)).toContain('cases/slides/dist/app.js');
    expect(`${r.stdout}${r.stderr}`).not.toContain('Warning');
  }, SITE_BUILD_TIMEOUT_MS);
});
// Task 35: the page bundle, the media folder and the links of the page.
describe('the site build and the new page (Task 35, run A)', () => {
  const GITHUB = 'https://github.com/subniin/tokk';
  let appsDir = '';
  let casesDir = '';
  let outDir = '';
  let siteSrcDir = '';
  let result: { warnings: string[]; files: { path: string }[] };

  // A fixture page: the real source layout (index.html, src/main.ts, style.css) and a media folder with a .wav and a nested file.
  function makeFixtureSite(): string {
    const dir = tempDir('tokk-site-src-');
    const put = (rel: string, text: string | Uint8Array): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    put('index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title><link rel="stylesheet" href="dist/landing.css"></head><body><h1>Fixture</h1><a href="apps/click-talk/">a</a><a href="#top">t</a><a href="' + GITHUB + '">g</a><script type="module" src="dist/landing.js"></script></body></html>');
    put('src/main.ts', "import '../style.css';\nimport { NAME } from './constants';\ndocument.title = NAME;\n");
    put('src/constants.ts', "export const NAME = 'fixture page';\n");
    put('style.css', 'h1 { color: #111111; }\n');
    put('media/clap-demo.wav', new Uint8Array([82, 73, 70, 70, 0, 1, 2, 3]));
    put('media/nested/model.json', '{"a":1}\n');
    put('media/notes.md', '# kept as it is\n');
    return dir;
  }

  beforeAll(async () => {
    appsDir = makeFixtureApps();
    temps.push(appsDir);
    casesDir = join(REPO_ROOT, 'cases');
    siteSrcDir = makeFixtureSite();
    outDir = tempDir('tokk-site-page-');
    result = await buildSite({ outDir, appsDir, casesDir, siteSrcDir });
  }, SITE_BUILD_TIMEOUT_MS);

  it('P1: the output holds the page, its bundle and CSS, both apps, the slides case and teach.html, and no warning', () => {
    const files = listFiles(outDir);
    for (const f of ['index.html', 'dist/landing.js', 'dist/landing.css', 'teach.html', 'apps/click-talk/index.html', 'apps/click-talk/dist/app.js',
      'apps/shoo/index.html', 'apps/shoo/dist/app.js', 'cases/slides/index.html', 'cases/slides/dist/app.js']) expect(files, f).toContain(f);
    expect(result.warnings).toEqual([]);
  });

  it('P2: site-src/media is copied as it is, .wav and .md included, and nothing else of site-src is copied', () => {
    expect(readFileSync(join(outDir, 'media', 'clap-demo.wav')).equals(readFileSync(join(siteSrcDir, 'media', 'clap-demo.wav')))).toBe(true);
    expect(readFileSync(join(outDir, 'media', 'nested', 'model.json'), 'utf8')).toBe('{"a":1}\n');
    expect(readFileSync(join(outDir, 'media', 'notes.md'), 'utf8')).toBe('# kept as it is\n');
    const files = listFiles(outDir);
    expect(files.filter((f) => f.startsWith('media/'))).toEqual(['media/clap-demo.wav', 'media/nested/model.json', 'media/notes.md']);
    expect(files.filter((f) => /^(src|style\.css)/.test(f))).toEqual([]);
  });

  it('P3: the page bundle is minified and its CSS holds the imported rule', () => {
    const js = readFileSync(join(outDir, 'dist', 'landing.js'), 'utf8');
    expect(js).toContain('fixture page');
    expect(js.split('\n').length).toBeLessThan(5);
    expect(readFileSync(join(outDir, 'dist', 'landing.css'), 'utf8')).toMatch(/h1\s*\{\s*color:\s*#111/);
  });

  it('P4: no dead link, and no external URL except links that start with the GitHub repository, in every file', () => {
    const problems = listFiles(outDir).flatMap((f) => scanSiteFile(f, readFileSync(join(outDir, f), 'utf8')));
    expect(problems).toEqual([]);
    for (const f of ['index.html', 'dist/landing.css']) {
      const text = readFileSync(join(outDir, f), 'utf8').split(GITHUB).join('');
      expect(text, f).not.toMatch(/https?:\/\//);
    }
  });

  it('P5: a missing media folder copies nothing and does not fail; a dead link, an anchor and a GitHub link are told apart', async () => {
    const noMedia = makeFixtureSite();
    rmSync(join(noMedia, 'media'), { recursive: true });
    const out = tempDir('tokk-site-nomedia-');
    const noApps = await buildSite({ outDir: out, appsDir: join(REPO_ROOT, 'no-such-apps'), casesDir: join(REPO_ROOT, 'no-such-cases'), siteSrcDir: noMedia });
    expect(existsSync(join(out, 'media'))).toBe(false);
    // Only the link to a missing app is a warning. "#top" and the GitHub link are not.
    expect(noApps.warnings).toHaveLength(1);
    expect(noApps.warnings[0]).toContain('apps/click-talk/');
  }, SITE_BUILD_TIMEOUT_MS);

  it('P6: the real page builds with the real source folder: landing.js, landing.css and index.html', async () => {
    const out = tempDir('tokk-site-real-page-');
    const real = await buildSite({ outDir: out, appsDir, casesDir });
    expect(listFiles(out)).toEqual(expect.arrayContaining(['index.html', 'dist/landing.js', 'dist/landing.css']));
    expect(real.warnings).toEqual([]);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toBe(readFileSync(join(REPO_ROOT, 'site-src', 'index.html'), 'utf8'));
  }, SITE_BUILD_TIMEOUT_MS);
});