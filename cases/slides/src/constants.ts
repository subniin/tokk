// The numbers of the deck, each with its unit in the name. A case cannot import core/constants.ts (a case reaches the
// library only through the package name), so the constants of the case live here, as the constants of the apps do.

// The size of the area that reveal.js scales to the window. These are the stock values of reveal.js 6.0.2, written
// down so that the page does not depend on a default that may change.
export const DECK_WIDTH_PX = 960;
export const DECK_HEIGHT_PX = 700;

// The empty margin around the content, as a share of the window (0.04 is 4 per cent).
export const DECK_MARGIN_RATIO = 0.04;
