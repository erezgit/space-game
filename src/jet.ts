import * as pc from "playcanvas";
import type { ShipRig } from "./ship";

function mat(diffuse: [number, number, number], opts: Partial<{ emissive: [number, number, number]; ei: number; metal: number; gloss: number; additive: boolean }> = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(...diffuse);
  if (opts.emissive) { m.emissive = new pc.Color(...opts.emissive); m.emissiveIntensity = opts.ei ?? 1; }
  m.useMetalness = true;
  m.metalness = opts.metal ?? 0.5;
  m.gloss = opts.gloss ?? 0.6;
  if (opts.additive) { m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; }
  m.update();
  return m;
}

function part(parent: pc.Entity, type: string, m: pc.Material, scale: number[], pos: number[], rot: number[] = [0, 0, 0]) {
  const e = new pc.Entity(type);
  e.addComponent("render", { type, material: m });
  e.setLocalScale(scale[0], scale[1], scale[2]);
  e.setLocalPosition(pos[0], pos[1], pos[2]);
  e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
  parent.addChild(e);
  return e;
}

/**
 * The player's fighter jet — grey, delta-winged, one afterburner. Nose points -Z.
 * About 6 units long and 5.5 wide, so it reads clearly from the chase camera.
 */
export function createJet(_app: pc.Application): ShipRig {
  const root = new pc.Entity("jet-root");
  const body = new pc.Entity("jet-body");
  root.addChild(body);

  const hull = mat([0.62, 0.66, 0.7], { emissive: [0.16, 0.16, 0.18], ei: 1, metal: 0.45, gloss: 0.65 });
  const dark = mat([0.2, 0.22, 0.25], { metal: 0.5, gloss: 0.5 });
  const canopyM = mat([0.05, 0.05, 0.05], { emissive: [0.9, 0.55, 0.25], ei: 0.5, metal: 0.9, gloss: 0.95 });
  const burner = mat([0, 0, 0], { emissive: [1.2, 0.4, 0.1], ei: 0.7, additive: true });
  const nav = mat([0, 0, 0], { emissive: [1.5, 0.1, 0.1], ei: 3 });
  const navG = mat([0, 0, 0], { emissive: [0.1, 1.4, 0.3], ei: 3 });

  part(body, "box", hull, [0.9, 0.8, 4.6], [0, 0, 0]);                       // fuselage
  part(body, "cone", hull, [0.8, 1.6, 0.75], [0, 0, -3.1], [-90, 0, 0]);     // nose
  part(body, "sphere", canopyM, [0.6, 0.5, 1.5], [0, 0.5, -1.2]);            // canopy
  part(body, "box", hull, [1.0, 0.5, 2.0], [0, -0.35, -0.3]);                // intake
  part(body, "box", dark, [2.6, 0.12, 2.2], [-1.45, 0, 0.6], [0, 24, 0]);    // wing L (swept)
  part(body, "box", dark, [2.6, 0.12, 2.2], [1.45, 0, 0.6], [0, -24, 0]);    // wing R
  part(body, "box", dark, [1.1, 0.1, 0.9], [-0.9, 0.05, 2.1], [0, 20, 0]);   // stabiliser L
  part(body, "box", dark, [1.1, 0.1, 0.9], [0.9, 0.05, 2.1], [0, -20, 0]);   // stabiliser R
  part(body, "box", dark, [0.12, 1.4, 1.3], [0, 0.95, 1.9], [-12, 0, 0]);    // tail fin
  part(body, "sphere", nav, [0.2, 0.2, 0.2], [-2.7, 0, 1.3]);                // nav lights
  part(body, "sphere", navG, [0.2, 0.2, 0.2], [2.7, 0, 1.3]);

  const thrust = part(body, "cylinder", burner, [0.3, 0.9, 0.3], [0, 0, 2.8], [90, 0, 0]);

  const engineLight = new pc.Entity("afterburner-light");
  engineLight.addComponent("light", { type: "point", color: new pc.Color(1.2, 0.6, 0.25), intensity: 2, range: 8 });
  engineLight.setLocalPosition(0, 0, 3.8);
  body.addChild(engineLight);

  const selfLight = new pc.Entity("self-light");
  selfLight.addComponent("light", { type: "point", color: new pc.Color(1, 0.85, 0.7), intensity: 1.4, range: 12 });
  selfLight.setLocalPosition(0, 3, -1.5);
  body.addChild(selfLight);

  return { root, body, thrust, velocity: new pc.Vec3(), pitchDeg: 0, yawDeg: 0 };
}
