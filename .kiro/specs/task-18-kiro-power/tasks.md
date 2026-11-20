# Tasks: Task 18, Kiro power, custom agents and the `_new-app` spec template

Order is test-first. Do not write `powers/`, `.kiro/agents/`, `.kiro/specs/_new-app/`, `docs/kiro.md`, the `bin` entry or the `dist/mcp.js` build before the tests that cover them exist and fail. After every step that touches code, `npm test`, `npx tsc --noEmit` and `npx tsc -p tsconfig.web.json --noEmit` must still pass (apart from the new tests that are meant to fail). Do not run Kiro or any Kiro agent. Do not run `npm publish` or `npm login`; `npm publish --dry-run` is not needed here. Do not change `core/`, `web/`, `node/`, `.kiro/settings/mcp.json`, hooks, `docs/_planning/` or other specs. The only allowed edits outside the new files are `.kiro/steering/integrate.md` (step 6.3) and, if needed, the entry check in `tools/mcp-ears/server.ts` (step 3.3). Do not guess Kiro formats beyond the facts in `requirements.md`. Do not weaken a test to pass it. If a test shows that a rule in `design.md` is wrong, change `requirements.md` and `design.md` first and say why in `docs/devlog.md`.

- [x] 1. Check prerequisites and the facts of the spec
  - [x] 1.1 Run `npm test`, the three type checks (`tsconfig.json`, `tsconfig.web.json`, `tsconfig.test-web.json`), `npm run build` and `npm run check:public-api` once. Note that they pass, the vitest count, and the sizes of `dist/tokk.js` and `dist/node.js`.
  - [x] 1.2 Confirm the repository facts in `requirements.md` (Introduction): `.kiro/settings/mcp.json`, the four tools and inputs in `tools/mcp-ears/tools.ts`, `isEntryPoint` in `server.ts`, `buildBundles()` and `build()` in `scripts/build.ts`, the pack test in `test/build.test.ts`, `package.json` (no `bin`, no `dependencies`).
  - [x] 1.3 Read `test/public-api.test.ts` and decide whether it asserts the whole `package.json` shape or only `exports` (requirement 1.7). Record the answer in `design.md`, "Measured values".
  - [x] 1.4 List `.kiro/specs/`, `.kiro/hooks/`, `.kiro/steering/` and `.kiro/agents/` and confirm that `.kiro/agents/`, `powers/` and `.kiro/specs/_new-app/` do not exist. Keep the list; `docs/kiro.md` is written from it (step 6).
  - [x] 1.5 Read `tsconfig.build.json` and confirm that a new entry in `scripts/build.ts` does not add `tools/` declarations to `dist/types` (design, finding on declarations).
  - [x] 1.6 Read `.kiro/steering/integrate.md` once more; it is the source text of the `integrate` skill. Read `web/listen.ts` and `web/index.ts` for the real names and options of the browser API (`listen`, `loadSounds`, `Ears`), so the skill matches the code.

- [x] 2. Write the failing tests
  - [x] 2.1 `test/build.test.ts`: add tests B1 to B5 of the table in `design.md`, as named requirements of Task 18 (a comment on each says so). The standalone start test uses the SDK client with a stdio transport, a `mkdtemp` folder removed in `finally`, and a named timeout constant with its unit in the name. Run and confirm FAIL because `dist/mcp.js` and the `bin` entry do not exist, not because of a typo.
  - [x] 2.2 `test/kiro-config.test.ts`: validator functions and tests A1 to A10. Front matter is parsed by a small function in the file. Tool names come from `TOOLS`. Constants for the required keyword list, the allowed `fs_write` and `shell` matches and the allow-list of the path check are named at the top of the file with a comment each. Run and confirm FAIL because the files do not exist.
  - [x] 2.3 `test/kiro-config.test.ts`: add test A11 (requirement 9): `integrate.md` keeps its front matter, has no "not in the repository" text, and shares the API terms with the `integrate` skill. Confirm it FAILS before step 6.3.
  - [x] 2.4 If step 1.3 found that `test/public-api.test.ts` asserts the whole `package.json` shape, add the `bin` key to its expected value with a comment that Task 18 requires it (requirement 1.7). Otherwise leave it unchanged.

- [x] 3. The bin and the bundle
  - [x] 3.1 `scripts/build.ts`: add the `dist/mcp.js` options (design, "Bundling `dist/mcp.js`") and run them in `buildBundles()`. Update the header comment and the final console line of `main()`. `npm run dev` stays as it is.
  - [x] 3.2 `package.json`: add `"bin": { "tokk-mcp": "./dist/mcp.js" }`. Change nothing else.
  - [x] 3.3 Run `npm run build`, then B1 to B5. If the standalone start fails with a `require` error, add the `createRequire` line to the banner, after the shebang. If the process exits at once, check `isEntryPoint` (finding 1) and apply the smallest fix allowed by requirement 1.4, then run the existing mcp-ears tests. Record both results in `design.md`.
  - [x] 3.4 Run `npm test`, the three type checks and `npm run check:public-api`.
  - [x] 3.5 Entry check through a bin link (requirement 1.4): run `npm pack`, make a temporary folder, `npm install <tarball>` there, run `npx tokk-mcp` with a short timeout and confirm it does not crash at startup (it must stay alive until the timeout kills it). If it exits at once, make the smallest fix in `isEntryPoint` and repeat. Delete the temporary folder and the tarball afterwards.

- [x] 4. The power
  - [x] 4.1 `powers/tokk/plugin.json` and `powers/tokk/mcp.json` as in requirement 2 and design "mcp.json". Run tests A1 and A2 until they pass.
  - [x] 4.2 `powers/tokk/skills/integrate/SKILL.md` from `integrate.md` and the real browser API (design, "Skills: content plan"). English, imperative, short. State the publish condition and the teach page text of requirement 2.6.
  - [x] 4.3 `powers/tokk/skills/tune-sounds/SKILL.md` with the tool names and inputs read in step 1.2.
  - [x] 4.4 `powers/tokk/skills/new-app/SKILL.md`, carrying the full table format and a worked example that is plainly invented.
  - [x] 4.5 Run tests A3 and A4 until they pass. Check that no skill states a measured time, accuracy or line count.

- [x] 5. The agents and the template
  - [x] 5.1 `.kiro/agents/sound-tuner.json` as in requirement 3 and design "Agent files". Run tests A5 and A7 for it.
  - [x] 5.2 `.kiro/agents/integrator.json` as in requirement 4. Run tests A6 and A7.
  - [x] 5.3 `.kiro/specs/_new-app/requirements.md`, `design.md`, `tasks.md` as in requirement 5 and design "Template". Run test A8.
  - [x] 5.4 Re-read the three template files as a stranger would: every cell is a placeholder in angle brackets, nothing refers to a task or label of this repository, and the first line of each file says it is a template.

- [x] 6. Documentation page
  - [x] 6.1 `docs/kiro.md` from the lists of step 1.4 (real file names), with the four URLs and the check date 2026-11-20, the power install steps, the publish condition and the headless run line. One page.
  - [x] 6.2 Run test A9 until it passes. Run A10 and confirm each negative test fails the validator when a field is removed.
  - [x] 6.3 `.kiro/steering/integrate.md`: keep the front matter, replace "Public API (target)" by the current browser API (requirement 9), add the stored-model note. Run test A11 until it passes.

- [x] 7. Finish
  - [x] 7.1 Run `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.test-web.json --noEmit`, `npm run build`, `npm run check:public-api`, `npm run test:web`, `npm run pbt:quick` and a short start check of `npm run mcp`. All must pass, and no server or Chrome process may stay running.
  - [x] 7.2 Run `npm pack --dry-run` once and show the file list: `dist/mcp.js` listed, no `powers/`, no `.kiro/`.
  - [x] 7.3 Search the new files for the words `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` in code (the build script and the tests) and confirm no new hit besides the existing ones.
  - [x] 7.4 Fill in every item of "Measured values" in `design.md`.
  - [x] 7.5 Add one line to `docs/devlog.md`: what was added, that the MCP part of the power needs `npm publish`, that the agents were not run (the operator runs them), and that `.kiro/steering/integrate.md` now has the current browser API. The line is dated 2026-11-20 and is written as a file edit, not with a shell command.
  - [x] 7.6 Remove any temporary file or script created while working (including any `mkdtemp` folder left by a failed run). Check `git status` shows only intended files.
  - [x] 7.7 Commit with the message `chore: add Kiro power, agents and new-app spec template`.
