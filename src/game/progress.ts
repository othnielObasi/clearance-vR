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
