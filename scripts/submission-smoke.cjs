// Browser regression checks for the submission flows. Run against npm run preview.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.URL ?? 'https://127.0.0.1:4173/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('clearance.daily.v1', '{"results":null}');
      localStorage.setItem('clearance.progress.v1', 'null');
      localStorage.setItem('clearance.crew.v1', 'null');
    });
    await page.goto(`${base}?debug&server=https://127.0.0.1:1`);
    await page.waitForFunction(() => window.clearance && !document.getElementById('start').disabled, null, { timeout: 90000 });
    assert.equal(await page.locator('#coop-dialog').count(), 1);
    await page.locator('#coop').click();
    await page.locator('#coop-keypad button').getByText('A', { exact: true }).click();
    await page.locator('#coop-keypad button').getByText('B', { exact: true }).click();
    await page.locator('#coop-keypad button').getByText('C', { exact: true }).click();
    await page.locator('#coop-keypad button').getByText('D', { exact: true }).click();
    assert.equal(await page.locator('#coop-code').textContent(), 'ABCD');
    assert.equal(await page.locator('#coop-join').isEnabled(), true);
    await page.locator('#coop-erase').click();
    assert.equal(await page.locator('#coop-code').textContent(), 'ABC_');
    assert.equal(await page.locator('#coop-join').isEnabled(), false);
    fs.mkdirSync(path.join('film', 'checks'), { recursive: true });
    await page.screenshot({ path: path.join('film', 'checks', 'room-picker.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#coop-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), true);
    await page.screenshot({ path: path.join('film', 'checks', 'room-picker-mobile.png') });
    await page.locator('#coop-cancel').click();
    await page.evaluate(() => {
      const app = window.clearance;
      app.loadOvertime();
      app.retryShift();
      if (app.game.level.id !== 'OVERTIME') throw new Error('Overtime retry switched mode');
      app.loadLevel(1);
      app.retryShift();
      if (app.game.level.id !== 'L02') throw new Error('Campaign retry switched level');
      app.loadDaily();
      app.retryShift();
      if (app.game.level.id !== 'DAILY') throw new Error('Daily retry switched mode');
    });
    console.log('PASS corrupted storage, room picker, mobile layout and all retry modes');

    await page.goto(`${base}?debug&emulate&nocontrols`);
    await page.waitForFunction(() => window.clearance && !document.getElementById('start').disabled, null, { timeout: 90000 });
    await page.evaluate(() => { navigator.xr.requestSession = () => Promise.reject(new Error('Test: permission denied')); });
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Could not start the shift.'));
    assert.equal(await page.locator('body').evaluate(b => b.classList.contains('playing') || b.classList.contains('in-xr')), false);
    assert.equal(await page.locator('#start').isEnabled(), true);
    assert.equal(await page.locator('#daily').isEnabled(), true);
    assert.equal(await page.locator('#overtime').isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS rejected XR entry restores page and retry buttons without uncaught errors');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
