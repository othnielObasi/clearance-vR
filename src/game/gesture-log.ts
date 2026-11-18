/**
 * A small record of how gestures went on this device: what fired, what nearly fired, and the
 * measurements behind the near misses. A remote tester plays with ?debug, then copies the report
 * from the page and sends it, so thresholds can be tuned without the developer holding a headset.
 * Stored only on the device; nothing is sent anywhere.
 */
import { GESTURE } from '../xr/gestures';

export type GestureKind = 'pinch' | 'palm' | 'flick' | 'wall' | 'menu' | 'all' | 'poke';

const KEY = 'clearance.gesturelog.v1';

export class GestureLog {
  fired: Record<GestureKind, number> = { pinch: 0, palm: 0, flick: 0, wall: 0, menu: 0, all: 0, poke: 0 };
  near: Record<'pinch' | 'palm' | 'flick', number> = { pinch: 0, palm: 0, flick: 0 };
  /** Closest thumb–index gap seen while a hand hovered on a permit without grabbing it (m). */
  pinchGaps: number[] = [];
  /** Flick speeds that came close to rejecting a plan but fell short (m/s). */
  slowFlicks: number[] = [];
  /** Palm angles (degrees off the robot) that came close to stopping one. */
  palmAngles: number[] = [];
  private frames = 0;
  /** Play time with at least one hand tracked, and with a controller active (s). */
  private playTime = 0;
  private handTime = 0;
  private controllerTime = 0;
  private frameTime = 0;
  private worstFrame = 0;
  private started = Date.now();
  levels = new Set<string>();
  assist = false;
  /** Frame-rate guard level reached (0 = everything on) and whether object walls were switched off as noisy. */
  perfLevel = 0;
  objectWalls: 'on' | 'off (noisy)' | 'off (performance)' | 'no depth data' = 'no depth data';

  fire(kind: GestureKind) {
    this.fired[kind]++;
  }

  nearMiss(kind: 'pinch' | 'palm' | 'flick', value: number) {
    this.near[kind]++;
    const list = kind === 'pinch' ? this.pinchGaps : kind === 'flick' ? this.slowFlicks : this.palmAngles;
    if (list.length < 40) list.push(value);
  }

  /** Called each frame of live play: was a hand tracked, was a controller awake? */
  tracking(dt: number, hand: boolean, controller: boolean) {
    if (dt <= 0 || dt > 0.5) return;
    this.playTime += dt;
    if (hand) this.handTime += dt;
    if (controller) this.controllerTime += dt;
  }

  frame(dt: number) {
    if (dt <= 0 || dt > 0.5) return;
    this.frames++;
    this.frameTime += dt;
    if (this.frames > 60) this.worstFrame = Math.max(this.worstFrame, dt);
  }

  text(): string {
    const r = (xs: number[], d = 3) => (xs.length ? xs.map((x) => x.toFixed(d)).join(' ') : 'none');
    const fps = this.frameTime > 0 ? this.frames / this.frameTime : 0;
    const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : 'n/a');
    return [
      'Clearance gesture report',
      `date ${new Date().toISOString().slice(0, 16)}  minutes ${((Date.now() - this.started) / 60000).toFixed(1)}`,
      `device ${navigator.userAgent.match(/(Quest[^;)]*|OculusBrowser\/[\d.]+)/g)?.join(' ') ?? navigator.userAgent.slice(0, 80)}`,
      `assist ${this.assist ? 'on' : 'off'}  levels ${[...this.levels].join(',') || 'none'}`,
      `fps avg ${fps.toFixed(1)}  worst frame ${(this.worstFrame * 1000).toFixed(0)} ms  safety level ${this.perfLevel}`,
      `object walls ${this.objectWalls}`,
      `play ${this.playTime.toFixed(0)} s  hands tracked ${pct(this.handTime, this.playTime)}  controller active ${pct(this.controllerTime, this.playTime)}`,
      `fired  ${Object.entries(this.fired).map(([k, v]) => `${k} ${v}`).join('  ')}`,
      `nearly ${Object.entries(this.near).map(([k, v]) => `${k} ${v}`).join('  ')}`,
      `pinch gaps missed (m, needs < ${GESTURE.pinchOn}): ${r(this.pinchGaps)}`,
      `brushes too slow (m/s, needs ${GESTURE.flickSpeed}): ${r(this.slowFlicks, 2)}`,
      `palm angles missed (deg, needs < ${((Math.acos(GESTURE.palmConeCos) * 180) / Math.PI).toFixed(0)}): ${r(this.palmAngles, 0)}`,
    ].join('\n');
  }

  /** Saves over the last report, but only once there is something to report. */
  save() {
    if (this.frames < 30) return;
    try {
      localStorage.setItem(KEY, this.text());
    } catch {
      // private browsing or storage full: the live panel still shows it
    }
  }

  static saved(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
}
