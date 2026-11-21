# Design: Task 35, the new site

## Files
| File | Content |
|---|---|
| `site-src/index.html` | The page. Static HTML, no inline script. Links `dist/landing.css` and `dist/landing.js`. |
| `site-src/style.css` | The CSS of the mockup without the mockup bar, with the dark theme under `prefers-color-scheme`. |
| `site-src/src/main.ts` | Entry. Imports the CSS, draws the waveform bars, sets the first state, registers the test hook. Run B adds the Tokk block here. |
| `site-src/src/demo.ts` | Pure: the six state names, their labels, `demoView(state)`. Tested without a DOM. |
| `site-src/src/constants.ts` | The waveform bar heights and the test hook names. |
| `site-src/media/` | Run B: `clap-demo.wav`, `clap-demo-sounds.json`. Copied as they are. |
| `scripts/build-site.ts` | Bundles the page, copies `media/`, skips `#` and GitHub links in the dead-link check, takes `siteSrcDir`. |
| `scripts/build.ts` | `npm run dev` also watches the page bundle (`site-src/dist/`). |
| `scripts/check-public-api.ts` | Scans `site-src/` too. |

## Build
`buildSite` calls `appBuildOptions(siteSrcDir, { minify: true, outfile: <out>/dist/landing.js })`. The entry of an app bundle is `<dir>/src/main.ts`, so the page needs no new esbuild options. `import '../style.css'` makes esbuild write `landing.css` beside `landing.js`. The page loads the CSS with a `<link>`, so the page is styled before the script runs. A CSS text import (as `apps/shoo` uses) would paint an unstyled page first and would not work without the script.

`media/` is copied with `cpSync`, with no deny list, because the deny list is for app folders.

In dev the same options are used unminified and write to `site-src/dist/`. The page is served at `/site-src/index.html`. Its `teach.html` link does not work there (the file is at the repository root), which is the same for every page served from a sub folder in dev. The built site is the place to check links.

## The demo box
```
.demo
  .demo-head   title and state text
  .wave        36 bars (drawn by main.ts)
  .stage       display: grid
    .st.s-idle  .st.s-teach  .st.s-room  .st.s-live  .st.s-fail   all at grid-area 1 / 1
```
`data-st` on `.demo` is one of `idle teach room live rec fail`. The CSS shows `.s-idle` for `idle`, `.s-live` for `live` and `rec`, and so on, with `visibility`. The `rec` state shows the same screen as `live` plus the line `Playing a recording...` (`.rec-note`, also visibility only). The box is as tall as its tallest state at every width. The border highlight is a `box-shadow`, so nothing moves.

`demoView(state)` returns `{ label, live, waveDim }`:
- `label`: `ready`, `teaching clap`, `room sound`, `listening`, `recording`, `no microphone` (the mockup labels).
- `live`: true for `live` and `rec`.
- `waveDim`: true for `idle` and `fail` (the waveform is faded).

`setDemoState(state)` writes `data-st`, the `live` class, the label and the wave opacity class. Run B calls it from the real flow. The test hook calls it too, only when the URL has `?test`.

## Numbers and code blocks
The numbers are written in the HTML. `test/landing.test.ts` reads `collectGroups()` of `count:wiring` and the table of `docs/integration.md` and compares. Credits are rounded to a whole number on the page (56 and 64).

The code blocks are written by hand from real code. The test normalises whitespace and checks that every call and option the blocks show appears in `cases/slides/src/main.ts` (browser) and in the README `expectEvents` example (Node), so a rename in the real code fails the test.

## Decisions
- **Contrast of the primary button.** White text on `#e5482a` is 3.97 to 1, below the 4.5 to 1 of `ui.md`. The text on the accent uses the dark ink `#15171a` (4.5 to 1) in the light theme. The dark theme already did this in the mockup. The accent colour is unchanged. This differs from the mockup in one colour.
- **Accent text.** The accent is used as text colour only for the large `clap clap` (3 to 1 is enough).
- **No theme switch.** The theme follows the system.
- **Favicon.** An inline `data:` SVG, so the browser does not ask for `/favicon.ico` outside `/tokk/`.
- **Static HTML.** Everything except the waveform bars is in the HTML, so the page reads without the script.

## Run B notes
The demo box code goes to `site-src/src/demo-box.ts`, with the Tokk block between `// tokk:start` and `// tokk:end` (`count:wiring` does not scan `site-src/`, so no number changes). The room sound is 10 seconds, shorter than the 30 seconds of the apps, because the demo has to finish on the first screen (plan, step 3). Run B uses `listen({ ... })` without `storageKey`.
