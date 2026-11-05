import {
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  type Material,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CrewName } from '../core/crew';
import { COLORS, TILE } from './models';

/**
 * The visual style: small, glossy toy robots on a clean warehouse floor.
 * Everything is procedural (no downloaded assets), so it loads instantly.
 */

const mat = (color: number, rough = 0.45, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
  new MeshStandardMaterial({ color, roughness: rough, metalness: 0.08, ...extra });

/** Shared materials for static scenery, so merged meshes can batch into a handful of draw calls. */
const shared = new Map<string, MeshStandardMaterial>();
const sharedMat = (color: number, rough = 0.5, metalness = 0.08) => {
  const k = `${color}|${rough}|${metalness}`;
  let m = shared.get(k);
  if (!m) shared.set(k, (m = new MeshStandardMaterial({ color, roughness: rough, metalness })));
  return m;
};

const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

// ------------------------------------------------------------------ shadows

let blobTex: Texture | undefined;
const blobMats = new Map<string, MeshBasicMaterial>();
/** Soft round contact shadow: grounds objects on the board (works in passthrough too). */
export function makeBlob(width: number, depth = width, opacity = 0.38): Mesh {
  blobTex ??= canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(0,0,0,1)');
    r.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
  const key = opacity.toFixed(2);
  let bm = blobMats.get(key);
  if (!bm) blobMats.set(key, (bm = new MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false })));
  const m = new Mesh(new PlaneGeometry(width, depth), bm);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0009;
  m.renderOrder = 1;
  return m;
}

// ------------------------------------------------------------------ robots

export interface CrewModel {
  root: Group;
  body: Mesh;
  light: Mesh;
  lightMat: MeshStandardMaterial;
  cargo: Mesh;
  halo: Mesh;
  haloMat: MeshBasicMaterial;
  wheels: Mesh[];
  antenna: Group;
  eyes: Mesh[];
}

interface Shape {
  w: number;
  h: number;
  d: number;
  radius: number;
  wheelR: number;
  treads?: boolean;
  fin?: boolean;
  dome?: boolean;
  spoiler?: boolean;
  mast: number;
}

/** Each crew member has a distinct silhouette, readable at a glance from across the board. */
const SHAPES: Record<CrewName, Shape> = {
  Bolt: { w: 0.03, h: 0.011, d: 0.034, radius: 0.004, wheelR: 0.0048, fin: true, mast: 0.006 }, // low and sleek
  Pip: { w: 0.027, h: 0.014, d: 0.027, radius: 0.0065, wheelR: 0.0045, dome: true, mast: 0.008 }, // round and friendly
  Rook: { w: 0.033, h: 0.017, d: 0.032, radius: 0.003, wheelR: 0.005, treads: true, mast: 0.005 }, // chunky, on treads
  Juno: { w: 0.024, h: 0.011, d: 0.034, radius: 0.005, wheelR: 0.0055, spoiler: true, mast: 0.012 }, // slim and fast
};

export function makeCrewRobot(name: CrewName, color: number): CrewModel {
  const s = SHAPES[name];
  const root = new Group();
  const paint = mat(color, 0.32, { metalness: 0.15 });
  const dark = mat(0x1d2127, 0.6);
  const lift = s.wheelR * 1.25;

  const body = new Mesh(new RoundedBoxGeometry(s.w, s.h, s.d, 3, s.radius), paint);
  body.position.y = lift + s.h / 2;
  root.add(body);

  // Lighter belly band for depth.
  const band = new Mesh(new RoundedBoxGeometry(s.w * 1.02, s.h * 0.28, s.d * 1.02, 2, s.radius * 0.6), mat(0xf4f1ea, 0.5));
  band.position.y = lift + s.h * 0.18;
  root.add(band);

  if (s.dome) {
    const dome = new Mesh(new SphereGeometry(s.w * 0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint);
    dome.position.y = lift + s.h;
    root.add(dome);
  }
  if (s.fin) {
    const fin = new Mesh(new BoxGeometry(0.002, 0.006, 0.012), paint);
    fin.position.set(0, lift + s.h + 0.003, s.d * 0.25);
    root.add(fin);
    const stripe = new Mesh(new BoxGeometry(0.006, 0.0006, s.d * 0.98), mat(0xffffff, 0.4));
    stripe.position.set(0, lift + s.h + 0.0003, 0);
    root.add(stripe);
  }
  if (s.spoiler) {
    const wing = new Mesh(new BoxGeometry(s.w * 1.1, 0.0015, 0.006), dark);
    wing.position.set(0, lift + s.h + 0.005, s.d * 0.42);
    const strutL = new Mesh(new BoxGeometry(0.0012, 0.005, 0.0012), dark);
    const strutR = strutL.clone();
    strutL.position.set(-s.w * 0.3, lift + s.h + 0.0025, s.d * 0.42);
    strutR.position.set(s.w * 0.3, lift + s.h + 0.0025, s.d * 0.42);
    root.add(wing, strutL, strutR);
  }

  // Face: dark visor with two glowing eyes, on the front (-z).
  const visor = new Mesh(new RoundedBoxGeometry(s.w * 0.78, s.h * 0.5, 0.003, 2, 0.0012), mat(0x111418, 0.15, { metalness: 0.4 }));
  visor.position.set(0, lift + s.h * 0.62, -s.d / 2 - 0.0005);
  root.add(visor);
  const eyeMat = new MeshBasicMaterial({ color: 0x9ff7ff });
  const eyes = [-1, 1].map((side) => {
    const e = new Mesh(new CapsuleGeometry(0.0013, 0.0016, 4, 8), eyeMat);
    e.position.set(side * s.w * 0.17, lift + s.h * 0.62, -s.d / 2 - 0.0022);
    root.add(e);
    return e;
  });

  // Wheels or treads.
  const wheels: Mesh[] = [];
  if (s.treads) {
    for (const side of [-1, 1]) {
      const tread = new Mesh(new RoundedBoxGeometry(0.006, s.wheelR * 2.2, s.d * 0.95, 2, 0.0025), dark);
      tread.position.set(side * (s.w / 2 + 0.002), s.wheelR * 1.1, 0);
      root.add(tread);
    }
  } else {
    const wheelGeo = new CylinderGeometry(s.wheelR, s.wheelR, 0.004, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubMat = mat(0xd9dde3, 0.3, { metalness: 0.5 });
    const hubGeo = new CylinderGeometry(s.wheelR * 0.45, s.wheelR * 0.45, 0.0042, 10);
    hubGeo.rotateZ(Math.PI / 2);
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const w = new Mesh(wheelGeo, dark);
      w.position.set(x * (s.w / 2 + 0.0015), s.wheelR, z * s.d * 0.3);
      w.add(new Mesh(hubGeo, hubMat));
      root.add(w);
      wheels.push(w);
    }
  }

  // Antenna with the status light; it wobbles on stops and starts.
  const antenna = new Group();
  antenna.position.set(s.w * 0.25, lift + s.h + (s.dome ? s.w * 0.2 : 0), s.d * 0.2);
  const mast = new Mesh(new CylinderGeometry(0.0006, 0.0006, s.mast, 6), dark);
  mast.position.y = s.mast / 2;
  const lightMat = new MeshStandardMaterial({ color: COLORS.idle, emissive: new Color(COLORS.idle), emissiveIntensity: 0.9, roughness: 0.3 });
  const light = new Mesh(new SphereGeometry(0.0028, 14, 10), lightMat);
  light.position.y = s.mast + 0.002;
  antenna.add(mast, light);
  root.add(antenna);

  const cargo = makeCrate(0.016);
  cargo.position.y = lift + s.h + 0.008 + (s.dome ? 0.004 : 0);
  cargo.visible = false;
  root.add(cargo);

  const haloMat = new MeshBasicMaterial({ color: COLORS.stop, transparent: true, opacity: 0, depthWrite: false });
  const halo = new Mesh(new RingGeometry(0.021, 0.026, 32), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.0015;
  root.add(halo, makeBlob(s.w * 1.7, s.d * 1.6, 0.42));

  return { root, body, light, lightMat, cargo, halo, haloMat, wheels, antenna, eyes };
}

// ------------------------------------------------------------------ props

let crateTex: Texture | undefined;
export function makeCrate(size = 0.018): Mesh {
  crateTex ??= canvasTex(128, 128, (g) => {
    g.fillStyle = '#c99257';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(90,55,25,0.35)';
    g.lineWidth = 3;
    g.strokeRect(4, 4, 120, 120);
    g.fillStyle = 'rgba(240,220,170,0.9)';
    g.fillRect(54, 0, 20, 128); // packing tape
    g.fillStyle = 'rgba(60,40,20,0.55)';
    g.font = 'bold 22px system-ui';
    g.fillText('↑↑', 14, 34);
  });
  const m = new Mesh(new RoundedBoxGeometry(size, size * 0.78, size, 2, 0.0012), new MeshStandardMaterial({ map: crateTex, roughness: 0.8 }));
  m.position.y = (size * 0.78) / 2;
  return m;
}

/** A crate sitting on the floor with its contact shadow. */
export function makeFloorCrate(): Group {
  const g = new Group();
  g.add(makeCrate(), makeBlob(0.026, 0.026, 0.35));
  return g;
}

/** Drop-off pad: soft green fill with a bright outline and corner chevrons. */
export function makePadV2(): Group {
  const g = new Group();
  const fill = new Mesh(new PlaneGeometry(TILE * 0.82, TILE * 0.82), new MeshBasicMaterial({ color: COLORS.pad, transparent: true, opacity: 0.16, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.0011;
  const ring = new Mesh(new RingGeometry(TILE * 0.36, TILE * 0.43, 4, 1, Math.PI / 4), new MeshBasicMaterial({ color: COLORS.pad, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0013;
  g.add(fill, ring);
  return g;
}

/** Shelving unit standing in for a wall cell: posts, boards and a few boxes. */
export function makeShelf(seed: number): Group {
  const g = new Group();
  const steel = sharedMat(0x5b6573, 0.4, 0.4);
  const board = sharedMat(0xe3e6ea, 0.6);
  const s = TILE * 0.92;
  const h = 0.034;
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.0022, h, 0.0022), steel);
      post.position.set((x * s) / 2, h / 2, (z * s) / 2);
      g.add(post);
    }
  const boxColors = [0xc99257, 0x5b8def, 0xe9c46a, 0x9aa3ad];
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  [0.004, 0.017, 0.03].forEach((y, level) => {
    const plank = new Mesh(new BoxGeometry(s, 0.0016, s), board);
    plank.position.y = y;
    g.add(plank);
    if (level === 2) return;
    for (let i = 0; i < 2; i++) {
      if (rand() < 0.12) continue;
      const bw = 0.012 + rand() * 0.005;
      const box = new Mesh(new BoxGeometry(bw, 0.0105, bw * 1.2), sharedMat(boxColors[Math.floor(rand() * boxColors.length)]!, 0.7));
      box.position.set((i === 0 ? -1 : 1) * s * 0.23, y + 0.0062, (rand() - 0.5) * s * 0.3);
      g.add(box);
    }
  });
  g.add(makeBlob(s * 1.25, s * 1.25, 0.32));
  return g;
}

let puddleMat: MeshStandardMaterial | undefined;
/** A puddle with a little sheen. */
export function makePuddle(): Mesh {
  const m = new Mesh(
    new CircleGeometry(TILE * 0.44, 24),
    (puddleMat ??= new MeshStandardMaterial({ color: 0x3aa0ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.82 })),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(1, 0.82, 1);
  m.position.y = 0.0012;
  return m;
}

/** A tiny worker in a hard hat and hi-vis vest. */
export function makeWorkerV2(): { root: Group; figure: Group } {
  const root = new Group();
  const figure = new Group();
  const legs = new Mesh(new CapsuleGeometry(0.0042, 0.008, 4, 10), mat(0x2b3a55, 0.7));
  legs.position.y = 0.007;
  const torso = new Mesh(new CapsuleGeometry(0.0055, 0.008, 4, 12), mat(0x2f6fde, 0.6));
  torso.position.y = 0.0165;
  const vest = new Mesh(new TorusGeometry(0.0054, 0.0016, 6, 16), mat(0xff7a1a, 0.5, { emissive: new Color(0x401a00) }));
  vest.rotation.x = Math.PI / 2;
  vest.position.y = 0.0175;
  const head = new Mesh(new SphereGeometry(0.0048, 14, 12), mat(0xe8b98f, 0.6));
  head.position.y = 0.0285;
  const hat = new Mesh(new SphereGeometry(0.0056, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffd23f, 0.35));
  hat.position.y = 0.0295;
  const brim = new Mesh(new CylinderGeometry(0.0068, 0.0068, 0.0006, 16), mat(0xffd23f, 0.35));
  brim.position.y = 0.0296;
  figure.add(legs, torso, vest, head, hat, brim);
  root.add(figure, makeBlob(0.016, 0.016, 0.4));
  return { root, figure };
}

/** Floor texture drawn for a specific grid: clean concrete, faint tile seams, safety border. */
export function floorTexture(w: number, h: number): CanvasTexture {
  const px = 64;
  return canvasTex(w * px, h * px, (g) => {
    g.fillStyle = '#d9d4ca';
    g.fillRect(0, 0, w * px, h * px);
    // Subtle concrete speckle.
    let seed = 1234;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h * 60; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.3)';
      g.fillRect(rand() * w * px, rand() * h * px, 2, 2);
    }
    g.strokeStyle = 'rgba(110,100,85,0.35)';
    g.lineWidth = 2;
    for (let x = 0; x <= w; x++) {
      g.beginPath();
      g.moveTo(x * px, 0);
      g.lineTo(x * px, h * px);
      g.stroke();
    }
    for (let y = 0; y <= h; y++) {
      g.beginPath();
      g.moveTo(0, y * px);
      g.lineTo(w * px, y * px);
      g.stroke();
    }
    // Yellow-black safety border.
    const b = 10;
    g.save();
    g.beginPath();
    g.rect(0, 0, w * px, h * px);
    g.rect(b, b, w * px - 2 * b, h * px - 2 * b);
    g.clip('evenodd');
    g.fillStyle = '#ffc93c';
    g.fillRect(0, 0, w * px, h * px);
    g.strokeStyle = '#2b2f36';
    g.lineWidth = 7;
    for (let i = -h * px; i < w * px + h * px; i += 22) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h * px, h * px);
      g.stroke();
    }
    g.restore();
  });
}

// ------------------------------------------------------------------ desktop backdrop

/**
 * A desk and a softly lit room for the desktop preview and screenshots.
 * Hidden in the headset, where passthrough shows the player's real room.
 */
export function makePreviewRoom(): Group {
  const room = new Group();
  const wood = canvasTex(1024, 512, (g) => {
    g.fillStyle = '#8f6a4a';
    g.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(${70 + (i % 5) * 8},${40 + (i % 3) * 6},20,${0.12 + (i % 4) * 0.04})`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      const y = (i / 70) * 512;
      g.moveTo(0, y);
      g.bezierCurveTo(340, y + 6, 680, y - 6, 1024, y + 3);
      g.stroke();
    }
  });
  wood.wrapS = wood.wrapT = RepeatWrapping;
  const desk = new Mesh(new BoxGeometry(1.4, 0.03, 0.8), new MeshStandardMaterial({ map: wood, roughness: 0.6 }));
  desk.position.y = -0.015;
  desk.name = 'desk';
  room.add(desk);
  for (const [x, z] of [
    [-0.66, -0.36],
    [0.66, -0.36],
    [-0.66, 0.36],
    [0.66, 0.36],
  ] as const) {
    const leg = new Mesh(new BoxGeometry(0.04, 0.72, 0.04), mat(0x3a3f47, 0.5));
    leg.position.set(x, -0.39, z);
    room.add(leg);
  }
  const wall = canvasTex(4, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#cfd6de');
    gr.addColorStop(0.6, '#e8e4dc');
    gr.addColorStop(1, '#bdb4a6');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 256);
  });
  const shell = new Mesh(new BoxGeometry(8, 4, 8), new MeshBasicMaterial({ map: wall, side: BackSide }));
  shell.position.y = 0.8;
  room.add(shell);
  return room;
}

/**
 * Merge every mesh under `root` that shares a material into one mesh per material.
 * Used for static scenery; cuts draw calls from one per part to one per material.
 */
export function mergeStatic(root: Group): Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<Material, BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld.clone().premultiply(inv));
    // Merging needs matching attributes; keep position, normal and uv only.
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const list = byMat.get(m.material) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    byMat.set(m.material, list);
  });
  const out = new Group();
  for (const [material, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, material);
    mesh.renderOrder = (material as MeshBasicMaterial).transparent ? 1 : 0;
    out.add(mesh);
  }
  return out;
}
