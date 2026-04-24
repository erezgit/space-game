import * as pc from "playcanvas";
import { createStarfieldSkybox } from "./skybox";
import { createShip, type ShipRig } from "./ship";
import { TouchControls, type ControlInput } from "./controls";
import { ProjectileSystem } from "./projectiles";
import { AsteroidSystem } from "./asteroids";
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
app.scene.ambientLight = new pc.Color(0.12, 0.13, 0.2);

window.addEventListener("resize", () => {
  app.resizeCanvas();
});

// Camera
const camera = new pc.Entity("camera");
camera.addComponent("camera", {
  clearColor: new pc.Color(0.02, 0.01, 0.05),
  fov: 72,
  nearClip: 0.1,
  farClip: 2000,
  toneMapping: pc.TONEMAP_ACES,
  gammaCorrection: pc.GAMMA_SRGB,
});
app.root.addChild(camera);

// Lighting — key light + rim
const keyLight = new pc.Entity("key-light");
keyLight.addComponent("light", {
  type: "directional",
  color: new pc.Color(1, 0.95, 0.85),
  intensity: 1.4,
  castShadows: false,
});
keyLight.setEulerAngles(40, 30, 0);
app.root.addChild(keyLight);

const rimLight = new pc.Entity("rim-light");
rimLight.addComponent("light", {
  type: "directional",
  color: new pc.Color(0.55, 0.75, 1.2),
  intensity: 1.1,
});
rimLight.setEulerAngles(-30, -140, 0);
app.root.addChild(rimLight);

const fillLight = new pc.Entity("fill-light");
fillLight.addComponent("light", {
  type: "directional",
  color: new pc.Color(0.9, 0.4, 1.0),
  intensity: 0.5,
});
fillLight.setEulerAngles(70, 200, 0);
app.root.addChild(fillLight);

// Procedural starfield skybox
createStarfieldSkybox(app);

// Ship (player rig)
const shipRig: ShipRig = createShip(app);
app.root.addChild(shipRig.root);

// Camera follows ship (chase cam). Ship forward = -Z, so camera sits at +Z behind,
// above so the hull/wings silhouette reads well. Look point is low + forward so
// the ship appears tilted from this vantage.
const CAMERA_OFFSET_LOCAL = new pc.Vec3(0, 3.6, 8.5);
const CAMERA_LOOK_OFFSET = new pc.Vec3(0, -2.5, -18);

// Systems
const particles = new ParticleSystem(app);
const projectiles = new ProjectileSystem(app);
const asteroids = new AsteroidSystem(app);
const state = new GameState();
const hud = new HUD();
const controls = new TouchControls();

// Initial population
asteroids.spawnInitial(shipRig.root.getPosition(), 14);

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
  asteroids.clear();
  projectiles.clear();
  particles.clear();
  shipRig.root.setPosition(0, 0, 0);
  shipRig.root.setEulerAngles(0, 0, 0);
  shipRig.velocity.set(0, 0, 0);
  asteroids.spawnInitial(shipRig.root.getPosition(), 14);
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
const FIRE_INTERVAL = 0.14;

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

  projectiles.update(dt);
  asteroids.update(dt, shipRig.root.getPosition());
  particles.update(dt);

  // Collisions: projectiles vs asteroids
  const hits = asteroids.checkProjectileHits(projectiles.active);
  for (const hit of hits) {
    particles.spawnExplosion(hit.position, hit.size);
    state.addScore(hit.scoreValue);
    hud.setScore(state.score);
  }

  // Collisions: asteroid vs player
  if (alive) {
    const damaged = asteroids.checkPlayerHit(
      shipRig.root.getPosition(),
      1.2 // ship collision radius
    );
    if (damaged) {
      particles.spawnExplosion(shipRig.root.getPosition(), 0.6);
      hud.flashDamage();
      state.takeDamage();
      hud.setHealth(state.health);
      if (!state.alive) {
        hud.showDeath(state.score);
      }
    }
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

function updateShip(rig: ShipRig, input: ControlInput, dt: number): void {
  // Auto-forward thrust with gentle forward acceleration
  const FORWARD_SPEED = 18;
  const ACCEL = 10;

  // Target angular velocity from joystick
  // input.x: -1..1 (yaw), input.y: -1..1 (pitch, -y = nose up)
  const PITCH_RATE = 1.6; // rad/s
  const YAW_RATE = 1.5;
  const ROLL_RATE = 2.0; // bank into turns

  const targetPitch = -input.y * PITCH_RATE;
  const targetYaw = input.x * YAW_RATE;
  const targetRoll = -input.x * ROLL_RATE;

  // Smooth lerp angular inputs
  rig.pitchRate = pc.math.lerp(rig.pitchRate, targetPitch, Math.min(1, dt * 6));
  rig.yawRate = pc.math.lerp(rig.yawRate, targetYaw, Math.min(1, dt * 6));
  rig.rollTarget = pc.math.lerp(rig.rollTarget, targetRoll, Math.min(1, dt * 6));

  // Apply rotations — pitch around local X, yaw around local Y
  rig.root.rotateLocal(rig.pitchRate * dt * pc.math.RAD_TO_DEG, 0, 0);
  rig.root.rotateLocal(0, rig.yawRate * dt * pc.math.RAD_TO_DEG, 0);

  // Visual roll on mesh only (not the whole rig — we want movement to stay flat-ish)
  const currentRoll = rig.body.getLocalEulerAngles().z;
  const newRoll = pc.math.lerp(
    currentRoll,
    rig.rollTarget * pc.math.RAD_TO_DEG,
    Math.min(1, dt * 5)
  );
  rig.body.setLocalEulerAngles(0, 0, newRoll);

  // Forward velocity: ship always moves in its local +Z
  const fwd = rig.root.forward;
  const targetVel = new pc.Vec3(
    fwd.x * FORWARD_SPEED,
    fwd.y * FORWARD_SPEED,
    fwd.z * FORWARD_SPEED
  );

  rig.velocity.lerp(rig.velocity, targetVel, Math.min(1, dt * ACCEL * 0.2));

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
    asteroids,
    projectiles,
    particles,
    state,
  };
}

app.start();
