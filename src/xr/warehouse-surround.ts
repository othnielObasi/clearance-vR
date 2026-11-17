/**
 * The warehouse around the board: racking rows, busy background robots and a conveyor on the
 * left, right and far sides of the playable board, so the board reads as the near corner of a
 * large warehouse rather than a tray on the desk. The near side stays clear for the player's
 * arms, the permit dispenser and the move handle.
 *
 * Purely decorative: nothing here is interactable or affects the game. It dissolves with distance
 * from the board (an ordered-dither fade, so it stays in the opaque pass with no transparency
 * sorting) instead of ending in a hard edge off the real table.
 *
 * Cost: built once and reused across levels; about ten draw calls. On a real headset it hides
 * itself if frames get slow. `?nowarehouse` turns it off.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { makeRack, mergeStatic, RACK_TALL, trackRackMaterial } from './look';
import { COLORS, TILE } from './models';

const PITCH = TILE; // racks sit on the board's grid pitch
const ROW_GAP = 0.1; // centre to centre between rack rows (aisle about 6 cm, board units)
/** Clear strip along the board's near side (board units): dispenser, gold pad, corner buttons. */
const FRONT_CLEAR = 0.15;

/** Shared fade uniforms: board centre (world) and fade start/end distance (world metres). */
const FADE = {
  center: { value: new Vector3() },
  range: { value: new Vector2(0.5, 1) },
};

const BAYER_GLSL = `
const float decoBayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
`;

/** Dissolve a material with distance from the board centre (ordered dither, no blending). */
function withFade<T extends Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDecoCenter = FADE.center;
    shader.uniforms.uDecoFade = FADE.range;
    shader.vertexShader =
      'varying vec3 vDecoWorld;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 decoWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          decoWorld = instanceMatrix * decoWorld;
        #endif
        vDecoWorld = (modelMatrix * decoWorld).xyz;`,
      );
    shader.fragmentShader =
      'uniform vec3 uDecoCenter;\nuniform vec2 uDecoFade;\nvarying vec3 vDecoWorld;\n' +
      BAYER_GLSL +
      shader.fragmentShader.replace(
        'void main() {',
        `void main() {
        float decoA = 1.0 - smoothstep(uDecoFade.x, uDecoFade.y, length(vDecoWorld.xz - uDecoCenter.xz));
        ivec2 decoP = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
        if (decoA < (decoBayer[decoP.x + decoP.y * 4] + 0.5) / 16.0) discard;`,
      );
  };
  mat.customProgramCacheKey = () => 'airg-deco-fade';
  return mat;
}

function concreteTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8c9097';
  g.fillRect(0, 0, 256, 256);
  let r = 99991;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const v = 120 + Math.floor(rand() * 40);
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.35)`;
    g.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  // Slab joints.
  g.strokeStyle = 'rgba(60,64,70,0.45)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

interface Bot {
  axis: 'x' | 'z';
  /** Aisle line (the fixed coordinate). */
  line: number;
  from: number;
  to: number;
  speed: number;
  phase: number;
  carrying: boolean;
}

export class WarehouseSurround {
  readonly root = new Group();
  private bots: Bot[] = [];
  private bodies: InstancedMesh;
  private lights: InstancedMesh;
  private loads: InstancedMesh;
  private parcels: InstancedMesh;
  private parcelCount = 9;
  private conveyor = { from: 0, to: 0, z: 0, y: 0 };
  private m = new Matrix4();
  private p = new Vector3();
  private slowFor = 0;
  private avgDt = 1 / 72;
  private disabled = false;
  private readonly guard: boolean;
  private readonly fadeStart: number;
  private readonly fadeEnd: number;
  private on = new Color(0xb8ffff);
  private off = new Color(0x1d3a3c);

  /** `width`/`depth` are the board's size in board units. */
  constructor(width: number, depth: number, guardFrameRate: boolean) {
    this.guard = guardFrameRate;
    const halfW = width / 2;
    const halfD = depth / 2;
    this.fadeStart = Math.hypot(halfW, halfD) + 0.06;
    this.fadeEnd = this.fadeStart + 0.38;
    const reach = this.fadeEnd + 0.02;

    // Floor: from the board's near edge back, out to where the fade ends.
    const tex = concreteTexture();
    tex.repeat.set((reach * 2) / (PITCH * 4), (reach + halfD) / (PITCH * 4));
    const floor = new Mesh(
      new PlaneGeometry(reach * 2, reach + halfD),
      withFade(new MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.0118, halfD - (reach + halfD) / 2);
    this.root.add(floor);

    // Aisle markings on the floor: yellow lines along every aisle.
    const lineMat = withFade(new MeshBasicMaterial({ color: COLORS.zone }));
    const lines = new Group();

    // Racking.
    const racks = new Group();
    let seed = 1;
    const backRows = [0, 1, 2].map((i) => -(halfD + 0.14 + i * ROW_GAP));
    for (const z of backRows) {
      for (let x = -reach + PITCH / 2; x <= reach - PITCH / 2; x += PITCH) {
        if (Math.hypot(x, z) > reach) continue;
        const r = makeRack(seed++, true);
        r.position.set(x, -0.0118, z);
        racks.add(r);
      }
    }
    const sideRows = [0, 1, 2].map((j) => halfW + 0.08 + j * ROW_GAP);
    for (const side of [-1, 1])
      for (const x of sideRows) {
        // Racks start behind the front corners, where the permit dispenser and the
        // stop-all and pause buttons sit.
        for (let z = halfD - FRONT_CLEAR - PITCH / 2; z >= -(halfD + 0.05); z -= PITCH) {
          if (Math.hypot(x, z) > reach) continue;
          const r = makeRack(seed++, seed % 3 !== 0);
          r.position.set(side * x, -0.0118, z);
          r.rotation.y = Math.PI / 2;
          racks.add(r);
        }
      }
    const merged = mergeStatic(racks);
    const clones = new Map<Material, Material>();
    merged.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const original = mesh.material as Material;
      let clone = clones.get(original);
      if (!clone) {
        clone = withFade(original.clone());
        if ((clone as MeshStandardMaterial).isMeshStandardMaterial) trackRackMaterial(clone as MeshStandardMaterial);
        clones.set(original, clone);
      }
      mesh.material = clone;
    });
    this.root.add(merged);

    // Background robots, driving the aisles between rows.
    const backAisles = backRows.slice(0, -1).map((z, i) => (z + backRows[i + 1]!) / 2);
    const sideAisles = sideRows.slice(0, -1).map((x, i) => (x + sideRows[i + 1]!) / 2);
    let k = 0;
    for (const z of backAisles)
      for (let n = 0; n < 2; n++)
        this.bots.push({ axis: 'x', line: z, from: -reach * 0.8, to: reach * 0.8, speed: 0.22 + 0.07 * n, phase: n * 2.4 + k++, carrying: n === 0 });
    for (const side of [-1, 1])
      for (const x of sideAisles)
        this.bots.push({ axis: 'z', line: side * x, from: halfD - FRONT_CLEAR, to: -(halfD + 0.05), speed: 0.3, phase: k++ * 1.7, carrying: k % 2 === 0 });
    // A lane just behind the dock, the busiest one.
    const dockLane = -(halfD + 0.07);
    this.bots.push({ axis: 'x', line: dockLane, from: -reach * 0.7, to: reach * 0.7, speed: 0.35, phase: 0.6, carrying: true });

    for (const z of backAisles) {
      const l = new Mesh(new PlaneGeometry(reach * 1.6, 0.0016), lineMat);
      l.rotation.x = -Math.PI / 2;
      l.position.set(0, -0.0112, z);
      lines.add(l);
    }
    for (const side of [-1, 1])
      for (const x of sideAisles) {
        const len = halfD * 2 + 0.05 - FRONT_CLEAR;
        const l = new Mesh(new PlaneGeometry(0.0016, len), lineMat);
        l.rotation.x = -Math.PI / 2;
        l.position.set(side * x, -0.0112, halfD - FRONT_CLEAR - len / 2);
        lines.add(l);
      }
    this.root.add(mergeStatic(lines));

    const n = this.bots.length;
    const bodyMat = withFade(new MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 }));
    this.bodies = new InstancedMesh(new BoxGeometry(TILE * 0.8, 0.018, TILE * 0.8), bodyMat, n);
    this.lights = new InstancedMesh(new BoxGeometry(0.009, 0.007, 0.009), withFade(new MeshBasicMaterial()), n);
    this.loads = new InstancedMesh(new BoxGeometry(TILE * 0.6, 0.018, TILE * 0.6), withFade(new MeshStandardMaterial({ color: COLORS.crate, roughness: 0.8 })), n);
    this.bots.forEach((b, i) => {
      this.bodies.setColorAt(i, new Color(COLORS.robot[i % COLORS.robot.length]!));
      this.lights.setColorAt(i, this.on);
    });

    // Conveyor across the back, raised above the dock wall, carrying parcels away.
    this.conveyor = { from: -reach * 0.85, to: reach * 0.85, z: -(halfD + 0.035), y: RACK_TALL * 0.82 };
    const beltLen = this.conveyor.to - this.conveyor.from;
    const belt = new Group();
    const beltTop = new Mesh(new BoxGeometry(beltLen, 0.004, 0.026), new MeshStandardMaterial({ color: 0x23272d, roughness: 0.6 }));
    beltTop.position.set(0, this.conveyor.y, this.conveyor.z);
    belt.add(beltTop);
    for (const z of [-1, 1]) {
      const rail = new Mesh(new BoxGeometry(beltLen, 0.006, 0.003), new MeshStandardMaterial({ color: 0xf07b1a, roughness: 0.5, metalness: 0.3 }));
      rail.position.set(0, this.conveyor.y + 0.003, this.conveyor.z + z * 0.0145);
      belt.add(rail);
    }
    for (let x = this.conveyor.from; x <= this.conveyor.to; x += 0.12) {
      const leg = new Mesh(new BoxGeometry(0.004, this.conveyor.y, 0.004), new MeshStandardMaterial({ color: 0x5b6470, roughness: 0.5, metalness: 0.4 }));
      leg.position.set(x, this.conveyor.y / 2 - 0.0118, this.conveyor.z);
      belt.add(leg);
    }
    const beltMerged = mergeStatic(belt);
    beltMerged.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.material = withFade((mesh.material as Material).clone());
    });
    this.root.add(beltMerged);
    this.parcels = new InstancedMesh(new BoxGeometry(0.016, 0.012, 0.016), withFade(new MeshStandardMaterial({ color: 0xc99257, roughness: 0.8 })), this.parcelCount);

    for (const im of [this.bodies, this.lights, this.loads, this.parcels]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
    this.root.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /** Animate, keep the fade centred on the board, and hide on a slow device. */
  update(dt: number, time: number, board: Object3D) {
    if (this.disabled) return;
    if (this.guard && dt > 0) {
      this.avgDt += (dt - this.avgDt) * 0.05;
      this.slowFor = this.avgDt > 1 / 50 ? this.slowFor + dt : 0;
      if (this.slowFor > 2) {
        this.disabled = true;
        this.root.visible = false;
        console.warn('[clearance] warehouse surroundings hidden to keep the frame rate up');
        return;
      }
    }
    board.getWorldPosition(FADE.center.value);
    const s = board.getWorldScale(this.p).x;
    FADE.range.value.set(this.fadeStart * s, this.fadeEnd * s);

    this.bots.forEach((b, i) => {
      // Ping-pong along the aisle, easing at each end like a robot stopping to pick.
      const span = Math.abs(b.to - b.from);
      const u = 0.5 - 0.5 * Math.cos(((time * b.speed) / span) * Math.PI * 2 + b.phase);
      const along = b.from + (b.to - b.from) * u;
      const x = b.axis === 'x' ? along : b.line;
      const z = b.axis === 'x' ? b.line : along;
      const heading = Math.sin(((time * b.speed) / span) * Math.PI * 2 + b.phase) >= 0 ? 0 : Math.PI;
      this.m.makeRotationY(b.axis === 'x' ? heading : heading + Math.PI / 2).setPosition(x, -0.0118 + 0.009, z);
      this.bodies.setMatrixAt(i, this.m);
      this.m.setPosition(x, -0.0118 + 0.0215, z);
      this.lights.setMatrixAt(i, this.m);
      this.lights.setColorAt(i, Math.sin(time * 5 + i) > 0.2 ? this.on : this.off);
      this.m.setPosition(x, b.carrying ? -0.0118 + 0.027 : -1000, z);
      this.loads.setMatrixAt(i, this.m);
    });
    const len = this.conveyor.to - this.conveyor.from;
    for (let i = 0; i < this.parcelCount; i++) {
      const x = this.conveyor.from + ((time * 0.05 + (i / this.parcelCount) * len) % len);
      this.m.makeTranslation(x, this.conveyor.y + 0.008, this.conveyor.z);
      this.parcels.setMatrixAt(i, this.m);
    }
    for (const im of [this.bodies, this.lights, this.loads, this.parcels]) im.instanceMatrix.needsUpdate = true;
    if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
  }
}

let shared: { key: string; surround: WarehouseSurround } | undefined;

/** One warehouse, built on first use and moved between boards of the same size. */
export function getWarehouseSurround(width: number, depth: number): WarehouseSurround | null {
  if (typeof location !== 'undefined') {
    const params = new URLSearchParams(location.search);
    if (params.has('nowarehouse')) return null;
  }
  const key = `${width}x${depth}`;
  if (shared?.key !== key) {
    const guard = typeof location === 'undefined' || !new URLSearchParams(location.search).has('emulate');
    shared = { key, surround: new WarehouseSurround(width, depth, guard) };
  }
  return shared.surround;
}
