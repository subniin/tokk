import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/web/**'],
    setupFiles: ['test/setup.ts'],
    env: {
      PBT_RUNS: process.env.PBT_RUNS ?? '100',
    },
  },
});
