import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import type { Mood } from '../core/game';

const W = 512;
const H = 128;

/** Mood colours the bubble, so a robot's attitude reads at a glance. */
const MOOD_FILL: Record<Mood, string> = {
  eager: '#ffffff',
  sly: '#ffffff',
  honest: '#c9f7e4',
  bold: '#ffd7b8',
  hesitant: '#d6dde8',
};

/** A small speech bubble that always faces the player. */
export class Bubble {
  readonly sprite: Sprite;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private mat: SpriteMaterial;
  private sig = '';
  private reactUntil = 0;
  private reaction = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.sprite = new Sprite(this.mat);
    this.sprite.scale.set(0.08, 0.02, 1);
    this.sprite.renderOrder = 5;
    this.sprite.visible = false;
  }

  react(text: string, now: number, holdSec = 1.8) {
    this.reaction = text;
    this.reactUntil = now + holdSec;
  }

  /** Show the reaction if one is live, else the standing line (or hide). */
  update(now: number, standing: string | null, mood: Mood) {
    const text = now < this.reactUntil ? this.reaction : standing;
    this.sprite.visible = !!text;
    if (!text) return;
    const fade = now < this.reactUntil ? Math.min(1, (this.reactUntil - now) / 0.3) : 1;
    this.mat.opacity = fade;
    const sig = `${text}|${mood}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.draw(text, MOOD_FILL[mood]);
  }

  private draw(text: string, fill: string) {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.font = '600 52px system-ui, sans-serif';
    const tw = Math.min(W - 40, g.measureText(text).width + 56);
    const x = (W - tw) / 2;
    const r = 34;
    g.beginPath();
    g.moveTo(x + r, 8);
    g.arcTo(x + tw, 8, x + tw, 98, r);
    g.arcTo(x + tw, 98, x, 98, r);
    g.lineTo(W / 2 + 14, 98);
    g.lineTo(W / 2, 122);
    g.lineTo(W / 2 - 14, 98);
    g.arcTo(x, 98, x, 8, r);
    g.arcTo(x, 8, x + tw, 8, r);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(20,24,30,0.5)';
    g.stroke();
    g.fillStyle = '#1b1f24';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, 55, W - 70);
    this.tex.needsUpdate = true;
  }
}
