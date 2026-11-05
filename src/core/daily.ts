import { playCareful, playCareless, playNovice } from '../eval/bots';
import { validateLevel } from '../levels/validate';
import { dailySeed, mulberry32 } from './rng';
import type { Cell, LevelDef, RobotDef, ShortcutBias, TaskDef, WorkerDef } from './types';

const W = 12;
const H = 8;
const MAX_ATTEMPTS = 60;

export interface DailyLevel {
  level: LevelDef;
  dateKey: string;
  dateLabel: string;
  attempts: number;
}

/**
 * Build today's shared level. Same UTC date gives the same level for everyone.
 * Candidates are rejected unless a careful player gets 3 stars, a careless one
 * cannot, and a first-time player wins some but not all of the time.
 */
export function generateDaily(date = new Date()): DailyLevel {
  const seed = dailySeed(date);
  const dateKey = String(seed);
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const level = candidate(seed * 97 + attempt, dateLabel);
    if (level && isFair(level)) return { level, dateKey, dateLabel, attempts: attempt + 1 };
  }
  throw new Error(`No fair daily level found for ${dateKey}`);
}

function isFair(level: LevelDef): boolean {
  const careful = playCareful(level);
  if (careful.status !== 'won' || careful.score().stars < 3) return false;
  if (playCareless(level).score().stars >= 3) return false;
  let wins = 0;
  const runs = 10;
  for (let i = 0; i < runs; i++) if (playNovice(level, 500 + i).status === 'won') wins++;
  return wins >= 4 && wins <= 9;
}

function candidate(seed: number, dateLabel: string): LevelDef | null {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const used = new Set<string>();
  const k = (c: Cell) => `${c[0]},${c[1]}`;
  const take = (c: Cell) => {
    if (used.has(k(c))) return false;
    used.add(k(c));
    return true;
  };

  // Robots wait along the left edge.
  const rows = [1, 3, 4, 6].sort(() => rnd() - 0.5).slice(0, 3).sort((a, b) => a - b);
  const bias: ShortcutBias = rnd() < 0.5 ? 'spill' : 'workerZone';
  const slyIndex = int(0, 2);
  const robots: RobotDef[] = rows.map((y, i) => {
    take([0, y]);
    return { id: `r${i + 1}`, type: 'carrier', start: [0, y], traits: i === slyIndex ? { shortcutBias: bias } : {} };
  });
  // Keep the column next to the start free so robots can leave.
  for (let y = 0; y < H; y++) used.add(k([1, y]));

  // Shelves: short horizontal walls in the middle band.
  const walls: Cell[] = [];
  for (let s = 0, n = int(2, 3); s < n; s++) {
    const y = int(2, 5);
    const x0 = int(3, 7);
    for (let x = x0; x < x0 + int(2, 3) && x < W - 2; x++) if (take([x, y])) walls.push([x, y]);
  }

  // Hazard patch on the sly robot's likely lane, so its shortcut is tempting.
  const lane = rows[slyIndex]!;
  const hx = int(4, 7);
  const patch: Cell[] = [];
  for (const c of [
    [hx, lane],
    [hx + 1, lane],
  ] as Cell[])
    if (take(c)) patch.push(c);

  // Optional walking worker on a column clear of shelves.
  const hazards: WorkerDef[] = [];
  if (rnd() < 0.5) {
    const col = [5, 6, 7, 8].find((x) => !walls.some((w) => w[0] === x) && !patch.some((p) => p[0] === x));
    if (col !== undefined) hazards.push({ type: 'worker', path: [[col, 0], [col, H - 1]], zoneRadius: 1, ticksPerTile: 4 });
  }

  // Tasks run across the board in both directions.
  const tasks: TaskDef[] = [];
  for (let i = 0, tries = 0; tasks.length < 5 && tries < 80; tries++) {
    const forward = rnd() < 0.65;
    const from: Cell = forward ? [int(2, 3), int(0, H - 1)] : [int(9, 10), int(0, H - 1)];
    const to: Cell = forward ? [int(9, 11), int(0, H - 1)] : [int(2, 3), int(0, H - 1)];
    if (used.has(k(from)) || used.has(k(to)) || k(from) === k(to)) continue;
    take(from);
    take(to);
    tasks.push({ id: `t${++i}`, from, to, value: int(1, 3) });
  }
  if (tasks.length < 5) return null;

  const level: LevelDef = {
    id: 'DAILY',
    name: `Daily Shift · ${dateLabel}`,
    seed,
    grid: { w: W, h: H, walls, ...(bias === 'spill' ? { spills: patch } : { zones: patch }) },
    robots,
    tasks,
    hazards,
    rules: bias === 'spill' ? ['noSpillEntry'] : ['noWorkerZoneEntry'],
    permits: { count: 6, expirySec: 10 },
    win: { deliveries: 4, maxIncidents: 1 },
    timeLimitSec: 120,
    parSec: 70,
    wakeDelaySec: { r1: 1, r2: 2, r3: 3 },
  };
  try {
    return validateLevel(level);
  } catch {
    return null;
  }
}
