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
import { FIXTURE_SAMPLE_RATE_HZ, LEAD_MS, removeTempDirs, tempDir, wav24Bytes, writeFixture, type RecordingSpec } from './helpers/score-fixture';
import { cp, readdir, rm } from 'node:fs/promises';
import { runSoundsRebuild } from '../scripts/sounds-rebuild';
import { runCorpusScore } from '../scripts/corpus-score';
import { writeWavFile } from '../node/files';
import { CORPUS_SCORE_BUDGET_MS } from '../core/constants';
import { LEAD_MS as TRAIN_LEAD_MS, TRAIN_SPACING_MS, TRAIL_MS, makeSignal } from './helpers/engine-fixture';
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
// Task 11B: sounds-rebuild, corpus-score, hooks, MCP file, steering, tsconfig, experiments header.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REBUILD_SR_HZ = 16000;
const REBUILD_PER_CLASS = 10;
const REBUILD_FEW = 4;
const REBUILD_GAIN_DB = -6;
const EARLY_HIT_MS = 300;
const SLOW_TEST_MS = 120000;
const SYNTH_REL = join('fixtures', 'audio', 'synth');
const NOTE_PATTERN = /nothing to rebuild|no label folders/;

interface Io { out: string[]; err: string[]; text: () => string; errText: () => string }

function io(): Io {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, text: () => out.join(''), errText: () => err.join('') };
}

function rebuild(cwd: string, argv: string[], i: Io): Promise<number> {
  return runSoundsRebuild(argv, { cwd, out: (s) => i.out.push(s), err: (s) => i.err.push(s) });
}

function classHits(cls: 'low' | 'mid' | 'high' | 'ring', count: number, firstMs = TRAIN_LEAD_MS) {
  return Array.from({ length: count }, (_, k) => ({ atMs: firstMs + k * TRAIN_SPACING_MS, cls, gainDb: REBUILD_GAIN_DB }));
}

async function putClass(sounds: string, label: string, cls: 'low' | 'mid' | 'high' | 'ring', count: number, seed: number, firstMs = TRAIN_LEAD_MS, file = 'a.wav'): Promise<void> {
  await mkdirAsync(join(sounds, label), { recursive: true });
  const samples = makeSignal({
    sampleRate: REBUILD_SR_HZ, totalMs: firstMs + count * TRAIN_SPACING_MS + TRAIL_MS, hits: classHits(cls, count, firstMs), seed,
  });
  await writeWavFile(join(sounds, label, file), samples, REBUILD_SR_HZ);
}

async function projectWith(labels: Record<string, 'low' | 'mid' | 'high' | 'ring'>, count = REBUILD_PER_CLASS): Promise<{ root: string; sounds: string }> {
  const root = await tempDir('tokk-rebuild-');
  const sounds = join(root, 'examples', 'sounds');
  let seed = 1000;
  for (const [label, cls] of Object.entries(labels)) await putClass(sounds, label, cls, count, (seed += 100));
  return { root, sounds };
}

describe('sounds-rebuild script', () => {
  it('writes sounds.json next to the sounds folder, with the summary, labels and confused line', async () => {
    const { root, sounds } = await projectWith({ low: 'low', high: 'high' });
    const i = io();
    expect(await rebuild(root, [sounds], i)).toBe(EXIT_OK);
    const target = join(root, 'examples', 'sounds.json');
    expect(existsSync(target)).toBe(true);
    const text = await readFile(target, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "version": 1');
    const out = i.text();
    expect(out).toMatch(/^taught 2 sounds, \d+ examples -> examples\/sounds\.json\n/);
    expect(out).toMatch(/^high: \d+ examples, LOO accuracy \d\.\d\d$/m);
    expect(out).toMatch(/^low: \d+ examples, LOO accuracy \d\.\d\d$/m);
    expect(out).toContain('confused: none');
  }, SLOW_TEST_MS);

  it('uses examples/sounds under the working directory when no argument is given', async () => {
    const { root } = await projectWith({ low: 'low', high: 'high' });
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_OK);
    expect(existsSync(join(root, 'examples', 'sounds.json'))).toBe(true);
  }, SLOW_TEST_MS);

  it('holds feature vectors only: model keys and per example id, label, v', async () => {
    const { root } = await projectWith({ low: 'low', high: 'high' });
    await rebuild(root, [], io());
    const model = JSON.parse(await readFile(join(root, 'examples', 'sounds.json'), 'utf8'));
    expect(Object.keys(model).every((k) => ['version', 'k', 'sampleRate', 'mean', 'std', 'examples', 'thresholds', 'pitch'].includes(k))).toBe(true);
    expect(JSON.stringify(model)).not.toMatch(/samples/);
    for (const e of model.examples) {
      expect(Object.keys(e).sort()).toEqual(['id', 'label', 'v']);
      expect(e.v.length).toBe(32);
    }
  }, SLOW_TEST_MS);

  it('prints confused pairs and exits 0 for two nearly identical classes', async () => {
    const { root } = await projectWith({ low: 'low', low2: 'low' });
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_OK);
    expect(i.text()).toMatch(/^confused: (low|low2) -> (low|low2) \d\.\d\d$/m);
    expect(existsSync(join(root, 'examples', 'sounds.json'))).toBe(true);
  }, SLOW_TEST_MS);

  it('prints a warning line and exits 0 for a sound in the first second', async () => {
    const { root, sounds } = await projectWith({ low: 'low', high: 'high' });
    await putClass(sounds, 'low', 'low', 1, 77, EARLY_HIT_MS, 'early.wav');
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_OK);
    expect(i.text()).toMatch(/^warning \[sound-in-calibration\] low\/early\.wav: /m);
  }, SLOW_TEST_MS);

  it('gives a note, exit 0 and no file for a missing folder and for a folder without subfolders', async () => {
    const root = await tempDir('tokk-rebuild-');
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_OK);
    expect(i.text()).toMatch(NOTE_PATTERN);
    const empty = join(root, 'examples', 'sounds');
    await mkdirAsync(empty, { recursive: true });
    await writeFileAsync(join(empty, 'loose.wav'), 'x');
    const j = io();
    expect(await rebuild(root, [], j)).toBe(EXIT_OK);
    expect(j.text()).toMatch(NOTE_PATTERN);
    expect(existsSync(join(root, 'examples', 'sounds.json'))).toBe(false);
    expect(i.errText() + j.errText()).toBe('');
  });

  it('reports counts, exits 0 and leaves an existing sounds.json unchanged for four examples of a label', async () => {
    const { root, sounds } = await projectWith({ low: 'low' }, REBUILD_FEW);
    await putClass(sounds, 'high', 'high', REBUILD_PER_CLASS, 5);
    const target = join(root, 'examples', 'sounds.json');
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_OK);
    expect(i.text()).toMatch(/low 4 \(too few\)/);
    expect(i.text()).toMatch(/more examples/);
    expect(existsSync(target)).toBe(false);
    await writeFileAsync(target, '{"version":1,"examples":[]}');
    expect(await rebuild(root, [], io())).toBe(EXIT_OK);
    expect(await readFile(target, 'utf8')).toBe('{"version":1,"examples":[]}');
  }, SLOW_TEST_MS);

  it('exits 1 with Error on the error stream and writes nothing for a 24-bit WAV', async () => {
    const { root, sounds } = await projectWith({ low: 'low', high: 'high' });
    await writeFileAsync(join(sounds, 'low', 'deep.wav'), wav24Bytes(REBUILD_SR_HZ, REBUILD_SR_HZ));
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_REGRESSION);
    expect(i.errText()).toMatch(/^Error: .*deep\.wav/);
    expect(existsSync(join(root, 'examples', 'sounds.json'))).toBe(false);
  }, SLOW_TEST_MS);

  it('refuses a target that is not a sounds model, or is a folder, and leaves it unchanged', async () => {
    const { root } = await projectWith({ low: 'low', high: 'high' });
    const target = join(root, 'examples', 'sounds.json');
    await writeFileAsync(target, '{"hello":"world"}');
    const i = io();
    expect(await rebuild(root, [], i)).toBe(EXIT_REGRESSION);
    expect(i.errText()).toMatch(/^Error: /);
    expect(await readFile(target, 'utf8')).toBe('{"hello":"world"}');
    await rm(target);
    await mkdirAsync(target);
    const j = io();
    expect(await rebuild(root, [], j)).toBe(EXIT_REGRESSION);
    expect(j.errText()).toMatch(/^Error: /);
  }, SLOW_TEST_MS);
});

// corpus-score: temporary project roots with copies of the committed synthetic set.
async function corpusProject(opts: { synth?: boolean; real?: boolean } = {}): Promise<string> {
  const root = await tempDir('tokk-cproj-');
  if (opts.synth !== false) await cp(join(REPO_ROOT, SYNTH_REL), join(root, SYNTH_REL), { recursive: true });
  if (opts.real) {
    await mkdirAsync(join(root, 'examples'), { recursive: true });
    await cp(join(REPO_ROOT, SYNTH_REL, 'sounds.json'), join(root, 'examples', 'sounds.json'));
    await cp(join(REPO_ROOT, SYNTH_REL, 'quick'), join(root, 'fixtures', 'audio', 'quick'), { recursive: true });
  }
  return root;
}

function corpus(root: string, argv: string[], i: Io): Promise<number> {
  return runCorpusScore(argv, {
    root, cwd: root, out: (s) => i.out.push(s), err: (s) => i.err.push(s), getCommit: () => FIXED_COMMIT, now: () => FIXED_NOW,
  });
}

const firstLine = (i: Io): string => i.text().split('\n')[0];
const tmpLeftovers = async (): Promise<string[]> => (await readdir(tmpdir())).filter((n) => n.startsWith('tokk-corpus-'));

describe('corpus-score script', () => {
  it('chooses real mode when both real inputs exist, and writes docs/ of the project root', async () => {
    const root = await corpusProject({ real: true });
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_OK);
    expect(firstLine(i)).toBe('corpus-score: real set');
    const lines = (await readFile(join(root, 'docs', 'experiments.md'), 'utf8')).split('\n').filter((l) => l.startsWith('2026-'));
    expect(lines).toHaveLength(1);
  }, SLOW_TEST_MS);

  it('chooses synthetic mode when the real quick folder is empty or examples/sounds.json is missing', async () => {
    const root = await corpusProject({ real: true });
    await rm(join(root, 'examples', 'sounds.json'));
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_OK);
    expect(firstLine(i)).toBe('corpus-score: synthetic set');
    await cp(join(REPO_ROOT, SYNTH_REL, 'sounds.json'), join(root, 'examples', 'sounds.json'));
    await rm(join(root, 'fixtures', 'audio', 'quick'), { recursive: true });
    await mkdirAsync(join(root, 'fixtures', 'audio', 'quick'), { recursive: true });
    const j = io();
    expect(await corpus(root, [], j)).toBe(EXIT_OK);
    expect(firstLine(j)).toBe('corpus-score: synthetic set');
  }, SLOW_TEST_MS);

  it('leaves docs/ of the project untouched in synthetic mode', async () => {
    const root = await corpusProject();
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_OK);
    expect(firstLine(i)).toBe('corpus-score: synthetic set');
    expect(existsSync(join(root, 'docs'))).toBe(false);
  }, SLOW_TEST_MS);

  it('gives a note and exit 0 when nothing is usable, also for empty folders and unlabelled recordings', async () => {
    const root = await corpusProject({ synth: false });
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_OK);
    expect(firstLine(i)).toMatch(/^corpus-score: no scored set yet/);
    await mkdirAsync(join(root, 'fixtures', 'audio', 'quick'), { recursive: true });
    await mkdirAsync(join(root, SYNTH_REL, 'quick'), { recursive: true });
    await writeFileAsync(join(root, SYNTH_REL, 'sounds.json'), '{"version":1,"examples":[]}');
    await writeFileAsync(join(root, SYNTH_REL, 'quick', 'only.wav'), 'x');
    const j = io();
    expect(await corpus(root, [], j)).toBe(EXIT_OK);
    expect(firstLine(j)).toMatch(/^corpus-score: no scored set yet/);
    expect(existsSync(join(root, 'docs'))).toBe(false);
  });

  it('copies the baseline in (regression exits 1) and copies it back with --update-baseline', async () => {
    const root = await corpusProject();
    const baseline = join(root, SYNTH_REL, 'scores-quick.json');
    await rm(baseline, { force: true });
    expect(await corpus(root, ['--update-baseline'], io())).toBe(EXIT_OK);
    expect(existsSync(baseline)).toBe(true);
    const saved = JSON.parse(await readFile(baseline, 'utf8'));
    expect(saved.perLabel.length).toBe(4);
    expect(await corpus(root, [], io())).toBe(EXIT_OK);
    for (const l of saved.perLabel) l.tp += 3;
    await writeFileAsync(baseline, JSON.stringify(saved));
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_REGRESSION);
    expect(i.text()).toMatch(/REGRESSION/);
    expect(existsSync(join(root, 'docs'))).toBe(false);
  }, SLOW_TEST_MS);

  it('keeps exit 2 for an invalid sounds.json and removes its temporary folder', async () => {
    const root = await corpusProject();
    await writeFileAsync(join(root, SYNTH_REL, 'sounds.json'), '{"version":2}');
    const before = await tmpLeftovers();
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_USAGE);
    expect(i.errText()).toMatch(/^Error: /);
    expect(await tmpLeftovers()).toEqual(before);
  }, SLOW_TEST_MS);

  it('removes its temporary folder after a normal run', async () => {
    const root = await corpusProject();
    const before = await tmpLeftovers();
    expect(await corpus(root, [], io())).toBe(EXIT_OK);
    expect(await tmpLeftovers()).toEqual(before);
  }, SLOW_TEST_MS);

  it('scores the committed synthetic set within the budget', async () => {
    const root = await corpusProject();
    const start = performance.now();
    const i = io();
    expect(await corpus(root, [], i)).toBe(EXIT_OK);
    expect(performance.now() - start).toBeLessThan(CORPUS_SCORE_BUDGET_MS);
  }, SLOW_TEST_MS);
});

// Files of Task 11B.
const readText = (rel: string): Promise<string> => readFile(join(REPO_ROOT, rel), 'utf8');

interface HookFile { version: string; hooks: { name: string; trigger: string; matcher: string; timeout: number; enabled: boolean; action: { type: string; command: string } }[] }

describe('hook files', () => {
  it('corpus-score.json fires on core files only', async () => {
    const f = JSON.parse(await readText('.kiro/hooks/corpus-score.json')) as HookFile;
    expect(f.version).toBe('v1');
    expect(f.hooks).toHaveLength(1);
    const h = f.hooks[0];
    expect([h.name, h.trigger, h.enabled, h.action.type, h.action.command]).toEqual(['corpus-score', 'PostFileSave', true, 'command', 'npm run corpus-score']);
    expect(h.action.command).not.toMatch(/[\r\n]/);
    expect(h.timeout).toBeGreaterThanOrEqual(CORPUS_SCORE_BUDGET_MS / 1000);
    const re = new RegExp(h.matcher);
    for (const p of ['core/segment.ts', 'core\\classify\\knn.ts', 'C:\\work\\tokk\\core\\constants.ts']) expect(re.test(p), p).toBe(true);
    for (const p of ['node/score.ts', 'examples/sounds.json', 'test/core.test.ts', 'apps/core-demo/main.ts']) expect(re.test(p), p).toBe(false);
  });

  it('sounds-rebuild.json fires on wav files below examples/sounds', async () => {
    const f = JSON.parse(await readText('.kiro/hooks/sounds-rebuild.json')) as HookFile;
    expect(f.version).toBe('v1');
    const h = f.hooks.find((x) => x.name === 'sounds-rebuild')!;
    expect([h.trigger, h.enabled, h.action.type, h.action.command]).toEqual(['PostFileSave', true, 'command', 'npm run sounds:rebuild']);
    for (const x of f.hooks) {
      expect(x.action.command).not.toMatch(/[\r\n]/);
      expect(x.matcher).toBe(h.matcher);
      expect(x.action.command).toBe(h.action.command);
    }
    const re = new RegExp(h.matcher);
    for (const p of ['examples/sounds/clap/01.wav', 'examples\\sounds\\background\\a.wav', 'examples/sounds/a/b/c.wav']) expect(re.test(p), p).toBe(true);
    for (const p of ['node/score.ts', 'examples/sounds.json', 'examples/sounds/clap/notes.txt']) expect(re.test(p), p).toBe(false);
  });
});

describe('mcp registration', () => {
  it('registers mcp-ears with the exact entry and no cwd', async () => {
    const text = await readText('.kiro/settings/mcp.json');
    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        'mcp-ears': { command: 'npm', args: ['run', '--silent', 'mcp'], disabled: false, autoApprove: ['listen', 'score'] },
      },
    });
    expect(text).not.toMatch(/"cwd"/);
  });

  it('has the mcp script that the entry runs, and the three new scripts', async () => {
    const pkg = JSON.parse(await readText('package.json')).scripts;
    expect(pkg.mcp).toBe('tsx tools/mcp-ears/server.ts');
    expect(pkg['sounds:rebuild']).toBe('tsx scripts/sounds-rebuild.ts');
    expect(pkg['synth:fixtures']).toBe('tsx scripts/make-synth-fixtures.ts');
    expect(pkg['corpus-score']).toBe('tsx scripts/corpus-score.ts');
  });
});

describe('integrate.md', () => {
  it('has a front matter and the key phrases', async () => {
    const text = await readText('.kiro/steering/integrate.md');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text.indexOf('\n---', 4)).toBeGreaterThan(0);
    const phrases = [
      'sounds:rebuild', 'teach', 'sounds.json', 'listen(', 'modes', 'expectEvents', 'tokk/node',
      "'clap clap'", "'clap _ clap'", "'hum.rise'", 'e.speed', 'debug: true', "ears.teach('clap', { ui: true })",
      'pause', 'resume', 'stop', 'setMode', 'start', 'question', "expectEvents('clap-2.wav', ['clap', 'clap'], { sounds })",
      // Task 18 (requirement 9.5): 'plan 2' removed. It came from the stale "belongs to the browser layer of plan 2" text.
      'loadSounds', 'createEngine', 'runSamples',
      'calibration', 'sound-in-calibration', 'background', 'reserved', 'hum` folder', 'prefix', '350', '1000',
      'units', 'privacy',
    ];
    for (const p of phrases) expect(text, p).toContain(p);
  });
});

describe('tsconfig and experiments header', () => {
  it('includes scripts and tools and keeps the other entries', async () => {
    const cfg = JSON.parse(await readText('tsconfig.json'));
    expect(cfg.include).toEqual(['core', 'node', 'tools', 'scripts', 'test', 'vitest.config.ts']);
  });

  it('docs/experiments.md starts with the header that the score script writes, and a run appends one line', async () => {
    const s = await setup();
    await run(s, [s.quick, s.sounds]);
    const written = (await readFile(experiments(s), 'utf8')).split('\n');
    const header = `${written.slice(0, 4).join('\n')}\n`;
    expect(header).toMatch(/^# Experiments\n\ndate \| commit \| recall per label \| FP\/h\n--- \| --- \| --- \| ---\n$/);
    const real = await readText('docs/experiments.md');
    expect(real.startsWith(header)).toBe(true);

    await writeFileAsync(experiments(s), header);
    await run(s, [s.quick, s.sounds]);
    const after = await readFile(experiments(s), 'utf8');
    expect(after.startsWith(header)).toBe(true);
    expect(after.split('\n').filter((l) => l.startsWith('2026-'))).toHaveLength(1);
    expect(after.split('date | commit').length).toBe(2);
  });
});
