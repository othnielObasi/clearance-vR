import { afterEach, expect, it, vi } from 'vitest';
import { enterXR } from '../src/game/entry';

afterEach(() => vi.useRealTimers());

it('waits for the actual XR session rather than the void launch return', async () => {
  vi.useFakeTimers();
  const world = { session: null as unknown, sessionRequestPending: false, launchXR() { this.sessionRequestPending = true; } };
  let entered = false;
  const pending = enterXR(world).then(() => { entered = true; });
  await vi.advanceTimersByTimeAsync(100);
  expect(entered).toBe(false);
  world.session = {};
  world.sessionRequestPending = false;
  await vi.advanceTimersByTimeAsync(50);
  await pending;
  expect(entered).toBe(true);
});

it('rejects when the SDK finishes a denied session request', async () => {
  vi.useFakeTimers();
  const world = { session: null, sessionRequestPending: false, launchXR() { this.sessionRequestPending = true; } };
  const result = expect(enterXR(world)).rejects.toThrow('cancelled or unavailable');
  world.sessionRequestPending = false;
  await vi.advanceTimersByTimeAsync(50);
  await result;
});
