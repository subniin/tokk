// Paths of the generated fixture files. Shared by playwright.config.ts, the global setup and the specs.
// The folder is git-ignored and sits below the served root, so a page can fetch the files by URL.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATED_DIR = resolve(REPO_ROOT, 'test', 'web', 'generated');
export const FIXTURE_WAV_PATH = resolve(GENERATED_DIR, 'listen-test.wav');
export const FIXTURE_MODEL_PATH = resolve(GENERATED_DIR, 'sounds.json');
export const FIXTURE_LABELS_PATH = resolve(GENERATED_DIR, 'labels.json');

// URLs below the served repository root.
export const FIXTURE_WAV_URL = '/test/web/generated/listen-test.wav';
export const FIXTURE_MODEL_URL = '/test/web/generated/sounds.json';
export const PAGE_URL = '/test/web/listen.html';
