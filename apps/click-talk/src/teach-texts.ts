// The English copy of the welcome screen, the mode choice and the teach dialog (click-talk.md section 5). Pure.

export const WELCOME_TEXT = {
  title: 'Click Talk',
  lead: 'Talk with two small mouth sounds. A tongue click moves, a lip pop chooses, and the laptop says the words.',
  setup: 'Set it up with the person who will use it. It takes about two minutes.',
  privacy: 'Sounds and settings stay on this device. Click Talk is not a medical device.',
  button: 'Set up',
} as const;

export const MODE_TEXT = {
  question: 'How many sounds can they make?',
  two: { title: 'Two sounds (recommended)', body: 'Tongue click to move, lip pop to choose.' },
  one: { title: 'One sound', body: 'The frame moves by itself. Tongue click to choose.' },
} as const;

// The `record` text of the teach dialog of each sound. The count is part of the sentence, so there is no {count}.
export const TEACH_LINE = {
  click: 'Ask them to click their tongue 10 times, with a short pause between clicks.',
  pop: 'Now 10 lip pops.',
} as const;

// The `recordBackground` text: 30 seconds of the room.
export const BACKGROUND_LINE = 'Last, 30 seconds of the room: talk for a while, then type for a while. Click Talk learns what to ignore.';
