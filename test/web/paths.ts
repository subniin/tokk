// Paths of the generated fixture files. Shared by playwright.config.ts, the global setup and the specs.
// The folder is git-ignored and sits below the served root, so a page can fetch the files by URL.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATED_DIR = resolve(REPO_ROOT, 'test', 'web', 'generated');
export const FIXTURE_WAV_PATH = resolve(GENERATED_DIR, 'listen-test.wav');
export const FIXTURE_MODEL_PATH = resolve(GENERATED_DIR, 'sounds.json');
export const FIXTURE_MISMATCH_MODEL_PATH = resolve(GENERATED_DIR, 'sounds-44100.json');
export const FIXTURE_LABELS_PATH = resolve(GENERATED_DIR, 'labels.json');
export const FIXTURE_TEACH_WAV_PATH = resolve(GENERATED_DIR, 'teach-10.wav');
export const FIXTURE_TEACH_FEW_WAV_PATH = resolve(GENERATED_DIR, 'teach-4.wav');
export const FIXTURE_TAP_WAV_PATH = resolve(GENERATED_DIR, 'tap-test.wav');
export const FIXTURE_TEACH_BASE_MODEL_PATH = resolve(GENERATED_DIR, 'sounds-low-mid.json');
export const FIXTURE_TEACH_PITCH_MODEL_PATH = resolve(GENERATED_DIR, 'sounds-low-mid-pitch.json');
export const FIXTURE_PHASE_WAV_PATH = resolve(GENERATED_DIR, 'phase-test.wav');
export const FIXTURE_TEACH_INFO_PATH = resolve(GENERATED_DIR, 'teach-info.json');
export const TEACH_PAGE_SEED_DIR = resolve(GENERATED_DIR, 'teach-page-seed');   // holds sounds/<label>/<label>-01.wav of two labels

// URLs below the served repository root.
export const FIXTURE_WAV_URL = '/test/web/generated/listen-test.wav';
export const FIXTURE_MODEL_URL = '/test/web/generated/sounds.json';
export const FIXTURE_MISMATCH_MODEL_URL = '/test/web/generated/sounds-44100.json';
export const FIXTURE_PHASE_WAV_URL = '/test/web/generated/phase-test.wav';
export const FIXTURE_TEACH_PITCH_MODEL_URL = '/test/web/generated/sounds-low-mid-pitch.json';
export const FIXTURE_TAP_WAV_URL = '/test/web/generated/tap-test.wav';
export const FIXTURE_TEACH_BASE_MODEL_URL = '/test/web/generated/sounds-low-mid.json';
export const PAGE_URL = '/test/web/listen.html';
export const TEACH_PAGE_URL = '/test/web/teach.html';
export const DEV_TEACH_PAGE_URL = '/teach.html';   // the developer page of Task 17, at the repository root

// Chrome arguments for the fake microphone: the WAV plays once from the moment the stream is opened.
export function fakeMicArgs(wavPath: string): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavPath}%noloop`,
    '--autoplay-policy=user-gesture-required',
  ];
}
