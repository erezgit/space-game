import * as pc from "playcanvas";
import type { ShipRig } from "./ship";
import { MeshBuilder, vertexColorMaterial } from "./geom";

/**
 * The player's F-35: chined blended body, trapezoid wings, all-moving tailplanes,
 * twin tails canted outward, side intakes, a gold-tinted bubble canopy and a
 * single round nozzle with an afterburner cone. Nose points -Z; ~7.4 long, ~8.2 wide.
 */

const GREY: number[] = [0.5, 0.53, 0.56, 1];
const GREY_D: number[] = [0.38, 0.4, 0.43, 1];
const GREY_L: number[] = [0.58, 0.61, 0.64, 1];

const mirror = (pts: [number, number][]): [number, number][] => pts.map(([x, z]) => [-x, z] as [number, number]).reverse();

export function createJet(app: pc.Application): ShipRig {
  const device = app.graphicsDevice;
  const root = new pc.Entity("jet-root");
  const body = new pc.Entity("jet-body");
  root.addChild(body);

  const mb = new MeshBuilder();
  // Blended body with chines, in stacked plates for volume.
  const outline: [number, number][] = [
    [0, -3.9], [0.45, -2.9], [0.9, -1.6], [1.3, -0.4], [1.35, 2.6], [0.6, 3.25],
    [-0.6, 3.25], [-1.35, 2.6], [-1.3, -0.4], [-0.9, -1.6], [-0.45, -2.9],
  ];
  mb.plate(outline, 0, 0.5, GREY);
  mb.plate(outline.map(([x, z]) => [x * 0.72, z * 0.93 + 0.2] as [number, number]), 0.35, 0.35, GREY_L);
  mb.plate(outline.map(([x, z]) => [x * 0.45, z * 0.85 + 0.3] as [number, number]), 0.6, 0.25, GREY);
  // Wings and tailplanes.
  const wing: [number, number][] = [[1.2, -0.3], [4.1, 1.45], [4.1, 2.25], [1.2, 2.45]];
  mb.plate(wing, -0.05, 0.14, GREY);
  mb.plate(mirror(wing), -0.05, 0.14, GREY);
  const tailplane: [number, number][] = [[1.1, 2.55], [2.7, 3.35], [2.7, 3.9], [1.1, 3.75]];
  mb.plate(tailplane, 0.02, 0.1, GREY_D);
  mb.plate(mirror(tailplane), 0.02, 0.1, GREY_D);
  // Intakes and the nozzle shroud.
  mb.box(1.0, -0.02, -0.8, 0.5, 0.62, 1.7, GREY_D);
  mb.box(-1.0, -0.02, -0.8, 0.5, 0.62, 1.7, GREY_D);
  mb.box(0, 0.05, 2.9, 1.2, 0.8, 0.9, GREY_D);
  // Two missiles on the wing pylons.
  for (const s of [1, -1]) mb.box(2.6 * s, -0.35, 1.0, 0.22, 0.22, 2.4, [0.9, 0.9, 0.88, 1]);
  const mat = vertexColorMaterial({ gloss: 0.55, metalness: 0.35 });
  mat.cull = pc.CULLFACE_NONE;
  mat.update();
  const hull = new pc.Entity("f35-hull");
  hull.addComponent("render", { meshInstances: [new pc.MeshInstance(mb.build(device), mat)] });
  body.addChild(hull);

  // Twin tails, canted 25° outward.
  const tailMesh = new MeshBuilder();
  tailMesh.plate([[0, 2.0], [1.7, 2.85], [1.7, 3.35], [0, 3.55]], 0, 0.1, GREY);
  const tm = tailMesh.build(device);
  for (const side of [1, -1]) {
    const t = new pc.Entity("tail");
    t.addComponent("render", { meshInstances: [new pc.MeshInstance(tm, mat)] });
    t.setLocalPosition(0.72 * side, 0.3, 0);
    t.setLocalEulerAngles(0, 0, side > 0 ? 65 : 115);
    body.addChild(t);
  }

  // Canopy.
  const glass = new pc.StandardMaterial();
  glass.diffuse = new pc.Color(0.08, 0.07, 0.04);
  glass.emissive = new pc.Color(0.35, 0.28, 0.1);
  glass.useMetalness = true;
  glass.metalness = 0.9;
  glass.gloss = 0.95;
  glass.update();
  const canopy = new pc.Entity("canopy");
  canopy.addComponent("render", { type: "sphere", material: glass });
  canopy.setLocalScale(0.7, 0.55, 2.0);
  canopy.setLocalPosition(0, 0.72, -1.5);
  body.addChild(canopy);

  // Nozzle and afterburner.
  const metal = new pc.StandardMaterial();
  metal.diffuse = new pc.Color(0.22, 0.2, 0.19);
  metal.useMetalness = true;
  metal.metalness = 0.8;
  metal.gloss = 0.6;
  metal.update();
  const nozzle = new pc.Entity("nozzle");
  nozzle.addComponent("render", { type: "cylinder", material: metal });
  nozzle.setLocalScale(0.9, 0.7, 0.9);
  nozzle.setLocalPosition(0, 0.05, 3.55);
  nozzle.setLocalEulerAngles(90, 0, 0);
  body.addChild(nozzle);

  const flameMat = new pc.StandardMaterial();
  flameMat.diffuse = new pc.Color(0, 0, 0);
  flameMat.emissive = new pc.Color(1.3, 0.55, 0.2);
  flameMat.emissiveIntensity = 1.2;
  flameMat.blendType = pc.BLEND_ADDITIVE;
  flameMat.depthWrite = false;
  flameMat.useFog = false;
  flameMat.update();
  // Cone apex is +Y; rotate so it points backward (+Z).
  const thrust = new pc.Entity("afterburner");
  thrust.addComponent("render", { type: "cone", material: flameMat, castShadows: false });
  thrust.setLocalScale(0.6, 1.8, 0.6);
  thrust.setLocalPosition(0, 0.05, 4.7);
  thrust.setLocalEulerAngles(90, 0, 0);
  body.addChild(thrust);

  // Nav lights.
  const light = (c: [number, number, number], x: number, z: number) => {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(0, 0, 0);
    m.emissive = new pc.Color(...c);
    m.emissiveIntensity = 3;
    m.update();
    const e = new pc.Entity("nav");
    e.addComponent("render", { type: "sphere", material: m });
    e.setLocalScale(0.18, 0.18, 0.18);
    e.setLocalPosition(x, -0.02, z);
    body.addChild(e);
  };
  light([1.5, 0.1, 0.1], -4.1, 1.9);
  light([0.1, 1.4, 0.3], 4.1, 1.9);

  const selfLight = new pc.Entity("self-light");
  selfLight.addComponent("light", { type: "point", color: new pc.Color(1, 0.95, 0.9), intensity: 0.8, range: 10 });
  selfLight.setLocalPosition(0, 3, -1);
  body.addChild(selfLight);

  return { root, body, thrust, velocity: new pc.Vec3(), pitchDeg: 0, yawDeg: 0 };
}
