// The five waves. Each wave adds one kind to the kinds of the wave before (shoo.md section 4). Pure.
import { SPAWN_INTERVAL_FIRST_WAVE_MS, SPAWN_INTERVAL_LAST_WAVE_MS, WAVE_COUNT_PER_WAVE, WAVE_SPEED_PER_S } from './constants';
import type { Kind } from './monsters';

// The kinds in the order they first appear.
const KIND_ORDER: readonly Kind[] = ['bat', 'ghost', 'skeleton', 'pumpkin', 'warden'];

// kinds: what can appear; count: monsters in the wave; speed: path fraction per second.
// Wave 5 holds exactly one warden. It spawns first and walks at half speed (game.ts).
export const WAVES: readonly { kinds: Kind[]; count: number; speed: number }[] = KIND_ORDER.map((_, i) => ({
  kinds: KIND_ORDER.slice(0, i + 1),
  count: WAVE_COUNT_PER_WAVE[i],
  speed: WAVE_SPEED_PER_S[i],
}));

// The kinds that appear first in this wave: what the player has to learn. Empty for a wave that does not exist.
export function newKinds(wave: number): Kind[] {
  const w = WAVES[wave - 1];
  if (w === undefined) return [];
  const before = wave > 1 ? WAVES[wave - 2].kinds : [];
  return w.kinds.filter((k) => !before.includes(k));
}

// Time between two spawns, in ms: falls in equal steps from the first wave to the last.
export function spawnIntervalMs(wave: number): number {
  const last = WAVES.length;
  const w = Math.min(Math.max(wave, 1), last);
  const step = (SPAWN_INTERVAL_LAST_WAVE_MS - SPAWN_INTERVAL_FIRST_WAVE_MS) / (last - 1);
  return Math.round(SPAWN_INTERVAL_FIRST_WAVE_MS + step * (w - 1));
}
