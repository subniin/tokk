# Devlog

## 2026-11-19

The project scaffold and WAV I/O were built with Kiro CLI from spec `task-01-wav` (`.kiro/specs/task-01-wav/`). The work covers the npm package, TypeScript and Vitest setup, shared types and constants, `core/wav.ts`, and `node/files.ts`.

Task 2 added deterministic test sounds in `core/synth.ts` (seeded `rng`, impacts, tones, noise, `place`, `SYNTH_CLASSES`) from spec `task-02-synth` (`.kiro/specs/task-02-synth/`), with tests in `test/synth.test.ts`.
