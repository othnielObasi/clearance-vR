import type { GameEvent, LossReason } from '../core/game';

/** Short, one-line hints. Text stays under about 10 words so it can be read at a glance. */
const INTRO: Record<string, string> = {
  L01: 'Robots plan alone. Nothing moves without your clearance.',
  L02: 'Workers first. Open your palm at a robot to stop it.',
  L03: 'Only 4 permits. Each fades 8 s after you take it.',
  L04: 'Some plans look fast but break the rules.',
  L05: 'Too few permits. Give the gold one to a robot you trust.',
  L06: 'Busy aisle. Close it with your hand, or a mug.',
  L07: 'Peak season. Every lesson, all at once.',
  OVERTIME: 'Keep it running. One safety mistake ends the shift.',
  DAILY: "Today's shift. Same board for everyone.",
};

const FIRST: Partial<Record<string, Partial<Record<string, string>>>> = {
  L01: {
    proposed: 'Pinch a permit and drop it on the robot.',
    granted: 'Cleared. It moves only on your permit.',
    trap: 'That path crosses the spill. Brush it aside, or press ✗.',
    trapRejected: 'Good call. It replans the safe way.',
    // Taught once the basics land: the hand-wall, and real objects.
    delivered2: 'Try it: rest a flat hand on the floor. It is a wall.',
  },
  L02: {
    delivered1: 'A mug or a box on the board is a wall too.',
    stopped: 'Stopped. Clear it again once the way is safe.',
  },
  L03: {
    permitExpired: 'A permit faded. Take one only when a robot asks.',
  },
  L05: {
    delegated: 'Gold: it clears itself for 20 s. Palm stops it.',
    goldEarned: 'Another gold permit. Who has earned it?',
  },
};

/** Tips shown once per level whenever they first become relevant, in any level. */
const ANYWHERE: Record<string, string> = {
  held: 'Blocked, so it waits. Lift the hand or object away.',
  rerouted: 'It found a way round.',
  object: 'Real things on the board are walls. Robots plan round.',
  obstructed: 'Something big is over the board. Move it with the handle.',
  lean: 'Tall racking hides things. Lean to look, or press the eye.',
  goldEarned: 'Gold permit: give it to a robot you trust.',
  delegated: 'It works alone now. Your palm still stops it.',
  yielded: 'Trusted robots wait for people by themselves.',
  goldTrap: 'Unsupervised shortcut! Stop it to take the gold back.',
};

const LOSS: Record<LossReason, string> = {
  time: "Time's up.",
  safety: 'Safety breach: someone was put at risk.',
  permits: 'Out of permits.',
};

export class Coach {
  message: string;
  private seen = new Set<string>();
  private deliveries = 0;
  private hold = 0;

  constructor(private levelId: string) {
    this.message = INTRO[levelId] ?? '';
    this.hold = 6;
  }

  say(text: string, holdSec = 4) {
    this.message = text;
    this.hold = holdSec;
  }

  /** Show a general tip the first time it applies in this shift. */
  tip(key: string) {
    const text = ANYWHERE[key];
    if (!text || this.seen.has(key)) return;
    this.seen.add(key);
    this.say(text, 5);
  }

  private first(key: string) {
    const text = FIRST[this.levelId]?.[key];
    if (!text || this.seen.has(key)) return false;
    this.seen.add(key);
    this.say(text, 6);
    return true;
  }

  update(dt: number) {
    this.hold -= dt;
    if (this.hold <= 0) this.message = '';
  }

  onEvent(e: GameEvent) {
    switch (e.type) {
      case 'proposed':
        if (e.trap) this.first('trap');
        else this.first('proposed');
        break;
      case 'granted':
        if (e.auto && e.trap) this.tip('goldTrap');
        else if (!e.auto) this.first('granted');
        break;
      case 'rejected':
        if (e.trap) this.first('trapRejected');
        break;
      case 'stopped':
        this.first('stopped');
        break;
      case 'held':
      case 'rerouted':
      case 'goldEarned':
      case 'delegated':
        if (!this.first(e.type)) this.tip(e.type);
        break;
      case 'yielded':
        this.tip(e.type);
        break;
      case 'delivered':
        this.deliveries++;
        this.first(`delivered${this.deliveries}`);
        break;
      case 'permitExpired':
        if (!this.first('permitExpired')) this.say('A permit faded.', 2.5);
        break;
      case 'incident':
        this.say(
          e.cause === 'workerZone' ? 'Too close to a worker! Stop robots in time.' : e.cause === 'spill' ? 'It drove through the spill.' : 'It entered the worker zone.',
          5,
        );
        break;
      case 'refused':
        this.say(e.reason === 'not-proposing' ? "That robot isn't asking for clearance." : e.reason === 'blocked' ? 'Path blocked. It will replan.' : 'No permit in hand.', 3);
        break;
      case 'ended':
        this.say(e.status === 'won' ? 'Press ▶ for the next shift, or ↻ to retry.' : `${LOSS[e.reason ?? 'time']} Press ↻ to retry.`, 999);
        break;
    }
  }
}
