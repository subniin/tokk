# Design: Task 25, integration measurements

## Layout
```
docs/integration.md              the measurements                          [new]
test/integration-doc.test.ts     checks of the document                    [new]
docs/kiro.md, docs/devlog.md     one row, one line                         [changed]
```

## Document format
Sections, in order: `## How the numbers were measured`, `## Cases`, `## Wiring lines`, `## Shared template work`, `## Human checks with a real microphone`, `## Synthetic sounds`.

- `Cases` is a table with the seven columns of requirement 3. The wiring cell of an app row is `<n> lines`. The third row has "not done yet" in every measured cell.
- `Wiring lines` is a table `| Group | Lines |` with the group names of `count:wiring` as they print (`apps/hands-free`, `apps/knock-once`, `examples/hello`).
- `Human checks...` is a table `| Check | App | What to measure | Target | Value |`. The last cell of every row is `not measured yet`.
- No cell contains a `|`.

## Tests (`test/integration-doc.test.ts`)
- I1: for each group from `collectGroups(REPO_ROOT)`, the `Wiring lines` table has that group with the same number.
- I2: the Hands-Free and Knock Once rows of `Cases` contain `<n> lines` with the computed number of their app.
- I3: the document matches none of `\bN hours\b`, `\bM hours\b`, `TBD`, `TODO`.
- I4: the human-check table has at least 6 rows and the value cell of each is `not measured yet`.
- I5: the document names the two commits and the five rules of the measurement (start, end, sources, wall-clock, orchestrator).

The test reads files only. It does not start npm or a browser.

## Measured values
Taken from the operator's prompt (Kiro run logs and git commit times); this task does not measure them again.
