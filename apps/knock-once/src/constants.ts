// Every number of the app with its unit in the name, the storage key and the colours that the tests check.
// The units rule says to keep constants in core/constants.ts, but an app reaches Tokk only through 'tokk', so the app
// keeps its own (the exception of Task 21 and Task 22, design.md "Assumptions" item 4). Pure: no DOM, no Tokk.

// The localStorage key of the taught model. Both apps share one origin on Pages, so each has its own key.
export const STORAGE_KEY = 'tokk:knock-once';
export const KNOCK_LABEL = 'knock';
export const TEACH_KNOCK_EXAMPLES = 10;          // a count: the library default

// Sound effects.
export const EFFECT_SUMMON_MS = 1800;
export const EFFECT_BETWEEN_MS = 900;
export const EFFECT_ENDING_MS = 2400;
export const EFFECT_TAIL_MS = 200;               // the room's decay before the microphone reopens
export const EFFECT_TOTAL_MAX_MS = 3000;         // the longest effect plus the tail
export const EFFECT_PEAK_DBFS = -14;             // the largest sum of the voice peaks of one effect
export const EFFECT_FADE_IN_MS = 60;
export const EFFECT_FADE_OUT_MS = 200;
export const TRANSITION_HOLD_MS = 900;           // the hold of a transition when the effects are muted

// The ectoplasm.
export const ECTO_HISTORY_MS = 4000;             // how long the envelope levels are kept
export const ECTO_LEVEL_WINDOW_MS = 300;         // the window of data-level
export const ECTO_IDLE_MS = 1500;                // no envelope for this long: the ribbon settles
export const ECTO_SETTLE_MS = 1000;              // the time the ribbon takes to settle after ECTO_IDLE_MS
export const ECTO_IDLE_LEVEL = 0.04;             // a fraction of full scale: the calm height of a settled ribbon
export const ECTO_LEVEL_GAIN = 4;                // a factor: a knock at -12 dBFS (0.25) fills the ribbon
export const ECTO_DRIFT_PERIOD_MS = 9000;        // one slow drift of the ribbon
export const ECTO_POINT_SPACING_PX = 8;          // the distance of two ribbon points
export const ECTO_RIBBON_HEIGHT_FRACTION = 0.45; // the largest swing of a ribbon, as a fraction of the canvas height
export const ECTO_CANVAS_MAX_WIDTH_PX = 960;
export const ECTO_CANVAS_HEIGHT_PX = 180;
export const ECTO_RESIZE_DEBOUNCE_MS = 1000;     // the least time between two still redraws
export const ECTO_LAYER_COUNT = 3;               // a count of ribbon layers
export const ECTO_STROKE_PX = 2;
export const ECTO_GLOW_PX = 8;

// Captions and the story.
export const CAPTION_KEEP = 60;                  // a count of caption lines
export const STORY_QUESTION_MIN = 7;
export const STORY_QUESTION_MAX = 10;
export const STORY_ENDING_COUNT = 3;
export const STORY_PATH_MIN_QUESTIONS = 3;
export const STORY_QUESTION_MAX_CHARS = 140;

// The look. The page colours are written again in the style block of index.html; U9 checks that both agree.
export const FOCUS_OUTLINE_PX = 2;
export const COLOR_ROOM = '#0d0907';
export const COLOR_TEXT = '#f3e3c3';
export const COLOR_CANDLE = '#f2c46b';
export const COLOR_ECTO = '#9fe8c8';
export const COLOR_BUTTON_BG = '#2a1c14';
export const COLOR_BUTTON_BORDER = '#e0a243';
export const COLOR_FOCUS = '#ffd98a';

// The theme of the teach dialog (the five --tokk-* properties).
export const THEME_BG = '#17100c';
export const THEME_FG = '#f3e3c3';
export const THEME_ACCENT = '#e0a243';
export const THEME_FONT = 'Georgia, "Times New Roman", serif';
export const THEME_RADIUS_PX = 2;
