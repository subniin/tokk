# Tasks: Task 10, MCP server `mcp-ears`

Order is test-first. Do not write `tools/mcp-ears/*.ts` before the tests for it exist and fail. The `spectrogram` tool belongs to Task 9b and is not part of this task. `synth` is out of scope.

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `node/teach.ts` (`teachFromDir`), `node/score.ts` (`scoreDir`), `node/files.ts` (`readWavFile`, `writeWavFile`), `core/engine.ts` (`createEngine`, `EngineEvent`) and `core/synth.ts` exist, and that the tests of Tasks 1 to 5, 7, 8, 9a and 11A pass.
  - [x] 1.2 Read `test/helpers/engine-fixture.ts`, `test/helpers/score-fixture.ts` and the folder-building code of `test/teach.test.ts`. Note what can be reused for a model, a labelled folder and a taught folder.
  - [x] 1.3 Confirm that `tools/` does not exist yet, that `package.json` has no `mcp` script, and that `node/index.ts`, `core/index.ts` and `core/constants.ts` stay as they are in this task.

- [x] 2. Install and check the SDK
  - [x] 2.1 Install `@modelcontextprotocol/sdk` and `zod` as dev dependencies with exact pinning (`--save-exact`). Use a `zod` version inside the SDK's peer range. Check that `package.json` has no `^` or `~` for the two packages.
  - [x] 2.2 Check against the installed package (its `exports` field and its type files) the import paths listed in `design.md`: `server/mcp.js`, `server/stdio.js`, `client/index.js`, `inMemory.js`; that `InMemoryTransport` has `createLinkedPair()` and which side comes first; and the name and input form of the registration function. Check that the project's TypeScript settings resolve these subpaths. If they do not, stop and report instead of editing `tsconfig.json`.
  - [x] 2.3 Write the two installed versions and the confirmed import paths into the "Pinned versions" part of `design.md`. Correct the design text first if a name differs.
  - [x] 2.4 Add `"mcp": "tsx tools/mcp-ears/server.ts"` to `package.json` `scripts`. Leave the other scripts and `exports` unchanged. (Req 1.1)

- [x] 3. Write failing tests
  - [x] 3.1 `test/helpers/mcp-client.ts`: makes the linked in-memory pair, connects `createServer({ root })` and a `Client`, returns `{ client, close }`. (Req 8.1)
  - [x] 3.2 If the earlier helpers do not cover it, `test/helpers/mcp-fixture.ts`: writes a taught-sounds folder (label folders with WAV files), a recording with impacts at given times, and a silent recording, in a temporary folder. Every sound starts at or after a test-only `LEAD_MS` of 1200, except in the calibration test. (Req 8.2)
  - [x] 3.3 `test/mcp.test.ts`, tool list: exactly `listen`, `score`, `teach`, each with a description and an input schema. (Req 1.6, 8.3, 8.5)
  - [x] 3.4 `test/mcp.test.ts`, path guard (Req 3, 8.4): absolute path outside the root; `../` relative; sibling-prefix `../tokk-evil/...` for a read argument and for `out`, with a check that the sibling folder gained no file; `out` with a missing parent; `out` with a parent outside; a link or junction inside the root pointing outside (skipped with a reason if it cannot be created); `..notes.json` accepted; the root itself accepted as `dir`; the rejection message names the argument and does not contain the real root path.
  - [x] 3.5 `test/mcp.test.ts`, `teach` (Req 4): writes `sounds.json` at `dir/../sounds.json`; writes at an explicit `out`; the text has the first line, one line per label and `confused:`; the file holds only model keys and each example only `id`, `label`, `v`; a sound in the first second gives `warning [sound-in-calibration]`; 4 examples for a label is a tool error with counts and writes nothing, and an existing `sounds.json` stays unchanged; `dir` as the root gives the "pass `out`" hint; `out` existing as a non-model JSON file is refused and unchanged; `out` as a folder is refused; running twice gives the same text and the same file.
  - [x] 3.6 `test/mcp.test.ts`, `listen` (Req 5): a recording with two impacts of a taught class and one far sound gives two lines matching `clap @ <t>s conf <c>` (3 and 2 decimals, times within 20 ms of the placed times), one `unknown @ <t>s nearest <id>` line whose id exists in the model, time order, and the last line `clap x2, unknown x1`; a silent recording and an empty recording give exactly `no sounds found`; a recording with only taught sounds has no `unknown` in the summary; sample rate 8000 is a tool error with the supported range; two runs give the same text.
  - [x] 3.7 `test/mcp.test.ts`, `score` (Req 6): a fixture folder gives the table with the right counts, the confusion table and the totals line; the folder holds the same files after the call (nothing written, no experiments file); an empty folder and a folder with only unlabelled WAV files are tool errors saying no labelled recordings were found; a warning (recording without labels next to a labelled one) appears as `warning [no-labels]`.
  - [x] 3.8 `test/mcp.test.ts`, errors (Req 7): missing WAV is a tool error with the path as given and no stack; 24-bit WAV is a tool error naming 16-bit PCM; sounds file that is invalid JSON, or has no `examples`, is a tool error naming the file; missing argument and wrong type fail (tool error or protocol error, both accepted) and the next call works; no error text contains `at ` stack lines.
  - [x] 3.9 Run the new tests and confirm FAIL (modules missing).

- [x] 4. Implement
  - [x] 4.1 `tools/mcp-ears/paths.ts`: `createPathGuard(root)` with `resolveExisting` and `resolveForWrite`, the segment-aware relative check, messages that use the argument as given. Run the path tests (3.4), expect them to move toward PASS. (Req 3)
  - [x] 4.2 `tools/mcp-ears/errors.ts` and `tools/mcp-ears/sounds.ts`: `toToolError`, `readSoundsFile`. (Req 7)
  - [x] 4.3 `tools/mcp-ears/format.ts`: teach, listen and score text formatters, with file-local decimal constants. (Req 4.5, 5.3 to 5.6, 6.2)
  - [x] 4.4 `tools/mcp-ears/tools.ts`: the `TOOLS` list with `teach`, `listen`, `score`, zod input schemas and handlers, the content type with `text` and `image`. (Req 2, 4, 5, 6)
  - [x] 4.5 `tools/mcp-ears/server.ts`: `createServer({ root })`, the single registration loop with the error wrapper, the direct-run entry that connects `StdioServerTransport`, nothing written to the standard output. (Req 1, 2.2)
  - [x] 4.6 Run `test/mcp.test.ts`. Expect PASS.

- [x] 5. Verify by hand
  - [x] 5.1 Start `npm run mcp` in a throw-away way, send one JSON-RPC `initialize` request line on the standard input, and confirm that exactly one JSON response comes back on the standard output, with server name `mcp-ears`, and nothing else is printed there. Stop the process. Do not leave a script or a log file behind. (Req 1.4, 1.5)
  - [x] 5.2 Confirm that importing `tools/mcp-ears/server.ts` in the tests starts no transport (the test run exits by itself).

- [x] 6. Verify and commit
  - [x] 6.1 Run the full test suite and the TypeScript check. All earlier tests still pass, including the public API test of Task 8 (this task adds no export to `core/index.ts` or `node/index.ts`).
  - [x] 6.2 Check that nothing under `core/` changed, that `scripts/score.ts`, `node/teach.ts` and `node/score.ts` are unchanged, that no threshold or sample count is a literal number, and run `npm run check:public-api`. (Req 9.1, 9.2)
  - [x] 6.3 Check that no code sends audio over the network, that the only file written by the server is the `out` model of `teach`, and that no model or error text holds samples. (Req 9.3, 7.6)
  - [x] 6.4 Check that `package.json` changed only in `scripts.mcp` and the two exact dev dependencies, and that the lock file matches. Check that no temporary folder, script or log remains and that no Korean text is in tracked files outside `docs/_planning/`. (Req 1.2, 9.4)
  - [x] 6.5 Add a line to `docs/devlog.md`: MCP server done with `teach`, `listen`, `score`, the pinned SDK and zod versions, and a note that `spectrogram` comes with Task 9b and registration in `.kiro/settings/mcp.json` with Task 11B.
  - [x] 6.6 Commit with the message `feat: add mcp-ears MCP server`.
