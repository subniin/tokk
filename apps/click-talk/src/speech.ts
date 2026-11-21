// Which voice to speak with. Pure part only; speak() itself is run B (it calls speechSynthesis).
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
