// Text of the overlay as pure functions. No DOM type, no Node module, no clock.
// Times are in s, rates in Hz. A number that is not finite is shown as `n/a`, never as NaN or Infinity.

import type { SegmentReport } from '../../core/engine';
import type { MatchEvent } from '../../core/types';
import {
  WEB_OVERLAY_CONFIDENCE_DECIMALS, WEB_OVERLAY_DISTANCE_DECIMALS, WEB_OVERLAY_LOW_RATE_HZ, WEB_OVERLAY_TIME_DECIMALS,
} from '../constants';

export type OverlayState = 'listening' | 'paused' | 'teaching';

export interface EventRow {
  kind: 'sound' | 'unknown' | 'background';
  label: string;
  text: string;
  time: string;
  confidence: string;     // empty for unknown and background
  nearestId: string;
  distance: string;
  threshold: string;
}

export interface MatchRow {
  kind: 'match';
  bold: true;
  text: string;
  time: string;
  pattern: string;
  speed: string;          // empty when the match has no speed
}

const BACKGROUND_LABEL = 'background';
const UNKNOWN_LABEL = 'unknown';
const NOT_AVAILABLE = 'n/a';
const SEPARATOR = '  ';

function num(value: number | undefined, decimals: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : NOT_AVAILABLE;
}

function seconds(t: number): string {
  return `${num(t, WEB_OVERLAY_TIME_DECIMALS)} s`;
}

function thresholdOf(thresholds: Record<string, number> | undefined, label: string): string {
  if (thresholds === undefined || thresholds === null) return NOT_AVAILABLE;
  const v = Object.prototype.hasOwnProperty.call(thresholds, label) ? thresholds[label] : undefined;
  return num(v, WEB_OVERLAY_DISTANCE_DECIMALS);
}

export function formatEventRow(report: SegmentReport, thresholds: Record<string, number> | undefined): EventRow {
  const { result } = report;
  let kind: EventRow['kind'];
  let label: string;
  let thresholdLabel: string;
  let confidence = '';
  if (result.kind === 'unknown') {
    kind = 'unknown';
    label = UNKNOWN_LABEL;
    thresholdLabel = result.nearest.label;
  } else if (result.label === BACKGROUND_LABEL) {
    kind = 'background';
    label = BACKGROUND_LABEL;
    thresholdLabel = BACKGROUND_LABEL;
  } else {
    kind = 'sound';
    label = result.label;
    thresholdLabel = result.label;
    confidence = num(result.confidence, WEB_OVERLAY_CONFIDENCE_DECIMALS);
  }
  const time = seconds(report.t);
  const nearestId = result.nearest.id;
  const distance = num(result.nearest.distance, WEB_OVERLAY_DISTANCE_DECIMALS);
  const threshold = thresholdOf(thresholds, thresholdLabel);
  const shownLabel = kind === 'background' ? `${BACKGROUND_LABEL} (no event)` : label;
  const parts = [time, shownLabel];
  if (kind === 'sound') parts.push(`confidence ${confidence}`);
  parts.push(`nearest ${nearestId}`, `distance ${distance} / threshold ${threshold}`);
  return { kind, label, text: parts.join(SEPARATOR), time, confidence, nearestId, distance, threshold };
}

export function formatMatchRow(pattern: string, match: MatchEvent): MatchRow {
  const time = seconds(match.t);
  const speed = typeof match.speed === 'number' && Number.isFinite(match.speed) ? num(match.speed, WEB_OVERLAY_DISTANCE_DECIMALS) : '';
  let text = `Pattern "${pattern}" matched at ${time}`;
  if (speed !== '') text += `${SEPARATOR}speed ${speed}`;
  return { kind: 'match', bold: true, text, time, pattern, speed };
}

function validRate(hz: number): boolean {
  return typeof hz === 'number' && Number.isFinite(hz) && hz > 0;
}

export function sampleRateWarning(micRateHz: number, modelRateHz: number): string | null {
  if (!validRate(micRateHz) || !validRate(modelRateHz) || micRateHz === modelRateHz) return null;
  let text = `Sample rate warning: the input runs at ${micRateHz} Hz but the sounds were taught at ${modelRateHz} Hz. `
    + 'Recognition can be less accurate. Teach the sounds again at this rate.';
  if (micRateHz === WEB_OVERLAY_LOW_RATE_HZ) {
    text += ` At ${WEB_OVERLAY_LOW_RATE_HZ} Hz the high-frequency features are empty, so sounds that differ mostly in the high frequencies look alike.`;
  }
  return text;
}

export function stateLabel(state: OverlayState): string {
  switch (state) {
    case 'listening': return 'Listening';
    case 'paused': return 'Paused';
    case 'teaching': return 'Teaching';
  }
}
