import { Game } from '../src/core/game';
import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { playCareful } from '../src/eval/bots';
for (const s of [9, 10, 12, 13]) for (const gold of [true, false]) {
  const dir = new OvertimeDirector(s); const lvl = overtimeLevel(s); if (!gold) delete lvl.permits.gold;
  const evs: string[] = [];
  const orig = (Game.prototype as any).emit;
  (Game.prototype as any).emit = function (e: any) { if (e.type === 'incident') { const r = this.robot(e.robot); evs.push(`${e.cause} ${r.def.name} auto=${r.autonomousRun} trap? honest=${r.honest} t=${this.time.toFixed(1)}`); } orig.call(this, e); };
  const g = playCareful(lvl, 300, (x: Game) => dir.step(x));
  (Game.prototype as any).emit = orig;
  console.log(s, gold, g.stats.deliveries, g.status, g.lossReason ?? '', evs.join('; '));
}
