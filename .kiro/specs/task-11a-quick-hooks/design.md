# Design: Task 11A, Steering and quick hooks

## Layer rule
Nothing in this task goes into `core/`, `node/` or `web/`. The two scripts live in `scripts/` and are run by `tsx`. They use only Node built-ins (`fs`, `path`, `child_process`) and import nothing from `core/`. Steering and hook files are data for Kiro.

## Files
| File | Kind | Purpose |
|---|---|---|
| `scripts/check-public-api.ts` | script | Find forbidden `core/` imports in `apps/` |
| `scripts/pbt-quick.ts` | script | Run the existing PBT files with 20 cases |
| `test/scripts.test.ts` | test | The two tests of the public API check |
| `package.json` | edit | Add the scripts `check:public-api` and `pbt:quick` |
| `.kiro/steering/web-audio.md`, `units.md`, `privacy.md`, `layers.md` | steering | Rules from design 8.3 |
| `.kiro/hooks/pbt-quick.json`, `public-api-only.json` | hooks | Shell-command hooks on file save |
| `docs/devlog.md` | edit | One line with the measured time and the manual check |

`scripts/pbt-quick.ts` is the one file the task text does not name. It exists because `PBT_RUNS=20` cannot be written in an npm script on Windows without a shell-specific syntax or a new dependency such as `cross-env` (Requirement 3.3). The vitest config already reads `PBT_RUNS` from the environment and `test/setup.ts` hands it to fast-check, so the script only has to set the variable and start vitest.

## npm scripts
| Script | Runs |
|---|---|
| `check:public-api` | `tsx scripts/check-public-api.ts` |
| `pbt:quick` | `tsx scripts/pbt-quick.ts` |

`test` and `test:quick` stay as they are.

## `scripts/pbt-quick.ts`
1. Candidate list, in a constant at the top of the file: `test/segment.test.ts`, `test/knn.test.ts`, `test/grammar.test.ts`. A new PBT file is added to this list by the task that creates it (Tasks 5 and 7 already have the name in their plan, so the list holds all three from now on).
2. Keep the candidates that exist (`fs.existsSync`, relative to the current directory).
3. When none exists, print `pbt:quick: no property test files yet` and exit 0.
4. Otherwise start vitest as a child process (`vitest run --reporter dot` followed by the file paths) with the environment of the parent, and `PBT_RUNS` set to `20` only when it is not set already. Standard output and error pass through. The script exits with the child's exit code.

The vitest binary is started through `process.execPath` and the `vitest` package entry, not through a shell, so there is no quoting problem and no `.cmd` shim on Windows.

Why not vitest's own file filter (`vitest run test/segment.test.ts test/knn.test.ts ...`): it also skips missing files, but it cannot set the environment variable on Windows. The wrapper does both with one rule, and the list of "files that exist" is explicit and testable by reading.

### Time target
| Case count | Segment suite (measured earlier) | Target |
|---|---|---|
| 100 (`npm test`) | about 60 s, mostly P4 | not a target |
| 20 (`pbt:quick`) | about 12 s of test time expected | **under 20 s, including start-up** |

P4 resamples a 96000 Hz signal to three rates for each case, so it scales with the case count. The deterministic example tests in the file cost about 1 s. At 20 cases the properties P2, P3 and P4 together should stay near 10 s. The measurement is a task step (3.4 in `tasks.md`); the number goes to `docs/devlog.md`. If it is above 20 s the case count goes down (to 10), the hook timeout does not go up.

When `knn.test.ts` and `grammar.test.ts` arrive, the target stays 20 s for the three files. Task 5 and Task 7 check this and, if needed, keep their own PBT properties cheap at 20 cases. This task does not tune files that do not exist.

## `scripts/check-public-api.ts`
Root is `process.cwd()`. This is how the hook (project root) and the tests (temporary root) both use it.

1. If `apps/` does not exist, print `public API check: no apps/ folder` and exit 0.
2. Walk `apps/` recursively. Skip folders named `node_modules` and `dist`. Keep files that end in `.ts`, `.tsx` or `.js`.
3. For each file, read the text and go through it line by line. Skip a line whose first non-space characters are `//` or `*`.
4. On each remaining line, look for module specifiers in these forms, each with a single-quoted, double-quoted or backtick string:
   - `from '<spec>'` (covers `import ... from` and `export ... from`, also when the clause spans several lines, because the `from` line holds the specifier)
   - `import '<spec>'` (side-effect import)
   - `import('<spec>')` (dynamic import)
   - `require('<spec>')`
5. A specifier is forbidden when it equals `tokk/core`, starts with `tokk/core/`, or starts with `.` or `/` and has a path segment equal to `core` (split on `/`). All other specifiers are allowed.
6. Print `<relative path>:<line number>  <specifier>` for each forbidden specifier. Use `/` in paths, also on Windows. After the list print one line that says how many were found and that apps must import from `tokk` only.
7. Exit 1 when the list is not empty, otherwise 0.

The check reads lines with a regular expression and does not parse TypeScript. This is a known limit: an import that is built from a string at run time, or a specifier inside a template string that spans lines, is not seen. It catches the way a developer or an agent writes an import. A full parser would add a dependency to a check that has to start fast on every save.

### Tests (`test/scripts.test.ts`)
Both tests create a temporary folder with `fs.mkdtemp` under the system temp directory, write files with a small local helper, run the script in a child process with the temporary folder as working directory, and remove the folder in a `finally` block. The child process is `process.execPath` with `--import tsx`, and the script path is absolute, built from the test file's location.

| Test | Setup in the temporary root | Expected |
|---|---|---|
| `check-public-api exits 1 and names the file for an app importing core/segment` | `apps/demo/main.ts`: line 1 a harmless import from `tokk`, line 2 an import from the relative path of `core/segment` | exit code 1, output has `apps/demo/main.ts:2` |
| `check-public-api exits 0 when apps only import from tokk` | `apps/demo/main.ts` imports from `tokk` and from `tokk/node`; a second file `apps/demo/util.ts` imports `./core-utils` | exit code 0 |

The `./core-utils` file in the second test covers the whole-segment rule of Requirement 1.3. Test-only values (the file names, the line number) are at the top of the test file.

`pbt:quick` has no automated test. It starts the full suite, its useful result is a time on one machine, and a unit test of "which files exist" would test `fs.existsSync`. Its check is the measured run in `tasks.md` step 3.

## Steering files
Format: front matter, then one heading line, then rules as a list of imperative sentences. A rule gives the action and, where it helps, the value. Content comes only from design 8.3 and the plan's Global Constraints.

Kiro loads `always` files in every interaction. It loads `fileMatch` files when a file that matches is part of the conversation (open or touched). The docs say custom agents do not load steering unless their `resources` list it, so the custom agents of later plans (`sound-tuner`, `integrator`) must list `.kiro/steering/**/*.md`. That is a plan 2 task, noted here.

| File | Mode | Why this mode |
|---|---|---|
| `web-audio.md` | `fileMatch`: `web/**/*`, `teach.html` | The rules are only about browser audio code and are the longest file. They are noise when Kiro edits the segmenter. Plan 2 creates `web/` and `teach.html`, so they match from then on |
| `layers.md` | `fileMatch`: `core/**/*`, `web/**/*`, `node/**/*` | The boundaries matter when Kiro works inside a layer. Docs, scripts and tests do not need it. All three layers are listed because the rule says what each layer may not import |
| `units.md` | `always` | A threshold can appear anywhere: `core/`, `node/`, tests, scripts, docs. A `fileMatch` list would miss a new file in a new place. The file is five lines |
| `privacy.md` | `always` | The rule is a promise to the user and applies to every file that can send data: `web/`, `apps/`, `tools/`, a new script. Missing it once is worse than the cost of five lines |

### Rules per file
`web-audio.md` (from 4.1 and 8.3):
- Open the microphone with `getUserMedia` and set `echoCancellation`, `noiseSuppression` and `autoGainControl` to `false`, on every page that records or listens.
- Call `AudioContext.resume()` after a user gesture.
- Serve the page over HTTPS. A microphone does not work on plain HTTP outside `localhost`.
- Accept sample rates from 16000 to 96000 Hz. Reject others with an error.
- Make the AudioWorklet only pass sample chunks to its `port`. Do the computing (FFT, YIN, kNN) in a Web Worker.
- Load the worklet from a Blob URL built from a string.
- Warn in the debug overlay when the sample rate differs from the rate of the taught sounds.

`layers.md` (from 4.2 and the plan's Global Constraints):
- Keep `core/` pure TypeScript. Import no `fs`, `path`, DOM or Web Audio API there.
- Put browser code (microphone, AudioWorklet, teach UI, overlay) in `web/`.
- Put file reading and writing, and tools, in `node/`.
- Let apps import from `tokk` only, never from `core/` paths (checked by `npm run check:public-api`).
- Export from `core/index.ts` only what the public API needs.

`units.md` (from 8.3 and Global Constraints):
- Write every threshold and time constant in ms, Hz or dB, with the unit in the name.
- Never hard-code a sample count. Derive it from the sample rate and a constant.
- Keep the constants in `core/constants.ts`.
- Compute every time `t` as a cumulative sample count divided by the sample rate, in seconds.

`privacy.md` (from 8.3 and Global Constraints):
- Never write code that sends audio over the network.
- Never store recorded samples in `sounds.json`. Store feature vectors only.
- Keep original recordings only in the local `sounds/` folders.

The Global Constraint "the sound name `background` is reserved" is not in design 8.3, so this task writes it in no steering file. Task 11B's `integrate.md` can carry it.

## Hook files
The format is the standalone definition that the Kiro docs describe for `.kiro/hooks/*.json`, introduced in IDE 1.0 and CLI V3 and read by both (docs: Hooks, page of 12 November 2026). The files were not written by the Kiro "Ask Kiro to create a hook" flow; the schema was taken from the docs, so step 6.2 in `tasks.md` opens them in the IDE panel to confirm they load.

Schema used (one hook per file):

| Field | Value in this task |
|---|---|
| `version` | `"v1"` |
| `hooks` | array with exactly one object |
| `hooks[].name` | `pbt-quick` or `public-api-only` |
| `hooks[].description` | one sentence, English |
| `hooks[].trigger` | `PostFileSave` (docs name "File Save", PascalCase form, the only form shown in the docs example) |
| `hooks[].matcher` | regular expression against the file path, see below |
| `hooks[].action` | `type` `command` and `command` `npm run pbt:quick` or `npm run check:public-api` |
| `hooks[].timeout` | `60` for `pbt-quick`, `30` for `public-api-only` (seconds) |
| `hooks[].enabled` | `true` |

The command runs in the project root. Kiro sends session context as JSON on standard input, and both commands ignore it. Exit code 0 puts the output in the agent's context. Another exit code sends the error output to the agent and tells it that the hook failed. This is the behaviour wanted: a failing property test or a forbidden import is reported without a credit-costing prompt of our own. The action is a shell command, so the hook itself starts no model call.

| Hook | Matcher (regular expression) | Matches | Does not match |
|---|---|---|---|
| `pbt-quick` | `(^\|[\\/])core[\\/](segment\.ts\|grammar\.ts\|classify[\\/].+)$` | `core/segment.ts`, `core\grammar.ts`, `C:/x/tokk/core/classify/knn.ts` | `test/segment.test.ts`, `core/features.ts`, `core/segment.ts.bak` |
| `public-api-only` | `(^\|[\\/])apps[\\/]` | `apps/hands-free/demo/main.ts`, `C:\x\tokk\apps\knock-once\app.js` | `docs/apps.md`, `core/apps.ts` |

In the table the pipe characters are written with a backslash only because of the Markdown table. In the file the regular expression has no backslash before `|`, and each backslash of the expression is doubled because the value sits in a JSON string.

Design choices:
- **Regular expression with both separators.** The docs say the file-event matcher is a regular expression on the path, and do not say whether the path is relative or absolute or which separator it has on Windows. The expressions accept all four cases.
- **`public-api-only` matches any file under `apps/`**, as the plan says (`apps/**`), although the script reads only `.ts`, `.tsx` and `.js`. Saving a CSS file runs a check that finds nothing in under a second.
- **Not on the test files.** Saving `test/segment.test.ts` does not start `pbt-quick`. The plan names source files only, and a test file under edit would run 12 s on every save.
- **Timeout.** The default of 60 s is kept for `pbt-quick`, written down so it shows in the file. The goal is 20 s. A longer value would hide a slow run.
- **Both hooks in separate files.** The docs allow several hooks per file. Separate files give each hook its own name in the panel and make Task 11B's hooks easy to add as more files.

### Risks and open point
- **Does File Save fire on a save made by the user?** The docs describe the File Save trigger as "the agent saves or modifies files that match the patterns". The plan wants the hook to run when the user saves in the IDE. The manual check in `tasks.md` step 6 decides. If the hook runs only after the agent edits a file, the design keeps the hook (it still guards agent edits, which is where most edits happen in this project), and the devlog and the Devpost text must say "on agent and editor saves" only for what was seen.
- **CLI.** `PostFileSave` is listed for CLI V3. This task checks the IDE only, as the plan says.
- **Output size.** The compact reporter keeps the passing run to a few lines. A failing run prints the counterexample of fast-check, which can be long and goes to the agent as intended.

## Constants and dependencies
No new constant in `core/constants.ts`. No new package. Values owned by this task (the three candidate files, the case count 20 and the hook timeouts) are written in `scripts/pbt-quick.ts` and in the hook files, where they are used.
