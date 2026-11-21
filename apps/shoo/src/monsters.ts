// The five kinds of monster, the sound each one runs from and its hit points (shoo.md section 4). Pure.

export type SoundId = 'click' | 'clap' | 'knock' | 'pop';
export type Kind = 'bat' | 'ghost' | 'skeleton' | 'pumpkin' | 'warden';

// `rhythm` is the weak point of the warden: the pattern BOSS_PATTERN, never a single sound.
export const MONSTERS: Record<Kind, { weak: SoundId | 'rhythm'; hp: number }> = {
  bat: { weak: 'click', hp: 1 },
  ghost: { weak: 'clap', hp: 1 },
  skeleton: { weak: 'knock', hp: 2 },
  pumpkin: { weak: 'pop', hp: 1 },
  warden: { weak: 'rhythm', hp: 3 },
};

// Two knocks, a rest, one knock.
export const BOSS_PATTERN = 'knock knock _ knock';
