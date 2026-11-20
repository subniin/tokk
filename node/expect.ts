// expectEvents: checks a recording against a list of expected sound names and, optionally, patterns (Task 8, Task 30).

import { runSamples } from '../core/engine';
import type { SoundModel } from '../core/types';
import { readWavFile } from './files';

const TIME_DECIMALS = 3;

export class ExpectEventsError extends Error {
  readonly expected: string[];
  readonly actual: string[];
  readonly expectedMatches: string[] | undefined;
  readonly actualMatches: string[] | undefined;

  constructor(
    expected: string[],
    actual: string[],
    unknowns: number[],
    expectedMatches?: string[],
    actualMatches?: string[],
  ) {
    const parts: string[] = [];
    if (!sameList(actual, expected) || expectedMatches === undefined) {
      parts.push(`Expected events [${expected.join(', ')}] but got [${actual.join(', ')}].`);
    }
    if (expectedMatches !== undefined && actualMatches !== undefined && !sameList(actualMatches, expectedMatches)) {
      parts.push(`Expected matches [${expectedMatches.join(', ')}] but got [${actualMatches.join(', ')}].`);
    }
    if (unknowns.length > 0) {
      parts.push(`${unknowns.length} unknown at ${unknowns.map((t) => `${t.toFixed(TIME_DECIMALS)} s`).join(', ')}.`);
    }
    super(parts.join(' '));
    this.name = 'ExpectEventsError';
    this.expected = [...expected];
    this.actual = actual;
    this.expectedMatches = expectedMatches === undefined ? undefined : [...expectedMatches];
    this.actualMatches = actualMatches;
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export interface ExpectEventsOptions {
  sounds: SoundModel;
  patterns?: string[];   // the pattern set the app listens for (one mode)
  matches?: string[];    // the patterns expected to fire, in order
}

export async function expectEvents(wavPath: string, expected: string[], o: ExpectEventsOptions): Promise<void> {
  const { samples, sampleRate } = await readWavFile(wavPath);
  const patterns = o.patterns ?? (o.matches === undefined ? [] : [...new Set(o.matches)]);
  const { events, matches, unknowns } = runSamples(samples, sampleRate, o.sounds, patterns);
  const actual = events.flatMap((e) => (e.kind === 'sound' ? [e.label] : []));
  const actualMatches = o.matches === undefined ? undefined : matches.map((m) => m.pattern);
  const soundsOk = sameList(actual, expected);
  const matchesOk = o.matches === undefined || sameList(actualMatches ?? [], o.matches);
  if (!soundsOk || !matchesOk) throw new ExpectEventsError(expected, actual, unknowns, o.matches, actualMatches);
}
