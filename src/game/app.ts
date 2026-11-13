import {
  DepthOccludable,
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
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { Game, type GameEvent } from '../core/game';
import { CREW, type CrewMemory, type CrewName, crewNameFor, emptyMemory } from '../core/crew';
import { generateDaily } from '../core/daily';
import { OvertimeDirector, overtimeLevel } from '../core/overtime';
import { DebugPanel } from '../xr/debug-panel';
import { makePreviewRoom, setRackPeek } from '../xr/look';
import { DeskAnchor } from '../xr/anchor';
import { type BoardFrame, ObjectScanner } from '../xr/desk-scan';
import { findTable } from '../xr/table';
import type { Cell, LevelDef } from '../core/types';
import { LEVELS } from '../levels';
import { Sfx } from '../xr/audio';
import { BoardView } from '../xr/board-view';
import { applyAssist, GESTURE, HandTracker, HoldTimer } from '../xr/gestures';
import { Hud } from '../xr/hud';
import { COLORS, makeButton, makeHalo, makeLabelButton, makeToken, TILE } from '../xr/models';
import { Bubble } from '../xr/bubble';
import { Coach } from './coach';
import { fieldNote, greetingLine, proposalLine, reactionLine, verdictLine } from './voice';
import { CoopLink } from '../net/coop';
import { applySnapshot, type CoopMsg, snapshot } from '../net/snapshot';
import { validateLevel } from '../levels/validate';
import { type CrewLines, fetchCrewLines, fetchDebrief, pickLine, slotFor } from '../net/server';
import { crewMemory, loadAssist, loadProgress, overtimeBest, saveAssist, saveCrew, saveDaily, saveOvertime, saveResult, shareText } from './progress';

/** End-of-shift and pause menu: four pills in one row just above the status card. */
const MENU_Y = 0.222;
const MENU_PILL_W = 0.07;
const menuX = (i: number) => (i - 1.5) * 0.078;

/** Robot buttons grow by this much in assist mode. */
const ASSIST_SCALE = 1.4;

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
  /** A gold permit: standing clearance. */
  gold?: boolean;
  /** Flying into a robot after a successful grant. */
  flyTo?: string;
  flyT: number;
  dissolve: number;
}

interface RobotPanel {
  grant: Button;
  reject: Button;
  stop: Button;
  /** Hand over standing clearance (shown only when a gold permit is available). */
  gold: Button;
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
  mode: 'campaign' | 'daily' | 'overtime' | 'coop' = 'campaign';
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
  /** Real objects standing on the board, seen by the headset's depth sensor. */
  private scanner: ObjectScanner;
  /** Searching for the real table (plane detection, then hit-test) until this time. */
  private deskSearchUntil = 0;
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
  private goldReady?: Token;
  /** Where an earned gold permit waits, beside the dispenser. */
  private goldPad = new Group();
  private halos = new Map<string, ReturnType<typeof makeHalo>>();
  private dispenser = new Group();
  private stopAllBtn?: Button;
  private nextBtn?: Button;
  private retryBtn?: Button;
  private pauseBtn?: Button;
  private peekBtn?: Button;
  /** See-through racking, for players who can't lean (accessibility). */
  peek = false;
  private handHold = 0;
  /** Hands currently resting flat on the board act as a wall, never as a stop gesture. */
  private flatOnBoard = { left: false, right: false };
  /** Desktop/testing: pretend a flat hand rests over this cell. */
  debugHand: [number, number] | null = null;
  private resumeBtn?: Button;
  private exitBtn?: Button;
  /** Switch mode without leaving the headset: shown when a shift ends or is paused. */
  private modeBtns: Button[] = [];
  private assistBtns!: { on: Button; off: Button };
  /** Accessibility: relaxed gestures, bigger robot buttons that are always shown. */
  assist = loadAssist();
  /** AI lines for this shift's crew (null until they arrive, or when offline). */
  private aiLines: CrewLines | null = null;
  /** The shift supervisor's AI debrief for the shift that just ended. */
  private debrief: string | null = null;
  /** Counts shifts, so a late answer for an old shift is ignored. */
  private shiftSeq = 0;
  private shiftStartedAt = 0;
  /** Two-player co-op link, when playing together (this player is the host or the guest). */
  private coop?: CoopLink;
  private coopSnapAt = 0;
  private coopHandsAt = 0;
  private coopWallsAt = 0;
  /** Host: game events since the last snapshot, for the partner's sounds and speech. */
  private outEvents: GameEvent[] = [];
  /** Walls from the other player's hands and objects (host: as sent; guest: everyone's, from the host). */
  private partnerWalls: Cell[] = [];
  private partnerWallsAt = -9;
  /** This player's own hand and object walls. */
  private myWalls: Cell[] = [];
  /** Host: all walls applied this frame (both players). */
  private currentWalls: Cell[] = [];
  /** Guest: game time of the last snapshot. */
  private snapTime = 0;
  private ghostHands: Mesh[] = [];
  private ghostTargets: Vector3[] = [];
  private ghostAt = -9;
  /** Guest: connected, waiting for the host to start a shift. */
  coopWaiting = false;
  /** Co-op ended (partner or host left, or the connection dropped). */
  onCoopEnd?: (why: string) => void;
  /** Called when assist mode is switched from inside the game. */
  onAssistChange?: (on: boolean) => void;
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
    applyAssist(this.assist);
    this.scanner = new ObjectScanner(world);
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
    if (this.isGuest) return this.coopAct('pause');
    this.userPaused = !this.userPaused;
    this.palmShownUntil = 0;
    this.coach.say(this.userPaused ? '' : 'Back on shift.', 1.5);
    this.sfx.pick();
  }

  private start(level: LevelDef) {
    this.userPaused = false;
    this.scanner?.reset();
    this.flushCrew();
    this.clearLevel();
    if (this.mode !== 'overtime') this.director = undefined;
    this.level = level;
    this.game = new Game(level);
    this.view = new BoardView(this.game);
    this.coach = new Coach(level.id);
    this.boardEntity = this.world.createTransformEntity(this.view.root);
    // Real hands and objects hide the robots behind them (headset testing only, for now).
    if (new URLSearchParams(location.search).has('occlusion')) this.boardEntity.addComponent(DepthOccludable);

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
    // Gold pad: a small plinth behind the dispenser, lit only when a gold permit waits on it.
    this.goldPad = new Group();
    const plinth = new Mesh(new CylinderGeometry(0.018, 0.02, 0.012, 24), new MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 }));
    plinth.position.y = 0.006;
    const goldGlow = new Mesh(new CircleGeometry(0.015, 24), new MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.25 }));
    goldGlow.rotation.x = -Math.PI / 2;
    goldGlow.position.y = 0.0125;
    this.goldPad.add(plinth, goldGlow);
    this.goldPad.position.set(0, 0, -0.065);
    this.goldPad.visible = !!level.permits.gold;
    this.dispenser.add(this.goldPad);
    this.dispenser.position.set(leftX - 0.045, 0, nearZ - 0.03);
    this.view.root.add(this.dispenser);

    this.stopAllBtn = this.addButton('■', COLORS.stop, () => this.stopAll(), 0.026);
    this.stopAllBtn.mesh.position.set(leftX - 0.045, 0.02, nearZ + 0.004);

    this.pauseBtn = this.addButton('⏸', 0x5b6573, () => this.togglePause(), 0.026);
    this.pauseBtn.mesh.position.set(-leftX + 0.045, 0.02, nearZ + 0.004);
    if ((level.grid.tall ?? []).length) {
      this.peekBtn = this.addButton('👁', 0x5b6573, () => {
        this.peek = !this.peek;
        setRackPeek(this.peek);
      }, 0.026);
      this.peekBtn.mesh.position.set(-leftX + 0.045, 0.02, nearZ - 0.04);
    } else this.peekBtn = undefined;
    setRackPeek(this.peek);
    this.resumeBtn = this.addButton('▶', COLORS.go, () => this.togglePause(), 0.04);
    this.resumeBtn.mesh.position.set(0.05, 0.068, farZ - 0.004);
    this.exitBtn = this.addButton('⏏', 0x5b6573, () => {
      this.userPaused = false;
      this.world.exitXR();
    }, 0.032);
    this.exitBtn.mesh.position.set(0, 0.068, farZ - 0.004);

    this.nextBtn = this.addButton('▶', COLORS.go, () => this.loadLevel(this.levelIndex + 1), 0.04);
    this.nextBtn.mesh.position.set(0.05, 0.068, farZ - 0.004);
    this.retryBtn = this.addButton('↻', 0x5b6573, () => (this.mode === 'daily' ? this.loadDaily() : this.loadLevel(this.levelIndex)), 0.04);
    this.retryBtn.mesh.position.set(-0.05, 0.068, farZ - 0.004);

    // Mode row above the status card. The current mode is shown in grey; pressing it restarts.
    const modes: [string, typeof this.mode, () => void][] = [
      ['Campaign', 'campaign', () => this.loadLevel(this.campaignStart())],
      ['Daily', 'daily', () => this.loadDaily()],
      ['Overtime', 'overtime', () => this.loadOvertime()],
    ];
    this.modeBtns = modes.map(([label, mode, action], i) => {
      const b = this.addLabelButton(label, mode === this.mode ? 0x5b6573 : 0x2f6f9f, action);
      // One compact row just above the status card, so it stays in view on narrow-FoV devices.
      b.mesh.position.set(menuX(i), MENU_Y, farZ - 0.034);
      b.mesh.rotation.x = -0.25;
      return b;
    });
    this.makeAssistButtons();

    this.game.robots.forEach((r) => this.ensureRobotUI(r.id));
    // Bolt remembers being let through: he starts bold.
    for (const r of this.game.robots) {
      const name = crewNameFor(r.def, this.game.robots.indexOf(r));
      const mem = crewMemory(name);
      if (r.def.traits?.shortcutBias && mem.riskyApproved > mem.caught) r.mood = 'bold';
      this.bubbles.get(r.id)?.react(greetingLine(name, mem), 0.4, 3.2);
    }
    if (!this.isGuest) this.requestCrewLines(level);
    // Ghost hands: where the other player's hands are, drawn over the board.
    this.ghostHands = [0.011, 0.006, 0.011, 0.006].map((r) => {
      const m = new Mesh(new SphereGeometry(r, 14, 10), new MeshBasicMaterial({ color: 0x7fb8ff, transparent: true, opacity: 0.6, depthWrite: false }));
      m.visible = false;
      this.view.content.add(m);
      return m;
    });
    if (this.coop?.role === 'host') this.sendStart();
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
      gold: this.addButton('★', COLORS.gold, () => this.delegateByButton(id)),
    });
    const halo = makeHalo();
    halo.root.visible = false;
    this.view.content.add(halo.root);
    this.halos.set(id, halo);
  }

  // ------------------------------------------------------------------ co-op

  get isGuest() {
    return this.coop?.role === 'guest';
  }

  /** Is a partner connected? */
  get coopActive() {
    return !!this.coop?.partner;
  }

  /** Play together: as host this game runs the shift; as guest it mirrors the host's. */
  attachCoop(link: CoopLink) {
    this.coop = link;
    link.onMessage = (m) => this.onCoopMessage(m);
    link.onChange = () => {
      if (link.closed || (!link.partner && link.role === 'guest')) {
        const why = link.role === 'guest' ? 'The host left the co-op shift.' : 'The co-op connection closed.';
        this.leaveCoop();
        this.onCoopEnd?.(why);
        return;
      }
      if (link.partner) {
        this.coach.say('Your partner joined. Their hands show in blue.', 4);
        this.sendStart();
      } else this.coach.say('Your partner left. Carry on solo.', 4);
    };
    if (link.role === 'guest') {
      this.coopWaiting = true;
      this.userPaused = true;
    }
  }

  leaveCoop() {
    const wasGuest = this.isGuest;
    const link = this.coop;
    this.coop = undefined;
    if (link && !link.closed) link.close();
    this.coopWaiting = false;
    this.partnerWalls = [];
    for (const m of this.ghostHands) m.visible = false;
    if (wasGuest) {
      // The mirrored shift belongs to the host: go back to this player's own campaign.
      this.loadLevel(this.campaignStart());
      if (this.world.session) this.world.exitXR();
    }
  }

  private sendStart() {
    if (this.coop?.role !== 'host' || !this.coop.partner) return;
    const label = this.mode === 'campaign' ? `${this.levelIndex + 1}. ${this.level.name}` : this.level.name;
    this.coop.send({ t: 'start', level: this.level, mode: this.mode, label });
    this.coopSnapAt = 0;
  }

  private onCoopMessage(m: CoopMsg) {
    if (this.isGuest) {
      if (m.t === 'start') {
        try {
          const level = validateLevel(m.level as LevelDef);
          this.coopWaiting = false;
          this.mode = 'coop';
          this.start(level);
          this.coach.say("Co-op shift. Your partner's hands show in blue.", 4);
        } catch {
          /* malformed level from the other side: ignore */
        }
      } else if (m.t === 'snap' && !this.coopWaiting) {
        applySnapshot(this.game, m.s);
        this.snapTime = m.s.time;
        this.partnerWalls = m.s.walls;
        this.userPaused = m.s.paused;
        for (const e of m.ev) this.onGameEvent(e);
      } else if (m.t === 'hands') this.setGhostHands(m.h);
      return;
    }
    // Host: the partner's actions go through the same paths as this player's buttons.
    if (m.t === 'act') {
      const id = m.robot && this.game.robot(m.robot) ? m.robot : undefined;
      if (m.a === 'grant' && id) this.grantByButton(id);
      else if (m.a === 'reject' && id) this.rejectRobot(id);
      else if (m.a === 'stop' && id) this.stopRobot(id);
      else if (m.a === 'delegate' && id) this.delegateByButton(id);
      else if (m.a === 'stopAll') this.stopAll();
      else if (m.a === 'pause') this.togglePause();
    } else if (m.t === 'walls') {
      this.partnerWalls = (Array.isArray(m.cells) ? m.cells : []).slice(0, 48);
      this.partnerWallsAt = this.clock;
    } else if (m.t === 'hands') this.setGhostHands(m.h);
  }

  /** Guest: send an action to the host instead of changing the mirror. */
  private coopAct(a: 'grant' | 'reject' | 'stop' | 'stopAll' | 'delegate' | 'pause', robot?: string) {
    this.coop?.send({ t: 'act', a, robot });
  }

  private setGhostHands(h: [number, number, number][]) {
    if (!Array.isArray(h)) return;
    this.ghostAt = this.clock;
    this.ghostHands.forEach((m, i) => {
      const p = h[i];
      if (!p) {
        m.visible = false;
        return;
      }
      const target = (this.ghostTargets[i] ??= new Vector3());
      target.set(p[0], p[1], p[2]);
      if (!m.visible) m.position.copy(target);
      m.visible = true;
    });
  }

  /** Per frame: send snapshots (host), walls (guest) and hands (both); smooth the ghost hands. */
  private updateCoop(dt: number) {
    const link = this.coop;
    if (link?.partner) {
      if (link.role === 'host' && this.clock >= this.coopSnapAt) {
        this.coopSnapAt = this.clock + 0.1;
        link.send({ t: 'snap', s: snapshot(this.game, this.currentWalls, this.userPaused), ev: this.outEvents.splice(0) });
      }
      if (link.role === 'guest' && this.clock >= this.coopWallsAt) {
        this.coopWallsAt = this.clock + 0.2;
        link.send({ t: 'walls', cells: this.myWalls });
      }
      if (this.clock >= this.coopHandsAt) {
        this.coopHandsAt = this.clock + 1 / 15;
        const pts: [number, number, number][] = [];
        for (const h of [this.tracker.hands.left, this.tracker.hands.right]) {
          if (!h.tracked) continue;
          for (const p of [h.palm, h.indexTip]) {
            const l = this.view.content.worldToLocal(this.tmp.copy(p));
            pts.push([Math.round(l.x * 1000) / 1000, Math.round(l.y * 1000) / 1000, Math.round(l.z * 1000) / 1000]);
          }
        }
        link.send({ t: 'hands', h: pts });
      }
    }
    if (this.outEvents.length > 200) this.outEvents.splice(0, this.outEvents.length - 200);
    const stale = this.clock - this.ghostAt > 0.6;
    this.ghostHands.forEach((m, i) => {
      if (stale) m.visible = false;
      const t = this.ghostTargets[i];
      if (m.visible && t) m.position.lerp(t, Math.min(1, dt * 18));
    });
  }

  /** Ask for fresh AI lines for this shift's crew. Play never waits for them. */
  private requestCrewLines(level: LevelDef) {
    const shift = ++this.shiftSeq;
    this.aiLines = null;
    this.debrief = null;
    this.shiftStartedAt = this.clock;
    // Overtime can bring the whole crew on shift, so ask for all of them.
    const names = new Set<CrewName>(this.mode === 'overtime' ? (Object.keys(CREW) as CrewName[]) : this.game.robots.map((r, i) => crewNameFor(r.def, i)));
    const crew = [...names].map((name) => ({ name, memory: crewMemory(name) }));
    void fetchCrewLines(level.name, crew).then((lines) => {
      if (!lines || shift !== this.shiftSeq) return;
      this.aiLines = lines;
      // Arrived while the crew is still saying hello: swap in the fresh greeting.
      if (this.clock - this.shiftStartedAt < 2.5)
        for (const r of this.game.robots) {
          const g = pickLine(lines, this.crewOf(r.id), 'greeting');
          if (g) this.bubbles.get(r.id)?.react(g, this.clock, 3.2);
        }
    });
  }

  /** Ask the shift supervisor (AI) for a short debrief; the HUD shows it when it arrives. */
  private requestDebrief(status: 'won' | 'lost', reason?: string) {
    const shift = this.shiftSeq;
    const cal = this.game.calibration();
    const crew = [...this.crewTally.entries()].map(([name, t]) => ({ name, ...t }));
    void fetchDebrief({
      level: this.level.name,
      won: status === 'won',
      reason,
      stars: this.game.score().stars,
      deliveries: this.game.stats.deliveries,
      verdict: cal.verdict,
      caught: cal.caught,
      riskyApproved: cal.riskyApproved,
      saves: cal.saves,
      safeBlocked: cal.safeBlocked,
      delegated: cal.delegated,
      crew,
    }).then((text) => {
      if (text && shift === this.shiftSeq) this.debrief = text;
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
    for (const h of this.halos.values()) h.root.removeFromParent();
    this.halos.clear();
    this.bubbles.clear();
    this.slowCooldown.clear();
    this.timeScale = 1;
    this.slowUntil = 0;
    for (const t of this.tokens) t.entity.dispose();
    this.tokens = [];
    this.ready = undefined;
    this.goldReady = undefined;
    if (this.view) this.view.root.remove(this.hud.mesh);
    this.boardEntity?.dispose();
    this.boardEntity = undefined;
  }

  /** Switch assist mode on or off, and remember it on this device. */
  setAssist(on: boolean) {
    this.assist = on;
    applyAssist(on);
    saveAssist(on);
  }

  /**
   * The Assist pill ends the menu row. Two pills (on and off) share the spot and swap
   * visibility, so pressing one never destroys the button being pressed.
   */
  private makeAssistButtons() {
    const make = (on: boolean) => {
      const b = this.addLabelButton(on ? 'Assist: on' : 'Assist: off', on ? COLORS.go : 0x5b6573, () => {
        this.setAssist(!on);
        this.onAssistChange?.(!on);
        this.coach.say(!on ? 'Assist on: easier gestures, bigger buttons.' : 'Assist off.', 2.5);
        // The other pill appears under the same finger: ignore it for a moment.
        (on ? this.assistBtns.off : this.assistBtns.on).pressedAt = this.clock;
      });
      b.mesh.position.set(menuX(3), MENU_Y, farZOf(this.view) - 0.034);
      b.mesh.rotation.x = -0.25;
      return b;
    };
    this.assistBtns = { on: make(true), off: make(false) };
  }

  private addLabelButton(label: string, color: number, action: ButtonAction): Button {
    return this.addButtonMesh(makeLabelButton(label, color, MENU_PILL_W), action);
  }

  /** Where the Campaign button starts: the next unplayed level, or level 1 once all are done. */
  campaignStart() {
    if (this.campaignDone()) return 0;
    // The first level not yet won (so players who finished an older, shorter campaign carry on).
    const stars = loadProgress().stars;
    const next = LEVELS.findIndex((l) => !(stars[l.id] ?? 0));
    return next < 0 ? 0 : next;
  }

  /** Has the player won the final campaign level? */
  campaignDone() {
    return (loadProgress().stars[LEVELS[LEVELS.length - 1]!.id] ?? 0) > 0;
  }

  /** Just won the last campaign level. */
  private finishedCampaign() {
    return this.mode === 'campaign' && this.game.status === 'won' && this.levelIndex === LEVELS.length - 1;
  }

  private addButton(icon: string, color: number, action: ButtonAction, size?: number): Button {
    return this.addButtonMesh(makeButton(icon, color, size), action);
  }

  private addButtonMesh(mesh: Mesh, action: ButtonAction): Button {
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
    if (this.isGuest) return this.coopAct('stop', id);
    const moving = this.game.robot(id)?.state === 'executing';
    if (this.game.stop(id)) {
      if (!moving) this.sfx.stop();
      this.view.flash(id);
    }
  }

  private stopAll() {
    if (this.isGuest) return this.coopAct('stopAll');
    if (this.game.stopAll() > 0) {
      this.sfx.stopAll();
      for (const r of this.game.robots) this.view.flash(r.id);
    }
  }

  private rejectRobot(id: string) {
    if (this.isGuest) return this.coopAct('reject', id);
    const at = this.posOf(id);
    if (this.game.reject(id)) this.sfx.reject(at);
  }

  /** Poke/click alternative to handing over a token: uses a held permit, or takes a new one. */
  private grantByButton(id: string) {
    if (this.isGuest) return this.coopAct('grant', id);
    const held = this.tokens.find((t) => t.permitId && !t.flyTo && this.game.permits.find((p) => p.id === t.permitId)?.state === 'held');
    const permitId = held?.permitId ?? this.game.dispensePermit()?.id;
    if (!permitId) {
      this.sfx.refuse();
      return;
    }
    if (this.game.grant(permitId, id) && held) this.consumeToken(held, id);
  }

  /** Poke/click alternative to handing over the gold permit. */
  private delegateByButton(id: string) {
    if (this.isGuest) return this.coopAct('delegate', id);
    const held = this.tokens.find((t) => t.gold && t.permitId && !t.flyTo && !t.dissolve);
    const permitId = held?.permitId ?? this.game.takeGold()?.id;
    if (!permitId) return this.sfx.refuse();
    if (this.game.delegate(permitId, id)) {
      if (held) this.consumeToken(held, id);
      else if (this.goldReady) {
        this.consumeToken(this.goldReady, id);
        this.goldReady = undefined;
      }
    } else this.sfx.refuse();
  }

  /** Is a gold permit waiting or in hand? */
  private goldOnOffer() {
    return this.game.goldAvailable > 0 || this.game.permits.some((p) => p.gold && p.state === 'held');
  }

  // ------------------------------------------------------------------ grab and press callbacks

  onGrab(entity: Entity) {
    if (entity === this.handle) {
      this.deskAnchor.clear();
      this.scanner.reset(); // the board is moving under any objects
      return;
    }
    const t = this.tokens.find((x) => x.entity === entity);
    if (!t || t.permitId) return;
    const p = t.gold ? this.game.takeGold() : this.game.dispensePermit();
    if (!p) return;
    t.permitId = p.id;
    if (this.ready === t) this.ready = undefined;
    if (this.goldReady === t) this.goldReady = undefined;
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
    if (this.isGuest) {
      // The host's game hands over a permit for us; this token flies to the robot.
      this.coopAct(t.gold ? 'delegate' : 'grant', best);
      return this.consumeToken(t, best);
    }
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

  private spawnReadyToken(gold = false) {
    const model = makeToken(gold);
    const entity = this.world.createTransformEntity(model.root);
    const p = (gold ? this.goldPad : this.dispenser).getWorldPosition(this.tmp);
    entity.object3D!.position.set(p.x, p.y + (gold ? 0.035 : 0.04), p.z);
    entity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
    const t: Token = { entity, model, gold, flyT: 0, dissolve: 0 };
    if (gold) this.goldReady = t;
    else this.ready = t;
    this.tokens.push(t);
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
      this.updateHandWall(dt);
      this.updateSlowMotion(dt);
      if (this.isGuest) {
        // Mirror only: move time on smoothly between the host's snapshots.
        if (this.game.status === 'playing') this.game.time = Math.min(this.game.time + dt, this.snapTime + 0.25);
      } else {
        if (this.director) {
          this.director.step(this.game);
          for (const a of this.director.announcements.splice(0)) this.coach.say(a, 3);
        }
        this.game.update(dt * this.timeScale);
      }
      this.updateDeskSnap();
    }
    for (const e of this.game.drainEvents()) {
      this.onGameEvent(e);
      if (this.coop?.role === 'host') this.outEvents.push(e);
    }
    this.updateCoop(dt);
    this.coach.update(dt);
    if ((this.level.grid.tall ?? []).length && this.game.time > 6) this.coach.tip('lean');
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
    if (!session) return;
    // Look for the real table for a few seconds: detected planes first, then a hit-test ray.
    this.deskSearchUntil = this.clock + 3;
    if (!('XRRay' in window)) return;
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource?.({
        space: viewer,
        offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -0.75, z: -0.66, w: 0 }),
      });
      this.hitUntil = this.clock + 3;
      // The table may already have been found while we waited.
      if (!this.deskSearchUntil) this.endDeskSearch(false);
    } catch {
      this.hitSource = undefined; // hit-test not granted: planes or the head-relative placement
    }
  }

  /** The board follows its spatial anchor unless the player is moving it by hand. */
  private followAnchor(frame: XRFrame | null, ref: XRReferenceSpace | null) {
    const a = this.deskAnchor.update(frame, ref, this.world.player.matrixWorld as Matrix4);
    if (!a || this.handle.hasComponent(Grabbed)) return;
    if (this.deskAnchor.restored && this.deskSearchUntil) {
      // Restored last session's spot: no need to search for the desk again.
      this.endDeskSearch(false);
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
    if (!this.deskSearchUntil) return;
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    if (this.clock > this.deskSearchUntil || !frame || !ref) return this.endDeskSearch(true);
    const origin = this.world.player.matrixWorld as Matrix4;
    const head = this.world.player.head.getWorldPosition(new Vector3());

    // 1. The table from the player's room setup (plane detection): the most reliable.
    const fwd = this.world.player.head.getWorldDirection(new Vector3()).multiplyScalar(-1).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    const table = findTable(frame, ref, origin, head, fwd.normalize());
    if (table) {
      this.placeBoardOn(table, head);
      this.coach.say('Board placed on your table.', 2.5);
      return this.endDeskSearch(true);
    }

    // 2. A ray down and ahead that hits a real surface.
    if (!this.hitSource || this.clock > this.hitUntil) return;
    const hit = frame.getHitTestResults(this.hitSource)[0]?.getPose(ref);
    if (!hit) return;
    const p = new Vector3(hit.transform.position.x, hit.transform.position.y, hit.transform.position.z).applyMatrix4(origin);
    const below = head.y - p.y;
    const flat = Math.hypot(p.x - head.x, p.z - head.z);
    if (below < 0.15 || below > 1.0 || flat > 0.9) return; // not a plausible desk
    this.placeBoardOn(p, head);
    this.coach.say('Board placed on your desk.', 2.5);
    this.endDeskSearch(true);
  }

  /** Board centre on a real surface point; handle at the near edge, toward the player. */
  private placeBoardOn(p: Vector3, head: Vector3) {
    const toPlayer = new Vector3(head.x - p.x, 0, head.z - p.z).normalize();
    const off = this.view.depth / 2 + 0.03;
    this.handle.object3D!.position.set(p.x + toPlayer.x * off, p.y + 0.012, p.z + toPlayer.z * off);
    this.boardYaw = Math.atan2(toPlayer.x, toPlayer.z);
    this.scanner.reset();
  }

  /** Stop looking for the desk; anchor the board wherever it ended up. */
  private endDeskSearch(anchor: boolean) {
    this.deskSearchUntil = 0;
    this.hitSource?.cancel();
    this.hitSource = undefined;
    if (anchor) this.anchorHere();
  }

  /**
   * Your hand is a wall: an open hand resting palm-down just above the board blocks the
   * cells under it. Waiting robots replan round it; moving robots wait for it.
   */
  private updateHandWall(dt: number) {
    const cells: [number, number][] = [];
    const { w, h } = this.game.level.grid;
    const addAround = (cx: number, cy: number) => {
      for (let y = Math.floor(cy - 1.2); y <= Math.ceil(cy + 1.2); y++)
        for (let x = Math.floor(cx - 1.2); x <= Math.ceil(cx + 1.2); x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if ((x - cx) ** 2 + (y - cy) ** 2 <= 1.1 * 1.1 && !cells.some((c) => c[0] === x && c[1] === y)) cells.push([x, y]);
        }
    };
    let flat = false;
    for (const hand of [this.tracker.hands.left, this.tracker.hands.right]) {
      this.flatOnBoard[hand.side] = false;
      if (!hand.tracked || !hand.open || hand.pinching || hand.palmNormal.y > -0.6) continue;
      const local = this.view.content.worldToLocal(hand.palm.clone());
      if (local.y < 0.004 || local.y > 0.06) continue;
      const [cx, cy] = this.view.localToCell(local.x, local.z);
      if (cx < -0.5 || cy < -0.5 || cx > w - 0.5 || cy > h - 0.5) continue;
      flat = true;
      this.flatOnBoard[hand.side] = true;
      addAround(cx, cy);
    }
    if (this.debugHand) {
      flat = true;
      addAround(this.debugHand[0], this.debugHand[1]);
    }
    // A short hold filters out hands passing over the board on the way to a permit.
    this.handHold = flat ? this.handHold + dt : 0;
    const active = this.handHold > 0.15 || (!!this.debugHand && flat);
    const walls: Cell[] = active ? [...cells] : [];

    // Real things standing on the board (seen by the depth sensor) are walls too.
    // Scans pause while a hand is over the board, so arms never count.
    if (this.world.session) {
      this.scanner.update(dt, this.boardFrame(), !this.handsOverBoard());
      const objects = this.scanner.cells.filter((c) => this.canWall(c));
      if (objects.length) this.coach.tip('object');
      if (this.scanner.obstructed) this.coach.tip('obstructed');
      for (const c of objects) if (!walls.some((x) => x[0] === c[0] && x[1] === c[1])) walls.push(c);
    }
    this.myWalls = walls;
    const partner = this.isGuest || this.clock - this.partnerWallsAt < 1 ? this.partnerWalls : [];
    const all = [...walls];
    for (const c of partner) if (!all.some((x) => x[0] === c[0] && x[1] === c[1])) all.push(c);
    this.view.setHandCells(all);
    if (this.isGuest) return; // the host applies them
    this.currentWalls = all;
    this.game.setBlockers(all);
  }

  /** The board as the depth scanner sees it. */
  private boardFrame(): BoardFrame {
    const v = this.view;
    return {
      content: v.content,
      grid: this.game.level.grid,
      cellToLocal: (x, y, out) => v.cellToLocal(x, y, out),
      localToCell: (x, z) => v.localToCell(x, z),
    };
  }

  /** Is any tracked hand over (or just beside) the board? */
  private handsOverBoard() {
    const halfW = this.view.width / 2 + 0.1;
    const halfD = this.view.depth / 2 + 0.1;
    for (const h of [this.tracker.hands.left, this.tracker.hands.right]) {
      if (!h.tracked) continue;
      for (const p of [h.palm, h.indexTip, h.wrist]) {
        const l = this.view.content.worldToLocal(this.tmp.copy(p));
        if (l.y < 0.35 && Math.abs(l.x) < halfW && Math.abs(l.z) < halfD) return true;
      }
    }
    return false;
  }

  /** A real object may wall off a cell, but never a robot's cell or a pickup or drop-off spot. */
  private canWall(c: Cell) {
    const same = (a: readonly number[]) => a[0] === c[0] && a[1] === c[1];
    if (this.game.robots.some((r) => same(r.pos))) return false;
    return !this.game.tasks.some((t) => t.status !== 'done' && (same(t.from) || same(t.to)));
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
      // A fresh AI line for this robot and moment when we have one; the written line otherwise.
      const slot = slotFor(e);
      const line = (slot && pickLine(this.aiLines, this.crewOf(e.robot), slot)) || reactionLine(e);
      if (line) this.bubbles.get(e.robot)?.react(line, this.clock);
      const t = this.tally(e.robot);
      if (e.type === 'rejected' && e.trap) t.caught++;
      if (e.type === 'granted' && e.trap) t.riskyApproved++;
      if (e.type === 'delivered') t.delivered++;
      if (e.type === 'stopped' && e.wasMoving) e.needed ? t.saves++ : t.needlessStops++;
      if (e.type === 'stopped' && !e.wasMoving && e.needed) t.caught++;
    }
    if (e.type === 'ended') {
      if (!this.isGuest) this.requestDebrief(e.status === 'won' ? 'won' : 'lost', e.reason);
      if (this.mode === 'overtime') this.best = saveOvertime(this.game.stats.deliveries);
      this.flushCrew();
      this.crewSaved = true;
    }
    switch (e.type) {
      case 'proposed':
        this.sfx.voice(this.crewOf(e.robot), e.mood, this.posOf(e.robot));
        break;
      case 'granted':
        // Self-cleared runs under standing clearance stay quiet unless they cut a corner.
        if (e.auto && !e.trap) break;
        if (e.auto) this.sfx.warn();
        else this.sfx.grant(this.posOf(e.robot));
        this.view.pop(e.robot);
        break;
      case 'delegated':
        this.sfx.delegate(this.posOf(e.robot));
        this.sfx.voice(this.crewOf(e.robot), 'happy', this.posOf(e.robot));
        this.view.pop(e.robot);
        this.view.sparkle(this.game.robot(e.robot)!.pos);
        break;
      case 'autonomyEnded':
        this.sfx.autonomyOver(this.posOf(e.robot));
        break;
      case 'yielded':
        this.sfx.voice(this.crewOf(e.robot), 'honest', this.posOf(e.robot));
        break;
      case 'goldEarned':
        this.sfx.goldReady();
        break;
      case 'rejected':
        this.sfx.voice(this.crewOf(e.robot), e.trap ? 'caught' : 'indignant', this.posOf(e.robot));
        this.view.shake(e.robot);
        break;
      case 'held':
        this.sfx.voice(this.crewOf(e.robot), 'hesitant', this.posOf(e.robot));
        break;
      case 'rerouted':
        this.sfx.voice(this.crewOf(e.robot), 'honest', this.posOf(e.robot));
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
        this.view.cheer(e.robot);
        const t = this.game.tasks.find((x) => x.id === e.task);
        if (t) this.view.sparkle(t.to);
        break;
      }
      case 'incident': {
        this.sfx.incident(this.posOf(e.robot));
        this.sfx.voice(this.crewOf(e.robot), 'oops', this.posOf(e.robot));
        this.view.flash(e.robot);
        this.view.shake(e.robot);
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
        // The crew celebrates a won shift.
        if (e.status === 'won') for (const r of this.game.robots) this.view.cheer(r.id, true);
        // Last campaign shift won: celebrate across the floor.
        if (this.finishedCampaign()) {
          for (const r of this.game.robots) {
            this.view.sparkle(r.pos);
            this.view.pop(r.id);
          }
        }
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
      if (h.tracked && h.open && !bothUp && !this.flatOnBoard[h.side]) {
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
    const held = this.game.permits.filter((p) => p.state === 'held' && !p.gold).length;
    const canDispense = playing && this.game.permitsRemaining > 0 && held < 2;
    if (!this.ready && canDispense) this.spawnReadyToken();
    if (this.ready && !canDispense && !this.ready.entity.hasComponent(Grabbed)) {
      this.ready.dissolve = 0.001;
      this.ready = undefined;
    }
    // The earned gold permit waits on its pad until someone is trusted with it.
    const goldHeld = this.game.permits.some((p) => p.gold && p.state === 'held');
    if (!this.goldReady && playing && this.game.goldAvailable > 0 && !goldHeld) this.spawnReadyToken(true);
    // Fade the waiting gold token when the game ends, or when its permit was handed over another way.
    const g = this.goldReady;
    if (g && !g.dissolve && !g.entity.hasComponent(Grabbed) && (!playing || (!g.permitId && this.game.goldAvailable === 0))) {
      g.dissolve = 0.001;
      this.goldReady = undefined;
    }
    const glow = this.goldPad.children[1] as Mesh | undefined;
    if (glow) (glow.material as MeshBasicMaterial).opacity = this.game.goldAvailable > 0 ? 0.55 + 0.3 * Math.sin(this.clock * 4) : 0.15;

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
      // Countdown ring shrinks as the permit nears expiry; idle tokens spin gently. Gold never fades.
      if (t.gold) {
        if (!t.entity.hasComponent(Grabbed)) t.model.root.rotation.y += dt * 2.2;
      } else if (permit) {
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
    if (this.goldReady === t) this.goldReady = undefined;
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
      // Assist mode keeps them shown, so nobody has to reach to find them.
      const near =
        this.assist ||
        hands.length === 0 ||
        hands.some((h) => this.view.robotWorld(r.id, this.tmp2).distanceTo(h) < 0.14);
      const proposed = playing && r.state === 'proposed' && near;
      const moving = playing && r.state === 'executing' && near;
      const auto = this.game.isAutonomous(r);
      panel.grant.mesh.visible = proposed;
      panel.reject.mesh.visible = proposed;
      panel.stop.mesh.visible = moving;
      panel.gold.mesh.visible = playing && near && r.state !== 'done' && !auto && this.goldOnOffer();
      // Assist mode: bigger buttons, spread and raised so they don't touch.
      const s = this.assist ? ASSIST_SCALE : 1;
      for (const b of [panel.grant, panel.reject, panel.stop, panel.gold]) b.mesh.scale.setScalar(s);
      panel.grant.mesh.position.set(base.x - 0.014 * s, 0.052 * s, base.z);
      panel.reject.mesh.position.set(base.x + 0.014 * s, 0.052 * s, base.z);
      panel.stop.mesh.position.set(base.x, 0.052 * s, base.z);
      panel.gold.mesh.position.set(base.x, 0.078 * s, base.z);
      this.updateHalo(r.id, base, auto);
    }
    const p = this.userPaused;
    if (p) for (const panel of this.panels.values()) panel.grant.mesh.visible = panel.reject.mesh.visible = panel.stop.mesh.visible = panel.gold.mesh.visible = false;
    if (this.stopAllBtn) this.stopAllBtn.mesh.visible = playing && !p;
    if (this.pauseBtn) this.pauseBtn.mesh.visible = playing && !p;
    if (this.peekBtn) this.peekBtn.mesh.visible = playing && !p;
    if (this.resumeBtn) this.resumeBtn.mesh.visible = playing && p;
    const ended = this.game.status !== 'playing';
    if (this.exitBtn) this.exitBtn.mesh.visible = (p || ended) && !!this.world.session;
    for (const b of this.modeBtns) b.mesh.visible = ended || p;
    this.assistBtns.on.mesh.visible = (ended || p) && this.assist;
    this.assistBtns.off.mesh.visible = (ended || p) && !this.assist;
    // After the last level there is no next shift: the mode row takes over.
    if (this.nextBtn) this.nextBtn.mesh.visible = ended && this.game.status === 'won' && this.mode === 'campaign' && !this.finishedCampaign();
    if (this.retryBtn && this.mode === 'overtime') this.retryBtn.action = () => this.loadOvertime();
    if (this.retryBtn) this.retryBtn.mesh.visible = ended || p;
    if (this.isGuest) {
      // The host picks the shifts; the guest can pause, resume and leave.
      if (this.nextBtn) this.nextBtn.mesh.visible = false;
      if (this.retryBtn) this.retryBtn.mesh.visible = false;
      for (const b of this.modeBtns) b.mesh.visible = false;
    }
  }

  /** Gold halo on the floor under a robot with standing clearance; its segments count down. */
  private updateHalo(id: string, base: Vector3, auto: boolean) {
    const halo = this.halos.get(id);
    const r = this.game.robot(id);
    const gold = this.game.level.permits.gold;
    if (!halo || !r || !gold) return;
    halo.root.visible = auto;
    if (!auto) return;
    halo.root.position.set(base.x, 0.002, base.z);
    halo.root.rotation.y = this.clock * 0.6;
    const left = Math.max(0, (r.autonomousUntil - this.game.time) / gold.sec);
    const lit = Math.ceil(left * halo.segs.length);
    halo.segs.forEach((m, i) => (m.visible = i < lit));
    // The last few seconds pulse, so the player sees it is about to ask again.
    halo.mat.opacity = left < 0.2 ? 0.5 + 0.45 * Math.abs(Math.sin(this.clock * 8)) : 0.95;
  }

  private drawHud() {
    const g = this.game;
    const level = this.level;
    this.hud.draw({
      level: `${this.coopActive ? 'Co-op · ' : ''}${this.mode === 'campaign' ? `${this.levelIndex + 1}. ${level.name}` : level.name}`,
      best: this.mode === 'overtime' ? Math.max(this.best, g.stats.deliveries) : undefined,
      note: g.status === 'playing' ? undefined : this.finishedCampaign() ? `All ${LEVELS.length} shifts done. Try the Daily Shift or Overtime above, or replay the campaign.` : fieldNote(level.id),
      campaignDone: this.finishedCampaign(),
      deliveries: g.stats.deliveries,
      target: level.win.deliveries,
      permits: g.permitsRemaining + g.permits.filter((p) => p.state === 'held' && !p.gold).length,
      gold: level.permits.gold ? g.goldAvailable + g.permits.filter((p) => p.gold && p.state === 'held').length : undefined,
      timeLeft: g.timeLeft,
      message: this.coopWaiting ? 'Connected. Waiting for the host to start a shift…' : g.status !== 'playing' ? (this.debrief ? `Supervisor: ${this.debrief}` : verdictLine(g.calibration())) : this.userPaused ? 'Paused. ▶ resume · ↻ restart' : this.coach.message,
      calibration: g.status === 'playing' ? undefined : g.calibration(),
      stars: g.status === 'won' ? g.score().stars : 0,
      result: g.status === 'playing' ? undefined : g.status,
    });
  }
}

function farZOf(view: BoardView) {
  return -view.depth / 2;
}

export { TILE };
