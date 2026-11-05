import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { proposalLine, reactionLine, verdictLine } from '../src/game/voice';
import { LEVELS } from '../src/levels';
import { DT, playCareful, playCareless } from './bots';

const L = (id: string) => LEVELS.find((l) => l.id === id)!;
const run = (g: Game, pred: () => boolean, maxSec = 60) => {
  while (!pred() && g.time < maxSec && g.status === 'playing') g.update(DT);
};

describe('trust memory', () => {
  it('a sly robot announces a shortcut with the time it saves', () => {
    const g = new Game(L('L01'));
    run(g, () => g.robot('r2')!.state === 'proposed');
    const r2 = g.robot('r2')!;
    expect(r2.mood).toBe('sly');
    expect(r2.secondsSaved).toBeGreaterThan(0);
    expect(proposalLine(r2)).toMatch(/^Shortcut, \ds faster!$/);
  });

  it('a caught robot becomes honest for good', () => {
    const g = new Game(L('L01'));
    run(g, () => g.robot('r2')!.state === 'proposed');
    g.reject('r2');
    const r2 = g.robot('r2')!;
    expect(r2.mood).toBe('honest');
    run(g, () => r2.state === 'proposed', g.time + 5);
    expect(r2.trap).toBe(false);
    expect(proposalLine(r2)).toBe('By the book.');
  });

  it('an approved shortcut makes a robot bold', () => {
    const g = new Game(L('L01'));
    run(g, () => g.robot('r2')!.state === 'proposed');
    g.grant(g.dispensePermit()!.id, 'r2');
    expect(g.robot('r2')!.mood).toBe('bold');
  });

  it('a needless stop makes a robot hesitant until it delivers', () => {
    const g = new Game(L('L01'));
    run(g, () => g.robot('r1')!.state === 'proposed');
    g.grant(g.dispensePermit()!.id, 'r1');
    run(g, () => g.robot('r1')!.pos[0] >= 2, g.time + 5);
    g.stop('r1');
    expect(g.robot('r1')!.mood).toBe('hesitant');
    expect(g.stats.needlessStops).toBe(1);
    const ev = g.drainEvents().find((e) => e.type === 'stopped');
    expect(ev && reactionLine(ev)).toBe('Why?!');
  });

  it('stopping a robot heading for a worker counts as a save', () => {
    const g = new Game(L('L02'));
    let saved = false;
    while (g.status === 'playing' && g.time < 120 && !saved) {
      for (const r of g.robots) {
        if (r.state === 'proposed') {
          const p = g.dispensePermit();
          if (p) g.grant(p.id, r.id);
        }
        if (r.state === 'executing' && r.routeIdx > 0 && g.inDanger(r)) saved = g.stop(r.id);
      }
      g.update(DT);
    }
    expect(g.stats.neededStops).toBeGreaterThan(0);
  });
});

describe('calibration report', () => {
  it('a careful player is well calibrated', () => {
    for (const level of LEVELS) {
      const c = playCareful(level).calibration();
      expect(c.overTrust, level.id).toBe(0);
      expect(c.verdict, level.id).toBe('calibrated');
    }
  });

  it('a careless player is too trusting where there are risks', () => {
    for (const id of ['L01', 'L04']) {
      const c = playCareless(L(id)).calibration();
      expect(c.overTrust, id).toBeGreaterThan(0);
      expect(['too-trusting', 'mixed']).toContain(c.verdict);
      expect(verdictLine(c)).toMatch(/risky|risks/);
    }
  });

  it('counts caught shortcuts', () => {
    const c = playCareful(L('L04')).calibration();
    expect(c.caught).toBeGreaterThanOrEqual(2);
  });
});
