import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, type Object3D } from 'three';

const MAX = 160;

interface Particle {
  pos: Vector3;
  vel: Vector3;
  life: number;
  max: number;
  size: number;
  color: Color;
}

/** Small pooled particle bursts: delivery sparkles, brake dust, incident puffs. */
export class Effects {
  readonly mesh: InstancedMesh;
  private parts: Particle[] = [];
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();

  constructor(parent: Object3D) {
    const mat = new MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    this.mesh = new InstancedMesh(new SphereGeometry(1, 6, 4), mat, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    parent.add(this.mesh);
  }

  /** Burst at a board-local position. */
  burst(at: Vector3, color: number, count: number, opts: { speed?: number; up?: number; size?: number; life?: number } = {}) {
    const c = new Color(color);
    for (let i = 0; i < count && this.parts.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 0.08) * (0.4 + Math.random() * 0.6);
      this.parts.push({
        pos: at.clone(),
        vel: new Vector3(Math.cos(a) * sp, (opts.up ?? 0.12) * (0.5 + Math.random()), Math.sin(a) * sp),
        life: 0,
        max: (opts.life ?? 0.6) * (0.7 + Math.random() * 0.6),
        size: (opts.size ?? 0.0018) * (0.6 + Math.random() * 0.8),
        color: c,
      });
    }
  }

  update(dt: number) {
    let n = 0;
    this.parts = this.parts.filter((p) => (p.life += dt) < p.max);
    for (const p of this.parts) {
      p.vel.y -= 0.35 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.001) {
        p.pos.y = 0.001;
        p.vel.multiplyScalar(0.4);
      }
      const k = 1 - p.life / p.max;
      this.m.compose(p.pos, this.q, this.s.setScalar(p.size * (0.4 + 0.6 * k)));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
