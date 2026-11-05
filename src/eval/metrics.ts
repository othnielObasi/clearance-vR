import type { Game } from '../core/game';
import type { LevelDef } from '../core/types';
import { DT, playCareful, playCareless, playNovice } from './bots';

export interface LevelMetrics {
  id: string;
  name: string;
  careful: { status: string; timeSec: number; stars: number; calibration: string };
  careless: { status: string; reason?: string; stars: number };
  /** Share of novice runs won, 0..1: the difficulty estimate. */
  noviceWinRate: number;
  noviceStars: number;
  /** Share of novice play time with two or more robots asking for clearance at once. */
  pressure: number;
  peakAsking: number;
  /** Player decisions (grants, rejects, stops) per minute for the careful run. */
  decisionsPerMin: number;
  trapsOffered: number;
}

function observePressure() {
  let frames = 0;
  let multi = 0;
  let peak = 0;
  const traps = new Set<string>();
  const observe = (g: Game) => {
    frames++;
    const asking = g.robots.filter((r) => r.state === 'proposed');
    if (asking.length >= 2) multi++;
    peak = Math.max(peak, asking.length);
    for (const r of asking) if (r.trap) traps.add(`${r.id}:${r.taskId}`);
  };
  return { observe, result: () => ({ pressure: frames ? multi / frames : 0, peak, traps: traps.size }) };
}

export function evaluateLevel(level: LevelDef, noviceRuns = 40): LevelMetrics {
  const p = observePressure();
  const careful = playCareful(level);
  const careless = playCareless(level);
  let wins = 0;
  let stars = 0;
  for (let i = 0; i < noviceRuns; i++) {
    // Pressure is measured under human-like play: an instant bot never leaves a robot waiting.
    const g = playNovice(level, 1000 + i, 200, p.observe);
    if (g.status === 'won') wins++;
    stars += g.score().stars;
  }
  const s = careful.stats;
  const decisions = s.permitsUsed + s.trapsRejected + s.goodRejected + s.neededStops + s.needlessStops;
  const pr = p.result();
  return {
    id: level.id,
    name: level.name,
    careful: { status: careful.status, timeSec: round(careful.time), stars: careful.score().stars, calibration: careful.calibration().verdict },
    careless: { status: careless.status, reason: careless.lossReason, stars: careless.score().stars },
    noviceWinRate: wins / noviceRuns,
    noviceStars: round(stars / noviceRuns),
    pressure: round(pr.pressure),
    peakAsking: pr.peak,
    decisionsPerMin: round(decisions / Math.max(DT, careful.time / 60)),
    trapsOffered: pr.traps,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
