# Task 38: setDebug and the "Under the hood" toggle

Goal: a judge who opens Click Talk or Shoo! can see, on the app's own screen, what Tokk hears and how little code wires it.

Source: plan 6 (`docs/_planning/tokk/plans/2026-11-24-tokk-versatility.md`, Task 38). Plan 6 allows exactly one debug control on the main screen of each app, and it is off by default. The Global Constraints of plan 5 otherwise apply: English only, apps import only from `'tokk'`, no external requests, audio never leaves the device.

## Requirements

### R1. `ears.setDebug(on)`
1. `Ears` has `setDebug(on: boolean): void`.
2. `setDebug(true)` mounts the same debug overlay that `listen({ debug: true })` mounts. `setDebug(false)` removes it with `destroy()`.
3. After `setDebug(true)` the overlay gets envelopes, segment reports and matches exactly as with `debug: true`, including its state (listening, paused, teaching) and its colours from the current model.
4. `setDebug` with the current value does nothing: no second host element, no second mount, no destroy.
5. On a stopped or failed Ears (after `stop()` or `onError`) it does nothing.
6. `stop()` still removes the overlay.
7. `listen({ debug: true })` works as before. After `setDebug(false)`, a later Save or import of a model must not mount the overlay again.
8. The type is in `web/index.ts` through `Ears`, in the type check `test/web-unit/public-api-types.ts`, and the README API section has one line for it.

### R2. "Under the hood" button in both apps
1. Click Talk and Shoo! each have a button "Under the hood" with `aria-pressed`, in the corner next to the settings control.
2. Pressing it calls `ears.setDebug(!current)` and flips `aria-pressed`.
3. The query `?debug=1` starts with it on. The state is not stored (no localStorage, no cookie).
4. It also works in keys mode: the overlay shows the injected sounds.
5. It looks like the app's other corner controls and does not cover the board or the path.
6. The state belongs to the app, so a new Ears (reconnect, keys fallback) starts with the same state.
7. The setDebug call is inside the `tokk:start` / `tokk:end` markers.

### R3. "Built with Tokk" link in both apps
1. A small link in a screen corner, text `Built with Tokk · N lines`, where N is the app's line count from `scripts/count-wiring.ts`.
2. `href` is `https://github.com/subniin/tokk/blob/main/apps/<app>/src/main.ts#L<a>-L<b>`, where a and b are the line numbers of the `// tokk:start` and `// tokk:end` lines of that file.
3. `target="_blank"` and `rel="noopener"`.
4. A Node test reads `main.ts`, runs the counter and fails if the link text or the line range of the page does not match.

### R4. Tests
1. Node unit tests for R1 with a fake Worker and a fake overlay: mount, remove, same value twice, after `stop()`, after failure, the overlay receives messages, no remount after `setDebug(false)`.
2. Browser tests for R1 on the real overlay: host present or absent, the same host after a repeat call, nothing after `stop()`.
3. Browser tests per app: the button toggles the overlay host, `aria-pressed` follows, `?debug=1` starts on, keys mode works, the link has the right text and href.

### R5. Documents
1. `docs/integration.md`, `README.md` and `site-src` say the line numbers of these apps from `npm run count:wiring`.
2. One devlog line dated 2026-11-24.

## Rules
- `privacy`: no audio over the network; the overlay shows envelopes only.
- `units`: no new hard-coded sample count. No new threshold or time constant is needed.
