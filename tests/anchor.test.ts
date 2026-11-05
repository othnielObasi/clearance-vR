import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DeskAnchor } from '../src/xr/anchor';

// Minimal stand-ins for the WebXR objects the anchor uses.
class FakeRigid {
  constructor(
    public position: DOMPointInit,
    public orientation: DOMPointInit,
  ) {}
}
Object.assign(globalThis, { XRRigidTransform: FakeRigid });

function fakeFrame() {
  const anchors = new Set<unknown>();
  let stored: FakeRigid | undefined;
  const anchor = { anchorSpace: {}, delete: () => anchors.delete(anchor) };
  const frame = {
    session: {},
    trackedAnchors: anchors,
    createAnchor: (pose: FakeRigid) => {
      stored = pose;
      anchors.add(anchor);
      return Promise.resolve(anchor);
    },
    getPose: () => (stored ? { transform: stored } : null),
  };
  return frame as unknown as XRFrame;
}

describe('DeskAnchor', () => {
  it('locks the board to the placed pose, position and facing', async () => {
    const a = new DeskAnchor();
    const frame = fakeFrame();
    const ref = {} as XRReferenceSpace;
    const origin = new Matrix4();
    a.place(new Vector3(0.2, 0.74, -0.4), 0.6);
    expect(a.update(frame, ref, origin)).toBeNull(); // created asynchronously
    await Promise.resolve();
    await Promise.resolve();
    const pose = a.update(frame, ref, origin)!;
    expect(pose.pos.x).toBeCloseTo(0.2);
    expect(pose.pos.y).toBeCloseTo(0.74);
    expect(pose.pos.z).toBeCloseTo(-0.4);
    expect(pose.yaw).toBeCloseTo(0.6);
    expect(a.tracking).toBe(true);
  });

  it('stops following once cleared (while the player moves the board)', async () => {
    const a = new DeskAnchor();
    const frame = fakeFrame();
    a.place(new Vector3(0, 0.7, -0.4), 0);
    a.update(frame, {} as XRReferenceSpace, new Matrix4());
    await Promise.resolve();
    await Promise.resolve();
    a.clear();
    expect(a.update(frame, {} as XRReferenceSpace, new Matrix4())).toBeNull();
    expect(a.tracking).toBe(false);
  });
});
