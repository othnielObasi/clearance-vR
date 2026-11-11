import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { findTable } from '../src/xr/table';

/** A fake XR frame with horizontal planes given as world-space rectangles. */
function frameWith(planes: { y: number; x0: number; x1: number; z0: number; z1: number; label?: string; vertical?: boolean }[]) {
  const set = new Set(
    planes.map((p) => ({
      orientation: p.vertical ? 'vertical' : 'horizontal',
      semanticLabel: p.label,
      planeSpace: p,
      // Plane space = world translated up to the plane's height; polygon in plane space.
      polygon: [
        { x: p.x0, y: 0, z: p.z0 },
        { x: p.x1, y: 0, z: p.z0 },
        { x: p.x1, y: 0, z: p.z1 },
        { x: p.x0, y: 0, z: p.z1 },
      ],
    })),
  );
  return {
    detectedPlanes: set,
    getPose: (space: { y: number }) => ({ transform: { matrix: new Matrix4().makeTranslation(0, space.y, 0).toArray() } }),
  } as unknown as XRFrame;
}

const head = new Vector3(0, 1.2, 0);
const forward = new Vector3(0, 0, -1);
const origin = new Matrix4();
const ref = {} as XRReferenceSpace;

describe('findTable', () => {
  it('puts the board a comfortable reach ahead on a table under the player', () => {
    const p = findTable(frameWith([{ y: 0.75, x0: -0.8, x1: 0.8, z0: -1.2, z1: 0.1 }]), ref, origin, head, forward)!;
    expect(p.y).toBeCloseTo(0.75);
    expect(p.z).toBeCloseTo(-0.45);
    expect(p.x).toBeCloseTo(0);
  });

  it('ignores the floor, walls and anything overhead', () => {
    const frame = frameWith([
      { y: 0, x0: -3, x1: 3, z0: -3, z1: 3, label: 'floor' },
      { y: 1.6, x0: -1, x1: 1, z0: -1, z1: 0 },
      { y: 0.75, x0: -1, x1: 1, z0: -1, z1: 0, vertical: true },
    ]);
    expect(findTable(frame, ref, origin, head, forward)).toBeNull();
  });

  it('keeps the board on a small table that does not reach the ideal spot', () => {
    // Table edge starts 0.6 m away: the board goes just inside the near edge.
    const p = findTable(frameWith([{ y: 0.72, x0: -0.5, x1: 0.5, z0: -1.1, z1: -0.6 }]), ref, origin, head, forward)!;
    expect(p.z).toBeLessThan(-0.6);
    expect(p.z).toBeGreaterThan(-0.85);
  });

  it('prefers a surface labelled as a table', () => {
    const frame = frameWith([
      { y: 0.45, x0: -0.3, x1: 0.3, z0: -0.7, z1: -0.2, label: 'couch' },
      { y: 0.74, x0: -0.6, x1: 0.6, z0: -0.9, z1: -0.3, label: 'table' },
    ]);
    expect(findTable(frame, ref, origin, head, forward)!.y).toBeCloseTo(0.74);
  });

  it('returns null without plane detection', () => {
    expect(findTable({} as XRFrame, ref, origin, head, forward)).toBeNull();
  });
});
