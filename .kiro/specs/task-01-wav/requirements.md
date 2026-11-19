# Requirements: Task 1, Repository scaffold and WAV I/O

## Introduction
Tokk is a sound-event engine that runs in Node and in the browser. Task 1 creates the repository scaffold, the shared types and constants, and WAV reading and writing. Every later task builds on these. Only 16-bit PCM WAV is supported.

## Requirements

### Requirement 1: Read 16-bit PCM WAV
**User story:** As a developer, I want to read a WAV file from bytes, so that I can feed recorded audio to the engine without any I/O in the core.

#### Acceptance Criteria
1. WHEN `readWav` receives bytes of a valid 16-bit PCM mono WAV, THE system SHALL return its `sampleRate` and a `Float32Array` of samples scaled to the range [-1, 1).
2. WHEN a sample array is written with `writeWav` and read back with `readWav`, THE system SHALL return the same sample rate and every sample within 3 decimal places (round trip, 48000 Hz, values 0, 0.5, -0.5, 0.999).
3. THE `readWav` and `writeWav` functions SHALL operate on `Uint8Array` only and SHALL NOT touch the file system.

### Requirement 2: Walk RIFF chunks
**User story:** As a developer, I want WAV files with extra metadata to load, so that files from different recorders work.

#### Acceptance Criteria
1. WHEN a WAV file contains chunks other than `fmt ` and `data` (for example `LIST`), THE system SHALL skip them and still find `fmt ` and `data`.
2. WHEN a chunk has an odd size, THE system SHALL skip its pad byte before reading the next chunk.
3. IF the bytes are not a RIFF/WAVE file, or `fmt ` or `data` is missing, THEN THE system SHALL throw an `Error` that says what is missing.

### Requirement 3: Downmix to mono
**User story:** As a developer, I want stereo files to work, so that I do not convert recordings by hand.

#### Acceptance Criteria
1. WHEN a 16-bit file has two or more channels, THE system SHALL return one channel that is the average of all channels per frame.
2. WHEN a stereo frame has L = 0.5 and R = 0.1, THE system SHALL return 0.3 (within 3 decimal places).

### Requirement 4: Reject unsupported formats loudly
**User story:** As a user, I want a clear error for an unsupported WAV, so that I never get silent garbage.

#### Acceptance Criteria
1. IF the `fmt ` chunk is not `audioFormat = 1` with `bitsPerSample = 16`, THEN THE system SHALL throw an `Error` whose message contains `16-bit PCM`.
2. WHEN the input is 24-bit PCM, 32-bit float, or 8-bit PCM, THE system SHALL throw that error and SHALL NOT return samples.

### Requirement 5: Handle empty audio
**User story:** As a developer, I want an empty recording to be valid, so that silent input does not crash later stages.

#### Acceptance Criteria
1. WHEN a WAV has a `data` chunk of zero bytes, THE system SHALL return an empty `Float32Array` and the file's sample rate, and SHALL NOT throw.

### Requirement 6: File helpers in `node/`
**User story:** As a Node user, I want to read and write WAV files by path, so that tools can use files directly.

#### Acceptance Criteria
1. THE `readWavFile(path)` function SHALL read the file with `fs/promises` and return the result of `readWav`.
2. THE `writeWavFile(path, samples, sampleRate)` function SHALL write the result of `writeWav` and resolve to `void`.
3. THE file helpers SHALL live in `node/files.ts` and nowhere under `core/`.

### Requirement 7: Layer rule
**User story:** As a maintainer, I want `core/` to stay portable, so that the same code runs in Node and in the browser.

#### Acceptance Criteria
1. THE code under `core/` SHALL NOT import `fs`, `path`, DOM APIs, or Web Audio APIs.
2. THE `core/` code SHALL have no runtime dependencies.
3. THE code SHALL NOT send audio over the network.

### Requirement 8: Shared types and constants
**User story:** As a developer of later tasks, I want one source for types and tuning values, so that experiments change one file.

#### Acceptance Criteria
1. THE `core/types.ts` file SHALL export `Segment`, `SoundEvent`, `SoundModel`, `Nearest`, `ClassifyResult`, `Classifier`, and `MatchEvent` exactly as listed in `design.md`.
2. THE `core/constants.ts` file SHALL export every tuning value of the plan as a named constant whose name includes its unit (`_MS`, `_HZ`, `_DB`, `_DBFS`, `_SEMITONES`).
3. THE code SHALL NOT hard-code sample counts for thresholds or durations.

### Requirement 9: Project scaffold
**User story:** As a contributor, I want a working project on first clone, so that I can run tests immediately.

#### Acceptance Criteria
1. THE repository SHALL contain `package.json` (`"type": "module"`, scripts `test` and `test:quick` = `vitest run --reporter dot`), `tsconfig.json`, `vitest.config.ts`, `README.md` (one line), and `docs/devlog.md`.
2. THE dev dependencies SHALL include `typescript`, `vitest`, `fast-check`, `@fast-check/vitest`, `tsx`, and `@types/node`.
3. THE `.gitignore` SHALL list `node_modules`, `dist`, and `docs/_planning/`, and SHALL NOT list `.kiro`.
4. THE repository SHALL contain a `LICENSE` file with the MIT license text.
5. THE first commit SHALL include `LICENSE` and the `.kiro/` directory (including `.kiro/specs/` and `.kiro/steering/.gitkeep`).
6. THE code, comments, README, and commit messages SHALL be in English.
