// The scan (DOM): one frame that moves over the links and buttons of <main>, driven by one pending timer (requirement 4).
// Every move is recorded with performance.now() in the scan history, so a click can be matched to the element that was
// highlighted when the sound was made. No frame loop, no transition.
import { SCAN_HISTORY_KEEP_MS, SCAN_STEP_MS_DEFAULT } from './constants';
import { ScanHistory } from './history';

const TARGET_SELECTOR = 'main a[href], main button:not([disabled])';
const FRAME_ATTRIBUTE = 'data-scan';
const FRAME_VALUE = 'current';

export interface Scan {
  // Reads the targets of the current view again, clears the history and highlights the first target (requirement 4.6).
  collect(): void;
  // `visible`: the frame is drawn. `running`: the timer moves it. Called on every state change; it changes only what differs.
  update(state: { visible: boolean; running: boolean }): void;
  setStepMs(stepMs: number): void;
  // The target that was highlighted at a page time in ms, or null.
  lookup(pageMs: number): HTMLElement | null;
}

export function createScan(onHighlight: (target: HTMLElement | null) => void): Scan {
  const history = new ScanHistory<HTMLElement>(SCAN_HISTORY_KEEP_MS);
  let targets: HTMLElement[] = [];
  let index = -1;
  let stepMs = SCAN_STEP_MS_DEFAULT;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  let running = false;

  const isShown = (el: HTMLElement): boolean => !el.hidden && el.getClientRects().length > 0;
  const clearFrame = (): void => {
    for (const el of document.querySelectorAll(`[${FRAME_ATTRIBUTE}="${FRAME_VALUE}"]`)) el.removeAttribute(FRAME_ATTRIBUTE);
  };
  const scrollIfOutside = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  };

  // Draws the frame on the current target and records the move at the time it is set.
  const show = (): void => {
    clearFrame();
    const el = index >= 0 ? targets[index] : undefined;
    if (!visible || el === undefined) {
      onHighlight(null);
      return;
    }
    el.setAttribute(FRAME_ATTRIBUTE, FRAME_VALUE);
    history.record(performance.now(), el);
    scrollIfOutside(el);
    onHighlight(el);
  };

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (): void => {
    stopTimer();
    if (running && targets.length > 0) timer = setTimeout(move, stepMs);
  };
  function move(): void {
    timer = undefined;
    if (targets.length === 0) return;
    index = (index + 1) % targets.length;
    show();
    schedule();
  }

  return {
    collect(): void {
      history.clear();
      targets = [...document.querySelectorAll<HTMLElement>(TARGET_SELECTOR)].filter(isShown);
      index = targets.length > 0 ? 0 : -1;
      show();
      schedule();
    },
    update(next): void {
      const becameVisible = next.visible && !visible;
      const startedRunning = next.running && !running;
      visible = next.visible;
      running = next.running;
      if (!visible) show();
      else if (becameVisible) show();
      if (!running) stopTimer();
      else if (startedRunning || timer === undefined) schedule();
    },
    setStepMs(ms: number): void {
      stepMs = ms;
      if (running) schedule();   // the wait for the next move starts again from now; the frame stays where it is
    },
    lookup(pageMs: number): HTMLElement | null {
      return visible ? history.lookup(pageMs) : null;
    },
  };
}
