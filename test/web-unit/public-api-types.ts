// Task 20, U16 (b): compile-time checks of the public types. test/public-api.test.ts runs tsc with
// test/web-unit/tsconfig.public-api.json on this file (tsconfig.json has no DOM types). Nothing here runs.

import type { Ears, EngineEvent, Envelope, ListenOptions, TeachOptions, TeachText, TokkError } from '../../web/index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

export type PublicApiChecks = [
  Expect<IsOptional<ListenOptions, 'sounds'>>,
  Expect<IsOptional<ListenOptions, 'onEvent'>>,
  Expect<IsOptional<ListenOptions, 'onEnvelope'>>,
  Expect<Equal<NonNullable<ListenOptions['onEvent']>, (e: EngineEvent) => void>>,
  Expect<Equal<NonNullable<ListenOptions['onEnvelope']>, (env: Envelope) => void>>,
  Expect<Equal<Ears['labels'], string[]>>,
  Expect<Equal<Ears['toPageTime'], (t: number) => number>>,
  Expect<IsOptional<TeachOptions, 'text'>>,
  Expect<IsOptional<TeachOptions, 'backgroundMs'>>,
  Expect<Equal<NonNullable<TeachOptions['backgroundMs']>, number>>,
  Expect<Equal<NonNullable<TeachOptions['text']>, TeachText>>,
  Expect<Equal<Envelope['t0'], number>>,
  Expect<Equal<Envelope['binMs'], number>>,
  Expect<Equal<Envelope['min'], Float32Array>>,
  Expect<Equal<Envelope['max'], Float32Array>>,
  Expect<Equal<Extract<EngineEvent, { kind: 'unknown' }>['kind'], 'unknown'>>,
  Expect<Equal<TeachText['title'], string | undefined>>,
  // Task 32
  Expect<IsOptional<ListenOptions, 'onError'>>,
  Expect<Equal<NonNullable<ListenOptions['onError']>, (error: TokkError) => void>>,
  Expect<Equal<TokkError['kind'], 'mic-ended' | 'worker' | 'audio-closed'>>,
  Expect<Equal<TokkError extends Error ? true : false, true>>,
  Expect<Equal<Ears['inject'], (label: string) => void>>,
    Expect<Equal<Ears['setDebug'], (on: boolean) => void>>,
  Expect<Equal<Exclude<ListenOptions['source'], undefined>, string | MediaStream>>,
];
