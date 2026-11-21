// The settings of Click Talk as pure parse and serialize functions for localStorage. No DOM, no Tokk.
// Settings hold text, numbers and flags only. Audio is never stored here (privacy rule).
import {
  DEFAULT_RATE_FACTOR, DEFAULT_SCAN_MS, RATE_FACTOR_MAX, RATE_FACTOR_MIN, SCAN_MS_MAX, SCAN_MS_MIN, SETTINGS_STORAGE_KEY,
} from './constants';
import { CATEGORIES, FREQUENT_ID, HELP_ID, PHRASE_COUNT_MESSAGE, validPhraseCount } from './phrases';
import type { Category } from './phrases';

export type Settings = {
  mode: 'two' | 'one';
  scanMs: number;
  voiceURI: string | null;
  rate: number;
  onlineVoices: boolean;
  phrases: Category[];
  counts: Record<string, number>;
};

export const SETTINGS_KEY = SETTINGS_STORAGE_KEY;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'two',
  scanMs: DEFAULT_SCAN_MS,
  voiceURI: null,
  rate: DEFAULT_RATE_FACTOR,
  onlineVoices: false,
  phrases: CATEGORIES,
  counts: {},
};

type Json = Record<string, unknown>;
const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const copyCategories = (cats: readonly Category[]): Category[] => cats.map((c) => ({ ...c, phrases: [...c.phrases] }));

function numberIn(x: unknown, min: number, max: number, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : fallback;
}

// A list is valid when it has 6 or 8 phrases and every phrase is a non-blank string.
function validList(x: unknown): x is string[] {
  return Array.isArray(x) && validPhraseCount(x.length) && x.every((p) => typeof p === 'string' && p.trim() !== '');
}

// Titles, ids and order come from the defaults. Only the phrase lists of the four phrase categories can be stored, and a
// list that is not valid keeps the one it replaces (the default on a first load).
function readPhrases(x: unknown, base: readonly Category[]): Category[] {
  const stored = Array.isArray(x) ? x.filter(isObject) : [];
  return base.map((c) => {
    if (c.id === FREQUENT_ID || c.id === HELP_ID) return { ...c, phrases: [] };
    const found = stored.find((e) => e.id === c.id);
    return found !== undefined && validList(found.phrases) ? { ...c, phrases: [...found.phrases] } : { ...c, phrases: [...c.phrases] };
  });
}

function readCounts(x: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!isObject(x)) return counts;
  for (const [phrase, n] of Object.entries(x)) {
    if (phrase === '__proto__') continue;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) counts[phrase] = n;
  }
  return counts;
}

export function loadSettings(text: string | null): Settings {
  const defaults: Settings = { ...DEFAULT_SETTINGS, phrases: copyCategories(DEFAULT_SETTINGS.phrases), counts: {} };
  if (text === null) return defaults;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaults;
  }
  if (!isObject(raw)) return defaults;
  return {
    mode: raw.mode === 'one' || raw.mode === 'two' ? raw.mode : defaults.mode,
    scanMs: numberIn(raw.scanMs, SCAN_MS_MIN, SCAN_MS_MAX, defaults.scanMs),
    voiceURI: typeof raw.voiceURI === 'string' ? raw.voiceURI : null,
    rate: numberIn(raw.rate, RATE_FACTOR_MIN, RATE_FACTOR_MAX, defaults.rate),
    onlineVoices: raw.onlineVoices === true,
    phrases: readPhrases(raw.phrases, defaults.phrases),
    counts: readCounts(raw.counts),
  };
}

export function saveSettings(s: Settings): string {
  return JSON.stringify(s);
}

// The caregiver edits one category. A list that is not 6 or 8 phrases is refused with the message, and the last valid list
// stays. Frequent and Help have no list of their own.
export function editPhrases(s: Settings, id: string, phrases: readonly string[]): { settings: Settings; error: string | null } {
  const target = s.phrases.find((c) => c.id === id);
  if (target === undefined || id === FREQUENT_ID || id === HELP_ID) return { settings: s, error: null };
  if (!validList(phrases)) return { settings: s, error: PHRASE_COUNT_MESSAGE };
  return { settings: { ...s, phrases: s.phrases.map((c) => (c.id === id ? { ...c, phrases: [...phrases] } : c)) }, error: null };
}

// One more time said.
export function countSaid(counts: Readonly<Record<string, number>>, phrase: string): Record<string, number> {
  return { ...counts, [phrase]: (counts[phrase] ?? 0) + 1 };
}
