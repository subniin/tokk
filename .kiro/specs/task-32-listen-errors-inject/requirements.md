# Requirements: Task 32, onError, inject and keys mode

## Introduction
The two new apps (Click Talk, Shoo!) need three things the template lacks. They must learn when the microphone is lost, so they can show a "Reconnect" card. They need a keyboard fallback that follows the same pattern grammar as the microphone (rests, held-back long patterns, `modes`). They must also keep working when the microphone cannot start. All additions are optional. A call that uses none of them behaves exactly as before.

## Requirements
1. `Engine.inject(label)` (core) feeds `{ kind: 'sound', label, t: <current engine time>, durationMs: 0, confidence: 1 }` into the matcher and skips the classifier. The same event goes to `onEvent`. It returns the matches made at once; handlers are called as for any other event.
2. `inject('')` and `inject('background')` throw `RangeError`. `core/` stays pure.
3. `Ears.inject(label)` (web) does the same through the Worker message `{ type: 'inject'; label: string }`. It is ignored while paused (as the microphone is) and while a teach dialog is open. It throws the same `RangeError` on the main thread.
4. `ListenOptions.onError?: (error: TokkError) => void`. `TokkError extends Error` with `kind: 'mic-ended' | 'worker' | 'audio-closed'`. `message` says how to fix it.
   - `mic-ended`: an audio track of the microphone stream fires `ended`.
   - `worker`: the Worker fires `onerror` after a successful start.
   - `audio-closed`: the AudioContext reaches `closed` without a call to `stop()`.
5. After `onError` fires, that `Ears` is finished as after `stop()` (resources released, no handler runs, `stop()` still resolves). `onError` fires once. The template does not reconnect; the app calls `listen()` again.
6. An AudioContext that is only `suspended` is not an error. The template calls `resume()` on the next `pointerdown` or `keydown`.
7. An exception thrown inside `onError` is logged with `console.error` and never rethrown.
8. Without `onError`, nothing changes: no listener is added, a Worker error is only logged.
9. `ListenOptions.source: 'keys'`: no microphone, no `getUserMedia`, no `AudioContext`. A page timer sends 20 ms chunks of silence so the engine clock and pattern timing run. Sounds come only from `ears.inject`. `ears.teach()` rejects with `Error("No microphone in keys mode. Teach sounds with the microphone, then use keys as a fallback.")`.
10. The only new export name is the type `TokkError`. No runtime export is added. `check:public-api` expectations do not change, because they scan apps and cases for forbidden imports. `test/web-unit/public-api-types.ts` gets compile-time checks for the new members.
11. Docs: one short README example of `onError` and `source: 'keys'`, one row in `docs/kiro.md`, one line in `docs/devlog.md` dated 2026-11-22.
12. Out of scope: apps, cases, `docs/_planning/`, reconnecting, any audio sent anywhere.
