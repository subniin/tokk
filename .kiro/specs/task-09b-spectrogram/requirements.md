# Requirements: Task 9b, spectrogram rendering, PNG encoding and the `spectrogram` MCP tool

## Introduction
Task 9b is the last item of the plan's execution order ("9 (spectrogram and PNG)"). It adds three things:
- `core/spectrogram.ts`, `renderSpectrogram`: turns samples into a grayscale pixel grid (time to the right, low frequencies at the bottom).
- `node/png.ts`, `encodePng`: turns that grid into a PNG file in memory, with no dependency except Node's `zlib`.
- The MCP tool `spectrogram` in `tools/mcp-ears/`, so that a coding agent can look at a recording (design 8.1).

The tool is added as one definition in the `TOOLS` list of Task 10. Nothing in the server wiring, the error wrapper or the path guard changes.

| Piece | Reads | Used by |
|---|---|---|
| `renderSpectrogram` | `fft` from `core/dsp/fft.ts`, constants from `core/constants.ts` | `spectrogram` tool, later the browser debug overlay (plan 2) |
| `encodePng` | `zlib.deflateSync` | `spectrogram` tool |
| `spectrogram` tool | `readWavFile`, the path guard, `renderSpectrogram`, `encodePng` | Kiro agents (`sound-tuner`, the `tokk` power) |

Out of scope: colour maps, axis labels or text in the image, a `synth` tool, any change to `core/index.ts` public exports beyond what the earlier public API test already expects, registration in `.kiro/settings/mcp.json` (Task 11B), any change to scoring.

**Segment marker (optional in the request): skipped.** Marking detected sounds in the image needs a sounds model argument, a run of the engine and drawing into the pixel grid, which makes the tool depend on a second file and changes its meaning from "show this audio" to "show this audio and what the engine thinks". That is not trivial, so this task does not do it. An agent can call `listen` for the segment times and `spectrogram` with `startS`/`endS` for the picture.

Constants: `core/constants.ts` already holds `SPECTROGRAM_FFT_SIZE`, `SPECTROGRAM_HOP_MS`, `SPECTROGRAM_MAX_HZ`, `SPECTROGRAM_HEIGHT_PX` and `SPECTROGRAM_FLOOR_DBFS`. Task 1 of `tasks.md` confirms them. This task adds two constants (Requirement 1.6 and Requirement 5.5).

## Requirements

### Requirement 1: `renderSpectrogram`
**User story:** As a developer or an agent, I want a picture of the energy in a recording, one pixel per 10 ms, so that I can see where sounds start and what band they sit in.

#### Acceptance Criteria
1. THE function SHALL have the signature `renderSpectrogram(samples: Float32Array, sampleRate: number, options?: { startS?: number; endS?: number }): { width: number; height: number; gray: Uint8Array }` and live in `core/spectrogram.ts`. It SHALL import only `core/dsp/fft.ts` and `core/constants.ts`. It SHALL have no dependency and SHALL NOT use `fs`, `path`, DOM, Web Audio or randomness.
2. THE frame size SHALL be `SPECTROGRAM_FFT_SIZE` (1024) samples with a Hann window. THE hop SHALL be `SPECTROGRAM_HOP_MS` (10 ms), converted once to samples as `round(sampleRate × SPECTROGRAM_HOP_MS / 1000)`. No other sample count SHALL be written as a literal. One column of the image is one hop.
3. THE height SHALL be `SPECTROGRAM_HEIGHT_PX` (256). THE image SHALL cover 0 to `SPECTROGRAM_MAX_HZ` (8000 Hz). THE gray array SHALL be row-major, row 0 at the top, with `gray.length === width × height`. Low frequencies SHALL be at the bottom: image row `height − 1 − r` shows frequency band `r`.
4. FREQUENCY BAND `r` (0 at the bottom) SHALL cover `[r × B, (r + 1) × B)` Hz with `B = SPECTROGRAM_MAX_HZ / height` (31.25 Hz); the top band SHALL also include 8000 Hz itself. FFT bin `k` has frequency `k × sampleRate / SPECTROGRAM_FFT_SIZE`. THE value of a band SHALL be the largest magnitude among the bins whose frequency lies in the band. IF no bin lies in the band (the bin spacing is wider than the band, which happens above 16 kHz sample rate), THEN the value SHALL be the magnitude of the bin nearest to the band's centre frequency.
5. THE magnitude SHALL be scaled so that a full-scale sine (amplitude 1) reads 0 dB: magnitude = `|X[k]| / (sum of window / 2)`. THE level SHALL be `20 × log10(magnitude)` in dB, clamped to the range `SPECTROGRAM_FLOOR_DBFS` (−90) to `SPECTROGRAM_CEILING_DBFS` (0), with a magnitude of 0 reading the floor. THE gray value SHALL be `round((level − floor) / (ceiling − floor) × 255)`, so −90 dB gives 0 and 0 dB gives 255. The result SHALL be deterministic and have no NaN.
6. THE new constant `SPECTROGRAM_CEILING_DBFS = 0` SHALL go into `core/constants.ts`, under "Spectrogram", next to the existing ones.
7. THE time of column `i` SHALL be its centre sample count divided by the sample rate (centre sample = `i × hopSamples` counted from the start of the selected range), in seconds. Frame `i` covers the 1024 samples around that centre sample. Samples outside the selected range SHALL count as zero (the range is cut out first, then analysed), so the picture of a range does not depend on audio outside it.
8. THE range SHALL be `startS` (default 0) to `endS` (default the end of the recording), in seconds of the recording. THE start and end samples SHALL be `round(startS × sampleRate)` and `round(endS × sampleRate)`, clamped to `[0, samples.length]`. IF `endS` is not greater than `startS` after clamping, THE range is empty.
9. THE width SHALL be `ceil(rangeSamples / hopSamples)` for a non-empty range, so a range shorter than one hop still gives one column, and a range shorter than the frame is zero-padded to the frame size.
10. WHEN the range is empty (an empty recording, `startS` at or after the end, or `endS` not greater than `startS`), THE function SHALL return `{ width: 0, height: 256, gray: <empty> }` and SHALL NOT throw.
11. THE function SHALL throw `RangeError` when `sampleRate` is not a finite number greater than 0, or when `startS` or `endS` is given and is not a finite number. A negative `startS` is clamped to 0 and SHALL NOT throw.
12. AT 16000 Hz, THE Nyquist frequency is 8000 Hz, which is the top of the image. The bin spacing is 15.625 Hz, so each band holds exactly two bins, and the Nyquist bin (index 512) falls into the top band together with bins 510 and 511. Every band is filled from real bins and none uses the nearest-bin rule.
13. ABOVE 16 kHz, 8000 Hz lies below Nyquist and the part of the spectrum above 8 kHz is not drawn. BELOW 16 kHz (the engine does not accept such rates, but a WAV file can have one), bands above the Nyquist frequency have no bins and SHALL read the floor (black). It SHALL NOT throw for this reason.
14. THE function SHALL NOT change the input array.

### Requirement 2: `encodePng`
**User story:** As a developer, I want a valid PNG from the pixel grid without installing an image library.

#### Acceptance Criteria
1. THE function SHALL have the signature `encodePng(width: number, height: number, gray: Uint8Array): Uint8Array` and live in `node/png.ts`. It MAY import `node:zlib`. It SHALL import nothing else from outside the project.
2. THE output SHALL be, in order: the 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`); an `IHDR` chunk with the width and height as 4-byte big-endian integers, bit depth 8, colour type 0 (grayscale), compression 0, filter method 0, interlace 0; one `IDAT` chunk; an `IEND` chunk with empty data.
3. THE `IDAT` data SHALL be `zlib.deflateSync` of the scan lines. Every scan line SHALL be one filter-type byte of 0 followed by `width` gray bytes, rows in the order of the array (row 0 at the top).
4. EVERY chunk SHALL be: 4-byte big-endian data length, 4-byte type, data, 4-byte big-endian CRC32 over type and data. THE CRC32 SHALL be implemented in the file by hand (polynomial `0xEDB88320`, initial value and final XOR `0xFFFFFFFF`, a lookup table built once), without a library and without `zlib.crc32`.
5. THE file SHALL export `crc32(bytes: Uint8Array): number` (unsigned 32-bit) so that it can be tested. `node/index.ts` SHALL stay as it is unless the public API test of Task 8 already expects `encodePng` there.
6. THE function SHALL throw `RangeError` when `width` or `height` is not an integer of at least 1, or when `gray.length` is not `width × height`. It SHALL NOT change the input array.
7. THE same input SHALL give the same bytes on every run on the same Node version.

### Requirement 3: Tool `spectrogram`
**User story:** As an agent, I want to see a recording as an image, and zoom into a time range, with the same path safety as the other tools.

#### Acceptance Criteria
1. THE tool SHALL be named `spectrogram`, with a short description and the zod input `{ wav: string, startS?: number, endS?: number }`. `wav` is a non-empty string. `startS` and `endS` are finite numbers of at least 0. A missing or wrongly typed argument is answered by the SDK's own validation (Task 10 Requirement 7.4).
2. THE tool SHALL be added as one more definition in the `TOOLS` list of `tools/mcp-ears/tools.ts`. `server.ts`, the registration loop, the error wrapper, `paths.ts`, `errors.ts`, `sounds.ts` and `format.ts` SHALL NOT change in how they work.
3. THE `wav` argument SHALL pass through the path guard (`resolveExisting`) before any file is touched. A path outside the working folder, a link pointing outside, and the sibling-prefix case SHALL be rejected with the guard's message, and no file SHALL be read.
4. THE tool SHALL read the file with `readWavFile`, call `renderSpectrogram(samples, sampleRate, { startS, endS })` and `encodePng(width, height, gray)`, and return exactly one content item: `{ type: 'image', data: <base64 of the PNG>, mimeType: 'image/png' }`. THE result SHALL contain no text item.
5. THE tool SHALL reject a range that gives more than `SPECTROGRAM_TOOL_MAX_RANGE_MS` (new constant in `core/constants.ts`, 60000 ms) of audio, as a tool error that says the range is too long and tells the caller to pass `startS` and `endS`. The width limit follows from the range and the hop, and no pixel count is written as a literal. This keeps the image small enough for an agent.
6. WHEN the range is empty (width 0), THE tool SHALL return a tool error that says the selected range holds no samples, with the recording's duration in seconds (3 decimals) and the `startS` and `endS` as given. It SHALL NOT call `encodePng` with width 0.
7. ERRORS from `readWavFile` (24-bit WAV and others, with the 16-bit PCM message), a missing file (`not found: <path as given>`) and any other failure SHALL come back through the shared error wrapper as in the other tools. No stack trace SHALL be printed.
8. THE tool SHALL write no file.
9. THE segment marker SHALL NOT be implemented (see Introduction).

### Requirement 4: Tests
**User story:** As a maintainer, I want the picture checked by measurement and the PNG checked by its structure.

#### Acceptance Criteria
1. `test/png.test.ts` SHALL check: the first 8 bytes are the PNG signature; the `IHDR` chunk (bytes 8 to 32) has type `IHDR`, data length 13, and the given width and height, with bit depth 8 and colour type 0; the last 12 bytes are the `IEND` chunk, whose CRC bytes are `AE 42 60 82` (the standard CRC of the type `IEND` with no data); `crc32` of the ASCII bytes of `123456789` is `0xCBF43926`; the stored CRC of every chunk equals `crc32` of its type and data; after `zlib.inflateSync` of the `IDAT` data, the scan lines are `1 + width` bytes long, start with filter byte 0 and hold the given pixels; a 1×1 image works; mismatched `gray.length`, width 0 and a non-integer size throw `RangeError`; the input is unchanged.
2. `test/spectrogram.test.ts` SHALL check, by synthetic input from `core/synth.ts` or a plain sine written in the test:
   - a 1 kHz sine at 16000 Hz is brightest in image row `height − 1 − 32` (band 32 holds 1000 Hz to 1031.25 Hz), measured as the row with the largest sum over the interior columns;
   - the same at 44100 Hz and 48000 Hz, with the brightest row within one row of the expected row;
   - the full-scale sine reaches a gray value of at least 250 in its brightest pixel, and a digital-silence input gives gray 0 everywhere;
   - low frequency at the bottom: a 500 Hz sine is brighter in a lower image row than a 4 kHz sine;
   - at 16000 Hz, a 7.9 kHz sine lights the top rows (band 252 and its neighbours), and the output has 256 rows, which covers 0 to 8000 Hz exactly at Nyquist;
   - width: 1 s at 16000 Hz gives 100 columns, and `height` is 256;
   - time range cropping: for a 2 s recording that holds a 1 kHz sine only in the second half, `{ startS: 1, endS: 2 }` gives 100 columns that are bright in the 1 kHz row (interior columns), `{ startS: 0, endS: 1 }` gives 100 columns that are black in that row, and `{ startS: 0.5, endS: 1.5 }` gives 100 columns that are dark on the left half and bright on the right half;
   - the rendering of a range equals the rendering of the same samples cut out by hand (`samples.subarray`) with no range;
   - `endS` past the end is clamped, `startS` negative is clamped to 0;
   - empty and short ranges: an empty recording gives width 0 and an empty array; `startS` after the end gives width 0; `endS <= startS` gives width 0; a range of 3 ms gives width 1 and finite values; a range of 25 ms gives 3 columns;
   - `RangeError` for sample rate 0, NaN, negative, and for `startS = NaN`;
   - the input array is unchanged, and two calls give identical output.
3. `test/mcp.test.ts` SHALL be extended with: the tool list is exactly `listen`, `score`, `spectrogram`, `teach` (this is the one existing expectation that this task changes), each with a description and an input schema; `spectrogram` on a synthetic recording returns exactly one content item of type `image` with `mimeType` `image/png`, no text item, and the base64 data decodes to bytes that start with the PNG signature and whose `IHDR` width equals the expected column count and height is 256; `startS`/`endS` change the width; an empty range, a range longer than `SPECTROGRAM_TOOL_MAX_RANGE_MS` and a missing file are tool errors with the messages above; a 24-bit WAV is a tool error naming 16-bit PCM; a `wav` outside the working folder and the sibling-prefix case are rejected; no file is written (the folder content is the same after the call); the next call works after an error.
4. EVERY test that needs files SHALL use a temporary folder made per test and removed in `afterEach`. Tests SHALL NOT start a child process.
5. THE tests SHALL write times and levels with their unit in the name where they define constants (`..._S`, `..._MS`, `..._HZ`, `..._DBFS`).

### Requirement 5: Constants, layers and privacy
**User story:** As a maintainer, I want the project rules kept.

#### Acceptance Criteria
1. `core/spectrogram.ts` SHALL stay pure TypeScript (layers rule). `node/png.ts` and `tools/mcp-ears/` MAY use Node APIs. `core/index.ts` SHALL export `renderSpectrogram` only if the earlier public API test already expects it, and otherwise SHALL NOT change.
2. EVERY threshold and time constant SHALL be in `core/constants.ts` with its unit in the name. The two new ones are `SPECTROGRAM_CEILING_DBFS` and `SPECTROGRAM_TOOL_MAX_RANGE_MS`. The PNG format values (signature, bit depth 8, colour type 0, gray maximum 255) are format facts and MAY be file-local constants in `node/png.ts` and `core/spectrogram.ts`.
3. NO sample count SHALL be hard-coded. Hop samples come from the sample rate and `SPECTROGRAM_HOP_MS`. Time `t` is a sample count divided by the sample rate, in seconds.
4. NO code of this task SHALL send audio over the network. THE PNG holds magnitudes only (no phase), so the audio cannot be rebuilt from it. It is returned to the local MCP client over standard input and output, as the other tool results are. No recording and no PNG file SHALL be written to disk by this task, and `sounds.json` is not touched.
5. ALL text in code, comments, messages, test names, the devlog line and the commit SHALL be English.
