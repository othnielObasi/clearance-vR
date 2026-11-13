// End-to-end hand-gesture test in Meta's headset emulator (no Quest needed).
//
//   npm run build && npm run preview      (in one terminal)
//   npm run test:hands                    (in another; needs Playwright: npx playwright install chromium)
//
// It opens the game with ?emulate, enters the mixed-reality session at the emulated desk, and drives
// the emulated hands through every gesture, checking that the game reacts: pinch a permit and drop it
// on a robot, open palm to stop it, flick to reject a plan, a flat hand as a wall, palm up for the
// pause button, and both palms up to stop everything. Screenshots go to the folder given by SHOTS.

const { chromium } = require('playwright');

const URL = process.env.URL ?? 'https://localhost:4173/';
const SHOTS = process.env.SHOTS;
const results = [];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${URL}?debug&emulate&nocontrols`);
  await page.waitForFunction(() => window.clearance && !document.getElementById('start').disabled, null, { timeout: 90000 });
  await page.evaluate(() => document.getElementById('start').click());
  await page.waitForFunction(() => window.clearance.world.renderer.xr.getSession?.(), null, { timeout: 30000 });

  // Record game events, and give the test simple helpers that run inside the page.
  await page.evaluate(() => {
    const a = window.clearance;
    const V = a.tmp.constructor;
    window.events = [];
    const stopAll = a.stopAll.bind(a);
    a.stopAll = () => {
      window.events.push('stopAll');
      stopAll();
    };
    const orig = a.onGameEvent.bind(a);
    a.onGameEvent = (e) => {
      window.events.push(e.type);
      orig(e);
    };
    const v3 = (v) => ({ x: v.x, y: v.y, z: v.z });
    window.T = {
      remote: (method, params) => window.xrdevice.remote.dispatch(method, params),
      robot: (id) => v3(a.view.robotWorld(id, new V())),
      path: (id) => a.view.pathWorld(a.game.robot(id)).map(v3),
      token: () => (a.ready ? v3(a.ready.entity.object3D.getWorldPosition(new V())) : null),
      board: () => {
        const c = a.view.content;
        return { centre: v3(c.getWorldPosition(new V())), up: v3(new V(0, 1, 0).applyQuaternion(c.getWorldQuaternion(c.quaternion.clone()))) };
      },
      cell: (x, y) => v3(a.view.content.localToWorld(a.view.cellToLocal(x, y, new V()))),
      state: (id) => a.game.robot(id)?.state,
      head: () => v3(a.world.player.head.getWorldPosition(new V())),
      had: (type) => window.events.includes(type),
      hands: () => {
        const t = a.tracker.hands;
        const f = (h) => `${h.side}: tracked ${h.tracked} open ${h.open} pinch ${h.pinchDist.toFixed(3)} palmY ${h.palmNormal.y.toFixed(2)}`;
        return `${f(t.left)} | ${f(t.right)} | game ${a.game.status} paused ${a.userPaused}`;
      },
      clear: () => (window.events = []),
    };
  });

  const remote = (method, params) => page.evaluate(([m, p]) => window.T.remote(m, p), [method, params]);
  const call = (fn, ...args) => page.evaluate(([f, a]) => window.T[f](...a), [fn, args]);
  // Waits count game seconds, not wall-clock time: a software-rendered emulator can run at a few
  // frames a second, and the game's hold timers run on game time.
  const waitFor = async (expr, gameSec = 6) => {
    const until = await page.evaluate((s) => window.clearance.clock + s, gameSec);
    const fn = `(${expr.toString()})()`;
    const ok = await page
      .waitForFunction(([f, u]) => eval(f) || window.clearance.clock > u, [fn, until], { timeout: 600000, polling: 100 })
      .then(() => page.evaluate((f) => !!eval(f), fn));
    return ok;
  };
  const gameSeconds = (s) => page.evaluate((s) => new Promise((ok) => {
    const a = window.clearance;
    const t0 = a.clock;
    const tick = () => (a.clock - t0 >= s ? ok() : requestAnimationFrame(tick));
    tick();
  }), s);
  const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const add = (p, x = 0, y = 0, z = 0) => ({ x: p.x + x, y: p.y + y, z: p.z + z });
  const park = async (side) => {
    // Hands down by the sides, out of the way.
    const h = await call('head');
    await remote('set_hand_pose', { device: `hand-${side}`, poseId: 'default' });
    await remote('set_transform', { device: `hand-${side}`, position: add(h, side === 'left' ? -0.35 : 0.35, -0.6, 0.1), orientation: 'auto' });
  };
  await park('left');
  await park('right');

  // 1. Pinch a permit from the dispenser and drop it on the robot that is asking.
  const asked = await waitFor(() => window.clearance.game.robot('r1')?.state === 'proposed', 20);
  check('a robot proposes a plan', asked);
  const token = await call('token');
  check('a permit waits on the dispenser', !!token);
  if (asked && token) {
    await remote('set_hand_pose', { device: 'hand-right', poseId: 'open' });
    await remote('set_transform', { device: 'hand-right', anchor: 'grasp', position: add(token, 0, 0.01, 0), orientation: { fingers: 'forward', palm: 'down' } });
    await gameSeconds(0.3);
    await remote('set_hand_pose', { device: 'hand-right', poseId: 'pinch', duration: 0.15 });
    await remote('set_select_value', { device: 'hand-right', value: 1 });
    await gameSeconds(0.4);
    const r1 = await call('robot', 'r1');
    await remote('animate_to', { device: 'hand-right', anchor: 'grasp', position: add(r1, 0, 0.05, 0), duration: 0.6 });
    await gameSeconds(0.3);
    await shot('1-permit-over-robot');
    await remote('set_select_value', { device: 'hand-right', value: 0 });
    await remote('set_hand_pose', { device: 'hand-right', poseId: 'open', duration: 0.1 });
    const moved = await waitFor(() => window.T.had('granted') || window.T.state('r1') === 'executing', 4);
    check('pinch-and-drop clears the robot', moved, await page.evaluate(() => window.events.join(',')));
    check('dropping a permit does not press a robot button', !(await page.evaluate(() => window.T.had('rejected'))));
    await park('right');
  }

  // 2. Open palm toward the moving robot: it stops.
  let moving = await waitFor(() => window.clearance.game.robots.some((r) => r.state === 'executing'), 2);
  if (!moving) {
    // The first robot already finished its short run: clear the next one through the game, so
    // this step tests the palm and nothing else.
    await waitFor(() => window.clearance.game.robots.some((r) => r.state === 'proposed'), 20);
    await page.evaluate(() => {
      const g = window.clearance.game;
      const r = g.robots.find((x) => x.state === 'proposed');
      const p = g.dispensePermit();
      if (r && p) g.grant(p.id, r.id);
    });
    moving = await waitFor(() => window.clearance.game.robots.some((r) => r.state === 'executing'), 2);
  }
  if (moving) {
    await call('clear');
    const mover = await page.evaluate(() => window.clearance.game.robots.find((r) => r.state === 'executing').id);
    const r1 = await call('robot', mover);
    const head = await call('head');
    // Palm between the eyes and the robot, about 25 cm from it, facing it.
    const dir = { x: r1.x - head.x, y: r1.y - head.y, z: r1.z - head.z };
    const len = Math.hypot(dir.x, dir.y, dir.z);
    const n = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const at = add(r1, -n.x * 0.25, -n.y * 0.25 + 0.05, -n.z * 0.25);
    await remote('set_hand_pose', { device: 'hand-left', poseId: 'open' });
    await remote('set_transform', { device: 'hand-left', position: at, orientation: { fingers: 'up', palm: [n.x, n.y, n.z] } });
    const stopped = await waitFor(() => window.T.had('stopped'), 3);
    await shot('2-palm-stop');
    check('open palm stops a moving robot', stopped, await page.evaluate(() => window.events.join(',')));
    await park('left');
  } else check('open palm stops a moving robot', false, 'robot never moved');

  // 3. Flick sideways across a proposed plan: rejected.
  const again = await waitFor(() => window.clearance.game.robots.some((r) => r.state === 'proposed'), 25);
  if (again) {
    await call('clear');
    const id = await page.evaluate(() => window.clearance.game.robots.find((r) => r.state === 'proposed').id);
    const path = await call('path', id);
    const mid = path[Math.min(2, path.length - 1)] ?? (await call('robot', id));
    await remote('set_hand_pose', { device: 'hand-right', poseId: 'point' });
    await remote('set_transform', { device: 'hand-right', anchor: 'index-tip', position: add(mid, -0.06, 0.02, 0), orientation: { fingers: 'forward', palm: 'down' } });
    await gameSeconds(0.4); // rest on the plan first, as a real flick starts
    await remote('animate_to', { device: 'hand-right', anchor: 'index-tip', position: add(mid, 0.3, 0.02, 0), duration: 0.15 });
    const rejected = await waitFor(() => window.T.had('rejected'), 2);
    check('a sideways flick rejects the plan', rejected, await page.evaluate(() => window.events.join(',')));
    await park('right');
  } else check('a sideways flick rejects the plan', false, 'no second proposal');

  // 3b. A fast reach across the table, passing over a plan, must not reject it.
  {
    const live = await waitFor(() => window.clearance.game.robots.some((r) => r.state === 'proposed'), 25);
    if (live) {
      await call('clear');
      const id = await page.evaluate(() => window.clearance.game.robots.find((r) => r.state === 'proposed').id);
      const path = await call('path', id);
      const mid = path[Math.min(2, path.length - 1)];
      await remote('set_hand_pose', { device: 'hand-right', poseId: 'open' });
      await remote('set_transform', { device: 'hand-right', anchor: 'index-tip', position: add(mid, -0.35, 0.03, 0), orientation: { fingers: 'forward', palm: 'down' } });
      await gameSeconds(0.4);
      await remote('animate_to', { device: 'hand-right', anchor: 'index-tip', position: add(mid, 0.35, 0.03, 0), duration: 0.35 });
      await gameSeconds(0.6);
      const wrongly = await page.evaluate(() => window.T.had('rejected'));
      check('a fast reach over a plan does not reject it', !wrongly, await page.evaluate(() => window.events.join(',')));
      await park('right');
    } else check('a fast reach over a plan does not reject it', false, 'no proposal to reach over');
  }

  // 4. A flat hand resting on the board becomes a wall.
  {
    const c = await call('cell', 5, 4);
    await remote('set_hand_pose', { device: 'hand-left', poseId: 'flat' });
    await remote('set_transform', { device: 'hand-left', anchor: 'wrist', position: add(c, 0, 0.03, 0.04), orientation: { fingers: 'forward', palm: 'down' } });
    const walled = await waitFor(() => (window.clearance.currentWalls ?? []).length > 0, 2);
    await shot('4-hand-wall');
    check('a flat hand on the board becomes a wall', walled, `${await page.evaluate(() => (window.clearance.currentWalls ?? []).length)} cells`);
    await park('left');
    const cleared = await waitFor(() => (window.clearance.currentWalls ?? []).length === 0, 2);
    check('lifting the hand clears the wall', cleared);
  }

  // 5. One palm up: the pause button appears above it.
  {
    const h = await call('head');
    await remote('set_hand_pose', { device: 'hand-right', poseId: 'open' });
    await remote('set_transform', { device: 'hand-right', position: add(h, 0.15, -0.35, -0.3), orientation: { fingers: 'forward', palm: 'up' } });
    const shown = await waitFor(() => window.clearance.palmBtn.mesh.visible, 2);
    await shot('5-palm-menu');
    check('palm up shows the pause button', shown, shown ? '' : await call('hands'));
    await park('right');
  }

  // 6. Both palms up: everything stops.
  {
    await call('clear');
    const h = await call('head');
    for (const side of ['left', 'right']) {
      await remote('set_hand_pose', { device: `hand-${side}`, poseId: 'open' });
      await remote('set_transform', { device: `hand-${side}`, position: add(h, side === 'left' ? -0.2 : 0.2, -0.3, -0.3), orientation: { fingers: 'forward', palm: 'up' } });
    }
    const all = await waitFor(() => window.T.had('stopAll'), 2);
    check('both palms up stops everything', all, all ? '' : await call('hands'));
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
