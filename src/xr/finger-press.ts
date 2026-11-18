/**
 * Fingertip presses, detected by the game itself from tracked hand joints.
 *
 * On a Quest the toolkit's own poke pointer did not register touches on the small buttons above
 * the robots, so players could not use the fallback controls at all. This does not replace the
 * toolkit pointer (presses from either are de-duplicated by the button's cooldown); it makes a
 * fingertip that reaches a visible button press it, whatever the toolkit does.
 *
 * Rules, chosen so a resting or passing hand does not press by accident:
 * - press when the fingertip comes within `reach` of the button's surface (centre distance minus
 *   its radius); a target may ask for a shorter reach (the stop buttons over moving robots);
 * - one button per fingertip: the nearest one in reach, never every button it is close to. The
 *   ✓ ✗ ■ buttons sit in tight clusters and a headset recording showed one reach blocking work;
 * - only for buttons that have been visible for `settle` seconds, so a hand sweeping in does not
 *   press a button that has only just appeared under it;
 * - once per touch: the same fingertip must move `release` beyond the press distance before that
 *   button can be pressed again, and while it is still on a button it cannot press a neighbour.
 */
import type { Vector3 } from 'three';

export interface PressTarget {
  id: number;
  /** World-space centre. */
  center: Vector3;
  /** World-space radius of the button face. */
  radius: number;
  visible: boolean;
  /** Press distance for this button, if shorter than `FINGER_PRESS.reach`. */
  reach?: number;
}

export interface Fingertip {
  side: 'left' | 'right';
  tip: Vector3;
}

export const FINGER_PRESS = {
  reach: 0.015,
  release: 0.012,
  settle: 0.25,
  /** Reach for buttons that cost the player when pressed by mistake (stopping a robot). */
  carefulReach: 0.009,
};

export class FingerPress {
  private visibleFor = new Map<number, number>();
  /** Per fingertip, the button it is still touching after pressing it. */
  private touching = new Map<string, number>();

  /** Advance by `dt` seconds; returns the ids of buttons newly pressed this frame. */
  update(dt: number, tips: Fingertip[], targets: PressTarget[]): number[] {
    const seen = new Set<number>();
    for (const t of targets) {
      seen.add(t.id);
      if (t.visible) this.visibleFor.set(t.id, (this.visibleFor.get(t.id) ?? 0) + dt);
      else this.visibleFor.delete(t.id);
    }
    for (const id of this.visibleFor.keys()) if (!seen.has(id)) this.visibleFor.delete(id);

    const pressed: number[] = [];
    for (const { side, tip } of tips) {
      // Still on the button it pressed: wait for the finger to lift clear of it.
      const held = this.touching.get(side);
      if (held !== undefined) {
        const t = targets.find((x) => x.id === held);
        const gap = t && t.visible ? tip.distanceTo(t.center) - t.radius : Infinity;
        if (gap <= (t?.reach ?? FINGER_PRESS.reach) + FINGER_PRESS.release) continue;
        this.touching.delete(side);
      }
      let best: PressTarget | undefined;
      let bestGap = Infinity;
      for (const t of targets) {
        if (!t.visible || (this.visibleFor.get(t.id) ?? 0) < FINGER_PRESS.settle) continue;
        const gap = tip.distanceTo(t.center) - t.radius;
        if (gap <= (t.reach ?? FINGER_PRESS.reach) && gap < bestGap) [best, bestGap] = [t, gap];
      }
      if (!best) continue;
      this.touching.set(side, best.id);
      if (!pressed.includes(best.id)) pressed.push(best.id);
    }
    return pressed;
  }
}
