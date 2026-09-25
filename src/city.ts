import * as pc from "playcanvas";
import { MeshBuilder, mulberry32, vertexColorMaterial } from "./geom";
import { CITY_HALF_X, CITY_HALF_Z, EAST_X, HUDSON_X } from "./terrain";

/**
 * New York at war, in daylight.
 *
 * Manhattan: a street grid of towers in six facade styles (glass, limestone,
 * brick, white modern, dark office, and burnt-out), a downtown and a midtown
 * cluster, the Empire State and One World Trade, Central Park, rooftop water
 * towers and plant. Most buildings stand; a few are burning or gutted.
 * Across the rivers: low-rise boroughs, and two suspension bridges.
 * In the harbour: the Statue of Liberty.
 *
 * Every style is ONE merged mesh, so the whole city is a handful of draw calls.
 */

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }

type Style = "glass" | "limestone" | "brick" | "white" | "dark" | "burnt";
const STYLES: Style[] = ["glass", "limestone", "brick", "white", "dark", "burnt"];

interface StyleSpec { wall: string; win: string; frame?: string; glint?: boolean; lit: number; burn: number; cellW: number; cellH: number; bands?: boolean }
const SPEC: Record<Style, StyleSpec> = {
  glass:     { wall: "#6f93ad", win: "#9cc3de", frame: "#50708a", glint: true, lit: 0.02, burn: 0, cellW: 3, cellH: 3.6 },
  limestone: { wall: "#d8c7a4", win: "#4a525e", frame: "#c9b893", lit: 0.03, burn: 0, cellW: 3.4, cellH: 3.8 },
  brick:     { wall: "#9a5541", win: "#2f3036", frame: "#b7866f", lit: 0.03, burn: 0, cellW: 3, cellH: 3.4 },
  white:     { wall: "#ecebe6", win: "#4a5a68", lit: 0.02, burn: 0, cellW: 3.2, cellH: 3.6, bands: true },
  dark:      { wall: "#4a4c52", win: "#7a8a99", frame: "#3a3c42", lit: 0.04, burn: 0, cellW: 3, cellH: 3.6 },
  burnt:     { wall: "#2c2724", win: "#110e0c", lit: 0, burn: 0.16, cellW: 3.2, cellH: 3.6 },
};

function facadeTextures(device: pc.GraphicsDevice, s: StyleSpec, seed: number): { diffuse: pc.Texture; emissive: pc.Texture } {
  // 16×16 cells of 8 px; the first row/column of each cell is wall, so UV (0.01,0.01) = wall (roofs).
  const N = 128, C = 8;
  const dc = document.createElement("canvas"); dc.width = dc.height = N;
  const ec = document.createElement("canvas"); ec.width = ec.height = N;
  const d = dc.getContext("2d")!, e = ec.getContext("2d")!;
  d.fillStyle = s.wall; d.fillRect(0, 0, N, N);
  e.fillStyle = "#000"; e.fillRect(0, 0, N, N);
  const rnd = mulberry32(seed);
  for (let y = 0; y < N; y += C) {
    for (let x = 0; x < N; x += C) {
      if (s.bands) {
        d.fillStyle = s.win; d.fillRect(x + 1, y + 3, C - 1, 4);
      } else {
        if (s.frame) { d.fillStyle = s.frame; d.fillRect(x + 1, y + 1, 7, 7); }
        d.fillStyle = s.win; d.fillRect(x + 2, y + 2, 5, 5);
        if (s.glint && rnd() < 0.5) { d.fillStyle = "#c9e2f2"; d.fillRect(x + 2, y + 2, 2, 5); }
      }
      const r = rnd();
      if (r < s.burn) { e.fillStyle = r < s.burn * 0.5 ? "#ff6a1a" : "#c23a0c"; e.fillRect(x + 2, y + 2, 5, 5); }
      else if (r < s.burn + s.lit) { e.fillStyle = "#6b5a3a"; e.fillRect(x + 2, y + 2, 5, 5); }
    }
  }
  if (s.burn) { // soot streaks
    d.fillStyle = "rgba(0,0,0,0.45)";
    for (let i = 0; i < 12; i++) d.fillRect(Math.floor(rnd() * N), 0, 3 + Math.floor(rnd() * 6), N);
  }
  const mk = (c: HTMLCanvasElement) => {
    const t = new pc.Texture(device, {
      width: N, height: N, format: pc.PIXELFORMAT_RGBA8,
      addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, mipmaps: true,
    });
    t.anisotropy = 8;
    t.setSource(c);
    return t;
  };
  return { diffuse: mk(dc), emissive: mk(ec) };
}

function streetTexture(device: pc.GraphicsDevice): pc.Texture {
  // One block pitch: asphalt with lane marks, sidewalks, and the block itself.
  const N = 64;
  const c = document.createElement("canvas"); c.width = c.height = N;
  const g = c.getContext("2d")!;
  g.fillStyle = "#55585c"; g.fillRect(0, 0, N, N);             // asphalt
  g.fillStyle = "#9a9a94"; g.fillRect(6, 6, N - 12, N - 12);   // sidewalk
  g.fillStyle = "#7c7a74"; g.fillRect(9, 9, N - 18, N - 18);   // block
  g.fillStyle = "#d8cf9a"; for (let i = 0; i < N; i += 8) { g.fillRect(i, 2, 4, 1); g.fillRect(2, i, 1, 4); }
  const t = new pc.Texture(device, { width: N, height: N, format: pc.PIXELFORMAT_RGBA8, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR });
  t.anisotropy = 8;
  t.setSource(c);
  return t;
}

const BLOCK_X = 40, BLOCK_Z = 24, STREET = 9;

export class City {
  readonly boxes: Box[] = [];
  private grid = new Map<string, Box[]>();
  readonly fires: pc.Vec3[] = [];
  private fireEntities: pc.Entity[] = [];
  private t = 0;

  constructor(app: pc.Application) {
    const device = app.graphicsDevice;
    const rnd = mulberry32(1941);
    const builders = new Map<Style, MeshBuilder>(STYLES.map((s) => [s, new MeshBuilder()]));
    const detail = new MeshBuilder(); // vertex-coloured: rooftop plant, water towers, landmarks, bridges, statue

    const addBox = (style: Style, cx: number, cz: number, w: number, d: number, y0: number, y1: number) => {
      const spec = SPEC[style];
      builders.get(style)!.box(cx, (y0 + y1) / 2, cz, w, y1 - y0, d, [1, 1, 1, 1], spec.cellW * 16, spec.cellH * 16);
      this.collide(cx, cz, w, d, y0, y1);
    };
    const addDetail = (cx: number, cy: number, cz: number, w: number, h: number, d: number, c: number[], solid = true) => {
      detail.box(cx, cy, cz, w, h, d, c);
      if (solid) this.collide(cx, cz, w, d, cy - h / 2, cy + h / 2);
    };

    // Height field for Manhattan: downtown (south, -z) and midtown clusters.
    const heightAt = (x: number, z: number) => {
      const downtown = Math.exp(-((x + 40) ** 2 + (z + 220) ** 2) / (2 * 85 ** 2));
      const midtown = Math.exp(-((x - 10) ** 2 + (z - 70) ** 2) / (2 * 100 ** 2));
      const k = Math.max(downtown, midtown);
      return 14 + k * 115 + rnd() * (18 + k * 70);
    };
    const pickStyle = (h: number): Style => {
      const r = rnd();
      if (r < 0.05) return "burnt";
      if (h > 90) return r < 0.5 ? "glass" : r < 0.72 ? "dark" : r < 0.88 ? "white" : "limestone";
      if (h > 45) return r < 0.3 ? "limestone" : r < 0.5 ? "glass" : r < 0.7 ? "white" : r < 0.85 ? "brick" : "dark";
      return r < 0.5 ? "brick" : r < 0.8 ? "limestone" : "white";
    };

    const EMPIRE = { x: 20, z: 70 }, WTC = { x: -60, z: -235 };
    const PARK = { x0: -70, x1: 70, z0: 170, z1: 320 };

    // ── Manhattan
    for (let bx = -CITY_HALF_X + BLOCK_X / 2; bx < CITY_HALF_X; bx += BLOCK_X) {
      for (let bz = -CITY_HALF_Z + BLOCK_Z / 2; bz < CITY_HALF_Z; bz += BLOCK_Z) {
        if (Math.hypot(bx - EMPIRE.x, bz - EMPIRE.z) < 30 || Math.hypot(bx - WTC.x, bz - WTC.z) < 32) continue;
        if (bx > PARK.x0 && bx < PARK.x1 && bz > PARK.z0 && bz < PARK.z1) continue;
        const blockW = BLOCK_X - STREET, blockD = BLOCK_Z - STREET;
        const n = rnd() < 0.45 ? 1 : rnd() < 0.7 ? 2 : 3;
        for (let i = 0; i < n; i++) {
          const w = blockW / n - 1;
          const cx = bx - blockW / 2 + (i + 0.5) * (blockW / n);
          let h = heightAt(cx, bz);
          const style = pickStyle(h);
          if (style === "burnt") h *= 0.55 + rnd() * 0.3; // gutted
          addBox(style, cx, bz, w, blockD, 0, h);
          // Setbacks and crowns on towers.
          if (h > 75 && style !== "burnt" && rnd() < 0.65) {
            const h2 = h + 12 + rnd() * 35;
            addBox(style, cx, bz, w * 0.68, blockD * 0.68, h, h2);
            if (rnd() < 0.35) addDetail(cx, h2 + 6, bz, 0.8, 12, 0.8, [0.75, 0.75, 0.78, 1]); // antenna
          }
          // Rooftop plant and New York water towers.
          if (style !== "burnt") {
            if (rnd() < 0.5) addDetail(cx + (rnd() - 0.5) * w * 0.4, h + 1.2, bz + (rnd() - 0.5) * 3, 3 + rnd() * 3, 2.4, 2.5 + rnd() * 2, [0.55, 0.56, 0.58, 1]);
            if (h < 60 && rnd() < 0.35) {
              const tx = cx + (rnd() - 0.5) * w * 0.3, tz = bz + (rnd() - 0.5) * 2;
              detail.cylinder(tx, h, tz, 0.25, 3, [0.25, 0.2, 0.15, 1], 4);
              detail.cylinder(tx, h + 3, tz, 2, 4, [0.5, 0.36, 0.24, 1], 10, 1.6, [0.3, 0.3, 0.32, 1]);
            }
          }
          if (style === "burnt" || (rnd() < 0.025 && h > 30)) this.fires.push(new pc.Vec3(cx, h, bz));
        }
      }
    }

    // ── Empire State: stepped limestone tower, mast.
    addBox("limestone", EMPIRE.x, EMPIRE.z, 32, 32, 0, 22);
    addBox("limestone", EMPIRE.x, EMPIRE.z, 26, 26, 22, 160);
    addBox("limestone", EMPIRE.x, EMPIRE.z, 19, 19, 160, 186);
    addBox("limestone", EMPIRE.x, EMPIRE.z, 12, 12, 186, 200);
    detail.cylinder(EMPIRE.x, 200, EMPIRE.z, 4, 12, [0.8, 0.8, 0.82, 1], 8, 4);
    addDetail(EMPIRE.x, 236, EMPIRE.z, 1.4, 44, 1.4, [0.85, 0.85, 0.88, 1]);
    // ── One World Trade: glass, tapering, spire — hit and burning near the top.
    addBox("glass", WTC.x, WTC.z, 36, 36, 0, 40);
    addBox("glass", WTC.x, WTC.z, 30, 30, 40, 150);
    addBox("glass", WTC.x, WTC.z, 23, 23, 150, 235);
    addBox("glass", WTC.x, WTC.z, 15, 15, 235, 268);
    addDetail(WTC.x, 300, WTC.z, 1.4, 64, 1.4, [0.85, 0.85, 0.88, 1]);
    this.fires.push(new pc.Vec3(WTC.x, 236, WTC.z));

    // ── Boroughs across both rivers: low-rise, sparser toward the edges.
    for (const side of [-1, 1]) {
      const x0 = side > 0 ? HUDSON_X + 70 : -720, x1 = side > 0 ? 720 : EAST_X - 70;
      for (let bx = x0; bx < x1; bx += 34) {
        for (let bz = -400; bz < 400; bz += 26) {
          if (rnd() < 0.3) continue;
          const edgeFade = 1 - Math.min(1, Math.max(0, (Math.abs(bx) - 560) / 160));
          if (rnd() > edgeFade) continue;
          const h = 8 + rnd() * 18 + (rnd() < 0.08 ? 30 + rnd() * 40 : 0);
          const style: Style = rnd() < 0.04 ? "burnt" : rnd() < 0.6 ? "brick" : rnd() < 0.8 ? "limestone" : "white";
          addBox(style, bx, bz, 20 + rnd() * 6, 14 + rnd() * 4, 0, h);
          if (style === "burnt") this.fires.push(new pc.Vec3(bx, h, bz));
        }
      }
    }

    // ── Suspension bridges over both rivers.
    for (const [rx, bz] of [[HUDSON_X, -120], [EAST_X, -250]] as [number, number][]) {
      const deckY = 22;
      addDetail(rx, deckY, bz, 190, 2, 12, [0.42, 0.4, 0.38, 1]);
      for (const tx of [rx - 50, rx + 50]) {
        addDetail(tx, 30, bz - 5, 3, 60, 3, [0.62, 0.52, 0.42, 1]);
        addDetail(tx, 30, bz + 5, 3, 60, 3, [0.62, 0.52, 0.42, 1]);
        addDetail(tx, 55, bz, 3, 3, 13, [0.62, 0.52, 0.42, 1]);
      }
      // Hangers under the main cable (thin, not solid).
      for (let i = 1; i < 12; i++) {
        const x = rx - 50 + (i * 100) / 12;
        const top = 58 - 30 * (1 - ((x - rx) / 50) ** 2);
        for (const zz of [bz - 5, bz + 5]) detail.box(x, (top + deckY) / 2, zz, 0.3, top - deckY, 0.3, [0.3, 0.3, 0.32, 1]);
      }
    }

    // ── Statue of Liberty on her island in the harbour.
    const L = { x: 150, z: -760 };
    detail.cylinder(L.x, -2, L.z, 30, 5, [0.55, 0.6, 0.45, 1], 12);          // island
    addDetail(L.x, 10, L.z, 20, 14, 20, [0.72, 0.66, 0.55, 1]);                // star fort base
    addDetail(L.x, 28, L.z, 11, 22, 11, [0.78, 0.72, 0.6, 1]);                 // pedestal
    detail.cylinder(L.x, 39, L.z, 4, 24, [0.36, 0.62, 0.52, 1], 10, 3, [0.36, 0.62, 0.52, 1]); // robe
    detail.cylinder(L.x, 66, L.z, 1.8, 3, [0.4, 0.66, 0.56, 1], 8);          // head
    addDetail(L.x + 2.8, 72, L.z, 1.2, 12, 1.2, [0.36, 0.62, 0.52, 1]);        // raised arm
    const torch = new pc.Vec3(L.x + 2.8, 79.5, L.z);
    this.collide(L.x, L.z, 10, 10, 39, 70);

    // ── Ships: warships in the harbour, barges and a ferry on the rivers.
    const ship = (x: number, z: number, len: number, heading: number, warship: boolean) => {
      const c = Math.cos(heading), sn = Math.sin(heading);
      const at = (dx: number, dz: number): [number, number] => [x + dx * c - dz * sn, z + dx * sn + dz * c];
      // Hull as a plate outline, pointed bow.
      detail.plate([at(0, -len / 2), at(len * 0.09, -len * 0.32), at(len * 0.09, len / 2), at(-len * 0.09, len / 2), at(-len * 0.09, -len * 0.32)]
        .map(([px, pz]) => [px, pz] as [number, number]), 1.2, 3.2, warship ? [0.42, 0.45, 0.48, 1] : [0.55, 0.28, 0.2, 1]);
      const [sx, sz] = at(0, len * 0.08);
      detail.box(sx, 4.2, sz, len * 0.1, 3, len * 0.22, warship ? [0.5, 0.53, 0.56, 1] : [0.9, 0.9, 0.86, 1]);
      if (warship) {
        detail.box(sx, 7.5, sz, len * 0.06, 3.6, len * 0.08, [0.5, 0.53, 0.56, 1]);
        detail.cylinder(sx, 9.3, sz, 0.3, 6, [0.3, 0.3, 0.32, 1], 4);
        const [gx, gz] = at(0, -len * 0.25);
        detail.cylinder(gx, 2.8, gz, 1.6, 1.2, [0.45, 0.48, 0.5, 1], 8);
      }
    };
    ship(60, -900, 90, 0.3, true);
    ship(-160, -1000, 110, -0.2, true);
    ship(320, -1150, 80, 1.1, true);
    ship(HUDSON_X - 18, 180, 50, 0.05, false);
    ship(HUDSON_X + 20, -420, 44, 3.1, false);
    ship(EAST_X + 15, 80, 40, 0.02, false);
    ship(EAST_X - 10, -500, 36, 3.2, false);

    // ── Ground: the street grid under Manhattan, grass and trees in Central Park.
    const street = new pc.StandardMaterial();
    street.diffuseMap = streetTexture(device);
    street.diffuseMapTiling = new pc.Vec2((CITY_HALF_X * 2) / BLOCK_X, (CITY_HALF_Z * 2) / BLOCK_Z);
    street.update();
    const ground = new pc.Entity("streets");
    ground.addComponent("render", { type: "plane", material: street });
    ground.setLocalScale(CITY_HALF_X * 2, 1, CITY_HALF_Z * 2);
    ground.setLocalPosition(0, 1.3, 0);
    app.root.addChild(ground);
    const parkMat = new pc.StandardMaterial();
    parkMat.diffuse = new pc.Color(0.3, 0.52, 0.22);
    parkMat.update();
    const park = new pc.Entity("central-park");
    park.addComponent("render", { type: "plane", material: parkMat });
    park.setLocalScale(PARK.x1 - PARK.x0 - 6, 1, PARK.z1 - PARK.z0);
    park.setLocalPosition((PARK.x0 + PARK.x1) / 2, 1.4, (PARK.z0 + PARK.z1) / 2 + 3);
    app.root.addChild(park);
    for (let i = 0; i < 160; i++) {
      const x = PARK.x0 + 6 + rnd() * (PARK.x1 - PARK.x0 - 16), z = PARK.z0 + 6 + rnd() * (PARK.z1 - PARK.z0 - 8);
      detail.cylinder(x, 1.4, z, 0.4, 2.5, [0.3, 0.22, 0.15, 1], 4);
      detail.cone(x, 3, z, 3 + rnd() * 1.5, 6 + rnd() * 3, [0.2, 0.42, 0.16, 1]);
    }
    detail.cylinder(0, 1.2, 250, 18, 0.5, [0.2, 0.35, 0.45, 1], 12); // the reservoir

    // ── Materials and entities
    for (const style of STYLES) {
      const spec = SPEC[style];
      const tex = facadeTextures(device, spec, 7 + STYLES.indexOf(style) * 13);
      const m = new pc.StandardMaterial();
      m.diffuseMap = tex.diffuse;
      m.emissiveMap = tex.emissive;
      m.emissive = new pc.Color(1, 1, 1);
      m.emissiveIntensity = style === "burnt" ? 2.4 : 0.6;
      m.useMetalness = true;
      m.metalness = style === "glass" ? 0.55 : 0.05;
      m.gloss = style === "glass" ? 0.8 : style === "white" ? 0.45 : 0.3;
      m.update();
      const e = new pc.Entity(`city-${style}`);
      e.addComponent("render", { meshInstances: [new pc.MeshInstance(builders.get(style)!.build(device), m)] });
      app.root.addChild(e);
    }
    const dmat = vertexColorMaterial({ gloss: 0.35 });
    dmat.cull = pc.CULLFACE_NONE;
    dmat.update();
    const de = new pc.Entity("city-detail");
    de.addComponent("render", { meshInstances: [new pc.MeshInstance(detail.build(device), dmat)] });
    app.root.addChild(de);

    // ── Fires (flickering glows; the game emits their smoke) and Liberty's torch.
    const fireMat = new pc.StandardMaterial();
    fireMat.diffuse = new pc.Color(0, 0, 0);
    fireMat.emissive = new pc.Color(1.5, 0.42, 0.06);
    fireMat.emissiveIntensity = 1.7;
    fireMat.blendType = pc.BLEND_ADDITIVE;
    fireMat.depthWrite = false;
    fireMat.useFog = false;
    fireMat.update();
    for (const f of [...this.fires, torch]) {
      const fire = new pc.Entity("fire");
      fire.addComponent("render", { type: "cone", material: fireMat, castShadows: false });
      fire.setLocalPosition(f.x, f.y + 3, f.z);
      app.root.addChild(fire);
      this.fireEntities.push(fire);
    }
  }

  private collide(cx: number, cz: number, w: number, d: number, y0: number, y1: number): void {
    const b: Box = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y0, maxY: y1 };
    this.boxes.push(b);
    for (let gx = Math.floor(b.minX / 50); gx <= Math.floor(b.maxX / 50); gx++) {
      for (let gz = Math.floor(b.minZ / 50); gz <= Math.floor(b.maxZ / 50); gz++) {
        const k = `${gx},${gz}`;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
    }
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.fireEntities.length;
    for (let i = 0; i < n; i++) {
      const k = 1 + Math.sin(this.t * 9 + i * 1.7) * 0.15 + Math.sin(this.t * 23 + i) * 0.08;
      const big = i === n - 1 ? 0.35 : 1; // the torch is small
      this.fireEntities[i].setLocalScale(7 * big, 9 * k * big, 7 * big);
    }
  }

  firesNear(p: pc.Vec3, radius: number): pc.Vec3[] {
    return this.fires
      .filter((f) => Math.abs(f.x - p.x) < radius && Math.abs(f.z - p.z) < radius)
      .map((f) => new pc.Vec3(f.x, f.y + 4, f.z));
  }

  /** Does a sphere at p touch a building? */
  hit(p: pc.Vec3, r: number): boolean {
    const list = this.grid.get(`${Math.floor(p.x / 50)},${Math.floor(p.z / 50)}`);
    if (!list) return false;
    for (const b of list) {
      if (p.y + r < b.minY || p.y - r > b.maxY) continue;
      if (p.x + r < b.minX || p.x - r > b.maxX) continue;
      if (p.z + r < b.minZ || p.z - r > b.maxZ) continue;
      return true;
    }
    return false;
  }
}
