// Task 23, U5 (requirement 11.3 to 11.5, 11.7): the order of every effect, with injected functions that log their calls.
// No fake timers: `wait` is injected and resolves at once.
import { describe, expect, it } from 'vitest';
import { createEffectRunner, planFor, waitMsOf } from '../apps/knock-once/src/effects';
import type { EffectIo, EffectPlan } from '../apps/knock-once/src/effects';
import { RECIPES } from '../apps/knock-once/src/effect-recipes';
import { EFFECT_TAIL_MS, EFFECT_TOTAL_MAX_MS, TRANSITION_HOLD_MS } from '../apps/knock-once/src/constants';
import type { EffectName } from '../apps/knock-once/src/captions';

const NAMES: EffectName[] = ['summon', 'between', 'ending'];

function logIo(over: Partial<EffectIo> = {}): { io: EffectIo; log: string[]; waits: number[] } {
  const log: string[] = [];
  const waits: number[] = [];
  const io: EffectIo = {
    lock: () => log.push('lock'),
    caption: (e) => log.push(`caption ${e}`),
    pause: () => log.push('pause'),
    play: (e) => log.push(`play ${e}`),
    wait: async (ms) => { log.push('wait'); waits.push(ms); },
    failed: () => log.push('failed'),
    show: () => log.push('show'),
    setMode: () => log.push('setMode'),
    resume: () => log.push('resume'),
    unlock: () => log.push('unlock'),
    ...over,
  };
  return { io, log, waits };
}

describe('runBetween (U5)', () => {
  it('the order: lock, caption, pause, play, wait, show, setMode, resume, unlock', async () => {
    const { io, log, waits } = logIo();
    const r = await createEffectRunner().runBetween(planFor('between', false), io);
    expect(r).toBe('done');
    expect(log).toEqual(['lock', 'caption between', 'pause', 'play between', 'wait', 'show', 'setMode', 'resume', 'unlock']);
    expect(waits).toEqual([RECIPES.between.durationMs + EFFECT_TAIL_MS]);
  });

  it('the mode is set before the microphone is resumed', async () => {
    const { io, log } = logIo();
    await createEffectRunner().runBetween(planFor('summon', false), io);
    expect(log.indexOf('setMode')).toBeLessThan(log.indexOf('resume'));
    expect(log.indexOf('show')).toBeLessThan(log.indexOf('setMode'));
  });

  it('resume and unlock after a failed play, with a failure caption', async () => {
    const { io, log } = logIo({ play: () => { throw new Error('no audio'); } });
    const r = await createEffectRunner().runBetween(planFor('ending', false), io);
    expect(r).toBe('done');
    expect(log).toEqual(['lock', 'caption ending', 'pause', 'failed', 'show', 'setMode', 'resume', 'unlock']);
  });

  it('resume and unlock also when show throws', async () => {
    const { io, log } = logIo({ show: () => { throw new Error('draw'); } });
    await expect(createEffectRunner().runBetween(planFor('between', false), io)).rejects.toThrow('draw');
    expect(log.slice(-2)).toEqual(['resume', 'unlock']);
  });

  it('a second run while one runs is busy and calls nothing', async () => {
    let release: () => void = () => undefined;
    const first = logIo({ wait: () => new Promise<void>((r) => { release = r; }) });
    const second = logIo();
    const runner = createEffectRunner();
    const running = runner.runBetween(planFor('summon', false), first.io);
    expect(runner.busy).toBe(true);
    expect(await runner.runBetween(planFor('between', false), second.io)).toBe('busy');
    expect(second.log).toEqual([]);
    release();
    expect(await running).toBe('done');
    expect(runner.busy).toBe(false);
    expect(await runner.runBetween(planFor('between', false), second.io)).toBe('done');
  });

  it('muted: no pause, no play, no resume, one wait of the hold', async () => {
    const { io, log, waits } = logIo();
    await createEffectRunner().runBetween(planFor('ending', true), io);
    expect(log).toEqual(['lock', 'caption ending', 'wait', 'show', 'setMode', 'unlock']);
    expect(waits).toEqual([TRANSITION_HOLD_MS]);
  });

  it('the wait is the duration of the recipe plus the tail, and never more than EFFECT_TOTAL_MAX_MS', () => {
    for (const n of NAMES) {
      const plan = planFor(n, false);
      expect(plan.durationMs).toBe(RECIPES[n].durationMs);
      expect(waitMsOf(plan)).toBe(RECIPES[n].durationMs + EFFECT_TAIL_MS);
      expect(waitMsOf(plan)).toBeLessThanOrEqual(EFFECT_TOTAL_MAX_MS);
    }
    const long: EffectPlan = { effect: 'ending', durationMs: 9000, muted: false, tailMs: EFFECT_TAIL_MS, holdMs: TRANSITION_HOLD_MS };
    expect(waitMsOf(long)).toBe(EFFECT_TOTAL_MAX_MS);
    expect(waitMsOf(planFor('summon', true))).toBe(TRANSITION_HOLD_MS);
  });
});
