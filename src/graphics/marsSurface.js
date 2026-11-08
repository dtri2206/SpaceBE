import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeTexture, GLSL_NOISE, qualitySettings, sharedUniforms } from './shared.js';
import { CRATERS, channelDistance, craterRimAmount, duneAmount, getTerrainHeight } from './terrain.js';
import { createMarsSky } from './sky.js';
import { buildTier } from './groundTier.js';

const WALK_AREA = 900; // half-width, in metres, of the area where rocks are scattered (the ground itself is exact everywhere)
const HORIZON = 11000;

// Tileable ground detail: R fine grit, G pebbles, B blotches, A speckle.
const DETAIL = /* glsl */ `
varying vec2 vUv;
${GLSL_NOISE}
float cell(vec2 p, float period) { return hash13(vec3(mod(p, period), period)); }
float tile(vec2 x, float period) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3. - 2. * f);
  return mix(mix(cell(i, period), cell(i + vec2(1, 0), period), f.x), mix(cell(i + vec2(0, 1), period), cell(i + vec2(1, 1), period), f.x), f.y);
}
float tileFbm(vec2 uv, float period, int octaves) {
  float a = .5, s = 0., n = 0.;
  for (int i = 0; i < octaves; i++) { s += a * tile(uv * period, period); n += a; period *= 2.; a *= .5; }
  return s / n;
}
float pebbles(vec2 uv, float period) {
  vec2 p = uv * period, i = floor(p), f = fract(p);
  float best = 1.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    vec2 g = vec2(x, y);
    vec2 c = mod(i + g, period);
    vec2 o = vec2(hash13(vec3(c, 1.)), hash13(vec3(c, 2.)));
    best = min(best, length(g + o - f));
  }
  return 1. - smoothstep(0., .62, best);
}
void main() {
  gl_FragColor = vec4(
    tileFbm(vUv, 64., 5),
    pebbles(vUv, 48.) * .7 + pebbles(vUv, 120.) * .3,
    tileFbm(vUv, 6., 7),
    tile(vUv * 256., 256.));
}`;

let detailTexture = null;

export function regolithMaterial({ rock = 0, roughness = 0.96, terrain = false } = {}) {
  detailTexture ??= bakeTexture({ width: 1024, height: 1024, fragment: DETAIL, wrap: THREE.RepeatWrapping });
  const material = new THREE.MeshStandardMaterial({ roughness, metalness: 0, flatShading: rock > 0 });
  if (terrain) material.defines = { TERR: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTexture };
    shader.uniforms.uRock = { value: rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vUp;\n#ifdef TERR\nattribute vec3 aTerr;\nvarying vec3 vTerr;\n#endif')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        #ifdef TERR
          vTerr = aTerr;
        #endif
        vec4 wp_ = vec4(transformed, 1.);
        vec3 wn_ = objectNormal;
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
          wn_ = mat3(instanceMatrix) * wn_;
        #endif
        wp_ = modelMatrix * wp_;
        vWPos = wp_.xyz;
        vUp = normalize(mat3(modelMatrix) * wn_).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n#ifdef TERR\nvarying vec3 vTerr;\n#endif\nvarying vec3 vWPos;\nvarying float vUp;\nuniform sampler2D uDetail;\nuniform float uRock;\nvec4 dA_, dB_, dC_;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        dA_ = texture2D(uDetail, vWPos.xz / 7.);
        dB_ = texture2D(uDetail, vWPos.xz / 53. + .37);
        dC_ = texture2D(uDetail, vWPos.xz / 487. + .11);
        float macro_ = dC_.b * .55 + dB_.b * .45;
        vec3 alb_ = mix(vec3(.335, .165, .085), vec3(.50, .285, .155), smoothstep(.38, .62, macro_));
        alb_ = mix(alb_, vec3(.135, .09, .075), smoothstep(.52, .74, dB_.b * .5 + dA_.g * .5) * .42);
        alb_ *= .8 + .4 * dA_.r;
        float cliff_ = smoothstep(.09, .24, 1. - clamp(vUp, 0., 1.));
        // Beds of uneven thickness, read off the blotch noise along height.
        float strata_ = smoothstep(.36, .64, texture2D(uDetail, vec2(vWPos.y / 41. + dB_.b * .012, .37)).b);
        alb_ = mix(alb_, mix(vec3(.2, .125, .085), vec3(.31, .2, .135), strata_) * (.72 + .5 * dA_.b), cliff_);
        vec3 rockCol_ = mix(vec3(.12, .1, .09), vec3(.2, .145, .11), dA_.b) * (.75 + .5 * dA_.r);
        rockCol_ = mix(rockCol_, vec3(.46, .27, .15), smoothstep(.45, .95, vUp) * .55 * (.3 + dC_.b)); // dust settles on top
        #ifdef TERR
          // Banded cliffs: thin beds every few metres on steep faces (channel banks, mesa sides, crater walls).
          float band_ = .5 + .5 * sin(vWPos.y * 2.2 + dB_.b * 7. + dC_.b * 12.);
          band_ = smoothstep(.3, .7, band_ * .7 + strata_ * .3);
          vec3 cliffCol_ = mix(vec3(.17, .105, .075), vec3(.40, .26, .165), band_) * (.72 + .5 * dA_.b);
          alb_ = mix(alb_, cliffCol_, cliff_ * .75);
          // Reddish-tan dust settles in hollows and low flats; dune sand is a touch darker and warmer.
          float hollow_ = smoothstep(.1, .65, vTerr.x);
          float ridge_ = smoothstep(.1, .65, -vTerr.x);
          alb_ = mix(alb_, vec3(.60, .355, .215) * (.86 + .28 * dA_.r), hollow_ * .6 * (1. - cliff_));
          alb_ = mix(alb_, vec3(.42, .25, .15) * (.82 + .34 * dA_.r), vTerr.y * .55 * (1. - cliff_));
          // Dark basalt on crater rims, ridges and the steepest faces.
          float basalt_ = clamp(vTerr.z * .85 + ridge_ * .3 * smoothstep(.05, .2, 1. - vUp) + smoothstep(.22, .42, 1. - vUp) * .55, 0., .88);
          alb_ = mix(alb_, vec3(.085, .066, .058) * (.8 + .6 * dA_.b) + vec3(.03, .015, .008) * dA_.g, basalt_);
          // Far highlands (the crater rim): grey-brown banded rock above the plain.
          float hi_ = smoothstep(70., 330., vWPos.y);
          vec3 hiCol_ = mix(vec3(.16, .115, .095), vec3(.30, .20, .145), band_) * (.8 + .4 * dC_.b);
          alb_ = mix(alb_, hiCol_, hi_ * .8);
        #endif
        diffuseColor.rgb = mix(alb_, rockCol_, uRock);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        float hd_ = dA_.r * .028 + dA_.g * .045 + dB_.r * .055 * smoothstep(.42, .62, dC_.b) + dB_.b * .3 + dC_.b * 1.2;
        vec3 dpx_ = dFdx(-vViewPosition), dpy_ = dFdy(-vViewPosition);
        vec3 r1_ = cross(dpy_, normal), r2_ = cross(normal, dpx_);
        float det_ = dot(dpx_, r1_);
        normal = normalize(abs(det_) * normal - sign(det_) * (dFdx(hd_) * r1_ + dFdy(hd_) * r2_) * (1. - uRock * .65));`);
  };
  return material;
}

const marsCues = (x, z, hollow, out) => { out[0] = hollow; out[1] = duneAmount(x, z); out[2] = craterRimAmount(x, z); };

/**
 * The ground in three tiers: fine around the player, medium out to the delta, and a coarse ring to the horizon
 * that carries the crater-rim mountains. All three sample getTerrainHeight, so craters, the channel and dunes you
 * see are the ones you walk over.
 */
function createGround() {
  const { terrainShadows, terrainSegments } = qualitySettings();
  const terrainScale = 512 / terrainSegments; // 1 at high quality, 2 at low: cells twice as wide
  const group = new THREE.Group();
  const material = regolithMaterial({ terrain: true });

  const nearHalf = 200, midHalf = 1200;
  const nearCell = 1.25 * terrainScale, midCell = 5 * terrainScale;
  const near = new THREE.Mesh(buildTier({
    segments: Math.round(nearHalf * 2 / nearCell), cell: nearCell, skirt: 4, height: getTerrainHeight, extra: marsCues,
    coord: (t) => t * nearHalf,
  }), material);
  const mid = new THREE.Mesh(buildTier({
    segments: Math.round(midHalf * 2 / midCell), cell: midCell, hole: nearHalf, skirt: 12, height: getTerrainHeight, extra: marsCues,
    coord: (t) => t * midHalf,
  }), material);
  // Vertices bunch towards the centre; the ones under the medium tier drop out of sight.
  const farSegments = Math.round(240 / terrainScale);
  const far = new THREE.Mesh(buildTier({
    segments: farSegments, cell: 60, hole: midHalf, sink: 14, height: getTerrainHeight, extra: marsCues,
    coord: (t) => Math.sign(t) * Math.pow(Math.abs(t), 2.1) * HORIZON,
  }), material);
  near.receiveShadow = true;
  near.castShadow = terrainShadows;
  mid.receiveShadow = far.receiveShadow = true;
  for (const mesh of [near, mid, far]) mesh.frustumCulled = false;
  group.add(near, mid, far);
  return group;
}

function rockGeometry(seed, detail) {
  let geometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry, 1e-4);
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  const stretch = new THREE.Vector3(0.75 + (seed * 37 % 1) * 0.6, 0.55 + (seed * 53 % 1) * 0.35, 0.75 + (seed * 71 % 1) * 0.6);
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    // Ridged lumps give broken, angular faces instead of a smooth pebble.
    const lump = (Math.abs(Math.sin(p.x * 2.3 + seed * 9) + Math.cos(p.y * 2.9 + seed * 4)) - 0.7) * 0.3
      + Math.abs(Math.sin(p.z * 5.3 + seed * 2) * Math.sin(p.x * 4.1 + seed)) * 0.2
      + Math.sin(p.y * 9 + p.x * 7 + seed) * 0.015;
    p.multiplyScalar(1 + lump).multiply(stretch);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createRocks() {
  const total = qualitySettings().rocks;
  const group = new THREE.Group();
  const material = regolithMaterial({ rock: 1, roughness: 1 });
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Every rock is { x, z, size, ... }: first the scattered ones, then the boulder fields thrown out around fresh craters.
  const rocks = [];
  for (let i = 0; i < total; i++) {
    // Bias towards the camera's likely path, with a clear landing pad.
    const r = 24 + Math.pow(rnd(), 1.5) * (WALK_AREA - 40), a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (channelDistance(x, z) < 10 && rnd() < 0.6) continue; // the channel floor is sandier
    rocks.push({ x, z, size: 0.05 + Math.pow(rnd(), 11) * 3.2 + Math.pow(rnd(), 3) * 0.3, sink: 0.08 });
  }
  const lowQuality = total < 1000;
  for (const c of CRATERS) {
    if (!c.fresh || c.R < 6 || Math.hypot(c.x, c.z) > (lowQuality ? 450 : 800)) continue;
    const count = Math.round((4 + Math.min(c.R, 60) * 0.6) * (lowQuality ? 0.5 : 1));
    for (let k = 0; k < count; k++) {
      const a = rnd() * Math.PI * 2, t = 0.95 + Math.pow(rnd(), 1.8) * 1.5; // thickest on the rim, thinning with distance
      const x = c.x + Math.cos(a) * c.R * t, z = c.z + Math.sin(a) * c.R * t;
      const size = (0.25 + Math.pow(rnd(), 3) * Math.min(2.4, c.R * 0.05 + 0.6)) * (1.2 - 0.3 * (t - 0.95));
      rocks.push({ x, z, size, sink: 0.15 });
    }
  }
  // Big rocks get the smoother 320-triangle mesh; small ones are fine with 80.
  const variants = [{ seed: 0.17, detail: 2, pick: (s) => s > 0.7 }, { seed: 0.41, detail: 1, pick: (s, i) => s <= 0.7 && i % 2 === 0 }, { seed: 0.73, detail: 1, pick: (s, i) => s <= 0.7 && i % 2 === 1 }];
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (const variant of variants) {
    const mine = rocks.filter((rock, i) => variant.pick(rock.size, i));
    if (!mine.length) continue;
    const mesh = new THREE.InstancedMesh(rockGeometry(variant.seed, variant.detail), material, mine.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mine.forEach((rock, i) => {
      const { x, z, size } = rock;
      euler.set(rnd() * 0.5, rnd() * 6.28, rnd() * 0.5);
      q.setFromEuler(euler);
      matrix.compose(new THREE.Vector3(x, getTerrainHeight(x, z) + size * rock.sink, z), q, new THREE.Vector3(size * (0.7 + rnd() * 0.7), size * (0.45 + rnd() * 0.6), size * (0.7 + rnd() * 0.7)));
      mesh.setMatrixAt(i, matrix);
    });
    group.add(mesh);
  }
  return group;
}

const DUST_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
uniform float uTime;
uniform float uScale;
varying float vFade;
void main() {
  const vec3 box = vec3(70., 22., 70.);
  vec3 wind = vec3(1.1, .05, .5) * uTime;
  vec3 wave = vec3(sin(uTime * .3 + position.z), sin(uTime * .21 + position.x) * .5, cos(uTime * .26 + position.y));
  vec3 local = mod(position + wind + wave - cameraPosition + box * .5, box) - box * .5;
  vec4 mv = viewMatrix * vec4(local + cameraPosition, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, .4);
  vFade = smoothstep(35., 14., length(local)) * smoothstep(.4, 2.5, -mv.z);
  #include <logdepthbuf_vertex>
}`;

const DUST_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vFade;
void main() {
  float q = 1. - length(gl_PointCoord - .5) * 2.;
  if (q <= 0.) discard;
  gl_FragColor = vec4(uColor, q * q * vFade * .34);
  #include <logdepthbuf_fragment>
}`;

function createDust(count) {
  let seed = 777;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([rnd() * 70, rnd() * 22, rnd() * 70], i * 3);
    sizes[i] = 2 + rnd() * rnd() * 16;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const dust = new THREE.Points(geometry, new THREE.ShaderMaterial({
    vertexShader: DUST_VERTEX,
    fragmentShader: DUST_FRAGMENT,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uScale: { value: window.innerHeight / 900 * qualitySettings().pixelRatio },
      uColor: { value: new THREE.Color().setRGB(0.95, 0.66, 0.45) },
    },
    transparent: true,
    depthWrite: false,
  }));
  dust.frustumCulled = false;
  return dust;
}

/**
 * The whole Mars surface as a ready-to-render scene: sky, ground, rocks, dust, fog and light.
 * Returns { scene, sun, setSunElevation(degrees, azimuthDegrees) }.
 */
export function createMarsScene({ sunElevation = 14, sunAzimuth = 118 } = {}) {
  const settings = qualitySettings();
  const scene = new THREE.Scene();
  scene.name = 'mars-surface';
  scene.fog = new THREE.FogExp2(0xffffff, 0.00022);

  const sky = createMarsSky();
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(settings.shadowMap);
  const reach = 110;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: 900 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  scene.add(sky, hemi, sun, sun.target, createGround(), createRocks(), createDust(settings.dust));

  const direction = new THREE.Vector3();
  const lit = new THREE.Color();
  const setSunElevation = (elevation, azimuth = sunAzimuth) => {
    const e = THREE.MathUtils.degToRad(elevation), a = THREE.MathUtils.degToRad(azimuth);
    direction.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
    const { horizon, dusk } = sky.userData.setSun(direction);
    scene.fog.color.copy(horizon);
    // Thin air barely softens the Sun, so light stays strong until it reaches the horizon.
    const up = THREE.MathUtils.smoothstep(direction.y, -0.03, 0.14);
    sun.color.copy(lit.setRGB(1, 0.86 + 0.08 * up, 0.72 + 0.14 * up));
    sun.intensity = 3.5 * up;
    hemi.color.setRGB(0.92, 0.7, 0.53);
    hemi.groundColor.setRGB(0.4, 0.24, 0.15);
    hemi.intensity = THREE.MathUtils.lerp(0.95, 0.34, dusk);
  };
  setSunElevation(sunElevation);

  // The shadow box follows the camera in whole texels, so edges don't crawl as you walk.
  const texel = (reach * 2) / settings.shadowMap;
  const camPos = new THREE.Vector3();
  sky.userData.onFrame = (_dt, camera) => {
    camera.getWorldPosition(camPos);
    const x = Math.round(camPos.x / texel) * texel, z = Math.round(camPos.z / texel) * texel;
    const y = getTerrainHeight(x, z);
    sun.target.position.set(x, y, z);
    sun.position.copy(sun.target.position).addScaledVector(direction, 420);
  };

  return { scene, sun, setSunElevation };
}
