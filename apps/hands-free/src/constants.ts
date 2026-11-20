// Every number of the Hands-Free app, with its unit in the name. These live here and not in core/constants.ts:
// an app cannot import core/ (npm run check:public-api), so this is the named exception of design.md, "Assumptions" 4.

export const STORAGE_KEY = 'tokk:hands-free';        // the storageKey of listen(): the two apps share one origin on Pages

export const MS_PER_SECOND = 1000;                    // a unit conversion, not a tuning value

export const SCAN_STEP_MS_DEFAULT = 1200;             // time between two moves of the frame
export const SCAN_STEP_MS_MIN = 600;
export const SCAN_STEP_MS_MAX = 3000;
export const SCAN_STEP_MS_INCREMENT = 200;
// At least the largest step (3000) plus the longest wait of a pattern (1000, a rest) plus the lag of the time mapping, with a margin.
export const SCAN_HISTORY_KEEP_MS = 10000;

export const HUM_SCROLL_PX_PER_S_PER_SPEED = 120;     // scroll speed per unit of MatchEvent.speed (speed 6 gives 720 px/s)
export const HUM_UPDATE_DT_MAX_MS = 100;              // the longest dt of one hum step
export const HUM_FIRST_UPDATE_DT_MS = 10;             // dt of the first update of a hum: the pitch tracker updates every 10 ms (design.md, Measured values)
export const RECOGNITION_UPDATE_MS = 150;             // least time between two rewrites of a hum text

export const TEACH_CLICK_EXAMPLES = 10;               // examples of the click step
export const TEACH_HUM_MIN_S = 2;                     // what the texts say: equal to the dialog's WEB_TEACH_HUM_RECORD_MS / 1000
export const TEACH_BACKGROUND_MIN_S = 10;             // equal to WEB_TEACH_BACKGROUND_RECORD_MS / 1000
export const TEACH_STEP_COUNT = 3;                    // a count: click, hum, background

export const FOCUS_OUTLINE_PX = 2;                    // outline widths of the style in index.html
export const SCAN_FRAME_PX = 3;
export const STATE_BANNER_FONT_SCALE = 1.5;           // a ratio to the body font size, no unit

export const HUM_SPEED_DIGITS = 1;                    // decimals of the speed in the "Heard:" line
export const SCAN_STEP_SECONDS_DIGITS = 1;            // decimals of the slider value text
