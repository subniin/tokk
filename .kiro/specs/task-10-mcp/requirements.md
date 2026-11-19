# Requirements: Task 10, MCP server `mcp-ears`

## Introduction
Task 10 of the plan builds `tools/mcp-ears/server.ts`, a stdio MCP server started by `npm run mcp` (`tsx tools/mcp-ears/server.ts`). It lets a coding agent in Kiro test sound code against real recordings: teach sounds from a folder, listen to a recording, and score a labelled folder (design 8.1). It wraps code that already exists (`teachFromDir`, `createEngine`, `scoreDir`, `readWavFile`). It adds no sound processing.

This task offers three tools: `teach`, `listen`, `score`. The `spectrogram` tool is added later, together with Task 9b (`renderSpectrogram`, `encodePng`), and the `synth` tool is out of scope (design 8.1 puts it last in the cutting order). The server is built so that adding `spectrogram` is one new tool definition (Requirement 2).

The server uses `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk`, and `zod` for the input schemas.

| Consumer | What it uses from this task |
|---|---|
| Task 9b (spectrogram) | The tool list and the path guard. Adds one tool definition and updates one test expectation |
| Task 11B (MCP registration, hook `sounds-rebuild`) | `npm run mcp`, the tool names and the output formats |
| Custom agent `sound-tuner` (later) | `teach`, `listen`, `score` output text |
| Kiro power `tokk` (later) | The same server |

Out of scope: the `spectrogram` and `synth` tools, `.kiro/settings/mcp.json` registration (Task 11B), the Kiro power, any change under `core/`, any change to `scripts/score.ts` or to `node/teach.ts`, `node/score.ts`.

Dependency versions: the registry was not reachable when this spec was written, so no version is claimed here. Task 2 of `tasks.md` installs the packages with exact pinning and records the versions it got in `design.md` (table "Pinned versions") and in `docs/devlog.md`.

## Requirements

### Requirement 1: Server, start-up and dependencies
**User story:** As a developer, I want one command that starts the server, and a server that never corrupts the protocol stream.

#### Acceptance Criteria
1. THE `package.json` `scripts` SHALL get `"mcp": "tsx tools/mcp-ears/server.ts"`. Other scripts and `exports` SHALL stay unchanged.
2. THE packages `@modelcontextprotocol/sdk` and `zod` SHALL be installed as `devDependencies` with exact versions (installed with `--save-exact`, so `package.json` has no `^` or `~` for them). The server runs from the repository checkout, and the published `tokk` package exports only `core` and `node`, so the consumers of `tokk` do not get the SDK. The versions SHALL be stated in `design.md`. The `zod` major version SHALL be one that the installed SDK lists as a supported peer.
3. THE file `tools/mcp-ears/server.ts` SHALL export a function `createServer(options?)` that returns a configured `McpServer` and does not connect it. The option `root` (folder) SHALL default to the working directory at the time of the call. THE server name SHALL be `mcp-ears`.
4. WHEN the file is run directly (as `npm run mcp` does), THE server SHALL connect to a `StdioServerTransport`. WHEN the file is imported (by tests), it SHALL NOT start any transport and SHALL have no side effect.
5. THE server SHALL write nothing to the standard output except protocol messages. Diagnostics, if any, SHALL go to the standard error.
6. THE server SHALL list exactly the tools `teach`, `listen` and `score`, each with a short description and a zod input schema.
7. THE server SHALL NOT send audio over the network and SHALL NOT store recorded samples anywhere. (privacy rule)

### Requirement 2: One registration per tool
**User story:** As the author of Task 9b, I want to add the spectrogram tool without touching the server wiring.

#### Acceptance Criteria
1. EVERY tool SHALL be one definition object in a single list: name, description, input schema, and a handler that takes the checked arguments and a context (`root`) and returns a list of content items.
2. THE server SHALL register all tools by looping over that list. The loop SHALL be the only place that calls the SDK's registration function, and it SHALL wrap every handler with the shared error handling (Requirement 7).
3. THE content item type SHALL allow `text` items and `image` items (`type`, base64 `data`, `mimeType`), so that the spectrogram tool needs no change to the type or the loop.
4. THE path guard (Requirement 3) and the sounds reader SHALL be shared helpers that the handlers call. A new tool SHALL reuse them without changes.

### Requirement 3: Path safety
**User story:** As a user who lets an agent call tools, I want the server to read and write only inside the project folder.

#### Acceptance Criteria
1. EVERY path argument (`dir`, `out`, `wav`, `sounds`) SHALL pass through one function before any file is touched.
2. THE function SHALL take the root as `fs.realpath(root)`. A relative argument SHALL be resolved against the root. An absolute argument SHALL be allowed when it passes the check.
3. FOR an argument whose target exists, THE function SHALL compute `fs.realpath` of the full path (this resolves symbolic links and Windows junctions). FOR `out` of `teach`, which may not exist yet, it SHALL compute `fs.realpath` of the parent folder and join the file name. IF that parent does not exist, THEN the call SHALL fail with a message saying the parent folder is missing, and nothing SHALL be created.
4. THE function SHALL compute `path.relative(realRoot, p)` and SHALL reject the path when the result is absolute (another drive on Windows), or is `..`, or begins with `..` followed by a path separator. A name that merely starts with two dots, such as `..notes`, SHALL be accepted. The root itself (relative path empty) SHALL be accepted for folder arguments.
5. THE function SHALL NOT compare by string prefix. A sibling folder such as `../tokk-evil` of a root named `tokk` SHALL be rejected.
6. THE rejection message SHALL say that the path is outside the working folder and SHALL name the argument as the caller wrote it. It SHALL NOT print the resolved real path.
7. WHEN the path is rejected, THE tool SHALL NOT read, create or change any file.
8. THE check and the later file access are separate steps (a path can change between them). THE design SHALL state this as an accepted limit for a local tool.

### Requirement 4: Tool `teach`
**User story:** As a developer, I want the agent to turn a folder of examples into `sounds.json` and tell me what is weak.

#### Acceptance Criteria
1. THE input SHALL be `{ dir: string, out?: string }`. THE `out` default SHALL be `dir/../sounds.json`. THE default SHALL pass the same path check as an explicit `out`. IF `dir` is the root itself, so that the default falls outside the root, THEN the error SHALL say so and tell the caller to pass `out`.
2. THE tool SHALL call `teachFromDir(dir)`, and only when that succeeds write the model to `out` as JSON with 2-space indentation and a final newline. WHEN `teachFromDir` rejects, nothing SHALL be written.
3. THE file written SHALL be the `SoundModel` as returned, with feature vectors only (`id`, `label`, `v` per example). It SHALL hold no samples. (privacy rule)
4. IF `out` exists, THEN it SHALL be a regular file whose content is a sounds model (an object with `version` 1 and an `examples` array). OTHERWISE the call SHALL fail without writing, so that an agent cannot overwrite `package.json` by passing it as `out`. IF `out` is a folder, the call SHALL fail.
5. THE text result SHALL contain, in this order: a first line `taught <L> sounds, <N> examples -> <out as a path relative to the root>`; one line per label `<label>: <examples> examples, LOO accuracy <0.00 to 1.00>`; one line per confused pair `confused: <a> -> <b> <rate with 2 decimals>`, or `confused: none`; and one line per warning `warning [<code>] <file>: <message>`, or none. The calibration-lead warnings of `teachFromDir` (`shorter-than-calibration`, `sound-in-calibration`, `no-sound-found`) and `no-pitch-found` SHALL appear in this way.
6. THE report order SHALL be the order of the `TeachReport` (labels, confused pairs, warnings), so the output is the same on every run for the same folder.
7. A `TooFewExamplesError` (fewer than the minimum examples for a label, or no label folders) SHALL become a tool error whose text contains the per-label counts from the error message.

### Requirement 5: Tool `listen`
**User story:** As a developer, I want to see what the engine hears in a recording, one event per line.

#### Acceptance Criteria
1. THE input SHALL be `{ wav: string, sounds: string }`. THE tool SHALL read the WAV with `readWavFile`, read `sounds` as a `SoundModel` (Requirement 7.5), create an engine with `createEngine` and an `onEvent` collector, push all samples, call `flush`, and use the collected events. THE tool SHALL NOT use `runSamples`, because its result keeps only the time of an unknown sound and not the nearest example.
2. THE engine SHALL be created with the sample rate of the WAV header. A rate outside the supported range SHALL become a tool error that carries the `RangeError` message.
3. EACH sound event SHALL give one line `<label> @ <t>s conf <confidence>`, with `t` in seconds with 3 decimals and the confidence with 2 decimals, for example `clap @ 0.210s conf 0.82`.
4. EACH unknown sound SHALL give one line `unknown @ <t>s nearest <id>`, where `<id>` is the `nearest.id` of the model example, for example `unknown @ 1.100s nearest clap/03.wav#0`.
5. THE lines SHALL be in time order (ties in the order the engine reported them). Events of kind `continuous` SHALL NOT produce a line.
6. THE last line SHALL be the summary: counts per label as `<label> x<count>` separated by comma and space, labels in code-unit order, then `unknown x<count>` last when there are unknown sounds, for example `clap x2, unknown x1`. WHEN no event was found, the whole output SHALL be the single line `no sounds found`, with no summary line.
7. AN empty recording or a silent recording SHALL give `no sounds found` and no error.
8. THE output SHALL be the same on every run for the same inputs.

### Requirement 6: Tool `score`
**User story:** As a developer, I want the agent to see precision, recall and the confusion table for a labelled folder.

#### Acceptance Criteria
1. THE input SHALL be `{ dir: string, sounds: string }`. THE tool SHALL call `scoreDir(dir, model)` from `node/score.ts` and print the report as text. It SHALL NOT write any file, not the experiments file and not a baseline.
2. THE text SHALL contain a table with one row per label: `label`, `truths`, `tp`, `fp`, `fn`, `inCalibration`, `precision`, `recall` (3 decimals), with a header row and padded columns. THEN a confusion table (rows are the truth or `none`, columns the predicted labels, counts), or the line `confusion: none` when empty. THEN one line with `false positives per hour` (1 decimal), `total seconds` (1 decimal) and the in-calibration total. THEN one line per warning `warning [<code>] <file>: <message>`.
3. IF the report has no labels and no scored recording (an empty folder, or only recordings without labels), THEN the tool SHALL return a tool error that says no labelled recordings were found. (The script of Task 9a does the same, exit 2.)
4. THE format code SHALL live in the MCP tool folder. `scripts/score.ts` SHALL NOT be edited.
5. THE output SHALL be the same on every run for the same inputs.

### Requirement 7: Errors
**User story:** As an agent, I want a clear message when something is wrong, and a server that stays up.

#### Acceptance Criteria
1. ANY error thrown by a handler SHALL be returned as an MCP tool result with `isError: true` and one text item with a clear message. THE server SHALL NOT crash, SHALL NOT exit, and SHALL answer the next call normally.
2. THE messages SHALL name what went wrong in the user's terms: path outside the working folder, file or folder not found (from `ENOENT`, with the path as given), unsupported WAV format (the `readWav` message that names 16-bit PCM), too few examples (with counts), invalid sounds file, unsupported sample rate.
3. A message SHALL NOT include a stack trace. It MAY include the original message of the error.
4. FOR invalid arguments (a missing field, a wrong type, an empty string), THE SDK's own input validation SHALL answer, either as a tool error result or as a protocol error, depending on the SDK version. THE server SHALL stay usable afterwards. THE tests SHALL accept either form and check the next call.
5. THE sounds file SHALL be read as JSON and checked to be an object with `version` 1 and an `examples` array (the same check as `scripts/score.ts`). IF it is not valid JSON or fails the check, THEN the error SHALL say which file and what is wrong.
6. THE error text SHALL NOT contain audio samples or feature vectors.

### Requirement 8: Tests
**User story:** As a maintainer, I want the server tested through the real protocol, without a child process.

#### Acceptance Criteria
1. THE tests in `test/mcp.test.ts` SHALL connect a `Client` and the server from `createServer({ root })` with the SDK's in-memory transport (`InMemoryTransport.createLinkedPair()` from the SDK's `inMemory` module; the exact import path of the installed version is recorded in `design.md`).
2. EVERY test SHALL use a temporary folder made per test and removed in `afterEach`, with the working root set through the `root` option. Synthetic recordings SHALL start at or after a test-only lead of 1200 ms (named with its unit), as in the other tests.
3. THE tests SHALL cover: the tool list is exactly `listen`, `score`, `teach`, each with a description and an input schema; `listen` on a synthetic recording gives the expected label lines and the summary line; an unknown sound gives the `unknown @ ... nearest <id>` line with an id that exists in the model; a silent recording gives `no sounds found`; `teach` writes `sounds.json` at the default place and at an explicit `out`, reports the per-label counts, and the written file holds only model keys (no samples); `teach` warnings (a recording with a sound in the first second) appear as `warning [sound-in-calibration]`; `teach` with 4 examples is a tool error with counts and writes nothing; `score` prints the table and the confusion table for a fixture folder and writes no file; an empty fixture folder is a tool error; a missing file is a tool error with the path as given; a 24-bit WAV is a tool error that names 16-bit PCM; invalid sounds JSON is a tool error; invalid arguments fail and the next call works.
4. THE path tests SHALL cover: an absolute path outside the root; `../` relative; the sibling-prefix case (`<tmp>/tokk` as root and `../tokk-evil/...` as the argument, for a read argument and for `out`); `out` whose parent is missing; `out` with a parent outside the root, with a check that no file appeared outside; a link or junction inside the root that points outside (skipped when the platform refuses to create it); a name such as `..notes.json` inside the root accepted; the root itself accepted as `dir`; the default `out` falling outside the root when `dir` is the root, with the "pass `out`" hint; `out` existing as a non-model file (`package.json`-like) refused and left unchanged; `out` as a folder refused.
5. THE test of the tool list SHALL be the one place that Task 9b changes when it adds `spectrogram`.
6. THE tests SHALL NOT start a child process and SHALL NOT touch the real working directory.

### Requirement 9: Constants, layers and privacy
**User story:** As a maintainer, I want the project rules kept.

#### Acceptance Criteria
1. THE server file and its helpers SHALL live under `tools/mcp-ears/` and MAY import `fs/promises`, `path`, `node/` and `core/`. Nothing under `core/` SHALL change. `core/index.ts` and `node/index.ts` SHALL NOT change, so the public API test of Task 8 stays valid.
2. NO threshold or time constant SHALL be added. Event times `t` come from the engine as a cumulative sample count divided by the sample rate, in seconds, and are only printed. Number of printed decimals SHALL be file-local named constants. No sample count SHALL be written as a literal.
3. NO code of this task SHALL send audio over the network, write a recording, or store samples in `sounds.json`. The server SHALL write only the `out` file of `teach` (Requirement 4).
4. ALL text in code, comments, messages and the commit SHALL be English.
