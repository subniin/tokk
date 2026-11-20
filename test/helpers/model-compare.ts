// Compares two sound models that were trained on the same wav bytes in two JavaScript engines (for example Node and
// Chrome). V8's Math.exp, log, log10, sin, cos and atan2 differ in the last bits between versions, so the floats of
// two engines are equal only within a tolerance. Everything that is not a float must be exactly equal.

import { classifyVector } from '../../core/classify/knn';
import type { SoundModel } from '../../core/types';

export const MODEL_REL_TOLERANCE = 1e-9;    // relative, no unit
export const MODEL_ABS_TOLERANCE = 1e-12;   // absolute, for numbers near zero, no unit

export interface ModelDifference { path: string; a: unknown; b: unknown; reason: string }

function numbersClose(a: number, b: number): boolean {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  return diff <= MODEL_ABS_TOLERANCE || diff <= MODEL_REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

// Same structure and key order; numbers within the tolerance; strings, booleans and null equal.
function walk(a: unknown, b: unknown, path: string, out: ModelDifference[]): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!numbersClose(a, b)) out.push({ path, a, b, reason: 'number outside tolerance' });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path, a: a.length, b: b.length, reason: 'array length' });
      return;
    }
    a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`, out));
    return;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join('\u0000') !== kb.join('\u0000')) {
      out.push({ path, a: ka, b: kb, reason: 'keys or key order' });
      return;
    }
    for (const k of ka) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  if (a !== b) out.push({ path, a, b, reason: 'value' });
}

// Every difference between the two models (an empty list means they agree).
export function compareModels(a: SoundModel, b: SoundModel): ModelDifference[] {
  const out: ModelDifference[] = [];
  walk(a, b, '$', out);
  // classifyVector of every example vector of `a` gives the same kind, label and nearest id with both models.
  if (out.length === 0) {
    a.examples.forEach((e, i) => {
      const ra = classifyVector(a, e.v);
      const rb = classifyVector(b, e.v);
      const label = (r: typeof ra): string | null => (r.kind === 'match' ? r.label : null);
      if (ra.kind !== rb.kind || label(ra) !== label(rb) || ra.nearest.id !== rb.nearest.id) {
        out.push({ path: `$.examples[${i}]`, a: { kind: ra.kind, label: label(ra), nearest: ra.nearest.id }, b: { kind: rb.kind, label: label(rb), nearest: rb.nearest.id }, reason: 'classifyVector result' });
      }
    });
  }
  return out;
}

export function describeDifferences(d: ModelDifference[]): string {
  if (d.length === 0) return '';
  const first = d[0];
  return `${d.length} difference(s), first at ${first.path}: ${JSON.stringify(first.a)} vs ${JSON.stringify(first.b)} (${first.reason})`;
}
