// openMic: microphone -> AudioWorklet (copies chunks) -> MessageChannel port for the Worker.
// No audio passes through the main thread and nothing is sent over the network.

import { checkSampleRate } from '../core/engine';
import { WEB_CHUNK_MS, WEB_RESUME_TIMEOUT_MS } from './constants';
import { msToSamples } from './protocol';
import { WORKLET_PROCESSOR_NAME, WORKLET_SOURCE } from './worklet-source';

const WORKLET_MIME_TYPE = 'text/javascript';
const GESTURE_HINT = 'The audio context did not start. Please call listen() from a user gesture such as a click.';

// The one place of the microphone constraints (see .kiro/steering/web-audio.md).
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
};

export interface MicHandle {
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode;
  sampleRate: number;
  workerPort: MessagePort;   // send it to the Worker with a `connect` message
  pause(): void;
  resume(): void;
  close(): Promise<void>;
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null ? String((e as { name?: unknown }).name) : '';
}

function micError(e: unknown): Error {
  const name = errorName(e);
  let text: string;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    text = 'The microphone permission was denied. Allow microphone access for this site in the browser\'s site settings, then reload the page.';
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    text = 'No microphone was found. Connect a microphone and check that the browser may use it.';
  } else if (name === 'NotReadableError') {
    text = 'The microphone is in use by another program or cannot be read. Close the other program and try again.';
  } else {
    text = 'The microphone could not be opened. Check the device and the browser settings, then try again.';
  }
  return new Error(text, { cause: e });
}

export async function openMic(given?: MediaStream): Promise<MicHandle> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('The microphone needs HTTPS (or localhost). Serve the page over https:// or open it on localhost.');
  }
  // Created before any await, so it is made inside the click handler.
  const context = new AudioContext();
  let stream: MediaStream | undefined;
  let ownStream = false;
  let url: string | undefined;
  let channel: MessageChannel | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  const cleanup = async (stopTracks: boolean): Promise<void> => {
    if (stopTracks) stream?.getTracks().forEach((t) => t.stop());
    try { source?.disconnect(); } catch { /* already disconnected */ }
    try { node?.disconnect(); } catch { /* already disconnected */ }
    channel?.port2.close();
    if (url !== undefined) URL.revokeObjectURL(url);
    url = undefined;
    try { await context.close(); } catch { /* already closed */ }
  };

  try {
    const sampleRate = context.sampleRate;
    checkSampleRate(sampleRate);
    if (!context.audioWorklet) throw new Error('This browser does not support AudioWorklet, which tokk needs for the microphone.');

    // Inside the gesture. The result is read later.
    const earlyResume: Promise<void> | null = context.state === 'suspended' ? context.resume().catch(() => undefined) : null;

    if (given) {
      stream = given;
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        ownStream = true;
      } catch (e) {
        throw micError(e);
      }
    }

    source = context.createMediaStreamSource(stream);
    url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: WORKLET_MIME_TYPE }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
      url = undefined;
    }
    const chunkFrames = msToSamples(WEB_CHUNK_MS, sampleRate);
    node = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      processorOptions: { chunkFrames },
    });
    channel = new MessageChannel();
    node.port.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
    source.connect(node);

    if (context.state === 'suspended') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, WEB_RESUME_TIMEOUT_MS); });
      await Promise.race([earlyResume ?? context.resume().catch(() => undefined), timeout]);
      clearTimeout(timer);
    }
    if ((context.state as AudioContextState) !== 'running') throw new Error(GESTURE_HINT);

    const handle = { stream, context, node, channel, source };
    let closed = false;
    return {
      stream: handle.stream,
      context,
      node,
      sampleRate,
      workerPort: channel.port2,
      pause: () => node?.port.postMessage({ type: 'pause' }),
      resume: () => node?.port.postMessage({ type: 'resume' }),
      async close() {
        if (closed) return;
        closed = true;
        await cleanup(true);   // also stops a stream passed in: a microphone light that stays on looks like a leak
      },
    };
  } catch (e) {
    await cleanup(ownStream);
    throw e;
  }
}
