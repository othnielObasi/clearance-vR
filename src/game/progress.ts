import { type CrewMemory, type CrewName, emptyMemory } from '../core/crew';

const KEY = 'clearance.progress.v1';

export interface Progress {
  /** Index of the furthest level the player may start. */
  unlocked: number;
  stars: Record<string, number>;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (typeof p.unlocked === 'number' && p.stars) return p;
    }
  } catch {
    /* storage unavailable: play without saving */
  }
  return { unlocked: 0, stars: {} };
}

export function saveResult(levelIndex: number, levelId: string, stars: number, levelCount: number) {
  const p = loadProgress();
  p.stars[levelId] = Math.max(p.stars[levelId] ?? 0, stars);
  p.unlocked = Math.min(levelCount - 1, Math.max(p.unlocked, levelIndex + 1));
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const ASSIST_KEY = 'clearance.assist.v1';

/** Assist mode (relaxed gestures, bigger always-on buttons), remembered on this device. */
export function loadAssist(): boolean {
  try {
    return localStorage.getItem(ASSIST_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAssist(on: boolean) {
  try {
    localStorage.setItem(ASSIST_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the setting lasts this session */
  }
}

const DAILY_KEY = 'clearance.daily.v1';

interface DailyRecord {
  /** dateKey (YYYYMMDD) -> best result that day. */
  results: Record<string, { won: boolean; stars: number; calibration: number }>;
}

function loadDaily(): DailyRecord {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) return JSON.parse(raw) as DailyRecord;
  } catch {
    /* ignore */
  }
  return { results: {} };
}

/** Records today's result and returns the current streak of consecutive days won. */
export function saveDaily(dateKey: string, won: boolean, stars: number, calibration: number): number {
  const d = loadDaily();
  const prev = d.results[dateKey];
  if (!prev || (won && !prev.won) || stars > prev.stars) d.results[dateKey] = { won: won || !!prev?.won, stars: Math.max(stars, prev?.stars ?? 0), calibration };
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
  return streakEnding(dateKey, d);
}

export function streakEnding(dateKey: string, d: DailyRecord = loadDaily()): number {
  let streak = 0;
  const day = new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8)));
  for (;;) {
    const k = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, '0')}${String(day.getUTCDate()).padStart(2, '0')}`;
    if (!d.results[k]?.won) return streak;
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
}

/** Plain-text result card, safe to paste anywhere. */
export function shareText(
  dateLabel: string,
  won: boolean,
  stars: number,
  delivered: number,
  target: number,
  cal: { caught: number; saves: number; overTrust: number; safeBlocked: number; score: number },
  streak: number,
): string {
  return [
    `Clearance Daily Shift · ${dateLabel}`,
    `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${won ? 'Shift complete' : 'Shift over'} · ${delivered}/${target} delivered`,
    `Caught ${cal.caught} · Saves ${cal.saves} · Risks let through ${cal.overTrust} · Safe blocked ${cal.safeBlocked}`,
    `Trust calibration ${cal.score}/100${streak > 1 ? ` · ${streak}-day streak` : ''}`,
  ].join('\n');
}


const CREW_KEY = 'clearance.crew.v1';
const OVERTIME_KEY = 'clearance.overtime.v1';

export function loadCrew(): Record<string, CrewMemory> {
  try {
    const raw = localStorage.getItem(CREW_KEY);
    if (raw) return JSON.parse(raw) as Record<string, CrewMemory>;
  } catch {
    /* ignore */
  }
  return {};
}

export function crewMemory(name: CrewName): CrewMemory {
  return { ...emptyMemory(), ...(loadCrew()[name] ?? {}) };
}

/** Add one shift's tallies to each crew member's memory. */
export function saveCrew(tally: Map<CrewName, CrewMemory>) {
  const all = loadCrew();
  for (const [name, t] of tally) {
    const m = { ...emptyMemory(), ...(all[name] ?? {}) };
    for (const k of Object.keys(t) as (keyof CrewMemory)[]) m[k] += t[k];
    m.shifts += 1;
    all[name] = m;
  }
  try {
    localStorage.setItem(CREW_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function overtimeBest(): number {
  try {
    return Number(localStorage.getItem(OVERTIME_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Saves a new best if beaten; returns the best. */
export function saveOvertime(score: number): number {
  const best = Math.max(score, overtimeBest());
  try {
    localStorage.setItem(OVERTIME_KEY, String(best));
  } catch {
    /* ignore */
  }
  return best;
}
