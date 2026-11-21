// The test-only parameter of the page: ?room=short records the room sound for 10 s (the shortest length teach() allows)
// instead of 30 s, so that the browser test of the first run is not a minute longer. A missing or other value gives 30 s.
// Pure: no DOM.
import { BACKGROUND_TEACH_MS, BACKGROUND_TEACH_TEST_MS } from './constants';

export function backgroundMsFor(query: string): number {
  return new URLSearchParams(query).get('room') === 'short' ? BACKGROUND_TEACH_TEST_MS : BACKGROUND_TEACH_MS;
}
