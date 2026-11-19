# Design: Task 10, MCP server `mcp-ears`

## Layer rule
`tools/mcp-ears/*` is Node code. It may use `fs/promises`, `path` and import from `node/` and `core/`. Nothing under `core/` changes. No threshold or time constant is added, so `core/constants.ts` stays as it is. Printed decimals are file-local constants. Times come from the engine (cumulative samples divided by sample rate, in seconds) and are only formatted. No audio leaves the machine, and the only file the server writes is the `out` model of `teach`, which holds feature vectors.

## Pinned versions
| Package | Version | Where |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.2 (exact) | `devDependencies` |
| `zod` | 4.6.7 (exact) | `devDependencies` |

Task 2 installed both with `--save-exact` and checked the points below against the installed package. The SDK peer range for `zod` is `^3.25 || ^4.0`, so zod 4.6.7 is accepted. The design assumed the 1.x line of the SDK, which has `McpServer`, `registerTool` with a zod raw shape as `inputSchema`, `StdioServerTransport`, `Client` and `InMemoryTransport`.

Import paths for the 1.x line. The package maps `./*` to `dist/esm/*` (types `dist/esm/*.d.ts`), so subpaths carry the `.js` suffix. `inMemory.d.ts`, `server/mcp.d.ts` (`registerTool(name, { description, inputSchema }, cb)`) and `server/stdio.d.ts` exist in the installed package. Confirmed list (checked again by `tsc` with `moduleResolution` `bundler`):
- server: `@modelcontextprotocol/sdk/server/mcp.js` (`McpServer`), `@modelcontextprotocol/sdk/server/stdio.js` (`StdioServerTransport`)
- client in tests: `@modelcontextprotocol/sdk/client/index.js` (`Client`)
- in-memory transport in tests: `@modelcontextprotocol/sdk/inMemory.js` (`InMemoryTransport`, with `createLinkedPair()` returning the client side first and the server side second)

The `zod` major must be one that the SDK's `peerDependencies` accepts. Task 2 reads that range and picks the highest exact version inside it. If the TypeScript settings do not resolve package `exports` subpaths (`moduleResolution` of `Node16`, `NodeNext` or `Bundler`), Task 2 reports it and changes nothing else before asking, because `tsconfig.json` belongs to an earlier task.

## Files
```
tools/mcp-ears/
├─ server.ts      createServer, tool list wiring, direct-run entry
├─ tools.ts       TOOLS list: teach, listen, score (definitions and handlers)
├─ paths.ts       createPathGuard(root): resolveExisting, resolveForWrite
├─ sounds.ts      readSoundsFile(guard, arg): SoundModel
├─ format.ts      text formatters for teach, listen, score
└─ errors.ts      toToolError(error): message text
test/mcp.test.ts
test/helpers/mcp-client.ts   connect(root): { client, close }
package.json                 scripts.mcp, devDependencies (two entries)
docs/devlog.md               one line
.kiro/specs/task-10-mcp/
```
`node/index.ts` and `core/index.ts` do not change. `tools/mcp-ears/` imports `node/score.ts`, `node/teach.ts`, `node/files.ts` and `core/engine.ts` by relative path.

The split into small files keeps `server.ts` short. `tools.ts` is the file that Task 9b edits, by adding one definition.

## Server and entry
`createServer({ root })` builds an `McpServer` named `mcp-ears`, makes the path guard for `root` (default: the working directory at call time), and registers every definition of `TOOLS` in one loop. It returns the server unconnected. Tests connect it to an in-memory transport.

The direct-run entry sits at the bottom of `server.ts`. It runs only when the module is the process entry (comparison of `import.meta.url` with the entry file of the process), then creates the server and connects a `StdioServerTransport`. Importing the module does nothing. Errors while starting go to the standard error and set a non-zero exit code. Nothing is ever written to the standard output by the server's own code, because the protocol uses it.

## Tool definition shape
A definition holds: `name`, `description`, `inputSchema` (a zod raw shape, the form `registerTool` takes), and `run(args, ctx)`. `ctx` holds the path guard. `run` returns a list of content items: `{ type: 'text', text }` or `{ type: 'image', data, mimeType }`. The result type allows both now, so the spectrogram tool adds no type change.

The loop wraps `run`:
1. Call `run` inside try/catch.
2. On success return `{ content }`.
3. On error return `{ isError: true, content: [{ type: 'text', text: toToolError(error) }] }`.

The wrapper is the only place that decides how an error looks. The SDK's registration call is made only in this loop. If the SDK's generic types fight the list (a heterogeneous list of schemas), the loop casts at that one call and nowhere else.

### Adding `spectrogram` in Task 9b
Add one definition to `TOOLS`: input `{ wav, startS?, endS? }`, a handler that resolves the path with the guard, reads the WAV, calls `renderSpectrogram` and `encodePng`, and returns one `image` item with `mimeType` `image/png` and base64 data. Then change the expected name list in the tool-list test. No change to `server.ts`, the loop, the guard, or the error wrapper.

## Path guard
`createPathGuard(root)` computes `realRoot = await fs.realpath(root)` once, lazily on first use (so a root that is created after the guard still works in tests, and an invalid root fails with a clear message at the first call).

Two functions, both returning an absolute real path or throwing:
- `resolveExisting(arg)`: resolve `arg` against `realRoot` (an absolute argument stays as it is), call `fs.realpath` on the result, then run the check. If the target is missing, the `ENOENT` error is turned into "not found: `<arg as given>`". The check runs only on the real path, so a link inside the root that points outside is rejected.
- `resolveForWrite(arg)`: same resolution. If the target exists it behaves like `resolveExisting`. If not, it takes the parent folder, calls `fs.realpath` on it (a missing parent gives "parent folder not found: `<arg>`"), joins the file name, and runs the check on that path. The file name comes from `path.basename` of the resolved argument, so it cannot contain a separator.

The check:
```
rel = path.relative(realRoot, candidate)
reject if  path.isAbsolute(rel)                 (other drive on Windows)
        or rel === '..'
        or rel starts with '..' + path.sep
```
This is the user's rule (`path.relative` result starting with `..` or absolute) made segment-aware, so that a file called `..notes.json` inside the root is not refused. A string prefix test on the path is not used. It would accept `<parent>/tokk-evil` for a root `<parent>/tokk`, because the evil path starts with the root string. `path.relative` gives `../tokk-evil/x`, which the check rejects. On Windows, `path.relative` compares case-insensitively, and `realpath` returns the true case, so drive letter and case differences do not cause a false answer.

The rejection message is `<name> is outside the working folder: <arg as given>`. It does not print `realRoot` or the resolved path.

Accepted limit: the check and the later read or write are two steps. A process that can change the file system between them could swap a path for a link. The server is a local tool started by the user, and the same user owns the working folder, so this is accepted and stated here. The write is done on the path the guard returned, not on the original argument, which closes the simple case of a link created before the call.

## Sounds file
`readSoundsFile(guard, arg)`: `resolveExisting`, read as UTF-8, `JSON.parse`, check an object with `version` 1 and an `examples` array. Errors say which argument and what is wrong. The same function checks the existing `out` of `teach`, so an agent cannot overwrite an unrelated JSON file.

## Tool: teach
```
dir  -> resolveExisting (must be a folder; readdir errors surface as tool errors)
out  -> given: resolveForWrite(out)
        default: join(dir real path, '..', 'sounds.json') -> resolveForWrite
        default outside the root -> error with the "pass out" hint
out exists -> must be a regular file that passes the sounds check, else error, nothing written
teachFromDir(dir) -> { model, report }   (rejects: nothing written)
write JSON.stringify(model, null, 2) + newline to out
text = format teach
```
The write goes last, after teaching succeeded, so a failed teach leaves an existing `sounds.json` untouched. `writeFile` replaces the file in one call. A partly written file after a crash is possible and accepted, because the model is rebuilt from the recordings with one command.

Text format (labels, pairs, warnings in report order):
```
taught 3 sounds, 31 examples -> examples/sounds.json
clap: 12 examples, LOO accuracy 0.92
knock: 10 examples, LOO accuracy 0.90
confused: clap -> knock 0.17
warning [sound-in-calibration] clap/04.wav: ...
```
The path in the first line is relative to the root with forward slashes, so the text is the same on every platform.

## Tool: listen
```
wav    -> resolveExisting -> readWavFile
sounds -> readSoundsFile
engine = createEngine({ sounds, sampleRate: wav.sampleRate, onEvent: collect })
engine.push(samples); engine.flush()
lines  = events in time order -> sound line or unknown line (continuous events skipped)
summary = counts
```
Why not `runSamples`: it returns the times of unknown sounds only. The required line `unknown @ 1.100s nearest clap/03.wav#0` needs `nearest.id`, which `createEngine` passes to `onEvent`. Using `createEngine` keeps the result the same as the engine in a browser (P3), because `runSamples` is itself a thin wrapper of it.

The whole recording is pushed in one call. The engine's output does not depend on chunk size (P3), so this equals any other chunking.

Summary rule: count sound events per label, sort labels by code-unit order, join as `<label> x<n>`, then append `unknown x<n>` when any. No events: the single line `no sounds found`.

## Tool: score
```
dir    -> resolveExisting
sounds -> readSoundsFile
report = scoreDir(dir, model)
no labels and totalSeconds 0 -> tool error "no labelled recordings found in <dir as given>"
text = table + confusion + totals + warnings
```
The formatter is written in `format.ts`, with its own column padding. The script of Task 9a has a similar formatter inside `runScore`. The duplication is accepted so that Task 10 does not edit the finished script, and the two outputs are meant for different readers (a terminal, an agent). The tool writes no experiments line and no baseline, because an agent call is a question and not a recorded run.

Table format: a header row `label truths tp fp fn calib precision recall`, then one row per label, columns padded to the widest cell, ratios with 3 decimals. The confusion table lists truth rows (labels, then `none` last) against predicted columns with counts, or `confusion: none`. Totals line: `false positives per hour 1.2, total seconds 61.4, in calibration 0`.

## Errors
`toToolError(error)` returns the message text:
- `ENOENT` from the file system: `not found: <path as given>`. The handler passes the argument name and value in, so the text uses the caller's words and not the resolved path.
- `RangeError`, `TooFewExamplesError` and the `readWav` errors: their own `message`, which already names the supported format, the counts or the sample rate range.
- Any other `Error`: its `message`.
- A non-error value: `String(value)`.
No stack is printed. Messages never include samples or vectors. Argument validation by zod is done by the SDK before the handler runs.

## Tests
`test/helpers/mcp-client.ts` makes a linked in-memory pair, connects `createServer({ root })` to the server side and a `Client` to the client side, and returns `{ client, close }`. `close` closes both. Tests call `client.listTools()` and `client.callTool({ name, arguments })` and read `content[0].text` and `isError`.

Fixtures: use the model builder of the earlier tests (`buildModel` in `test/helpers/engine-fixture.ts`) and the fixture writer of Task 9a (`test/helpers/score-fixture.ts`), and the folder builder used in `test/teach.test.ts` if it is a helper. Task 3 reads these and reuses them as they are. Where a needed case is not covered, it adds `test/helpers/mcp-fixture.ts`, which writes a sound folder (label folders with WAV files) with `synthImpact`, `place` and `writeWavFile`. Folders are made with `mkdtemp` in the OS temp folder.

Root layout for the sibling-prefix test: a temporary parent folder with two children, `tokk` (the root passed to `createServer`) and `tokk-evil`. The test asks for `../tokk-evil/x.wav` as an existing read and as an `out` write, expects the guard error, and checks that `tokk-evil` still holds no new file.

The link test creates a directory link (a junction on Windows, which needs no special right) from inside the root to the sibling folder, asks for a file through it, and expects rejection. If the link cannot be created, the test is skipped with a visible reason.

The tests do not start a child process. The stdio path is checked by hand in the verification task (one `initialize` request in, one response out, nothing else on the standard output).

## Risks and rules
- **SDK surface differs from the assumption.** The names of subpaths or of the registration function can differ between releases. Task 2 checks the installed package before any test is written and records the facts here. If a name differs, this document is corrected first.
- **Validation errors differ by version.** Newer 1.x versions answer invalid arguments as a tool error result, older ones throw a protocol error. Tests accept both and check that the next call works.
- **`unknown` events in listen come from the classifier only.** A segment that overlaps a hum range is skipped by the engine and gives no line. This is the engine's rule and not changed here.
- **Large recordings.** A WAV is read fully into memory, as everywhere else in the project. No limit is added. A very long file simply takes time. This is accepted for a local tool.
- **Overwriting `out`.** A model file is replaced by design, since rebuilding `sounds.json` is the normal use. Only a file that is not a sounds model, or a folder, is refused.
- **Task 11B.** Registering the server in `.kiro/settings/mcp.json` is left to Task 11B, so this task changes no Kiro settings.
