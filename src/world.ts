import * as pc from "playcanvas";

/**
 * Populates the far-away cosmic scenery: nebulae, galaxy billboards, and
 * a handful of "civilization" set pieces (ringed planet, Dyson sphere).
 *
 * Everything here is big and far away — they act as distant landmarks
 * that the ship flies past. Each object is a billboard pair (two crossed
 * planes) so it reads from most angles without building proper meshes.
 *
 * All materials are additive/emissive so they light up when bloom is on.
 */

interface WorldProps {
  app: pc.Application;
  root: pc.Entity;
  /** The ship's root entity — world container will follow its position (with
   *  slight lag) so that the far-away scenery is always visible. */
  follow: pc.Entity;
}

/** Nebula color palette presets (linear RGB 0..1, plus intensity mult) */
const NEBULA_PALETTES: Array<{
  name: string;
  core: [number, number, number];
  mid: [number, number, number];
  edge: [number, number, number];
}> = [
  {
    name: "Carina",
    core: [1.4, 0.35, 0.75],
    mid: [0.85, 0.25, 0.85],
    edge: [0.25, 0.08, 0.45],
  },
  {
    name: "Horsehead",
    core: [0.3, 0.8, 1.4],
    mid: [0.2, 0.55, 1.1],
    edge: [0.05, 0.2, 0.6],
  },
  {
    name: "Orion",
    core: [1.5, 0.75, 0.15],
    mid: [1.15, 0.35, 0.15],
    edge: [0.55, 0.1, 0.08],
  },
  {
    name: "Trifid",
    core: [0.1, 1.2, 0.65],
    mid: [0.1, 0.65, 0.75],
    edge: [0.05, 0.25, 0.45],
  },
  {
    name: "Eagle",
    core: [1.1, 0.5, 0.9],
    mid: [0.85, 0.5, 1.0],
    edge: [0.45, 0.25, 0.6],
  },
  {
    name: "Mint",
    core: [0.7, 1.3, 0.55],
    mid: [0.3, 0.9, 0.7],
    edge: [0.1, 0.35, 0.3],
  },
];

function makeNebulaShader(
  core: [number, number, number],
  mid: [number, number, number],
  edge: [number, number, number],
  seed: number
): pc.ShaderMaterial {
  const vert = /* glsl */ `
    attribute vec3 aPosition;
    attribute vec2 aUv0;

    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;

    varying vec2 vUv;

    void main(void) {
      vUv = aUv0;
      gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
    }
  `;

  const frag = /* glsl */ `
    precision highp float;

    varying vec2 vUv;

    uniform float uTime;
    uniform float uSeed;
    uniform vec3  uCore;
    uniform vec3  uMid;
    uniform vec3  uEdge;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i + vec2(0.0, 0.0));
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 6; i++) {
        v += amp * noise2(p);
        p *= 2.07;
        amp *= 0.5;
      }
      return v;
    }

    void main(void) {
      // Centered UV (-1..1)
      vec2 uv = vUv * 2.0 - 1.0;
      float r = length(uv);
      if (r > 1.1) { discard; }

      // Layered fBm noise for organic cloud shape
      vec2 p = uv * 1.8 + vec2(uSeed * 7.0, uSeed * 3.0);
      float n1 = fbm(p + vec2(uTime * 0.02, 0.0));
      float n2 = fbm(p * 2.3 + vec2(0.0, uTime * 0.015));
      float n3 = fbm(p * 0.5 + 7.0);

      float density = smoothstep(0.25, 0.95, n1 * 0.8 + n2 * 0.35 - r * 0.6);

      // Radial falloff for soft edges
      float radial = smoothstep(1.0, 0.2, r);

      // Core vs mid vs edge mix
      float coreMask = smoothstep(0.6, 0.95, n1 + n3 * 0.2);
      vec3 col = mix(uEdge, uMid, smoothstep(0.3, 0.75, n1));
      col = mix(col, uCore, coreMask);

      float alpha = density * radial;
      // Sparkle brighter cores
      col += uCore * coreMask * 0.5;

      gl_FragColor = vec4(col * alpha, alpha);
    }
  `;

  const mat = new pc.ShaderMaterial({
    uniqueName: `nebula-${seed.toFixed(3)}`,
    vertexGLSL: vert,
    fragmentGLSL: frag,
    attributes: {
      aPosition: pc.SEMANTIC_POSITION,
      aUv0: pc.SEMANTIC_TEXCOORD0,
    },
  });
  mat.cull = pc.CULLFACE_NONE;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.blendType = pc.BLEND_ADDITIVE;
  mat.setParameter("uCore", core);
  mat.setParameter("uMid", mid);
  mat.setParameter("uEdge", edge);
  mat.setParameter("uSeed", seed);
  mat.setParameter("uTime", 0);
  mat.update();
  return mat;
}

function makeNebula(
  root: pc.Entity,
  palette: (typeof NEBULA_PALETTES)[number],
  pos: pc.Vec3,
  scale: number,
  seed: number
): pc.ShaderMaterial {
  const mat = makeNebulaShader(palette.core, palette.mid, palette.edge, seed);

  // Cross of two perpendicular planes so the nebula reads from many angles.
  const container = new pc.Entity(`nebula-${palette.name}`);
  container.setPosition(pos);
  root.addChild(container);

  for (let i = 0; i < 2; i++) {
    const plane = new pc.Entity(`nebula-${palette.name}-plane-${i}`);
    plane.addComponent("render", { type: "plane", material: mat });
    plane.setLocalScale(scale, scale, scale);
    plane.setLocalEulerAngles(90, i * 90, Math.random() * 360);
    container.addChild(plane);
  }

  return mat;
}

function makeGalaxyShader(style: "spiral" | "elliptical" | "ringed" | "edge"): pc.ShaderMaterial {
  const vert = /* glsl */ `
    attribute vec3 aPosition;
    attribute vec2 aUv0;

    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;

    varying vec2 vUv;

    void main(void) {
      vUv = aUv0;
      gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
    }
  `;

  const styleCode =
    style === "spiral"
      ? /* glsl */ `
          // Spiral galaxy — swirled density
          float angle = atan(uv.y, uv.x);
          float armPattern = sin(angle * 2.0 - log(r + 0.05) * 6.0 + uTime * 0.1) * 0.5 + 0.5;
          armPattern = pow(armPattern, 3.0);
          float core = smoothstep(0.22, 0.0, r);
          float disc = smoothstep(0.9, 0.15, r) * armPattern;
          float density = max(core * 1.4, disc * 0.7);
          vec3 col = mix(vec3(0.35, 0.45, 1.1), vec3(1.3, 0.9, 0.6), core);
          col = mix(col, vec3(0.7, 0.4, 1.2), armPattern * 0.4);
          gl_FragColor = vec4(col * density, density);
        `
      : style === "elliptical"
      ? /* glsl */ `
          // Elliptical — smooth radial falloff, bright core
          float core = smoothstep(0.8, 0.0, r);
          float density = pow(core, 2.2);
          vec3 col = mix(vec3(1.0, 0.75, 0.45), vec3(1.3, 1.0, 0.8), density);
          gl_FragColor = vec4(col * density, density);
        `
      : style === "ringed"
      ? /* glsl */ `
          // Ringed — faint disc with a bright ring at 0.6
          float ring = smoothstep(0.08, 0.0, abs(r - 0.6));
          float core = smoothstep(0.25, 0.0, r);
          float density = max(core * 1.2, ring * 0.8);
          vec3 col = mix(vec3(0.3, 0.85, 1.3), vec3(1.4, 1.0, 0.7), core);
          gl_FragColor = vec4(col * density, density);
        `
      : /* edge */ /* glsl */ `
          // Edge-on disc galaxy — thin horizontal streak with bulge
          float streak = smoothstep(0.05, 0.0, abs(uv.y)) * smoothstep(1.0, 0.0, abs(uv.x));
          float bulge = smoothstep(0.18, 0.0, length(uv * vec2(1.0, 2.5)));
          float density = max(streak * 0.8, bulge * 1.5);
          vec3 col = mix(vec3(0.9, 0.75, 0.55), vec3(1.4, 1.1, 0.9), bulge);
          gl_FragColor = vec4(col * density, density);
        `;

  const frag = /* glsl */ `
    precision highp float;

    varying vec2 vUv;
    uniform float uTime;

    void main(void) {
      vec2 uv = vUv * 2.0 - 1.0;
      float r = length(uv);
      if (r > 1.05) { discard; }
      ${styleCode}
    }
  `;

  const mat = new pc.ShaderMaterial({
    uniqueName: `galaxy-${style}-${Math.random().toFixed(3)}`,
    vertexGLSL: vert,
    fragmentGLSL: frag,
    attributes: {
      aPosition: pc.SEMANTIC_POSITION,
      aUv0: pc.SEMANTIC_TEXCOORD0,
    },
  });
  mat.cull = pc.CULLFACE_NONE;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.blendType = pc.BLEND_ADDITIVE;
  mat.setParameter("uTime", 0);
  mat.update();
  return mat;
}

function makeGalaxy(
  root: pc.Entity,
  style: "spiral" | "elliptical" | "ringed" | "edge",
  pos: pc.Vec3,
  scale: number,
  tilt: pc.Vec3
): pc.ShaderMaterial {
  const mat = makeGalaxyShader(style);
  const e = new pc.Entity(`galaxy-${style}`);
  e.addComponent("render", { type: "plane", material: mat });
  e.setPosition(pos);
  e.setLocalScale(scale, scale, scale);
  e.setEulerAngles(90 + tilt.x, tilt.y, tilt.z);
  root.addChild(e);
  return mat;
}

function makeRingedPlanet(root: pc.Entity, pos: pc.Vec3): void {
  const container = new pc.Entity("ringed-planet");
  container.setPosition(pos);
  container.setEulerAngles(22, 0, 12);
  root.addChild(container);

  // Planet body
  const bodyMat = new pc.StandardMaterial();
  bodyMat.diffuse = new pc.Color(0.75, 0.55, 0.32);
  bodyMat.emissive = new pc.Color(0.25, 0.14, 0.08);
  bodyMat.emissiveIntensity = 1.4;
  bodyMat.metalness = 0.1;
  bodyMat.gloss = 0.6;
  bodyMat.useMetalness = true;
  bodyMat.update();

  const body = new pc.Entity("planet-body");
  body.addComponent("render", { type: "sphere", material: bodyMat });
  body.setLocalScale(55, 55, 55);
  container.addChild(body);

  // Ring — proper additive ring shader with radial alpha (not a solid quad)
  const ringVert = /* glsl */ `
    attribute vec3 aPosition;
    attribute vec2 aUv0;
    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;
    varying vec2 vUv;
    void main(void) {
      vUv = aUv0;
      gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
    }
  `;
  const ringFrag = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    void main(void) {
      vec2 uv = vUv * 2.0 - 1.0;
      float r = length(uv);
      if (r > 1.0 || r < 0.55) { discard; }
      // Smooth inner + outer edges
      float inner = smoothstep(0.55, 0.62, r);
      float outer = smoothstep(1.0, 0.92, r);
      float stripe = 0.5 + 0.5 * sin(r * 70.0);
      float a = inner * outer * (0.6 + stripe * 0.4);
      vec3 col = mix(vec3(1.4, 1.0, 0.6), vec3(1.2, 0.75, 0.4), r);
      gl_FragColor = vec4(col * a, a);
    }
  `;
  const ringMat = new pc.ShaderMaterial({
    uniqueName: `planet-ring-${Math.random().toFixed(3)}`,
    vertexGLSL: ringVert,
    fragmentGLSL: ringFrag,
    attributes: {
      aPosition: pc.SEMANTIC_POSITION,
      aUv0: pc.SEMANTIC_TEXCOORD0,
    },
  });
  ringMat.cull = pc.CULLFACE_NONE;
  ringMat.depthWrite = false;
  ringMat.blendType = pc.BLEND_ADDITIVE;
  ringMat.update();

  const ring = new pc.Entity("planet-ring");
  ring.addComponent("render", { type: "plane", material: ringMat });
  ring.setLocalScale(170, 1, 170);
  container.addChild(ring);
}

function makeDysonSphere(root: pc.Entity, pos: pc.Vec3): void {
  const container = new pc.Entity("dyson-sphere");
  container.setPosition(pos);
  root.addChild(container);

  const coreMat = new pc.StandardMaterial();
  coreMat.diffuse = new pc.Color(0, 0, 0);
  coreMat.emissive = new pc.Color(1.6, 1.2, 0.4);
  coreMat.emissiveIntensity = 3.5;
  coreMat.update();

  const core = new pc.Entity("dyson-core");
  core.addComponent("render", { type: "sphere", material: coreMat });
  core.setLocalScale(30, 30, 30);
  container.addChild(core);

  // A few translucent bands around it to suggest lattice structure
  const shellMat = new pc.StandardMaterial();
  shellMat.diffuse = new pc.Color(0.4, 0.35, 0.25);
  shellMat.emissive = new pc.Color(0.8, 0.55, 0.15);
  shellMat.emissiveIntensity = 1.1;
  shellMat.opacity = 0.35;
  shellMat.blendType = pc.BLEND_ADDITIVE;
  shellMat.depthWrite = false;
  shellMat.update();

  for (let i = 0; i < 3; i++) {
    const shell = new pc.Entity(`dyson-shell-${i}`);
    shell.addComponent("render", { type: "torus", material: shellMat });
    shell.setLocalScale(55, 55, 55);
    shell.setLocalEulerAngles(i * 60, i * 40, i * 30);
    container.addChild(shell);
  }
}

export function buildWorld({ app, root, follow }: WorldProps): void {
  // World container — parallax behaviour. Most distant objects (galaxies, set
  // pieces) get parented into this container which follows the ship at a
  // fraction of its speed. Result: player feels they're moving (parallax),
  // but scenery never fully leaves the frame.
  const worldContainer = new pc.Entity("world-container");
  root.addChild(worldContainer);

  // Near scenery (nebulae) — parented to a subcontainer that follows the ship
  // at ~0.85× so they drift by as the player passes but never fully go behind.
  const nebulaContainer = new pc.Entity("nebula-container");
  worldContainer.addChild(nebulaContainer);

  // Far scenery (galaxies, set pieces) — follow ship at ~0.96× so they feel
  // essentially fixed at the horizon.
  const farContainer = new pc.Entity("far-container");
  worldContainer.addChild(farContainer);

  // Nebulae — 6 volumetric-looking clouds spread in a sphere around the ship.
  // Placed at ±radius from origin; radius 300-500. Scale is large.
  const nebulaPlacements: Array<{
    paletteIndex: number;
    pos: pc.Vec3;
    scale: number;
  }> = [
    { paletteIndex: 0, pos: new pc.Vec3(300, 50, -420), scale: 520 },
    { paletteIndex: 1, pos: new pc.Vec3(-380, 80, -300), scale: 580 },
    { paletteIndex: 2, pos: new pc.Vec3(80, -180, -560), scale: 640 },
    { paletteIndex: 3, pos: new pc.Vec3(-250, -60, 380), scale: 540 },
    { paletteIndex: 4, pos: new pc.Vec3(420, 220, 260), scale: 600 },
    { paletteIndex: 5, pos: new pc.Vec3(-480, 280, 480), scale: 620 },
  ];

  const nebulaMats: pc.ShaderMaterial[] = [];
  for (let i = 0; i < nebulaPlacements.length; i++) {
    const p = nebulaPlacements[i];
    const mat = makeNebula(
      nebulaContainer,
      NEBULA_PALETTES[p.paletteIndex],
      p.pos,
      p.scale,
      i * 3.7 + 1.2
    );
    nebulaMats.push(mat);
  }

  // Galaxy billboards — 4, far out
  const galaxyMats: pc.ShaderMaterial[] = [];
  galaxyMats.push(
    makeGalaxy(farContainer, "spiral", new pc.Vec3(0, 150, -1500), 340, new pc.Vec3(-25, 0, 15))
  );
  galaxyMats.push(
    makeGalaxy(farContainer, "elliptical", new pc.Vec3(-1100, -220, -900), 220, new pc.Vec3(10, 40, 0))
  );
  galaxyMats.push(
    makeGalaxy(farContainer, "ringed", new pc.Vec3(950, 280, -700), 280, new pc.Vec3(-40, -30, 5))
  );
  galaxyMats.push(
    makeGalaxy(farContainer, "edge", new pc.Vec3(-350, -320, -1700), 320, new pc.Vec3(-15, 20, 30))
  );

  // Civilization set pieces — distant landmarks
  makeRingedPlanet(farContainer, new pc.Vec3(620, -80, -950));
  makeDysonSphere(farContainer, new pc.Vec3(-580, 180, -1300));

  // Animate time uniforms + parallax follow.
  //
  // Nebulae follow at 88% of ship motion — means every 100 units the player
  // flies, the nebulae drift past at 12 units, giving a strong parallax /
  // "I'm moving through this" feel. Far scenery follows at 97% — effectively
  // horizon-locked.
  const startTime = performance.now();
  const nebulaPos = new pc.Vec3();
  const farPos = new pc.Vec3();
  app.on("update", () => {
    const elapsed = (performance.now() - startTime) / 1000;
    for (const m of nebulaMats) m.setParameter("uTime", elapsed);
    for (const m of galaxyMats) m.setParameter("uTime", elapsed);

    const shipPos = follow.getPosition();
    nebulaPos.set(shipPos.x * 0.88, shipPos.y * 0.88, shipPos.z * 0.88);
    nebulaContainer.setPosition(nebulaPos);
    farPos.set(shipPos.x * 0.97, shipPos.y * 0.97, shipPos.z * 0.97);
    farContainer.setPosition(farPos);
  });
}
