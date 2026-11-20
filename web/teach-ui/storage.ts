// Storage of the taught model in localStorage. Only the feature-vector model is stored, never a sample.
// The stored entry is { version, base, model }. `base` is a fingerprint of the `sounds` that the developer passed to
// listen(). A stored entry with another base is ignored, so a newly shipped sounds.json is never hidden by an old
// personal model. Every access to localStorage is inside try/catch: it can throw (blocked storage, private mode,
// a sandboxed frame, a full store).

import { emptyModel } from '../../core/classify/knn';
import { SAMPLE_RATE_MIN_HZ } from '../../core/constants';
import type { SoundModel } from '../../core/types';
import { WEB_STORAGE_VERSION } from '../constants';
import { checkModel } from '../model';

// The part of Storage that is used. A structural type, so vitest needs no DOM and passes a stub.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SaveResult = { ok: true } | { ok: false; reason: string };

const FNV_OFFSET_BASIS = 0x811c9dc5;   // 32-bit FNV-1a, no unit
const FNV_PRIME = 0x01000193;
const HEX = 16;
const HEX_DIGITS = 8;

function describe(e: unknown): string {
  return e instanceof Error ? (e.message || e.name) : String(e);
}

// JSON with the keys of every object in sorted order and no white space, so equal models give equal text.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    const parts = Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// FNV-1a (32 bit) of the canonical JSON, as 8 hex digits.
export function fingerprint(sounds: SoundModel): string {
  let h = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(canonicalJson(sounds))) {
    h ^= byte;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(HEX).padStart(HEX_DIGITS, '0');
}

function defaultStorage(): StorageLike {
  const s = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (s === undefined) throw new Error('this environment has no localStorage');
  return s;
}

function ignored(key: string, reason: string): null {
  console.warn(`tokk: ignoring the stored model "${key}": ${reason}`);
  return null;
}

// Returns the stored model, or null when there is none or it cannot be used (with one console.warn for the latter).
export function loadStoredModel(key: string, base: string, storage?: StorageLike): SoundModel | null {
  let text: string | null;
  try {
    text = (storage ?? defaultStorage()).getItem(key);
  } catch (e) {
    return ignored(key, `the browser would not let tokk read it (${describe(e)}).`);
  }
  if (text === null) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(text);
  } catch {
    return ignored(key, 'it is not valid JSON.');
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return ignored(key, 'it is not an object.');
  const e = entry as Record<string, unknown>;
  if (e.version !== WEB_STORAGE_VERSION) return ignored(key, `its storage version is ${String(e.version)}, but this build uses ${WEB_STORAGE_VERSION}.`);
  if (typeof e.base !== 'string') return ignored(key, 'it has no base fingerprint.');
  if (e.base !== base) {
    return ignored(key, 'it was taught on top of another sounds.json (the developer shipped a new one), so the shipped sounds are used.');
  }
  const checked = checkModel(e.model);
  if (!checked.ok) {
    return ignored(key, checked.problem === 'version' ? `its model has version ${checked.version}.` : 'its model has the wrong shape.');
  }
  return checked.model;
}

// Stores the model. Never throws: a full or blocked store gives { ok: false, reason }.
export function saveStoredModel(key: string, base: string, model: SoundModel, storage?: StorageLike): SaveResult {
  try {
    (storage ?? defaultStorage()).setItem(key, JSON.stringify({ version: WEB_STORAGE_VERSION, base, model }));
    return { ok: true };
  } catch (e) {
    const reason = `the browser would not store the model (${describe(e)}).`;
    console.warn(`tokk: could not save the model under "${key}": ${reason}`);
    return { ok: false, reason };
  }
}

// The base of the stored entry when listen() is called without `sounds` (Task 20): the fingerprint of the empty model at
// SAMPLE_RATE_MIN_HZ. It is one fixed value, because the input rate is not known when the stored model is read.
export function firstRunBase(): string {
  return fingerprint(emptyModel(SAMPLE_RATE_MIN_HZ));
}
