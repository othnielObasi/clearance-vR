import {
  type Entity,
  Grabbed,
  IBLTexture,
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
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { Game, type GameEvent } from '../core/game';
import { CREW, type CrewMemory, type CrewName, crewNameFor, emptyMemory } from '../core/crew';
import { generateDaily } from '../core/daily';
import { OvertimeDirector, overtimeLevel } from '../core/overtime';
import { DebugPanel } from '../xr/debug-panel';
import { makePreviewRoom } from '../xr/look';
import { DeskAnchor } from '../xr/anchor';
import type { LevelDef } from '../core/types';
import { LEVELS } from '../levels';
import { Sfx } from '../xr/audio';
import { BoardView } from '../xr/board-view';
import { GESTURE, HandTracker, HoldTimer } from '../xr/gestures';
import { Hud } from '../xr/hud';
import { COLORS, makeButton, makeToken, TILE } from '../xr/models';
import { Bubble } from '../xr/bubble';
import { Coach } from './coach';
import { fieldNote, greetingLine, proposalLine, reactionLine, verdictLine } from './voice';
import { crewMemory, loadProgress, overtimeBest, saveCrew, saveDaily, saveOvertime, saveResult, shareText } from './progress';

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
  mode: 'campaign' | 'daily' | 'overtime' = 'campaign';
  private director?: OvertimeDirector;
  private best = 0;
  /** How each crew member was treated this shift; saved to their memory when it ends. */
  private crewTally = new Map<CrewName, CrewMemory>();
  private crewSaved = false;
  private debug?: DebugPanel;
  private hitSource?: XRHitTestSource;
  private hitUntil = 0;
  /** Desk and room shown only in the desktop preview; passthrough replaces it in the headset. */
  private room = makePreviewRoom();
  /** Locks the board to the real desk (spatial anchor), and remembers the spot where supported. */
  private deskAnchor = new DeskAnchor();
  level!: LevelDef;
  private dailyLabel = '';
  private dailyKey = '';
  /** Called when a Daily Shift ends, with text the player can share. */
  onDailyResult?: (text: string) => void;
  /** Called when the player leaves the headset session. */
  onExitXR?: () => void;
  private wasInXR = false;

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
  private pauseBtn?: Button;
  private resumeBtn?: Button;
  private exitBtn?: Button;
  /** Floating pause button shown above an upturned palm (the Quest palm-menu pattern). */
  private palmBtn!: Button;
  private palmSide: 'left' | 'right' | null = null;
  private palmShownUntil = 0;
  private holdPalmUp = { left: new HoldTimer(), right: new HoldTimer() };
  /** Paused by the player (the headset sleeping pauses separately). */
  userPaused = false;
  private holdHand = { left: new HoldTimer(), right: new HoldTimer() };
  private holdBoth = new HoldTimer();
  private palmRings: Record<'left' | 'right', Mesh>;
  private flickCooldown = 0;
  private clock = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(private world: World) {
    // Soft image-based light from IWSDK's built-in room environment, plus a gentle key light.
    try {
      world.activeLevel.value?.addComponent(IBLTexture, { src: 'room', intensity: 0.55 });
    } catch {
      /* fall back to the lights below */
    }
    world.scene.add(this.room);
    const hemi = new HemisphereLight(0xffffff, 0x8a8070, 0.55);
    const sun = new DirectionalLight(0xfff4e6, 0.9);
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

    const palmMesh = makeButton('⏸', 0x5b6573, 0.03);
    const palmEntity = world.createTransformEntity(palmMesh, { persistent: true });
    palmEntity.addComponent(RayInteractable);
    palmEntity.addComponent(PokeInteractable);
    palmMesh.visible = false;
    this.palmBtn = { entity: palmEntity, mesh: palmMesh, action: () => this.togglePause(), pressedAt: -1 };

    this.levelIndex = Math.min(loadProgress().unlocked, LEVELS.length - 1);
    this.loadLevel(this.levelIndex);
  }

  // ------------------------------------------------------------------ level lifecycle

  loadLevel(i: number) {
    this.mode = 'campaign';
    this.levelIndex = (i + LEVELS.length) % LEVELS.length;
    this.start(LEVELS[this.levelIndex]!);
  }

  /** Today's shared, seeded level. */
  loadDaily() {
    const d = generateDaily();
    this.mode = 'daily';
    this.dailyLabel = d.dateLabel;
    this.dailyKey = d.dateKey;
    this.start(d.level);
  }

  /** Endless shift: keep going until the first safety mistake. */
  loadOvertime() {
    this.mode = 'overtime';
    this.director = new OvertimeDirector(Math.floor(Math.random() * 1e6));
    this.best = overtimeBest();
    this.start(overtimeLevel());
  }

  togglePause() {
    if (this.game.status !== 'playing') return;
    this.userPaused = !this.userPaused;
    this.palmShownUntil = 0;
    this.coach.say(this.userPaused ? '' : 'Back on shift.', 1.5);
    this.sfx.pick();
  }

  private start(level: LevelDef) {
    this.userPaused = false;
    this.flushCrew();
    this.clearLevel();
    if (this.mode !== 'overtime') this.director = undefined;
    this.level = level;
    this.game = new Game(level);
    this.view = new BoardView(this.game);
    this.coach = new Coach(level.id);
    this.boardEntity = this.world.createTransformEntity(this.view.root);

    const nearZ = this.view.depth / 2;
    const farZ = -this.view.depth / 2;
    const leftX = -this.view.width / 2;

    // HUD floats above the far edge, tilted toward the player.
    this.hud.mesh.position.set(0, 0.145, farZ - 0.02);
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

    this.pauseBtn = this.addButton('⏸', 0x5b6573, () => this.togglePause(), 0.026);
    this.pauseBtn.mesh.position.set(-leftX + 0.045, 0.02, nearZ + 0.004);
    this.resumeBtn = this.addButton('▶', COLORS.go, () => this.togglePause(), 0.04);
    this.resumeBtn.mesh.position.set(0.05, 0.05, farZ - 0.01);
    this.exitBtn = this.addButton('⏏', 0x5b6573, () => {
      this.userPaused = false;
      this.world.exitXR();
    }, 0.032);
    this.exitBtn.mesh.position.set(0, 0.05, farZ - 0.01);

    this.nextBtn = this.addButton('▶', COLORS.go, () => this.loadLevel(this.levelIndex + 1), 0.04);
    this.nextBtn.mesh.position.set(0.05, 0.05, farZ - 0.01);
    this.retryBtn = this.addButton('↻', 0x5b6573, () => (this.mode === 'daily' ? this.loadDaily() : this.loadLevel(this.levelIndex)), 0.04);
    this.retryBtn.mesh.position.set(-0.05, 0.05, farZ - 0.01);

    this.game.robots.forEach((r) => this.ensureRobotUI(r.id));
    // Bolt remembers being let through: he starts bold.
    for (const r of this.game.robots) {
      const name = crewNameFor(r.def, this.game.robots.indexOf(r));
      const mem = crewMemory(name);
      if (r.def.traits?.shortcutBias && mem.riskyApproved > mem.caught) r.mood = 'bold';
      this.bubbles.get(r.id)?.react(greetingLine(name, mem), 0.4, 3.2);
    }
    if (new URLSearchParams(location.search).has('debug')) {
      this.debug ??= new DebugPanel();
      this.debug.mesh.position.set(this.view.width / 2 + 0.1, 0.12, -this.view.depth / 2);
      this.debug.mesh.rotation.y = -0.4;
      this.view.root.add(this.debug.mesh);
    }
    this.placeBoard();
  }

  /** Create bubble and poke buttons for a robot (also for robots that join mid-shift). */
  private ensureRobotUI(id: string) {
    if (this.panels.has(id)) return;
    const r = this.game.robot(id)!;
    const bubble = new Bubble(COLORS.robot[CREW[crewNameFor(r.def, this.game.robots.indexOf(r))].color]!);
    this.view.content.add(bubble.sprite);
    this.bubbles.set(id, bubble);
    this.panels.set(id, {
      grant: this.addButton('✓', COLORS.go, () => this.grantByButton(id)),
      reject: this.addButton('✗', 0xff8a3d, () => this.rejectRobot(id)),
      stop: this.addButton('■', COLORS.stop, () => this.stopRobot(id)),
    });
  }

  private crewOf(robotId: string): CrewName {
    const r = this.game.robot(robotId)!;
    return crewNameFor(r.def, this.game.robots.indexOf(r));
  }

  /** World position of a robot, for spatial sound. */
  private posOf(robotId: string) {
    return this.view.robotWorld(robotId, new Vector3());
  }

  private tally(robotId: string): CrewMemory {
    const r = this.game.robot(robotId)!;
    const name = crewNameFor(r.def, this.game.robots.indexOf(r));
    let t = this.crewTally.get(name);
    if (!t) this.crewTally.set(name, (t = emptyMemory()));
    return t;
  }

  /** Save how the crew was treated this shift (once per shift). */
  private flushCrew() {
    if (!this.crewSaved && this.crewTally.size) saveCrew(this.crewTally);
    this.crewTally = new Map();
    this.crewSaved = false;
  }

  private clearLevel() {
    if (this.debug) this.view?.root.remove(this.debug.mesh);
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
    const session = this.world.session;
    if (session) void this.deskAnchor.restore(session);
    void this.startDeskSnap();
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
    const at = this.posOf(id);
    if (this.game.reject(id)) this.sfx.reject(at);
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
    if (entity === this.handle) {
      this.deskAnchor.clear();
      return;
    }
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
      if (this.world.session) this.deskAnchor.place(this.handle.object3D!.position, this.boardYaw);
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
    const b = entity === this.palmBtn.entity ? this.palmBtn : this.buttons.get(entity.index);
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
    if (!inXR && this.placedInXR) {
      this.placedInXR = false;
      this.deskAnchor = new DeskAnchor(); // anchors belong to the ended session; the saved spot stays
    }
    if (inXR) this.followAnchor(frame, ref);
    if (this.wasInXR && !inXR) this.onExitXR?.();
    this.wasInXR = inXR;
    // Pause cleanly when the headset sleeps or a system menu opens.
    const paused = this.userPaused || (inXR && this.world.visibilityState.value !== VisibilityState.Visible);

    this.placeBoard();
    this.room.visible = !inXR;
    if (!inXR) {
      this.room.position.set(this.view.root.position.x, this.view.root.position.y - 0.0125, this.view.root.position.z);
      this.room.rotation.y = this.boardYaw;
    }
    this.tracker.update(frame, ref, this.world.player.matrixWorld as Matrix4, dt);

    this.view.hands = (['left', 'right'] as const).filter((s) => this.tracker.hands[s].tracked).map((s) => this.tracker.hands[s].indexTip);
    this.updatePalmMenu(dt);
    if (!paused) {
      this.handleGestures(dt);
      this.updateSlowMotion(dt);
      if (this.director) {
        this.director.step(this.game);
        for (const a of this.director.announcements.splice(0)) this.coach.say(a, 3);
      }
      this.game.update(dt * this.timeScale);
      this.updateDeskSnap();
    }
    for (const e of this.game.drainEvents()) this.onGameEvent(e);
    this.coach.update(dt);
    this.view.update(dt, this.clock);
    this.updateTokens(dt);
    this.updateButtons();
    this.updateBubbles();
    this.drawHud();
    this.updateDebug(dt);
    this.updateAudio(paused);
  }

  /** Listener follows the head; music builds with how much is happening. */
  private updateAudio(paused: boolean) {
    const head = this.world.player.head;
    head.updateMatrixWorld();
    const pos = head.getWorldPosition(this.tmp);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
    const up = new Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
    this.sfx.setListener(pos, fwd, up);
    const g = this.game;
    let i = 0.2;
    if (g.status === 'playing') {
      i += Math.min(0.45, g.robots.filter((r) => r.state === 'proposed').length * 0.15);
      if (Number.isFinite(g.timeLeft) && g.timeLeft < 20) i += 0.3;
      if (this.timeScale < 0.9) i += 0.3;
      if (this.mode === 'overtime') i += Math.min(0.3, g.stats.deliveries * 0.02);
    } else i = 0.12;
    this.sfx.setIntensity(i);
    this.sfx.setPaused(paused);
  }

  private updateDebug(dt: number) {
    if (!this.debug) return;
    const f = (v: number) => v.toFixed(3);
    const lines = [`fps ${(1 / Math.max(dt, 1e-3)).toFixed(0)}  draws ${this.world.renderer.info.render.calls}  tris ${this.world.renderer.info.render.triangles}`];
    for (const side of ['left', 'right'] as const) {
      const h = this.tracker.hands[side];
      if (!h.tracked) {
        lines.push(`${side}: not tracked`);
        continue;
      }
      const pinch = h.thumbTip.distanceTo(h.indexTip);
      let bestDot = -1;
      for (const r of this.game.robots) {
        const d = this.view.robotWorld(r.id, this.tmp).sub(h.palm).normalize().dot(h.palmNormal);
        bestDot = Math.max(bestDot, d);
      }
      lines.push(`${side}: pinch ${f(pinch)} ${h.pinching ? 'PINCH' : ''}${h.open ? 'OPEN' : ''}`);
      lines.push(`  palm·robot ${f(bestDot)} (need ${f(GESTURE.palmConeCos)})`);
      lines.push(`  palm up ${f(h.palmNormal.y)}  flick ${f(Math.hypot(h.velocity.x, h.velocity.z))} m/s`);
    }
    lines.push(`permits ${this.game.permitsRemaining}  robots ${this.game.robots.map((r) => r.state[0]).join('')}`);
    this.debug.update(dt, lines);
  }

  /** Look for the real desk just after entering XR and rest the board on it. */
  private async startDeskSnap() {
    const session = this.world.session;
    if (!session || !('XRRay' in window)) return this.anchorHere();
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource?.({
        space: viewer,
        offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -0.75, z: -0.66, w: 0 }),
      });
      this.hitUntil = this.clock + 3;
      if (!this.hitSource) this.anchorHere();
    } catch {
      this.hitSource = undefined; // hit-test not granted: keep the head-relative placement
      this.anchorHere();
    }
  }

  /** The board follows its spatial anchor unless the player is moving it by hand. */
  private followAnchor(frame: XRFrame | null, ref: XRReferenceSpace | null) {
    const a = this.deskAnchor.update(frame, ref, this.world.player.matrixWorld as Matrix4);
    if (!a || this.handle.hasComponent(Grabbed)) return;
    if (this.deskAnchor.restored && this.hitSource) {
      // Restored last session's spot: no need to search for the desk again.
      this.hitSource.cancel();
      this.hitSource = undefined;
      this.coach.say('Board is where you left it.', 2.5);
    }
    this.handle.object3D!.position.copy(a.pos);
    this.boardYaw = a.yaw;
  }

  /** Anchor the board where it is now (after the desk search finishes). */
  private anchorHere() {
    if (this.world.session && !this.deskAnchor.tracking) this.deskAnchor.place(this.handle.object3D!.position, this.boardYaw);
  }

  private updateDeskSnap() {
    if (!this.hitSource) return;
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    if (this.clock > this.hitUntil || !frame || !ref) {
      this.hitSource.cancel();
      this.hitSource = undefined;
      this.anchorHere();
      return;
    }
    const hit = frame.getHitTestResults(this.hitSource)[0]?.getPose(ref);
    if (!hit) return;
    const p = new Vector3(hit.transform.position.x, hit.transform.position.y, hit.transform.position.z).applyMatrix4(this.world.player.matrixWorld);
    const head = this.world.player.head.getWorldPosition(new Vector3());
    const below = head.y - p.y;
    const flat = Math.hypot(p.x - head.x, p.z - head.z);
    if (below < 0.15 || below > 1.0 || flat > 0.9) return; // not a plausible desk
    // Board centre on the hit point; handle at the near edge, toward the player.
    const toPlayer = new Vector3(head.x - p.x, 0, head.z - p.z).normalize();
    const off = this.view.depth / 2 + 0.03;
    this.handle.object3D!.position.set(p.x + toPlayer.x * off, p.y + 0.012, p.z + toPlayer.z * off);
    this.boardYaw = Math.atan2(toPlayer.x, toPlayer.z);
    this.coach.say('Board placed on your desk.', 2.5);
    this.hitSource.cancel();
    this.hitSource = undefined;
    this.anchorHere();
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
      // Stagger heights so neighbouring robots' bubbles don't overlap.
      const idx = this.game.robots.indexOf(r);
      this.view.cellToLocal(x, y, b.sprite.position).setY(0.08 + (idx % 3) * 0.016);
      b.update(this.clock, playing && r.state === 'proposed' ? proposalLine(r) : null, r.mood);
    }
  }

  private onGameEvent(e: GameEvent) {
    this.coach.onEvent(e);
    if ('robot' in e) {
      this.ensureRobotUI(e.robot);
      const line = reactionLine(e);
      if (line) this.bubbles.get(e.robot)?.react(line, this.clock);
      const t = this.tally(e.robot);
      if (e.type === 'rejected' && e.trap) t.caught++;
      if (e.type === 'granted' && e.trap) t.riskyApproved++;
      if (e.type === 'delivered') t.delivered++;
      if (e.type === 'stopped' && e.wasMoving) e.needed ? t.saves++ : t.needlessStops++;
      if (e.type === 'stopped' && !e.wasMoving && e.needed) t.caught++;
    }
    if (e.type === 'ended') {
      if (this.mode === 'overtime') this.best = saveOvertime(this.game.stats.deliveries);
      this.flushCrew();
      this.crewSaved = true;
    }
    switch (e.type) {
      case 'proposed':
        this.sfx.voice(this.crewOf(e.robot), e.mood, this.posOf(e.robot));
        break;
      case 'granted':
        this.sfx.grant(this.posOf(e.robot));
        this.view.pop(e.robot);
        break;
      case 'rejected':
        this.sfx.voice(this.crewOf(e.robot), e.trap ? 'caught' : 'indignant', this.posOf(e.robot));
        break;
      case 'stopped':
        if (e.wasMoving) {
          this.view.brake(e.robot);
          this.view.puff(e.robot);
          this.sfx.brake(this.posOf(e.robot));
          this.sfx.voice(this.crewOf(e.robot), e.needed ? 'thanks' : 'indignant', this.posOf(e.robot));
        }
        break;
      case 'refused':
        this.sfx.refuse();
        break;
      case 'delivered': {
        this.sfx.deliver(this.posOf(e.robot));
        this.sfx.voice(this.crewOf(e.robot), 'happy', this.posOf(e.robot));
        const t = this.game.tasks.find((x) => x.id === e.task);
        if (t) this.view.sparkle(t.to);
        break;
      }
      case 'incident': {
        this.sfx.incident(this.posOf(e.robot));
        this.sfx.voice(this.crewOf(e.robot), 'oops', this.posOf(e.robot));
        this.view.flash(e.robot);
        this.view.puff(e.robot, 0xff6b3d);
        const r = this.game.robot(e.robot);
        if (r) this.view.bounceWorkerNear(r.pos);
        break;
      }
      case 'permitExpired':
        this.sfx.expire();
        break;
      case 'ended': {
        if (e.status === 'won') this.sfx.win();
        else this.sfx.lose();
        if (this.mode === 'campaign' && e.status === 'won') saveResult(this.levelIndex, this.level.id, this.game.score().stars, LEVELS.length);
        if (this.mode === 'daily') {
          const score = this.game.score();
          const cal = this.game.calibration();
          const streak = saveDaily(this.dailyKey, e.status === 'won', score.stars, cal.score);
          this.onDailyResult?.(shareText(this.dailyLabel, e.status === 'won', score.stars, this.game.stats.deliveries, this.level.win.deliveries, cal, streak));
        }
        break;
      }
    }
  }

  /** One upturned open palm (not both) for a moment shows a pause button floating above it. */
  private updatePalmMenu(dt: number) {
    const { left, right } = this.tracker.hands;
    const up = (h: typeof left) => h.tracked && h.open && h.palmNormal.y > GESTURE.palmUpY;
    const both = up(left) && up(right);
    for (const h of [left, right]) {
      const hold = this.holdPalmUp[h.side].step(up(h) && !both, 'menu', dt, 0.4);
      if (hold.fire && this.game.status === 'playing') {
        this.palmSide = h.side;
        this.palmShownUntil = this.clock + 4;
      }
    }
    const side = this.palmSide;
    const show = !!side && this.clock < this.palmShownUntil && this.tracker.hands[side].tracked && !both;
    this.palmBtn.mesh.visible = show;
    if (show && side) {
      const h = this.tracker.hands[side];
      if (up(h)) this.palmShownUntil = Math.max(this.palmShownUntil, this.clock + 0.6);
      const m = this.palmBtn.mesh;
      m.position.copy(h.palm).addScaledVector(h.palmNormal, 0.07);
      m.lookAt(this.world.player.head.getWorldPosition(this.tmp));
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
      this.ensureRobotUI(r.id);
      const panel = this.panels.get(r.id)!;
      const [x, y] = this.game.robotRenderPos(r);
      const base = this.view.cellToLocal(x, y, this.tmp);
      // In the headset, poke buttons appear only when a hand comes near, to keep the table clean.
      // On desktop (no tracked hands) they are always shown.
      const hands = this.view.hands;
      const near =
        hands.length === 0 ||
        hands.some((h) => this.view.robotWorld(r.id, this.tmp2).distanceTo(h) < 0.14);
      const proposed = playing && r.state === 'proposed' && near;
      const moving = playing && r.state === 'executing' && near;
      panel.grant.mesh.visible = proposed;
      panel.reject.mesh.visible = proposed;
      panel.stop.mesh.visible = moving;
      panel.grant.mesh.position.set(base.x - 0.014, 0.052, base.z);
      panel.reject.mesh.position.set(base.x + 0.014, 0.052, base.z);
      panel.stop.mesh.position.set(base.x, 0.052, base.z);
    }
    const p = this.userPaused;
    if (p) for (const panel of this.panels.values()) panel.grant.mesh.visible = panel.reject.mesh.visible = panel.stop.mesh.visible = false;
    if (this.stopAllBtn) this.stopAllBtn.mesh.visible = playing && !p;
    if (this.pauseBtn) this.pauseBtn.mesh.visible = playing && !p;
    if (this.resumeBtn) this.resumeBtn.mesh.visible = playing && p;
    if (this.exitBtn) this.exitBtn.mesh.visible = p && !!this.world.session;
    const ended = this.game.status !== 'playing';
    if (this.nextBtn) this.nextBtn.mesh.visible = ended && this.game.status === 'won' && this.mode === 'campaign';
    if (this.retryBtn && this.mode === 'overtime') this.retryBtn.action = () => this.loadOvertime();
    if (this.retryBtn) this.retryBtn.mesh.visible = ended || p;
  }

  private drawHud() {
    const g = this.game;
    const level = this.level;
    this.hud.draw({
      level: this.mode === 'campaign' ? `${this.levelIndex + 1}. ${level.name}` : level.name,
      best: this.mode === 'overtime' ? Math.max(this.best, g.stats.deliveries) : undefined,
      note: g.status === 'playing' ? undefined : fieldNote(level.id),
      deliveries: g.stats.deliveries,
      target: level.win.deliveries,
      permits: g.permitsRemaining + g.permits.filter((p) => p.state === 'held').length,
      timeLeft: g.timeLeft,
      message: g.status !== 'playing' ? verdictLine(g.calibration()) : this.userPaused ? 'Paused. ▶ resume · ↻ restart' : this.coach.message,
      calibration: g.status === 'playing' ? undefined : g.calibration(),
      stars: g.status === 'won' ? g.score().stars : 0,
      result: g.status === 'playing' ? undefined : g.status,
    });
  }
}

export { TILE };
