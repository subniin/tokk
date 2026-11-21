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
export const FIXTURE_HUM_STEADY_WAV_PATH = resolve(GENERATED_DIR, 'hum-steady.wav');      // Task 20
export const FIXTURE_TWO_HUM_WAV_PATH = resolve(GENERATED_DIR, 'hum-two.wav');
export const FIXTURE_HUM_MIC_WAV_PATH = resolve(GENERATED_DIR, 'hum-mic.wav');
export const FIXTURE_PITCH_ONLY_MODEL_PATH = resolve(GENERATED_DIR, 'sounds-pitch-only.json');
export const FIXTURE_HANDS_FREE_WAV_PATH = resolve(GENERATED_DIR, 'hands-free.wav');      // Task 22
export const FIXTURE_HANDS_FREE_TIMES_PATH = resolve(GENERATED_DIR, 'hands-free-times.json');
export const FIXTURE_KNOCK_ONCE_WAV_PATH = resolve(GENERATED_DIR, 'knock-once.wav');      // Task 23
export const FIXTURE_KNOCK_ONCE_TIMES_PATH = resolve(GENERATED_DIR, 'knock-once-times.json');
export const FIXTURE_SLIDES_WAV_PATH = resolve(GENERATED_DIR, 'slides.wav');      // Task 26
export const FIXTURE_SLIDES_TIMES_PATH = resolve(GENERATED_DIR, 'slides-times.json');
export const TEACH_PAGE_SEED_DIR = resolve(GENERATED_DIR, 'teach-page-seed');   // holds sounds/<label>/<label>-01.wav of two labels

// URLs below the served repository root.
export const FIXTURE_WAV_URL = '/test/web/generated/listen-test.wav';
export const FIXTURE_MODEL_URL = '/test/web/generated/sounds.json';
export const FIXTURE_MISMATCH_MODEL_URL = '/test/web/generated/sounds-44100.json';
export const FIXTURE_PHASE_WAV_URL = '/test/web/generated/phase-test.wav';
export const FIXTURE_TEACH_PITCH_MODEL_URL = '/test/web/generated/sounds-low-mid-pitch.json';
export const FIXTURE_TAP_WAV_URL = '/test/web/generated/tap-test.wav';
export const FIXTURE_TEACH_BASE_MODEL_URL = '/test/web/generated/sounds-low-mid.json';
export const FIXTURE_HUM_STEADY_WAV_URL = '/test/web/generated/hum-steady.wav';   // Task 20
export const FIXTURE_TWO_HUM_WAV_URL = '/test/web/generated/hum-two.wav';
export const FIXTURE_PITCH_ONLY_MODEL_URL = '/test/web/generated/sounds-pitch-only.json';
export const FIXTURE_TEACH_WAV_URL = '/test/web/generated/teach-10.wav';
export const HANDS_FREE_PAGE_URL = '/apps/hands-free/index.html';   // Task 22
export const KNOCK_ONCE_PAGE_URL = '/apps/knock-once/index.html';   // Task 23
export const SLIDES_PAGE_URL = '/cases/slides/index.html';   // Task 26
export const FIRST_RUN_PAGE_URL = '/test/web/first-run.html';
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

// Task 33: Shoo!
export const FIXTURE_SHOO_FIRST_WAV_PATH = resolve(GENERATED_DIR, 'shoo-first.wav');
export const FIXTURE_SHOO_PLAY_WAV_PATH = resolve(GENERATED_DIR, 'shoo-play.wav');
export const FIXTURE_SHOO_TIMES_PATH = resolve(GENERATED_DIR, 'shoo-times.json');
export const FIXTURE_SHOO_STORED_PATH = resolve(GENERATED_DIR, 'shoo-stored.json');   // the localStorage text of a returning player
export const SHOO_PAGE_URL = '/apps/shoo/index.html';
