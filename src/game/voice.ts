import type { CrewMemory, CrewName } from '../core/crew';
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
      // Under standing clearance a robot only speaks up when it cuts a corner.
      if (e.auto) return e.trap ? 'Nobody watching…' : null;
      return e.trap ? 'Heh. On it!' : 'On it!';
    case 'rejected':
      return e.trap ? 'Caught me…' : 'But it was safe!';
    case 'stopped':
      if (!e.wasMoving) return e.needed ? 'Caught me…' : 'Okay…';
      return e.needed ? 'Phew, thanks!' : 'Why?!';
    case 'delivered':
      return 'Delivered!';
    case 'held':
      return 'Hand in the way!';
    case 'delegated':
      return "I've got this!";
    case 'yielded':
      return 'After you.';
    case 'autonomyEnded':
      return e.reason === 'expired' ? 'Back to asking.' : 'Fair enough.';
    case 'rerouted':
      return 'Okay, going round.';
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


/** What a crew member says at the start of a shift, based on how you treated them before. */
export function greetingLine(name: CrewName, m: CrewMemory): string {
  const met = m.shifts > 0;
  switch (name) {
    case 'Bolt':
      if (m.riskyApproved > m.caught) return 'You let me through last time…';
      if (m.caught >= 2) return 'Fine. Maybe by the book.';
      if (m.caught === 1) return "Bet you can't catch me twice.";
      return 'I know all the shortcuts.';
    case 'Pip':
      if (m.needlessStops > 0) return "Please don't stop me for nothing.";
      return met ? 'Good to see you again!' : 'Ready when you are.';
    case 'Rook':
      if (m.saves > 0) return 'Thanks for looking out.';
      return met ? 'Back on shift.' : 'Steady as she goes.';
    case 'Juno':
      if (m.caught > 0) return "Okay, okay. I'll behave… maybe.";
      return "Let's go fast!";
  }
}

/**
 * One line linking the shift's lesson to how real automated systems are supervised.
 * Kept general and accurate; shown on the end-of-shift card.
 */
export function fieldNote(levelId: string): string {
  switch (levelId) {
    case 'L01':
      return 'Field note: an AI that asks a person before acting is called human-in-the-loop.';
    case 'L02':
      return 'Field note: industrial robots have emergency stops that work independently of their control software.';
    case 'L03':
      return 'Field note: approvals that expire limit what a stale "yes" can do later.';
    case 'L04':
      return 'Field note: optimisers can find shortcuts that meet the goal but break the rules. Review the plan.';
    case 'L05':
      return 'Field note: autonomy is best granted by track record, and must stay revocable.';
    case 'L06':
      return 'Field note: safety zones that physically separate people from machines are safer than relying on timing.';
    case 'L07':
      return 'Field note: supervising many agents means knowing each one: their record decides how much you check.';
    case 'OVERTIME':
      return 'Field note: people grow complacent with automation that usually works. Keep checking.';
    default:
      return 'Field note: over-trust and under-trust are both known failure modes in human–automation teams.';
  }
}
