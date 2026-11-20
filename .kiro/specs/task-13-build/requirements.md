# Requirements: Task 13, build and package

## Introduction
Task 13 is the second task of plan 2 (browser layer). Today `package.json` `exports` point at TypeScript sources (`core/index.ts`, `node/index.ts`). That works inside the repository, but an npm package needs JavaScript bundles and type declarations. This task adds an esbuild build, the first files of `web/`, a development server, and the new `package.json` `exports`.

The browser bundle must carry a Web Worker. The Worker source is bundled first as a string and injected into the main bundle, and the main bundle later starts the Worker from a Blob URL, so it works from a CDN across origins (plan 2, architecture). Task 14 fills the Worker and the `listen()` function. This task builds the path with a minimal Worker that answers a ping, so the Blob URL path is real before Task 14 relies on it.

| Consumer | What it uses from this task |
|---|---|
| Task 14 (Worker, `listen`) | The worker-source injection, `web/index.ts`, `web/worker.ts` as the Worker entry, `tsconfig.web.json` (it adds `test/web` to it), the `test/web` exclusions |
| Tasks 15 to 17 | `npm run dev` and `dist/tokk.js` |
| Task 19 (`examples/hello`, npm publish dry run) | `exports`, `files`, `dist/` |
| `npm run mcp`, tsx scripts, vitest | Nothing. They keep importing TypeScript sources by relative path |

Facts checked before this spec was written (the first task step checks them again): no repository code imports `tokk` by package name; `core/index.ts` exports the runtime names `createEngine`, `knnClassifier`, `readWav`, `runSamples`, `writeWav`; `node/index.ts` exports `ExpectEventsError`, `TooFewExamplesError`, `expectEvents`, `readWavFile`, `teachFromDir`, `writeWavFile`; `listen` does not exist yet; `.gitignore` already has `dist`; esbuild 0.28.2 is in `node_modules` as a dependency of tsx.

## Requirements

### Requirement 1: esbuild as a pinned devDependency
**User story:** As a maintainer, I want a reproducible build tool that I control.

#### Acceptance Criteria
1. `package.json` SHALL list `esbuild` in `devDependencies` with the exact version `0.28.2` (no `^`, no `~`), unless the first task step finds a reason against it. A reason SHALL be recorded in `design.md` ("Measured values") and in the devlog, together with the version chosen instead, which SHALL also be exact.
2. `npm ls esbuild` SHALL show one installed version of esbuild, shared with tsx (no second copy), and `package-lock.json` SHALL record it.
3. THE runtime `dependencies` of the package SHALL stay empty.

### Requirement 2: `npm run build`
**User story:** As a maintainer, I want one command that produces everything the package ships.

#### Acceptance Criteria
1. `package.json` `scripts.build` SHALL run `scripts/build.ts` with tsx, and the script SHALL exit with a non-zero code and a message on any failure.
2. **Worker string.** THE script SHALL first bundle `web/worker.ts` to a string: format IIFE, platform browser, bundled, written to memory (no file). THE result SHALL NOT be committed or written to the repository in any form (no generated source file).
3. **Browser bundle.** THE script SHALL bundle `web/index.ts` to `dist/tokk.js`: format ESM, platform browser, bundled, target ES2022. THE Worker string from 2.2 SHALL be injected through a virtual module (an esbuild plugin that resolves one reserved module name and returns the string as its default export). A `define` is not used, so that the watch mode of `npm run dev` rebuilds the Worker string when a Worker file changes (see `design.md`).
4. **Node bundle.** THE script SHALL bundle `node/index.ts` to `dist/node.js`: format ESM, platform node, bundled, target ES2022, with the Node built-ins left external.
5. **Declarations.** THE script SHALL run the TypeScript compiler with `tsconfig.build.json` (`emitDeclarationOnly`) so that `.d.ts` files are written below `dist/types`, including `dist/types/web/index.d.ts`, `dist/types/node/index.d.ts` and `dist/types/core/index.d.ts`. IF the installed TypeScript (7) cannot emit declarations, THE implementer SHALL stop and report, and SHALL NOT replace the compiler, add a second type tool, or write declarations by hand.
6. THE script SHALL remove `dist/` at its start, so that a file left from an older build cannot pass a test.
7. THE script SHALL write no file outside `dist/`, SHALL send nothing over the network, and SHALL NOT write source maps.
8. THE build SHALL be deterministic: two runs on the same sources give byte-identical `dist/tokk.js` and `dist/node.js`.

### Requirement 3: `web/` files of this task
**User story:** As the author of Task 14, I want the browser entry points to exist and be real.

#### Acceptance Criteria
1. `web/index.ts` SHALL re-export exactly the runtime names and the types of `core/index.ts` (relative import from `../core/index`), and SHALL export `loadSounds`. IT SHALL NOT export `listen` (Task 14 adds it) and SHALL NOT export any other runtime name. The re-export SHALL NOT drift from `core/index.ts`: a test compares the two name lists.
2. `loadSounds(url: string): Promise<SoundModel>` SHALL fetch the URL, parse the body as JSON and check the model `version`. It SHALL reject with an `Error` whose message names the URL and says what to do in these cases: the response is not ok (include the HTTP status); the body is not valid JSON (the original error in `cause`); the parsed value is not an object with a numeric `version` and the fields of a `SoundModel` that the check needs; the `version` differs from the version this build supports (message holds both numbers and says to teach again or update the package). A network failure of `fetch` SHALL reject with an `Error` that names the URL and keeps the original error in `cause`.
3. THE supported model version SHALL come from the one constant that already defines the version written by training. IF it is not exported by name from `core/constants.ts`, THE task SHALL add it there under a name with no unit (a version is not a threshold), and the training code SHALL use it.
4. `loadSounds` SHALL read a model file only. IT SHALL NOT send any audio or recording anywhere, and SHALL NOT send any request body. (Privacy rule: the only network use in `web/` is reading `sounds.json`.)
5. `web/worker.ts` SHALL be a minimal Worker entry. WHEN it receives a message `{ type: 'ping' }` it SHALL answer with `{ type: 'pong' }`, and SHALL ignore every other message without throwing. IT SHALL import no `fs`, `path`, `zlib` or `process`. THE ping message is temporary: Task 14 replaces the entry with the real protocol and removes the ping.
6. A web helper SHALL create a Worker from the injected string through a Blob URL: a `Blob` of type `text/javascript`, `URL.createObjectURL`, `new Worker(url)`. IT SHALL return a handle with the `Worker` and a `dispose()` that terminates the Worker and revokes the URL. IT SHALL touch `Blob`, `URL` and `Worker` only when called, never at import time.
7. EVERY module in `web/` SHALL be free of top-level side effects (no calls at import time other than defining functions, constants and types), so that `sideEffects: false` is true.
8. THE files in `web/` SHALL NOT import `fs`, `path`, `zlib`, `node:*` or anything from `node/`. THEY SHALL import from `core/` by relative path only.

### Requirement 4: `npm run dev`
**User story:** As a developer of the browser layer, I want to open pages from a local server that rebuilds on every save.

#### Acceptance Criteria
1. `package.json` `scripts.dev` SHALL run `scripts/build.ts` in development mode (a command-line flag of the same script, not a second script).
2. IN development mode THE script SHALL use the esbuild serve API with the repository root as the served directory, on the host `localhost` only (never `0.0.0.0`), on a port named by a constant in the script (`DEV_SERVER_PORT`).
3. THE script SHALL rebuild `dist/tokk.js` when a file of `web/` or `core/` changes, including the Worker source (the Worker string is rebuilt through the plugin, not at start only).
4. THE script SHALL print the URL it serves at, and SHALL stop cleanly on interrupt (dispose of the esbuild contexts).
5. THE development mode SHALL NOT rebuild `dist/node.js` or the type declarations. It is for browser pages. The first build in development mode SHALL still write `dist/tokk.js`.

### Requirement 5: `package.json`
**User story:** As a user of the npm package, I want `import ... from 'tokk'` to give me the browser bundle with types.

#### Acceptance Criteria
1. `exports["."]` SHALL be exactly `{ "types": "./dist/types/web/index.d.ts", "browser": "./dist/tokk.js", "import": "./dist/tokk.js" }`, in this key order.
2. `exports["./node"]` SHALL be exactly `{ "types": "./dist/types/node/index.d.ts", "import": "./dist/node.js" }`, in this key order. No `default` and no `require` condition.
3. `files` SHALL be exactly `["dist", "README.md", "LICENSE"]`. `sideEffects` SHALL be `false`.
4. THE stale `main` field (`index.js`, a file that does not exist) SHALL be set to `./dist/tokk.js`, and a top-level `types` SHALL be set to `./dist/types/web/index.d.ts`, for tools that do not read `exports`. No other field changes except `scripts` and `devDependencies`. (`version` and metadata are Task 19.)
5. NO file in the repository outside `dist/` SHALL import `tokk` by package name, so vitest, tsx and the MCP server keep using TypeScript sources by relative path. `npm run mcp`, `npm run check:public-api`, `npm run sounds:rebuild` and all hooks SHALL work as before.
6. **Named change to the public API test.** `test/public-api.test.ts` is the specification of the public API. THIS task changes `package.json` `exports`, so, as a requirement of this task and not as a bug fix, THE test "package.json exports "." and "./node" ..." SHALL be rewritten to expect the values of 5.1 and 5.2, and the check that the targets exist SHALL move out of it (the targets exist only after `npm run build`; Requirement 7 checks them). THE two tests that list the runtime export names of `core` and `node` SHALL NOT change, and the name lists SHALL stay as they are.
7. `scripts/check-public-api.ts` (the `check:public-api` script) SHALL be read in the first task step. IF it reads `exports` or resolves `tokk` to the old paths, it SHALL be adapted to the new values with the smallest change and the change SHALL be listed in the devlog. IF it does not, it SHALL NOT be touched.

### Requirement 6: TypeScript, vitest and git configuration
**User story:** As a maintainer, I want the DOM to be available in `web/` and nowhere else.

#### Acceptance Criteria
1. `tsconfig.web.json` SHALL extend `tsconfig.json`, set `lib` to `ES2022` and `DOM`, set `types` to an empty list (so Node typings are not visible in `web/`), and include `web` and `core`. `npx tsc -p tsconfig.web.json --noEmit` SHALL pass.
2. `tsconfig.json` SHALL keep `lib` without `DOM`. IT SHALL add `exclude` with `test/web` (Playwright specs arrive in Task 14 and belong to `tsconfig.web.json`). IT SHALL NOT include `web`. `npx tsc --noEmit` SHALL pass.
3. `tsconfig.build.json` SHALL serve only the declaration build: `emitDeclarationOnly`, `declaration`, `noEmit` off, `outDir` `dist/types`, `rootDir` the repository root, `lib` with `DOM`, `types` with `node` (`node/` needs it), include `core`, `web` and `node`. `scripts/build.ts` SHALL be the only user of it. THE test files and `scripts/` SHALL NOT be in it.
4. `vitest.config.ts` SHALL exclude `test/web/**` (keeping vitest's default excludes). The change SHALL NOT alter `setupFiles` or `env`.
5. `.gitignore` SHALL add `test-results/` and `playwright-report/`, and SHALL still ignore `dist`, `node_modules` and `docs/_planning/`.

### Requirement 7: Tests
**User story:** As a maintainer, I want the build and the package shape fixed by tests that fail first, and fast enough to keep running.

#### Acceptance Criteria
1. THE new file `test/build.test.ts` SHALL run `npm run build` (or the build function of `scripts/build.ts`) once, in `beforeAll`, with a timeout that has a named value with its unit (`..._TIMEOUT_MS`), and every test of the file SHALL use that one build.
2. THE tests of `test/build.test.ts` SHALL be:
   - the build writes `dist/tokk.js`, `dist/node.js`, `dist/types/web/index.d.ts`, `dist/types/node/index.d.ts` and `dist/types/core/index.d.ts`, and every `package.json` `exports` target path exists;
   - `dist/tokk.js` contains no reference to `fs`, `path`, `zlib`, `process`, `node:` or a `require(` call (matched as whole words or import specifiers, so that ordinary words do not count);
   - `dist/tokk.js` imports in a separate Node process with no `document`, `window`, `navigator` or `Worker` defined, and its export names are exactly the five core names plus `loadSounds` (no `listen` yet, with a comment that Task 14 adds it);
   - `dist/node.js` imports in Node and its export names equal the list in `test/public-api.test.ts`;
   - the Worker source from `bundleWorkerSource` of `scripts/build.ts` is an IIFE, contains no `import` or `export` statement, and answers `{ type: 'ping' }` with `{ type: 'pong' }` when run in a `node:vm` context that has only a fake worker scope;
   - bundling `web/worker-factory.ts` alone through the plugin of `scripts/build.ts` (in memory) puts the Worker source into the output and the output uses `createObjectURL` (the injection is real even though `index.ts` does not use the helper yet);
   - two builds give byte-identical bundles (reuse the first build and one more run; keep the test short);
   - `npm pack --dry-run` with JSON output lists exactly the paths below `dist/` plus `package.json`, `README.md` and `LICENSE` (both files exist in the repository root, so both must be listed; no missing file is allowed), contains `dist/tokk.js`, `dist/node.js` and `package.json`, and lists no path of `test/`, `fixtures/`, `.kiro/`, `core/`, `web/`, `node/` or `docs/`;
   - the base TypeScript configuration rejects a core file that uses `document`: the test writes one temporary file below `core/` with a unique name, runs `tsc` with the base `tsconfig.json`, expects a non-zero exit and an error that names the file and `document`, and removes the file in a `finally` block and again in `afterAll`.
3. THE new file `test/load-sounds.test.ts` SHALL test `loadSounds` in vitest with a stubbed `fetch` (no network): a valid model resolves and equals the parsed JSON; a 404 rejects with the URL and the status; a body that is not JSON rejects with the URL and a `cause`; a model with another `version` rejects with both versions; a value that is not a model rejects; a rejected `fetch` rejects with the URL and a `cause`. THE test SHALL also check that no request body is sent (the stub sees only a URL and no `body`).
4. THE comparison test of 3.1 (`web/index.ts` names equal `core/index.ts` names plus `loadSounds`) SHALL live in `test/load-sounds.test.ts` or in `test/build.test.ts`, whichever needs no build.
5. THE tests SHALL write nothing outside `dist/` and the one temporary core file (which is removed), and need no network.
6. THE changed test in `test/public-api.test.ts` SHALL be written first and shown failing (Requirement 5.6) before `package.json` changes.
7. THE full suite (`npm test`), `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` SHALL pass. `npm run build` SHALL pass from a clean `dist/`.

### Requirement 8: Rules that apply
**User story:** As a maintainer, I want this task to follow the project rules.

#### Acceptance Criteria
1. EVERY value with a unit that this task adds (a timeout, a port is not a time but is named, a threshold) SHALL have the unit in its name. NO sample count SHALL be hard-coded. Constants used by `web/` SHALL be in `core/constants.ts` or `web/constants.ts`; constants that belong to the build script alone (`DEV_SERVER_PORT`) MAY stay in `scripts/build.ts`; test-only values stay at the top of their test file.
2. `core/` SHALL NOT change except where Requirement 3.3 needs the version constant. IT SHALL stay free of DOM, `fs` and `path`.
3. THE apps rule stays: nothing outside `web/` and the build imports `web/` paths, and nothing in `examples/` or later `apps/` is touched.
4. NO audio is sent over the network by any code of this task, and `sounds.json` is not touched.
5. ALL text written for people (errors, messages, comments, docs) SHALL be English.
