import * as pc from "playcanvas";

/** The horizon colour — the scene fog uses it too, so the city melts into the sky. */
export const HAZE: [number, number, number] = [0.46, 0.22, 0.12];

/**
 * World War III sky over New York: a burning orange horizon, a low red sun
 * behind the smoke, and heavy drifting smoke clouds overhead.
 *
 * An inverted sphere with a GLSL shader. It follows the camera every frame so
 * the player can never fly out of it.
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

      // Gradient: burning horizon → smoky brown → near-black overhead.
      vec3 horizon = uHaze * 1.25;
      vec3 mid = vec3(0.30, 0.13, 0.08);
      vec3 top = vec3(0.07, 0.05, 0.05);
      vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
      col = mix(col, top, smoothstep(0.18, 0.75, h));
      // Below the horizon: the glow of the burning city.
      col = mix(col, uHaze * 0.9, smoothstep(0.0, -0.25, h));

      // A low, blood-red sun hidden in the smoke.
      vec3 sunDir = normalize(vec3(-0.55, 0.12, -0.83));
      float sd = max(dot(dir, sunDir), 0.0);
      col += vec3(1.4, 0.45, 0.12) * pow(sd, 350.0) * 2.2;
      col += vec3(1.0, 0.35, 0.1) * pow(sd, 12.0) * 0.45;

      // Heavy smoke, drifting.
      vec3 p = dir * 3.0 + vec3(uTime * 0.012, 0.0, uTime * 0.02);
      float smoke = fbm(p);
      smoke = smoothstep(0.42, 0.85, smoke) * smoothstep(-0.05, 0.25, h);
      col = mix(col, vec3(0.09, 0.07, 0.07), smoke * 0.75);
      // Fire light catching the underside of the smoke near the horizon.
      col += vec3(0.5, 0.18, 0.05) * smoke * (1.0 - smoothstep(0.0, 0.3, h)) * 0.5;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const material = new pc.ShaderMaterial({
    uniqueName: "war-sky",
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
  material.update();

  const sky = new pc.Entity("war-sky");
  sky.addComponent("render", {
    type: "sphere", material, castShadows: false, receiveShadows: false, layers: [pc.LAYERID_SKYBOX],
  });
  // Radius 1300: beyond the fog's end (900), inside the camera's far clip (1400).
  sky.setLocalScale(2600, 2600, 2600);
  app.root.addChild(sky);

  const start = performance.now();
  app.on("update", () => {
    material.setParameter("uTime", (performance.now() - start) / 1000);
    sky.setPosition(camera.getPosition());
  });

  return sky;
}
