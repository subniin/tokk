// Task 22, U7: the missing steps from a model, the order, the examples count, and that every teach text passes the
// library's own check (resolveTeachText, imported here only).
import { describe, expect, it } from 'vitest';
import { WEB_TEACH_BACKGROUND_RECORD_MS, WEB_TEACH_HUM_RECORD_MS } from '../web/constants';
import { resolveTeachText } from '../web/teach-ui/text';
import { MS_PER_SECOND, TEACH_BACKGROUND_MIN_S, TEACH_CLICK_EXAMPLES, TEACH_HUM_MIN_S } from '../apps/hands-free/src/constants';
import { allSteps, missingSteps, STEPS } from '../apps/hands-free/src/steps';
import type { ModelLike } from '../apps/hands-free/src/steps';

// Test-only values.
const MIN_EXAMPLES = 5;   // the library's minimum examples per label
const model = (labels: string[], exampleLabels: string[] = []): ModelLike => ({ labels, examples: exampleLabels.map((label) => ({ label })) });
const names = (steps: readonly { label: string }[]): string[] => steps.map((s) => s.label);

describe('teach steps (U7)', () => {
  it('there are three steps, in the order click, hum, background', () => {
    expect(names(STEPS)).toEqual(['click', 'hum', 'background']);
    expect(names(allSteps())).toEqual(['click', 'hum', 'background']);
  });

  it('an empty model misses all three', () => {
    expect(names(missingSteps(model([])))).toEqual(['click', 'hum', 'background']);
  });

  it('each taught label removes its step and the order stays', () => {
    expect(names(missingSteps(model(['click'], ['click'])))).toEqual(['hum', 'background']);
    expect(names(missingSteps(model(['hum'])))).toEqual(['click', 'background']);
    expect(names(missingSteps(model([], ['background'])))).toEqual(['click', 'hum']);
    expect(names(missingSteps(model(['click', 'hum'], ['click'])))).toEqual(['background']);
    expect(names(missingSteps(model(['click'], ['click', 'background'])))).toEqual(['hum']);
  });

  it('a model with all three misses nothing', () => {
    expect(missingSteps(model(['click', 'hum'], ['click', 'background']))).toEqual([]);
  });

  it('background is taught only when an example has that label, not when a label list says so', () => {
    expect(names(missingSteps(model(['click', 'hum', 'background'])))).toEqual(['background']);
  });

  it('the click step asks for ten examples, the library default, and at least the minimum', () => {
    const click = STEPS.find((s) => s.label === 'click');
    expect(click?.examples).toBe(TEACH_CLICK_EXAMPLES);
    expect(TEACH_CLICK_EXAMPLES).toBe(10);
    expect(TEACH_CLICK_EXAMPLES).toBeGreaterThanOrEqual(MIN_EXAMPLES);
  });

  it('the seconds in the texts equal the minimum of the dialog', () => {
    expect(TEACH_HUM_MIN_S).toBe(WEB_TEACH_HUM_RECORD_MS / MS_PER_SECOND);
    expect(TEACH_BACKGROUND_MIN_S).toBe(WEB_TEACH_BACKGROUND_RECORD_MS / MS_PER_SECOND);
    expect(STEPS.find((s) => s.label === 'hum')?.text.recordHum).toContain(`${TEACH_HUM_MIN_S} seconds`);
    expect(STEPS.find((s) => s.label === 'background')?.text.recordBackground).toContain(`${TEACH_BACKGROUND_MIN_S} seconds`);
  });

  it('every text of every step passes resolveTeachText', () => {
    for (const step of STEPS) {
      expect(() => resolveTeachText(step.text), step.label).not.toThrow();
      const resolved = resolveTeachText(step.text);
      for (const [key, value] of Object.entries(step.text)) expect(resolved[key as keyof typeof resolved]).toBe(value);
    }
  });

  it('each step has the step number, what to do and what happens after Save', () => {
    const [click, hum, background] = STEPS;
    expect(click.text.title).toBe('Step 1 of 3: your click');
    expect(hum.text.title).toBe('Step 2 of 3: your hum');
    expect(background.text.title).toBe('Step 3 of 3: the room');
    expect(click.text.record).toContain('{count}');
    expect(click.text.saved).toContain('Step 2 of 3');
    expect(hum.text.saved).toContain('Step 3 of 3');
    expect(background.text.saved).toContain('Close');
    expect(background.text.recordBackground).toContain('ignore');
  });

  it('a bad key, an empty text or a wrong placeholder in the steps would be rejected by the library check', () => {
    expect(() => resolveTeachText({ title: '' })).toThrow(RangeError);
    expect(() => resolveTeachText({ saved: 'Saved {label}' })).toThrow(RangeError);
    expect(() => resolveTeachText({ nope: 'x' })).toThrow(RangeError);
  });

  it('allSteps gives a fresh array each time', () => {
    expect(allSteps()).not.toBe(allSteps());
    expect(allSteps()).toEqual([...STEPS]);
  });
});
