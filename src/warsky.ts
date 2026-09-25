import * as pc from "playcanvas";

/** The horizon haze colour — the scene fog uses it too, so distant land melts into the sky. */
export const HAZE: [number, number, number] = [0.66, 0.66, 0.66];
/** Direction TO the sun (normalised in the shader). The key light shines along its negative. */
export const SUN_DIR: [number, number, number] = [-0.45, 0.42, -0.79];

/**
 * A late-afternoon sky over a city at war: deep blue overhead, a warm hazy
 * horizon, a bright sun with a glow, drifting cumulus — and dark war smoke
 * smudged low over the horizon where the city burns.
 *
 * An inverted sphere, depth-tested, drawn in the skybox layer, following the camera.
 */
export function createWarSky(app: pc.Application, camera: pc.Entity): pc.Entity {
  const vertexShader = /* glsl */ `
    attribute vec3 aPosition;
    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;
    varying vec3 vDir;
    void main(void) {
      vDir = normalize(aPosition);
      gl_Position = matrix_viewProjection * (matrix_model * vec4(aPosition, 1.0));
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    varying vec3 vDir;
    uniform float uTime;
    uniform vec3 uHaze;
    uniform vec3 uSun;

    float hash31(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i), n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0)), n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1)), n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1)), n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
                 mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise3(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main(void) {
      vec3 dir = normalize(vDir);
      float h = dir.y;
      vec3 sun = normalize(uSun);

      vec3 zenith = vec3(0.16, 0.34, 0.66);
      vec3 mid = vec3(0.42, 0.58, 0.8);
      vec3 col = mix(uHaze * 1.08, mid, smoothstep(0.0, 0.18, h));
      col = mix(col, zenith, smoothstep(0.15, 0.7, h));
      col = mix(col, uHaze * 0.95, smoothstep(0.0, -0.2, h)); // below the horizon

      // Sun: disc, halo, and a warm cast over that side of the sky.
      float sd = max(dot(dir, sun), 0.0);
      col += vec3(1.6, 1.4, 1.1) * pow(sd, 900.0) * 3.0;
      col += vec3(1.0, 0.8, 0.5) * pow(sd, 24.0) * 0.35;
      col += vec3(0.5, 0.35, 0.2) * pow(sd, 4.0) * 0.18 * (1.0 - smoothstep(0.0, 0.6, h));

      // Cumulus, drifting, lit on the sun side.
      vec3 cp = dir / max(h + 0.15, 0.05) * 0.9 + vec3(uTime * 0.01, 0.0, uTime * 0.006);
      float cloud = smoothstep(0.52, 0.78, fbm(cp)) * smoothstep(0.02, 0.2, h);
      vec3 cloudCol = mix(vec3(0.72, 0.74, 0.78), vec3(1.05, 1.0, 0.95), pow(sd, 3.0));
      col = mix(col, cloudCol, cloud * 0.85);

      // War smoke: dark, low, in columns over the horizon.
      float band = 1.0 - smoothstep(0.0, 0.26, abs(h - 0.06));
      float columns = smoothstep(0.55, 0.9, fbm(vec3(atan(dir.z, dir.x) * 5.0, h * 5.0 - uTime * 0.03, 3.0)));
      col = mix(col, vec3(0.2, 0.18, 0.17), band * columns * 0.7);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const material = new pc.ShaderMaterial({
    uniqueName: "war-sky-day",
    vertexGLSL: vertexShader,
    fragmentGLSL: fragmentShader,
    attributes: { aPosition: pc.SEMANTIC_POSITION },
  });
  material.cull = pc.CULLFACE_FRONT;
  material.depthWrite = false;
  // Depth-tested, so it only fills pixels nothing else drew — the skybox layer renders
  // AFTER the world layer in PlayCanvas 2, and with depthTest off it painted over the city.
  material.depthTest = true;
  material.setParameter("uTime", 0);
  material.setParameter("uHaze", HAZE);
  material.setParameter("uSun", SUN_DIR);
  material.update();

  const sky = new pc.Entity("war-sky");
  sky.addComponent("render", {
    type: "sphere", material, castShadows: false, receiveShadows: false, layers: [pc.LAYERID_SKYBOX],
  });
  // Radius 4500: beyond the fog's end, inside the camera's far clip (5000).
  sky.setLocalScale(9000, 9000, 9000);
  app.root.addChild(sky);

  const start = performance.now();
  app.on("update", () => {
    material.setParameter("uTime", (performance.now() - start) / 1000);
    sky.setPosition(camera.getPosition());
  });

  return sky;
}
