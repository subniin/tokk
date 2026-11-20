// Task 21: scripts/count-wiring.ts (tests C1 to C11).
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { collectGroups, countWiring, formatReport, WiringError } from '../scripts/count-wiring';
import { REPO_ROOT } from './web/paths';

const CLI_TIMEOUT_MS = 60_000;
const SCRIPT = join(REPO_ROOT, 'scripts', 'count-wiring.ts');
const TSX_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const block = (...body: string[]): string => ['// tokk:start', ...body, '// tokk:end'].join('\n');

const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function put(root: string, rel: string, text: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tokk-wiring-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}
function error(source: string): WiringError {
  try { countWiring(source); } catch (e) { return e as WiringError; }
  throw new Error('countWiring did not throw');
}

describe('countWiring (Task 21)', () => {
  it('C1: counts the plain lines between the markers, not the markers', () => {
    expect(countWiring(block('const a = 1;', 'const b = 2;'))).toEqual({ lines: 2, blocks: 1 });
    expect(countWiring('const outside = 1;\n')).toEqual({ lines: 0, blocks: 0 });
  });
  it('C2: blank lines and // comment lines are skipped', () => {
    expect(countWiring(block('', '   ', '// a note', '  // indented note', 'run();'))).toEqual({ lines: 1, blocks: 1 });
  });
  it('C3: block comments are skipped, code after */ counts', () => {
    expect(countWiring(block('/* one line */', 'a();'))).toEqual({ lines: 1, blocks: 1 });
    expect(countWiring(block('/* start', ' * middle', '', 'plain text inside', ' */', 'b();'))).toEqual({ lines: 1, blocks: 1 });
    expect(countWiring(block('/* x */ c();'))).toEqual({ lines: 1, blocks: 1 });
    expect(countWiring(block('/* open', 'still comment', '*/ d();'))).toEqual({ lines: 1, blocks: 1 });
  });
  it('C4: a line with code and a trailing comment counts', () => {
    expect(countWiring(block('a(); // why', 'b(); /* why */'))).toEqual({ lines: 2, blocks: 1 });
  });
  it('C5: several blocks add up', () => {
    expect(countWiring(`${block('a();', 'b();')}\nmiddle();\n${block('c();')}\n`)).toEqual({ lines: 3, blocks: 2 });
  });
  it('C6: CRLF gives the same count as LF, whatever the indentation and trailing spaces', () => {
    const lf = block('  a();   ', '\tb();', '', '// c');
    expect(countWiring(lf.replace(/\n/g, '\r\n'))).toEqual(countWiring(lf));
    expect(countWiring(lf)).toEqual({ lines: 2, blocks: 1 });
  });
  it('C7: each malformed form throws a WiringError with the 1-based line', () => {
    const noOpen = error('a();\n// tokk:end\n');
    expect(noOpen).toBeInstanceOf(WiringError);
    expect(noOpen.line).toBe(2);
    expect(noOpen.message).toMatch(/tokk:end/);
    const twice = error('// tokk:start\na();\n// tokk:start\n// tokk:end\n');
    expect(twice.line).toBe(3);
    expect(twice.message).toMatch(/already open|second/);
    const unclosed = error('x();\n// tokk:start\na();\n');
    expect(unclosed.line).toBe(2);
    expect(unclosed.message).toMatch(/never closed|not closed/);
  });
  it('C8: a marker line may be indented and may have trailing text', () => {
    expect(countWiring('    // tokk:start (setup)\n    a();\n    // tokk:end  done\n')).toEqual({ lines: 1, blocks: 1 });
  });
});

describe('collectGroups and the CLI (Task 21)', () => {
  const files = {
    'apps/zeta/src/main.ts': block('a();', 'b();'),
    'apps/zeta/src/deep/more.ts': `x();\n${block('c();')}\n`,
    'apps/zeta/src/none.ts': 'no markers here();\n',
    'apps/zeta/dist/app.js': block('skipped();'),
    'apps/zeta/index.html': block('not-in-src();'),
    'apps/alpha/src/main.ts': 'plain();\n',
    'apps/README.md': block('md();'),
    'examples/hello/index.html': `<script type="module">\n${block('import x;', 'go();')}\n</script>\n`,
    'examples/hello/sounds/skip.js': block('skipped();'),
    'examples/hello/notes.css': block('skipped();'),
    'examples/loose.html': block('loose();'),
  };

  it('C9: groups by app and example, sorted, with skipped folders and extensions, and a group without markers', () => {
    const root = tree(files);
    const groups = collectGroups(root);
    expect(groups.map((g) => [g.name, g.kind, g.lines, g.blocks])).toEqual([
      ['apps/alpha', 'app', 0, 0],
      ['apps/zeta', 'app', 3, 2],
      ['examples/hello', 'example', 2, 1],
    ]);
    expect(groups[1].files).toEqual([{ path: 'apps/zeta/src/deep/more.ts', lines: 1 }, { path: 'apps/zeta/src/main.ts', lines: 2 }]);
    expect(groups[0].files).toEqual([]);
    expect(formatReport(groups, false)).toContain('apps/alpha');
    expect(formatReport(groups, false)).toContain('no markers');
    expect(formatReport(groups, false).trimEnd().split('\n').pop()).toBe('3 groups');
    expect(JSON.parse(formatReport(groups, true))).toEqual({ groups });
  });

  it('C10: the CLI prints text, prints only JSON with --json, and exits 1 with path:line for a malformed file', () => {
    const run = (root: string, ...args: string[]) =>
      spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT, '--root', root, ...args], { encoding: 'utf8', timeout: CLI_TIMEOUT_MS });
    const root = tree(files);
    const text = run(root);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('apps/zeta');
    expect(text.stdout).toContain('3 groups');
    const json = run(root, '--json');
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout).groups).toHaveLength(3);
    expect(json.stdout.startsWith('{\n  "groups"')).toBe(true);
    const bad = tree({ 'apps/bad/src/main.ts': 'a();\n// tokk:end\n' });
    const failed = run(bad);
    expect(failed.status).toBe(1);
    expect(`${failed.stdout}${failed.stderr}`).toContain('apps/bad/src/main.ts:2');
  }, CLI_TIMEOUT_MS);

  it('C11: the real repository reports examples/hello with the count of its own text', () => {
    const page = readFileSync(join(REPO_ROOT, 'examples', 'hello', 'index.html'), 'utf8');
    const expected = countWiring(page);
    expect(expected.blocks).toBe(1);
    const hello = collectGroups(REPO_ROOT).find((g) => g.name === 'examples/hello');
    expect(hello).toMatchObject({ kind: 'example', lines: expected.lines, blocks: 1 });
  });
});
