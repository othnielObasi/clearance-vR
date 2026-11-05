import type { Mood } from '../core/game';
import type { CrewName } from '../core/crew';

/** A world position for spatial sounds. */
export interface Pos {
  x: number;
  y: number;
  z: number;
}

export type VoiceKind = Mood | 'happy' | 'caught' | 'indignant' | 'thanks' | 'oops';

/** Each crew member's voice: a base pitch and a wave, so you can tell them apart with eyes closed. */
const VOICES: Record<CrewName, { base: number; wave: OscillatorType; rate: number }> = {
  Bolt: { base: 300, wave: 'square', rate: 0.07 },
  Pip: { base: 640, wave: 'triangle', rate: 0.09 },
  Rook: { base: 190, wave: 'sawtooth', rate: 0.11 },
  Juno: { base: 520, wave: 'square', rate: 0.05 },
};

/** Pitch contours (semitones) per attitude: the robot's tone of voice. */
const CONTOURS: Record<VoiceKind, number[]> = {
  eager: [0, 4, 7],
  sly: [0, 3, 8, 12], // sneaky rising run
  honest: [0, 0, 5],
  bold: [0, 7, 12, 7, 12],
  hesitant: [5, 3, 1, -2], // unsure, falling
  happy: [0, 4, 7, 12],
  caught: [7, 3, -2],
  indignant: [0, 6, 13],
  thanks: [4, 9, 4],
  oops: [6, -6],
};

// Am – F – C – G, as semitones above A2.
const CHORDS = [
  [0, 3, 7, 12],
  [-4, 0, 3, 8],
  [3, 7, 10, 15],
  [-2, 2, 5, 10],
];
const A2 = 110;
const BPM = 92;
const semis = (n: number) => A2 * Math.pow(2, n / 12);

/**
 * Procedural sound: effects, spatial robot voices, an ambient warehouse hum and
 * generative music whose layers build with pressure. No audio files to download.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private nextStep = 0;
  private step = 0;
  private intensity = 0.25;
  private targetIntensity = 0.25;
  private paused = false;
  muted = false;

  /** Must be called from a user gesture (the Start button). */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 900;
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicFilter.connect(this.musicBus).connect(this.master);
      this.noise = this.makeNoise();
      this.startAmbience();
      this.nextStep = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    void this.ctx.resume();
  }

  // ------------------------------------------------------------------ listener and mix

  /** Keep the listener on the player's head so robot voices come from the board. */
  setListener(pos: Pos, forward: Pos, up: Pos) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** 0 = calm, 1 = everything at once. Smoothed. */
  setIntensity(v: number) {
    this.targetIntensity = Math.max(0, Math.min(1, v));
  }

  setPaused(p: boolean) {
    if (p === this.paused || !this.ctx || !this.musicBus) return;
    this.paused = p;
    this.musicBus.gain.setTargetAtTime(p ? 0.08 : 0.32, this.ctx.currentTime, 0.2);
  }

  // ------------------------------------------------------------------ voices

  /** A robot speaks: short blips in its own voice, shaped by its attitude, from where it stands. */
  voice(name: CrewName, kind: VoiceKind, at?: Pos) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const v = VOICES[name];
    const contour = CONTOURS[kind];
    const out = at ? this.panner(at) : this.sfxBus!;
    contour.forEach((s, i) => {
      const f = v.base * Math.pow(2, s / 12);
      this.tone(f, v.rate * 1.4, v.wave, i * v.rate, 0.16, f * 1.06, out);
    });
  }

  // ------------------------------------------------------------------ effects

  pick() {
    this.tone(880, 0.06, 'triangle', 0, 0.5);
  }
  grant(at?: Pos) {
    const out = at ? this.panner(at) : undefined;
    this.tone(660, 0.12, 'sine', 0, 0.7, undefined, out);
    this.tone(990, 0.18, 'sine', 0.08, 0.7, undefined, out);
    this.tone(1320, 0.22, 'sine', 0.16, 0.35, undefined, out);
  }
  refuse() {
    this.tone(180, 0.18, 'square', 0, 0.25);
  }
  reject(at?: Pos) {
    this.tone(500, 0.2, 'sawtooth', 0, 0.25, 120, at ? this.panner(at) : undefined);
    this.noiseBurst(0.12, 2500, 0.2, at);
  }
  stop() {
    this.tone(320, 0.1, 'square', 0, 0.3);
    this.tone(240, 0.16, 'square', 0.1, 0.3);
  }
  stopAll() {
    for (let i = 0; i < 3; i++) this.tone(700, 0.12, 'square', i * 0.16, 0.25, 350);
  }
  brake(at?: Pos) {
    this.tone(1400, 0.22, 'sawtooth', 0, 0.15, 500, at ? this.panner(at) : undefined);
    this.noiseBurst(0.18, 4000, 0.25, at);
  }
  warn() {
    this.tone(980, 0.08, 'square', 0, 0.2);
    this.tone(980, 0.08, 'square', 0.12, 0.2);
  }
  propose() {
    this.tone(1200, 0.05, 'sine', 0, 0.25);
  }
  deliver(at?: Pos) {
    const out = at ? this.panner(at) : undefined;
    this.tone(784, 0.08, 'triangle', 0, 0.6, undefined, out);
    this.tone(1046, 0.08, 'triangle', 0.07, 0.6, undefined, out);
    this.tone(1318, 0.14, 'triangle', 0.14, 0.6, undefined, out);
  }
  incident(at?: Pos) {
    this.tone(220, 0.35, 'sawtooth', 0, 0.35, 110, at ? this.panner(at) : undefined);
  }
  expire() {
    this.tone(600, 0.25, 'sine', 0, 0.3, 200);
  }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', i * 0.12, 0.6));
  }
  lose() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', i * 0.18, 0.5));
  }

  // ------------------------------------------------------------------ internals

  private panner(at: Pos): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.3;
    p.rolloffFactor = 0.8;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else p.setPosition(at.x, at.y, at.z);
    p.connect(this.sfxBus!);
    // Panners are cheap but not free: drop it once its sounds are done.
    setTimeout(() => p.disconnect(), 1500);
    return p;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', at = 0, vol = 1, slideTo?: number, out?: AudioNode, when?: number) {
    if (!this.ctx || !this.sfxBus || this.muted) return;
    const t0 = (when ?? this.ctx.currentTime) + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out ?? this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // Brown-ish noise: warmer than white, good for hum and hiss.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  private noiseBurst(dur: number, cutoff: number, vol: number, at?: Pos, when?: number, out?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || this.muted) return;
    const t0 = when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out ?? (at ? this.panner(at) : this.sfxBus!));
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.02);
  }

  /** Low warehouse hum under everything. */
  private startAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    const hum = ctx.createOscillator();
    hum.frequency.value = 55;
    const hg = ctx.createGain();
    hg.gain.value = 0.012;
    hum.connect(hg).connect(this.master!);
    hum.start();
  }

  /** Look-ahead scheduler: queues the next 16th notes slightly in advance. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicFilter) return;
    this.intensity += (this.targetIntensity - this.intensity) * 0.04;
    this.musicFilter.frequency.setTargetAtTime(700 + this.intensity * 2600, ctx.currentTime, 0.3);
    const stepDur = 60 / BPM / 4;
    while (this.nextStep < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStep, stepDur);
      this.nextStep += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, sd: number) {
    if (this.muted) return;
    const out = this.musicFilter!;
    const chord = CHORDS[Math.floor(step / 16)]!;
    const i = this.intensity;
    const inBar = step % 16;
    // Pad: the chord, once per bar, always on.
    if (inBar === 0) for (const n of chord.slice(0, 3)) this.tone(semis(n + 12), sd * 16, 'sawtooth', 0, 0.022, undefined, out, t);
    // Bass on beats 1 and 3, eighths when busy.
    if (inBar % 8 === 0 || (i > 0.7 && inBar % 2 === 0)) this.tone(semis(chord[0]!), sd * 1.8, 'triangle', 0, 0.12, undefined, out, t);
    // Arpeggio fills in as pressure rises.
    const density = i > 0.75 ? 1 : i > 0.5 ? 2 : i > 0.3 ? 4 : 0;
    if (density && inBar % density === 0) {
      const n = chord[(step / density) % chord.length | 0]!;
      this.tone(semis(n + 24), sd * 1.2, 'triangle', 0, 0.05, undefined, out, t);
    }
    // Hats and a soft kick at higher intensity.
    if (i > 0.55 && inBar % 2 === 1) this.noiseBurst(0.04, 7000, 0.06, undefined, t, out);
    if (i > 0.62 && inBar % 4 === 0) this.tone(120, 0.18, 'sine', 0, 0.22, 45, out, t);
  }
}
