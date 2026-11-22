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

## Run B: the demo box behaviour
- [x] 9. `site-src/media/clap-demo.wav` (10.8 s, 16 kHz) and `clap-demo-sounds.json`, written once with core/synth by a script that was deleted afterwards. `test/site-demo.test.ts` checks the matches in Node.
- [x] 10. `site-src/src/demo-box.ts`: teach 5 claps, 10 s of room sound, reaction to `clap clap` and `clap clap clap` (Tokk only between `// tokk:start` and `// tokk:end`).
- [x] 11. "Hear a recording": `<audio>` plus `readWav` and `runSamples`, events shown at `audio.currentTime`; the microphone is stopped first.
- [x] 12. Microphone failure state (denied, none, `onError`).
- [x] 13. Browser tests in `test/web/site.spec.ts` with `test/web/site-fixture.ts` (fake microphone): first visit, returning visitor, lost track, denied then recording at 320 and 1280 px, reduced motion, app card links, no request with a body or to another origin.
- [x] 14. `docs/devlog.md` line, all checks, commit `feat: rebuild the site with a live teach demo`.