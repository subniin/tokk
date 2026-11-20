// The caption texts of the deck (requirement 10). One pure function, with no DOM type and no 'tokk' import, so that Node
// tests it. Every result is plain text: nothing is told by colour, shape or sound alone.

export type CaptionAction = 'next' | 'previous';

export type CaptionState =
  | { kind: 'off' }
  | { kind: 'teaching' }
  | { kind: 'listening' }
  | { kind: 'heard'; pattern: string; action: CaptionAction }
  | { kind: 'error'; message: string };

const OFF_TEXT = 'Sound control is off. Press Start sound control.';
const TEACHING_TEXT = 'Teach your clap in the dialog.';
const LISTENING_TEXT = 'Listening. Clap twice for the next slide, three times for the previous slide.';
const KEYBOARD_TEXT = 'The keyboard still works.';
const FALLBACK_ERROR_TEXT = 'Sound control could not start.';

// The two patterns of the deck. A pattern that is not in this list is not shown as "Heard".
const KNOWN_PATTERNS: readonly string[] = ['clap clap', 'clap clap clap'];
const ACTION_TEXT: Record<CaptionAction, string> = { next: 'Next slide.', previous: 'Previous slide.' };

// The message of the library, ended with a full stop when it has no end mark, so that two sentences read well.
function sentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed === '') return FALLBACK_ERROR_TEXT;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function captionText(state: CaptionState): string {
  switch (state.kind) {
    case 'off': return OFF_TEXT;
    case 'teaching': return TEACHING_TEXT;
    case 'listening': return LISTENING_TEXT;
    case 'heard':
      return KNOWN_PATTERNS.includes(state.pattern) ? `Heard: ${state.pattern}. ${ACTION_TEXT[state.action]}` : LISTENING_TEXT;
    case 'error': return `${sentence(state.message)} ${KEYBOARD_TEXT}`;
  }
}
