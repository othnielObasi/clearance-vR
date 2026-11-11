import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { Game } from '../src/core/game';
import { playCareful } from '../src/eval/bots';
const lvl = overtimeLevel(7); lvl.permits.gold = { every: 4, sec: 20 };
const dir = new OvertimeDirector(7);
let watch: string | undefined; let until = 0;
const obs = (g: Game) => {
  dir.step(g);
  if (watch && g.time < until && Math.round(g.time * 30) % 15 === 0) {
    const r = g.robot(watch)!;
    console.log(g.time.toFixed(1), r.def.name, r.state, r.pos.join(','), r.route?.slice(0,4).map(c=>c.join(',')).join(' '), 'w', g.workers[0]!.pos.join(','), 'task', r.taskId);
  }
};
const orig = (Game.prototype as any).emit;
(Game.prototype as any).emit = function (e: any) {
  if (e.type === 'delegated' && !watch) { watch = e.robot; until = this.time + 21; }
  if (watch && e.robot === watch) console.log('  EV', e.type, e.reason ?? '', e.auto ?? '');
  orig.call(this, e);
};
playCareful(lvl, 120, obs);
