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

// Run B (the screen, speech, alarm and wiring).
export const BURST_TIMER_MARGIN_MS = 50;          // the two-pop timer runs this much longer than the burst gap
export const TEACH_EXAMPLES = 10;                 // sounds taught per label on the first run
export const HEARD_SHOW_MS = 700;                 // the "heard" badge of the sound bar stays this long
export const VOICES_WAIT_MS = 1500;               // Chrome loads voices late: wait this long for voiceschanged
export const SPEAK_MAX_MS = 30_000;               // a speech that never reports its end is treated as ended
export const HELP_ARM_MS = 300;                   // a key or click right after help starts does not stop it

// The alarm: two alternating tones, no audio file.
export const ALARM_HIGH_HZ = 880;
export const ALARM_LOW_HZ = 660;
export const ALARM_BEEP_MS = 320;                 // one tone
export const ALARM_PERIOD_MS = 700;               // start to start of two tones
export const ALARM_LEVEL_DB = -6;
export const ALARM_FADE_MS = 15;
export const ALARM_TEST_MS = 2000;                // "Test the alarm" sounds this long
export const DB_AMPLITUDE_DIVISOR = 20;

// The caregiver screen.
export const SCAN_STEP_MS = 100;                  // the scan speed slider moves in steps of this
export const RATE_STEP_FACTOR = 0.1;
export const PREVIEW_PHRASE_COUNT = 3;            // phrases named under a category title
