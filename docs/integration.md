# Integration measurements

Measured values for the apps that use Tokk. A value that has not been measured says "not measured yet". Wiring line counts come from `npm run count:wiring`.

## How the numbers were measured

- Start: the Kiro run that wrote the app's spec.
- End: the commit whose tests met the app's completion criteria.
- Sources: times come from Kiro run logs and git commit times.
- Times are Kiro wall-clock time. There was no manual coding.
- The times do not include any check with a real microphone.

## Cases

| Target | Sounds taught | Wiring lines | Time | Kiro credits | What Kiro did | What the orchestrator corrected |
|---|---|---|---|---|---|---|
| Hands-Free (task 22), commit e7d5083 | tongue click (`click`), hum and `background` | 17 lines | 2026-11-20 17:50:21 to 19:14:02, 1 h 24 min | about 135 (spec 24, implementation 24 + 87) | Wrote the spec, then the app. A model throttle error stopped the first implementation run, and a second run on another model resumed the same session. | Told Kiro to fix the template's sequential `teach()` handling instead of retrying on the "already open" error. Spotted that the "Heard" line showed "(ignored: listening is off)" under the ON banner, fixed in task 23. |
| Knock Once for Yes (task 23), commit 2e29c2f | knock | 19 lines | 2026-11-20 19:16:00 to 21:13:10, 1 h 57 min | about 84 (spec 15, implementation 69) | Wrote the spec, then the app. Found and fixed by itself: the state line kept "Listening is paused" after a sound effect (seen in its own screenshot, failing test first), and the ending text was clipped at 320 px. | None. |
| Shoo! (task 33), run A commit 59dff36 (rules), run B this task | click, clap, knock, pop and `background`. The sounds in `apps/shoo/sounds/` and the browser fixtures are synthetic; the player teaches real ones on the first run. | 25 lines | Start 2026-11-22 03:38:29 (run A start). End 2026-11-22 06:13:30 (fix commit c8ff1a3). Duration without task 32b: 2 h 10 min (2 h 35 min 1 s from start to end, minus 25 min 11 s of task 32b). Run A 03:38:29 to 03:48:46, run B first attempt from 03:49:49 (stopped without changes), run B 04:17:39 to 05:09:01 (commit f14cf7e), operator check in the browser 05:09 to 05:15, fix run 05:15:16 to 06:13:30. | About 12.7 (run A) + about 2.7 (run B first attempt) + about 43.4 (run B) + about 5.1 (fix run) = about 63.9 without task 32b. | Run A wrote the spec and the pure rules with their tests. Run B wrote the screen, the sound effects, the wiring (the room sound of 30 s through `backgroundMs`, the sound of each new monster, the microphone card with a keys fallback) and the browser tests. | None to the code; the operator only wrote prompts. The first run B attempt stopped without changes because teach could not record 30 s of background; task 32b (`backgroundMs`) fixed that. In the browser the operator found the HUD candles box stretched to 453 px and a test that pressed a key repeatedly; both were fixed in the fix run (commit c8ff1a3). Real-microphone checks: not measured yet. |
| Click Talk (task 34), run A commit 5632a2b (rules), run B this task | click, pop and `background`. The sounds in `apps/click-talk/sounds/` and the browser fixtures are synthetic; the caregiver teaches real ones on the first run. | 27 lines | Measured after build | Measured after build | Run A wrote the spec and the pure rules with their tests. Run B wrote the screen from the approved mockup, the speech, the generated alarm, the caregiver screen, the wiring (`settleBurst` for two pops then silence, the one-sound scan timer, the microphone card with a keys fallback) and the browser tests. | Measured after build |
| Slide deck (task 26), reveal.js 6.0.2 (MIT, credit in `cases/slides/README.md`), stage 1 commit f21a3b1 | clap. The claps in `cases/slides/sounds/` and the recordings are synthetic and only serve the Node tests. In the browser the user teaches their own claps on the first run. | 17 lines (`count:wiring`). The agent reported 12 non-blank lines (15 lines between the markers). The caption added 5 lines. | Start 2026-11-21 01:00:26 (stage 2a start). End 2026-11-21 02:50:00 (stage 2c commit 60bacde). Duration of stage 2: 1 h 50 min (01:00:26 to 02:50:00, 1 h 49 min 34 s). Stage 2a 01:00:26 to 01:04:42, stage 2b 01:05:07 to 01:05:39 (32 s), stage 2c 01:06:06 to 02:50:00. | About 5.0 (2a) + about 0.8 (2b) + about 36.9 (2c) = about 42.7 in total. | Stage 2a (normal Kiro run): synthetic claps, recordings, model and the grammar tests. Stage 2b (the `integrator` custom agent, headless): stopped for nothing, wrote only the three named files, ran only `npx vitest run test/slides-events.test.ts` (2 passed), did not call the mcp-ears listen tool. Stage 2c (normal Kiro run): the caption, the button styling, the browser tests, the documents. | None. The agent's wiring was kept; stage 2c added the caption calls and the error caption inside the markers as the spec planned. `git diff --stat f21a3b1 60bacde`: 28 files changed, 1544 insertions(+), 78 deletions(-). |

## Wiring lines

Output of `npm run count:wiring`.

| Group | Lines |
|---|---|
| `apps/hands-free` | 17 |
| `apps/knock-once` | 19 |
| `apps/click-talk` | 27 |
| `apps/shoo` | 25 |
| `cases/slides` | 17 |
| `examples/hello` | 7 |

## Shared template work

Not counted in the apps. The apps needed it. Task 32b was needed by Shoo! and is not counted in its time or credits.

| Task | Content | Time | Kiro credits | Commit |
|---|---|---|---|---|
| 20 | Template features both apps needed | 2026-11-20 14:53:17 to 16:37:51, 1 h 45 min | about 93 | 9bf4b5f |
| 21 | App bundles, static site, wiring count | 2026-11-20 16:52:04 to 17:48:08, 56 min | about 49 | 3a32cf3 |
| 32b | Template option ackgroundMs for the Shoo! build | 2026-11-22 03:51:22 to 04:16:33, 25 min 11 s | about 8.1 | 8328b44 |

When the hello tests conflicted in task 21, the orchestrator chose minimal named edits (H3, H4, D1).

## Human checks with a real microphone

| Check | App | What to measure | Target | Value |
|---|---|---|---|---|
| Teaching a new sound | any | Time from the start of recording to a working pattern | under 1 minute | not measured yet |
| Three articles hands-free | Hands-Free | Read the three articles using sounds only | all three read | not measured yet |
| Wrong clicks | Hands-Free | Count wrong clicks while talking, with listening off and with listening on | 0 in 10 minutes of talking with listening off; at most 2 per hour with listening on | not measured yet |
| Whole game by knocking | Knock Once for Yes | Play the whole game using knocks only | finished by knocking only | not measured yet |
| One knock against two knocks | Knock Once for Yes | Share of correct answers, one knock against two knocks, in the filming room | 95 % or better | not measured yet |
| Double clap | third case | Teach the clap once in the deck, then clap twice 10 times and three times 10 times, and count the times the slide moved as the table says | at least 9 of 10 for each pattern | not measured yet |

## Synthetic sounds

All recognition tests so far used synthetic sounds and a fake microphone. They show the logic and the wiring, not the recognition of a real mouth, hand or table.
