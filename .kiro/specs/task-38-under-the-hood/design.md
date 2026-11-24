# Design: Task 38

## `web/listen.ts`
- A variable `debugOn`, set from `opts.debug === true` at the start, replaces the two reads of `opts.debug` (the mount at start and the remount in `adopt`). So `setDebug(false)` also stops the remount after a Save or an import.
- `mountCurrent()` is the existing `tryMount(contextRate)` followed by the state the Ears has now: `paused` (if paused), `teaching` (if recording), else `listening`.
- `setDebug(on)`:
  ```
  if (closed || on === debugOn) return;
  debugOn = on;
  if (on) { overlay = tryMount(contextRate); apply state } else { overlay?.destroy(); overlay = null; }
  ```
  `closed` is set by `stop()` and by a failure (`fail`), so both cases do nothing.
- The overlay needs the sample rate. `contextRate` is set for the microphone, a WAV and keys mode alike, before any message is routed.
- `stop()` already calls `overlay?.destroy()` in `teardown`.

## Apps
- State: `app.debug` (a boolean in the app object, outside the markers). It starts from `new URLSearchParams(location.search).get('debug') === '1'`. It is not stored.
- Wiring (inside the markers): `listen({ ..., debug: app.debug() })` through the `Glue` (`debug(): boolean`), so a new Ears starts with the state. `port.setDebug = (on) => ears?.setDebug(on)`.
- The button handler: `app.debug = !app.debug; port.setDebug(app.debug); sync aria-pressed`.
- Click Talk: button in `.status`, before the Settings button. Same visual style (`settings-btn`); visible on the same screens as the top bar. Shoo!: button in `.corner` of the HUD, class `link`, like Pause and Settings.
- Link: Click Talk in the footer corner of the top bar region is not free of the board, so the link goes in the page's last line (`<a class="built">` fixed to the bottom-left corner, small, with a background so it stays readable). Shoo!: fixed bottom-left corner of the stage, below the path and the porch.
- The link text and href are static in `index.html` (no code runs for them). The Node test `test/under-the-hood-link.test.ts` computes both from `main.ts` with `countWiring` and the marker lines and compares them to the `index.html` of each app.

## Why no stored state, no new constants
The toggle is a view of the current Ears, so it is a boolean on the page. There is no time or sample constant.
