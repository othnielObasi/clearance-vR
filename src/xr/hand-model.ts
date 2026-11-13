/**
 * A stylised hand drawn from the 25 WebXR hand joints: a ball at every joint and a capsule
 * along every bone, in two instanced draw calls. On a Quest the player sees their real hands
 * through passthrough, so this is used only for the emulator's hands (filming without a headset)
 * and, translucent, for the tutorial's ghost hand.
 */
import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector3 } from 'three';

export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
] as const;
export type HandJoint = (typeof HAND_JOINTS)[number];

const J = (n: HandJoint) => HAND_JOINTS.indexOf(n);
const chain = (names: HandJoint[]) => names.slice(1).map((n, i) => [J(names[i]!), J(n)] as const);
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const BONES: (readonly [number, number])[] = [
  ...chain(['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']),
  ...FINGERS.flatMap((f) =>
    chain([
      'wrist',
      `${f}-finger-metacarpal`,
      `${f}-finger-phalanx-proximal`,
      `${f}-finger-phalanx-intermediate`,
      `${f}-finger-phalanx-distal`,
      `${f}-finger-tip`,
    ] as HandJoint[]),
  ),
  // Across the knuckles and the base of the palm, so it reads as a hand and not a set of sticks.
  ...chain(['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']),
  ...chain(['thumb-phalanx-proximal', 'index-finger-phalanx-proximal']),
  ...chain(['index-finger-metacarpal', 'middle-finger-metacarpal', 'ring-finger-metacarpal', 'pinky-finger-metacarpal']),
];

/** Joint radii (m) when the source gives none: thicker at the palm, thinner at the tips. */
function defaultRadius(i: number) {
  const n = HAND_JOINTS[i]!;
  if (n === 'wrist') return 0.02;
  if (n.endsWith('metacarpal')) return 0.016;
  if (n.endsWith('tip')) return 0.0075;
  if (n.endsWith('distal')) return 0.0085;
  return 0.0105;
}

export interface HandLook {
  color: number;
  opacity?: number;
  emissive?: number;
}

export class HandModel extends Object3D {
  private joints: InstancedMesh;
  private bones: InstancedMesh;
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private d = new Vector3();
  private yAxis = new Vector3(0, 1, 0);
  readonly material: MeshStandardMaterial;

  constructor(look: HandLook) {
    super();
    const translucent = (look.opacity ?? 1) < 1;
    this.material = new MeshStandardMaterial({
      color: look.color,
      roughness: 0.55,
      metalness: 0,
      transparent: translucent,
      opacity: look.opacity ?? 1,
      depthWrite: !translucent,
      emissive: new Color(look.emissive ?? 0x000000),
      emissiveIntensity: look.emissive ? 0.9 : 0,
    });
    this.joints = new InstancedMesh(new SphereGeometry(1, 12, 8), this.material, HAND_JOINTS.length);
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 10, 1, true), this.material, BONES.length);
    for (const im of [this.joints, this.bones]) {
      im.frustumCulled = false;
      im.renderOrder = translucent ? 8 : 0;
    }
    this.add(this.joints, this.bones);
  }

  /** Pose the hand from joint positions in this object's parent space, in HAND_JOINTS order. */
  setJoints(p: Vector3[], radii?: number[]) {
    const r = (i: number) => radii?.[i] ?? defaultRadius(i);
    for (let i = 0; i < HAND_JOINTS.length; i++) {
      const k = r(i) * 0.95;
      this.m.compose(p[i]!, this.q.identity(), this.s.set(k, k, k));
      this.joints.setMatrixAt(i, this.m);
    }
    BONES.forEach(([a, b], i) => {
      this.d.subVectors(p[b]!, p[a]!);
      const len = this.d.length();
      const k = Math.min(r(a), r(b)) * 0.85;
      this.q.setFromUnitVectors(this.yAxis, len > 1e-6 ? this.d.divideScalar(len) : this.yAxis);
      this.m.compose(this.s.addVectors(p[a]!, p[b]!).multiplyScalar(0.5), this.q, this.d.set(k, len, k));
      this.bones.setMatrixAt(i, this.m);
    });
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }
}
