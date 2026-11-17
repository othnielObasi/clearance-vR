import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FINGER_PRESS, FingerPress } from '../src/xr/finger-press';

const DT = 1 / 72;
const button = (visible = true) => ({ id: 7, center: new Vector3(0, 0, 0), radius: 0.011, visible });
const tip = (x: number, side: 'left' | 'right' = 'right') => ({ side, tip: new Vector3(x, 0, 0) });

/** Run frames until the button has settled, with the finger far away. */
function settled(p = new FingerPress()) {
  for (let t = 0; t < FINGER_PRESS.settle + 0.1; t += DT) p.update(DT, [tip(0.3)], [button()]);
  return p;
}

describe('fingertip presses', () => {
  it('presses a settled button the fingertip touches', () => {
    const p = settled();
    expect(p.update(DT, [tip(0.011 + 0.01)], [button()])).toEqual([7]);
  });

  it('ignores a hand hovering a few centimetres away', () => {
    const p = settled();
    for (let i = 0; i < 100; i++) expect(p.update(DT, [tip(0.011 + 0.03)], [button()])).toEqual([]);
  });

  it('presses once per touch, not again while the finger stays', () => {
    const p = settled();
    expect(p.update(DT, [tip(0.012)], [button()])).toEqual([7]);
    for (let i = 0; i < 100; i++) expect(p.update(DT, [tip(0.012)], [button()])).toEqual([]);
  });

  it('presses again after the finger lifts away and comes back', () => {
    const p = settled();
    expect(p.update(DT, [tip(0.012)], [button()])).toEqual([7]);
    p.update(DT, [tip(0.011 + FINGER_PRESS.reach + FINGER_PRESS.release + 0.005)], [button()]);
    expect(p.update(DT, [tip(0.012)], [button()])).toEqual([7]);
  });

  it('does not press a button that only just appeared under the hand', () => {
    const p = new FingerPress();
    p.update(DT, [tip(0.012)], [button(false)]);
    expect(p.update(DT, [tip(0.012)], [button()])).toEqual([]);
  });

  it('presses a button that appeared while the finger stays on it, once settled', () => {
    const p = new FingerPress();
    let presses = 0;
    for (let t = 0; t < FINGER_PRESS.settle + 0.1; t += DT) presses += p.update(DT, [tip(0.012)], [button()]).length;
    expect(presses).toBe(1);
  });

  it('never presses hidden buttons', () => {
    const p = settled();
    expect(p.update(DT, [tip(0)], [button(false)])).toEqual([]);
  });

  it('reports a button once when both hands touch it together', () => {
    const p = settled();
    expect(p.update(DT, [tip(0.012, 'left'), tip(0.012, 'right')], [button()])).toEqual([7]);
  });
});
