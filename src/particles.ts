import * as pc from "playcanvas";

interface Particle {
  entity: pc.Entity;
  velocity: pc.Vec3;
  life: number;
  maxLife: number;
  initialScale: number;
}

const MAX_PARTICLES = 160;

export class ParticleSystem {
  private active: Particle[] = [];
  private pool: pc.Entity[] = [];
  private material: pc.StandardMaterial;

  constructor(app: pc.Application) {
    this.material = new pc.StandardMaterial();
    this.material.diffuse = new pc.Color(0, 0, 0);
    this.material.emissive = new pc.Color(1.2, 0.65, 0.25);
    this.material.emissiveIntensity = 2.8;
    this.material.opacity = 1;
    this.material.blendType = pc.BLEND_ADDITIVE;
    this.material.depthWrite = false;
    this.material.useMetalness = false;
    this.material.update();

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const e = new pc.Entity(`particle-${i}`);
      e.addComponent("render", { type: "sphere", material: this.material });
      e.enabled = false;
      app.root.addChild(e);
      this.pool.push(e);
    }
  }

  spawnExplosion(position: pc.Vec3, scale: number): void {
    const count = Math.min(
      this.pool.length,
      Math.max(12, Math.round(16 * scale))
    );
    for (let i = 0; i < count; i++) {
      const e = this.pool.pop();
      if (!e) break;
      e.enabled = true;
      e.setPosition(position);
      const s = (0.2 + Math.random() * 0.45) * scale;
      e.setLocalScale(s, s, s);

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 5 + Math.random() * 14 * Math.max(0.6, scale);
      const velocity = new pc.Vec3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      );

      const life = 0.45 + Math.random() * 0.35;
      this.active.push({
        entity: e,
        velocity,
        life,
        maxLife: life,
        initialScale: s,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.recycle(i);
        continue;
      }
      const pos = p.entity.getPosition();
      pos.x += p.velocity.x * dt;
      pos.y += p.velocity.y * dt;
      pos.z += p.velocity.z * dt;
      p.entity.setPosition(pos);

      // Decay velocity + scale
      p.velocity.mulScalar(0.92);
      const t = p.life / p.maxLife;
      const s = p.initialScale * (0.5 + t * 0.8);
      p.entity.setLocalScale(s, s, s);
    }
  }

  private recycle(index: number): void {
    const p = this.active[index];
    p.entity.enabled = false;
    this.pool.push(p.entity);
    this.active.splice(index, 1);
  }

  clear(): void {
    while (this.active.length > 0) {
      this.recycle(this.active.length - 1);
    }
  }
}
