# Requirements: Task 19, hello example, README and npm package preparation

## Introduction
Task 19 is the last task of plan 2 (browser layer). It makes the repository ready for a first `npm publish` and shows what Tokk costs a developer in code. It adds:
- `examples/hello/index.html` and `examples/hello/sounds.json`: one page with one button "Start listening", whose Tokk code is at most 10 lines, and a temporary model built from the synthetic sounds;
- the npm metadata in `package.json` (version, description, keywords, repository, homepage, bugs, license, author, engines, `prepack`);
- minified `dist/tokk.js` and `dist/mcp.js`, with the sizes before and after recorded;
- `README.md` in English: pitch, the 10-line example, teaching with `teach.html`, Node tools, the MCP server, Kiro, privacy, known limits, placeholders for media;
- tests for the example, the metadata and the package;
- a manual `npm publish --dry-run` whose output is recorded. A real publish is out of scope: the operator asks the user first (plan 2, Global Constraints).

This task changes no behaviour of `core/`, `web/` or `node/`, and no public export. The only build change is minification.

| Consumer | What it uses from this task |
|---|---|
| A developer who reads the README | The 10-line example, the teach steps, the Node and MCP sections |
| A browser user of the example | The button, the text results and the debug overlay |
| The operator | `npm publish --dry-run` output, the measured sizes, the placeholders to fill after real-microphone runs |
| The Kiro usage write-up (design 16.4) | `docs/kiro.md` pointer and the 10-line count |

Facts read from this repository before this spec was written (step 1 of the tasks checks them again):
- `package.json`: version `1.0.0`, empty `description` and `keywords` and `author`, `license` `MIT`, `bin` `tokk-mcp`, `files` `dist`, `README.md`, `LICENSE`, no `dependencies`, no `engines`, no `prepack`. `scripts.dev` is `tsx scripts/build.ts --dev`.
- `README.md` holds one sentence.
- `scripts/build.ts` builds `dist/tokk.js`, `dist/node.js` and `dist/mcp.js` with `sourcemap: false`, no minification. `npm run dev` builds `dist/tokk.js` and `dist/teach-page.js` and serves the repository root on `http://localhost:5173`. `npm run test:web` starts `npm run dev`, which empties `dist/`.
- `test/build.test.ts` checks the bundle files, the absence of `dist/tokk.js.map`, strings inside `dist/tokk.js` (`replaceSounds`, `createObjectURL`, `registerProcessor`, the worklet processor name), a Node global scan, byte-identical second builds, the bundled MCP server, the Worker source shape and the `npm pack --dry-run` list.
- `examples/` has no `hello` folder. `.kiro/steering/ui.md` applies to `examples/**`.
- Plan 2 carried-over facts for the README (plan 2, "Plan 1 facts"): the first 1000 ms is a calibration window and a sound inside it is lost; a repeat that follows before the previous sound's segment ends can come out `unknown` (checked down to 210 ms spacing for `mid` and `high`, 440 ms for `low` and `ring`); real-microphone experiments E1 to E5 are postponed; automatic tests use synthetic sounds and Chrome's fake microphone.
- The npm name `tokk` was free when last checked and nothing is published.

## Glossary
- **Marker comments**: the two lines `// tokk:start` and `// tokk:end` inside the module script of `examples/hello/index.html`.
- **Tokk code**: the non-empty lines between the marker comments, the import line included.
- **Synthetic model**: `examples/hello/sounds.json`, a model trained from the synthetic sounds of the repository, not from a real microphone.
- **Fake microphone**: Chrome started with the fixture WAV as its audio input (`fakeMicArgs` in `test/web/paths.ts`).

## Requirements

### Requirement 1: The hello example page
**User story:** As a developer, I want to see sound control working in a page with ten lines of Tokk code.

#### Acceptance Criteria
1. `examples/hello/index.html` SHALL be one static page with one button whose visible text is `Start listening`. `listen()` SHALL be called only from the click handler of that button (a user gesture).
2. THE Tokk code SHALL sit in one `<script type="module">` between two marker comments, `// tokk:start` and `// tokk:end`, and SHALL have at most 10 non-empty lines, the import line included. THE marker lines are not counted. THE code SHALL call `loadSounds` and `listen` with `debug: true`.
3. THE import SHALL be `/dist/tokk.js`, so the page runs with `npm run dev`, which serves the repository root. THE page SHALL load its model with a URL relative to the page (`sounds.json` next to `index.html`), so the page keeps working when the folder is copied.
4. EVERY recognised sound and every pattern match SHALL be written as text on the page, inside an element that screen readers announce (a live region), with the sound or pattern name and a time or a counter. Colour, shape or sound alone SHALL NOT carry a result. THE patterns SHALL be chosen from the fixture of the fake microphone (design.md, "Patterns of the example") so the page shows at least one pattern match on it, and SHALL include single sounds so that recognised sounds appear as text.
5. THE page SHALL say in visible text that the model is synthetic and should be replaced: it was built from synthetic sounds, and the way to replace it is to teach real sounds with `teach.html` and pick `examples/hello` as the project folder. THE same statement SHALL be in the README (requirement 4.9).
6. THE page SHALL follow `.kiro/steering/ui.md`: all visible text in English; the button reachable by keyboard with an accessible name and a visible focus outline; text contrast at least 4.5 to 1 and graphics at least 3 to 1; no CSS transition or animation and no looping motion; no Halloween element; the debug panel is the one that `debug: true` mounts (Shadow DOM), and the page builds no panel of its own.
7. WHEN `listen()` rejects (permission denied, no microphone, no secure context), THE page SHALL show the error message as text next to the button, with no change of the Tokk code count beyond the 10 lines. IF this does not fit in 10 lines, the error text MAY be written by code outside the markers, which then SHALL hold no Tokk call.
8. THE page SHALL send nothing over the network except the two requests for `/dist/tokk.js` and `sounds.json`, and SHALL contain no recording. No code SHALL send audio, a sample or a model over the network.
9. `check:public-api` SHALL still pass: the example imports only from `tokk`.

### Requirement 2: The synthetic model `examples/hello/sounds.json`
**User story:** As a developer, I want the example to work before I have taught any sound.

#### Acceptance Criteria
1. `examples/hello/sounds.json` SHALL be a `SoundModel` built by the project's own teaching code from the synthetic sounds (`fixtures/audio/synth`), at the sample rate of the fake-microphone fixture, so the fake microphone produces the same labels as in the Task 14 test. IT SHALL hold feature vectors only: no sample array and no WAV bytes (privacy rule).
2. NO WAV file SHALL be added under `examples/hello/`. `examples/hello/sounds/` is where `teach.html` writes real recordings later; THE task SHALL make sure that folder is git-ignored if `.gitignore` does not already cover it (design.md, "Findings", item 5).
3. THE way the file was made (source folder, rate, command) SHALL be recorded in `design.md` ("Measured values") and in the README, not inside the JSON.
4. `loadSounds('sounds.json')` SHALL accept the file (version check) and the fake microphone SHALL recognise the labels of the synthetic fixture with it.

### Requirement 3: `package.json` metadata and `prepack`
**User story:** As a maintainer, I want the package to be ready for `npm publish` and to publish a current build.

#### Acceptance Criteria
1. `package.json` SHALL have: `version` `0.1.0`; a non-empty one-sentence English `description`; `keywords` that include `sound`, `audio`, `microphone`, `sound control`, `clap`, `whistle`, `sound detection`, `audio events`, `web audio`, `tokk` and `mcp`; `repository` `{ "type": "git", "url": "git+https://github.com/subniin/tokk.git" }`; `homepage` `https://github.com/subniin/tokk#readme`; `bugs` `{ "url": "https://github.com/subniin/tokk/issues" }`; `license` `MIT`; `author` `subniin`; `engines` `{ "node": ">=20" }`.
2. `scripts.prepack` SHALL be `npm run build`, because `npm run test:web` empties `dist/` and a pack or publish after it would otherwise ship an incomplete build.
3. `dependencies` and `peerDependencies` SHALL stay absent (zero runtime dependencies). `main`, `types`, `exports`, `bin`, `files` and `sideEffects` SHALL NOT change. `name` SHALL stay `tokk`. THE `plugin.json` version of the power MAY stay at `0.1.0`; a test checks that both agree.
4. THE repository URL, the homepage and the bugs URL are where the repository will be; it is not public yet. THE README SHALL NOT claim that it is.
5. `npm pack --dry-run` SHALL still list only `dist/**`, `README.md`, `LICENSE` and `package.json`. In particular it SHALL list nothing under `examples/`.
6. THE README and `package.json` SHALL agree: the `bin` name `tokk-mcp`, the package name and the Node version.

### Requirement 4: `README.md`
**User story:** As a developer who finds the repository or the npm page, I want to understand Tokk and run the example within one screen of reading.

#### Acceptance Criteria
1. `README.md` SHALL be English and short. It SHALL open with a one-line pitch (a sound-event engine that lets an app react to short sounds like a clap, a knock or a whistle, in the browser and in Node).
2. A section for the 10-line example SHALL show the same Tokk code as `examples/hello/index.html` between the markers, with one change: the import comes from `https://cdn.jsdelivr.net/npm/tokk/+esm` instead of `/dist/tokk.js`. A test compares the two texts line by line apart from that import specifier. THE section SHALL say that the CDN form works after `npm publish` and that inside the repository `npm run dev` serves the page at `http://localhost:5173/examples/hello/index.html`.
3. A section SHALL explain teaching with `teach.html`: run `npm run dev`, open `http://localhost:5173/teach.html`, pick the project folder, type the sound name, record the sound 10 times, save. THE section SHALL say `teach.html` is part of the repository and is not in the npm package, and that the result is the same as `npm run sounds:rebuild`.
4. A section SHALL name the Node tools of `tokk/node` (`teachFromDir`, `expectEvents`) with the one-line `expectEvents` use of the integrate steering, and the MCP server: `npm run mcp` in this repository, the `tokk-mcp` bin after publish, with its four tools (`teach`, `listen`, `score`, `spectrogram`).
5. A section SHALL point to `docs/kiro.md` for the Kiro power and the agents, and say in one sentence that the MCP part of the power works after `npm publish`.
6. A privacy section SHALL say: audio never leaves the device; `sounds.json` holds feature vectors only; original recordings stay in local `sounds/` folders.
7. A "Known limits" section SHALL state the carried-over facts as facts: the first 1000 ms after the microphone opens is the calibration window and a sound in it is lost, so stay quiet for one second; a repeat that comes close after the previous sound can come out `unknown`; the project is tested on synthetic sounds and on Chrome's fake microphone, and experiments with real microphones are pending.
8. MEDIA and measured values SHALL be placeholders only: a visible line for a GIF, a line for a video, and a line for the measured teaching time and code lines, each marked as pending. THE README SHALL contain no number invented for these (design 9: only measured values). Sizes, times, accuracy and line counts SHALL NOT appear as claims, except the ten-line limit that the example code itself shows.
9. THE README SHALL say that the example model is synthetic and is to be replaced by teaching real sounds with `teach.html` with `examples/hello` as the project folder.
10. THE README SHALL end with a license line (MIT) that names `LICENSE`. IT SHALL NOT claim the package is published until it is.
11. EVERY relative path in backticks that names a repository file or folder SHALL exist, except names marked "after build" or "after publish" (same rule as `docs/kiro.md`).

### Requirement 5: Bundle size
**User story:** As a developer who loads Tokk from a CDN, I want the files to be small.

#### Acceptance Criteria
1. THE package build SHALL minify `dist/tokk.js` (browser) and `dist/mcp.js` (Node bin). THE Worker source and the worklet source that are embedded in `dist/tokk.js` SHALL be minified by the same option, because they are part of that file.
2. THE decision for `dist/node.js` is in design.md ("Decisions"): it stays readable. Minified code SHALL keep names that other code relies on: the exported names, the strings of the message protocol, the processor name, and `#!/usr/bin/env node` as the first line of `dist/mcp.js`.
3. `npm run dev` SHALL NOT minify (readable code in the browser tools while developing).
4. NO source map SHALL be written into `dist/`, and `dist/tokk.js.map` SHALL NOT exist (the existing assertion stays). THE implementer SHALL measure the size an external map would have and record it; shipping maps is not part of this task (design.md, "Decisions").
5. THE sizes of `dist/tokk.js`, `dist/node.js` and `dist/mcp.js` before and after, in bytes, SHALL be recorded in `design.md` ("Measured values"), with the size of the `npm pack` tarball before and after (from `npm pack --dry-run`).
6. TWO builds SHALL still give byte-identical `dist/tokk.js`, `dist/node.js` and `dist/mcp.js`.
7. Existing tests SHALL keep passing. Where minification changes the text a test searches (`test/build.test.ts`: the Node global scan, the Worker source shape, the strings inside `dist/tokk.js`), the test SHALL be updated as a named requirement of this task, with a comment, and SHALL still fail when the thing it guards is broken. No assertion SHALL be removed to make a test pass.

### Requirement 6: Tests
**User story:** As a maintainer, I want a failing test when the example grows past 10 lines, loses its text output or the package loses a metadata field.

#### Acceptance Criteria
1. `test/web/hello.spec.ts` (Playwright, the default fake microphone): open `/examples/hello/index.html`, click the button, and wait until the live region shows the fixture pattern as text. THE test SHALL also check that the debug panel host exists and that no request leaves `localhost` (a request listener).
2. `test/hello-example.test.ts` (vitest) SHALL check: the two marker comments exist once each, in order, inside a `<script type="module">`; the non-empty lines between them are at most `HELLO_MAX_TOKK_LINES` (a named constant, 10); the code contains `listen(` and `debug: true`; the import line is `/dist/tokk.js`; the README example equals the page code except the import specifier; the page contains the text `Start listening`; the page and the README both contain the words `synthetic` and `teach.html`; `sounds.json` parses, has the model `version` that `loadSounds` accepts, holds only labels of the synthetic sounds, has the sample rate of the fake-microphone fixture, and has no sample or WAV field.
3. A negative test SHALL show the line check can fail: a copy of the page text with 11 lines of code, and a copy with a missing marker, are rejected by the same function.
4. `test/package-meta.test.ts` (vitest) SHALL check every field of requirement 3.1, `scripts.prepack`, `engines`, the absence of `dependencies`, and that the version equals the `plugin.json` version. A negative test removes one field from a parsed copy and the validator reports it.
5. `test/build.test.ts` SHALL be updated as named in requirement 5.7, and its pack test SHALL add `examples/` to the forbidden prefixes. THE pack test SHALL run `npm pack` with `--ignore-scripts`, so `prepack` neither rebuilds `dist/` in the middle of the test run nor writes to the JSON output; `test/package-meta.test.ts` proves that `prepack` exists (design.md, "Findings", item 3).
6. OPTIONAL: a docs test that the README has no number followed by `minute`, `minutes`, `second`, `seconds` or `lines` outside code blocks. THE implementer SHALL skip it if it takes more than a short regular expression, and SHALL say so in `design.md`.
7. NO time or count in a new test SHALL be a bare number: use named constants with units in the name. No existing test SHALL be weakened.
8. `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run check:public-api` and `npm run test:web` SHALL pass at the end.

### Requirement 7: The dry-run publish
**User story:** As the operator, I want to see what `npm publish` would send, before I decide to publish.

#### Acceptance Criteria
1. THE implementer SHALL run `npm publish --dry-run` once, after the build and the tests pass, and SHALL record the output in `design.md` ("Measured values"): package name and version, tarball size, unpacked size, file count, and every warning or error. `npm publish --dry-run` runs `prepack`; THE record SHALL say so.
2. IF the dry run fails or warns about something that `package.json` can fix (for example a normalised field), THE implementer SHALL fix it and repeat. IF it needs a login, THE implementer SHALL record that fact and stop; it SHALL NOT run `npm login`.
3. THE implementer SHALL NOT run `npm publish` without `--dry-run`, `npm login`, `git push` or any command that sends data out. The operator asks the user before a real publish.

### Requirement 8: Privacy, units and scope
**User story:** As a maintainer, I want this task to keep the project rules.

#### Acceptance Criteria
1. THE privacy rules SHALL hold: no code that sends audio over the network; `sounds.json` holds feature vectors only; recordings only in local `sounds/` folders.
2. EVERY threshold or time constant in code of this task SHALL be in ms, Hz or dB with the unit in the name; no sample count SHALL be hard-coded. THE example page needs no such constant.
3. THIS task SHALL NOT change `core/`, `web/`, `node/`, `tools/`, hooks, steering, `docs/_planning/` or other specs. THE allowed changes are the files named in design.md ("Layout").
4. NO live Kiro run SHALL be part of the tests or of the commit. The check with a real microphone is a human step recorded by the operator (plan 2, "completion check").
