// The alarm of the Help screen, made with Web Audio only (no audio file). Two tones alternate and repeat until stop().
// The app calls ears.pause() before start() and ears.resume() after stop() (main.ts), so the microphone does not hear it.
// A browser starts an AudioContext only after a click or key, so prime() is called on the first one.
import {
  ALARM_BEEP_MS, ALARM_FADE_MS, ALARM_HIGH_HZ, ALARM_LEVEL_DB, ALARM_LOW_HZ, ALARM_PERIOD_MS, DB_AMPLITUDE_DIVISOR, MS_PER_SECOND,
} from './constants';

const SILENT_GAIN = 0.0001;

export interface Alarm {
  prime(): void;
  start(): void;
  stop(): void;
  running(): boolean;
}

export function createAlarm(): Alarm {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let beeps = 0;
  const peak = Math.pow(10, ALARM_LEVEL_DB / DB_AMPLITUDE_DIVISOR);

  const context = (): AudioContext | null => {
    if (ctx === null) {
      try {
        ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };

  const beep = (): void => {
    const c = context();
    if (c === null) return;
    const start = c.currentTime;
    const end = start + ALARM_BEEP_MS / MS_PER_SECOND;
    const gain = c.createGain();
    gain.gain.setValueAtTime(SILENT_GAIN, start);
    gain.gain.linearRampToValueAtTime(peak, start + ALARM_FADE_MS / MS_PER_SECOND);
    gain.gain.setValueAtTime(peak, end - ALARM_FADE_MS / MS_PER_SECOND);
    gain.gain.linearRampToValueAtTime(SILENT_GAIN, end);
    gain.connect(c.destination);
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(beeps % 2 === 0 ? ALARM_HIGH_HZ : ALARM_LOW_HZ, start);
    beeps += 1;
    osc.connect(gain);
    osc.start(start);
    osc.stop(end);
    osc.onended = () => gain.disconnect();
  };

  return {
    prime(): void {
      context();
    },
    start(): void {
      if (timer !== undefined) return;
      beeps = 0;
      beep();
      timer = setInterval(beep, ALARM_PERIOD_MS);
    },
    stop(): void {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
    running(): boolean {
      return timer !== undefined;
    },
  };
}
