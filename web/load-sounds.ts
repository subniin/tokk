import { MODEL_VERSION } from '../core/constants';
import type { SoundModel } from '../core/index';

const HINT_TEACH_AGAIN = 'Teach the sounds again with teach.html or `npm run sounds:rebuild`, or update tokk.';

function fail(url: string, problem: string, cause?: unknown): Error {
  return new Error(`loadSounds("${url}"): ${problem}`, cause === undefined ? undefined : { cause });
}

function isModelShape(value: unknown): value is SoundModel {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.version === 'number'
    && typeof m.k === 'number'
    && typeof m.sampleRate === 'number'
    && Array.isArray(m.mean)
    && Array.isArray(m.std)
    && Array.isArray(m.examples)
    && typeof m.thresholds === 'object' && m.thresholds !== null;
}

// Reads a model file (sounds.json). It sends no audio and no request body.
export async function loadSounds(url: string): Promise<SoundModel> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw fail(url, 'the request failed. Check the URL and your network connection.', e);
  }
  if (!res.ok) {
    throw fail(url, `the server answered HTTP ${res.status}. Check that the file exists at this URL.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch (e) {
    throw fail(url, `the file is not valid JSON. ${HINT_TEACH_AGAIN}`, e);
  }
  if (!isModelShape(parsed)) {
    throw fail(url, `the file is not a sound model. ${HINT_TEACH_AGAIN}`);
  }
  if ((parsed.version as number) !== MODEL_VERSION) {
    throw fail(url, `the model has version ${parsed.version}, but this build supports version ${MODEL_VERSION}. ${HINT_TEACH_AGAIN}`);
  }
  return parsed;
}
