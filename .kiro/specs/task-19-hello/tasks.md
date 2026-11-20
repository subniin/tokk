# Tasks: Task 19, hello example, README and npm package preparation

Order is test-first. Do not write `examples/hello/`, the README text, the `package.json` fields or the minify option before the tests that cover them exist and fail. After every step that touches code, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` must still pass (apart from the new tests that are meant to fail). Do not run Kiro or any Kiro agent. Do not run `npm publish` without `--dry-run`, `npm login` or `git push`. Do not change `core/`, `web/`, `node/`, `tools/`, hooks, steering, `docs/_planning/` or other specs. Do not guess: if `listen()` lacks something the page needs, stop and report. Do not weaken a test to pass it. If a test shows that a rule in `design.md` is wrong, change `requirements.md` and `design.md` first and say why in `docs/devlog.md`. Record every item of "Measured values" in `design.md` as it is measured.

- [x] 1. Check prerequisites and the facts of the spec
  - [x] 1.1 Run `npm test`, the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`), `npm run build` and `npm run check:public-api` once. Note that they pass and the vitest count. Note the sizes of `dist/tokk.js`, `dist/node.js` and `dist/mcp.js` and the tarball size from `npm pack --dry-run` (these are the "before" values).
  - [x] 1.2 Confirm the repository facts in `requirements.md` (Introduction): `package.json`, `README.md`, `scripts/build.ts`, `test/build.test.ts`, the absence of `examples/hello`.
  - [x] 1.3 Read `web/listen.ts`, `web/index.ts` and the `Handlers` type for the callbacks of `listen()` (design, finding 1). Read `test/web/paths.ts`, `test/web/fixture.ts`, `test/web/global-setup.ts` and `test/web/listen.spec.ts` for the fake-microphone fixture: sample rate, label sequence, spacing (design, finding 6).
  - [x] 1.4 Read `.gitignore` and decide whether `examples/hello/sounds/` needs an ignore line (design, finding 5). Read `.kiro/steering/ui.md` once more. Read `docs/kiro.md`, `.kiro/steering/integrate.md` and `powers/tokk/plugin.json` for the names and versions the README repeats.
  - [x] 1.5 Choose the patterns of the example from the fixture (design, "Patterns of the example") and record them in `design.md`, "Measured values".

- [x] 2. Write the failing tests
  - [x] 2.1 `test/hello-example.test.ts`: the marker function, tests H2 to H6, the negative copies of H3 and the optional D1 (try D1 with a short regular expression; skip it and say why if it gets fiddly). Constants named at the top with a comment each (`HELLO_MAX_TOKK_LINES` and the paths). Confirm FAIL because `examples/hello/` and the README example do not exist.
  - [x] 2.2 `test/package-meta.test.ts`: tests M1 and M2. Confirm FAIL because the fields do not exist.
  - [x] 2.3 `test/web/hello.spec.ts`: test H1 with the default fake microphone, named timeouts with the unit in the name, a request listener that fails on any request to a host other than the dev server. Confirm FAIL because the page does not exist (run `npm run test:web -- --grep hello`).
  - [x] 2.4 `test/build.test.ts`: add the pack test changes of B6 (`--ignore-scripts`, `examples/` forbidden). Add a check that the browser and MCP bundles are minified (a measurable rule such as the longest line or the line count of `dist/tokk.js` being far below that of an unminified build in the same test, using a named ratio constant) and that `dist/node.js` is not minified. Confirm the minify checks FAIL before step 5.

- [x] 3. The example
  - [x] 3.1 Build the synthetic model at the sample rate of the fake-microphone fixture (design, finding 6) in a temporary folder, copy only `sounds.json` to `examples/hello/sounds.json`, and delete the temporary folder. Record how it was built, its size and its labels. Run the H6 tests until they pass.
  - [x] 3.2 `examples/hello/index.html`: the page of design "The page", with the markers, at most 10 Tokk lines, the patterns of step 1.5, the live region, the error text, the synthetic-model notice and `debug: true`. Add the `.gitignore` line if step 1.4 needs it. Run H2, H3 and H5 until they pass.
  - [x] 3.3 Run `npm run test:web -- --grep hello` until H1 passes. If the pattern line comes late (design, finding 2), raise the named timeout, not the pattern. Run `npm run build` again afterwards (`test:web` empties `dist/`).
  - [x] 3.4 Open the page with `npm run dev` only through the test; do not leave a server running. Check by reading that every visible text is English, the button has a visible focus outline, and nothing moves.

- [x] 4. Package metadata
  - [x] 4.1 `package.json`: add the fields of requirement 3.1 and `scripts.prepack`. Change nothing else, and keep `dependencies` absent. Run M1 and M2 until they pass.
  - [x] 4.2 If the `plugin.json` version differs from `0.1.0`, report it; do not change the power in this task unless the version test of M1 needs the two to agree, in which case set the power to `0.1.0` as a named requirement (requirement 3.3).
  - [x] 4.3 Run `npm test`. Run `npm pack --dry-run` and confirm the list is unchanged apart from sizes (no `examples/`).

- [x] 5. Minification
  - [x] 5.1 Build once into a temporary folder with minification and an external source map for `dist/tokk.js` and `dist/mcp.js` and note the map sizes. Delete the folder. Do not ship maps.
  - [x] 5.2 `scripts/build.ts`: add the minify option for the browser bundle, the MCP bundle and the embedded Worker source in the package build (design, "Minification"). `dev()` stays unminified. Update the header comment. Keep `dist/node.js` as it is.
  - [x] 5.3 Run `npm run build`, then the minify checks of step 2.4 until they pass.
  - [x] 5.4 Run `npm test`. For each assertion of `test/build.test.ts` that fails because of the minified text, update it as a named requirement of Task 19 (comment on each) and show that its negative case still fails: the Node global scan still reports `process.env.X` and `require(`, the Worker shape test still rejects a bundle with `import`, the string checks still need the real strings. Record which assertions changed.
  - [x] 5.5 Record the sizes after (`dist/tokk.js`, `dist/node.js`, `dist/mcp.js`, tarball). Run the bundled-server test (B3 of Task 18) and the byte-identical build test.

- [x] 6. README
  - [x] 6.1 `README.md` following design "README outline" and requirement 4. Copy the Tokk code from the page between the markers and change only the import specifier to the jsDelivr form. Placeholders for the GIF, the video and the measured teaching time and lines, each marked pending. No invented number.
  - [x] 6.2 Run H4, H5 and D1 (if kept) until they pass. Check every backtick path of the README exists, except names marked "after build" or "after publish".
  - [x] 6.3 Re-read the README as a stranger would: it does not say the package is published, it says the example model is synthetic, and it states the known limits as facts.

- [x] 7. Dry-run publish
  - [x] 7.1 Run `npm run build`, `npm test`, then `npm publish --dry-run` once (it runs `prepack`). Record the output in `design.md`, "Measured values". If a field is reported as fixable, fix it and repeat. If it needs a login, record that and stop; do not run `npm login`.

- [x] 8. Finish
  - [x] 8.1 Run `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run check:public-api`, `npm run test:web`, `npm run pbt:quick`. All must pass and no server or Chrome process may stay running. Run `npm run build` once more after `test:web`, then `npm pack --dry-run` and show the file list.
  - [x] 8.2 Search the new files for the words `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` in code; the only allowed hit is the page's `loadSounds` request (inside `tokk`, not in the page). Confirm no recording or WAV file is under `examples/hello/`.
  - [x] 8.3 Fill in every item of "Measured values" in `design.md`.
  - [x] 8.4 Add one line to `docs/devlog.md` as a file edit: what was added, the before and after sizes, that the package is ready for the operator's publish decision, that nothing was published, and that real-microphone experiments are still pending.
  - [x] 8.5 Remove any temporary file, folder or script created while working (build folders, source maps, tarballs). Check `git status` shows only intended files.
  - [x] 8.6 Commit with the message `feat: add hello example and package metadata`.
