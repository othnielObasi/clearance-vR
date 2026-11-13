import type { Cell } from '../core/types';

/**
 * Decides whether the depth sensor's object walls can be trusted on this headset.
 *
 * A real object only appears or disappears just after a hand was at the board (someone
 * put it down or picked it up). Walls that come and go while no hand has been near are
 * sensor noise. A few of those in a short time switches object walls off for the rest
 * of the shift, so the game plays as it does without depth sensing instead of showing
 * phantom walls.
 */
export class WallTrust {
  disabled = false;
  private prev = new Set<number>();
  private lastHand = -Infinity;
  private strikes: number[] = [];

  constructor(
    /** Changes within this many seconds of a hand at the board are explained. */
    private quietSec = 4,
    private windowSec = 20,
    private maxStrikes = 3,
  ) {}

  /** A hand is at the board right now. */
  handSeen(now: number) {
    this.lastHand = now;
  }

  /** New shift (or the board moved): start trusting again. */
  reset() {
    this.disabled = false;
    this.prev.clear();
    this.strikes = [];
    this.lastHand = -Infinity;
  }

  /**
   * Feed the scanner's raw object cells (before any game filtering). Returns false once
   * object walls should be ignored.
   */
  update(now: number, cells: readonly Cell[], gridW: number): boolean {
    if (this.disabled) return false;
    const cur = new Set(cells.map((c) => c[1] * gridW + c[0]));
    let changed = false;
    for (const k of cur) if (!this.prev.has(k)) changed = true;
    for (const k of this.prev) if (!cur.has(k)) changed = true;
    this.prev = cur;
    if (changed && now - this.lastHand > this.quietSec) this.strikes.push(now);
    this.strikes = this.strikes.filter((t) => now - t < this.windowSec);
    if (this.strikes.length >= this.maxStrikes) this.disabled = true;
    return !this.disabled;
  }
}
