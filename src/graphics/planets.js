import * as THREE from 'three';
import { bakeTexture, getRenderer, GLSL_NOISE, qualitySettings, sharedUniforms, skyState } from './shared.js';

const EARTH_COLOR = /* glsl */ `
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec3 d = dirFromUv(vUv);
  vec3 w = vec3(fbm(d * 1.7 + 3.1, 5), fbm(d * 1.7 + 7.7, 5), fbm(d * 1.7 + 11.3, 5)) - .5;
  float c = fbm(d * 2.1 + w * 1.5 + vec3(4.2, 1.3, 9.1), 9);
  float sea = .53;
  float land = smoothstep(sea, sea + .003, c);
  float h = clamp((c - sea) / .2, 0., 1.);
  float lat = abs(d.y);
  float m = fbm(d * 5. + w * .9 + 20., 6);
  float arid = smoothstep(.12, .3, lat) * (1. - smoothstep(.38, .56, lat));
  vec3 lc = mix(vec3(.028, .075, .024), vec3(.095, .125, .04), smoothstep(.4, .6, m));
  lc = mix(lc, vec3(.44, .30, .15), smoothstep(.4, .68, arid + (.5 - m) * 1.3));
  lc = mix(lc, vec3(.2, .2, .15), smoothstep(.62, .78, lat + (m - .5) * .2));
  lc = mix(lc, vec3(.2, .16, .12), smoothstep(.45, .85, h));
  lc = mix(lc, vec3(.8, .83, .87), smoothstep(.82, .97, h + lat * .18));
  float ice = smoothstep(.87, .93, lat + (fbm(d * 9., 4) - .5) * .14);
  float depth = clamp((sea - c) / .11, 0., 1.);
  vec3 ocean = mix(vec3(.012, .085, .15), vec3(.003, .016, .055), pow(depth, .55));
  vec3 col = mix(mix(ocean, lc, land), vec3(.85, .88, .92), ice);
  gl_FragColor = vec4(col, max(land * (.06 + .94 * h), ice * .1)); // alpha 0 marks open ocean
}`;

const EARTH_CLOUDS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor;
${GLSL_NOISE}
void main() {
  vec3 d = dirFromUv(vUv);
  vec3 w = vec3(fbm(d * 2. + 1., 4), fbm(d * 2. + 5., 4), fbm(d * 2. + 9., 4)) - .5;
  float streak = fbm(d * vec3(3.2, 7.5, 3.2) + w * 2.6, 9);
  float clouds = smoothstep(.5, .72, streak + cos(d.y * 7.) * .025);
  float land = step(.001, texture2D(uColor, vUv).a);
  float clusters = smoothstep(.52, .7, fbm(d * 13. + 31., 5));
  float dots = pow(fbm(d * 150., 3), 6.) * 26.;
  float lat = abs(d.y);
  float city = land * clusters * dots * (1. - smoothstep(.62, .82, lat));
  gl_FragColor = vec4(clouds, city, 0., 1.);
}`;

const MARS_COLOR = /* glsl */ `
varying vec2 vUv;
${GLSL_NOISE}
float craters(vec3 d, float scale) {
  vec3 p = d * scale, i = floor(p), f = fract(p);
  float h = 0.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(x, y, z);
    if (hash13(i + g + 9.) < .55) continue;
    float r = .12 + .3 * hash13(i + g + 5.);
    float q = length(g + hash33(i + g) - f) / r;
    if (q < 1.7) h += -(1. - smoothstep(0., 1., q)) * .9 + exp(-pow((q - 1.) * 5., 2.)) * .35;
  }
  return h;
}
void main() {
  vec3 d = dirFromUv(vUv);
  vec3 w = vec3(fbm(d * 1.9 + 2.1, 5), fbm(d * 1.9 + 6.3, 5), fbm(d * 1.9 + 9.7, 5)) - .5;
  float large = fbm(d * 2.3 + w * 1.4, 8);
  float crater = craters(d, 13.) * .085 + craters(d, 34.) * .05 + craters(d, 88.) * .022;
  float dark = smoothstep(.44, .6, fbm(d * 2.6 + w * 1.3 + 17., 7));
  float fine = fbm(d * 26., 5);
  vec3 col = mix(vec3(.60, .30, .135), vec3(.72, .42, .22), smoothstep(.4, .62, large));
  col = mix(col, vec3(.15, .10, .08), dark * .78);
  col *= .84 + .32 * fine + crater * .6;
  float cap = smoothstep(.93, .975, abs(d.y) + (fbm(d * 8., 4) - .5) * .05);
  col = mix(col, vec3(.86, .82, .78), cap);
  gl_FragColor = vec4(col, clamp(large * .6 + crater + fine * .08, 0., 1.));
}`;

// Real maps. These compose the same two textures the procedural bake makes, so the surface shader doesn't care which it got.
const EARTH_COMPOSE_COLOR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uDay;
void main() {
  vec3 c = texture2D(uDay, vUv).rgb;
  float lum = dot(c, vec3(.2126, .7152, .0722));
  // Open water: blue clearly ahead of red, no brighter than green, and dark. Ice and cloud-white fail on the first test.
  bool water = c.b > c.r * 1.5 + .0015 && c.b > c.g * .95 && lum < .3;
  gl_FragColor = vec4(c * (water ? .8 : .9), water ? 0. : .06 + .2 * lum); // alpha 0 marks open ocean
}`;

const EARTH_COMPOSE_CLOUDS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uClouds;
uniform sampler2D uNight;
uniform sampler2D uMap;
void main() {
  float c = texture2D(uClouds, vUv).r;
  float clouds = smoothstep(.06, .92, c);
  vec3 n = texture2D(uNight, vUv).rgb;
  float lights = smoothstep(.03, .8, dot(n, vec3(.2126, .7152, .0722))); // soft curve: the shader adds the fine structure
  lights *= step(.001, texture2D(uMap, vUv).a); // never over open water
  gl_FragColor = vec4(clouds, lights, 0., 1.);
}`;

const MARS_COMPOSE_COLOR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uMars;
${GLSL_NOISE}
void main() {
  vec3 c = texture2D(uMars, vUv).rgb * vec3(1., 1.2, 1.08); // the photo runs a little red: nudge it toward the ground hue
  float lum = dot(c, vec3(.2126, .7152, .0722));
  float fine = fbm(dirFromUv(vUv) * 60., 4) - .5;
  gl_FragColor = vec4(c, clamp(lum * 1.3 + fine * .08, 0., 1.)); // the photo has its own shading baked in, so relief stays gentle
}`;

const SURFACE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vQ;
varying vec3 vWorld;
varying vec3 vT;
varying vec3 vB;
varying vec3 vCenter;
varying float vRad;
void main() {
  vUv = uv;
  vCenter = modelMatrix[3].xyz;
  vRad = length(modelMatrix[0].xyz);
  float lon = uv.x * 6.2831853, lat = (uv.y - .5) * 3.14159265;
  vT = mat3(modelMatrix) * vec3(sin(lon), 0., cos(lon));
  vB = mat3(modelMatrix) * vec3(cos(lon) * sin(lat), cos(lat), -sin(lon) * sin(lat));
  vQ = mat3(modelMatrix) * position; // world-rotated, free of the huge translation, so derivatives stay precise
  vec4 world = modelMatrix * vec4(position, 1.);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

const SURFACE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uColor;
uniform sampler2D uClouds;
uniform float uIsEarth;
uniform float uBump;
uniform float uTime;
uniform vec3 uSunDir;
uniform float uTexel;
uniform float uClose;
uniform float uAlt;   // camera height above the surface, in planet radii
uniform float uHigh;  // 1 on High quality: more octaves, filtered taps, relief normals
varying vec2 vUv;
${GLSL_NOISE}
varying vec3 vQ;
varying vec3 vWorld;
varying vec3 vT;
varying vec3 vB;
varying vec3 vCenter;
varying float vRad;

// fbm that fades each octave out once it is smaller than a pixel, so detail never shimmers or aliases. fw: pixel footprint in noise cells.
float fbmA(vec3 p, float fw, int octaves) {
  float a = .5, s = 0., n = 0.;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * mix(.5, vnoise(p), 1. - smoothstep(.35, 1., fw));
    n += a;
    p = p * 2.02 + vec3(13.1, 7.3, 2.9);
    fw *= 2.02;
    a *= .5;
  }
  return s / n;
}
vec3 rotY(vec3 d, float a) {
  float c = cos(a), s = sin(a);
  return vec3(d.x * c + d.z * s, d.y, d.z * c - d.x * s);
}
// Slope from a blurred copy of the map, so the relief has no texel stair-steps.
vec3 bumped(vec3 N, vec3 T, vec3 B, float scale, float lod) {
  float e = max(uTexel * (1. + lod), max(fwidth(vUv.x), fwidth(vUv.y)));
  float c = max(cos((vUv.y - .5) * 3.14159265), .06);
  float dT = (textureLod(uColor, vUv + vec2(e, 0.), lod).a - textureLod(uColor, vUv - vec2(e, 0.), lod).a) / (2. * e * 6.2831853 * c);
  float dB = (textureLod(uColor, vUv + vec2(0., e), lod).a - textureLod(uColor, vUv - vec2(0., e), lod).a) / (2. * e * 3.14159265);
  return normalize(N - scale * (dT * T + dB * B));
}
// Relief from noise: height at the point and one step along each tangent, tilted into the normal. cells: noise frequency.
float reliefH(vec3 p, float pix, int oct) {
  return fbmA(p * 420., pix * 420., oct) + .12 * fbmA(p * 3300. + 1.7, pix * 3300., 3);
}
vec3 noiseRelief(vec3 N, vec3 T, vec3 B, float pix, float amp, int oct) {
  float e = .4 / 3300.; // a step well under the smallest feature, or the difference ghosts the noise into streaks
  float h0 = reliefH(N, pix, oct);
  float hT = reliefH(N + T * e, pix, oct);
  float hB = reliefH(N + B * e, pix, oct);
  vec3 tilt = amp * ((hT - h0) * T + (hB - h0) * B) / (e * 420.);
  return normalize(N - tilt * min(1., .35 / max(length(tilt), 1e-4))); // never tipped past about 20 degrees
}

// ---- Earth land: fields, forest, scrub and rock from the base colour ----
vec3 landDetail(vec3 c, vec3 N, float pix, float D, int oct) {
  float broad = fbmA(N * 90., pix * 90., oct);
  float mid = fbmA(N * 700. + 3.7, pix * 700., oct);
  float fine = fbmA(N * 4200. + 9.1, pix * 4200., 3);
  float lum = dot(c, vec3(.2126, .7152, .0722));
  float snow = smoothstep(.22, .45, lum);
  float green = smoothstep(.0, .025, c.g - c.r * .95);
  float patchv = smoothstep(.42, .58, mid + (broad - .5) * .5);
  float grain = .78 + .5 * fine;
  vec3 gcol = mix(c * vec3(.62, .78, .5), c * vec3(1.5, 1.4, .8), patchv) * grain;
  vec3 dcol = mix(c * vec3(.72, .68, .6), c * vec3(1.3, 1.22, 1.08), patchv) * (.82 + .4 * fine);
  vec3 res = mix(dcol, gcol, green);
  res = mix(res, c * (.88 + .24 * fine), snow);
  return mix(c, res, D);
}

// ---- Night lights: clusters of points and streets, never texel tiles ----
float dotLayer(vec3 p, float fw, float density) {
  vec3 i = floor(p), f = fract(p);
  vec3 o = .3 + .4 * hash33(i);
  float d = length(f - o);
  float on = step(hash13(i + 3.1), density) * (.45 + .55 * hash13(i + 9.2));
  return mix(on * smoothstep(.32, .06, d), density * .07, smoothstep(.4, 1., fw));
}
float cityLights(vec3 N, float pix, float field) {
  float cluster = mix(.3, 1., fbmA(N * 900. + 7., pix * 900., 3));
  float f = field * cluster;
  float l = f * .1;
  l += dotLayer(N * 800., pix * 800., f * 1.2) * .95;
  l += dotLayer(N * 2600., pix * 2600., f * 1.15) * .9;
  l += dotLayer(N * 9500., pix * 9500., f) * .75 * (1. - smoothstep(.5, 1., pix * 9500.));
  float street = 1. - abs(2. * vnoise(N * 1500. + 4.) - 1.);
  l += smoothstep(.9, 1., street) * f * f * .55 * (1. - smoothstep(.4, 1., pix * 1500.));
  return l;
}

// ---- Clouds: the map gives where, noise gives the billows ----
// Returns the cover; shade goes 0..1 from the dark underside to the lit top.
float cloudDensity(vec3 Nd, float c, float pix, int oct) {
  float n = fbmA(Nd * 130., pix * 130., oct);
  float m = fbmA(Nd * 800. + 5.3, pix * 800., oct);
  return c + (n - .5) * .85 + (m - .5) * .45;
}
float cloudAt(vec3 Nd, vec2 uvc, float pix, float D, int oct, vec3 toSun, out float shade) {
  shade = .75;
  if (D < .001) return texture2D(uClouds, uvc).r;
  float c = textureLod(uClouds, uvc, 1.).r;
  float dd = cloudDensity(Nd, c, pix, oct);
  // Lit where the cloud rises away from the Sun: compare with a point a little toward it.
  if (oct > 3) shade = clamp(.75 + (dd - cloudDensity(normalize(Nd + toSun * .0006), c, pix, 3)) * 5., .4, 1.1);
  return mix(c, smoothstep(.34, .62, dd), D);
}

void main() {
  // The mesh is a coarse polyhedron: up close its normal-from-position drifts by tens of metres, which smears fine noise into streaks.
  // So find the exact point where the pixel's ray meets the true sphere.
  vec3 N = normalize(vQ);
  {
    vec3 ro = (cameraPosition - vCenter) / vRad, rd = normalize(vWorld - cameraPosition);
    float b = dot(ro, rd), h = b * b - (dot(ro, ro) - 1.);
    if (h > 0.) N = normalize(ro + rd * (-b - sqrt(h)));
  }
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uSunDir;
  vec3 sun = vec3(1., .97, .92) * 1.75;
  vec3 T = normalize(vT), B = normalize(vB);
  vec3 fwN = fwidth(N);
  float pix = max(fwN.x, max(fwN.y, fwN.z));
  int oct = uHigh > .5 ? 5 : 3;
  float ndl = dot(N, L);
  vec3 col;

  if (uIsEarth > .5) {
    float D = 1. - smoothstep(.03, .1, uAlt); // procedural detail takes over below about 60 km
    // Land and sea from a blurred copy of the map: smooth coast, no texel zigzag.
    vec2 e = vec2(uTexel * 1.4, 0.);
    vec4 t0 = texture2D(uColor, vUv);
    float aB = t0.a;
    vec3 landCol = t0.rgb, seaCol = t0.rgb;
    float field = textureLod(uClouds, vUv, 0.).g;
    if (uHigh > .5) {
      vec4 t1 = texture2D(uColor, vUv + e.xy), t2 = texture2D(uColor, vUv - e.xy);
      vec4 t3 = texture2D(uColor, vUv + e.yx), t4 = texture2D(uColor, vUv - e.yx);
      aB = (t0.a * 2. + t1.a + t2.a + t3.a + t4.a) / 6.;
      float wsum = t0.a * 2. + t1.a + t2.a + t3.a + t4.a;
      landCol = wsum > .0005 ? (t0.rgb * t0.a * 2. + t1.rgb * t1.a + t2.rgb * t2.a + t3.rgb * t3.a + t4.rgb * t4.a) / wsum : t0.rgb;
      vec4 w = 1. - smoothstep(0., .03, vec4(t1.a, t2.a, t3.a, t4.a));
      float w0 = 1. - smoothstep(0., .03, t0.a);
      float ws = w0 * 2. + w.x + w.y + w.z + w.w;
      seaCol = ws > .001 ? (t0.rgb * w0 * 2. + t1.rgb * w.x + t2.rgb * w.y + t3.rgb * w.z + t4.rgb * w.w) / ws : t0.rgb;
      field = (field * 2. + textureLod(uClouds, vUv + e.xy, 0.).g + textureLod(uClouds, vUv - e.xy, 0.).g
        + textureLod(uClouds, vUv + e.yx, 0.).g + textureLod(uClouds, vUv - e.yx, 0.).g) / 6.;
    }
    float coastNoise = D > .001 ? fbmA(N * 650. + 2., pix * 650., min(oct, 4)) - .5 : 0.;
    float landMask = smoothstep(.022, .04, aB + coastNoise * .06 * D);
    float landSoft = smoothstep(.008, .04, aB + coastNoise * .06 * D);

    // Albedo
    vec3 land = D > .001 ? landDetail(landCol, N, pix, D, oct) : landCol;
    vec3 sea = seaCol;
    if (D > .001) {
      float aW = textureLod(uColor, vUv, 4.).a;
      float shallow = smoothstep(.002, .04, aW);
      vec3 deep = vec3(.006, .04, .1) * (.8 + .5 * fbmA(N * 120., pix * 120., 3));
      vec3 shoal = vec3(.02, .13, .15) * (.7 + .6 * fbmA(N * 900., pix * 900., 3));
      sea = mix(sea, mix(deep, shoal, shallow), D * .85); // also hides the map's JPEG blocks
    }

    // Surface normals: noise relief on land when close, gentle map slope otherwise.
    vec3 Nb = bumped(N, T, B, uBump, 1.);
    if (D > .001 && uHigh > .5) {
      float broad = fbmA(N * 45., pix * 45., 3);
      float amp = D * (.05 + .2 * smoothstep(.45, .7, broad));
      Nb = noiseRelief(Nb, T, B, pix, amp, 4);
    }
    // Wave-tilted normal for the sea: breaks the sun glint into sparkle.
    vec3 Nw = N;
    if (D > .001) {
      vec3 p = N * 2600. + vec3(uTime * .05, 0., uTime * .03);
      float aa = 1. - smoothstep(.3, 1., pix * 2600.);
      Nw = normalize(N + (T * (vnoise(p) - .5) + B * (vnoise(p + 17.3) - .5)) * .2 * D * aa);
    }

    vec3 albedo = mix(sea, land, landMask);
    float lit = mix(max(ndl, 0.), max(dot(Nb, L), 0.), landMask);
    col = albedo * sun * lit;

    // Clouds
    float drift = uTime * .00022 * 6.2831853;
    vec3 Nd = rotY(N, drift);
    float shade;
    float clouds = cloudAt(Nd, vUv + vec2(uTime * .00022, 0.), pix, D, oct, normalize(rotY(L - N * ndl, drift)), shade);
    float shadowShade;
    float cloudShadow;
    if (D > .001) {
      vec3 Ns = normalize(Nd - (L - N * ndl) * .004);
      cloudShadow = cloudAt(Ns, vUv + vec2(uTime * .00022 + .0012, -.0008), pix, D, 3, Ns, shadowShade);
    } else {
      cloudShadow = texture2D(uClouds, vUv + vec2(uTime * .00022 + .0015, -.001)).r;
    }
    col *= 1. - mix(.55, .4, D) * cloudShadow;
    clouds *= mix(1., smoothstep(.003, .02, uAlt), D * .5); // a camera low in the cloud deck sees it thin out

    float seaLit = 1. - landMask;
    vec3 H = normalize(L + V);
    float nh = max(dot(Nw, H), 0.);
    float glint = (pow(nh, 1100.) + pow(nh, 90.) * .012) * seaLit * (1. - clouds);
    float fresnel = pow(1. - max(dot(N, V), 0.), 5.);
    col += vec3(1., .88, .72) * glint * 3. * step(0., ndl);
    col += vec3(.16, .3, .5) * fresnel * seaLit * .5 * max(ndl, 0.);
    float topShade = mix(1., shade * 1.2, D);
    vec3 cloudCol = vec3(.72, .74, .77) * topShade * sun * (max(ndl, 0.) * .94 + .008);
    col = mix(col, cloudCol, clouds * .9);

    float night = 1. - smoothstep(-.1, .1, ndl);
    if (night > .001 && field > .002) {
      float lights = cityLights(N, pix, field * landSoft) * 2.5;
      col += vec3(1., .68, .34) * min(lights, 1.3) * night * (1. - clouds * .85) * .95;
    }
  } else {
    // Mars: the photo gives the colours; dust patches and relief fill in below it as you descend.
    float D = 1. - smoothstep(.03, .4, uAlt);
    vec4 base = texture2D(uColor, vUv);
    if (uHigh > .5) {
      vec2 e = vec2(uTexel * 1.2, 0.);
      base = (base * 2. + texture2D(uColor, vUv + e.xy) + texture2D(uColor, vUv - e.xy) + texture2D(uColor, vUv + e.yx) + texture2D(uColor, vUv - e.yx)) / 6.;
    }
    vec3 Nb = bumped(N, T, B, uBump, .4);
    if (D > .001) {
      float g = fbmA(N * 260., pix * 260., oct) * .55 + fbmA(N * 2400. + 4., pix * 2400., 3) * .3 + fbmA(N * 9000., pix * 9000., 2) * .15;
      float dust = fbmA(N * 40. + 8., pix * 40., 3);
      base.rgb *= 1. + D * ((g - .5) * .6);
      base.rgb = mix(base.rgb, base.rgb * vec3(1.18, 1.0, .82), D * smoothstep(.45, .65, dust) * .6);
      if (uHigh > .5) Nb = noiseRelief(Nb, T, B, pix, D * .12, 4);
    }
    col = base.rgb * sun * max(dot(Nb, L), 0.);
  }
  gl_FragColor = vec4(col, 1.);
  #include <logdepthbuf_fragment>
}`;

const ATMOSPHERE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  #include <logdepthbuf_vertex>
}`;

// Single scattering through an exponential shell, in units of the planet's radius.
// The same shader gives the halo seen from orbit and the sky seen from inside the air.
const ATMOSPHERE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCamObj;
uniform vec3 uSunDir;
uniform vec3 uBeta;
uniform float uTop;
uniform float uFalloff;
uniform float uSunPower;
varying vec3 vObj;
vec2 hitSphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
void main() {
  vec3 ro = uCamObj, rd = normalize(vObj - ro);
  vec2 shell = hitSphere(ro, rd, uTop);
  float t0 = max(shell.x, 0.), t1 = shell.y;
  vec2 ground = hitSphere(ro, rd, 1.);
  if (ground.x > 0.) t1 = min(t1, ground.x);
  if (t1 <= t0) discard;
  const int STEPS = 10;
  float seg = (t1 - t0) / float(STEPS), viewDepth = 0.;
  float column = (uTop - 1.) / uFalloff;
  vec3 light = vec3(0.);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (t0 + seg * (float(i) + .5));
    float r = length(p);
    float density = exp(-clamp((r - 1.) / (uTop - 1.), 0., 1.) * uFalloff);
    float mu = dot(p / r, uSunDir);
    float sunDepth = density * column / max(mu + .14, .035);
    viewDepth += density * seg * .5;
    light += density * seg * smoothstep(-.13, .07, mu) * exp(-uBeta * (viewDepth + sunDepth));
    viewDepth += density * seg * .5;
  }
  float c = dot(rd, uSunDir);
  vec3 col = light * uBeta * .75 * (1. + c * c) * uSunPower;
  vec3 through = exp(-uBeta * viewDepth);
  float alpha = 1. - dot(through, vec3(.3333));
  // A bright sky hides the stars behind it. Over the ground, only real extinction may dim the surface.
  if (ground.x <= 0.) alpha = max(alpha, smoothstep(.004, .05, dot(col, vec3(.2126, .7152, .0722))));
  gl_FragColor = vec4(col, alpha);
  #include <logdepthbuf_fragment>
}`;

const SETTINGS = {
  earth: { top: 1.1, falloff: 7.5, beta: [3.3, 7.7, 18.9], sunPower: 1.15, bump: 0.006 },
  mars: { top: 1.2, falloff: 6.1, beta: [0.6, 0.41, 0.19], sunPower: 1.5, bump: 0.008 },
};

const baked = new Map(); // name -> { color, clouds }, shared by every instance
const loading = new Map(); // name -> Promise, so each planet loads once
const live = new Map(); // name -> Set of surface materials waiting on, or showing, those maps

function proceduralMaps(name) {
  const width = qualitySettings().planetTexture;
  const height = width / 2;
  if (name === 'earth') {
    const color = bakeTexture({ width, height, fragment: EARTH_COLOR });
    const clouds = bakeTexture({ width, height, fragment: EARTH_CLOUDS, uniforms: { uColor: { value: color } } });
    return { color, clouds };
  }
  return { color: bakeTexture({ width, height, fragment: MARS_COLOR }), clouds: null };
}

function loadTexture(file, srgb) {
  const url = `${import.meta.env.BASE_URL}assets/textures/${file}_${qualitySettings().planetTexture / 1024}k.jpg`;
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter; // read 1:1 by the compose pass, so no mip chain needed
    t.generateMipmaps = false;
    return t;
  });
}

function composeMaps(name, src) {
  const width = qualitySettings().planetTexture;
  const height = width / 2;
  if (name === 'earth') {
    const color = bakeTexture({ width, height, fragment: EARTH_COMPOSE_COLOR, uniforms: { uDay: { value: src.day } } });
    const clouds = bakeTexture({
      width, height, fragment: EARTH_COMPOSE_CLOUDS, type: THREE.UnsignedByteType,
      uniforms: { uClouds: { value: src.clouds }, uNight: { value: src.night }, uMap: { value: color } },
    });
    return { color, clouds };
  }
  return { color: bakeTexture({ width, height, fragment: MARS_COMPOSE_COLOR, uniforms: { uMars: { value: src.mars } } }), clouds: null };
}

/** Resolves once the real maps of a planet are composed and every live instance uses them. Safe to call many times. */
export function loadPlanetMaps(name) {
  if (!SETTINGS[name]) return Promise.resolve();
  if (loading.has(name)) return loading.get(name);
  const files = name === 'earth'
    ? { day: ['earth_day', true], clouds: ['earth_clouds', false], night: ['earth_night', false] }
    : { mars: ['mars', true] };
  const promise = (async () => {
    const sources = {};
    let maps;
    try {
      await Promise.all(Object.entries(files).map(async ([key, [file, srgb]]) => { sources[key] = await loadTexture(file, srgb); }));
      const t0 = performance.now();
      maps = composeMaps(name, sources);
      getRenderer().getContext().finish();
      performance.measure(`planet:${name}:compose`, { start: t0, end: performance.now() });
    } catch (error) {
      console.warn(`[planets] real ${name} maps unavailable (${error?.message ?? 'an image failed to load'}), using generated ones`);
      maps = proceduralMaps(name);
    }
    Object.values(sources).forEach((t) => t.dispose());
    baked.set(name, maps);
    for (const material of live.get(name) ?? []) {
      material.uniforms.uColor.value = maps.color;
      material.uniforms.uClouds.value = maps.clouds ?? maps.color;
    }
  })();
  loading.set(name, promise);
  return promise;
}

// Flat stand-ins shown for the instant before the real maps arrive: deep ocean, or rust. Alpha is above 0 so no glint appears.
const placeholders = new Map();
function placeholderMaps(name) {
  if (!placeholders.has(name)) {
    const make = (r, g, b, a) => {
      const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
      t.needsUpdate = true;
      return t;
    };
    placeholders.set(name, { color: make(...(name === 'earth' ? [3, 14, 40, 30] : [140, 70, 35, 120])), clouds: make(0, 0, 0, 255) });
  }
  return placeholders.get(name);
}

/**
 * A planet of radius 1. Scale the group to the radius you need, for example
 * planet.scale.setScalar(PLANETS.earth.radius). Don't rotate the group itself: spin planet.userData.surface.
 */
export function createPlanet(name) {
  const cfg = SETTINGS[name];
  const maps = baked.get(name) ?? placeholderMaps(name);
  loadPlanetMaps(name);
  const group = new THREE.Group();
  group.name = `planet:${name}`;

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 96),
    new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      uniforms: {
        uClose: { value: 0 },
        uAlt: { value: 10 },
        uHigh: { value: qualitySettings().planetTexture > 2048 ? 1 : 0 },
        uColor: { value: maps.color },
        uClouds: { value: maps.clouds ?? maps.color },
        uIsEarth: { value: name === 'earth' ? 1 : 0 },
        uBump: { value: cfg.bump },
        uTexel: { value: 1 / qualitySettings().planetTexture },
        uTime: sharedUniforms.uTime,
        uSunDir: sharedUniforms.uSunDir,
      },
    }),
  );
  group.add(surface);
  if (!live.has(name)) live.set(name, new Set());
  live.get(name).add(surface.material);

  const shellMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    uniforms: {
      uCamObj: { value: new THREE.Vector3() },
      uSunDir: sharedUniforms.uSunDir,
      uBeta: { value: new THREE.Vector3(...cfg.beta) },
      uTop: { value: cfg.top },
      uFalloff: { value: cfg.falloff },
      uSunPower: { value: cfg.sunPower },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(cfg.top, 128, 64), shellMaterial);
  shell.renderOrder = 1;
  group.add(shell);

  const cam = new THREE.Vector3();
  group.userData.surface = surface;
  group.userData.onFrame = (_dt, camera) => {
    camera.getWorldPosition(cam);
    group.worldToLocal(cam);
    shellMaterial.uniforms.uCamObj.value.copy(cam);
    surface.material.uniforms.uAlt.value = cam.length() - 1;
    surface.material.uniforms.uClose.value = 1 - THREE.MathUtils.smoothstep(cam.length() - 1, 0.04, 0.2);
    if (name === 'earth') {
      // How bright the sky is at the camera: stars (sky.js) fade out in daylight under thick air and return in space or at night.
      const alt = cam.length() - 1;
      const sunUp = THREE.MathUtils.smoothstep(cam.clone().normalize().dot(sharedUniforms.uSunDir.value), -0.12, 0.15);
      skyState.daylight = sunUp * THREE.MathUtils.smoothstep(Math.exp(-alt * 75), 0.01, 0.12);
      skyState.stamp = sharedUniforms.uTime.value;
    }
    shellMaterial.side = cam.length() < cfg.top ? THREE.BackSide : THREE.FrontSide;
  };
  return group;
}
