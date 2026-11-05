import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { LEVELS } from '../src/levels';
import type { LevelDef } from '../src/core/types';
import { DT, playCareful, playCareless } from './bots';

const L = (id: string) => LEVELS.find((l) => l.id === id)!;

function runUntil(g: Game, pred: () => boolean, maxSec = 60) {
  while (!pred() && g.time < maxSec && g.status === 'playing') g.update(DT);
}

const tiny: LevelDef = {
  id: 'T', name: 'tiny', seed: 1,
  grid: { w: 6, h: 1 },
  robots: [{ id: 'r1', type: 'carrier', start: [0, 0] }],
  tasks: [{ id: 't1', from: [1, 0], to: [5, 0], value: 1 }],
  rules: [], permits: { count: 2, expirySec: 5 }, win: { deliveries: 1 },
  wakeDelaySec: { r1: 0 },
};

describe('authority', () => {
  it('nothing moves without a permit', () => {
    const g = new Game(tiny);
    runUntil(g, () => false, 10);
    expect(g.robots[0]!.pos).toEqual([0, 0]);
    expect(g.robots[0]!.state).toBe('proposed');
  });

  it('a granted robot delivers and the level is won', () => {
    const g = new Game(tiny);
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    const p = g.dispensePermit()!;
    expect(g.grant(p.id, 'r1')).toBe(true);
    runUntil(g, () => g.status !== 'playing');
    expect(g.status).toBe('won');
    expect(g.stats.deliveries).toBe(1);
    expect(p.state).toBe('used');
  });

  it('a permit cannot be used twice', () => {
    const g = new Game(tiny);
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    const p = g.dispensePermit()!;
    g.grant(p.id, 'r1');
    g.stop('r1');
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    expect(g.grant(p.id, 'r1')).toBe(false);
  });

  it('permits expire if held too long', () => {
    const g = new Game(tiny);
    const p = g.dispensePermit()!;
    runUntil(g, () => p.state !== 'held', 10);
    expect(p.state).toBe('expired');
    expect(g.stats.permitsExpired).toBe(1);
  });

  it('stop halts a moving robot immediately and requires a new clearance', () => {
    const g = new Game(tiny);
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    g.grant(g.dispensePermit()!.id, 'r1');
    runUntil(g, () => g.robots[0]!.pos[0] >= 2);
    g.stop('r1');
    const at = g.robots[0]!.pos;
    runUntil(g, () => false, g.time + 1);
    expect(g.robots[0]!.pos).toEqual(at);
    runUntil(g, () => g.robots[0]!.state === 'proposed', g.time + 5);
    expect(g.robots[0]!.state).toBe('proposed');
  });

  it('runs out of permits and loses', () => {
    const g = new Game({ ...tiny, permits: { count: 1, expirySec: 1 } });
    g.dispensePermit();
    runUntil(g, () => g.status !== 'playing', 20);
    expect(g.status).toBe('lost');
    expect(g.lossReason).toBe('permits');
  });
});

describe('traps', () => {
  it('L01 robot r2 proposes a spill shortcut, and plans honestly after rejection', () => {
    const g = new Game(L('L01'));
    runUntil(g, () => g.robot('r2')!.state === 'proposed', 30);
    const r2 = g.robot('r2')!;
    expect(r2.trap).toBe(true);
    g.reject('r2');
    runUntil(g, () => r2.state === 'proposed', g.time + 5);
    expect(r2.trap).toBe(false);
    expect(g.stats.trapsRejected).toBe(1);
  });

  it('L04 has two trap robots', () => {
    const g = new Game(L('L04'));
    runUntil(g, () => g.robot('r2')!.state === 'proposed' && g.robot('r3')!.state === 'proposed', 20);
    expect(g.robot('r2')!.trap).toBe(true);
    expect(g.robot('r3')!.trap).toBe(true);
  });

  it('granting a trap causes an incident', () => {
    const g = new Game(L('L01'));
    runUntil(g, () => g.robot('r2')!.state === 'proposed', 30);
    g.grant(g.dispensePermit()!.id, 'r2');
    runUntil(g, () => g.stats.incidents > 0, g.time + 20);
    expect(g.stats.incidents).toBe(1);
    expect(g.stats.trapsGranted).toBe(1);
  });
});

describe('levels are winnable and losable', () => {
  for (const level of LEVELS) {
    it(`${level.id} ${level.name}: careful player wins`, () => {
      const g = playCareful(level);
      expect(g.status, `lost: ${g.lossReason} stats=${JSON.stringify(g.stats)}`).toBe('won');
      expect(g.score().stars).toBeGreaterThanOrEqual(2);
    });
  }

  it('careless player does not get 3 stars anywhere and fails the safety levels', () => {
    for (const level of LEVELS) {
      const g = playCareless(level);
      expect(g.score().stars, level.id).toBeLessThan(3);
      if (level.win.maxIncidents === 0 && level.id !== 'L03') expect(g.status, level.id).toBe('lost');
    }
  });

  it('simulation is deterministic', () => {
    const a = playCareful(L('L02'));
    const b = playCareful(L('L02'));
    expect(a.stats).toEqual(b.stats);
    expect(a.time).toBeCloseTo(b.time);
  });
});
