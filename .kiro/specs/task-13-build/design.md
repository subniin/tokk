# Design: Task 13, build and package

## Layout
```
scripts/build.ts          build and dev (one script, `--dev` flag)
tsconfig.web.json         DOM lib, web + core
tsconfig.build.json       declaration emit only
web/index.ts              re-exports core public API + loadSounds
web/worker.ts             minimal Worker entry (ping -> pong)
web/worker-factory.ts     creates a Worker from the injected string through a Blob URL
web/virtual-modules.d.ts  type of the virtual module that holds the Worker string
dist/                     (ignored) tokk.js, node.js, types/**
```
`web/index.ts` imports from `../core/index` by relative path. `web/` never imports `node/`. The base `tsconfig.json` does not include `web/`, but it compiles the web files that a test imports (`test/load-sounds.test.ts` imports `web/index.ts`). `web/index.ts` therefore uses only `fetch`, which `@types/node` also declares, and no DOM-only type. The first task step confirms that `npx tsc --noEmit` passes with that import; if it does not, the test imports `loadSounds` from a file that avoids the DOM types, not the other way round.

## Decisions

### Worker string: virtual module, not `define`
Brief: "define or a virtual module". Chosen: a virtual module (an esbuild plugin).

| | `define` | Virtual module (plugin) |
|---|---|---|
| Worker string rebuilt in `dev` watch mode | No. The value is fixed when the context is created, so a changed Worker file needs a restart | Yes. The plugin builds the Worker inside `onLoad` and reports the Worker's input files as `watchFiles`, so esbuild reruns it when they change |
| Complexity | Lowest | One small plugin (about one function) |
| Type declaration | A global `declare const` | A `declare module` for one reserved name |

The dev server is the way Tasks 15 to 17 are developed, and Task 14 edits the Worker often, so a stale Worker would cost more than the plugin. The plugin lives in `scripts/build.ts` and is exported with `bundleWorkerSource()` so a test can use it.

Details:
- Reserved module name: `tokk:worker-source` (the `tokk:` prefix cannot collide with an npm name). The plugin resolves it into its own namespace and `onLoad` returns `export default <JSON string>`, loader `js`.
- `bundleWorkerSource()` runs esbuild `build` with `write: false`, `bundle`, `format: 'iife'`, `platform: 'browser'`, `target: 'es2022'`, entry `web/worker.ts`, and returns the single output file's text. The plugin passes the input file list (from the metafile) as `watchFiles`.
- `web/virtual-modules.d.ts` declares `module 'tokk:worker-source'` with a default export of type `string`. It is in `tsconfig.web.json` (through `web`) and in `tsconfig.build.json`.

### Declarations: one extra config
The base `tsconfig.json` has no DOM and `noEmit`, and does not include `web/`. `tsconfig.web.json` has DOM but no Node types. Declarations need all three source folders and Node typings for `node/`. A separate `tsconfig.build.json` (not extending the web config, to avoid inheriting `types: []`) is the clearest: `emitDeclarationOnly`, `declaration`, `noEmit: false`, `outDir: dist/types`, `rootDir: .`, `lib` ES2022 + DOM, `types: ["node"]`, include `core`, `web`, `node` and `web/virtual-modules.d.ts`. With `rootDir` at the root, the output keeps the folder names (`dist/types/web/index.d.ts`), which `exports` points to. Declarations for `node/*` import `../core/*` relatively, and those files are emitted too, so the package types are self-contained.

The script runs `tsc` from `node_modules` (the installed TypeScript 7) as a child process, with `-p tsconfig.build.json`, and fails the build on a non-zero exit. **If TypeScript 7 cannot emit declarations** (an error about the flag, missing output, or an empty `dist/types`), the implementer stops and reports; it does not add `typescript@6`, `dts-bundle` or hand-written `.d.ts` files.

### `package.json` and consumers
`exports` per Requirement 5. `browser` and `import` both point to `dist/tokk.js`: `browser` helps bundlers that prefer it, `import` covers plain ESM. `./node` has only `types` and `import`, as the brief says. The old `exports` pointed at `.ts` files; no repository code uses the package name, so nothing resolves through `exports` inside the repository. The first task step searches for `from 'tokk` and `from "tokk` to confirm again, and also for `require('tokk` and `import('tokk`.

### Public API test change (named requirement)
Only the third test of `test/public-api.test.ts` changes: its expected values become the new `exports` objects. The `existsSync` loop is removed from it, because it would fail on a clean checkout (`dist/` is ignored and built on demand), and `test/build.test.ts` checks that every target exists after the build. The two name-list tests do not change. This is recorded in the devlog as a requirement of the task.

### `web/index.ts`
Re-exports with `export { ... } from '../core/index'` and `export type { ... } from '../core/index'`, plus `loadSounds`. A test compares `Object.keys` of `web/index.ts` with the core names plus `loadSounds`, so a name added to core without a decision about the browser API is noticed.

`loadSounds` steps: `fetch(url)` (a failure rejects with the URL and `cause`); if `!res.ok` reject with URL and status; `res.text()` then `JSON.parse` (failure rejects with URL and `cause`); a shape check (an object with a numeric `version`, and the fields that `createEngine` needs from a `SoundModel`, found in the first task step); a version check against the training constant. The check is deliberately small: it protects against a wrong file or an old model, not against every possible corruption (the engine validates the rest). Messages are English and say what to do ("teach the sounds again with teach.html or `npm run sounds:rebuild`", "update tokk").

### `web/worker.ts` and the factory
The Worker uses `self` through a narrow local interface (`addEventListener('message', ...)` and `postMessage(message)`), because the DOM lib types `self` as a `Window`, whose `postMessage` takes different arguments. A pure function `answer(message)` that returns the reply or `null` keeps the logic out of the scope object. The vm test supplies a fake scope with those two members.

`web/worker-factory.ts` imports the default export of `tokk:worker-source`, and exports `createWorkerFromSource(source: string)` and `createTokkWorker()` (the latter passes the injected string). Taking the string as a parameter lets a test or Task 14 pass another source. Nothing runs at import time. Because `index.ts` does not import the factory in this task, esbuild's tree shaking leaves the Worker string out of `dist/tokk.js`. This is correct for `sideEffects: false`, and it is why the injection test bundles the factory as its own entry. Task 14 imports the factory from `listen.ts`, and then the string is in `dist/tokk.js`; Task 14 adds the check to the build test.

`dispose()` terminates the Worker and revokes the Blob URL. The URL is not revoked right after `new Worker`, because a Worker may load the script after the call returns.

### Build script structure
`scripts/build.ts` exports `bundleWorkerSource()`, `workerSourcePlugin()` and `build()`; a main function runs only when the file is the entry point (an `import.meta.url` comparison with `process.argv[1]`), so the test can import the helpers without starting a build.

Build order: (1) remove `dist/`, (2) `build()` of the browser bundle (the plugin calls `bundleWorkerSource` inside), (3) the node bundle, (4) the `tsc` declaration run. Steps 2 and 3 run in parallel; step 4 runs after them, so a TypeScript error is reported after the bundles. Any failure sets a non-zero exit code. Options shared by both bundles: `bundle`, `format: 'esm'`, `target: 'es2022'`, `legalComments: 'none'`, `logLevel: 'warning'`, no minify (readable output helps while the package is young; size is measured in a later task), no source maps. The node bundle uses `platform: 'node'` with `packages: 'external'` off and the built-ins external by default; there are no runtime dependencies, so nothing else is external.

Determinism: esbuild output depends only on the inputs; the Worker string is a pure function of the sources. The test compares two runs.

### `npm run dev`
`--dev` creates one esbuild context for `web/index.ts` with the plugin, writes `dist/tokk.js`, calls `watch()` and `serve({ servedir: '.', host: 'localhost', port: DEV_SERVER_PORT })`, and prints `http://localhost:<port>/`. The served directory is the repository root, so `teach.html` (Task 17), `examples/` and `dist/tokk.js` are all reachable. The server is bound to `localhost` only, so nothing is exposed to the network. If the port is busy esbuild fails with its own message; the script prints it and exits (no silent port change, because pages and Playwright configs refer to the port). `SIGINT` disposes the context.

Not in dev mode: the node bundle and declarations (browser pages do not use them). The first dev run still needs the build once for `dist/node.js` only if something else uses it; nothing does.

### Config changes
- `tsconfig.json`: add `"exclude": ["test/web"]`. The `include` list stays.
- `tsconfig.web.json`: `extends: ./tsconfig.json`, `lib: [ES2022, DOM]`, `types: []`, `include: [web, core]`. Task 14 appends `test/web` and `playwright.config.ts`. With `types: []`, a stray `import 'fs'` or `process` in `web/` fails the type check as well as the bundle test. If `core/` needs a Node typing, that is a bug in core and the task reports it.
- `tsconfig.build.json`: as above.
- `vitest.config.ts`: `exclude: [...configDefaults.exclude, 'test/web/**']`, importing `configDefaults` from `vitest/config`.
- `.gitignore`: two lines added.

## Risks and rules
- **Build time in tests.** One `npm run build` is a few esbuild calls plus a whole `tsc` declaration run. The tests share the single build (`beforeAll`) and the base-config test runs `tsc` once more over the whole project. Target: `test/build.test.ts` under 30 s on this machine, to be measured; the largest costs are the two `tsc` runs. If the target is missed, the declaration check stays and the `document` probe is the part to shorten (check only the probe file with the same compiler options is not allowed, because the test is about the base configuration).
- **Probe file in `core/`.** The `document` test writes a real file below `core/`. If the process is killed, the file stays and would break `tsc` and other checks. Mitigations: a unique, clearly named file (`core/__dom-probe-<pid>.ts`), removal in `finally` and in `afterAll`, and the first task step and the cleanup step both list `core/` for leftovers. Vitest runs files in parallel; no other test reads the whole `core/` folder (checked in the first task step; the scan test of Task 12 reads one named file).
- **`process` in the bundle.** The check uses whole-word matching on `process` and import-specifier matching on `fs`, `path`, `zlib`, `node:`. If core text contains the word legitimately in a comment, the build removes comments only with a minifier; the test would then show the line. The fix is to change the source wording or the code, not to loosen the test, unless the hit is truly harmless; then the test excludes comments and says why.
- **Stale `dist/`.** The build removes `dist/` first; the tests do not rely on files from older builds.
- **Task 14 fit.** Task 14 replaces `web/worker.ts` (same entry path, same IIFE build), adds `web/protocol.ts` (imported by the Worker, bundled into the string), `listen.ts` and `mic.ts`, and adds `listen` to `web/index.ts`. The build needs no change for that. Task 14 updates two expectations of this task as part of its own requirements: the export list in the "imports in Node" test (adds `listen`) and the Worker test (ping replaced by the protocol). Worklet code (Task 14, `worklet-source.ts`) is a plain string in a source file and needs no build step.
- **MCP and hooks.** `tools/mcp-ears/server.ts` and hooks run through tsx on sources. They are unaffected because nothing resolves `tokk` by name. The first task step runs `npm run check:public-api`, and the final step runs it again.
- **Publishing.** Nothing here publishes. `npm pack --dry-run` only lists files. `LICENSE` and `README.md` both exist in the repository root, so the pack test requires exactly `dist/**`, `README.md`, `LICENSE` and `package.json`, with no allowance for a missing file.
- **Privacy.** The only network call is `fetch` of a model file in `loadSounds`. No audio, no request body.

## Tests
`test/build.test.ts` (one shared build), `test/load-sounds.test.ts` (no build), changed expectation in `test/public-api.test.ts`.

| # | Test | Requirement |
|---|---|---|
| 1 | public API test expects the new `exports` (written first, fails) | 5.6 |
| 2 | build writes bundles and type files; every `exports` target exists | 2, 7.2 |
| 3 | `dist/tokk.js` has no `fs`, `path`, `zlib`, `process`, `node:`, `require(` | 2.3, 7.2 |
| 4 | `dist/tokk.js` imports in a Node process with no DOM; exports exactly the core names plus `loadSounds` | 3.1, 7.2 |
| 5 | `dist/node.js` imports; exports equal the list of `test/public-api.test.ts` | 2.4 |
| 6 | the Worker source is an IIFE and answers ping with pong in a `vm` context | 3.5, 2.2 |
| 7 | the factory entry bundled alone contains the Worker source and `createObjectURL` | 3.6, 2.3 |
| 8 | two builds are byte-identical | 2.8 |
| 9 | `npm pack --dry-run` lists only the allowed files | 5.3, 7.2 |
| 10 | base `tsc` rejects a core file that uses `document` (temp file, removed) | 6.2 |
| 11 | `loadSounds`: ok, 404, not JSON, wrong version, not a model, `fetch` rejects, no request body | 3.2, 3.4 |
| 12 | `web/index.ts` names equal the core names plus `loadSounds` | 3.1 |

Test-only values at the top of the files, with units: `BUILD_TEST_TIMEOUT_MS`, `PACK_TEST_TIMEOUT_MS`, `TSC_TEST_TIMEOUT_MS`.

Manual check once (not a committed test): start `npm run dev`, fetch `http://localhost:<port>/dist/tokk.js` and see the file, edit `web/worker.ts`, see `dist/tokk.js` change after a save (once the factory is imported by `index.ts` in Task 14, the change shows there; in this task, check the plugin through the in-memory bundle of `web/worker-factory.ts`). Stop the server.

## Measured values
Measured on 2026-11-20.
- esbuild 0.28.2, installed as an exact devDependency. `npm ls esbuild` shows one version (0.28.2), deduped under `tsx` and `vitest`/`vite`. Nothing found against 0.28.2, so no other version was chosen.
- TypeScript 7.0.2 emitted declarations with `emitDeclarationOnly` (`dist/types/core`, `web`, `node`).
- `dist/tokk.js` 51065 bytes, `dist/node.js` 60295 bytes (not minified, no source maps).
- `npm run build` about 0.8 s. `test/build.test.ts` about 1.8 s (target 30 s). Baseline `npm test` 63 s, after this task 65 s.
- `npm pack --dry-run`: `LICENSE`, `README.md`, `package.json`, `dist/tokk.js`, `dist/node.js` and `dist/types/**` (28 files). Both `README.md` and `LICENSE` exist and are listed.
- `scripts/check-public-api.ts` does not read `exports` and was not changed.
- No code in the repository imports `tokk` by package name (hits are docs, steering text and test fixtures strings).
