// Task 34 (requirement 11, Review Focus 5): which voice the app speaks with. Pure; the voice type is structural.
import { describe, expect, it } from 'vitest';
import { NO_VOICE_TEXT, pickVoice } from '../apps/click-talk/src/speech';
import type { VoiceLike } from '../apps/click-talk/src/speech';
import { DEFAULT_SETTINGS } from '../apps/click-talk/src/settings';

const voice = (voiceURI: string, lang: string, localService: boolean): VoiceLike => ({ voiceURI, name: voiceURI, lang, localService });
const LOCAL_DE = voice('local-de', 'de-DE', true);
const LOCAL_EN = voice('local-en', 'en-US', true);
const LOCAL_EN_GB = voice('local-en-gb', 'en-GB', true);
const NET_EN = voice('net-en', 'en-US', false);
const NET_DE = voice('net-de', 'de-DE', false);

const OFF = DEFAULT_SETTINGS;
const ON = { ...DEFAULT_SETTINGS, onlineVoices: true };

describe('pickVoice', () => {
  it('no voices gives null (Review Focus 5)', () => {
    expect(pickVoice([], OFF)).toBeNull();
    expect(pickVoice([], ON)).toBeNull();
  });

  it('with online voices off, a network voice is never picked', () => {
    expect(pickVoice([NET_EN], OFF)).toBeNull();
    expect(pickVoice([NET_EN, NET_DE], OFF)).toBeNull();
    expect(pickVoice([NET_EN, LOCAL_DE], OFF)).toBe(LOCAL_DE);
  });

  it('the voiceURI wins when it is local', () => {
    expect(pickVoice([LOCAL_EN, LOCAL_DE], { ...OFF, voiceURI: 'local-de' })).toBe(LOCAL_DE);
  });

  it('the voiceURI of a network voice is ignored while online voices are off', () => {
    expect(pickVoice([NET_EN, LOCAL_DE], { ...OFF, voiceURI: 'net-en' })).toBe(LOCAL_DE);
    expect(pickVoice([NET_EN], { ...OFF, voiceURI: 'net-en' })).toBeNull();
  });

  it('an unknown voiceURI falls back to an English local voice, then any local voice', () => {
    expect(pickVoice([LOCAL_DE, LOCAL_EN_GB], { ...OFF, voiceURI: 'gone' })).toBe(LOCAL_EN_GB);
    expect(pickVoice([LOCAL_DE], { ...OFF, voiceURI: 'gone' })).toBe(LOCAL_DE);
  });

  it('without a voiceURI it prefers English, then the first local voice', () => {
    expect(pickVoice([LOCAL_DE, LOCAL_EN], OFF)).toBe(LOCAL_EN);
    expect(pickVoice([LOCAL_DE, voice('l2', 'fr-FR', true)], OFF)).toBe(LOCAL_DE);
    expect(pickVoice([voice('x', 'en_US', true)], OFF)?.voiceURI).toBe('x');
    expect(pickVoice([voice('x', 'english', true), LOCAL_DE], OFF)).toBeDefined();
  });

  it('online voices on allows a network voice, but a local one is still preferred', () => {
    expect(pickVoice([NET_EN], ON)).toBe(NET_EN);
    expect(pickVoice([NET_EN, LOCAL_DE], ON)).toBe(LOCAL_DE);
    expect(pickVoice([NET_EN, LOCAL_EN], ON)).toBe(LOCAL_EN);
    expect(pickVoice([NET_EN, LOCAL_DE], { ...ON, voiceURI: 'net-en' })).toBe(NET_EN);
    expect(pickVoice([NET_DE, NET_EN], ON)).toBe(NET_EN);
  });

  it('does not change its input', () => {
    const list = [NET_EN, LOCAL_DE, LOCAL_EN];
    pickVoice(list, OFF);
    expect(list).toEqual([NET_EN, LOCAL_DE, LOCAL_EN]);
  });
});

describe('the no-voice notice', () => {
  it('is the copy of click-talk.md section 5', () => {
    expect(NO_VOICE_TEXT).toBe('No offline voice on this device. Phrases are shown on screen only.');
  });
});
