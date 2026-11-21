// The test-only parameters of the page: ?speed=N (game clock and waits run N times faster, 1 to 16), ?wave=N (start at wave N)
// and ?lives=N (start with N candles). The browser tests use them so that a wave takes seconds and a boss test can start at
// wave 5. A missing or bad value gives the plain game. Pure: no DOM.
import { BACKGROUND_TEACH_MS, BACKGROUND_TEACH_TEST_MS, START_LIVES, TEST_LIVES_MAX, TEST_SPEED_MAX } from './constants';
import { WAVES } from './waves';

export interface TestParams { speed: number; wave: number; lives: number }

function number(search: URLSearchParams, key: string): number | null {
  const raw = search.get(key);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseTestParams(query: string): TestParams {
  const q = new URLSearchParams(query);
  const speed = number(q, 'speed');
  const wave = number(q, 'wave');
  const lives = number(q, 'lives');
  return {
    speed: speed !== null && speed >= 1 && speed <= TEST_SPEED_MAX ? speed : 1,
    wave: wave !== null && Number.isInteger(wave) && wave >= 1 && wave <= WAVES.length ? wave : 1,
    lives: lives !== null && Number.isInteger(lives) && lives >= 1 && lives <= TEST_LIVES_MAX ? lives : START_LIVES,
  };
}

// The room sound lasts 30 s. A test speed above 1 uses the shortest length teach() allows.
export function backgroundMsFor(speed: number): number {
  return speed > 1 ? BACKGROUND_TEACH_TEST_MS : BACKGROUND_TEACH_MS;
}
