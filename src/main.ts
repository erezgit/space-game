import * as pc from "playcanvas";
import { type ShipRig } from "./ship";
import { createJet } from "./jet";
import { createWarSky, HAZE } from "./warsky";
import { City } from "./city";
import { EnemySystem } from "./enemies";
import { SmokeSystem } from "./smoke";
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
  graphicsDeviceOptions: {
    alpha: false,
    antialias: true,
    powerPreference: "high-performance",
  },
});

app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.scene.exposure = 1.15;
app.scene.ambientLight = new pc.Color(0.3, 0.2, 0.16);
// Smoke haze: the far city fades into the burning horizon (and hides the tile seams).
app.scene.fog.type = pc.FOG_LINEAR;
app.scene.fog.color = new pc.Color(HAZE[0], HAZE[1], HAZE[2]);
app.scene.fog.start = 240;
app.scene.fog.end = 900;

window.addEventListener("resize", () => {
  app.resizeCanvas();
});

// Camera
const camera = new pc.Entity("camera");
camera.addComponent("camera", {
  clearColor: new pc.Color(HAZE[0], HAZE[1], HAZE[2]),
  fov: 72,
  nearClip: 0.3,
  farClip: 1400,
  toneMapping: pc.TONEMAP_ACES,
  gammaCorrection: pc.GAMMA_SRGB,
});
app.root.addChild(camera);

// Lighting — key light + rim
const keyLight = new pc.Entity("key-light");
keyLight.addComponent("light", {
  type: "directional",
  color: new pc.Color(1.0, 0.62, 0.38),
  intensity: 1.5,
  castShadows: false,
});
keyLight.setEulerAngles(35, 210, 0);
app.root.addChild(keyLight);

const rimLight = new pc.Entity("rim-light");
rimLight.addComponent("light", {
  type: "directional",
  color: new pc.Color(0.45, 0.5, 0.65),
  intensity: 0.6,
});
rimLight.setEulerAngles(-30, -140, 0);
app.root.addChild(rimLight);

const fillLight = new pc.Entity("fill-light");
fillLight.addComponent("light", {
  type: "directional",
  color: new pc.Color(1.0, 0.4, 0.15),
  intensity: 0.45,
});
fillLight.setEulerAngles(70, 200, 0);
app.root.addChild(fillLight);

// World War III sky
createWarSky(app, camera);

// HDR bloom via CameraFrame — gives nebulae + engines that cinematic glow
try {
  const cameraComp = camera.camera;
  if (cameraComp) {
    const frame = new pc.CameraFrame(app, cameraComp);
    frame.bloom.intensity = 0.03;
    frame.bloom.blurLevel = 14;
    frame.vignette.inner = 0.7;
    frame.vignette.outer = 1.6;
    frame.vignette.intensity = 0.35;
    frame.update();
  }
} catch (err) {
  // Bloom is a nice-to-have; if the runtime doesn't support it (older WebGL
  // paths) the game should still render cleanly without post-processing.
  console.warn("Bloom post-processing unavailable:", err);
}

// Player jet
const shipRig: ShipRig = createJet(app);
app.root.addChild(shipRig.root);
// Start over the river, heading up it, clear of every building.
const START_POS = new pc.Vec3(265, 120, 300);
shipRig.root.setPosition(START_POS);

// Manhattan at war
const city = new City(app);

// Camera follows ship (chase cam). Ship forward = -Z; camera sits at +Z behind,
// above, looking slightly down at the ship for a clear silhouette.
const CAMERA_OFFSET_LOCAL = new pc.Vec3(0, 2.6, 7.5);
const CAMERA_LOOK_OFFSET = new pc.Vec3(0, 0.2, -14);

// Systems
const particles = new ParticleSystem(app);
const projectiles = new ProjectileSystem(app, { color: [1.6, 1.1, 0.3], speed: 120, life: 1.8, width: 0.16, length: 1.4 });
const enemyBullets = new ProjectileSystem(app, { color: [1.8, 0.2, 0.1], speed: 105, life: 2.2, width: 0.2, length: 1.8, max: 96 });
const smoke = new SmokeSystem(app);
const enemies = new EnemySystem(app);
const state = new GameState();
const hud = new HUD();
const controls = new TouchControls();


// Snap camera to starting position so first frame isn't inside the ship
function snapCameraToShip(): void {
  const shipPos = shipRig.root.getPosition();
  camera.setPosition(
    shipPos.x + CAMERA_OFFSET_LOCAL.x,
    shipPos.y + CAMERA_OFFSET_LOCAL.y,
    shipPos.z + CAMERA_OFFSET_LOCAL.z
  );
  camera.lookAt(
    shipPos.x + CAMERA_LOOK_OFFSET.x,
    shipPos.y + CAMERA_LOOK_OFFSET.y,
    shipPos.z + CAMERA_LOOK_OFFSET.z
  );
}
snapCameraToShip();

// Restart
hud.onRestart(() => {
  state.reset();
  enemies.clear();
  projectiles.clear();
  enemyBullets.clear();
  particles.clear();
  smoke.clear();
  invulnerable = 0;
  shipRig.root.setPosition(START_POS);
  shipRig.root.setEulerAngles(0, 0, 0);
  shipRig.velocity.set(0, 0, 0);
  shipRig.pitchDeg = 0;
  shipRig.yawDeg = 0;
  snapCameraToShip();
  hud.hideDeath();
  hud.setScore(0);
  hud.setHealth(state.health);
});

hud.setHealth(state.health);
hud.setScore(0);

// Game loop
const tmpVec = new pc.Vec3();
const tmpVec2 = new pc.Vec3();
const tmpQuat = new pc.Quat();

let fireCooldown = 0;
const FIRE_INTERVAL = 0.11;
let invulnerable = 0;
let flakTimer = 1;
let fireSmokeTimer = 0;

function damagePlayer(at: pc.Vec3, size: number): void {
  if (invulnerable > 0 || !state.alive) return;
  particles.spawnExplosion(at, size);
  smoke.spawn(at, 3, 1.5);
  hud.flashDamage();
  state.takeDamage();
  hud.setHealth(state.health);
  invulnerable = 0.6;
  if (!state.alive) {
    particles.spawnExplosion(at, 2.5);
    for (let k = 0; k < 6; k++) smoke.spawn(at, 6 + Math.random() * 5, 3.5);
    hud.showDeath(state.score);
  }
}

app.on("update", (dt: number) => {
  const alive = state.alive;
  const input: ControlInput = controls.sample();

  if (alive) {
    updateShip(shipRig, input, dt);

    fireCooldown -= dt;
    if (input.firing && fireCooldown <= 0) {
      fireWeapon(shipRig);
      fireCooldown = FIRE_INTERVAL;
    }
  }

  invulnerable = Math.max(0, invulnerable - dt);
  const shipPosNow = shipRig.root.getPosition();
  projectiles.update(dt);
  enemyBullets.update(dt);
  particles.update(dt);
  smoke.update(dt);
  city.update(dt, shipPosNow);
  enemies.update(
    dt, state.score, shipPosNow, shipRig.root.forward, shipRig.velocity,
    enemyBullets, particles, smoke, (p) => city.hit(p, 1) >= 0,
  );

  // Player tracers vs enemy fighters
  const kills = enemies.checkProjectileHits(projectiles.active, particles, smoke, projectiles);
  for (const k of kills) {
    state.addScore(k.score);
    hud.setScore(state.score);
  }

  if (alive) {
    // Enemy tracers vs the jet
    for (let i = enemyBullets.active.length - 1; i >= 0; i--) {
      const bp = enemyBullets.active[i].entity.getPosition();
      if (bp.distance(shipPosNow) < 1.9) {
        enemyBullets.recycle(i);
        damagePlayer(bp, 0.6);
      }
    }
    // Buildings and the ground
    const top = city.hit(shipPosNow, 1.4);
    if (top >= 0) {
      damagePlayer(shipPosNow, 1.2);
      // Bounce: nose up and back out of the building.
      const fwd = shipRig.root.forward;
      shipPosNow.x -= fwd.x * 6; shipPosNow.z -= fwd.z * 6;
      shipPosNow.y = Math.max(shipPosNow.y + 4, 3);
      shipRig.root.setPosition(shipPosNow);
      shipRig.pitchDeg = 35;
    }
  }

  // Smoke rising from the burning rooftops near the player.
  fireSmokeTimer -= dt;
  if (fireSmokeTimer <= 0) {
    for (const f of city.firesNear(shipPosNow, 420)) {
      f.x += (Math.random() - 0.5) * 6; f.z += (Math.random() - 0.5) * 6;
      smoke.spawn(f, 10 + Math.random() * 8, 7, new pc.Vec3(1.5, 7 + Math.random() * 4, 0.8));
    }
    fireSmokeTimer = 0.28;
  }

  // Anti-aircraft fire bursting around the sky.
  flakTimer -= dt;
  if (flakTimer <= 0) {
    const f = shipRig.root.forward;
    const d = 50 + Math.random() * 110;
    const p = new pc.Vec3(
      shipPosNow.x + f.x * d + (Math.random() - 0.5) * 90,
      Math.max(40, shipPosNow.y + (Math.random() - 0.3) * 60),
      shipPosNow.z + f.z * d + (Math.random() - 0.5) * 90,
    );
    particles.spawnExplosion(p, 0.7);
    smoke.spawn(p, 3 + Math.random() * 2.5, 2.6, new pc.Vec3(0, 0.6, 0));
    flakTimer = 0.35 + Math.random() * 0.7;
  }

  // Camera follow (smooth chase)
  const shipPos = shipRig.root.getPosition();
  const shipRot = shipRig.root.getRotation();
  tmpQuat.copy(shipRot);
  tmpVec.copy(CAMERA_OFFSET_LOCAL);
  tmpQuat.transformVector(tmpVec, tmpVec);
  tmpVec2.add2(shipPos, tmpVec);

  // Lerp camera position
  const camPos = camera.getPosition();
  const lerp = Math.min(1, dt * 6);
  camPos.lerp(camPos, tmpVec2, lerp);
  camera.setPosition(camPos);

  // Look ahead of ship
  tmpVec.copy(CAMERA_LOOK_OFFSET);
  tmpQuat.transformVector(tmpVec, tmpVec);
  tmpVec2.add2(shipPos, tmpVec);
  camera.lookAt(tmpVec2);

  hud.tick(dt);
});

/**
 * ARCADE FLIGHT MODE.
 *
 * The ship never rolls/banks — roll is permanently zero.
 * Joystick right/left = yaw around WORLD-Y (horizontal turn).
 * Joystick down/up   = pitch (nose down / nose up), clamped to ±60° so the
 *                      player can never loop or flip upside-down.
 * Forward velocity is always along the ship's current forward vector at a
 * constant auto-speed.
 *
 * Because we accumulate Euler angles (yaw, pitch) directly and never roll,
 * left/right always maps to screen-left / screen-right regardless of pitch.
 */
function updateShip(rig: ShipRig, input: ControlInput, dt: number): void {
  const FORWARD_SPEED = 30;
  const YAW_RATE_DEG = 75;   // deg/sec at full stick
  const PITCH_RATE_DEG = 55; // deg/sec at full stick
  const PITCH_LIMIT_DEG = 60;

  // input.x  +1 = joystick right  => ship turns to screen-right.
  // input.y  +1 = joystick down   => ship pitches nose DOWN.
  //
  // In PlayCanvas, setEulerAngles(pitch, yaw, 0) with +yaw rotates the
  // forward vector toward -X (screen-left from the default -Z forward),
  // so we negate the yaw delta to make right-stick turn right.
  const targetYawDelta = -input.x * YAW_RATE_DEG * dt;
  const targetPitchDelta = -input.y * PITCH_RATE_DEG * dt;

  rig.yawDeg += targetYawDelta;
  rig.pitchDeg = pc.math.clamp(
    rig.pitchDeg + targetPitchDelta,
    -PITCH_LIMIT_DEG,
    PITCH_LIMIT_DEG
  );

  // Apply absolute Euler angles. Roll LOCKED to 0.
  // Note: PlayCanvas setEulerAngles applies ZYX order. We pass pitch (X),
  // yaw (Y), roll=0 (Z). The resulting `forward` for (pitch=0, yaw=Y) rotates
  // the world forward (-Z) by Y degrees around world-Y.
  rig.root.setEulerAngles(rig.pitchDeg, rig.yawDeg, 0);

  // Body mesh — also locked to zero roll. We no longer tilt it with input.
  rig.body.setLocalEulerAngles(0, 0, 0);

  // Forward velocity: ship always moves along its own forward vector at a
  // constant speed. Avoids the sluggish lerp of the old code.
  const fwd = rig.root.forward;
  rig.velocity.set(
    fwd.x * FORWARD_SPEED,
    fwd.y * FORWARD_SPEED,
    fwd.z * FORWARD_SPEED
  );

  const pos = rig.root.getPosition();
  pos.x += rig.velocity.x * dt;
  pos.y += rig.velocity.y * dt;
  pos.z += rig.velocity.z * dt;
  rig.root.setPosition(pos);

  // Engine trail pulse
  if (rig.thrust) {
    rig.thrust.setLocalScale(
      1,
      1,
      1.0 + Math.sin(performance.now() * 0.02) * 0.15
    );
  }
}

function fireWeapon(rig: ShipRig): void {
  const fwd = rig.root.forward.clone();
  const pos = rig.root.getPosition().clone();
  // Offset slightly forward from nose
  pos.x += fwd.x * 1.4;
  pos.y += fwd.y * 1.4;
  pos.z += fwd.z * 1.4;
  projectiles.spawn(pos, fwd, rig.velocity);
}

// Dev: expose for debugging
if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = {
    app,
    shipRig,
    enemies,
    city,
    projectiles,
    particles,
    state,
  };
}

app.start();
