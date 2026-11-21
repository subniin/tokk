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
