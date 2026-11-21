// Constants of the landing page script.

// The bars of the waveform in the demo box, as percent of the box height. Two claps are the bars marked in WAVE_HIT_RANGES (first to last index).
export const WAVE_BAR_PERCENTS: readonly number[] = [12, 18, 10, 22, 14, 30, 16, 12, 48, 86, 70, 30, 18, 14, 10, 12, 52, 92, 64, 26, 16, 12, 18, 14, 10, 16, 12, 20, 14, 10, 12, 18, 14, 22, 12, 10];
export const WAVE_HIT_RANGES: readonly (readonly [number, number])[] = [[8, 11], [16, 19]];

// The test-only hook: with this key in the URL query the page listens for this event on window. Its detail is a demo state name.
export const TEST_QUERY_KEY = 'test';
export const TEST_STATE_EVENT = 'tokk-demo-state';
