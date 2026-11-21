// Which voice to speak with. Pure part only; speak() itself is run B (it calls speechSynthesis).
import { SPEAK_MAX_MS, VOICES_WAIT_MS } from './constants';
import type { Settings } from './settings';

// The part of SpeechSynthesisVoice that is used, so Node tests need no DOM.
export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

export const NO_VOICE_TEXT = 'No offline voice on this device. Phrases are shown on screen only.';

const ENGLISH = /^en([-_]|$)/i;

// With online voices off only voices with localService === true are allowed, because a network voice sends the text to a
// speech service. Order: the chosen voiceURI, an English local voice, any local voice; with online voices on, then an
// English network voice, then any voice. No voice at all gives null (the app then only shows the phrase).
export function pickVoice<V extends VoiceLike>(voices: readonly V[], s: Pick<Settings, 'voiceURI' | 'onlineVoices'>): V | null {
  const allowed = s.onlineVoices ? voices : voices.filter((v) => v.localService === true);
  const local = allowed.filter((v) => v.localService === true);
  const tiers: (V | undefined)[] = [
    s.voiceURI === null ? undefined : allowed.find((v) => v.voiceURI === s.voiceURI),
    local.find((v) => ENGLISH.test(v.lang)),
    local[0],
    allowed.find((v) => ENGLISH.test(v.lang)),
    allowed[0],
  ];
  return tiers.find((v) => v !== undefined) ?? null;
}

// ---- Run B: speaking ----
// speak() and the voice list touch speechSynthesis, but only inside functions, so the pure part above still loads in Node.
// The browser types are written out here (the part of them that is used), so the Node type check needs no DOM library.
interface Utterance { voice: unknown; lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null }
interface Synthesis {
  getVoices(): VoiceLike[];
  speak(u: Utterance): void;
  cancel(): void;
  addEventListener(type: 'voiceschanged', listener: () => void): void;
  removeEventListener(type: 'voiceschanged', listener: () => void): void;
}
const host = globalThis as unknown as { speechSynthesis?: Synthesis; SpeechSynthesisUtterance?: new (text: string) => Utterance };

let voicesChecked = false;

// Chrome fills getVoices() late and says so with `voiceschanged`. Wait for it once before concluding that there is no voice.
export function loadVoices(): Promise<VoiceLike[]> {
  const s = host.speechSynthesis;
  if (s === undefined) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length > 0 || voicesChecked) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      voicesChecked = true;
      s.removeEventListener('voiceschanged', finish);
      clearTimeout(timer);
      resolve(s.getVoices());
    };
    const timer = setTimeout(finish, VOICES_WAIT_MS);
    s.addEventListener('voiceschanged', finish);
  });
}

// The label of a voice in the caregiver list.
export function voiceLabel(v: VoiceLike): string {
  return `${v.name} (${v.localService ? 'on this device' : 'online'})`;
}

// Speaks the text. Resolves true when the speech has ended, and false at once when there is no allowed voice.
export async function speak(text: string, s: Pick<Settings, 'voiceURI' | 'onlineVoices' | 'rate'>): Promise<boolean> {
  const synthesis = host.speechSynthesis;
  const Make = host.SpeechSynthesisUtterance;
  if (synthesis === undefined || Make === undefined) return false;
  const voice = pickVoice(await loadVoices(), s);
  if (voice === null) return false;
  return new Promise<boolean>((resolve) => {
    const u = new Make(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = s.rate;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    u.onend = finish;
    u.onerror = finish;
    timer = setTimeout(finish, SPEAK_MAX_MS);
    synthesis.cancel();
    synthesis.speak(u);
  });
}

export function cancelSpeech(): void {
  host.speechSynthesis?.cancel();
}