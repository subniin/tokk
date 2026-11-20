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
export const ONSET_ABOVE_FLOOR_DB = 16;
export const ONSET_MIN_LEVEL_DBFS = -60;
export const ONSET_RISE_DB = 3;               // one-hop step needed within ONSET_RISE_SPAN_MS
export const ONSET_RISE_SPAN_MS = 60;
export const ONSET_MIN_GAP_MS = 80;
export const ONSET_LEAD_MS = 5;
export const REONSET_MIN_SEGMENT_AGE_MS = 80;
export const OFFSET_ABOVE_FLOOR_DB = 6;
export const OFFSET_HOLD_MS = 30;
export const SEGMENT_MAX_MS = 1500;
export const REONSET_RISE_DB = 3;
export const REONSET_CONFIRM_MS = 70;
export const REONSET_CONFIRM_BEFORE_MS = 30;
export const REONSET_CONFIRM_DB = 4;
export const REONSET_CONFIRM_EARLY_MS = 15;
export const REONSET_CONFIRM_EARLY_DB = 3;
export const NOISE_FLOOR_WARMUP_MS = 1000;
export const NOISE_FLOOR_WARMUP_RISE_MS = 100;

// Engine advance rule: the matcher is never advanced past a sound whose onset hop is not analyzed yet.
export const ENGINE_ADVANCE_MARGIN_MS = SEGMENT_HOP_MS + ONSET_LEAD_MS;

// Features
export const FEATURE_LENGTH = 32;
export const FEATURE_FRAME_MIN_MS = 20;
export const FEATURE_HOP_MS = 10;
export const FEATURE_FFT_WINDOW_MULTIPLE = 2;
export const MEL_FILTER_COUNT = 26;
export const MEL_MIN_HZ = 100;
export const MEL_MAX_HZ = 8000;
export const MEL_MAX_NYQUIST_FRACTION = 0.45;
export const MFCC_COUNT = 13;
export const DECAY_DROP_DB = 20;
export const BAND_EDGES_HZ = [500, 2000, 5000];
export const MEL_POWER_FLOOR = 1e-10;
export const FEATURE_CENTROID_SCALE_HZ = 1000;
export const FEATURE_DECAY_SCALE_MS = 100;
export const FEATURE_ATTACK_SCALE_MS = 100;
export const FEATURE_ZCR_SCALE_PER_S = 1000;

// Classifier
export const KNN_K = 3;
export const DISTANCE_THRESHOLD_FACTOR = 1.5;
export const THRESHOLD_PERCENTILE = 95;
export const MIN_EXAMPLES_PER_LABEL = 5;
export const RECOMMENDED_EXAMPLES_PER_LABEL = 10;
export const STD_FLOOR_RANGE_FRACTION = 0.05;
export const STD_FLOOR_ABSOLUTE = 0.01;
export const BACKGROUND = 'background';

// Teaching
export const HUM_LABEL = 'hum';   // reserved label name: sets the pitch baseline, has no examples
export const BACKGROUND_WINDOW_MS = 300;
export const BACKGROUND_WINDOW_OVERLAP_PERCENT = 50;
export const BACKGROUND_MAX_EXAMPLES = 200;

// Teaching report
export const LOO_MIN_EXAMPLES_PER_LABEL = MIN_EXAMPLES_PER_LABEL - 1;   // one example is held out
export const CONFUSED_PAIR_MIN_RATE = 0.1;

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
export const GAP_TOLERANCE_MS = 1e-6;          // rounding allowance for t = samples / sampleRate
export const PITCH_MAX_STEP_SEMITONES = 1;      // largest pitch change between two hops of a voiced run, in semitones; E5 knob
// Quality factor of the 2nd-order pitch filters, unitless: 1 / sqrt(2) is a Butterworth response.
export const PITCH_FILTER_Q = Math.SQRT1_2;
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
// Rounding allowance (unitless) for time and recall comparisons in scoring, so that 0.02 or 50 ms exactly never fails on float error.
export const SCORE_EPSILON = 1e-9;

// Spectrogram
export const SPECTROGRAM_FFT_SIZE = 1024;
export const SPECTROGRAM_HOP_MS = 10;
export const SPECTROGRAM_MAX_HZ = 8000;
export const SPECTROGRAM_HEIGHT_PX = 256;
export const SPECTROGRAM_FLOOR_DBFS = -90;
export const SPECTROGRAM_CEILING_DBFS = 0; // level that reads as white
export const SPECTROGRAM_TOOL_MAX_RANGE_MS = 60000; // longest range the spectrogram tool draws

// Synthetic fixtures and corpus score
export const SYNTH_FIXTURE_SAMPLE_RATE_HZ = SAMPLE_RATE_MIN_HZ;
export const SYNTH_FIXTURE_LEAD_MARGIN_MS = 200;     // added to NOISE_FLOOR_WARMUP_MS
export const SYNTH_FIXTURE_LEAD_NOISE_DBFS = -75;    // noise bed in the lead and under the sounds, below ONSET_MIN_LEVEL_DBFS
export const SYNTH_FIXTURE_SOUNDS_SPACING_MS = 600;  // start-to-start distance of impacts in sounds/ files
export const SYNTH_FIXTURE_QUICK_SPACING_MS = 700;   // start-to-start distance of impacts in quick/ files
export const SYNTH_FIXTURE_TAIL_MS = 400;
export const SYNTH_FIXTURE_GAIN_DB = -12;
export const SYNTH_FIXTURE_GAIN_JITTER_DB = 3;
export const SYNTH_FIXTURE_SEED = 20261119;
export const SYNTH_FIXTURE_QUICK_SEED_OFFSET = 1000;  // quick files use other realizations than the sounds files
export const SYNTH_FIXTURE_BACKGROUND_MS = 2000;      // length of the steady noise after the lead
export const SYNTH_FIXTURE_BACKGROUND_LEVELS_DBFS = [-45, -35];   // white, then pink
export const CORPUS_SCORE_BUDGET_MS = 15000;

// Model file format
export const MODEL_VERSION = 1;   // version of sounds.json written by training; no unit
