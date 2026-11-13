/**
 * A small record of how gestures went on this device: what fired, what nearly fired, and the
 * measurements behind the near misses. A remote tester plays with ?debug, then copies the report
 * from the page and sends it, so thresholds can be tuned without the developer holding a headset.
 * Stored only on the device; nothing is sent anywhere.
 */
import { GESTURE } from '../xr/gestures';

export type GestureKind = 'pinch' | 'palm' | 'flick' | 'wall' | 'menu' | 'all';

const KEY = 'clearance.gesturelog.v1';

export class GestureLog {
  fired: Record<GestureKind, number> = { pinch: 0, palm: 0, flick: 0, wall: 0, menu: 0, all: 0 };
  near: Record<'pinch' | 'palm' | 'flick', number> = { pinch: 0, palm: 0, flick: 0 };
  /** Closest thumb–index gap seen while a hand hovered on a permit without grabbing it (m). */
  pinchGaps: number[] = [];
  /** Flick speeds that came close to rejecting a plan but fell short (m/s). */
  slowFlicks: number[] = [];
  /** Palm angles (degrees off the robot) that came close to stopping one. */
  palmAngles: number[] = [];
  private frames = 0;
  private frameTime = 0;
  private worstFrame = 0;
  private started = Date.now();
  levels = new Set<string>();
  assist = false;

  fire(kind: GestureKind) {
    this.fired[kind]++;
  }

  nearMiss(kind: 'pinch' | 'palm' | 'flick', value: number) {
    this.near[kind]++;
    const list = kind === 'pinch' ? this.pinchGaps : kind === 'flick' ? this.slowFlicks : this.palmAngles;
    if (list.length < 40) list.push(value);
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
    return [
      'Clearance gesture report',
      `date ${new Date().toISOString().slice(0, 16)}  minutes ${((Date.now() - this.started) / 60000).toFixed(1)}`,
      `device ${navigator.userAgent.match(/(Quest[^;)]*|OculusBrowser\/[\d.]+)/g)?.join(' ') ?? navigator.userAgent.slice(0, 80)}`,
      `assist ${this.assist ? 'on' : 'off'}  levels ${[...this.levels].join(',') || 'none'}`,
      `fps avg ${fps.toFixed(1)}  worst frame ${(this.worstFrame * 1000).toFixed(0)} ms`,
      `fired  ${Object.entries(this.fired).map(([k, v]) => `${k} ${v}`).join('  ')}`,
      `nearly ${Object.entries(this.near).map(([k, v]) => `${k} ${v}`).join('  ')}`,
      `pinch gaps missed (m, needs < ${GESTURE.pinchOn}): ${r(this.pinchGaps)}`,
      `flicks too slow (m/s, needs ${GESTURE.flickSpeed}): ${r(this.slowFlicks, 2)}`,
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
