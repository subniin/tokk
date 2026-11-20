// The three teach steps and the missing steps of a model (requirement 3.2, 3.3). Pure: no Tokk import.
import { TEACH_CLICK_EXAMPLES } from './constants';
import { TEACH_TEXTS } from './text';

export type StepLabel = 'click' | 'hum' | 'background';
export interface TeachStep { label: StepLabel; examples?: number; text: Record<string, string> }
// The part of a model that decides what is missing. ears.labels and ears.sounds.examples satisfy it.
export interface ModelLike { labels: readonly string[]; examples: readonly { label: string }[] }

export const STEPS: readonly TeachStep[] = [
  { label: 'click', examples: TEACH_CLICK_EXAMPLES, text: { ...TEACH_TEXTS.click } },
  { label: 'hum', text: { ...TEACH_TEXTS.hum } },
  { label: 'background', text: { ...TEACH_TEXTS.background } },
];

// The steps in the order click, hum, background that the model does not have yet. `background` is never in `labels`,
// so it is read from the examples.
export function missingSteps(model: ModelLike): TeachStep[] {
  return STEPS.filter((s) => (s.label === 'background' ? !model.examples.some((e) => e.label === 'background') : !model.labels.includes(s.label)));
}

export function allSteps(): TeachStep[] {
  return [...STEPS];
}
