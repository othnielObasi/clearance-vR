import { describe, expect, it } from 'vitest';
import { evaluateLevel } from '../src/eval/metrics';
import { LEVELS } from '../src/levels';

/** Target bands for a first-time player. Retune levels if these fail. */
const BANDS: Record<string, { win: [number, number]; minPressure: number }> = {
  L01: { win: [0.9, 1], minPressure: 0 },
  L02: { win: [0.7, 0.95], minPressure: 0 },
  L03: { win: [0.5, 0.8], minPressure: 0.15 },
  L04: { win: [0.45, 0.8], minPressure: 0.15 },
};

describe('difficulty curve', () => {
  for (const level of LEVELS) {
    const band = BANDS[level.id];
    if (!band) continue;
    it(`${level.id} sits in its novice win band and pressure target`, () => {
      const m = evaluateLevel(level, 30);
      expect(m.noviceWinRate).toBeGreaterThanOrEqual(band.win[0]);
      expect(m.noviceWinRate).toBeLessThanOrEqual(band.win[1]);
      expect(m.pressure).toBeGreaterThanOrEqual(band.minPressure);
      expect(m.careful.stars).toBe(3);
    });
  }
});
