# Requirements: Task 32b, background recording of a set length

## Introduction
The new apps need a 30 s background recording that ends on its own. Today the teach dialog enforces only a 10 s minimum and waits for Done. The addition is optional. A call without it behaves exactly as before.

## Requirements
1. `TeachOptions.backgroundMs?: number`, used only when the label is `background`. For any other label it is ignored.
2. Allowed range: `WEB_TEACH_BACKGROUND_RECORD_MS` (10000 ms) to `WEB_TEACH_MAX_RECORDING_MS` (120000 ms), both included. A value outside it, or not a finite number, makes `teach()` reject with a `RangeError` whose message names both limits. No dialog opens.
3. With `backgroundMs`, the dialog shows the remaining seconds (rounded up, down to 0) and Done is hidden. The recording ends by itself when its time reaches `backgroundMs`, then continues exactly as after Done (training, review, Save). Cancel and Esc still work.
4. The time is the recorder time `t` in s (cumulative samples divided by the sample rate), never a page timer.
5. No new export name. `check:public-api` does not change: it scans apps and cases for forbidden imports.
6. Docs: one line in the README, one row in `docs/kiro.md`, one line in `docs/devlog.md` dated 2026-11-22.
7. Out of scope: `apps/`, `site-src/`, `docs/_planning/`, a length for `hum`, any audio sent anywhere.
