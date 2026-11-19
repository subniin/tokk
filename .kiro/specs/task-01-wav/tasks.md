# Tasks: Task 1, Repository scaffold and WAV I/O

Order is test-first. Do not write `core/wav.ts` before the tests fail.

- [x] 1. Initialize the repository
  - [x] 1.1 Run `git init` and `npm init`. Set `"type": "module"` and scripts `test` and `test:quick` (`vitest run --reporter dot`). (Req 9.1)
  - [x] 1.2 Install dev dependencies: `typescript vitest fast-check @fast-check/vitest tsx @types/node`. (Req 9.2)
  - [x] 1.3 Add `tsconfig.json` and `vitest.config.ts`.
  - [x] 1.4 Confirm `.gitignore` lists `node_modules`, `dist`, `docs/_planning/` and does not list `.kiro`. (Req 9.3)
  - [x] 1.5 Add the MIT `LICENSE`, a one-line English `README.md`, `docs/devlog.md` with a first entry, and `.kiro/steering/.gitkeep`. (Req 9.4, 9.5, 9.6)

- [x] 2. Add shared types and constants
  - [x] 2.1 Create `core/types.ts` exactly as in `design.md`. (Req 8.1)
  - [x] 2.2 Create `core/constants.ts` with every export in the design table, each with a unit in its name and a section comment. (Req 8.2, 8.3)

- [x] 3. Write failing tests in `test/wav.test.ts`
  - [x] 3.1 Round-trips 16-bit mono at 48000 Hz. (Req 1)
  - [x] 3.2 Downmixes 16-bit stereo to mono by averaging (L=0.5, R=0.1 gives 0.3). (Req 3)
  - [x] 3.3 Skips an unknown chunk (`LIST`, including an odd-sized one) before `data`. (Req 2)
  - [x] 3.4 Rejects 24-bit PCM with a message matching `/16-bit PCM/`. (Req 4)
  - [x] 3.5 Rejects 32-bit float and 8-bit the same way. (Req 4)
  - [x] 3.6 Reads a file with zero samples as an empty array. (Req 5)
  - [x] 3.7 Rejects non-RIFF bytes and a missing `data` chunk with a clear error. (Req 2.3)
  - [x] 3.8 Run `npx vitest run test/wav.test.ts` and confirm FAIL (module missing).

- [x] 4. Implement
  - [x] 4.1 Create `core/wav.ts` (`readWav`, `writeWav`) on `Uint8Array`/`DataView` only. (Req 1, 2, 3, 4, 5, 7)
  - [x] 4.2 Create `node/files.ts` (`readWavFile`, `writeWavFile`) with `fs/promises`. (Req 6)
  - [x] 4.3 Run `npx vitest run test/wav.test.ts` and confirm PASS.
  - [x] 4.4 Check that no file under `core/` imports `fs`, `path`, DOM, or Web Audio. (Req 7)

- [ ] 5. Verify and commit
  - [x] 5.1 Run `npm test` and `npx tsc --noEmit`. Both pass.
  - [x] 5.2 Confirm `git status` shows `LICENSE` and `.kiro/` as tracked, and no Korean text in any tracked file.
  - [x] 5.3 Commit with the message `feat: add WAV read/write and project scaffold`.
  - [ ] 5.4 Manual, outside Kiro: publish to a public GitHub repository, check that About shows MIT, and enable "Template repository" in Settings.
