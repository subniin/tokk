// The landing page script (Task 35): the waveform bars, the demo box state, the test-only hook, and the demo box behaviour
// (teach, room sound, reaction, "Hear a recording") from demo-box.ts. The page sends nothing over the network.
import '../style.css';
import { TEST_STATE_EVENT, WAVE_BAR_PERCENTS, WAVE_HIT_RANGES } from './constants';
import { demoView, isDemoState, isTestMode } from './demo';
import { initDemoBox } from './demo-box';
import type { DemoState } from './demo';

const demo = document.getElementById('demo');
const wave = document.getElementById('wave');
const stateText = document.getElementById('state');

function drawWave(): void {
  if (!wave) return;
  wave.replaceChildren(...WAVE_BAR_PERCENTS.map((percent, i) => {
    const bar = document.createElement('i');
    bar.style.height = `${percent}%`;
    if (WAVE_HIT_RANGES.some(([from, to]) => i >= from && i <= to)) bar.className = 'hit';
    return bar;
  }));
}

// Shows one state. The six states stay in the page; only the attributes change, so the box never changes size.
export function setDemoState(state: DemoState): void {
  const view = demoView(state);
  if (demo) {
    demo.dataset.st = state;
    demo.classList.toggle('live', view.live);
  }
  if (wave) wave.classList.toggle('dim', view.waveDim);
  if (stateText) stateText.textContent = view.label;
}

drawWave();
setDemoState('idle');
initDemoBox(setDemoState);

// Test-only: with ?test in the URL a test sets the state with window.dispatchEvent(new CustomEvent('tokk-demo-state', { detail: 'live' })).
if (isTestMode(window.location.search)) {
  window.addEventListener(TEST_STATE_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isDemoState(detail)) setDemoState(detail);
  });
}
