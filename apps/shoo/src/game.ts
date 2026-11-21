// The rules of the game. Pure: no DOM, no Web Audio, no Tokk. reduce(state, input) returns a new state and never
// changes its input. Spawn order comes from a seeded generator kept in the state, so a test replays a game exactly.
import { MS_PER_SECOND, PATH_END_Y, PATH_START_Y, START_LIVES, WARDEN_SPEED_FACTOR } from './constants';
import { BOSS_PATTERN, MONSTERS } from './monsters';
import type { Kind } from './monsters';
import { WAVES, spawnIntervalMs } from './waves';

export type Phase = 'room' | 'intro' | 'battle' | 'between' | 'paused' | 'lost' | 'won';
export interface Monster { id: number; kind: Kind; hp: number; y: number }

export interface GameState {
  phase: Phase;
  wave: number;           // 1 to WAVES.length
  lives: number;
  monsters: Monster[];
  shooed: number;         // monsters removed by a sound, over the whole game
  lastHeard: string | null;
  queue: Kind[];          // kinds still to spawn in this wave, next first
  spawnInMs: number;      // time until the next spawn
  nextId: number;
  seed: number;           // the seed the game started with (restart keeps it)
  rngState: number;       // the state of the generator
}

export type GameInput =
  | { type: 'sound'; label: string }
  | { type: 'pattern'; pattern: string }
  | { type: 'tick'; dtMs: number }
  | { type: 'roomDone' }
  | { type: 'introDone' }
  | { type: 'nextWave' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart'; seed?: number };

// What one input did to a monster, for the screen. The state itself already has the result.
export type Hit =
  | { type: 'hit'; id: number; kind: Kind; sound: string; removed: boolean }
  | { type: 'miss'; reason: 'unknown' | 'no-target'; sound?: string };

// mulberry32 as a pure step: the next value in [0, 1) and the next state.
const RNG_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;
function nextRandom(state: number): { value: number; state: number } {
  const next = (state + RNG_INCREMENT) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE, state: next };
}

export function initialState(seed: number): GameState {
  const s = seed >>> 0;
  return {
    phase: 'room', wave: 1, lives: START_LIVES, monsters: [], shooed: 0, lastHeard: null,
    queue: [], spawnInMs: 0, nextId: 1, seed: s, rngState: s,
  };
}

// The queue of a wave: the one warden first (wave 5), then random kinds of the other kinds of the wave.
function buildQueue(wave: number, rngState: number): { queue: Kind[]; rngState: number } {
  const { kinds, count } = WAVES[wave - 1];
  const queue: Kind[] = [];
  if (kinds.includes('warden')) queue.push('warden');
  const others = kinds.filter((k) => k !== 'warden');
  let rs = rngState;
  while (queue.length < count) {
    const r = nextRandom(rs);
    rs = r.state;
    queue.push(others[Math.floor(r.value * others.length)]);
  }
  return { queue, rngState: rs };
}

const speedOf = (wave: number, kind: Kind): number => WAVES[wave - 1].speed * (kind === 'warden' ? WARDEN_SPEED_FACTOR : 1);

// The wave is over when nothing walks and nothing waits. A lost game stays lost.
function settle(s: GameState): GameState {
  if (s.lives <= 0) return { ...s, lives: 0, phase: 'lost' };
  if (s.monsters.length === 0 && s.queue.length === 0) return { ...s, phase: s.wave >= WAVES.length ? 'won' : 'between' };
  return s;
}

// The front monster (largest y) whose weak point is `weak`; the first of equal ones.
function target(monsters: Monster[], weak: string): Monster | undefined {
  let best: Monster | undefined;
  for (const m of monsters) if (MONSTERS[m.kind].weak === weak && (best === undefined || m.y > best.y)) best = m;
  return best;
}

function strike(s: GameState, weak: string, heard: string | null, shownSound: string): { state: GameState; hit: Hit } {
  const lastHeard = heard ?? s.lastHeard;
  const m = target(s.monsters, weak);
  if (m === undefined) return { state: { ...s, lastHeard }, hit: { type: 'miss', reason: 'no-target', sound: shownSound } };
  const hp = m.hp - 1;
  const removed = hp <= 0;
  const monsters = removed ? s.monsters.filter((x) => x.id !== m.id) : s.monsters.map((x) => (x.id === m.id ? { ...x, hp } : x));
  const state = settle({ ...s, monsters, lastHeard, shooed: s.shooed + (removed ? 1 : 0) });
  return { state, hit: { type: 'hit', id: m.id, kind: m.kind, sound: shownSound, removed } };
}

function tick(s: GameState, dtMs: number): GameState {
  if (!(Number.isFinite(dtMs) && dtMs > 0)) return s;
  const moved = s.monsters.map((m) => ({ ...m, y: m.y + (speedOf(s.wave, m.kind) * dtMs) / MS_PER_SECOND }));
  const queue = [...s.queue];
  const monsters = moved.filter((m) => m.y < PATH_END_Y);
  let spawnInMs = s.spawnInMs - dtMs;
  let nextId = s.nextId;
  while (queue.length > 0 && spawnInMs <= 0) {
    const kind = queue.shift() as Kind;
    monsters.push({ id: nextId++, kind, hp: MONSTERS[kind].hp, y: PATH_START_Y });
    spawnInMs += spawnIntervalMs(s.wave);
  }
  const escaped = moved.length - moved.filter((m) => m.y < PATH_END_Y).length;
  return settle({ ...s, monsters, queue, spawnInMs, nextId, lives: s.lives - escaped });
}

export function reduceWithHit(s: GameState, i: GameInput): { state: GameState; hit: Hit | null } {
  const same = { state: s, hit: null };
  switch (i.type) {
    case 'restart': return { state: initialState(i.seed ?? s.seed), hit: null };
    case 'roomDone': return s.phase === 'room' ? { state: { ...s, phase: 'intro' }, hit: null } : same;
    case 'nextWave':
      return s.phase === 'between' && s.wave < WAVES.length ? { state: { ...s, phase: 'intro', wave: s.wave + 1, monsters: [] }, hit: null } : same;
    case 'introDone': {
      if (s.phase !== 'intro') return same;
      const q = buildQueue(s.wave, s.rngState);
      return { state: { ...s, phase: 'battle', monsters: [], queue: q.queue, rngState: q.rngState, spawnInMs: 0 }, hit: null };
    }
    case 'pause': return s.phase === 'battle' ? { state: { ...s, phase: 'paused' }, hit: null } : same;
    case 'resume': return s.phase === 'paused' ? { state: { ...s, phase: 'battle' }, hit: null } : same;
    case 'tick': return s.phase === 'battle' ? { state: tick(s, i.dtMs), hit: null } : same;
    case 'sound': {
      if (s.phase !== 'battle' || i.label === 'background') return same;
      if (i.label === 'unknown') return { state: { ...s, lastHeard: '?' }, hit: { type: 'miss', reason: 'unknown' } };
      return strike(s, i.label, i.label, i.label);
    }
    case 'pattern':
      if (s.phase !== 'battle' || i.pattern !== BOSS_PATTERN) return same;
      return strike(s, 'rhythm', null, i.pattern);
  }
}

export function reduce(s: GameState, i: GameInput): GameState {
  return reduceWithHit(s, i).state;
}

// The engine mode: the boss pattern is listened for only while the warden's wave is fought.
export function modeFor(s: GameState): 'battle' | 'boss' {
  return s.wave === WAVES.length && s.phase === 'battle' ? 'boss' : 'battle';
}
