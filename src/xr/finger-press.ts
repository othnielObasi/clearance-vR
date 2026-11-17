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
 *   its radius);
 * - only for buttons that have been visible for `settle` seconds, so a hand sweeping in does not
 *   press a button that has only just appeared under it;
 * - once per touch: the same fingertip must move `release` beyond the press distance before that
 *   button can be pressed again.
 */
import type { Vector3 } from 'three';

export interface PressTarget {
  id: number;
  /** World-space centre. */
  center: Vector3;
  /** World-space radius of the button face. */
  radius: number;
  visible: boolean;
}

export interface Fingertip {
  side: 'left' | 'right';
  tip: Vector3;
}

export const FINGER_PRESS = {
  reach: 0.015,
  release: 0.012,
  settle: 0.25,
};

export class FingerPress {
  private visibleFor = new Map<number, number>();
  private touching = new Set<string>();

  /** Advance by `dt` seconds; returns the ids of buttons newly pressed this frame. */
  update(dt: number, tips: Fingertip[], targets: PressTarget[]): number[] {
    const pressed: number[] = [];
    const seen = new Set<number>();
    for (const t of targets) {
      seen.add(t.id);
      if (!t.visible) {
        this.visibleFor.delete(t.id);
        for (const tip of tips) this.touching.delete(`${tip.side}:${t.id}`);
        continue;
      }
      const shownFor = (this.visibleFor.get(t.id) ?? 0) + dt;
      this.visibleFor.set(t.id, shownFor);
      for (const { side, tip } of tips) {
        const key = `${side}:${t.id}`;
        const gap = tip.distanceTo(t.center) - t.radius;
        if (this.touching.has(key)) {
          if (gap > FINGER_PRESS.reach + FINGER_PRESS.release) this.touching.delete(key);
          continue;
        }
        if (gap <= FINGER_PRESS.reach && shownFor >= FINGER_PRESS.settle) {
          this.touching.add(key);
          if (!pressed.includes(t.id)) pressed.push(t.id);
        }
      }
    }
    for (const id of this.visibleFor.keys()) if (!seen.has(id)) this.visibleFor.delete(id);
    return pressed;
  }
}
