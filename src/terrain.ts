import * as pc from "playcanvas";
import { MeshBuilder, fbm2, mulberry32, noise2, vertexColorMaterial } from "./geom";

/**
 * The land around the city.
 *
 *   north (+z)  mountains, snow on the peaks
 *   west  (-x)  a second range, foothills and forest
 *   south (-z)  the harbour and the open ocean (the Statue of Liberty stands in it)
 *   the rest    rolling green fields in a patchwork, farms and woods
 *
 * Two rivers (the Hudson at x≈260, the East River at x≈-260) run from the
 * mountains past the city into the harbour. The city block itself is flat.
 */

export const WORLD_HALF = 3200;
const GRID = 256;
export const CITY_HALF_X = 200;
export const CITY_HALF_Z = 330;
export const HUDSON_X = 262;
export const EAST_X = -262;
const RIVER_HALF = 48;

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Terrain height at world (x, z). Water is at y = 0. */
export function heightAt(x: number, z: number): number {
  // Rolling fields.
  let h = 4 + fbm2(x / 520 + 11, z / 520 + 3, 4) * 22;

  // Rivers (carved before the mountains are added, so they rise in the foothills).
  for (const rx of [HUDSON_X, EAST_X]) {
    const d = Math.abs(x - rx) + (fbm2(z / 300, rx, 2) - 0.5) * 30;
    // Rivers rise in the foothills: no carving into the mountains themselves.
    const carve = (1 - smooth(RIVER_HALF - 6, RIVER_HALF + 40, d)) * (1 - smooth(700, 1000, z));
    h = h * (1 - carve) - carve * 8;
  }

  // Mountains to the north and west: ridged noise, rising with distance into the zone.
  const north = smooth(900, 1900, z);
  const west = smooth(-1300, -2300, x);
  const m = Math.max(north, west);
  if (m > 0) {
    const r = 1 - Math.abs(fbm2(x / 380, z / 380, 5) * 2 - 1); // ridged
    h += m * (r * r * 520 + fbm2(x / 150, z / 150, 3) * 60);
  }

  // The ocean to the south.
  const sea = smooth(-650, -1000, z);
  h = h * (1 - sea) - sea * 45;

  // The city block (and the land next to it) is flat.
  const cityW = 1 - Math.max(smooth(CITY_HALF_X, CITY_HALF_X + 25, Math.abs(x)), smooth(CITY_HALF_Z, CITY_HALF_Z + 60, Math.abs(z)));
  const boroughs = (Math.abs(x) > HUDSON_X + RIVER_HALF + 10 && Math.abs(x) < 760 && Math.abs(z) < 420) ? 1 - smooth(640, 760, Math.abs(x)) : 0;
  const flat = Math.max(cityW, boroughs);
  if (flat > 0) h = h * (1 - flat) + 1.2 * flat;
  return h;
}

function colourAt(x: number, z: number, h: number, slope: number): [number, number, number] {
  if (h < 0.5) return [0.55, 0.5, 0.38];                                  // river / sea bed
  if (h < 3.5 && z < -560) return [0.86, 0.79, 0.6];                      // beach
  if (h > 330 + noise2(x / 60, z / 60) * 60) return [0.94, 0.95, 0.98];  // snow
  if (h > 170 || slope > 0.9) return [0.46, 0.44, 0.42];                 // rock
  // Patchwork fields: each ~110 m cell gets its own crop colour.
  const cx = Math.floor(x / 110), cz = Math.floor(z / 90);
  const r = noise2(cx * 7.13, cz * 3.71) * 0.999;
  const fields: [number, number, number][] = [
    [0.36, 0.55, 0.22], [0.45, 0.62, 0.25], [0.3, 0.48, 0.2], [0.62, 0.62, 0.3], [0.52, 0.6, 0.27], [0.4, 0.5, 0.24],
  ];
  let c = fields[Math.floor(r * fields.length)];
  const forest = fbm2(x / 260 + 40, z / 260, 3);
  if (forest > 0.56 || h > 80) c = [0.2, 0.36, 0.16];
  const v = 0.9 + noise2(x / 18, z / 18) * 0.2;
  return [c[0] * v, c[1] * v, c[2] * v];
}

export class Terrain {
  readonly entity: pc.Entity;

  constructor(app: pc.Application) {
    const device = app.graphicsDevice;
    const mb = new MeshBuilder();
    const step = (WORLD_HALF * 2) / GRID;
    const hs: number[] = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) hs.push(heightAt(-WORLD_HALF + i * step, -WORLD_HALF + j * step));
    const H = (i: number, j: number) => hs[Math.max(0, Math.min(GRID, j)) * (GRID + 1) + Math.max(0, Math.min(GRID, i))];
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const x = -WORLD_HALF + i * step, z = -WORLD_HALF + j * step, h = H(i, j);
        const nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), ny = 2 * step;
        const len = Math.hypot(nx, ny, nz);
        mb.pos.push(x, h, z);
        mb.nrm.push(nx / len, ny / len, nz / len);
        mb.uv.push(0, 0);
        const c = colourAt(x, z, h, 1 - ny / len);
        mb.col.push(c[0], c[1], c[2], 1);
      }
    }
    const W = GRID + 1;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        mb.idx.push(a, c, b, b, c, d);
      }
    }
    const mat = vertexColorMaterial({ gloss: 0.15 });
    this.entity = new pc.Entity("terrain");
    this.entity.addComponent("render", { meshInstances: [new pc.MeshInstance(mb.build(device), mat)] });
    app.root.addChild(this.entity);

    // Water: one big sheet at y = 0 — the sea, the harbour and the rivers.
    const water = new pc.StandardMaterial();
    water.diffuse = new pc.Color(0.1, 0.24, 0.34);
    water.useMetalness = true;
    water.metalness = 0.3;
    water.gloss = 0.9;
    water.emissive = new pc.Color(0.02, 0.05, 0.08);
    water.update();
    const sea = new pc.Entity("water");
    sea.addComponent("render", { type: "plane", material: water });
    sea.setLocalScale(WORLD_HALF * 4, 1, WORLD_HALF * 4);
    sea.setLocalPosition(0, 0, 0);
    app.root.addChild(sea);

    this.buildTrees(app);
  }

  /** Woods on the hills and hedgerow trees in the fields — all one mesh. */
  private buildTrees(app: pc.Application): void {
    const rnd = mulberry32(99);
    const mb = new MeshBuilder();
    let placed = 0;
    for (let tries = 0; tries < 60000 && placed < 5200; tries++) {
      const x = (rnd() * 2 - 1) * (WORLD_HALF - 200), z = (rnd() * 2 - 1) * (WORLD_HALF - 200);
      if (Math.abs(x) < 780 && Math.abs(z) < 460) continue; // city and boroughs
      const h = heightAt(x, z);
      if (h < 3 || h > 190) continue;
      const forest = fbm2(x / 260 + 40, z / 260, 3);
      if (forest < 0.5 && h < 80 && rnd() > 0.08) continue;
      const s = 0.8 + rnd() * 0.8;
      const g = 0.75 + rnd() * 0.35;
      mb.cylinder(x, h - 1, z, 0.9 * s, 4 * s, [0.3, 0.22, 0.15, 1], 4);
      mb.cone(x, h + 2.5 * s, z, 5 * s, 14 * s, [0.13 * g, 0.33 * g, 0.12 * g, 1]);
      placed++;
    }
    const mat = vertexColorMaterial({ gloss: 0.1 });
    mat.cull = pc.CULLFACE_NONE;
    mat.update();
    const e = new pc.Entity("trees");
    e.addComponent("render", { meshInstances: [new pc.MeshInstance(mb.build(app.graphicsDevice), mat)] });
    app.root.addChild(e);
  }
}
