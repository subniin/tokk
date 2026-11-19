import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach } from 'vitest';
import { mkdir as mkdirAsync, readFile, writeFile as writeFileAsync } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getCommit, runScore } from '../scripts/score';
import { buildModel, type Hit } from './helpers/engine-fixture';
import { FIXTURE_SAMPLE_RATE_HZ, LEAD_MS, removeTempDirs, tempDir, writeFixture, type RecordingSpec } from './helpers/score-fixture';
const APP_FILE = 'apps/demo/main.ts';
const UTIL_FILE = 'apps/demo/util.ts';
const FORBIDDEN_LINE = 2;
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-public-api.ts');

const TSX_URL = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function write(root: string, rel: string, text: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function runInTempRoot(files: Record<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'tokk-scripts-'));
  try {
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    const r = spawnSync(process.execPath, ['--import', TSX_URL, SCRIPT], { cwd: root, encoding: 'utf8' });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('scripts', () => {
  it('check-public-api exits 1 and names the file for an app importing core/segment', () => {
    const { status, output } = runInTempRoot({
      [APP_FILE]: "import { x } from 'tokk';\nimport { segment } from '../../core/segment';\n",
    });
    expect(status).toBe(1);
    expect(output).toContain(`${APP_FILE}:${FORBIDDEN_LINE}`);
  }, 30000);

  it('check-public-api exits 0 when apps only import from tokk', () => {
    const { status } = runInTempRoot({
      [APP_FILE]: "import { a } from 'tokk';\nimport { b } from 'tokk/node';\n",
      [UTIL_FILE]: "import { c } from './core-utils';\nexport const d = c;\n",
    });
    expect(status).toBe(0);
  }, 30000);
});

// Scoring script (Task 9a). Every run uses a temporary project root, never the real docs/.
const SPACING_MS = 700;
const TAIL_MS = 1000;
const GAIN_DB = -6;
const FIXED_NOW = new Date(Date.UTC(2026, 10, 19, 12, 0, 0));
const FIXED_COMMIT = 'abc1234';
const EXIT_OK = 0;
const EXIT_REGRESSION = 1;
const EXIT_USAGE = 2;
const SHORT_HASH_MIN_LENGTH = 7;

afterEach(removeTempDirs);

function hits(cls: 'low' | 'mid' | 'high' | 'ring', count: number, startMs: number): Hit[] {
  return Array.from({ length: count }, (_, i) => ({ atMs: startMs + i * SPACING_MS, cls, gainDb: GAIN_DB }));
}

interface Setup { root: string; quick: string; sounds: string; out: string[]; err: string[] }

async function setup(): Promise<Setup> {
  const root = await tempDir('tokk-root-');
  await mkdirAsync(join(root, 'docs'), { recursive: true });
  const quick = join(root, 'fixtures', 'quick');
  await mkdirAsync(quick, { recursive: true });
  const all = [...hits('low', 3, LEAD_MS), ...hits('mid', 3, LEAD_MS + 3 * SPACING_MS)];
  const rec: RecordingSpec = { name: 'a', hits: all, seed: 21, totalMs: LEAD_MS + 6 * SPACING_MS + TAIL_MS };
  await writeFixture(quick, [rec]);
  const sounds = join(root, 'sounds.json');
  await writeFileAsync(sounds, JSON.stringify(buildModel(['low', 'mid'], FIXTURE_SAMPLE_RATE_HZ)));
  return { root, quick, sounds, out: [], err: [] };
}

function run(s: Setup, args: string[], commit = FIXED_COMMIT): Promise<number> {
  return runScore(args, {
    root: s.root, cwd: s.root, out: (x) => s.out.push(x), err: (x) => s.err.push(x),
    getCommit: () => commit, now: () => FIXED_NOW,
  });
}

const experiments = (s: Setup): string => join(s.root, 'docs', 'experiments.md');

describe('score script', () => {
  it('exits 0 without a baseline, creates experiments.md with a header and one line', async () => {
    const s = await setup();
    expect(await run(s, [s.quick, s.sounds])).toBe(EXIT_OK);
    const text = await readFile(experiments(s), 'utf8');
    expect(text).toMatch(/^# /);
    expect(text).toContain('date | commit | recall per label | FP/h');
    expect(text.trimEnd().split('\n').filter((l) => l.startsWith('2026-'))).toEqual(['2026-11-19 | abc1234 | low 1.000, mid 1.000 | 0.0']);
    expect(s.out.join('\n')).toContain('no baseline');
  });

  it('writes docs/scores-<folder>.json with --update-baseline, then a second run exits 0', async () => {
    const s = await setup();
    expect(await run(s, [s.quick, s.sounds, '--update-baseline'])).toBe(EXIT_OK);
    const baseline = join(s.root, 'docs', 'scores-quick.json');
    const saved = JSON.parse(await readFile(baseline, 'utf8'));
    expect(saved.perLabel.map((l: { label: string }) => l.label)).toEqual(['low', 'mid']);
    expect((await readFile(baseline, 'utf8')).endsWith('}\n')).toBe(true);
    expect(existsSync(join(s.root, 'docs', 'scores.json'))).toBe(false);
    expect(await run(s, [s.quick, s.sounds])).toBe(EXIT_OK);
  });

  it('does not compare a folder with the baseline of another folder', async () => {
    const s = await setup();
    await run(s, [s.quick, s.sounds, '--update-baseline']);
    const full = join(s.root, 'fixtures', 'full');
    await mkdirAsync(full, { recursive: true });
    await writeFixture(full, [{ name: 'a', hits: hits('low', 1, LEAD_MS), seed: 22, totalMs: LEAD_MS + TAIL_MS + SPACING_MS }]);
    s.out.length = 0;
    expect(await run(s, [full, s.sounds])).toBe(EXIT_OK);
    expect(s.out.join('\n')).toContain('no baseline');
  });

  it('exits 1 for a model that loses hits and still appends a line', async () => {
    const s = await setup();
    await run(s, [s.quick, s.sounds, '--update-baseline']);
    await writeFileAsync(s.sounds, JSON.stringify(buildModel(['high', 'ring'], FIXTURE_SAMPLE_RATE_HZ)));
    expect(await run(s, [s.quick, s.sounds])).toBe(EXIT_REGRESSION);
    const lines = (await readFile(experiments(s), 'utf8')).split('\n').filter((l) => l.startsWith('2026-'));
    expect(lines).toHaveLength(2);
    expect(s.out.join('\n')).toMatch(/REGRESSION/);
    expect(s.out.join('\n')).toMatch(/low|mid/);
  });

  it('exits 2 and appends nothing for wrong use and invalid input', async () => {
    const s = await setup();
    const empty = join(s.root, 'fixtures', 'empty');
    await mkdirAsync(empty, { recursive: true });
    const badSounds = join(s.root, 'bad-sounds.json');
    await writeFileAsync(badSounds, '{"version":2}');
    await writeFileAsync(join(s.root, 'docs', 'scores-quick.json'), '{"nope":1}');
    const cases: string[][] = [
      [],
      [s.quick],
      [s.quick, s.sounds, 'extra'],
      [s.quick, s.sounds, '--bogus'],
      [s.quick, join(s.root, 'missing.json')],
      [s.quick, badSounds],
      [s.quick, s.sounds],                          // invalid baseline
      [empty, s.sounds],                            // nothing to score
      [join(s.root, 'fixtures', 'nope'), s.sounds], // missing folder
    ];
    for (const args of cases) {
      s.err.length = 0;
      expect(await run(s, args), args.join(' ')).toBe(EXIT_USAGE);
      expect(s.err.join('\n').length).toBeGreaterThan(0);
    }
    expect(existsSync(experiments(s))).toBe(false);
    expect(s.err.join('\n')).toBeTruthy();
  });

  it('prints a usage line for wrong use', async () => {
    const s = await setup();
    await run(s, []);
    expect(s.err.join('\n')).toMatch(/Usage: npm run score/);
  });

  it('adds a newline before the line when experiments.md does not end in one', async () => {
    const s = await setup();
    await writeFileAsync(experiments(s), '# Experiments\n\nold text');
    await run(s, [s.quick, s.sounds]);
    const text = await readFile(experiments(s), 'utf8');
    expect(text.startsWith('# Experiments\n\nold text\n2026-11-19 | abc1234 |')).toBe(true);
  });

  it('warns on the error stream and does not exit 1 for warnings', async () => {
    const s = await setup();
    await writeFileAsync(join(s.quick, 'orphan.json'), JSON.stringify({ events: [] }));
    expect(await run(s, [s.quick, s.sounds])).toBe(EXIT_OK);
    expect(s.err.join('\n')).toContain('orphan.json');
  });
});

const hasGit = spawnSync('git', ['--version']).status === 0;

describe('getCommit', () => {
  it('gives uncommitted for a plain folder', async () => {
    const d = await tempDir('tokk-plain-');
    expect(getCommit(d)).toBe('uncommitted');
  });

  it.skipIf(!hasGit)('gives a short hash for a clean repository and uncommitted after a change', async () => {
    const d = await tempDir('tokk-repo-');
    const git = (...a: string[]): void => {
      const r = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: d });
      if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    };
    git('init');
    await writeFileAsync(join(d, 'a.txt'), 'one');
    git('add', '-A');
    git('commit', '-m', 'first');
    expect(getCommit(d)).toMatch(new RegExp(`^[0-9a-f]{${SHORT_HASH_MIN_LENGTH},}$`));
    await writeFileAsync(join(d, 'a.txt'), 'two');
    expect(getCommit(d)).toBe('uncommitted');
  });
});