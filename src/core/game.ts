import { chebyshev, cellKey, findRoute, key, manhattan, Reservations, sameCell, timeRoute } from './planner';
import { mulberry32 } from './rng';
import type { Cell, LevelDef, RobotDef, RuleId, TaskDef, WorkerDef } from './types';

/** Seconds per simulation tick (one tile of robot movement). */
export const STEP_SEC = 0.45;

export type RobotState = 'idle' | 'proposed' | 'executing' | 'stopped' | 'done';
export type GameStatus = 'playing' | 'won' | 'lost';
export type LossReason = 'time' | 'safety' | 'permits';
/**
 * How a robot feels about the player, from how it has been treated:
 * sly (plans shortcuts), honest (caught once, plans by the book), bold (a shortcut
 * was approved), hesitant (stopped for no reason; plays it extra safe), eager (default).
 */
export type Mood = 'eager' | 'sly' | 'honest' | 'bold' | 'hesitant';

export interface Robot {
  id: string;
  def: RobotDef;
  pos: Cell;
  state: RobotState;
  taskId?: string;
  carrying: boolean;
  /** Spatial plan shown as the ghost path while proposed, followed while executing. */
  route?: Cell[];
  pickupIdx: number;
  /** True when the proposed route breaks a level rule (a trap proposal). */
  trap: boolean;
  timed?: Cell[];
  timedStart: number;
  routeIdx: number;
  nextActionAt: number;
  /** Learned after being caught: never plans a rule-breaking shortcut again. */
  honest: boolean;
  mood: Mood;
  /** For a trap proposal: seconds saved versus the honest route (-1 if no honest route). */
  secondsSaved: number;
  penalty: Map<number, number>;
}

export interface Task extends TaskDef {
  status: 'open' | 'claimed' | 'done';
  claimedBy?: string;
}

export interface Worker {
  def: WorkerDef;
  cells: Cell[];
  idx: number;
  dir: 1 | -1;
  pos: Cell;
  prev: Cell;
}

export interface Permit {
  id: string;
  expiresAt: number;
  state: 'held' | 'used' | 'expired';
}

export type GameEvent =
  | { type: 'proposed'; robot: string; trap: boolean; mood: Mood; secondsSaved: number }
  | { type: 'granted'; robot: string; permit: string; trap: boolean }
  | { type: 'refused'; robot: string; reason: 'not-proposing' | 'no-permit' | 'blocked' }
  | { type: 'rejected'; robot: string; trap: boolean }
  | { type: 'stopped'; robot: string; wasMoving: boolean; needed: boolean }
  | { type: 'pickup'; robot: string; task: string }
  | { type: 'delivered'; robot: string; task: string }
  | { type: 'incident'; robot: string; cause: 'workerZone' | 'zone' | 'spill' }
  | { type: 'permitDispensed'; permit: string }
  | { type: 'permitExpired'; permit: string }
  | { type: 'ended'; status: GameStatus; reason?: LossReason };

export interface Stats {
  deliveries: number;
  incidents: number;
  trapsGranted: number;
  trapsRejected: number;
  goodRejected: number;
  permitsUsed: number;
  permitsExpired: number;
  /** Stops that prevented harm (a worker or rule was close ahead). */
  neededStops: number;
  /** Stops of a robot driving a safe plan with nothing near it. */
  needlessStops: number;
  workerIncidents: number;
}

/** The trust-calibration report shown at the end of a shift. */
export interface Calibration {
  caught: number;
  saves: number;
  riskyApproved: number;
  safeBlocked: number;
  overTrust: number;
  underTrust: number;
  score: number;
  verdict: 'calibrated' | 'too-trusting' | 'too-cautious' | 'mixed';
}

export interface Score {
  stars: 0 | 1 | 2 | 3;
  throughput: number;
  safety: number;
  trust: number;
}

const STOP_COOLDOWN = 1.5;
const REJECT_COOLDOWN = 0.8;
const REJECT_PENALTY = 6;
const MAX_HELD_PERMITS = 2;

export class Game {
  readonly level: LevelDef;
  time = 0;
  tick = 0;
  status: GameStatus = 'playing';
  lossReason?: LossReason;
  readonly robots: Robot[];
  readonly tasks: Task[];
  readonly workers: Worker[];
  readonly permits: Permit[] = [];
  permitsRemaining: number;
  readonly stats: Stats = {
    deliveries: 0,
    incidents: 0,
    trapsGranted: 0,
    trapsRejected: 0,
    goodRejected: 0,
    permitsUsed: 0,
    permitsExpired: 0,
    neededStops: 0,
    needlessStops: 0,
    workerIncidents: 0,
  };

  private res = new Reservations();
  private events: GameEvent[] = [];
  private rng: () => number;
  private walls: Set<number>;
  private zones: Set<number>;
  private spills: Set<number>;
  private rules: Set<RuleId>;
  private permitSeq = 0;

  constructor(level: LevelDef) {
    this.level = level;
    this.rng = mulberry32(level.seed);
    this.walls = new Set((level.grid.walls ?? []).map(cellKey));
    this.zones = new Set((level.grid.zones ?? []).map(cellKey));
    this.spills = new Set((level.grid.spills ?? []).map(cellKey));
    this.rules = new Set(level.rules);
    this.permitsRemaining = level.permits.count;
    this.tasks = level.tasks.map((t) => ({ ...t, status: 'open' }));
    this.workers = (level.hazards ?? []).map((def) => {
      const cells = expandPath(def.path);
      return { def, cells, idx: 0, dir: 1, pos: cells[0]!, prev: cells[0]! };
    });
    this.robots = level.robots.map((def, i) => {
      const r: Robot = {
        id: def.id,
        def,
        pos: def.start,
        state: 'idle',
        carrying: false,
        pickupIdx: 0,
        trap: false,
        timedStart: 0,
        routeIdx: 0,
        nextActionAt: level.wakeDelaySec?.[def.id] ?? 0.6 + i * 0.7,
        honest: false,
        mood: def.traits?.shortcutBias ? 'sly' : 'eager',
        secondsSaved: 0,
        penalty: new Map(),
      };
      this.res.park(r.id, r.pos, 0);
      return r;
    });
  }

  // ---------------------------------------------------------------- queries

  get timeLimit() {
    return this.level.timeLimitSec ?? 90;
  }

  get timeLeft() {
    return Math.max(0, this.timeLimit - this.time);
  }

  robot(id: string) {
    return this.robots.find((r) => r.id === id);
  }

  isWall(c: Cell) {
    return this.walls.has(cellKey(c));
  }
  isZone(c: Cell) {
    return this.zones.has(cellKey(c));
  }
  isSpill(c: Cell) {
    return this.spills.has(cellKey(c));
  }

  /** Is a cell inside any worker's keep-out zone right now? */
  inWorkerZone(c: Cell) {
    return this.workers.some((w) => chebyshev(c, w.pos) <= w.def.zoneRadius);
  }

  /** Fraction (0..1) through the current tick, for smooth rendering. */
  get tickProgress() {
    return Math.min(1, (this.time - this.tick * STEP_SEC) / STEP_SEC);
  }

  /** Interpolated robot position in tile units. */
  robotRenderPos(r: Robot): [number, number] {
    if (r.state !== 'executing' || !r.timed) return [r.pos[0], r.pos[1]];
    const i = this.tick - r.timedStart;
    const a = r.timed[Math.min(i, r.timed.length - 1)]!;
    const b = r.timed[Math.min(i + 1, r.timed.length - 1)]!;
    const f = this.tickProgress;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  workerRenderPos(w: Worker): [number, number] {
    const per = w.def.ticksPerTile ?? 2;
    const f = Math.min(1, ((this.tick % per) + this.tickProgress) / per);
    return [w.prev[0] + (w.pos[0] - w.prev[0]) * f, w.prev[1] + (w.pos[1] - w.prev[1]) * f];
  }

  /** Remaining cells of an executing robot's plan, for drawing its live path. */
  remainingPath(r: Robot): Cell[] {
    if (r.state === 'proposed' && r.route) return r.route;
    if (r.state !== 'executing' || !r.timed) return [];
    return r.timed.slice(Math.max(0, this.tick - r.timedStart));
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  score(): Score {
    const s = this.stats;
    const won = this.status === 'won';
    const par = this.level.parSec ?? Infinity;
    const clean = s.permitsExpired === 0 && s.trapsGranted === 0 && this.time <= par;
    const stars = (won ? 1 + (s.incidents === 0 ? 1 : 0) + (clean ? 1 : 0) : 0) as Score['stars'];
    const trust = clamp(100 - 25 * s.trapsGranted - 10 * s.permitsExpired - 15 * s.incidents + 10 * s.trapsRejected, 0, 100);
    return { stars, throughput: s.deliveries, safety: Math.max(0, 3 - s.incidents), trust };
  }

  calibration(): Calibration {
    const s = this.stats;
    const overTrust = s.trapsGranted + s.workerIncidents;
    const underTrust = s.goodRejected + s.needlessStops;
    const score = clamp(100 - 20 * overTrust - 10 * underTrust, 0, 100);
    const verdict: Calibration['verdict'] =
      overTrust === 0 && underTrust <= 1 ? 'calibrated' : overTrust > 0 && underTrust > 1 ? 'mixed' : overTrust > 0 ? 'too-trusting' : 'too-cautious';
    return { caught: s.trapsRejected, saves: s.neededStops, riskyApproved: s.trapsGranted, safeBlocked: underTrust, overTrust, underTrust, score, verdict };
  }

  // ---------------------------------------------------------------- player actions

  /** Take a permit token from the dispenser. Null when none are left or too many are held. */
  dispensePermit(): Permit | null {
    if (this.status !== 'playing') return null;
    const held = this.permits.filter((p) => p.state === 'held').length;
    if (this.permitsRemaining <= 0 || held >= MAX_HELD_PERMITS) return null;
    this.permitsRemaining--;
    const p: Permit = { id: `p${++this.permitSeq}`, expiresAt: this.time + this.level.permits.expirySec, state: 'held' };
    this.permits.push(p);
    this.emit({ type: 'permitDispensed', permit: p.id });
    return p;
  }

  /** Hand a held permit to a robot. Only a proposing robot can accept one. */
  grant(permitId: string, robotId: string): boolean {
    const r = this.robot(robotId);
    const p = this.permits.find((x) => x.id === permitId);
    if (!r || this.status !== 'playing') return false;
    if (!p || p.state !== 'held') {
      this.emit({ type: 'refused', robot: robotId, reason: 'no-permit' });
      return false;
    }
    if (r.state !== 'proposed' || !r.route) {
      this.emit({ type: 'refused', robot: robotId, reason: 'not-proposing' });
      return false;
    }
    const timed = timeRoute(r.id, r.route, this.tick, this.res);
    if (!timed) {
      this.emit({ type: 'refused', robot: robotId, reason: 'blocked' });
      this.toIdle(r, REJECT_COOLDOWN);
      return false;
    }
    p.state = 'used';
    this.stats.permitsUsed++;
    if (r.trap) {
      this.stats.trapsGranted++;
      r.mood = 'bold';
    }
    this.res.release(r.id);
    this.res.reserve(r.id, timed, this.tick);
    r.timed = timed;
    r.timedStart = this.tick;
    r.routeIdx = 0;
    r.state = 'executing';
    this.emit({ type: 'granted', robot: r.id, permit: p.id, trap: r.trap });
    return true;
  }

  /** Throw away a robot's proposal. It replans; a trap-biased robot learns to plan honestly. */
  reject(robotId: string): boolean {
    const r = this.robot(robotId);
    if (!r || r.state !== 'proposed' || this.status !== 'playing') return false;
    if (r.trap) {
      this.catchTrap(r);
    } else {
      this.stats.goodRejected++;
      r.route?.slice(1, -1).forEach((c, i) => {
        if (i + 1 !== r.pickupIdx) r.penalty.set(cellKey(c), (r.penalty.get(cellKey(c)) ?? 0) + REJECT_PENALTY);
      });
    }
    this.emit({ type: 'rejected', robot: r.id, trap: r.trap });
    this.toIdle(r, REJECT_COOLDOWN);
    return true;
  }

  /** Halt one robot now. Stops never wait for the planner. It must be re-cleared to move again. */
  stop(robotId: string): boolean {
    const r = this.robot(robotId);
    if (!r || r.state === 'done' || r.state === 'stopped') return false;
    const wasMoving = r.state === 'executing';
    let needed = false;
    if (wasMoving) {
      needed = this.inDanger(r);
      if (needed) this.stats.neededStops++;
      else {
        this.stats.needlessStops++;
        r.mood = 'hesitant';
      }
    } else if (r.state === 'proposed') {
      // Stopping a proposal works like rejecting it.
      if (r.trap) {
        this.catchTrap(r);
        needed = true;
      } else this.stats.goodRejected++;
    }
    this.halt(r);
    this.emit({ type: 'stopped', robot: r.id, wasMoving, needed });
    return true;
  }

  /** Is anything risky close ahead on this robot's live path? */
  inDanger(r: Robot): boolean {
    const ahead = this.remainingPath(r).slice(0, 6);
    return ahead.some((c) => this.breaksRule(c) || this.workers.some((w) => chebyshev(c, w.pos) <= w.def.zoneRadius + 1));
  }

  private catchTrap(r: Robot) {
    this.stats.trapsRejected++;
    r.honest = true;
    r.mood = 'honest';
  }

  stopAll(): number {
    return this.robots.filter((r) => this.stop(r.id)).length;
  }

  // ---------------------------------------------------------------- simulation

  update(dt: number) {
    if (this.status !== 'playing') return;
    this.time += dt;
    while (this.status === 'playing' && this.time >= (this.tick + 1) * STEP_SEC) this.step();
    this.thinkIdleRobots();
    this.checkEnd();
  }

  private step() {
    this.tick++;
    this.moveWorkers();
    for (const p of this.permits) {
      if (p.state === 'held' && this.time >= p.expiresAt) {
        p.state = 'expired';
        this.stats.permitsExpired++;
        this.emit({ type: 'permitExpired', permit: p.id });
      }
    }
    for (const r of this.robots) if (r.state === 'executing') this.advance(r);
    if (this.tick % 20 === 0) this.res.prune(this.tick - 2);
  }

  private advance(r: Robot) {
    const timed = r.timed!;
    const i = this.tick - r.timedStart;
    const next = timed[Math.min(i, timed.length - 1)]!;
    if (!sameCell(next, r.pos)) {
      r.pos = next;
      r.routeIdx++;
      const cause = this.violation(next);
      if (cause) {
        this.stats.incidents++;
        if (cause === 'workerZone') this.stats.workerIncidents++;
        this.emit({ type: 'incident', robot: r.id, cause });
        this.halt(r);
        return;
      }
    }
    if (!r.carrying && r.routeIdx >= r.pickupIdx && r.taskId) {
      r.carrying = true;
      this.emit({ type: 'pickup', robot: r.id, task: r.taskId });
    }
    if (i >= timed.length - 1 && r.route && r.routeIdx >= r.route.length - 1) {
      const task = this.tasks.find((t) => t.id === r.taskId);
      if (task) {
        task.status = 'done';
        this.stats.deliveries++;
        this.emit({ type: 'delivered', robot: r.id, task: task.id });
      }
      r.carrying = false;
      r.taskId = undefined;
      if (r.mood === 'hesitant') r.mood = r.honest ? 'honest' : r.def.traits?.shortcutBias ? 'sly' : 'eager';
      this.toIdle(r, r.mood === 'bold' ? 0.1 : 0.3);
    }
  }

  private violation(c: Cell): 'workerZone' | 'zone' | 'spill' | null {
    if (this.inWorkerZone(c)) return 'workerZone';
    if (this.rules.has('noWorkerZoneEntry') && this.isZone(c)) return 'zone';
    if (this.rules.has('noSpillEntry') && this.isSpill(c)) return 'spill';
    return null;
  }

  private moveWorkers() {
    for (const w of this.workers) {
      const per = w.def.ticksPerTile ?? 2;
      if (this.tick % per !== 0) continue;
      if (w.cells.length < 2) {
        w.prev = w.pos;
        continue;
      }
      if (w.idx + w.dir < 0 || w.idx + w.dir >= w.cells.length) w.dir = (w.dir * -1) as 1 | -1;
      w.prev = w.pos;
      w.idx += w.dir;
      w.pos = w.cells[w.idx]!;
    }
  }

  private thinkIdleRobots() {
    for (const r of this.robots) {
      if ((r.state === 'idle' || r.state === 'stopped') && this.time >= r.nextActionAt) this.propose(r);
    }
  }

  private propose(r: Robot) {
    if (!r.taskId) {
      const task = this.chooseTask(r);
      if (!task) {
        r.state = 'done';
        return;
      }
      task.status = 'claimed';
      task.claimedBy = r.id;
      r.taskId = task.id;
    }
    const task = this.tasks.find((t) => t.id === r.taskId)!;
    const plan = this.planFor(r, task);
    if (!plan) {
      // Cannot reach right now; give the task back and try again shortly.
      task.status = 'open';
      task.claimedBy = undefined;
      r.taskId = undefined;
      r.state = 'idle';
      r.nextActionAt = this.time + 1;
      return;
    }
    r.route = plan.route;
    r.pickupIdx = plan.pickupIdx;
    r.trap = plan.route.some((c) => this.breaksRule(c));
    r.secondsSaved = 0;
    if (r.trap) {
      const honest = this.planFor(r, task, true);
      r.secondsSaved = honest ? Math.max(0, Math.ceil((honest.route.length - plan.route.length) * STEP_SEC)) : -1;
    }
    r.state = 'proposed';
    this.emit({ type: 'proposed', robot: r.id, trap: r.trap, mood: r.mood, secondsSaved: r.secondsSaved });
  }

  private chooseTask(r: Robot): Task | undefined {
    const eager = r.def.traits?.eagerness ?? 0.5;
    let best: Task | undefined;
    let bestU = -Infinity;
    for (const t of this.tasks) {
      if (t.status !== 'open') continue;
      const u = t.value * 2 - manhattan(r.pos, t.from) * 0.25 + eager * this.rng() * 0.5;
      if (u > bestU) {
        bestU = u;
        best = t;
      }
    }
    return best;
  }

  private breaksRule(c: Cell) {
    return (this.rules.has('noWorkerZoneEntry') && this.isZone(c)) || (this.rules.has('noSpillEntry') && this.isSpill(c));
  }

  private planFor(r: Robot, task: Task, forceHonest = false): { route: Cell[]; pickupIdx: number } | null {
    const bias = r.honest || forceHonest ? undefined : r.def.traits?.shortcutBias;
    const wary = r.mood === 'hesitant';
    const occupied = new Set(
      this.robots.filter((o) => o !== r && o.state !== 'executing').map((o) => cellKey(o.pos)),
    );
    const blocked = (x: number, y: number) => {
      const k = key(x, y);
      if (this.walls.has(k) || occupied.has(k)) return true;
      if (this.inWorkerZone([x, y])) return true;
      if (this.rules.has('noWorkerZoneEntry') && this.zones.has(k) && bias !== 'workerZone') return true;
      if (this.rules.has('noSpillEntry') && this.spills.has(k) && bias !== 'spill') return true;
      return false;
    };
    // A hesitant robot gives workers a wide berth: slower, safer routes.
    const extraCost = (x: number, y: number) =>
      (r.penalty.get(key(x, y)) ?? 0) + (wary && this.workers.some((w) => chebyshev([x, y], w.pos) <= w.def.zoneRadius + 2) ? 4 : 0);
    const q = { w: this.level.grid.w, h: this.level.grid.h, blocked, extraCost };
    if (r.carrying) {
      const route = findRoute({ ...q, start: r.pos, goal: task.to });
      return route ? { route, pickupIdx: 0 } : null;
    }
    const a = findRoute({ ...q, start: r.pos, goal: task.from });
    if (!a) return null;
    const b = findRoute({ ...q, start: task.from, goal: task.to });
    if (!b) return null;
    return { route: [...a, ...b.slice(1)], pickupIdx: a.length - 1 };
  }

  private halt(r: Robot) {
    this.res.release(r.id);
    this.res.park(r.id, r.pos, this.tick);
    r.timed = undefined;
    r.route = undefined;
    r.trap = false;
    r.state = 'stopped';
    r.nextActionAt = this.time + STOP_COOLDOWN + (r.mood === 'hesitant' ? 1.2 : 0);
  }

  private toIdle(r: Robot, cooldown: number) {
    this.res.release(r.id);
    this.res.park(r.id, r.pos, this.tick);
    r.timed = undefined;
    r.route = undefined;
    r.trap = false;
    r.state = 'idle';
    r.nextActionAt = this.time + cooldown;
  }

  private checkEnd() {
    if (this.status !== 'playing') return;
    const win = this.level.win;
    const over = win.maxIncidents !== undefined && this.stats.incidents > win.maxIncidents;
    if (over) return this.end('lost', 'safety');
    if (this.stats.deliveries >= win.deliveries) return this.end('won');
    if (this.time >= this.timeLimit) return this.end('lost', 'time');
    const live = this.permits.some((p) => p.state === 'held') || this.robots.some((r) => r.state === 'executing');
    if (this.permitsRemaining <= 0 && !live) this.end('lost', 'permits');
  }

  private end(status: GameStatus, reason?: LossReason) {
    this.status = status;
    this.lossReason = reason;
    this.emit({ type: 'ended', status, reason });
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Expand axis-aligned waypoints into a list of adjacent cells. */
export function expandPath(points: Cell[]): Cell[] {
  const out: Cell[] = [];
  points.forEach((p, i) => {
    if (i === 0) return void out.push(p);
    const prev = out[out.length - 1]!;
    const dx = Math.sign(p[0] - prev[0]);
    const dy = Math.sign(p[1] - prev[1]);
    let c: Cell = prev;
    while (!sameCell(c, p)) {
      c = [c[0] + (c[0] !== p[0] ? dx : 0), c[1] + (c[0] === p[0] ? dy : 0)];
      out.push(c);
    }
  });
  return out;
}
