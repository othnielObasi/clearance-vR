import { describe, expect, it } from 'vitest';
import { findRoute, Reservations, timeRoute } from '../src/core/planner';
import type { Cell } from '../src/core/types';

const open = () => false;

describe('findRoute', () => {
  it('finds a shortest straight route', () => {
    const r = findRoute({ w: 5, h: 1, start: [0, 0], goal: [4, 0], blocked: open });
    expect(r).toHaveLength(5);
  });

  it('goes around a wall', () => {
    const wall = new Set(['2,0', '2,1']);
    const r = findRoute({ w: 5, h: 3, start: [0, 0], goal: [4, 0], blocked: (x, y) => wall.has(`${x},${y}`) })!;
    expect(r.some(([x, y]) => wall.has(`${x},${y}`))).toBe(false);
    expect(r[r.length - 1]).toEqual([4, 0]);
  });

  it('returns null when the goal is sealed off', () => {
    const r = findRoute({ w: 5, h: 1, start: [0, 0], goal: [4, 0], blocked: (x) => x === 2 });
    expect(r).toBeNull();
  });

  it('prefers cheaper cells when costs are added', () => {
    const r = findRoute({ w: 3, h: 3, start: [0, 1], goal: [2, 1], blocked: open, extraCost: (x, y) => (x === 1 && y === 1 ? 10 : 0) })!;
    expect(r.some(([x, y]) => x === 1 && y === 1)).toBe(false);
  });

  it('is deterministic', () => {
    const q = { w: 8, h: 8, start: [0, 0] as Cell, goal: [7, 7] as Cell, blocked: open };
    expect(findRoute(q)).toEqual(findRoute(q));
  });
});

describe('timeRoute', () => {
  it('waits for a cell another robot holds', () => {
    const res = new Reservations();
    res.reserve('other', [[1, 0], [1, 0], [2, 0]], 0); // holds [1,0] at t=0,1 then moves
    const timed = timeRoute('me', [[0, 0], [1, 0]], 0, res)!;
    expect(timed[0]).toEqual([0, 0]);
    expect(timed.at(-1)).toEqual([1, 0]);
    expect(timed.length).toBeGreaterThan(2);
  });

  it('gives up when blocked for too long', () => {
    const res = new Reservations();
    res.park('wall-bot', [1, 0], 0);
    expect(timeRoute('me', [[0, 0], [1, 0]], 0, res, 5)).toBeNull();
  });

  it('refuses head-on swaps', () => {
    const res = new Reservations();
    res.reserve('other', [[1, 0], [0, 0]], 0);
    const timed = timeRoute('me', [[0, 0], [1, 0]], 0, res, 3);
    // Either waits or fails; must never sit in [1,0] at t=1 while other moves into [0,0].
    if (timed) expect(timed[1]).not.toEqual([1, 0]);
  });
});
