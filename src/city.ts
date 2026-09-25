import * as pc from "playcanvas";

/**
 * Procedural Manhattan at war.
 *
 * One TILE is an island of street-grid blocks with a river on each side,
 * a downtown and a midtown cluster of towers, and two landmarks (an Empire
 * State and a One World Trade silhouette). All buildings of a tile are merged
 * into ONE mesh, so the whole city is a handful of draw calls.
 *
 * The world is endless: nine copies of the tile sit in a 3×3 grid that
 * re-centres on the player, and the fog hides the seams.
 *
 * War dressing per tile: burning rooftops (the game emits their smoke) and sweeping searchlights.
 */

export const TILE = 640;
const ISLAND_HALF = 200; // land from x=-200..200, water beyond
const BLOCK_PITCH_X = 40;
const BLOCK_PITCH_Z = 24;
const STREET = 9;

export interface Box {
  minX: number; maxX: number; minZ: number; maxZ: number; height: number;
}

/** Deterministic PRNG so every tile copy is identical and collisions match the mesh. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function windowTexture(device: pc.GraphicsDevice): { diffuse: pc.Texture; emissive: pc.Texture } {
  // 16×16 window cells of 8 px. The first pixel row/column of every cell is wall,
  // so a UV at (0.01, 0.01) samples plain wall — used for roofs.
  const N = 128, CELL = 8;
  const dc = document.createElement("canvas"); dc.width = dc.height = N;
  const ec = document.createElement("canvas"); ec.width = ec.height = N;
  const d = dc.getContext("2d")!, e = ec.getContext("2d")!;
  d.fillStyle = "#3a3634"; d.fillRect(0, 0, N, N);
  e.fillStyle = "#000"; e.fillRect(0, 0, N, N);
  const rnd = mulberry32(7);
  for (let y = 0; y < N; y += CELL) {
    for (let x = 0; x < N; x += CELL) {
      d.fillStyle = "#1c2026"; d.fillRect(x + 2, y + 2, 5, 5);
      const r = rnd();
      if (r < 0.16) { // lit window
        e.fillStyle = r < 0.05 ? "#ffb36b" : "#d9a35c";
        e.fillRect(x + 2, y + 2, 5, 5);
      } else if (r < 0.2) { // burning window
        e.fillStyle = "#ff5a14"; e.fillRect(x + 2, y + 2, 5, 5);
      }
    }
  }
  const mk = (c: HTMLCanvasElement) => {
    const t = new pc.Texture(device, {
      width: N, height: N, format: pc.PIXELFORMAT_RGBA8,
      addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, mipmaps: true,
    });
    t.setSource(c);
    return t;
  };
  return { diffuse: mk(dc), emissive: mk(ec) };
}

/** Append an axis-aligned box (no bottom face) to the mesh arrays. */
function pushBox(
  pos: number[], nrm: number[], uv: number[], idx: number[],
  cx: number, cz: number, w: number, dpt: number, y0: number, y1: number,
): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - dpt / 2, z1 = cz + dpt / 2;
  const WIN_W = 3.2, WIN_H = 3.6; // metres per window cell
  const faces: Array<{ v: number[][]; n: number[]; uw: number; uh: number }> = [
    { v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], n: [0, 0, 1], uw: w, uh: y1 - y0 },
    { v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], n: [0, 0, -1], uw: w, uh: y1 - y0 },
    { v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], n: [1, 0, 0], uw: dpt, uh: y1 - y0 },
    { v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], n: [-1, 0, 0], uw: dpt, uh: y1 - y0 },
    { v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], n: [0, 1, 0], uw: 0, uh: 0 },
  ];
  for (const f of faces) {
    const base = pos.length / 3;
    const cells = 16; // cells per texture repeat
    const u1 = f.uw / WIN_W / cells, v1 = f.uh / WIN_H / cells;
    const uvs = f.uw === 0 ? [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]]
      : [[0, 0], [u1, 0], [u1, v1], [0, v1]];
    for (let i = 0; i < 4; i++) {
      pos.push(...f.v[i]); nrm.push(...f.n); uv.push(...uvs[i]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

interface TileData {
  mesh: pc.Mesh;
  boxes: Box[];
  fires: pc.Vec3[];
  lights: pc.Vec3[];
}

function buildTile(device: pc.GraphicsDevice): TileData {
  const rnd = mulberry32(1941);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const boxes: Box[] = [];
  const fires: pc.Vec3[] = [];
  const lights: pc.Vec3[] = [];

  const add = (cx: number, cz: number, w: number, d: number, y0: number, y1: number) => {
    pushBox(pos, nrm, uv, idx, cx, cz, w, d, y0, y1);
    boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, height: y1 });
  };

  // Height field: a downtown cluster (south, -z) and a midtown cluster (+z).
  const heightAt = (x: number, z: number) => {
    const downtown = Math.exp(-((x + 40) ** 2 + (z + 210) ** 2) / (2 * 90 ** 2));
    const midtown = Math.exp(-((x - 10) ** 2 + (z - 90) ** 2) / (2 * 110 ** 2));
    const k = Math.max(downtown, midtown);
    return 14 + k * 120 + rnd() * (20 + k * 70);
  };

  const LANDMARK_KEEP_OUT = [
    { x: 20, z: 90, r: 34 },    // Empire State
    { x: -60, z: -225, r: 34 }, // One World Trade
  ];

  for (let bx = -ISLAND_HALF + BLOCK_PITCH_X / 2; bx < ISLAND_HALF; bx += BLOCK_PITCH_X) {
    for (let bz = -TILE / 2 + BLOCK_PITCH_Z / 2; bz < TILE / 2; bz += BLOCK_PITCH_Z) {
      if (LANDMARK_KEEP_OUT.some((l) => Math.hypot(bx - l.x, bz - l.z) < l.r)) continue;
      if (rnd() < 0.06) continue; // a park, a crater, a gap
      const blockW = BLOCK_PITCH_X - STREET, blockD = BLOCK_PITCH_Z - STREET;
      const n = rnd() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const w = blockW / n - 1;
        const cx = bx - blockW / 2 + (i + 0.5) * (blockW / n);
        const h = heightAt(cx, bz);
        add(cx, bz, w, blockD, 0, h);
        // Setbacks on taller towers.
        if (h > 70 && rnd() < 0.6) add(cx, bz, w * 0.65, blockD * 0.65, h, h + 10 + rnd() * 30);
        if (rnd() < 0.07) fires.push(new pc.Vec3(cx, h, bz));
      }
    }
  }

  // Empire State: stepped tower + spire.
  add(20, 90, 30, 30, 0, 70);
  add(20, 90, 22, 22, 70, 150);
  add(20, 90, 14, 14, 150, 185);
  add(20, 90, 7, 7, 185, 200);
  add(20, 90, 1.6, 1.6, 200, 235);
  // One World Trade: tapering tower + spire.
  add(-60, -225, 34, 34, 0, 60);
  add(-60, -225, 28, 28, 60, 150);
  add(-60, -225, 22, 22, 150, 230);
  add(-60, -225, 14, 14, 230, 262);
  add(-60, -225, 1.4, 1.4, 262, 320);

  fires.push(new pc.Vec3(-60, 230, -225)); // the tower is hit
  for (let i = 0; i < 5; i++) lights.push(new pc.Vec3(-150 + rnd() * 300, 0, -TILE / 2 + rnd() * TILE));

  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos);
  mesh.setNormals(nrm);
  mesh.setUvs(0, uv);
  mesh.setIndices(idx);
  mesh.update();
  return { mesh, boxes, fires, lights };
}

export class City {
  private tile: TileData;
  private tiles: pc.Entity[] = [];
  private searchlights: pc.Entity[] = [];
  private fireEntities: pc.Entity[] = [];
  private center = { ix: 0, iz: 0 };
  private t = 0;

  constructor(app: pc.Application) {
    const device = app.graphicsDevice;
    this.tile = buildTile(device);
    const tex = windowTexture(device);

    const bMat = new pc.StandardMaterial();
    bMat.diffuseMap = tex.diffuse;
    bMat.diffuse = new pc.Color(0.8, 0.72, 0.66);
    bMat.emissiveMap = tex.emissive;
    bMat.emissive = new pc.Color(1, 1, 1);
    bMat.emissiveIntensity = 2.2;
    bMat.useMetalness = true;
    bMat.metalness = 0.1;
    bMat.gloss = 0.3;
    bMat.update();

    const groundMat = new pc.StandardMaterial();
    groundMat.diffuse = new pc.Color(0.16, 0.14, 0.13);
    groundMat.emissive = new pc.Color(0.05, 0.02, 0.01);
    groundMat.update();

    const waterMat = new pc.StandardMaterial();
    waterMat.diffuse = new pc.Color(0.05, 0.06, 0.08);
    waterMat.emissive = new pc.Color(0.12, 0.05, 0.02); // fire reflected on the river
    waterMat.useMetalness = true;
    waterMat.metalness = 0.6;
    waterMat.gloss = 0.85;
    waterMat.update();

    const fireMat = new pc.StandardMaterial();
    fireMat.diffuse = new pc.Color(0, 0, 0);
    fireMat.emissive = new pc.Color(1.6, 0.55, 0.12);
    fireMat.emissiveIntensity = 3;
    fireMat.blendType = pc.BLEND_ADDITIVE;
    fireMat.depthWrite = false;
    fireMat.useFog = false;
    fireMat.update();

    const beamMat = new pc.StandardMaterial();
    beamMat.diffuse = new pc.Color(0, 0, 0);
    beamMat.emissive = new pc.Color(0.55, 0.6, 0.7);
    beamMat.emissiveIntensity = 0.22;
    beamMat.useFog = false;
    beamMat.blendType = pc.BLEND_ADDITIVE;
    beamMat.depthWrite = false;
    beamMat.cull = pc.CULLFACE_NONE;
    beamMat.update();

    for (let i = 0; i < 9; i++) {
      const t = new pc.Entity(`city-tile-${i}`);
      const mi = new pc.MeshInstance(this.tile.mesh, bMat);
      t.addComponent("render", { meshInstances: [mi] });

      const land = new pc.Entity("land");
      land.addComponent("render", { type: "plane", material: groundMat });
      land.setLocalScale(ISLAND_HALF * 2 + 10, 1, TILE);
      t.addChild(land);
      const water = new pc.Entity("water");
      water.addComponent("render", { type: "plane", material: waterMat });
      water.setLocalScale(TILE, 1, TILE);
      water.setLocalPosition(0, -0.5, 0);
      t.addChild(water);

      for (const f of this.tile.fires) {
        const fire = new pc.Entity("fire");
        fire.addComponent("render", { type: "sphere", material: fireMat });
        fire.setLocalPosition(f.x, f.y + 2, f.z);
        fire.setLocalScale(9, 6, 9);
        t.addChild(fire);
        this.fireEntities.push(fire);

      }

      for (const l of this.tile.lights) {
        const pivot = new pc.Entity("searchlight");
        pivot.setLocalPosition(l.x, 0, l.z);
        const beam = new pc.Entity("beam");
        beam.addComponent("render", { type: "cone", material: beamMat, castShadows: false });
        // Cone apex (+Y) at the ground, flaring upward: flip it and lift it.
        beam.setLocalScale(7, 380, 7);
        beam.setLocalEulerAngles(180, 0, 0);
        beam.setLocalPosition(0, 190, 0);
        pivot.addChild(beam);
        pivot.setLocalEulerAngles(15 + Math.random() * 15, Math.random() * 360, 0);
        t.addChild(pivot);
        this.searchlights.push(pivot);
      }
      app.root.addChild(t);
      this.tiles.push(t);
    }
    this.place();
  }

  private place(): void {
    let i = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.tiles[i++].setPosition((this.center.ix + dx) * TILE, 0, (this.center.iz + dz) * TILE);
      }
    }
  }

  update(dt: number, playerPos: pc.Vec3): void {
    this.t += dt;
    const ix = Math.round(playerPos.x / TILE), iz = Math.round(playerPos.z / TILE);
    if (ix !== this.center.ix || iz !== this.center.iz) {
      this.center = { ix, iz };
      this.place();
    }
    for (let i = 0; i < this.searchlights.length; i++) {
      const s = this.searchlights[i];
      s.setLocalEulerAngles(20 + Math.sin(this.t * 0.4 + i) * 14, (this.t * 12 + i * 47) % 360, 0);
    }
    for (let i = 0; i < this.fireEntities.length; i++) {
      const f = this.fireEntities[i];
      const k = 1 + Math.sin(this.t * 9 + i * 1.7) * 0.15 + Math.sin(this.t * 23 + i) * 0.08;
      f.setLocalScale(9 * k, 6 * k * 1.1, 9 * k);
    }
  }

  /** World positions of burning rooftops within `radius` of `p` — the game emits their smoke. */
  firesNear(p: pc.Vec3, radius: number): pc.Vec3[] {
    const out: pc.Vec3[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ox = (this.center.ix + dx) * TILE, oz = (this.center.iz + dz) * TILE;
        for (const f of this.tile.fires) {
          const x = f.x + ox, z = f.z + oz;
          if (Math.abs(x - p.x) < radius && Math.abs(z - p.z) < radius) out.push(new pc.Vec3(x, f.y + 4, z));
        }
      }
    }
    return out;
  }

  /** Does a sphere at `p` touch a building (or the ground)? Returns the building top, or -1. */
  hit(p: pc.Vec3, radius: number): number {
    if (p.y - radius < 0.5) return 0;
    const lx = p.x - Math.round(p.x / TILE) * TILE;
    const lz = p.z - Math.round(p.z / TILE) * TILE;
    if (Math.abs(lx) > ISLAND_HALF + radius) return -1;
    for (const b of this.tile.boxes) {
      if (p.y - radius > b.height) continue;
      if (lx + radius < b.minX || lx - radius > b.maxX) continue;
      if (lz + radius < b.minZ || lz - radius > b.maxZ) continue;
      return b.height;
    }
    return -1;
  }
}
