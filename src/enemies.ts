import * as pc from "playcanvas";
import type { Projectile, ProjectileSystem } from "./projectiles";
import type { ParticleSystem } from "./particles";
import type { SmokeSystem } from "./smoke";
import { MeshBuilder, vertexColorMaterial } from "./geom";

/**
 * Enemy aircraft.
 *
 *  FIGHTERS hunt the player: they lead the target, fire tracer bursts when
 *  lined up, and break off when they get too close. Two hits bring one down.
 *
 *  BOMBERS are big and slow. They cross the map on a straight line through
 *  the city and carpet-bomb it; a tail gunner fires back. Five hits.
 *
 * A downed aircraft bursts into flame and falls, trailing smoke, until it
 * hits the ground. More of both appear as the score rises.
 */

type Kind = "fighter" | "bomber";
type Mode = "hunt" | "breakoff" | "cruise" | "falling";

export interface Enemy {
  id: number;
  kind: Kind;
  entity: pc.Entity;
  body: pc.Entity;
  dir: pc.Vec3;
  speed: number;
  hp: number;
  mode: Mode;
  modeTimer: number;
  fireCooldown: number;
  burstLeft: number;
  roll: number;
  fallVel: pc.Vec3;
  smokeTimer: number;
  bombTimer: number;
}

export interface Kill { position: pc.Vec3; score: number; kind: Kind }

const TURN_RATE = 0.95; // rad/s
const FIRE_RANGE = 140;
const SPEC = {
  fighter: { hp: 2, score: 100, radius: 3.6, speedMin: 30, speedMax: 38 },
  bomber: { hp: 5, score: 300, radius: 8, speedMin: 20, speedMax: 24 },
};

export class EnemySystem {
  readonly active: Enemy[] = [];
  private pools: Record<Kind, Enemy[]> = { fighter: [], bomber: [] };
  private meshes: Record<Kind, pc.Mesh>;
  private mat: pc.StandardMaterial;
  private glow: pc.StandardMaterial;
  private spawnTimer = { fighter: 0, bomber: 4 };
  private pendingBombs: { at: pc.Vec3; t: number }[] = [];
  private nextId = 1;

  constructor(private app: pc.Application, private groundHeight: (x: number, z: number) => number) {
    this.mat = vertexColorMaterial({ gloss: 0.4, metalness: 0.3 });
    this.mat.cull = pc.CULLFACE_NONE;
    this.mat.update();
    this.glow = new pc.StandardMaterial();
    this.glow.diffuse = new pc.Color(0, 0, 0);
    this.glow.emissive = new pc.Color(1.5, 0.5, 0.1);
    this.glow.emissiveIntensity = 2.2;
    this.glow.blendType = pc.BLEND_ADDITIVE;
    this.glow.depthWrite = false;
    this.glow.update();
    this.meshes = { fighter: this.fighterMesh(), bomber: this.bomberMesh() };
  }

  private fighterMesh(): pc.Mesh {
    const b = new MeshBuilder();
    const body = [0.28, 0.3, 0.27, 1], dark = [0.18, 0.2, 0.18, 1], red = [0.75, 0.08, 0.06, 1];
    b.plate([[0, -3.6], [0.5, -2.2], [0.6, 2.8], [-0.6, 2.8], [-0.5, -2.2]], 0, 0.8, body);   // fuselage
    b.plate([[0, -2.2], [0.3, -1.2], [0.3, 0.2], [-0.3, 0.2], [-0.3, -1.2]], 0.5, 0.35, [0.5, 0.6, 0.65, 1]); // canopy
    const wing: [number, number][] = [[0.5, -0.8], [3.8, 1.0], [3.8, 1.8], [0.5, 1.6]];
    b.plate(wing, -0.1, 0.14, dark);
    b.plate(wing.map(([x, z]) => [-x, z] as [number, number]).reverse(), -0.1, 0.14, dark);
    b.plate([[0.4, 2.2], [1.8, 3.0], [1.8, 3.4], [0.4, 3.3]], 0.1, 0.1, dark);
    b.plate([[-0.4, 2.2], [-0.4, 3.3], [-1.8, 3.4], [-1.8, 3.0]], 0.1, 0.1, dark);
    b.box(0, 0.9, 2.7, 0.12, 1.4, 1.2, dark);                                                // fin
    b.box(3.0, -0.02, 1.2, 0.9, 0.18, 0.6, red);                                              // markings
    b.box(-3.0, -0.02, 1.2, 0.9, 0.18, 0.6, red);
    b.box(0, 0.9, 2.9, 0.16, 0.5, 0.5, red);
    return b.build(this.app.graphicsDevice);
  }

  private bomberMesh(): pc.Mesh {
    const b = new MeshBuilder();
    const body = [0.36, 0.37, 0.34, 1], dark = [0.24, 0.25, 0.23, 1], red = [0.7, 0.08, 0.06, 1];
    b.plate([[0, -6], [0.9, -4.5], [1.1, 4.5], [0.5, 6.2], [-0.5, 6.2], [-1.1, 4.5], [-0.9, -4.5]], 0, 1.8, body);
    b.plate([[0, -5.6], [0.6, -4.6], [0.6, -3.6], [-0.6, -3.6], [-0.6, -4.6]], 0.95, 0.4, [0.45, 0.55, 0.6, 1]);
    const wing: [number, number][] = [[1, -1.4], [11, 0.4], [11, 1.6], [1, 1.8]];
    b.plate(wing, 0.2, 0.3, dark);
    b.plate(wing.map(([x, z]) => [-x, z] as [number, number]).reverse(), 0.2, 0.3, dark);
    for (const x of [-7, -3.5, 3.5, 7]) b.box(x, -0.2, -0.4, 0.9, 0.9, 2.8, body);          // engines
    b.plate([[0.8, 4.6], [4.2, 5.6], [4.2, 6.2], [0.8, 6.1]], 0.4, 0.15, dark);
    b.plate([[-0.8, 4.6], [-0.8, 6.1], [-4.2, 6.2], [-4.2, 5.6]], 0.4, 0.15, dark);
    b.box(0, 2.2, 5.3, 0.2, 3, 1.8, dark);                                                   // fin
    b.box(8.5, 0.37, 0.8, 1.6, 0.1, 1.0, red);
    b.box(-8.5, 0.37, 0.8, 1.6, 0.1, 1.0, red);
    return b.build(this.app.graphicsDevice);
  }

  private build(kind: Kind): Enemy {
    const entity = new pc.Entity(kind);
    const body = new pc.Entity(`${kind}-body`);
    entity.addChild(body);
    body.addComponent("render", { meshInstances: [new pc.MeshInstance(this.meshes[kind], this.mat)] });
    const exhausts = kind === "fighter" ? [[0, 0, 3.0]] : [[-7, -0.2, 1.1], [-3.5, -0.2, 1.1], [3.5, -0.2, 1.1], [7, -0.2, 1.1]];
    for (const [x, y, z] of exhausts) {
      const g = new pc.Entity("exhaust");
      g.addComponent("render", { type: "sphere", material: this.glow, castShadows: false });
      g.setLocalScale(0.5, 0.5, 0.9);
      g.setLocalPosition(x, y, z);
      body.addChild(g);
    }
    entity.enabled = false;
    this.app.root.addChild(entity);
    return {
      id: 0, kind, entity, body, dir: new pc.Vec3(0, 0, -1), speed: 30, hp: 2, mode: "hunt", modeTimer: 0,
      fireCooldown: 0, burstLeft: 0, roll: 0, fallVel: new pc.Vec3(), smokeTimer: 0, bombTimer: 0,
    };
  }

  static targetCount(score: number): { fighter: number; bomber: number } {
    return { fighter: Math.min(4 + Math.floor(score / 300), 12), bomber: Math.min(1 + Math.floor(score / 900), 4) };
  }

  private spawn(kind: Kind, playerPos: pc.Vec3, playerFwd: pc.Vec3): void {
    const e = this.pools[kind].pop() ?? this.build(kind);
    const s = SPEC[kind];
    e.id = this.nextId++;
    e.hp = s.hp;
    e.speed = s.speedMin + Math.random() * (s.speedMax - s.speedMin);
    e.fireCooldown = 1.5 + Math.random() * 2;
    e.burstLeft = 0;
    e.roll = 0;
    e.modeTimer = 0;
    e.bombTimer = 1;
    if (kind === "fighter") {
      const yaw = Math.atan2(-playerFwd.x, -playerFwd.z) + (Math.random() - 0.5) * 2.6;
      const dist = 260 + Math.random() * 140;
      const x = playerPos.x - Math.sin(yaw) * dist, z = playerPos.z - Math.cos(yaw) * dist;
      const y = Math.max(this.groundHeight(x, z) + 60, playerPos.y + (Math.random() - 0.35) * 70);
      e.entity.setPosition(x, y, z);
      e.dir.set(playerPos.x - x, playerPos.y - y, playerPos.z - z).normalize();
      e.mode = "hunt";
    } else {
      // A bombing run: enter 900 m from the city, fly straight across it.
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * 900, z = Math.sin(a) * 900;
      const tx = (Math.random() - 0.5) * 200, tz = (Math.random() - 0.5) * 300;
      e.entity.setPosition(x, 170 + Math.random() * 60, z);
      e.dir.set(tx - x, 0, tz - z).normalize();
      e.mode = "cruise";
    }
    e.entity.enabled = true;
    this.active.push(e);
  }

  update(
    dt: number, score: number, playerPos: pc.Vec3, playerFwd: pc.Vec3, playerVel: pc.Vec3,
    bullets: ProjectileSystem, particles: ParticleSystem, smoke: SmokeSystem,
  ): void {
    const want = EnemySystem.targetCount(score);
    for (const kind of ["fighter", "bomber"] as Kind[]) {
      const flying = this.active.filter((e) => e.kind === kind && e.mode !== "falling").length;
      this.spawnTimer[kind] -= dt;
      if (flying < want[kind] && this.spawnTimer[kind] <= 0) {
        this.spawn(kind, playerPos, playerFwd);
        this.spawnTimer[kind] = kind === "fighter" ? 1.0 : 6;
      }
    }

    // Bombs landing.
    for (let i = this.pendingBombs.length - 1; i >= 0; i--) {
      const b = this.pendingBombs[i];
      b.t -= dt;
      if (b.t <= 0) {
        particles.spawnExplosion(b.at, 1.8);
        smoke.spawn(b.at, 9 + Math.random() * 5, 5, new pc.Vec3(0, 5, 0));
        this.pendingBombs.splice(i, 1);
      }
    }

    const toP = new pc.Vec3(), desired = new pc.Vec3(), pos = new pc.Vec3();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      pos.copy(e.entity.getPosition());
      const ground = this.groundHeight(pos.x, pos.z);

      if (e.mode === "falling") {
        e.fallVel.y -= 22 * dt;
        pos.x += e.fallVel.x * dt; pos.y += e.fallVel.y * dt; pos.z += e.fallVel.z * dt;
        e.entity.setPosition(pos);
        e.roll += (e.kind === "bomber" ? 90 : 260) * dt;
        e.body.setLocalEulerAngles(15, 0, e.roll);
        e.smokeTimer -= dt;
        if (e.smokeTimer <= 0) {
          smoke.spawn(pos, (e.kind === "bomber" ? 6 : 3) + Math.random() * 2, 3.2, new pc.Vec3(0, 1.5, 0));
          particles.spawnExplosion(pos, 0.25);
          e.smokeTimer = 0.05;
        }
        e.modeTimer += dt;
        if (pos.y < Math.max(ground, 0) + 1 || e.modeTimer > 8) {
          particles.spawnExplosion(pos, e.kind === "bomber" ? 3.5 : 2.2);
          for (let k = 0; k < 7; k++) smoke.spawn(pos, 8 + Math.random() * 8, 5, new pc.Vec3((Math.random() - 0.5) * 4, 4, (Math.random() - 0.5) * 4));
          this.recycle(i);
        }
        continue;
      }

      toP.sub2(playerPos, pos);
      const dist = toP.length();
      if (dist > (e.kind === "bomber" ? 2200 : 700)) { this.recycle(i); continue; }
      toP.mulScalar(1 / Math.max(dist, 0.001));

      if (e.kind === "fighter") {
        e.modeTimer -= dt;
        if (e.mode === "hunt" && dist < 24) { e.mode = "breakoff"; e.modeTimer = 2 + Math.random(); }
        if (e.mode === "breakoff" && e.modeTimer <= 0) e.mode = "hunt";
        if (e.mode === "hunt") {
          desired.copy(playerVel).mulScalar(Math.min(dist / 90, 1.5)).add(playerPos).sub(pos).normalize();
        } else {
          desired.copy(toP).mulScalar(-1);
          desired.y = Math.abs(desired.y) + 0.3;
          desired.normalize();
        }
      } else {
        desired.copy(e.dir);
        // Carpet-bomb while over the city and the boroughs.
        if (Math.abs(pos.x) < 700 && Math.abs(pos.z) < 450) {
          e.bombTimer -= dt;
          if (e.bombTimer <= 0) {
            this.pendingBombs.push({ at: new pc.Vec3(pos.x + e.dir.x * 30, 2, pos.z + e.dir.z * 30), t: 2.2 });
            e.bombTimer = 0.45;
          }
        }
      }
      // Terrain avoidance.
      if (pos.y < ground + 45) desired.y = Math.max(desired.y, 0.6);
      if (e.kind === "fighter" && pos.y > 420) desired.y = Math.min(desired.y, -0.2);

      const maxTurn = (e.kind === "bomber" ? 0.3 : TURN_RATE) * dt;
      const ang = Math.acos(Math.max(-1, Math.min(1, e.dir.dot(desired.normalize()))));
      const k = ang > maxTurn ? maxTurn / ang : 1;
      const prevDir = e.dir.clone();
      e.dir.lerp(e.dir, desired, k).normalize();

      pos.x += e.dir.x * e.speed * dt; pos.y += e.dir.y * e.speed * dt; pos.z += e.dir.z * e.speed * dt;
      e.entity.setPosition(pos);
      const yaw = Math.atan2(-e.dir.x, -e.dir.z) * pc.math.RAD_TO_DEG;
      const pitch = Math.asin(Math.max(-1, Math.min(1, e.dir.y))) * pc.math.RAD_TO_DEG;
      const turn = new pc.Vec3().cross(prevDir, e.dir).y / Math.max(dt, 0.001);
      e.roll = pc.math.lerp(e.roll, pc.math.clamp(-turn * 40, -65, 65), Math.min(1, dt * 3));
      e.entity.setEulerAngles(pitch, yaw, 0);
      e.body.setLocalEulerAngles(0, 0, e.roll);

      // Guns: fighters when lined up; a bomber's tail gunner at anything close.
      e.fireCooldown -= dt;
      const aligned = e.kind === "bomber" ? dist < 110 : e.dir.dot(toP) > 0.96 && dist < FIRE_RANGE;
      if ((e.mode === "hunt" || e.kind === "bomber") && aligned && e.fireCooldown <= 0 && e.burstLeft === 0) {
        e.burstLeft = 3 + Math.floor(Math.random() * 3);
      }
      if (e.burstLeft > 0 && e.fireCooldown <= 0) {
        const aim = toP.clone();
        const spread = e.kind === "bomber" ? 0.14 : 0.08;
        aim.x += (Math.random() - 0.5) * spread; aim.y += (Math.random() - 0.5) * spread; aim.z += (Math.random() - 0.5) * spread;
        const muzzle = pos.clone().add(aim.clone().normalize().mulScalar(e.kind === "bomber" ? 8 : 3.5));
        bullets.spawn(muzzle, aim.normalize(), new pc.Vec3());
        e.burstLeft--;
        e.fireCooldown = e.burstLeft > 0 ? 0.11 : 2.2 + Math.random() * 1.8;
      }
    }
  }

  /** Aircraft that can still be targeted. */
  targets(): Enemy[] {
    return this.active.filter((e) => e.mode !== "falling");
  }

  radiusOf(e: Enemy): number {
    return SPEC[e.kind].radius;
  }

  /** Take `damage` off an aircraft; returns a Kill if it goes down. */
  damage(e: Enemy, damage: number, particles: ParticleSystem, smoke: SmokeSystem): Kill | null {
    if (e.mode === "falling") return null;
    e.hp -= damage;
    const ep = e.entity.getPosition();
    if (e.hp > 0) return null;
    e.mode = "falling";
    e.modeTimer = 0;
    e.smokeTimer = 0;
    e.fallVel.copy(e.dir).mulScalar(e.speed * 0.7);
    particles.spawnExplosion(ep, e.kind === "bomber" ? 2.4 : 1.6);
    smoke.spawn(ep, e.kind === "bomber" ? 12 : 7, 3);
    return { position: ep.clone(), score: SPEC[e.kind].score, kind: e.kind };
  }

  /** Player tracers vs aircraft. */
  checkProjectileHits(projectiles: Projectile[], particles: ParticleSystem, smoke: SmokeSystem, projSystem: ProjectileSystem): Kill[] {
    const kills: Kill[] = [];
    for (let pi = projectiles.length - 1; pi >= 0; pi--) {
      const pp = projectiles[pi].entity.getPosition();
      for (const e of this.active) {
        if (e.mode === "falling") continue;
        if (pp.distance(e.entity.getPosition()) > SPEC[e.kind].radius) continue;
        projSystem.recycle(pi);
        particles.spawnExplosion(pp, 0.35);
        const k = this.damage(e, 1, particles, smoke);
        if (k) kills.push(k);
        break;
      }
    }
    return kills;
  }

  clear(): void {
    while (this.active.length) this.recycle(this.active.length - 1);
    this.pendingBombs.length = 0;
  }

  private recycle(i: number): void {
    const e = this.active[i];
    e.entity.enabled = false;
    this.active.splice(i, 1);
    this.pools[e.kind].push(e);
  }
}
