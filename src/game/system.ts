import { createSystem, Grabbed, Pressed } from '@iwsdk/core';
import type { ClearanceApp } from './app';

/** Bridges the IWSDK ECS frame loop and grab/press events into the app. */
export function makeClearanceSystem(getApp: () => ClearanceApp | undefined) {
  return class ClearanceSystem extends createSystem({
    grabbed: { required: [Grabbed] },
    pressed: { required: [Pressed] },
  }) {
    init() {
      this.queries.grabbed.subscribe('qualify', (e) => getApp()?.onGrab(e));
      this.queries.grabbed.subscribe('disqualify', (e) => getApp()?.onRelease(e));
      this.queries.pressed.subscribe('qualify', (e) => getApp()?.onPress(e));
    }

    update(delta: number) {
      const world = this.world;
      getApp()?.frame(delta, world.xrFrame, world.xrReferenceSpace);
    }
  };
}
