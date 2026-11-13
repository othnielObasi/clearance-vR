/**
 * Keeps the game smooth on hardware we could not test: if the frame rate stays below
 * the target for a few seconds in the headset, step down one level of cost.
 *
 *   0  everything on
 *   1  fixed foveated rendering at maximum (the Quest renders the edges of view at lower resolution)
 *   2  depth scanning for real objects off
 *   3  particle effects off
 *
 * It never steps back up during a session, so it cannot flip-flop.
 */
export const MAX_PERF_LEVEL = 3;

export class PerfGuard {
  level = 0;
  /** Smoothed seconds per frame. */
  private avg: number;
  private slow = 0;
  private warm = 0;

  constructor(
    private targetFps = 60,
    private holdSec = 3,
    private warmupSec = 4,
  ) {
    this.avg = 1 / targetFps;
  }

  /** Smoothed frames per second (for the debug panel). */
  get fps() {
    return 1 / this.avg;
  }

  /**
   * Feed one frame. `active` is false outside the headset or while paused.
   * Returns true when the level just went up.
   */
  sample(dt: number, active: boolean): boolean {
    if (!active) {
      this.warm = 0;
      this.slow = 0;
      return false;
    }
    // Loading, entering the headset and system menus cause one-off hitches: ignore them.
    this.warm += dt;
    if (this.warm < this.warmupSec || dt > 0.25) return false;
    this.avg += (dt - this.avg) * 0.05;
    if (this.fps < this.targetFps - 2) this.slow += dt;
    else this.slow = Math.max(0, this.slow - dt * 0.5);
    if (this.slow < this.holdSec || this.level >= MAX_PERF_LEVEL) return false;
    this.level++;
    // Measure the new level afresh.
    this.slow = 0;
    this.avg = 1 / this.targetFps;
    return true;
  }
}
