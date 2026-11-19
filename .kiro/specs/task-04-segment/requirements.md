# Requirements: Task 4, Chunk-invariant onset segmenter

## Introduction
Task 4 adds `core/segment.ts`. A `Segmenter` receives audio in chunks of any size and returns `Segment`s, the stretches of sound that stand out from the background. It decides every `t` the engine reports (design section 4.1). The same code runs in the browser and in Node, so a test with a recording must give the same result as the microphone. For that reason the result must not depend on how the input was cut into chunks (P3), and it must not depend on the sample rate beyond 5 ms of timing (P4).

The segmenter does not classify. It measures a short-time level every 5 ms, tracks a noise floor, and opens a segment when the level jumps above the floor.

| Consumer | What it uses from this task |
|---|---|
| Task 5 (kNN) | Nothing directly. Task 3's `extractFeatures` takes the `Segment`s it returns |
| Task 8 (engine, teach) | `push`, `flush`, `openSegmentStart` (the matcher is advanced only to the start of an open segment), `noiseFloorDb` |
| P2, P3, P4 | Noise-only silence, chunk invariance, sample-rate invariance |
| Review Focus 2, 4, 5 | Empty and silent input, clipped input, fast knocking |

## Requirements

### Requirement 1: Interface and output
**User story:** As a developer of the engine, I want a small streaming object, so that I can feed it microphone chunks or a whole file the same way.

#### Acceptance Criteria
1. THE `Segmenter` class SHALL be constructed with `sampleRate` and SHALL offer `push(chunk): Segment[]`, `flush(): Segment[]`, `noiseFloorDb(): number` and `openSegmentStart(): number | null`.
2. IF `sampleRate` is not a positive finite number, or is so low that the hop would be 0 samples, THEN THE constructor SHALL throw a `RangeError` that names `sampleRate`. The 16000-96000 Hz range check belongs to the engine (Task 8).
3. THE `push` method SHALL return the segments that closed during this call, in time order, and an empty array when none closed.
4. EACH returned `Segment` SHALL have `t` = start sample / `sampleRate` (seconds), `durationMs` = sample count / `sampleRate` x 1000, `sampleRate`, and `samples` as a new `Float32Array` that holds exactly the input samples of the segment.
5. THE segmenter SHALL NOT modify a pushed chunk and SHALL NOT keep a reference to it. WHEN the caller changes a chunk after `push`, THE segments returned later SHALL NOT change.
6. WHEN `push` receives an empty chunk, THE system SHALL return `[]` and change no state.

### Requirement 2: Fixed hop and chunk independence (P3)
**User story:** As a developer, I want the same result for any chunking, so that a file test equals the browser.

#### Acceptance Criteria
1. THE system SHALL analyze the input in hops of `round(sampleRate x SEGMENT_HOP_MS / 1000)` samples (221 at 44100 Hz, 240 at 48000 Hz, 80 at 16000 Hz), counted from the first sample pushed.
2. THE system SHALL store incoming samples in an internal buffer and SHALL analyze a hop only when all its samples have arrived. A partial hop SHALL wait for the next `push`.
3. THE levels, noise floor, onsets, offsets, segment start and end samples and the sample values of every segment SHALL depend only on the concatenation of all pushed samples, never on chunk boundaries. This includes `noiseFloorDb()` and `openSegmentStart()` after the same total input.
4. THE system SHALL compute every time from cumulative sample counts (`t` = sample index / `sampleRate`). It SHALL NOT read a clock or add up floating-point times.
5. EVERY duration constant used for a decision (10, 5, 30, 70, 80, 1000 and 1500 ms) SHALL be converted once to a whole number of samples with `round(ms x sampleRate / 1000)`, and decisions SHALL compare whole sample counts.

### Requirement 3: Level
**User story:** As a developer, I want one level number per hop, so that all thresholds are in dB.

#### Acceptance Criteria
1. FOR each hop, THE level SHALL be `20 log10(RMS)` dBFS of the most recent `LEVEL_WINDOW_MS` (10 ms) of samples that end at the end of the hop. WHEN fewer samples exist (the start of the input), THE system SHALL use the samples available.
2. WHEN the RMS is 0, THE level SHALL be `SILENCE_LEVEL_DBFS` (-90). THE level SHALL NOT be lower than -90.
3. THE level before the first hop (the "previous level" of hop 0) SHALL be -90.

### Requirement 4: Noise floor
**User story:** As a user, I want the segmenter to adapt to a quiet or a noisy room, so that a knock stands out in both.

#### Acceptance Criteria
1. THE noise floor SHALL start at `NOISE_FLOOR_INITIAL_DBFS` (-70) and `noiseFloorDb()` SHALL return -70 before the first hop has been analyzed.
2. THE noise floor SHALL NOT go below `NOISE_FLOOR_MIN_DBFS` (-90) at any time.
3. WHILE no segment is open, AND the hop is not an onset, WHEN the level is below the floor, THE floor SHALL fall to the level at once.
4. WHILE no segment is open, AND the hop is not an onset, WHEN the level is above the floor, THE floor SHALL rise by the fraction `1 - exp(-hopSeconds / (T / 1000))` of the difference, where `hopSeconds` = hop samples / `sampleRate` (the real hop length, not 5 ms) and `T` is `NOISE_FLOOR_RISE_TIME_CONSTANT_MS` (1000 ms), or `NOISE_FLOOR_WARMUP_RISE_MS` (100 ms) during the calibration period of 4.7.
5. WHILE a segment is open, THE floor SHALL NOT change. This includes the hop that opens the segment and the hop that closes it.
6. AFTER the same elapsed time at a constant level, THE floor SHALL have risen by the same amount at 44100 Hz and at 48000 Hz (to within 0.01 dB), because the coefficient uses the real hop length.
7. THE first `NOISE_FLOOR_WARMUP_MS` (1000 ms) of the input SHALL be the calibration period (see Requirement 5.5). Hops whose end lies inside it use the warm-up time constant of 4.4.

**Why (calibration period).** The property test P2 (noise only) failed with the counterexample `["pink", -20, 16000, seed 3]`: a first segment opened when the noise began, ran to the 1.5 s maximum with the floor frozen at the -70 dBFS default (4.5), and a second segment opened at 1.795 s because the floor had risen only about 13 dB. A later run gave `["pink", -20, 44100, seed 477378]`, a segment at 3.07 s. With the 1 s constant the floor needs about 3 s to follow a loud room. The calibration period lets the floor settle before any segment can open. It matches the teach page step "record one second of silence first".

### Requirement 5: Onset
**User story:** As a user, I want a segment to open only for a clear, sudden sound.

#### Acceptance Criteria
1. WHILE no segment is open, THE system SHALL detect an onset at a hop only when all four hold: level > floor + `ONSET_ABOVE_FLOOR_DB` (12); level >= `ONSET_MIN_LEVEL_DBFS` (-60); level - previous level >= `ONSET_RISE_DB` (6); and at least `ONSET_MIN_GAP_MS` (80 ms) have passed since the previous onset hop.
2. THE "previous onset" SHALL include onsets that opened a segment by a confirmed in-segment re-onset (Requirement 6.3). WHEN there is no previous onset, THE gap condition SHALL be met.
3. WHEN a level is below -60 dBFS, THE system SHALL NOT open a segment, however far above the floor it is (so -70 dBFS dither never opens one).
4. WHEN the level rises by less than 6 dB over the previous hop, THE system SHALL NOT open a segment, however loud it is (a steady sound does not open a new segment).
5. DURING the calibration period (the first `NOISE_FLOOR_WARMUP_MS`, 1000 ms of input, Requirement 4.7), THE system SHALL NOT accept any onset. A hop is inside the period when its end sample is at most `round(1000 x sampleRate / 1000)`. The floor keeps adapting (4.3, 4.4).

### Requirement 6: Segment start and in-segment re-onset
**User story:** As a user who knocks fast, I want two knocks 100 ms apart to give two segments.

#### Acceptance Criteria
1. WHEN an onset opens a segment, THE segment SHALL start `ONSET_LEAD_MS` (5 ms) before the first sample of the onset hop. THE start SHALL NOT be before sample 0 and SHALL NOT be before the end of the previous segment.
2. WHILE a segment is open and no candidate is pending, WHEN at least `REONSET_MIN_SEGMENT_AGE_MS` (80 ms) have passed since its onset hop AND the level is at least `REONSET_RISE_DB` (3 dB) above the previous hop's level, THE hop SHALL become a re-onset **candidate**. THE system SHALL decide the candidate when `REONSET_CONFIRM_MS` (70 ms) of input after the start of the candidate hop have arrived. It SHALL **confirm** the candidate only if the mean energy (mean of squares) of the `REONSET_CONFIRM_MS` after the start of the candidate hop is at least `REONSET_CONFIRM_DB` (2.4 dB) above the mean energy of the `REONSET_CONFIRM_BEFORE_MS` (30 ms) before it, and the open segment is still open at that time. WHEN confirmed, THE system SHALL close the current segment at the start sample of the new segment and SHALL open a new segment with the start rule of 6.1 (the start is `ONSET_LEAD_MS` before the candidate hop, not 70 ms later). WHEN not confirmed, or WHEN the open segment closed first, THE candidate SHALL be dropped and the segment SHALL go on unchanged. THE decision SHALL use only samples already pushed, so that it does not depend on chunk boundaries (Requirement 2.3). `openSegmentStart()` SHALL keep reporting the start of the open segment until the new one is confirmed.
3. A confirmed re-onset SHALL count as an onset for the gap rule of 5.1.
4. WHILE a segment is open and fewer than 80 ms have passed since its onset hop, THE system SHALL NOT cut it, whatever the rise.
5. A candidate pending at `flush()` SHALL be dropped.

**Why (two-stage re-onset).** Property P4 (same sound at 16, 44.1 and 48 kHz) failed with the counterexample `[1, "low", "low", gain 0, 0, gap 500, no noise, seed 450386]`: at 16000 and 48000 Hz the tail of one isolated `low` impact (narrowband noise around 300 Hz, bandwidth 150 Hz, so its short-time level fluctuates about every 7 ms) rose 6.33 dB in one 5 ms hop at 0.430 s and was split into two segments, and at 44100 Hz it was not. A second counterexample `[2, "low", "low", 0, 0, 571, no noise, seed 19]` followed after a "within 10 dB of the running peak" check was added. A one-hop rise on a 10 ms window cannot separate such a fluctuation from a real second hit (measurements in `design.md`: both rise 3 to 8 dB in one hop, and a fluctuation can sit 1.6 dB below the peak while a real hit sits 3.2 dB below it). A real hit adds energy that lasts, a fluctuation does not. The confirmation compares 70 ms of energy after the candidate with 30 ms before it.

### Requirement 7: Offset and maximum length
**User story:** As a user, I want a segment to end when the sound ends, and never to run on.

#### Acceptance Criteria
1. WHILE a segment is open, THE system SHALL count consecutive hops whose level is below floor + `OFFSET_ABOVE_FLOOR_DB` (6). A hop at or above that line SHALL reset the count to 0.
2. WHEN the counted hops cover `OFFSET_HOLD_MS` (30 ms), THE system SHALL close the segment at the end of the hop that completed the hold.
3. WHEN the segment length reaches `SEGMENT_MAX_MS` (1500 ms), THE system SHALL close the segment at exactly `round(1500 x sampleRate / 1000)` samples. WHEN the hold and the maximum are reached in the same hop, THE maximum SHALL decide the end.
4. AFTER a segment closed at the maximum length, THE system SHALL open a new one only through the onset rule of Requirement 5 (a 6 dB rise). A steady 3 s tone SHALL give exactly one segment of 1500 ms.

### Requirement 8: Open segment, flush, floor query
**User story:** As the engine author, I want to know where the pending sound started, so that pattern timing is not delayed by the segmenter.

#### Acceptance Criteria
1. THE `openSegmentStart()` method SHALL return the start time in seconds (equal to the `t` the segment will have) while a segment is open, and `null` otherwise, including before the first hop is analyzed and right after the segment closes.
2. THE `flush()` method SHALL close an open segment at the last pushed sample (not later than the maximum length), SHALL return it, and SHALL NOT analyze a partial hop. WHEN no segment is open, `flush()` SHALL return `[]`. Calling it twice SHALL return `[]` the second time.
3. AFTER `flush()`, THE system SHALL keep the noise floor and the timeline, so that more `push` calls continue the same stream.
4. THE `noiseFloorDb()` method SHALL return the floor after the last analyzed hop.

### Requirement 9: Behaviour on fixed inputs
**User story:** As a user, I want the common cases to work, and the failure cases to fail safely.

#### Acceptance Criteria
1. WHEN the input is empty or all zeros, THE system SHALL return no segments from `push` and `flush`, and SHALL NOT throw (Review Focus 2).
2. WHEN three impacts are placed 300 ms apart at 48000 Hz, THE system SHALL return three segments whose `t` is within 10 ms of the impact times.
3. WHEN two impacts of the class `mid` or `high` are placed 100 ms apart, at 16000, 44100 or 48000 Hz, THE system SHALL return two segments (Review Focus 5, minimum gap 80 ms). WHEN a single impact of any class (`low`, `mid`, `high`, `ring`) is placed alone, THE system SHALL return exactly one segment at all three rates, whatever its seed and gain (no split by the re-onset).
4. WHEN one impact is hard-clipped at 0 dBFS and rings for 200 ms, THE system SHALL return exactly one segment (Review Focus 4). The ring SHALL NOT create a second segment.
5. WHEN white noise of constant level has played for 1 s, THE system SHALL not open any new segment after that second.
6. WHEN digital silence is followed by white dither at -70 dBFS, THE system SHALL return no segments, and `noiseFloorDb()` SHALL never be below -90.
7. EVERY sound in these examples SHALL start at or after the calibration period (1000 ms, Requirement 5.5). THE tests SHALL prepend 1 s of silence or of the test noise.

### Requirement 10: Noise-only input gives no segments (P2)
**User story:** As a user, I want a quiet room hum to produce no events.

#### Acceptance Criteria
1. FOR white or pink noise of constant RMS level between -60 and -20 dBFS at 16000, 44100 or 48000 Hz, THE system SHALL return no segment at all, over the whole input. The calibration period (Requirement 5.5) is why no segment opens when the noise itself starts.

### Requirement 11: Chunk invariance (P3)
**User story:** As a developer, I want a file test to equal the browser result.

#### Acceptance Criteria
1. FOR any list of chunk sizes between 1 and 4096, cycled over a fixed 3.2 s test signal at 44100 Hz that contains single impacts, a re-onset pair, and a 1.7 s tone, THE segments returned by `push` calls plus `flush` SHALL equal those returned by one `push` of the whole signal plus `flush`, in `t`, `durationMs`, `sampleRate` and every sample. THE final `noiseFloorDb()` SHALL be equal as well.

### Requirement 12: Sample-rate invariance (P4)
**User story:** As a developer, I want the same sound to give the same events on a 16, 44.1 or 48 kHz device.

#### Acceptance Criteria
1. FOR a signal synthesized once at 96000 Hz and resampled to 16000, 44100 and 48000 Hz with `test/helpers/resample.ts`, THE system SHALL return the same number of segments at all three rates, and the `t` of each segment SHALL differ between any two rates by at most 5 ms (plus 0.1 ms to cover the 44100 Hz hop of 5.011 ms).
2. THE test signal SHALL contain one or two impacts of the classes `low`, `mid`, `high` or `ring` at -20 to 0 dB, and optional white noise at -90 to -70 dBFS. THE first impact SHALL start at 1200 ms or later (after the calibration period) and the gap between impacts SHALL be 500 ms or more.

### Requirement 13: Layer rule and constants
**User story:** As a maintainer, I want `core/` to stay portable and tunable from one file.

#### Acceptance Criteria
1. THE file `core/segment.ts` SHALL NOT import `fs`, `path`, DOM or Web Audio APIs, SHALL have no runtime dependencies, SHALL NOT call `Math.random`, and SHALL NOT read the clock.
2. THE system SHALL use the existing constants `SEGMENT_HOP_MS`, `LEVEL_WINDOW_MS`, `SILENCE_LEVEL_DBFS`, `NOISE_FLOOR_INITIAL_DBFS`, `NOISE_FLOOR_MIN_DBFS`, `NOISE_FLOOR_RISE_TIME_CONSTANT_MS`, `ONSET_ABOVE_FLOOR_DB`, `ONSET_MIN_LEVEL_DBFS`, `ONSET_RISE_DB`, `ONSET_MIN_GAP_MS`, `ONSET_LEAD_MS`, `REONSET_MIN_SEGMENT_AGE_MS`, `OFFSET_ABOVE_FLOOR_DB`, `OFFSET_HOLD_MS` and `SEGMENT_MAX_MS`. ANY other tuning value this task needs SHALL be a named export of `core/constants.ts`. THE file SHALL NOT hard-code sample counts or thresholds.
3. THIS task SHALL add these constants to the Segmenter section of `core/constants.ts`: `REONSET_RISE_DB` (3), `REONSET_CONFIRM_MS` (70), `REONSET_CONFIRM_BEFORE_MS` (30), `REONSET_CONFIRM_DB` (2.4), `NOISE_FLOOR_WARMUP_MS` (1000) and `NOISE_FLOOR_WARMUP_RISE_MS` (100).
