import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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

// Task 20, U16 (a): web/index.ts adds no runtime name. It is read as text, because vitest cannot import it (it needs
// the bundled Worker source). The compile-time checks (b) are in test/web-unit/public-api-types.ts. tsconfig.json has no DOM
// types, so it cannot check web/listen.ts, and the other configs exclude test/web-unit, so the test below runs tsc on it.
const TSC_BIN = join('node_modules', 'typescript', 'bin', 'tsc');
const TSC_TIMEOUT_MS = 120_000;

describe('public API of the browser entry (Task 20)', () => {
  it('web/index.ts exports exactly the listed runtime names', () => {
    const src = readFileSync('web/index.ts', 'utf8');
    const names: string[] = [];
    for (const m of src.matchAll(/^export\s+(type\s+)?\{([^}]*)\}/gm)) {
      if (m[1] !== undefined) continue;
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop();
        if (name) names.push(name);
      }
    }
    expect(src).not.toMatch(/^export\s+(\*|default|const|let|var|function|class)\b/m);
    expect(names.sort()).toEqual(['createEngine', 'knnClassifier', 'listen', 'loadSounds', 'readWav', 'runSamples', 'writeWav']);
  });

  it('the public types have the members of Task 20 (compile-time checks)', () => {
    const r = spawnSync(process.execPath, [TSC_BIN, '--noEmit', '-p', join('test', 'web-unit', 'tsconfig.public-api.json')], {
      encoding: 'utf8', timeout: TSC_TIMEOUT_MS,
    });
    expect(`${r.stdout}${r.stderr}`).toBe('');
    expect(r.status).toBe(0);
  }, TSC_TIMEOUT_MS);
});
