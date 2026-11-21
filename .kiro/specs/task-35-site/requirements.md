# Requirements: Task 35, the new site

## Introduction
Task 35 replaces the landing page of the GitHub Pages site (`https://subniin.github.io/tokk/`) with the approved design of `site.md` and its mockup. The page has a hero with a demo box that teaches Tokk a clap in the browser, two app cards, a case band, a four-step guide, a "how it works" figure, a Kiro section, a privacy band and a footer.

The task runs twice.

| Run | Content |
|---|---|
| A | This spec, the site build changes, the whole page, the demo box with its six states laid out and a test-only way to switch them. The buttons of the demo box do nothing yet. |
| B (later) | The behaviour of the demo box (microphone teaching, room sound, reaction, "Hear a recording" with `clap-demo.wav`, the failure state) and the browser tests for it. |

Facts checked before this spec was written:
- `site-src/index.html` is a small page with an inline `<style>`. `scripts/build-site.ts` copies it to `site/index.html` and warns about each landing-page link that is not in the output.
- Apps are bundled by `appBuildOptions` (alias `tokk` to `web/index.ts`, minify, worker source plugin). A CSS import in a bundle gives a `.css` file next to the `.js` file (the slides case has `dist/app.css`).
- The app rule of `copyTree` drops `.wav` files. The files in `site-src/media/` are for the page and must be copied as they are.
- `scripts/check-public-api.ts` scans `apps/` and `cases/`.
- `count:wiring` gives Click Talk 27, Shoo! 25 and the slides case 17 lines. `docs/integration.md` gives the build time and credits: Click Talk 1 h 32 min (about 56.0 credits), Shoo! 2 h 10 min (about 63.9 credits).
- The old apps (`hands-free`, `knock-once`) stay in the repository until Task 36. The new page does not link them.

## Requirements

### Requirement 1: The site bundle
**User story:** As a developer, I want the page script and style built like an app, so the page imports Tokk as a user of the package does.

#### Acceptance Criteria
1. `site-src/src/main.ts` SHALL be bundled by `npm run build:site` to `site/dist/landing.js` with the options of an app bundle (alias `tokk`, minified). Its CSS (`site-src/style.css`, imported by `main.ts`) SHALL be written to `site/dist/landing.css`.
2. `npm run dev` SHALL rebuild the same bundle on save, unminified, to `site-src/dist/landing.js` and `site-src/dist/landing.css`, so `http://localhost:5173/site-src/index.html` works like the built page. `site-src/dist/` is ignored by Git (the rule `dist` already covers it).
3. `site-src/media/` SHALL be copied to `site/media/` as it is, with no deny list (`.wav` files stay). A missing `site-src/media/` SHALL copy nothing and not fail.
4. `buildSite` SHALL take an optional `siteSrcDir` (default `site-src/`), so a test can build a fixture page.
5. The dead-link check of the build SHALL skip links that start with `#` and links that start with `https://github.com/subniin/tokk`. Every other link that is not in the output SHALL still give a warning.
6. `npm run check:public-api` SHALL scan `site-src/` too, and the page code SHALL import from `'tokk'` only.

### Requirement 2: No external requests
1. Every URL of `index.html`, `dist/landing.js` and `dist/landing.css` SHALL be relative (the site lives under `/tokk/`), except `<a href>` values that start with `https://github.com/subniin/tokk`.
2. The page SHALL load no external font, script, style, image or frame. It SHALL use system fonts only.
3. `index.html` SHALL have no inline `<script>`. It loads `dist/landing.js` as a module script and `dist/landing.css` as a stylesheet.

### Requirement 3: Look
1. The light theme is the default. The dark theme applies by `prefers-color-scheme: dark`. The accent is `#e5482a` (light) and `#ff6a4a` (dark). One colour set per theme, no theme switch.
2. Text SHALL have a contrast of at least 4.5 to 1 against its background and large text and graphics at least 3 to 1, in both themes (the text on the accent button uses the dark ink for this reason, see design.md).
3. Every link and button SHALL have a visible focus outline of at least 2 px.
4. Motion SHALL exist in two places only: the demo box (waveform and reaction) and the flow figure of "How it works". `prefers-reduced-motion: reduce` SHALL stop both.
5. The page SHALL have no horizontal scroll at 320 px and at 1280 px.

### Requirement 4: Content
1. The page SHALL contain, in this order: the top bar (`Tokk`, `Demo`, `Apps`, `Build`, `How it works`, `GitHub`), the hero, the apps section with the case band, `Build your own in four steps.`, `How it works`, `Built with Kiro.`, the privacy band and the footer (`Tokk`, `MIT licence`, `GitHub`, `Teach page`).
2. The copy SHALL be the final English copy of `site.md` section 5, word for word.
3. The two app cards SHALL show the mini screen of the app (Click Talk category cells, Shoo! night yard), one line of text, the sounds, `Wiring N lines`, `Built in ...` and an `Open` link to `apps/click-talk/` and `apps/shoo/`.
4. The case band SHALL link to `cases/slides/` and credit reveal.js (`reveal.js by Hakim El Hattab, MIT licence`).
5. The two code blocks of "Build your own" SHALL come from real code: the browser block from the wiring of `cases/slides/src/main.ts`, the Node block from the `expectEvents` call of the README. A test SHALL check that each call and option the blocks show exists in that source.
6. The page SHALL link `teach.html` (footer) and `https://github.com/subniin/tokk/blob/main/docs/kiro.md` (`How Kiro was used`). It SHALL NOT link `apps/hands-free/` or `apps/knock-once/`.
7. The numbers on the cards SHALL equal `count:wiring` and `docs/integration.md`. A Node test SHALL check this.

### Requirement 5: The demo box layout
1. The demo box SHALL hold six states: idle, teaching, room sound, reacting, recording and microphone failure (`site.md` section 4).
2. All six SHALL sit in one grid cell, and only `visibility` changes between them. The box height and the position of the hero title SHALL NOT change between states. The highlight border of a live state SHALL be drawn with `box-shadow` only.
3. In run A the idle state is shown, and its two buttons (`Turn on the microphone`, `Hear a recording`) do nothing.
4. A test-only hook SHALL switch the state: with `?test` in the URL, the page listens for the event `tokk-demo-state` whose `detail` is a state name. Without `?test` the event is ignored.

### Requirement 6: Privacy
1. No code of the page SHALL send audio over the network. The page SHALL store no recording and no sound model of its own.
2. In run B the demo box SHALL keep its feature vectors in memory only (no `storageKey`).

### Requirement 7: Tests (run A)
1. `test/build-site.test.ts` SHALL check that the output holds `index.html`, `dist/landing.js`, `dist/landing.css`, copied `media/` files, both new apps, the slides case and `teach.html`, with no dead link and no external URL except the GitHub links.
2. `test/landing.test.ts` SHALL check the copy, the numbers, the code blocks, the links, the colours, and that the page has no inline script and no external font or script.
3. `test/web/site.spec.ts` SHALL check the sections, that the links open, the layout at 320 px and 1280 px, and that the demo box height and the title position are equal in all six states.

### Requirement 8: Run B (later, not done in run A)
1. `Turn on the microphone` SHALL teach `clap` five times (`examples: 5`), then record 10 seconds of room sound, then react to `clap clap` with the animation of the mockup.
2. `Hear a recording` SHALL play `site-src/media/clap-demo.wav` in an `<audio>` element and process the same file with `readWav` and `runSamples`, and show the events at their play time. The file and its model are synthetic until the owner supplies a real recording.
3. A microphone failure SHALL show the reason in one line and highlight `Hear a recording` (`onError` for a lost microphone).
4. Browser tests SHALL cover teaching with the fake microphone, a denied permission followed by a recording, and the states.
