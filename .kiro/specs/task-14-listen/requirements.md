# Requirements: Task 14, microphone, Worker and `listen()`

## Introduction
Task 14 is the third task of plan 2 (browser layer) and the largest. It connects the engine to a microphone in the browser: `getUserMedia` feeds an AudioWorklet, the worklet passes 20 ms chunks to a Web Worker through a `MessageChannel`, the Worker runs `createEngine`, and the main thread calls the user's handlers. It also adds `listen()` with a WAV-file source, the `Ears` object (without teaching), and the first Playwright end-to-end tests, which run in installed Chrome with a fake microphone.

Task 13 left these files that this task builds on: `web/index.ts` (core re-exports and `loadSounds`), `web/worker.ts` (a temporary ping/pong entry), `web/worker-factory.ts` (Blob URL Worker from the injected string), `scripts/build.ts` (build, dev server, Worker string plugin), `tsconfig.web.json`, `tsconfig.build.json` and the `test/web` exclusions.

| Consumer | What it uses from this task |
|---|---|
| Task 15 (overlay) | The `envelope`, `event` and `match` messages, one routing function in `listen.ts`, the context sample rate |
| Task 16 (`ears.teach`) | A message union that accepts new message types, `replaceSounds`, `connect`, the Playwright setup, the fixture generator |
| Task 17 (`teach.html`) | `openMic`, `listen()` |
| Task 19 (`examples/hello`) | `listen()`, `test/web` fixture and page conventions |

Facts checked before this spec was written (the first task step checks them again): `core/engine.ts` throws a `RangeError` for a sample rate outside 16000 to 96000 Hz from a function that is not exported; `core/index.ts` exports exactly `createEngine`, `knnClassifier`, `readWav`, `runSamples`, `writeWav` and types; `web/index.ts` exports those plus `loadSounds`; `web/worker.ts` only answers `ping`; `web/worker-factory.ts` has `createTokkWorker()`; `test/helpers/engine-fixture.ts` has `makeSignal`, `buildModel`, `LEAD_MS`; `test/helpers/resample.ts` exists; `core/synth.ts` has `place`, `rng`, `synthImpact`, `synthNoise`, `SYNTH_CLASSES`; `.kiro/hooks/pbt-quick.json` shows the hook format; `@playwright/test` is not installed.

## Requirements

### Requirement 1: Playwright as a pinned devDependency and its configuration
**User story:** As a maintainer, I want end-to-end tests in the installed Chrome without a browser download.

#### Acceptance Criteria
1. `package.json` SHALL list `@playwright/test` in `devDependencies` with an exact version (no `^`, no `~`). THE version SHALL be the newest stable release (no alpha, beta, or `next`) whose publish date in `npm view @playwright/test time` is at least 14 days before 2026-11-20, that is on or before 2026-11-06. THE version, its publish date and the command output used SHALL be recorded in `design.md` ("Measured values") and in the devlog. IF a problem is reported against that version, the next older stable version is chosen and the reason recorded.
2. THE task SHALL NOT download a browser (no `playwright install`). THE config SHALL use `channel: 'chrome'`. IF the installed Chrome cannot be launched, THE implementer SHALL stop and report, and SHALL NOT download a browser or switch the channel.
3. `playwright.config.ts` SHALL set the test directory to `test/web`, the match pattern to `*.spec.ts`, one worker, no parallel files, one retry only if the first task step shows a reason (default none), and a project that uses Chrome with these launch arguments: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=<absolute path of the fixture wav>%noloop`, `--autoplay-policy=user-gesture-required`. THE absolute path SHALL be built from the repository root with `path.resolve`, not typed by hand.
4. THE config SHALL start the existing dev server (`npm run dev`, the repository root on `localhost` at `DEV_SERVER_PORT`) with the Playwright `webServer` option, and SHALL use the same port constant as `scripts/build.ts`. THE only change to `scripts/build.ts` SHALL be exporting the port and host constants. The design justifies this choice; if the first task step finds that the dev server cannot serve the tests, the implementer reports instead of writing another server.
5. `package.json` `scripts` SHALL get `test:web` that runs the Playwright tests, so that `npm run test:web -- --grep smoke` passes the extra arguments to Playwright.
6. THE fixture files SHALL be generated into a git-ignored folder below `test/web/` (named in `design.md`) by a Playwright global setup, and `.gitignore` SHALL list that folder. `test-results/` and `playwright-report/` stay ignored (Task 13).
7. `vitest.config.ts` keeps excluding `test/web/**`. THE vitest unit tests of this task that touch DOM-typed modules SHALL live in `test/web-unit/`, which stays inside vitest's scope.
8. TypeScript SHALL be configured so that: `tsconfig.json` excludes `test/web` and `test/web-unit`; `tsconfig.web.json` keeps `types: []` and its include of `web` and `core` only (so a Node import in `web/` still fails the check); a new `tsconfig.test-web.json` extends `tsconfig.web.json`, sets `types` to `["node"]`, and includes `web`, `core`, `test/web`, `test/web-unit`, `playwright.config.ts` and the helpers they import. `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit` and `npx tsc -p tsconfig.test-web.json --noEmit` SHALL pass.
9. THE reason for the extra config (specs and the config file need Node typings, which `tsconfig.web.json` must not have) SHALL be written in `design.md`.

### Requirement 2: `web/constants.ts`
**User story:** As a maintainer, I want every time value of the browser layer to have a name and a unit.

#### Acceptance Criteria
1. `web/constants.ts` SHALL define `WEB_CHUNK_MS` = 20, `WEB_RESUME_TIMEOUT_MS` = 500 and `WEB_ENVELOPE_RESOLUTION_MS` = 10, and no other value unless the design names it. THE file SHALL contain constants only (no functions).
2. NO sample count SHALL be hard-coded anywhere in `web/`. Every count of samples SHALL be derived from the sample rate and a named millisecond constant, with one shared conversion (reuse a core helper if the first task step finds one, otherwise add one exported function to `web/protocol.ts`).
3. EVERY time `t` produced by `web/` code SHALL be a cumulative sample count divided by the sample rate, in seconds. NO clock (`Date`, `performance.now`) SHALL be used to compute an event time.

### Requirement 3: `web/protocol.ts`
**User story:** As a maintainer, I want the Worker logic to be a pure function that Node tests can run, so the message boundary is tested without a browser.

#### Acceptance Criteria
1. `web/protocol.ts` SHALL define the message types as discriminated unions on a string field `type`, open to new members (Tasks 15 and 16 add some). It SHALL import no DOM type (use small local structural types for a message port) and no Node module, so the base `tsc` accepts a vitest file that imports it.
2. **Main to Worker:**
   - `init`: `sounds` (a `SoundModel`), `sampleRate`, `patterns` (a record from mode name to a list of pattern names), `mode` (the starting mode name).
   - `chunk`: `samples` (a `Float32Array`), sent with its buffer transferred.
   - `setMode`: `name`.
   - `flush`.
   - `replaceSounds`: `sounds`.
   - `connect`: `port`. This is a transport message that is not in the plan's list; it hands one end of the `MessageChannel` to the Worker (see requirement 4 and `design.md`).
3. **Worker to main:**
   - `match`: `pattern` and `event` (a `MatchEvent`).
   - `event`: `e` (an `EngineEvent`, including `unknown` events).
   - `envelope`: `t0` (seconds), `min` and `max` (`Float32Array`), one value pair per `WEB_ENVELOPE_RESOLUTION_MS` bin.
   - `error`: `message` (a string).
4. `handleWorkerMessage(state, msg)` SHALL return the list of outgoing messages. It SHALL do no I/O and use no clock, random numbers, timers or globals. The `state` object is the only thing it changes. A function that creates the initial state SHALL be exported.
5. **init.** IT SHALL build one engine with `createEngine`, with one handler set per mode (each handler appends a `match` message) and the `onEvent` callback appending `event` messages. A failure of `createEngine` (for example a sample rate of 8000) SHALL give exactly one `error` message whose `message` is the text of the engine's error, and SHALL leave the state without an engine.
6. **chunk.** IT SHALL push the samples to the engine and return, in the order they happened, the `event` and `match` messages the engine produced, followed by the `envelope` message of this chunk if it completed at least one bin. A chunk before `init`, or a `chunk` without a `Float32Array`, SHALL give an `error` message and change nothing.
7. **Envelope.** Bins SHALL be `WEB_ENVELOPE_RESOLUTION_MS` long, counted from the first sample the Worker received, and a bin that is cut by a chunk boundary SHALL be finished by the next chunk. `t0` SHALL be the cumulative number of samples before the first bin of the message divided by the sample rate. Every sample SHALL be in exactly one bin, and the counter SHALL not restart on `replaceSounds`. No bin is invented for a partial bin at the end (a trailing partial bin is dropped on `flush`, with a note in `design.md`).
8. **flush** SHALL call the engine's `flush` and return the resulting `event` and `match` messages. **setMode** SHALL call the engine's `setMode`. An unknown mode SHALL give an `error` message with the engine's text.
9. **replaceSounds.** IT SHALL replace the engine by a new one built with the new model and the same sample rate, modes and current mode. The new engine starts its calibration period again, and its times restart at 0. This SHALL be stated in `design.md`, with the reason (the core engine has no way to swap a model).
10. ANY exception inside the handler SHALL become an `error` message, not an exception. An unknown `type` SHALL give an `error` message that names the type. `error` messages SHALL carry text only.
11. EVERY outgoing message SHALL survive `structuredClone` (no functions, no class instances). A pure function SHALL return the list of transferable buffers of an outgoing message (the `min` and `max` buffers of an envelope), so `worker.ts` can transfer them.
12. THE protocol SHALL contain no network call and SHALL NOT send audio anywhere except between the page's own threads.

### Requirement 4: `web/worker.ts`
**User story:** As a maintainer, I want the Worker entry to hold no logic of its own.

#### Acceptance Criteria
1. `web/worker.ts` SHALL replace the temporary ping/pong entry. IT SHALL create the state once, and for every message that arrives on the Worker scope or on a connected port SHALL call `handleWorkerMessage` and post each result, with the transfer list from requirement 3.11.
2. FOR a `connect` message, IT SHALL attach the same handler to `msg.port` (it is the end of the `MessageChannel` whose other end is in the worklet). This is the only code in the file besides the calls of requirement 4.1.
3. IT SHALL import no `fs`, `path`, `zlib`, `process` or `node:*`, and SHALL NOT use `importScripts`. The build SHALL still bundle it as an IIFE string.
4. THE ping/pong code and its test SHALL be removed. THE vm test in `test/build.test.ts` that answered ping SHALL be replaced by a test of the new entry (requirement 10.3).

### Requirement 5: `web/worklet-source.ts`
**User story:** As a maintainer, I want the AudioWorklet to copy and forward samples and do nothing else.

#### Acceptance Criteria
1. `web/worklet-source.ts` SHALL export the AudioWorklet processor as a string, and SHALL contain no top-level side effects other than defining that string.
2. THE processor SHALL collect the 128-frame render blocks of the first input channel into chunks of exactly `chunkFrames` frames and post each chunk with its buffer transferred, as a `chunk` message of requirement 3.2, on a data port. A block that does not fit into the chunk being filled SHALL be split, so every chunk has the same length, and no sample is lost or repeated.
3. `chunkFrames` SHALL be computed on the main thread from the context sample rate and `WEB_CHUNK_MS` and passed to the processor in `processorOptions`. THE worklet string SHALL contain no millisecond constant, no sample rate and no number of frames per chunk.
4. THE processor SHALL do no computing on the samples (no filtering, level, FFT, YIN or kNN). It copies values only.
5. THE processor SHALL post nothing until its data port is connected, and SHALL support two control messages on the node's own port: `connect` with the data port (transferred), and `pause` / `resume`. While paused it SHALL drop every block and discard the partly filled chunk, and after `resume` it SHALL start a new chunk. A missing input (no channel) SHALL count as a block of silence of the same length, so a chunk keeps its size.
6. THE `process` method SHALL return `true` so the node stays alive.
7. THE string SHALL be usable in a Blob URL (`text/javascript`) and SHALL register the processor under one name constant of this file.

### Requirement 6: `web/mic.ts`, `openMic()`
**User story:** As a user of `listen()`, I want a microphone that works or an error that tells me what to do.

#### Acceptance Criteria
1. `openMic` SHALL return a handle with: the `MediaStream`, the `AudioContext`, the worklet node, the worklet's control port usage hidden behind `pause()`, `resume()` and `close()`, the sample rate of the context, and the data port end that goes to the Worker (so `listen()` can send it with `connect`).
2. **HTTPS.** IF `navigator.mediaDevices` is missing, `openMic` SHALL reject with an `Error` that says the microphone needs HTTPS (or `localhost`) and names what to do. IF `audioWorklet` is missing on the context, it SHALL reject with an `Error` that says the browser does not support it.
3. **Constraints.** `getUserMedia` SHALL be called with `audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }` and no video. A `MediaStream` passed in by the caller replaces `getUserMedia` and is used as is.
4. **Context first.** `openMic` SHALL create the `AudioContext` synchronously before any `await` (so it is created inside the click handler of the page), SHALL read its `sampleRate`, and SHALL ask for the microphone only after that. The reason is in `design.md`.
5. **Sample rate.** IF the context sample rate is outside 16000 to 96000 Hz, `openMic` SHALL reject with a `RangeError` whose message is the engine's message for that rate, taken from the one function of the engine that builds it (no copy of the text). It SHALL do so before the microphone permission is asked, and SHALL close the context.
6. **Errors of `getUserMedia`.** A permission error (`NotAllowedError`, `SecurityError`) SHALL give an `Error` that says the permission was denied and how to allow it in the browser's site settings. A missing device (`NotFoundError`, `OverconstrainedError`) SHALL give an `Error` that says no microphone was found. `NotReadableError` SHALL say the microphone is in use or cannot be read. Any other error SHALL give an `Error` that says the microphone could not be opened. EVERY one of these SHALL keep the original error in `cause`, and the message SHALL be English text that says what to do.
7. **Worklet.** THE worklet SHALL be loaded from a Blob URL (`text/javascript`) made from `web/worklet-source.ts` and revoked after `addModule` has settled. THE node SHALL have one input and no output (or the fallback in `design.md`), a mono input, and `processorOptions` with `chunkFrames`. THE microphone source node SHALL be connected to it.
8. **MessageChannel.** `openMic` SHALL create a `MessageChannel`, send one port to the worklet node with `connect` (transferred), and return the other port for the Worker. NO audio SHALL pass through the main thread.
9. **Suspended context.** IF the context state is `suspended` after the microphone and worklet are ready, `openMic` SHALL call `resume()` and wait until `resume()` settles or `WEB_RESUME_TIMEOUT_MS` has passed, whichever is first, and then read `state`. IF the state is not `running`, it SHALL reject with an `Error` that includes the sentence "call listen() from a user gesture such as a click". A `resume()` that rejects SHALL be handled the same way. A `resume()` that stays pending SHALL NOT make `openMic` hang.
10. **Cleanup.** ON every failure after a resource was created, `openMic` SHALL stop the tracks of a stream it opened, close the context and revoke the Blob URL, then reject. `close()` of the handle SHALL stop every track of the stream (also a stream passed in), disconnect the nodes, close the port and close the context, and SHALL be safe to call twice.
11. `openMic` SHALL NOT call `resume()` outside the paths of requirements 6.4 and 6.9, and SHALL NOT create a second context.

### Requirement 7: `web/listen.ts`, `listen()` and `Ears`
**User story:** As a developer, I want to call `listen()` with a model and handlers and get sound patterns on the main thread.

#### Acceptance Criteria
1. THE options SHALL be: `sounds` (a `SoundModel`), `on`, `modes`, `mode` (same rules as `createEngine`), `debug` (accepted and ignored until Task 15), `source` (a string WAV URL or a `MediaStream`; none means the microphone). `storageKey` and the other Task 16 items SHALL NOT exist yet.
2. THE returned object (`Ears`) SHALL have `setMode(name)`, `pause()`, `resume()`, `stop(): Promise<void>` and a read-only `sounds`. It SHALL NOT have `teach`, `exportSounds` or `importSounds` yet. THE exported types SHALL be `Ears` and the option type.
3. **Validation.** `listen()` SHALL reject, before any microphone, fetch or Worker is used, with the original error that `createEngine` gives for these options (both `on` and `modes`, `modes` without `mode`, unknown mode, an invalid pattern). It SHALL do so by building one engine on the main thread with the same options and dropping it without pushing a sample. For a WAV source the sample rate of the file SHALL be checked the same way.
4. **Handlers.** THE handlers SHALL stay on the main thread. The Worker SHALL receive pattern names only (`patterns` in `init`), and a `match` message SHALL call the handler of that pattern in the current mode. A message for a pattern the current mode does not have SHALL be ignored. An exception from a handler SHALL NOT stop the dispatch of the following messages (it is rethrown asynchronously so it shows in the console).
5. **Microphone source.** WHEN `source` is absent or a `MediaStream`, `listen()` SHALL call `openMic`, create the Worker with `createTokkWorker()`, send `init` with the context sample rate, send `connect` with the data port, and resolve after that. NO sample SHALL be sent before `init`.
6. **WAV source.** WHEN `source` is a string, `listen()` SHALL `fetch` it (GET, no body), read it with `readWav`, and send `init` with the sample rate of the file. It SHALL send the samples as `chunk` messages of `WEB_CHUNK_MS` of samples each (the last may be shorter), at real-time pace, never playing the sound and creating no `AudioContext`. THE pace SHALL be set by a timer that sends every chunk that is due, so a late timer sends the missed chunks together, in order, and never drops one. WHEN the last chunk is sent, `listen()` SHALL send `flush`. A failed `fetch`, a non-OK status or a file that is not 16-bit PCM WAV SHALL reject with an `Error` that names the URL and keeps the original error in `cause`. `listen()` SHALL resolve after the first chunks are scheduled, not after the file ends.
7. **No gesture.** THE microphone path SHALL reject as in requirement 6.9 when no user gesture was given. THE WAV path needs no gesture.
8. **pause().** IT SHALL stop forwarding chunks (microphone: the worklet drops blocks; WAV: the timer stops and keeps its position) and SHALL keep the microphone, the context, the Worker and the engine state. **resume()** SHALL start forwarding again without creating an engine or sending `init` (no new calibration period). A WAV source SHALL continue at the sample where it stopped. `pause()` and `resume()` SHALL be safe to call twice and after `stop()`.
9. **setMode(name).** IT SHALL throw the engine's error for an unknown mode on the main thread, and otherwise send `setMode` and switch the handler set.
10. **stop().** IT SHALL stop the pacing timer, stop every track of the microphone stream, close the `AudioContext`, terminate the Worker (and revoke its Blob URL), and resolve after the context is closed. IT SHALL be safe to call twice. After it, no handler SHALL be called.
11. **Errors.** AN `error` message from the Worker and an `error` event of the Worker SHALL be written with `console.error` including the message, and SHALL NOT throw into the page. If a Worker fails to start, `listen()` SHALL reject when this is seen before it resolves.
12. THE routing of every Worker message SHALL pass through one internal function, so Task 15 can add the overlay and Task 16 can add the recording messages without changing how handlers are called.
13. `listen()` SHALL send nothing over the network except the GET of requirement 7.6, and SHALL NOT send audio, samples, envelope data or a model anywhere. NO sample SHALL be stored (no `localStorage`, no file, no IndexedDB).

### Requirement 8: `web/index.ts`, the bundle and the core change
**User story:** As a user of the package, I want `import { listen, loadSounds } from 'tokk'`.

#### Acceptance Criteria
1. `web/index.ts` SHALL export `listen`, `loadSounds`, the type of `Ears` and of the options, and exactly the core runtime names and types it exports today. It SHALL export no other runtime name.
2. THE function that checks the sample rate in `core/engine.ts` SHALL be exported from that file for `web/mic.ts` (a relative import). IT SHALL NOT be exported from `core/index.ts`, its text and behavior SHALL NOT change, and the public API of `core` SHALL stay as it is.
3. **Named test changes.** THESE changes are requirements of this task, not fixes made to pass a bug: (a) in `test/build.test.ts`, the export-name check of `dist/tokk.js` expects the five core names, `loadSounds` and `listen`; (b) in `test/build.test.ts`, the ping test is replaced as in requirement 4.4, and a check is added that the Worker source is now present in `dist/tokk.js`; (c) in `test/load-sounds.test.ts`, the export-name test no longer imports `web/index.ts` (it now pulls DOM types into the base `tsc`) and checks the names of `dist/tokk.js` through the build test instead, or reads `web/index.ts` as text, as the first task step decides; (d) `test/public-api.test.ts` SHALL NOT change, because `package.json` `exports` and the names of `core` and `node` do not change. IF the first task step finds a reason to change it, the reason is written in `design.md` first.
4. `dist/tokk.js` SHALL contain the Worker string and the worklet string, and still no reference to `fs`, `path`, `zlib`, `process`, `node:` or `require(`.
5. NO file outside `web/` and the build imports a `web/` path, and nothing in `examples/` changes.

### Requirement 9: Fixtures and test pages
**User story:** As a maintainer, I want end-to-end tests that need no committed audio.

#### Acceptance Criteria
1. THE global setup SHALL generate, in Node at the start of the run: a 48 kHz teaching set (every class of the synthetic sounds: `low`, `mid`, `high`, `ring`, with `TRAIN_PER_CLASS` impacts each, plus a noise-only `background` recording if `teachFromRecordings` needs one), a model made with `teachFromRecordings` from that set, and a test WAV (16-bit PCM mono at 48000 Hz) with synthetic impacts, written as `sounds.json`-shaped model file and WAV file in the ignored folder.
2. THE test WAV SHALL start with a quiet lead of at least `NOISE_FLOOR_WARMUP_MS` plus `SYNTH_FIXTURE_LEAD_MARGIN_MS` (1200 ms), plus a named allowance for the time the browser needs to start capturing (named and justified in `design.md`), then one impact of each class in a fixed order, then a quiet tail. Every value SHALL come from a named constant with its unit, and no sample count SHALL be typed.
3. THE setup SHALL check, in Node, that `runSamples` over the generated WAV with the generated model gives exactly the fixture's label sequence as matches of single-label patterns, and SHALL fail the run with a clear message if it does not, before any browser starts.
4. NO generated audio or model SHALL be committed. THE total size SHALL stay below 2 MB, and the setup SHALL not need a network.
5. THE test page `test/web/listen.html` SHALL load `/dist/tokk.js` as a module, read the model with `loadSounds`, offer a button that calls `listen()` from its click handler, record the handler calls and any rejection message in a global object for the spec, and expose a function that the spec can call without a click (for the no-gesture test).
6. A shared test helper SHALL, through an init script, record every `AudioContext` created, every `MediaStream` returned by `getUserMedia` and every `Worker.terminate` call, so a spec can read the real `AudioContext.sampleRate`, the context state and the track states, without any production code exposing them.

### Requirement 10: Tests
**User story:** As a maintainer, I want the failing tests to exist before the code, and a quick one for the save hook.

#### Acceptance Criteria
1. **`test/protocol.test.ts` (vitest, no DOM).**
   - A property test (P3 across the message boundary): for a generated signal (impact classes, gaps, gains, sample rate among 16000, 44100 and 48000, chunk sizes drawn at random and not multiples of the bin size), the `event` and `match` messages from `handleWorkerMessage` (an `init`, then the chunks, then `flush`) equal the events, unknowns and matches of `runSamples` on the whole signal. The run count SHALL follow `PBT_RUNS` as other property tests do.
   - Every outgoing message of that run passes `structuredClone`.
   - The `envelope` messages together cover the signal in `WEB_ENVELOPE_RESOLUTION_MS` bins whose `min` and `max` equal the values computed directly from the samples, and `t0` values are consecutive.
   - A `setMode` message switches which patterns fire (a signal with a quiet gap that is long enough that no pattern is pending at the switch), and an unknown mode gives an `error` message.
   - An `init` with sample rate 8000 gives one `error` message with the engine's text, and a following `chunk` gives an `error` message and no event.
   - A `chunk` before `init`, an unknown `type` and an exception in the engine give `error` messages and do not throw.
   - `replaceSounds` makes the new model act and restarts calibration.
   - The transfer-list function returns the envelope buffers and nothing else.
2. **`test/worklet.test.ts` (vitest, `node:vm`).** The worklet string runs in a context with a fake processor base class, a fake `registerProcessor` and a `sampleRate`. THE tests SHALL show: chunks of exactly `chunkFrames` frames from 128-frame blocks, also when `chunkFrames` is not a multiple of 128; concatenated chunks equal the input exactly; each chunk is posted with its buffer in the transfer list; nothing is posted before `connect`; `pause` drops blocks and the partial chunk, and `resume` starts fresh; a missing input gives a silent block; `process` returns `true`.
3. **`test/web-unit/mic.test.ts` (vitest with stubbed browser globals, no network).** THE tests SHALL show: no `navigator.mediaDevices` rejects with the HTTPS message; a context sample rate of 8000 rejects with a `RangeError` of the engine's text, closes the context and does not call `getUserMedia`; a `NotAllowedError` and a `NotFoundError` reject with guiding errors that keep the original in `cause`; the constraints passed to `getUserMedia` are exactly those of 6.3; a `resume()` that never settles rejects after `WEB_RESUME_TIMEOUT_MS` with the gesture sentence (fake timers); a `resume()` that settles with the context still `suspended` rejects at once; a context that is `running` needs no `resume()` wait; the context is created before `getUserMedia` is called; on a failure the tracks are stopped and the context is closed.
4. **`test/build.test.ts`** changes as in requirement 8.3, plus a vm test of the new Worker entry: an `init` with sample rate 8000 posted on a fake scope gets an `error` message back, and a `connect` message attaches a handler to the fake port.
5. **`test/web/listen.spec.ts` (Playwright, Chrome, fake microphone).**
   - `smoke: listen() on the fake microphone fires the patterns of the fixture labels in order`. The title SHALL contain the word `smoke`. It SHALL read the real `AudioContext.sampleRate` and check it is inside 16000 to 96000 Hz, and SHALL compare the sequence of pattern names with the fixture's label sequence. It SHALL NOT compare times. THIS is the only test with `smoke` in its title, and it SHALL finish in under 20 s including the browser start.
   - `listen({ source: wav }) gives the same patterns and times as runSamples in Node`: it SHALL compare the pattern names and `t` values with `runSamples` on the same WAV bytes and model, and SHALL pause and resume once while the file is still in its quiet lead, to show that pause keeps the position and the engine state.
   - `listen() without a user gesture rejects with the gesture message`: it calls `listen()` from the page without a click (Chrome started with `--autoplay-policy=user-gesture-required`) and expects a rejection that contains "call listen() from a user gesture such as a click" within a bounded time.
   - `stop() closes the microphone track`: after `stop()`, every track the page got from `getUserMedia` is `ended`, the context is `closed`, and `Worker.terminate` was called, and no handler fires afterwards.
6. THE new tests SHALL be written and shown failing before the code they test (the first step of `tasks.md` lists the order). THE full `npm test`, `npm run test:web`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit` and `npx tsc -p tsconfig.test-web.json --noEmit` SHALL pass at the end, and `npm run build` SHALL pass from a clean `dist/`.
7. THE tests SHALL NOT read the sample rate of the fake device from a constant: the fake device can resample the WAV to its own rate (see `design.md`), so the microphone tests read it from the real `AudioContext`.
8. THE Playwright tests SHALL write only into the ignored folders and SHALL need no network.

### Requirement 11: The save hook
**User story:** As the author of `web/`, I want a fast browser check every time I save a file there.

#### Acceptance Criteria
1. `.kiro/hooks/web-smoke.json` SHALL use the same format as `.kiro/hooks/pbt-quick.json` (version, a list with one hook of name, description, trigger, matcher, action, timeout, enabled).
2. THE hook SHALL be named `web-smoke`, trigger on `PostFileSave`, match files below `web/` (any depth, both path separators, the same style of matcher expression as `pbt-quick`), run the command `npm run test:web -- --grep smoke`, have a timeout of 60 seconds and be enabled.
3. THE hook SHALL not match files outside `web/` (a test in `test/` or a file in `core/` does not trigger it). THE implementer SHALL check the matcher expression against sample paths of `web/listen.ts`, `web/overlay/overlay.ts`, `core/engine.ts` and `test/web/listen.spec.ts` with a Node one-liner or a vitest test and note the result.
4. ANY other hook stays as it is.

### Requirement 12: Rules that apply
**User story:** As a maintainer, I want this task to follow the project rules.

#### Acceptance Criteria
1. **Units.** EVERY threshold and time constant SHALL be in ms, Hz or dB with the unit in its name. NO sample count SHALL be hard-coded. Constants used by `web/` SHALL be in `web/constants.ts` or `core/constants.ts`. Test-only values stay at the top of their test file, with units.
2. **Privacy.** NO code SHALL send audio over the network. NO recorded sample SHALL be stored in `sounds.json`, in `localStorage` or anywhere in the browser. THE fixtures are generated synthetic audio, written only into the ignored folder.
3. **Layers.** `core/` SHALL stay pure (the one change of 8.2 adds an `export` keyword). `web/` SHALL use DOM and Web Audio and SHALL NOT import `fs`, `path` or `node/`. Apps import `tokk` only.
4. **Web audio.** THE microphone constraints, the gesture rule, the HTTPS message, the 16000 to 96000 Hz range, the "worklet only passes chunks" rule and the Blob URL worklet SHALL all hold, as in `.kiro/steering/web-audio.md`. THE overlay warning of that steering file belongs to Task 15.
5. ALL text written for people (errors, messages, comments, docs, test titles) SHALL be English.
6. THE devlog SHALL get a line: the Playwright version and date, the extra TypeScript config and why, the `connect` message, the context-first order, the exported sample-rate check, the named test changes, the measured smoke time and the fake-device sample rate seen.
