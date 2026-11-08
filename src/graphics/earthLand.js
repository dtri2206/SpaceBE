import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTier } from './groundTier.js';
import { fbm, perlin, smoothstep } from './terrain.js';

/**
 * The land around the Earth launch site: rolling hills, ridges and distant mountains on the inland sides, a
 * land-cover map (forest, farm fields) the ground shader paints from, and instanced trees placed from the same map.
 * The pad and the launch complex stay dead flat; the coast stays flat so the beach and the sea are untouched.
 * Pure helpers (earthHeight, forestDensity) have no Three.js in them.
 */

export const EARTH_R = 637e3;
export const drop = (x, z) => Math.sqrt(EARTH_R * EARTH_R - x * x - z * z) - EARTH_R; // Earth curves away: 3 m at 2 km
export const shoreX = (z) => 1250 + 300 * Math.sin(z * 0.0011 + 1.3) + 130 * Math.sin(z * 0.0041 + 0.4) + 45 * Math.sin(z * 0.013);
export const roadX = (z) => 82 + 55 * Math.sin(z / 330) + 40 * Math.sin(z / 910 + 1);
const ROAD_END = 2600;

const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

// 0 on the road and out to `near` metres from it, 1 beyond `far`. The road only exists for z between -40 and its end.
function awayFromRoad(x, z, near, far) {
  if (z < -40 - far || z > ROAD_END + far) return 1;
  const d = Math.abs(x - roadX(Math.max(0, Math.min(ROAD_END, z))));
  const end = z > ROAD_END ? Math.hypot(d, z - ROAD_END) : z < 0 ? Math.hypot(d, z) : d;
  return smoothstep(near, far, end);
}

/** Ground height above the flat site, in metres (the sphere's curvature is added separately). */
export function earthHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r < 330) return 0;
  const inland = shoreX(z) - x; // metres inland of the shoreline
  const coast = smoothstep(120, 800, inland);
  if (coast <= 0) return 0;
  const away = smoothstep(330, 950, r);
  let h = 0;
  if (away > 0) {
    // Rolling hills between flat meadows, and low ridges further out.
    const n = fbm(x / 1100 + 3, z / 1100 - 8, 3);
    h += smoothstep(-0.2, 0.45, n) * 105 * away + perlin(x / 240 + 5, z / 240) * 4 * away * smoothstep(-0.1, 0.3, n);
    const ridge = 1 - Math.abs(perlin(x / 2100 + 9, z / 2500 - 3));
    h += ridge * ridge * ridge * 240 * smoothstep(1500, 3300, r) * smoothstep(-0.2, 0.3, fbm(x / 3400 + 4, z / 3400 - 11, 2));
    h *= awayFromRoad(x, z, 16, 130);
  }
  // Distant mountains, only on the inland horizons.
  if (r > 4200) {
    const ramp = smoothstep(4200, 9000, r + fbm(x / 2500 + 2, z / 2500 + 7, 2) * 700);
    const side = (0.3 + 0.7 * smoothstep(300, 5500, inland)) * smoothstep(0, 900, inland);
    const jag = 1 - Math.abs(perlin(x / 1100 - 3, z / 1100 + 5));
    const jag2 = 1 - Math.abs(perlin(x / 380 + 8, z / 380 - 6));
    const notch = smoothstep(-0.3, 0.25, fbm(x / 3000 + 31, z / 3000 - 17, 2));
    h += ramp * side * (150 + notch * 260 + (jag * jag * 520 + jag2 * jag2 * 110) * (0.3 + 0.7 * notch));
  }
  return h * coast;
}

/** Forest cover, 0..1: patches of woodland a few hundred metres across, thicker on hills, none on the pad, road or beach. */
export function forestDensity(x, z) {
  const r = Math.hypot(x, z);
  if (r < 300) return 0;
  const inland = shoreX(z) - x;
  const n = fbm(x / 420 + 50, z / 420 - 20, 3) * 0.6 + fbm(x / 1500, z / 1500 + 6, 2) * 0.4;
  let d = smoothstep(-0.1, 0.2, n + smoothstep(0, 120, earthHeight(x, z)) * 0.14);
  d *= smoothstep(300, 520, r) * smoothstep(180, 420, inland) * awayFromRoad(x, z, 12, 30);
  return d;
}

// Farm fields: a tilted grid of rectangles, each with its own crop colour, in the lowlands.
const FIELD = { cos: Math.cos(0.26), sin: Math.sin(0.26), w: 250, h: 330 };
function fieldCell(x, z) {
  const u = (x * FIELD.cos + z * FIELD.sin) / FIELD.w, v = (-x * FIELD.sin + z * FIELD.cos) / FIELD.h;
  return [Math.floor(u), Math.floor(v), u - Math.floor(u), v - Math.floor(v)];
}
function fieldHash(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function farmland(x, z) {
  const r = Math.hypot(x, z);
  const inland = shoreX(z) - x;
  const area = smoothstep(-0.05, 0.25, fbm(x / 1300 + 13, z / 1300 - 40, 2)) * smoothstep(420, 700, r) * smoothstep(260, 520, inland) * (1 - smoothstep(0, 60, earthHeight(x, z) - 22));
  return area;
}

/* ------------------------------------------------------------------ land-cover map for the ground shader */

export const COVER_HALF = 3072;
const COVER_SIZE = 512;

/** An RGBA map over +-3 km: R forest density, G field colour (0..1), B farm cover. */
export function buildCoverTexture() {
  const data = new Uint8Array(COVER_SIZE * COVER_SIZE * 4);
  for (let j = 0; j < COVER_SIZE; j++) {
    for (let i = 0; i < COVER_SIZE; i++) {
      const x = (i + 0.5) / COVER_SIZE * COVER_HALF * 2 - COVER_HALF, z = (j + 0.5) / COVER_SIZE * COVER_HALF * 2 - COVER_HALF;
      const [fi, fj] = fieldCell(x, z);
      const k = (j * COVER_SIZE + i) * 4;
      data[k] = Math.round(forestDensity(x, z) * 255);
      data[k + 1] = Math.round(fieldHash(fi, fj) * 255);
      data[k + 2] = Math.round(farmland(x, z) * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, COVER_SIZE, COVER_SIZE, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ ground meshes */

/** Three tiers (fine near the pad, medium, a coarse ring to the horizon), all following earth curvature plus the hills. */
export function buildEarthGround(high) {
  const k = high ? 1 : 2;
  const height = (x, z) => drop(x, z) + earthHeight(x, z);
  const innerHalf = 1800, midHalf = 6000;
  return [
    buildTier({ segments: Math.round(innerHalf * 2 / (15 * k)), cell: 15 * k, skirt: 8, coord: (t) => t * innerHalf, height }),
    buildTier({ segments: Math.round(midHalf * 2 / (60 * k)), cell: 60 * k, hole: innerHalf, skirt: 40, coord: (t) => t * midHalf, height }),
    buildTier({ segments: Math.round(110 / k), cell: 250, hole: midHalf, sink: 40, coord: (t) => Math.sign(t) * Math.pow(Math.abs(t), 2.1) * 15000, height }),
  ];
}

/* ------------------------------------------------------------------ trees */

function paint(geometry, rgb, jitter = 0.18) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const [r, gg, b] = rgb;
  g.computeBoundingBox();
  const lo = g.boundingBox.min.y, span = Math.max(1e-3, g.boundingBox.max.y - lo);
  // Per-face shade, a little lighter towards the top, so each low-poly tree reads as chunks of leaves.
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const s = 1 + (((i * 2654435761) >>> 0) % 1000 / 1000 - 0.5) * jitter + ((y - lo) / span - 0.5) * 0.35;
    for (let v = 0; v < 3; v++) col.set([r * s, gg * s, b * s], (i + v) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const BARK = [0.2, 0.14, 0.09];

function coniferGeometry() {
  const parts = [paint(new THREE.CylinderGeometry(0.22, 0.34, 3.4, 5, 1, true).translate(0, 1.7, 0), BARK, 0.1)];
  [[3.0, 5.2, 3.6, 1], [2.4, 4.6, 6.4, 0.95], [1.7, 4.0, 9.0, 1.05], [1.0, 3.2, 11.2, 1.1]].forEach(([rad, h, y, tone]) => {
    parts.push(paint(new THREE.ConeGeometry(rad, h, 7, 1, true).translate(0, y + h / 2 - 1, 0), [0.045 * tone, 0.105 * tone, 0.05 * tone]));
  });
  return mergeGeometries(parts);
}

function broadleafGeometry() {
  const blob = (r, x, y, z, sy, tone) => paint(new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1).translate(x, y, z), [0.1 * tone, 0.2 * tone, 0.06 * tone], 0.3);
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.3, 0.5, 4.2, 5, 1, true).translate(0, 2.1, 0), BARK, 0.1),
    blob(3.4, 0, 6.6, 0, 0.82, 1),
    blob(2.5, 1.9, 5.2, 0.8, 0.8, 0.9),
    blob(2.3, -1.7, 5.6, -1.1, 0.85, 1.08),
    blob(1.9, 0.4, 8.6, -0.4, 0.8, 1.15),
  ]);
}

function palmGeometry() {
  const parts = [];
  // A curved trunk of three tapered pieces, leaning a little.
  let x = 0, y = 0;
  [[0.3, 0.24, 3.2, 0.25], [0.24, 0.19, 3.0, 0.45], [0.19, 0.15, 2.6, 0.6]].forEach(([r0, r1, h, lean], i) => {
    const seg = new THREE.CylinderGeometry(r1, r0, h, 5, 1, true).translate(0, h / 2, 0).rotateZ(-lean * 0.3).translate(x, y, 0);
    parts.push(paint(seg, [0.3, 0.24, 0.17], 0.1));
    x += Math.sin(lean * 0.3) * h * 0.96;
    y += Math.cos(lean * 0.3) * h;
    void i;
  });
  // Drooping fronds: three triangles each, radiating from the crown.
  const pos = [];
  const fronds = 9;
  for (let k = 0; k < fronds; k++) {
    const a = k / fronds * Math.PI * 2 + (k % 2) * 0.15, c = Math.cos(a), s = Math.sin(a);
    const L = 3.1 + (k % 3) * 0.3;
    const at = (d, up, side) => [x + c * d - s * side, y + up, s * d + c * side];
    const base = at(0, 0, 0), m1 = at(L * 0.5, 0.75, 0.45), m2 = at(L * 0.5, 0.75, -0.45), tip = at(L, -0.8, 0);
    pos.push(...base, ...m1, ...m2, ...m1, ...tip, ...m2);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.computeVertexNormals();
  parts.push(paint(fg, [0.11, 0.24, 0.07], 0.35));
  return mergeGeometries(parts);
}

/** Instanced low-poly trees: conifers, broadleaf, and coastal palms. Returns a Group; trees.userData.count is the total. */
export function buildTrees(high) {
  const rnd = rng(2024);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  const buckets = { conifer: [], broadleaf: [], palm: [] };
  const budget = high ? { forest: 3200, lines: 420, palms: 260 } : { forest: 900, lines: 140, palms: 90 };
  const clear = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 290) return false;
    if (z > -40 && z < ROAD_END + 20 && Math.abs(x - roadX(Math.max(0, z))) < 8.5) return false;
    return shoreX(z) - x > 120;
  };
  const slopeOk = (x, z) => Math.abs(earthHeight(x + 7, z) - earthHeight(x - 7, z)) < 7 && Math.abs(earthHeight(x, z + 7) - earthHeight(x, z - 7)) < 7;
  const add = (kind, x, z, scale) => {
    const h = earthHeight(x, z);
    if (h > 430 || !slopeOk(x, z)) return false;
    buckets[kind].push({ x, y: drop(x, z) + h, z, scale, rot: rnd() * 6.283, lean: (rnd() - 0.5) * 0.12, tone: rnd() });
    return true;
  };

  // Woods: rejection-sampled from the forest map, thickest near the pad and thinning with distance.
  for (let n = 0, guard = 0; n < budget.forest && guard++ < budget.forest * 60;) {
    const r = 300 + 2700 * Math.pow(rnd(), 1.9), a = rnd() * 6.283;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clear(x, z) || rnd() > forestDensity(x, z)) continue;
    const high_ = smoothstep(20, 160, earthHeight(x, z)), coastal = smoothstep(1500, 450, shoreX(z) - x);
    const stand = fbm(x / 600 + 90, z / 600 - 30, 2) + high_ * 0.35 - coastal * 0.4; // conifer stands on hills, broadleaf in the lowlands
    const kind = stand > 0.1 ? 'conifer' : 'broadleaf';
    const scale = (kind === 'conifer' ? 1.0 + rnd() * rnd() * 1.3 : 1.0 + rnd() * 0.9) * (1 + 0.2 * perlin(x / 90, z / 90));
    if (add(kind, x, z, scale)) n++;
  }

  // Windbreaks along the road and the field edges: broadleaf trees every 12 to 22 m, with gaps.
  let lines = 0;
  for (let z = 150; z < ROAD_END - 60 && lines < budget.lines * 0.55;) {
    z += 11 + rnd() * 11;
    if (perlin(z / 140, 7.1) < -0.05) continue; // a stretch with no trees
    for (const side of [-1, 1]) {
      if (rnd() < 0.35) continue;
      const x = roadX(z) + side * (12 + rnd() * 3.5);
      if (clear(x, z) && add(rnd() < 0.2 ? 'palm' : 'broadleaf', x, z, 1.0 + rnd() * 0.6)) lines++;
    }
  }
  for (let fi = -9; fi < 10 && lines < budget.lines; fi++) for (let fj = -9; fj < 10 && lines < budget.lines; fj++) {
    if (fieldHash(fi + 40, fj + 17) > 0.45) continue;
    // One hedgerow along the +u edge of this field cell.
    const u = (fi + 1) * FIELD.w, v0 = fj * FIELD.h;
    for (let t = 8; t < FIELD.h && lines < budget.lines; t += 11 + rnd() * 9) {
      const v = v0 + t;
      const x = u * FIELD.cos - v * FIELD.sin, z = u * FIELD.sin + v * FIELD.cos;
      if (farmland(x, z) < 0.5 || !clear(x, z)) continue;
      if (add('broadleaf', x + (rnd() - 0.5) * 3, z + (rnd() - 0.5) * 3, 0.7 + rnd() * 0.5)) lines++;
    }
  }

  // Palms and sea-grape scrub towards the coast, in loose groups.
  for (let n = 0, guard = 0; n < budget.palms && guard++ < budget.palms * 80;) {
    const z = (rnd() - 0.5) * 3200;
    const x = shoreX(z) - 190 - rnd() * rnd() * 900;
    if (!clear(x, z) || perlin(x / 120 + 3, z / 120) < -0.1) continue;
    if (add('palm', x, z, 0.8 + rnd() * 0.7)) n++;
  }

  const group = new THREE.Group();
  group.name = 'trees';
  const geometries = { conifer: coniferGeometry(), broadleaf: broadleafGeometry(), palm: palmGeometry() };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), colour = new THREE.Color();
  let total = 0;
  for (const [kind, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geometries[kind], material, list.length);
    list.forEach((t, i) => {
      e.set(t.lean, t.rot, t.lean * 0.7);
      const squash = kind === 'conifer' ? 0.85 + t.tone * 0.3 : 1;
      m.compose(new THREE.Vector3(t.x, t.y - 0.3, t.z), q.setFromEuler(e), new THREE.Vector3(t.scale * squash, t.scale, t.scale * squash));
      mesh.setMatrixAt(i, m);
      // Colour variation: most trees near the base green, some yellower or browner.
      const k = t.tone;
      if (kind === 'palm') colour.setRGB(0.9 + k * 0.25, 0.95 + k * 0.2, 0.85);
      else if (k > 0.88) colour.setRGB(1.9, 1.35, 0.7); // turning or dry
      else colour.setRGB(0.78 + k * 0.4, 0.82 + (1 - k) * 0.36, 0.78 + k * 0.25);
      mesh.setColorAt(i, colour);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    total += list.length;
  }
  group.userData.count = total;
  return group;
}
