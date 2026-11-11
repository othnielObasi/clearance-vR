import type { Game, GameEvent, Robot } from '../core/game';
import type { Cell, RobotDef, TaskDef } from '../core/types';

/**
 * Co-op: the host's game is the only one that runs. It sends this snapshot about ten times
 * a second; the partner copies it onto a mirror Game that never runs its own update, so the
 * two boards can never disagree.
 */
export interface Snapshot {
  time: number;
  tick: number;
  status: Game['status'];
  lossReason?: Game['lossReason'];
  permitsRemaining: number;
  goldAvailable: number;
  stats: Game['stats'];
  permits: Game['permits'];
  robots: RobotSnap[];
  tasks: { def: TaskDef; status: 'open' | 'claimed' | 'done'; claimedBy?: string }[];
  workers: { idx: number; dir: 1 | -1; pos: Cell; prev: Cell }[];
  /** Cells walled off by either player's hands or real objects. */
  walls: Cell[];
  paused: boolean;
}

type RobotSnap = Pick<
  Robot,
  | 'id'
  | 'def'
  | 'pos'
  | 'state'
  | 'taskId'
  | 'carrying'
  | 'route'
  | 'pickupIdx'
  | 'trap'
  | 'timed'
  | 'timedStart'
  | 'routeIdx'
  | 'honest'
  | 'mood'
  | 'secondsSaved'
  | 'autonomousUntil'
  | 'autonomousRun'
>;

export function snapshot(g: Game, walls: Cell[], paused: boolean): Snapshot {
  return {
    time: g.time,
    tick: g.tick,
    status: g.status,
    lossReason: g.lossReason,
    permitsRemaining: g.permitsRemaining,
    goldAvailable: g.goldAvailable,
    stats: { ...g.stats },
    permits: g.permits.map((p) => ({ ...p, expiresAt: Number.isFinite(p.expiresAt) ? p.expiresAt : 1e9 })),
    robots: g.robots.map((r) => ({
      id: r.id,
      def: r.def,
      pos: r.pos,
      state: r.state,
      taskId: r.taskId,
      carrying: r.carrying,
      route: r.route,
      pickupIdx: r.pickupIdx,
      trap: r.trap,
      timed: r.state === 'executing' ? r.timed : undefined,
      timedStart: r.timedStart,
      routeIdx: r.routeIdx,
      honest: r.honest,
      mood: r.mood,
      secondsSaved: r.secondsSaved,
      autonomousUntil: r.autonomousUntil,
      autonomousRun: r.autonomousRun,
    })),
    tasks: g.tasks.map((t) => ({ def: { id: t.id, from: t.from, to: t.to, value: t.value }, status: t.status, claimedBy: t.claimedBy })),
    workers: g.workers.map((w) => ({ idx: w.idx, dir: w.dir, pos: w.pos, prev: w.prev })),
    walls,
    paused,
  };
}

/** Copy a snapshot onto the partner's mirror game. Robots and tasks added mid-shift (Overtime) are created. */
export function applySnapshot(g: Game, s: Snapshot) {
  g.time = s.time;
  g.tick = s.tick;
  g.status = s.status;
  g.lossReason = s.lossReason;
  g.permitsRemaining = s.permitsRemaining;
  g.goldAvailable = s.goldAvailable;
  Object.assign(g.stats, s.stats);
  g.permits.splice(0, g.permits.length, ...s.permits.map((p) => ({ ...p, expiresAt: p.gold ? Infinity : p.expiresAt })));
  for (const rs of s.robots) {
    let r = g.robot(rs.id);
    if (!r) r = g.addRobot(rs.def as RobotDef, 0);
    Object.assign(r, rs);
  }
  for (const ts of s.tasks) {
    let t = g.tasks.find((x) => x.id === ts.def.id);
    if (!t) {
      g.addTask(ts.def);
      t = g.tasks[g.tasks.length - 1]!;
    }
    t.status = ts.status;
    t.claimedBy = ts.claimedBy;
  }
  s.workers.forEach((ws, i) => {
    const w = g.workers[i];
    if (w) Object.assign(w, ws);
  });
}

/** Messages between the two players, through the relay. */
export type CoopMsg =
  | { t: 'start'; level: unknown; mode: string; label: string }
  | { t: 'snap'; s: Snapshot; ev: GameEvent[] }
  | { t: 'act'; a: 'grant' | 'reject' | 'stop' | 'stopAll' | 'delegate' | 'pause'; robot?: string }
  | { t: 'walls'; cells: Cell[] }
  /** Hand points (palm and index tip per tracked hand) in board-local metres. */
  | { t: 'hands'; h: [number, number, number][] };
