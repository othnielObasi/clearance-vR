import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { overtimeLevel, OvertimeDirector } from '../src/core/overtime';
import { playCareful } from '../src/eval/bots';
import { LEVELS } from '../src/levels';
import { applySnapshot, snapshot } from '../src/net/snapshot';

/** Send the snapshot through JSON, as the relay does. */
const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('co-op snapshots', () => {
  it('a partner mirror draws the same board as the host at every moment', () => {
    for (const level of LEVELS) {
      const mirror = new Game(level);
      let checked = 0;
      playCareful(level, 120, (host) => {
        if (Math.round(host.time * 30) % 9 !== 0) return; // about every 0.3 s, like the network
        applySnapshot(mirror, wire(snapshot(host, [], false)));
        for (const r of host.robots) {
          const m = mirror.robot(r.id)!;
          expect(mirror.robotRenderPos(m), `${level.id} ${r.id} at ${host.time.toFixed(2)}`).toEqual(host.robotRenderPos(r));
          expect(m.state).toBe(r.state);
          expect(mirror.remainingPath(m)).toEqual(host.remainingPath(r));
        }
        expect(mirror.workers.map((w) => w.pos)).toEqual(host.workers.map((w) => w.pos));
        expect(mirror.permitsRemaining).toBe(host.permitsRemaining);
        expect(mirror.status).toBe(host.status);
        checked++;
      });
      expect(checked).toBeGreaterThan(10);
    }
  });

  it('robots and tasks that join mid-shift appear on the partner board (Overtime)', () => {
    const host = new Game(overtimeLevel());
    const director = new OvertimeDirector(7);
    const mirror = new Game(overtimeLevel());
    for (let i = 0; i < 30 * 90 && host.status === 'playing'; i++) {
      director.step(host);
      for (const r of host.robots) if (r.state === 'proposed' && !r.trap) {
        const p = host.permits.find((x) => x.state === 'held') ?? host.dispensePermit();
        if (p) host.grant(p.id, r.id);
      }
      host.update(1 / 30);
    }
    applySnapshot(mirror, wire(snapshot(host, [], false)));
    expect(mirror.robots.map((r) => r.id)).toEqual(host.robots.map((r) => r.id));
    expect(mirror.tasks.map((t) => t.id)).toEqual(host.tasks.map((t) => t.id));
  });

  it('a gold permit keeps its never-expires after the trip', () => {
    const level = LEVELS.find((l) => l.id === 'L05')!;
    const host = new Game(level);
    host.takeGold();
    const mirror = new Game(level);
    applySnapshot(mirror, wire(snapshot(host, [], false)));
    expect(mirror.permits.find((p) => p.gold)?.expiresAt).toBe(Infinity);
  });
});
