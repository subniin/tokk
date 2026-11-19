// npm run sounds:rebuild [soundsDir]
// Teaches from <soundsDir>/<label>/*.wav (default examples/sounds) and writes <soundsDir>/../sounds.json.
// Exit 0 for normal states (too few examples, nothing to teach yet), 1 for errors.
// Local files only. The model holds feature vectors only. No audio is stored or sent.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TooFewExamplesError } from '../core/classify/knn';
import { teachFromDir, type TeachReport } from '../node/teach';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const DEFAULT_SOUNDS_DIR = 'examples/sounds';
const ACCURACY_DECIMALS = 2;
const RATE_DECIMALS = 2;

export interface RebuildEnv {
  cwd: string;                        // base for a relative sounds folder
  out: (text: string) => void;
  err: (text: string) => void;
}

function isModel(x: unknown): boolean {
  const m = x as { version?: unknown; examples?: unknown } | null;
  return typeof m === 'object' && m !== null && m.version === 1 && Array.isArray(m.examples);
}

async function hasLabelFolders(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir, { withFileTypes: true })).some((e) => e.isDirectory());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return false;
    throw e;
  }
}

// Throws when the target exists and is not a sounds model.
async function checkTarget(target: string, shown: string): Promise<void> {
  let info;
  try {
    info = await stat(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  if (!info.isFile()) throw new Error(`${shown} exists and is not a file, so it was not overwritten.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(target, 'utf8'));
  } catch {
    throw new Error(`${shown} exists and is not a sounds model, so it was not overwritten.`);
  }
  if (!isModel(parsed)) throw new Error(`${shown} exists and is not a sounds model, so it was not overwritten.`);
}

// Same line shapes as the text of the MCP teach tool.
function formatSummary(labels: number, examples: number, shown: string, report: TeachReport): string[] {
  const lines = [`taught ${labels} sounds, ${examples} examples -> ${shown}`];
  for (const l of report.labels) {
    lines.push(`${l.label}: ${l.examples} examples, LOO accuracy ${l.looAccuracy.toFixed(ACCURACY_DECIMALS)}`);
  }
  if (report.confusedPairs.length === 0) lines.push('confused: none');
  for (const p of report.confusedPairs) lines.push(`confused: ${p.a} -> ${p.b} ${p.rate.toFixed(RATE_DECIMALS)}`);
  for (const w of report.warnings) lines.push(`warning [${w.code}] ${w.file}: ${w.message}`);
  return lines;
}

export async function runSoundsRebuild(argv: string[], env: RebuildEnv): Promise<number> {
  const out = (s: string): void => env.out(`${s}\n`);
  const err = (s: string): void => env.err(`${s}\n`);
  try {
    const dir = resolve(env.cwd, argv[0] ?? DEFAULT_SOUNDS_DIR);
    const shownDir = relative(env.cwd, dir).split('\\').join('/') || '.';
    if (!(await hasLabelFolders(dir))) {
      out(`no label folders in ${shownDir} yet, nothing to rebuild`);
      return EXIT_OK;
    }
    const target = join(dir, '..', 'sounds.json');
    const shownTarget = relative(env.cwd, target).split('\\').join('/');
    await checkTarget(target, shownTarget);

    let taught;
    try {
      taught = await teachFromDir(dir);
    } catch (e) {
      if (e instanceof TooFewExamplesError) {
        out(`${e.message}. Nothing written, add more examples.`);
        return EXIT_OK;
      }
      throw e;
    }
    await writeFile(target, `${JSON.stringify(taught.model, null, 2)}\n`);
    for (const line of formatSummary(taught.report.labels.length, taught.model.examples.length, shownTarget, taught.report)) out(line);
    return EXIT_OK;
  } catch (e) {
    err(`Error: ${(e as Error).message}`);
    return EXIT_ERROR;
  }
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  runSoundsRebuild(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  }).then((code) => process.exit(code));
}
