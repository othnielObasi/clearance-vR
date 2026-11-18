import type { CoopMsg, Snapshot } from './snapshot';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 160;
const one = (v: unknown, options: readonly unknown[]) => options.includes(v);
const list = (v: unknown, max: number, check: (x: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(check);
const cell = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(count) && v.every(n => n < 64);
const cells = (v: unknown) => list(v, 4096, cell);
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);
const bool = (v: unknown) => typeof v === 'boolean';
const mood = (v: unknown) => one(v, ['eager', 'sly', 'honest', 'bold', 'hesitant']);
const reason = (v: unknown) => one(v, ['time', 'safety', 'permits']);
const status = (v: unknown) => one(v, ['playing', 'won', 'lost']);
const keysOnly = (v: Obj, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const robotFields = ['id', 'def', 'pos', 'state', 'taskId', 'carrying', 'route', 'pickupIdx', 'trap', 'timed',
  'timedStart', 'routeIdx', 'honest', 'mood', 'secondsSaved', 'autonomousUntil', 'autonomousRun'];

function robotDef(v: unknown): boolean {
  return obj(v) && text(v.id) && optional(v.name, text) && one(v.type, ['carrier', 'lifter']) && cell(v.start)
    && optional(v.traits, t => obj(t) && optional(t.eagerness, finite) && optional(t.shortcutBias, b => one(b, ['workerZone', 'spill'])));
}
function taskDef(v: unknown): boolean {
  return obj(v) && text(v.id) && cell(v.from) && cell(v.to) && finite(v.value) && v.value >= 0;
}
function level(v: unknown): boolean {
  if (!obj(v) || !text(v.id) || !text(v.name) || !finite(v.seed) || !obj(v.grid)) return false;
  const g = v.grid;
  return count(g.w) && g.w > 0 && g.w <= 64 && count(g.h) && g.h > 0 && g.h <= 64
    && ['walls', 'zones', 'spills', 'tall'].every(k => optional(g[k], cells))
    && list(v.robots, 32, robotDef) && v.robots.length > 0 && list(v.tasks, 2048, taskDef)
    && list(v.rules, 2, r => one(r, ['noWorkerZoneEntry', 'noSpillEntry']))
    && optional(v.hazards, hs => list(hs, 32, h => obj(h) && h.type === 'worker' && cells(h.path)
      && Array.isArray(h.path) && h.path.length > 0 && count(h.zoneRadius) && optional(h.ticksPerTile, n => count(n) && n > 0)))
    && obj(v.permits) && count(v.permits.count) && finite(v.permits.expirySec) && v.permits.expirySec > 0
    && optional(v.permits.earnPerDelivery, count) && optional(v.permits.refundOnSave, bool)
    && optional(v.permits.gold, p => obj(p) && count(p.every) && p.every > 0 && finite(p.sec) && p.sec > 0 && optional(p.startWith, count))
    && obj(v.win) && count(v.win.deliveries) && optional(v.win.maxIncidents, count)
    && optional(v.timeLimitSec, finite) && optional(v.parSec, finite) && optional(v.endless, bool)
    && optional(v.wakeDelaySec, d => obj(d) && Object.values(d).every(n => finite(n) && n >= 0));
}

export function validSnapshot(v: unknown): v is Snapshot {
  if (!obj(v)) return false;
  const stats = ['deliveries', 'incidents', 'trapsGranted', 'trapsRejected', 'goodRejected', 'permitsUsed',
    'permitsExpired', 'neededStops', 'needlessStops', 'workerIncidents', 'goldGiven', 'autonomousDeliveries'];
  return finite(v.time) && v.time >= 0 && count(v.tick) && status(v.status) && optional(v.lossReason, reason)
    && count(v.permitsRemaining) && count(v.goldAvailable) && bool(v.paused) && cells(v.walls)
    && obj(v.stats) && keysOnly(v.stats, stats) && stats.every(k => count((v.stats as Obj)[k]))
    && list(v.permits, 2048, p => obj(p) && text(p.id) && optional(p.gold, bool) && finite(p.expiresAt) && one(p.state, ['held', 'used', 'expired']))
    && list(v.robots, 32, r => obj(r) && keysOnly(r, robotFields) && text(r.id) && robotDef(r.def) && obj(r.def) && r.def.id === r.id && cell(r.pos)
      && one(r.state, ['idle', 'proposed', 'executing', 'stopped', 'done']) && optional(r.taskId, text)
      && ['carrying', 'trap', 'honest', 'autonomousRun'].every(k => bool(r[k]))
      && optional(r.route, cells) && optional(r.timed, cells) && count(r.pickupIdx) && count(r.routeIdx)
      && finite(r.timedStart) && finite(r.secondsSaved) && finite(r.autonomousUntil) && mood(r.mood))
    && list(v.tasks, 2048, t => obj(t) && taskDef(t.def) && one(t.status, ['open', 'claimed', 'done']) && optional(t.claimedBy, text))
    && list(v.workers, 32, w => obj(w) && keysOnly(w, ['idx', 'dir', 'pos', 'prev']) && count(w.idx) && one(w.dir, [-1, 1]) && cell(w.pos) && cell(w.prev));
}

function event(v: unknown): boolean {
  if (!obj(v)) return false;
  switch (v.type) {
    case 'goldEarned': return true;
    case 'ended': return status(v.status) && optional(v.reason, reason);
    case 'permitDispensed': case 'permitExpired': return text(v.permit);
    case 'proposed': return text(v.robot) && bool(v.trap) && mood(v.mood) && finite(v.secondsSaved);
    case 'granted': return text(v.robot) && text(v.permit) && bool(v.trap) && optional(v.auto, bool);
    case 'delegated': return text(v.robot) && finite(v.sec) && v.sec > 0;
    case 'autonomyEnded': return text(v.robot) && one(v.reason, ['expired', 'revoked']);
    case 'refused': return text(v.robot) && one(v.reason, ['not-proposing', 'no-permit', 'blocked']);
    case 'rejected': return text(v.robot) && bool(v.trap);
    case 'stopped': return text(v.robot) && bool(v.wasMoving) && bool(v.needed);
    case 'pickup': case 'delivered': return text(v.robot) && text(v.task);
    case 'incident': return text(v.robot) && one(v.cause, ['workerZone', 'zone', 'spill']);
    case 'held': case 'yielded': case 'rerouted': return text(v.robot);
    default: return false;
  }
}

/** JSON types are untrusted until every field consumed by the game has been checked. */
export function validCoopMessage(v: unknown): v is CoopMsg {
  if (!obj(v)) return false;
  switch (v.t) {
    case 'start': return level(v.level) && one(v.mode, ['campaign', 'daily', 'overtime', 'coop']) && text(v.label);
    case 'snap': return validSnapshot(v.s) && list(v.ev, 256, event);
    case 'act': return one(v.a, ['grant', 'reject', 'stop', 'stopAll', 'delegate', 'pause']) && optional(v.robot, text);
    case 'walls': return list(v.cells, 48, cell);
    case 'hands': return list(v.h, 4, p => Array.isArray(p) && p.length === 3 && p.every(n => finite(n) && Math.abs(n) <= 10));
    default: return false;
  }
}
