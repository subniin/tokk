// The envelope history and the ribbons (design.md "The ectoplasm", requirement 9). Pure: times come in as arguments.
// The history keeps one number per bin (the peak of the bin) for ECTO_HISTORY_MS. The envelope arrays are only read,
// never kept, stored or sent.
import {
  ECTO_DRIFT_PERIOD_MS, ECTO_HISTORY_MS, ECTO_IDLE_LEVEL, ECTO_IDLE_MS, ECTO_LAYER_COUNT, ECTO_LEVEL_GAIN, ECTO_POINT_SPACING_PX,
  ECTO_RIBBON_HEIGHT_FRACTION, ECTO_SETTLE_MS,
} from './constants';

export interface EnvelopeLike { t0: number; binMs: number; min: ArrayLike<number>; max: ArrayLike<number> }
export interface History { binMs: number; capacity: number; levels: readonly number[] }
export interface Point { x: number; y: number }

const TWO_PI = 2 * Math.PI;
const WAVES_PER_WIDTH = [1.5, 2.3, 3.1];          // slow sine waves across the canvas, one per layer
const LAYER_PHASE = [0, 2.1, 4.2];                // radians between the layers
const STILL_PHASE_MS = [1300, 4700, 7100];        // fixed drift phases of the still ribbon (a fixed seed)
const STILL_LEVEL = 0.12;                         // the calm height of the still ribbon, a fraction of full scale

export function createHistory(binMs: number): History {
  return { binMs, capacity: Math.max(1, Math.round(ECTO_HISTORY_MS / binMs)), levels: [] };
}

// A new history with the bins of the envelope appended (the larger of |min| and |max|, clamped to 1) and the oldest dropped.
export function fold(history: History, env: EnvelopeLike): History {
  const added: number[] = [];
  const n = Math.min(env.min.length, env.max.length);
  for (let i = 0; i < n; i++) added.push(Math.min(1, Math.max(Math.abs(env.min[i]), Math.abs(env.max[i]))));
  const all = [...history.levels, ...added];
  return { ...history, levels: all.length > history.capacity ? all.slice(all.length - history.capacity) : all };
}

// The largest peak of the newest bins that cover windowMs.
export function levelOf(history: History, windowMs: number): number {
  const bins = Math.max(1, Math.ceil(windowMs / history.binMs));
  const recent = history.levels.slice(-bins);
  return recent.length === 0 ? 0 : Math.max(...recent);
}

// 0 while envelopes arrive, rising to 1 over ECTO_SETTLE_MS once none came for ECTO_IDLE_MS.
export function settleFactor(sinceEnvelopeMs: number): number {
  if (!(sinceEnvelopeMs > ECTO_IDLE_MS)) return 0;
  return Math.min(1, (sinceEnvelopeMs - ECTO_IDLE_MS) / ECTO_SETTLE_MS);
}

// A level eased toward the idle level by the settle factor.
export function shownLevel(level: number, settle: number): number {
  return level * (1 - settle) + ECTO_IDLE_LEVEL * settle;
}

const layerOf = (layer: number): number => ((layer % ECTO_LAYER_COUNT) + ECTO_LAYER_COUNT) % ECTO_LAYER_COUNT;

// The points of one ribbon: a slow sine across the canvas whose height at a column is the history level of that column.
function ribbon(width: number, height: number, phaseMs: number, layer: number, levelAt: (fraction: number) => number): Point[] {
  const l = layerOf(layer);
  const count = Math.max(2, Math.floor(width / ECTO_POINT_SPACING_PX) + 1);
  const mid = height / 2;
  const maxSwing = height * ECTO_RIBBON_HEIGHT_FRACTION;
  const drift = (TWO_PI * phaseMs) / ECTO_DRIFT_PERIOD_MS;
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const amp = Math.min(1, levelAt(f) * ECTO_LEVEL_GAIN + ECTO_IDLE_LEVEL) * maxSwing;
    const y = mid + amp * Math.sin(TWO_PI * WAVES_PER_WIDTH[l] * f + drift * (1 + l * 0.3) + LAYER_PHASE[l]);
    points.push({ x: f * width, y: Math.min(height, Math.max(0, y)) });
  }
  return points;
}

// The ribbon of a layer from the history: the oldest bin on the left, the newest on the right.
export function ribbonPoints(history: History, width: number, height: number, phaseMs: number, layer: number, settle: number): Point[] {
  const lv = history.levels;
  return ribbon(width, height, phaseMs, layer, (f) => {
    const raw = lv.length === 0 ? 0 : lv[Math.min(lv.length - 1, Math.floor(f * lv.length))];
    return shownLevel(raw, settle) - ECTO_IDLE_LEVEL * settle;
  });
}

// The fixed, calm ribbon of reduced motion: the same on every call, independent of any envelope.
export function stillRibbonPoints(width: number, height: number, layer: number): Point[] {
  return ribbon(width, height, STILL_PHASE_MS[layerOf(layer)], layer, () => STILL_LEVEL / ECTO_LEVEL_GAIN);
}
