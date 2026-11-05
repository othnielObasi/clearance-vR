import {
  type Entity,
  Grabbed,
  OneHandGrabbable,
  PokeInteractable,
  Pressed,
  RayInteractable,
  VisibilityState,
  type World,
} from '@iwsdk/core';
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import { Game, type GameEvent } from '../core/game';
import { LEVELS } from '../levels';
import { Sfx } from '../xr/audio';
import { BoardView } from '../xr/board-view';
import { GESTURE, HandTracker, HoldTimer } from '../xr/gestures';
import { Hud } from '../xr/hud';
import { COLORS, makeButton, makeToken, TILE } from '../xr/models';
import { Bubble } from '../xr/bubble';
import { Coach } from './coach';
import { proposalLine, reactionLine, verdictLine } from './voice';
import { loadProgress, saveResult } from './progress';

type ButtonAction = () => void;
interface Button {
  entity: Entity;
  mesh: Mesh;
  action: ButtonAction;
  pressedAt: number;
}

interface Token {
  entity: Entity;
  model: ReturnType<typeof makeToken>;
  permitId?: string;
  /** Flying into a robot after a successful grant. */
  flyTo?: string;
  flyT: number;
  dissolve: number;
}

interface RobotPanel {
  grant: Button;
  reject: Button;
  stop: Button;
}

const DROP_RADIUS = 0.07;
const FLICK_RADIUS = 0.05;
const BOARD_FORWARD = 0.42; // metres in front of the head
const BOARD_BELOW = 0.42; // metres below the head (seated desk height)

/**
 * Owns one play session: the board, the current Game, hands, buttons, tokens, HUD.
 * Driven every frame by ClearanceSystem.
 */
export class ClearanceApp {
  readonly sfx = new Sfx();
  readonly tracker = new HandTracker();
  game!: Game;
  view!: BoardView;
  levelIndex = 0;

  private boardEntity?: Entity;
  private handle!: Entity;
  private boardYaw = 0;
  private placedInXR = false;
  private hud = new Hud();
  private coach!: Coach;
  private buttons = new Map<number, Button>();
  private panels = new Map<string, RobotPanel>();
  private bubbles = new Map<string, Bubble>();
  /** Game-time multiplier: dips briefly into slow motion on a near miss. */
  private timeScale = 1;
  private slowUntil = 0;
  private slowCooldown = new Map<string, number>();
  private tokens: Token[] = [];
  private ready?: Token;
  private dispenser = new Group();
  private stopAllBtn?: Button;
  private nextBtn?: Button;
  private retryBtn?: Button;
  private holdHand = { left: new HoldTimer(), right: new HoldTimer() };
  private holdBoth = new HoldTimer();
  private palmRings: Record<'left' | 'right', Mesh>;
  private flickCooldown = 0;
  private clock = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(private world: World) {
    const hemi = new HemisphereLight(0xffffff, 0x8a8070, 2.2);
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, 2, 0.6);
    world.scene.add(hemi, sun);

    this.palmRings = {
      left: this.makePalmRing(),
      right: this.makePalmRing(),
    };

    // The grab handle sits at the near edge; the board follows it.
    const bar = new Mesh(new BoxGeometry(0.11, 0.014, 0.022), new MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4 }));
    const grip = new Mesh(new BoxGeometry(0.07, 0.016, 0.012), new MeshStandardMaterial({ color: 0x5ce1e6, roughness: 0.3 }));
    grip.position.y = 0.002;
    bar.add(grip);
    this.handle = world.createTransformEntity(bar, { persistent: true });
    this.handle.addComponent(OneHandGrabbable, { rotate: false, translate: true });
    // Desktop preview position; re-placed relative to the head when XR starts.
    this.handle.object3D!.position.set(0, 0.9, -0.32);

    this.levelIndex = Math.min(loadProgress().unlocked, LEVELS.length - 1);
    this.loadLevel(this.levelIndex);
  }

  // ------------------------------------------------------------------ level lifecycle

  loadLevel(i: number) {
    this.levelIndex = (i + LEVELS.length) % LEVELS.length;
    this.clearLevel();
    const level = LEVELS[this.levelIndex]!;
    this.game = new Game(level);
    this.view = new BoardView(this.game);
    this.coach = new Coach(level.id);
    this.boardEntity = this.world.createTransformEntity(this.view.root);

    const nearZ = this.view.depth / 2;
    const farZ = -this.view.depth / 2;
    const leftX = -this.view.width / 2;

    // HUD floats above the far edge, tilted toward the player.
    this.hud.mesh.position.set(0, 0.11, farZ - 0.02);
    this.hud.mesh.rotation.x = -0.25;
    this.view.root.add(this.hud.mesh);

    // Permit dispenser at the near-left corner.
    this.dispenser = new Group();
    const box = new Mesh(new BoxGeometry(0.05, 0.03, 0.05), new MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 }));
    box.position.y = 0.015;
    const slot = new Mesh(new BoxGeometry(0.032, 0.002, 0.032), new MeshBasicMaterial({ color: COLORS.token }));
    slot.position.y = 0.031;
    this.dispenser.add(box, slot);
    this.dispenser.position.set(leftX - 0.045, 0, nearZ - 0.03);
    this.view.root.add(this.dispenser);

    this.stopAllBtn = this.addButton('■', COLORS.stop, () => this.stopAll(), 0.026);
    this.stopAllBtn.mesh.position.set(leftX - 0.045, 0.02, nearZ + 0.004);

    this.nextBtn = this.addButton('▶', COLORS.go, () => this.loadLevel(this.levelIndex + 1), 0.04);
    this.nextBtn.mesh.position.set(0.05, 0.05, farZ - 0.01);
    this.retryBtn = this.addButton('↻', 0x5b6573, () => this.loadLevel(this.levelIndex), 0.04);
    this.retryBtn.mesh.position.set(-0.05, 0.05, farZ - 0.01);

    for (const r of this.game.robots) {
      const bubble = new Bubble();
      this.view.content.add(bubble.sprite);
      this.bubbles.set(r.id, bubble);
      this.panels.set(r.id, {
        grant: this.addButton('✓', COLORS.go, () => this.grantByButton(r.id)),
        reject: this.addButton('✗', 0xff8a3d, () => this.rejectRobot(r.id)),
        stop: this.addButton('■', COLORS.stop, () => this.stopRobot(r.id)),
      });
    }
    this.placeBoard();
  }

  private clearLevel() {
    for (const b of this.buttons.values()) b.entity.dispose();
    this.buttons.clear();
    this.panels.clear();
    this.bubbles.clear();
    this.slowCooldown.clear();
    this.timeScale = 1;
    this.slowUntil = 0;
    for (const t of this.tokens) t.entity.dispose();
    this.tokens = [];
    this.ready = undefined;
    if (this.view) this.view.root.remove(this.hud.mesh);
    this.boardEntity?.dispose();
    this.boardEntity = undefined;
  }

  private addButton(icon: string, color: number, action: ButtonAction, size?: number): Button {
    const mesh = makeButton(icon, color, size);
    const entity = this.world.createTransformEntity(mesh, { parent: this.boardEntity! });
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    const b = { entity, mesh, action, pressedAt: -1 };
    this.buttons.set(entity.index, b);
    return b;
  }

  // ------------------------------------------------------------------ placement

  /** Board follows the handle, at the handle's height, rotated to face the player. */
  private placeBoard() {
    const hp = this.handle.object3D!.position;
    const root = this.view.root;
    root.rotation.set(0, this.boardYaw, 0);
    // Handle is at the near edge centre; board centre lies behind it.
    this.tmp.set(0, 0, -(this.view.depth / 2 + 0.03)).applyAxisAngle(new Vector3(0, 1, 0), this.boardYaw);
    root.position.set(hp.x + this.tmp.x, hp.y - 0.008, hp.z + this.tmp.z);
  }

  /** On entering XR, put the board in front of the seated player at desk height. */
  private placeInFrontOfHead() {
    const head = this.world.player.head;
    const hp = head.getWorldPosition(new Vector3());
    const dir = head.getWorldDirection(new Vector3()).multiplyScalar(-1); // camera looks down -z
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    this.boardYaw = Math.atan2(-dir.x, -dir.z);
    this.handle.object3D!.position.set(hp.x + dir.x * (BOARD_FORWARD - 0.2), hp.y - BOARD_BELOW, hp.z + dir.z * (BOARD_FORWARD - 0.2));
    this.handle.object3D!.rotation.set(0, this.boardYaw, 0);
    this.placedInXR = true;
  }

  // ------------------------------------------------------------------ actions (shared by gestures and buttons)

  private stopRobot(id: string) {
    const moving = this.game.robot(id)?.state === 'executing';
    if (this.game.stop(id)) {
      if (!moving) this.sfx.stop();
      this.view.flash(id);
    }
  }

  private stopAll() {
    if (this.game.stopAll() > 0) {
      this.sfx.stopAll();
      for (const r of this.game.robots) this.view.flash(r.id);
    }
  }

  private rejectRobot(id: string) {
    if (this.game.reject(id)) this.sfx.reject();
  }

  /** Poke/click alternative to handing over a token: uses a held permit, or takes a new one. */
  private grantByButton(id: string) {
    const held = this.tokens.find((t) => t.permitId && !t.flyTo && this.game.permits.find((p) => p.id === t.permitId)?.state === 'held');
    const permitId = held?.permitId ?? this.game.dispensePermit()?.id;
    if (!permitId) {
      this.sfx.refuse();
      return;
    }
    if (this.game.grant(permitId, id) && held) this.consumeToken(held, id);
  }

  // ------------------------------------------------------------------ grab and press callbacks

  onGrab(entity: Entity) {
    if (entity === this.handle) return;
    const t = this.tokens.find((x) => x.entity === entity);
    if (!t || t.permitId) return;
    const p = this.game.dispensePermit();
    if (!p) return;
    t.permitId = p.id;
    if (this.ready === t) this.ready = undefined;
    this.sfx.pick();
  }

  onRelease(entity: Entity) {
    if (entity === this.handle) {
      this.boardYaw = this.yawTowardHead(this.handle.object3D!.position);
      return;
    }
    const t = this.tokens.find((x) => x.entity === entity);
    if (!t?.permitId) return;
    const pos = t.entity.object3D!.getWorldPosition(this.tmp);
    let best: string | undefined;
    let bd = DROP_RADIUS;
    for (const r of this.game.robots) {
      const d = this.view.robotWorld(r.id, this.tmp2).distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = r.id;
      }
    }
    if (!best) return;
    if (this.game.grant(t.permitId, best)) this.consumeToken(t, best);
    else this.sfx.refuse();
  }

  onPress(entity: Entity) {
    const b = this.buttons.get(entity.index);
    if (!b || !b.mesh.visible || this.clock - b.pressedAt < 0.35) return;
    b.pressedAt = this.clock;
    b.action();
  }

  private yawTowardHead(p: Vector3) {
    const hp = this.world.player.head.getWorldPosition(new Vector3());
    return Math.atan2(hp.x - p.x, hp.z - p.z);
  }

  private consumeToken(t: Token, robot: string) {
    if (t.entity.hasComponent(OneHandGrabbable)) t.entity.removeComponent(OneHandGrabbable);
    t.flyTo = robot;
    t.flyT = 0;
  }

  private spawnReadyToken() {
    const model = makeToken();
    const entity = this.world.createTransformEntity(model.root);
    const p = this.dispenser.getWorldPosition(this.tmp);
    entity.object3D!.position.set(p.x, p.y + 0.04, p.z);
    entity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
    this.ready = { entity, model, flyT: 0, dissolve: 0 };
    this.tokens.push(this.ready);
  }

  // ------------------------------------------------------------------ per-frame

  frame(dt: number, frame: XRFrame | null, ref: XRReferenceSpace | null) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const inXR = !!this.world.session;
    if (inXR && !this.placedInXR && this.world.visibilityState.value === VisibilityState.Visible) this.placeInFrontOfHead();
    if (!inXR) this.placedInXR = false;
    // Pause cleanly when the headset sleeps or a system menu opens.
    const paused = inXR && this.world.visibilityState.value !== VisibilityState.Visible;

    this.placeBoard();
    this.tracker.update(frame, ref, this.world.player.matrixWorld as Matrix4, dt);

    this.view.hands = (['left', 'right'] as const).filter((s) => this.tracker.hands[s].tracked).map((s) => this.tracker.hands[s].indexTip);
    if (!paused) {
      this.handleGestures(dt);
      this.updateSlowMotion(dt);
      this.game.update(dt * this.timeScale);
    }
    for (const e of this.game.drainEvents()) this.onGameEvent(e);
    this.coach.update(dt);
    this.view.update(dt, this.clock);
    this.updateTokens(dt);
    this.updateButtons();
    this.updateBubbles();
    this.drawHud();
  }

  /** Half a second of slow motion when a moving robot is about to reach a worker: time to react, and drama. */
  private updateSlowMotion(dt: number) {
    const g = this.game;
    if (g.status === 'playing') {
      for (const r of g.robots) {
        if (r.state !== 'executing') continue;
        const next = g.remainingPath(r).slice(1, 3);
        const close = next.some((c) => g.inWorkerZone(c));
        if (close && this.clock > (this.slowCooldown.get(r.id) ?? 0)) {
          this.slowUntil = this.clock + 0.6;
          this.slowCooldown.set(r.id, this.clock + 3);
          this.view.flash(r.id);
          this.sfx.warn();
        }
      }
    }
    const target = this.clock < this.slowUntil ? 0.3 : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * 12);
  }

  private updateBubbles() {
    const playing = this.game.status === 'playing';
    for (const r of this.game.robots) {
      const b = this.bubbles.get(r.id);
      if (!b) continue;
      const [x, y] = this.game.robotRenderPos(r);
      this.view.cellToLocal(x, y, b.sprite.position).setY(0.09);
      b.update(this.clock, playing && r.state === 'proposed' ? proposalLine(r) : null, r.mood);
    }
  }

  private onGameEvent(e: GameEvent) {
    this.coach.onEvent(e);
    if ('robot' in e) {
      const line = reactionLine(e);
      if (line) this.bubbles.get(e.robot)?.react(line, this.clock);
    }
    switch (e.type) {
      case 'proposed':
        this.sfx.propose();
        break;
      case 'granted':
        this.sfx.grant();
        this.view.pop(e.robot);
        break;
      case 'stopped':
        if (e.wasMoving) {
          this.view.brake(e.robot);
          this.sfx.brake();
        }
        break;
      case 'refused':
        this.sfx.refuse();
        break;
      case 'delivered':
        this.sfx.deliver();
        break;
      case 'incident': {
        this.sfx.incident();
        this.view.flash(e.robot);
        const r = this.game.robot(e.robot);
        if (r) this.view.bounceWorkerNear(r.pos);
        break;
      }
      case 'permitExpired':
        this.sfx.expire();
        break;
      case 'ended': {
        const level = LEVELS[this.levelIndex]!;
        if (e.status === 'won') {
          this.sfx.win();
          saveResult(this.levelIndex, level.id, this.game.score().stars, LEVELS.length);
        } else this.sfx.lose();
        break;
      }
    }
  }

  private handleGestures(dt: number) {
    const { left, right } = this.tracker.hands;
    this.flickCooldown -= dt;

    // Both palms up and open: stop everything.
    const bothUp = left.tracked && right.tracked && left.open && right.open && left.palmNormal.y > GESTURE.palmUpY && right.palmNormal.y > GESTURE.palmUpY;
    const all = this.holdBoth.step(bothUp, 'all', dt, GESTURE.bothPalmsHoldSec);
    if (all.fire) this.stopAll();

    for (const h of [left, right]) {
      const ring = this.palmRings[h.side];
      // One open palm facing a robot: stop that robot.
      let target: string | null = null;
      if (h.tracked && h.open && !bothUp) {
        let bestDot = GESTURE.palmConeCos;
        for (const r of this.game.robots) {
          if (r.state !== 'executing' && r.state !== 'proposed') continue;
          const to = this.view.robotWorld(r.id, this.tmp).sub(h.palm);
          const dist = to.length();
          if (dist < GESTURE.palmMinDist || dist > GESTURE.palmMaxDist) continue;
          const dot = to.normalize().dot(h.palmNormal);
          if (dot > bestDot) {
            bestDot = dot;
            target = r.id;
          }
        }
      }
      const hold = this.holdHand[h.side].step(target !== null, target, dt, GESTURE.palmHoldSec);
      if (hold.fire && target) this.stopRobot(target);
      ring.visible = hold.progress > 0.05 || (bothUp && all.progress > 0.05);
      if (ring.visible) {
        ring.position.copy(h.palm).addScaledVector(h.palmNormal, 0.03);
        ring.lookAt(this.tmp.copy(ring.position).add(h.palmNormal));
        const s = 0.4 + 0.6 * Math.max(hold.progress, all.progress);
        ring.scale.setScalar(s);
      }

      // Flick: a fast sideways index-tip swipe that starts on a proposed path rejects it.
      if (!h.tracked || h.pinching || this.flickCooldown > 0) continue;
      const speed = Math.hypot(h.velocity.x, h.velocity.z);
      if (speed < GESTURE.flickSpeed) continue;
      for (const r of this.game.robots) {
        if (r.state !== 'proposed') continue;
        const near =
          this.view.robotWorld(r.id, this.tmp).distanceTo(h.indexTip) < FLICK_RADIUS ||
          this.view.pathWorld(r).some((p) => p.distanceTo(h.indexTip) < FLICK_RADIUS);
        if (near) {
          this.rejectRobot(r.id);
          this.flickCooldown = GESTURE.flickCooldown;
          break;
        }
      }
    }
  }

  private makePalmRing() {
    const ring = new Mesh(new RingGeometry(0.03, 0.038, 40), new MeshBasicMaterial({ color: COLORS.stop, transparent: true, opacity: 0.8, depthTest: false }));
    ring.visible = false;
    ring.renderOrder = 10;
    this.world.scene.add(ring);
    return ring;
  }

  private updateTokens(dt: number) {
    const playing = this.game.status === 'playing';
    const held = this.game.permits.filter((p) => p.state === 'held').length;
    const canDispense = playing && this.game.permitsRemaining > 0 && held < 2;
    if (!this.ready && canDispense) this.spawnReadyToken();
    if (this.ready && !canDispense && !this.ready.entity.hasComponent(Grabbed)) {
      this.ready.dissolve = 0.001;
      this.ready = undefined;
    }

    for (const t of [...this.tokens]) {
      const o = t.entity.object3D!;
      if (t.flyTo) {
        t.flyT += dt / 0.25;
        const target = this.view.robotWorld(t.flyTo, this.tmp);
        o.position.lerp(target, Math.min(1, t.flyT));
        o.scale.setScalar(Math.max(0.01, 1 - t.flyT));
        if (t.flyT >= 1) this.removeToken(t);
        continue;
      }
      const permit = t.permitId ? this.game.permits.find((p) => p.id === t.permitId) : undefined;
      if (permit && (permit.state === 'expired' || !playing) && !t.dissolve) t.dissolve = 0.001;
      if (t.dissolve) {
        t.dissolve += dt / 0.4;
        o.scale.setScalar(Math.max(0.01, 1 - t.dissolve));
        o.position.y += dt * 0.05;
        if (t.dissolve >= 1) this.removeToken(t);
        continue;
      }
      // Countdown ring shrinks as the permit nears expiry; idle tokens spin gently.
      if (permit) {
        const left = Math.max(0, (permit.expiresAt - this.game.time) / this.game.level.permits.expirySec);
        t.model.ring.scale.setScalar(0.35 + 0.65 * left);
        t.model.ringMat.color.setHex(left < 0.3 ? COLORS.stop : 0xffffff);
      } else if (!t.entity.hasComponent(Grabbed)) {
        t.model.root.rotation.y += dt * 1.5;
      }
    }
  }

  private removeToken(t: Token) {
    this.tokens = this.tokens.filter((x) => x !== t);
    if (this.ready === t) this.ready = undefined;
    t.entity.dispose();
  }

  private updateButtons() {
    const playing = this.game.status === 'playing';
    for (const r of this.game.robots) {
      const panel = this.panels.get(r.id)!;
      const [x, y] = this.game.robotRenderPos(r);
      const base = this.view.cellToLocal(x, y, this.tmp);
      const proposed = playing && r.state === 'proposed';
      const moving = playing && r.state === 'executing';
      panel.grant.mesh.visible = proposed;
      panel.reject.mesh.visible = proposed;
      panel.stop.mesh.visible = moving;
      panel.grant.mesh.position.set(base.x - 0.014, 0.052, base.z);
      panel.reject.mesh.position.set(base.x + 0.014, 0.052, base.z);
      panel.stop.mesh.position.set(base.x, 0.052, base.z);
    }
    if (this.stopAllBtn) this.stopAllBtn.mesh.visible = playing;
    const ended = this.game.status !== 'playing';
    if (this.nextBtn) this.nextBtn.mesh.visible = ended && this.game.status === 'won';
    if (this.retryBtn) this.retryBtn.mesh.visible = ended;
  }

  private drawHud() {
    const g = this.game;
    const level = LEVELS[this.levelIndex]!;
    this.hud.draw({
      level: `${this.levelIndex + 1}. ${level.name}`,
      deliveries: g.stats.deliveries,
      target: level.win.deliveries,
      permits: g.permitsRemaining + g.permits.filter((p) => p.state === 'held').length,
      timeLeft: g.timeLeft,
      message: g.status === 'playing' ? this.coach.message : verdictLine(g.calibration()),
      calibration: g.status === 'playing' ? undefined : g.calibration(),
      stars: g.status === 'won' ? g.score().stars : 0,
      result: g.status === 'playing' ? undefined : g.status,
    });
  }
}

export { TILE };
