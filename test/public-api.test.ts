import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

  // Changed by Task 13 (requirement 5.6): exports point at the built files. The targets exist only after
  // `npm run build`, so test/build.test.ts checks that they exist.
  it('package.json exports "." and "./node" point at the built bundles', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.exports['.']).toEqual({
      types: './dist/types/web/index.d.ts',
      browser: './dist/tokk.js',
      import: './dist/tokk.js',
    });
    expect(Object.keys(pkg.exports['.'])).toEqual(['types', 'browser', 'import']);
    expect(pkg.exports['./node']).toEqual({
      types: './dist/types/node/index.d.ts',
      import: './dist/node.js',
    });
    expect(Object.keys(pkg.exports['./node'])).toEqual(['types', 'import']);
  });
});
