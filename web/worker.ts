// Minimal Worker entry (Task 13). It answers a ping with a pong.
// Task 14 replaces this with the real protocol and removes the ping.

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export function answer(message: unknown): { type: 'pong' } | null {
  if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'ping') {
    return { type: 'pong' };
  }
  return null;
}

const scope = self as unknown as WorkerScope;
scope.addEventListener('message', (event) => {
  const reply = answer(event.data);
  if (reply !== null) scope.postMessage(reply);
});
