import { Game } from '../core/game';
import { chebyshev } from '../core/planner';
import { mulberry32 } from '../core/rng';
import type { Cell, LevelDef } from '../core/types';

export const DT = 1 / 30;

const nearWorker = (g: Game, c: Cell, margin: number) => g.workers.some((w) => chebyshev(c, w.pos) <= w.def.zoneRadius + margin);

/** Called once per frame before the simulation steps; lets metrics observe the game. */
export type Observer = (g: Game) => void;

/** A careful player with instant reactions: rejects traps, keeps robots clear of workers, never wastes permits. */
export function playCareful(level: LevelDef, maxSec = 200, observe?: Observer) {
  const g = new Game(level);
  while (g.status === 'playing' && g.time < maxSec) {
    observe?.(g);
    for (const r of g.robots) {
      if (r.state === 'executing' && g.remainingPath(r).slice(1, 3).some((c) => nearWorker(g, c, 1))) g.stop(r.id);
      if (r.state === 'proposed') {
        if (r.trap) {
          g.reject(r.id);
          continue;
        }
        if (r.route!.slice(0, 6).some((c) => nearWorker(g, c, 2))) continue;
        const p = g.permits.find((x) => x.state === 'held') ?? g.dispensePermit();
        if (p) g.grant(p.id, r.id);
      }
    }
    g.update(DT);
  }
  return g;
}

/** A careless player: grants every proposal at once and never stops anything. */
export function playCareless(level: LevelDef, maxSec = 200, observe?: Observer) {
  const g = new Game(level);
  while (g.status === 'playing' && g.time < maxSec) {
    observe?.(g);
    for (const r of g.robots) {
      if (r.state === 'proposed') {
        const p = g.dispensePermit();
        if (p) g.grant(p.id, r.id);
      }
    }
    g.update(DT);
  }
  return g;
}

/**
 * A first-time player model: notices proposals after a human-like delay, misses
 * some shortcuts, and is slow (sometimes too slow) to stop robots near workers.
 * Varies by seed, so many runs give a win-rate estimate for a level.
 */
export function playNovice(level: LevelDef, seed: number, maxSec = 200, observe?: Observer) {
  const g = new Game(level);
  const rnd = mulberry32(seed);
  const noticed = new Map<string, number>(); // robot -> time a decision will be made
  const danger = new Map<string, number>();
  const missTrap = 0.3;
  const missStop = 0.25;
  while (g.status === 'playing' && g.time < maxSec) {
    observe?.(g);
    for (const r of g.robots) {
      if (r.state === 'proposed') {
        if (!noticed.has(r.id)) noticed.set(r.id, g.time + 0.8 + rnd() * 1.6);
        if (g.time < noticed.get(r.id)!) continue;
        noticed.delete(r.id);
        if (r.trap && rnd() > missTrap) {
          g.reject(r.id);
          continue;
        }
        const p = g.permits.find((x) => x.state === 'held') ?? g.dispensePermit();
        if (p) g.grant(p.id, r.id);
      } else noticed.delete(r.id);

      if (r.state === 'executing' && g.remainingPath(r).slice(1, 3).some((c) => nearWorker(g, c, 0))) {
        if (!danger.has(r.id)) danger.set(r.id, rnd() < missStop ? Infinity : g.time + 0.3 + rnd() * 0.5);
        if (g.time >= danger.get(r.id)!) {
          g.stop(r.id);
          danger.delete(r.id);
        }
      } else danger.delete(r.id);
    }
    g.update(DT);
  }
  return g;
}
