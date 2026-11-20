// Constants of the browser layer. Every value has its unit in the name.

export const WEB_CHUNK_MS = 20;                 // length of one chunk of samples sent to the Worker
export const WEB_RESUME_TIMEOUT_MS = 500;       // how long openMic waits for AudioContext.resume()
export const WEB_ENVELOPE_RESOLUTION_MS = 10;   // length of one envelope bin

// Debug overlay (Task 15).
export const WEB_OVERLAY_WINDOW_MS = 5000;                // length of the rolling waveform
export const WEB_OVERLAY_MAX_ROWS = 20;                   // a count of rows, not a time
export const WEB_OVERLAY_REDRAW_REDUCED_MOTION_MS = 1000; // longest time between two redraws with reduced motion
export const WEB_OVERLAY_WIDTH_PX = 360;
export const WEB_OVERLAY_WAVEFORM_HEIGHT_PX = 80;
export const WEB_OVERLAY_Z_INDEX = 2147483647;            // largest 32-bit signed integer, no unit
export const WEB_OVERLAY_TIME_DECIMALS = 2;               // decimals of a time in s
export const WEB_OVERLAY_CONFIDENCE_DECIMALS = 2;
export const WEB_OVERLAY_DISTANCE_DECIMALS = 3;
export const WEB_OVERLAY_MARGIN_PX = 12;                  // distance from the viewport corner
export const WEB_OVERLAY_ROWS_MAX_HEIGHT_PX = 168;        // the row list scrolls above this height
export const WEB_OVERLAY_FONT_SIZE_PX = 12;
export const WEB_OVERLAY_MARK_MIN_WIDTH_PX = 2;           // a mark is never narrower than this
export const WEB_OVERLAY_LOW_RATE_HZ = 16000;                 // input rate at which the high-frequency features are empty

// Teach dialog (Task 16).
export const WEB_TEACH_THUMBNAIL_BINS = 48;                    // a count of bins per segment thumbnail
export const WEB_TEACH_HUM_RECORD_MS = 2000;                   // shortest hum recording
export const WEB_TEACH_BACKGROUND_RECORD_MS = 10000;           // shortest background recording
export const WEB_TEACH_MAX_RECORDING_MS = 120000;              // the recorder stops collecting here
export const WEB_TEACH_PROGRESS_REDUCED_MOTION_MS = 1000;      // longest time between two progress updates with reduced motion
export const WEB_TEACH_THUMBNAIL_WIDTH_PX = 120;
export const WEB_TEACH_THUMBNAIL_HEIGHT_PX = 32;
export const WEB_TEACH_FILE_NAME = 'teach.wav';                // file part of the ids of in-app examples
export const WEB_TEACH_Z_INDEX = 2147483647;                   // largest 32-bit signed integer, no unit
export const WEB_TEACH_FONT_SIZE_PX = 16;
export const WEB_TEACH_WIDTH_PX = 480;
export const WEB_TEACH_TIME_DECIMALS = 2;                      // decimals of a time in s
export const WEB_TEACH_FOCUS_OUTLINE_PX = 2;
export const WEB_STORAGE_KEY_DEFAULT = 'tokk:sounds';
export const WEB_STORAGE_VERSION = 1;                          // version of the stored entry, no unit

// Developer teach page (Task 17).
export const WEB_TEACH_PAGE_CLIP_MARGIN_MS = 100;              // quiet kept before and after a segment in its clip
export const WEB_TEACH_PAGE_NUMBER_DIGITS = 2;                 // a count of digits, no unit
export const WEB_TEACH_PAGE_SOUNDS_DIR = 'sounds';             // child of the project folder that holds the label folders
export const WEB_TEACH_PAGE_MODEL_FILE = 'sounds.json';        // child of the project folder
export const WEB_TEACH_PAGE_PICKER_ID = 'tokk-teach-page';     // lets the browser remember the last folder
export const WEB_TEACH_PAGE_TEST_STORAGE_KEY = 'tokk:teach-page';
