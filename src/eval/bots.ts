import { Game, type Robot } from '../core/game';
import { chebyshev } from '../core/planner';
import { mulberry32 } from '../core/rng';
import type { Cell, LevelDef } from '../core/types';

export const DT = 1 / 30;

const nearWorker = (g: Game, c: Cell, margin: number) => g.workers.some((w) => chebyshev(c, w.pos) <= w.def.zoneRadius + margin);

/** Called once per frame before the simulation steps; lets metrics observe the game. */
export type Observer = (g: Game) => void;

/** Would a sensible supervisor trust this robot alone? Not one still planning shortcuts. */
export const trustworthy = (r: Robot) => r.state !== 'done' && !(r.def.traits?.shortcutBias && !r.honest);

/** Hand the gold permit to the first robot `pick` accepts. */
function useGold(g: Game, pick: (r: Robot) => boolean) {
  const target = g.robots.find((r) => !g.isAutonomous(r) && pick(r));
  if (!target) return;
  const gold = g.permits.find((p) => p.gold && p.state === 'held') ?? g.takeGold();
  if (gold) g.delegate(gold.id, target.id);
}

/** A careful player with instant reactions: rejects traps, keeps robots clear of workers, never wastes permits. */
export function playCareful(level: LevelDef, maxSec = 200, observe?: Observer, opts: { naiveDelegation?: boolean } = {}) {
  const g = new Game(level);
  const naive = !!opts.naiveDelegation;
  const waitingSince = new Map<string, number>();
  while (g.status === 'playing' && g.time < maxSec) {
    observe?.(g);
    // A naive delegator is careful with permits but hands standing clearance to anyone and never takes it back.
    // Spend a permit already in hand before delegating, so it doesn't fade unused.
    const spare = g.permits.some((p) => p.state === 'held' && !p.gold);
    if (naive || !spare) useGold(g, naive ? (r) => r.state !== 'done' : trustworthy);
    for (const r of g.robots) {
      // A robot that relapsed while on standing clearance gets it taken back.
      if (!naive && g.isAutonomous(r) && !trustworthy(r)) g.stop(r.id);
      // A robot on standing clearance is trusted a little further: stop it only when it is about to enter a zone.
      const margin = g.isAutonomous(r) ? 0 : 1;
      if (r.state === 'executing' && g.remainingPath(r).slice(1, 3).some((c) => nearWorker(g, c, margin))) g.stop(r.id);
      if (r.state === 'proposed') {
        if (r.trap) {
          g.reject(r.id);
          continue;
        }
        // Wait if the first steps run into the worker, or the route ever crosses its zone now.
        // A plan the worker has since walked into is stale: send it back to be replanned.
        if (r.route!.some((c) => nearWorker(g, c, 0))) {
          g.reject(r.id);
          continue;
        }
        // Hold off while a worker is close to the start, but not forever: a patrolling worker may never leave.
        if (r.route!.slice(0, 4).some((c) => nearWorker(g, c, 1))) {
          if (!waitingSince.has(r.id)) waitingSince.set(r.id, g.time);
          const patient = g.time - waitingSince.get(r.id)! < 4;
          if (patient || r.route!.slice(0, 2).some((c) => nearWorker(g, c, 1))) continue;
        }
        waitingSince.delete(r.id);
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
    useGold(g, (r) => r.state !== 'done');
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
  let goldPick: number | undefined;
  while (g.status === 'playing' && g.time < maxSec) {
    observe?.(g);
    if (g.goldAvailable > 0 || g.permits.some((p) => p.gold && p.state === 'held')) {
      goldPick ??= g.time + 1.5 + rnd() * 2;
      // A first-timer usually picks a sensible robot, but one time in four trusts whoever is closest.
      if (g.time >= goldPick) {
        const careless = rnd() < 0.25;
        useGold(g, (r) => (careless ? r.state !== 'done' : trustworthy(r)));
        goldPick = undefined;
      }
    }
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

/** Run Overtime with a given player bot; returns the finished game. */
export function playOvertime(
  player: 'careful' | 'careless' | 'novice',
  seed = 7,
  maxSec = 300,
): Game {
  // Imported lazily to keep the core bots free of mode-specific code.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { overtimeLevel, OvertimeDirector } = OVERTIME;
  const dir = new OvertimeDirector(seed);
  const level = overtimeLevel(seed);
  const observe: Observer = (g) => dir.step(g);
  if (player === 'careful') return playCareful(level, maxSec, observe);
  if (player === 'careless') return playCareless(level, maxSec, observe);
  return playNovice(level, seed, maxSec, observe);
}
import * as OVERTIME from '../core/overtime';
