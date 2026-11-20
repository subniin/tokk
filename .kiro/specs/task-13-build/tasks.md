# Tasks: Task 13, build and package

Order is test-first. Do not change `package.json` `exports`, and do not write `scripts/build.ts` or any `web/` file, before the matching tests exist and fail. After every step that touches configuration, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` (once that file exists) must still pass. If TypeScript 7 cannot emit declarations, stop and report (Requirement 2.5).

- [x] 1. Record the Task 12 measurement
  - [x] 1.1 In `.kiro/specs/task-12-teach-core/design.md`, section "Measured values", add one line: with `PBT_RUNS=1000`, `test/teach-core.test.ts` plus `test/teach.test.ts` passed, 47 tests, 224 s (measured 2026-11-20 by the operator). Change nothing else in that spec.

- [x] 2. Check prerequisites
  - [x] 2.1 Run `npm test`, `npx tsc --noEmit` and `npm run check:public-api` once and note that they pass (baseline). Note the runtime of the whole suite.
  - [x] 2.2 Confirm that `node_modules/esbuild` is version 0.28.2, that `npm ls esbuild` shows one copy (from tsx), and that 0.28.2 is not a reason to choose another version (a reported problem, or a version less than two weeks old; plan 2 asks for versions at least two weeks old). Record the result in "Measured values". If another exact version is chosen, record why.
  - [x] 2.3 Search the repository except `node_modules`, `dist` and `docs/_planning` for `from 'tokk`, `from "tokk`, `require('tokk`, `import('tokk` and for the string `tokk/node`. Confirm that no code imports the package by name. List each hit that is not code (docs, comments).
  - [x] 2.4 Read `scripts/check-public-api.ts` and decide Requirement 5.7: does it read `exports` or resolve `tokk`? Note the decision.
  - [x] 2.5 Confirm that `core/index.ts` exports the runtime names `createEngine`, `knnClassifier`, `readWav`, `runSamples`, `writeWav`, that `node/index.ts` exports the six names of `test/public-api.test.ts`, that `listen` exists nowhere, and that `web/`, `scripts/build.ts`, `tsconfig.web.json`, `tsconfig.build.json` and `dist/` do not exist yet. Check whether `README.md` and `LICENSE` exist.
  - [x] 2.6 Find where the model `version` is written (the training code) and whether the value is a named constant. Find which `SoundModel` fields `createEngine` needs, for the shape check of `loadSounds`. Check that no test or script lists the files of `core/` as a whole (for the temporary probe file).
  - [x] 2.7 Confirm that the installed TypeScript can run `tsc --version` as a child process from `node_modules`, and that `emitDeclarationOnly` is accepted. This is a quick probe only: no file is kept. If it fails, stop and report.

- [x] 3. Write failing tests
  - [x] 3.1 Change the third test of `test/public-api.test.ts` to expect the exact `exports` objects of Requirement 5.1 and 5.2, remove its `existsSync` loop, and add a comment that the change is a requirement of Task 13. Do not touch the other two tests. Run it and confirm FAIL, and confirm that the other two pass.
  - [x] 3.2 Create `test/load-sounds.test.ts` with tests 11 and 12 of `design.md`, stubbing `fetch` with `vi.stubGlobal` and restoring it after each test. Run it and confirm FAIL (module missing).
  - [x] 3.3 Create `test/build.test.ts` with tests 2 to 10 of `design.md`: the test-only values with units at the top, one build in `beforeAll`, the Node import checks in a child process, the `vm` ping test, the in-memory factory bundle, the pack list, and the `document` probe with removal in `finally` and `afterAll`. Run it and confirm FAIL (script and files missing). Confirm that no file is left in `core/` after the failing run.

- [x] 4. Configuration that needs no new code
  - [x] 4.1 Add `test-results/` and `playwright-report/` to `.gitignore`.
  - [x] 4.2 Add `exclude` with `test/web` to `tsconfig.json`. Add `configDefaults.exclude` plus `test/web/**` to `vitest.config.ts`. Run `npm test` and `npx tsc --noEmit` and confirm the earlier results (apart from the new failing files).
  - [x] 4.3 Add `esbuild` with the exact version from step 2.2 to `devDependencies` and run the install so that `package-lock.json` is updated. Confirm `npm ls esbuild` shows one copy and the version has no range prefix.

- [x] 5. Web files and the declaration config
  - [x] 5.1 Create `tsconfig.web.json` (Requirement 6.1) and `tsconfig.build.json` (Requirement 6.3).
  - [x] 5.2 If step 2.6 found no named version constant, add it to `core/constants.ts` and use it in the training code; otherwise use the existing one. Run the teaching and classifier tests to confirm that nothing changed.
  - [x] 5.3 Create `web/virtual-modules.d.ts`, `web/worker.ts`, `web/worker-factory.ts`, and `web/index.ts` with the core re-exports and `loadSounds`, following `design.md`. No top-level side effects, no DOM access at import time, no `node/` import.
  - [x] 5.4 Run `npx tsc -p tsconfig.web.json --noEmit` and `npx tsc --noEmit`. Fix until both pass. Run `test/load-sounds.test.ts` and confirm PASS.

- [x] 6. Build script
  - [x] 6.1 Create `scripts/build.ts` with `bundleWorkerSource`, `workerSourcePlugin`, `build`, the entry-point guard and the `--dev` mode, following `design.md` and Requirements 2 and 4. Name the dev port `DEV_SERVER_PORT`.
  - [x] 6.2 Add `scripts.build` and `scripts.dev` to `package.json`.
  - [x] 6.3 Run `npm run build` from a clean checkout state (no `dist/`). If the declaration step fails because the compiler cannot emit declarations, stop and report with the exact error. Otherwise fix until the build passes.
  - [x] 6.4 Update `package.json`: `exports`, `files`, `sideEffects`, `main`, `types` (Requirement 5). Keep every other field as it is.
  - [x] 6.5 Run `test/build.test.ts` and `test/public-api.test.ts` and fix the code until they pass. Do not weaken a test to make it pass. If a test shows a rule of `design.md` is wrong, change `design.md` and `requirements.md` first and say why in the devlog.
  - [x] 6.6 Run the manual dev check of `design.md` (serve, fetch `dist/tokk.js`, change the file, stop the server) and confirm that no process is left running.

- [x] 7. Check rules and consumers
  - [x] 7.1 Run `npm run check:public-api`, `npm run mcp` (start and stop it, or run its test), `npm run sounds:rebuild` on a copy or confirm by its test that its output is unchanged, and confirm that hooks in `.kiro/hooks` do not refer to `exports` paths. Adapt `scripts/check-public-api.ts` only if step 2.4 said so.
  - [x] 7.2 Check that `web/` has no `fs`, `path`, `zlib`, `process` or `node:` import, that `node/` and `core/` have no DOM use, that no unit-bearing value lacks a unit in its name, that no sample count is hard-coded, and that no file in `dist/` or `web/` sends anything except the `fetch` of a model file in `loadSounds`.
  - [x] 7.3 Check that no generated file of the Worker string exists in the repository, and that `git status` shows `dist/` as ignored.
  - [x] 7.4 Check that no Korean text is in tracked files outside `docs/_planning/`.

- [x] 8. Verify and commit
  - [x] 8.1 Record the values listed in "Measured values" of `design.md`, including the runtime of `test/build.test.ts`. If it exceeds 30 s, shorten as `design.md` says, without removing a listed test.
  - [x] 8.2 Run `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npm run build` and `npm pack --dry-run`. All pass, and the pack list is as Requirement 7.2 says.
  - [x] 8.3 Add a line to `docs/devlog.md`: esbuild version, the virtual module choice over `define` and why, the declaration config, the named change to `test/public-api.test.ts`, the `main` and `types` fields, that `README.md` and `LICENSE` are both packed, and whether `check-public-api.ts` changed.
  - [x] 8.4 Remove every temporary file (the `core/` probe file must not exist) and confirm `git status` shows only the intended files: `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.web.json`, `tsconfig.build.json`, `vitest.config.ts`, `scripts/build.ts`, `web/` files, `test/build.test.ts`, `test/load-sounds.test.ts`, `test/public-api.test.ts`, `core/constants.ts` and the training file only if step 5.2 changed them, `docs/devlog.md`, `.kiro/specs/task-12-teach-core/design.md` and this spec.
  - [x] 8.5 Commit with the message `build: add esbuild bundles and package exports`.
