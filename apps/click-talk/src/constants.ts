// Every number of Click Talk, with its unit in the name.
// The units rule says to keep constants in core/constants.ts, but an app reaches Tokk only through 'tokk' and this task
// does not change core/, so the app keeps its own (the exception of Tasks 21 to 23). Pure: no DOM, no Tokk.

export const MS_PER_SECOND = 1000;

// Settings (click-talk.md section 4 and 5).
export const SETTINGS_STORAGE_KEY = 'click-talk:settings';   // text settings and counts only, never audio
export const MODEL_STORAGE_KEY = 'tokk:click-talk';          // the taught model (feature vectors) lives under this key (run B)
export const DEFAULT_SCAN_MS = 1500;                         // one-sound mode: the frame moves every 1.5 s
export const SCAN_MS_MIN = 500;
export const SCAN_MS_MAX = 5000;
export const DEFAULT_RATE_FACTOR = 1;                        // speaking speed, 1 = the voice's normal speed
export const RATE_FACTOR_MIN = 0.5;
export const RATE_FACTOR_MAX = 2;

// The board.
export const VALID_PHRASE_COUNTS: readonly number[] = [6, 8];   // 3 x 2 or 4 x 2 cells, no empty cell
export const FREQUENT_MAX_PHRASES = 8;                          // the last said, then the most used, 8 in all

// The pattern grammar (core/constants.ts GAP_CONSECUTIVE_MAX_MS and GAP_TOLERANCE_MS, kept equal by a test).
export const BURST_GAP_MAX_MS = 350;       // two sounds start less than this apart: the same burst
export const BURST_TOLERANCE_MS = 1e-6;    // rounding allowance for t = samples / sample rate

// Run B: the app around the rules.
export const BACKGROUND_TEACH_MS = 30_000;               // the room sound of the first run
export const BACKGROUND_TEACH_TEST_MS = 10_000;          // the shortest length teach() allows; used with a test parameter only
export const SPEAK_SHOW_MS = 3000;                       // the chosen phrase stays on screen this long
