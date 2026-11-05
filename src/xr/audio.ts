/** Tiny procedural sound kit: no audio files to download. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (the Start button). */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', at = 0, vol = 1, slideTo?: number) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  pick() {
    this.tone(880, 0.06, 'triangle', 0, 0.5);
  }
  grant() {
    this.tone(660, 0.12, 'sine', 0, 0.7);
    this.tone(990, 0.18, 'sine', 0.08, 0.7);
  }
  refuse() {
    this.tone(180, 0.18, 'square', 0, 0.25);
  }
  reject() {
    this.tone(500, 0.2, 'sawtooth', 0, 0.25, 120);
  }
  stop() {
    this.tone(320, 0.1, 'square', 0, 0.3);
    this.tone(240, 0.16, 'square', 0.1, 0.3);
  }
  stopAll() {
    for (let i = 0; i < 3; i++) this.tone(700, 0.12, 'square', i * 0.16, 0.25, 350);
  }
  propose() {
    this.tone(1200, 0.05, 'sine', 0, 0.25);
  }
  deliver() {
    this.tone(784, 0.08, 'triangle', 0, 0.6);
    this.tone(1046, 0.08, 'triangle', 0.07, 0.6);
    this.tone(1318, 0.14, 'triangle', 0.14, 0.6);
  }
  incident() {
    this.tone(220, 0.35, 'sawtooth', 0, 0.35, 110);
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
}
