import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as core from '../core/index';
import * as node from '../node/index';

describe('public API (Req 14)', () => {
  it('core exports exactly the listed runtime names', () => {
    expect(Object.keys(core).sort()).toEqual(['createEngine', 'knnClassifier', 'readWav', 'runSamples', 'writeWav']);
  });

  it('node exports exactly the listed runtime names', () => {
    expect(Object.keys(node).sort()).toEqual([
      'ExpectEventsError', 'TooFewExamplesError', 'expectEvents', 'readWavFile', 'teachFromDir', 'writeWavFile',
    ]);
  });

  it('package.json exports "." and "./node" with existing targets', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.exports['.']).toEqual({ types: './core/index.ts', default: './core/index.ts' });
    expect(pkg.exports['./node']).toEqual({ types: './node/index.ts', default: './node/index.ts' });
    for (const entry of Object.values<{ types: string; default: string }>(pkg.exports)) {
      expect(existsSync(entry.types)).toBe(true);
      expect(existsSync(entry.default)).toBe(true);
    }
  });
});
