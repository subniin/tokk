import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['test/setup.ts'],
    env: {
      PBT_RUNS: process.env.PBT_RUNS ?? '100',
    },
  },
});
