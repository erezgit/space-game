import * as pc from "playcanvas";
import type { Projectile } from "./projectiles";

interface AsteroidRec {
  entity: pc.Entity;
  velocity: pc.Vec3;
  spin: pc.Vec3; // deg per second on each axis
  tier: 0 | 1 | 2;
  radius: number;
  alive: boolean;
}

export interface AsteroidHit {
  position: pc.Vec3;
  size: number;
  scoreValue: number;
}

const MAX_ASTEROIDS = 42;
const SPAWN_RADIUS = 72;
const DESPAWN_RADIUS = 90;
const BEHIND_DESPAWN_DIST = 30; // recycle asteroids that are behind the ship faster
const TIER_CONFIG = [
  { radius: 0.9, speedMin: 3, speedMax: 7, score: 50, color: [0.55, 0.5, 0.48] }, // small
  { radius: 1.7, speedMin: 2, speedMax: 5, score: 100, color: [0.62, 0.55, 0.5] }, // medium
  { radius: 2.9, speedMin: 1.2, speedMax: 3.5, score: 200, color: [0.7, 0.6, 0.55] }, // large
];

export class AsteroidSystem {
  public readonly active: AsteroidRec[] = [];
  private pool: pc.Entity[][] = [[], [], []]; // pool per tier
  private app: pc.Application;
  private materials: pc.StandardMaterial[] = [];
  private spawnTimer = 0;

  constructor(app: pc.Application) {
    this.app = app;

    for (let t = 0; t < 3; t++) {
      const mat = new pc.StandardMaterial();
      const c = TIER_CONFIG[t].color;
      mat.diffuse = new pc.Color(c[0], c[1], c[2]);
      mat.metalness = 0.08;
      mat.gloss = 0.12;
      mat.useMetalness = true;
      mat.bumpiness = 0.8;
      mat.update();
      this.materials.push(mat);
    }

    // Pre-create some asteroid entities
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < 14; i++) {
        const e = this.buildAsteroid(t as 0 | 1 | 2);
        e.enabled = false;
        app.root.addChild(e);
        this.pool[t].push(e);
      }
    }
  }

  private buildAsteroid(tier: 0 | 1 | 2): pc.Entity {
    const e = new pc.Entity(`asteroid-${tier}`);

    // Use a noise-distorted sphere mesh
    const mesh = this.createDistortedSphere(tier);
    const mi = new pc.MeshInstance(mesh, this.materials[tier]);
    e.addComponent("render", { meshInstances: [mi] });

    const baseScale = TIER_CONFIG[tier].radius;
    e.setLocalScale(baseScale, baseScale, baseScale);

    return e;
  }

  private createDistortedSphere(tier: 0 | 1 | 2): pc.Mesh {
    // Generate an icosphere-like mesh by taking PlayCanvas's sphere and distorting vertices
    const device = this.app.graphicsDevice;
    const subdivisions = tier === 0 ? 12 : 14;

    // Build a UV sphere manually with noise distortion
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const rings = subdivisions;
    const sectors = subdivisions;
    const R = 1 / (rings - 1);
    const S = 1 / (sectors - 1);

    // Seeded per-tier noise
    const seed = Math.random() * 1000;

    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sectors; s++) {
        const y = Math.sin(-Math.PI / 2 + Math.PI * r * R);
        const x = Math.cos(2 * Math.PI * s * S) * Math.sin(Math.PI * r * R);
        const z = Math.sin(2 * Math.PI * s * S) * Math.sin(Math.PI * r * R);

        // Noise distortion using a cheap trig function
        const n =
          Math.sin((x + seed) * 3.1) *
            Math.cos((y + seed) * 2.7) *
            Math.sin((z + seed) * 3.3) *
            0.22 +
          Math.sin((x + seed) * 7.0) * Math.cos((z + seed) * 6.5) * 0.08;

        const dist = 1 + n;
        positions.push(x * dist, y * dist, z * dist);
        normals.push(x, y, z); // approximate
      }
    }

    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < sectors - 1; s++) {
        const a = r * sectors + s;
        const b = r * sectors + (s + 1);
        const c = (r + 1) * sectors + (s + 1);
        const d = (r + 1) * sectors + s;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const mesh = new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setIndices(indices);
    mesh.update();
    return mesh;
  }

  private acquire(tier: 0 | 1 | 2): pc.Entity | null {
    let e = this.pool[tier].pop();
    if (!e) {
      if (this.active.length >= MAX_ASTEROIDS) return null;
      e = this.buildAsteroid(tier);
      this.app.root.addChild(e);
    }
    e.enabled = true;
    return e;
  }

  spawnInitial(centerPos: pc.Vec3, count: number, forwardDir?: pc.Vec3): void {
    // On first spawn keep asteroids at least 80 units away from the player so
    // nothing is blocking the view on frame 1.
    for (let i = 0; i < count; i++) {
      this.spawnAround(centerPos, forwardDir, 80);
    }
  }

  private spawnAround(
    centerPos: pc.Vec3,
    forwardDir?: pc.Vec3,
    minDist = 0
  ): void {
    if (this.active.length >= MAX_ASTEROIDS) return;

    const tier = (Math.random() < 0.2 ? 2 : Math.random() < 0.5 ? 0 : 1) as 0 | 1 | 2;
    const entity = this.acquire(tier);
    if (!entity) return;

    const cfg = TIER_CONFIG[tier];

    // Bias spawns toward the forward hemisphere if a direction is provided.
    // This keeps gameplay dense in front of the ship.
    let dirX: number;
    let dirY: number;
    let dirZ: number;

    const theta = Math.random() * Math.PI * 2;
    const u = Math.random();
    // When forwardDir given, pick from a narrow forward cone (cos between 0.94 and 1.0)
    // so asteroids land directly on the ship's flight path.
    const cosPhi = forwardDir ? 0.94 + u * 0.06 : 2 * u - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));

    if (forwardDir) {
      // Build orthonormal basis aligned to forwardDir
      const fx = forwardDir.x;
      const fy = forwardDir.y;
      const fz = forwardDir.z;
      // Pick an up vector not parallel to forward
      const upX = Math.abs(fy) < 0.9 ? 0 : 1;
      const upY = Math.abs(fy) < 0.9 ? 1 : 0;
      const upZ = 0;
      // right = forward × up
      const rxRaw = fy * upZ - fz * upY;
      const ryRaw = fz * upX - fx * upZ;
      const rzRaw = fx * upY - fy * upX;
      const rLen = Math.hypot(rxRaw, ryRaw, rzRaw) || 1;
      const rx = rxRaw / rLen;
      const ry = ryRaw / rLen;
      const rz = rzRaw / rLen;
      // trueUp = right × forward
      const tux = ry * fz - rz * fy;
      const tuy = rz * fx - rx * fz;
      const tuz = rx * fy - ry * fx;

      const vx = sinPhi * Math.cos(theta);
      const vy = sinPhi * Math.sin(theta);
      // World direction = vx*right + vy*trueUp + cosPhi*forward
      dirX = vx * rx + vy * tux + cosPhi * fx;
      dirY = vx * ry + vy * tuy + cosPhi * fy;
      dirZ = vx * rz + vy * tuz + cosPhi * fz;
    } else {
      dirX = sinPhi * Math.cos(theta);
      dirY = sinPhi * Math.sin(theta) * 0.4; // flatten vertical
      dirZ = cosPhi;
    }

    // For forward-biased spawns, spawn at medium distance so player has reaction time
    const rangeMin = forwardDir ? 0.55 : 0.7;
    const rangeMax = forwardDir ? 0.65 : 0.5;
    const rBase = SPAWN_RADIUS * (rangeMin + Math.random() * rangeMax);
    const r = Math.max(rBase, minDist);
    const sx = centerPos.x + r * dirX;
    const sy = centerPos.y + r * dirY;
    const sz = centerPos.z + r * dirZ;

    entity.setPosition(sx, sy, sz);
    entity.setEulerAngles(
      Math.random() * 360,
      Math.random() * 360,
      Math.random() * 360
    );

    const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
    // Velocity biased gently toward playspace but mostly random
    const vel = new pc.Vec3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 2
    );
    vel.normalize().mulScalar(speed);

    const spin = new pc.Vec3(
      (Math.random() - 0.5) * 60,
      (Math.random() - 0.5) * 60,
      (Math.random() - 0.5) * 60
    );

    this.active.push({
      entity,
      velocity: vel,
      spin,
      tier,
      radius: cfg.radius,
      alive: true,
    });
  }

  update(dt: number, playerPos: pc.Vec3, forwardDir?: pc.Vec3): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < MAX_ASTEROIDS) {
      // Spawn 1-2 per tick, forward-biased, never closer than 55 units so
      // the player always has reaction time.
      this.spawnAround(playerPos, forwardDir, 55);
      if (this.active.length < MAX_ASTEROIDS && Math.random() < 0.6) {
        this.spawnAround(playerPos, forwardDir, 55);
      }
      this.spawnTimer = 0.22 + Math.random() * 0.25;
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      const pos = a.entity.getPosition();
      pos.x += a.velocity.x * dt;
      pos.y += a.velocity.y * dt;
      pos.z += a.velocity.z * dt;
      a.entity.setPosition(pos);

      a.entity.rotate(a.spin.x * dt, a.spin.y * dt, a.spin.z * dt);

      // Despawn if far from player
      const dx = pos.x - playerPos.x;
      const dy = pos.y - playerPos.y;
      const dz = pos.z - playerPos.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > DESPAWN_RADIUS * DESPAWN_RADIUS) {
        this.recycle(i);
        continue;
      }
      // Despawn asteroids that are behind the ship or too far sideways,
      // keeping the forward cone densely populated.
      if (forwardDir) {
        const dot = dx * forwardDir.x + dy * forwardDir.y + dz * forwardDir.z;
        if (dot < -BEHIND_DESPAWN_DIST) {
          this.recycle(i);
          continue;
        }
        // Perpendicular distance from ship's forward axis
        const perp2 = dist2 - dot * dot;
        if (perp2 > 40 * 40) {
          this.recycle(i);
        }
      }
    }
  }

  checkProjectileHits(projectiles: Projectile[]): AsteroidHit[] {
    const hits: AsteroidHit[] = [];
    for (let pi = projectiles.length - 1; pi >= 0; pi--) {
      const proj = projectiles[pi];
      const pp = proj.entity.getPosition();
      for (let ai = this.active.length - 1; ai >= 0; ai--) {
        const a = this.active[ai];
        const ap = a.entity.getPosition();
        const dx = pp.x - ap.x;
        const dy = pp.y - ap.y;
        const dz = pp.z - ap.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Generous collision radius — projectiles move fast so we can tunnel;
        // bump effective hit radius to reduce frustration.
        const r = a.radius + 0.8;
        if (d2 < r * r) {
          hits.push({
            position: ap.clone(),
            size: a.radius,
            scoreValue: TIER_CONFIG[a.tier].score,
          });

          // Split large asteroid into 2 medium
          if (a.tier === 2) {
            this.splitAsteroid(ap);
          }

          this.recycle(ai);

          // Remove projectile
          proj.entity.enabled = false;
          proj.life = -1;
          break;
        }
      }
    }
    return hits;
  }

  private splitAsteroid(position: pc.Vec3): void {
    for (let i = 0; i < 2; i++) {
      const entity = this.acquire(1);
      if (!entity) return;
      entity.setPosition(
        position.x + (Math.random() - 0.5) * 2,
        position.y + (Math.random() - 0.5) * 2,
        position.z + (Math.random() - 0.5) * 2
      );
      entity.setEulerAngles(
        Math.random() * 360,
        Math.random() * 360,
        Math.random() * 360
      );
      const cfg = TIER_CONFIG[1];
      const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin) + 2;
      const vel = new pc.Vec3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 1,
        (Math.random() - 0.5) * 2
      );
      vel.normalize().mulScalar(speed);
      this.active.push({
        entity,
        velocity: vel,
        spin: new pc.Vec3(
          (Math.random() - 0.5) * 90,
          (Math.random() - 0.5) * 90,
          (Math.random() - 0.5) * 90
        ),
        tier: 1,
        radius: cfg.radius,
        alive: true,
      });
    }
  }

  checkPlayerHit(playerPos: pc.Vec3, playerRadius: number): boolean {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      const ap = a.entity.getPosition();
      const dx = ap.x - playerPos.x;
      const dy = ap.y - playerPos.y;
      const dz = ap.z - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = a.radius + playerRadius;
      if (d2 < r * r) {
        this.recycle(i);
        return true;
      }
    }
    return false;
  }

  private recycle(index: number): void {
    const a = this.active[index];
    a.entity.enabled = false;
    this.pool[a.tier].push(a.entity);
    this.active.splice(index, 1);
  }

  clear(): void {
    while (this.active.length > 0) {
      this.recycle(this.active.length - 1);
    }
  }
}
