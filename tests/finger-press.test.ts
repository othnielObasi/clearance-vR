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

describe('fingertip presses in a crowded cluster', () => {
  const at = (id: number, x: number, reach?: number) => ({ id, center: new Vector3(x, 0, 0), radius: 0.011, visible: true, reach });
  const settle = (p: FingerPress, targets: ReturnType<typeof at>[]) => {
    for (let t = 0; t < FINGER_PRESS.settle + 0.1; t += DT) p.update(DT, [tip(0.5)], targets);
  };

  it('presses only the nearest of two buttons a fingertip is close to', () => {
    // ✓ at 0, ✗ 2.6 cm along: a fingertip between them, nearer ✓, is within reach of both.
    const targets = [at(1, 0), at(2, 0.026)];
    const p = new FingerPress();
    settle(p, targets);
    expect(p.update(DT, [tip(0.012)], targets)).toEqual([1]);
  });

  it('does not press a neighbour while sliding off the button it pressed', () => {
    const targets = [at(1, 0), at(2, 0.026)];
    const p = new FingerPress();
    settle(p, targets);
    expect(p.update(DT, [tip(0.005)], targets)).toEqual([1]);
    let presses = 0;
    for (let x = 0.005; x <= 0.026; x += 0.001) presses += p.update(DT, [tip(x)], targets).length;
    expect(presses).toBe(0);
  });

  it('a careful button needs a closer touch than a normal one', () => {
    const p = new FingerPress();
    const stop = [at(3, 0, FINGER_PRESS.carefulReach)];
    settle(p, stop);
    expect(p.update(DT, [tip(0.011 + FINGER_PRESS.reach - 0.001)], stop)).toEqual([]);
    expect(p.update(DT, [tip(0.011 + FINGER_PRESS.carefulReach - 0.001)], stop)).toEqual([3]);
  });

  it('two hands can press two different buttons in the same frame', () => {
    const targets = [at(1, 0), at(2, 0.1)];
    const p = new FingerPress();
    settle(p, targets);
    expect(p.update(DT, [tip(0.012, 'left'), tip(0.112, 'right')], targets).sort()).toEqual([1, 2]);
  });
});
