/**
 * The ghost hand: a translucent hand that acts out a gesture in place, on the real board, the
 * first time the player needs it. It replaces paragraphs of instructions with a demonstration:
 * pinch the permit and drop it on the robot; rest a finger on a plan and flick it away; hold a
 * palm up to a moving robot; lay a flat hand on the floor.
 *
 * Hand shapes come from the Immersive Web Emulation Runtime's pose library (MIT, Meta).
 */
import { CylinderGeometry, Matrix4, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { libraryHandPoses } from 'iwer/lib/device/configs/hand/library.js';
import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { pointHandPose } from 'iwer/lib/device/configs/hand/point.js';
import { HAND_JOINTS, HandModel } from './hand-model';

export type GhostPose = 'open' | 'flat' | 'pinch' | 'point';
export type GhostAnchor = 'index-tip' | 'pinch' | 'palm';

export interface GhostKey {
  pose: GhostPose;
  anchor: GhostAnchor;
  /** World position the anchor sits at. */
  at: Vector3;
  /** World direction the fingers point. */
  fingers: Vector3;
  /** World direction the palm faces. */
  palm: Vector3;
  /** Seconds to move here from the previous key. */
  move: number;
  /** Seconds to hold here. */
  hold: number;
  /** Show a ghost permit in the hand at this key. */
  carrying?: boolean;
}

interface PoseData {
  points: Vector3[];
  radii: number[];
  anchors: Record<GhostAnchor, Vector3>;
  basis: Matrix4;
}

type RawPose = { jointTransforms: Record<string, { offsetMatrix: ArrayLike<number>; radius: number }> };

function poseData(raw: RawPose): PoseData {
  const points = HAND_JOINTS.map((n) => {
    const m = raw.jointTransforms[n]!.offsetMatrix;
    return new Vector3(m[12], m[13], m[14]);
  });
  const radii = HAND_JOINTS.map((n) => raw.jointTransforms[n]!.radius);
  const P = (n: (typeof HAND_JOINTS)[number]) => points[HAND_JOINTS.indexOf(n)]!;
  // The same frame the gesture tracker uses: fingers along the middle metacarpal, palm normal from
  // the metacarpal fan (right hand). Keeps "palm faces X" meaning the same thing in both places.
  const f = new Vector3().subVectors(P('middle-finger-metacarpal'), P('wrist')).normalize();
  const a = new Vector3().subVectors(P('index-finger-metacarpal'), P('wrist'));
  const b = new Vector3().subVectors(P('pinky-finger-metacarpal'), P('wrist'));
  const n = new Vector3().crossVectors(a, b).normalize();
  return {
    points,
    radii,
    anchors: {
      'index-tip': P('index-finger-tip').clone(),
      pinch: P('index-finger-tip').clone().add(P('thumb-tip')).multiplyScalar(0.5),
      palm: P('wrist').clone().add(P('middle-finger-metacarpal')).multiplyScalar(0.5),
    },
    basis: frameBasis(f, n),
  };
}

/** Orthonormal basis (fingers, palm, side) as matrix columns. */
function frameBasis(fingers: Vector3, palm: Vector3) {
  const f = fingers.clone().normalize();
  const n = palm.clone().sub(f.clone().multiplyScalar(palm.dot(f))).normalize();
  const s = new Vector3().crossVectors(f, n);
  return new Matrix4().makeBasis(f, n, s);
}

let POSES: Record<GhostPose, PoseData> | undefined;
const poses = () =>
  (POSES ??= {
    open: poseData(libraryHandPoses.open as unknown as RawPose),
    flat: poseData(libraryHandPoses.flat as unknown as RawPose),
    point: poseData(pointHandPose as unknown as RawPose),
    pinch: poseData(pinchHandPose as unknown as RawPose),
  });

/** World joint positions for one key. */
function place(key: GhostKey, out: Vector3[]) {
  const p = poses()[key.pose];
  const rot = frameBasis(key.fingers, key.palm).multiply(p.basis.clone().transpose());
  const anchor = p.anchors[key.anchor];
  p.points.forEach((v, i) => (out[i] ??= new Vector3()).copy(v).sub(anchor).applyMatrix4(rot).add(key.at));
  return p.radii;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class GhostHand extends Object3D {
  readonly hand = new HandModel({ color: 0x8fe9ff, opacity: 0.5, emissive: 0x2bb8e0 });
  private permit: Mesh;
  private keys: GhostKey[] = [];
  private placed: { points: Vector3[]; radii: number[] }[] = [];
  private t = 0;
  private length = 0;
  private loops = 0;
  private maxLoops = 0;
  private work: Vector3[] = HAND_JOINTS.map(() => new Vector3());
  private radii: number[] = HAND_JOINTS.map(() => 0.01);
  /** The demonstration now playing, if any. */
  playing: string | null = null;

  constructor() {
    super();
    this.permit = new Mesh(
      new CylinderGeometry(0.012, 0.012, 0.004, 24),
      new MeshBasicMaterial({ color: 0x58f0a0, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.permit.renderOrder = 8;
    this.add(this.hand, this.permit);
    this.visible = false;
  }

  /** Play a demonstration, looping it up to `loops` times. Keys are in world space. */
  play(name: string, keys: GhostKey[], loops = 4) {
    this.playing = name;
    this.keys = keys;
    this.placed = keys.map((k) => {
      const points = HAND_JOINTS.map(() => new Vector3());
      const radii = place(k, points);
      return { points, radii };
    });
    this.length = keys.reduce((s, k) => s + k.move + k.hold, 0) + FADE * 2 + GAP;
    this.t = 0;
    this.loops = 0;
    this.maxLoops = loops;
    this.visible = true;
  }

  stop() {
    this.playing = null;
    this.visible = false;
  }

  /** Advance; returns false once the demonstration has finished all its loops. */
  update(dt: number): boolean {
    if (!this.playing) return false;
    this.t += dt;
    if (this.t >= this.length) {
      this.t = 0;
      if (++this.loops >= this.maxLoops) {
        this.stop();
        return false;
      }
    }
    // Fade in, run the keys, fade out, short gap.
    const body = this.length - FADE * 2 - GAP;
    const tt = this.t - FADE;
    const alpha = this.t < FADE ? this.t / FADE : tt > body + FADE ? 0 : tt > body ? 1 - (tt - body) / FADE : 1;
    this.hand.material.opacity = 0.5 * alpha;
    (this.permit.material as MeshBasicMaterial).opacity = 0.55 * alpha;

    // Which key are we moving to, and how far along?
    let clock = Math.max(0, Math.min(body, tt));
    let i = 0;
    let blend = 1;
    for (; i < this.keys.length; i++) {
      const k = this.keys[i]!;
      if (clock < k.move) {
        blend = k.move > 0 ? smooth(clock / k.move) : 1;
        break;
      }
      clock -= k.move;
      if (clock < k.hold) {
        blend = 1;
        break;
      }
      clock -= k.hold;
    }
    i = Math.min(i, this.keys.length - 1);
    const to = this.placed[i]!;
    const from = this.placed[Math.max(0, i - 1)]!;
    for (let j = 0; j < this.work.length; j++) {
      this.work[j]!.lerpVectors(from.points[j]!, to.points[j]!, i === 0 ? 1 : blend);
      this.radii[j] = from.radii[j]! + (to.radii[j]! - from.radii[j]!) * (i === 0 ? 1 : blend);
    }
    this.hand.setJoints(this.work, this.radii);

    // The ghost permit rides between thumb and finger while carrying.
    const carrying = this.keys[i]!.carrying && (i === 0 || this.keys[i - 1]!.carrying || blend > 0.5);
    this.permit.visible = !!carrying;
    if (carrying) {
      const thumb = this.work[HAND_JOINTS.indexOf('thumb-tip')]!;
      const index = this.work[HAND_JOINTS.indexOf('index-finger-tip')]!;
      this.permit.position.addVectors(thumb, index).multiplyScalar(0.5);
    }
    return true;
  }
}

const FADE = 0.35;
const GAP = 0.6;
