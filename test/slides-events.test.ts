// One expectEvents test per pattern of the slide deck, against the recordings in cases/slides/recordings.
// Task 30 (a later improvement; the measured stage 2 of task 26 stays as committed): the tests also pass patterns and matches.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { SoundModel } from '../core/types';
import { expectEvents } from '../node';
import { checkModel } from '../web/model';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const SLIDES_DIR = join(REPO_ROOT, 'cases', 'slides');
const MODEL_PATH = join(SLIDES_DIR, 'sounds.json');
const TWO_PATH = join(SLIDES_DIR, 'recordings', 'clap-x2.wav');
const THREE_PATH = join(SLIDES_DIR, 'recordings', 'clap-x3.wav');
const PATTERN_NEXT = 'clap clap';
const PATTERN_PREV = 'clap clap clap';
const PATTERNS = [PATTERN_NEXT, PATTERN_PREV];

function readModel(): SoundModel {
  const checked = checkModel(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
  if (!checked.ok) throw new Error(`cases/slides/sounds.json is not a valid model: ${checked.problem}`);
  return checked.model;
}

describe('slides events', () => {
  it('"clap clap": clap-x2.wav gives two claps', async () => {
    await expectEvents(TWO_PATH, ['clap', 'clap'], { sounds: readModel(), patterns: PATTERNS, matches: [PATTERN_NEXT] });
  });

  it('"clap clap clap": clap-x3.wav gives three claps', async () => {
    await expectEvents(THREE_PATH, ['clap', 'clap', 'clap'], { sounds: readModel(), patterns: PATTERNS, matches: [PATTERN_PREV] });
  });
});
