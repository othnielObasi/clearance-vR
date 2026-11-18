import { afterEach, describe, expect, it, vi } from 'vitest';
import { crewMemory, loadProgress, overtimeBest, saveDaily, saveResult, streakEnding } from '../src/game/progress';

function storage(values: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
  });
  return values;
}
afterEach(() => vi.unstubAllGlobals());

describe('saved data recovery', () => {
  it.each(['null', '[]', '"bad"', '{', '{}', '{"results":null}'])('recovers from malformed daily data: %s', raw => {
    storage({ 'clearance.daily.v1': raw });
    expect(streakEnding('20261117')).toBe(0);
    expect(saveDaily('20261117', true, 3, 100)).toBe(1);
  });

  it('preserves valid progress and discards invalid star values', () => {
    const values = storage({ 'clearance.progress.v1': JSON.stringify({ unlocked: 2, stars: { L01: 3, L02: '3', L03: -1 } }) });
    expect(loadProgress()).toEqual({ unlocked: 2, stars: { L01: 3 } });
    saveResult(1, 'L02', 2, 7);
    expect(JSON.parse(values['clearance.progress.v1']!).stars).toEqual({ L01: 3, L02: 2 });
  });

  it('repairs crew counters instead of concatenating corrupt strings', () => {
    storage({ 'clearance.crew.v1': JSON.stringify({ Bolt: { caught: '4', saves: -2, shifts: 3 } }) });
    expect(crewMemory('Bolt')).toEqual({ caught: 0, riskyApproved: 0, needlessStops: 0, saves: 0, delivered: 0, shifts: 3 });
  });

  it.each(['Infinity', '-4', 'NaN', '2.5'])('ignores invalid Overtime best %s', raw => {
    storage({ 'clearance.overtime.v1': raw });
    expect(overtimeBest()).toBe(0);
  });

  it('still permits playing when storage is denied', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
    expect(loadProgress()).toEqual({ unlocked: 0, stars: {} });
    expect(() => saveResult(0, 'L01', 3, 7)).not.toThrow();
    expect(saveDaily('20261117', true, 3, 100)).toBe(1);
  });
});
