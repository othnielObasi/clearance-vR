import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { detachToolkitHands } from '../src/xr/hand-model';

/**
 * Regression: on a Quest the toolkit re-showed its own hand models every frame, so players saw
 * stiff, generic hands over their real ones. A fake adapter reproduces the toolkit's per-frame
 * `visual.model.visible = isPrimary && tracked`.
 */
function fakeToolkit() {
  const playerSpace = new Object3D();
  const make = () => {
    const model = new Object3D();
    playerSpace.add(model);
    return { visual: { model } };
  };
  const adapters = { left: make(), right: make() };
  const toolkitFrame = () => {
    for (const a of Object.values(adapters)) a.visual.model.visible = true;
  };
  const drawnHands = () => {
    const drawn: Object3D[] = [];
    playerSpace.traverseVisible((o) => o !== playerSpace && drawn.push(o));
    return drawn;
  };
  return { playerSpace, adapters, toolkitFrame, drawnHands };
}

describe('toolkit hand models', () => {
  it('stay hidden although the toolkit makes them visible every frame', () => {
    const t = fakeToolkit();
    for (let frame = 0; frame < 5; frame++) {
      t.toolkitFrame();
      detachToolkitHands(t.adapters);
      t.toolkitFrame(); // the toolkit runs again before the next render
      expect(t.drawnHands()).toHaveLength(0);
    }
  });

  it('are hidden again when the toolkit recreates a visual on reconnect', () => {
    const t = fakeToolkit();
    detachToolkitHands(t.adapters);
    const fresh = new Object3D();
    t.playerSpace.add(fresh);
    t.adapters.left.visual.model = fresh;
    detachToolkitHands(t.adapters);
    expect(fresh.parent).toBeNull();
  });

  it('copes with visuals that have not loaded yet', () => {
    expect(() => detachToolkitHands({ left: {}, right: undefined })).not.toThrow();
    expect(() => detachToolkitHands(undefined)).not.toThrow();
  });
});
