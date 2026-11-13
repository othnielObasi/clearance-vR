import { DepthSensingSystem, type World } from '@iwsdk/core';
import {
  DataTexture,
  FloatType,
  GLSL3,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { Cell } from '../core/types';

/** What the scanner needs from the board: its surface frame and cell maths. */
export interface BoardFrame {
  content: { matrixWorld: Matrix4 };
  grid: { w: number; h: number };
  /** Board-local position of a (fractional) cell centre, on the board surface (y = 0). */
  cellToLocal(x: number, y: number, out: Vector3): Vector3;
  /** Fractional cell under a board-local x/z. */
  localToCell(x: number, z: number): [number, number];
}

// ---------------------------------------------------------------- real objects on the board

const SUB = [0.25, 0.75]; // 2 x 2 samples per cell
const SCAN_EVERY = 0.25; // seconds
const MIN_HEIGHT = 0.025; // metres above the board: a mug counts, the desk under the board does not
const MAX_HEIGHT = 0.35;
const BLOCK_AFTER = 0.75; // seconds an object must stay before robots treat it as a wall
const CLEAR_AFTER = 0.5;
/**
 * A mug, a phone or a box covers a few cells. Anything spanning more than this many connected
 * cells is furniture the board overlaps (a monitor, a laptop, a keyboard): not a wall to play
 * around, so it is ignored and the player is told to move the board instead.
 */
export const MAX_OBJECT_CELLS = 6;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uDepth;
uniform sampler2D uUV;
uniform float uRawToMeters;
uniform float uNear;
uniform bool uGPU;
uniform int uCount;
// GLSL 3 has no gl_FragColor: declare the output explicitly.
out highp vec4 scanOut;
void main() {
  int i = int(gl_FragCoord.x);
  if (i >= uCount) { scanOut = vec4(0.0); return; }
  vec2 uv = texelFetch(uUV, ivec2(i, 0), 0).xy;
  if (!uGPU) uv.y = 1.0 - uv.y;
  float v = texture(uDepth, vec3(uv, 0.0)).r;
  float m = uGPU ? uRawToMeters * uNear / max(1e-5, 1.0 - v) : v * uRawToMeters;
  // Pack metres (0..8) into three bytes.
  float x = clamp(m / 8.0, 0.0, 0.99999);
  vec3 enc = fract(x * vec3(1.0, 255.0, 65025.0));
  enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  scanOut = vec4(enc, 1.0);
}`;

const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

type DepthInternals = { getDepthTextureArray?: () => Texture | undefined };

/**
 * Reads the headset's depth sensor to find real things standing on the board: a mug,
 * a phone on its side, a box. Cells under them become walls, like a flat hand.
 *
 * About four times a second it projects points across the board into the left eye, reads the
 * real depth there on the GPU, and works out where the real surface is. A cell is blocked when
 * something real stands at least 2.5 cm above it for most of a second. Scans pause while a hand
 * is over the board, so arms never count. Without depth data it does nothing.
 */
export class ObjectScanner {
  /** Cells currently blocked by real objects. */
  cells: Cell[] = [];
  /** True once real depth data has arrived this session. */
  available = false;
  /** Something too big to be a game object overlaps the board (see MAX_OBJECT_CELLS). */
  obstructed = false;

  private max: number;
  private uvData: Float32Array;
  private uvTex: DataTexture;
  private rt: WebGLRenderTarget;
  private material: ShaderMaterial;
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private pixels: Uint8Array;
  private viewPos: Vector3[] = [];
  private camWorld = new Matrix4();
  private boardInv = new Matrix4();
  private viewInv = new Matrix4();
  private busy = false;
  private wait = 0;
  private seen = new Map<number, number>();
  private blocked = new Set<number>();
  private tmp = new Vector3();

  constructor(
    private world: World,
    grid: { w: number; h: number } = { w: 12, h: 8 },
  ) {
    this.max = grid.w * grid.h * SUB.length * SUB.length;
    this.uvData = new Float32Array(this.max * 4);
    this.uvTex = new DataTexture(this.uvData, this.max, 1, RGBAFormat, FloatType);
    this.uvTex.minFilter = this.uvTex.magFilter = NearestFilter;
    this.rt = new WebGLRenderTarget(this.max, 1, { depthBuffer: false });
    this.pixels = new Uint8Array(this.max * 4);
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDepth: { value: null },
        uUV: { value: this.uvTex },
        uRawToMeters: { value: 0.001 },
        uNear: { value: 0 },
        uGPU: { value: true },
        uCount: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
  }

  /** Forget everything (new level, or the board was moved). */
  reset() {
    this.cells = [];
    this.obstructed = false;
    this.seen.clear();
    this.blocked.clear();
  }

  /**
   * Call every frame in XR. `handsAway` must be false while a hand is over the board:
   * the scan pauses and the current walls stay as they are.
   */
  update(dt: number, board: BoardFrame, handsAway: boolean) {
    this.wait -= dt;
    if (this.busy || this.wait > 0 || !handsAway) return;
    const sys = this.world.getSystem(DepthSensingSystem);
    const session = this.world.session;
    if (!sys || !session) return;
    const tex = (sys as unknown as DepthInternals).getDepthTextureArray?.();
    if (!tex) return;
    const eye = this.world.renderer.xr.getCamera().cameras[0];
    if (!eye) return;
    this.available = true;
    this.wait = SCAN_EVERY;

    // Sample points across the board surface, projected into the left eye.
    this.camWorld.copy(eye.matrixWorld);
    this.viewInv.copy(eye.matrixWorld).invert();
    this.boardInv.copy(board.content.matrixWorld).invert();
    const { w, h } = board.grid;
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (const sy of SUB)
          for (const sx of SUB) {
            if (n >= this.max) continue; // a board bigger than the scanner was sized for
            const p = board.cellToLocal(x - 0.5 + sx, y - 0.5 + sy, this.tmp).setY(0).applyMatrix4(board.content.matrixWorld);
            const v = p.applyMatrix4(this.viewInv);
            if (v.z > -0.05) continue;
            const ndc = v.clone().applyMatrix4(eye.projectionMatrix);
            const u = ndc.x * 0.5 + 0.5;
            const t = ndc.y * 0.5 + 0.5;
            if (u < 0 || u > 1 || t < 0 || t > 1) continue;
            this.uvData[n * 4] = u;
            this.uvData[n * 4 + 1] = t;
            (this.viewPos[n] ??= new Vector3()).copy(v);
            n++;
          }
    if (!n) return;
    this.uvTex.needsUpdate = true;
    const u = this.material.uniforms;
    u.uDepth!.value = tex;
    u.uGPU!.value = session.depthUsage === 'gpu-optimized';
    u.uRawToMeters!.value = sys.rawValueToMeters;
    u.uNear!.value = (sys.gpuDepthData[0] as { depthNear?: number } | undefined)?.depthNear ?? 0;
    u.uCount!.value = n;

    // Render the tiny pass outside the XR cameras, then read it back without stalling.
    const r = this.world.renderer;
    const prev = r.getRenderTarget();
    const xr = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.xr.enabled = xr;
    this.busy = true;
    const count = n;
    r.readRenderTargetPixelsAsync(this.rt, 0, 0, this.max, 1, this.pixels)
      .then(() => this.process(count, board))
      .catch(() => undefined)
      .finally(() => (this.busy = false));
  }

  private process(n: number, board: BoardFrame) {
    const { w, h } = board.grid;
    const hits = new Map<number, number>();
    const q = new Vector3();
    for (let i = 0; i < n; i++) {
      const px = this.pixels;
      const m = 8 * (px[i * 4]! / 255 + px[i * 4 + 1]! / 65025 + px[i * 4 + 2]! / 16581375);
      if (m < 0.08 || m > 3) continue;
      const v = this.viewPos[i]!;
      const scale = m / -v.z;
      if (scale > 0.99) continue; // nothing real in front of the board here
      q.copy(v).multiplyScalar(scale).applyMatrix4(this.camWorld).applyMatrix4(this.boardInv);
      if (q.y < MIN_HEIGHT || q.y > MAX_HEIGHT) continue;
      const [cx, cy] = board.localToCell(q.x, q.z);
      const x = Math.round(cx);
      const y = Math.round(cy);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = y * w + x;
      hits.set(k, (hits.get(k) ?? 0) + 1);
    }
    // Something must be seen by at least two samples, scan after scan, before it becomes a wall.
    const keys = new Set([...this.seen.keys(), ...hits.keys()]);
    for (const k of keys) {
      const present = (hits.get(k) ?? 0) >= 2;
      // Evidence builds up while the object is seen and drains when it is gone (capped, so
      // a removed object clears in about CLEAR_AFTER seconds).
      const s = Math.max(0, Math.min(BLOCK_AFTER, (this.seen.get(k) ?? 0) + (present ? SCAN_EVERY : -SCAN_EVERY)));
      if (s <= 0) this.seen.delete(k);
      else this.seen.set(k, s);
      if (s >= BLOCK_AFTER) this.blocked.add(k);
      else if (s <= BLOCK_AFTER - CLEAR_AFTER) this.blocked.delete(k);
    }
    const { cells, obstructed } = splitObjects(this.blocked, w, h);
    this.cells = cells;
    this.obstructed = obstructed;
  }
}

/**
 * Keep blocked areas small enough to be objects on the board; report anything larger
 * (eight-connected, so a diagonal edge still counts as one thing) as an obstruction.
 */
export function splitObjects(blocked: Set<number>, w: number, h: number): { cells: Cell[]; obstructed: boolean } {
  const cells: Cell[] = [];
  let obstructed = false;
  const done = new Set<number>();
  for (const start of blocked) {
    if (done.has(start)) continue;
    const blob = [start];
    done.add(start);
    for (let i = 0; i < blob.length; i++) {
      const k = blob[i]!;
      const x = k % w;
      const y = Math.floor(k / w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || done.has(nk) || !blocked.has(nk)) continue;
          done.add(nk);
          blob.push(nk);
        }
    }
    if (blob.length > MAX_OBJECT_CELLS) obstructed = true;
    else for (const k of blob) cells.push([k % w, Math.floor(k / w)]);
  }
  return { cells, obstructed };
}
