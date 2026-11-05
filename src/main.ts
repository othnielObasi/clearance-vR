import { ReferenceSpaceType, SessionMode, World } from '@iwsdk/core';
import { ClearanceApp } from './game/app';
import { makeClearanceSystem } from './game/system';

const container = document.getElementById('scene') as HTMLDivElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

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

  const xr = navigator.xr;
  const arOK = xr ? await xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  startBtn.disabled = false;
  startBtn.textContent = arOK ? 'Start shift' : 'Start (desktop preview)';
  status.textContent = arOK
    ? 'Sit at a table, put your controllers down, and press Start.'
    : 'No headset detected. Desktop preview: click the buttons above robots to play.';

  startBtn.addEventListener('click', () => {
    app?.sfx.unlock();
    if (arOK) world.launchXR();
    document.body.classList.add('playing');
  });
}

boot().catch((err) => {
  console.error(err);
  status.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
});
