import {
  BoxGeometry,
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
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type Object3D,
} from 'three';

/** Board tile size in metres. A 12 x 8 grid is about 48 x 32 cm: fits a desk or lap tray. */
export const TILE = 0.04;

export const COLORS = {
  board: 0xf1ede4,
  boardEdge: 0x2b2f36,
  tileLine: 0xd8d2c4,
  wall: 0x8a919c,
  zone: 0xffc93c,
  spill: 0x3aa0ff,
  crate: 0xc98b4a,
  pad: 0x3fb950,
  ghost: 0x5ce1e6,
  stop: 0xff4d4f,
  go: 0x3fb950,
  wait: 0xffb020,
  idle: 0x9aa3ad,
  worker: 0x2f6fde,
  hat: 0xffd23f,
  token: 0x58f0a0,
  robot: [0xff8a3d, 0x2ec4b6, 0x9b5de5, 0xf15bb5],
} as const;

const std = (color: number, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
  new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });

export const shadowed = <T extends Object3D>(o: T) => {
  o.traverse((c) => {
    if ((c as Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
};

export interface RobotModel {
  root: Group;
  body: Mesh;
  light: Mesh;
  lightMat: MeshStandardMaterial;
  cargo: Mesh;
  halo: Mesh;
  haloMat: MeshBasicMaterial;
}

/** A small, friendly carrier robot: rounded body, visor, beacon light on top. */
export function makeRobot(colorIndex: number): RobotModel {
  const root = new Group();
  const color = COLORS.robot[colorIndex % COLORS.robot.length]!;
  const body = new Mesh(new BoxGeometry(0.03, 0.016, 0.03), std(color));
  body.position.y = 0.012;
  const visor = new Mesh(new BoxGeometry(0.022, 0.006, 0.002), std(0x1b1f24, { roughness: 0.2 }));
  visor.position.set(0, 0.014, -0.0155);
  const eyeMat = new MeshBasicMaterial({ color: 0x9ff7ff });
  const eyeL = new Mesh(new SphereGeometry(0.0018, 8, 8), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.005, 0.014, -0.0168);
  eyeR.position.set(0.005, 0.014, -0.0168);
  const wheelGeo = new CylinderGeometry(0.005, 0.005, 0.004, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = std(0x22262b);
  for (const [x, z] of [
    [-0.016, -0.01],
    [0.016, -0.01],
    [-0.016, 0.01],
    [0.016, 0.01],
  ] as const) {
    const w = new Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.005, z);
    root.add(w);
  }
  const mast = new Mesh(new CylinderGeometry(0.0008, 0.0008, 0.008, 6), std(0x22262b));
  mast.position.y = 0.024;
  const lightMat = std(COLORS.idle, { emissive: new Color(COLORS.idle), emissiveIntensity: 0.8 });
  const light = new Mesh(new SphereGeometry(0.0032, 12, 12), lightMat);
  light.position.y = 0.029;
  const cargo = new Mesh(new BoxGeometry(0.016, 0.012, 0.016), std(COLORS.crate));
  cargo.position.y = 0.026;
  cargo.visible = false;
  const haloMat = new MeshBasicMaterial({ color: COLORS.stop, transparent: true, opacity: 0, depthWrite: false });
  const halo = new Mesh(new RingGeometry(0.021, 0.026, 32), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.0015;
  root.add(body, visor, eyeL, eyeR, mast, light, cargo, halo);
  shadowed(body);
  return { root, body, light, lightMat, cargo, halo, haloMat };
}

/** A tiny worker in a hard hat. */
export function makeWorker(): { root: Group; figure: Group } {
  const root = new Group();
  const figure = new Group();
  const torso = new Mesh(new CapsuleGeometry(0.0055, 0.014, 4, 10), std(COLORS.worker));
  torso.position.y = 0.0125;
  const head = new Mesh(new SphereGeometry(0.005, 12, 12), std(0xe8b98f));
  head.position.y = 0.0285;
  const hat = new Mesh(new SphereGeometry(0.0058, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(COLORS.hat));
  hat.position.y = 0.0295;
  figure.add(torso, head, hat);
  root.add(shadowed(figure));
  return { root, figure };
}

export function makeCrate(): Mesh {
  const m = new Mesh(new BoxGeometry(0.018, 0.014, 0.018), std(COLORS.crate));
  m.position.y = 0.007;
  return shadowed(m);
}

/** Drop-off pad: a green outline square. */
export function makePad(): Mesh {
  const m = new Mesh(
    new RingGeometry(TILE * 0.32, TILE * 0.44, 4, 1, Math.PI / 4),
    new MeshBasicMaterial({ color: COLORS.pad, transparent: true, opacity: 0.85 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0012;
  return m;
}

export function makeSpill(): Mesh {
  const m = new Mesh(
    new CircleGeometry(TILE * 0.46, 20),
    new MeshStandardMaterial({ color: COLORS.spill, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.001;
  return m;
}

let zoneMat: MeshBasicMaterial | undefined;
export function makeZoneTile(): Mesh {
  zoneMat ??= new MeshBasicMaterial({ map: hatchTexture(), transparent: true, opacity: 0.9 });
  const m = new Mesh(new PlaneGeometry(TILE * 0.96, TILE * 0.96), zoneMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0008;
  return m;
}

export function makeWall(): Mesh {
  const m = new Mesh(new BoxGeometry(TILE * 0.94, 0.028, TILE * 0.94), std(COLORS.wall));
  m.position.y = 0.014;
  return shadowed(m);
}

/** The permit token: a glowing disc with a countdown ring. */
export function makeToken(): { root: Group; ring: Mesh; ringMat: MeshBasicMaterial; disc: Mesh } {
  const root = new Group();
  const disc = new Mesh(
    new CylinderGeometry(0.012, 0.012, 0.004, 24),
    std(COLORS.token, { emissive: new Color(COLORS.token), emissiveIntensity: 0.6 }),
  );
  const mark = new Mesh(new BoxGeometry(0.012, 0.0045, 0.003), std(0xffffff));
  mark.rotation.y = Math.PI / 4;
  const ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const ring = new Mesh(new TorusGeometry(0.0145, 0.0012, 6, 32), ringMat);
  ring.rotation.x = Math.PI / 2;
  root.add(disc, mark, ring);
  return { root, ring, ringMat, disc };
}

/** Round push button with an icon face toward the player (+z); pokeable and ray-clickable. */
export function makeButton(icon: string, color: number, size = 0.022): Mesh {
  const geo = new CylinderGeometry(size / 2, size / 2, 0.006, 24);
  geo.rotateX(Math.PI / 2); // axis along z, cap facing the player
  const m = new Mesh(geo, std(color));
  const face = new Mesh(new CircleGeometry(size * 0.46, 24), new MeshBasicMaterial({ map: iconTexture(icon, color), transparent: true }));
  face.position.z = 0.0032;
  m.add(face);
  return m;
}

function iconTexture(icon: string, color: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  // Draw common controls as shapes so they look the same whatever fonts the headset browser has.
  if (!drawShapeIcon(g, icon)) {
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, 64, 70);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function drawShapeIcon(g: CanvasRenderingContext2D, icon: string): boolean {
  g.beginPath();
  switch (icon) {
    case '⏸':
      g.fillRect(40, 34, 18, 60);
      g.fillRect(70, 34, 18, 60);
      return true;
    case '▶':
      g.moveTo(46, 32);
      g.lineTo(96, 64);
      g.lineTo(46, 96);
      g.closePath();
      g.fill();
      return true;
    case '■':
      g.fillRect(38, 38, 52, 52);
      return true;
    case '⏏':
      g.moveTo(64, 30);
      g.lineTo(98, 70);
      g.lineTo(30, 70);
      g.closePath();
      g.fill();
      g.fillRect(30, 80, 68, 14);
      return true;
    default:
      return false;
  }
}

let hatch: CanvasTexture | undefined;
function hatchTexture(): CanvasTexture {
  if (hatch) return hatch;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffc93c';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#2b2f36';
  g.lineWidth = 8;
  for (let i = -64; i < 128; i += 22) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 64, 0);
    g.stroke();
  }
  hatch = new CanvasTexture(c);
  hatch.colorSpace = SRGBColorSpace;
  return hatch;
}
