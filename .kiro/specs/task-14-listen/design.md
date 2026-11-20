# Design: Task 14, microphone, Worker and `listen()`

## Layout
```
web/constants.ts          WEB_CHUNK_MS, WEB_RESUME_TIMEOUT_MS, WEB_ENVELOPE_RESOLUTION_MS
web/protocol.ts           message types, createWorkerState, handleWorkerMessage, transferListOf, ms-to-samples helper
web/worker.ts             Worker entry: calls handleWorkerMessage, posts results, attaches the connected port
web/worklet-source.ts     the processor as a string (copy 128-frame blocks into chunks, post, nothing else)
web/mic.ts                openMic
web/listen.ts             listen(), Ears, WAV pacing, message routing
web/index.ts              + listen, Ears and option types
core/engine.ts            the sample-rate check gets an `export` (not in core/index.ts)
playwright.config.ts      Chrome channel, fake-mic arguments, webServer = npm run dev
tsconfig.test-web.json    web + core + specs, Node types
test/protocol.test.ts     vitest, Node, no DOM
test/worklet.test.ts      vitest, node:vm
test/web-unit/mic.test.ts vitest with stubbed browser globals (DOM-typed module, so outside the base tsc)
test/web/                 listen.html, listen.spec.ts, global-setup.ts, fixture.ts, instrument.ts, generated/ (ignored)
.kiro/hooks/web-smoke.json
```

## Data flow
```
getUserMedia ──► MediaStreamSource ──► AudioWorkletNode (tokk-capture)
                                         │  chunk {samples}, transferred, every WEB_CHUNK_MS
                                         ▼  MessageChannel port (not through the main thread)
page ── init, connect, setMode, replaceSounds, flush ──► Worker ── handleWorkerMessage ── createEngine
 ▲                                                         │
 └──── match {pattern, event}, event {e}, envelope, error ◄┘

WAV source: page fetches the file, readWav, posts the same `chunk` messages to the Worker itself, at real-time pace.
```
Handlers live on the page. The Worker holds no function and sends pattern names.

## Decisions

### Context first, then the microphone (a change of order)
The request lists `getUserMedia` before `AudioContext`. `openMic` creates the context first, synchronously, inside the click handler, for two reasons. (1) Safari ties audio start to a transient user activation, which lasts a few seconds, while a real permission prompt can take longer. (2) The sample rate is known right after the context exists, so an unsupported rate (a Bluetooth headset at 8000 Hz) rejects with the `RangeError` before the browser asks for permission. The cost is that every failure after the context exists must close it. This is in the cleanup requirement and in the mic unit tests. Chrome uses sticky activation, so the order does not matter for the Chrome tests.

### `connect` is a transport message
The plan's list has no way to give the Worker one end of the `MessageChannel`. A port can only reach a Worker inside a message, so `connect {port}` is added. `handleWorkerMessage` returns no messages for it. `worker.ts` attaches its handler to the port, which is the one thing in the entry besides the calls. Alternative rejected: carry the port inside `init`. That would make `init` impure (a port to attach) and block later reconnects.

### Worklet `pause` and `resume` live in the worklet
The worklet port goes straight to the Worker, so the main thread cannot drop chunks there. Options: (a) the worklet drops blocks while paused (a boolean, no computing); (b) the Worker gets `pause` messages (a new message type, and the chunks still cross the port while paused); (c) `track.enabled = false` (the engine then sees silence and its clock keeps running, which is not "keep the engine state"). Chosen: (a). The control messages use the node's own port (`node.port`), which is the main-thread link, and the data port is separate. A paused period leaves a gap in the audio, and a sound that was open at the pause joins the sound after resume. This is accepted and documented in the README task (Task 19), because a pause is a user choice. For a WAV source the same position is kept in the main thread timer, so there is no gap.

### Validation by a throwaway engine
The Worker would report an invalid option (`on` plus `modes`, an unknown mode, a bad pattern) as an `error` message, after `listen()` resolved. To reject early with the real error type, `listen()` builds one engine on the main thread with the same options and drops it. Cost: the allocation of one engine without pushing a sample (to be measured, expected small). The sample-rate check uses the same engine function, so the message cannot drift from the engine's. The protocol has no `ready` acknowledgement because of this.

### Exporting the engine's sample-rate check
`mic.ts` needs the engine's message without copying text. Options: (a) export the existing check from `core/engine.ts` (one keyword; `core/index.ts` and the public API do not change); (b) copy the message (can drift); (c) build a throwaway engine with the rate (heavy, and the rate error is raised only after other checks). Chosen: (a).

### Pause, resume, replaceSounds and times
`replaceSounds` creates a new engine, because `createEngine` takes the model once. The new engine counts samples from 0 again, so its event times restart at 0 and it needs its quiet calibration period again. The envelope counter lives in the state, outside the engine, so envelope times stay continuous. Task 16 decides what the user sees (a notice for 1 s). A `pause()` does not rebuild anything.

### Match dispatch after `setMode`
A `match` message carries the pattern name only (the plan's shape). A match that was already in flight when `setMode` ran is delivered to the new mode's handler if that mode has a pattern of the same name, and is ignored otherwise. A `mode` field on the message would remove this window. It is not added because the plan fixes the message. Noted as a known limit.

### Real-time pace of the WAV source
One timer, one position. Chunk i is due at the start time plus (cumulative samples before it divided by the rate), in milliseconds. On every tick the code sends every chunk that is due, then arms the timer for the next due time. A throttled tab (timers at 1 s) sends bursts and loses nothing, because the engine does not depend on chunk size (P3). Pause stores the position and, on resume, re-bases the start time, so the file continues where it stopped. The clock is used for pacing only. The times of events come from sample counts (rule: `t` is a cumulative sample count divided by the sample rate). The wav path creates no `AudioContext`, so it needs no gesture and the file's own rate is the engine rate.

### The HTTP server for the tests
The tests use the existing dev server (`npm run dev`) through `webServer`. It already serves the repository root, rebuilds `dist/tokk.js` on save, and is what a developer uses for Tasks 15 to 17. A separate test server would need its own build step and could drift from the dev setup. Costs: the port is shared with a developer's running server (`reuseExistingServer` is on, so a running one is used), and `scripts/build.ts` must export its port and host so the config does not repeat them. A page in `test/web/` is a static HTML file with an inline module, served as is; no TypeScript is compiled for pages.

### Fixture location
Generated files go to `test/web/generated/` (ignored). `dist/` is removed by the dev server at start and `test-results/` is cleaned by Playwright, so neither is a safe place. The folder sits below the served root, so the page can `fetch` the WAV and the model by URL.

### Where Playwright code is type-checked
The plan says `tsconfig.web.json` takes `test/web`. Specs and `playwright.config.ts` import `node:fs` and `node:path`, which need Node typings, and `tsconfig.web.json` has `types: []` on purpose, so that a Node import in `web/` fails. Giving the web config Node types would remove that guard. A third config, `tsconfig.test-web.json`, extends the web config and adds Node types for specs, the config and the DOM-typed vitest tests. The guard stays. The base `tsconfig.json` excludes `test/web` and `test/web-unit` because it has no DOM, and Task 13 already warned that a DOM-typed module reached through a test breaks it. Task 14 hits this once: `test/load-sounds.test.ts` imports `web/index.ts`, which now exports `listen` and brings DOM types. That test is changed (requirement 8.3).

## Protocol details

### State
The state holds: the engine or none, the sample rate, the modes (name to pattern list), the current mode, the stored sample rate for the envelope, the cumulative envelope sample count, the partial bin (running min, max and how many samples it has), and an output list that the engine callbacks append to during one call. `handleWorkerMessage` empties that list before it returns and returns the new list. That is the only "mutable output" and it never outlives a call.

### Order of outgoing messages
Within one `chunk` call the engine runs once, and its callbacks fire in engine order: `event` messages for pitch events, then for segment results, with each `match` after the event that completed it (handlers are called by the engine after the events of the same step, as in `runSamples`). The test compares the lists the way `runSamples` collects them (events, unknowns and matches separately), so it does not depend on the interleaving between kinds, only on the order inside each kind. The `envelope` message goes last.

### Envelope
Bin length in samples comes from the rate and `WEB_ENVELOPE_RESOLUTION_MS` through the one shared conversion (rounded to at least 1). At 48000 Hz this is a whole number; at 44100 Hz it is 441. A chunk of `WEB_CHUNK_MS` holds an exact number of bins only when the product divides, so the partial-bin state is needed and tested with chunk sizes that are not multiples. `flush` drops a trailing partial bin (less than one resolution step, not shown). `t0` is the cumulative number of samples before the first bin of the message divided by the rate.

### Errors
Everything that can throw is caught at one place in `handleWorkerMessage`, and the error becomes `{ type: 'error', message }` with the original error's message. For a failed `init`, the state keeps no engine, so later chunks answer with "send init first" errors. A flood of one error per chunk is acceptable for a failed session; `listen()` logs the first and may drop repeats of the same text.

### Transfer
`transferListOf(msg)` returns the `ArrayBuffer`s of `min` and `max` for an `envelope` and an empty list otherwise. `worker.ts` posts each message with that list, so a 100 Hz stream of small arrays does not copy.

## Microphone details (`openMic`)
Order inside the function: check `navigator.mediaDevices`; create the context (synchronously); read and check the rate; call `resume()` once if the context is `suspended` (this is inside the gesture, and its result is looked at later); `getUserMedia` or use the given stream; `createMediaStreamSource`; Blob URL, `addModule`, revoke; create the node (one input, zero outputs, one channel in; `processorOptions.chunkFrames`); `MessageChannel`; send one port to the node with `connect`; connect the source to the node; wait for `running` as in requirement 6.9; return the handle.

A node with no output is pulled by Chrome when its input is connected to a live source. The fake-microphone test proves it. If it does not (no chunks arrive), the fallback is to connect the node to a gain node of value 0 that goes to the destination, and the first task step records which was needed.

The browser resamples a stream to the context rate in Chrome. Firefox throws on a mismatch; that case is outside this task, and the error text would be Firefox's.

## `listen()` details
Steps: copy the options; validate by a throwaway engine; choose the source; build the session object (worker, optional mic handle, optional file pacer, handler sets, current mode); `init`; `connect` for the microphone; resolve with `Ears`. The session's one routing function receives every Worker message, and the cases are `match` (call the handler), `event` (nothing in this task), `envelope` (nothing in this task), `error` (log). Task 15 adds the overlay in that function and Task 16 adds recording replies. The `debug` option is read and ignored.

`stop()` sets a closed flag first, so a message that arrives while stopping calls no handler. Then: cancel the timer, `close()` the mic handle (stop tracks, disconnect, close the port, close the context), terminate the Worker and revoke its URL (`dispose`). A stream passed in by the caller has its tracks stopped too. The reason is privacy: a microphone indicator that stays on after `stop()` looks like a leak. The handbook text (Task 19) says so.

## Test design

### Fixture
Built in Node by `fixture.ts`, called from the global setup. Classes: the four synthetic impact classes. Teaching set: for each class one recording at 48000 Hz of `TRAIN_PER_CLASS` impacts through `makeSignal` with a noise bed at `SYNTH_FIXTURE_LEAD_NOISE_DBFS`, as `make-synth-fixtures` does at 16 kHz, plus a steady-noise `background` recording if `teachFromRecordings` requires one (the first task step checks). `teachFromRecordings` gives the model. The test WAV is: quiet lead, then one impact of each class at a fixed spacing, then a quiet tail, with the same noise bed.

Lead length: `NOISE_FLOOR_WARMUP_MS` + `SYNTH_FIXTURE_LEAD_MARGIN_MS` is the 1200 ms minimum. The microphone path loses the start of the capture while the context, the stream, the worklet module and the Worker start, and the engine needs its own 1000 ms of quiet before the first impact. So the lead adds `WEB_TEST_CAPTURE_START_ALLOWANCE_MS` (test-only, first guess 1800 ms; measured loss 0 to 10 ms, so it is 500 ms and the lead is 1700 ms, see `Measured values`). The tail is `SYNTH_FIXTURE_TAIL_MS` plus the longest impact. The file is then 4.9 s, so a real-time test takes that long plus start-up. This is why only one test carries `smoke`.

The setup runs `runSamples` over the WAV with the generated model and single-label patterns and compares the sequence with the fixture's order. This guards the fixture (a model that does not recognise its own file would make every browser test fail for the wrong reason).

### The fake device may resample
`--use-file-for-fake-audio-capture` feeds the file through Chrome's fake audio device, which can deliver it at its own rate (often the default 44100 or 48000 Hz of the machine) and which may play the file only once with `%noloop`. The WAV is 48000 Hz but the `AudioContext` rate is whatever Chrome picks. **Tests must read the real `AudioContext.sampleRate` from the page and never assume 48000.** The model was taught at 48000 Hz, so a different context rate gives the sample-rate warning case of Task 15, and the engine still works (plan: 44.1k and 48k classify the same). The microphone test therefore compares the sequence of pattern names, not times, and checks the rate lies in 16000 to 96000 Hz. Times are compared only in the WAV-source test, where the rate is the file's own.

### Instrumentation
`instrument.ts` is added with `addInitScript` before the page loads. It wraps the `AudioContext` constructor to keep every instance, wraps `navigator.mediaDevices.getUserMedia` to keep every returned stream, and wraps `Worker.prototype.terminate` to count calls. The wrappers call the originals and change no behavior. This gives the specs the real rate, the state, the track states and the stop result with no hook in production code, and no field is added to `Ears`.

### Gesture tests
A click through Playwright (`page.click`) is a real input event, so it gives user activation. A call made with `page.evaluate` is not one. The no-gesture test uses `evaluate`, with `--autoplay-policy=user-gesture-required`, and expects the rejection of requirement 6.9 within `WEB_RESUME_TIMEOUT_MS` plus a margin.

### Pause in the WAV test
The pause is made while the file is still in its quiet lead, so no impact is cut by it. The engine and the position survive, so the match list must still equal `runSamples`. A change in position handling (for example a lost or doubled chunk) would break the equality, which makes this a test of "pause keeps state and position". The microphone pause is covered by the worklet vm test (it drops blocks, it restarts a chunk) and by the mic unit test only as far as the handle goes.

### Property test cost
Each case runs the engine twice (the protocol and `runSamples`) over a signal of a few seconds. The case count follows `PBT_RUNS` like other property tests. The first task step measures the time at 20 and 100 runs and sets a per-run timeout constant with a unit. Target: under 30 s at `PBT_RUNS=100`.

## Playwright setup
- Config: `testDir` `test/web`, `workers: 1`, `fullyParallel: false`, `webServer` with the dev command and the URL of the served root, `reuseExistingServer: true`, a project named `chrome` with `channel: 'chrome'` and the four arguments. Headless is the default; the first task step checks that the fake device delivers audio in headless Chrome and records the result. If it does not, the run uses headed mode and the reason is written here.
- Global setup: writes the fixture files, and fails the run on the check of requirement 9.3.
- The fake audio file is read by the browser process, not per page. If a second test in the same browser starts mid-file, the setup must start a new browser per test that uses the microphone (a launch inside the test). The first task step runs two microphone tests in a row to see this, and the result is recorded in `Measured values`.
- The Chrome argument for the file needs an absolute path. The config computes it with `path.resolve` from the repository root. A path with spaces or characters that Chrome treats as separators would break the argument; the repository path does not have any, and the config throws if the path contains a space.
- Playwright and Task 13's `vitest.config.ts` exclusion keep the two runners apart.

## Risks and rules
- **`listen()` without a gesture does nothing visible.** Covered by requirement 6.9 and the no-gesture test. Chrome can keep `resume()` pending, so the code reads the state after `WEB_RESUME_TIMEOUT_MS` and never waits on the promise alone.
- **Permission denied and no device.** Covered by the mic unit tests and the guiding messages with `cause`.
- **HTTP page.** `navigator.mediaDevices` is missing. Covered by the unit test and the HTTPS message.
- **Sample rate of a Bluetooth headset (16 kHz) or another taught rate.** The 8000 Hz case is a `RangeError` before the permission prompt. A rate in range but different from the model is accepted here and shown by the overlay in Task 15.
- **Handler errors.** One failing handler must not hide later matches. Handled by catching per call and rethrowing asynchronously.
- **The fake microphone is real time.** A test that waits for the file takes the file's length. Waits use `waitForFunction` with a timeout of the fixture length plus a named slack (test-only, with unit), not fixed sleeps, except the bounded wait for "no more matches" after the last expected one, which is a named settle time (test-only, with unit).
- **Flush and late matches.** The protocol has no flush acknowledgement. A test knows the end by the expected count, then waits the settle time to see that no extra match arrives.
- **Port and memory.** Chunks are transferred, so no copy of audio is kept on the main thread. The WAV samples stay in page memory for the file's duration (the file itself, not a recording of the user). They are dropped when `stop()` runs.
- **Task 13 fit.** `web/index.ts` now imports `listen.ts`, which imports the factory, so the Worker string enters `dist/tokk.js`. The Task 13 note ("Task 14 adds the check to the build test") is requirement 8.3 here.
- **Privacy.** The only network call in `web/` besides `loadSounds` is the GET of a WAV URL. A WAV URL is user supplied and may be cross-origin; the page only reads it. Review step: search `web/` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `localStorage`, `indexedDB` and confirm each hit.
- **Task 15 fit.** The overlay needs the context rate, the three message kinds above and the routing function. All exist. No message needs to change.
- **Task 16 fit.** The union is open. Recording needs `record-start` and `record-stop` messages and a state field for recorded segments in the Worker. Both fit into `handleWorkerMessage` without a change in `worker.ts`. `replaceSounds` and the state of "engine restarts" are already defined. `listen.ts` gains `teach`, `exportSounds`, `importSounds` and `storageKey` in its option and result types.

## Tests
| # | Test | Where | Requirement |
|---|---|---|---|
| 1 | P3 across the message boundary: protocol messages equal `runSamples` | `test/protocol.test.ts` | 3.5, 3.6, 3.8, 10.1 |
| 2 | every message survives `structuredClone`; transfer list is the envelope buffers | `test/protocol.test.ts` | 3.11 |
| 3 | envelope bins and `t0` equal direct computation, at chunk sizes that split bins | `test/protocol.test.ts` | 3.7 |
| 4 | `setMode` switches patterns; unknown mode gives `error` | `test/protocol.test.ts` | 3.8 |
| 5 | `init` at 8000 Hz gives the engine's `error`; `chunk` before `init` gives `error` | `test/protocol.test.ts` | 3.5, 3.6, 3.10 |
| 6 | unknown type and thrown exceptions become `error` messages | `test/protocol.test.ts` | 3.10 |
| 7 | `replaceSounds` uses the new model and restarts calibration | `test/protocol.test.ts` | 3.9 |
| 8 | worklet chunks: size, split blocks, exact copy, transfer, connect, pause, resume, missing input | `test/worklet.test.ts` | 5 |
| 9 | mic: HTTPS message, 8000 Hz `RangeError` before the prompt, permission and device errors with `cause`, constraints, context before `getUserMedia`, resume timeout, resume with state still suspended, cleanup | `test/web-unit/mic.test.ts` | 6 |
| 10 | Worker entry in vm: `init` 8000 gives `error`; `connect` attaches a port handler | `test/build.test.ts` | 4, 10.4 |
| 11 | `dist/tokk.js` exports `listen` and holds the Worker and worklet strings, no Node references | `test/build.test.ts` | 8 |
| 12 | `smoke:` fake microphone fires the fixture's patterns in order | `test/web/listen.spec.ts` | 6, 7.5, 10.5 |
| 13 | WAV source gives `runSamples`' patterns and times, with a pause and a resume | `test/web/listen.spec.ts` | 7.6, 7.8 |
| 14 | no gesture rejects with the gesture message | `test/web/listen.spec.ts` | 6.9, 7.7 |
| 15 | `stop()` ends the tracks, closes the context, terminates the Worker, stops handlers | `test/web/listen.spec.ts` | 7.10 |

Test-only values with units sit at the top of each file: `WEB_TEST_SAMPLE_RATE_HZ` (48000), `WEB_TEST_CAPTURE_START_ALLOWANCE_MS`, `WEB_TEST_WAIT_SLACK_MS`, `WEB_TEST_SETTLE_MS`, `WEB_TEST_NO_GESTURE_MARGIN_MS`, `WEB_TEST_SMOKE_BUDGET_MS` (20000), the property-test timeouts.

## Measured values
Measured on 2026-11-20 (Windows, Node 24.15.0).
- **`@playwright/test` 1.65.0**, published 2026-11-05T18:30:18Z. Cut-off 2026-11-06 (14 days before 2026-11-20). From `npm view @playwright/test time --json`: 1.64.1 2026-10-14, 1.65.0 2026-11-05, 1.65.1 2026-11-13 (after the cut-off). `dist-tags`: `latest` 1.65.1, `next` 1.66.0-alpha-2026-11-19, `beta` 1.65.0-beta-…, `rc` 1.18.0-rc1. Installed with `--save-exact`; no browser was downloaded (`playwright install` was not run).
- **Chrome** 157.0.8103.79 (installed, `channel: 'chrome'`). The fake device works in headless mode, so headed mode is not needed.
- **`AudioContext.sampleRate` in the microphone test: 48000 Hz** (two runs). The worklet node with no output was pulled by Chrome. The zero-gain fallback was not needed.
- **Capture start lost: 0 to 10 ms.** The first `low` match had `t` = 2.995 s in the browser and 2.995 s in Node in the first test, and 2.985 s in a second microphone test in the same browser. The fake device starts the file when the stream opens. `WEB_TEST_CAPTURE_START_ALLOWANCE_MS` went from the 1800 ms first guess to 500 ms (about 50 times the measured loss), so the lead is 1700 ms and the test WAV is 4900 ms long (470,444 bytes; the generated folder with `sounds.json` and `labels.json` is 496,957 bytes, limit 2 MB).
- **Second microphone test in the same browser** starts at the beginning of the file (every page opens its own capture), so no extra browser launch per test is needed.
- **Runtimes:** smoke test 6.6 s, `npm run test:web -- --grep smoke` 9.3 s wall time including browser start and dev server (budget 20 s). Whole `npm run test:web`: 18.8 to 19.0 s reported (19 to 20 s wall), stable in 3 runs in a row plus the final runs. `test/protocol.test.ts`: 1.4 s at `PBT_RUNS=20`, 3.1 s at `PBT_RUNS=100`, 26.5 s at `PBT_RUNS=1000` (all passed). Throwaway engine in `listen()`: 0.12 ms per `createEngine` with the test model (200 runs).
- **`dist/tokk.js`:** 116,722 bytes with the Worker and worklet strings.
- **Full vitest suite:** 474 passed, 2 todo, 72 s (baseline before this task: 430 passed, 2 todo, 62 s).

## Implementation notes (task steps)
- **1.3** `checkSampleRate` in `core/engine.ts` was private and built its message there only. It now has `export`, and `core/index.ts` is unchanged.
- **1.4** `core/` has only private ms-to-samples helpers (`segment.ts`, `synth.ts`), so `web/protocol.ts` exports `msToSamples` (rounded, at least 1).
- **1.5** A pattern that is the plain name of a label fires on one sound of that label. With no longer pattern sharing the prefix, the matcher reports it when the engine advances past the sound (at the latest on `flush`).
- **1.6** `teachFromRecordings` needs no `background` recording (it requires `MIN_EXAMPLES_PER_LABEL` per label present). The teaching set has the four impact classes only.
- **1.7** Only `test/load-sounds.test.ts` imported `web/index.ts`. It now imports `loadSounds` from `web/load-sounds.ts` and reads `web/index.ts` as text for the name check. The names of `dist/tokk.js` are checked in `test/build.test.ts`. No file moved to `test/web-unit/`.
- **1.10** `check:public-api` only scans `apps/` and does not depend on the new files. The hook copies the matcher style of `pbt-quick.json`.
- **4.1** Playwright imports the core and helper files by relative path. The fixture generation runs in the global setup, and no separate `tsx` step is needed. A shared `test/web/paths.ts` holds the fixture paths for the config, the setup and the spec.
- **Gesture test (finding).** Chrome 157 started with `--autoplay-policy=user-gesture-required` creates an `AudioContext` in state `running` without any user activation (`navigator.userActivation.hasBeenActive` is `false`), headless and headed, with and without the fake-media flags, and also for a navigation started by script. `page.evaluate` also counts as a gesture in Playwright. So real Chrome here cannot produce the no-gesture case. The test therefore (a) calls `listen()` on page load (`?autostart=1`), with no click, and (b) passes `suspendWithoutGesture` to the instrumentation init script: a context created while `navigator.userActivation.isActive` is false reports `suspended` and its `resume()` stays pending, as Safari and a strict Chrome policy behave. Production code is unchanged. The test then proves that `openMic` does not hang and rejects with the gesture sentence after `WEB_RESUME_TIMEOUT_MS`. The assertion is unchanged.
- **Hook matcher** `(?<!test)(^|[\\/])web[\\/].+$`, checked with Node: `web/listen.ts` true, `web/overlay/overlay.ts` true (both separators, also an absolute path), `core/engine.ts` false, `test/web/listen.spec.ts` false (both separators, also absolute). The lookbehind is needed because the `pbt-quick` style alone also matches `test/web/`.
- **Dev server and `dist/`.** `npm run dev` (the Playwright `webServer`) removes `dist/` and rebuilds only `dist/tokk.js`, so run `npm run build` again after `npm run test:web` before `npm pack`.
