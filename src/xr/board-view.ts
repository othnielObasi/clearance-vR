import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { expandPath, type Game, type Robot } from '../core/game';
import type { Cell } from '../core/types';
import { CREW, crewNameFor } from '../core/crew';
import { Effects } from './effects';
import {
  type CrewModel,
  makeBollard,
  makeChargingPad,
  makeDock,
  makeRack,
  makeStencil,
  warehouseFloor,
  makeCrewRobot,
  makeFloorCrate,
  makePadV2,
  makePuddle,
  makeShelf,
  makeWorkerV2,
  mergeStatic,
} from './look';
import { COLORS, makeZoneTile, TILE } from './models';
import { makeBlob as makeBlobLike } from './look';

const MAX_GHOST = 48;
const STATE_COLOR: Record<Robot['state'], number> = {
  idle: COLORS.idle,
  proposed: COLORS.wait,
  executing: COLORS.go,
  stopped: COLORS.stop,
  done: COLORS.idle,
};

interface RobotView {
  model: CrewModel;
  /** Distance driven, for spinning the wheels. */
  odo: number;
  wobble: number;
  ghost: InstancedMesh;
  ghostMat: MeshBasicMaterial;
  heading: number;
  flash: number;
  colorIndex: number;
  /** 1 → 0 after a grant: squash-and-stretch salute plus a green burst ring. */
  pop: number;
  /** 1 → 0 after a hard stop: tips forward like braking. */
  brake: number;
  burst: Mesh;
  burstMat: MeshBasicMaterial;
}

/**
 * Renders a Game onto a tabletop board. Board-local axes: x right, y up,
 * z toward the seated player. Grid row 0 is the far edge.
 */
export class BoardView {
  readonly root = new Group();
  readonly content = new Group();
  readonly robots = new Map<string, RobotView>();
  private workers: { root: Group; figure: Group; zone: Mesh; bounce: number; waveCooldown: number }[] = [];
  /** 0 → 1 as the board unfolds from the desk after loading. */
  private unfold = 0;
  /** Glow on the cells under the player's flat hand. */
  private handCells!: InstancedMesh;
  /** World positions of tracked fingertips, set each frame by the app. */
  hands: Vector3[] = [];
  private crates = new Map<string, Group>();
  private pads = new Map<string, Group>();
  readonly effects: Effects;
  private m = new Matrix4();
  private v = new Vector3();
  private q = new Quaternion();
  private s = new Vector3();
  readonly width: number;
  readonly depth: number;

  constructor(private game: Game) {
    const { w, h } = game.level.grid;
    this.width = w * TILE;
    this.depth = h * TILE;
    this.root.add(this.content);
    this.effects = new Effects(this.content);
    this.handCells = new InstancedMesh(
      new PlaneGeometry(TILE * 0.9, TILE * 0.9),
      new MeshBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.45, depthWrite: false }),
      16,
    );
    this.handCells.count = 0;
    this.handCells.renderOrder = 3;
    this.handCells.frustumCulled = false;
    this.content.add(this.handCells);
    this.buildStatic();
  }

  /** Board-local position of a (possibly fractional) cell centre. */
  cellToLocal(x: number, y: number, out = new Vector3()): Vector3 {
    const { w, h } = this.game.level.grid;
    return out.set((x - (w - 1) / 2) * TILE, 0, (y - (h - 1) / 2) * TILE);
  }

  /** World position of a robot (its body centre). */
  robotWorld(id: string, out = new Vector3()): Vector3 {
    const v = this.robots.get(id);
    if (!v) return out.set(0, -999, 0);
    return v.model.body.getWorldPosition(out);
  }

  /** World positions of the ghost path dots of a robot. */
  pathWorld(r: Robot): Vector3[] {
    return this.game.remainingPath(r).map((c) => this.root.localToWorld(this.cellToLocal(c[0], c[1]).setY(0.004)));
  }

  pop(robotId: string) {
    const v = this.robots.get(robotId);
    if (v) v.pop = 1;
  }

  brake(robotId: string) {
    const v = this.robots.get(robotId);
    if (v) v.brake = 1;
  }

  /** Show which cells the hand is blocking. */
  setHandCells(cells: Cell[]) {
    const n = Math.min(cells.length, 16);
    for (let i = 0; i < n; i++) {
      const c = cells[i]!;
      this.cellToLocal(c[0], c[1], this.v).setY(0.0016);
      this.m.compose(this.v, this.q.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), this.s.set(1, 1, 1));
      this.handCells.setMatrixAt(i, this.m);
    }
    this.handCells.count = n;
    this.handCells.instanceMatrix.needsUpdate = true;
  }

  /** Board-local point to (fractional) cell coordinates. */
  localToCell(x: number, z: number): [number, number] {
    const { w, h } = this.game.level.grid;
    return [x / TILE + (w - 1) / 2, z / TILE + (h - 1) / 2];
  }

  /** Sparkles at a cell (deliveries). */
  sparkle(cell: Cell, color = 0xffd23f) {
    this.effects.burst(this.cellToLocal(cell[0], cell[1]).setY(0.012), color, 22, { speed: 0.09, up: 0.16, size: 0.0016 });
  }

  /** A puff at a robot (brakes, incidents). */
  puff(robotId: string, color = 0xb9b2a5) {
    const v = this.robots.get(robotId);
    if (!v) return;
    this.effects.burst(v.model.root.position.clone().setY(0.004), color, 12, { speed: 0.05, up: 0.04, size: 0.0022, life: 0.5 });
  }

  flash(robotId: string) {
    const v = this.robots.get(robotId);
    if (v) v.flash = 1;
  }

  bounceWorkerNear(cell: Cell) {
    let best = this.workers[0];
    let bd = Infinity;
    this.game.workers.forEach((w, i) => {
      const d = Math.abs(w.pos[0] - cell[0]) + Math.abs(w.pos[1] - cell[1]);
      if (d < bd) {
        bd = d;
        best = this.workers[i];
      }
    });
    if (best) best.bounce = 1;
  }

  private buildStatic() {
    const g = this.game.level.grid;
    const base = new Mesh(new BoxGeometry(this.width + 0.024, 0.012, this.depth + 0.024), new MeshStandardMaterial({ color: COLORS.boardEdge, roughness: 0.45, metalness: 0.2 }));
    base.position.y = -0.0062;
    const top = new Mesh(new PlaneGeometry(this.width, this.depth), new MeshStandardMaterial({
        map: warehouseFloor({
          w: g.w,
          h: g.h,
          seed: this.game.level.seed,
          walls: (g.walls ?? []).map(([x, y]) => ({ x, y })),
          zones: (g.zones ?? []).map(([x, y]) => ({ x, y })),
          walkways: this.game.workers.flatMap((w) => expandPath(w.def.path)).map(([x, y]) => ({ x, y })),
        }),
        roughness: 0.85,
      }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.0001;
    // Glowing cyan edge along the player's side, so the board reads as a device on the desk.
    const glow = new Mesh(new BoxGeometry(this.width + 0.024, 0.0025, 0.0025), new MeshBasicMaterial({ color: 0x5ce1e6 }));
    glow.position.set(0, -0.003, this.depth / 2 + 0.0125);
    // A soft shadow under the whole board grounds it on the real desk.
    const shadow = makeBlobLike(this.width * 1.18, this.depth * 1.25);
    shadow.position.y = -0.0125;
    this.content.add(base, top, glow, shadow);

    const place = (o: Mesh | Group, c: Cell) => {
      const p = this.cellToLocal(c[0], c[1]);
      o.position.x = p.x;
      o.position.z = p.z;
      this.content.add(o);
    };
    // Static scenery is built in a scratch group, then merged into a few meshes.
    const scenery = new Group();
    const put = (o: Mesh | Group, c: Cell) => {
      const p = this.cellToLocal(c[0], c[1]);
      o.position.x = p.x;
      o.position.z = p.z;
      scenery.add(o);
    };
    const tall = new Set((g.tall ?? []).map(([x, y]) => `${x},${y}`));
    (g.walls ?? []).forEach((c, i) => put(makeRack(i + c[0] * 31 + c[1] * 7, tall.has(`${c[0]},${c[1]}`)), c));
    // Charging pads where robots start; bollards at the corners and walkway ends.
    for (const r of this.game.level.robots) put(makeChargingPad(), r.start);
    for (const w of this.game.workers) {
      const cells = expandPath(w.def.path);
      for (const end of [cells[0]!, cells[cells.length - 1]!]) {
        const b = makeBollard();
        b.position.x = TILE * 0.42;
        b.position.z = TILE * 0.42;
        const holder = new Group();
        holder.add(b);
        put(holder, end);
      }
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const b = makeBollard();
      b.position.set((sx * this.width) / 2 + sx * 0.009, -0.012, (sz * this.depth) / 2 + sz * 0.009);
      scenery.add(b);
    }
    // Loading dock along the far edge.
    const dock = makeDock(this.width + 0.024);
    dock.position.set(0, -0.012, -this.depth / 2 - 0.018);
    scenery.add(dock);
    (g.zones ?? []).forEach((c) => put(makeZoneTile(), c));
    (g.spills ?? []).forEach((c) => put(makePuddle(), c));
    this.content.add(mergeStatic(scenery));

    this.syncDynamic();

    for (const w of this.game.workers) {
      const { root, figure } = makeWorkerV2();
      const side = (w.def.zoneRadius * 2 + 1) * TILE;
      const zone = new Mesh(
        new PlaneGeometry(side, side),
        new MeshBasicMaterial({ color: 0xff6b3d, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      zone.rotation.x = -Math.PI / 2;
      zone.position.y = 0.0006;
      root.add(zone);
      this.content.add(root);
      this.workers.push({ root, figure, zone, bounce: 0, waveCooldown: 0 });
    }
  }

  /** Create visuals for robots and tasks that joined since the last frame (Overtime). */
  syncDynamic() {
    for (const t of this.game.tasks) {
      if (this.crates.has(t.id)) continue;
      const crate = makeFloorCrate();
      crate.add(makeStencil('PICK', '#2b2f36'));
      const pad = makePadV2();
      pad.add(makeStencil('DROP', '#1f7a3a'));
      const a = this.cellToLocal(t.from[0], t.from[1]);
      crate.position.x = a.x;
      crate.position.z = a.z;
      const b = this.cellToLocal(t.to[0], t.to[1]);
      pad.position.x = b.x;
      pad.position.z = b.z;
      this.content.add(crate, pad);
      this.crates.set(t.id, crate);
      this.pads.set(t.id, pad);
    }
    this.game.robots.forEach((r, i) => {
      if (this.robots.has(r.id)) return;
      const colorIndex = CREW[crewNameFor(r.def, i)].color;
      const model = makeCrewRobot(crewNameFor(r.def, i), COLORS.robot[colorIndex % COLORS.robot.length]!);
      const i0 = colorIndex;
      this.content.add(model.root);
      // Plans always show through racking: hiding things is for workers and spills, never for plans.
      const ghostMat = new MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false });
      const ghost = new InstancedMesh(new SphereGeometry(0.0042, 8, 6), ghostMat, MAX_GHOST);
      ghost.count = 0;
      ghost.frustumCulled = false;
      ghost.renderOrder = 4;
      this.content.add(ghost);
      const burstMat = new MeshBasicMaterial({ color: COLORS.go, transparent: true, opacity: 0, depthWrite: false });
      const burst = new Mesh(new RingGeometry(0.018, 0.022, 32), burstMat);
      burst.rotation.x = -Math.PI / 2;
      burst.position.y = 0.002;
      model.root.add(burst);
      this.robots.set(r.id, { model, ghost, ghostMat, heading: Math.PI, flash: 0, colorIndex: i0, pop: 0, brake: 0, burst, burstMat, odo: 0, wobble: 0 });
      model.root.position.copy(this.cellToLocal(r.pos[0], r.pos[1]));
    });
  }

  update(dt: number, time: number) {
    const game = this.game;
    this.syncDynamic();
    this.effects.update(dt);
    if (this.unfold < 1) {
      this.unfold = Math.min(1, this.unfold + dt / 0.7);
      const e = 1 - Math.pow(1 - this.unfold, 3);
      this.content.scale.set(0.3 + 0.7 * e, 1, Math.max(0.02, e));
    }
    // Crates follow task state: on the floor, on a robot, or gone.
    for (const t of game.tasks) {
      const crate = this.crates.get(t.id)!;
      const carrier = game.robots.find((r) => r.taskId === t.id && r.carrying);
      crate.visible = t.status !== 'done' && !carrier;
      const pad = this.pads.get(t.id)!;
      pad.visible = t.status !== 'done';
      pad.scale.setScalar(t.claimedBy ? 1 : 0.9);
    }

    for (const r of game.robots) {
      const v = this.robots.get(r.id)!;
      const [x, y] = game.robotRenderPos(r);
      const p = this.cellToLocal(x, y);
      const prev = v.model.root.position;
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      if (dx * dx + dz * dz > 1e-8) v.heading = Math.atan2(-dx, -dz);
      const step = Math.hypot(dx, dz);
      v.odo += step;
      for (const w of v.model.wheels) w.rotation.x = -v.odo / 0.005;
      // Antenna springs back after starts and stops.
      v.wobble = Math.max(v.wobble * Math.pow(0.02, dt), step > 0.0004 && v.wobble < 0.05 ? 0.25 : 0);
      prev.copy(p);
      // A robot that isn't driving turns to look at a hand reaching toward it.
      if (r.state !== 'executing') {
        for (const h of this.hands) {
          const local = this.content.worldToLocal(this.v.copy(h));
          const hx = local.x - p.x;
          const hz = local.z - p.z;
          if (hx * hx + hz * hz < 0.15 * 0.15 && hx * hx + hz * hz > 1e-6) {
            v.heading = Math.atan2(-hx, -hz);
            break;
          }
        }
      }
      const cur = v.model.root.rotation.y;
      let d = v.heading - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.model.root.rotation.y = cur + d * Math.min(1, dt * 12);

      v.model.cargo.visible = r.carrying;
      const color = STATE_COLOR[r.state];
      v.model.lightMat.color.setHex(color);
      v.model.lightMat.emissive.setHex(color);
      // Blink while waiting for clearance.
      v.model.lightMat.emissiveIntensity = r.state === 'proposed' ? 0.5 + 0.8 * (0.5 + 0.5 * Math.sin(time * 8)) : 0.9;
      v.flash = Math.max(0, v.flash - dt * 1.5);
      const stopped = r.state === 'stopped' ? 0.6 : 0;
      v.model.haloMat.opacity = Math.max(stopped, v.flash);
      v.model.root.position.y = r.state === 'proposed' ? 0.0015 * Math.abs(Math.sin(time * 5)) : 0;

      v.pop = Math.max(0, v.pop - dt * 2.2);
      const sq = Math.sin(v.pop * Math.PI * 2) * 0.25 * v.pop;
      v.model.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      v.model.root.position.y += 0.008 * Math.sin(v.pop * Math.PI);
      v.burstMat.opacity = v.pop * 0.9;
      v.burst.scale.setScalar(1 + (1 - v.pop) * 1.8);

      v.brake = Math.max(0, v.brake - dt * 3);
      v.model.root.rotation.x = -0.35 * Math.sin(v.brake * Math.PI);
      if (v.brake > 0.95 || v.pop > 0.95) v.wobble = 1;
      v.model.antenna.rotation.x = Math.sin(time * 28) * 0.35 * v.wobble;
      // Eyes blink now and then.
      const blink = Math.sin(time * 0.9 + v.colorIndex * 2.1) > 0.985 ? 0.15 : 1;
      for (const e of v.model.eyes) e.scale.y = blink;

      this.updateGhost(r, v, time);
    }

    game.workers.forEach((w, i) => {
      const view = this.workers[i]!;
      const [x, y] = game.workerRenderPos(w);
      this.cellToLocal(x, y, view.root.position);
      const dx = w.pos[0] - w.prev[0];
      const dy = w.pos[1] - w.prev[1];
      if (dx || dy) view.figure.rotation.y = Math.atan2(-dx, -dy);
      // Workers hop and look up when a hand comes close.
      view.waveCooldown -= dt;
      if (view.waveCooldown <= 0) {
        const wp = view.root.getWorldPosition(this.v);
        if (this.hands.some((h) => h.distanceTo(wp) < 0.08)) {
          view.bounce = 0.7;
          view.waveCooldown = 2.5;
        }
      }
      view.bounce = Math.max(0, view.bounce - dt * 2);
      view.figure.position.y = 0.012 * Math.sin(view.bounce * Math.PI);
      view.figure.position.y += 0.0008 * Math.abs(Math.sin(time * 10)); // walk bob
    });
  }

  private updateGhost(r: Robot, v: RobotView, time: number) {
    const path = this.game.remainingPath(r);
    const proposed = r.state === 'proposed';
    // Each plan wears its robot's colour, so several proposals stay readable.
    v.ghostMat.color.setHex(COLORS.robot[v.colorIndex % COLORS.robot.length]!);
    v.ghostMat.opacity = proposed ? 0.95 : 0.3;
    const n = Math.min(path.length - 1, MAX_GHOST);
    // A pulse travels along the proposed path so the plan reads as intent.
    const pulse = (time * 6) % Math.max(1, n);
    for (let i = 0; i < n; i++) {
      const c = path[i + 1]!;
      this.cellToLocal(c[0], c[1], this.v).setY(0.004);
      const near = proposed ? Math.max(0, 1 - Math.abs(i - pulse) / 2) : 0;
      const isPickup = proposed && i + 1 === r.pickupIdx;
      const sc = 1 + near * 0.8 + (isPickup ? 0.6 : 0);
      this.m.compose(this.v, this.q.identity(), this.s.set(sc, sc, sc));
      v.ghost.setMatrixAt(i, this.m);
    }
    v.ghost.count = Math.max(0, n);
    v.ghost.instanceMatrix.needsUpdate = true;
  }

  setRobotTint(id: string, hex: number) {
    const v = this.robots.get(id);
    if (v) (v.model.body.material as MeshStandardMaterial).emissive = new Color(hex);
  }
}
