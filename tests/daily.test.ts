import { describe, expect, it } from 'vitest';
import { generateDaily } from '../src/core/daily';
import { playCareful } from '../src/eval/bots';

describe('Daily Shift', () => {
  it('is the same level for everyone on the same UTC day', () => {
    const a = generateDaily(new Date('2026-11-06T08:00:00Z'));
    const b = generateDaily(new Date('2026-11-06T22:00:00Z'));
    expect(a.level).toEqual(b.level);
    expect(a.dateKey).toBe('20261106');
  });

  it('changes from day to day', () => {
    const a = generateDaily(new Date('2026-11-06T12:00:00Z'));
    const b = generateDaily(new Date('2026-11-07T12:00:00Z'));
    expect(a.level).not.toEqual(b.level);
  });

  it('produces a fair, winnable level for 30 consecutive days', () => {
    for (let d = 0; d < 30; d++) {
      const date = new Date(Date.UTC(2026, 10, 18 + d, 12));
      const { level } = generateDaily(date);
      const g = playCareful(level);
      expect(g.status, level.name).toBe('won');
      expect(level.robots.some((r) => r.traits?.shortcutBias)).toBe(true);
    }
  });
});
