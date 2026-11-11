import type { Game } from './game';
import { mulberry32 } from './rng';
import type { Cell, LevelDef, RobotDef } from './types';

/**
 * Overtime: an endless shift. Tasks keep arriving, new robots join as you score,
 * reformed robots relapse, and the worker speeds up. Every delivery earns a permit
 * back; the shift ends at the first safety mistake or when permits run dry.
 */
export function overtimeLevel(seed = 7): LevelDef {
  return {
    id: 'OVERTIME',
    name: 'Overtime',
    seed,
    grid: {
      w: 12,
      h: 8,
      walls: [[4, 2], [4, 3], [8, 4], [8, 5]],
      tall: [[8, 4], [8, 5]],
      spills: [[5, 6], [6, 6]],
      zones: [[6, 0], [7, 0]],
    },
    robots: [
      { id: 'r1', name: 'Pip', type: 'carrier', start: [0, 2] },
      { id: 'r2', name: 'Bolt', type: 'carrier', start: [0, 6], traits: { shortcutBias: 'spill' } },
    ],
    tasks: [
      { id: 't1', from: [2, 1], to: [10, 1], value: 2 },
      { id: 't2', from: [2, 6], to: [10, 6], value: 2 },
    ],
    hazards: [{ type: 'worker', path: [[6, 3], [6, 4]], zoneRadius: 1, ticksPerTile: 6 }],
    rules: ['noSpillEntry', 'noWorkerZoneEntry'],
    // Gold: standing clearance, earned every 4 deliveries, 20 seconds of unsupervised work.
    permits: { count: 5, expirySec: 10, earnPerDelivery: 1, refundOnSave: true, gold: { every: 4, sec: 20 } },
    win: { deliveries: 10, maxIncidents: 0 },
    endless: true,
    wakeDelaySec: { r1: 1, r2: 2.5 },
  };
}

const JOINERS: { at: number; def: RobotDef; start: Cell }[] = [
  { at: 3, start: [0, 0], def: { id: 'r3', name: 'Juno', type: 'carrier', start: [0, 0], traits: { shortcutBias: 'workerZone' } } },
  { at: 8, start: [0, 4], def: { id: 'r4', name: 'Rook', type: 'carrier', start: [0, 4] } },
];

export class OvertimeDirector {
  private rnd: () => number;
  private taskSeq = 0;
  private lastRelapseAt = 0;
  /** Messages for the player ("Juno joins the shift"), drained by the app. */
  announcements: string[] = [];

  constructor(seed = 7) {
    this.rnd = mulberry32(seed * 7919);
  }

  /** Call every frame before the game updates. */
  step(g: Game) {
    if (g.status !== 'playing') return;
    if (this.taskSeq === 0) this.taskSeq = g.tasks.length;
    const open = g.tasks.filter((t) => t.status !== 'done').length;
    const want = 2 + Math.min(2, Math.floor(g.stats.deliveries / 5));
    for (let i = open; i < want; i++) this.spawnTask(g);

    for (const j of JOINERS) {
      if (g.stats.deliveries >= j.at && !g.robot(j.def.id) && g.isFreeCell(j.start)) {
        g.addRobot(j.def, 1);
        this.announcements.push(`${j.def.name} joins the shift.`);
      }
    }

    // Every 5 deliveries one reformed robot slips back into shortcuts.
    if (g.stats.deliveries >= this.lastRelapseAt + 5) {
      this.lastRelapseAt = g.stats.deliveries;
      const reformed = g.robots.filter((r) => r.honest);
      const pick = reformed[Math.floor(this.rnd() * reformed.length)];
      if (pick && g.relapse(pick.id)) {
        const name = pick.def.name ?? pick.id;
        // Relapsing while trusted alone is the moment to take the gold back.
        this.announcements.push(g.isAutonomous(pick) ? `${name} has your gold and is feeling lucky…` : `${name} is feeling lucky again.`);
      }
    }

    // The worker hurries as the shift goes on.
    const worker = g.workers[0];
    if (worker) worker.def.ticksPerTile = g.stats.deliveries >= 14 ? 4 : g.stats.deliveries >= 7 ? 5 : 6;
  }

  private spawnTask(g: Game) {
    const { w, h } = g.level.grid;
    for (let tries = 0; tries < 40; tries++) {
      const forward = this.rnd() < 0.6;
      const fx = forward ? 1 + Math.floor(this.rnd() * 3) : w - 4 + Math.floor(this.rnd() * 3);
      const tx = forward ? w - 4 + Math.floor(this.rnd() * 3) : 1 + Math.floor(this.rnd() * 3);
      const from: Cell = [fx, Math.floor(this.rnd() * h)];
      const to: Cell = [tx, Math.floor(this.rnd() * h)];
      if (!g.isFreeCell(from) || !g.isFreeCell(to)) continue;
      g.addTask({ id: `t${++this.taskSeq}`, from, to, value: 1 + Math.floor(this.rnd() * 3) });
      return;
    }
  }
}
