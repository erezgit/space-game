import * as pc from "playcanvas";
import { MeshBuilder, vertexColorMaterial } from "./geom";
import type { Enemy, EnemySystem, Kill } from "./enemies";
import type { ParticleSystem } from "./particles";
import type { SmokeSystem } from "./smoke";

/**
 * Air-to-air missiles.
 *
 * Launched from the wing with a short drop, then the motor lights: the missile
 * accelerates hard and, if it has a locked target, steers onto an intercept
 * (proportional pursuit on the target's predicted position). Without a lock it
 * flies straight. A proximity fuse detonates it near any aircraft. A white
 * smoke trail marks its path.
 */

interface Missile {
  entity: pc.Entity;
  pos: pc.Vec3;
  dir: pc.Vec3;
  speed: number;
  target: Enemy | null;
  age: number;
  trailTimer: number;
}

const LIFE = 7;
const TURN = 3.4;       // rad/s
const MAX_SPEED = 190;
const FUSE = 6;

export class MissileSystem {
  private active: Missile[] = [];
  private pool: pc.Entity[] = [];
  private side = 1;

  constructor(app: pc.Application) {
    const mb = new MeshBuilder();
    mb.box(0, 0, 0, 0.26, 0.26, 2.8, [0.93, 0.93, 0.9, 1]);
    mb.box(0, 0, -1.55, 0.18, 0.18, 0.3, [0.25, 0.25, 0.25, 1]);                 // seeker head
    for (const [w, h] of [[0.9, 0.05], [0.05, 0.9]]) mb.box(0, 0, 1.2, w, h, 0.45, [0.6, 0.6, 0.6, 1]);   // tail fins
    for (const [w, h] of [[0.6, 0.04], [0.04, 0.6]]) mb.box(0, 0, -0.6, w, h, 0.3, [0.6, 0.6, 0.6, 1]);   // canards
    const mesh = mb.build(app.graphicsDevice);
    const mat = vertexColorMaterial({ gloss: 0.6, metalness: 0.2 });
    mat.cull = pc.CULLFACE_NONE;
    mat.update();
    const flame = new pc.StandardMaterial();
    flame.diffuse = new pc.Color(0, 0, 0);
    flame.emissive = new pc.Color(1.8, 1.0, 0.45);
    flame.emissiveIntensity = 2.5;
    flame.blendType = pc.BLEND_ADDITIVE;
    flame.depthWrite = false;
    flame.useFog = false;
    flame.update();
    for (let i = 0; i < 12; i++) {
      const e = new pc.Entity("missile");
      e.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, mat)] });
      const f = new pc.Entity("motor");
      f.addComponent("render", { type: "sphere", material: flame, castShadows: false });
      f.setLocalScale(0.45, 0.45, 1.2);
      f.setLocalPosition(0, 0, 1.9);
      e.addChild(f);
      e.enabled = false;
      app.root.addChild(e);
      this.pool.push(e);
    }
  }

  get inFlight(): number { return this.active.length; }

  launch(from: pc.Entity, velocity: pc.Vec3, target: Enemy | null): boolean {
    const e = this.pool.pop();
    if (!e) return false;
    // Alternate wing pylons.
    const offset = new pc.Vec3(2.6 * this.side, -0.6, 0.5);
    this.side = -this.side;
    from.getRotation().transformVector(offset, offset);
    const pos = from.getPosition().clone().add(offset);
    const dir = from.forward.clone();
    e.setPosition(pos);
    e.enabled = true;
    this.active.push({ entity: e, pos, dir, speed: velocity.length() * 0.9, target, age: 0, trailTimer: 0 });
    return true;
  }

  update(dt: number, enemies: EnemySystem, particles: ParticleSystem, trail: SmokeSystem, onKill: (k: Kill) => void, groundAt: (x: number, z: number) => number): void {
    const want = new pc.Vec3();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.age += dt;

      if (m.age < 0.25) {
        // Drop clear of the jet before the motor lights.
        m.pos.y -= 6 * dt;
      } else {
        m.speed = Math.min(MAX_SPEED, m.speed + 160 * dt);
        if (m.target && m.target.mode !== "falling" && m.target.entity.enabled) {
          const tp = m.target.entity.getPosition();
          const dist = tp.distance(m.pos);
          const lead = dist / Math.max(m.speed, 1);
          want.copy(m.target.dir).mulScalar(m.target.speed * lead).add(tp).sub(m.pos).normalize();
          const ang = Math.acos(Math.max(-1, Math.min(1, m.dir.dot(want))));
          const k = ang > TURN * dt ? (TURN * dt) / ang : 1;
          m.dir.lerp(m.dir, want, k).normalize();
        } else {
          m.target = null;
        }
        m.trailTimer -= dt;
        if (m.trailTimer <= 0) {
          trail.spawn(m.pos, 0.7 + Math.random() * 0.4, 1.8, new pc.Vec3(0, 0.3, 0));
          m.trailTimer = 0.015;
        }
      }
      m.pos.x += m.dir.x * m.speed * dt;
      m.pos.y += m.dir.y * m.speed * dt;
      m.pos.z += m.dir.z * m.speed * dt;
      m.entity.setPosition(m.pos);
      m.entity.lookAt(m.pos.x + m.dir.x, m.pos.y + m.dir.y, m.pos.z + m.dir.z);

      // Proximity fuse.
      let detonated = false;
      for (const e of enemies.targets()) {
        if (e.entity.getPosition().distance(m.pos) < enemies.radiusOf(e) + FUSE) {
          particles.spawnExplosion(m.pos, 2.2);
          const k = enemies.damage(e, 99, particles, trail);
          if (k) onKill(k);
          detonated = true;
          break;
        }
      }
      if (!detonated && (m.age > LIFE || m.pos.y < Math.max(groundAt(m.pos.x, m.pos.z), 0))) {
        particles.spawnExplosion(m.pos, 1.4);
        detonated = true;
      }
      if (detonated) {
        m.entity.enabled = false;
        this.pool.push(m.entity);
        this.active.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const m of this.active) { m.entity.enabled = false; this.pool.push(m.entity); }
    this.active.length = 0;
  }
}
