// Task 30: expectEvents checks patterns (`patterns`, `matches`) on the synthetic recordings of cases/slides.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SoundModel } from '../core/types';
import { ExpectEventsError, expectEvents } from '../node';
import { checkModel } from '../web/model';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const SLIDES_DIR = join(REPO_ROOT, 'cases', 'slides');
const TWO_PATH = join(SLIDES_DIR, 'recordings', 'clap-x2.wav');
const THREE_PATH = join(SLIDES_DIR, 'recordings', 'clap-x3.wav');
const TWO = 'clap clap';
const THREE = 'clap clap clap';
const PATTERNS = [TWO, THREE];

function readModel(): SoundModel {
  const checked = checkModel(JSON.parse(readFileSync(join(SLIDES_DIR, 'sounds.json'), 'utf8')));
  if (!checked.ok) throw new Error(checked.problem);
  return checked.model;
}

async function failure(p: Promise<void>): Promise<ExpectEventsError> {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(ExpectEventsError);
  return err as ExpectEventsError;
}

describe('expectEvents patterns (Task 30)', () => {
  it('X1: two claps fire "clap clap", three claps fire only "clap clap clap"', async () => {
    const sounds = readModel();
    await expectEvents(TWO_PATH, ['clap', 'clap'], { sounds, patterns: PATTERNS, matches: [TWO] });
    await expectEvents(THREE_PATH, ['clap', 'clap', 'clap'], { sounds, patterns: PATTERNS, matches: [THREE] });
    const err = await failure(expectEvents(THREE_PATH, ['clap', 'clap', 'clap'], { sounds, patterns: PATTERNS, matches: [TWO] }));
    expect(err.actualMatches).toEqual([THREE]);
  });

  it('X2: a wrong matches fails with both match lists in the message', async () => {
    const err = await failure(expectEvents(TWO_PATH, ['clap', 'clap'], { sounds: readModel(), patterns: PATTERNS, matches: [THREE] }));
    expect(err.expectedMatches).toEqual([THREE]);
    expect(err.actualMatches).toEqual([TWO]);
    expect(err.message).toContain(`[${THREE}]`);
    expect(err.message).toContain(`[${TWO}]`);
  });

  it('X3: matches without patterns uses the deduplicated matches as the pattern set', async () => {
    const sounds = readModel();
    await expectEvents(TWO_PATH, ['clap', 'clap'], { sounds, matches: [TWO] });
    await expectEvents(THREE_PATH, ['clap', 'clap', 'clap'], { sounds, matches: [THREE, THREE] }).then(
      () => { throw new Error('expected a failure: one recording gives one match'); },
      (e: unknown) => expect((e as ExpectEventsError).actualMatches).toEqual([THREE]),
    );
    // An empty matches list means an empty pattern set: nothing may fire.
    await expectEvents(TWO_PATH, ['clap', 'clap'], { sounds, matches: [] });
  });

  it('X4: an invalid pattern rejects with the grammar RangeError before any check', async () => {
    const sounds = readModel();
    await expect(expectEvents(TWO_PATH, ['no', 'match'], { sounds, patterns: ['_ clap'] })).rejects.toBeInstanceOf(RangeError);
    await expect(expectEvents(TWO_PATH, [], { sounds, matches: ['clap _'] })).rejects.toThrow(/Invalid pattern/);
  });

  it('X5: old calls are unchanged', async () => {
    const sounds = readModel();
    await expect(expectEvents(TWO_PATH, ['clap', 'clap'], { sounds })).resolves.toBeUndefined();
    const err = await failure(expectEvents(TWO_PATH, ['clap'], { sounds }));
    expect(err.expectedMatches).toBeUndefined();
    expect(err.actualMatches).toBeUndefined();
    expect(err.message).not.toContain('matches');
  });

  it('X6: a sound failure with matches names both pairs of lists', async () => {
    const err = await failure(expectEvents(TWO_PATH, ['clap'], { sounds: readModel(), patterns: PATTERNS, matches: [THREE] }));
    expect(err.message).toContain('Expected events [clap] but got [clap, clap]');
    expect(err.message).toContain(`Expected matches [${THREE}] but got [${TWO}]`);
  });
});


