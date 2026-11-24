# Tasks: Task 38

- [x] 1. Node unit test `test/listen-debug.test.ts` (fails first), then `setDebug` in `web/listen.ts` and the `Ears` type.
- [x] 2. Type test in `test/web-unit/public-api-types.ts`; README API line.
- [x] 3. Browser tests for `setDebug` in `test/web/listen.spec.ts` (real overlay).
- [x] 4. Node test `test/under-the-hood-link.test.ts` (fails first), then the link in both `index.html` files and CSS.
- [x] 5. Browser tests per app (`click-talk.spec.ts`, `shoo.spec.ts`) (fail first), then the button, `?debug=1`, the glue and the wiring.
- [x] 6. Recount (`npm run count:wiring`), sync link numbers, `docs/integration.md`, README, `site-src`, devlog line.
- [x] 7. Full checks: `npm test`, `npm run test:web` twice, three tsc checks, `npm run check:public-api`, `npm run build:site`, `npm run count:wiring`. Commit `feat: add setDebug and the Under the hood toggle`.
