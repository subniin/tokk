// Constants of the landing page script.

// The bars of the waveform in the demo box, as percent of the box height. Two claps are the bars marked in WAVE_HIT_RANGES (first to last index).
export const WAVE_BAR_PERCENTS: readonly number[] = [12, 18, 10, 22, 14, 30, 16, 12, 48, 86, 70, 30, 18, 14, 10, 12, 52, 92, 64, 26, 16, 12, 18, 14, 10, 16, 12, 20, 14, 10, 12, 18, 14, 22, 12, 10];
export const WAVE_HIT_RANGES: readonly (readonly [number, number])[] = [[8, 11], [16, 19]];

// The test-only hook: with this key in the URL query the page listens for this event on window. Its detail is a demo state name.
export const TEST_QUERY_KEY = 'test';
export const TEST_STATE_EVENT = 'tokk-demo-state';

// The live demo box (run B). Times are in ms, and the unit is in the name.
export const MS_PER_SECOND = 1000;
export const DEMO_STORAGE_KEY = 'tokk:site-demo';       // the taught model (feature vectors only) of a returning visitor
export const DEMO_PATTERNS: readonly string[] = ['clap clap', 'clap clap clap'];
export const DEMO_TEACH_EXAMPLES = 5;                    // claps the teach dialog asks for
export const DEMO_ROOM_MS = 10000;                       // the room sound the teach dialog records
export const DEMO_ROOM_QUIET_MS = 1000;                  // the quiet second of the dialog before the room sound, an allowance for the countdown
export const DEMO_HEARD_MAX = 3;                         // entries of the Heard list (the list has a fixed height)
export const DEMO_RECORDING_URL = 'media/clap-demo.wav';
export const DEMO_MODEL_URL = 'media/clap-demo-sounds.json';
export const DEMO_COUNT_TEXT = 'Follow the window that opened.';
export const DEMO_COUNTDOWN_TICK_MS = 250;
