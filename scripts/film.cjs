// Records demo footage in Meta's headset emulator, frame by frame at a steady 30 fps (FPS=60 for smoother).
//
//   npm run build && npm run preview          (in one terminal)
//   node scripts/film.cjs [scene ...]         (in another; needs Playwright and ffmpeg)
//
// A small shim injected before the game loads takes over the page's frame loop and clocks: once
// filming starts, a frame runs only when this script asks for one, and each frame advances time by
// exactly 1/60 s. So the clip is smooth however slowly the machine renders. Emulated hands
// act out each scene through the emulator's remote control. Output: OUT/<scene>.mp4 (default ./film).
// The video must say this is emulator footage (the room is synthetic, not passthrough).

const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.URL ?? 'https://localhost:4173/';
const OUT = path.resolve(process.env.OUT ?? 'film');
const FPS = +(process.env.FPS ?? 30);
const FOV = +(process.env.FOV ?? 58); // vertical, degrees
const SIZE = { width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) };

// Runs in the page before anything else. Until __film.start(), everything is passed through.
const SHIM = () => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realPerf = performance.now.bind(performance);
  const realDate = Date.now;
  let manual = false;
  let now = 0;
  let dateOffset = 0;
  let queue = [];
  let id = 1e6;
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRaf(cb);
    queue.push({ id: ++id, cb });
    return id;
  };
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (h) => {
    queue = queue.filter((q) => q.id !== h);
    realCancel(h);
  };
  performance.now = () => (manual ? now : realPerf());
  Date.now = () => (manual ? Math.round(now + dateOffset) : realDate());
  window.__film = {
    start() {
      now = realPerf();
      dateOffset = realDate() - now;
      manual = true;
    },
    // Advance one frame of `ms` and run everything waiting for it.
    step(ms) {
      now += ms;
      const run = queue;
      queue = [];
      for (const q of run) q.cb(now);
      return run.length;
    },
    pending: () => queue.length,
  };
};

const SCENES = {
  // The board lands on the desk, the ghost hand shows the permit, then a real pinch and drop.
  async firstPermit(s) {
    await s.level(0, { fresh: true });
    await s.film(1.5);
    await s.until(() => window.clearance.ghost?.playing === 'pinch', 20);
    // Film the whole demonstration, then let the player's own hand take over with no more demos.
    await s.filmUntil(() => !window.clearance.ghost?.playing, 12);
    await s.film(0.4);
    await s.page.evaluate(() => {
      window.clearance.learned = new Set(['pinch', 'flick', 'palm', 'wall']);
      window.clearance.ghost?.stop();
    });
    const token = await s.at('token');
    const robot = await s.at('robot', 'r1');
    s.hand('right', 'open', s.add(token, 0, 0.07, 0.03), { fingers: 'forward', palm: 'down' }, 'thumb-tip');
    await s.film(0.6);
    s.hand('right', 'open', s.add(token, 0, 0.012, 0), null, 'thumb-tip', 0.45);
    await s.film(0.5);
    s.pinch('right', true);
    await s.film(0.35);
    s.hand('right', 'pinch', s.add(robot, 0, 0.07, 0), null, 'thumb-tip', 0.9);
    await s.film(1.0);
    s.pinch('right', false);
    await s.film(0.3);
    s.park('right', 0.6);
    await s.film(3.5);
  },

  // Bolt offers a shortcut through the spill; rest a finger on it and flick it away.
  async flick(s) {
    await s.level(0, { learned: ['pinch', 'flick', 'palm', 'wall'] });
    await s.until(() => window.clearance.game.robots.some((r) => r.state === 'proposed' && r.trap), 40);
    await s.film(1.2);
    const id = await s.page.evaluate(() => window.clearance.game.robots.find((r) => r.trap).id);
    const mid = await s.at('path', id, 2);
    s.hand('right', 'point', s.add(mid, -0.02, 0.06, 0.04), { fingers: 'forward', palm: 'down' }, 'index-tip', 0);
    await s.film(0.4);
    s.hand('right', 'point', s.add(mid, 0, 0.012, 0), null, 'index-tip', 0.4);
    await s.film(0.7);
    s.hand('right', 'point', s.add(mid, 0.3, 0.02, 0), null, 'index-tip', 0.15);
    await s.film(0.6);
    s.park('right', 0.6);
    await s.film(2.5);
  },

  // A robot heads for a worker; hold up a palm and it brakes.
  async palmStop(s) {
    await s.level(1, { learned: ['pinch', 'flick', 'palm', 'wall'] });
    await s.until(() => window.clearance.game.robots.some((r) => r.state === 'proposed'), 30);
    await s.page.evaluate(() => {
      const g = window.clearance.game;
      const r = g.robots.find((x) => x.state === 'proposed');
      const p = g.dispensePermit();
      g.grant(p.id, r.id);
    });
    await s.film(1.2);
    const id = await s.page.evaluate(() => window.clearance.game.robots.find((r) => r.state === 'executing').id);
    const r = await s.at('robot', id);
    const head = await s.at('head');
    const toward = s.norm({ x: head.x - r.x, y: 0, z: head.z - r.z });
    s.hand('left', 'open', s.add(r, toward.x * 0.2, 0.1, toward.z * 0.2), { fingers: 'up', palm: [-toward.x, 0, -toward.z] }, 'wrist', 0.5);
    await s.film(2.4);
    s.park('left', 0.6);
    await s.film(2);
  },

  // Close the aisle with a flat hand: waiting robots plan round it.
  async handWall(s) {
    await s.level(5, { learned: ['pinch', 'flick', 'palm', 'wall'] });
    await s.until(() => window.clearance.game.robots.some((r) => r.state === 'proposed'), 30);
    await s.film(1);
    const c = await s.at('cell', 6, 3);
    s.hand('left', 'flat', s.add(c, 0, 0.12, 0.05), { fingers: 'forward', palm: 'down' }, 'wrist', 0.6);
    await s.film(0.7);
    s.hand('left', 'flat', s.add(c, 0, 0.035, 0.05), null, 'wrist', 0.5);
    await s.film(4);
    s.park('left', 0.7);
    await s.film(2);
  },

  // Standing clearance: hand the gold permit to Pip, who works alone inside a gold halo.
  async gold(s) {
    await s.level(4, { learned: ['pinch', 'flick', 'palm', 'wall'] });
    await s.until(() => window.clearance.goldReady && window.clearance.game.robot('r1')?.state === 'proposed', 30);
    await s.film(1);
    const gold = await s.page.evaluate(() => {
      const a = window.clearance;
      const v = a.goldReady.entity.object3D.getWorldPosition(new (a.tmp.constructor)());
      return { x: v.x, y: v.y, z: v.z };
    });
    const pip = await s.at('robot', 'r1');
    s.hand('right', 'open', s.add(gold, 0, 0.07, 0.03), { fingers: 'forward', palm: 'down' }, 'thumb-tip', 0);
    await s.film(0.5);
    s.hand('right', 'open', s.add(gold, 0, 0.012, 0), null, 'thumb-tip', 0.45);
    await s.film(0.5);
    s.pinch('right', true);
    await s.film(0.35);
    s.hand('right', 'pinch', s.add(pip, 0, 0.08, 0), null, 'thumb-tip', 1);
    await s.film(1.1);
    s.pinch('right', false);
    await s.film(0.3);
    s.park('right', 0.6);
    await s.film(6);
  },
};

async function makeStage(page, sceneDir) {
  let frame = 0;
  let sway = 0;
  const remote = (method, params) =>
    // Not awaited: with the clock paused the emulator applies it on the next frame we advance.
    page.evaluate(([m, p]) => void window.xrdevice.remote.dispatch(m, p), [method, params]);
  const s = {
    page,
    add: (p, x = 0, y = 0, z = 0) => ({ x: p.x + x, y: p.y + y, z: p.z + z }),
    norm: (v) => {
      const l = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    },
    at: (what, ...args) =>
      page.evaluate(
        ([w, a]) => {
          const app = window.clearance;
          const V = app.tmp.constructor;
          const o = (v) => ({ x: v.x, y: v.y, z: v.z });
          if (w === 'token') return o(app.ready.entity.object3D.getWorldPosition(new V()));
          if (w === 'robot') return o(app.view.robotWorld(a[0], new V()));
          if (w === 'head') return o(app.world.player.head.getWorldPosition(new V()));
          if (w === 'cell') return o(app.view.content.localToWorld(app.view.cellToLocal(a[0], a[1], new V())));
          if (w === 'path') {
            const p = app.view.pathWorld(app.game.robot(a[0]));
            return o(p[Math.min(a[1], p.length - 1)]);
          }
        },
        [what, args],
      ),
    hand: (side, pose, position, orientation, anchor = 'wrist', duration = 0) => {
      remote('set_hand_pose', { device: `hand-${side}`, poseId: pose, duration: Math.min(0.2, duration || 0.15) });
      const t = { device: `hand-${side}`, anchor, position, ...(orientation ? { orientation } : {}) };
      remote(duration ? 'animate_to' : 'set_transform', duration ? { ...t, duration } : t);
    },
    pinch: (side, on) => {
      remote('set_hand_pose', { device: `hand-${side}`, poseId: on ? 'pinch' : 'open', duration: 0.12 });
      remote('set_select_value', { device: `hand-${side}`, value: on ? 1 : 0 });
    },
    park: async (side, duration = 0) => {
      const h = await s.at('head');
      const t = { device: `hand-${side}`, position: { x: h.x + (side === 'left' ? -0.4 : 0.4), y: h.y - 0.8, z: h.z + 0.25 }, orientation: 'auto' };
      remote(duration ? 'animate_to' : 'set_transform', duration ? { ...t, duration } : t);
    },
    // Advance game time without recording (waiting for something to happen).
    until: async (pred, maxSec) => {
      for (let t = 0; t < maxSec * 10; t++) {
        if (await page.evaluate(`(${pred.toString()})()`)) return true;
        await s.advance(1, 100); // fast-forward in 0.1 s steps while nothing is being recorded
      }
      throw new Error(`timed out waiting for ${pred}`);
    },
    // Record until a condition holds (checked every frame), at most `maxSec`.
    filmUntil: async (pred, maxSec) => {
      for (let i = 0; i < maxSec * FPS; i++) {
        if (await page.evaluate(`(${pred.toString()})()`)) return;
        await s.film(1 / FPS);
      }
    },
    // Record `sec` seconds of footage.
    film: async (sec) => {
      for (let i = 0; i < Math.max(1, Math.round(sec * FPS)); i++) {
        // A seated person's head is never perfectly still.
        sway += 1 / FPS;
        await page.evaluate((t) => {
          const d = window.xrdevice;
          d.position.x = d.__seat.x + Math.sin(t * 0.7) * 0.012;
          d.position.y = d.__seat.y + Math.sin(t * 1.1) * 0.006;
          // ?debug is needed to drive the game, but its tuning panel stays out of shot.
          if (window.clearance.debug) window.clearance.debug.mesh.visible = false;
        }, sway);
        await s.advance(1);
        await page.screenshot({ path: path.join(sceneDir, `${String(frame++).padStart(5, '0')}.png`) });
      }
    },
    level: async (index, { fresh = false, learned = [] } = {}) => {
      await page.evaluate(
        ([i, fresh, l]) => {
          const a = window.clearance;
          a.learned = new Set(fresh ? [] : l);
          a.loadLevel(i); // also resets the coach line
        },
        [index, fresh, learned],
      );
      await s.park('left');
      await s.park('right');
      await s.advance(5, 100);
    },
    // Run n frames of 1/60 s each. Frames scheduled by the real clock before filming started are
    // still in flight for a moment, so wait for them to land in the queue.
    advance: async (n, ms = 1000 / FPS) => {
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 200 && !(await page.evaluate(() => window.__film.pending())); tries++) await page.waitForTimeout(5);
        await page.evaluate((ms) => window.__film.step(ms), ms);
      }
    },
  };
  return s;
}

(async () => {
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(SCENES);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  for (const name of names) {
    const sceneDir = path.join(OUT, name);
    fs.rmSync(sceneDir, { recursive: true, force: true });
    fs.mkdirSync(sceneDir, { recursive: true });
    const page = await browser.newPage({ viewport: SIZE, ignoreHTTPSErrors: true });
    await page.addInitScript(SHIM);
    await page.goto(`${URL}?debug&emulate&nocontrols`);
    await page.waitForFunction(() => window.clearance && !document.getElementById('start').disabled, null, { timeout: 180000 });
    // Clicked from inside the page: launching the session can keep the page busy longer than a click allows.
    await page.evaluate(() => document.getElementById('start').click());
    await page.waitForFunction(() => window.clearance.world.renderer.xr.getSession?.(), null, { timeout: 60000 });
    // Take over time only now, once the session is running.
    await page.evaluate(() => window.__film.start());
    const stage = await makeStage(page, sceneDir);
    // Let the board find the desk before rolling.
    await stage.advance(15, 100);
    // Frame the shot: look at the board and narrow the field of view, like a close-up lens.
    // A Quest sees much wider; this is only so the board fills a video frame.
    await page.evaluate((fov) => {
      const a = window.clearance;
      const d = window.xrdevice;
      const V = a.tmp.constructor;
      const M = a.world.camera.matrix.constructor;
      const Q = a.world.camera.quaternion.constructor;
      const target = a.view.content.getWorldPosition(new V()).add(new V(0, 0.02, 0));
      const eye = new V(d.position.x, d.position.y, d.position.z);
      const q = new Q().setFromRotationMatrix(new M().lookAt(eye, target, new V(0, 1, 0)));
      d.quaternion.set(q.x, q.y, q.z, q.w);
      d.fovy = (fov * Math.PI) / 180;
      // The synthetic room's monitor overhangs the board; its stand would read as an object.
      a.scanObjects = false;
      a.scanner.cells = [];
      a.scanner.obstructed = false;
      d.__seat = { x: d.position.x, y: d.position.y };
    }, FOV);
    await stage.advance(3, 100);
    console.log(`filming ${name}`);
    await SCENES[name](stage);
    await page.close();
    const mp4 = path.join(OUT, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(sceneDir, '%05d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', mp4]);
    console.log(`  -> ${mp4}`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
