import { Game } from '../src/core/game';
import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { playCareful, playCareless, playNovice } from '../src/eval/bots';

for (const gold of [undefined, { every: 4, sec: 20 }, { every: 4, sec: 15 }, { every: 3, sec: 20 }]) {
  const rows: string[] = [];
  for (const who of ['careful', 'careless', 'novice'] as const) {
    let del = 0, auto = 0, t = 0, given = 0;
    const N = who === 'novice' ? 20 : 5;
    for (let s = 0; s < N; s++) {
      const seed = 7 + s;
      const lvl = overtimeLevel(seed);
      if (gold) lvl.permits.gold = gold;
      const dir = new OvertimeDirector(seed);
      const obs = (g: Game) => dir.step(g);
      const g = who === 'careful' ? playCareful(lvl, 300, obs) : who === 'careless' ? playCareless(lvl, 300, obs) : playNovice(lvl, 500 + s, 300, obs);
      del += g.stats.deliveries; auto += g.stats.autonomousDeliveries; t += g.time; given += g.stats.goldGiven;
    }
    rows.push(`${who}: del ${(del / N).toFixed(1)} auto ${(auto / N).toFixed(1)} gold ${(given / N).toFixed(1)} t ${(t / N).toFixed(0)}s`);
  }
  console.log(JSON.stringify(gold), '\n  ' + rows.join('\n  '));
}
