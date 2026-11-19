---
inclusion: fileMatch
fileMatchPattern: ["core/**/*", "web/**/*", "node/**/*"]
---

# Layer rules

- Keep `core/` pure TypeScript. Import no `fs`, `path`, DOM or Web Audio API there.
- Put browser code (microphone, AudioWorklet, teach UI, overlay) in `web/`.
- Put file reading and writing, and tools, in `node/`.
- Let apps import from `tokk` only, never from `core/` paths (checked by `npm run check:public-api`).
- Export from `core/index.ts` only what the public API needs.
