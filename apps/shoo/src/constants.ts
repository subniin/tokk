// Every number of the rules of Shoo!, with its unit in the name. The start values are tuned by play in run B (design.md).
// The units rule says to keep constants in core/constants.ts, but an app reaches Tokk only through 'tokk' and this task
// does not change core/, so the app keeps its own (the exception of Tasks 21 to 23). Pure: no DOM, no Tokk.

export const MS_PER_SECOND = 1000;

// The path runs from y 0 (top, in the fog) to y 1 (the porch).
export const PATH_START_Y = 0;
export const PATH_END_Y = 1;

export const START_LIVES = 3;
export const WAVE_COUNT_PER_WAVE = [6, 10, 14, 18, 14] as const;               // monsters in wave 1 to 5
export const WAVE_SPEED_PER_S = [0.07, 0.08, 0.09, 0.1, 0.1] as const;         // path fraction per second, wave 1 to 5
export const SPAWN_INTERVAL_FIRST_WAVE_MS = 2200;                              // one spawn every 2.2 s in wave 1
export const SPAWN_INTERVAL_LAST_WAVE_MS = 1400;                               // and every 1.4 s in wave 5
export const WARDEN_SPEED_FACTOR = 0.5;                                        // the Grave Warden walks at half speed

// ---- Run B: the app around the rules. Every time is in ms, a speed in per-second, a level in dB. ----
export const STORAGE_KEY = 'tokk:shoo';                  // the taught model (feature vectors) lives under this key
export const TEACH_EXAMPLES_PER_SOUND = 10;              // the teach dialog asks for 10 sounds (the 10 is part of TEACH_LINE)
export const BACKGROUND_TEACH_MS = 30_000;               // the room sound of the first run
export const BACKGROUND_TEACH_TEST_MS = 10_000;          // the shortest length teach() allows; used with ?speed above 1 only
export const READY_MS = 3000;                            // "Get ready." when every sound of the wave is taught
export const WAVE_LABEL_MS = 1500;                       // "Wave n" before the fight
export const BETWEEN_MS = 4000;                          // "Wave n cleared." on screen
export const MAX_FRAME_MS = 100;                         // the longest step the game clock takes in one frame
export const CAPTION_MS = 2500;                          // "[a candle goes out]" and the "No bats here" note
export const REDUCED_WORD_MS = 600;                      // reduced motion: the word and "+1" stay this long

// The hit effect of shoo.md 3.1: about 1 s in four stages. The times are from the start of the hit.
export const HEARD_GROW_MS = 200;                        // stage 1: the heard label grows and glows
export const ARC_START_MS = 150;                         // stage 2: three arcs leave the porch ...
export const ARC_FLIGHT_MS = 400;                        // ... and need 0.4 s to reach the monster
export const ARC_STAGGER_MS = 50;
export const FLASH_AT_MS = 550;                          // stage 3: flash and the word
export const WORD_MS = 450;
export const EXIT_AT_MS = 650;                           // stage 4: the monster leaves, "+1"
export const EXIT_MS = 350;
export const HIT_EFFECT_MS = 1000;                       // the exit sprite is removed after this
export const MISS_EFFECT_MS = 900;                       // the "?" smoke and the faded arcs

// Sound effects between waves: length in ms, level in dB.
export const EFFECT_LEVEL_DB = -14;
export const EFFECT_CLEARED_MS = 900;
export const EFFECT_LOST_MS = 1400;
export const EFFECT_DAWN_MS = 1800;

// Test-only parameters of the page (design.md "Test-only parameters"): ?speed=, ?wave=, ?lives=.
export const TEST_SPEED_MAX = 16;
export const TEST_LIVES_MAX = 9;
