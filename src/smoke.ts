import * as pc from "playcanvas";

interface Puff {
  entity: pc.Entity;
  velocity: pc.Vec3;
  life: number;
  maxLife: number;
  size: number;
}

/** Dark smoke puffs — flak bursts and burning planes' trails. Alpha-blended, not glowing. */
export class SmokeSystem {
  private active: Puff[] = [];
  private pool: pc.Entity[] = [];

  constructor(app: pc.Application, max = 420) {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(0.1, 0.09, 0.09);
    m.emissive = new pc.Color(0.08, 0.05, 0.04);
    m.opacity = 0.55;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
    m.update();
    for (let i = 0; i < max; i++) {
      const e = new pc.Entity(`smoke-${i}`);
      e.addComponent("render", { type: "sphere", material: m, castShadows: false });
      e.enabled = false;
      app.root.addChild(e);
      this.pool.push(e);
    }
  }

  spawn(position: pc.Vec3, size: number, life = 2.2, drift?: pc.Vec3): void {
    const e = this.pool.pop();
    if (!e) return;
    e.enabled = true;
    e.setPosition(position);
    e.setLocalScale(size * 0.4, size * 0.4, size * 0.4);
    const v = drift ? drift.clone() : new pc.Vec3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2);
    this.active.push({ entity: e, velocity: v, life, maxLife: life, size });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.entity.enabled = false;
        this.pool.push(p.entity);
        this.active.splice(i, 1);
        continue;
      }
      const pos = p.entity.getPosition();
      pos.x += p.velocity.x * dt; pos.y += p.velocity.y * dt; pos.z += p.velocity.z * dt;
      p.entity.setPosition(pos);
      const t = 1 - p.life / p.maxLife; // 0 → 1
      const s = p.size * (0.4 + t * 1.2) * (t > 0.8 ? (1 - t) * 5 : 1);
      p.entity.setLocalScale(s, s, s);
    }
  }

  clear(): void {
    for (const p of this.active) { p.entity.enabled = false; this.pool.push(p.entity); }
    this.active.length = 0;
  }
}
