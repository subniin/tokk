// The error that listen({ onError }) reports. No DOM type: it is built from a kind and a text.

export type TokkErrorKind = 'mic-ended' | 'worker' | 'audio-closed';

// An Error with the kind of failure. `message` says how to fix it.
export interface TokkError extends Error {
  kind: TokkErrorKind;
}

export const KEYS_TEACH_MESSAGE = 'No microphone in keys mode. Teach sounds with the microphone, then use keys as a fallback.';

export function makeTokkError(kind: TokkErrorKind, detail?: string, cause?: unknown): TokkError {
  let text: string;
  if (kind === 'mic-ended') {
    text = 'The microphone stopped: it was unplugged, or another program took it. Reconnect the microphone, then call listen() again.';
  } else if (kind === 'worker') {
    text = `The sound engine failed${detail ? ` (${detail})` : ''}. Call listen() again. If it fails again, reload the page.`;
  } else {
    text = 'The audio context was closed by the browser. Call listen() again from a click or a key press.';
  }
  const error = new Error(text, cause === undefined ? undefined : { cause }) as TokkError;
  error.name = 'TokkError';
  error.kind = kind;
  return error;
}
