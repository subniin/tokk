// Tuning values for the engine. Only this file changes after experiments.
// Names include their unit (_MS, _HZ, _DB, _DBFS, _SEMITONES) where the value has one.

// Engine
export const SAMPLE_RATE_MIN_HZ = 16000;
export const SAMPLE_RATE_MAX_HZ = 96000;

// Segmenter
export const SEGMENT_HOP_MS = 5;
export const LEVEL_WINDOW_MS = 10;
export const SILENCE_LEVEL_DBFS = -90;
export const NOISE_FLOOR_INITIAL_DBFS = -70;
export const NOISE_FLOOR_MIN_DBFS = -90;
export const NOISE_FLOOR_RISE_TIME_CONSTANT_MS = 1000;
export const ONSET_ABOVE_FLOOR_DB = 12;
export const ONSET_MIN_LEVEL_DBFS = -60;
export const ONSET_RISE_DB = 6;
export const ONSET_MIN_GAP_MS = 80;
export const ONSET_LEAD_MS = 5;
export const REONSET_MIN_SEGMENT_AGE_MS = 80;
export const OFFSET_ABOVE_FLOOR_DB = 6;
export const OFFSET_HOLD_MS = 30;
export const SEGMENT_MAX_MS = 1500;

// Features
export const FEATURE_LENGTH = 32;
export const FEATURE_FRAME_MIN_MS = 20;
export const FEATURE_HOP_MS = 10;
export const MEL_FILTER_COUNT = 26;
export const MEL_MIN_HZ = 100;
export const MEL_MAX_HZ = 8000;
export const MEL_MAX_NYQUIST_FRACTION = 0.45;
export const MFCC_COUNT = 13;
export const DECAY_DROP_DB = 20;
export const BAND_EDGES_HZ = [500, 2000, 5000];

// Classifier
export const KNN_K = 3;
export const DISTANCE_THRESHOLD_FACTOR = 1.5;
export const THRESHOLD_PERCENTILE = 95;
export const MIN_EXAMPLES_PER_LABEL = 5;
export const RECOMMENDED_EXAMPLES_PER_LABEL = 10;
export const STD_FLOOR_RANGE_FRACTION = 0.05;
export const STD_FLOOR_ABSOLUTE = 0.01;

// Teaching
export const BACKGROUND_WINDOW_MS = 300;
export const BACKGROUND_WINDOW_OVERLAP_PERCENT = 50;
export const BACKGROUND_MAX_EXAMPLES = 200;

// Pitch
export const PITCH_ANALYSIS_RATE_HZ = 8000;
export const PITCH_LOWPASS_HZ = 3400;
export const YIN_WINDOW_MS = 40;
export const PITCH_HOP_MS = 10;
export const YIN_THRESHOLD = 0.15;
export const PITCH_MIN_HZ = 80;
export const PITCH_MAX_HZ = 400;
export const PITCH_HIGH_BAND_MIN_HZ = 1000;
export const PITCH_HIGH_ENERGY_RATIO_MAX = 0.2;
export const PITCH_MIN_LEVEL_DBFS = -50;
export const HUM_START_VOICED_MS = 120;
export const HUM_END_UNVOICED_MS = 60;

// Grammar
export const GAP_CONSECUTIVE_MAX_MS = 350;   // exclusive
export const GAP_REST_MAX_MS = 1000;         // inclusive
export const HUM_DEADZONE_SEMITONES = 2;
export const HUM_SPEED_MAX_SEMITONES = 6;

// Synthesis
export const SYNTH_FADE_OUT_MS = 10;
export const SYNTH_MAX_DURATION_MS = 400;
export const SYNTH_BANDWIDTH_FRACTION = 0.5;
export const SYNTH_DURATION_DECAY_MULTIPLE = 3;
export const SYNTH_TONE_HARMONICS = 3;
export const SYNTH_VIBRATO_RATE_HZ = 5;

// Scoring
export const MATCH_TOLERANCE_MS = 50;
export const REGRESSION_RECALL_DROP = 0.02;
export const REGRESSION_MIN_TRUTHS = 50;
export const REGRESSION_TP_DROP_COUNT = 2;

// Spectrogram
export const SPECTROGRAM_FFT_SIZE = 1024;
export const SPECTROGRAM_HOP_MS = 10;
export const SPECTROGRAM_MAX_HZ = 8000;
export const SPECTROGRAM_HEIGHT_PX = 256;
export const SPECTROGRAM_FLOOR_DBFS = -90;
