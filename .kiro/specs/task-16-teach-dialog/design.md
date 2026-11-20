# Design: Task 16, in-app teach dialog

## Layout
```
web/constants.ts            + WEB_TEACH_* and WEB_STORAGE_KEY_DEFAULT
web/recorder.ts             pure: Worker-side recorder (fresh Segmenter, chunks, ids, thumbnails)       [shared with Task 17]
web/protocol.ts             + record-* messages, recorder in WorkerState, current model, rebuild helper  [shared]
web/teach-ui/state.ts       pure reducer, doneState, validateLabel, progress rule                         [shared]
web/teach-ui/format.ts      pure text lines for steps, report, confused pairs, warnings                   [shared]
web/teach-ui/teach-dialog.ts  <dialog> in Shadow DOM, takes a controller                                  [shared]
web/teach-ui/storage.ts     localStorage load/save with try/catch                                         [listen() only]
web/listen.ts               storageKey, teach, sounds getter, exportSounds, importSounds, controller
web/overlay/*               unchanged (setState('teaching') and drawWaveform are used as they are)
test/teach-state.test.ts    vitest: reducer, doneState, validateLabel, progress rule, format
test/teach-storage.test.ts  vitest: storage with a stub Storage
test/teach-recorder.test.ts vitest: recorder and record messages through handleWorkerMessage
test/web/teach.html         page for the E2E tests
test/web/teach.spec.ts      Playwright
test/web/fixture.ts, paths.ts  + the teaching WAV
docs/devlog.md              one line
```

## Assumptions (this spec was written without a person to ask)
1. **`ears.teach` without `ui: true` rejects.** The plan only defines the dialog form, and `ui?: true` is the type. A silent no-op would be worse than an error that says what to write.
2. **`importSounds` stores the model like Save.** Otherwise an imported model disappears at the next reload while the stored one wins at start, which would surprise the user.
3. **Label rule** `^[a-z][a-z0-9-]{0,31}$` is taken from Task 17 so both entry points accept the same names.
4. **`hum` and `background` are minimal.** `hum`: no quiet step, no list, one steady hum, Done after 2 s. `background`: no quiet step, no list, "let the room make its usual noise" for 10 s, Done after 10 s. Their `keep` is not used. The numbers are named constants and are the first thing to change after a real-microphone check.
5. **After a Save the overlay is mounted again** instead of getting a new `setSounds` method, so `overlay.ts` stays unchanged. The cost is that the last rows disappear, which matches the engine restart that happens at the same moment.

## Findings from reading the code
1. **The live `Segmenter` must give the ids that `retrainLabel` will give.** `retrainLabel` re-segments the whole recording as one batch and numbers segments from 0. The dialog shows ids from a live run in chunks and sends back which ones to keep. The two agree only if the `Segmenter` gives the same segments for any chunking (the P3 property of plan 1) and if the recorder numbers in finishing order. A property test makes this a test and not a belief (test 6). The trailing segment from `flush` is numbered last, as in the batch.
2. **A deleted example is not hidden in the model, it is filtered by id.** `keep` = all ids the recorder sent minus the deleted ones. Segments the user never saw (only the one that `flush` can add at Done) are kept. This can only raise the count above what the Done gate checked, never below.
3. **The engine cannot just be paused.** If chunks simply skipped the engine, its `Segmenter` would see a splice of two different times, and the grammar state would be stale. Rebuilding the engine on `record-end` and `record-cancel` costs one calibration second and gives a clean state. The model change needs a rebuild anyway (finding of Task 14).
4. **The fake microphone starts when `listen()` opens it, not when `teach()` is called.** The test WAV must have a quiet lead long enough that the dialog's own one second of quiet fits inside it, wherever in the lead `record-start` lands (see "E2E timing").
5. **A stored model must not hide a newly shipped sounds.json (decision, approved).** Storage keeps `{ version, base, model }`. `base` is a short deterministic fingerprint (FNV-1a, 32 bit, hex, of the canonical JSON: keys sorted, no whitespace) of the `sounds` passed to `listen()`. On start, a stored entry whose `base` differs from the fingerprint of the current `o.sounds` is ignored with a `console.warn` (the developer shipped a new `sounds.json`), and `o.sounds` is used. `importSounds` and Save write the current `base` (the fingerprint of the `o.sounds` given to `listen()`, not of the taught model). Corrupt entries and a wrong `version` are still ignored with a warning. The fingerprint function lives in `web/teach-ui/storage.ts`.
6. **Validation of a model.** `loadSounds` in `web/index.ts` fetches and checks `version`. Step 1 finds where the check lives. If it is inline, it moves to a function in `web/` (for example in `web/index.ts` or a small `web/model.ts`) that both `loadSounds`, the storage and `importSounds` call, with no change of behaviour and with the existing `loadSounds` tests as the guard. It stays in `web/` unless it already is in `core/`.
7. **Existing test impact.** Making `ears.sounds` a getter and adding the Worker state field must change no existing test. The one place that could notice is a test that reads `ears.sounds` by identity (`toBe`); step 1 searches for it.

## Decisions

### Messages
| Direction | Message | Content |
|---|---|---|
| main to Worker | `record-start` | `label`, `kind` |
| main to Worker | `record-stop` | `deleted`: ids the user removed |
| main to Worker | `record-end` | `sounds`: the model to use from now on (the one from `record-trained`) |
| main to Worker | `record-cancel` | nothing |
| Worker to main | `record-progress` | `t` (s) |
| Worker to main | `record-segment` | `id`, `t` (s), `durationMs`, `min`, `max` |
| Worker to main | `record-limit` | nothing |
| Worker to main | `record-trained` | `model`, `report` |
| Worker to main | `record-failed` | `message` |

`record-end` carries the model back instead of the Worker remembering the one it trained. That keeps the Worker free of a "pending model" state that a second `record-stop` could confuse, and the main thread is the one that stores it.

`record-trained` sends the whole model over the message port. A model with a background label has up to 200 vectors of 32 numbers, so it is about 100 KB as JSON. This is a feature-vector model, which the privacy rule allows, and the message stays inside the page.

### Worker-side recorder (`web/recorder.ts`)
One recorder per recording, created by `record-start`, holding: the label, the kind, the rate, the array of chunks, the cumulative sample count, a fresh `Segmenter`, the id counter and the list of ids sent. Methods: push a chunk (returns messages), finish (flush, returns messages and the joined `Float32Array`). The recorder sends `record-progress` with `t` = count divided by the rate for every chunk, so the dialog needs no clock.

The thumbnail: the segment's samples split into `min(WEB_TEACH_THUMBNAIL_BINS, length)` slices of near equal length (slice `i` covers `floor(i * n / B)` to `floor((i + 1) * n / B)`), the min and max of each. It is raw, not normalised, so the dialog can scale it for display. It is a short summary of one segment, kept in the page only while the dialog is open.

The limit: the sample count reaches `msToSamples(WEB_TEACH_MAX_RECORDING_MS, rate)` and the recorder stops collecting, keeps what it has, and sends `record-limit` once. At 48000 Hz this is about 23 MB of floats, freed when the recorder is dropped.

`record-stop` builds `Recording { label, file: WEB_TEACH_FILE_NAME, samples, sampleRate }` and calls `retrainLabel(currentModel, label, [recording], { keep })`. File name is a constant, so an example in the model has an id like `tap/teach.wav#3`, which also shows in the overlay as `nearest.id` and tells a developer that this example came from the in-app dialog.

Training cost: `retrainLabel` runs a leave-one-out over all examples of the model. With a background label this is several hundred small trainings. It runs in the Worker, so the page stays responsive, and the dialog shows "Training...". The implementer measures it for the fixture model and for one with 200 background examples and records both in "Measured values". If it is long (more than a few seconds), that is reported, not changed here.

### Pattern pause and rebuild
The Worker state gets `recorder` (or null) and `sounds` (the current model; set by `init`, `replaceSounds`, `record-end`). While `recorder` is not null, `chunk` goes to the recorder and skips the engine and the envelope. `record-end` and `record-cancel` clear the recorder and call the same build function that `replaceSounds` uses, and also reset the envelope counters (`binsDone`, the partial bin) so the overlay model restarts with the engine. `replaceSounds` itself is not changed (its Task 14 test keeps passing); `importSounds` uses it and the overlay is re-mounted on the main thread, so a counter that continues does no harm there.

On the main thread the `match` case of `route` drops a message while a dialog is open, so a message already in flight when the dialog opened cannot call a handler.

### State machine (`state.ts`)
State is a plain object with a `phase` and the data of the phase: `kind`, `label`, `target` (the examples to ask for), `examples` (number, id, `t`, `durationMs`, thumbnail, `deleted`), `elapsedMs` (from the last `record-progress`, as `t` times 1000), `finishing`, `limitReached`, `report`, `model`, `error`, `saveStored` (true, false or unknown until saved). Actions: `progress`, `segment`, `delete`, `done`, `trained`, `failed`, `limit`, `save`, `again`, `cancel`, `stored` (result of the storage write). The reducer returns the same object for an action that does not apply, so the dialog can skip redrawing by identity.

Why the quiet to recording switch uses `elapsedMs >= NOISE_FLOOR_WARMUP_MS` and not a message from the Worker: both sides use the same constant, the `Segmenter` has its calibration for exactly that long, and one message type less is one thing less to keep in sync. If a future change gives the `Segmenter` another warm-up, the constant is the one place.

`doneState(state)` and the "can save" function return `{ enabled, reason }`. Reasons are English sentences built from numbers, for example "Keep at least 5 examples. You have 3." and "Hum for 1 more second."; the second rounds up to whole seconds, never below 1.

### Dialog (`teach-dialog.ts`)
The dialog takes a state (it starts it, by `kind` and `label`), a controller, the current model (to show how many examples a label already has, and the sample rate), and callbacks `onSave(model, report)` and `onCancel()`. It returns a handle with `destroy()`. Its job is to show the state and send controller calls. It holds no logic that `state.ts` could hold.

The controller interface is the seam to Task 17:
- `start(label, kind)`, `stop(deleted)`, `end(model)`, `cancel()`, and `subscribe(handler)` for the Worker messages.
- In `listen.ts` the controller posts to the Worker it already has and routes `record-*` messages to the subscribed handler.
- In `teach.html` (Task 17) the controller posts to a Worker that has `init` with no patterns. That Worker does not run patterns. Task 17 also adds its own request for the recording samples (it needs them for the wav files). That request is not built here: Task 16 never sends samples to the page.

Shared with Task 17: `state.ts`, `format.ts`, `teach-dialog.ts`, `recorder.ts`, the record messages in `protocol.ts`. Not shared: `storage.ts` (Task 17 writes to a folder), and all of the `listen.ts` wiring (pause, overlay, `ears` methods).

Structure of the shadow tree: host, `<dialog aria-labelledby>`, `<h2 tabindex="-1">`, a status paragraph (`role="status"`), the step body (replaced per phase), a footer with the buttons. The body is replaced only when the phase changes; during `recording` only the count line, the progress, and the list change. The list is rebuilt per change (it is short).

Thumbnails: step 1 reads `draw.ts` and `waveform.ts`. If `drawWaveform` can draw a bare envelope without marks (a view with bins and no marks), the thumbnail uses it with `WEB_TEACH_THUMBNAIL_WIDTH_PX` by `WEB_TEACH_THUMBNAIL_HEIGHT_PX` and the view built from the segment's min and max scaled to the segment's own peak. If the view type needs the rolling-window fields in a way that makes this more than a few lines, the dialog draws its own bars in one small local function (about 15 lines) and says so in "Measured values". The two choices are equal for the user. Thumbnails are drawn once, when the example is added, and are not redrawn.

Focus and Esc: `showModal()` gives the focus trap and Esc. The `cancel` event from Esc is treated like a Cancel press, and `preventDefault` is called on it so the dialog closes through our own path (one close path, one cleanup). A click on the backdrop does nothing (a stray click must not throw away ten examples).

Reduced motion: the `matchMedia` query is read when the dialog opens and listened to. No CSS transitions, the `<progress>` is determinate, the thumbnails are static. With reduced motion the progress element and its text update only when the progress rule from `state.ts` says so, using `performance.now()` only to pace this display (never a displayed time; all times shown come from `t`).

Results as text: the summary lines come from `format.ts`; confused pairs are sentences; the pitch baseline is a line. A confused rate is `rate` times 100 rounded.

Saved screen: shows the report text again, the line "Saved." or the not-stored line, and a Close button. The dialog closes when Close is pressed, or at once after `onSave` for the page (see below). Decision: close at once. The saved state is shown only for `teach()`'s promise and the not-stored message would then disappear unread. So the dialog stays on the saved screen until the user presses Close, and `teach()` resolves when Save succeeded, not when Close is pressed. The model is already in use at that moment, so the dialog closing later does no harm. If the dialog is closed by Esc from this screen, nothing is cancelled (the model is already saved).

### `listen()` changes
- The start sequence: `storageKey` read; load from storage; if valid and the handlers accept it (a throwaway engine, as `listen()` already does for `o.sounds`), it replaces `sounds`. The current model moves from a `const` to a `let`, and the `sounds` property of `Ears` becomes a getter on it. Overlay mount uses the current model.
- `teach`: validates, sets `teaching` true, sets the overlay state, builds the controller, mounts the dialog, and returns a promise with two outcomes: `onSave` (store, update model, `record-end`, re-mount overlay, resolve), `onCancel` (`record-cancel`, set `listening`, reject `AbortError`). `ears.stop()` while open calls the dialog's destroy and the cancel path. A `finally` clears `teaching` on all paths.
- The overlay is re-mounted on Save and on import: `destroy()` the old one, `tryMount` with the new model and the current rate, and `setState('listening')`. After Cancel the old overlay stays, with `setState('listening')`.
- `importSounds` and `teach` share one function that applies a model (Worker, `ears.sounds`, storage, overlay).
- `exportSounds()` returns `JSON.stringify` of the current model. Step 1 checks whether a serializer for `sounds.json` already exists in `core/` or `node/`. If it is in `core/`, `exportSounds` uses it so a file written from the export equals one written by the tools; if it is only in `node/`, plain `JSON.stringify` is used and the test only requires that `loadSounds`-style validation accepts the result and that a round trip gives a deep-equal model.
- The doc comment of `listen()` names: `storageKey`, that a stored model replaces `sounds`, the rebuild and its one second of calibration, and the stale-model risk.

### Storage (`storage.ts`)
`loadStoredModel(key, storage?)` returns the model or null and warns once per failure. `saveStoredModel(key, model, storage?)` returns `{ ok: true }` or `{ ok: false, reason }`. A guard against an oversized value is not added: the browser refuses (quota) and that is the failure path already handled. The validation function of finding 6 is called by `load`. The stored string is `JSON.stringify(model)`, so it contains only the model's own fields (labels, thresholds, vectors, `pitch`, `sampleRate`, `version`). A test asserts that the stored string has no field that is a sample array by checking its size against the vector count (a model with 10 examples of 32 numbers stays below a small bound).

### E2E timing
The fake microphone plays the WAV once (`%noloop`) from the moment `listen()` opens the microphone. `teach()` is called right after `listen()` resolves, so the recording starts a fraction of a second after the file starts. The teaching WAV therefore has:
- a lead of `WEB_TEST_TEACH_LEAD_MS` (3000 ms) of the synthetic noise bed (`SYNTH_FIXTURE_LEAD_NOISE_DBFS`). The dialog's one second of quiet fits wherever in the first 2 s `record-start` lands;
- `WEB_TEST_TEACH_COPIES` (10) copies of the same synth impact, `SYNTH_FIXTURE_SOUNDS_SPACING_MS` (600) apart;
- `SYNTH_FIXTURE_TAIL_MS` of tail.
The test waits for ten thumbnails, then waits until the file's whole length plus `WEB_TEST_WAIT_SLACK_MS` has passed, and checks the count is exactly ten before pressing Done. If the real count is not ten on the implementer's machine, step 7 reports it with the evidence before the expectation is changed. A different count would mean the `Segmenter` splits or merges these impacts, which is a finding for Task 12, not something to hide.

For "a following run recognises `tap`": the page stops the first `ears`, then calls `listen({ source: <tap wav url>, sounds: <old model>, storageKey, on: { tap } })`. The old model has no `tap` label, so the `tap` handler can fire only if the stored model replaced it (requirement 6.1; `createEngine` accepts the handler without the label, it just never matches). `tap` is counted by the handler and compared to the number of impacts in a second WAV (calibration lead then `WEB_TEST_TAP_COPIES` impacts). The WAV source rate is the file's rate; the test generates the file at the rate the page reports for `AudioContext` (read in the page first), through the helper Task 14 used for the 44100 model, so the model and the input rate agree. New browser per mic test if the fake device needs it (Task 14 note); each test uses its own `storageKey`.

For "a reload restores `tap`": after Save, `page.reload()`, then `listen()` with the same key and the old model, and check that `ears.sounds.thresholds` has `tap` and that `exportSounds()` parses to a model with the `tap` label. This does not need a second microphone run.

For "Cancel": after `teach` starts and the dialog shows, press Cancel, expect the promise's rejection name `AbortError`, `ears.sounds` deep-equal to the model before, and `localStorage` without the key.

For "Done disabled below 5": the same WAV with `WEB_TEST_TEACH_COPIES` as an option set to 4 for this test (a second small WAV), expect Done `aria-disabled="true"` with the reason text visible, pressing it changes nothing, and Cancel works.

For the keyboard test: open the dialog, Tab to reach Cancel within `WEB_TEST_TAB_LIMIT` presses, Esc rejects with `AbortError`, and focus returns to the button that was used to start `teach` in the test page.

### Risks and rules
- **A taught sound can make an existing pattern worse.** A new label near an old one raises confusion. The dialog shows the confused pairs for this reason, and Cancel keeps the old model.
- **Stored model hides a new `sounds.json`.** Handled by the `base` fingerprint (finding 5). A personal model is dropped (with a warning) when the shipped model changes; the user must teach again.
- **Stale handlers after import or Save.** `createEngine` does not check pattern labels against the model (measured in Task 16: a pattern for a missing label never matches and does not throw). It does throw for a hum pattern when the model has no `pitch.baselineHz`, so an import of a model without a pitch fails the engine build. Requirement 6.8 checks this with a throwaway engine before changing anything.
- **`teach()` of an existing label replaces its examples.** A line in the dialog says so before recording.
- **Quota or blocked storage.** Handled by 5.3 and 5.4. A private window can throw on first access.
- **The Worker holds up to `WEB_TEACH_MAX_RECORDING_MS` of audio.** Bounded and freed on `record-end`, `record-cancel` and when `listen()` stops (the Worker is terminated).
- **Training time in the Worker** is measured (see above).
- **Overlay shows frozen rows while teaching.** Intended: the badge says `Teaching`.
- **Privacy.** The recording stays in the Worker. The page gets thumbnails (small summaries), the model and the report. Nothing is sent. The search of requirement 8.3 is a step in the tasks.
- **Task 17 fit.** The controller seam, the record messages, the shared files and the missing "give the samples" request are described above. Task 17 adds that request as an additive option on `record-stop` and may need `record-trained` to carry a samples array when asked.

## Tests
| # | Test | Where | Requirement |
|---|---|---|---|
| 1 | state order quiet, recording, review, saved; hum and background start in recording; cancel from every phase but saved | `test/teach-state.test.ts` | 2.2, 2.3, 2.9 |
| 2 | segments add, number stable after delete, duplicate ignored, unknown delete ignored | `test/teach-state.test.ts` | 2.4, 2.5 |
| 3 | Done disabled below 5 with the reason text; enabled at 5; disabled while quiet and while finishing; hum and background time rules | `test/teach-state.test.ts` | 2.6, 2.7 |
| 4 | property: random action sequences never leave the allowed phases, never give a negative count, and an inapplicable action returns the same object | `test/teach-state.test.ts` | 2.9 |
| 5 | `validateLabel` accepts and rejects the table (including `background`, `hum`, 32 and 33 characters, upper case, empty) | `test/teach-state.test.ts` | 2.10 |
| 6 | progress update rule | `test/teach-state.test.ts` | 2.11 |
| 7 | text lines for step, report, confused pair (none, one), warnings, hum pitch, replace line; no `NaN` for any input | `test/teach-state.test.ts` | 3 |
| 8 | recorder: ids from live chunks equal the ids `retrainLabel` gives for the same samples, for random chunk sizes | `test/teach-recorder.test.ts` | 1.5 |
| 9 | `record-start` to `record-stop` through `handleWorkerMessage` with synth impacts: progress, segments, then `record-trained` with the label added and a report; a deleted id is absent from the model | `test/teach-recorder.test.ts` | 1.3 to 1.6 |
| 10 | during a recording no `match`, `segment` or `event` message appears even for a pattern sound; after `record-end` the new model is used by a fresh engine; after `record-cancel` the old one | `test/teach-recorder.test.ts` | 1.3, 1.7 |
| 11 | a sound in the first 1000 ms of the recording is not reported (own calibration) | `test/teach-recorder.test.ts` | 1.4 |
| 12 | 4 kept examples answer `record-failed` with a message; no throw | `test/teach-recorder.test.ts` | 1.6 |
| 13 | hum recording sets `pitch.baselineHz`; background recording adds background examples; neither sends `record-segment` | `test/teach-recorder.test.ts` | 1.5, 6.10 |
| 14 | the limit sends `record-limit` once and stops collecting; protocol misuse answers `error` and changes nothing | `test/teach-recorder.test.ts` | 1.8, 1.9 |
| 15 | storage round trip; no entry; corrupt text; wrong version; wrong shape; a throwing `getItem`; a throwing `setItem`; stored string has no sample-sized array | `test/teach-storage.test.ts` | 5 |
| 16 | the model that `loadSounds` accepts is accepted by storage and `importSounds` validation | `test/teach-storage.test.ts` | 5.2, 6.8 |
| 17 | `teach("tap")` on the fake microphone adds `tap`; a following WAV run fires the `tap` handler for each impact | `test/web/teach.spec.ts` | 6.5, 7.2 |
| 18 | reload with the same `storageKey` restores `tap`; another key does not | `test/web/teach.spec.ts` | 6.1 |
| 19 | Cancel rejects with `AbortError`, keeps the model, stores nothing; `stop()` while open does the same | `test/web/teach.spec.ts` | 6.6 |
| 20 | Done `aria-disabled` below 5 with a visible reason, pressing does nothing | `test/web/teach.spec.ts` | 4.5 |
| 21 | keyboard: focus inside, Tab reaches Cancel, Esc cancels, focus returns | `test/web/teach.spec.ts` | 4.7 |
| 22 | no handler fires while the dialog is open and handlers fire again after Cancel (after the calibration second) | `test/web/teach.spec.ts` | 6.4 |
| 23 | style isolation: a page `h1` keeps its size; a page `body` rule does not reach the dialog | `test/web/teach.spec.ts` | 4.1 |
| 24 | reduced motion: no animation or transition on the dialog and no `requestAnimationFrame` call from `dist/tokk.js` for it | `test/web/teach.spec.ts` | 4.8 |
| 25 | `importSounds` of an invalid text throws and changes nothing; of a valid text replaces the model, stores it and survives a reload; `exportSounds` round trips | `test/web/teach.spec.ts` | 6.8 |
| 26 | `teach` argument errors: bad label, `examples` of 4, no `ui`, while open, while paused, after stop | `test/web/teach.spec.ts` | 6.3 |
| 27 | the extended contrast pairs | the existing overlay theme test | 4.9 |

Test-only constants at the top of `teach.spec.ts` (with units): `WEB_TEST_TEACH_LEAD_MS`, `WEB_TEST_TEACH_COPIES`, `WEB_TEST_TAP_COPIES`, `WEB_TEST_WAIT_SLACK_MS`, `WEB_TEST_SETTLE_MS`, `WEB_TEST_TAB_LIMIT`.

## Measured values
Filled in by the implementer on 2026-11-20 (Windows, Chrome 157 through Playwright, fake microphone at 48000 Hz).
- Model validation of `loadSounds`: it was inline in `web/load-sounds.ts` (`isModelShape` plus the version check). It moved, with no change of behaviour, to `checkModel` in `web/model.ts`, which `loadSounds`, the storage and `importSounds` call. The 8 `loadSounds` tests passed before and after. No `sounds.json` serializer exists in `core/` or `node/` (only `JSON.stringify` in the training tools), so `exportSounds()` uses `JSON.stringify`.
- Existing tests that read `ears.sounds` by identity: none (a search of `test/` for `ears.sounds` found no hit).
- `drawWaveform` draws the thumbnails: a `WaveformView` with bins and no marks is enough, so no local drawing function was written. The thumbnail view is scaled to the segment's own peak.
- Segments the dialog found in the teaching WAV: 10 (and the Node `Segmenter` finds the same 10, checked in the global setup).
- Training time in the Worker (`record-stop`): 23 ms for the fixture model (low, mid, ring) plus 10 `tap` examples; 163 ms for a model with 200 background examples plus the 10 `tap` examples. Stopping a 40 s background recording (200 windows) took 796 ms.
- Stored JSON for the model low + mid + `tap` (10 examples each), with the wrapper: 19986 bytes. With 200 background examples the model alone is 155314 bytes.
- Size of `dist/tokk.js`: 134953 bytes before, 181535 bytes after.
- Runtime: `test/web/teach.spec.ts` about 52 s (11 tests, three of them with the fake microphone take 17.5 s, 11.1 s and 7.2 s); `npm run test:web` 104 s with 23 tests, twice; the smoke test 8.8 s (9.6 s wall).
- Vitest count: 571 passed and 2 todo before (27 files), 646 passed and 2 todo after (30 files).
- Contrast ratios of the colour pairs the dialog adds to the test: waveform on panel 8.63 (progress bar), background mark on panel 7.04 (dialog border), text on header 12.17 (buttons). The first choice for the border, `baseline` on panel, measured 2.97 and failed the 3 to 1 rule, so the border uses `backgroundMark`.
- Privacy search (requirement 8.3) in `web/teach-ui/`, `web/recorder.ts`, `web/record-kind.ts`, `web/model.ts` and `web/protocol.ts`: no hit for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `Image`, `src =`; `localStorage` appears only in `web/teach-ui/storage.ts`.

## Differences from the first spec text
- `createEngine` does not check pattern labels against the model (a pattern for a missing label never matches). It throws for a hum pattern when the model has no `pitch.baselineHz`. Requirements 6.1 and the "Risks" text now say so. The E2E import test uses a hum pattern to show the handler check.
- `TeachReport` was not exported from `web/index.ts` or `core/index.ts`. `web/index.ts` now exports the type `TeachReport` and the new type `TeachOptions` (types only, no runtime export name changes, `test/public-api.test.ts` is unchanged).
- Playwright treats `aria-disabled="true"` as disabled, so the E2E test presses the disabled Done button with `force: true`.
- The fake microphone file belongs to the browser launch, so the tests that need another file (4 copies) launch their own Chrome through a fixture in `teach.spec.ts` and close it afterwards. The other new tests use a WAV `source`.