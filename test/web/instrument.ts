import type { Page } from '@playwright/test';

// Records what the page does with the browser's audio objects, so a spec can read the real sample rate, the state
// of the context and the tracks, and the Worker.terminate calls. The wrappers call the originals and change no
// behavior. No production code exposes any of this.

export interface Instrumentation {
  contexts: { sampleRate: number; state: string }[];
  tracks: { readyState: string }[];
  terminateCalls: number;
  animationFrames: number;
}

// Runs inside the page before any page script.
function installInstrumentation(options: InstrumentOptions): void {
  const record = { contexts: [] as AudioContext[], streams: [] as MediaStream[], terminateCalls: 0, animationFrames: 0 };
  (window as unknown as { __tokkInstr: typeof record }).__tokkInstr = record;

  const OriginalContext = window.AudioContext;
  window.AudioContext = class extends OriginalContext {
    constructor(contextOptions?: AudioContextOptions) {
      super(contextOptions);
      record.contexts.push(this);
      if (options.suspendWithoutGesture && !navigator.userActivation.isActive) {
        // Chrome 157 with --autoplay-policy=user-gesture-required still starts a context without a gesture (measured, see
        // design.md). This makes the context behave as Safari does: suspended, and resume() stays pending.
        Object.defineProperty(this, 'state', { get: () => 'suspended' });
        this.resume = () => new Promise<void>(() => {});
      }
    }
  };

  const devices = navigator.mediaDevices;
  if (devices) {
    const originalGetUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await originalGetUserMedia(constraints);
      record.streams.push(stream);
      return stream;
    };
  }

  if (options.countAnimationFrames) {
    const originalFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      // Playwright's own waiting also calls requestAnimationFrame in the page, so only calls from the bundle count.
      if (new Error().stack?.includes('/dist/tokk.js')) record.animationFrames++;
      return originalFrame(callback);
    };
  }

  const originalTerminate = Worker.prototype.terminate;
  Worker.prototype.terminate = function terminate(this: Worker) {
    record.terminateCalls++;
    return originalTerminate.call(this);
  };
}

export interface InstrumentOptions {
  suspendWithoutGesture?: boolean;
  countAnimationFrames?: boolean;   // counts calls of requestAnimationFrame made by dist/tokk.js, then calls the original
}

export async function instrument(page: Page, options: InstrumentOptions = {}): Promise<void> {
  await page.addInitScript(installInstrumentation, options);
}

export async function readInstrumentation(page: Page): Promise<Instrumentation> {
  return page.evaluate(() => {
    const r = (window as unknown as { __tokkInstr: { contexts: AudioContext[]; streams: MediaStream[]; terminateCalls: number; animationFrames: number } }).__tokkInstr;
    return {
      contexts: r.contexts.map((c) => ({ sampleRate: c.sampleRate, state: c.state })),
      tracks: r.streams.flatMap((s) => s.getTracks().map((t) => ({ readyState: t.readyState }))),
      terminateCalls: r.terminateCalls,
      animationFrames: r.animationFrames,
    };
  });
}
