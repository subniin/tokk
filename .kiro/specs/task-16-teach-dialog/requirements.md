# Requirements: Task 16, in-app teach dialog

## Introduction
Task 16 is the fifth task of plan 2 (browser layer). It adds `ears.teach(label, { ui: true, examples })`: a dialog inside the running page where the end user teaches the engine one sound (or the hum pitch, or the background). The dialog asks for one second of quiet, collects the sounds the user makes, lets the user delete wrong examples, trains the model with `retrainLabel` (Task 12), shows the leave-one-out accuracy as text, and saves the new feature-vector model to `localStorage`. `listen()` also gets a `storageKey` option, an `ears.sounds` getter and `exportSounds()` / `importSounds(json)`.

Task 16 covers Review Focus 4 of the plan: a clap recorded ten times can give nine or twelve segments. The user can delete single examples, and "Done" is blocked below 5 examples with the reason shown.

Task 15 left these files that this task builds on: `web/listen.ts` (the `route` function, `pause`/`resume`/`stop`, an `Ears` object with `sounds` as a plain property), `web/protocol.ts` (message unions, `handleWorkerMessage`, `replaceSounds`), `web/overlay/` (`mountOverlay` with `setState('teaching')`, `drawWaveform`, the pure waveform model), `web/constants.ts`, `core/teach.ts` (`retrainLabel`, `TeachReport`) and `test/web/` (fixture, instrument and path helpers, the fake microphone setup of Task 14).

| Consumer | What it uses from this task |
|---|---|
| Task 17 (`teach.html`) | `web/teach-ui/state.ts`, `format.ts`, `teach-dialog.ts` (mounted with its own controller, no `listen()` engine running patterns), `web/recorder.ts` and the record messages of the Worker. It adds the folder reading and writing and the "give me the samples" option itself. |
| Task 18 (power, agents) | The final `listen()` options and `Ears` methods for `integrate.md` |
| Task 19 (`examples/hello`) | `storageKey` default behaviour, so a taught sound survives a reload |

Facts checked before this spec was written (step 1 of the tasks checks them again):
- `retrainLabel(model, label, recs, { keep })` builds the examples of `label` from the segments of the recordings. An example id is `<label>/<file>#<n>`, where `n` is the index of the segment in the recording. `keep` filters those ids. For `hum` it ignores `keep` and sets `pitch.baselineHz` from the median pitch. For `background` it adds fixed 300 ms windows over the whole file (ids `background/<file>#w<n>`) besides the segments. It throws `TooFewExamplesError` when any label has fewer than `MIN_EXAMPLES_PER_LABEL` (5) examples, except for `hum`.
- `retrainLabel` puts `sample-rate-mismatch` in `warnings` when the recording rate differs from `model.sampleRate`. It does not change `model.sampleRate`.
- The core `Segmenter` has its own 1000 ms (`NOISE_FLOOR_WARMUP_MS`) calibration. A sound inside it is lost. The running engine has such a calibration too, but it has run long since, so the dialog needs a fresh `Segmenter` on the teaching recording.
- `replaceSounds` in the Worker builds a new engine, so its clock and its calibration restart. The envelope counter does not restart there (Task 15 design, finding 2).
- `OverlayHandle.setState('teaching')` already exists. The overlay builds its colours and thresholds from the model it was mounted with.
- The audio never leaves the Worker in this task. The page only receives numbers: segment times, small min/max envelopes, the model and the report.

## Requirements

### Requirement 1: Protocol and the Worker recorder
**User story:** As a user of the dialog, I want my teaching recording to be analysed on its own, without the running patterns firing.

#### Acceptance Criteria
1. `web/protocol.ts` SHALL get these main-to-Worker messages: `record-start` (label, kind), `record-stop` (the ids the user deleted), `record-end` (the model to use from now on), `record-cancel`. It SHALL get these Worker-to-main messages: `record-progress`, `record-segment`, `record-limit`, `record-trained`, `record-failed`. All message members are plain data (strings, numbers, typed arrays, the model, the report), so `structuredClone` works.
2. THE `kind` of a recording SHALL be `sound` for any label other than `hum` and `background`, `hum` for the label `hum`, and `background` for the label `background`. THE Worker SHALL derive it from the label and ignore a `kind` that disagrees.
3. WHILE a recording is open, THE Worker SHALL send every chunk only to the recorder. It SHALL NOT push it to the engine, so no `match`, `segment` or `event` message is produced. It SHALL NOT send `envelope` messages for it.
4. THE recorder SHALL keep the chunks of one recording in memory in the Worker, run a fresh `Segmenter` for the sample rate over them (its own `NOISE_FLOOR_WARMUP_MS` calibration), and send one `record-progress` per chunk with `t` in seconds, equal to the cumulative sample count divided by the sample rate.
5. FOR `kind` `sound`, THE recorder SHALL send one `record-segment` per segment the `Segmenter` finishes, with `id`, `t` (s), `durationMs` and a thumbnail envelope: `min` and `max` arrays of `WEB_TEACH_THUMBNAIL_BINS` bins (fewer if the segment has fewer samples). The id SHALL be `<label>/<WEB_TEACH_FILE_NAME>#<n>`, where `n` counts the segments of this recording from 0 in the order they are finished. THE ids SHALL equal the ids that `retrainLabel` gives to the same segments of the same recording (tested). THE recorder SHALL send no `record-segment` for `hum` and `background`.
6. WHEN `record-stop` arrives, THE Worker SHALL flush the `Segmenter` (sending `record-segment` for any segment it still holds), build one `Recording` from all the samples (label, file `WEB_TEACH_FILE_NAME`, the context sample rate), and call `retrainLabel` with the current model, the label and `keep` = every id the recorder has sent minus the deleted ids. FOR `hum` and `background` it SHALL pass no `keep`. On success it SHALL answer `record-trained` with the new model and the `TeachReport`. On `TooFewExamplesError` or any other error it SHALL answer `record-failed` with a message in English that says what to do. The recording samples SHALL stay in the Worker.
7. WHEN `record-end` arrives with a model, THE Worker SHALL drop the recording samples, use that model as its current model, and build a new engine for it (same patterns and current mode). WHEN `record-cancel` arrives, THE Worker SHALL drop the recording samples and build a new engine for the model it had before. In both cases the envelope counters SHALL restart together with the engine, so the overlay's time axis stays consistent (Task 15 design, finding 2). Patterns SHALL fire again once the new engine has finished its own calibration.
8. WHEN a recording reaches `WEB_TEACH_MAX_RECORDING_MS`, THE recorder SHALL stop collecting samples and send `record-limit` once. The dialog SHALL then show the limit as text and let the user press Done or Cancel.
9. A `record-start` while a recording is open, a `record-stop` or `record-end` or `record-cancel` without a recording, and a `record-start` before `init` SHALL answer an `error` message and change nothing.
10. THE recorder and its pure helpers SHALL live in `web/recorder.ts` with no DOM type, no Node module, no clock, no randomness and no network, as `protocol.ts` does. THE Worker state SHALL also remember the current model (needed by `record-cancel`).
11. A flush message for the wav source that arrives while a recording is open SHALL be ignored for the engine.

### Requirement 2: The pure state machine
**User story:** As a maintainer, I want the dialog's logic tested without a browser.

#### Acceptance Criteria
1. `web/teach-ui/state.ts` SHALL export a pure reducer and its types. It SHALL import no DOM type and use no clock, randomness or storage.
2. THE phases SHALL be `quiet`, `recording`, `review`, `saved` and `cancelled`. For `kind` `sound` the order is `quiet` to `recording` to `review` to `saved`. For `hum` and `background` the dialog starts in `recording` (no quiet step, since those kinds need no calibration).
3. IN `quiet`, WHEN a `record-progress` with `t` times 1000 at least `NOISE_FLOOR_WARMUP_MS` arrives, THE phase SHALL become `recording`. The quiet progress SHALL be the elapsed ms over `NOISE_FLOOR_WARMUP_MS`, at most 1.
4. IN `recording`, a `record-segment` SHALL add an example with a number (its index plus 1, stable: deleting does not renumber), its id, `t`, `durationMs` and thumbnail. A segment that arrives in `quiet` SHALL be added too and move the phase to `recording`. A duplicate id SHALL be ignored.
5. Deleting an example SHALL mark it deleted. Deleting an unknown or already deleted id SHALL change nothing. A deleted example SHALL NOT count as kept.
6. THE function that answers whether Done is enabled SHALL return `{ enabled, reason }`. For `kind` `sound` it SHALL be enabled only in `recording`, when not already finishing, with at least `MIN_EXAMPLES_PER_LABEL` kept examples. WHEN disabled, `reason` SHALL be English text that names what to do: in `quiet` that the quiet second is not over; with too few examples the number kept and the minimum (for example "Keep at least 5 examples. You have 3."); while finishing that the model is being trained. For `hum` it SHALL be enabled once the recording is at least `WEB_TEACH_HUM_RECORD_MS` long. For `background` once at least `WEB_TEACH_BACKGROUND_RECORD_MS` long. Their `reason` says how much time is left.
7. THE Done action SHALL mark the recording as finishing. It SHALL change nothing when Done is not enabled.
8. `record-trained` in a finishing `recording` SHALL move to `review` with the model and the report. `record-failed` SHALL move to `review` with an error message and no report. IN `review`, "Save" SHALL be enabled only with a report, and, for `hum`, only when the report has no `no-pitch-found` warning. The reason text SHALL say why when it is not.
9. Save in `review` SHALL move to `saved`. "Record again" SHALL return to the first phase of the kind with an empty example list and the progress at 0. Cancel SHALL move any phase except `saved` to `cancelled`. Any action that does not apply to the current phase SHALL return the same state object.
10. `state.ts` SHALL also export `validateLabel(label)`: the rule `^[a-z][a-z0-9-]{0,31}$` (the same as Task 17). It SHALL return a message in English that states the rule when it fails, and `null` when the label is fine. THE words `background` and `hum` SHALL be valid.
11. `state.ts` SHALL also export a pure function that tells whether a progress display should be updated now, from `reducedMotion`, the current time in ms and the time of the last update in ms: always yes without reduced motion; at most once per `WEB_TEACH_PROGRESS_REDUCED_MOTION_MS` with it.

### Requirement 3: Result text
**User story:** As a user, I want to read the result, not decode a picture.

#### Acceptance Criteria
1. `web/teach-ui/format.ts` SHALL export pure functions that turn the state and the report into English text lines. They SHALL return no `NaN`, `undefined` or `Infinity` text for any input.
2. THE report SHALL be shown as one line per label: the label, the number of examples and the leave-one-out accuracy as a whole percent (for example "tap: 100% of 10 examples were recognised when left out one by one").
3. EVERY confused pair SHALL be one sentence that names both labels and the rate as a whole percent (for example "tap is sometimes heard as clap (20% of tap examples)"). WHEN there are no confused pairs, a line SHALL say so.
4. EVERY warning of the report SHALL be shown with its `message`. FOR `hum`, a line SHALL show the new pitch baseline in Hz, rounded to a whole number.
5. THE texts for the steps SHALL be: "Stay quiet for 1 second", "Make the sound N times" (N is the `examples` target), a count line "M of N heard, K kept", the hum and background instructions of requirement 6.4 and 6.5, "Training...", and the saved line (requirement 5.4).
6. IF the label already has examples in the current model, a line SHALL say that its existing examples will be replaced and how many there are.

### Requirement 4: The dialog
**User story:** As an end user, I want a clear dialog that works with the keyboard and does not move more than needed.

#### Acceptance Criteria
1. `web/teach-ui/teach-dialog.ts` SHALL build a `<dialog>` inside a Shadow DOM (open root, one host element appended to `document.body`, `data-tokk-teach` on the host) and open it with `showModal()`. Its style SHALL be a string in the file, with `all: initial` on the host as the overlay does. The page's styles SHALL NOT reach it and its styles SHALL NOT reach the page. It SHALL build every node with `createElement` and `textContent`, never `innerHTML` with data.
2. THE dialog SHALL have an accessible name (the heading, `aria-labelledby`), show the steps of requirement 3.5, and show one status line (`role="status"`, polite) that gives the current instruction.
3. DURING `quiet`, THE dialog SHALL show a determinate `<progress>` element and the text "Stay quiet for 1 second". It SHALL use no indeterminate bar.
4. DURING `recording` for kind `sound`, THE dialog SHALL show the count line and a numbered list of examples. EACH example SHALL show its number, its start time in s and duration in s as text, a small waveform thumbnail (a canvas with `role="img"` and a text label), and a "Delete" button whose accessible name includes the number ("Delete example 3"). WHEN the list gets longer than the target, the dialog SHALL NOT end the recording by itself. After a delete, focus SHALL move to the next example's Delete button, or to the Done button when none is left.
5. THE "Done" button SHALL use `aria-disabled` (not the `disabled` attribute) while it is not enabled, SHALL stay focusable, SHALL be linked to the reason text with `aria-describedby`, and SHALL do nothing when activated while disabled. The reason text SHALL be visible next to it, not only in a tooltip. The Save button SHALL follow the same rule.
6. IN `review`, THE dialog SHALL show the lines of requirement 3 and the buttons "Save", "Record again" and "Cancel". WHEN training failed, it SHALL show the error text and the buttons "Record again" and "Cancel".
7. THE dialog SHALL be fully usable with the keyboard: every control is a native `button` with a visible focus outline (2 px, at least 3 to 1 against its background), focus is inside the dialog when it opens (on the heading, which has `tabindex="-1"`, or the first control), focus stays inside while it is open (native modal behaviour), and focus returns to the element that had it before the dialog opened when the dialog closes. Esc SHALL act as Cancel, and the Cancel button text SHALL say so ("Cancel (Esc)").
8. THE dialog SHALL respect `prefers-reduced-motion` (`ui.md`): no CSS transition or animation, no rolling waveform (thumbnails are drawn once per segment), and the progress display updates at most once per `WEB_TEACH_PROGRESS_REDUCED_MOTION_MS` when reduced motion is on. It SHALL use no `requestAnimationFrame` for the dialog's own content.
9. THE text colours SHALL reach 4.5 to 1 against their background, and the thumbnail and focus colours 3 to 1. THE dialog SHALL reuse the colour constants of `web/overlay/theme.ts` where they fit, so the existing contrast test covers them, and any new pair SHALL be added to that test.
10. No result SHALL be shown by colour alone (`ui.md`). No Halloween element SHALL be used. All visible text SHALL be English.
11. THE dialog SHALL talk to its engine through a small controller object that it receives when it is mounted: start a recording, stop it with the deleted ids, end it with a model, cancel it, and subscribe to the record messages. THE dialog SHALL NOT import `listen.ts`, `mic.ts` or the overlay's mount function. Reusing the overlay's drawing function for thumbnails is allowed where simple (design.md, "Thumbnails").
12. THE dialog SHALL remove its host element, listeners and any timer when it closes, whatever the way it closed. After close, no sample and no thumbnail data SHALL stay referenced.

### Requirement 5: Storage
**User story:** As an end user, I want my taught sound to be there after a reload, and a broken browser store to not break the app.

#### Acceptance Criteria
1. `web/teach-ui/storage.ts` SHALL store the model of `SoundModel` JSON in `localStorage` under the given key (default `WEB_STORAGE_KEY_DEFAULT`, `'tokk:sounds'`). The value SHALL be the feature-vector model only (privacy rule): no sample, no recording.
2. Loading SHALL return the model, or `null` when there is no entry. A corrupt entry (not JSON, not an object, a wrong `version`, a wrong shape) SHALL be ignored with one `console.warn` that names the key and the reason, and SHALL return `null`. An entry whose `base` differs from the fingerprint of the current `o.sounds` SHALL be ignored the same way (the developer shipped a new `sounds.json`), so new shipped labels are never hidden by an old personal model. THE validation SHALL be the one `loadSounds` uses (design.md, "Validation"), so a model that `loadSounds` accepts is accepted here.
3. Every access to `localStorage` SHALL be inside `try`/`catch`. Access can throw (blocked storage, private mode, a sandboxed frame). A throw while loading SHALL return `null` with a warning. A throw while saving (including a full store) SHALL return a failure result with the reason, log a `console.warn`, and SHALL NOT throw. THE taught model SHALL stay in use for this session.
4. WHEN saving failed, THE saved screen of the dialog SHALL say so as text ("Saved for this session only. The browser did not allow storing it.") and `teach()` SHALL still resolve.
5. The functions SHALL take the storage object as an optional last argument (default `window.localStorage` read inside the `try`), so vitest tests them with a stub.

### Requirement 6: `listen()`, `ears.teach` and the model methods
**User story:** As a developer, I want `ears.teach(label, { ui: true })` to resolve with the report, and the taught model to be used without more code.

#### Acceptance Criteria
1. `ListenOptions` SHALL get `storageKey?: string` (default `'tokk:sounds'`). On start, WHEN storage holds an entry with a matching `base` and a valid model that the handlers' patterns accept (checked as `listen()` already checks `o.sounds`), THAT model SHALL replace `o.sounds` for this run, and `ears.sounds` SHALL return it. WHEN the handlers' patterns are not accepted with the stored model (`createEngine` throws, which Task 16 measured to happen for a hum pattern when the model has no `pitch.baselineHz`; a pattern for a label the model lacks does not throw, it only never matches), `listen()` SHALL ignore it with one `console.warn` that names the reason, and use `o.sounds`.
2. `Ears` SHALL get `readonly sounds` as a getter that returns the current model (it changes after a Save or an import), `teach`, `exportSounds(): string` and `importSounds(json: string): void`.
3. `ears.teach(label, { ui: true, examples })` SHALL validate before it opens anything: `label` with `validateLabel` (rejects with `RangeError` and its message), `examples` an integer of at least `MIN_EXAMPLES_PER_LABEL` (default `RECOMMENDED_EXAMPLES_PER_LABEL`; rejects with `RangeError`), `ui` is `true` (without it rejects with an `Error` that says this version needs `{ ui: true }`), `listen()` not stopped, not paused and no other dialog open (reject with an `Error` that says what to do). `examples` is the target shown in the text. It is ignored for `hum` and `background`.
4. WHEN the dialog opens, THE overlay (if mounted) SHALL get `setState('teaching')`, `pause()` and `resume()` SHALL be ignored while the dialog is open, and `match` messages SHALL NOT call any handler (also ones already in flight). `setMode()` SHALL still work and apply to the engine that is built after the dialog.
5. WHEN the user presses Save, THE dialog SHALL tell the Worker (`record-end` with the new model), `ears.sounds` SHALL become the new model, the model SHALL be stored (requirement 5), the overlay (if mounted) SHALL be mounted again for the new model (its thresholds and colours come from the model) and set back to `listening`, and `teach()` SHALL resolve with the `TeachReport` of the training.
6. WHEN the user presses Cancel or Esc, or `ears.stop()` is called while the dialog is open, THE Worker SHALL get `record-cancel`, the model SHALL stay as it was, nothing SHALL be stored, the overlay SHALL go back to `listening`, and `teach()` SHALL reject with a `DOMException` named `AbortError`.
7. THE recording samples SHALL be dropped when the dialog closes. THE only things stored SHALL be the feature-vector model. No recording SHALL be written anywhere, and no audio SHALL be sent over the network.
8. `exportSounds()` SHALL return the current model as JSON text. `importSounds(json)` SHALL parse and validate the text like `loadSounds` and throw an English error that names the problem when it fails, BEFORE anything changes. It SHALL also check the handlers' patterns against the imported model like requirement 6.1 and throw when one would fail. On success it SHALL replace the model in the Worker (`replaceSounds`), make `ears.sounds` return it, store it like a Save, and re-mount the overlay. It SHALL throw when a dialog is open or `listen()` was stopped.
9. THE Worker rebuild after Save, Cancel or import SHALL be documented in the `listen()` doc comment: patterns recognise again after the new engine's own calibration (1 s of the microphone running).
10. THE `hum` label SHALL update `pitch.baselineHz` and the `background` label SHALL replace the background examples, both through `retrainLabel`. THE dialog SHALL ask for what requirement 3.5 and the design say, and nothing more.
11. IF a model with a different `sampleRate` than the microphone is trained, the report's `sample-rate-mismatch` warning SHALL be shown as text in the review step.

### Requirement 7: Tests
**User story:** As a maintainer, I want the failure paths a user meets first to be tested.

#### Acceptance Criteria
1. THE vitest tests SHALL cover: the state machine order, segment add and delete, Done disabled below 5 with the reason, the hum and background Done rules, every invalid action, `validateLabel`, the progress update rule, the text functions (including the no-`NaN` property), the storage round trip, a corrupt entry, a wrong version, a throwing storage, a failed save, and the Worker recorder through `handleWorkerMessage` (design.md, "Tests").
2. THE Playwright tests SHALL cover: `teach("tap")` with the fake microphone adds a `tap` label and a following run recognises `tap`; a page reload with the same `storageKey` restores `tap`; Cancel rejects with `AbortError` and keeps the old model; a keyboard run through the dialog; `Done` disabled below 5 in the real dialog; style isolation of the dialog.
3. No existing test SHALL change, except where design.md names it. `test/public-api.test.ts` SHALL NOT change unless step 1 of the tasks shows that a runtime export name changes. In that case the change is named in design.md and is the requirement of this task, not a way to pass a bug.
4. EVERY new test with a time, a rate or a count SHALL use named constants with the unit in the name. EVERY time `t` in a test SHALL be a sample count divided by the sample rate.

### Requirement 8: Constants, privacy and layers
**User story:** As a maintainer, I want the rules of the project kept.

#### Acceptance Criteria
1. New constants SHALL be in `web/constants.ts` with the unit in the name where there is one: `WEB_TEACH_THUMBNAIL_BINS` (a count), `WEB_TEACH_HUM_RECORD_MS` (2000), `WEB_TEACH_BACKGROUND_RECORD_MS` (10000), `WEB_TEACH_MAX_RECORDING_MS` (120000), `WEB_TEACH_PROGRESS_REDUCED_MOTION_MS` (1000), `WEB_TEACH_THUMBNAIL_WIDTH_PX`, `WEB_TEACH_THUMBNAIL_HEIGHT_PX`, `WEB_TEACH_FILE_NAME`, `WEB_STORAGE_KEY_DEFAULT`. Constants of `core/constants.ts` (`NOISE_FLOOR_WARMUP_MS`, `MIN_EXAMPLES_PER_LABEL`, `RECOMMENDED_EXAMPLES_PER_LABEL`, `HUM_LABEL`, `BACKGROUND`, `MODEL_VERSION`) SHALL be imported, not copied. No sample count SHALL be hard-coded: every sample count comes from a time and the sample rate.
2. `web/` SHALL NOT import `fs` or `path`. `core/` SHALL stay pure; the only `core/` change allowed by this task is none (requirement 1 needs no change there). If step 1 finds that the model validator must move into `core/` to be shared, that move is the only exception and it SHALL change no behaviour.
3. NO code in this task SHALL send audio, a sample, a thumbnail or a model over the network, or write a sample to storage. Searching `web/teach-ui/` and `web/recorder.ts` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `Image` and `src =` SHALL give no hit (`localStorage` only in `storage.ts`).
4. `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run build`, `npm run test:web` and `npm run check:public-api` SHALL pass at the end.
