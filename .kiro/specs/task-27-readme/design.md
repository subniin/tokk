# Design: Task 27, README

## Layout
```
README.md                       the first page                                  [rewritten]
test/readme.test.ts             checks of the README (RM1 to RM7)               [new]
apps/README.md                  one line: the pattern table is a TypeScript object  [changed]
docs/kiro.md, docs/devlog.md    one row, one line                               [changed]
```

## Sections of README.md
`# Tokk`, one paragraph, then:
1. Current status
2. Teach your sounds (2.1 picture, 2.2 `teach.html` steps)
3. Hello example (the 7 lines, import map, run steps)
4. Demo video
5. Two apps and a third case (5.1 table, 5.2 measured numbers, 5.3 reveal.js credit)
6. How it works (flow, pattern rule)
7. Repository layout (7.1 tree, 7.2 layer rules, 7.3 set up and check)
8. Make a new app from this template
9. Node tools and MCP server
10. Kiro
11. Third-party components and licences
12. Privacy
13. What is next
14. Known limits and common problems (14.1 limits, 14.2 common problems)
15. Licence

Sub-sections use `### N.M`. The status section and the layout section follow the style of the owner's other repositories: short declarative sentences, present tense, bold only for a key term inside a sentence.

## Constraints from existing tests
- `test/apps-readme.test.ts` (R1): the first fenced block with `tokk:start` equals the hello block, one fenced block holds the jsDelivr import map, and the text contains `from 'tokk'`, `not counted`, `<n> lines of Tokk code` and `pending`.
- `test/hello-example.test.ts` (H4, H5, D1): the words `synthetic`, `teach.html`, `examples/hello`. Outside fenced blocks the only "number + minutes/seconds/lines" is the one `7 lines`. So tables carry wiring numbers as bare numbers under a "Wiring lines" header, and times as `1 h 24 min`.
- `test/slides-deck.test.ts` (U5): `reveal.js`, `6.0.2`, `MIT`, `LICENSE-revealjs.txt`, the author name and the home page of the installed package. Kept.
- `test/build.test.ts`: README ships in the package, so every link is relative and resolves in the repository.

## Numbers
- Wiring: `collectGroups` from `scripts/count-wiring.ts` (17, 19, 17, 7).
- Times and credits are copied from the `Cases` table of `docs/integration.md`: 1 h 24 min, 1 h 57 min, 1 h 50 min; about 135, about 84, about 42.7.
- Not measured, and said so: teaching time, wrong clicks, accuracy of real sounds, the double-clap check.

## Tests (`test/readme.test.ts`)
- RM1: `##` headings are numbered 1..n in order, `###` headings are `N.M` under their parent, the title is `# Tokk`.
- RM2: no `TODO`, no `TBD`, no e-mail address.
- RM3: every relative link and image target exists. Negative: a made-up link is reported.
- RM4: the wiring numbers of the case table and of the measured-numbers table equal `collectGroups`. Negative: a changed number is reported.
- RM5: time and credits of each case row equal the `Cases` row of `docs/integration.md`. Negative: a changed time is reported.
- RM6: the third-party table has a row for every name in `package.json` with the same version, and no `dependencies` exist that the table misses.
- RM7: required items: status words, demo video line, site URL with "not deployed", `npx tokk-mcp` with "after publish", reveal.js credit, `_new-app`, `expectEvents`, no YAML.

The tests read files only.
