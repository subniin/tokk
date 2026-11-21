// Task 33 (requirements 3 to 11): the pure rules of the game.
import { describe, expect, it } from 'vitest';
import { BOSS_PATTERN } from '../apps/shoo/src/monsters';
import type { Kind } from '../apps/shoo/src/monsters';
import { WAVES } from '../apps/shoo/src/waves';
import { initialState, modeFor, reduce, reduceWithHit } from '../apps/shoo/src/game';
import type { GameInput, GameState, Monster } from '../apps/shoo/src/game';

// Test-only values.
const SEED = 33;
const OTHER_SEED = 34;
const MS_PER_SECOND = 1000;
const NO_SPAWN_MS = 1e9;           // a spawn timer that never runs out inside a test
const TICK_MS = 100;
const MAX_TICKS = 5000;
const MANY_LIVES = 999;
const PHASES: GameState['phase'][] = ['paused', 'intro', 'between', 'room', 'lost', 'won'];

let nextId = 1000;
const monster = (kind: Kind, y: number, hp?: number): Monster => ({
  id: nextId++, kind, y, hp: hp ?? (kind === 'skeleton' ? 2 : kind === 'warden' ? 3 : 1),
});

// A battle state with the given monsters, an empty queue and no spawning.
function battle(monsters: Monster[], over: Partial<GameState> = {}): GameState {
  return { ...initialState(SEED), phase: 'battle', queue: [], spawnInMs: NO_SPAWN_MS, monsters, ...over };
}

const sound = (label: string): GameInput => ({ type: 'sound', label });
const tick = (dtMs: number): GameInput => ({ type: 'tick', dtMs });

// Starts a wave and ticks until `count` monsters have appeared. Returns the kinds in spawn order.
function spawnOrder(seed: number, wave: number): Kind[] {
  let s = reduce({ ...initialState(seed), phase: 'intro', wave }, { type: 'introDone' });
  s = { ...s, lives: MANY_LIVES };
  const seen = new Map<number, Kind>();
  for (let i = 0; i < MAX_TICKS && s.phase === 'battle'; i++) {
    s = reduce(s, tick(TICK_MS));
    for (const m of s.monsters) if (!seen.has(m.id)) seen.set(m.id, m.kind);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, k]) => k);
}

describe('the start state', () => {
  it('room phase, wave 1, three lives, nothing on the path', () => {
    const s = initialState(SEED);
    expect(s).toMatchObject({ phase: 'room', wave: 1, lives: 3, monsters: [], shooed: 0, lastHeard: null });
  });
});

describe('a sound hits the front monster that fears it', () => {
  it('click removes the bat at y .7 and leaves the one at y .3', () => {
    const near = monster('bat', 0.7);
    const far = monster('bat', 0.3);
    const s = reduce(battle([far, near]), sound('click'));
    expect(s.monsters.map((m) => m.id)).toEqual([far.id]);
    expect(s.shooed).toBe(1);
    expect(s.lastHeard).toBe('click');
  });

  it('the skeleton takes one knock with hp 1 left, the second removes it', () => {
    const one = reduce(battle([monster('skeleton', 0.5), monster('bat', 0.2)]), sound('knock'));
    expect(one.monsters.find((m) => m.kind === 'skeleton')?.hp).toBe(1);
    expect(one.shooed).toBe(0);
    const two = reduce(one, sound('knock'));
    expect(two.monsters.map((m) => m.kind)).toEqual(['bat']);
    expect(two.shooed).toBe(1);
  });

  it('a clap with no ghost leaves the monsters as they are and sets lastHeard', () => {
    const start = battle([monster('bat', 0.4), monster('skeleton', 0.6)]);
    const s = reduce(start, sound('clap'));
    expect(s.monsters).toEqual(start.monsters);
    expect(s.shooed).toBe(0);
    expect(s.lastHeard).toBe('clap');
  });

  it('unknown leaves the monsters as they are and sets lastHeard to ?', () => {
    const start = battle([monster('ghost', 0.4)]);
    const s = reduce(start, sound('unknown'));
    expect(s.monsters).toEqual(start.monsters);
    expect(s.lastHeard).toBe('?');
  });

  it('background is ignored', () => {
    const start = battle([monster('ghost', 0.4)], { lastHeard: 'clap' });
    expect(reduce(start, sound('background'))).toEqual(start);
  });

  it('a sound that no monster fears at all (the warden is hit by the rhythm only)', () => {
    const start = battle([monster('warden', 0.5)]);
    const s = reduce(start, sound('knock'));
    expect(s.monsters).toEqual(start.monsters);
    expect(s.lastHeard).toBe('knock');
  });

  it('wave 5: a single knock still hits a skeleton', () => {
    const s = reduce(battle([monster('warden', 0.8), monster('skeleton', 0.3)], { wave: 5 }), sound('knock'));
    expect(s.monsters.find((m) => m.kind === 'skeleton')?.hp).toBe(1);
    expect(s.monsters.find((m) => m.kind === 'warden')?.hp).toBe(3);
  });
});

describe('the boss pattern', () => {
  it('three times removes the warden and counts one shooed monster', () => {
    let s = battle([monster('warden', 0.4), monster('bat', 0.1)], { wave: 5 });
    const pattern: GameInput = { type: 'pattern', pattern: BOSS_PATTERN };
    s = reduce(s, pattern);
    expect(s.monsters.find((m) => m.kind === 'warden')?.hp).toBe(2);
    s = reduce(s, pattern);
    expect(s.monsters.find((m) => m.kind === 'warden')?.hp).toBe(1);
    s = reduce(s, pattern);
    expect(s.monsters.map((m) => m.kind)).toEqual(['bat']);
    expect(s.shooed).toBe(1);
  });

  it('with no warden, or another pattern, nothing changes', () => {
    const start = battle([monster('bat', 0.4)], { wave: 5 });
    expect(reduce(start, { type: 'pattern', pattern: BOSS_PATTERN })).toEqual(start);
    const withBoss = battle([monster('warden', 0.4)], { wave: 5 });
    expect(reduce(withBoss, { type: 'pattern', pattern: 'clap clap' })).toEqual(withBoss);
  });
});

describe('ticks', () => {
  it('monsters move by the wave speed', () => {
    const s = reduce(battle([monster('bat', 0.1)]), tick(MS_PER_SECOND));
    expect(s.monsters[0].y).toBeCloseTo(0.1 + WAVES[0].speed, 10);
  });

  it('the warden walks at half speed', () => {
    const s = reduce(battle([monster('warden', 0.1)], { wave: 5 }), tick(MS_PER_SECOND));
    expect(s.monsters[0].y).toBeCloseTo(0.1 + WAVES[4].speed / 2, 10);
  });

  it('a monster that reaches y 1 is removed and costs one life', () => {
    const s = reduce(battle([monster('bat', 0.99)], { queue: ['bat'] }), tick(MS_PER_SECOND));
    expect(s.monsters).toEqual([]);
    expect(s.lives).toBe(2);
    expect(s.phase).toBe('battle');
    expect(s.shooed).toBe(0);
  });

  it('the last life gone gives lost', () => {
    const s = reduce(battle([monster('bat', 0.99)], { lives: 1, queue: ['bat'] }), tick(MS_PER_SECOND));
    expect(s.lives).toBe(0);
    expect(s.phase).toBe('lost');
  });

  it('an empty wave with an empty queue gives between', () => {
    const s = reduce(battle([monster('bat', 0.5)]), sound('click'));
    expect(s.phase).toBe('between');
    const t = reduce(battle([monster('bat', 0.99)]), tick(MS_PER_SECOND));
    expect(t.phase).toBe('between');
    expect(t.lives).toBe(2);
  });

  it('the last wave empty gives won, by a hit and by a tick', () => {
    expect(reduce(battle([monster('bat', 0.5)], { wave: 5 }), sound('click')).phase).toBe('won');
    expect(reduce(battle([monster('bat', 0.99)], { wave: 5 }), tick(MS_PER_SECOND)).phase).toBe('won');
  });

  it('a wave with monsters still in the queue goes on', () => {
    const s = reduce(battle([], { queue: ['bat'], spawnInMs: NO_SPAWN_MS }), tick(TICK_MS));
    expect(s.phase).toBe('battle');
  });
});

describe('spawning', () => {
  it('introDone starts the wave with the queue of its count', () => {
    const s = reduce({ ...initialState(SEED), phase: 'intro' }, { type: 'introDone' });
    expect(s.phase).toBe('battle');
    expect(s.queue).toHaveLength(WAVES[0].count);
    expect(s.monsters).toEqual([]);
  });

  it('each wave spawns its count, only its kinds, in the order of the queue', () => {
    for (let wave = 1; wave <= WAVES.length; wave++) {
      const order = spawnOrder(SEED, wave);
      expect(order, `wave ${wave}`).toHaveLength(WAVES[wave - 1].count);
      for (const k of order) expect(WAVES[wave - 1].kinds, `wave ${wave}`).toContain(k);
    }
  });

  it('wave 5 spawns the one warden first', () => {
    const order = spawnOrder(SEED, 5);
    expect(order[0]).toBe('warden');
    expect(order.filter((k) => k === 'warden')).toHaveLength(1);
  });

  it('the same seed gives the same spawn order, another seed another one', () => {
    expect(spawnOrder(SEED, 4)).toEqual(spawnOrder(SEED, 4));
    expect(spawnOrder(SEED, 4)).not.toEqual(spawnOrder(OTHER_SEED, 4));
  });

  it('new monsters appear at y 0 on the timer of the wave', () => {
    let s = reduce({ ...initialState(SEED), phase: 'intro' }, { type: 'introDone' });
    s = reduce(s, tick(TICK_MS));
    expect(s.monsters).toHaveLength(1);
    expect(s.monsters[0].y).toBe(0);
    s = reduce(s, tick(TICK_MS));
    expect(s.monsters).toHaveLength(1);
  });
});

describe('input while the app makes sounds or the game is not running (Review Focus 3)', () => {
  for (const phase of PHASES) {
    it(`sound, pattern and tick change nothing in ${phase}`, () => {
      const start = battle([monster('bat', 0.5), monster('warden', 0.4)], { phase, wave: 5, queue: ['bat'] });
      for (const input of [sound('click'), sound('unknown'), { type: 'pattern', pattern: BOSS_PATTERN } as const, tick(MS_PER_SECOND)]) {
        expect(reduce(start, input), `${phase} ${input.type}`).toEqual(start);
      }
    });
  }
});

describe('the flow', () => {
  it('room, intro, battle, between, intro of the next wave', () => {
    let s = initialState(SEED);
    s = reduce(s, { type: 'roomDone' });
    expect(s.phase).toBe('intro');
    s = reduce(s, { type: 'introDone' });
    expect(s.phase).toBe('battle');
    s = { ...s, phase: 'between' };
    s = reduce(s, { type: 'nextWave' });
    expect(s).toMatchObject({ phase: 'intro', wave: 2 });
  });

  it('flow inputs in the wrong phase do nothing', () => {
    const s = battle([monster('bat', 0.5)]);
    for (const input of [{ type: 'roomDone' }, { type: 'introDone' }, { type: 'nextWave' }, { type: 'resume' }] as const) {
      expect(reduce(s, input), input.type).toEqual(s);
    }
    const room = initialState(SEED);
    expect(reduce(room, { type: 'pause' })).toEqual(room);
  });

  it('pause and resume work from battle and keep the monsters', () => {
    const s = battle([monster('bat', 0.5)]);
    const paused = reduce(s, { type: 'pause' });
    expect(paused.phase).toBe('paused');
    expect(paused.monsters).toEqual(s.monsters);
    expect(reduce(paused, { type: 'resume' })).toEqual(s);
  });

  it('restart gives the start state from every phase, with the seed of the game or a new one', () => {
    const played = reduce(battle([monster('bat', 0.5)], { lives: 0, shooed: 9, phase: 'lost', lastHeard: 'clap' }), { type: 'restart' });
    expect(played).toEqual(initialState(SEED));
    expect(reduce(battle([monster('bat', 0.5)]), { type: 'restart', seed: OTHER_SEED })).toEqual(initialState(OTHER_SEED));
  });

  it('reduce does not change its input', () => {
    const s = battle([monster('skeleton', 0.5), monster('bat', 0.2)], { queue: ['bat'] });
    const before = structuredClone(s);
    for (const input of [sound('knock'), sound('clap'), tick(MS_PER_SECOND), { type: 'pause' } as const]) reduce(s, input);
    expect(s).toEqual(before);
  });
});

describe('modeFor', () => {
  it('boss only in wave 5 during battle', () => {
    for (let wave = 1; wave <= 5; wave++) {
      for (const phase of ['room', 'intro', 'battle', 'between', 'paused', 'lost', 'won'] as const) {
        const expected = wave === 5 && phase === 'battle' ? 'boss' : 'battle';
        expect(modeFor({ ...initialState(SEED), wave, phase }), `wave ${wave} ${phase}`).toBe(expected);
      }
    }
  });
});

describe('reduceWithHit: what the screen draws', () => {
  it('a removed monster', () => {
    const bat = monster('bat', 0.6);
    const { state, hit } = reduceWithHit(battle([bat, monster('bat', 0.1)]), sound('click'));
    expect(hit).toEqual({ type: 'hit', id: bat.id, kind: 'bat', sound: 'click', removed: true });
    expect(state.shooed).toBe(1);
  });

  it('a monster that is hit and stays', () => {
    const skeleton = monster('skeleton', 0.6);
    const { hit } = reduceWithHit(battle([skeleton]), sound('knock'));
    expect(hit).toEqual({ type: 'hit', id: skeleton.id, kind: 'skeleton', sound: 'knock', removed: false });
  });

  it('the boss pattern hits the warden', () => {
    const warden = monster('warden', 0.6);
    const { hit } = reduceWithHit(battle([warden], { wave: 5 }), { type: 'pattern', pattern: BOSS_PATTERN });
    expect(hit).toEqual({ type: 'hit', id: warden.id, kind: 'warden', sound: BOSS_PATTERN, removed: false });
  });

  it('why nothing was hit', () => {
    const s = battle([monster('bat', 0.6)]);
    expect(reduceWithHit(s, sound('pop')).hit).toEqual({ type: 'miss', reason: 'no-target', sound: 'pop' });
    expect(reduceWithHit(s, sound('unknown')).hit).toEqual({ type: 'miss', reason: 'unknown' });
  });

  it('null when the input is not a sound', () => {
    expect(reduceWithHit(battle([monster('bat', 0.6)]), tick(TICK_MS)).hit).toBeNull();
    expect(reduceWithHit(battle([]), sound('background')).hit).toBeNull();
    expect(reduceWithHit({ ...battle([]), phase: 'intro' }, sound('click')).hit).toBeNull();
  });

  it('the state is the one that reduce gives', () => {
    const s = battle([monster('bat', 0.6), monster('skeleton', 0.2)]);
    for (const input of [sound('click'), sound('knock'), sound('unknown'), tick(TICK_MS)]) {
      expect(reduceWithHit(s, input).state).toEqual(reduce(s, input));
    }
  });
});
