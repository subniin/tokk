# Design: Task 1, Repository scaffold and WAV I/O

## Layer rule
- `core/`: pure TypeScript. No `fs`, `path`, DOM, or Web Audio imports. No runtime dependencies.
- `node/`: the only place for file I/O (`fs/promises`).
- `web/`: browser code, added in a later plan.
- All durations and thresholds are in ms, Hz, or dB. No hard-coded sample counts.

## Interfaces
```ts
// core/wav.ts
readWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array }
writeWav(samples: Float32Array, sampleRate: number): Uint8Array   // 16-bit PCM mono

// node/files.ts
readWavFile(path: string): Promise<{ sampleRate: number; samples: Float32Array }>
writeWavFile(path: string, samples: Float32Array, sampleRate: number): Promise<void>
```

`readWav` algorithm:
1. Check `RIFF` and `WAVE` headers.
2. Walk chunks (4-byte id, 4-byte little-endian size, pad to even size). Record `fmt ` and `data`, skip all others.
3. Accept only `audioFormat = 1` and `bitsPerSample = 16`. Otherwise throw `Error` with a message containing `16-bit PCM`, naming the actual format found.
4. Read `data` as little-endian Int16, divide by 32768. If `channels >= 2`, average the channels per frame.
5. A zero-length `data` chunk returns an empty array.

## Shared types (`core/types.ts`)
```ts
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
```
`t` is in seconds from the start of input.

## `core/constants.ts` layout
Named exports only, grouped by section with a comment header. Values are the plan defaults; only this file changes after experiments.

| Section | Exports (value) |
|---|---|
| Engine | `SAMPLE_RATE_MIN_HZ` (16000), `SAMPLE_RATE_MAX_HZ` (96000) |
| Segmenter | `SEGMENT_HOP_MS` (5), `LEVEL_WINDOW_MS` (10), `SILENCE_LEVEL_DBFS` (-90), `NOISE_FLOOR_INITIAL_DBFS` (-70), `NOISE_FLOOR_MIN_DBFS` (-90), `NOISE_FLOOR_RISE_TIME_CONSTANT_MS` (1000), `ONSET_ABOVE_FLOOR_DB` (12), `ONSET_MIN_LEVEL_DBFS` (-60), `ONSET_RISE_DB` (6), `ONSET_MIN_GAP_MS` (80), `ONSET_LEAD_MS` (5), `REONSET_MIN_SEGMENT_AGE_MS` (80), `OFFSET_ABOVE_FLOOR_DB` (6), `OFFSET_HOLD_MS` (30), `SEGMENT_MAX_MS` (1500) |
| Features | `FEATURE_LENGTH` (32), `FEATURE_FRAME_MIN_MS` (20), `FEATURE_HOP_MS` (10), `MEL_FILTER_COUNT` (26), `MEL_MIN_HZ` (100), `MEL_MAX_HZ` (8000), `MEL_MAX_NYQUIST_FRACTION` (0.45), `MFCC_COUNT` (13), `DECAY_DROP_DB` (20), `BAND_EDGES_HZ` ([500, 2000, 5000]) |
| Classifier | `KNN_K` (3), `DISTANCE_THRESHOLD_FACTOR` (1.5), `THRESHOLD_PERCENTILE` (95), `MIN_EXAMPLES_PER_LABEL` (5), `RECOMMENDED_EXAMPLES_PER_LABEL` (10), `STD_FLOOR_RANGE_FRACTION` (0.05), `STD_FLOOR_ABSOLUTE` (0.01) |
| Teaching | `BACKGROUND_WINDOW_MS` (300), `BACKGROUND_WINDOW_OVERLAP_PERCENT` (50), `BACKGROUND_MAX_EXAMPLES` (200) |
| Pitch | `PITCH_ANALYSIS_RATE_HZ` (8000), `PITCH_LOWPASS_HZ` (3400), `YIN_WINDOW_MS` (40), `PITCH_HOP_MS` (10), `YIN_THRESHOLD` (0.15), `PITCH_MIN_HZ` (80), `PITCH_MAX_HZ` (400), `PITCH_HIGH_BAND_MIN_HZ` (1000), `PITCH_HIGH_ENERGY_RATIO_MAX` (0.2), `PITCH_MIN_LEVEL_DBFS` (-50), `HUM_START_VOICED_MS` (120), `HUM_END_UNVOICED_MS` (60) |
| Grammar | `GAP_CONSECUTIVE_MAX_MS` (350, exclusive), `GAP_REST_MAX_MS` (1000, inclusive), `HUM_DEADZONE_SEMITONES` (2), `HUM_SPEED_MAX_SEMITONES` (6) |
| Synthesis | `SYNTH_FADE_OUT_MS` (10), `SYNTH_MAX_DURATION_MS` (400) |
| Scoring | `MATCH_TOLERANCE_MS` (50), `REGRESSION_RECALL_DROP` (0.02), `REGRESSION_MIN_TRUTHS` (50), `REGRESSION_TP_DROP_COUNT` (2) |
| Spectrogram | `SPECTROGRAM_FFT_SIZE` (1024), `SPECTROGRAM_HOP_MS` (10), `SPECTROGRAM_MAX_HZ` (8000), `SPECTROGRAM_HEIGHT_PX` (256), `SPECTROGRAM_FLOOR_DBFS` (-90) |

Not constants: `BACKGROUND` (reserved label, exported from `core/classify/knn.ts`) and `SYNTH_CLASSES` (in `core/synth.ts`).

## File layout (created by Task 1)
```
tokk/
├─ core/ types.ts  constants.ts  wav.ts
├─ node/ files.ts
├─ test/ wav.test.ts
├─ docs/ devlog.md
├─ .kiro/ specs/task-01-wav/  steering/.gitkeep
├─ LICENSE  README.md  package.json  tsconfig.json  vitest.config.ts  .gitignore
```
Later tasks add the rest of the plan's tree (`dsp/`, `segment.ts`, `engine.ts`, and so on).

## Testing
`test/wav.test.ts` (vitest) builds WAV bytes in the test: 16-bit mono and stereo, 24-bit, 32-bit float, 8-bit, an extra `LIST` chunk, and a zero-sample file. It checks error messages with `/16-bit PCM/`.
