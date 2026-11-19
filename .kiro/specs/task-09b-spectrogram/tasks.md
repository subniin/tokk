# Tasks: Task 9b, spectrogram, PNG and the `spectrogram` MCP tool

Order is test-first. Do not write `core/spectrogram.ts`, `node/png.ts` or the tool definition before the tests for them exist and fail. The segment marker is skipped (see `requirements.md`). Do not edit the specs of other tasks.

- [x] 1. Check prerequisites
  - [x] 1.1 Confirm that `core/dsp/fft.ts` (`fft`), `node/files.ts` (`readWavFile`, `writeWavFile`), `core/synth.ts`, `tools/mcp-ears/tools.ts` (`TOOLS`, `defineTool`, the `Content` type with the `image` variant), `tools/mcp-ears/server.ts` and the tests of Tasks 1 to 5, 7, 8, 9a, 10, 11A and 11B pass.
  - [x] 1.2 Confirm that `core/spectrogram.ts`, `node/png.ts` and `test/png.test.ts` do not exist, that `core/constants.ts` has `SPECTROGRAM_FFT_SIZE`, `SPECTROGRAM_HOP_MS`, `SPECTROGRAM_MAX_HZ`, `SPECTROGRAM_HEIGHT_PX`, `SPECTROGRAM_FLOOR_DBFS`, and that the two new constants are absent.
  - [x] 1.3 Read how the registration loop in `server.ts` returns results. Note whether an `image` content item passes through unchanged to the SDK result. Read the public API test of Task 8 and note whether it lists `renderSpectrogram` or `encodePng`, so that `core/index.ts` and `node/index.ts` change only if it does.
  - [x] 1.4 Read `test/helpers/` (the MCP client helper and the synthetic folder builder) and the existing tool-list test in `test/mcp.test.ts`. Note what is reused.

- [x] 2. Constants
  - [x] 2.1 Add `SPECTROGRAM_CEILING_DBFS = 0` and `SPECTROGRAM_TOOL_MAX_RANGE_MS = 60000` to `core/constants.ts`, under "Spectrogram", with a one-line comment each. Change nothing else in the file. (Req 1.6, 3.5, 5.2)

- [x] 3. Write failing tests: PNG
  - [x] 3.1 `test/helpers/png-read.ts`: reads a PNG into `{ signatureOk, chunks (type, data, crcStored, crcOk), ihdr (width, height, bitDepth, colourType, compression, filter, interlace), rows }` using `zlib.inflateSync`. It calls the exported `crc32` for the CRC check.
  - [x] 3.2 `test/png.test.ts` (Req 4.1): signature; `IHDR` type, length 13, width, height, bit depth 8, colour type 0, other fields 0; the last 12 bytes are the `IEND` chunk with CRC bytes `AE 42 60 82`; `crc32` of `123456789` is `0xCBF43926`; every stored CRC equals the computed one; scan lines are `1 + width` bytes, start with filter byte 0 and hold the given pixels (3×2 known values, 1×1, a 256×256 gradient); `RangeError` for width 0, height 0, width 1.5 and `gray.length` off by one; the input array is unchanged; two calls give identical bytes.
  - [x] 3.3 Run the PNG tests. Confirm FAIL (module missing).

- [x] 4. Write failing tests: renderer
  - [x] 4.1 `test/spectrogram.test.ts` (Req 4.2). Local tone builder with unit-named constants. A helper finds the brightest band over the interior columns (skip 5 columns at each edge). Cases:
    - 1 kHz sine at 16000 Hz: brightest band exactly 32 (image row 223);
    - the same at 44100 and 48000 Hz: within one row;
    - full-scale sine: brightest pixel at least 250; digital silence: all 0;
    - 500 Hz is lower in the image than 4 kHz; at 16000 Hz a 7.9 kHz sine lights bands 250 to 255, height is 256;
    - width for 1 s at 16000 Hz is 100;
    - range crop on the 2 s recording (silence, then 1 kHz): `1..2` bright, `0..1` black in the tone row, `0.5..1.5` dark left and bright right with margins around column 50;
    - rendering a range equals rendering the same samples cut with `subarray`; `endS` past the end clamps; negative `startS` clamps to 0;
    - empty recording gives width 0 and an empty array; `startS` after the end, and `endS <= startS`, give width 0; a 3 ms range gives width 1 with finite values; a 25 ms range at 16000 Hz gives 3 columns;
    - `RangeError` for sample rate 0, NaN and negative, and for `startS = NaN`;
    - the input is unchanged; two calls give identical output; no NaN anywhere.
  - [x] 4.2 Run the renderer tests. Confirm FAIL (module missing).

- [x] 5. Write failing tests: MCP
  - [x] 5.1 In `test/mcp.test.ts`, change the tool-list expectation to exactly `listen`, `score`, `spectrogram`, `teach` (sorted), each with a description and an input schema. (Req 4.3) This is the one existing expectation this task changes.
  - [x] 5.2 Add the `spectrogram` cases (Req 4.3): one content item of type `image`, `mimeType` `image/png`, no text item; decoded base64 starts with the PNG signature, `IHDR` width is 150 for a 1.5 s recording at 16000 Hz and height is 256; `startS`/`endS` change the width; empty range, range over `SPECTROGRAM_TOOL_MAX_RANGE_MS` (61 s silent WAV) and missing file are tool errors with the specified messages; 24-bit WAV is a tool error naming 16-bit PCM; `wav` outside the working folder, a junction pointing outside (skipped with a reason if it cannot be created) and the sibling-prefix case are rejected; the folder holds the same files after the call; the next call works after an error.
  - [x] 5.3 Run `test/mcp.test.ts`. Confirm the new cases FAIL and the old ones pass.

- [x] 6. Implement
  - [x] 6.1 `node/png.ts`: `crc32` (table built once, polynomial `0xEDB88320`, unsigned result), chunk writer, `encodePng` with validation, filter byte 0 per row and `zlib.deflateSync`. Run `test/png.test.ts`. Expect PASS. (Req 2)
  - [x] 6.2 `core/spectrogram.ts`: validation, the range helper `spectrogramRange`, hop samples from the sample rate and `SPECTROGRAM_HOP_MS`, Hann table and `windowGain`, band-to-bin map (two bins per band at 16000 Hz, nearest-bin fallback above 16 kHz, floor for bands at or above Nyquist), per-column frame with zero padding, `fft`, maximum per band, level, clamp and gray, rows written bottom-up. Run `test/spectrogram.test.ts`. Expect PASS. (Req 1)
  - [x] 6.3 `tools/mcp-ears/tools.ts`: add the `spectrogram` definition and put it into `TOOLS`. Do not change `server.ts`, `paths.ts`, `errors.ts`, `sounds.ts` or `format.ts`. Run `test/mcp.test.ts`. Expect PASS. If the image item does not pass through the loop (task 1.3), stop and report instead of changing the loop on your own. (Req 3)
  - [x] 6.4 Only if task 1.3 found that the public API test lists them: export `renderSpectrogram` from `core/index.ts` and `encodePng` from `node/index.ts`. Otherwise change neither file.

- [x] 7. Verify by hand
  - [x] 7.1 Render one real PNG from a synthetic or fixture recording into a temporary folder, using the tool through a throw-away call, and open it to check that it is a readable image with low frequencies at the bottom. Delete the temporary file and any throw-away script afterwards. Do not leave a PNG in the repository.
  - [x] 7.2 Run `npm run mcp`, send one `initialize` request line on the standard input, and confirm that one JSON response comes back, nothing else is printed to the standard output, and the tool list now includes `spectrogram`. Stop the process and leave no script or log behind.

- [x] 8. Verify and commit
  - [x] 8.1 Run the full test suite and the TypeScript check. All earlier tests pass, including the public API test of Task 8.
  - [x] 8.2 Check that `core/spectrogram.ts` imports only `core/dsp/fft.ts` and `core/constants.ts`, that no sample count or threshold is a literal number (the 255 gray maximum and PNG format values are file-local named constants), and run `npm run check:public-api`. (Req 5.1 to 5.3)
  - [x] 8.3 Check that no code sends audio over the network, that neither the renderer nor the tool writes a file, that `package.json` and the lock file are unchanged (no new dependency), and that no temporary file, folder, script or log remains in the workspace. (Req 3.8, 5.4)
  - [x] 8.4 Check that only these files changed: `core/spectrogram.ts`, `core/constants.ts`, `node/png.ts`, `tools/mcp-ears/tools.ts`, the four test files and the helper, `docs/devlog.md`, and `core/index.ts` / `node/index.ts` only if task 6.4 applied. No Korean text in tracked files outside `docs/_planning/`. (Req 5.5)
  - [x] 8.5 Add a line to `docs/devlog.md`: spectrogram rendering, PNG encoder and the `spectrogram` MCP tool done; segment marker skipped as not trivial; registration in `.kiro/settings/mcp.json` stays with Task 11B if not done yet.
  - [x] 8.6 Commit with the message `feat: add spectrogram rendering and MCP tool`.
