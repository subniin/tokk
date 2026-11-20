# Requirements: Task 17, developer teach page `teach.html`

## Introduction
Task 17 is the sixth task of plan 2 (browser layer). It adds `teach.html`, a static page at the repository root for developers. The developer picks a project folder, types a sound name, records the sound ten times in the teach dialog of Task 16, checks the result, saves `sounds/<name>/<name>-NN.wav` and `sounds.json`, and tests the new model at once with the debug overlay. The plan's design table row "teach page" reads: sound name input, 1 second of quiet, 10 recordings (segments shown, examples can be deleted), test now, save `sounds/<name>/*.wav` and `sounds.json`.

The main promise of this task: the `sounds.json` that the page writes is the same model as the one `npm run sounds:rebuild <folder>/sounds` writes for the same folder. "The same" means the same JSON structure and key order, exactly equal non-float fields (`version`, `k`, `sampleRate`, the labels, every example `id` and `label`, the threshold keys, the presence of `pitch`), every number equal within a relative 1e-9 or an absolute 1e-12, and the same `classifyVector` result (`kind`, `label`, `nearest.id`) for every example vector with both models. It does not mean the same bytes: V8's `Math` functions give different last bits in Chrome and in Node (design.md, "Cross-engine numbers"), so a browser-built and a Node-built `sounds.json` cannot be byte-equal. What stays byte-exact: the text format (`JSON.stringify(model, null, 2)` plus one `\n`), the wav files the page writes (integers, the output of `writeWav`) and the files that already were in the folder. The plan's completion check "`teach.html`'s `sounds.json` = `npm run sounds:rebuild`" is read in this sense (the plan file in `docs/_planning/` is not changed by this task).

Task 16 left these parts that this task builds on (the Task 16 design marks them "shared with Task 17"): `web/teach-ui/state.ts` (reducer, `validateLabel`), `web/teach-ui/format.ts`, `web/teach-ui/teach-dialog.ts` (mounted with a `TeachController`), `web/recorder.ts`, the record messages in `web/protocol.ts`, `web/record-kind.ts`. Task 16 left out on purpose: a way for the page to get the recording samples (the Task 16 design says Task 17 adds it as an additive option on `record-stop`). `web/teach-ui/storage.ts` and the `listen.ts` wiring are not used by this page, apart from `listen()` itself for "Test now".

| Consumer | What it uses from this task |
|---|---|
| Task 18 (power, agents, `integrate.md`) | The URL and the steps of the page, for the integration guide |
| Task 19 (`examples/hello`, README) | The page as the way to teach a sound, its URL and the folder rule |
| Person check of plan 2 | Teaching one new sound with a real microphone on this page |

Facts checked before this spec was written (step 1 of the tasks checks them again):
- `npm run sounds:rebuild [soundsDir]` reads `<soundsDir>/<label>/*.wav` through `teachFromDir` and writes `<soundsDir>/../sounds.json` as `JSON.stringify(model, null, 2)` plus one `\n`. It writes nothing when `teachFromRecordings` throws `TooFewExamplesError`. It refuses to overwrite a target that exists and is not a sounds model (`version === 1` and an `examples` array).
- `teachFromDir` takes every directory entry that does not start with `.` as a label folder (any name, in code-unit order), and in each one every file entry whose name ends with `.wav` in any letter case (a file name that starts with `.` is included). A label folder with no such file is passed as `emptyFolders`. It calls `teachFromRecordings(recs, { emptyFolders })`, which sorts the recordings itself.
- `core/wav.ts` has `readWav(bytes)` and `writeWav(samples, sampleRate)` (16-bit PCM, mono, 44-byte header, rounding and clamping). `writeWav` then `readWav` does not give back the same floats, so the model must be trained from the samples read back from the bytes that are written, never from the recorded floats.
- The `Segmenter` loses any sound in the first `NOISE_FLOOR_WARMUP_MS` (1000 ms) of a file. A wav file that holds only one cut-out segment would teach nothing.
- `retrainLabel` replaces the examples of a label. `teachFromRecordings` over files adds whatever files exist. The two do not give the same model, so the page cannot show the `retrainLabel` result as the model it saves.
- `TeachDialogOptions.onSave` returns `{ stored }` synchronously, and the dialog shows a line that says the replaced example count (`replaceLine`). Both fit `listen()` and not a page that writes files.
- The dev server (`npm run dev`, `scripts/build.ts`) serves the repository root on `http://localhost:5173/` and rebuilds only `dist/tokk.js`.
- `showDirectoryPicker()` cannot give access to the parent of the picked folder.

## Glossary
- **Project folder**: the folder the developer picks. It holds `sounds/` and `sounds.json`, for example `examples/hello`.
- **Sounds folder**: `<project folder>/sounds`, the folder that `npm run sounds:rebuild` is given.
- **Take**: one recording made in the dialog, from Record to Done.
- **Clip**: the part of a take that is written as one wav file.

## Requirements

### Requirement 1: The page and its bundle
**User story:** As a developer, I want to open one page from the dev server and teach a sound, without writing code.

#### Acceptance Criteria
1. `teach.html` SHALL be a static page at the repository root that loads one module script, `/dist/teach-page.js`. All visible text SHALL be English. It SHALL have one `h1`, a `main` element and one section per step: Folder, Sound name, Record, Result, Test now.
2. `scripts/build.ts` SHALL bundle `web/teach-page.ts` into `dist/teach-page.js` (browser ESM, with the Worker source plugin) in `npm run dev`, rebuilt on save like `dist/tokk.js`. `npm run build` SHALL NOT change: the npm package gets no new file (the page is for developers who clone the repository).
3. WHEN `npm run dev` runs, THE page SHALL open at `http://localhost:5173/teach.html`. THE microphone works there without HTTPS because the host is `localhost`.
4. THE page SHALL follow `ui.md`: every control is a native control with an accessible name and a visible focus outline, text contrast at least 4.5 to 1 and graphics at least 3 to 1, every result also shown as text, no CSS transition or animation, no Halloween element. The page's own styles SHALL be in `teach.html` and SHALL NOT reach the dialog or the overlay (both are in a Shadow DOM).
5. THE page SHALL reuse the Task 16 dialog parts (`state.ts`, `format.ts`, `teach-dialog.ts`, `recorder.ts`, the record messages) for recording, the live segment thumbnails, deleting examples and the report. Page-only code SHALL be the folder access, the sound name input, the save and download step, and the "Test now" view.
6. THE microphone SHALL be opened with `openMic` from `web/mic.ts` (the constraints of `web-audio.md`) only after a click on Record, and closed when the dialog closes. Only one microphone stream SHALL be open at a time: Record is disabled while "Test now" runs, and "Test now" is disabled while the dialog is open.

### Requirement 2: Picking and reading the folder
**User story:** As a developer, I want the page to read the sounds I already have, so the model it writes contains all of them.

#### Acceptance Criteria
1. THE Folder step SHALL have a "Pick project folder" button that calls `window.showDirectoryPicker({ mode: 'readwrite', id: WEB_TEACH_PAGE_PICKER_ID })`. Its text SHALL say: "Pick the folder that holds sounds/ and sounds.json, for example examples/hello. The page writes sounds/<name>/<name>-NN.wav and sounds.json there and nowhere else."
2. Decision (design.md, "Where sounds.json goes"): the developer picks the project folder, not the sounds folder, because the page cannot write `sounds.json` next to a picked folder. THE sounds folder SHALL be the child named `sounds` (`WEB_TEACH_PAGE_SOUNDS_DIR`). WHEN it does not exist, THE page SHALL say so and offer a "Create sounds folder" button, and create nothing without that click. WHEN the picked folder is itself named `sounds` and has no `sounds` child, THE page SHALL also say "You picked a sounds folder. Pick the folder that contains it."
3. THE page SHALL list the sounds folder with the same rule as `teachFromDir` (Introduction, facts): label folders are the directory entries whose name does not start with `.`; in each, the files whose name ends with `.wav` in any case; label folders with no such file are empty folders. THE rule SHALL be a pure function, tested against the same entries given to `teachFromDir` in Node.
4. THE page SHALL read every listed file with `readWav` and train the whole model with `teachFromRecordings(recordings, { emptyFolders })` in the Worker (design.md, "Messages"). It SHALL show, as text: each label with its file count and example count, the leave-one-out lines of `format.ts`, the warnings, and the sample rate of the files.
5. WHEN a file is not a 16-bit PCM wav, THE page SHALL name the file and the reason and train nothing. WHEN training throws `TooFewExamplesError`, THE page SHALL show the counts per label and say that the folder has no model yet; teaching a new label SHALL still be allowed.
6. WHEN `sounds.json` exists in the project folder and is not a sounds model (the `sounds:rebuild` check), THE page SHALL say so and SHALL NOT allow Save (the same refusal as `sounds:rebuild`).
7. A "Reload folder" button SHALL read the folder again. THE page SHALL also read it again before every Save (requirement 4.3).
8. THE page SHALL ask for read-write permission (`queryPermission`, then `requestPermission` from the click) only when the handle has these methods, and SHALL show the reason when permission is refused.

### Requirement 3: The sound name
**User story:** As a developer, I want to know at once when a name is not allowed and why.

#### Acceptance Criteria
1. THE Sound name step SHALL have a text input with a visible label "Sound name". THE name SHALL be checked with `validateLabel` from `web/teach-ui/state.ts` (rule `^[a-z][a-z0-9-]{0,31}$`) on every input and on Record.
2. WHEN the name is invalid, THE page SHALL show the message of `validateLabel` (it contains the rule) in an element with `role="alert"` that the input references with `aria-describedby`, SHALL set `aria-invalid="true"` on the input, and Record SHALL be `aria-disabled="true"` and do nothing.
3. `background` and `hum` SHALL be valid with the Task 16 behaviour (one take, no quiet step, no example list; `hum` is "one steady hum for 2 s", `background` is "the room's usual noise for 10 s"). THE page SHALL show one line under the input that explains each of them when it is typed.
4. WHEN the name already is a label folder, THE page SHALL show the re-teach line of requirement 5.1 before recording.

### Requirement 4: Recording and saving
**User story:** As a developer, I want the recordings saved as files that `npm run sounds:rebuild` turns into the same model.

#### Acceptance Criteria
1. Record SHALL open the microphone, start the page's Worker in record-only mode (design.md, "Messages") and mount the Task 16 dialog with the page's controller, `examples` = `RECOMMENDED_EXAMPLES_PER_LABEL` (10), and the current model when one exists.
2. WHEN the user presses Done, THE controller SHALL send `record-stop` with the deleted ids and `clips: true`. THE Worker SHALL answer `record-clips` with one clip per kept segment for kind `sound`, and one clip of the whole take for `hum` and `background` (design.md, "Clips"). THE page SHALL then build the candidate folder (requirement 4.4) and have the Worker train it with `teachFromRecordings`. Its result SHALL reach the dialog as `record-trained` or `record-failed`, so the review shows the model that Save will write, not a `retrainLabel` result.
3. WHEN the user presses Save, THE page SHALL read the folder again, give the new files their names from that listing (requirement 6), train the candidate folder again, and only when that succeeds, write the new wav files and then `sounds.json`. WHEN the listing has not changed since Done, the saved model SHALL equal the reviewed one.
4. THE candidate folder SHALL be the listing of the sounds folder plus the new files. EVERY new recording in it SHALL be `readWav(writeWav(clip, rate))`, the samples of the exact bytes that will be written.
5. EACH new wav file SHALL be written as `<sounds folder>/<label>/<label>-NN.wav` with `writeWav` (16-bit PCM, mono, the microphone's sample rate), created with `getFileHandle(name, { create: true })` only for a name that is not in the listing. THE page SHALL never overwrite or delete a wav file. THE label folder SHALL be created when missing.
6. `sounds.json` SHALL be written to `<project folder>/sounds.json` as the UTF-8 bytes of `JSON.stringify(model, null, 2) + '\n'`, written last, through one `createWritable()` that is closed only after the whole text is written.
7. AFTER writing, THE page SHALL read the folder again, train it again, and compare the new text with the written text. WHEN they differ, THE page SHALL say so and ask the developer to run `npm run sounds:rebuild <project folder>/sounds`. WHEN they agree, THE page SHALL show the list of written files with their paths relative to the project folder.
8. WHEN writing fails part way, THE page SHALL name the files that were written and the step that failed, and say that `npm run sounds:rebuild <project folder>/sounds` builds `sounds.json` from the files that are there.
9. THE dialog SHALL get two additive options (design.md, "Dialog changes"): `existingLine` (a text that replaces the Task 16 replace line) and an `onSave` that may return a promise of `{ stored, text }`; the saved screen shows `text` when given and "Saving..." while the promise is pending. `listen()` and the Task 16 tests SHALL NOT change.
10. WHEN the sample rate of the microphone differs from the rate of the files already in the folder, THE page SHALL show a warning line before recording and in the result (16 kHz with the extra sentence of `sampleRateWarning` in `web/overlay/format.ts`). It SHALL NOT block Save.

### Requirement 5: Re-teaching a label
**User story:** As a developer, I want to add recordings to a sound without losing the old ones by accident.

#### Acceptance Criteria
1. Decision: new recordings of an existing label SHALL be added to its files; the page never deletes a file. WHEN the label exists, THE page and the dialog (through `existingLine`) SHALL show: "<label> already has N recordings (<first> to <last>). New recordings are added after them; no file is deleted. To start over, delete the old files in your file manager and press Reload folder."
2. THE numbering of requirement 6 SHALL continue after the highest existing number of that label.

### Requirement 6: File names and numbering
**User story:** As a maintainer, I want the file names to be predictable and tested.

#### Acceptance Criteria
1. A new file name SHALL be `<label>-<NN>.wav`, where `NN` is the number in decimal, padded with zeros to `WEB_TEACH_PAGE_NUMBER_DIGITS` (2) digits, and longer when it needs more digits (`tap-100.wav`).
2. THE first new number SHALL be one more than the highest number among the files of that label folder whose name matches `<label>-<digits>.wav` (lower-case `.wav`), or 1 when there is none. Files with other names SHALL be kept and read, and SHALL NOT affect the numbering.
3. A name that is already in the listing (in any letter case) SHALL be skipped and the next number used.
4. THE functions of this requirement and the listing rule (requirement 2.3), the relative path text, the `sounds.json` text and the "is a sounds model" check SHALL be pure functions in `web/teach-page/files.ts` with no DOM type, tested with vitest.

### Requirement 7: Browsers without `showDirectoryPicker`
**User story:** As a developer on a browser without folder access, I want the files as downloads and to be told where they go.

#### Acceptance Criteria
1. WHEN `window.showDirectoryPicker` is not a function, THE Folder step SHALL say: "This browser cannot write to a folder. The page offers the files as downloads instead. Chrome and Edge can write them directly." and SHALL offer "Load existing sounds (read only)": an `<input type="file" webkitdirectory>` where the developer picks the project folder.
2. THE read-only listing SHALL use the `webkitRelativePath` of each file with the listing rule of requirement 2.3 through the path rule of `files.ts` (`<picked>/sounds/<label>/<file>.wav` only; other depths ignored). THE page SHALL say that empty label folders cannot be seen this way.
3. WITHOUT loaded files, THE page SHALL teach from the new recordings only and say: "sounds.json will hold only this sound. If sounds/ already has other sounds, run npm run sounds:rebuild <project folder>/sounds after copying the files."
4. ON Save, THE page SHALL offer one download link per new wav file and one for `sounds.json`, built from `Blob` object URLs (local, no network), with the file names of requirement 6. THE text SHALL say: "Put <first> to <last> in <project folder>/sounds/<label>/ and sounds.json in <project folder>/." THE object URLs SHALL be revoked when the next take starts and when the page unloads.

### Requirement 8: Test now
**User story:** As a developer, I want to try the new model before I put it in my app.

#### Acceptance Criteria
1. THE Test now step SHALL have "Test now" and "Stop" buttons. "Test now" SHALL be enabled when a model exists (read or just saved) and the dialog is closed.
2. "Test now" SHALL call `listen({ sounds: <current model>, debug: true, storageKey: WEB_TEACH_PAGE_TEST_STORAGE_KEY })` with no `on` and no `modes`, so no pattern runs and every event is shown in the overlay. THE page SHALL show "Listening. Events appear in the debug panel." and the error text of `listen()` when it rejects.
3. "Stop" SHALL call `ears.stop()`, show "Stopped.", and enable Record again.
4. Saving a new model SHALL stop a running test first.

### Requirement 9: Privacy and layers
**User story:** As a user of a developer's app, I want my recordings to stay on the developer's machine.

#### Acceptance Criteria
1. THE page SHALL write wav files only below the picked project folder (with the picker) or offer them as downloads (without it). NO code of this task SHALL send audio, a sample, a clip, a model or a file over the network. Searching `web/teach-page.ts`, `web/teach-page/` and `web/clips.ts` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `localStorage`, `Image` and `src =` SHALL give no hit.
2. THE clips SHALL move only from the page's Worker to the page (transferred), and SHALL be dropped when the dialog closes and after Save.
3. `sounds.json` SHALL hold the feature-vector model only (the output of `teachFromRecordings`).
4. `web/` SHALL NOT import `fs` or `path`. `core/` SHALL NOT change. THE test hook SHALL NOT exist in production code (design.md, "Test hook").
5. New constants SHALL be in `web/constants.ts` with the unit in the name where there is one: `WEB_TEACH_PAGE_CLIP_MARGIN_MS`, `WEB_TEACH_PAGE_NUMBER_DIGITS`, `WEB_TEACH_PAGE_SOUNDS_DIR`, `WEB_TEACH_PAGE_MODEL_FILE`, `WEB_TEACH_PAGE_PICKER_ID`, `WEB_TEACH_PAGE_TEST_STORAGE_KEY`. No sample count SHALL be hard-coded.

### Requirement 10: Tests
**User story:** As a maintainer, I want the promise of the same model from the page and from `sounds:rebuild` tested end to end.

#### Acceptance Criteria
1. THE vitest tests SHALL cover: numbering, file naming, the listing rule against `teachFromDir`'s choice for the same entries, the `webkitRelativePath` rule, the relative path text, the `sounds.json` text against the bytes `runSoundsRebuild` writes for the synth sounds folder, the "is a sounds model" check, the clip bounds, that each clip of the teaching fixture re-segments to exactly one segment, `record-stop` with `clips: true`, record-only `init`, and `teach-recordings` against `teachFromRecordings`, and the model comparison helper (design.md, "Tests").
2. THE Playwright tests (`test/web/teach-page.spec.ts`) SHALL cover: teaching a new label with the fake microphone writes 10 wav files and a `sounds.json` into the stand-in folder; the spec copies the whole stand-in folder to a temporary folder in Node, runs `runSoundsRebuild` on its `sounds` folder and checks with the helper `test/helpers/model-compare.ts` that the rebuilt `sounds.json` and the page's agree in the sense of the Introduction, that the page's text has the format of `soundsJsonText`, that each new wav file is byte-equal to what `writeWav` writes for its own samples, and that the existing files are byte-equal to the seeded ones; an invalid name shows the rule and blocks Record; without `showDirectoryPicker` the page offers 10 wav downloads and a `sounds.json` download with the folder text.
3. THE stand-in folder SHALL be an OPFS directory (`navigator.storage.getDirectory()`), given to the page by the test only (design.md, "Test hook").
4. No existing test SHALL change. `test/public-api.test.ts` SHALL NOT change (no export changes).
5. EVERY new test with a time, a rate or a count SHALL use named constants with the unit in the name. EVERY time `t` SHALL be a sample count divided by the sample rate.
6. `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run check:public-api` and `npm run test:web` SHALL pass at the end.
