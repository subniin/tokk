import { defineConfig } from '@playwright/test';
import { DEV_SERVER_HOST, DEV_SERVER_PORT } from './scripts/build';
import { FIXTURE_WAV_PATH, fakeMicArgs } from './test/web/paths';

// Chrome treats a space in this argument as a separator, and the repository path has none.
if (/\s/.test(FIXTURE_WAV_PATH)) {
  throw new Error(`The fixture path must not contain a space for Chrome's fake microphone: ${FIXTURE_WAV_PATH}`);
}

const BASE_URL = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;
const WEB_SERVER_START_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  testDir: 'test/web',
  testMatch: '*.spec.ts',
  globalSetup: './test/web/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: TEST_TIMEOUT_MS,
  reporter: [['list']],
  use: { baseURL: BASE_URL },
  webServer: {
    command: 'npm run dev',
    url: `${BASE_URL}/`,
    reuseExistingServer: true,
    timeout: WEB_SERVER_START_TIMEOUT_MS,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        channel: 'chrome',
        launchOptions: {
          args: fakeMicArgs(FIXTURE_WAV_PATH),
        },
      },
    },
  ],
});
