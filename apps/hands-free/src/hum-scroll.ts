// Hum update -> scroll step in px (requirement 5.4). Pure: it reads the sound time `t` of each update and keeps nothing
// but the time of the previous update. No timer, no frame loop: the scroll happens inside the handler only.
import { HUM_FIRST_UPDATE_DT_MS, HUM_SCROLL_PX_PER_S_PER_SPEED, HUM_UPDATE_DT_MAX_MS, MS_PER_SECOND } from './constants';

export type HumDirection = 'up' | 'down';
export interface HumUpdate { t: number; speed: number; direction: HumDirection }
export interface HumScrollOptions { pxPerSPerSpeed: number; dtMaxMs: number; firstDtMs: number }
export interface HumScroll {
  // A signed step in px: negative scrolls the page up, positive down.
  update(u: HumUpdate): number;
  // The hum ended: the next update is a first update.
  end(): void;
}

const DT_EPSILON_MS = 1e-6;   // rounding allowance for t = samples / sampleRate

const DEFAULTS: HumScrollOptions = {
  pxPerSPerSpeed: HUM_SCROLL_PX_PER_S_PER_SPEED,
  dtMaxMs: HUM_UPDATE_DT_MAX_MS,
  firstDtMs: HUM_FIRST_UPDATE_DT_MS,
};

export function createHumScroll(options: Partial<HumScrollOptions> = {}): HumScroll {
  const o = { ...DEFAULTS, ...options };
  let previousT: number | null = null;   // sound time in s of the previous update of this hum
  return {
    update({ t, speed, direction }: HumUpdate): number {
      if (!(Number.isFinite(speed) && speed >= 0)) throw new RangeError(`speed must be a finite number of 0 or more, got ${speed}.`);
      if (!Number.isFinite(t)) throw new RangeError(`t must be a finite number, got ${t}.`);
      let dtMs = previousT === null ? o.firstDtMs : (t - previousT) * MS_PER_SECOND;
      // A gap above the longest dt, or a time that did not advance, starts a new hum: never a long jump.
      if (previousT !== null && (dtMs > o.dtMaxMs + DT_EPSILON_MS || dtMs <= 0)) dtMs = o.firstDtMs;
      previousT = t;
      const px = (speed * o.pxPerSPerSpeed * dtMs) / MS_PER_SECOND;
      if (px === 0) return 0;   // never -0
      return direction === 'up' ? -px : px;
    },
    end(): void {
      previousT = null;
    },
  };
}
