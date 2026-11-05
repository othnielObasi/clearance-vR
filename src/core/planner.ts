import type { Cell } from './types';

export const key = (x: number, y: number) => y * 1000 + x;
export const cellKey = (c: Cell) => key(c[0], c[1]);
export const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
export const manhattan = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
export const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

export interface RouteQuery {
  w: number;
  h: number;
  start: Cell;
  goal: Cell;
  /** Impassable for this robot right now. */
  blocked: (x: number, y: number) => boolean;
  /** Extra cost for entering a cell (0 = normal). */
  extraCost?: (x: number, y: number) => number;
}

const DIRS: Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Spatial A* over the tile grid. Returns the route including start and goal,
 * or null when the goal cannot be reached. Deterministic: ties break by
 * insertion order and a fixed direction order.
 */
export function findRoute(q: RouteQuery): Cell[] | null {
  const { w, h, start, goal } = q;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  if (!inBounds(goal[0], goal[1])) return null;
  if (sameCell(start, goal)) return [start];

  const open: { c: Cell; f: number; g: number; order: number }[] = [];
  const gScore = new Map<number, number>();
  const came = new Map<number, Cell>();
  let order = 0;
  gScore.set(cellKey(start), 0);
  open.push({ c: start, f: manhattan(start, goal), g: 0, order: order++ });

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[bi]!;
      if (a.f < b.f || (a.f === b.f && a.order < b.order)) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    if (sameCell(cur.c, goal)) {
      const route: Cell[] = [cur.c];
      let k = cellKey(cur.c);
      while (came.has(k)) {
        const p = came.get(k)!;
        route.push(p);
        k = cellKey(p);
      }
      return route.reverse();
    }
    if (cur.g > (gScore.get(cellKey(cur.c)) ?? Infinity)) continue;
    for (const [dx, dy] of DIRS) {
      const nx = cur.c[0] + dx;
      const ny = cur.c[1] + dy;
      if (!inBounds(nx, ny)) continue;
      const isGoal = nx === goal[0] && ny === goal[1];
      if (!isGoal && q.blocked(nx, ny)) continue;
      const ng = cur.g + 1 + (q.extraCost?.(nx, ny) ?? 0);
      const nk = key(nx, ny);
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, cur.c);
        const c: Cell = [nx, ny];
        open.push({ c, g: ng, f: ng + manhattan(c, goal), order: order++ });
      }
    }
  }
  return null;
}

/** Space-time reservations: who holds which cell at which tick. */
export class Reservations {
  private table = new Map<string, string>();
  /** Cells held indefinitely from a tick onward (robot parked at path end). */
  private parked = new Map<number, { robot: string; from: number }>();

  private k(x: number, y: number, t: number) {
    return `${x},${y},${t}`;
  }

  holder(x: number, y: number, t: number): string | undefined {
    const timed = this.table.get(this.k(x, y, t));
    if (timed) return timed;
    const p = this.parked.get(key(x, y));
    return p && t >= p.from ? p.robot : undefined;
  }

  reserve(robot: string, timed: Cell[], startTick: number) {
    timed.forEach((c, i) => this.table.set(this.k(c[0], c[1], startTick + i), robot));
    const last = timed[timed.length - 1];
    if (last) this.parked.set(cellKey(last), { robot, from: startTick + timed.length - 1 });
  }

  park(robot: string, c: Cell, fromTick: number) {
    this.parked.set(cellKey(c), { robot, from: fromTick });
  }

  release(robot: string) {
    for (const [k, v] of this.table) if (v === robot) this.table.delete(k);
    for (const [k, v] of this.parked) if (v.robot === robot) this.parked.delete(k);
  }

  /** Drop timed entries before a tick to keep the table small. */
  prune(beforeTick: number) {
    for (const k of this.table.keys()) {
      const t = Number(k.slice(k.lastIndexOf(',') + 1));
      if (t < beforeTick) this.table.delete(k);
    }
  }
}

/**
 * Turn a spatial route into a timed path starting at `startTick` by inserting
 * waits wherever another robot holds the next cell (or would swap with us).
 * Returns null if the robot would wait longer than `maxWait` ticks in a row.
 */
export function timeRoute(
  robot: string,
  route: Cell[],
  startTick: number,
  res: Reservations,
  maxWait = 12,
): Cell[] | null {
  if (!route.length) return null;
  const timed: Cell[] = [route[0]!];
  let t = startTick;
  let i = 0;
  let waited = 0;
  while (i < route.length - 1) {
    const cur = route[i]!;
    const nxt = route[i + 1]!;
    const other = res.holder(nxt[0], nxt[1], t + 1);
    const swap = res.holder(nxt[0], nxt[1], t);
    const swapping = swap && swap !== robot && res.holder(cur[0], cur[1], t + 1) === swap;
    if ((other && other !== robot) || swapping) {
      timed.push(cur);
      waited++;
      if (waited > maxWait) return null;
    } else {
      timed.push(nxt);
      i++;
      waited = 0;
    }
    t++;
  }
  return timed;
}
