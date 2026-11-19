---
inclusion: fileMatch
fileMatchPattern: ["web/**/*", "teach.html"]
---

# Web audio rules

- Open the microphone with `getUserMedia` and set `echoCancellation`, `noiseSuppression` and `autoGainControl` to `false`, on every page that records or listens.
- Call `AudioContext.resume()` after a user gesture.
- Serve the page over HTTPS. A microphone does not work on plain HTTP outside `localhost`.
- Accept sample rates from 16000 to 96000 Hz. Reject others with an error.
- Make the AudioWorklet only pass sample chunks to its `port`. Do the computing (FFT, YIN, kNN) in a Web Worker.
- Load the worklet from a Blob URL built from a string.
- Warn in the debug overlay when the sample rate differs from the rate of the taught sounds.
