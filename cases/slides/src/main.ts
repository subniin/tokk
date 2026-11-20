// The slide deck of the case. reveal.js is used through its documented public API only: the default export, its
// configuration and (later) next() and prev(). The case never edits or reaches into the package.
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/serif.css';
import './style.css';
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
