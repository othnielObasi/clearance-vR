import { ReferenceSpaceType, SessionMode, World } from '@iwsdk/core';
import { LEVELS } from './levels';
import { ClearanceApp } from './game/app';
import { loadProgress, streakEnding } from './game/progress';
import { makeClearanceSystem } from './game/system';
import { dailySeed } from './core/rng';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const container = $<HTMLDivElement>('scene');
const startBtn = $<HTMLButtonElement>('start');
const dailyBtn = $<HTMLButtonElement>('daily');
const status = $<HTMLParagraphElement>('status');

let app: ClearanceApp | undefined;

async function boot() {
  const world = await World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      referenceSpace: { type: ReferenceSpaceType.LocalFloor, fallbackOrder: [ReferenceSpaceType.Local] },
      features: { handTracking: { required: false }, hitTest: false, planeDetection: false, anchors: false },
      offer: 'none',
    },
    render: { near: 0.01, far: 20, camera: { position: [0, 1.25, 0.15], lookAt: [0, 0.9, -0.45] } },
    features: { grabbing: { useHandPinchForGrab: true }, locomotion: false },
  });
  world.registerSystem(makeClearanceSystem(() => app));
  app = new ClearanceApp(world);
  // ?debug exposes the app for automated browser tests and playtest tooling.
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { clearance: app });

  const xr = navigator.xr;
  const arOK = xr ? await xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  const progress = loadProgress();
  const next = Math.min(progress.unlocked, LEVELS.length - 1);
  const streak = streakEnding(String(dailySeed()));
  startBtn.disabled = dailyBtn.disabled = false;
  startBtn.textContent = next > 0 ? `Continue: level ${next + 1}` : 'Start shift';
  dailyBtn.textContent = streak > 1 ? `Daily Shift · ${streak}-day streak` : 'Daily Shift';
  status.textContent = arOK
    ? 'Sit at a table, put your controllers down, and press Start.'
    : 'No headset detected. Desktop preview: click the buttons above robots to play.';

  const go = (daily: boolean) => {
    app?.sfx.unlock();
    if (daily) app?.loadDaily();
    else app?.loadLevel(next);
    document.body.classList.remove('result');
    document.body.classList.add('playing');
    if (arOK) world.launchXR();
  };
  startBtn.addEventListener('click', () => go(false));
  dailyBtn.addEventListener('click', () => go(true));

  app.onDailyResult = (text) => {
    $<HTMLPreElement>('shareText').textContent = text;
    document.body.classList.add('result');
    // On desktop show it now; in the headset it appears when the player takes it off.
    if (!world.session) document.body.classList.remove('playing');
  };
  app.onExitXR = () => document.body.classList.remove('playing');
  $<HTMLButtonElement>('copy').addEventListener('click', async () => {
    await navigator.clipboard?.writeText($<HTMLPreElement>('shareText').textContent ?? '').catch(() => {});
    $<HTMLButtonElement>('copy').textContent = 'Copied';
  });
  $<HTMLButtonElement>('again').addEventListener('click', () => document.body.classList.remove('result'));
}

boot().catch((err) => {
  console.error(err);
  status.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
});
