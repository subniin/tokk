# Devlog

## 2026-11-19

The project scaffold and WAV I/O were built with Kiro CLI from spec `task-01-wav` (`.kiro/specs/task-01-wav/`). The work covers the npm package, TypeScript and Vitest setup, shared types and constants, `core/wav.ts`, and `node/files.ts`.

Task 2 added deterministic test sounds in `core/synth.ts` (seeded `rng`, impacts, tones, noise, `place`, `SYNTH_CLASSES`) from spec `task-02-synth` (`.kiro/specs/task-02-synth/`), with tests in `test/synth.test.ts`.

Task 3 added the FFT, mel filterbank, MFCC and 32-value segment features in `core/dsp/fft.ts`, `core/dsp/mfcc.ts` and `core/features.ts` from spec `task-03-features` (`.kiro/specs/task-03-features/`), with tests in `test/features.test.ts`. Decision: the analysis window is exactly 20 ms at every rate and is zero-padded into an FFT of 2x the window (1024, 2048, 2048, 4096 samples), because a window rounded up to a power of two was 23.2 ms at 44.1 kHz and 21.3 ms at 48 kHz, which broke the 5% rate check.
