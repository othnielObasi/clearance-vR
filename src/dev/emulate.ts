/**
 * Headset emulator for testing and filming without a Quest. Loaded only when the page is opened
 * with `?emulate` (optionally `?emulate=kitchen` to pick a room), so normal visitors never fetch it.
 *
 * It replaces navigator.xr with Meta's Immersive Web Emulation Runtime: an emulated Quest 3 with
 * tracked hands, a synthetic mixed-reality room (planes, meshes and hit-testing for the desk snap),
 * and the emulator's on-screen controls for moving the head and hands.
 */
import { metaQuest3, XRDevice } from 'iwer';
import { Matrix4, Quaternion, Vector3 } from 'three';

export interface Emulator {
  device: XRDevice;
  room: string;
}

export async function installEmulator(room = 'home_office', withControls = true): Promise<Emulator> {
  const device = new XRDevice(metaQuest3, { stereoEnabled: false });
  // Seated at a desk: eyes about 1.2 m up.
  device.position.set(0, 1.2, 0.1);
  device.installRuntime({ forceInstall: true });
  device.primaryInputMode = 'hand';

  const { SyntheticEnvironmentModule } = await import('@iwer/sem');
  device.installSEM(SyntheticEnvironmentModule);
  const sem = device.sem;
  const envs = sem?.environments ?? [];
  const pick = envs.includes(room) ? room : envs[0];
  if (sem && pick) await sem.loadDefaultEnvironment(pick);

  if (sem) seatAtTable(device);

  if (withControls) {
    const { DevUI } = await import('@iwer/devui');
    device.installDevUI(DevUI);
  }
  // Exposed for automated tests and scripted recordings.
  Object.assign(window, { xrdevice: device });
  return { device, room: pick ?? 'none' };
}

/**
 * Sit the emulated player at the room's table: eyes 50 cm above the top, 25 cm back from its
 * near edge, facing it, as a seated Quest player would be. Falls back to the room's origin.
 */
function seatAtTable(device: XRDevice) {
  const planes = [...(device.sem?.trackedPlanes ?? [])] as unknown as {
    transform: { matrix: Float32Array };
    polygon: { x: number; y: number; z: number }[];
    semanticLabel?: string;
  }[];
  const tables = planes.filter((p) => /table|desk/i.test(String(p.semanticLabel ?? '')));
  if (!tables.length) return;
  // Largest table wins.
  const corners = (p: (typeof tables)[number]) => {
    const m = new Matrix4().fromArray(p.transform.matrix);
    return p.polygon.map((q) => new Vector3(q.x, q.y, q.z).applyMatrix4(m));
  };
  const area = (pts: Vector3[]) => {
    const xs = pts.map((v) => v.x), zs = pts.map((v) => v.z);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  };
  const pts = tables.map(corners).sort((a, b) => area(b) - area(a))[0]!;
  const centre = pts.reduce((a, v) => a.add(v), new Vector3()).multiplyScalar(1 / pts.length);
  // Approach from the side nearest the middle of the room (the open side, usually).
  const toRoom = new Vector3(-centre.x, 0, -centre.z);
  if (toRoom.lengthSq() < 1e-4) toRoom.set(0, 0, 1);
  toRoom.normalize();
  const halfDepth = Math.max(...pts.map((v) => Math.abs(new Vector3().subVectors(v, centre).setY(0).dot(toRoom))));
  const seat = centre.clone().addScaledVector(toRoom, halfDepth + 0.25);
  device.position.set(seat.x, centre.y + 0.5, seat.z);
  // Face the table, tipped down a little.
  const yaw = Math.atan2(toRoom.x, toRoom.z);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.45));
  device.quaternion.set(q.x, q.y, q.z, q.w);
}
