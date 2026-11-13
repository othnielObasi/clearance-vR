import { HAND_JOINTS } from './hand-model';
import { Matrix4, Vector3 } from 'three';

/** All gesture thresholds in one place, so accessibility settings can relax them. */
// Defaults are set a little forgiving because they could not be tuned on a headset: the hold
// timers, not tight thresholds, are what stop gestures firing by accident.
export const GESTURE = {
  pinchOn: 0.018,
  pinchOff: 0.028,
  openTipDist: 0.13,
  palmHoldSec: 0.3,
  palmConeCos: Math.cos((40 * Math.PI) / 180),
  palmMaxDist: 0.6,
  palmMinDist: 0.06,
  bothPalmsHoldSec: 0.5,
  palmUpY: 0.7,
  flickSpeed: 0.85,
  flickCooldown: 0.6,
};

const STANDARD = { ...GESTURE };

/**
 * Assist mode, for players with limited reach, grip or steadiness: pinches register
 * further apart, a partly open hand counts as open, the palm can point less exactly,
 * and a slower flick rejects. The hold times stay the same, so a resting hand
 * still does not stop robots by accident.
 */
const RELAXED: Partial<typeof GESTURE> = {
  pinchOn: 0.022,
  pinchOff: 0.035,
  openTipDist: 0.11,
  palmConeCos: Math.cos((50 * Math.PI) / 180),
  palmMaxDist: 0.75,
  flickSpeed: 0.65,
};

export function applyAssist(on: boolean) {
  Object.assign(GESTURE, STANDARD, on ? RELAXED : {});
}

export type Handedness = 'left' | 'right';

export interface HandFrame {
  side: Handedness;
  tracked: boolean;
  wrist: Vector3;
  indexTip: Vector3;
  thumbTip: Vector3;
  palm: Vector3;
  /** Unit normal pointing out of the palm. */
  palmNormal: Vector3;
  pinching: boolean;
  /** Thumb tip to index tip, metres. */
  pinchDist: number;
  open: boolean;
  /** Smoothed index-tip velocity, m/s. */
  velocity: Vector3;
}

const JOINTS = [
  'wrist',
  'thumb-tip',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
  'index-finger-metacarpal',
  'middle-finger-metacarpal',
  'pinky-finger-metacarpal',
] as const;

const blank = (side: Handedness): HandFrame => ({
  side,
  tracked: false,
  wrist: new Vector3(),
  indexTip: new Vector3(),
  thumbTip: new Vector3(),
  palm: new Vector3(),
  palmNormal: new Vector3(0, -1, 0),
  pinching: false,
  pinchDist: 1,
  open: false,
  velocity: new Vector3(),
});

/**
 * Reads WebXR hand joints each frame and derives the features gameplay needs.
 * Works directly on the XR frame so it does not depend on any visual hand rig.
 */
export class HandTracker {
  readonly hands: Record<Handedness, HandFrame> = { left: blank('left'), right: blank('right') };
  /**
   * All 25 joints per hand (world space) and their radii, read only when `readAllJoints` is set:
   * for drawing hands where passthrough can't show the real ones (the emulator).
   */
  readAllJoints = false;
  readonly allJoints: Record<Handedness, { points: Vector3[]; radii: number[]; ok: boolean }> = {
    left: { points: HAND_JOINTS.map(() => new Vector3()), radii: HAND_JOINTS.map(() => 0.01), ok: false },
    right: { points: HAND_JOINTS.map(() => new Vector3()), radii: HAND_JOINTS.map(() => 0.01), ok: false },
  };
  private pos: Record<string, Vector3> = {};
  private lastTip: Record<Handedness, Vector3 | null> = { left: null, right: null };
  private a = new Vector3();
  private b = new Vector3();

  update(frame: XRFrame | null, ref: XRReferenceSpace | null, origin: Matrix4, dt: number) {
    for (const side of ['left', 'right'] as const) {
      this.hands[side].tracked = false;
      this.allJoints[side].ok = false;
    }
    if (!frame || !ref) return;
    for (const src of frame.session.inputSources) {
      if (!src.hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const h = this.hands[src.handedness];
      let ok = true;
      for (const name of JOINTS) {
        const space = src.hand.get(name);
        const pose = space && frame.getJointPose?.(space, ref);
        if (!pose) {
          ok = false;
          break;
        }
        const p = pose.transform.position;
        (this.pos[name] ??= new Vector3()).set(p.x, p.y, p.z).applyMatrix4(origin);
      }
      if (!ok) {
        this.lastTip[src.handedness] = null;
        continue;
      }
      this.derive(h, dt);
      if (this.readAllJoints) {
        const all = this.allJoints[src.handedness];
        all.ok = HAND_JOINTS.every((name, i) => {
          const space = src.hand!.get(name);
          const pose = space && frame.getJointPose?.(space, ref);
          if (!pose) return false;
          const p = pose.transform.position;
          all.points[i]!.set(p.x, p.y, p.z).applyMatrix4(origin);
          all.radii[i] = pose.radius ?? 0.01;
          return true;
        });
      }
    }
  }

  private derive(h: HandFrame, dt: number) {
    const P = this.pos as Record<(typeof JOINTS)[number], Vector3>;
    h.tracked = true;
    h.wrist.copy(P.wrist);
    h.indexTip.copy(P['index-finger-tip']);
    h.thumbTip.copy(P['thumb-tip']);
    h.palm.copy(P.wrist).add(P['middle-finger-metacarpal']).multiplyScalar(0.5);

    // Palm normal from the metacarpal fan; sign depends on handedness.
    this.a.subVectors(P['index-finger-metacarpal'], P.wrist);
    this.b.subVectors(P['pinky-finger-metacarpal'], P.wrist);
    if (h.side === 'right') h.palmNormal.crossVectors(this.a, this.b);
    else h.palmNormal.crossVectors(this.b, this.a);
    h.palmNormal.normalize();

    const pinchD = h.thumbTip.distanceTo(h.indexTip);
    h.pinchDist = pinchD;
    h.pinching = h.pinching ? pinchD < GESTURE.pinchOff : pinchD < GESTURE.pinchOn;
    const tips = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const;
    const spread = tips.reduce((s, t) => s + P[t].distanceTo(P.wrist), 0) / tips.length;
    h.open = !h.pinching && spread > GESTURE.openTipDist;

    const last = this.lastTip[h.side];
    if (last && dt > 0) {
      this.a.subVectors(h.indexTip, last).divideScalar(dt);
      h.velocity.lerp(this.a, 0.5);
      last.copy(h.indexTip);
    } else {
      this.lastTip[h.side] = h.indexTip.clone();
      h.velocity.set(0, 0, 0);
    }
  }
}

/** Accumulates how long a condition has held; fires once per hold. */
export class HoldTimer {
  private t = 0;
  private fired = false;
  key: string | null = null;

  /** Returns progress 0..1; `true` in `fired` when it crosses the threshold. */
  step(active: boolean, key: string | null, dt: number, threshold: number): { progress: number; fire: boolean } {
    if (!active || key !== this.key) {
      this.t = 0;
      this.fired = false;
      this.key = active ? key : null;
      if (!active) return { progress: 0, fire: false };
    }
    this.t += dt;
    const fire = !this.fired && this.t >= threshold;
    if (fire) this.fired = true;
    return { progress: Math.min(1, this.t / threshold), fire };
  }
}
