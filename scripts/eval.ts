import { evaluateLevel } from '../src/eval/metrics';
import { LEVELS } from '../src/levels';

const rows = LEVELS.map((l) => evaluateLevel(l));
console.table(
  rows.map((m) => ({
    level: `${m.id} ${m.name}`,
    'careful': `${m.careful.status} ${m.careful.stars}★ ${m.careful.timeSec}s`,
    'careless': `${m.careless.status}${m.careless.reason ? ` (${m.careless.reason})` : ''}`,
    'novice win %': Math.round(m.noviceWinRate * 100),
    'novice ★': m.noviceStars,
    'pressure %': Math.round(m.pressure * 100),
    'peak asking': m.peakAsking,
    'decisions/min': m.decisionsPerMin,
    traps: m.trapsOffered,
  })),
);
