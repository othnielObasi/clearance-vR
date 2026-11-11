import { Matrix4, Vector3 } from 'three';

type PlaneFrame = XRFrame & { detectedPlanes?: Set<XRPlane & { semanticLabel?: string }> };

/**
 * Finds the real table with WebXR plane detection (the room the player set up on their Quest).
 * Returns the point on the table where the board centre should go, or null.
 */
export function findTable(frame: XRFrame, ref: XRReferenceSpace, origin: Matrix4, head: Vector3, forward: Vector3): Vector3 | null {
  const planes = (frame as PlaneFrame).detectedPlanes;
  if (!planes?.size) return null;
  const m = new Matrix4();
  let best: { p: Vector3; score: number } | null = null;
  for (const plane of planes) {
    if (plane.orientation !== 'horizontal') continue;
    const pose = frame.getPose(plane.planeSpace, ref);
    if (!pose) continue;
    m.fromArray(pose.transform.matrix).premultiply(origin);
    const poly = plane.polygon.map((q) => new Vector3(q.x, q.y, q.z).applyMatrix4(m));
    if (poly.length < 3) continue;
    const y = poly[0]!.y;
    const below = head.y - y;
    if (below < 0.15 || below > 1.0) continue; // floors, shelves overhead
    // Aim for a spot a comfortable reach in front of the player, kept inside the table.
    const target = new Vector3(head.x + forward.x * 0.45, y, head.z + forward.z * 0.45);
    const p = insidePolygon(target, poly) ? target : pullInside(target, poly, 0.18);
    const reach = Math.hypot(p.x - head.x, p.z - head.z);
    if (reach > 0.9) continue;
    const label = plane.semanticLabel?.toLowerCase() ?? '';
    const score = (label === 'table' || label === 'desk' ? 1 : 0) - p.distanceTo(target);
    if (!best || score > best.score) best = { p, score };
  }
  return best?.p ?? null;
}

function insidePolygon(p: Vector3, poly: Vector3[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Nearest point on the polygon's edge, then a little way in toward its centre. */
function pullInside(p: Vector3, poly: Vector3[], inset: number) {
  let best = poly[0]!.clone();
  let bd = Infinity;
  const ab = new Vector3();
  const ap = new Vector3();
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    ab.subVectors(b, a);
    const t = Math.max(0, Math.min(1, ap.subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
    const q = a.clone().addScaledVector(ab, t);
    const d = q.distanceToSquared(p);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  const centre = poly.reduce((s, q) => s.add(q), new Vector3()).divideScalar(poly.length);
  const toCentre = centre.clone().sub(best);
  const len = toCentre.length();
  if (len > 1e-4) best.addScaledVector(toCentre, Math.min(inset, len) / len);
  return best;
}

