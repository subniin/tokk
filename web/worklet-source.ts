// The AudioWorklet processor as a string. It copies 128-frame blocks into fixed-size chunks and posts them.
// It computes nothing. The Worker does the computing.

export const WORKLET_PROCESSOR_NAME = 'tokk-capture';

export const WORKLET_SOURCE = `
const RENDER_BLOCK_FRAMES = 128;
class TokkCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.chunkFrames = options.processorOptions.chunkFrames;
    this.buffer = new Float32Array(this.chunkFrames);
    this.filled = 0;
    this.data = null;
    this.paused = false;
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'connect') {
        this.data = msg.port;
        this.filled = 0;
      } else if (msg.type === 'pause') {
        this.paused = true;
        this.filled = 0;
      } else if (msg.type === 'resume') {
        this.paused = false;
        this.filled = 0;
      }
    };
  }
  process(inputs) {
    if (this.data === null || this.paused) return true;
    const input = inputs[0];
    const channel = input && input[0];
    const frames = channel ? channel.length : RENDER_BLOCK_FRAMES;
    let at = 0;
    while (at < frames) {
      const n = Math.min(frames - at, this.chunkFrames - this.filled);
      if (channel) this.buffer.set(channel.subarray(at, at + n), this.filled);
      else this.buffer.fill(0, this.filled, this.filled + n);
      this.filled += n;
      at += n;
      if (this.filled === this.chunkFrames) {
        const samples = this.buffer;
        this.data.postMessage({ type: 'chunk', samples }, [samples.buffer]);
        this.buffer = new Float32Array(this.chunkFrames);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(WORKLET_PROCESSOR_NAME)}, TokkCapture);
`;
