// npm run score -- <fixturesDir> <sounds.json> [--update-baseline]
// Scores labelled recordings, prints the result, appends one line to docs/experiments.md and compares with
// docs/scores-<fixtures folder name>.json. Exit 0: ok, 1: regression, 2: wrong use or invalid input.
// Local files only. No audio is stored or sent: the baseline and the experiments line hold counts and rates.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, scoreDir, type ScoreReport } from '../node/score';
import type { SoundModel } from '../core/types';

const EXIT_OK = 0;
const EXIT_REGRESSION = 1;
const EXIT_USAGE = 2;
const UPDATE_FLAG = '--update-baseline';
const USAGE = `Usage: npm run score -- <fixturesDir> <sounds.json> [${UPDATE_FLAG}]`;
const UNCOMMITTED = 'uncommitted';
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const RECALL_DECIMALS = 3;
const FP_DECIMALS = 1;
const DATE_LENGTH = 10;
const EXPERIMENTS_TITLE = '# Experiments';
const EXPERIMENTS_HEADER = 'date | commit | recall per label | FP/h\n--- | --- | --- | ---';

export interface ScoreEnv {
  root: string;                       // project root: docs/ lives here
  cwd?: string;                       // base for relative command-line paths
  out: (text: string) => void;
  err: (text: string) => void;
  getCommit: (folder: string) => string;
  now?: () => Date;
}

// Short commit hash of a clean working tree, otherwise 'uncommitted'. Fixed arguments, no shell.
export function getCommit(folder: string): string {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const hash = git(['rev-parse', '--short', 'HEAD']).trim();
    if (hash === '' || git(['status', '--porcelain']).trim() !== '') return UNCOMMITTED;
    return hash;
  } catch {
    return UNCOMMITTED;
  }
}

class InputError extends Error {}

function isModel(x: unknown): x is SoundModel {
  const m = x as { version?: unknown; examples?: unknown } | null;
  return typeof m === 'object' && m !== null && m.version === 1 && Array.isArray(m.examples);
}

function isReport(x: unknown): x is ScoreReport {
  const r = x as Partial<ScoreReport> | null;
  return typeof r === 'object' && r !== null && Array.isArray(r.perLabel)
    && typeof r.falsePositivesPerHour === 'number' && typeof r.totalSeconds === 'number'
    && r.perLabel.every((l) => typeof l === 'object' && l !== null && typeof l.label === 'string'
      && ['tp', 'fp', 'fn', 'precision', 'recall'].every((k) => typeof (l as unknown as Record<string, unknown>)[k] === 'number'));
}

async function readJson(path: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new InputError(`${what} cannot be read: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new InputError(`${what} is not valid JSON: ${(e as Error).message}`);
  }
}

const pad = (s: string | number, n: number): string => String(s).padEnd(n);

function formatReport(r: ScoreReport): string[] {
  const width = Math.max(5, ...r.perLabel.map((l) => l.label.length)) + 2;
  const lines = [[pad('label', width), 'truths', 'tp', 'fp', 'fn', 'calib', 'precision', 'recall'].join(' ')];
  for (const l of r.perLabel) {
    lines.push([
      pad(l.label, width), pad(l.truths, 6), pad(l.tp, 2), pad(l.fp, 2), pad(l.fn, 2), pad(l.inCalibration, 5),
      pad(l.precision.toFixed(RECALL_DECIMALS), 9), l.recall.toFixed(RECALL_DECIMALS),
    ].join(' '));
  }
  lines.push('', 'confusion (truth -> predicted):');
  for (const [truth, row] of Object.entries(r.confusion)) {
    lines.push(`  ${truth}: ${Object.entries(row).map(([p, n]) => `${p} ${n}`).join(', ')}`);
  }
  lines.push(
    '',
    `false positives per hour: ${r.falsePositivesPerHour.toFixed(FP_DECIMALS)}`,
    `total seconds: ${r.totalSeconds.toFixed(FP_DECIMALS)}`,
    `in calibration: ${r.inCalibration}`,
  );
  return lines;
}

async function appendExperiment(file: string, line: string): Promise<void> {
  if (!existsSync(file)) {
    await writeFile(file, `${EXPERIMENTS_TITLE}\n\n${EXPERIMENTS_HEADER}\n${line}\n`);
    return;
  }
  const old = await readFile(file, 'utf8');
  await appendFile(file, `${old === '' || old.endsWith('\n') ? '' : '\n'}${line}\n`);
}

export async function runScore(argv: string[], env: ScoreEnv): Promise<number> {
  const out = (s: string): void => env.out(`${s}\n`);
  const err = (s: string): void => env.err(`${s}\n`);
  try {
    const positional = argv.filter((a) => !a.startsWith('-'));
    const flags = argv.filter((a) => a.startsWith('-'));
    if (positional.length !== 2 || flags.some((f) => f !== UPDATE_FLAG)) {
      err(flags.some((f) => f !== UPDATE_FLAG) ? `Unknown option: ${flags.find((f) => f !== UPDATE_FLAG)}` : 'Expected two paths.');
      err(USAGE);
      return EXIT_USAGE;
    }
    const update = flags.includes(UPDATE_FLAG);
    const base = env.cwd ?? process.cwd();
    const fixtures = resolve(base, positional[0]);
    const folderName = basename(fixtures);
    if (!SAFE_NAME.test(folderName) || /^\.+$/.test(folderName)) {
      throw new InputError(`Fixtures folder name "${folderName}" must use only letters, digits, "-", "_" and ".", so the baseline name stays inside docs/.`);
    }
    const docs = join(env.root, 'docs');
    const baselinePath = join(docs, `scores-${folderName}.json`);

    const model = await readJson(resolve(base, positional[1]), positional[1]);
    if (!isModel(model)) throw new InputError(`${positional[1]} is not a sound model (needs version 1 and an examples array).`);

    const report = await scoreDir(fixtures, model);
    if (report.totalSeconds === 0 && report.perLabel.length === 0) {
      throw new InputError(`No labelled recordings found in ${positional[0]}.`);
    }

    let baseline: ScoreReport | undefined;
    if (!update && existsSync(baselinePath)) {
      const b = await readJson(baselinePath, baselinePath);
      if (!isReport(b)) throw new InputError(`${baselinePath} is not a score report.`);
      baseline = b;
    }

    for (const line of formatReport(report)) out(line);
    for (const w of report.warnings) err(`warning [${w.code}] ${w.file}: ${w.message}`);

    const date = (env.now ?? (() => new Date()))().toISOString().slice(0, DATE_LENGTH);
    const recalls = report.perLabel.map((l) => `${l.label} ${l.recall.toFixed(RECALL_DECIMALS)}`).join(', ');
    await mkdir(docs, { recursive: true });
    await appendExperiment(join(docs, 'experiments.md'), `${date} | ${env.getCommit(env.root)} | ${recalls} | ${report.falsePositivesPerHour.toFixed(FP_DECIMALS)}`);

    if (update) {
      await writeFile(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
      out(`baseline written: ${baselinePath}`);
      return EXIT_OK;
    }
    if (!baseline) {
      out(`no baseline (${baselinePath}); run with ${UPDATE_FLAG} to create one.`);
      return EXIT_OK;
    }
    const cmp = compareToBaseline(report, baseline);
    out('', );
    for (const c of cmp) {
      const sign = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(RECALL_DECIMALS)}`;
      out(`${c.label}: recall ${sign(c.recallDelta)}, precision ${sign(c.precisionDelta)}, tp ${c.tpDelta >= 0 ? '+' : ''}${c.tpDelta}${c.regression ? '  REGRESSION' : ''}`);
    }
    const bad = cmp.filter((c) => c.regression).map((c) => c.label);
    if (bad.length > 0) {
      out(`REGRESSION in: ${bad.join(', ')}`);
      return EXIT_REGRESSION;
    }
    out('no regression.');
    return EXIT_OK;
  } catch (e) {
    err(`Error: ${(e as Error).message}`);
    return EXIT_USAGE;
  }
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  const root = resolve(dirname(here), '..');
  runScore(process.argv.slice(2), {
    root,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    getCommit,
  }).then((code) => process.exit(code));
}
