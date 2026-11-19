// npm run corpus-score [-- --update-baseline]
// Scores the best available labelled set and returns the exit code of the score run (0 ok, 1 regression, 2 invalid input).
// REAL set: examples/sounds.json with fixtures/audio/quick. SYNTHETIC set: fixtures/audio/synth. Otherwise a note and exit 0.
// The synthetic run uses a temporary score root, so docs/experiments.md and docs/scores-quick.json stay untouched.
// Local files only. No audio is sent.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommit, runScore, type ScoreEnv } from './score';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const UPDATE_FLAG = '--update-baseline';
const REAL_SOUNDS = 'examples/sounds.json';
const REAL_QUICK = 'fixtures/audio/quick';
const SYNTH_DIR = 'fixtures/audio/synth';
const BASELINE_NAME = 'scores-quick.json';
const NO_SET_NOTE = 'corpus-score: no scored set yet (add fixtures/audio/quick with examples/sounds.json, or run npm run synth:fixtures)';

export type CorpusEnv = ScoreEnv;

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// True when the folder holds at least one <name>.wav with a <name>.json next to it.
async function hasLabelledWav(dir: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return false;
  }
  const set = new Set(names);
  return names.some((n) => n.toLowerCase().endsWith('.wav') && set.has(`${n.slice(0, -'.wav'.length)}.json`));
}

async function usable(sounds: string, quick: string): Promise<boolean> {
  return (await isFile(sounds)) && (await hasLabelledWav(quick));
}

export async function runCorpusScore(argv: string[], env: CorpusEnv): Promise<number> {
  const line = (s: string): void => env.out(`${s}\n`);
  const root = env.root;
  const realSounds = join(root, REAL_SOUNDS);
  const realQuick = join(root, REAL_QUICK);
  const synthSounds = join(root, SYNTH_DIR, 'sounds.json');
  const synthQuick = join(root, SYNTH_DIR, 'quick');
  const synthBaseline = join(root, SYNTH_DIR, BASELINE_NAME);

  if (await usable(realSounds, realQuick)) {
    line('corpus-score: real set');
    return runScore([realQuick, realSounds, ...argv], { ...env, cwd: root });
  }
  if (!(await usable(synthSounds, synthQuick))) {
    line(NO_SET_NOTE);
    return EXIT_OK;
  }

  line('corpus-score: synthetic set');
  const tmp = await mkdtemp(join(tmpdir(), 'tokk-corpus-'));
  try {
    const tmpBaseline = join(tmp, 'docs', BASELINE_NAME);
    await mkdir(join(tmp, 'docs'), { recursive: true });
    if (existsSync(synthBaseline)) await copyFile(synthBaseline, tmpBaseline);
    // The baseline lives in the committed folder after the run, so name that path instead of the temporary one.
    const out = (s: string): void => env.out(s.split(tmpBaseline).join(synthBaseline));
    const code = await runScore([synthQuick, synthSounds, ...argv], { ...env, out, root: tmp, cwd: root });
    if (code === EXIT_OK && argv.includes(UPDATE_FLAG) && existsSync(tmpBaseline)) {
      await copyFile(tmpBaseline, synthBaseline);
    }
    return code;
  } catch (e) {
    env.err(`Error: ${(e as Error).message}\n`);
    return EXIT_USAGE;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  runCorpusScore(process.argv.slice(2), {
    root: resolve(dirname(here), '..'),
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    getCommit,
  }).then((code) => process.exit(code));
}
