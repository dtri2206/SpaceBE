import * as THREE from 'three';
import { GLSL_NOISE, getRenderer, qualitySettings, sharedUniforms } from './shared.js';

// Every shader here depth-tests against the logarithmic depth buffer, so each includes the logdepthbuf chunks.

const FUELS = {
  // core, edge (HDR linear), alpha multiplier, light colour
  kerolox: { core: [6, 4.6, 2.6], edge: [4.2, 1.35, 0.22], alpha: 1, light: 0xff9a45 },
  methalox: { core: [2.2, 2.7, 6], edge: [1.7, 0.6, 0.14], alpha: 0.9, light: 0xa8b8ff },
  hydrolox: { core: [1.8, 3.2, 6.5], edge: [0.9, 1.7, 3.6], alpha: 0.38, light: 0x9fc4ff },
};

const FLAME_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_NOISE}
uniform float uTime, uThrottle, uDensity, uLayer;
varying float vT;
varying vec3 vNormalV, vViewPos, vObj;

// Plume radius in nozzle radii at t (0 nozzle, 1 tip): a tight column at sea level, a ballooning bell in vacuum.
float plume(float t) {
  float sea = (1. + .25 * smoothstep(0., .35, t)) * (1. - .55 * smoothstep(.55, 1., t));
  float vac = 1. + 4.6 * (1. - pow(1. - t, 1.8));
  return mix(vac, sea, uDensity) * mix(1., .42, uLayer);
}

void main() {
  float t = .5 - position.y;
  vec2 dir = position.xz;
  float len = mix(9., 12., uDensity) * (.4 + .6 * uThrottle) * mix(1., .6, uLayer);
  float wobble = 1. + .1 * (vnoise(vec3(dir * 1.5, t * 5. - uTime * 11.)) - .5) * t;
  float r = plume(t) * wobble;
  float drdt = (plume(min(t + .01, 1.)) - plume(t)) * 100.;
  vec3 pos = vec3(dir.x * .95 * r, -t * len, dir.y * .95 * r);
  // The surface normal leans with the flare, so the rim fade follows the real silhouette.
  vec3 n = normalize(vec3(dir.x * len, .95 * drdt, dir.y * len));
  vNormalV = normalMatrix * n;
  vec4 mv = modelViewMatrix * vec4(pos, 1.);
  vViewPos = mv.xyz;
  vObj = pos;
  vT = t;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FLAME_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
uniform float uTime, uThrottle, uDensity, uLayer, uAlphaMul;
uniform vec3 uCore, uEdge;
varying float vT;
varying vec3 vNormalV, vViewPos, vObj;
void main() {
  #include <logdepthbuf_fragment>
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  // No hard cone edge: opacity falls to nothing as the surface turns edge-on, and at the tip.
  float rim = pow(facing, mix(1.5, 2.4, uLayer));
  // In vacuum the plume dissolves from 55% of its length on, so no rounded bell edge shows.
  float tip = pow(1. - vT, 1.5) * mix(smoothstep(1., .55, vT), 1., uDensity);
  float flick = vnoise(vec3(vObj.xz * 1.1, vT * 7. - uTime * 14.));
  float streak = vnoise(vec3(vObj.xz * 3., vT * 3. - uTime * 6.));
  // Shock diamonds: 6 bright knots in the dense air, fading out as the plume thins into vacuum.
  float diamonds = pow(abs(sin(vT * 20.42)), 6.) * uDensity * (1. - vT * .55);
  float heat = pow(facing, 1.1) * (1. - vT * .45);
  vec3 col = mix(uEdge, uCore, clamp(heat, 0., 1.));
  float bright = (.7 + .7 * flick) * (.8 + .4 * streak) * (.5 + .7 * uThrottle);
  // A dim base at sea level leaves room for the knots: tone mapping flattens anything already near white.
  bright *= mix(1., mix(.55, .28, uLayer), uDensity) + diamonds * mix(1.2, 3.2, uLayer);
  float vacuumFade = mix(.3, 1., uDensity);
  float alpha = rim * tip * uAlphaMul * vacuumFade * mix(.45, 1., uLayer) * (.6 + .4 * uThrottle);
  gl_FragColor = vec4(col * bright * mix(1., 1.35, uLayer), clamp(alpha, 0., 1.));
}`;

/** Rocket plume for a 0.95 m nozzle, pointing down -Y from the origin. set({ throttle, airDensity, fuel }). */
export function createEngineFlame() {
  const group = new THREE.Group();
  group.name = 'vfx:engineFlame';
  const shared = {
    uTime: sharedUniforms.uTime,
    uThrottle: { value: 1 },
    uDensity: { value: 1 },
    uCore: { value: new THREE.Vector3() },
    uEdge: { value: new THREE.Vector3() },
    uAlphaMul: { value: 1 },
  };
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 32, 48, true);
  const plumes = [];
  [0, 1].forEach((layer) => {
    const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: { ...shared, uLayer: { value: layer } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    mesh.frustumCulled = false; // the vertex shader stretches the unit cylinder far outside its bounds
    mesh.renderOrder = 2;
    plumes.push(mesh);
    group.add(mesh);
  });

  // The light is never hidden: toggling it would change the scene's light count and recompile every lit material.
  const light = new THREE.PointLight(0xffffff, 0, 40, 2);
  light.position.y = -0.7;
  group.add(light);

  let throttle = 1;
  const state = { throttle: 1, airDensity: 1, fuel: 'methalox' };
  group.userData.set = (values = {}) => {
    Object.assign(state, values);
    const fuel = FUELS[state.fuel] ?? FUELS.methalox;
    throttle = THREE.MathUtils.clamp(state.throttle, 0, 1);
    shared.uThrottle.value = throttle;
    shared.uDensity.value = THREE.MathUtils.clamp(state.airDensity, 0, 1);
    shared.uCore.value.set(...fuel.core);
    shared.uEdge.value.set(...fuel.edge);
    shared.uAlphaMul.value = fuel.alpha;
    light.color.set(fuel.light);
    plumes.forEach((m) => { m.visible = throttle > 0; });
  };
  group.userData.onFrame = () => {
    const t = sharedUniforms.uTime.value;
    if (throttle <= 0) { light.intensity = 0; return; }
    // Dense air makes a brighter splash on the ground, and vacuum leaves little to light.
    light.intensity = throttle * (60 + 160 * shared.uDensity.value) * (0.88 + 0.12 * Math.sin(t * 41) * Math.sin(t * 23));
  };
  group.userData.set();
  return group;
}

// World-size points: size in metres becomes pixels from the projection, clamped so a close particle can't fill the screen.
const POINT_COMMON = /* glsl */ `
uniform float uHeightPx;
float pointPixels(float worldSize, vec4 mv) {
  return min(worldSize * projectionMatrix[1][1] * uHeightPx * .5 / max(-mv.z, .01), uHeightPx * .3);
}
`;

const SPRITE_FRAGMENT_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
uniform float uTime;
varying vec4 vColor;
varying float vSeed;
// A soft falloff broken up by one octave of noise, and exactly zero at the quad's edge so no square shows.
float spriteShape() {
  vec2 p = gl_PointCoord * 2. - 1.;
  float r = length(p);
  if (r >= 1.) discard;
  // Two octaves of domain-warped noise break the outline, offset per particle so no two sprites match.
  vec2 w = vec2(vnoise(vec3(p * 1.6 + vSeed * 13., vSeed * 5.)), vnoise(vec3(p * 1.6 + vSeed * 7. + 5., vSeed * 3.))) - .5;
  float n = fbm(vec3((p + w * .9) * 2.2 + vSeed * 17., vSeed * 5. + uTime * .2), 2);
  return smoothstep(1., .15, r + (n - .5) * .9 * (1. - r));
}
`;

function particleSeeds(count) {
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  return geometry;
}

function createParticles(name, { count, vertex, fragment, extraUniforms }) {
  const heightPx = { value: 1080 };
  const material = new THREE.ShaderMaterial({
    vertexShader: `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_NOISE}
${POINT_COMMON}
attribute vec4 aSeed;
uniform float uTime;
varying vec4 vColor;
varying float vSeed;
${vertex}`,
    fragmentShader: `${SPRITE_FRAGMENT_HEAD}\n${fragment}`,
    uniforms: { uTime: sharedUniforms.uTime, uHeightPx: heightPx, ...extraUniforms },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(particleSeeds(count), material);
  points.frustumCulled = false; // positions are computed on the GPU
  points.name = name;
  const size = new THREE.Vector2();
  points.onBeforeRender = () => { heightPx.value = getRenderer().getDrawingBufferSize(size).y; };
  const group = new THREE.Group();
  group.name = name;
  group.add(points);
  return group;
}

const countFor = (high, low) => (qualitySettings().rocks > 1000 ? high : low);

/** Smoke and sparks under the nozzle. set({ throttle, airDensity }). Needs air to show, so it vanishes in vacuum. */
export function createExhaust() {
  const uniforms = { uThrottle: { value: 1 }, uDensity: { value: 1 } };
  const group = createParticles('vfx:exhaust', {
    count: countFor(600, 200),
    extraUniforms: uniforms,
    vertex: /* glsl */ `
uniform float uThrottle, uDensity;
void main() {
  float age = fract(uTime * .45 + aSeed.x);
  float a = aSeed.y * 6.2832;
  // Particles are flung down the plume and spread as they age, slowing as the jet loses speed.
  float drop = (1. - pow(1. - age, 2.2)) * (5. + 7. * uThrottle) + age * 2.;
  float spread = (.35 + sqrt(aSeed.z) * .5) + age * (1.2 + 3.2 * aSeed.w);
  vec3 pos = vec3(cos(a) * spread, -drop, sin(a) * spread);
  pos.x += (vnoise(vec3(aSeed.xy * 9., uTime * .4)) - .5) * age * 2.;
  vec4 mv = modelViewMatrix * vec4(pos, 1.);
  gl_Position = projectionMatrix * mv;
  float worldSize = .4 + age * (1.8 + 2.4 * aSeed.w);
  gl_PointSize = pointPixels(worldSize, mv);
  float hot = 1. - smoothstep(0., .3, age);
  vec3 smoke = vec3(.62, .6, .58) * (.75 + .25 * aSeed.z);
  vec3 col = mix(smoke, vec3(4.2, 2.2, .85), hot);
  float alpha = smoothstep(0., .06, age) * pow(1. - age, 1.4) * mix(.3, .2, hot);
  vColor = vec4(col, alpha * uDensity * uThrottle);
  vSeed = aSeed.w;
  #include <logdepthbuf_vertex>
}`,
    fragment: /* glsl */ `
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vColor.rgb, vColor.a * spriteShape());
}`,
  });
  group.userData.set = ({ throttle = 1, airDensity = 1 } = {}) => {
    uniforms.uThrottle.value = THREE.MathUtils.clamp(throttle, 0, 1);
    uniforms.uDensity.value = THREE.MathUtils.clamp(airDensity, 0, 1);
    group.visible = uniforms.uThrottle.value > 0 && uniforms.uDensity.value > 0;
  };
  group.userData.set();
  return group;
}

/** Mars dust thrown sideways by the engine, on the ground under it. set({ intensity }). */
export function createLandingDust() {
  const uniforms = { uIntensity: { value: 1 }, uColor: { value: new THREE.Color().setRGB(0.62, 0.4, 0.26) } };
  const group = createParticles('vfx:landingDust', {
    count: countFor(700, 250),
    extraUniforms: uniforms,
    vertex: /* glsl */ `
uniform float uIntensity;
uniform vec3 uColor;
void main() {
  float age = fract(uTime * .15 + aSeed.x);
  float a = aSeed.y * 6.2832;
  // A sheet racing out along the ground: fast at first, then coasting.
  float reach = (1. - pow(1. - age, 2.4)) * (14. + 26. * aSeed.z) * uIntensity;
  float size = (2.5 + 4.5 * aSeed.w) * (.7 + .3 * age) * (.4 + .6 * uIntensity);
  // Resting on the ground, so the sprite doesn't slice through the terrain: under 1.5 m high at the centre, about 5 m at the rim.
  float y = size * .4 + age * 2.5 * uIntensity;
  vec3 pos = vec3(cos(a) * (reach + .8), y, sin(a) * (reach + .8));
  vec4 mv = modelViewMatrix * vec4(pos, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = pointPixels(size, mv);
  // Fades near the camera so a close sprite never shows as a ball.
  float alpha = smoothstep(0., .06, age) * pow(1. - age, .6) * .34 * uIntensity * smoothstep(3., 10., -mv.z);
  vColor = vec4(uColor * (.85 + .3 * aSeed.z), alpha);
  vSeed = aSeed.w;
  #include <logdepthbuf_vertex>
}`,
    fragment: /* glsl */ `
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vColor.rgb, vColor.a * spriteShape());
}`,
  });
  group.userData.set = ({ intensity = 1 } = {}) => {
    uniforms.uIntensity.value = THREE.MathUtils.clamp(intensity, 0, 1);
    group.visible = uniforms.uIntensity.value > 0;
  };
  group.userData.set();
  return group;
}

const PLASMA_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
uniform float uTime, uIntensity;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  // Flow travels bottom to top and slightly outward, as many fine filaments: fbm in stretched, domain-warped coordinates.
  vec2 p = vUv * vec2(2.5, 1.3);
  float t = uTime;
  p.x += (p.x - 1.25) * p.y * .25;
  vec2 warp = vec2(fbm(vec3(p * vec2(1.6, .7) + vec2(0., -t * 1.2), t * .3), 3), fbm(vec3(p * vec2(1.6, .7) + vec2(7., -t * 1.6), t * .3), 3)) - .5;
  float body = fbm(vec3(p.x * 11. + warp.x * 4., p.y * 1.5 - t * 3.6 + warp.y * 2., t * .5), 4);
  float fine = vnoise(vec3(p.x * 34. + warp.x * 6., p.y * 3. - t * 7., t));
  float f = body * .78 + fine * .22;
  float v = smoothstep(mix(.65, .1, uIntensity), mix(.9, .38, uIntensity), f);
  // Kept low on purpose: tone mapping and bloom bleach anything brighter than this to cream.
  // White-yellow appears only in a small hot zone at the lower centre.
  vec3 col = mix(vec3(.85, .06, .012), vec3(2., .5, .06), smoothstep(.25, .7, f));
  vec2 h = (vUv - vec2(.5, .05)) * vec2(2.5, 1.3);
  float hot = exp(-dot(h * vec2(1.3, 2.2), h * vec2(1.3, 2.2)) * 3.) * uIntensity;
  col = mix(col, vec3(4.2, 2.6, 1.), clamp(hot * f * 1.8, 0., 1.));
  vec2 e = min(vUv, 1. - vUv);
  float border = smoothstep(0., .12, min(e.x, e.y));
  float alpha = v * mix(.3, .95, uIntensity) * border;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

/** Re-entry plasma outside the cockpit window, in cockpit coordinates. set({ intensity }). */
export function createEntryPlasma() {
  const group = new THREE.Group();
  group.name = 'vfx:entryPlasma';
  const uniforms = { uTime: sharedUniforms.uTime, uIntensity: { value: 0.9 } };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: PLASMA_FRAGMENT,
    uniforms,
    transparent: true,
    // Premultiplied "over", so dense plasma hides the bright planet behind it instead of only adding to it.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
  }));
  plane.position.set(0, 0.3, -1.42);
  plane.renderOrder = 3;
  // The glow reaches the dash and the pilot's face, but instruments are unlit screens and stay readable.
  const light = new THREE.PointLight(0xff6a1f, 0, 4.5, 2);
  light.position.set(0, 0.3, -1.0);
  group.add(plane, light);

  group.userData.set = ({ intensity = 1 } = {}) => {
    uniforms.uIntensity.value = THREE.MathUtils.clamp(intensity, 0, 1);
    plane.visible = uniforms.uIntensity.value > 0; // the light stays in the scene so lit materials never recompile
  };
  group.userData.onFrame = () => {
    const t = sharedUniforms.uTime.value;
    const flicker = 0.8 + 0.2 * Math.sin(t * 31) * Math.sin(t * 17.3) + 0.12 * Math.sin(t * 7.1);
    light.intensity = uniforms.uIntensity.value * 4 * flicker;
  };
  group.userData.set();
  return group;
}
