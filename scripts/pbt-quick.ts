import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const CANDIDATES = ['test/segment.test.ts', 'test/knn.test.ts', 'test/grammar.test.ts'];
const QUICK_RUNS = '20';

const files = CANDIDATES.filter((f) => existsSync(f));
if (files.length === 0) {
  console.log('pbt:quick: no property test files yet');
  process.exit(0);
}

const require = createRequire(join(process.cwd(), 'package.json'));
const vitestEntry = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const env = { ...process.env, PBT_RUNS: process.env.PBT_RUNS ?? QUICK_RUNS };
const result = spawnSync(process.execPath, [vitestEntry, 'run', '--reporter', 'dot', ...files], {
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
