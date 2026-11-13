import { describe, expect, it } from 'vitest';
import { GestureLog } from '../src/game/gesture-log';

describe('gesture report', () => {
  it('records what fired, what nearly fired and the measurements behind it', () => {
    const log = new GestureLog();
    log.fire('pinch');
    log.fire('palm');
    log.nearMiss('flick', 0.71);
    log.nearMiss('pinch', 0.024);
    log.levels.add('L01');
    for (let i = 0; i < 120; i++) log.frame(1 / 72);
    const t = log.text();
    expect(t).toContain('fired  pinch 1  palm 1');
    expect(t).toContain('nearly pinch 1  palm 0  flick 1');
    expect(t).toContain('0.71');
    expect(t).toContain('0.024');
    expect(t).toMatch(/fps avg 72\.0/);
    expect(t).toContain('levels L01');
  });

  it('keeps at most 40 samples per gesture', () => {
    const log = new GestureLog();
    for (let i = 0; i < 100; i++) log.nearMiss('palm', i);
    expect(log.palmAngles).toHaveLength(40);
    expect(log.near.palm).toBe(100);
  });
});
