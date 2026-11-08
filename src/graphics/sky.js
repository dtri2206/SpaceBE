import * as THREE from 'three';
import { bakeTexture, GLSL_NOISE, qualitySettings, sharedUniforms, skyState } from './shared.js';

const DOME_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vUv = uv;
  vDir = position;
  // Rotation only: the dome stays at infinity wherever the camera goes.
  gl_Position = (projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.)).xyww;
}`;

const MILKY_WAY = /* glsl */ `
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec3 d = dirFromUv(vUv);
  vec3 pole = normalize(vec3(.35, .86, -.37));
  vec3 center = normalize(cross(pole, vec3(0., 0., 1.)));
  float b = dot(d, pole);
  float band = exp(-b * b * 46.);
  float core = exp(-pow(length(d - center) * 1.25, 2.));
  vec3 w = vec3(fbm(d * 3. + 1.3, 4), fbm(d * 3. + 4.7, 4), fbm(d * 3. + 8.1, 4)) - .5;
  float clouds = fbm(d * 4.2 + w * 1.6, 8);
  float lanes = smoothstep(.46, .66, fbm(d * 7.5 + w * 2.4 + 9., 8));
  vec3 col = vec3(.03, .036, .06) * band * clouds * 1.5;
  col += vec3(.2, .145, .1) * core * band * clouds * 1.6;
  col *= 1. - lanes * band * .82;
  col += vec3(.0045, .003, .007) * smoothstep(.54, .75, fbm(d * 2.4 + w + 31., 6)) * (1. - band);
  float cell = hash13(floor(d * 520.));
  col += vec3(.7, .78, 1.) * step(.9965, cell) * (hash13(floor(d * 520.) + 3.) * .16 + .02);
  gl_FragColor = vec4(col, 1.);
}`;

const SPACE_DOME = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform float uStarFade;
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = texture2D(uMap, vUv).rgb * uStarFade;
  float m = max(dot(d, uSunDir), 0.);
  col += vec3(1., .96, .88) * smoothstep(.99988, .99994, m) * 90.;
  col += vec3(1., .86, .66) * (pow(m, 700.) * 1.6 + pow(m, 60.) * .035);
  gl_FragColor = vec4(col, 1.);
}`;

const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = aSize * uScale;
  gl_Position = (projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.)).xyww;
}`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
uniform float uStarFade;
void main() {
  float q = 1. - length(gl_PointCoord - .5) * 2.;
  if (q <= 0.) discard;
  gl_FragColor = vec4(vColor * q * q * uStarFade, 1.);
}`;

// Stars and Milky Way dim in a bright sky. The Earth planet reports the daylight; a stale report (no Earth in view) counts as night.
const fadeUniform = { value: 1 };
const updateFade = () => {
  const fresh = sharedUniforms.uTime.value - skyState.stamp < 0.5;
  fadeUniform.value = 1 - (fresh ? skyState.daylight : 0) * 0.98;
};

function createStars(count) {
  let seed = 90210;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tint = [new THREE.Color(1, 0.72, 0.5), new THREE.Color(1, 0.9, 0.78), new THREE.Color(1, 1, 1), new THREE.Color(0.72, 0.84, 1)];
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
    const magnitude = Math.pow(rnd(), 9); // many faint stars, very few bright ones
    const c = tint[Math.floor(rnd() * tint.length)];
    const power = 0.32 + magnitude * 9;
    colors.set([c.r * power, c.g * power, c.b * power], i * 3);
    sizes[i] = 1.4 + magnitude * 3.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const stars = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { uScale: { value: Math.min(window.devicePixelRatio, qualitySettings().pixelRatio) }, uStarFade: fadeUniform },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -999;
  stars.onBeforeRender = updateFade;
  return stars;
}

let milkyWay = null;

/** Stars, Milky Way and the Sun, all at infinity. Set the Sun with graphics.setSunDirection(). */
export function createSpaceSky() {
  const size = qualitySettings().skyTexture;
  milkyWay ??= bakeTexture({ width: size, height: size / 2, fragment: MILKY_WAY });
  const group = new THREE.Group();
  group.name = 'sky:space';
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: DOME_VERTEX,
      fragmentShader: SPACE_DOME,
      uniforms: { uMap: { value: milkyWay }, uSunDir: sharedUniforms.uSunDir, uStarFade: fadeUniform },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.onBeforeRender = updateFade;
  group.add(dome, createStars(7000));
  return group;
}

const MARS_DOME = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uDusk;
varying vec3 vDir;
float disc(vec3 d, vec3 center, float radius) {
  return smoothstep(cos(radius * 1.25), cos(radius * .8), dot(d, center));
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.);
  vec3 col = mix(uHorizon, uZenith, pow(h, .5));
  float m = max(dot(d, uSunDir), 0.);
  // Fine dust scatters blue light forward, so the sky around a low Sun turns blue.
  col = mix(col, vec3(.32, .5, .86) * mix(.8, 1.2, uDusk), (pow(m, 70.) * .8 + pow(m, 14.) * .3) * mix(.2, 1., uDusk));
  col += vec3(1., .78, .55) * pow(m, 5.) * .1 * (1. - uDusk);
  // From Mars the Sun looks about two thirds as wide as it does from Earth.
  col += vec3(1., .97, .92) * disc(d, uSunDir, .0031) * 60.;
  float night = smoothstep(.45, 1., uDusk);
  col += vec3(.75, .85, 1.) * disc(d, normalize(vec3(-.42, .2, -.88)), .0017) * 9. * night; // Earth, the evening star
  col += vec3(.5, .43, .37) * disc(d, normalize(vec3(.2, .58, -.79)), .0048) * mix(.5, 1.1, night); // Phobos
  col += vec3(.5, .44, .38) * disc(d, normalize(vec3(-.6, .45, .66)), .0011) * mix(.5, 1.1, night); // Deimos
  gl_FragColor = vec4(col, 1.);
}`;

/** Mars sky at infinity. Call setSun(direction) to move the Sun and recolour the sky. */
export function createMarsSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uHorizon: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() },
    uDusk: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: DOME_VERTEX, fragmentShader: MARS_DOME, uniforms, side: THREE.BackSide, depthTest: false, depthWrite: false }),
  );
  dome.name = 'sky:mars';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  const dayHorizon = new THREE.Color().setRGB(0.86, 0.49, 0.29);
  const duskHorizon = new THREE.Color().setRGB(0.36, 0.22, 0.17);
  const dayZenith = new THREE.Color().setRGB(0.46, 0.24, 0.15);
  const duskZenith = new THREE.Color().setRGB(0.055, 0.045, 0.065);
  dome.userData.setSun = (direction) => {
    uniforms.uSunDir.value.copy(direction);
    const dusk = 1 - THREE.MathUtils.smoothstep(direction.y, -0.05, 0.42);
    uniforms.uDusk.value = dusk;
    uniforms.uHorizon.value.lerpColors(dayHorizon, duskHorizon, dusk);
    uniforms.uZenith.value.lerpColors(dayZenith, duskZenith, dusk);
    return { horizon: uniforms.uHorizon.value, dusk };
  };
  return dome;
}
