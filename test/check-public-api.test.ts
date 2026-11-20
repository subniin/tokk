// Task 21 (requirement 11, test A1): scripts/check-public-api.ts as a child process on temporary trees.
// The two cases of test/scripts.test.ts stay as they are.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './web/paths';

const CHILD_TIMEOUT_MS = 60_000;
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-public-api.ts');
const TSX_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const MAIN = 'apps/demo/src/main.ts';

const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function run(files: Record<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'tokk-api-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const r = spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT], { cwd: root, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}
const importing = (spec: string, rel = MAIN): Record<string, string> => ({ [rel]: `import { a } from 'tokk';\nimport { b } from '${spec}';\n` });

describe('check-public-api (Task 21)', () => {
  it('A1: a clean fixture app passes, and a missing apps/ folder passes', () => {
    expect(run({ [MAIN]: "import { a } from 'tokk';\nimport { b } from 'tokk/node';\n" }).status).toBe(0);
    const none = run({});
    expect(none.status).toBe(0);
    expect(none.output).toContain('no apps/ folder');
  }, CHILD_TIMEOUT_MS);

  it.each([
    ['../../../web/listen', 'a path into web/ (the bypass)'],
    ['../../../core/segment', 'a path into core/'],
    ['../../../node/files', 'a path into node/'],
    ['../../../tools/mcp-ears/server', 'a path into tools/'],
    ['/core/segment', 'an absolute URL into core/'],
    ['/web/listen.js', 'an absolute URL into web/'],
    ['tokk/core', 'tokk/core'],
    ['tokk/core/segment', 'tokk/core/...'],
    ['tokk/web', 'tokk/web'],
    ['tokk/node/files', 'tokk/node/ with a path'],
    ['tokk/dist/tokk.js', 'tokk/dist/...'],
    ['core/segment', 'the bare name core/...'],
    ['web/listen', 'the bare name web/...'],
    ['node/files', 'the bare name node/...'],
    ['tools/x', 'the bare name tools/...'],
  ])('A1: %s is rejected (%s) with file and line', (spec) => {
    const r = run(importing(spec));
    expect(r.status).toBe(1);
    expect(r.output).toContain(`${MAIN}:2  ${spec}`);
  }, CHILD_TIMEOUT_MS);

  it.each([
    ['./web/panel', 'the app\'s own web/ folder'],
    ['./core/state', 'the app\'s own core/ folder'],
    ['../core/state', 'a core/ folder beside the app src/, at apps/demo/core'],
    ['./core-utils', 'a name that starts with core'],
    ['../../other/src/x', 'another app'],
    ['/apps/other/src/x', 'an absolute URL into apps/'],
    ['../../../../outside/core/x', 'a path that leaves the repository'],
    ['tokk', 'tokk'],
    ['tokk/node', 'tokk/node'],
    ['lodash', 'another package'],
  ])('A1: %s is allowed (%s)', (spec) => {
    expect(run(importing(spec)).status).toBe(0);
  }, CHILD_TIMEOUT_MS);

  it('A1: .mjs files are scanned and a comment line is skipped', () => {
    const r = run({ 'apps/demo/src/tool.mjs': "// import x from '../../../web/listen';\nimport y from '../../../web/listen';\n" });
    expect(r.status).toBe(1);
    expect(r.output).toContain('apps/demo/src/tool.mjs:2');
    expect(r.output).not.toContain('tool.mjs:1');
  }, CHILD_TIMEOUT_MS);

  it('A1: an inline module script in an .html file is scanned, the page text and other scripts are not', () => {
    const bad = run({
      'apps/demo/index.html': ['<p>import x from "../../web/listen"</p>', '<script type="module">', "  import { z } from '../../web/listen';", '</script>', ''].join('\n'),
    });
    expect(bad.status).toBe(1);
    expect(bad.output).toContain('apps/demo/index.html:3  ../../web/listen');
    expect(bad.output).not.toContain('index.html:1');
    const ok = run({
      'apps/demo/index.html': ['<p>import x from "../../web/listen"</p>', '<script>', "  import('../../web/listen');", '</script>', '<script type="module" src="./dist/app.js"></script>', ''].join('\n'),
    });
    expect(ok.status).toBe(0);
  }, CHILD_TIMEOUT_MS);

  it('A1: files below node_modules and dist are skipped', () => {
    expect(run({ 'apps/demo/dist/app.js': "import x from '../../../web/listen';\n", 'apps/demo/node_modules/p/i.js': "import x from '../../../../../web/y';\n" }).status).toBe(0);
  }, CHILD_TIMEOUT_MS);
});

// Task 26 (U2): the same rules for files below cases/.
describe('check-public-api and cases/ (Task 26, U2)', () => {
  const CASE_MAIN = 'cases/slides/src/main.ts';

  it.each([
    ['../../../web/listen', 'a path into web/'],
    ['../../../core/segment', 'a path into core/'],
    ['../../../node/files', 'a path into node/'],
    ['../../../tools/mcp-ears/server', 'a path into tools/'],
    ['/core/segment', 'an absolute URL into core/'],
    ['tokk/core', 'tokk/core'],
    ['tokk/dist/tokk.js', 'tokk/dist/...'],
    ['web/listen', 'the bare name web/...'],
  ])('U2: %s in a case file is rejected (%s) with file and line', (spec) => {
    const r = run(importing(spec, CASE_MAIN));
    expect(r.status).toBe(1);
    expect(r.output).toContain(`${CASE_MAIN}:2  ${spec}`);
  }, CHILD_TIMEOUT_MS);

  it.each([
    ['reveal.js', 'the package'],
    ['reveal.js/reveal.css', 'a documented CSS export'],
    ['reveal.js/reset.css', 'a documented CSS export'],
    ['reveal.js/theme/serif.css', 'a stock theme export'],
    ['tokk', 'tokk'],
    ['tokk/node', 'tokk/node'],
    ['./constants', 'a file of the case'],
  ])('U2: %s in a case file is allowed (%s)', (spec) => {
    expect(run(importing(spec, CASE_MAIN)).status).toBe(0);
  }, CHILD_TIMEOUT_MS);

  it('U2: a missing apps/ folder does not fail and cases/ is still scanned', () => {
    expect(run({ [CASE_MAIN]: "import Reveal from 'reveal.js';\n" }).status).toBe(0);
    const bad = run(importing('../../../web/listen', CASE_MAIN));
    expect(bad.status).toBe(1);
    expect(bad.output).toContain(`${CASE_MAIN}:2`);
  }, CHILD_TIMEOUT_MS);

  it('U2: a missing cases/ folder does not fail and apps/ is still scanned', () => {
    expect(run({ [MAIN]: "import { a } from 'tokk';\n" }).status).toBe(0);
    expect(run(importing('../../../web/listen')).status).toBe(1);
  }, CHILD_TIMEOUT_MS);

  it('U2: both folders are scanned in one run, and both missing still passes', () => {
    const r = run({ ...importing('../../../web/listen'), ...importing('../../../core/x', CASE_MAIN) });
    expect(r.status).toBe(1);
    expect(r.output).toContain(`${MAIN}:2`);
    expect(r.output).toContain(`${CASE_MAIN}:2`);
    const none = run({});
    expect(none.status).toBe(0);
    expect(none.output).toContain('no apps/ folder');
    expect(none.output).toContain('no cases/ folder');
  }, CHILD_TIMEOUT_MS);

  it('U2: a case file under dist or node_modules is skipped, and an html module script is scanned', () => {
    expect(run({ 'cases/slides/dist/app.js': "import x from '../../../web/listen';\n" }).status).toBe(0);
    const bad = run({ 'cases/slides/index.html': ['<script type="module">', "  import { z } from '../../web/listen';", '</script>', ''].join('\n') });
    expect(bad.status).toBe(1);
    expect(bad.output).toContain('cases/slides/index.html:2  ../../web/listen');
  }, CHILD_TIMEOUT_MS);
});