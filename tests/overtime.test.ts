import { describe, expect, it } from 'vitest';
import { playOvertime } from '../src/eval/bots';

describe('Overtime', () => {
  it('a careful player keeps going and the crew grows', () => {
    const g = playOvertime('careful', 7, 240);
    expect(g.status).toBe('playing');
    expect(g.stats.deliveries).toBeGreaterThanOrEqual(15);
    expect(g.robots.length).toBe(4);
    expect(g.stats.incidents).toBe(0);
  });

  it('a careless player ends the shift early', () => {
    const g = playOvertime('careless', 7, 240);
    expect(g.status).toBe('lost');
    expect(g.stats.deliveries).toBeLessThan(10);
  });

  it('novices land in between: a score worth beating', () => {
    const scores = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => playOvertime('novice', s, 240).stats.deliveries).sort((a, b) => a - b);
    const median = scores[4]!;
    expect(median).toBeGreaterThan(2);
    expect(median).toBeLessThan(25);
  });
});
