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
  SphereGeometry,
  Vector3,
} from 'three';
import type { Game, Robot } from '../core/game';
import type { Cell } from '../core/types';
import {
  COLORS,
  makeCrate,
  makePad,
  makeRobot,
  makeSpill,
  makeWall,
  makeWorker,
  makeZoneTile,
  type RobotModel,
  TILE,
} from './models';

const MAX_GHOST = 48;
const STATE_COLOR: Record<Robot['state'], number> = {
  idle: COLORS.idle,
  proposed: COLORS.wait,
  executing: COLORS.go,
  stopped: COLORS.stop,
  done: COLORS.idle,
};

interface RobotView {
  model: RobotModel;
  ghost: InstancedMesh;
  ghostMat: MeshBasicMaterial;
  heading: number;
  flash: number;
  colorIndex: number;
}

/**
 * Renders a Game onto a tabletop board. Board-local axes: x right, y up,
 * z toward the seated player. Grid row 0 is the far edge.
 */
export class BoardView {
  readonly root = new Group();
  readonly content = new Group();
  readonly robots = new Map<string, RobotView>();
  private workers: { root: Group; figure: Group; zone: Mesh; bounce: number }[] = [];
  private crates = new Map<string, Mesh>();
  private pads = new Map<string, Mesh>();
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
    const base = new Mesh(new BoxGeometry(this.width + 0.02, 0.012, this.depth + 0.02), new MeshStandardMaterial({ color: COLORS.boardEdge, roughness: 0.7 }));
    base.position.y = -0.0065;
    base.receiveShadow = true;
    const top = new Mesh(new PlaneGeometry(this.width, this.depth), new MeshStandardMaterial({ color: COLORS.board, roughness: 0.9 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.0001;
    top.receiveShadow = true;
    this.content.add(base, top);

    // Grid lines as thin instanced strips.
    const lines = new InstancedMesh(new BoxGeometry(1, 0.0002, 0.0008), new MeshBasicMaterial({ color: COLORS.tileLine }), g.w + g.h + 2);
    let n = 0;
    for (let x = 0; x <= g.w; x++) {
      this.m.compose(this.v.set((x - g.w / 2) * TILE, 0.0003, 0), this.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), this.s.set(this.depth, 1, 1));
      lines.setMatrixAt(n++, this.m);
    }
    for (let y = 0; y <= g.h; y++) {
      this.m.compose(this.v.set(0, 0.0003, (y - g.h / 2) * TILE), this.q.identity(), this.s.set(this.width, 1, 1));
      lines.setMatrixAt(n++, this.m);
    }
    this.content.add(lines);

    const place = (o: Mesh | Group, c: Cell) => {
      const p = this.cellToLocal(c[0], c[1]);
      o.position.x = p.x;
      o.position.z = p.z;
      this.content.add(o);
    };
    (g.walls ?? []).forEach((c) => place(makeWall(), c));
    (g.zones ?? []).forEach((c) => place(makeZoneTile(), c));
    (g.spills ?? []).forEach((c) => place(makeSpill(), c));

    for (const t of this.game.tasks) {
      const crate = makeCrate();
      place(crate, t.from);
      this.crates.set(t.id, crate);
      const pad = makePad();
      place(pad, t.to);
      this.pads.set(t.id, pad);
    }

    this.game.robots.forEach((r, i) => {
      const model = makeRobot(i);
      this.content.add(model.root);
      const ghostMat = new MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.85, depthWrite: false });
      const ghost = new InstancedMesh(new SphereGeometry(0.0042, 8, 6), ghostMat, MAX_GHOST);
      ghost.count = 0;
      ghost.frustumCulled = false;
      this.content.add(ghost);
      this.robots.set(r.id, { model, ghost, ghostMat, heading: Math.PI, flash: 0, colorIndex: i });
    });

    for (const w of this.game.workers) {
      const { root, figure } = makeWorker();
      const side = (w.def.zoneRadius * 2 + 1) * TILE;
      const zone = new Mesh(
        new PlaneGeometry(side, side),
        new MeshBasicMaterial({ color: 0xff6b3d, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      zone.rotation.x = -Math.PI / 2;
      zone.position.y = 0.0006;
      root.add(zone);
      this.content.add(root);
      this.workers.push({ root, figure, zone, bounce: 0 });
    }
  }

  update(dt: number, time: number) {
    const game = this.game;
    // Crates follow task state: on the floor, on a robot, or gone.
    for (const t of game.tasks) {
      const crate = this.crates.get(t.id)!;
      const carrier = game.robots.find((r) => r.taskId === t.id && r.carrying);
      crate.visible = t.status !== 'done' && !carrier;
      const pad = this.pads.get(t.id)!;
      pad.visible = t.status !== 'done';
      (pad.material as MeshBasicMaterial).opacity = t.claimedBy ? 0.95 : 0.45;
    }

    for (const r of game.robots) {
      const v = this.robots.get(r.id)!;
      const [x, y] = game.robotRenderPos(r);
      const p = this.cellToLocal(x, y);
      const prev = v.model.root.position;
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      if (dx * dx + dz * dz > 1e-8) v.heading = Math.atan2(-dx, -dz);
      prev.copy(p);
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

      this.updateGhost(r, v, time);
    }

    game.workers.forEach((w, i) => {
      const view = this.workers[i]!;
      const [x, y] = game.workerRenderPos(w);
      this.cellToLocal(x, y, view.root.position);
      const dx = w.pos[0] - w.prev[0];
      const dy = w.pos[1] - w.prev[1];
      if (dx || dy) view.figure.rotation.y = Math.atan2(-dx, -dy);
      view.bounce = Math.max(0, view.bounce - dt * 2);
      view.figure.position.y = 0.012 * Math.sin(view.bounce * Math.PI);
      view.figure.position.y += 0.0008 * Math.abs(Math.sin(time * 10)); // walk bob
    });
  }

  private updateGhost(r: Robot, v: RobotView, time: number) {
    const path = this.game.remainingPath(r);
    const proposed = r.state === 'proposed';
    v.ghostMat.color.setHex(proposed ? COLORS.ghost : COLORS.robot[v.colorIndex % COLORS.robot.length]!);
    v.ghostMat.opacity = proposed ? 0.9 : 0.35;
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
