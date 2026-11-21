# Tasks: Task 35, the new site

Test first. English only. Do not push, publish or deploy. Do not touch `docs/_planning/`, `core/`, `web/` or the apps. Never send audio over the network. Remove temporary files. Only the boxes of steps that were run are marked.

## Run A: spec, build, page
- [x] 1. Read the plan, `redesign.md` 5.4, `site.md`, the mockup, the current site build and tests.
- [x] 2. Write `.kiro/specs/task-35-site/` (requirements, design, tasks).
- [x] 3. Write the tests first: additions to `test/build-site.test.ts`, `test/landing.test.ts`. Run them and confirm FAIL.
- [x] 4. Build: `siteSrcDir`, the page bundle `site/dist/landing.{js,css}`, `media/` copy, the dead-link rule, `npm run dev` watch, `check:public-api` for `site-src/`, `tsconfig.web.json`.
- [x] 5. The page: `site-src/index.html`, `style.css`, `src/{main,demo,constants}.ts`. Demo box with six states in one grid cell and the `?test` hook.
- [x] 6. Update `test/web/site.spec.ts` to the new page (sections, links, 320 px and 1280 px, equal box height and title position in six states).
- [x] 7. One row in `docs/kiro.md` for this spec.
- [x] 8. Run all checks (`npm test`, `npm run pbt:quick`, tsc x3, `check:public-api`, `build`, `build:site`, `site.spec.ts`). Commit `feat: add the new site page`.

## Run B: the demo box behaviour (later)
- [ ] 9. `site-src/media/clap-demo.wav` and `clap-demo-sounds.json` (synthetic).
- [ ] 10. `site-src/src/demo-box.ts`: teach 5 claps, 10 s of room sound, reaction to `clap clap`.
- [ ] 11. "Hear a recording": `<audio>` plus `readWav` and `runSamples`, events at play time.
- [ ] 12. Microphone failure state and `onError`.
- [ ] 13. Browser tests: fake microphone teaching, denied permission then recording, link checks.
- [ ] 14. Update `docs/integration.md` if needed, run all checks, commit.
