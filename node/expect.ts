// expectEvents: checks a recording against a list of expected sound names (Task 8).

import { runSamples } from '../core/engine';
import type { SoundModel } from '../core/types';
import { readWavFile } from './files';

const TIME_DECIMALS = 3;

export class ExpectEventsError extends Error {
  readonly expected: string[];
  readonly actual: string[];

  constructor(expected: string[], actual: string[], unknowns: number[]) {
    let message = `Expected events [${expected.join(', ')}] but got [${actual.join(', ')}].`;
    if (unknowns.length > 0) {
      message += ` ${unknowns.length} unknown at ${unknowns.map((t) => `${t.toFixed(TIME_DECIMALS)} s`).join(', ')}.`;
    }
    super(message);
    this.name = 'ExpectEventsError';
    this.expected = [...expected];
    this.actual = actual;
  }
}

export async function expectEvents(wavPath: string, expected: string[], o: { sounds: SoundModel }): Promise<void> {
  const { samples, sampleRate } = await readWavFile(wavPath);
  const { events, unknowns } = runSamples(samples, sampleRate, o.sounds);
  const actual = events.flatMap((e) => (e.kind === 'sound' ? [e.label] : []));
  const same = actual.length === expected.length && actual.every((label, i) => label === expected[i]);
  if (!same) throw new ExpectEventsError(expected, actual, unknowns);
}
