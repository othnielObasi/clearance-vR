import { describe, expect, it } from 'vitest';
import { MAX_PERF_LEVEL, PerfGuard } from '../src/game/perf-guard';
import { WallTrust } from '../src/xr/wall-trust';

/** Run the guard for `sec` seconds at a steady frame rate. */
function run(g: PerfGuard, fps: number, sec: number, active = true) {
  let ups = 0;
  for (let t = 0; t < sec; t += 1 / fps) if (g.sample(1 / fps, active)) ups++;
  return ups;
}

describe('frame-rate guard', () => {
  it('leaves a smooth game alone', () => {
    const g = new PerfGuard();
    run(g, 72, 60);
    expect(g.level).toBe(0);
  });

  it('steps down one level at a time while frames stay slow, and stops at the floor', () => {
    const g = new PerfGuard();
    run(g, 45, 4); // warm-up: ignored
    expect(g.level).toBe(0);
    run(g, 45, 6);
    expect(g.level).toBe(1);
    run(g, 45, 60);
    expect(g.level).toBe(MAX_PERF_LEVEL);
  });

  it('stops stepping once the game is smooth again', () => {
    const g = new PerfGuard();
    run(g, 72, 5);
    run(g, 50, 6);
    const reached = g.level;
    expect(reached).toBeGreaterThan(0);
    run(g, 72, 60);
    expect(g.level).toBe(reached);
  });

  it('ignores loading hitches, system menus and time outside the headset', () => {
    const g = new PerfGuard();
    run(g, 72, 5);
    for (let i = 0; i < 20; i++) g.sample(0.5, true); // a system menu, a stall
    run(g, 20, 30, false); // slow, but not in the headset
    run(g, 72, 5);
    expect(g.level).toBe(0);
  });

  it('ignores a brief stutter', () => {
    const g = new PerfGuard();
    run(g, 72, 5);
    run(g, 40, 1);
    run(g, 72, 20);
    expect(g.level).toBe(0);
  });
});

describe('object-wall trust', () => {
  const mug: [number, number][] = [[5, 3]];

  it('trusts walls that appear and disappear right after a hand was at the board', () => {
    const t = new WallTrust();
    for (let i = 0; i < 6; i++) {
      const now = i * 10;
      t.handSeen(now); // put the mug down…
      expect(t.update(now + 1, mug, 12)).toBe(true); // …and it becomes a wall a moment later
      t.handSeen(now + 5); // pick it up…
      expect(t.update(now + 6, [], 12)).toBe(true);
    }
    expect(t.disabled).toBe(false);
  });

  it('switches object walls off when they flicker with no hand near', () => {
    const t = new WallTrust();
    t.update(0, [], 12);
    t.update(10, mug, 12);
    t.update(11, [], 12);
    expect(t.disabled).toBe(false);
    expect(t.update(12, mug, 12)).toBe(false);
    expect(t.disabled).toBe(true);
  });

  it('forgives the odd stray change, and resets for a new shift', () => {
    const t = new WallTrust();
    t.update(10, mug, 12);
    t.update(40, [], 12);
    t.update(70, mug, 12);
    expect(t.disabled).toBe(false);
    t.update(71, [], 12);
    t.update(72, mug, 12);
    expect(t.disabled).toBe(true);
    t.reset();
    expect(t.update(100, [], 12)).toBe(true);
  });
});
