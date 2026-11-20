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
