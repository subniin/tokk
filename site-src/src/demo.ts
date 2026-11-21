// The six states of the demo box (site.md section 4). Pure: no DOM, so a Node test can read it.
import { TEST_QUERY_KEY } from './constants';

export const DEMO_STATES = ['idle', 'teach', 'room', 'live', 'rec', 'fail'] as const;
export type DemoState = (typeof DEMO_STATES)[number];

export interface DemoView {
  // The short state text at the top right of the box.
  label: string;
  // The border of the box is highlighted (a box-shadow, so the box does not change size).
  live: boolean;
  // The waveform is faded.
  waveDim: boolean;
}

const VIEWS: Record<DemoState, DemoView> = {
  idle: { label: 'ready', live: false, waveDim: true },
  teach: { label: 'teaching clap', live: false, waveDim: false },
  room: { label: 'room sound', live: false, waveDim: false },
  live: { label: 'listening', live: true, waveDim: false },
  rec: { label: 'recording', live: true, waveDim: false },
  fail: { label: 'no microphone', live: false, waveDim: true },
};

export function isDemoState(value: unknown): value is DemoState {
  return typeof value === 'string' && (DEMO_STATES as readonly string[]).includes(value);
}

export function demoView(state: DemoState): DemoView {
  return VIEWS[state];
}

// True when the URL query has the test key (`?test`). Only then does the page take states from the test event.
export function isTestMode(search: string): boolean {
  return new URLSearchParams(search).has(TEST_QUERY_KEY);
}
