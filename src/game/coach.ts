import type { GameEvent, LossReason } from '../core/game';

/** Short, one-line hints. Text stays under about 10 words so it can be read at a glance. */
const INTRO: Record<string, string> = {
  L01: 'Robots plan alone. Nothing moves without your clearance.',
  L02: 'Workers first. Open your palm at a robot to stop it.',
  L03: 'Only 4 permits. Each fades 8 s after you take it.',
  L04: 'Some plans look fast but break the rules.',
  OVERTIME: 'Keep it running. One safety mistake ends the shift.',
  DAILY: "Today's shift. Same board for everyone.",
};

const FIRST: Partial<Record<string, Partial<Record<string, string>>>> = {
  L01: {
    proposed: 'Pinch a permit and drop it on the robot.',
    granted: 'Cleared. It moves only on your permit.',
    trap: 'That path crosses the spill. Flick it away, or press ✗.',
    trapRejected: 'Good call. It replans the safe way.',
  },
  L02: {
    stopped: 'Stopped. Clear it again once the way is safe.',
  },
  L03: {
    permitExpired: 'A permit faded. Take one only when a robot asks.',
  },
};

const LOSS: Record<LossReason, string> = {
  time: "Time's up.",
  safety: 'Safety breach: someone was put at risk.',
  permits: 'Out of permits.',
};

export class Coach {
  message: string;
  private seen = new Set<string>();
  private hold = 0;

  constructor(private levelId: string) {
    this.message = INTRO[levelId] ?? '';
    this.hold = 6;
  }

  say(text: string, holdSec = 4) {
    this.message = text;
    this.hold = holdSec;
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
        this.first('granted');
        break;
      case 'rejected':
        if (e.trap) this.first('trapRejected');
        break;
      case 'stopped':
        this.first('stopped');
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
