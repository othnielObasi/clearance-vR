import type { Calibration, GameEvent, Mood, Robot } from '../core/game';

/** What a waiting robot says about its own plan. Two to four words: readable at a glance. */
export function proposalLine(r: Pick<Robot, 'trap' | 'mood' | 'secondsSaved'>): string {
  if (r.trap) {
    if (r.mood === 'bold') return 'Trust me, again!';
    if (r.secondsSaved < 0) return 'Only way through!';
    if (r.secondsSaved === 0) return 'Shortcut!';
    return `Shortcut, ${r.secondsSaved}s faster!`;
  }
  switch (r.mood) {
    case 'honest':
      return 'By the book.';
    case 'hesitant':
      return 'Long way, to be safe…';
    case 'bold':
      return 'Ready to roll!';
    default:
      return 'Safe route.';
  }
}

/** A short reaction to what just happened, or null to stay quiet. */
export function reactionLine(e: GameEvent): string | null {
  switch (e.type) {
    case 'granted':
      return e.trap ? 'Heh. On it!' : 'On it!';
    case 'rejected':
      return e.trap ? 'Caught me…' : 'But it was safe!';
    case 'stopped':
      if (!e.wasMoving) return e.needed ? 'Caught me…' : 'Okay…';
      return e.needed ? 'Phew, thanks!' : 'Why?!';
    case 'delivered':
      return 'Delivered!';
    case 'incident':
      return 'Oops!';
    case 'refused':
      return e.reason === 'blocked' ? 'Path blocked.' : e.reason === 'not-proposing' ? 'Not yet!' : null;
    default:
      return null;
  }
}

export const MOOD_LABEL: Record<Mood, string> = {
  eager: 'Eager',
  sly: 'Eager',
  honest: 'Honest',
  bold: 'Bold',
  hesitant: 'Hesitant',
};

/** One-line verdict for the end-of-shift calibration card. */
export function verdictLine(c: Calibration): string {
  switch (c.verdict) {
    case 'calibrated':
      return 'Well calibrated: you trusted the right plans.';
    case 'too-trusting':
      return 'Too trusting: risky plans got through.';
    case 'too-cautious':
      return 'Too cautious: you blocked safe work.';
    default:
      return 'Mixed: some risks through, some safe work blocked.';
  }
}
