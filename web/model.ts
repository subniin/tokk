// The one check of a sound model (the content of sounds.json). Used by loadSounds, the stored model and importSounds.
// Pure: no DOM type, no Node module, no network.

import { BACKGROUND, HUM_LABEL, MODEL_VERSION } from '../core/constants';
import type { SoundModel } from '../core/types';

export type ModelCheck =
  | { ok: true; model: SoundModel }
  | { ok: false; problem: 'shape' }
  | { ok: false; problem: 'version'; version: number };

function isModelShape(value: unknown): value is SoundModel {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.version === 'number'
    && typeof m.k === 'number'
    && typeof m.sampleRate === 'number'
    && Array.isArray(m.mean)
    && Array.isArray(m.std)
    && Array.isArray(m.examples)
    && typeof m.thresholds === 'object' && m.thresholds !== null;
}

export function checkModel(value: unknown): ModelCheck {
  if (!isModelShape(value)) return { ok: false, problem: 'shape' };
  if (value.version !== MODEL_VERSION) return { ok: false, problem: 'version', version: value.version };
  return { ok: true, model: value };
}

// The labels a model has been taught, for ears.labels (Task 20): the labels of its examples without background, plus
// hum when it has a pitch, sorted by plain code-unit order. A new array on every call.
export function labelsOf(model: SoundModel): string[] {
  const labels = new Set(model.examples.map((e) => e.label));
  labels.delete(BACKGROUND);
  if (model.pitch?.baselineHz !== undefined) labels.add(HUM_LABEL);
  return [...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
