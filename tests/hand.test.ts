import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { cellKey } from '../src/core/planner';
import type { Cell, LevelDef } from '../src/core/types';
import { DT } from './bots';

const run = (g: Game, pred: () => boolean, maxSec = 30) => {
  while (!pred() && g.time < maxSec && g.status === 'playing') g.update(DT);
};

// Open 10 x 5 floor: the robot's shortest route runs straight along row 2.
const open: LevelDef = {
  id: 'H', name: 'hand', seed: 3,
  grid: { w: 10, h: 5 },
  robots: [{ id: 'r1', name: 'Pip', type: 'carrier', start: [0, 2] }],
  tasks: [{ id: 't1', from: [1, 2], to: [9, 2], value: 1 }],
  rules: [], permits: { count: 3, expirySec: 20 }, win: { deliveries: 1 },
  wakeDelaySec: { r1: 0 },
};
const wall: Cell[] = [[5, 1], [5, 2], [5, 3]];

describe('your hand is a wall', () => {
  it('a waiting robot replans around the hand without using a permit', () => {
    const g = new Game(open);
    run(g, () => g.robot('r1')!.state === 'proposed');
    expect(g.robot('r1')!.route!.some((c) => c[0] === 5 && c[1] === 2)).toBe(true);
    g.setBlockers(wall);
    g.update(DT);
    const r = g.robot('r1')!;
    expect(r.state).toBe('proposed');
    expect(r.route!.some((c) => wall.some((w) => cellKey(w) === cellKey(c)))).toBe(false);
    expect(g.drainEvents().some((e) => e.type === 'rerouted')).toBe(true);
    expect(g.permitsRemaining).toBe(3);
  });

  it('a moving robot waits at the hand, keeps its permit and route, and carries on when it lifts', () => {
    const g = new Game(open);
    run(g, () => g.robot('r1')!.state === 'proposed');
    g.grant(g.dispensePermit()!.id, 'r1');
    const route = g.robot('r1')!.route!.map(cellKey);
    run(g, () => g.robot('r1')!.pos[0] >= 3);
    g.setBlockers(wall);
    run(g, () => false, g.time + 3);
    const r = g.robot('r1')!;
    expect(r.state).toBe('executing');
    expect(r.pos[0]).toBe(4); // stopped right in front of the hand
    expect(r.route!.map(cellKey)).toEqual(route); // never took an unapproved route
    expect(g.drainEvents().filter((e) => e.type === 'held')).toHaveLength(1);
    expect(g.stats.needlessStops + g.stats.neededStops).toBe(0); // not a stop
    g.setBlockers([]);
    run(g, () => g.status !== 'playing');
    expect(g.status).toBe('won');
    expect(g.stats.permitsUsed).toBe(1);
  });

  it('if the hand covers the goal, the plan waits instead of thrashing', () => {
    const g = new Game(open);
    run(g, () => g.robot('r1')!.state === 'proposed');
    g.drainEvents();
    g.setBlockers([[9, 2]]);
    run(g, () => false, g.time + 2);
    const events = g.drainEvents();
    expect(events.filter((e) => e.type === 'rerouted' || e.type === 'proposed')).toHaveLength(0);
    expect(g.robot('r1')!.state).toBe('proposed');
  });
});
