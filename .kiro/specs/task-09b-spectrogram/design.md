# Design: Task 9b, spectrogram, PNG and the `spectrogram` MCP tool

## Layer rule
- `core/spectrogram.ts` is pure TypeScript. It imports `core/dsp/fft.ts` and `core/constants.ts` and nothing else. It works on a `Float32Array` and returns a `Uint8Array`.
- `node/png.ts` is Node code. It imports `node:zlib` only.
- `tools/mcp-ears/tools.ts` gets one more definition. It imports `renderSpectrogram`, `encodePng`, `readWavFile` and constants by relative path, as the other definitions do.

No threshold or time constant is written in these files. Two new constants go into `core/constants.ts` under "Spectrogram":
```
SPECTROGRAM_CEILING_DBFS = 0
SPECTROGRAM_TOOL_MAX_RANGE_MS = 60000
```
The existing ones are used as they are: `SPECTROGRAM_FFT_SIZE` (1024), `SPECTROGRAM_HOP_MS` (10), `SPECTROGRAM_MAX_HZ` (8000), `SPECTROGRAM_HEIGHT_PX` (256), `SPECTROGRAM_FLOOR_DBFS` (-90).

## Files
```
core/spectrogram.ts              renderSpectrogram
core/constants.ts                + SPECTROGRAM_CEILING_DBFS, SPECTROGRAM_TOOL_MAX_RANGE_MS
node/png.ts                      encodePng, crc32
tools/mcp-ears/tools.ts          + one definition `spectrogram`, TOOLS list gets it
test/spectrogram.test.ts         renderer tests
test/png.test.ts                 PNG tests
test/helpers/png-read.ts         reads a PNG for tests: chunks, IHDR, inflated scan lines
test/mcp.test.ts                 tool list expectation, spectrogram cases
docs/devlog.md                   one line
.kiro/specs/task-09b-spectrogram/
```
The plan names `test/spectrogram.test.ts` for the renderer and the PNG. The PNG tests get their own file `test/png.test.ts`, because they have a different subject and a helper. `core/index.ts` and `node/index.ts` change only if the public API test of Task 8 already lists the names.

## `renderSpectrogram`

### Setup
```
hopSamples   = round(sampleRate * SPECTROGRAM_HOP_MS / 1000)       (at least 1)
frameSamples = SPECTROGRAM_FFT_SIZE
bandHz       = SPECTROGRAM_MAX_HZ / SPECTROGRAM_HEIGHT_PX          (31.25)
binHz        = sampleRate / frameSamples
window[n]    = Hann, length frameSamples (periodic form)
windowGain   = sum(window) / 2          (a full-scale sine gives a peak magnitude of 1)
```
The Hann table, the `windowGain` and the band-to-bin map are computed once per call, not per column.

At 48000 Hz the hop is 480 samples and at 44100 Hz it is 441. At 22050 Hz it is 221 (rounded from 220.5), so one pixel is 10.02 ms there. That rounding error is accepted, and the column time is always computed from the sample count, never from the pixel index times 10 ms.

### Range
```
startSample = clamp(round(startS * sampleRate), 0, N)      startS default 0
endSample   = clamp(round(endS   * sampleRate), 0, N)      endS default N / sampleRate
n           = endSample - startSample                      (empty when n <= 0)
width       = n <= 0 ? 0 : ceil(n / hopSamples)
```
`N` is `samples.length`. `endS` default means "the end of the array", so a recording is never cut by float rounding. The range is read as `samples.subarray(startSample, endSample)`, a view without copying. The view is never written to.

Validation first: `sampleRate` finite and greater than 0, else `RangeError("sampleRate must be a finite number greater than 0, got ...")`. `startS` and `endS`, when given, must be finite, else `RangeError`. Negative `startS` is clamped. When `n <= 0` the function returns `{ width: 0, height, gray: new Uint8Array(0) }` right after validation.

### Columns
For column `i` in `0 .. width-1`:
```
centre    = i * hopSamples                 (sample count from the start of the range)
t_i       = centre / sampleRate            (seconds from the range start, only used for documentation and tests)
first     = centre - frameSamples / 2      (may be negative)
re[n]     = sample(first + n) * window[n]  for n in 0 .. frameSamples-1, zero when first + n is outside 0 .. n_range-1
im[n]     = 0
fft(re, im)
mag[k]    = sqrt(re[k]^2 + im[k]^2) / windowGain     for k in 0 .. frameSamples/2
```
`re` and `im` are two `Float64Array` of length 1024, reused for all columns and cleared to the sample values each time. `frameSamples / 2` is the Nyquist bin.

Frames are centred on the column centre, so the first column of a range sees half a frame of zeros. A short range is therefore zero-padded without a special case, and a 3 ms range gives one column. Cropping zeroes everything outside the range (the range is cut first), which makes `render(samples, sr, {startS, endS})` equal to `render(samples.subarray(...), sr)`. The cost is that the edge columns of a range are dimmer than the same moment in an uncropped render, by at most the half frame (about 32 ms at 16 kHz, 21 ms at 48 kHz, 2 to 4 columns). Tests look at interior columns.

### Band map
For each band `r` (0 at the bottom), the bin list is built once:
```
lo = r * bandHz,  hi = (r + 1) * bandHz
bins = all k in 0 .. frameSamples/2 with lo <= k*binHz < hi        (top band: also k*binHz == SPECTROGRAM_MAX_HZ)
if bins is empty:  bins = [ nearest k to (lo + hi) / 2 ], limited to 0 .. frameSamples/2
```
Bins with frequency above the Nyquist limit do not exist, so for a sample rate below 16 kHz the bands above Nyquist would have an empty list and fall back to the nearest bin, which would show Nyquist energy in a band it does not belong to. The rule is therefore: **when `lo >= sampleRate / 2` the band has no bins at all and reads the floor.** This makes the image honest for 8000 Hz or 11025 Hz files, which the engine rejects but `readWavFile` accepts.

Comparison of the bin frequency with the band edge uses integer arithmetic where possible (`k * sampleRate` against `lo * frameSamples`), so that 16000 Hz hits the edges exactly. With the float form, `k * binHz` for `binHz = 15.625` is exact in binary, so it also works, but the integer form is not affected by other rates.

#### Behaviour at 16 kHz (Nyquist is 8 kHz)
`binHz = 15.625`, `bandHz = 31.25`, so every band holds exactly two bins: band `r` holds bins `2r` and `2r+1`. The top band 255 holds bins 510 and 511, and bin 512 (Nyquist, exactly 8000 Hz) is added by the "also 8000 Hz" rule. The whole image is therefore made of real bins and the nearest-bin fallback never runs. 1 kHz is bin 64 and falls into band 32 (1000 to 1031.25 Hz), image row 223. Nothing above 8 kHz exists, so nothing is cut off.

At 44100 and 48000 Hz the bins are 43.07 and 46.875 Hz apart, wider than a band, so some bands have no bin of their own and use the nearest bin. The picture then shows steps of 1 to 2 rows for a pure tone, and the test allows one row of error for these rates.

### Level and gray
```
level = 20 * log10(max(maxMag, tiny))        tiny = 10^(SPECTROGRAM_FLOOR_DBFS / 20)
level = clamp(level, SPECTROGRAM_FLOOR_DBFS, SPECTROGRAM_CEILING_DBFS)
gray  = round((level - SPECTROGRAM_FLOOR_DBFS) / (SPECTROGRAM_CEILING_DBFS - SPECTROGRAM_FLOOR_DBFS) * 255)
```
The maximum over the band's bins is taken before the log. A band with no bins reads the floor, gray 0. The value 255 is the 8-bit gray maximum and is a file-local constant.

A full-scale sine at an exact bin centre gives a Hann peak of 1 (0 dB, gray 255). A tone between two bins gives up to 1.4 dB less, and at most gray 250 or so, so the tests use "at least 250".

### Output
Rows are written top-down: band `r` goes to image row `height - 1 - r`. `gray` has `width * height` entries, written column by column into row-major positions (`y * width + x`).

### Cost
`width` FFTs of 1024 points. One minute of audio is 6000 columns, which is about 6000 × 1024 × 10 butterfly steps and runs well under a second in Node. The tool limit (below) keeps the image to 60 s.

## `encodePng`
```
validate width, height integers >= 1; gray.length == width * height, else RangeError
raw = Uint8Array(height * (1 + width)); for each row y: raw[y*(1+width)] = 0; copy gray row after it
idat = zlib.deflateSync(raw)
out = signature + chunk('IHDR', ihdr) + chunk('IDAT', idat) + chunk('IEND', empty)
```
- `ihdr` is 13 bytes: width (4, big-endian), height (4), bit depth 8, colour type 0, compression 0, filter method 0, interlace 0. Width and height go through `DataView.setUint32(…, false)`.
- `chunk(type, data)` writes the 4-byte length, the 4 ASCII type bytes, the data, and `crc32(type bytes + data)` as 4 big-endian bytes. The CRC is computed over one temporary concatenation of type and data, or over the two parts in sequence (the function takes an optional start value internally so that no copy is needed). Either is fine for the sizes here.
- `crc32`: a 256-entry table built once at module load from the polynomial `0xEDB88320` (for each `n`, 8 rounds of: shift right, and XOR the polynomial when the low bit was set). The running value starts at `0xFFFFFFFF`, is updated per byte as `table[(c ^ byte) & 0xFF] ^ (c >>> 8)`, and the result is `(c ^ 0xFFFFFFFF) >>> 0`. The `>>> 0` keeps it an unsigned 32-bit number, which matters for the comparison with `0xCBF43926` and for `setUint32`.
- A single `IDAT` chunk holds the whole stream. PNG allows any size per chunk up to 2^31 - 1, and the tool's image is small (6000 × 256 = 1.5 MB raw, much less compressed).
- No `zlib.crc32` (it exists only in newer Node versions, and the requirement is a hand-made CRC).

Known-answer values used in tests:
- `crc32("123456789")` is `0xCBF43926`, the standard check value for this CRC.
- The `IEND` chunk of every PNG is `00 00 00 00 49 45 4E 44 AE 42 60 82`. The CRC `AE426082` is the CRC32 of the four bytes `IEND`. This is the "known chunk" test, and it also holds for the output of `encodePng`.

`test/helpers/png-read.ts` returns `{ signatureOk, chunks: [{ type, data, crcStored, crcOk }], ihdr, rows }`. It uses `zlib.inflateSync` and its own CRC check, which calls the exported `crc32` for the "stored CRC equals computed" test. The independent known answers above guard against the table being wrong in both places.

## MCP tool `spectrogram`
The definition follows the shape of `teach`, `listen` and `score`: `defineTool({ name, description, inputSchema, run })`. The `run` function:
```
wavPath = guard.resolveExisting('wav', wav)
audio   = withArg(wav, () => readWavFile(wavPath))                   (same helper as listen)
range   = clamp as renderSpectrogram will, to find the length that will be drawn
too long?  -> ToolError("range is longer than <limit> s; pass startS and endS")
image   = renderSpectrogram(audio.samples, audio.sampleRate, { startS, endS })
image.width === 0 ? -> ToolError("no samples in the selected range: recording is <d> s long, startS <as given>, endS <as given>")
png     = encodePng(image.width, image.height, image.gray)
return [{ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }]
```
- Input schema: `wav: z.string().min(1)`, `startS: z.number().finite().min(0).optional()`, `endS: z.number().finite().min(0).optional()`. The descriptions say that times are seconds, the time axis is 10 ms per pixel, the vertical axis is 0 to 8 kHz with low at the bottom, and brightness is level from -90 to 0 dB.
- The "too long" check runs before the render, using the range length in samples: `(endSample - startSample) / sampleRate × 1000 > SPECTROGRAM_TOOL_MAX_RANGE_MS`. To avoid two copies of the clamp rule, the range-to-samples step is a small exported helper in `core/spectrogram.ts` (`spectrogramRange(length, sampleRate, startS, endS)` returning `{ startSample, endSample }`) that `renderSpectrogram` uses too. If the helper turns out to need more than a few lines in the tool, the tool simply renders and checks `width × hop` afterwards, at the cost of rendering an image that is then rejected. The helper form is preferred.
- Exactly one item is returned. There is no text item next to the image, so the client has one thing to show.
- The tool does not touch `format.ts`, `errors.ts`, `paths.ts`, `sounds.ts` or `server.ts`. A `ToolError` is the same class the other tools throw.
- The `Content` type of `tools.ts` already has the `image` variant (Task 10 Requirement 2.3), so no type change is needed. The registration loop passes image items through to the SDK result unchanged. Task 1 of `tasks.md` checks this before the tool is written, because it is the one assumption of Task 10's design that no test has exercised yet.

### Order in the list
`TOOLS` is `[teach, listen, score, spectrogram]`. The tool-list test compares the sorted names, so the order in the list does not matter.

### Segment marker: skipped
A marker would add a `sounds` argument, run `createEngine`, convert segment times to columns (`t × sampleRate / hopSamples`) and paint pixels or a strip into `gray`. It touches the renderer's contract (the image is then no longer a pure function of the audio) and needs a second set of tests. It is not trivial, so it is not part of this task. If wanted later, it is a separate tool or an optional `sounds` argument with its own spec.

## Tests

### `test/png.test.ts`
Cases as in Requirement 4.1, over a small image (for example 3×2 with known pixel values), a 1×1 image, and a larger one (256×256 gradient, which also exercises a multi-block deflate stream). Error cases: width 0, height 0, width 1.5, `gray.length` off by one.

### `test/spectrogram.test.ts`
A local helper `sine(freqHz, sampleRate, durationS, amplitude)` in the test builds a tone. The tone builder takes time as `n / sampleRate`. The constants in the test have unit suffixes (`TONE_HZ`, `DURATION_S`, `SAMPLE_RATE_HZ`). The "brightest row" helper sums gray over the interior columns of each row (skipping the first and last 5 columns, which covers the half frame at every tested rate) and returns the row with the largest sum, converted to a band number with `height - 1 - y`.

For the crop test, the 2 s recording is zeros for the first second and a 1 kHz sine for the second. The expected results are:
- `{ startS: 1, endS: 2 }`: 100 columns, the 1 kHz band is bright (at least 200) in the interior columns.
- `{ startS: 0, endS: 1 }`: 100 columns, the 1 kHz band is 0 in all columns.
- `{ startS: 0.5, endS: 1.5 }`: 100 columns; the 1 kHz band is 0 in columns 0 to 44 and bright in columns 55 to 94 (the transition at column 50 is blurred by the frame width, which is why the checks leave a margin).

Empty and short ranges use the cases of Requirement 4.2. The 25 ms case at 16000 Hz is 400 samples, 160 per hop, so `ceil(400 / 160) = 3` columns.

### `test/mcp.test.ts`
New cases use the helpers of Task 10 (`connect(root)`, the synthetic folder builder). A decoded result is checked with `png-read.ts`: the base64 string is decoded with `Buffer.from(data, 'base64')`, then the signature and `IHDR` are read. The width expected for a 1.5 s recording at 16000 Hz is `ceil(24000 / 160) = 150`. The "too long" case writes a 61 s silent WAV in the temporary folder (16000 Hz, 16-bit, about 2 MB) and asks for it without a range. The link and sibling-prefix cases reuse the helpers of the Task 10 path tests with `wav` as the argument.

## Risks and rules
- **Image or content type not passed through.** Task 10's loop was written for `image` items but no test used one. The first test of the tool checks the actual SDK result. If the SDK result type rejects the item shape, the fix is in the loop's single cast and is reported, not worked around in the tool.
- **Large images in the agent's context.** A 60 s limit gives at most 6000 × 256 pixels, and a typical gray spectrogram compresses to well under 1 MB. The limit is a guard, not a tuned value. It sits in `core/constants.ts`, so it can change after use.
- **Edge dimming of a cropped image** is described above and accepted. It is the price of an image that depends only on the selected samples.
- **Rounded hop at some rates.** At 22050 Hz the hop is 221 samples and a pixel lasts 10.02 ms. The error is accepted and noted in the tool description only as "about 10 ms per pixel".
- **Hann form.** The periodic Hann is used. The symmetric form changes levels by well under 0.1 dB and no test depends on it.
- **No dependency.** `zlib` is part of Node, and nothing is added to `package.json`.
- **Task 11B** registers the server in `.kiro/settings/mcp.json`. This task changes no Kiro settings.
