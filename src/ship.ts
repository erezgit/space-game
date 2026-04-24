import * as pc from "playcanvas";

export interface ShipRig {
  root: pc.Entity;
  body: pc.Entity;
  thrust: pc.Entity | null;
  velocity: pc.Vec3;
  pitchRate: number;
  yawRate: number;
  rollTarget: number;
}

/**
 * Builds a ship from primitives — cone nose + box body + wing planes.
 * Crisp accent-color silhouette, intentional blocky look.
 */
export function createShip(_app: pc.Application): ShipRig {
  const root = new pc.Entity("ship-root");
  const body = new pc.Entity("ship-body");
  root.addChild(body);

  const hullMat = new pc.StandardMaterial();
  hullMat.diffuse = new pc.Color(0.9, 0.92, 1.0);
  hullMat.emissive = new pc.Color(0.65, 0.72, 0.9);
  hullMat.emissiveIntensity = 1.4;
  hullMat.metalness = 0.4;
  hullMat.gloss = 0.75;
  hullMat.useMetalness = true;
  hullMat.update();

  const accentMat = new pc.StandardMaterial();
  accentMat.diffuse = new pc.Color(0.1, 0.65, 0.95);
  accentMat.emissive = new pc.Color(0.2, 0.75, 1.1);
  accentMat.emissiveIntensity = 1.4;
  accentMat.metalness = 0.3;
  accentMat.useMetalness = true;
  accentMat.update();

  const darkMat = new pc.StandardMaterial();
  darkMat.diffuse = new pc.Color(0.6, 0.65, 0.78);
  darkMat.emissive = new pc.Color(0.35, 0.4, 0.52);
  darkMat.emissiveIntensity = 1.2;
  darkMat.metalness = 0.35;
  darkMat.useMetalness = true;
  darkMat.gloss = 0.7;
  darkMat.update();

  // Ship built so nose points to -Z (Entity.forward direction).
  // Hull — chunkier box for better readability at a distance
  const hull = new pc.Entity("hull");
  hull.addComponent("render", { type: "box", material: hullMat });
  hull.setLocalScale(1.25, 0.7, 2.6);
  body.addChild(hull);

  // Nose — cone at -Z (pointing forward/-Z), rotated so point aims -Z
  const nose = new pc.Entity("nose");
  nose.addComponent("render", { type: "cone", material: hullMat });
  nose.setLocalScale(0.75, 1.4, 0.75);
  nose.setLocalPosition(0, 0, -1.7);
  nose.setLocalEulerAngles(-90, 0, 0); // cone default points +Y; -90 rotates to -Z
  body.addChild(nose);

  // Canopy (accent) — small & sharp, sits atop hull, not engulfing it
  const canopy = new pc.Entity("canopy");
  canopy.addComponent("render", { type: "sphere", material: accentMat });
  canopy.setLocalScale(0.38, 0.22, 0.55);
  canopy.setLocalPosition(0, 0.38, -0.3);
  body.addChild(canopy);

  // Wings — two flat boxes, sit slightly behind canopy
  const wingL = new pc.Entity("wing-l");
  wingL.addComponent("render", { type: "box", material: darkMat });
  wingL.setLocalScale(1.8, 0.14, 0.85);
  wingL.setLocalPosition(-1.1, -0.08, 0.35);
  wingL.setLocalEulerAngles(0, 0, -14);
  body.addChild(wingL);

  const wingR = new pc.Entity("wing-r");
  wingR.addComponent("render", { type: "box", material: darkMat });
  wingR.setLocalScale(1.8, 0.14, 0.85);
  wingR.setLocalPosition(1.1, -0.08, 0.35);
  wingR.setLocalEulerAngles(0, 0, 14);
  body.addChild(wingR);

  // Wingtip accent lights
  const tipL = new pc.Entity("tip-l");
  tipL.addComponent("render", { type: "sphere", material: accentMat });
  tipL.setLocalScale(0.22, 0.22, 0.22);
  tipL.setLocalPosition(-2.0, -0.22, 0.55);
  body.addChild(tipL);

  const tipR = new pc.Entity("tip-r");
  tipR.addComponent("render", { type: "sphere", material: accentMat });
  tipR.setLocalScale(0.22, 0.22, 0.22);
  tipR.setLocalPosition(2.0, -0.22, 0.55);
  body.addChild(tipR);

  // Engine exhaust — smaller bright cylinder at rear (+Z)
  const thrustMat = new pc.StandardMaterial();
  thrustMat.diffuse = new pc.Color(0, 0, 0);
  thrustMat.emissive = new pc.Color(0.35, 0.9, 1.5);
  thrustMat.emissiveIntensity = 2.2;
  thrustMat.opacity = 0.85;
  thrustMat.blendType = pc.BLEND_ADDITIVE;
  thrustMat.depthWrite = false;
  thrustMat.update();

  const thrust = new pc.Entity("thrust");
  thrust.addComponent("render", { type: "cylinder", material: thrustMat });
  thrust.setLocalScale(0.25, 0.7, 0.25);
  thrust.setLocalPosition(0, 0, 1.5);
  thrust.setLocalEulerAngles(90, 0, 0);
  body.addChild(thrust);

  // Engine point light — small range so it doesn't wash out the hull
  const engineLight = new pc.Entity("engine-light");
  engineLight.addComponent("light", {
    type: "point",
    color: new pc.Color(0.3, 0.8, 1.2),
    intensity: 1.6,
    range: 3,
  });
  engineLight.setLocalPosition(0, 0, 2.4);
  body.addChild(engineLight);

  return {
    root,
    body,
    thrust,
    velocity: new pc.Vec3(),
    pitchRate: 0,
    yawRate: 0,
    rollTarget: 0,
  };
}
