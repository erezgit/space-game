import * as pc from "playcanvas";

/**
 * Small geometry kit: builders that append to plain arrays, so many pieces can be
 * merged into ONE mesh (one draw call). Colours are per-vertex RGBA 0..1.
 */
export class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  private quad(v: number[][], n: number[], uvs: number[][], c: number[]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(c[0], c[1], c[2], c[3] ?? 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Axis-aligned box. `uvScale` = metres per texture repeat on the walls
   * (0 → constant UV, for untextured parts). Roofs get UV (0.01,0.01).
   */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number,
    c: number[] = [1, 1, 1, 1], uvW = 0, uvH = 0, bottom = false): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const wall = (len: number) => (uvW ? [[0, 0], [len / uvW, 0], [len / uvW, h / uvH], [0, h / uvH]] : [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]]);
    const roof = [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]];
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], wall(w), c);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], wall(w), c);
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], wall(d), c);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], wall(d), c);
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], roof, c);
    if (bottom) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], roof, c);
  }

  /** Vertical cylinder (n sides) with a top cap; optional cone top of height `coneH`. */
  cylinder(cx: number, y0: number, cz: number, r: number, h: number, c: number[], n = 8, coneH = 0, coneC?: number[]): void {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const am = (a0 + a1) / 2;
      const nn = [Math.cos(am), 0, Math.sin(am)];
      this.quad([[x1, y0, z1], [x0, y0, z0], [x0, y0 + h, z0], [x1, y0 + h, z1]], nn, [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]], c);
      const top = y0 + h;
      const base = this.pos.length / 3;
      if (coneH > 0) {
        const cc = coneC ?? c;
        const ny = r / Math.hypot(r, coneH);
        this.pos.push(x1, top, z1, x0, top, z0, cx, top + coneH, cz);
        for (let k = 0; k < 3; k++) { this.nrm.push(nn[0] * (1 - ny), ny, nn[2] * (1 - ny)); this.uv.push(0.01, 0.01); this.col.push(cc[0], cc[1], cc[2], 1); }
      } else {
        this.pos.push(x1, top, z1, x0, top, z0, cx, top, cz);
        for (let k = 0; k < 3; k++) { this.nrm.push(0, 1, 0); this.uv.push(0.01, 0.01); this.col.push(c[0], c[1], c[2], 1); }
      }
      this.idx.push(base, base + 1, base + 2);
    }
  }

  /** Cone for trees: apex up. */
  cone(cx: number, y0: number, cz: number, r: number, h: number, c: number[], n = 6): void {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const base = this.pos.length / 3;
      const ny = r / Math.hypot(r, h);
      this.pos.push(cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r, cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r, cx, y0 + h, cz);
      for (let k = 0; k < 3; k++) {
        this.nrm.push(Math.cos(am) * (1 - ny), ny, Math.sin(am) * (1 - ny));
        this.uv.push(0.01, 0.01);
        const shade = k === 2 ? 1.15 : 0.9;
        this.col.push(c[0] * shade, c[1] * shade, c[2] * shade, 1);
      }
      this.idx.push(base, base + 1, base + 2);
    }
  }

  /**
   * A flat plate from a 2D outline in the XZ plane (points in order), with thickness t,
   * centred on y. Used for wings, tails and chines.
   */
  plate(points: [number, number][], y: number, t: number, c: number[]): void {
    const n = points.length;
    const top = y + t / 2, bot = y - t / 2;
    // Fan triangulation (outlines are convex).
    const bt = this.pos.length / 3;
    for (const [x, z] of points) { this.pos.push(x, top, z); this.nrm.push(0, 1, 0); this.uv.push(0.01, 0.01); this.col.push(c[0], c[1], c[2], 1); }
    for (let i = 1; i < n - 1; i++) this.idx.push(bt, bt + i + 1, bt + i);
    const bb = this.pos.length / 3;
    for (const [x, z] of points) { this.pos.push(x, bot, z); this.nrm.push(0, -1, 0); this.uv.push(0.01, 0.01); this.col.push(c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1); }
    for (let i = 1; i < n - 1; i++) this.idx.push(bb, bb + i, bb + i + 1);
    for (let i = 0; i < n; i++) {
      const [ax, az] = points[i], [bx, bz] = points[(i + 1) % n];
      const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez) || 1;
      this.quad([[ax, bot, az], [bx, bot, bz], [bx, top, bz], [ax, top, az]], [ez / len, 0, -ex / len], [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]], c);
    }
  }

  build(device: pc.GraphicsDevice): pc.Mesh {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.pos);
    mesh.setNormals(this.nrm);
    mesh.setUvs(0, this.uv);
    mesh.setColors(this.col);
    mesh.setIndices(this.pos.length / 3 > 65535 ? new Uint32Array(this.idx) : this.idx);
    mesh.update();
    return mesh;
  }
}

/** A material that takes its colour from the vertices. */
export function vertexColorMaterial(opts: { gloss?: number; metalness?: number; emissive?: [number, number, number] } = {}): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.useMetalness = true;
  m.metalness = opts.metalness ?? 0;
  m.gloss = opts.gloss ?? 0.25;
  if (opts.emissive) m.emissive = new pc.Color(...opts.emissive);
  m.update();
  return m;
}

/** Deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 2D, deterministic. */
export function noise2(x: number, z: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

export function fbm2(x: number, z: number, oct = 5): number {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise2(x * f, z * f); f *= 2.02; a *= 0.5; }
  return v;
}
