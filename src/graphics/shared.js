import * as THREE from 'three';

export const QUALITY = {
  low: { pixelRatio: 1, planetTexture: 2048, skyTexture: 2048, shadowMap: 2048, terrainSegments: 256, rocks: 800, dust: 200, terrainShadows: false },
  high: { pixelRatio: 1.5, planetTexture: 4096, skyTexture: 4096, shadowMap: 4096, terrainSegments: 512, rocks: 2400, dust: 500, terrainShadows: true },
};

// Filled by graphics.init(). `ensure` lets asset factories start the renderer if nobody has yet.
export const state = { renderer: null, quality: 'high', ensure: null };

export function getRenderer() {
  if (!state.renderer) state.ensure?.();
  return state.renderer;
}

export function qualitySettings() {
  return QUALITY[state.quality];
}

// One set of values for every shader, advanced once per frame by graphics.render().
export const sharedUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.82, 0.25, 0.52).normalize() },
};

// Written by the Earth planet each frame (planets.js), read by the star field (sky.js): 1 when the camera sits in a bright daytime sky.
export const skyState = { daylight: 0, stamp: -1e9 };

export const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(.1031, .1030, .0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p, int octaves) {
  float a = .5, s = 0., n = 0.;
  for (int i = 0; i < octaves; i++) {
    s += a * vnoise(p);
    n += a;
    p = p * 2.02 + vec3(13.1, 7.3, 2.9);
    a *= .5;
  }
  return s / n;
}
// Same mapping as THREE.SphereGeometry's uv, so baked maps wrap with no seam.
vec3 dirFromUv(vec2 uv) {
  float lon = uv.x * 6.2831853, lat = (uv.y - .5) * 3.14159265, c = cos(lat);
  return vec3(-cos(lon) * c, sin(lat), sin(lon) * c);
}
`;

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

// Renders a fragment shader into a mipmapped texture (half float unless `type` says otherwise) once, so heavy noise costs nothing per frame.
export function bakeTexture({ width, height, fragment, uniforms = {}, wrap = THREE.ClampToEdgeWrapping, wrapS = THREE.RepeatWrapping, type = THREE.HalfFloatType }) {
  const renderer = getRenderer();
  const target = new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    wrapS,
    wrapT: wrap,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  const material = new THREE.ShaderMaterial({ vertexShader: BAKE_VERTEX, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  material.dispose();
  return target.texture;
}
