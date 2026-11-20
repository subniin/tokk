// The slide deck of the case. reveal.js is used through its documented public API only: the default export, its
// configuration and (later) next() and prev(). The case never edits or reaches into the package.
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/serif.css';
import './style.css';
import { captionText } from './caption';
import type { CaptionState } from './caption';
import { DECK_HEIGHT_PX, DECK_MARGIN_RATIO, DECK_WIDTH_PX } from './constants';

// Motion is off everywhere: no slide transition, no background transition, no automatic animation and no control tutorial.
const deck = new Reveal({
  width: DECK_WIDTH_PX,
  height: DECK_HEIGHT_PX,
  margin: DECK_MARGIN_RATIO,
  transition: 'none',
  backgroundTransition: 'none',
  autoAnimate: false,
  controls: true,
  controlsTutorial: false,
  controlsLayout: 'bottom-right',
  progress: true,
  hash: false,
  respondToHashChanges: false,
});

function start(): void {
  void deck.initialize();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

// The caption: plain text in a status region outside the deck. The texts come from caption.ts.
function showCaption(state: CaptionState): void {
  const caption = document.getElementById('caption');
  if (caption) caption.textContent = captionText(state);
}

// reveal.js 6.0.2 listens for keys on the whole document. It takes Space on a focused button as 'next slide' and cancels the
// key, so the button would not start and the deck would move. The key is stopped at the button (reveal.js is not changed).
// Enter is not taken by reveal.js. The button is hidden once it has been pressed, because it starts the sound control only once.
const startButton = document.getElementById('start-sound');
startButton?.addEventListener('keydown', (event) => { event.stopPropagation(); });
startButton?.addEventListener('click', () => { startButton.hidden = true; }, { once: true });

// tokk:start
import { listen } from 'tokk';

// Every user teaches their own claps on the first run, so no sounds option is passed.
async function startSoundControl(): Promise<void> {
  try {
    const ears = await listen({
      storageKey: 'tokk:slides',
      on: {
        'clap clap': () => { showCaption({ kind: 'heard', pattern: 'clap clap', action: 'next' }); deck.next(); },
        'clap clap clap': () => { showCaption({ kind: 'heard', pattern: 'clap clap clap', action: 'previous' }); deck.prev(); },
      },
    });
    if (!ears.labels.includes('clap')) { showCaption({ kind: 'teaching' }); await ears.teach('clap', { ui: true }); }
    showCaption({ kind: 'listening' });
  } catch (error) {
    showCaption({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

document.getElementById('start-sound')?.addEventListener('click', () => { void startSoundControl(); }, { once: true });
// tokk:end
