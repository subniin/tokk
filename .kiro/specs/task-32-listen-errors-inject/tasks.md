# Tasks: Task 32, onError, inject and keys mode

Test first. English only. Do not push or publish. Do not touch `docs/_planning/`. Remove temporary files.

- [x] 1. Write `test/engine-inject.test.ts`. Confirm FAIL.
- [x] 2. Implement `Engine.inject` in `core/engine.ts`. Tests pass.
- [x] 3. Write `test/listen-errors.test.ts`. Confirm FAIL.
- [x] 4. Implement the `inject` message, `web/errors.ts`, `onError`, keys mode and `Ears.inject`. Tests pass.
- [x] 5. Add the two browser tests to `test/web/listen.spec.ts` and the type checks to `public-api-types.ts`.
- [x] 6. README example, one row in `docs/kiro.md`, one line in `docs/devlog.md`.
- [x] 7. Run `npm test`, `npm run pbt:quick`, `npm run test:web` twice, the three `tsc` checks, `npm run check:public-api`, `npm run build` and `npm run build:site`.
- [x] 8. Commit with `feat: add onError, inject and keys mode to listen`.
