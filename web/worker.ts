// Worker entry. It holds no logic of its own: every message goes through handleWorkerMessage.

import { createWorkerState, handleWorkerMessage, transferListOf } from './protocol';
import type { MessagePortLike } from './protocol';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: unknown[]): void;
}

const scope = self as unknown as WorkerScope;
const state = createWorkerState();

function onMessage(event: { data: unknown }): void {
  const data = event.data as { type?: unknown; port?: MessagePortLike } | null;
  if (typeof data === 'object' && data !== null && data.type === 'connect' && data.port) {
    data.port.onmessage = onMessage;
  }
  for (const out of handleWorkerMessage(state, event.data)) scope.postMessage(out, transferListOf(out));
}

scope.addEventListener('message', onMessage);
