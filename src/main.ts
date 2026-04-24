import * as pc from "playcanvas";
import { createStarfieldSkybox } from "./skybox";
import { createShip, type ShipRig } from "./ship";
import { TouchControls, type ControlInput } from "./controls";
import { ProjectileSystem } from "./projectiles";
import { AsteroidSystem } from "./asteroids";
import { ParticleSystem } from "./particles";
import { GameState } from "./state";
import { HUD } from "./hud";
import { buildWorld } from "./world";

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

// HDR bloom via CameraFrame — gives nebulae + engines that cinematic glow
try {
  const cameraComp = camera.camera;
  if (cameraComp) {
    const frame = new pc.CameraFrame(app, cameraComp);
    frame.bloom.intensity = 0.045;
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

// Ship (player rig)
const shipRig: ShipRig = createShip(app);
app.root.addChild(shipRig.root);

// Distant cosmic scenery — nebulae, galaxies, civilization set pieces.
// Parented in a parallax container that follows the ship.
buildWorld({ app, root: app.root, follow: shipRig.root });

// Camera follows ship (chase cam). Ship forward = -Z; camera sits at +Z behind,
// above, looking slightly down at the ship for a clear silhouette.
const CAMERA_OFFSET_LOCAL = new pc.Vec3(0, 2.6, 7.5);
const CAMERA_LOOK_OFFSET = new pc.Vec3(0, 0.2, -14);

// Systems
const particles = new ParticleSystem(app);
const projectiles = new ProjectileSystem(app);
const asteroids = new AsteroidSystem(app);
const state = new GameState();
const hud = new HUD();
const controls = new TouchControls();

// Initial population
asteroids.spawnInitial(shipRig.root.getPosition(), 14, shipRig.root.forward);

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
  shipRig.pitchDeg = 0;
  shipRig.yawDeg = 0;
  asteroids.spawnInitial(shipRig.root.getPosition(), 14, shipRig.root.forward);
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
  asteroids.update(dt, shipRig.root.getPosition(), shipRig.root.forward);
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
  const FORWARD_SPEED = 22;
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
    asteroids,
    projectiles,
    particles,
    state,
  };
}

app.start();
