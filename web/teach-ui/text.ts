// The texts of the teach dialog that an app may replace with TeachOptions.text (Task 20), their defaults, and the
// check and fill of placeholders. Pure: no DOM type. The dialog sets every text with textContent, never as HTML.

import { NOISE_FLOOR_WARMUP_MS } from '../../core/constants';

const MS_PER_SECOND = 1000;
const QUIET_SECONDS = NOISE_FLOOR_WARMUP_MS / MS_PER_SECOND;

export type TeachTextKey =
  | 'title' | 'quiet' | 'record' | 'recordHum' | 'recordBackground' | 'training' | 'count' | 'needMore' | 'review' | 'failed'
  | 'done' | 'save' | 'again' | 'cancel' | 'close' | 'saved' | 'savedSessionOnly';

// Replacements for texts of the teach dialog. Every key is optional; an absent key keeps the default.
// title {label}, quiet, record {count}, recordHum, recordBackground, training, count {heard} {target} {kept},
// needMore {min} {kept}, review, failed, done, save, again, cancel, close, saved, savedSessionOnly.
export type TeachText = Partial<Record<TeachTextKey, string>>;
export type ResolvedTeachText = Readonly<Record<TeachTextKey, string>>;

// Today's texts. The default `record` says "time" for one example (format.ts builds it).
export const TEACH_TEXT_DEFAULTS: ResolvedTeachText = Object.freeze({
  title: 'Teach "{label}"',
  quiet: `Stay quiet for ${QUIET_SECONDS} second`,
  record: 'Make the sound {count} times',
  recordHum: 'Hum one steady note, then press Done.',
  recordBackground: 'Let the room make its usual noise, then press Done.',
  training: 'Training...',
  count: '{heard} of {target} heard, {kept} kept',
  needMore: 'Keep at least {min} examples. You have {kept}.',
  review: 'Check the result, then save it.',
  failed: 'Training failed.',
  done: 'Done',
  save: 'Save',
  again: 'Record again',
  cancel: 'Cancel (Esc)',
  close: 'Close',
  saved: 'Saved.',
  savedSessionOnly: 'Saved for this session only. The browser did not allow storing it.',
});

export const TEACH_TEXT_PLACEHOLDERS: Readonly<Record<TeachTextKey, readonly string[]>> = Object.freeze({
  title: ['label'], quiet: [], record: ['count'], recordHum: [], recordBackground: [], training: [],
  count: ['heard', 'target', 'kept'], needMore: ['min', 'kept'], review: [], failed: [], done: [], save: [], again: [],
  cancel: [], close: [], saved: [], savedSessionOnly: [],
});

const KEYS = Object.keys(TEACH_TEXT_DEFAULTS) as TeachTextKey[];
const PLACEHOLDER = /^\{([A-Za-z]+)\}/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function allowedText(key: TeachTextKey): string {
  const list = TEACH_TEXT_PLACEHOLDERS[key];
  return list.length === 0 ? 'no placeholder' : `only ${list.map((p) => `{${p}}`).join(', ')}`;
}

// Throws when a value uses a { that does not start a placeholder its key allows.
function checkPlaceholders(key: TeachTextKey, value: string): void {
  const allowed = TEACH_TEXT_PLACEHOLDERS[key];
  for (let i = value.indexOf('{'); i !== -1; i = value.indexOf('{', i + 1)) {
    const m = PLACEHOLDER.exec(value.slice(i));
    if (m === null || !allowed.includes(m[1])) {
      const found = m === null ? `a "{" at position ${i} that does not start a placeholder` : `the placeholder {${m[1]}}`;
      throw new RangeError(`text.${key} uses ${found}. It may use ${allowedText(key)}.`);
    }
  }
}

// Checks the texts of TeachOptions.text and returns all texts, with the defaults for absent keys.
export function resolveTeachText(text: unknown): ResolvedTeachText {
  if (text === undefined) return TEACH_TEXT_DEFAULTS;
  if (!isPlainObject(text)) {
    throw new RangeError(`text must be a plain object with some of the keys ${KEYS.join(', ')}.`);
  }
  const out: Record<TeachTextKey, string> = { ...TEACH_TEXT_DEFAULTS };
  for (const key of Object.keys(text)) {
    if (!(KEYS as string[]).includes(key)) {
      throw new RangeError(`text has the unknown key "${key}". Allowed keys: ${KEYS.join(', ')}.`);
    }
    const k = key as TeachTextKey;
    const value = text[key];
    if (typeof value !== 'string') throw new RangeError(`text.${k} must be a string, got ${value === null ? 'null' : typeof value}.`);
    if (value.trim() === '') throw new RangeError(`text.${k} must not be empty.`);
    checkPlaceholders(k, value);
    out[k] = value;
  }
  return Object.freeze(out);
}

// Replaces each {name} by its value as plain text. A value checked by resolveTeachText has only known names.
export function fillText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole));
}
