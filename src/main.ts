import * as pc from "playcanvas";
import { type ShipRig } from "./ship";
import { createJet } from "./jet";
import { createWarSky, HAZE, SUN_DIR } from "./warsky";
import { Terrain, heightAt, WORLD_HALF } from "./terrain";
import { City } from "./city";
import { EnemySystem, type Kill } from "./enemies";
import { MissileSystem } from "./missiles";
import { Targeting } from "./targeting";
import { SmokeSystem } from "./smoke";
import { Sound } from "./audio";
import { TouchControls, type ControlInput } from "./controls";
import { ProjectileSystem } from "./projectiles";
import { ParticleSystem } from "./particles";
import { GameState } from "./state";
import { HUD } from "./hud";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas not found");

const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  touch: new pc.TouchDevice(canvas),
  graphicsDeviceOptions: { alpha: false, antialias: true, powerPreference: "high-performance" },
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener("resize", () => app.resizeCanvas());

// ── Atmosphere: afternoon light, haze that swallows the far mountains.
app.scene.exposure = 1.1;
app.scene.ambientLight = new pc.Color(0.42, 0.44, 0.5);
app.scene.fog.type = pc.FOG_LINEAR;
app.scene.fog.color = new pc.Color(HAZE[0], HAZE[1], HAZE[2]);
app.scene.fog.start = 500;
app.scene.fog.end = 3600;

const camera = new pc.Entity("camera");
camera.addComponent("camera", {
  clearColor: new pc.Color(HAZE[0], HAZE[1], HAZE[2]),
  fov: 70,
  nearClip: 0.4,
  farClip: 5000,
  toneMapping: pc.TONEMAP_ACES,
  gammaCorrection: pc.GAMMA_SRGB,
});
app.root.addChild(camera);

// The sun. A directional light shines down its entity's -Y, so point +Y at the sun.
const sun = new pc.Entity("sun");
sun.addComponent("light", {
  type: "directional",
  color: new pc.Color(1.0, 0.93, 0.82),
  intensity: 1.8,
  castShadows: true,
  shadowDistance: 420,
  shadowResolution: 2048,
  numCascades: 2,
  shadowBias: 0.3,
  normalOffsetBias: 0.6,
});
{
  const s = new pc.Vec3(...SUN_DIR).normalize();
  const up = pc.Vec3.UP;
  const axis = new pc.Vec3().cross(up, s).normalize();
  const ang = Math.acos(up.dot(s)) * pc.math.RAD_TO_DEG;
  sun.setRotation(new pc.Quat().setFromAxisAngle(axis, ang));
}
app.root.addChild(sun);
const skyFill = new pc.Entity("sky-fill");
skyFill.addComponent("light", { type: "directional", color: new pc.Color(0.55, 0.65, 0.85), intensity: 0.35 });
skyFill.setEulerAngles(0, 0, 0);
app.root.addChild(skyFill);

createWarSky(app, camera);

try {
  const frame = new pc.CameraFrame(app, camera.camera!);
  frame.bloom.intensity = 0.02;
  frame.bloom.blurLevel = 12;
  frame.vignette.inner = 0.75;
  frame.vignette.outer = 1.7;
  frame.vignette.intensity = 0.3;
  frame.update();
} catch (err) {
  console.warn("Bloom post-processing unavailable:", err);
}

// ── World
new Terrain(app);
const city = new City(app);

// ── The player's F-35. Start high over the Hudson, heading south toward downtown and the harbour.
const shipRig: ShipRig = createJet(app);
app.root.addChild(shipRig.root);
const START_POS = new pc.Vec3(262, 115, 520);

const CAMERA_OFFSET_LOCAL = new pc.Vec3(0, 2.8, 9.5);
const CAMERA_LOOK_OFFSET = new pc.Vec3(0, 0.6, -16);

// ── Systems
const particles = new ParticleSystem(app);
const projectiles = new ProjectileSystem(app, { color: [1.6, 1.1, 0.3], speed: 150, life: 1.6, width: 0.16, length: 1.6 });
const enemyBullets = new ProjectileSystem(app, { color: [1.8, 0.2, 0.1], speed: 110, life: 2.4, width: 0.2, length: 1.8, max: 128 });
const smoke = new SmokeSystem(app, 520);
const trail = new SmokeSystem(app, 480, [0.9, 0.9, 0.9], 0.38);
const enemies = new EnemySystem(app, heightAt);
const missiles = new MissileSystem(app);
const targeting = new Targeting();
const sound = new Sound();
const state = new GameState();
const hud = new HUD();
const controls = new TouchControls();

const el = (id: string) => document.getElementById(id) as HTMLElement;
const altEl = el("alt"), spdEl = el("spd"), mslEl = el("msl"), killsEl = el("kills"), warnEl = el("warning"), feedEl = el("kill-feed");
const missileBtn = el("missile-btn");

const SPEED = 36;
let kills = 0;
let fireCooldown = 0;
let missileCooldown = 0;
let invulnerable = 0;
let flakTimer = 1;
let fireSmokeTimer = 0;
let clock = 0;

function resetPlayer(): void {
  shipRig.root.setPosition(START_POS);
  shipRig.root.setEulerAngles(0, 0, 0);
  shipRig.velocity.set(0, 0, 0);
  shipRig.pitchDeg = 0;
  shipRig.yawDeg = 0;
  snapCamera();
}

function snapCamera(): void {
  const p = shipRig.root.getPosition();
  camera.setPosition(p.x + CAMERA_OFFSET_LOCAL.x, p.y + CAMERA_OFFSET_LOCAL.y, p.z + CAMERA_OFFSET_LOCAL.z);
  camera.lookAt(p.x + CAMERA_LOOK_OFFSET.x, p.y + CAMERA_LOOK_OFFSET.y, p.z + CAMERA_LOOK_OFFSET.z);
}
resetPlayer();

hud.onRestart(() => {
  state.reset();
  kills = 0;
  killsEl.textContent = "0";
  enemies.clear();
  missiles.clear();
  projectiles.clear();
  enemyBullets.clear();
  particles.clear();
  smoke.clear();
  trail.clear();
  targeting.reset();
  invulnerable = 0;
  resetPlayer();
  hud.hideDeath();
  hud.setScore(0);
  hud.setHealth(state.health);
});
hud.setHealth(state.health);
hud.setScore(0);

function feed(text: string): void {
  const d = document.createElement("div");
  d.textContent = text;
  feedEl.appendChild(d);
  setTimeout(() => d.remove(), 1700);
}

function onKill(k: Kill, byMissile: boolean): void {
  state.addScore(k.score + (byMissile ? 50 : 0));
  hud.setScore(state.score);
  kills++;
  killsEl.textContent = String(kills);
  sound.explosion(k.kind === "bomber");
  feed(k.kind === "bomber" ? `BOMBER DOWN +${k.score}` : byMissile ? `SPLASH ONE +${k.score + 50}` : `KILL +${k.score}`);
}

function damagePlayer(at: pc.Vec3, size: number): void {
  if (invulnerable > 0 || !state.alive) return;
  particles.spawnExplosion(at, size);
  smoke.spawn(at, 3, 1.5);
  hud.flashDamage();
  sound.hit();
  state.takeDamage();
  hud.setHealth(state.health);
  invulnerable = 0.6;
  if (!state.alive) {
    particles.spawnExplosion(at, 3);
    for (let k = 0; k < 8; k++) smoke.spawn(at, 6 + Math.random() * 6, 4);
    sound.explosion(true);
    hud.showDeath(state.score);
  }
}

const tmpVec = new pc.Vec3(), tmpVec2 = new pc.Vec3(), tmpQuat = new pc.Quat();

app.on("update", (dt: number) => {
  dt = Math.min(dt, 0.05);
  clock += dt;
  const alive = state.alive;
  const input: ControlInput = controls.sample();

  if (alive) {
    updateShip(shipRig, input, dt);
    fireCooldown -= dt;
    if (input.firing && fireCooldown <= 0) {
      fireGuns(shipRig);
      fireCooldown = 0.09;
    }
    missileCooldown -= dt;
    if (input.missile && missileCooldown <= 0) {
      const target = targeting.locked ? targeting.target : null;
      if (missiles.launch(shipRig.root, shipRig.velocity, target)) {
        sound.missile();
        missileCooldown = 1.0;
        if (target) { feed("FOX TWO"); targeting.reset(); }
      }
    }
  }

  invulnerable = Math.max(0, invulnerable - dt);
  const pos = shipRig.root.getPosition();
  projectiles.update(dt);
  enemyBullets.update(dt);
  particles.update(dt);
  smoke.update(dt);
  trail.update(dt);
  city.update(dt);
  enemies.update(dt, state.score, pos, shipRig.root.forward, shipRig.velocity, enemyBullets, particles, smoke);
  missiles.update(dt, enemies, particles, trail, (k) => onKill(k, true), heightAt);
  if (alive) targeting.update(dt, camera, shipRig.root, enemies);
  sound.setLock(alive ? targeting.state : 0, clock);

  for (const k of enemies.checkProjectileHits(projectiles.active, particles, smoke, projectiles)) onKill(k, false);

  if (alive) {
    for (let i = enemyBullets.active.length - 1; i >= 0; i--) {
      const bp = enemyBullets.active[i].entity.getPosition();
      if (bp.distance(pos) < 2.2) {
        enemyBullets.recycle(i);
        damagePlayer(bp, 0.6);
      }
    }
    // Buildings, terrain and water.
    const ground = Math.max(heightAt(pos.x, pos.z), 0);
    if (city.hit(pos, 1.8) || pos.y < ground + 1.5) {
      damagePlayer(pos, 1.3);
      const fwd = shipRig.root.forward;
      pos.x -= fwd.x * 8; pos.z -= fwd.z * 8;
      pos.y = Math.max(pos.y + 5, ground + 8);
      shipRig.root.setPosition(pos);
      shipRig.pitchDeg = 35;
    }
  }

  // Smoke rising from the burning buildings near the player.
  fireSmokeTimer -= dt;
  if (fireSmokeTimer <= 0) {
    for (const f of city.firesNear(pos, 700)) {
      f.x += (Math.random() - 0.5) * 6; f.z += (Math.random() - 0.5) * 6;
      smoke.spawn(f, 10 + Math.random() * 8, 8, new pc.Vec3(2, 8 + Math.random() * 4, 1));
    }
    fireSmokeTimer = 0.3;
  }

  // Anti-aircraft fire bursting in the sky ahead.
  flakTimer -= dt;
  if (flakTimer <= 0) {
    const f = shipRig.root.forward;
    const d = 70 + Math.random() * 160;
    const fx = pos.x + f.x * d + (Math.random() - 0.5) * 120, fz = pos.z + f.z * d + (Math.random() - 0.5) * 120;
    const p = new pc.Vec3(fx, Math.max(heightAt(fx, fz) + 50, pos.y + (Math.random() - 0.3) * 70), fz);
    particles.spawnExplosion(p, 0.7);
    smoke.spawn(p, 3 + Math.random() * 2.5, 2.6, new pc.Vec3(0, 0.6, 0));
    flakTimer = 0.4 + Math.random() * 0.8;
  }

  // Leaving the battle area: warn and turn the jet back.
  const out = Math.hypot(pos.x, pos.z) > WORLD_HALF - 600;
  warnEl.classList.toggle("hidden", !out);
  if (out) warnEl.textContent = "RETURN TO THE BATTLE";

  // HUD readouts.
  altEl.textContent = `${Math.max(0, Math.round(pos.y - Math.max(heightAt(pos.x, pos.z), 0)))}`;
  spdEl.textContent = `${Math.round(SPEED * 18)}`;
  mslEl.textContent = missileCooldown > 0 ? "RELOAD" : targeting.locked ? "LOCK" : "READY";
  missileBtn.classList.toggle("cooling", missileCooldown > 0);
  sound.setEngine(SPEED);

  // Chase camera.
  tmpQuat.copy(shipRig.root.getRotation());
  tmpVec.copy(CAMERA_OFFSET_LOCAL);
  tmpQuat.transformVector(tmpVec, tmpVec);
  tmpVec2.add2(pos, tmpVec);
  const camPos = camera.getPosition();
  camPos.lerp(camPos, tmpVec2, Math.min(1, dt * 6));
  camera.setPosition(camPos);
  tmpVec.copy(CAMERA_LOOK_OFFSET);
  tmpQuat.transformVector(tmpVec, tmpVec);
  tmpVec2.add2(pos, tmpVec);
  camera.lookAt(tmpVec2);

  hud.tick(dt);
});

/**
 * ARCADE FLIGHT: yaw around world-up, pitch clamped to ±60°, constant speed.
 * The body banks into turns for looks only; controls never roll.
 */
function updateShip(rig: ShipRig, input: ControlInput, dt: number): void {
  const YAW_RATE_DEG = 72;
  const PITCH_RATE_DEG = 55;
  const PITCH_LIMIT_DEG = 60;

  let yawInput = input.x;
  // Outside the battle area, the jet is steered back toward the city.
  const p = rig.root.getPosition();
  if (Math.hypot(p.x, p.z) > WORLD_HALF - 600) {
    const home = Math.atan2(p.x, p.z) * pc.math.RAD_TO_DEG; // yaw that faces the origin
    const diff = ((home - rig.yawDeg + 540) % 360) - 180;
    yawInput = pc.math.clamp(-diff / 30, -1, 1);
  }

  rig.yawDeg += -yawInput * YAW_RATE_DEG * dt;
  rig.pitchDeg = pc.math.clamp(rig.pitchDeg - input.y * PITCH_RATE_DEG * dt, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  rig.root.setEulerAngles(rig.pitchDeg, rig.yawDeg, 0);

  // Cosmetic bank.
  const bank = rig.body.getLocalEulerAngles().z;
  const targetBank = -yawInput * 35;
  rig.body.setLocalEulerAngles(0, 0, bank + (targetBank - bank) * Math.min(1, dt * 5));

  const fwd = rig.root.forward;
  rig.velocity.set(fwd.x * SPEED, fwd.y * SPEED, fwd.z * SPEED);
  p.x += rig.velocity.x * dt;
  p.y += rig.velocity.y * dt;
  p.z += rig.velocity.z * dt;
  rig.root.setPosition(p);

  if (rig.thrust) {
    const k = 1 + Math.sin(performance.now() * 0.03) * 0.12 + Math.random() * 0.06;
    rig.thrust.setLocalScale(0.6, 1.8 * k, 0.6);
  }
}

let gunSide = 1;
function fireGuns(rig: ShipRig): void {
  const fwd = rig.root.forward.clone();
  const offset = new pc.Vec3(0.6 * gunSide, 0.1, -3.5);
  gunSide = -gunSide;
  rig.root.getRotation().transformVector(offset, offset);
  const p = rig.root.getPosition().clone().add(offset);
  projectiles.spawn(p, fwd, rig.velocity);
  sound.gun();
}

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = {
    app, shipRig, enemies, city, projectiles, particles, state, missiles, targeting, camera,
  };
}

app.start();
