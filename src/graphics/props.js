import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, sharedUniforms } from './shared.js';
import { pbr } from './interiors.js';
import { regolithMaterial } from './marsSurface.js';

/**
 * Mission props that stand on the Mars surface. Each has its origin on the ground, +Y up, userData.height in metres and
 * userData.setState('idle' | 'active' | 'done'): amber, cyan and green light. Every function returns a new Object3D.
 */

const TWO_PI = Math.PI * 2;
const STATE_COLOURS = { idle: [2.9, 1.55, 0.15], active: [0.25, 2.3, 3.2], done: [0.45, 2.8, 0.65] };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hash3 = (i, j, k) => {
  const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(canvas, { colour = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ---------------------------------------------------------------- state lights */

// Collects the lamps and rings of one prop so setState and the blinking live in one place.
function createKit(group, height) {
  const lamps = [], rings = [];
  const tint = new THREE.Color(...STATE_COLOURS.idle);
  let state = 'idle';
  const kit = {
    tint,
    get state() { return state; },
    lamp(power = 1, blink = 0, phase = 0) {
      const material = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(power) });
      lamps.push({ material, power, blink, phase });
      return material;
    },
    ring(radius, { inner = 0.55, power = 0.5, y = 0.04, only = null } = {}) {
      const material = new THREE.MeshBasicMaterial({
        map: ringTexture(inner), color: tint.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.renderOrder = 2;
      rings.push({ material, mesh, power, only, phase: rings.length * 1.7 });
      return mesh;
    },
  };
  group.userData.height = height;
  group.userData.setState = (next) => {
    if (!STATE_COLOURS[next]) return;
    state = next;
    tint.setRGB(...STATE_COLOURS[next]);
    for (const r of rings) r.mesh.visible = !r.only || r.only === state;
    group.userData.onStateChange?.(state);
  };
  group.userData.state = () => state;
  group.userData.onFrame = () => {
    const t = sharedUniforms.uTime.value;
    for (const l of lamps) {
      let k = 1;
      if (l.blink) k = Math.sin(t * l.blink + l.phase) > 0.2 ? 1 : 0.1;
      else if (state === 'active') k = 0.8 + 0.2 * Math.sin(t * 5 + l.phase);
      l.material.color.copy(tint).multiplyScalar(l.power * k);
    }
    for (const r of rings) r.material.color.copy(tint).multiplyScalar(r.power * (state === 'active' ? 0.8 + 0.25 * Math.sin(t * 3 + r.phase) : 0.7));
  };
  group.userData.setState('idle');
  group.userData.onFrame();
  return kit;
}

const ringCache = new Map();
function ringTexture(inner) {
  if (ringCache.has(inner)) return ringCache.get(inner);
  const c0 = makeCanvas(256), c = c0.getContext('2d');
  const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.0)');
  g.addColorStop(inner - 0.2, 'rgba(255,255,255,0.0)');
  g.addColorStop(inner, 'rgba(255,255,255,0.55)');
  g.addColorStop(inner + 0.07, 'rgba(255,255,255,0.9)');
  g.addColorStop(inner + 0.15, 'rgba(255,255,255,0.28)');
  g.addColorStop(Math.min(inner + 0.4, 0.98), 'rgba(255,255,255,0.0)');
  g.addColorStop(1, 'rgba(255,255,255,0.0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  const t = canvasTexture(c0);
  ringCache.set(inner, t);
  return t;
}

const glowCache = {};
function glowTexture() {
  if (glowCache.t) return glowCache.t;
  const c0 = makeCanvas(128), c = c0.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  return (glowCache.t = canvasTexture(c0));
}

function halo(kit, size, power = 0.5, blink = 0, phase = 0) {
  const material = new THREE.SpriteMaterial({ map: glowTexture(), color: kit.tint.clone(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  sprite.userData.update = () => {
    const t = sharedUniforms.uTime.value;
    const k = blink ? (Math.sin(t * blink + phase) > 0.2 ? 1 : 0.05) : 1;
    material.color.copy(kit.tint).multiplyScalar(power * k);
  };
  return sprite;
}

// Wraps the group's onFrame so halos track the state.
function withHalos(group, halos) {
  const base = group.userData.onFrame;
  group.userData.onFrame = (...a) => { base(...a); halos.forEach((h) => h.userData.update()); };
  group.userData.onFrame();
}

function shadows(root, cast = true) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } });
  return root;
}

/* ---------------------------------------------------------------- shared materials */

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    white: pbr(0xcfcabf, 0.55, 0.15, { envMapIntensity: 0.35 }),
    paint: pbr(0xbcb6a8, 0.7, 0.1),
    dark: pbr(0x24272b, 0.6, 0.6),
    steel: pbr(0x8e949a, 0.4, 0.8),
    orange: pbr(0xd0661d, 0.55, 0.2),
    yellow: pbr(0xd7aa1c, 0.55, 0.15),
    rubber: pbr(0x1a1b1d, 0.9, 0),
    rock: regolithMaterial({ rock: 1, roughness: 1 }),
  };
  return shared;
}

// Rock-like lumps: an icosphere pushed around by ridged noise. Returns smooth-shaded geometry with its base at y = 0.
function lumpGeometry({ seed = 1, detail = 3, size = [1, 1, 1], plateau = 0.8, rough = 0.28 }) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.abs(noise3(v.x * 1.5 + seed, v.y * 1.5, v.z * 1.5) - 0.5) * 2;
    const m = noise3(v.x * 4 + seed * 3, v.y * 4, v.z * 4) - 0.5;
    v.multiplyScalar(1 + (0.5 - n) * rough * 1.6 + m * rough * 0.5);
    v.multiply(new THREE.Vector3(...size));
    v.y = Math.min(v.y, plateau * size[1]);
    if (v.y < -0.35 * size[1]) v.y = -0.35 * size[1] + (v.y + 0.35 * size[1]) * 0.15;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y - 0.02 * size[1], 0);
  g.computeBoundingBox();
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- scanPoint */

function createScanPoint() {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'scanPoint';
  const kit = createKit(g, 2.0);
  const hubY = 1.3;
  // Tripod: three tapered legs with feet, a hub and a braced cross ring.
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TWO_PI + 0.4, foot = new THREE.Vector3(Math.cos(a) * 0.78, 0.04, Math.sin(a) * 0.78), top = new THREE.Vector3(Math.cos(a) * 0.1, hubY, Math.sin(a) * 0.1);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, top.distanceTo(foot), 8), m.paint);
    leg.position.copy(top).lerp(foot, 0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.03, 10), m.dark);
    pad.position.set(foot.x, 0.015, foot.z);
    g.add(leg, pad);
    const next = new THREE.Vector3(Math.cos(a + TWO_PI / 3) * 0.55, 0.55, Math.sin(a + TWO_PI / 3) * 0.55);
    const mid = new THREE.Vector3(Math.cos(a) * 0.55, 0.55, Math.sin(a) * 0.55);
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, mid.distanceTo(next), 5), m.steel);
    brace.position.copy(mid).lerp(next, 0.5);
    brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), next.clone().sub(mid).normalize());
    g.add(brace);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.14, 12), m.dark);
  hub.position.y = hubY;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 8), m.steel);
  mast.position.y = hubY + 0.2;
  g.add(hub, mast);
  // Instrument head: body, camera lens, solar cell on top.
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.26, 0.3, 3, 0.04), m.white);
  body.position.y = hubY + 0.5;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.1, 14), m.dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0.0, hubY + 0.5, 0.2);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14), new THREE.MeshStandardMaterial({ color: 0x0a1a2e, roughness: 0.1, metalness: 0.9, envMap: m.white.envMap, envMapIntensity: 0.8 }));
  glass.position.set(0, hubY + 0.5, 0.252);
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.2), new THREE.MeshStandardMaterial({ color: 0x14275a, roughness: 0.3, metalness: 0.5 }));
  cell.position.y = hubY + 0.636;
  g.add(body, lens, glass, cell);
  // Small dish on an arm, tilted at the sky.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 6), m.steel);
  arm.position.set(0.3, hubY + 0.55, 0);
  arm.rotation.z = -0.5;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 8, 0, TWO_PI, 0, 0.9), new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }));
  dish.position.set(0.42, hubY + 0.76, 0);
  dish.rotation.set(0, 0, -0.6);
  dish.scale.y = 0.5;
  g.add(arm, dish);
  // Beacon: a lamp in a clear cap on a short whip, so the state reads from far off.
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.45, 5), m.steel);
  whip.position.set(-0.14, hubY + 0.84, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), kit.lamp(1.3, 0));
  lamp.position.set(-0.14, hubY + 1.09, 0);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 14), m.dark);
  collar.position.copy(lamp.position).setY(lamp.position.y - 0.06);
  collar.rotation.x = Math.PI / 2;
  g.add(whip, lamp, collar);
  const h = halo(kit, 0.75, 0.55, 0);
  h.position.copy(lamp.position);
  g.add(h);
  const ground = kit.ring(1.55, { inner: 0.5, power: 0.55 });
  const inner = kit.ring(0.75, { inner: 0.62, power: 0.3, y: 0.045 });
  g.add(ground, inner);
  shadows(g);
  withHalos(g, [h]);
  return g;
}

/* ---------------------------------------------------------------- sampleRock */

function createSampleRock() {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'sampleRock';
  const kit = createKit(g, 0.6);
  const main = new THREE.Mesh(lumpGeometry({ seed: 3.1, detail: 3, size: [0.5, 0.38, 0.4], plateau: 0.82, rough: 0.34 }), m.rock);
  main.rotation.y = 0.5;
  const side = new THREE.Mesh(lumpGeometry({ seed: 7.7, detail: 2, size: [0.27, 0.2, 0.22], plateau: 0.9, rough: 0.3 }), m.rock);
  side.position.set(0.55, 0, 0.14);
  side.rotation.y = 2;
  const back = new THREE.Mesh(lumpGeometry({ seed: 11.3, detail: 2, size: [0.22, 0.26, 0.2], plateau: 0.9, rough: 0.3 }), m.rock);
  back.position.set(-0.45, 0, -0.3);
  back.rotation.y = 1;
  g.add(main, side, back);
  const r = rng(5);
  for (let i = 0; i < 5; i++) {
    const s = 0.03 + r() * 0.05;
    const pebble = new THREE.Mesh(lumpGeometry({ seed: i * 5.1, detail: 1, size: [s * 1.3, s, s], plateau: 0.9, rough: 0.3 }), m.rock);
    const a = r() * TWO_PI;
    pebble.position.set(Math.cos(a) * (0.4 + r() * 0.3), 0, Math.sin(a) * (0.4 + r() * 0.3));
    g.add(pebble);
  }
  // The sampling mark: a fresh abraded patch, pale against the weathered rock, ringed with the state light.
  const top = main.geometry.boundingBox ?? (main.geometry.computeBoundingBox(), main.geometry.boundingBox);
  const topY = top.max.y;
  const c0 = makeCanvas(256), c = c0.getContext('2d');
  const grad = c.createRadialGradient(128, 128, 10, 128, 128, 124);
  grad.addColorStop(0, '#f1dfc6'); grad.addColorStop(0.7, '#d9bf9e'); grad.addColorStop(1, '#a98862');
  c.fillStyle = grad;
  c.beginPath(); c.arc(128, 128, 122, 0, TWO_PI); c.fill();
  const rr = rng(8);
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(${rr() < 0.5 ? '255,248,235' : '120,90,60'},${rr() * 0.25})`; c.fillRect(rr() * 256, rr() * 256, 2 + rr() * 5, 1 + rr() * 2); }
  c.strokeStyle = 'rgba(70,50,35,0.7)'; c.lineWidth = 6; c.beginPath(); c.arc(128, 128, 120, 0, TWO_PI); c.stroke();
  const patchMat = new THREE.MeshStandardMaterial({ map: canvasTexture(c0), roughness: 0.55, metalness: 0, emissive: 0x3a2a1c, transparent: true });
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.17, 28), patchMat);
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(0.0, topY + 0.004, 0.0);
  const lampRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.016, 6, 36), kit.lamp(1, 0));
  lampRing.rotation.x = Math.PI / 2;
  lampRing.position.set(0, topY + 0.01, 0);
  g.add(patch, lampRing);
  const gl = kit.ring(0.8, { inner: 0.5, power: 0.35 });
  g.add(gl);
  shadows(g);
  patch.castShadow = false;
  lampRing.castShadow = false;
  return g;
}

/* ---------------------------------------------------------------- discoveryRock */

let rockTextures = null;

// A red mudstone with white calcium-sulfate veins and pale "leopard spots" ringed in dark iron-rich rim. 1 px is about 1.2 mm.
function discoveryTextures() {
  if (rockTextures) return rockTextures;
  const S = 1024, r = rng(2021);
  const colour = makeCanvas(S), bump = makeCanvas(S);
  const c = colour.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = 'rgb(112,56,42)'; c.fillRect(0, 0, S, S);
  b.fillStyle = 'rgb(120,120,120)'; b.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) { // broad tonal patches
    const x = r() * S, y = r() * S, rad = 40 + r() * 170;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    const pal = [[128, 64, 48], [70, 36, 30], [112, 62, 50], [150, 98, 76], [58, 32, 30], [96, 78, 72]][Math.floor(r() * 6)];
    g.addColorStop(0, `rgba(${pal},0.34)`); g.addColorStop(1, `rgba(${pal},0)`);
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 22; i++) { // faint bedding, a little off horizontal
    const y = r() * S, tone = r() < 0.5 ? '255,200,170' : '30,10,6';
    c.strokeStyle = `rgba(${tone},${0.03 + r() * 0.05})`; c.lineWidth = 1 + r() * 3;
    c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 30, S * 0.6, y + (r() - 0.5) * 30, S, y + (r() - 0.5) * 40); c.stroke();
  }
  for (let i = 0; i < 90000; i++) {
    const a = r() * 0.28, w = 1 + Math.floor(r() * r() * 4);
    c.fillStyle = r() < 0.5 ? `rgba(230,170,140,${a})` : `rgba(18,6,4,${a})`;
    c.fillRect(r() * S, r() * S, w, w);
    b.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a * 1.5})` : `rgba(0,0,0,${a * 1.5})`;
    b.fillRect(r() * S, r() * S, w, w);
  }
  for (let i = 0; i < 700; i++) { // pits and chips
    const x = r() * S, y = r() * S, rad = 2 + r() * 7;
    c.fillStyle = `rgba(20,8,6,${0.15 + r() * 0.2})`; c.beginPath(); c.arc(x, y, rad, 0, TWO_PI); c.fill();
    b.fillStyle = 'rgba(40,40,40,0.8)'; b.beginPath(); b.arc(x, y, rad, 0, TWO_PI); b.fill();
  }

  // Veins: wandering lines of cream-white sulfate with a dark margin, thicker where they cross.
  const walk = (x, y, ang, length, width, depth) => {
    const pts = [[x, y]];
    for (let i = 0; i < length; i++) {
      ang += (r() - 0.5) * 0.35;
      x += Math.cos(ang) * 6; y += Math.sin(ang) * 6;
      pts.push([x, y]);
    }
    const stroke = (ctx, style, scale) => {
      ctx.strokeStyle = style; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const w = width * scale * (0.7 + 0.5 * noise3(i * 0.15, depth * 7, 3));
        ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(...pts[i - 1]); ctx.lineTo(...pts[i]); ctx.stroke();
      }
    };
    stroke(c, 'rgba(48,20,14,0.55)', 1.7);
    stroke(c, 'rgb(236,228,212)', 1);
    stroke(c, 'rgba(255,255,250,0.55)', 0.45);
    stroke(b, 'rgb(235,235,235)', 1.2);
    if (depth < 2) { // branches
      for (let i = 8; i < pts.length - 8; i += 10 + Math.floor(r() * 12)) {
        if (r() < 0.4) walk(pts[i][0], pts[i][1], ang + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.8), 10 + Math.floor(r() * 26), width * 0.42, depth + 1);
      }
    }
  };
  walk(250, 300, 0.35, 110, 16, 0);
  walk(300, 700, -0.3, 100, 12, 0);
  walk(560, 210, 1.2, 60, 11, 0);
  walk(900, 330, 2.1, 70, 10, 0);
  walk(780, 660, -0.8, 50, 9, 0);

  // Leopard spots: pale, greenish-white cores with a near-black rim, in loose clusters.
  const spotAt = (x, y, rad) => {
    const rim = c.createRadialGradient(x, y, rad * 0.35, x, y, rad * 1.15);
    rim.addColorStop(0, 'rgba(24,12,10,0)'); rim.addColorStop(0.45, 'rgba(26,14,12,0.92)'); rim.addColorStop(0.8, 'rgba(40,20,16,0.7)'); rim.addColorStop(1, 'rgba(40,20,16,0)');
    c.fillStyle = rim; c.beginPath(); c.arc(x, y, rad * 1.15, 0, TWO_PI); c.fill();
    const core = c.createRadialGradient(x, y, 0, x, y, rad * 0.72);
    core.addColorStop(0, 'rgb(232,226,204)'); core.addColorStop(0.7, 'rgb(212,206,182)'); core.addColorStop(1, 'rgb(170,158,134)');
    c.fillStyle = core; c.beginPath(); c.arc(x, y, rad * 0.72, 0, TWO_PI); c.fill();
    if (r() < 0.5) { c.fillStyle = 'rgba(30,18,14,0.8)'; c.beginPath(); c.arc(x + (r() - 0.5) * rad * 0.3, y + (r() - 0.5) * rad * 0.3, rad * 0.16, 0, TWO_PI); c.fill(); }
    b.fillStyle = 'rgb(70,70,70)'; b.beginPath(); b.arc(x, y, rad * 1.05, 0, TWO_PI); b.fill();
    b.fillStyle = 'rgb(150,150,150)'; b.beginPath(); b.arc(x, y, rad * 0.6, 0, TWO_PI); b.fill();
  };
  for (let k = 0; k < 14; k++) {
    const cx = 270 + r() * 700, cy = 240 + r() * 540, spread = 40 + r() * 90;
    for (let i = 0; i < 16; i++) spotAt(cx + (r() - 0.5) * spread * 2, cy + (r() - 0.5) * spread * 2, 6 + r() * r() * 18);
  }
  rockTextures = { map: canvasTexture(colour), bump: canvasTexture(bump, { colour: false }) };
  return rockTextures;
}

// Arrowhead outline in metres, tip towards +X: about 1.0 m long and 0.7 m across the barbs.
const ARROW = [[0.52, 0], [0.1, 0.27], [-0.28, 0.36], [-0.17, 0.08], [-0.2, 0], [-0.17, -0.08], [-0.28, -0.36], [0.1, -0.27]];

function arrowRadius(phi) {
  const dx = Math.cos(phi), dz = Math.sin(phi);
  let best = 0.3;
  for (let i = 0; i < ARROW.length; i++) {
    const [x1, z1] = ARROW[i], [x2, z2] = ARROW[(i + 1) % ARROW.length];
    const ex = x2 - x1, ez = z2 - z1, den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (x1 * ez - z1 * ex) / den, u = (x1 * dz - z1 * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = t;
  }
  return best;
}

function discoveryGeometry() {
  const g = new THREE.SphereGeometry(1, 64, 38);
  const p = g.attributes.position, uv = g.attributes.uv;
  const radius = (phi) => (arrowRadius(phi - 0.12) + arrowRadius(phi) * 2 + arrowRadius(phi + 0.12)) / 4; // soften the corners
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rho = Math.hypot(x, z), phi = Math.atan2(z, x);
    const R = radius(phi);
    let px = Math.cos(phi) * R * rho, pz = Math.sin(phi) * R * rho;
    let py = y > 0 ? 0.2 * Math.pow(y, 0.7) * (0.35 + 0.65 * Math.min(1, R / 0.3)) : y * 0.05;
    const n1 = noise3(px * 7, py * 7, pz * 7) - 0.5, n2 = noise3(px * 22, py * 22 + 4, pz * 22) - 0.5;
    const n3 = Math.abs(noise3(px * 40 + 9, py * 40, pz * 40) - 0.5);
    py += (n1 * 0.08 + n2 * 0.03 - n3 * 0.025) * Math.min(1, y * 4 + 0.2);
    px += n1 * 0.03 + n3 * 0.01; pz += n2 * 0.03;
    p.setXYZ(i, px, py, pz);
    const spread = Math.max(0, 0.2 - py) * rho / 1.2; // unwrap the steep sides so veins are not smeared
    uv.setXY(i, px / 1.2 + 0.5 + Math.cos(phi) * spread, pz / 1.2 + 0.5 + Math.sin(phi) * spread);
  }
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y - 0.012, 0);
  g.computeVertexNormals();
  return g;
}

function createDiscoveryRock() {
  const g = new THREE.Group();
  g.name = 'discoveryRock';
  const kit = createKit(g, 0.26);
  const { map, bump } = discoveryTextures();
  const rock = new THREE.Mesh(discoveryGeometry(), pbr(0xffffff, 0.97, 0, { map, bumpMap: bump, bumpScale: 5, envMapIntensity: 0.08 }));
  rock.rotation.y = -0.35;
  g.add(rock);
  // Loose fragments around the base.
  const mat = materials().rock;
  const r = rng(12);
  for (let i = 0; i < 7; i++) {
    const s = 0.015 + r() * 0.04, a = r() * TWO_PI, d = 0.45 + r() * 0.35;
    const chip = new THREE.Mesh(lumpGeometry({ seed: i * 3.3, detail: 1, size: [s * 1.4, s, s], plateau: 0.9, rough: 0.3 }), mat);
    chip.position.set(Math.cos(a) * d, 0, Math.sin(a) * d * 0.8);
    g.add(chip);
  }
  // The only effect: a faint ring of light on the ground, while the rock is the current goal.
  const ring = kit.ring(1.25, { inner: 0.62, power: 0.3, only: 'active' });
  g.add(ring);
  shadows(g);
  return g;
}

/* ---------------------------------------------------------------- solarPanel */

let solarMap = null;
function solarTexture() {
  if (solarMap) return solarMap;
  const W = 1024, H = 684, c0 = makeCanvas(W, H), c = c0.getContext('2d'), r = rng(44);
  c.fillStyle = '#a9aeb3'; c.fillRect(0, 0, W, H);
  const cols = 12, rows = 8, pad = 14, cw = (W - pad * 2) / cols, ch = (H - pad * 2) / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = pad + i * cw + 2, y = pad + j * ch + 2, w = cw - 4, h = ch - 4;
    const g = c.createLinearGradient(x, y, x + w, y + h);
    const k = (r() - 0.5) * 10;
    g.addColorStop(0, `rgb(${14 + k},${30 + k},${84 + k * 2})`); g.addColorStop(1, `rgb(${8 + k},${20 + k},${58 + k * 2})`);
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(190,200,220,0.5)'; c.lineWidth = 1;
    for (let f = 1; f < 9; f++) { c.beginPath(); c.moveTo(x + (w * f) / 9, y); c.lineTo(x + (w * f) / 9, y + h); c.stroke(); }
    c.strokeStyle = 'rgba(220,226,240,0.85)'; c.lineWidth = 2.5;
    for (const f of [0.33, 0.66]) { c.beginPath(); c.moveTo(x, y + h * f); c.lineTo(x + w, y + h * f); c.stroke(); }
  }
  const sheen = c.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0.15, 'rgba(255,255,255,0)'); sheen.addColorStop(0.32, 'rgba(160,190,255,0.16)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  c.fillStyle = sheen; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { // Martian dust, heavier along the lower edge
    const y = r() * H, bias = Math.pow(y / H, 2);
    c.fillStyle = `rgba(150,82,52,${r() * 0.18 * (0.3 + bias)})`;
    c.fillRect(r() * W, y, 1 + r() * 3, 1 + r() * 2);
  }
  const lower = c.createLinearGradient(0, H * 0.7, 0, H);
  lower.addColorStop(0, 'rgba(140,76,48,0)'); lower.addColorStop(1, 'rgba(140,76,48,0.22)');
  c.fillStyle = lower; c.fillRect(0, H * 0.7, W, H * 0.3);
  return (solarMap = canvasTexture(c0));
}

function createSolarPanel() {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'solarPanel';
  const kit = createKit(g, 1.35);
  const tilt = 0.4, W = 3, D = 2;
  const array = new THREE.Group();
  array.position.set(0, 0.75, 0);
  array.rotation.x = tilt; // faces up and to +Z
  const panel = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, D), [m.steel, m.steel, new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.32, metalness: 0.35, envMap: m.white.envMap, envMapIntensity: 0.45 }), m.dark, m.steel, m.steel]);
  array.add(panel);
  // Aluminium frame and a centre rail.
  for (const [w, d, x, z] of [[W + 0.06, 0.06, 0, D / 2], [W + 0.06, 0.06, 0, -D / 2], [0.06, D, W / 2, 0], [0.06, D, -W / 2, 0], [0.04, D, 0, 0]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), m.steel);
    rail.position.set(x, -0.01, z);
    array.add(rail);
  }
  g.add(array);
  // Low legs: short at the front, tall at the back, with a cross brace and ground feet.
  const hinge = (x, front) => {
    const top = new THREE.Vector3(x, 0.75 + (front ? -1 : 1) * (D / 2) * Math.sin(tilt) - 0.03, (front ? 1 : -1) * (D / 2) * Math.cos(tilt));
    const foot = new THREE.Vector3(x * 1.08, 0.04, top.z * 1.15 + (front ? 0.25 : -0.3));
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, top.distanceTo(foot), 8), m.steel);
    leg.position.copy(top).lerp(foot, 0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.04, 10), m.dark);
    pad.position.set(foot.x, 0.02, foot.z);
    g.add(leg, pad);
    return foot;
  };
  const feet = [hinge(-1.3, true), hinge(1.3, true), hinge(-1.3, false), hinge(1.3, false)];
  const brace = (a, b) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, a.distanceTo(b), 5), m.steel);
    mesh.position.copy(a).lerp(b, 0.5).setY(0.3);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).setY(0).normalize());
    g.add(mesh);
  };
  brace(feet[0], feet[2]); brace(feet[1], feet[3]);
  // Charge controller on a post with a status lamp, and a cable run to the array.
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.26, 0.16, 2, 0.02), m.paint);
  box.position.set(1.95, 0.45, 0.3);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), m.steel);
  post.position.set(1.95, 0.2, 0.3);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.02), kit.lamp(1.2, 0));
  lamp.position.set(1.95, 0.5, 0.385);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(1.95, 0.35, 0.3), new THREE.Vector3(1.8, 0.04, 0.5), new THREE.Vector3(1.55, 0.03, 0.25), new THREE.Vector3(1.35, 0.4, -0.3)]), 16, 0.012, 5), m.rubber);
  g.add(box, post, lamp, cable);
  // Status strip along the front rail so the state reads from the front.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.025, 0.02), kit.lamp(0.9, 0));
  strip.position.set(0, 0.0, D / 2 + 0.05);
  array.add(strip);
  const h = halo(kit, 0.5, 0.35);
  h.position.copy(lamp.position).setZ(0.4);
  g.add(h);
  g.add(kit.ring(2.2, { inner: 0.72, power: 0.3 }));
  shadows(g);
  withHalos(g, [h]);
  return g;
}

/* ---------------------------------------------------------------- iceDeposit */

let iceMap = null;
function iceTexture() {
  if (iceMap) return iceMap;
  const S = 512, c0 = makeCanvas(S), c = c0.getContext('2d'), r = rng(61);
  c.fillStyle = 'rgb(46,32,28)'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 120; i++) { // pale frost patches, thick in the middle
    const a = r() * TWO_PI, d = Math.pow(r(), 1.4) * S * 0.38, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, rad = 10 + r() * 46 * (1 - d / (S * 0.5));
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(226,240,248,0.92)'); g.addColorStop(0.6, 'rgba(190,214,232,0.55)'); g.addColorStop(1, 'rgba(190,214,232,0)');
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 80; i++) { // cracks in the ice
    let x = S / 2 + (r() - 0.5) * S * 0.6, y = S / 2 + (r() - 0.5) * S * 0.6, a = r() * TWO_PI;
    c.strokeStyle = `rgba(110,150,185,${0.25 + r() * 0.3})`; c.lineWidth = 1 + r() * 1.5; c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 7; k++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 14; y += Math.sin(a) * 14; c.lineTo(x, y); }
    c.stroke();
  }
  for (let i = 0; i < 9000; i++) { c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.5})` : `rgba(20,12,10,${r() * 0.4})`; c.fillRect(S / 2 + (r() - 0.5) * S * 0.8, S / 2 + (r() - 0.5) * S * 0.8, 1 + r() * 2, 1 + r()); }
  // Ragged edge: fade the disc out with a noisy mask so it melts into the soil.
  const edge = c.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.5);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,1)');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = edge; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(0,0,0,0.0)';
  c.globalCompositeOperation = 'source-over';
  return (iceMap = canvasTexture(c0));
}

function createIceDeposit() {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'iceDeposit';
  const kit = createKit(g, 1.8);
  // Spoil heap around the pit: dark excavated soil, a ring that rises from the ground to a rim and falls into the hole.
  const profile = [[0.8, 0.0], [0.95, 0.05], [1.12, 0.12], [1.3, 0.14], [1.5, 0.1], [1.75, 0.04], [2.0, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
  const ringGeo = new THREE.LatheGeometry(profile, 56);
  const pos = ringGeo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + (noise3(v.x * 2.2 + 3, 0, v.z * 2.2) - 0.5) * 0.28;
    pos.setXYZ(i, v.x * k, v.y * (0.8 + (noise3(v.x * 5, v.y * 3, v.z * 5) - 0.3) * 0.7), v.z * k);
  }
  ringGeo.computeVertexNormals();
  const spoil = new THREE.Mesh(ringGeo, m.rock);
  g.add(spoil);
  // Pit floor: dark soil with a skin of frost and exposed ice.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.25, 40), new THREE.MeshStandardMaterial({ map: iceTexture(), transparent: true, roughness: 0.32, metalness: 0, envMap: m.white.envMap, envMapIntensity: 0.5, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.045;
  g.add(floor);
  // Ice chunks broken out of the pit.
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.18, metalness: 0, envMap: m.white.envMap, envMapIntensity: 0.9, emissive: 0x16303c });
  const r = rng(9);
  for (let i = 0; i < 8; i++) {
    const s = 0.05 + r() * 0.1, a = r() * TWO_PI, d = 0.1 + r() * 0.62;
    const chunk = new THREE.Mesh(lumpGeometry({ seed: i * 2.7, detail: 1, size: [s * 1.2, s * 0.9, s], plateau: 0.7, rough: 0.5 }), iceMat);
    chunk.position.set(Math.cos(a) * d, 0.03, Math.sin(a) * d);
    chunk.rotation.y = r() * 6;
    g.add(chunk);
  }
  // Drill rig on the rim: tripod, mast, motor head and the drill string going down into the pit.
  const rig = new THREE.Group();
  rig.position.set(-0.1, 0.04, -0.1);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.55, 0.16), m.yellow);
  mast.position.y = 0.8;
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 8), m.steel);
  string.position.y = 0.6;
  const motor = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.3, 0.3, 2, 0.03), m.orange);
  motor.position.y = 1.42;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 12), m.dark);
  cap.position.y = 1.64;
  rig.add(mast, string, motor, cap);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TWO_PI + 0.5, foot = new THREE.Vector3(Math.cos(a) * 0.85, 0.0, Math.sin(a) * 0.85), top = new THREE.Vector3(0, 1.25, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, top.distanceTo(foot), 6), m.yellow);
    leg.position.copy(top).lerp(foot, 0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.035, 8), m.dark);
    pad.position.set(foot.x, 0.02, foot.z);
    rig.add(leg, pad);
  }
  for (let i = 0; i < 6; i++) { // safety stripes on the mast
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.07, 0.17), m.rubber);
    stripe.position.y = 0.25 + i * 0.22;
    rig.add(stripe);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), kit.lamp(1.3, 0));
  lamp.position.y = 1.74;
  rig.add(lamp);
  g.add(rig);
  const h = halo(kit, 0.7, 0.5);
  h.position.set(-0.1, 1.78, -0.1);
  g.add(h);
  g.add(kit.ring(2.1, { inner: 0.68, power: 0.28 }));
  shadows(g);
  floor.castShadow = false;
  withHalos(g, [h]);
  return g;
}

/* ---------------------------------------------------------------- dataLog */

let caseMap = null;
function caseTexture() {
  if (caseMap) return caseMap;
  const W = 512, H = 256, c0 = makeCanvas(W, H), c = c0.getContext('2d'), r = rng(88);
  c.fillStyle = '#4b5047'; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { const a = r() * 0.14; c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; c.fillRect(r() * W, r() * H, 1 + r() * 2, 1); }
  c.fillStyle = '#d4a017'; c.fillRect(0, 100, W, 22); // hazard stripe
  c.fillStyle = '#1b1d1c';
  for (let x = -40; x < W; x += 36) { c.beginPath(); c.moveTo(x, 100); c.lineTo(x + 18, 100); c.lineTo(x + 36, 122); c.lineTo(x + 18, 122); c.fill(); }
  c.fillStyle = '#d9d5c6'; c.font = 'bold 30px sans-serif'; c.fillText('HALCYON-1', 30, 62);
  c.font = '20px sans-serif'; c.fillText('FLIGHT DATA RECORDER', 30, 88);
  c.font = '16px monospace'; c.fillText('PROPERTY OF CREW - RETURN TO MISSION CONTROL', 30, 170);
  c.fillStyle = '#b3462c'; c.fillRect(388, 28, 90, 56);
  c.fillStyle = '#ece6d6'; c.font = 'bold 22px sans-serif'; c.fillText('DATA', 408, 52); c.font = '14px sans-serif'; c.fillText('LOG-03', 410, 72);
  for (let i = 0; i < 40; i++) { c.strokeStyle = `rgba(210,205,190,${r() * 0.5})`; c.lineWidth = 1; c.beginPath(); const x = r() * W, y = r() * H; c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 30); c.stroke(); }
  for (let i = 0; i < 14000; i++) { c.fillStyle = `rgba(150,80,50,${r() * 0.26})`; const y = Math.pow(r(), 0.5) * H; c.fillRect(r() * W, y, 1 + r() * 3, 1 + r() * 2); } // dust
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(150,80,50,0.12)'); grad.addColorStop(1, 'rgba(150,80,50,0.38)');
  c.fillStyle = grad; c.fillRect(0, 0, W, H);
  return (caseMap = canvasTexture(c0));
}

function createDataLog() {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'dataLog';
  const kit = createKit(g, 0.62);
  const caseGroup = new THREE.Group();
  caseGroup.rotation.set(0.04, 0.5, -0.05);
  caseGroup.position.y = 0.02;
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.17, 0.28, 3, 0.03), new THREE.MeshStandardMaterial({ map: caseTexture(), roughness: 0.85, metalness: 0.1 }));
  body.position.y = 0.085;
  const lid = new THREE.Mesh(new RoundedBoxGeometry(0.405, 0.012, 0.285, 2, 0.005), m.dark);
  lid.position.y = 0.095;
  caseGroup.add(body, lid);
  // Carry handle on top and corner guards.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI), m.dark);
  handle.position.set(0, 0.17, 0);
  caseGroup.add(handle);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const guard = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.19, 0.05, 2, 0.01), m.dark);
    guard.position.set(sx * 0.19, 0.095, sz * 0.13);
    caseGroup.add(guard);
  }
  for (const x of [-0.1, 0.1]) {
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.012), m.steel);
    latch.position.set(x, 0.1, 0.143);
    caseGroup.add(latch);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), kit.lamp(1.5, 3.2));
  led.position.set(0.14, 0.175, 0.08);
  caseGroup.add(led);
  // Antenna whip with a blinking tip: readable at 15 m, where a 40 cm case would be a speck.
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.42, 5), m.steel);
  whip.position.set(0.17, 0.38, -0.08);
  whip.rotation.z = -0.05;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), kit.lamp(1.6, 3.2));
  tip.position.set(0.165, 0.6, -0.08);
  caseGroup.add(whip, tip);
  g.add(caseGroup);
  // Dust drift against one side, and the cable it was torn from.
  const drift = new THREE.Mesh(lumpGeometry({ seed: 4, detail: 2, size: [0.3, 0.05, 0.18], plateau: 0.9, rough: 0.2 }), m.rock);
  drift.position.set(-0.12, 0, -0.18);
  g.add(drift);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.2, 0.05, 0.1), new THREE.Vector3(-0.45, 0.01, 0.25), new THREE.Vector3(-0.7, 0.012, 0.1), new THREE.Vector3(-0.9, 0.01, 0.3)]), 20, 0.009, 5), m.rubber);
  g.add(cable);
  const h1 = halo(kit, 0.2, 0.6, 3.2), h2 = halo(kit, 0.34, 0.9, 3.2);
  h1.position.copy(led.position).applyEuler(caseGroup.rotation).add(caseGroup.position);
  h2.position.copy(tip.position).applyEuler(caseGroup.rotation).add(caseGroup.position);
  g.add(h1, h2);
  shadows(g);
  withHalos(g, [h1, h2]);
  return g;
}

/* ---------------------------------------------------------------- halcyonLander */

// Paint that has sat under three years of Martian dust: darker and redder toward the ground, heavier on top faces.
function dusty(color, { roughness = 0.6, metalness = 0.2, ...extra } = {}) {
  const material = pbr(color, roughness, metalness, { envMapIntensity: 0.25, ...extra });
  const uBase = { value: 0 };
  material.userData.uBase = uBase;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBase = uBase;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPd;\nvarying float vUpd;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vec4 wp_ = vec4(transformed, 1.);
        vec3 wn_ = objectNormal;
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
        #endif
        wp_ = modelMatrix * wp_;
        vWPd = wp_.xyz;
        vUpd = normalize(mat3(modelMatrix) * wn_).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPd;\nvarying float vUpd;\nuniform float uBase;\nfloat dust_ = 0.;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          float h_ = vWPd.y - uBase;
          float n_ = vnoise(vWPd * 5.) * .5 + vnoise(vWPd * 17.) * .3 + vnoise(vWPd * 60.) * .2;
          float streak_ = vnoise(vec3(vWPd.x * 9., vWPd.y * .8, vWPd.z * 9.));
          dust_ = .42 + pow(clamp(1. - h_ / 6.5, 0., 1.), .6) * .5 + max(vUpd, 0.) * .22 + (streak_ - .5) * .3;
          dust_ = clamp(dust_ * (.7 + .6 * n_), 0., .93);
          vec3 dustCol_ = mix(vec3(.2, .09, .052), vec3(.42, .22, .125), n_) * mix(.6, 1., clamp(h_ / 3., 0., 1.));
          diffuseColor.rgb = mix(diffuseColor.rgb * (.85 + .3 * n_), dustCol_, dust_);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .97, dust_);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - dust_;');
  };
  return material;
}

function cylinderBetween(a, b, r0, r1, material, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), seg), material);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return mesh;
}

// A torn solar wing: a jagged outline extruded thin, with the cell texture mapped across it.
function tornPanel(width, depth, tear, seed) {
  const r = rng(seed);
  const pts = [[0, 0], [width, 0]];
  for (let i = 0; i <= 8; i++) pts.push([width - (width * i) / 8 * (tear ? 0.9 : 1) + (r() - 0.5) * 0.1, depth * (tear ? 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + seed)) * (r() * 0.6 + 0.4) : 1)]);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ShapeGeometry(shape);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / width, p.getY(i) / depth);
  return geometry;
}

function createHalcyon() {
  const g = new THREE.Group();
  g.name = 'halcyonLander';
  const kit = createKit(g, 7.2);
  const white = dusty(0xcfc9bc, { roughness: 0.55, metalness: 0.2 });
  const foil = dusty(0xb08a3c, { roughness: 0.4, metalness: 0.85 });
  const metal = dusty(0x8a8f95, { roughness: 0.45, metalness: 0.8 });
  const dark = dusty(0x25282c, { roughness: 0.6, metalness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.35, metalness: 0.4 });
  const panelMat = dusty(0xffffff, { roughness: 0.35, metalness: 0.4, map: solarTexture(), side: THREE.DoubleSide });
  const mats = [white, foil, metal, dark, panelMat];

  const wreck = new THREE.Group();
  g.add(wreck);

  // Descent stage: an octagonal body in foil-wrapped panels, an engine bell under it, and the crew cabin above.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.05, 1.5, 8, 6), white);
  body.position.y = 2.25;
  body.rotation.y = Math.PI / 8;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.08, 2.12, 0.4, 8, 3), foil);
  skirt.position.y = 1.65;
  skirt.rotation.y = Math.PI / 8;
  const bell = new THREE.Mesh(new THREE.LatheGeometry([[0.3, 0], [0.42, 0.15], [0.6, 0.5], [0.82, 0.88], [0.74, 0.9], [0.52, 0.55], [0.3, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)), 20), dark);
  bell.position.y = 0.62;
  bell.material.side = THREE.DoubleSide;
  wreck.add(body, skirt, bell);
  const cabin = new THREE.Mesh(new THREE.LatheGeometry([[1.62, 0], [1.62, 0.7], [1.42, 1.5], [1.0, 2.2], [0.64, 2.62], [0.36, 2.82], [0, 2.9]].map(([r, y]) => new THREE.Vector2(r, y)), 28, 0, TWO_PI), white);
  cabin.position.y = 3.0;
  wreck.add(cabin);
  // Cabin details: window pair, dark side hatch with frame and a handle, a band of RCS pods, a status lamp at the hatch.
  const windowGeo = new THREE.PlaneGeometry(0.5, 0.36);
  for (const az of [-0.55, 0.55]) {
    const w = new THREE.Mesh(windowGeo, black);
    w.position.set(Math.sin(az) * 1.0, 5.1, Math.cos(az) * 1.0);
    w.rotation.set(-0.7, az, 0);
    wreck.add(w);
  }
  const hatchAz = 1.0; // faces the camera of the sandbox wreck view, a little to the right
  const hatch = new THREE.Group();
  hatch.position.set(Math.sin(hatchAz) * 1.58, 3.95, Math.cos(hatchAz) * 1.58);
  hatch.rotation.y = hatchAz;
  hatch.rotation.x = -0.15;
  const frame = new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.4, 0.12, 2, 0.05), metal);
  const door = new THREE.Mesh(new RoundedBoxGeometry(0.82, 1.22, 0.14, 2, 0.04), black);
  door.position.z = 0.02;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), foil);
  handle.position.set(0.25, 0, 0.12);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), kit.lamp(0.9, 0.5));
  lamp.position.set(-0.38, 0.62, 0.1);
  hatch.add(frame, door, handle, lamp);
  wreck.add(hatch);
  const rails = new THREE.Group();
  const ladderBase = new THREE.Vector3(Math.sin(hatchAz + 0.5) * 3.3, 0.1, Math.cos(hatchAz + 0.5) * 3.3);
  const ladderTop = new THREE.Vector3(Math.sin(hatchAz + 0.5) * 1.95, 2.9, Math.cos(hatchAz + 0.5) * 1.95);
  for (const off of [-0.22, 0.22]) {
    const o = new THREE.Vector3(Math.cos(hatchAz + 0.5) * off, 0, -Math.sin(hatchAz + 0.5) * off);
    rails.add(cylinderBetween(ladderBase.clone().add(o), ladderTop.clone().add(o), 0.03, 0.03, metal, 6));
  }
  for (let i = 1; i < 9; i++) {
    const t = i / 9, c = ladderBase.clone().lerp(ladderTop, t);
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.44, 5), metal);
    rung.position.copy(c);
    rung.rotation.set(0, hatchAz + 0.5, Math.PI / 2);
    rails.add(rung);
  }
  wreck.add(rails);
  for (let i = 0; i < 4; i++) { // thruster quads on the cabin base
    const a = i / 4 * TWO_PI + 0.3;
    const quad = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.28, 0.3, 2, 0.04), dark);
    quad.position.set(Math.cos(a) * 1.7, 3.5, Math.sin(a) * 1.7);
    quad.rotation.y = -a;
    wreck.add(quad);
  }
  // Equipment boxes and spherical tanks bolted around the descent stage.
  for (const [a, y, w, h, d] of [[0.2, 2.5, 0.8, 0.7, 0.5], [2.2, 2.1, 0.6, 0.9, 0.5], [3.8, 2.6, 0.7, 0.6, 0.6], [5.2, 2.3, 0.6, 0.8, 0.5]]) {
    const box = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.04), a > 3 ? foil : white);
    box.position.set(Math.cos(a) * 2.1, y, Math.sin(a) * 2.1);
    box.rotation.y = -a;
    wreck.add(box);
  }

  // Four legs. The one at the back-left has folded: its upper strut hangs and the lower half lies on the ground.
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) / 4 * TWO_PI;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const top = dir.clone().multiplyScalar(1.85).setY(2.0);
    const brace = dir.clone().multiplyScalar(1.5).setY(1.55);
    if (i === 2) {
      const knee = dir.clone().multiplyScalar(2.9).setY(1.0);
      const foot = dir.clone().multiplyScalar(4.5).setY(0.14);
      wreck.add(cylinderBetween(top, knee, 0.07, 0.09, metal, 8), cylinderBetween(knee, foot, 0.06, 0.05, metal, 8));
      wreck.add(cylinderBetween(brace, knee.clone().lerp(foot, 0.1), 0.04, 0.04, metal, 6));
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 0.1, 14), dark);
      pad.position.copy(foot).setY(0.18);
      pad.rotation.z = 0.35;
      wreck.add(pad);
      continue;
    }
    const foot = dir.clone().multiplyScalar(3.7).setY(0.1);
    wreck.add(cylinderBetween(top, foot, 0.08, 0.06, metal, 8), cylinderBetween(brace, foot.clone().lerp(top, 0.15), 0.04, 0.04, metal, 6));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.1, 14), dark);
    pad.position.copy(foot).setY(0.05);
    wreck.add(pad);
  }

  // Antenna: a mast that took a hit, kinked halfway, the dish hanging off the end.
  const mastBase = new THREE.Vector3(0.45, 5.7, 0.25), kink = mastBase.clone().add(new THREE.Vector3(0.2, 1.3, 0.08));
  const tip = kink.clone().add(new THREE.Vector3(0.9, 0.55, 0.1));
  wreck.add(cylinderBetween(mastBase, kink, 0.04, 0.035, metal, 6), cylinderBetween(kink, tip, 0.03, 0.025, metal, 6));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 8, 0, TWO_PI, 0, 1.0), new THREE.MeshStandardMaterial({ color: 0xaaa397, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
  dish.position.copy(tip);
  dish.rotation.set(1.9, 0.4, 0.5);
  dish.scale.y = 0.45;
  wreck.add(dish);

  // Solar wing: the inner half still on its arm, the outer half torn and folded back.
  const arm = cylinderBetween(new THREE.Vector3(1.95, 3.0, 0.3), new THREE.Vector3(3.1, 3.6, 0.3), 0.06, 0.06, metal, 6);
  wreck.add(arm);
  const inner = new THREE.Mesh(tornPanel(2.6, 1.6, false, 3), panelMat);
  inner.position.set(2.1, 3.25, 0.2);
  inner.rotation.set(0, -0.35, 0.32);
  const outer = new THREE.Mesh(tornPanel(2.3, 1.5, true, 11), panelMat);
  outer.position.set(4.55, 4.05, -0.45);
  outer.rotation.set(0, -0.35, -1.15);
  wreck.add(inner, outer);

  // Debris on the ground.
  const debris = new THREE.Group();
  const shard = new THREE.Mesh(tornPanel(1.2, 0.7, true, 21), panelMat);
  shard.position.set(4.6, 0.12, 2.8);
  shard.rotation.set(-Math.PI / 2 + 0.12, 0.7, 0.2);
  const strut = cylinderBetween(new THREE.Vector3(-5.3, 0.14, 1.6), new THREE.Vector3(-3.8, 0.1, 2.4), 0.06, 0.06, metal, 6);
  const tankShell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 14, 1, true, 0, 3.6), metal);
  tankShell.material.side = THREE.DoubleSide;
  tankShell.rotation.set(Math.PI / 2, 0, 0.5);
  tankShell.position.set(-3.4, 0.32, -3.4);
  const scrap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.8), foil);
  scrap.position.set(2.6, 0.05, -3.4);
  scrap.rotation.set(0.1, 0.4, 0.15);
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.4, 0.5, 2, 0.04), white);
  box.position.set(1.3, 0.2, 4.4);
  box.rotation.set(0.3, 0.9, 0.2);
  const panelBit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), panelMat);
  panelBit.position.set(-1.5, 0.05, 4.6);
  panelBit.rotation.y = 0.5;
  debris.add(shard, strut, tankShell, scrap, box, panelBit);
  g.add(debris);

  // The wreck has settled about 8 degrees off vertical, and its low side has dug into the ground.
  wreck.rotation.set(0.0, 0.0, 0.14);
  wreck.rotation.x = 0.03;
  wreck.position.y = 0.2;
  shadows(g);
  g.userData.onFrame = ((base) => (...a) => {
    base(...a);
    const y = g.getWorldPosition(new THREE.Vector3()).y;
    for (const mat of mats) mat.userData.uBase.value = y;
  })(g.userData.onFrame);
  g.userData.onFrame();
  return g;
}

export const PROPS = {
  scanPoint: createScanPoint,
  sampleRock: createSampleRock,
  discoveryRock: createDiscoveryRock,
  solarPanel: createSolarPanel,
  iceDeposit: createIceDeposit,
  dataLog: createDataLog,
  halcyonLander: createHalcyon,
};

