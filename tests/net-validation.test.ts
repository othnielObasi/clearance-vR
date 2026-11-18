import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { LEVELS } from '../src/levels';
import { snapshot } from '../src/net/snapshot';
import { validCoopMessage } from '../src/net/validate';
import { playCareful } from '../src/eval/bots';
import { overtimeLevel } from '../src/core/overtime';

const wire = (v: unknown) => JSON.parse(JSON.stringify(v));
describe('co-op wire validation', () => {
  it('accepts campaign and Overtime start packets', () => {
    for (const level of [...LEVELS, overtimeLevel()]) {
      expect(validCoopMessage(wire({ t: 'start', level, mode: level.endless ? 'overtime' : 'campaign', label: level.name }))).toBe(true);
    }
  });

  it('accepts actual game snapshots and events throughout complete shifts', () => {
    for (const level of LEVELS) {
      playCareful(level, 120, g => {
        if (Math.round(g.time * 30) % 30 !== 0) return;
        expect(validCoopMessage(wire({ t: 'snap', s: snapshot(g, [], false), ev: g.drainEvents() })), `${level.id} at ${g.time}`).toBe(true);
      });
    }
  });

  it.each([null, [], {}, { t: 'snap' }, { t: 'act', a: 'erase' }, { t: 'hands', h: [[0, 0, null]] },
    { t: 'walls', cells: [[-1, 2]] }, { t: 'walls', cells: [[1.5, 2]] }, { t: 'hands', h: [[Infinity, 0, 0]] },
    { t: 'start', level: {}, mode: 'campaign', label: 'Bad' }])('ignores malformed packet %j', v => {
    expect(validCoopMessage(v)).toBe(false);
  });

  it('rejects bad nested snapshot fields before mutation', () => {
    const s = wire(snapshot(new Game(LEVELS[0]!), [], false));
    s.robots[0].pos = [null, 0];
    expect(validCoopMessage({ t: 'snap', s, ev: [] })).toBe(false);
  });

  it('bounds hands and walls while allowing valid inputs', () => {
    expect(validCoopMessage({ t: 'hands', h: [[0.1, 0.2, -0.3]] })).toBe(true);
    expect(validCoopMessage({ t: 'hands', h: Array(5).fill([0, 0, 0]) })).toBe(false);
    expect(validCoopMessage({ t: 'walls', cells: Array(49).fill([0, 0]) })).toBe(false);
  });

  it('rejects unexpected robot fields that could overwrite mirror internals', () => {
    const s = wire(snapshot(new Game(LEVELS[0]!), [], false));
    s.robots[0].penalty = null;
    expect(validCoopMessage({ t: 'snap', s, ev: [] })).toBe(false);
  });
});
