/** Tile coordinate on the board grid: [x, y]. */
export type Cell = readonly [number, number];

export type RobotType = 'carrier' | 'lifter';
export type RuleId = 'noWorkerZoneEntry' | 'noSpillEntry';
/** A shortcut-biased robot ignores one rule when planning (a "trap" proposal). */
export type ShortcutBias = 'workerZone' | 'spill';

export interface RobotDef {
  id: string;
  type: RobotType;
  start: Cell;
  traits?: { eagerness?: number; shortcutBias?: ShortcutBias };
}

export interface TaskDef {
  id: string;
  from: Cell;
  to: Cell;
  value: number;
}

export interface WorkerDef {
  type: 'worker';
  /** Waypoints the worker patrols back and forth along (axis-aligned segments). */
  path: Cell[];
  zoneRadius: number;
  /** Simulation ticks per tile moved; higher is slower. */
  ticksPerTile?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  seed: number;
  grid: {
    w: number;
    h: number;
    walls?: Cell[];
    /** Static no-go areas (a worker zone painted on the floor). */
    zones?: Cell[];
    spills?: Cell[];
  };
  robots: RobotDef[];
  tasks: TaskDef[];
  hazards?: WorkerDef[];
  rules: RuleId[];
  permits: { count: number; expirySec: number };
  win: { deliveries: number; maxIncidents?: number };
  timeLimitSec?: number;
  parSec?: number;
  /** Seconds before each robot's first proposal, by robot id (tutorial pacing). */
  wakeDelaySec?: Record<string, number>;
}
