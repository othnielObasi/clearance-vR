import './landing.css';
import { DepthSensingSystem, ReferenceSpaceType, SessionMode, World } from '@iwsdk/core';
import qrcode from 'qrcode-generator';
import { dailySeed } from './core/rng';
import { ClearanceApp } from './game/app';
import { GestureLog } from './game/gesture-log';
import { CoopLink } from './net/coop';
import { SERVER_URL } from './net/server';
import { overtimeBest, streakEnding } from './game/progress';
import { makeClearanceSystem } from './game/system';

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

// ?emulate swaps in Meta's headset emulator (an emulated Quest 3 with hands in a synthetic room),
// for testing and filming without a headset. It must be installed before anything asks navigator.xr.
const params = new URLSearchParams(location.search);
if (params.has('emulate')) {
  const { installEmulator } = await import('./dev/emulate');
  await installEmulator(params.get('emulate') || undefined, !params.has('nocontrols'));
}

// Decide early whether we're on a headset, so the page can lead with the buttons.
const arCheck: Promise<boolean> = navigator.xr ? navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : Promise.resolve(false);
void arCheck.then((ok) => body.classList.toggle('xr', ok));

let app: ClearanceApp | undefined;

async function boot() {
  const world = await World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      referenceSpace: { type: ReferenceSpaceType.LocalFloor, fallbackOrder: [ReferenceSpaceType.Local] },
      // All optional: the game still runs where a browser lacks any of them.
      // Planes find the real table; depth lets real objects on the board act as walls.
      features: {
        handTracking: { required: false },
        hitTest: { required: false },
        anchors: { required: false },
        planeDetection: { required: false },
        depthSensing: { required: false, usage: 'gpu-optimized', format: 'float32' },
      },
      offer: 'none',
    },
    render: { near: 0.01, far: 20, camera: { position: [0, 1.21, 0.04], lookAt: [0, 0.89, -0.5] } },
    features: { grabbing: { useHandPinchForGrab: true }, locomotion: false },
  });
  // Depth data for the object scanner. Occlusion (real things hiding robots) is off by default
  // until it has been checked on a headset; `?occlusion` turns it on for testing.
  world.registerSystem(DepthSensingSystem, { configData: { enableOcclusion: true, enableDepthTexture: true, useFloat32: true } });
  world.registerSystem(makeClearanceSystem(() => app));
  app = new ClearanceApp(world);
  // Real hands show through passthrough and hide the board behind them; the emulator, which has no
  // passthrough, draws them instead (?occluders shows the headset behaviour in the emulator).
  app.setupHands(params.has('emulate') && !params.has('occluders'));
  // ?debug exposes the app for automated browser tests and playtest tooling.
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { clearance: app });

  const arOK = await arCheck;
  const done = app.campaignDone();
  const next = app.campaignStart();
  const streak = streakEnding(String(dailySeed()));
  const best = overtimeBest();
  startBtn.disabled = dailyBtn.disabled = overtimeBtn.disabled = false;
  if (arOK) startBtn.textContent = done ? 'Replay the campaign' : next > 0 ? `Continue: level ${next + 1}` : 'Start shift';
  else startBtn.textContent = done ? 'Replay the preview' : next > 0 ? `Continue the preview: level ${next + 1}` : 'Play the preview';
  dailyBtn.textContent = streak > 1 ? `Daily Shift, ${streak}-day streak` : 'Daily Shift';
  overtimeBtn.textContent = best > 0 ? `Overtime, best ${best}` : 'Overtime';

  // Assist mode: the same setting as the Assist pill in the headset's pause menu.
  const assistBtn = $<HTMLButtonElement>('assist');
  const showAssist = (on: boolean) => {
    assistBtn.textContent = on ? 'Assist: on' : 'Assist: off';
    assistBtn.setAttribute('aria-pressed', String(on));
  };
  showAssist(app.assist);
  assistBtn.disabled = false;
  assistBtn.addEventListener('click', () => {
    app?.setAssist(!app.assist);
    showAssist(!!app?.assist);
  });
  app.onAssistChange = showAssist;

  // Play together: host a room (get a code) or join a friend's room with theirs.
  const coopBtn = $<HTMLButtonElement>('coop');
  let link: CoopLink | undefined;
  const showCoop = () => {
    if (!link) {
      coopBtn.textContent = 'Play together';
      return;
    }
    coopBtn.textContent = `Leave room ${link.code}`;
    status.textContent =
      link.role === 'host'
        ? `Room ${link.code}. ${link.partner ? 'Your partner is connected.' : 'Tell your partner this code.'} Press Start shift when ready; you pick the shift.`
        : `Joined room ${link.code}. Press Start shift to go in; the host picks the shift.`;
  };
  coopBtn.hidden = !SERVER_URL;
  coopBtn.disabled = false;
  coopBtn.addEventListener('click', async () => {
    if (link) {
      app?.leaveCoop();
      link = undefined;
      status.textContent = 'Left the room. Playing solo.';
      return showCoop();
    }
    const code = window.prompt('Play together. To join a friend, type their 4-letter room code. To host, leave it empty and press OK.', '');
    if (code === null) return;
    const role = code.trim() ? 'guest' : 'host';
    status.textContent = role === 'host' ? 'Opening a room…' : `Joining room ${code.trim().toUpperCase()}…`;
    try {
      link = await CoopLink.open(role, code.trim());
      app?.attachCoop(link);
      const appChange = link.onChange;
      link.onChange = () => {
        appChange?.();
        showCoop();
      };
      showCoop();
    } catch (e) {
      link = undefined;
      status.textContent = e instanceof Error ? e.message : 'Could not start co-op.';
      showCoop();
    }
  });
  app.onCoopEnd = (why) => {
    link = undefined;
    status.textContent = why;
    showCoop();
  };
  status.textContent = arOK
    ? 'Sit at a table and put your controllers down. Your hands do everything.'
    : 'No headset here, so this opens a preview you play with your mouse by clicking the buttons above each robot. For the real thing, open this page on a Quest.';

  const go = (mode: 'campaign' | 'daily' | 'overtime') => {
    app?.sfx.unlock();
    // A co-op guest plays the host's shift, which arrives over the connection.
    if (app?.isGuest) {
      /* nothing to load */
    } else if (mode === 'daily') app?.loadDaily();
    else if (mode === 'overtime') app?.loadOvertime();
    else app?.loadLevel(app.campaignStart());
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
  app.onExitXR = () => {
    app?.gestureLog.save();
    body.classList.remove('playing', 'in-xr');
    showReport();
  };

  // Testers: open with ?debug, play a shift, take the headset off (or come back to this page),
  // then copy the gesture report and send it. It never leaves the device by itself.
  function showReport() {
    if (!params.has('debug')) return;
    const text = GestureLog.saved();
    if (!text) return;
    let box = document.getElementById('report');
    if (!box) {
      box = document.createElement('section');
      box.id = 'report';
      box.className = 'block report';
      box.innerHTML = '<h2>Test report</h2><p class="intro">Thanks for testing. Copy this and send it back.</p><pre></pre><button class="permit" type="button">Copy test report</button>';
      document.querySelector('.hero')?.after(box);
      const btn = box.querySelector('button')!;
      btn.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(box!.querySelector('pre')!.textContent ?? '').catch(() => {});
        btn.textContent = 'Copied';
      });
    }
    box.querySelector('pre')!.textContent = text;
  }
  showReport();
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
