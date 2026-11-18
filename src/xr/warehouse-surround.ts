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
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Points,
  PointsMaterial,
  SphereGeometry,
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
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, makeRack, mergeStatic, painted, placed, RACK_TALL, trackRackMaterial } from './look';
import { COLORS, TILE } from './models';

const PITCH = TILE; // racks sit on the board's grid pitch
/** Warehouse floor height (board units): flush with the board surface, so the board reads as a
 * marked zone on one continuous floor rather than a platform standing on it. */
const FLOOR_Y = -0.0004;
const ROW_GAP = 0.1; // centre to centre between rack rows (aisle about 6 cm, board units)
/** Clear strip along the board's near side (board units): dispenser, gold pad, corner buttons. */
const FRONT_CLEAR = 0.15;

/** Most corners kept from a detected desk outline. */
const DESK_MAX = 16;

/**
 * Shared fade uniforms: board centre (world), fade start/end distance (world metres), and the
 * real desk's outline (world XZ) when plane detection found it. Outside the desk nothing is drawn,
 * so the warehouse never hangs in the air past the table's edge.
 */
const FADE = {
  center: { value: new Vector3() },
  range: { value: new Vector2(0.5, 1) },
  desk: { value: Array.from({ length: DESK_MAX }, () => new Vector2()) },
  deskN: { value: 0 },
};

const BAYER_GLSL = `
const float decoBayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
`;

/** Dissolve a material with distance from the board centre (ordered dither, no blending). */
function withFade<T extends Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDecoCenter = FADE.center;
    shader.uniforms.uDecoFade = FADE.range;
    shader.uniforms.uDecoDesk = FADE.desk;
    shader.uniforms.uDecoDeskN = FADE.deskN;
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
      `uniform vec3 uDecoCenter;\nuniform vec2 uDecoFade;\nuniform vec2 uDecoDesk[${DESK_MAX}];\nuniform int uDecoDeskN;\nvarying vec3 vDecoWorld;\n` +
      BAYER_GLSL +
      shader.fragmentShader.replace(
        'void main() {',
        `void main() {
        float decoA = 1.0 - smoothstep(uDecoFade.x, uDecoFade.y, length(vDecoWorld.xz - uDecoCenter.xz));
        if (uDecoDeskN >= 3) {
          // Inside the real desk (even-odd rule), dissolving over the last 3 cm to its edge.
          vec2 decoQ = vDecoWorld.xz;
          bool decoIn = false;
          float decoEdge = 1e9;
          for (int i = 0; i < ${DESK_MAX}; i++) {
            if (i >= uDecoDeskN) break;
            vec2 a = uDecoDesk[i];
            vec2 b = uDecoDesk[i == 0 ? uDecoDeskN - 1 : i - 1];
            if ((a.y > decoQ.y) != (b.y > decoQ.y) && decoQ.x < (b.x - a.x) * (decoQ.y - a.y) / (b.y - a.y) + a.x) decoIn = !decoIn;
            vec2 ab = b - a;
            float t = clamp(dot(decoQ - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
            decoEdge = min(decoEdge, length(decoQ - a - ab * t));
          }
          decoA *= decoIn ? smoothstep(0.0, 0.03, decoEdge) : 0.0;
        }
        ivec2 decoP = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
        if (decoA < (decoBayer[decoP.x + decoP.y * 4] + 0.5) / 16.0) discard;`,
      );
  };
  mat.customProgramCacheKey = () => 'clearance-deco-fade';
  return mat;
}

function concreteTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9d4c8';
  g.fillRect(0, 0, 256, 256);
  let r = 99991;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const v = 175 + Math.floor(rand() * 40);
    g.fillStyle = `rgba(${v},${v - 2},${v - 8},0.35)`;
    g.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  // Slab joints.
  g.strokeStyle = 'rgba(120,112,98,0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/**
 * Back and forth along an aisle with a pause at each end: where it is (0..1 along from→to),
 * which way it faces (+1 toward `to`), and how much it is walking (0 standing, 1 full stride).
 */
function patrol(time: number, span: number, speed: number, phase: number, dwell: number) {
  const walk = Math.max(0.1, span / speed);
  const cycle = 2 * (walk + dwell);
  let t = (time + phase * walk) % cycle;
  if (t < 0) t += cycle;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  if (t < walk) return { u: ease(t / walk), dir: 1, moving: Math.sin(Math.PI * (t / walk)) };
  t -= walk;
  if (t < dwell) return { u: 1, dir: 1, moving: 0 };
  t -= dwell;
  if (t < walk) return { u: 1 - ease(t / walk), dir: -1, moving: Math.sin(Math.PI * (t / walk)) };
  return { u: 0, dir: -1, moving: 0 };
}

/** Heading (rotation about y) that points a model's front (-z) along (dx, dz). */
const facing = (dx: number, dz: number) => Math.atan2(-dx, -dz);

interface Forklift {
  axis: 'x' | 'z';
  line: number;
  from: number;
  to: number;
  phase: number;
  /** Heading while lifting: facing the racking it works. */
  rackYaw: number;
}

/** Most of the player's own deliveries riding the conveyor at once. */
const MAX_MINE = 6;
/**
 * Background staff are deliberately unlike the workers on the board (the people the player
 * protects): three quarters their size, in dull grey coveralls and a grey cap, never the board's
 * blue and yellow hard hat.
 */
const STAFF_SCALE = 0.75;
const STAFF_GREY = 0x6f7774;
const STAFF_CAP = 0x9aa0a6;
const PARCEL = 0xc99257;
const MINE = 0x58f0a0;
const BEACON_OFF = new Color(0x3a2410);
const BEACON_ON = new Color(0xffa020);
const BULB = new Color(0xffe2a0);
const POOL = new Color(0xffffff);
const GOOD = new Color(0x7dffa8);
const ALARM = new Color(0xffa040);

interface Bot {
  axis: 'x' | 'z';
  /** Aisle line (the fixed coordinate). */
  line: number;
  from: number;
  to: number;
  /** Average speed along the aisle, board units per second (board robots: about 0.09). */
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
  /** The player's deliveries on the conveyor: where they were dropped on, and when. */
  private mine: { x: number; at: number }[] = [];
  private forklifts: Forklift[] = [];
  private forkBodies!: InstancedMesh;
  private forkCarriages!: InstancedMesh;
  private beacons: Vector3[] = [];
  private bulbMat!: MeshBasicMaterial;
  private poolMat!: MeshBasicMaterial;
  private now = 0;
  private alarmUntil = -1;
  private goodUntil = -1;
  private cheerUntil = -1;
  private waveUntil: number[] = [];
  private tmp = new Matrix4();
  private limb = new Matrix4();
  private staffScale = new Vector3(STAFF_SCALE, STAFF_SCALE, STAFF_SCALE);
  private out = new Matrix4();
  private conveyor = { from: 0, to: 0, z: 0, y: 0 };
  private m = new Matrix4();
  private p = new Vector3();
  private slowFor = 0;
  private avgDt = 1 / 72;
  private disabled = false;
  private readonly guard: boolean;
  private readonly fadeStart: number;
  /** Fade end with the real desk known (clipped to it) and without (kept close, so it can't overhang). */
  private readonly fadeEndDesk: number;
  private readonly fadeEndFree: number;
  private hasDesk = false;
  private workers: Bot[] = [];
  /** Torso, vest, head and hard hat in one instanced mesh; legs and arms instanced two per worker. */
  private workerBodies!: InstancedMesh;
  private workerLegs!: InstancedMesh;
  private workerArms!: InstancedMesh;
  private dust!: Points;
  private dustBase!: Float32Array;
  private on = new Color(0xb8ffff);
  private off = new Color(0x1d3a3c);

  /** `width`/`depth` are the board's size in board units. */
  constructor(width: number, depth: number, guardFrameRate: boolean) {
    this.guard = guardFrameRate;
    const halfW = width / 2;
    const halfD = depth / 2;
    this.fadeStart = Math.hypot(halfW, halfD) + 0.06;
    this.fadeEndDesk = this.fadeStart + 0.42;
    this.fadeEndFree = this.fadeStart + 0.16;
    const reach = this.fadeEndDesk + 0.02;

    // Floor: from the board's near edge back, out to where the fade ends.
    const tex = concreteTexture();
    tex.repeat.set((reach * 2) / (PITCH * 4), (reach + halfD) / (PITCH * 4));
    const floor = new Mesh(
      new PlaneGeometry(reach * 2, reach + halfD),
      withFade(new MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, halfD - (reach + halfD) / 2);
    this.root.add(floor);

    // Aisle markings on the floor: yellow lines along every aisle.
    const lineMat = withFade(new MeshBasicMaterial({ color: COLORS.zone }));
    const lines = new Group();

    // Racking.
    const racks = new Group();
    let seed = 1;
    const backRows = [0, 1, 2].map((i) => -(halfD + 0.14 + i * ROW_GAP));
    backRows.forEach((z, row) => {
      for (let x = -reach + PITCH / 2; x <= reach - PITCH / 2; x += PITCH) {
        if (Math.hypot(x, z) > reach) continue;
        const r = makeRack(seed++, true);
        r.position.set(x, FLOOR_Y, z);
        racks.add(r);
        // High-bay racking behind the first row: a second rack stacked on top, so the back of the
        // warehouse rises well above the board and the space reads as a tall hall.
        if (row > 0) {
          const top = makeRack(seed++, true);
          top.position.set(x, FLOOR_Y + RACK_TALL, z);
          racks.add(top);
        }
      }
    });
    const sideRows = [0, 1, 2].map((j) => halfW + 0.08 + j * ROW_GAP);
    for (const side of [-1, 1])
      for (const x of sideRows) {
        // Racks start behind the front corners, where the permit dispenser and the
        // stop-all and pause buttons sit.
        for (let z = halfD - FRONT_CLEAR - PITCH / 2; z >= -(halfD + 0.05); z -= PITCH) {
          if (Math.hypot(x, z) > reach) continue;
          const r = makeRack(seed++, seed % 3 !== 0);
          r.position.set(side * x, FLOOR_Y, z);
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
        this.bots.push({ axis: 'x', line: z, from: -reach * 0.8, to: reach * 0.8, speed: 0.06 + 0.012 * n, phase: n * 2.4 + k++, carrying: n === 0 });
    // The inner side aisles are what a real desk usually shows (desks are wider than deep): a forklift
    // works each of them; robots shuttle the outer ones.
    sideAisles.forEach((x, a) => {
      if (a === 0) return; // the forklifts' aisles
      for (const side of [-1, 1])
        this.bots.push({ axis: 'z', line: side * x, from: halfD - FRONT_CLEAR, to: -(halfD + 0.05), speed: 0.08, phase: k++ * 1.7, carrying: k % 2 === 0 });
    });
    // A lane just behind the dock, the busiest one.
    const dockLane = -(halfD + 0.07);
    this.bots.push({ axis: 'x', line: dockLane, from: -reach * 0.7, to: reach * 0.7, speed: 0.09, phase: 0.6, carrying: true });

    for (const z of backAisles) {
      const l = new Mesh(new PlaneGeometry(reach * 1.6, 0.0016), lineMat);
      l.rotation.x = -Math.PI / 2;
      l.position.set(0, FLOOR_Y + 0.0004, z);
      lines.add(l);
    }
    for (const side of [-1, 1])
      for (const x of sideAisles) {
        const len = halfD * 2 + 0.05 - FRONT_CLEAR;
        const l = new Mesh(new PlaneGeometry(0.0016, len), lineMat);
        l.rotation.x = -Math.PI / 2;
        l.position.set(side * x, FLOOR_Y + 0.0004, halfD - FRONT_CLEAR - len / 2);
        lines.add(l);
      }
    this.root.add(mergeStatic(lines));

    const n = this.bots.length;
    // A small carrier like the crew's: wheeled base, rounded body (tinted per robot), dark visor at
    // the front (-z), head lamps. Coloured per vertex so it stays one instanced draw call.
    const bodyMat = withFade(new MeshStandardMaterial({ roughness: 0.45, metalness: 0.15, vertexColors: true }));
    const botGeo = mergeGeometries([
      painted(placed(new BoxGeometry(TILE * 0.66, 0.006, TILE * 0.7), 0, 0.0035, 0), 0x2a2e35),
      painted(placed(new CylinderGeometry(0.0042, 0.0042, TILE * 0.78, 10), 0, 0.0042, -TILE * 0.22, Math.PI / 2), 0x1d2127),
      painted(placed(new CylinderGeometry(0.0042, 0.0042, TILE * 0.78, 10), 0, 0.0042, TILE * 0.22, Math.PI / 2), 0x1d2127),
      painted(placed(new RoundedBoxGeometry(TILE * 0.74, 0.012, TILE * 0.76, 2, 0.003), 0, 0.0125, 0), 0xffffff),
      painted(placed(new BoxGeometry(TILE * 0.5, 0.004, 0.002), 0, 0.0135, -TILE * 0.385), 0x15181c),
      painted(placed(new BoxGeometry(TILE * 0.66, 0.0016, TILE * 0.5), 0, 0.0193, 0.002), 0x5b6470),
    ])!;
    this.bodies = new InstancedMesh(botGeo, bodyMat, n);
    // Status lights on the robots, then amber beacons on the racking that flash on a near miss.
    this.beacons = [
      new Vector3(-halfW * 0.7, RACK_TALL + 0.006, -(halfD + 0.14)),
      new Vector3(halfW * 0.7, RACK_TALL + 0.006, -(halfD + 0.14)),
      new Vector3(-halfW * 0.25, RACK_TALL * 2 + 0.006, -(halfD + 0.14 + ROW_GAP)),
      new Vector3(halfW * 0.25, RACK_TALL * 2 + 0.006, -(halfD + 0.14 + ROW_GAP)),
    ];
    this.lights = new InstancedMesh(new BoxGeometry(0.009, 0.007, 0.009), withFade(new MeshBasicMaterial()), n + this.beacons.length);
    this.loads = new InstancedMesh(new BoxGeometry(TILE * 0.6, 0.018, TILE * 0.6), withFade(new MeshStandardMaterial({ color: COLORS.crate, roughness: 0.8 })), n);
    this.bots.forEach((b, i) => {
      this.bodies.setColorAt(i, new Color(COLORS.robot[i % COLORS.robot.length]!));
      this.lights.setColorAt(i, this.on);
    });
    this.beacons.forEach((p, j) => {
      this.lights.setColorAt(n + j, BEACON_OFF);
      this.lights.setMatrixAt(n + j, this.m.makeScale(1.3, 1.6, 1.3).setPosition(p));
    });

    // Conveyor across the back, raised above the dock wall, carrying parcels away.
    this.conveyor = { from: -reach * 0.85, to: reach * 0.85, z: -(halfD + 0.035), y: RACK_TALL * 0.82 };
    const beltLen = this.conveyor.to - this.conveyor.from;
    const belt = new Group();
    // One material per colour, so the merged belt is three draw calls, not one per leg.
    const beltMat = new MeshStandardMaterial({ color: 0x23272d, roughness: 0.6 });
    const railMat = new MeshStandardMaterial({ color: 0xf07b1a, roughness: 0.5, metalness: 0.3 });
    const legMat = new MeshStandardMaterial({ color: 0x5b6470, roughness: 0.5, metalness: 0.4 });
    const beltTop = new Mesh(new BoxGeometry(beltLen, 0.004, 0.026), beltMat);
    beltTop.position.set(0, this.conveyor.y, this.conveyor.z);
    belt.add(beltTop);
    for (const z of [-1, 1]) {
      const rail = new Mesh(new BoxGeometry(beltLen, 0.006, 0.003), railMat);
      rail.position.set(0, this.conveyor.y + 0.003, this.conveyor.z + z * 0.0145);
      belt.add(rail);
    }
    for (let x = this.conveyor.from; x <= this.conveyor.to; x += 0.12) {
      const leg = new Mesh(new BoxGeometry(0.004, this.conveyor.y, 0.004), legMat);
      leg.position.set(x, this.conveyor.y / 2 + FLOOR_Y, this.conveyor.z);
      belt.add(leg);
    }
    const beltMerged = mergeStatic(belt);
    beltMerged.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.material = withFade((mesh.material as Material).clone());
    });
    this.root.add(beltMerged);
    // Parcels on the belt; the last few slots are the player's own deliveries, in permit green.
    this.parcels = new InstancedMesh(new BoxGeometry(0.016, 0.012, 0.016), withFade(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })), this.parcelCount + MAX_MINE);
    for (let i = 0; i < this.parcelCount + MAX_MINE; i++) this.parcels.setColorAt(i, new Color(i < this.parcelCount ? PARCEL : MINE));
    this.buildForklifts(halfD, sideAisles);

    this.buildRoof(reach, halfW, halfD, backAisles, sideAisles);
    this.buildWorkers(reach, halfD, backAisles, sideAisles);
    this.buildDust(reach, halfW, halfD);

    for (const im of [this.bodies, this.lights, this.loads, this.parcels]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
    this.root.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /**
   * Roof structure over the back and sides (never over the play area): steel columns and trusses,
   * lamps hanging over the aisles, and warm pools of light on the floor under them.
   * Four draw calls in all: steel, lamp shades, bulbs, light pools.
   */
  private buildRoof(reach: number, halfW: number, halfD: number, backAisles: number[], sideAisles: number[]) {
    const H = RACK_TALL * 2.45; // truss height, above the high-bay racking
    const steelMat = withFade(new MeshStandardMaterial({ color: 0x4a5059, roughness: 0.55, metalness: 0.6 }));
    const shadeMat = withFade(new MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.5, side: DoubleSide }));
    const bulbMat = withFade(new MeshBasicMaterial({ color: BULB.clone() }));
    this.bulbMat = bulbMat;
    const steel = new Group();
    const beam = (len: number, axis: 'x' | 'z', x: number, z: number, y = H) => {
      const m = new Mesh(new BoxGeometry(axis === 'x' ? len : 0.004, 0.005, axis === 'z' ? len : 0.004), steelMat);
      m.position.set(x, y, z);
      steel.add(m);
    };
    const backEdge = -(halfD + 0.06);
    const sideEdge = halfW + 0.05;
    // Trusses across the back, each a top and bottom chord with a web of diagonals.
    for (let z = backEdge - 0.05; z > -reach; z -= 0.12) {
      beam(reach * 2, 'x', 0, z);
      beam(reach * 2, 'x', 0, z, H - 0.018);
      for (let x = -reach + 0.03; x < reach; x += 0.06) {
        const d = new Mesh(new BoxGeometry(0.0025, 0.026, 0.0025), steelMat);
        d.position.set(x, H - 0.009, z);
        d.rotation.z = (Math.round(x / 0.06) % 2 ? 1 : -1) * 0.75;
        steel.add(d);
      }
    }
    // Purlins along each side, joining the trusses, out over the side racking.
    // They stop level with the middle of the board: nothing overhead reaches toward the player.
    for (const side of [-1, 1]) for (const x of [sideEdge + 0.04, sideEdge + 0.16]) if (x < reach) beam(reach, 'z', side * x, -reach / 2);
    // Columns at the corners of the roof, down to the floor.
    for (const side of [-1, 1])
      for (const z of [backEdge - 0.05, -reach + 0.04]) {
        const c = new Mesh(new BoxGeometry(0.006, H, 0.006), steelMat);
        c.position.set(side * (sideEdge + 0.16), H / 2, z);
        steel.add(c);
      }
    this.root.add(mergeStatic(steel));

    // Lamps over the aisles: a cable, a shade and a glowing bulb; a pool of light on the floor.
    const shades = new Group();
    const bulbs = new Group();
    const pools = new Group();
    const poolTex = canvasTex(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      r.addColorStop(0, 'rgba(255,214,150,0.55)');
      r.addColorStop(0.6, 'rgba(255,200,130,0.18)');
      r.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    const poolMat = withFade(new MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.poolMat = poolMat;
    const lampAt: [number, number][] = [];
    for (const z of backAisles) for (let x = -reach * 0.7; x <= reach * 0.7; x += 0.16) lampAt.push([x, z]);
    for (const side of [-1, 1]) for (const x of sideAisles) for (let z = -0.02; z > -reach * 0.75; z -= 0.16) lampAt.push([side * x, z]);
    const hang = H - 0.045;
    for (const [x, z] of lampAt) {
      if (Math.hypot(x, z) > reach) continue;
      const cable = new Mesh(new BoxGeometry(0.0012, H - hang, 0.0012), shadeMat);
      cable.position.set(x, (H + hang) / 2, z);
      const shade = new Mesh(new CylinderGeometry(0.004, 0.011, 0.008, 12, 1, true), shadeMat);
      shade.position.set(x, hang, z);
      shades.add(cable, shade);
      const bulb = new Mesh(new SphereGeometry(0.0042, 10, 6), bulbMat);
      bulb.position.set(x, hang - 0.003, z);
      bulbs.add(bulb);
      const pool = new Mesh(new PlaneGeometry(0.11, 0.11), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, FLOOR_Y + 0.0008, z);
      pools.add(pool);
    }
    for (const g of [shades, bulbs, pools]) this.root.add(mergeStatic(g));
  }

  /** Staff walking the aisles: they give the warehouse its scale (see STAFF_SCALE). Three draw calls. */
  private buildWorkers(reach: number, halfD: number, backAisles: number[], sideAisles: number[]) {
    const back = backAisles[backAisles.length - 1] ?? -(halfD + 0.2);
    // Where a real desk shows them: the strip between the dock and the first back row, and the side
    // aisles from level with the board's front towards its back. Two more further back.
    const strip = -(halfD + 0.108);
    this.workers = [
      { axis: 'x', line: strip, from: -reach * 0.5, to: -reach * 0.08, speed: 0.016, phase: 0.4, carrying: false },
      { axis: 'x', line: strip, from: reach * 0.12, to: reach * 0.5, speed: 0.014, phase: 2.1, carrying: false },
      ...[-1, 1].map((side, i): Bot => {
        const x = side * (sideAisles[sideAisles.length - 1] ?? 0.4);
        return { axis: 'z', line: x, from: halfD - FRONT_CLEAR - 0.02, to: -(halfD - 0.02), speed: 0.015, phase: 1 + i * 2.7, carrying: false };
      }),
      { axis: 'x', line: backAisles[0] ?? back, from: -reach * 0.4, to: reach * 0.3, speed: 0.015, phase: 1.2, carrying: false },
    ];
    const n = this.workers.length;
    this.waveUntil = this.workers.map(() => -1);
    // Upper body from the hips up (origin on the floor, facing -z), modelled at board-worker size and
    // drawn at STAFF_SCALE: grey coveralls with a pale tool belt, head, grey cap with a peak.
    const upper = mergeGeometries([
      painted(placed(new CapsuleGeometry(0.0052, 0.0075, 4, 10), 0, 0.0165, 0), STAFF_GREY),
      painted(placed(new CylinderGeometry(0.00545, 0.00545, 0.0012, 10, 1, true), 0, 0.0128, 0), 0x8a8f8c),
      painted(placed(new SphereGeometry(0.0047, 10, 8), 0, 0.0283, 0), 0xb08f78),
      painted(placed(new SphereGeometry(0.005, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.0295, 0), STAFF_CAP),
      painted(placed(new BoxGeometry(0.006, 0.0006, 0.004), 0, 0.0296, -0.0052), STAFF_CAP),
    ])!;
    const limbMat = withFade(new MeshStandardMaterial({ roughness: 0.65, vertexColors: true }));
    this.workerBodies = new InstancedMesh(upper, withFade(new MeshStandardMaterial({ roughness: 0.6, vertexColors: true })), n);
    // Limbs hang from their pivot (origin at the hip or shoulder, pointing down).
    const leg = mergeGeometries([
      painted(placed(new CapsuleGeometry(0.0022, 0.0068, 3, 8), 0, -0.0056, 0), STAFF_GREY),
      painted(placed(new BoxGeometry(0.0034, 0.0018, 0.0052), 0, -0.0108, -0.0008), 0x1d2127),
    ])!;
    const arm = mergeGeometries([
      painted(placed(new CapsuleGeometry(0.0016, 0.0062, 3, 8), 0, -0.0045, 0), STAFF_GREY),
      painted(placed(new SphereGeometry(0.0017, 8, 6), 0, -0.0088, 0), 0xb08f78),
    ])!;
    this.workerLegs = new InstancedMesh(leg, limbMat, n * 2);
    this.workerArms = new InstancedMesh(arm, limbMat, n * 2);
    for (const im of [this.workerBodies, this.workerLegs, this.workerArms]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
  }

  /**
   * Forklifts working the back aisles: drive to a bay, turn to face the high racking, raise a
   * pallet up the mast, lower it, turn back and drive on. Chassis and carriage are one instanced
   * mesh each (two draw calls for all of them).
   */
  private buildForklifts(halfD: number, sideAisles: number[]) {
    const aisle = sideAisles[0];
    if (aisle === undefined) return;
    // Back half of the inner side aisles, lifting into the outer racking.
    this.forklifts = [-1, 1].map((side, i) => ({
      axis: 'z' as const,
      line: side * aisle,
      from: -0.03,
      to: -(halfD - 0.02),
      phase: i * 0.5,
      rackYaw: facing(side, 0),
    }));
    const Y = 0xf2b705;
    const D = 0x23272d;
    const G = 0x5b6470;
    // Origin on the floor under the centre; forks at the front (-z).
    const chassis: BufferGeometry[] = [
      painted(placed(new RoundedBoxGeometry(0.018, 0.009, 0.024, 2, 0.002), 0, 0.0085, 0.002), Y),
      painted(placed(new BoxGeometry(0.0185, 0.011, 0.006), 0, 0.009, 0.0155), 0x3d434c),
      painted(placed(new BoxGeometry(0.009, 0.0045, 0.006), 0, 0.0148, 0.006), D), // seat
      painted(placed(new SphereGeometry(0.0035, 8, 6), 0, 0.021, 0.0055), 0xd9a988), // driver
      painted(placed(new SphereGeometry(0.0041, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.0225, 0.0055), STAFF_CAP),
      painted(placed(new BoxGeometry(0.019, 0.0012, 0.017), 0, 0.0305, 0.004), D), // overhead guard
      painted(placed(new BoxGeometry(0.0016, 0.022, 0.0016), 0, 0.0305, -0.0062), G), // mast centre stay
    ];
    for (const sx of [-1, 1]) {
      for (const z of [-0.0045, 0.0122]) chassis.push(painted(placed(new BoxGeometry(0.0012, 0.017, 0.0012), sx * 0.0088, 0.0215, z), D));
      for (const z of [-0.0085, 0.0105]) chassis.push(painted(placed(new CylinderGeometry(0.0046, 0.0046, 0.0032, 12), sx * 0.0094, 0.0046, z, Math.PI / 2), 0x1a1d22));
      chassis.push(painted(placed(new BoxGeometry(0.0018, 0.074, 0.0022), sx * 0.0058, 0.037, -0.0118), G)); // mast rails
    }
    chassis.push(painted(placed(new BoxGeometry(0.0135, 0.0016, 0.0022), 0, 0.0735, -0.0118), G));
    chassis.push(painted(placed(new BoxGeometry(0.004, 0.0018, 0.0012), 0, 0.0315, 0.012), 0xffa020)); // roof beacon
    const carriage: BufferGeometry[] = [
      painted(placed(new BoxGeometry(0.0145, 0.009, 0.0012), 0, 0.006, -0.0138), D),
      painted(placed(new BoxGeometry(0.016, 0.0028, 0.016), 0, 0.0033, -0.0228), 0xa87a4a), // pallet
      painted(placed(new BoxGeometry(0.0062, 0.0098, 0.0062), -0.0038, 0.0096, -0.0262), PARCEL),
      painted(placed(new BoxGeometry(0.0062, 0.0098, 0.0062), 0.0038, 0.0096, -0.0262), PARCEL),
      painted(placed(new BoxGeometry(0.0062, 0.0098, 0.0062), -0.0038, 0.0096, -0.0194), 0xb98450),
      painted(placed(new BoxGeometry(0.0062, 0.0098, 0.0062), 0.0038, 0.0096, -0.0194), PARCEL),
    ];
    for (const sx of [-1, 1]) carriage.push(painted(placed(new BoxGeometry(0.0022, 0.0009, 0.018), sx * 0.0042, 0.0013, -0.0225), D));
    const fmat = withFade(new MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, vertexColors: true }));
    this.forkBodies = new InstancedMesh(mergeGeometries(chassis)!, fmat, this.forklifts.length);
    this.forkCarriages = new InstancedMesh(mergeGeometries(carriage)!, fmat, this.forklifts.length);
    for (const im of [this.forkBodies, this.forkCarriages]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
  }

  /** Where a forklift is in its loop: position, heading, and how high its forks are (0..1). */
  private forkliftPose(f: Forklift, time: number) {
    const span = Math.abs(f.to - f.from);
    const drive = span / 0.04;
    const turn = 0.9;
    const lift = 2.2;
    const hold = 1.4;
    // drive, turn, lift, hold, lower, turn back; then the same back the other way.
    const half = drive + turn + lift + hold + lift + turn;
    let t = (time + f.phase * half * 2) % (half * 2);
    const out = t < half;
    if (!out) t -= half;
    const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
    const start = out ? f.from : f.to;
    const end = out ? f.to : f.from;
    const along = f.axis === 'x' ? facing(end - start, 0) : facing(0, end - start);
    // Turn the short way round to face the racking.
    const toRack = along + Math.atan2(Math.sin(f.rackYaw - along), Math.cos(f.rackYaw - along));
    let x = end;
    let yaw = toRack;
    let h = 0;
    if (t < drive) {
      x = start + (end - start) * ease(t / drive);
      yaw = along;
    } else if ((t -= drive) < turn) yaw = along + (toRack - along) * ease(t / turn);
    else if ((t -= turn) < lift) h = ease(t / lift);
    else if ((t -= lift) < hold) h = 1;
    else if ((t -= hold) < lift) h = 1 - ease(t / lift);
    else yaw = toRack + (along - toRack) * ease((t - lift) / turn);
    return f.axis === 'x' ? { x, z: f.line, yaw, h } : { x: f.line, z: x, yaw, h };
  }

  /**
   * The warehouse answers what happens on the board: a wave when a delivery lands, amber beacons
   * and lamps on a near miss (workers stop and look), green lamps and cheering for a won shift.
   */
  react(kind: 'deliver' | 'alarm' | 'win') {
    const t = this.now;
    if (kind === 'deliver') {
      // The two workers nearest the board wave.
      const order = this.workers.map((w, i) => ({ i, d: Math.abs(w.line) })).sort((a, b) => a.d - b.d);
      for (const { i } of order.slice(0, 2)) this.waveUntil[i] = t + 1.8;
    } else if (kind === 'alarm') this.alarmUntil = t + 3;
    else {
      this.goodUntil = t + 3.5;
      this.cheerUntil = t + 3.5;
    }
  }

  /** A delivery made on the board drops onto the conveyor (board-local x) and rides away. */
  addParcel(x: number) {
    const c = this.conveyor;
    if (this.mine.length >= MAX_MINE) this.mine.shift();
    this.mine.push({ x: Math.min(c.to - 0.05, Math.max(c.from + 0.02, x)), at: this.now });
  }

  /** Dust drifting in the lamp light over the back and sides. One draw call. */
  private buildDust(reach: number, halfW: number, halfD: number) {
    const count = 110;
    this.dustBase = new Float32Array(count * 3);
    let r = 7;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      do {
        x = (rand() * 2 - 1) * reach;
        z = -rand() * reach;
      } while (Math.abs(x) < halfW + 0.03 && z > -(halfD + 0.04));
      this.dustBase.set([x, 0.02 + rand() * RACK_TALL * 2.2, z], i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.dustBase.slice(), 3));
    this.dust = new Points(
      geo,
      withFade(new PointsMaterial({ color: 0xfff1d0, size: 0.0035, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending })),
    );
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
  }

  /**
   * The real desk's outline (world space) from plane detection, or null when unknown. With it the
   * warehouse fills the desk and stops at its edge; without it, it stays close around the board.
   */
  setDesk(outline: { x: number; z: number }[] | null) {
    const pts = outline && outline.length >= 3 ? outline : null;
    if (!pts) {
      FADE.deskN.value = 0;
      this.hasDesk = false;
      return;
    }
    // Keep at most DESK_MAX corners, evenly spread (a desk outline is usually 4 to 8).
    const step = Math.max(1, Math.ceil(pts.length / DESK_MAX));
    const kept = pts.filter((_, i) => i % step === 0).slice(0, DESK_MAX);
    kept.forEach((p, i) => FADE.desk.value[i]!.set(p.x, p.z));
    FADE.deskN.value = kept.length;
    this.hasDesk = true;
  }

  /** World position of the conveyor's middle, for its sound. */
  conveyorWorld(out: Vector3) {
    return this.root.localToWorld(out.set((this.conveyor.from + this.conveyor.to) / 2, this.conveyor.y, this.conveyor.z));
  }

  /** World position of one background robot, for a distant reversing beep. */
  botWorld(i: number, out: Vector3) {
    const b = this.bots[i % Math.max(1, this.bots.length)];
    if (!b) return null;
    this.bodies.getMatrixAt(i % this.bots.length, this.m);
    return this.root.localToWorld(out.setFromMatrixPosition(this.m));
  }

  get visible() {
    return this.root.visible && !this.disabled;
  }

  /** Animate, keep the fade centred on the board, and hide on a slow device. */
  update(dt: number, time: number, board: Object3D) {
    this.now = time;
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
    FADE.range.value.set(this.fadeStart * s, (this.hasDesk ? this.fadeEndDesk : this.fadeEndFree) * s);

    this.bots.forEach((b, i) => {
      // Ping-pong along the aisle, easing at each end like a robot stopping to pick.
      const span = Math.abs(b.to - b.from);
      // A cosine ping-pong whose average speed is b.speed: angle advances at pi * speed / span.
      const angle = (time * Math.PI * b.speed) / span + b.phase;
      const u = 0.5 - 0.5 * Math.cos(angle);
      const along = b.from + (b.to - b.from) * u;
      const x = b.axis === 'x' ? along : b.line;
      const z = b.axis === 'x' ? b.line : along;
      const dir = (Math.sin(angle) >= 0 ? 1 : -1) * Math.sign(b.to - b.from);
      this.m.makeRotationY(b.axis === 'x' ? facing(dir, 0) : facing(0, dir)).setPosition(x, FLOOR_Y, z);
      this.bodies.setMatrixAt(i, this.m);
      this.m.setPosition(x, FLOOR_Y + 0.0215, z);
      this.lights.setMatrixAt(i, this.m);
      this.lights.setColorAt(i, Math.sin(time * 5 + i) > 0.2 ? this.on : this.off);
      this.m.setPosition(x, b.carrying ? FLOOR_Y + 0.0295 : -1000, z);
      this.loads.setMatrixAt(i, this.m);
    });
    const len = this.conveyor.to - this.conveyor.from;
    for (let i = 0; i < this.parcelCount; i++) {
      const x = this.conveyor.from + ((time * 0.03 + (i / this.parcelCount) * len) % len);
      this.m.makeTranslation(x, this.conveyor.y + 0.008, this.conveyor.z);
      this.parcels.setMatrixAt(i, this.m);
    }
    // The player's deliveries drop onto the belt with a bounce, then ride off its end.
    this.mine = this.mine.filter((p) => p.x + (time - p.at) * 0.03 < this.conveyor.to);
    for (let j = 0; j < MAX_MINE; j++) {
      const p = this.mine[j];
      if (!p) {
        this.parcels.setMatrixAt(this.parcelCount + j, this.m.makeTranslation(0, -1000, 0));
        continue;
      }
      const age = time - p.at;
      const fall = age < 0.45 ? 0.05 * (1 - age / 0.45) ** 2 : 0.004 * Math.abs(Math.sin(Math.min(1, (age - 0.45) / 0.3) * Math.PI)) * Math.max(0, 1 - (age - 0.45) / 0.3);
      const s = age < 0.45 ? 1.2 : 1.2 - 0.2 * Math.min(1, (age - 0.45) / 0.4);
      this.m.makeScale(s, s, s).setPosition(p.x + Math.max(0, age - 0.45) * 0.03, this.conveyor.y + 0.008 + fall, this.conveyor.z);
      this.parcels.setMatrixAt(this.parcelCount + j, this.m);
    }
    // Forklifts.
    this.forklifts.forEach((f, i) => {
      const { x, z, yaw, h } = this.forkliftPose(f, time);
      this.m.makeRotationY(yaw).setPosition(x, FLOOR_Y, z);
      this.forkBodies.setMatrixAt(i, this.m);
      this.m.setPosition(x, FLOOR_Y + h * (RACK_TALL - 0.004), z);
      this.forkCarriages.setMatrixAt(i, this.m);
    });
    // Reactions: beacons, lamp colour.
    const alarm = time < this.alarmUntil;
    const nb = this.bots.length;
    this.beacons.forEach((_, j) => this.lights.setColorAt(nb + j, alarm && Math.sin(time * 14 + j * 1.6) > 0 ? BEACON_ON : BEACON_OFF));
    const goodK = time < this.goodUntil ? Math.min(1, (this.goodUntil - time) / 0.8) * (0.6 + 0.4 * Math.sin(time * 6)) : 0;
    const alarmK = alarm ? 0.55 + 0.45 * Math.sin(time * 14) : 0;
    this.bulbMat.color.copy(BULB).lerp(GOOD, goodK).lerp(ALARM, alarmK);
    this.poolMat.color.copy(POOL).lerp(GOOD, goodK * 0.8).lerp(ALARM, alarmK * 0.8);
    // Workers walk their aisles, stop at each end to check the racking, wave at deliveries, stop and
    // look at the board on a near miss, and cheer a won shift.
    const cheer = time < this.cheerUntil;
    this.workers.forEach((w, i) => {
      const p = patrol(time, Math.abs(w.to - w.from), w.speed, w.phase, 2.5);
      const along = w.from + (w.to - w.from) * p.u;
      const x = w.axis === 'x' ? along : w.line;
      const z = w.axis === 'x' ? w.line : along;
      const sgn = p.dir * Math.sign(w.to - w.from);
      let yaw = w.axis === 'x' ? facing(sgn, 0) : facing(0, sgn);
      let stride = p.moving;
      let hop = 0;
      if (alarm || cheer) {
        // Stop and turn to the board.
        yaw = facing(-x, -z);
        stride = 0;
        if (cheer) hop = 0.004 * Math.abs(Math.sin(time * 9 + i));
      }
      const swing = Math.sin(time * 9 + i * 1.3) * 0.65 * Math.min(1, stride * 1.5);
      const bob = 0.0007 * Math.abs(Math.sin(time * 9 + i * 1.3)) * stride + hop;
      this.m.makeRotationY(yaw).scale(this.staffScale).setPosition(x, FLOOR_Y + bob * STAFF_SCALE, z);
      this.workerBodies.setMatrixAt(i, this.m);
      // Limbs: worker transform, then the joint offset, then the swing.
      [-1, 1].forEach((side, k) => {
        this.tmp.makeTranslation(side * 0.0024, 0.0114, 0).multiply(this.limb.makeRotationX(side * swing));
        this.workerLegs.setMatrixAt(i * 2 + k, this.out.multiplyMatrices(this.m, this.tmp));
        let rot = this.limb.makeRotationX(-side * swing * 0.8);
        const waving = time < (this.waveUntil[i] ?? -1);
        if (cheer) rot = this.limb.makeRotationZ(side * (2.7 + 0.25 * Math.sin(time * 12 + i)));
        else if (waving && side === 1) rot = this.limb.makeRotationZ(2.6 + 0.4 * Math.sin(time * 16));
        this.tmp.makeTranslation(side * 0.0066, 0.0215, 0).multiply(rot);
        this.workerArms.setMatrixAt(i * 2 + k, this.out.multiplyMatrices(this.m, this.tmp));
      });
    });
    // Dust drifts slowly and wraps.
    const pos = this.dust.geometry.attributes.position as BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] = this.dustBase[i]! + Math.sin(time * 0.21 + i) * 0.012;
      a[i + 1] = this.dustBase[i + 1]! + Math.sin(time * 0.13 + i * 1.7) * 0.01;
      a[i + 2] = this.dustBase[i + 2]! + Math.cos(time * 0.17 + i * 0.6) * 0.012;
    }
    pos.needsUpdate = true;
    for (const im of [this.bodies, this.lights, this.loads, this.parcels, this.workerBodies, this.workerLegs, this.workerArms, this.forkBodies, this.forkCarriages]) {
      if (im) im.instanceMatrix.needsUpdate = true;
    }
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
