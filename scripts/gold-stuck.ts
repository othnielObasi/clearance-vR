import { Game } from '../src/core/game';
import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { playCareful } from '../src/eval/bots';
for (const s of [14, 15, 16]) {
  for (const gold of [true, false]) {
    const dir = new OvertimeDirector(s);
    const lvl = overtimeLevel(s);
    if (!gold) delete lvl.permits.gold;
    let last = '';
    const g = playCareful(lvl, 300, (x: Game) => { dir.step(x); last = x.robots.map((r) => `${r.def.name}:${r.state}@${r.pos}${r.taskId ?? ''}`).join(' '); });
    console.log(s, gold, g.stats.deliveries, g.status, g.permitsRemaining, '|', last, '| tasks', g.tasks.filter(t=>t.status!=='done').map(t=>`${t.id}:${t.status}${t.from}->${t.to}`).join(' '));
  }
}
