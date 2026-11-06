import './landing.css';
import { ReferenceSpaceType, SessionMode, World } from '@iwsdk/core';
import qrcode from 'qrcode-generator';
import { dailySeed } from './core/rng';
import { ClearanceApp } from './game/app';
import { loadProgress, overtimeBest, streakEnding } from './game/progress';
import { makeClearanceSystem } from './game/system';
import { LEVELS } from './levels';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const body = document.body;
const container = $<HTMLDivElement>('scene');
const startBtn = $<HTMLButtonElement>('start');
const dailyBtn = $<HTMLButtonElement>('daily');
const overtimeBtn = $<HTMLButtonElement>('overtime');
const status = $<HTMLParagraphElement>('status');

// The address to open on a headset: this page, without any test flags.
const pageUrl = `${location.origin}${location.pathname}`;
const urlLink = $<HTMLAnchorElement>('url');
urlLink.href = pageUrl;
urlLink.textContent = pageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
const qr = qrcode(0, 'M');
qr.addData(pageUrl);
qr.make();
$<HTMLDivElement>('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

// Decide early whether we're on a headset, so the page can lead with the buttons.
const arCheck: Promise<boolean> = navigator.xr ? navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : Promise.resolve(false);
void arCheck.then((ok) => body.classList.toggle('xr', ok));

let app: ClearanceApp | undefined;

async function boot() {
  const world = await World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      referenceSpace: { type: ReferenceSpaceType.LocalFloor, fallbackOrder: [ReferenceSpaceType.Local] },
      features: { handTracking: { required: false }, hitTest: { required: false }, anchors: { required: false }, planeDetection: false },
      offer: 'none',
    },
    render: { near: 0.01, far: 20, camera: { position: [0, 1.21, 0.04], lookAt: [0, 0.89, -0.5] } },
    features: { grabbing: { useHandPinchForGrab: true }, locomotion: false },
  });
  world.registerSystem(makeClearanceSystem(() => app));
  app = new ClearanceApp(world);
  // ?debug exposes the app for automated browser tests and playtest tooling.
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { clearance: app });

  const arOK = await arCheck;
  const progress = loadProgress();
  const next = Math.min(progress.unlocked, LEVELS.length - 1);
  const streak = streakEnding(String(dailySeed()));
  const best = overtimeBest();
  startBtn.disabled = dailyBtn.disabled = overtimeBtn.disabled = false;
  if (arOK) startBtn.textContent = next > 0 ? `Continue: level ${next + 1}` : 'Start shift';
  else startBtn.textContent = next > 0 ? `Continue the preview: level ${next + 1}` : 'Play the preview';
  dailyBtn.textContent = streak > 1 ? `Daily Shift, ${streak}-day streak` : 'Daily Shift';
  overtimeBtn.textContent = best > 0 ? `Overtime, best ${best}` : 'Overtime';
  status.textContent = arOK
    ? 'Sit at a table and put your controllers down. Your hands do everything.'
    : 'No headset here, so this opens a preview you play with your mouse by clicking the buttons above each robot. For the real thing, open this page on a Quest.';

  const go = (mode: 'campaign' | 'daily' | 'overtime') => {
    app?.sfx.unlock();
    if (mode === 'daily') app?.loadDaily();
    else if (mode === 'overtime') app?.loadOvertime();
    else app?.loadLevel(next);
    body.classList.remove('result');
    body.classList.add('playing');
    window.scrollTo(0, 0);
    if (arOK) {
      body.classList.add('in-xr');
      world.launchXR();
    }
  };
  startBtn.addEventListener('click', () => go('campaign'));
  dailyBtn.addEventListener('click', () => go('daily'));
  overtimeBtn.addEventListener('click', () => go('overtime'));

  // Desktop preview: back to the page, with the shift paused.
  $<HTMLButtonElement>('back').addEventListener('click', () => {
    if (app && !app.userPaused && app.game.status === 'playing') app.togglePause();
    body.classList.remove('playing', 'result');
  });

  app.onDailyResult = (text) => {
    $<HTMLPreElement>('shareText').textContent = text;
    $<HTMLButtonElement>('copy').textContent = 'Copy result';
    // On desktop the card appears over the board; in the headset, when the player takes it off.
    body.classList.add('result');
  };
  app.onExitXR = () => body.classList.remove('playing', 'in-xr');
  $<HTMLButtonElement>('copy').addEventListener('click', async () => {
    await navigator.clipboard?.writeText($<HTMLPreElement>('shareText').textContent ?? '').catch(() => {});
    $<HTMLButtonElement>('copy').textContent = 'Copied';
  });
  $<HTMLButtonElement>('again').addEventListener('click', () => body.classList.remove('result'));
}

boot().catch((err) => {
  console.error(err);
  status.textContent = `The game could not start in this browser: ${err instanceof Error ? err.message : String(err)}. Try the Meta Quest Browser or a recent Chrome.`;
});
