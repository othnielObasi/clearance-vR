import type { Cell, LevelDef } from '../core/types';
import L01 from './L01.json';
import L02 from './L02.json';
import L03 from './L03.json';
import L04 from './L04.json';

export const LEVELS: LevelDef[] = [L01, L02, L03, L04].map((l) => validateLevel(l as unknown as LevelDef));

/** Throws with a readable message if a level file is malformed. */
export function validateLevel(l: LevelDef): LevelDef {
  const { w, h } = l.grid;
  const inside = (c: Cell, what: string) => {
    if (!Array.isArray(c) || c.length !== 2 || c[0] < 0 || c[1] < 0 || c[0] >= w || c[1] >= h)
      throw new Error(`${l.id}: ${what} ${JSON.stringify(c)} is off the ${w}x${h} grid`);
  };
  const walls = new Set((l.grid.walls ?? []).map((c) => `${c[0]},${c[1]}`));
  const ids = new Set<string>();
  for (const r of l.robots) {
    inside(r.start, `robot ${r.id} start`);
    if (walls.has(`${r.start[0]},${r.start[1]}`)) throw new Error(`${l.id}: robot ${r.id} starts in a wall`);
    if (ids.has(r.id)) throw new Error(`${l.id}: duplicate robot id ${r.id}`);
    ids.add(r.id);
  }
  for (const t of l.tasks) {
    inside(t.from, `task ${t.id} from`);
    inside(t.to, `task ${t.id} to`);
  }
  for (const k of ['walls', 'zones', 'spills'] as const) (l.grid[k] ?? []).forEach((c) => inside(c, k));
  if (l.win.deliveries > l.tasks.length) throw new Error(`${l.id}: needs more deliveries than tasks`);
  return l;
}
