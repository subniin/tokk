<!-- TEMPLATE: copy this spec into your own project, then replace every <placeholder>. Not a spec of the Tokk repository. -->
# Requirements: <App name>

## How to use this template (instructions for Kiro)
1. Fill the table below: one row per sound and pattern.
2. Generate the acceptance criteria below the table (one requirement per row, EARS style), then `design.md` and `tasks.md`, from the table.
3. Use the pattern grammar of Tokk: sound names separated by a space (`click click`), `_` for a rest, `hum.rise` and `hum.fall` for a hum. Gaps between sounds are below 350 ms and rests are 350 to 1000 ms.
4. Follow the `integrate` guidance (the `integrate` skill of the Tokk power, or `.kiro/steering/integrate.md`).
5. Use `modes` when two patterns share a prefix and the screens of the app differ.
6. Write tasks test-first, with an `expectEvents` test per pattern.
7. Ask a question only about an empty cell. Do not invent sounds.

| Sound name | Example folder | Pattern | Action |
|---|---|---|---|
| <sound name> | <examples/sounds/name> | <pattern> | <action> |
| <sound name> | <examples/sounds/name> | <pattern> | <action> |
