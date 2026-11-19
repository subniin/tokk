# Requirements: Task 11B, sound and score hooks, MCP registration

## Introduction
Task 11B of the plan connects the finished tools to Kiro. It adds the script `scripts/sounds-rebuild.ts` (`npm run sounds:rebuild [soundsDir]`), a deterministic synthetic sound set with a generator script, the script `scripts/corpus-score.ts` that chooses what the `corpus-score` hook scores, two hook files, the workspace MCP registration of `mcp-ears`, the steering file `integrate.md`, a `tools/` entry in `tsconfig.json`, and the header of `docs/experiments.md`. Design sections 6, 8.2 and 8.9 are the source.

No real recordings exist yet. They come later from the experiment page and the teach page. Until then a small synthetic set (ours, generated from a fixed seed, CC0-equivalent) lets the hooks, the scripts and the MCP check run end to end. The synthetic set is not a quality measure of the engine on real sound.

| Consumer | What it uses from this task |
|---|---|
| Kiro IDE and CLI hooks | `.kiro/hooks/sounds-rebuild.json`, `.kiro/hooks/corpus-score.json` |
| Kiro agents | `mcp-ears` registered in `.kiro/settings/mcp.json`, `integrate.md` steering |
| Later plans (apps, power `tokk`) | `npm run sounds:rebuild <soundsDir>`, `integrate.md` |
| Tests of Task 11B | The synthetic set as a stable fixture |

Out of scope: real recordings, `fixtures/audio/full/`, the teach page, the `spectrogram` tool, the Kiro power, any other spec, any change to the engine, to `node/teach.ts`, `node/score.ts` or `scripts/score.ts`.

Project rules that apply: thresholds and time constants are written in ms, Hz or dB with the unit in the name; no sample count is hard-coded (it is derived from the sample rate and a constant); constants live in `core/constants.ts`; every time `t` is a cumulative sample count divided by the sample rate, in seconds; no code sends audio over the network; `sounds.json` holds feature vectors only; original recordings stay in local `sounds/` folders. All text is English.

## Requirements

### Requirement 1: `sounds:rebuild`
**User story:** As a developer who adds recordings, I want one command that rebuilds `sounds.json` and tells me what is weak.

#### Acceptance Criteria
1. THE `package.json` `scripts` SHALL get `"sounds:rebuild": "tsx scripts/sounds-rebuild.ts"`. Other scripts and `exports` SHALL stay unchanged.
2. THE command `npm run sounds:rebuild [soundsDir]` SHALL take the sounds folder from the first argument, default `examples/sounds/`, resolved against the working directory. It SHALL write the model to `<soundsDir>/../sounds.json` (so `examples/sounds.json` by default).
3. THE script SHALL call `teachFromDir(soundsDir)` and, only when that succeeds, write the `SoundModel` as JSON with 2-space indentation and a final newline. The file SHALL hold feature vectors only (`id`, `label`, `v` per example), no samples. (privacy rule)
4. THE script SHALL print: one summary line (`taught <L> sounds, <N> examples -> <out path relative to the working directory, forward slashes>`), one line per label (`<label>: <examples> examples, LOO accuracy <0.00 to 1.00>`), one line per confused pair (`confused: <a> -> <b> <rate, 2 decimals>`) or `confused: none`, and one line per warning (`warning [<code>] <file>: <message>`), in the order of the `TeachReport`. These lines SHALL have the same shape as the text of the MCP `teach` tool.
5. WHEN the run is normal, including when confused pairs or warnings exist, THE exit code SHALL be 0. Confused pairs and warnings are notices only.
6. IF the folder does not exist, or exists but has no label subfolders, THEN the script SHALL print one short note (for example `no label folders in examples/sounds yet, nothing to rebuild`), write nothing, and exit 0.
7. IF `teachFromDir` rejects with `TooFewExamplesError`, THEN the script SHALL print the per-label counts from the error and a short note that more examples are needed, write nothing (an existing `sounds.json` stays unchanged), and exit 0. The reason: the hook fires after every saved recording, so the first four recordings of a label are a normal state, not a failure.
8. IF any other error occurs (unsupported WAV format, unreadable file, invalid target), THEN the script SHALL print `Error: <message>` to the standard error, write nothing, and exit 1.
9. IF the target `sounds.json` exists and is not a sounds model (an object with `version` 1 and an `examples` array), or is a folder, THEN the script SHALL refuse with exit 1 and leave it unchanged.
10. THE script SHALL be testable without a child process: it exports a function that takes the arguments and an environment (working directory, output functions) and returns the exit code, like `runScore` does. The direct-run entry runs only when the file is the process entry.
11. THE script SHALL make no network call and SHALL write no file except the model.

### Requirement 2: Synthetic set and generator
**User story:** As a developer without recordings, I want a small deterministic sound set so the hooks and tools work today.

#### Acceptance Criteria
1. THE package `scripts` SHALL get `"synth:fixtures": "tsx scripts/make-synth-fixtures.ts"`.
2. THE script `scripts/make-synth-fixtures.ts` SHALL write, below `fixtures/audio/synth/`: `sounds/<label>/*.wav` for the labels `low`, `mid`, `high`, `ring` (the four classes of `SYNTH_CLASSES` in `core/synth.ts`) and `background`; and `quick/*.wav` with a same-name `.json` label file each. It SHALL export a function that takes an output folder, so tests write to a temporary folder.
3. THE output SHALL be deterministic: all randomness comes from the seeded generator of `core/synth.ts` with fixed seeds, so two runs give byte-identical files, on every platform.
4. EVERY WAV SHALL be 16-bit PCM mono at one fixed sample rate named in `core/constants.ts` with its unit (the design picks the value).
5. EVERY recording SHALL start with a lead of low-level noise and no sound, at least as long as the calibration window (`NOISE_FLOOR_WARMUP_MS`) plus a margin constant. No sound SHALL start inside that lead, so `teachFromDir` and `scoreDir` report no `sound-in-calibration` warning and no `inCalibration` count.
6. EACH class label folder SHALL give at least `RECOMMENDED_EXAMPLES_PER_LABEL` segments after teaching, with small seeded variation of gain between impacts. THE `background` folder SHALL hold steady noise of at least two different kinds or levels, long enough to give at least `MIN_EXAMPLES_PER_LABEL` fixed windows each.
7. EACH `quick/*.json` SHALL have the form `{ "events": [{ "label": "<label>", "t": <seconds> }], "device": "synthetic", "room": "none", "sampleRate": <Hz> }`. THE `t` of every event SHALL be computed as the placed sample index divided by the sample rate, not as the requested millisecond value divided by 1000. THE events SHALL cover all four classes with gaps wide enough that no two sounds overlap.
8. THE committed files SHALL be small: the total size of `fixtures/audio/synth/` SHALL stay under 2 MB (target about 1.7 MB). A test SHALL check the limit.
9. THE generated WAV files, the label files and `fixtures/audio/synth/sounds.json` (produced by `npm run sounds:rebuild fixtures/audio/synth/sounds`) SHALL be committed. They are generated by us, contain no recorded sound and no personal data, and are released like the rest of the repository (MIT; CC0-equivalent for the audio). The README note of the folder is not required.
10. WITH the synthetic `sounds.json`, scoring `fixtures/audio/synth/quick` SHALL give recall and precision of at least 0.9 for every label and no inCalibration count. A test SHALL check this.
11. THE synthetic `sounds.json` SHALL contain feature vectors only. A test SHALL check that it is a valid model whose labels are exactly the five names and whose example ids match those of a fresh rebuild.

### Requirement 3: `corpus-score` script
**User story:** As a developer, I want one short command that scores the best available set after I save engine code.

#### Acceptance Criteria
1. THE `package.json` `scripts` SHALL get `"corpus-score": "tsx scripts/corpus-score.ts"`, so the hook command is one line: `npm run corpus-score`.
2. THE script SHALL choose the set this way. REAL mode: `examples/sounds.json` is a file AND `fixtures/audio/quick/` contains at least one `.wav` that has a same-name `.json` next to it. SYNTHETIC mode: otherwise, when the same two conditions hold for `fixtures/audio/synth/sounds.json` and `fixtures/audio/synth/quick/`. OTHERWISE it prints a note and exits 0.
3. IN REAL mode THE script SHALL run the score of Task 9a on `fixtures/audio/quick` with `examples/sounds.json`, with the project root as the score root (so the experiments line goes to `docs/experiments.md` and the baseline is `docs/scores-quick.json`), and return the exit code of the score run (0 ok, 1 regression, 2 wrong use or invalid input).
4. IN SYNTHETIC mode THE script SHALL run the same score on the synthetic set with a temporary score root, so `docs/experiments.md` and `docs/scores-quick.json` are not touched by synthetic runs. THE baseline of the synthetic set SHALL be the committed file `fixtures/audio/synth/scores-quick.json`: before the run the script copies it into the temporary `docs/` when it exists, and with `--update-baseline` it copies the new baseline back after the run. THE temporary folder SHALL be removed at the end, also after an error.
5. THE script SHALL print which mode it chose in its first line (`corpus-score: real set`, `corpus-score: synthetic set`, or the note).
6. THE script SHALL NOT fail because a folder is empty or missing: no usable set gives a note and exit 0. Invalid input in an existing set (for example `sounds.json` that is not a model) SHALL keep the score exit code 2.
7. THE script SHALL finish in under `CORPUS_SCORE_BUDGET_MS` (15000 ms, defined in `core/constants.ts`) on the synthetic set, including start-up of the process. A test SHALL measure the function (not the process start) against this budget, and the manual check in the tasks SHALL measure the whole command.
8. THE script SHALL be testable without a child process (exported function with an environment, direct-run entry only when run as the entry file) and SHALL NOT edit `scripts/score.ts`.
9. THE script SHALL make no network call.

### Requirement 4: Hooks
**User story:** As a developer, I want the checks to run when I save, without spending credits.

#### Acceptance Criteria
1. THE file `.kiro/hooks/corpus-score.json` SHALL use the v1 format of the existing hooks (`pbt-quick.json`): `"version": "v1"`, one hook named `corpus-score`, trigger `PostFileSave`, a matcher that matches `core/` files with either path separator and no other folder, action type `command` with the single command `npm run corpus-score`, and `"enabled": true`.
2. THE file `.kiro/hooks/sounds-rebuild.json` SHALL use the same format, name `sounds-rebuild`, a matcher for `.wav` files below `examples/sounds/` at any depth with either separator, action type `command` with the single command `npm run sounds:rebuild`. IT SHALL fire on file create and on file save. IF the v1 format has a create trigger, THEN the file SHALL hold two entries (`sounds-rebuild` for save, `sounds-rebuild-create` for create) with the same matcher and command. IF it has none, THEN only the save entry SHALL exist and the design SHALL note it.
3. THE `timeout` values SHALL be set so that `corpus-score` allows the 15 s target with margin and `sounds-rebuild` allows a full teach of the example set. The values in the file are seconds, as the existing hooks do (the Kiro schema fixes this unit).
4. THE hooks SHALL run shell commands only. They SHALL NOT call a model.
5. A test SHALL check both files: valid JSON, the fields above, matcher results on sample paths (matches `core/segment.ts`, `core\\classify\\knn.ts`, `examples/sounds/clap/01.wav`, `examples\\sounds\\background\\a.wav`; does not match `node/score.ts`, `examples/sounds.json`, `examples/sounds/clap/notes.txt`), and that the command is one line.

### Requirement 5: MCP registration
**User story:** As a Kiro user, I want `mcp-ears` available in this workspace without manual setup.

#### Acceptance Criteria
1. THE file `.kiro/settings/mcp.json` SHALL be created with exactly the content stated in `design.md` (server name `mcp-ears`, command `npm`, arguments `run`, `--silent`, `mcp`). The `--silent` flag is required because the npm script banner would otherwise be written to the standard output, which carries the protocol.
2. THE file SHALL NOT contain a `cwd` field, because the Kiro MCP configuration documents none. The working folder is the workspace root where Kiro starts the server, and `npm` runs the script from the folder of `package.json`, so the server root is the repository root. The verification in Requirement 6 confirms this.
3. THE file SHALL be committed, shall not be ignored by `.gitignore`, and shall hold no secret.
4. A test SHALL parse the file and check the server entry. A second check SHALL confirm that `package.json` has the `mcp` script that the entry runs.

### Requirement 6: Headless verification of `mcp-ears`
**User story:** As a maintainer, I want proof that Kiro itself can call the tool, not only the in-memory tests.

#### Acceptance Criteria
1. AFTER the files exist, THE task list SHALL include a headless Kiro CLI run (non-interactive chat, with only the `mcp-ears` `listen` tool trusted) that asks the agent to call `listen` on one file of `fixtures/audio/synth/quick/` with `fixtures/audio/synth/sounds.json`.
2. THE run passes WHEN the answer shows event lines for the labels in that file's label JSON (same labels in the same order, times within the match tolerance of the label file) and a summary line.
3. THE exact flag names SHALL be taken from the installed CLI's help output, because they change between versions. The version used SHALL be written to `docs/devlog.md`.
4. IF the server does not start on Windows because `npm` cannot be launched without a shell, THEN the fallback is `npm.cmd` as the command. The task SHALL then change the committed file and record the reason in `design.md`.
5. THE run SHALL leave no file behind (no log, no script).

### Requirement 7: Steering `integrate.md`
**User story:** As an agent that adds sound control to an app, I want the order of work and the traps in one file.

#### Acceptance Criteria
1. THE file `.kiro/steering/integrate.md` SHALL exist, in English, with a front matter and short rule sentences like the other steering files (`layers.md` is the model).
2. IT SHALL state the order: teach sounds (folder per label with at least `MIN_EXAMPLES_PER_LABEL` recordings, ten recommended), then `sounds.json` (`npm run sounds:rebuild` or the MCP `teach` tool), then `listen({ sounds, on })` or `modes`, then `expectEvents` tests against recordings.
3. IT SHALL include the public API example of design section 6: `listen` with `sounds: await loadSounds(...)`, an `on` table with `'clap clap'`, `'clap _ clap'` and `'hum.rise'` (using `e.speed`), `debug: true`, `ears.teach('clap', { ui: true })`, and `pause`, `resume`, `stop`; the modes example with `start` and `question` and `setMode`; and the `expectEvents('clap-2.wav', ['clap', 'clap'], { sounds })` test form (imported from `tokk/node`).
4. IT SHALL say that `listen`, `loadSounds` and the teach UI belong to the browser layer of plan 2 and are not in the repository yet, so a current Node integration uses `createEngine`, `runSamples` and `expectEvents`. Text that the API is available SHALL NOT claim more than exists.
5. IT SHALL list these common mistakes, each as a rule with its reason: sounds in the first second of a recording are lost (the calibration window; `teach` warns `sound-in-calibration`; start sounds after a quiet 1 s); the label `background` is reserved and never produces an event, so do not name a real sound that; hum patterns (`hum.rise`, `hum.fall`) stand alone and are not mixed with other sounds in a pattern, and need a `hum` folder for the baseline pitch; gap ranges: consecutive sounds are less than 350 ms apart, a rest `_` is 350 to 1000 ms, measured from the start of one sound to the start of the next, and a short pattern that is a prefix of a longer one fires late.
6. IT SHALL use the project rules on units and privacy in one line each and contain no code of the tool internals.
7. A test SHALL check that the file exists, has a front matter, and mentions each item of criteria 2, 3 and 5 by a key phrase.

### Requirement 8: `tsconfig.json` and `docs/experiments.md`
**User story:** As a maintainer, I want type checking to cover the tools folder, and the experiments file to start with its header.

#### Acceptance Criteria
1. THE `include` list of `tsconfig.json` SHALL get `"tools"`. Nothing else in the file SHALL change. IF the type check then reports errors, they SHALL be reported to the user and not fixed beyond what this change causes (for example a missing type import in a file of `tools/`).
2. THE file `docs/experiments.md` SHALL be created only if missing, with exactly the title and header that `scripts/score.ts` writes (`# Experiments`, a blank line, then the two header lines `date | commit | recall per label | FP/h` and `--- | --- | --- | ---`). If it exists it SHALL NOT be changed.
3. A test SHALL check that after the header exists, a score run appends exactly one line and does not repeat the header.

### Requirement 9: Tests, constants and layers
**User story:** As a maintainer, I want the project rules kept and the work covered by tests written first.

#### Acceptance Criteria
1. THE tests SHALL be in `test/scripts.test.ts` (added to the existing file: `sounds-rebuild`, `corpus-score`, hooks, MCP file, `integrate.md`, `tsconfig`, experiments header) and `test/synth-fixtures.test.ts` (generator, size, determinism, labels, score gate). Every test that writes SHALL use a temporary folder removed in `afterEach`. No test SHALL start a child process or touch the real `docs/`.
2. THE new constants (sample rate of the synthetic set in Hz, lead margin in ms, impact spacing in ms, gain values in dB, seeds, `CORPUS_SCORE_BUDGET_MS`) SHALL be added to `core/constants.ts` with their units in the names. No sample count SHALL be a literal: counts are derived from the sample rate and a time constant.
3. NOTHING else under `core/` SHALL change. `core/index.ts` and `node/index.ts` SHALL NOT change, so the public API test stays valid.
4. THE scripts MAY import `node/` and `core/` by relative path and may use `fs`. `core/` SHALL still import no `fs` or `path`.
5. NO code of this task SHALL send audio over the network or store samples in `sounds.json`.
6. THE commit message SHALL be `chore: add sound and score hooks, register MCP`.
