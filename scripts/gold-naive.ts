import { Game } from '../src/core/game';
import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { playCareful } from '../src/eval/bots';
for (const naive of [false, true]) {
  const out: string[] = [];
  for (let s = 0; s < 10; s++) {
    const dir = new OvertimeDirector(7 + s);
    const g = playCareful(overtimeLevel(7 + s), 300, (x: Game) => dir.step(x), { naiveDelegation: naive });
    out.push(`${g.stats.deliveries}${g.status === 'lost' ? 'L' : ''}`);
  }
  console.log(naive ? 'naive  ' : 'wise   ', out.join(' '));
}
