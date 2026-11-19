# Design: Task 2, Deterministic sound synthesis for tests

## Layer rule
`core/synth.ts` is pure TypeScript. No `fs`, `path`, DOM, or Web Audio. No dependencies. No `Math.random`. All times are in ms and all levels in dB; sample counts are computed from the sample rate, never hard-coded.

## Interfaces
```ts
// core/synth.ts
export interface ImpactParams { centerHz: number; bandwidthHz: number; decayMs: number; durationMs: number; gainDb: number }
export interface ToneParams { f0Hz: number; durationMs: number; gainDb: number; vibratoCents?: number; glideToHz?: number }

export function rng(seed: number): () => number                       // mulberry32, [0, 1)
export function synthImpact(p: ImpactParams, sampleRate: number, rand: () => number): Float32Array
export function synthTone(p: ToneParams, sampleRate: number): Float32Array
export function synthNoise(kind: 'white' | 'pink', durationMs: number, gainDb: number, sampleRate: number, rand: () => number): Float32Array
export function place(clips: { atMs: number; samples: Float32Array }[], totalMs: number, sampleRate: number): Float32Array
export const SYNTH_CLASSES: Record<'low' | 'mid' | 'high' | 'ring', Omit<ImpactParams, 'gainDb'>>
```
`SYNTH_CLASSES` entries hold the four fields that define a class. Callers add a level: `{ ...SYNTH_CLASSES.low, gainDb: -6 }`. The entries are built at module load from `centerHz` and `decayMs` using the constants below, so bandwidth and duration cannot drift from the plan:
- `bandwidthHz = centerHz x SYNTH_BANDWIDTH_FRACTION`
- `durationMs = min(decayMs x SYNTH_DURATION_DECAY_MULTIPLE, SYNTH_MAX_DURATION_MS)`

| Class | centerHz | decayMs | bandwidthHz | durationMs |
|---|---|---|---|---|
| low | 300 | 120 | 150 | 360 |
| mid | 1200 | 60 | 600 | 180 |
| high | 3500 | 25 | 1750 | 75 |
| ring | 2000 | 200 | 1000 | 400 (3 x 200 = 600 is capped) |

Because `ring` is capped, its level at `3 x decayMs` is never reached (at 400 ms it is `exp(-2)`, about -17 dB). The "20 dB below peak" test therefore uses `low`, `mid` and `high`, where `durationMs` is at least 3 x `decayMs`.

## Constants
Task 1 already defines `SYNTH_FADE_OUT_MS` (10) and `SYNTH_MAX_DURATION_MS` (400). This task adds four named exports to the "Synthesis" section of `core/constants.ts`:

| Export | Value | Meaning |
|---|---|---|
| `SYNTH_BANDWIDTH_FRACTION` | 0.5 | Impact bandwidth as a fraction of `centerHz` |
| `SYNTH_DURATION_DECAY_MULTIPLE` | 3 | Class duration is this many decay constants, before the cap |
| `SYNTH_TONE_HARMONICS` | 3 | Harmonics above the fundamental (amplitude 1/n for harmonic n = 2..4) |
| `SYNTH_VIBRATO_RATE_HZ` | 5 | Rate of the vibrato modulation |

These have no unit in the name because they are a fraction, a multiple, and a count. `SYNTH_VIBRATO_RATE_HZ` has one.

## Shared rules
- Length: `n = round(durationMs x sampleRate / 1000)`. Time of sample `i` is `i / sampleRate` seconds; `t / decayMs` uses `t` in ms.
- Random consumption: noise generators call `rand()` exactly once per output sample, in index order. A test that reuses one `rng` for several clips gets reproducible results.
- Level convention: `gainDb` is in dB relative to full scale 1.0. Values above 0 are allowed (P1 uses +6 dB, a peak of about 2.0) and nothing is clamped. Clipping happens only when a test writes the audio to a 16-bit WAV.
- Peak scaling: for impacts and tones, compute the result including the fade-out, then multiply so that `max|x| = 10^(gainDb/20)`. If the peak is 0, return the zeros without dividing.
- RMS scaling: for noise, multiply so that the RMS over the whole clip is `10^(gainDb/20)`. RMS is the natural unit for P1 (SNR) and P2 (noise level), and the segmenter measures RMS.
- Input checks throw `RangeError` naming the parameter: durations, decay, bandwidth and sample rate must be positive and finite, and `centerHz` and `f0Hz` must be below `sampleRate / 2`. This is an assumption beyond the plan, kept small so that a bad test setup does not produce silent NaN audio.

## `rng`: mulberry32
State is a 32-bit unsigned integer initialised from `seed >>> 0`. Each call advances the state by `0x6D2B79F5`, mixes it with the two multiply-xorshift steps of mulberry32, and returns the result divided by 2^32. This gives [0, 1), is fast, and is identical in Node and browsers because it uses only 32-bit integer operations (`Math.imul`).

## `synthImpact`: band-limited noise
Method chosen: **white noise through a 2nd-order band-pass biquad**, then the envelope, then the fade-out, then peak scaling.
1. White input: `x[i] = 2 x rand() - 1` (uniform, one call per sample).
2. Band-pass: RBJ cookbook "constant 0 dB peak gain" band-pass at `centerHz` with `Q = centerHz / bandwidthHz` (Q = 2 for the four classes). Direct form I, state starts at zero.
3. Envelope: multiply sample `i` by `exp(-(i / sampleRate x 1000) / decayMs)`.
4. Fade-out and peak scaling as in the shared rules.

Why this method:
- It is one pass in the time domain with O(1) state per sample. The alternative, an FFT mask on a whole noise buffer, needs the FFT from Task 3 and a power-of-two buffer, and `core/synth.ts` must not depend on later tasks.
- The biquad is defined by `centerHz` and `bandwidthHz` in Hz, so the same call at 16 kHz, 44.1 kHz, 48 kHz and 96 kHz has the same analog shape. The plan forbids fixed sample counts, and this method has none.
- A 2nd-order filter has gentle skirts. That is fine here: the classes need to differ in centroid, decay and attack, not in sharp band edges, and gentle skirts look more like a real knock.
- The filter ring-up at the start adds a short attack (about 1 ms at 300 Hz, less at higher centers). The attack feature in Task 3 sees different attacks for different classes, which helps separate them.

Known limit: with `centerHz` close to Nyquist the biquad shape warps. The `centerHz < sampleRate / 2` check keeps it defined, and the classes stay below 3500 Hz, well under Nyquist at 16 kHz (8000 Hz).

## `synthTone`
Phase is accumulated per sample, not computed as `f x t`, so vibrato and glide do not create phase jumps.
1. Base frequency at sample `i`: `f0Hz`, or `f0Hz + (glideToHz - f0Hz) x i / (n - 1)` when `glideToHz` is given.
2. Vibrato: multiply the base frequency by `2^(vibratoCents x sin(2 pi x SYNTH_VIBRATO_RATE_HZ x t) / 1200)`.
3. `phase += 2 pi x f / sampleRate`.
4. `x[i] = sum over h = 1..(1 + SYNTH_TONE_HARMONICS) of sin(h x phase) / h`. A harmonic whose frequency `h x f` is at or above Nyquist is left out for that sample.
5. Fade-out and peak scaling as in the shared rules.

The spectrum is a low-frequency fundamental with decaying harmonics (a sustained, voiced sound). It is the opposite of an impact: no decay envelope, strong periodicity. That is why P7 can expect the impact-only model to call it `unknown`. Start phase is 0, so the output is deterministic without a random function.

## `synthNoise`
- White: `x[i] = 2 x rand() - 1`.
- Pink: Paul Kellet's refined filter (seven one-pole states plus a delayed white term) applied to the same white input. It is a few multiplies per sample, uses one `rand()` per sample, and holds -3 dB per octave to within about 0.5 dB over most of the audio band. Voss-McCartney was the alternative. Kellet is chosen because it needs no counters or per-row random draws, so the "one `rand()` per sample" rule holds, and the filter is easy to test.
- Limit: Kellet's coefficients are tuned near 44.1 kHz. At 16 kHz and 96 kHz the slope is close but not exact. This is acceptable because P2 only needs noise with no onset structure, and the pink test checks a 2 dB tolerance at 44.1 kHz and 48 kHz.
- The first few hundred samples carry the filter start-up. The tests that need steady noise (P2) already skip the first second.
- Scale to RMS `gainDb` after generating the whole clip.

## `place`
Allocate `round(totalMs x sampleRate / 1000)` zeros. For each clip compute `start = round(atMs x sampleRate / 1000)` and add `min(clip.length, total - start)` samples. A clip that starts at or past the end adds nothing. Negative `atMs` throws `RangeError`.

## File layout (created by Task 2)
```
core/ synth.ts          (new)
core/ constants.ts      (edited: 4 new exports in the Synthesis section)
test/ synth.test.ts     (new)
.kiro/specs/task-02-synth/
```

## Testing
`test/synth.test.ts` (vitest). No FFT exists before Task 3, so spectral checks compute a few DFT bins directly:
- Tone: bins at `f0Hz`, and at `f0Hz` plus/minus 20 Hz and 100 Hz, to show the peak is at `f0Hz` within 5 Hz.
- Pink and white: band energies from DFT bins at a few center frequencies over a long clip.
- Peak and RMS: computed directly from samples.

Planned tests:
- Same seed gives identical output for impact, white noise and pink noise; different seeds differ.
- `rng` first values for a fixed seed match a recorded list (guards against changing the generator).
- Impact peak level matches `gainDb` within 1 dB for several gains (-20, 0, +6).
- Impact energy at `3 x decayMs` is at least 20 dB below peak for `low`, `mid`, `high`.
- Tone strongest bin at `f0Hz` within 5 Hz; harmonics at 2 x, 3 x, 4 x have amplitudes near 1/2, 1/3, 1/4.
- `place` puts a clip at `atMs` (first non-zero sample index), sums overlaps, cuts at the end, rejects negative `atMs`.
- The last 10 ms of a 400 ms `ring` impact fade to 0 (last sample is exactly 0, fade region is non-increasing in magnitude envelope).
- `SYNTH_CLASSES` values: bandwidth is 50% of center and duration is `min(3 x decay, 400)`.
- Sample counts at 16000, 44100, 48000 and 96000 Hz equal `round(durationMs x rate / 1000)`.
- `RangeError` for bad parameters.
