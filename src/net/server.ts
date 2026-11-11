import type { CrewMemory, CrewName } from '../core/crew';
import type { GameEvent } from '../core/game';

/**
 * The companion server (AI lines, debrief, co-op relay). Set at build time with
 * VITE_CLEARANCE_SERVER, or for testing with `?server=https://…`. Empty means play offline.
 */
export const SERVER_URL: string = (() => {
  const fromQuery = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('server');
  if (fromQuery && /^https:\/\/[\w.-]+(:\d+)?$/.test(fromQuery)) return fromQuery;
  return ((import.meta.env.VITE_CLEARANCE_SERVER as string | undefined) ?? '').replace(/\/$/, '');
})();

/** Situations a robot speaks in, matching the server's slots. */
export type Slot = 'greeting' | 'onIt' | 'caught' | 'protest' | 'thanks' | 'why' | 'delivered' | 'oops';
export type CrewLines = Partial<Record<CrewName, Partial<Record<Slot, string[]>>>>;

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  if (!SERVER_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SERVER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null; // offline, slow or down: the game uses its written lines
  } finally {
    clearTimeout(timer);
  }
}

/** Fresh lines for this shift's crew. Asked once as the shift starts; never awaited by play. */
export async function fetchCrewLines(level: string, crew: { name: CrewName; memory: CrewMemory }[]): Promise<CrewLines | null> {
  const r = await post<{ lines?: CrewLines }>('/api/lines', { level, crew }, 20000);
  return r?.lines ?? null;
}

export interface DebriefInput {
  level: string;
  won: boolean;
  reason?: string;
  stars: number;
  deliveries: number;
  verdict: string;
  caught: number;
  riskyApproved: number;
  saves: number;
  safeBlocked: number;
  delegated: number;
  crew: ({ name: CrewName } & Partial<CrewMemory>)[];
}

/** The shift supervisor's short debrief, or null. */
export async function fetchDebrief(d: DebriefInput): Promise<string | null> {
  const r = await post<{ text?: string | null }>('/api/debrief', d, 20000);
  return r?.text ?? null;
}

/** Which situation a game event puts a robot in, if any has AI lines. */
export function slotFor(e: GameEvent): Slot | null {
  switch (e.type) {
    case 'granted':
      return e.auto ? null : e.trap ? null : 'onIt';
    case 'rejected':
      return e.trap ? 'caught' : 'protest';
    case 'stopped':
      if (!e.wasMoving) return e.needed ? 'caught' : null;
      return e.needed ? 'thanks' : 'why';
    case 'delivered':
      return 'delivered';
    case 'incident':
      return 'oops';
    default:
      return null;
  }
}

/** A line from the pool for this robot and situation, or null to use the written one. */
export function pickLine(lines: CrewLines | null, name: CrewName, slot: Slot, rnd = Math.random): string | null {
  const pool = lines?.[name]?.[slot];
  if (!pool?.length) return null;
  return pool[Math.floor(rnd() * pool.length)] ?? null;
}
