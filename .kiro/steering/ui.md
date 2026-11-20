---
inclusion: fileMatch
fileMatchPattern: ["web/**/*", "teach.html", "examples/**/*", "apps/hands-free/**/*", "cases/slides/**/*"]
---

# UI rules

- Respect `prefers-reduced-motion`: no rolling or looping motion, redraw a canvas at most once per second, no CSS transitions or animations.
- Show every recognition result as text. Never carry a result by colour, shape or sound alone.
- Put no Halloween elements in the template (`web/`, `teach.html`) or in app 1. Halloween styling lives in app 2's `halloween-ui.md` only.
- Write all text a user can see in English.
- Make every control reachable by keyboard, with an accessible name and a visible focus outline.
- Build the debug and teach panels in a Shadow DOM, so they leave the page's styles alone and the page's styles stay out of them.
- Give text a contrast of at least 4.5 to 1 against its background, and graphics at least 3 to 1.
- Follow `web-audio.md` for audio and `privacy.md` for what may be stored or sent.