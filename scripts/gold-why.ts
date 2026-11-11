import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { Game } from '../src/core/game';
import { playCareful } from '../src/eval/bots';
const lvl = overtimeLevel(7); lvl.permits.gold = { every: 4, sec: 20 };
const dir = new OvertimeDirector(7);
const counts: Record<string, number> = {};
const obs = (g: Game) => { dir.step(g); };
// wrap drainEvents by peeking at internal events each frame
const orig = Game.prototype['emit' as never] as (e: { type: string; reason?: string; auto?: boolean }) => void;
(Game.prototype as any).emit = function (e: any) {
  const k = e.type + (e.reason ? ':' + e.reason : '') + (e.auto ? ':auto' : '') + (e.cause ? ':' + e.cause + ':' + this.robot(e.robot).autonomousRun : '');
  counts[k] = (counts[k] ?? 0) + 1;
  if (e.type === 'delegated') { const r = this.robot(e.robot); console.log('deleg', r.def.name, r.state, this.time.toFixed(1)); }
  orig.call(this, e);
};
playCareful(lvl, 300, obs);
console.log(counts);
