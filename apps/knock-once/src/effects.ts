// runBetween: the one order of every effect (design.md "Effects and the paused microphone", requirement 11.3 to 11.5).
// Pure: every call is passed in. `wait` is a timer of the given ms, never an audio-clock event, so a suspended audio
// context cannot stall the game. `resume` is called whenever `pause` was, also when playing or showing fails.
import type { EffectName } from './captions';
import { RECIPES } from './effect-recipes';
import { EFFECT_TAIL_MS, EFFECT_TOTAL_MAX_MS, TRANSITION_HOLD_MS } from './constants';

export interface EffectPlan { effect: EffectName; durationMs: number; muted: boolean; tailMs: number; holdMs: number }
export interface EffectIo {
  lock(): void;
  caption(effect: EffectName): void;
  pause(): void;
  play(effect: EffectName): void;
  wait(ms: number): Promise<void>;
  failed(error: unknown): void;
  show(): void;
  setMode(): void;
  resume(): void;
  unlock(): void;
}
export type RunResult = 'done' | 'busy';

export function planFor(effect: EffectName, muted: boolean): EffectPlan {
  return { effect, durationMs: RECIPES[effect].durationMs, muted, tailMs: EFFECT_TAIL_MS, holdMs: TRANSITION_HOLD_MS };
}

// The time the microphone stays paused (or the hold, when muted), never more than EFFECT_TOTAL_MAX_MS.
export function waitMsOf(plan: EffectPlan): number {
  return plan.muted ? plan.holdMs : Math.min(plan.durationMs + plan.tailMs, EFFECT_TOTAL_MAX_MS);
}

export function createEffectRunner(): { runBetween(plan: EffectPlan, io: EffectIo): Promise<RunResult>; readonly busy: boolean } {
  let busy = false;
  return {
    get busy() { return busy; },
    async runBetween(plan, io) {
      if (busy) return 'busy';
      busy = true;
      let paused = false;
      try {
        io.lock();
        io.caption(plan.effect);
        if (plan.muted) {
          await io.wait(waitMsOf(plan));
        } else {
          io.pause();
          paused = true;
          let played = true;
          try {
            io.play(plan.effect);
          } catch (e) {
            played = false;
            io.failed(e);
          }
          if (played) await io.wait(waitMsOf(plan));
        }
        io.show();
        io.setMode();
      } finally {
        if (paused) io.resume();
        io.unlock();
        busy = false;
      }
      return 'done';
    },
  };
}
