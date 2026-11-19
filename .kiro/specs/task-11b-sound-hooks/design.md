# Design: Task 11B, sound and score hooks, MCP registration

## Layer rule
The new scripts live in `scripts/` like `scripts/score.ts`. They may use `fs`, `path`, `os` and import from `node/` and `core/` by relative path. Nothing under `core/` changes except new named constants in `core/constants.ts`. No audio leaves the machine. The only recordings written are synthetic and sit under `fixtures/audio/synth/`. `sounds.json` files hold feature vectors only.

## Files
```
scripts/sounds-rebuild.ts        runSoundsRebuild(argv, env): exit code; direct-run entry
scripts/make-synth-fixtures.ts   makeSynthFixtures(outDir); direct-run entry writes fixtures/audio/synth
scripts/corpus-score.ts          runCorpusScore(argv, env): exit code; direct-run entry
core/constants.ts                new SYNTH_FIXTURE_* and CORPUS_SCORE_BUDGET_MS constants
fixtures/audio/synth/
├─ sounds/<low|mid|high|ring|background>/*.wav
├─ sounds.json                   made by sounds:rebuild, committed
├─ quick/quick-01.wav, quick-01.json, quick-02.wav, quick-02.json
└─ scores-quick.json             committed baseline of the synthetic set
.kiro/hooks/corpus-score.json
.kiro/hooks/sounds-rebuild.json
.kiro/settings/mcp.json
.kiro/steering/integrate.md
tsconfig.json                    include gets "tools"
docs/experiments.md              header only, created if missing
docs/devlog.md                   one line
package.json                     scripts: sounds:rebuild, synth:fixtures, corpus-score
test/scripts.test.ts             additions
test/synth-fixtures.test.ts
```
Scripts follow the shape of `scripts/score.ts`: an exported function that takes `argv` and an environment (`cwd`, `out`, `err`, and where needed `root`) and returns an exit code, plus a direct-run entry that runs only when `import.meta.url` is the process entry. Tests call the function with temporary folders.

## `sounds-rebuild`
Flow:
```
dir = resolve(cwd, argv[0] ?? "examples/sounds")
no folder, or no subfolder  -> note, exit 0
target = dir/../sounds.json
target exists and is not a sounds model, or is a folder -> Error, exit 1
teachFromDir(dir)
  TooFewExamplesError -> counts + "more examples needed", exit 0, nothing written
  other error         -> Error to stderr, exit 1
write model (2-space JSON + newline)
print summary, labels, confused pairs, warnings; exit 0
```
"Label subfolder" means a directory entry. Files directly in the folder are ignored by this check. A folder with label subfolders but no `.wav` files falls through to `teachFromDir`, whose error is a `TooFewExamplesError` (counts of 0) and so a note and exit 0.

Output lines have the shape of the MCP `teach` text (`taught 5 sounds, 58 examples -> fixtures/audio/synth/sounds.json`, then labels, `confused:` lines, `warning [code] file: message`). The formatter is a few lines inside the script. It is not shared with `tools/mcp-ears/format.ts`, so the finished MCP task stays unchanged. The two outputs are meant to look alike, not to be one function.

Why exit 0 for too few examples: the hook fires on every saved recording. A non-zero code would report a failure for the normal first four recordings of a label.

## Synthetic set
### Why this shape
The set must be small, deterministic and clean enough that scoring gives recall near 1.0, so that a drop signals a code change and not noise. It uses the four classes of `SYNTH_CLASSES` (`low`, `mid`, `high`, `ring`), which the engine tests already know to be separable, and a `background` class of steady noise.

### Constants (in `core/constants.ts`, units in names)
| Name | Meaning | Value |
|---|---|---|
| `SYNTH_FIXTURE_SAMPLE_RATE_HZ` | Rate of every synthetic WAV | 16000 (the smallest supported rate, keeps files small) |
| `SYNTH_FIXTURE_LEAD_MARGIN_MS` | Margin added to `NOISE_FLOOR_WARMUP_MS` | 200 |
| `SYNTH_FIXTURE_LEAD_NOISE_DBFS` | Level of the noise bed in the lead and under the sounds | -75 |
| `SYNTH_FIXTURE_SPACING_MS` | Start-to-start distance of impacts | 600 for sounds files, 700 for quick files |
| `SYNTH_FIXTURE_TAIL_MS` | Quiet tail after the last sound | 400 |
| `SYNTH_FIXTURE_GAIN_DB` and `SYNTH_FIXTURE_GAIN_JITTER_DB` | Impact gain and the seeded spread | -12 and 3 |
| `SYNTH_FIXTURE_SEED` | Base seed. Each file derives its seed from it and the file index | any fixed integer |
| `SYNTH_FIXTURE_BACKGROUND_LEVELS_DBFS` | Two steady noise levels, one white and one pink | -45 and -35 |
| `CORPUS_SCORE_BUDGET_MS` | Time target of the `corpus-score` script | 15000 |

The values are starting points. Final values after the first run: all as in the table, except that `SYNTH_FIXTURE_SPACING_MS` is two constants, `SYNTH_FIXTURE_SOUNDS_SPACING_MS` (600) and `SYNTH_FIXTURE_QUICK_SPACING_MS` (700), plus `SYNTH_FIXTURE_QUICK_SEED_OFFSET` (1000), `SYNTH_FIXTURE_BACKGROUND_MS` (2000) and `SYNTH_FIXTURE_SEED` 20261119. Measured size: WAV and label files 1,594,930 bytes, with `sounds.json` (82,554 bytes) and `scores-quick.json` 1,678,428 bytes in total (limit 2 MB). Sound files hold 7.4 s (236,844 bytes), background files 3.2 s (102,444 bytes), quick files 6.9 s (220,844 bytes); the measured values replace the estimates in the table below. Teaching gives 84 examples (background 44), no warning and no confused pair; quick scores recall and precision 1.000 for all four labels. Counts of samples come from `round(ms × rate / 1000)`. The lead is `NOISE_FLOOR_WARMUP_MS + SYNTH_FIXTURE_LEAD_MARGIN_MS`, which is 1200 ms, the same lead the existing tests use. The noise bed at -75 dBFS is under `ONSET_MIN_LEVEL_DBFS` (-60), so it never opens a segment, and it keeps the floor estimate above digital silence.

### Layout and size
| Part | Files | Content | Length each | Size each (16-bit mono, 32 KB/s) |
|---|---|---|---|---|
| `sounds/<class>/` | 4, one per class | 10 impacts of that class | about 7.6 s | about 243 KB |
| `sounds/background/` | 2 | 2 s steady white noise, 2 s steady pink noise, each after a lead | about 3.5 s | about 112 KB |
| `quick/` | 2 | 8 impacts each, 2 per class, in a fixed shuffled order | about 7.2 s | about 230 KB |
| `sounds.json` | 1 | 5 labels, about 50 examples plus windows, 32 numbers each | | about 40 KB |

Total about 1.7 MB. The limit that the test enforces is 2 MB. If the first generation is above the limit, the spacing and the number of impacts come down before the sample rate does (16 kHz is already the minimum).

A recording is built with `place` from `core/synth.ts`: noise bed of the full length, plus the impacts at their start times. The start time of every impact is converted to a sample index with `round(atMs × rate / 1000)`, and the label `t` is that index divided by the rate. The label file is written from the index, so it matches the audio exactly (units rule).

`background` files: the steady noise is the file content after the lead. Fixed 300 ms windows with 50% overlap give at least 5 examples per file. The noise levels differ so that the two background clusters cover both loud and quiet rooms.

`quick` files have the same noise bed at the lead level, the impacts at `SYNTH_FIXTURE_GAIN_DB` plus seeded jitter, and no other sound. Seeds differ from the `sounds/` seeds, so teaching and testing use different realizations of the same classes (design 8.9 asks for separate recordings). Label files follow design 8.9: `events`, `device: "synthetic"`, `room: "none"`, `sampleRate`.

### Determinism
All noise and jitter come from `rng(seed)`. Float math is the same on every platform for the operations used here, but output is rounded to 16-bit integers, and a one-bit difference between platforms is possible in principle. The test therefore regenerates into a temporary folder and compares to the committed files on the platform where the test runs. A mismatch on another platform is a signal to look at it, not to loosen the test. The JSON files are written with `JSON.stringify(x, null, 2)` and a final newline, and with `\n` line endings. `.gitattributes` is not needed for WAV (binary by content); the task checks that git does not treat the WAV files as text.

### Refresh rule
`sounds.json` holds feature vectors made by the current feature code. After a change in `core/features.ts` or `core/constants.ts` the committed vectors are stale. The test of Requirement 2.11 compares example ids and labels and not the numbers, so it stays green, but the corpus-score hook then scores with old vectors. The refresh is `npm run sounds:rebuild fixtures/audio/synth/sounds`, then `npm run corpus-score -- --update-baseline` if the new scores are accepted. `integrate.md` does not cover this. The devlog line of this task states it once.

## `corpus-score`
```
real      = file examples/sounds.json AND quick folder with >= 1 wav that has a same-name json
synthetic = file fixtures/audio/synth/sounds.json AND synth quick folder with the same condition
```
Decision order: real, then synthetic, then the note `corpus-score: no scored set yet (add fixtures/audio/quick with examples/sounds.json, or run npm run synth:fixtures)` and exit 0.

The "same-name json" check lists the folder and looks for `<name>.wav` plus `<name>.json`. Files without a label JSON are skipped by `scoreDir` itself with a warning, so a folder of only unlabelled WAV files would end in exit 2; the pre-check turns that into the note.

Real mode calls `runScore(['fixtures/audio/quick', 'examples/sounds.json', ...passthrough], { root, cwd, out, err, getCommit })` and returns its code. Passthrough arguments are the flags the caller gave (`--update-baseline`).

Synthetic mode:
```
tmp = mkdtemp(os.tmpdir()/tokk-corpus-)
copy fixtures/audio/synth/scores-quick.json -> tmp/docs/scores-quick.json  (if it exists)
code = runScore([synth quick, synth sounds.json, ...passthrough], { root: tmp, ... })
if --update-baseline and code is 0: copy tmp/docs/scores-quick.json back
remove tmp (finally)
```
The score script reads the baseline from `<root>/docs/scores-<folder name>.json`, and the folder name is `quick` in both modes. Using a temporary root keeps the two baselines apart and keeps synthetic lines out of `docs/experiments.md`, which is the record for real recordings. The regression rule stays the one of Task 9a (a label with fewer than 50 truths regresses when two or more true positives are lost).

Cost: scoring about 16 events of 16 kHz audio and teaching nothing (the model is read from JSON) is well under a second of engine time. Most of the time is the process start of `tsx` (about 1 to 2 s). The 15 s target leaves wide margin. The hook `timeout` is 30 s.

Real mode appends one line to `docs/experiments.md` on every run, so every save of a `core/**` file adds a line. This is how design 8.2 builds the experiment record, and it is accepted. The line carries the commit, or `uncommitted` when the tree is dirty, which it nearly always is during work.

## Hooks
Both files follow `pbt-quick.json`.

`corpus-score.json`:
- name `corpus-score`, trigger `PostFileSave`, matcher `(^|[\\/])core[\\/]`, command `npm run corpus-score`, timeout 30, enabled true.

`sounds-rebuild.json`:
- name `sounds-rebuild`, trigger `PostFileSave`, matcher `(^|[\\/])examples[\\/]sounds[\\/].+\.wav$`, command `npm run sounds:rebuild`, timeout 60, enabled true.
- For file creation, the task read the Kiro hook documentation (kiro.dev/docs/hooks/types and /hooks). It lists a `File Create` trigger for IDE and CLI V3, but the pages fetched at task time do not show its v1 JSON name (only `PostFileSave` is shown), and `PostFileCreate` is a guess. Result: the file keeps the save entry only, no unconfirmed trigger name is committed. A `sounds-rebuild-create` entry can be added once the name is confirmed in the Hooks UI of the IDE.

Matchers are regular expressions on the path with both separators, as in the existing hooks, so they work on Windows. The command for the sounds hook uses the default folder, so it needs no argument.

The JSON `timeout` is in seconds because Kiro defines it so. This is the one unit that the project rule on ms does not control, and the existing hooks do the same.

## MCP registration
Exact content of `.kiro/settings/mcp.json`:
```json
{
  "mcpServers": {
    "mcp-ears": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "disabled": false,
      "autoApprove": ["listen", "score"]
    }
  }
}
```
Notes:
- `--silent` keeps npm from printing its script banner (`> tokk@... mcp`) on the standard output, which is the protocol channel. Without it the first bytes the client reads are not JSON.
- No `cwd` field. The Kiro MCP documentation lists `command`, `args`, `env`, `disabled`, `autoApprove` and `disabledTools` and no working folder. Kiro starts workspace servers from the workspace folder, and `npm run` runs the script in the folder of `package.json`, so `process.cwd()` of the server is the repository root, which is the root the path guard uses (`createServer` default). The headless run confirms it: a relative path in the prompt (`fixtures/audio/synth/quick/quick-01.wav`) resolves only if the root is right.
- `autoApprove` holds the two read-only tools. `teach` writes a file and stays under approval.
- Windows fallback: if the client cannot start `npm` without a shell, the same file with `"command": "npm.cmd"`. The change is made only if the verification fails.
- The workspace file wins over the user file for the same server name, so a personal `mcp-ears` entry would be overridden here, which is the wanted result.

## Headless verification
The check is manual, because it needs the Kiro CLI, a login and a model. Steps in `tasks.md`. The prompt asks the agent to call the `mcp-ears` `listen` tool on `fixtures/audio/synth/quick/quick-01.wav` with `fixtures/audio/synth/sounds.json` and to print the tool result unchanged. The CLI runs in non-interactive mode with only that tool trusted (the flag names come from the CLI help of the installed version; they differ between releases). The expected result is the eight lines of `quick-01.json` in order, times within 20 ms of the label file (the segmenter test tolerance of the project), and the summary `high x2, low x2, mid x2, ring x2` (code-unit order of labels).

## `integrate.md`
Front matter `inclusion: fileMatch` with `fileMatchPattern` for `apps/**/*` and `docs/integration.md`, in the form of `layers.md`. If the existing steering files use another inclusion mode for new-app work, the task reads one and follows it.

Sections, each a short list of rule sentences:
1. Order of work: teach, rebuild `sounds.json`, connect patterns, test.
2. Public API (design 6): the three code samples (basic `listen`, modes, `expectEvents` test), stated as the target API. A status note says that `listen`, `loadSounds` and the teach UI arrive with plan 2; a Node integration today uses `createEngine`, `runSamples` and `expectEvents` from `tokk` and `tokk/node`.
3. Common mistakes: calibration lead, reserved `background`, stand-alone hum patterns (with the `hum` folder for the baseline), gap ranges and the late firing of prefix patterns. Each has the reason in one clause.
4. Project rules: units and privacy in one line each.

The `expectEvents` sample uses a synthetic recording path as the example (`fixtures/audio/synth/quick/quick-01.wav`) so the text can be run in this repository.

## `tsconfig.json` and `docs/experiments.md`
`include` becomes `["core", "node", "tools", "scripts", "test", "vitest.config.ts"]`. `scripts/` was added at approval of this spec, so the scripts are type-checked as well. `npx tsc --noEmit` reported no error in `tools/` or `scripts/`.

`docs/experiments.md` is created only if missing. Its text is the title and header lines that `scripts/score.ts` writes today. A test reads the constants of the script's output by running `runScore` on a temporary root and comparing, so the two cannot drift apart.

## Tests
- `test/scripts.test.ts`, `sounds-rebuild`: writes `sounds.json` at `<dir>/../sounds.json` from a temporary synthetic folder; default folder name is used when no argument is given (working directory set to a temporary project); prints confused pairs and exits 0 for a folder built with two nearly identical classes (reuse the folder builder of `test/teach.test.ts`); prints a warning and exits 0 for a recording with a sound in the first second; note and exit 0 for a missing folder and for a folder without subfolders, with no file written; four examples for a label give the counts, exit 0, no file, and an existing `sounds.json` unchanged; a 24-bit WAV gives exit 1 and no file; an existing non-model target is refused and unchanged; the file holds only model keys.
- `test/scripts.test.ts`, `corpus-score`: chooses real mode when both real inputs exist (temporary project with a small real-like set built from synthetic audio), synthetic mode when the real quick folder is empty or `examples/sounds.json` is missing, the note and exit 0 when neither exists; an existing but empty `fixtures/audio/quick` never fails; synthetic mode leaves `docs/` of the project untouched; baseline copy-in gives a regression exit 1 when a baseline is better than the run; `--update-baseline` copies the baseline back; the temporary folder is removed after success and after an error; the run on the committed synthetic set stays under `CORPUS_SCORE_BUDGET_MS`.
- `test/scripts.test.ts`, files: hook JSON (Requirement 4.5), MCP file (Requirement 5.4), `integrate.md` key phrases, `tsconfig` include, experiments header plus one appended line.
- `test/synth-fixtures.test.ts`: two generations into two temporary folders are byte-identical; the output matches the committed files byte for byte; total size under 2 MB; every WAV is 16-bit mono at `SYNTH_FIXTURE_SAMPLE_RATE_HZ` and starts with a lead where no segment opens (run the `Segmenter` over the lead); every label `t` times the sample rate is an integer; `teachFromDir` on `sounds/` gives five labels, no warnings, and each class at least `RECOMMENDED_EXAMPLES_PER_LABEL` examples; scoring `quick` with the committed model gives recall and precision at least 0.9 per label and no `inCalibration`; the committed `sounds.json` has the five labels and the same example ids as a fresh rebuild.

## Risks and rules
- **Synthetic scores hide real-sound problems.** The synthetic set measures regressions in code, not recognition of real sound. The real set replaces it automatically when `examples/sounds.json` and `fixtures/audio/quick/` exist.
- **Stale committed vectors.** See the refresh rule above.
- **Hook noise during recording.** `sounds-rebuild` fires per saved file. It is fast and exits 0 for the normal early states.
- **Hook create trigger unknown.** Confirmed from the Kiro documentation at task time. A save-only hook is an acceptable result if there is none.
- **MCP start on Windows.** `npm` may need `npm.cmd`. The headless run decides.
- **WAV files and git.** The task checks that the files are not ignored and are stored as binary. Size stays under the limit so the repository stays small.
- **`corpus-score` in real mode edits `docs/experiments.md` on each run.** Accepted, as in design 8.2.
- **`tsconfig` change may expose type errors in `tools/` and `test/`.** They are reported. Fixing a pre-existing error is a separate decision.
