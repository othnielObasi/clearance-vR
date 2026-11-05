import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

/** In-headset readout of live gesture values, for tuning thresholds on a real device (?debug). */
export class DebugPanel {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private acc = 0;

  constructor() {
    this.canvas.width = 640;
    this.canvas.height = 520;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(0.16, 0.13), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
  }

  /** Redraws at most 10 times a second. */
  update(dt: number, lines: string[]) {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const g = this.g;
    g.clearRect(0, 0, 640, 520);
    g.fillStyle = 'rgba(10, 12, 16, 0.88)';
    g.fillRect(0, 0, 640, 520);
    g.font = '26px ui-monospace, monospace';
    g.fillStyle = '#9ff7ff';
    lines.slice(0, 16).forEach((l, i) => g.fillText(l, 18, 40 + i * 30, 604));
    this.tex.needsUpdate = true;
  }
}
