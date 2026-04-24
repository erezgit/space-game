import * as pc from "playcanvas";

/**
 * Procedural starfield + nebula skybox.
 * Creates an inverted sphere surrounding the scene with a custom GLSL
 * ShaderMaterial that renders layered stars, color gradient, and soft nebula clouds.
 */
export function createStarfieldSkybox(app: pc.Application): pc.Entity {
  const vertexShader = /* glsl */ `
    attribute vec3 aPosition;

    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;

    varying vec3 vDir;

    void main(void) {
      vec4 worldPos = matrix_model * vec4(aPosition, 1.0);
      vDir = normalize(aPosition);
      gl_Position = matrix_viewProjection * worldPos;
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;

    varying vec3 vDir;
    uniform float uTime;

    // Hash helpers — cheap pseudo-random
    float hash31(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    // Value noise
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash31(i + vec3(0, 0, 0));
      float b = hash31(i + vec3(1, 0, 0));
      float c = hash31(i + vec3(0, 1, 0));
      float d = hash31(i + vec3(1, 1, 0));
      float e = hash31(i + vec3(0, 0, 1));
      float f1 = hash31(i + vec3(1, 0, 1));
      float g = hash31(i + vec3(0, 1, 1));
      float h = hash31(i + vec3(1, 1, 1));
      return mix(
        mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
        mix(mix(e, f1, f.x), mix(g, h, f.x), f.y),
        f.z
      );
    }

    float fbm(vec3 p) {
      float v = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 5; i++) {
        v += amp * noise3(p);
        p *= 2.02;
        amp *= 0.5;
      }
      return v;
    }

    // Stars: cells of sparse bright points
    float stars(vec3 dir, float density, float sharpness) {
      vec3 p = dir * density;
      vec3 cell = floor(p);
      vec3 localP = fract(p) - 0.5;

      float rnd = hash31(cell);
      if (rnd < 0.88) return 0.0;

      vec3 starOffset = vec3(
        hash31(cell + 1.7) - 0.5,
        hash31(cell + 3.1) - 0.5,
        hash31(cell + 5.3) - 0.5
      ) * 0.7;

      float d = length(localP - starOffset);
      float intensity = pow(1.0 - smoothstep(0.0, 0.05 * sharpness, d), 2.0);
      float brightBoost = step(0.985, rnd) * 1.8;
      return intensity * (0.6 + brightBoost);
    }

    void main(void) {
      vec3 dir = normalize(vDir);

      // Base deep-space gradient — subtle violet/blue
      float elev = dir.y * 0.5 + 0.5;
      vec3 baseColor = mix(
        vec3(0.01, 0.005, 0.03),
        vec3(0.04, 0.03, 0.08),
        elev
      );

      // Galaxy band — horizontal faint band of dust
      float band = exp(-pow(dir.y * 2.4, 2.0));
      vec3 bandTint = vec3(0.22, 0.14, 0.32);
      baseColor += bandTint * band * 0.35;

      // Large-scale nebula clouds
      vec3 nebCoord = dir * 2.3 + vec3(0.0, 0.0, uTime * 0.005);
      float neb = fbm(nebCoord);
      neb = smoothstep(0.45, 0.85, neb);

      vec3 nebColorA = vec3(0.45, 0.18, 0.65);
      vec3 nebColorB = vec3(0.12, 0.40, 0.85);
      vec3 nebColorC = vec3(0.92, 0.42, 0.22);

      float nebMix = fbm(dir * 1.1 + 5.0);
      vec3 nebColor = mix(nebColorA, nebColorB, nebMix);
      nebColor = mix(nebColor, nebColorC, smoothstep(0.55, 0.9, fbm(dir * 0.6 + 11.0)));

      baseColor += nebColor * neb * 0.55 * band;

      // Dusty secondary nebula
      float neb2 = fbm(dir * 1.4 + 3.0);
      neb2 = smoothstep(0.5, 0.8, neb2);
      baseColor += vec3(0.28, 0.12, 0.42) * neb2 * 0.22;

      // Stars — 3 layers at different densities
      float s1 = stars(dir, 180.0, 1.8);
      float s2 = stars(dir, 90.0, 1.3);
      float s3 = stars(dir, 42.0, 1.0);

      vec3 starColor = vec3(1.0, 0.95, 0.85);
      vec3 starColorCool = vec3(0.75, 0.85, 1.0);

      baseColor += starColor * s1 * 0.7;
      baseColor += mix(starColor, starColorCool, 0.4) * s2 * 0.85;
      vec3 brightTint = mix(vec3(1.0, 0.9, 0.7), vec3(0.8, 0.9, 1.1), hash31(floor(dir * 42.0)));
      baseColor += brightTint * s3;

      baseColor = pow(baseColor, vec3(0.96));
      gl_FragColor = vec4(baseColor, 1.0);
    }
  `;

  const material = new pc.ShaderMaterial({
    uniqueName: "starfield-skybox",
    vertexGLSL: vertexShader,
    fragmentGLSL: fragmentShader,
    attributes: { aPosition: pc.SEMANTIC_POSITION },
  });
  material.cull = pc.CULLFACE_FRONT; // render inside of sphere
  material.depthWrite = false;
  material.depthTest = false;
  material.setParameter("uTime", 0);
  material.update();

  const skyEntity = new pc.Entity("skybox");
  skyEntity.addComponent("render", {
    type: "sphere",
    material: material,
    castShadows: false,
    receiveShadows: false,
  });
  skyEntity.setLocalScale(900, 900, 900);
  app.root.addChild(skyEntity);

  // Animate time uniform
  const startTime = performance.now();
  app.on("update", () => {
    const elapsed = (performance.now() - startTime) / 1000;
    material.setParameter("uTime", elapsed);
  });

  return skyEntity;
}
