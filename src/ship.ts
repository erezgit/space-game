import * as pc from "playcanvas";

export interface ShipRig {
  root: pc.Entity;
  body: pc.Entity;
  thrust: pc.Entity | null;
  velocity: pc.Vec3;
  /** Accumulated pitch in degrees (clamped ±60) */
  pitchDeg: number;
  /** Accumulated yaw in degrees (unlimited) */
  yawDeg: number;
}

/**
 * A beefier fighter built from primitives — readable silhouette from the
 * chase camera, clear direction (long nose → -Z), bright accent colors,
 * glowing engine exhaust.
 *
 * Scale: approximately 5 units long × 6 units wingspan × 1.4 tall.
 */
export function createShip(_app: pc.Application): ShipRig {
  const root = new pc.Entity("ship-root");
  const body = new pc.Entity("ship-body");
  root.addChild(body);

  // Materials
  const hullMat = new pc.StandardMaterial();
  hullMat.diffuse = new pc.Color(0.88, 0.92, 1.0);
  hullMat.emissive = new pc.Color(0.22, 0.26, 0.36);
  hullMat.emissiveIntensity = 0.9;
  hullMat.metalness = 0.6;
  hullMat.gloss = 0.85;
  hullMat.useMetalness = true;
  hullMat.update();

  const wingMat = new pc.StandardMaterial();
  wingMat.diffuse = new pc.Color(0.35, 0.4, 0.55);
  wingMat.emissive = new pc.Color(0.12, 0.14, 0.22);
  wingMat.emissiveIntensity = 0.8;
  wingMat.metalness = 0.55;
  wingMat.gloss = 0.7;
  wingMat.useMetalness = true;
  wingMat.update();

  const accentMat = new pc.StandardMaterial();
  accentMat.diffuse = new pc.Color(0.0, 0.0, 0.0);
  accentMat.emissive = new pc.Color(0.3, 0.9, 1.5);
  accentMat.emissiveIntensity = 2.6;
  accentMat.metalness = 0;
  accentMat.useMetalness = false;
  accentMat.update();

  const canopyMat = new pc.StandardMaterial();
  canopyMat.diffuse = new pc.Color(0.05, 0.2, 0.35);
  canopyMat.emissive = new pc.Color(0.3, 0.75, 1.2);
  canopyMat.emissiveIntensity = 1.4;
  canopyMat.metalness = 0.2;
  canopyMat.gloss = 0.95;
  canopyMat.useMetalness = true;
  canopyMat.opacity = 0.85;
  canopyMat.blendType = pc.BLEND_NORMAL;
  canopyMat.update();

  // ── Hull / fuselage (long box)
  const hull = new pc.Entity("hull");
  hull.addComponent("render", { type: "box", material: hullMat });
  hull.setLocalScale(1.3, 0.9, 4.0);
  hull.setLocalPosition(0, 0, 0);
  body.addChild(hull);

  // ── Long nose cone (clearly points forward -Z)
  const nose = new pc.Entity("nose");
  nose.addComponent("render", { type: "cone", material: hullMat });
  nose.setLocalScale(0.95, 1.8, 0.95);
  nose.setLocalPosition(0, 0, -2.9);
  nose.setLocalEulerAngles(-90, 0, 0); // cone's +Y becomes -Z (pointing forward)
  body.addChild(nose);

  // ── Canopy — teardrop on top of hull, front half
  const canopy = new pc.Entity("canopy");
  canopy.addComponent("render", { type: "sphere", material: canopyMat });
  canopy.setLocalScale(0.75, 0.55, 1.4);
  canopy.setLocalPosition(0, 0.55, -0.4);
  body.addChild(canopy);

  // ── Main wings — swept-back trapezoid. Using two boxes rotated for swept-delta look.
  const wingL = new pc.Entity("wing-l");
  wingL.addComponent("render", { type: "box", material: wingMat });
  wingL.setLocalScale(3.0, 0.22, 1.9);
  wingL.setLocalPosition(-1.7, -0.05, 0.4);
  wingL.setLocalEulerAngles(0, 18, 0); // sweep back
  body.addChild(wingL);

  const wingR = new pc.Entity("wing-r");
  wingR.addComponent("render", { type: "box", material: wingMat });
  wingR.setLocalScale(3.0, 0.22, 1.9);
  wingR.setLocalPosition(1.7, -0.05, 0.4);
  wingR.setLocalEulerAngles(0, -18, 0);
  body.addChild(wingR);

  // ── Secondary wings / stabilizers (smaller, higher)
  const stabL = new pc.Entity("stab-l");
  stabL.addComponent("render", { type: "box", material: wingMat });
  stabL.setLocalScale(0.16, 0.75, 0.9);
  stabL.setLocalPosition(-0.55, 0.45, 1.5);
  stabL.setLocalEulerAngles(0, 0, -16);
  body.addChild(stabL);

  const stabR = new pc.Entity("stab-r");
  stabR.addComponent("render", { type: "box", material: wingMat });
  stabR.setLocalScale(0.16, 0.75, 0.9);
  stabR.setLocalPosition(0.55, 0.45, 1.5);
  stabR.setLocalEulerAngles(0, 0, 16);
  body.addChild(stabR);

  // ── Wingtip accent lights — bright cyan spheres
  const tipL = new pc.Entity("tip-l");
  tipL.addComponent("render", { type: "sphere", material: accentMat });
  tipL.setLocalScale(0.32, 0.32, 0.32);
  tipL.setLocalPosition(-3.05, -0.05, 0.85);
  body.addChild(tipL);

  const tipR = new pc.Entity("tip-r");
  tipR.addComponent("render", { type: "sphere", material: accentMat });
  tipR.setLocalScale(0.32, 0.32, 0.32);
  tipR.setLocalPosition(3.05, -0.05, 0.85);
  body.addChild(tipR);

  // ── Engine exhaust cluster — three glowing cylinders at rear
  const engineGlowMat = new pc.StandardMaterial();
  engineGlowMat.diffuse = new pc.Color(0, 0, 0);
  engineGlowMat.emissive = new pc.Color(0.4, 1.0, 1.6);
  engineGlowMat.emissiveIntensity = 3.0;
  engineGlowMat.opacity = 0.95;
  engineGlowMat.blendType = pc.BLEND_ADDITIVE;
  engineGlowMat.depthWrite = false;
  engineGlowMat.update();

  const thrust = new pc.Entity("thrust");
  thrust.addComponent("render", { type: "cylinder", material: engineGlowMat });
  thrust.setLocalScale(0.55, 1.1, 0.55);
  thrust.setLocalPosition(0, 0, 2.2);
  thrust.setLocalEulerAngles(90, 0, 0);
  body.addChild(thrust);

  const thrustL = new pc.Entity("thrust-l");
  thrustL.addComponent("render", { type: "cylinder", material: engineGlowMat });
  thrustL.setLocalScale(0.32, 0.85, 0.32);
  thrustL.setLocalPosition(-0.85, -0.15, 2.0);
  thrustL.setLocalEulerAngles(90, 0, 0);
  body.addChild(thrustL);

  const thrustR = new pc.Entity("thrust-r");
  thrustR.addComponent("render", { type: "cylinder", material: engineGlowMat });
  thrustR.setLocalScale(0.32, 0.85, 0.32);
  thrustR.setLocalPosition(0.85, -0.15, 2.0);
  thrustR.setLocalEulerAngles(90, 0, 0);
  body.addChild(thrustR);

  // ── Trailing engine glow (additive sphere behind ship)
  const engineHalo = new pc.Entity("engine-halo");
  engineHalo.addComponent("render", { type: "sphere", material: engineGlowMat });
  engineHalo.setLocalScale(1.8, 0.9, 1.5);
  engineHalo.setLocalPosition(0, -0.05, 2.9);
  body.addChild(engineHalo);

  // ── Engine point light (cyan rim-light from behind)
  const engineLight = new pc.Entity("engine-light");
  engineLight.addComponent("light", {
    type: "point",
    color: new pc.Color(0.35, 0.85, 1.3),
    intensity: 2.2,
    range: 7,
  });
  engineLight.setLocalPosition(0, 0, 3.2);
  body.addChild(engineLight);

  // Self-light so the ship is never a dark silhouette against a dark nebula
  const selfLight = new pc.Entity("self-light");
  selfLight.addComponent("light", {
    type: "point",
    color: new pc.Color(1.0, 0.95, 0.9),
    intensity: 1.6,
    range: 12,
  });
  selfLight.setLocalPosition(0, 3.0, -1.5);
  body.addChild(selfLight);

  return {
    root,
    body,
    thrust,
    velocity: new pc.Vec3(),
    pitchDeg: 0,
    yawDeg: 0,
  };
}
