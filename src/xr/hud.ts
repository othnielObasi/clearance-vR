import type { Calibration } from '../core/game';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

export interface HudState {
  level: string;
  deliveries: number;
  target: number;
  permits: number;
  timeLeft: number;
  message: string;
  stars?: number;
  result?: 'won' | 'lost';
  calibration?: Calibration;
  /** Overtime: best score, shown instead of the clock. */
  best?: number;
  /** End-of-shift line linking the lesson to the real world. */
  note?: string;
}

const W = 1024;
const H = 360;

/** A floating status card above the far edge of the board, drawn to a canvas. */
export class Hud {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private last = '';

  constructor(widthM = 0.34) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, (widthM * H) / W),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
  }

  draw(s: HudState) {
    const sig = JSON.stringify({ ...s, timeLeft: Math.ceil(s.timeLeft) });
    if (sig === this.last) return;
    this.last = sig;
    const g = this.g;
    g.clearRect(0, 0, W, H);
    round(g, 8, 8, W - 16, H - 16, 36);
    g.fillStyle = 'rgba(20, 24, 30, 0.86)';
    g.fill();

    g.fillStyle = '#ffffff';
    g.font = '600 52px system-ui, sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText(s.level, 44, 82);

    if (s.result) {
      g.font = '700 64px system-ui, sans-serif';
      g.fillStyle = s.result === 'won' ? '#3fb950' : '#ff6b6b';
      g.fillText(s.result === 'won' ? 'Shift complete' : 'Shift over', 44, 150);
      if (s.best !== undefined) {
        // Overtime: the score is the point.
        g.font = '600 46px system-ui, sans-serif';
        g.fillStyle = '#ffd23f';
        g.textAlign = 'right';
        g.fillText(`${s.deliveries} delivered · best ${s.best}`, W - 44, 150);
        g.textAlign = 'left';
      } else {
        g.font = '64px system-ui, sans-serif';
        g.fillStyle = '#ffd23f';
        g.fillText('★'.repeat(s.stars ?? 0) + '☆'.repeat(3 - (s.stars ?? 0)), W - 280, 150);
      }
      if (s.calibration) {
        const c = s.calibration;
        const items: [string, number, boolean][] = [
          ['Caught', c.caught, false],
          ['Saves', c.saves, false],
          ['Risks let through', c.overTrust, c.overTrust > 0],
          ['Safe blocked', c.safeBlocked, c.safeBlocked > 1],
        ];
        items.forEach(([label, n, bad], i) => {
          const x = 44 + i * 240;
          g.font = '28px system-ui, sans-serif';
          g.fillStyle = '#9aa3ad';
          g.fillText(label, x, 196);
          g.font = '600 40px system-ui, sans-serif';
          g.fillStyle = bad ? '#ff6b6b' : '#ffffff';
          g.fillText(String(n), x, 236);
        });
      }
    } else {
      const m = Math.floor(s.timeLeft / 60);
      const sec = Math.ceil(s.timeLeft % 60) % 60;
      const endless = s.best !== undefined;
      const stats = [
        ['Delivered', endless ? `${s.deliveries}` : `${s.deliveries}/${s.target}`],
        ['Permits', `${s.permits}`],
        endless ? ['Best', `${s.best}`] : ['Time', `${m}:${String(sec).padStart(2, '0')}`],
      ];
      stats.forEach(([label, value], i) => {
        const x = 44 + i * 320;
        g.font = '30px system-ui, sans-serif';
        g.fillStyle = '#9aa3ad';
        g.fillText(label!, x, 136);
        g.font = '600 58px system-ui, sans-serif';
        g.fillStyle = label === 'Time' && s.timeLeft < 15 ? '#ff6b6b' : '#ffffff';
        g.fillText(value!, x, 196);
      });
    }

    g.fillStyle = '#5ce1e6';
    g.font = s.result ? '30px system-ui, sans-serif' : '36px system-ui, sans-serif';
    g.fillText(s.message, 44, s.result ? 278 : 262, W - 88);
    if (s.result && s.note) {
      g.font = '26px system-ui, sans-serif';
      g.fillStyle = '#c9d1d9';
      g.fillText(s.note, 44, 326, W - 88);
    }
    this.tex.needsUpdate = true;
  }
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
