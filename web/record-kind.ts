// The kind of a teaching recording, derived from the label. Pure, shared by the Worker and the dialog.

import { BACKGROUND, HUM_LABEL } from '../core/constants';

export type RecordKind = 'sound' | 'hum' | 'background';

export function kindOfLabel(label: string): RecordKind {
  if (label === HUM_LABEL) return 'hum';
  if (label === BACKGROUND) return 'background';
  return 'sound';
}
