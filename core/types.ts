export interface Segment { t: number; durationMs: number; samples: Float32Array; sampleRate: number }

export type SoundEvent =
  | { kind: 'sound'; label: string; t: number; durationMs: number; confidence: number }
  | { kind: 'continuous'; name: 'pitch'; t: number; value: number; phase: 'start' | 'update' | 'end' };

export interface SoundModel {
  version: 1;
  k: number;
  sampleRate: number;
  mean: number[];
  std: number[];
  examples: { id: string; label: string; v: number[] }[];   // id = "<label>/<file>#<segment index>"
  thresholds: Record<string, number>;
  pitch?: { baselineHz: number };
}

export interface Nearest { id: string; label: string; distance: number }

export type ClassifyResult =
  | { kind: 'match'; label: string; confidence: number; nearest: Nearest }
  | { kind: 'unknown'; nearest: Nearest };

export interface Classifier {
  train(examples: { id: string; label: string; segment: Segment }[]): SoundModel;
  classify(model: SoundModel, s: Segment): ClassifyResult;
}

export interface MatchEvent { pattern: string; t: number; speed?: number }
