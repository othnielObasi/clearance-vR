import { Matrix4, Quaternion, Vector3 } from 'three';

const KEY = 'clearance.anchor.v1';

/** Minimal typing for Meta's persistent-anchor extension to WebXR (feature-detected at runtime). */
type PersistentSession = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};
type PersistentAnchor = XRAnchor & { requestPersistentHandle?: () => Promise<string> };

/**
 * Keeps the board locked to a real-world spot with a WebXR spatial anchor, so it
 * stays on the desk even if the headset recentres. Where the browser supports
 * persistent anchors, the spot is remembered for next time.
 */
export class DeskAnchor {
  private anchor?: XRAnchor;
  private pending?: { pos: Vector3; yaw: number };
  private creating = false;
  private restoring = false;
  private session?: PersistentSession;
  private origin = new Matrix4();
  private inv = new Matrix4();
  private q = new Quaternion();
  /** True once a restored or newly placed anchor is tracking. */
  tracking = false;
  /** Set when the board was restored from a previous session. */
  restored = false;

  /** Ask for an anchor at this world pose; created on the next XR frame. */
  place(pos: Vector3, yaw: number) {
    this.clear(false);
    this.pending = { pos: pos.clone(), yaw };
  }

  /** Drop the anchor (while the player moves the board by hand). */
  clear(forget = true) {
    this.anchor?.delete();
    this.anchor = undefined;
    this.tracking = false;
    this.pending = undefined;
    if (forget) this.forgetPersistent();
  }

  /** Try to bring back last session's desk spot. Call once when a session starts. */
  async restore(session: XRSession) {
    const s = session as PersistentSession;
    this.session = s;
    const uuid = safeGet();
    if (!uuid || !s.restorePersistentAnchor || this.restoring) return;
    this.restoring = true;
    try {
      this.anchor = await s.restorePersistentAnchor(uuid);
      this.restored = true;
    } catch {
      safeSet(null); // stale handle: start fresh
    } finally {
      this.restoring = false;
    }
  }

  /**
   * Each frame: create a pending anchor, and report the anchored board pose in world space.
   * Returns null when there is nothing to follow yet.
   */
  update(frame: XRFrame | null, ref: XRReferenceSpace | null, origin: Matrix4): { pos: Vector3; yaw: number } | null {
    if (!frame || !ref) return null;
    this.session = frame.session as PersistentSession;
    this.origin.copy(origin);
    if (this.pending && !this.creating && frame.createAnchor) {
      const { pos, yaw } = this.pending;
      this.pending = undefined;
      this.creating = true;
      // Convert from world to reference space (they differ only if the player origin moved).
      this.inv.copy(origin).invert();
      const p = pos.clone().applyMatrix4(this.inv);
      this.q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      frame
        .createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }), ref)
        ?.then((a) => {
          this.anchor = a;
          void this.persist(a);
        })
        .catch(() => undefined)
        .finally(() => (this.creating = false));
    }
    if (!this.anchor || !frame.trackedAnchors?.has(this.anchor)) {
      this.tracking = false;
      return null;
    }
    const pose = frame.getPose(this.anchor.anchorSpace, ref);
    if (!pose) return null;
    this.tracking = true;
    const t = pose.transform;
    const pos = new Vector3(t.position.x, t.position.y, t.position.z).applyMatrix4(this.origin);
    this.q.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(this.q);
    return { pos, yaw: Math.atan2(fwd.x, fwd.z) };
  }

  private async persist(a: XRAnchor) {
    const pa = a as PersistentAnchor;
    if (!pa.requestPersistentHandle) return;
    try {
      this.forgetPersistent();
      safeSet(await pa.requestPersistentHandle());
    } catch {
      /* persistence not granted: anchor still works this session */
    }
  }

  private forgetPersistent() {
    const uuid = safeGet();
    if (!uuid) return;
    safeSet(null);
    void this.session?.deletePersistentAnchor?.(uuid).catch(() => undefined);
  }
}

function safeGet(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function safeSet(v: string | null) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
