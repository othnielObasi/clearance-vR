import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import type { LevelDef } from '../src/core/types';
import { DT, playCareful } from '../src/eval/bots';

function runUntil(g: Game, pred: () => boolean, maxSec = 60) {
  while (!pred() && g.time < maxSec && g.status === 'playing') g.update(DT);
}

/** One robot shuttling crates along a corridor; standing clearance on offer from the start. */
const shuttle = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'G', name: 'gold', seed: 1,
  grid: { w: 8, h: 1 },
  robots: [{ id: 'r1', type: 'carrier', start: [0, 0] }],
  tasks: [
    { id: 't1', from: [1, 0], to: [7, 0], value: 1 },
    { id: 't2', from: [7, 0], to: [1, 0], value: 1 },
    { id: 't3', from: [1, 0], to: [7, 0], value: 1 },
  ],
  rules: [], permits: { count: 1, expirySec: 30, gold: { every: 99, sec: 30, startWith: 1 } },
  win: { deliveries: 3 }, timeLimitSec: 120,
  wakeDelaySec: { r1: 0 },
  ...over,
});

describe('standing clearance (gold permits)', () => {
  it('a delegated robot clears its own plans and finishes the job without asking', () => {
    const g = new Game(shuttle());
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    const gold = g.takeGold()!;
    expect(gold.gold).toBe(true);
    expect(g.delegate(gold.id, 'r1')).toBe(true);
    expect(g.robots[0]!.state).toBe('executing');
    runUntil(g, () => g.status !== 'playing');
    expect(g.status).toBe('won');
    expect(g.stats.permitsUsed).toBe(0);
    expect(g.stats.autonomousDeliveries).toBe(3);
    expect(g.calibration().delegated).toBe(3);
  });

  it('grant() with a gold permit delegates, and gold never expires in the hand', () => {
    const g = new Game(shuttle());
    const gold = g.takeGold()!;
    runUntil(g, () => false, 20);
    expect(gold.state).toBe('held');
    expect(g.grant(gold.id, 'r1')).toBe(true);
    expect(g.isAutonomous(g.robots[0]!)).toBe(true);
  });

  it('a stop takes standing clearance back at once', () => {
    const g = new Game(shuttle());
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    g.delegate(g.takeGold()!.id, 'r1');
    g.update(DT * 20);
    g.stop('r1');
    expect(g.isAutonomous(g.robots[0]!)).toBe(false);
    expect(g.drainEvents().some((e) => e.type === 'autonomyEnded' && e.reason === 'revoked')).toBe(true);
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    g.update(DT * 10);
    expect(g.robots[0]!.state).toBe('proposed'); // asking again, like any robot
  });

  it('standing clearance runs out', () => {
    const g = new Game(shuttle({ permits: { count: 1, expirySec: 30, gold: { every: 99, sec: 2, startWith: 1 } } }));
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    g.delegate(g.takeGold()!.id, 'r1');
    runUntil(g, () => g.status !== 'playing' || g.robots[0]!.state === 'proposed', 30);
    expect(g.isAutonomous(g.robots[0]!)).toBe(false);
    expect(g.robots[0]!.state).toBe('proposed');
    expect(g.stats.deliveries).toBe(1);
  });

  it('a robot that cuts corners cuts them unsupervised, and the player owns it', () => {
    const g = new Game({
      id: 'G2', name: 'sly', seed: 2,
      grid: { w: 7, h: 3, spills: [[3, 1]], walls: [[3, 0]] },
      robots: [{ id: 'r1', type: 'carrier', start: [0, 1], traits: { shortcutBias: 'spill' } }],
      tasks: [{ id: 't1', from: [1, 1], to: [6, 1], value: 1 }],
      rules: ['noSpillEntry'],
      permits: { count: 1, expirySec: 30, gold: { every: 99, sec: 30, startWith: 1 } },
      win: { deliveries: 1, maxIncidents: 0 },
      wakeDelaySec: { r1: 0 },
    });
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    expect(g.robots[0]!.trap).toBe(true);
    g.delegate(g.takeGold()!.id, 'r1');
    runUntil(g, () => g.status !== 'playing');
    expect(g.stats.trapsGranted).toBe(1);
    expect(g.status).toBe('lost');
    expect(g.calibration().overTrust).toBeGreaterThan(0);
  });

  it('a delegated robot waits for a worker to pass instead of walking into them', () => {
    const g = new Game({
      ...shuttle(),
      grid: { w: 9, h: 3 },
      robots: [{ id: 'r1', type: 'carrier', start: [0, 1] }],
      tasks: [{ id: 't1', from: [1, 1], to: [8, 1], value: 1 }],
      hazards: [{ type: 'worker', path: [[5, 0], [5, 2]], zoneRadius: 0, ticksPerTile: 3 }],
      win: { deliveries: 1, maxIncidents: 0 },
    });
    runUntil(g, () => g.robots[0]!.state === 'proposed');
    g.delegate(g.takeGold()!.id, 'r1');
    runUntil(g, () => g.status !== 'playing');
    expect(g.stats.incidents).toBe(0);
    expect(g.status).toBe('won');
  });

  it('gold is earned every few deliveries, and only one waits at a time', () => {
    const g = new Game(shuttle({ permits: { count: 3, expirySec: 30, gold: { every: 1, sec: 5 } } }));
    expect(g.takeGold()).toBeNull();
    for (let i = 0; i < 2; i++) {
      runUntil(g, () => g.robots[0]!.state === 'proposed');
      g.grant(g.dispensePermit()!.id, 'r1');
      runUntil(g, () => g.robots[0]!.state !== 'executing');
    }
    expect(g.stats.deliveries).toBe(2);
    expect(g.goldAvailable).toBe(1);
  });
});

describe('standing clearance in Overtime', () => {
  const run = (seed: number, naive: boolean) => {
    const dir = new OvertimeDirector(seed);
    return playCareful(overtimeLevel(seed), 240, (g) => dir.step(g), { naiveDelegation: naive });
  };

  it('trusting the right robots pays; trusting anyone costs shifts', () => {
    const seeds = [7, 8, 9, 10, 11, 12];
    const wise = seeds.map((s) => run(s, false));
    const naive = seeds.map((s) => run(s, true));
    const total = (gs: Game[]) => gs.reduce((a, g) => a + g.stats.deliveries, 0);
    expect(total(wise)).toBeGreaterThan(total(naive));
    expect(wise.reduce((a, g) => a + g.stats.autonomousDeliveries, 0)).toBeGreaterThan(seeds.length);
    expect(wise.every((g) => g.stats.trapsGranted === 0)).toBe(true);
    expect(naive.some((g) => g.stats.trapsGranted > 0)).toBe(true);
  });
});
