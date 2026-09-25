import * as pc from "playcanvas";

export interface Projectile {
  entity: pc.Entity;
  velocity: pc.Vec3;
  life: number;
}

export interface ProjectileOptions {
  /** Emissive colour of the tracer (linear, may exceed 1 for bloom). */
  color?: [number, number, number];
  speed?: number;
  life?: number;
  max?: number;
  /** Tracer thickness and length. */
  width?: number;
  length?: number;
}

export class ProjectileSystem {
  public readonly active: Projectile[] = [];
  private pool: pc.Entity[] = [];
  private material: pc.StandardMaterial;
  private speed: number;
  private life: number;

  constructor(app: pc.Application, opts: ProjectileOptions = {}) {
    const c = opts.color ?? [0.25, 1.1, 0.8];
    this.speed = opts.speed ?? 85;
    this.life = opts.life ?? 2.4;
    const max = opts.max ?? 64;
    this.material = new pc.StandardMaterial();
    this.material.diffuse = new pc.Color(0, 0, 0);
    this.material.emissive = new pc.Color(c[0], c[1], c[2]);
    this.material.emissiveIntensity = 3;
    this.material.useMetalness = false;
    this.material.update();

    for (let i = 0; i < max; i++) {
      const e = new pc.Entity(`proj-${i}`);
      e.addComponent("render", { type: "capsule", material: this.material });
      const w = opts.width ?? 0.14;
      e.setLocalScale(w, opts.length ?? 0.7, w);
      e.enabled = false;
      app.root.addChild(e);
      this.pool.push(e);
    }
  }

  spawn(position: pc.Vec3, direction: pc.Vec3, inheritedVel: pc.Vec3): void {
    const entity = this.pool.pop();
    if (!entity) return;

    entity.setPosition(position);
    // Orient capsule along direction. Capsule's long axis is local Y.
    const up = new pc.Vec3(0, 1, 0);
    const dirN = direction.clone().normalize();
    // Build a rotation from +Y to direction
    const axis = new pc.Vec3().cross(up, dirN);
    const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(dirN))));
    if (axis.length() < 0.0001) {
      // Aligned or opposite; handle opposite
      entity.setEulerAngles(dirN.y > 0 ? 0 : 180, 0, 0);
    } else {
      axis.normalize();
      const q = new pc.Quat().setFromAxisAngle(axis, angle * pc.math.RAD_TO_DEG);
      entity.setRotation(q);
    }

    entity.enabled = true;

    const vel = dirN.clone().mulScalar(this.speed);
    vel.add(inheritedVel);

    this.active.push({ entity, velocity: vel, life: this.life });
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
    }
  }

  recycle(index: number): void {
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
