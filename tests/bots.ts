import { chebyshev } from '../src/core/planner';
import { Game } from '../src/core/game';
import type { LevelDef } from '../src/core/types';

export const DT = 1 / 30;

/** A careful player: rejects traps, keeps robots clear of workers, never wastes permits. */
export function playCareful(level: LevelDef, maxSec = 200) {
  const g = new Game(level);
  const nearWorker = (c: readonly [number, number], margin: number) =>
    g.workers.some((w) => chebyshev(c, w.pos) <= w.def.zoneRadius + margin);
  while (g.status === 'playing' && g.time < maxSec) {
    for (const r of g.robots) {
      if (r.state === 'executing') {
        const ahead = g.remainingPath(r).slice(1, 3);
        if (ahead.some((c) => nearWorker(c, 1))) g.stop(r.id);
      }
      if (r.state === 'proposed') {
        if (r.trap) {
          g.reject(r.id);
          continue;
        }
        const ahead = r.route!.slice(0, 6);
        if (ahead.some((c) => nearWorker(c, 2))) continue; // wait for the worker to pass
        const p = g.permits.find((x) => x.state === 'held') ?? g.dispensePermit();
        if (p) g.grant(p.id, r.id);
      }
    }
    g.update(DT);
  }
  return g;
}

/** A careless player: grants every proposal at once and never stops anything. */
export function playCareless(level: LevelDef, maxSec = 200) {
  const g = new Game(level);
  while (g.status === 'playing' && g.time < maxSec) {
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
