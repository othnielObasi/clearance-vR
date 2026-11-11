import type { Calibration } from '../core/game';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

export interface HudState {
  level: string;
  deliveries: number;
  target: number;
  permits: number;
  /** Gold permits waiting or in hand (standing clearance), when the mode has them. */
  gold?: number;
  timeLeft: number;
  message: string;
  stars?: number;
  result?: 'won' | 'lost';
  calibration?: Calibration;
  /** Overtime: best score, shown instead of the clock. */
  best?: number;
  /** End-of-shift line linking the lesson to the real world. */
  note?: string;
  /** The final campaign level was just won. */
  campaignDone?: boolean;
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
      g.fillText(s.campaignDone ? 'Campaign complete' : s.result === 'won' ? 'Shift complete' : 'Shift over', 44, 150);
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
          ...(s.gold !== undefined ? [['Delegated', c.delegated, false] as [string, number, boolean]] : []),
          ['Risks let through', c.overTrust, c.overTrust > 0],
          ['Safe blocked', c.safeBlocked, c.safeBlocked > 1],
        ];
        const step = items.length > 4 ? 192 : 240;
        items.forEach(([label, n, bad], i) => {
          const x = 44 + i * step;
          g.font = items.length > 4 ? '24px system-ui, sans-serif' : '28px system-ui, sans-serif';
          g.fillStyle = '#9aa3ad';
          g.fillText(label, x, 196);
          g.font = '600 40px system-ui, sans-serif';
          g.fillStyle = bad ? '#ff6b6b' : '#ffffff';
          g.fillText(String(n), x, 236);
        });
      }
    } else {
      // Round up to whole seconds first, then split, so 119.9 s reads 2:00 rather than 1:00.
      const total = Number.isFinite(s.timeLeft) ? Math.ceil(s.timeLeft) : 0;
      const m = Math.floor(total / 60);
      const sec = total % 60;
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
        if (label === 'Permits' && s.gold) {
          // Gold permits sit beside the count as stars.
          const w = g.measureText(value!).width;
          g.fillStyle = '#ffc93c';
          g.font = '600 46px system-ui, sans-serif';
          g.fillText(' ★'.repeat(s.gold), x + w + 6, 192);
        }
      });
    }

    g.fillStyle = '#5ce1e6';
    g.font = s.result ? '30px system-ui, sans-serif' : '36px system-ui, sans-serif';
    if (s.result) {
      // The end card may carry a two-sentence debrief: wrap it onto two lines, note below.
      const lines = wrap(g, s.message, W - 88, 2);
      const two = lines.length > 1;
      if (two) g.font = '27px system-ui, sans-serif';
      lines.forEach((line, i) => g.fillText(line, 44, (two ? 266 : 278) + i * 32, W - 88));
      if (s.note) {
        g.font = two ? '22px system-ui, sans-serif' : '26px system-ui, sans-serif';
        g.fillStyle = '#c9d1d9';
        g.fillText(s.note, 44, two ? 338 : 326, W - 88);
      }
    } else g.fillText(s.message, 44, 262, W - 88);
    this.tex.needsUpdate = true;
  }
}

/** Split text into at most `max` lines that fit `width`; the last line keeps any overflow (squeezed). */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width <= width || !cur || lines.length === max - 1) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
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
