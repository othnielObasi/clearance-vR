import { describe, expect, it } from 'vitest';
import { MAX_OBJECT_CELLS, splitObjects } from '../src/xr/desk-scan';

const W = 12;
const H = 8;
const set = (cells: [number, number][]) => new Set(cells.map(([x, y]) => y * W + x));

describe('desk scanner: objects vs furniture', () => {
  it('a mug-sized blob becomes a wall', () => {
    const r = splitObjects(set([[3, 3], [4, 3], [3, 4], [4, 4]]), W, H);
    expect(r.cells).toHaveLength(4);
    expect(r.obstructed).toBe(false);
  });

  it('a monitor overhanging the back rows is ignored and reported', () => {
    const band: [number, number][] = [];
    for (let x = 1; x <= 10; x++) band.push([x, 1], [x, 2]);
    const r = splitObjects(set([...band, [8, 5]]), W, H);
    expect(r.obstructed).toBe(true);
    expect(r.cells).toEqual([[8, 5]]); // the separate small object still counts
  });

  it('diagonal neighbours belong to the same object', () => {
    const diag: [number, number][] = Array.from({ length: MAX_OBJECT_CELLS + 1 }, (_, i) => [i, i] as [number, number]);
    expect(splitObjects(set(diag), W, H).obstructed).toBe(true);
  });

  it('two small objects are both kept', () => {
    const r = splitObjects(set([[0, 0], [1, 0], [9, 6], [10, 6], [10, 7]]), W, H);
    expect(r.cells).toHaveLength(5);
    expect(r.obstructed).toBe(false);
  });
});
