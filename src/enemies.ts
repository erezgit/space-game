import * as pc from "playcanvas";
import type { Projectile, ProjectileSystem } from "./projectiles";
import type { ParticleSystem } from "./particles";
import type { SmokeSystem } from "./smoke";

/**
 * Enemy fighters. They hunt the player, fire tracer bursts when lined up,
 * and break off when they get too close. Hit one twice and it bursts into
 * flame and falls, trailing smoke, until it hits the ground.
 *
 * The number in the air grows with the score — the waves get harder.
 */

type Mode = "hunt" | "breakoff" | "falling";

interface Enemy {
  entity: pc.Entity;
  body: pc.Entity;
  dir: pc.Vec3;       // unit heading
  speed: number;
  hp: number;
  mode: Mode;
  modeTimer: number;
  fireCooldown: number;
  burstLeft: number;
  roll: number;
  fallVel: pc.Vec3;
  smokeTimer: number;
}

export interface Kill { position: pc.Vec3; score: number }

const HIT_RADIUS = 3.4;
const MIN_ALT = 55;
const TURN_RATE = 0.9;   // rad/s
const FIRE_RANGE = 130;
const SPAWN_MIN = 230, SPAWN_MAX = 320;
const DESPAWN = 520;

function material(diffuse: [number, number, number], emissive?: [number, number, number], ei = 1, additive = false) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(...diffuse);
  if (emissive) { m.emissive = new pc.Color(...emissive); m.emissiveIntensity = ei; }
  m.useMetalness = true; m.metalness = 0.4; m.gloss = 0.5;
  if (additive) { m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; }
  m.update();
  return m;
}

export class EnemySystem {
  private active: Enemy[] = [];
  private pool: Enemy[] = [];
  private app: pc.Application;
  private spawnTimer = 0;
  private hull = material([0.2, 0.21, 0.18], [0.05, 0.04, 0.03]);
  private wing = material([0.14, 0.15, 0.13]);
  private mark = material([0.4, 0.02, 0.02], [0.9, 0.05, 0.03], 1.5);
  private glow = material([0, 0, 0], [1.5, 0.5, 0.1], 3, true);

  constructor(app: pc.Application) {
    this.app = app;
  }

  private build(): Enemy {
    const entity = new pc.Entity("enemy");
    const body = new pc.Entity("enemy-body");
    entity.addChild(body);
    const p = (type: string, m: pc.Material, s: number[], pos: number[], rot: number[] = [0, 0, 0]) => {
      const e = new pc.Entity(type);
      e.addComponent("render", { type, material: m });
      e.setLocalScale(s[0], s[1], s[2]);
      e.setLocalPosition(pos[0], pos[1], pos[2]);
      e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
      body.addChild(e);
    };
    p("box", this.hull, [0.9, 0.9, 5], [0, 0, 0]);                     // fuselage
    p("cone", this.hull, [0.85, 1.4, 0.85], [0, 0, -3.1], [-90, 0, 0]); // nose
    p("box", this.wing, [7.2, 0.14, 1.5], [0, -0.1, -0.2]);            // straight wings
    p("box", this.wing, [2.8, 0.1, 0.9], [0, 0.1, 2.3]);               // tailplane
    p("box", this.wing, [0.12, 1.3, 1.1], [0, 0.75, 2.2]);             // fin
    p("box", this.mark, [0.9, 0.16, 0.7], [-3.0, -0.02, -0.2]);        // red wing markings
    p("box", this.mark, [0.9, 0.16, 0.7], [3.0, -0.02, -0.2]);
    p("sphere", this.glow, [0.6, 0.6, 1.1], [0, 0, 2.8]);              // exhaust
    entity.enabled = false;
    this.app.root.addChild(entity);
    return {
      entity, body, dir: new pc.Vec3(0, 0, -1), speed: 30, hp: 2, mode: "hunt", modeTimer: 0,
      fireCooldown: 0, burstLeft: 0, roll: 0, fallVel: new pc.Vec3(), smokeTimer: 0,
    };
  }

  /** How many fighters should be in the air for this score. */
  static targetCount(score: number): number {
    return Math.min(2 + Math.floor(score / 400), 9);
  }

  private spawn(playerPos: pc.Vec3, playerFwd: pc.Vec3): void {
    const e = this.pool.pop() ?? this.build();
    // Ahead of the player within ±70°, at a varied altitude.
    const yaw = Math.atan2(-playerFwd.x, -playerFwd.z) + (Math.random() - 0.5) * 2.4;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = playerPos.x - Math.sin(yaw) * dist;
    const z = playerPos.z - Math.cos(yaw) * dist;
    const y = Math.max(MIN_ALT + 10, playerPos.y + (Math.random() - 0.35) * 60);
    e.entity.setPosition(x, y, z);
    e.dir.set(playerPos.x - x, playerPos.y - y, playerPos.z - z).normalize();
    e.speed = 26 + Math.random() * 8;
    e.hp = 2;
    e.mode = "hunt";
    e.modeTimer = 0;
    e.fireCooldown = 1.5 + Math.random() * 2;
    e.burstLeft = 0;
    e.roll = 0;
    e.entity.enabled = true;
    this.active.push(e);
  }

  update(
    dt: number, score: number, playerPos: pc.Vec3, playerFwd: pc.Vec3, playerVel: pc.Vec3,
    bullets: ProjectileSystem, particles: ParticleSystem, smoke: SmokeSystem, groundAt: (p: pc.Vec3) => boolean,
  ): void {
    const want = EnemySystem.targetCount(score);
    const flying = this.active.filter((e) => e.mode !== "falling").length;
    this.spawnTimer -= dt;
    if (flying < want && this.spawnTimer <= 0) {
      this.spawn(playerPos, playerFwd);
      this.spawnTimer = 1.2;
    }

    const toP = new pc.Vec3(), desired = new pc.Vec3(), pos = new pc.Vec3();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      pos.copy(e.entity.getPosition());

      if (e.mode === "falling") {
        e.fallVel.y -= 22 * dt;
        pos.x += e.fallVel.x * dt; pos.y += e.fallVel.y * dt; pos.z += e.fallVel.z * dt;
        e.entity.setPosition(pos);
        e.roll += 260 * dt;
        e.body.setLocalEulerAngles(15, 0, e.roll);
        e.smokeTimer -= dt;
        if (e.smokeTimer <= 0) {
          smoke.spawn(pos, 3 + Math.random() * 2, 2.8, new pc.Vec3(0, 1.5, 0));
          particles.spawnExplosion(pos, 0.25);
          e.smokeTimer = 0.06;
        }
        if (groundAt(pos) || e.modeTimer > 6) {
          particles.spawnExplosion(pos, 2.2);
          for (let k = 0; k < 6; k++) smoke.spawn(pos, 8 + Math.random() * 6, 4);
          this.recycle(i);
        }
        e.modeTimer += dt;
        continue;
      }

      toP.sub2(playerPos, pos);
      const dist = toP.length();
      if (dist > DESPAWN) { this.recycle(i); continue; }
      toP.mulScalar(1 / Math.max(dist, 0.001));

      // Steering.
      e.modeTimer -= dt;
      if (e.mode === "hunt" && dist < 22) { e.mode = "breakoff"; e.modeTimer = 2.2 + Math.random(); }
      if (e.mode === "breakoff" && e.modeTimer <= 0) e.mode = "hunt";
      if (e.mode === "hunt") {
        // Lead the player a little.
        desired.copy(playerVel).mulScalar(Math.min(dist / 90, 1.5)).add(playerPos).sub(pos).normalize();
      } else {
        desired.copy(toP).mulScalar(-1);
        desired.y = Math.abs(desired.y) + 0.3;
        desired.normalize();
      }
      if (pos.y < MIN_ALT) desired.y = Math.max(desired.y, 0.5);
      const maxTurn = TURN_RATE * dt;
      const cosA = Math.max(-1, Math.min(1, e.dir.dot(desired)));
      const ang = Math.acos(cosA);
      const k = ang > maxTurn ? maxTurn / ang : 1;
      const prevDir = e.dir.clone();
      e.dir.lerp(e.dir, desired, k).normalize();

      pos.x += e.dir.x * e.speed * dt; pos.y += e.dir.y * e.speed * dt; pos.z += e.dir.z * e.speed * dt;
      e.entity.setPosition(pos);
      // Face the heading; bank into turns.
      const yaw = Math.atan2(-e.dir.x, -e.dir.z) * pc.math.RAD_TO_DEG;
      const pitch = Math.asin(Math.max(-1, Math.min(1, e.dir.y))) * pc.math.RAD_TO_DEG;
      const turn = new pc.Vec3().cross(prevDir, e.dir).y / Math.max(dt, 0.001);
      e.roll = pc.math.lerp(e.roll, pc.math.clamp(-turn * 40, -60, 60), Math.min(1, dt * 3));
      e.entity.setEulerAngles(pitch, yaw, 0);
      e.body.setLocalEulerAngles(0, 0, e.roll);

      // Firing: short tracer bursts when roughly lined up.
      e.fireCooldown -= dt;
      const aligned = e.dir.dot(toP) > 0.96;
      if (e.mode === "hunt" && dist < FIRE_RANGE && aligned && e.fireCooldown <= 0 && e.burstLeft === 0) {
        e.burstLeft = 3 + Math.floor(Math.random() * 3);
      }
      if (e.burstLeft > 0 && e.fireCooldown <= 0) {
        const aim = toP.clone();
        aim.x += (Math.random() - 0.5) * 0.08; aim.y += (Math.random() - 0.5) * 0.08; aim.z += (Math.random() - 0.5) * 0.08;
        const muzzle = pos.clone().add(e.dir.clone().mulScalar(3.5));
        bullets.spawn(muzzle, aim.normalize(), new pc.Vec3());
        e.burstLeft--;
        e.fireCooldown = e.burstLeft > 0 ? 0.11 : 2.2 + Math.random() * 1.8;
      }
    }
  }

  /** Player tracers vs enemies. Returns the kills. */
  checkProjectileHits(projectiles: Projectile[], particles: ParticleSystem, smoke: SmokeSystem, projSystem: ProjectileSystem): Kill[] {
    const kills: Kill[] = [];
    for (let pi = projectiles.length - 1; pi >= 0; pi--) {
      const pp = projectiles[pi].entity.getPosition();
      for (const e of this.active) {
        if (e.mode === "falling") continue;
        const ep = e.entity.getPosition();
        if (pp.distance(ep) > HIT_RADIUS) continue;
        projSystem.recycle(pi);
        e.hp--;
        particles.spawnExplosion(pp, 0.35);
        if (e.hp <= 0) {
          e.mode = "falling";
          e.modeTimer = 0;
          e.smokeTimer = 0;
          e.fallVel.copy(e.dir).mulScalar(e.speed * 0.7);
          particles.spawnExplosion(ep, 1.6);
          smoke.spawn(ep, 7, 3);
          kills.push({ position: ep.clone(), score: 100 });
        }
        break;
      }
    }
    return kills;
  }

  clear(): void {
    while (this.active.length) this.recycle(this.active.length - 1);
  }

  private recycle(i: number): void {
    const e = this.active[i];
    e.entity.enabled = false;
    this.active.splice(i, 1);
    this.pool.push(e);
  }
}
