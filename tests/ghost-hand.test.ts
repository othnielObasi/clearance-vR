import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GhostHand, type GhostKey } from '../src/xr/ghost-hand';
import { HAND_JOINTS } from '../src/xr/hand-model';

const J = (n: (typeof HAND_JOINTS)[number]) => HAND_JOINTS.indexOf(n);

/** Pose a ghost on one key and read back its joints. */
function posed(key: Partial<GhostKey>) {
  const g = new GhostHand();
  const k: GhostKey = { pose: 'open', anchor: 'palm', at: new Vector3(0.2, 0.8, -0.4), fingers: new Vector3(0, 0, -1), palm: new Vector3(0, -1, 0), move: 0, hold: 2, ...key };
  g.play('test', [k], 1);
  g.update(0.5); // past the fade-in, holding the key
  const pts = (g as unknown as { work: Vector3[] }).work.map((v) => v.clone());
  return { g, pts, k };
}

describe('ghost hand', () => {
  it('puts the chosen anchor exactly where asked', () => {
    const { pts, k } = posed({ pose: 'point', anchor: 'index-tip' });
    expect(pts[J('index-finger-tip')]!.distanceTo(k.at)).toBeLessThan(1e-6);
  });

  it('the pinch anchor sits between thumb and finger', () => {
    const { pts, k } = posed({ pose: 'pinch', anchor: 'pinch' });
    const mid = pts[J('thumb-tip')]!.clone().add(pts[J('index-finger-tip')]!).multiplyScalar(0.5);
    expect(mid.distanceTo(k.at)).toBeLessThan(1e-6);
    expect(pts[J('thumb-tip')]!.distanceTo(pts[J('index-finger-tip')]!)).toBeLessThan(0.03);
  });

  it('faces the palm and points the fingers as asked, by the same rule the gesture tracker uses', () => {
    for (const [fingers, palm] of [
      [new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
      [new Vector3(0, 1, 0), new Vector3(0, 0, -1)],
      [new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
    ] as const) {
      const { pts } = posed({ pose: 'flat', fingers, palm });
      const w = pts[J('wrist')]!;
      const a = pts[J('index-finger-metacarpal')]!.clone().sub(w);
      const b = pts[J('pinky-finger-metacarpal')]!.clone().sub(w);
      const normal = new Vector3().crossVectors(a, b).normalize(); // right hand, as in HandTracker
      expect(normal.dot(palm)).toBeGreaterThan(0.99);
      const along = pts[J('middle-finger-metacarpal')]!.clone().sub(w).normalize();
      expect(along.dot(fingers)).toBeGreaterThan(0.99);
    }
  });

  it('plays once, fading out, then stops', () => {
    const { g } = posed({});
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) alive = g.update(0.1);
    expect(alive).toBe(false);
    expect(g.playing).toBeNull();
    expect(g.visible).toBe(false);
  });
});
