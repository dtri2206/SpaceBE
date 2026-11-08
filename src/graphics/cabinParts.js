// Helpers for the crew cabin (cabin.js): geometry shortcuts, a bake step that merges static meshes per material, and the
// canvas textures (wall panels, deck plate, rack module faces, fabric, labels). Textures are built once and cached at
// module level, so building a second cabin is cheap.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MONO = '"IBM Plex Mono", monospace';
export const CYAN = '#67e8f9', AMBER = '#fbbf24', GREEN = '#34d399', RED = '#f87171';

export const glow = (color, power = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) });

const geoCache = new Map();
const cachedGeos = new Set();
export function box(w, h, d, material, x = 0, y = 0, z = 0, radius = 0.02) {
  const r = radius > 0 ? Math.min(radius, Math.min(w, h, d) / 2 - 1e-4) : 0;
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${r.toFixed(4)}`;
  let geometry = geoCache.get(key);
  if (!geometry) {
    geometry = r > 0.001 ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, geometry);
    cachedGeos.add(geometry);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

export function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function canvasTexture(canvas, { srgb = true, repeat = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export function stencil(c, text, x, y, size, color, align = 'center') {
  c.textAlign = align;
  c.font = `700 ${size}px ${MONO}`;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(text, x, y);
}

/** A live-looking screen: an unlit textured plane. `draw(c, w, h)` paints it once. */
export function screen(width, height, draw, power = 1.4, px = 384) {
  const canvas = makeCanvas(px, Math.max(32, Math.round(px * height / width)));
  const c = canvas.getContext('2d');
  c.fillStyle = '#04100f';
  c.fillRect(0, 0, canvas.width, canvas.height);
  draw(c, canvas.width, canvas.height);
  const texture = canvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(power, power, power) });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

export const cyl = (radius, height, material, x, y, z, axis = 'y', seg = 16) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, seg), material);
  mesh.position.set(x, y, z);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
};
export const sphere = (radius, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
};
export const torus = (radius, tube, material, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 36), material);
  mesh.position.set(x, y, z);
  return mesh;
};
export const rod = (a, b, radius, material, seg = 8) => {
  const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, p0.distanceTo(p1), seg), material);
  mesh.position.copy(p0).add(p1).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.sub(p0).normalize());
  return mesh;
};
export const tube = (points, radius, material, segments = 24) =>
  new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segments, radius, 6), material);
export const place = (mesh, rx = 0, ry = 0, rz = 0) => { mesh.rotation.set(rx, ry, rz); return mesh; };

/** A quad from four corners and UVs, wound so it faces the middle of the room. */
export function quad(corners, uvs) {
  const v = corners.map((p) => new THREE.Vector3(...p));
  const normal = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).normalize();
  const toRoom = new THREE.Vector3(0, 1.3, 0).sub(v[0].clone().add(v[2]).multiplyScalar(0.5));
  const flip = normal.dot(toRoom) < 0;
  if (flip) normal.negate();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((p) => p.toArray()), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(v.flatMap(() => normal.toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  return g;
}

/** Merges every static mesh into one mesh per material (dynamic ones stay live). */
export function bake(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const meshes = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.dynamic) return;
    meshes.push(o);
    const source = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(source.attributes)) if (!['position', 'normal', 'uv'].includes(name)) source.deleteAttribute(name);
    if (!source.attributes.uv) source.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count * 2), 2));
    const geometry = source.applyMatrix4(o.matrixWorld);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geometry);
  });
  meshes.forEach((o) => { if (!cachedGeos.has(o.geometry)) o.geometry.dispose?.(); o.removeFromParent(); });
  let triangles = 0;
  for (const [material, geometries] of buckets) {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = material.transparent ? 1 : 0;
    triangles += merged.attributes.position.count / 3;
    group.add(mesh);
  }
  return triangles;
}

// ---- Textures (module-level caches) ----------------------------------------------------------------------------

const cache = {};
const memo = (key, make) => (cache[key] ??= make());

/** Riveted wall panels, 256 px per metre, plus a bump map. Labels are { text, x, y, size } in metres from the top-left. */
export function panelTextures(wm, hm, labels = [], key = '') {
  return memo(`panel${wm}x${hm}${key}`, () => {
    const ppm = 256, rnd = seeded(wm * 31 + hm * 7 + key.length);
    const w = Math.round(wm * ppm), h = Math.round(hm * ppm);
    const color = makeCanvas(w, h), bump = makeCanvas(w, h);
    const c = color.getContext('2d'), b = bump.getContext('2d');
    b.fillStyle = '#808080'; b.fillRect(0, 0, w, h);
    const cols = Math.round(wm), rows = Math.max(1, Math.round(hm / 1.075));
    const pw = w / cols, ph = h / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const tone = 168 + rnd() * 10;
      c.fillStyle = `rgb(${tone - 2}, ${tone}, ${tone + 6})`;
      c.fillRect(i * pw, j * ph, pw, ph);
      const grime = c.createLinearGradient(0, j * ph, 0, (j + 1) * ph);
      grime.addColorStop(0, 'rgba(20,24,30,0)');
      grime.addColorStop(1, `rgba(20,24,30,${j === rows - 1 ? 0.28 : 0.1})`);
      c.fillStyle = grime; c.fillRect(i * pw, j * ph, pw, ph);
    }
    c.lineWidth = 5; b.lineWidth = 7;
    for (let i = 0; i <= cols; i++) {
      c.strokeStyle = '#2c333b'; b.strokeStyle = '#1c1c1c';
      c.beginPath(); c.moveTo(i * pw, 0); c.lineTo(i * pw, h); c.stroke();
      b.beginPath(); b.moveTo(i * pw, 0); b.lineTo(i * pw, h); b.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      c.beginPath(); c.moveTo(0, j * ph); c.lineTo(w, j * ph); c.stroke();
      b.beginPath(); b.moveTo(0, j * ph); b.lineTo(w, j * ph); b.stroke();
    }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) for (let k = 0; k < 8; k++) {
      for (const [x, y] of [[i * pw + 14 + k * (pw - 28) / 7, j * ph + 14], [i * pw + 14 + k * (pw - 28) / 7, (j + 1) * ph - 14]]) {
        c.fillStyle = '#4a525b'; c.beginPath(); c.arc(x, y, 4.5, 0, 6.3); c.fill();
        c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(x - 1, y - 1, 2, 0, 6.3); c.fill();
        b.fillStyle = '#e6e6e6'; b.beginPath(); b.arc(x, y, 5, 0, 6.3); b.fill();
      }
    }
    for (let k = 0; k < w / 24; k++) {
      const x = rnd() * w, y = rnd() * h, len = 20 + rnd() * 70, a = rnd() * 6.3;
      c.strokeStyle = 'rgba(80,90,100,.12)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
      b.strokeStyle = 'rgba(40,40,40,.5)'; b.lineWidth = 2;
      b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); b.stroke();
    }
    for (const { text, x, y, size } of labels) {
      stencil(c, text, x * ppm, y * ppm, size, 'rgba(60,66,74,.85)');
      stencil(b, text, x * ppm, y * ppm, size, '#505050');
    }
    return { map: canvasTexture(color), bump: canvasTexture(bump, { srgb: false }) };
  });
}

export const hullTexture = () => memo('hull', () => {
  const canvas = makeCanvas(512, 512), c = canvas.getContext('2d');
  c.fillStyle = '#b9c0c8'; c.fillRect(0, 0, 512, 512);
  c.strokeStyle = '#2c333b'; c.lineWidth = 5;
  c.strokeRect(0, 0, 512, 512);
  c.beginPath(); c.moveTo(256, 0); c.lineTo(256, 512); c.stroke();
  c.fillStyle = '#4a525b';
  for (let i = 0; i < 16; i++) for (const y of [14, 498]) { c.beginPath(); c.arc(14 + i * 32, y, 4, 0, 6.3); c.fill(); }
  return canvasTexture(canvas, { repeat: true });
});

export const gratingTextures = () => memo('grating', () => {
  const color = makeCanvas(512, 512), bump = makeCanvas(512, 512);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = '#4a525a'; c.fillRect(0, 0, 512, 512);
  b.fillStyle = '#b0b0b0'; b.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    c.fillStyle = '#23282e'; c.beginPath(); c.roundRect(i * 32 + 5, j * 32 + 7, 22, 18, 7); c.fill();
    b.fillStyle = '#707070'; b.beginPath(); b.roundRect(i * 32 + 5, j * 32 + 7, 22, 18, 7); b.fill();
  }
  // Panel seams every half metre with screw heads.
  c.strokeStyle = '#1b1f24'; c.lineWidth = 4;
  c.strokeRect(0, 0, 512, 512);
  c.beginPath(); c.moveTo(256, 0); c.lineTo(256, 512); c.moveTo(0, 256); c.lineTo(512, 256); c.stroke();
  c.fillStyle = '#9aa3ab';
  for (const [x, y] of [[8, 8], [248, 8], [264, 8], [504, 8], [8, 248], [248, 248], [264, 248], [504, 248], [8, 264], [248, 264], [264, 264], [504, 264], [8, 504], [248, 504], [264, 504], [504, 504]]) { c.beginPath(); c.arc(x, y, 3, 0, 6.3); c.fill(); }
  return { map: canvasTexture(color, { repeat: true }), bump: canvasTexture(bump, { srgb: false, repeat: true }) };
});

export const hazardTexture = () => memo('hazard', () => {
  const canvas = makeCanvas(512, 256), c = canvas.getContext('2d');
  c.fillStyle = '#15171a'; c.fillRect(0, 0, 512, 256);
  c.fillStyle = '#e0ae1c';
  for (let x = -256; x < 768; x += 64) {
    c.beginPath(); c.moveTo(x, 256); c.lineTo(x + 32, 256); c.lineTo(x + 32 + 256, 0); c.lineTo(x + 256, 0); c.fill();
  }
  const rnd = seeded(9);
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 3;
  for (let k = 0; k < 40; k++) { c.beginPath(); c.moveTo(rnd() * 512, rnd() * 256); c.lineTo(rnd() * 512, rnd() * 256); c.stroke(); }
  return canvasTexture(canvas);
});

export const occlusionTexture = () => memo('ao', () => {
  const canvas = makeCanvas(4, 64), c = canvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#9a9a9a'); g.addColorStop(0.35, '#4a4a4a'); g.addColorStop(1, '#000');
  c.fillStyle = g; c.fillRect(0, 0, 4, 64);
  return canvasTexture(canvas, { srgb: false });
});

/** Fabric weave for seats, bags and bedding: a tinted twill that tiles. */
export const fabricTexture = () => memo('fabric', () => {
  const canvas = makeCanvas(128, 128), c = canvas.getContext('2d');
  c.fillStyle = '#c8c8c8'; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 4) {
    c.fillStyle = 'rgba(0,0,0,.10)'; c.fillRect(i, 0, 2, 128);
    c.fillStyle = 'rgba(255,255,255,.10)'; c.fillRect(0, i, 128, 2);
  }
  const rnd = seeded(21);
  for (let k = 0; k < 400; k++) { c.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`; c.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
  return canvasTexture(canvas, { repeat: true });
});

/**
 * Rack module faces: one 1024 x 1024 atlas, 4 x 4 cells of 256 x 256. Each cell is a different piece of avionics or
 * life-support hardware (switch rows, connector banks, labelled strips, vents). A face picks its cell through UVs.
 */
const MODULES = [
  ['PWR DIST', 'switches'], ['AVIONICS', 'connectors'], ['LIFE SUPPORT', 'vent'], ['THERMAL', 'dials'],
  ['DATA / CMD', 'connectors'], ['CO2 SCRUB', 'vent'], ['FUEL CELL', 'dials'], ['BATTERY', 'switches'],
  ['WATER', 'dials'], ['COMMS', 'connectors'], ['NAV', 'switches'], ['FIRE SUPP', 'vent'],
  ['GALLEY', 'switches'], ['CAUTION', 'switches'], ['STOWAGE', 'vent'], ['TELEMETRY', 'connectors'],
];
export const rackAtlas = () => memo('rack', () => {
  const canvas = makeCanvas(1024, 1024), c = canvas.getContext('2d');
  const rnd = seeded(77);
  MODULES.forEach(([name, kind], i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;
    c.fillStyle = '#cfd5da'; c.fillRect(x, y, 256, 256);
    c.strokeStyle = '#7d868e'; c.lineWidth = 3; c.strokeRect(x + 3, y + 3, 250, 250);
    c.fillStyle = '#1f2a36'; c.fillRect(x + 12, y + 12, 232, 36);
    stencil(c, name, x + 128, y + 30, 22, '#e5e9ee');
    c.fillStyle = '#e0752d'; c.fillRect(x + 12, y + 52, 232, 5);
    // Screws in the corners.
    c.fillStyle = '#6b747c';
    for (const [sx, sy] of [[12, 12], [244, 12], [12, 244], [244, 244]]) { c.beginPath(); c.arc(x + sx, y + sy, 4, 0, 6.3); c.fill(); }
    if (kind === 'switches') {
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
        const sx = x + 28 + k * 38, sy = y + 90 + r * 50;
        c.fillStyle = '#10151b'; c.fillRect(sx - 9, sy - 16, 18, 32);
        c.fillStyle = rnd() > 0.5 ? '#e5e9ee' : '#e0752d'; c.fillRect(sx - 6, sy - (rnd() > 0.5 ? 14 : -2), 12, 12);
        c.fillStyle = '#394450'; c.font = `600 9px ${MONO}`; c.textAlign = 'center'; c.fillText(String.fromCharCode(65 + ((i * 7 + r * 6 + k) % 26)) + (k + 1), sx, sy + 28);
      }
    } else if (kind === 'connectors') {
      for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
        const sx = x + 38 + k * 44, sy = y + 96 + r * 52;
        c.fillStyle = '#12171d'; c.beginPath(); c.arc(sx, sy, 15, 0, 6.3); c.fill();
        c.strokeStyle = '#9aa3ab'; c.lineWidth = 3; c.beginPath(); c.arc(sx, sy, 15, 0, 6.3); c.stroke();
        c.fillStyle = '#c9a227'; for (let p = 0; p < 6; p++) { c.beginPath(); c.arc(sx + Math.cos(p) * 7, sy + Math.sin(p) * 7, 1.8, 0, 6.3); c.fill(); }
      }
      c.fillStyle = '#394450'; c.font = `600 10px ${MONO}`; c.textAlign = 'left';
      c.fillText('J1  J2  J3  J4  J5', x + 26, y + 236);
    } else if (kind === 'vent') {
      for (let k = 0; k < 9; k++) { c.fillStyle = '#12171d'; c.fillRect(x + 28, y + 76 + k * 16, 200, 8); }
      c.fillStyle = '#394450'; c.font = `600 11px ${MONO}`; c.textAlign = 'left';
      c.fillText('DO NOT BLOCK', x + 28, y + 232);
    } else {
      for (let k = 0; k < 3; k++) {
        const sx = x + 52 + k * 76, sy = y + 120;
        c.fillStyle = '#10151b'; c.beginPath(); c.arc(sx, sy, 28, 0, 6.3); c.fill();
        c.fillStyle = '#e5e9ee'; c.beginPath(); c.arc(sx, sy, 24, 0, 6.3); c.fill();
        c.strokeStyle = '#1f2a36'; c.lineWidth = 3; const a = 2 + rnd() * 3; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + Math.cos(a) * 20, sy + Math.sin(a) * 20); c.stroke();
      }
      c.fillStyle = '#e0752d'; c.fillRect(x + 28, y + 190, 200, 12);
      c.fillStyle = '#394450'; c.font = `600 10px ${MONO}`; c.textAlign = 'left'; c.fillText('PSI  TEMP  FLOW', x + 28, y + 228);
    }
  });
  return canvasTexture(canvas);
});
export const MODULE_COUNT = MODULES.length;

/** Retargets a plane's UVs to one cell of the rack atlas. */
export function moduleFace(w, h, cell) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const cx = cell % 4, cy = Math.floor(cell / 4);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i)) / 4, 1 - (cy + 1 - uv.getY(i)) / 4);
  return g;
}

/** Label strips (stencils on tape) for shelves, bins and locker doors: one atlas, 4 columns x 8 rows of 256 x 64. */
export const LABELS = ['SAMPLES', 'EVA KIT', 'TOOLS', 'MEDICAL', 'SPARES', 'CLOTHES', 'FILTERS', 'CABLES', 'WIPES', 'BATTERIES', 'O2 SPARE', 'REPAIR', 'DOCS', 'FOOD A', 'FOOD B', 'WASTE', 'REGOLITH', 'CORE 01', 'CORE 02', 'SOIL', 'ROCK', 'ICE', 'BLANK', 'DRILL BITS', 'LASER', 'CAMERA', 'LENSES', 'GLOVES', 'PLANT', 'SEEDS', 'NUTRIENT', 'PERSONAL'];
export const labelAtlas = () => memo('labels', () => {
  const canvas = makeCanvas(1024, 512), c = canvas.getContext('2d');
  LABELS.forEach((text, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 64;
    c.fillStyle = i % 5 === 0 ? '#e9b43a' : '#e9e4d6'; c.fillRect(x, y, 256, 64);
    c.strokeStyle = '#1a1c20'; c.lineWidth = 3; c.strokeRect(x + 3, y + 3, 250, 58);
    stencil(c, text, x + 128, y + 33, 30, '#17191c');
  });
  return canvasTexture(canvas);
});
export function labelStrip(w, h, index) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const cx = index % 4, cy = Math.floor(index / 4);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i)) / 4, 1 - (cy + 1 - uv.getY(i)) / 8);
  return g;
}

export function drawMarsView(c, w, h) {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#c99a73'); sky.addColorStop(0.5, '#e2b48a'); sky.addColorStop(0.52, '#a5593a'); sky.addColorStop(1, '#5b2c1e');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  c.fillStyle = '#fbe6c4'; c.beginPath(); c.arc(w * 0.72, h * 0.3, h * 0.05, 0, 6.3); c.fill();
  c.fillStyle = '#86452e';
  c.beginPath(); c.moveTo(0, h * 0.52); c.lineTo(w * 0.2, h * 0.43); c.lineTo(w * 0.34, h * 0.51); c.lineTo(w * 0.55, h * 0.45); c.lineTo(w * 0.8, h * 0.52); c.lineTo(w, h * 0.5); c.lineTo(w, h * 0.55); c.lineTo(0, h * 0.55); c.fill();
  const rnd = seeded(5);
  for (let k = 0; k < 60; k++) { c.fillStyle = `rgba(40,16,10,${0.2 + rnd() * 0.3})`; c.beginPath(); c.ellipse(rnd() * w, h * (0.58 + rnd() * 0.4), 4 + rnd() * 14, 2 + rnd() * 5, 0, 0, 6.3); c.fill(); }
}

export function drawPatch(c, w, h) {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#0f2540'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, 6.3); c.fill();
  c.strokeStyle = '#e0752d'; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 8, 0, 6.3); c.stroke();
  c.fillStyle = '#b8552b'; c.beginPath(); c.arc(w / 2, h * 0.62, w * 0.28, 0, 6.3); c.fill();
  c.fillStyle = '#fbe6c4'; c.beginPath(); c.arc(w * 0.66, h * 0.34, w * 0.07, 0, 6.3); c.fill();
  stencil(c, 'HALCYON-1', w / 2, h * 0.16, w * 0.12, '#f3e7c9');
  stencil(c, 'MARS', w / 2, h * 0.86, w * 0.12, '#f3e7c9');
}

export function drawFamilyPhoto(c, w, h) {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#3f5f86'); sky.addColorStop(0.55, '#f0a35e'); sky.addColorStop(1, '#8a4a2e');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  c.fillStyle = '#fde9b0'; c.beginPath(); c.arc(190, 150, 24, 0, 6.3); c.fill();
  c.fillStyle = '#4a3326'; c.beginPath(); c.moveTo(0, 230); c.quadraticCurveTo(80, 190, 150, 225); c.quadraticCurveTo(210, 245, 256, 215); c.lineTo(256, 320); c.lineTo(0, 320); c.fill();
  c.fillStyle = '#1c1613';
  const person = (x, base, height, width) => {
    c.beginPath(); c.arc(x, base - height, width * 0.34, 0, 6.3); c.fill();
    c.beginPath(); c.roundRect(x - width / 2, base - height * 0.82, width, height * 0.82, width * 0.3); c.fill();
  };
  person(86, 300, 118, 52); person(150, 300, 124, 56); person(118, 300, 66, 34);
}

export function drawNoteBoard(c, w, h) {
  c.fillStyle = '#9b7a52'; c.fillRect(0, 0, w, h);
  const rnd = seeded(3);
  for (let k = 0; k < 500; k++) { c.fillStyle = `rgba(60,36,16,${rnd() * 0.25})`; c.fillRect(rnd() * w, rnd() * h, 2, 2); }
  const notes = [['#f2e27a', 'CHECK\nSEALS', 20, 22, -0.06], ['#f0a0b0', 'CALL\nMOM', 150, 30, 0.05], ['#9fd6f2', 'SOL 41\nWATER', 70, 130, 0.03], ['#e8f0b0', 'PLANT\nDAY 12', 190, 140, -0.04]];
  notes.forEach(([col, text, x, y, a]) => {
    c.save(); c.translate(x + 40, y + 40); c.rotate(a);
    c.fillStyle = col; c.fillRect(-40, -40, 80, 80);
    c.fillStyle = '#e0392b'; c.beginPath(); c.arc(0, -34, 4, 0, 6.3); c.fill();
    c.fillStyle = '#2a2a2a'; c.font = `700 14px ${MONO}`; c.textAlign = 'center';
    text.split('\n').forEach((line, i) => c.fillText(line, 0, -4 + i * 18));
    c.restore();
  });
  c.strokeStyle = '#f5f1e8'; c.lineWidth = 2; c.strokeRect(6, 6, w - 12, h - 12);
}

export function drawWave(c, w, h) {
  c.strokeStyle = 'rgba(103,232,249,.2)'; c.lineWidth = 1;
  for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.strokeStyle = GREEN; c.lineWidth = 3;
  c.beginPath();
  for (let x = 0; x <= w; x += 3) {
    const k = x / w, y = h / 2 + Math.sin(k * 38) * Math.sin(k * 5 + 1) * h * 0.3 * (0.4 + Math.sin(k * 9) ** 2);
    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  c.font = `700 ${h * 0.1}px ${MONO}`; c.fillStyle = CYAN; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('SPECTRUM 8.4 GHZ', 10, 8);
}

export function drawLink(c, w, h) {
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.font = `700 ${h * 0.14}px ${MONO}`; c.fillStyle = CYAN; c.fillText('EARTH LINK', 16, 12);
  c.font = `500 ${h * 0.1}px ${MONO}`;
  c.fillStyle = AMBER; c.fillText('DELAY 08:32', 16, h * 0.34);
  c.fillStyle = CYAN; c.fillText('SIGNAL', 16, h * 0.52);
  for (let i = 0; i < 8; i++) { c.globalAlpha = i < 5 ? 1 : 0.25; c.fillRect(w * 0.4 + i * w * 0.07, h * 0.52, w * 0.05, h * 0.1); }
  c.globalAlpha = 1;
  c.fillText('MSG QUEUE  03', 16, h * 0.72);
  c.fillStyle = 'rgba(103,232,249,.5)'; c.fillText('> _', 16, h * 0.87);
}

export function drawKeys(c, w, h) {
  c.fillStyle = '#10161a'; c.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) {
    c.fillStyle = (k + r) % 5 === 0 ? '#7a8590' : '#4b545d';
    c.fillRect(10 + k * (w - 20) / 14, 10 + r * (h - 20) / 4, (w - 20) / 14 - 4, (h - 20) / 4 - 4);
  }
}

export function drawGaugeDial(c, w, h, label, frac, color = GREEN) {
  c.fillStyle = '#0a1418'; c.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.66, r = Math.min(w, h) * 0.5;
  c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = r * 0.12;
  c.beginPath(); c.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  c.strokeStyle = color; c.beginPath(); c.arc(cx, cy, r, Math.PI * 1.05, Math.PI * (1.05 + 0.9 * frac)); c.stroke();
  stencil(c, label, cx, h * 0.22, h * 0.17, color);
  stencil(c, `${Math.round(frac * 100)}%`, cx, h * 0.82, h * 0.2, color);
}

export function drawWater(c, w, h) {
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.font = `700 ${h * 0.18}px ${MONO}`; c.fillStyle = '#7dd3fc'; c.fillText('H2O  94%', 14, 10);
  c.fillStyle = 'rgba(125,211,252,.2)'; c.fillRect(14, h * 0.38, w - 28, h * 0.14);
  c.fillStyle = '#7dd3fc'; c.fillRect(14, h * 0.38, (w - 28) * 0.94, h * 0.14);
  c.font = `500 ${h * 0.13}px ${MONO}`; c.fillStyle = AMBER; c.fillText('RECYCLE  CYCLE 3', 14, h * 0.6);
  c.fillStyle = CYAN; c.fillText('FILTER OK', 14, h * 0.8);
}

export function drawAirlockSign(c, w, h) {
  c.textBaseline = 'middle'; c.textAlign = 'center';
  c.font = `700 ${h * 0.38}px ${MONO}`; c.fillStyle = RED; c.fillText('AIRLOCK', w / 2, h * 0.34);
  c.font = `500 ${h * 0.22}px ${MONO}`; c.fillStyle = AMBER; c.fillText('PRESSURE 1.01 BAR', w / 2, h * 0.76);
}

export function drawBikeStats(c, w, h) {
  c.font = `700 ${h * 0.5}px ${MONO}`; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillStyle = AMBER; c.fillText('82', w * 0.28, h * 0.45);
  c.fillStyle = CYAN; c.fillText('16.4', w * 0.72, h * 0.45);
  c.font = `500 ${h * 0.2}px ${MONO}`; c.fillText('RPM          KM', w / 2, h * 0.85);
}

export function drawSampleLog(c, w, h) {
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.font = `700 ${h * 0.16}px ${MONO}`; c.fillStyle = '#c4b5fd'; c.fillText('SAMPLE LOG', 12, 8);
  c.font = `500 ${Math.min(h * 0.12, w / 19)}px ${MONO}`; c.fillStyle = CYAN;
  ['S-014  BASALT   OK', 'S-015  REGOLITH OK', 'S-016  ICE CORE  COLD', 'S-017  --- EMPTY ---'].forEach((t, i) => c.fillText(t, 12, h * (0.3 + i * 0.17)));
}

export function drawPilotNav(c, w, h) {
  c.fillStyle = '#071417'; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(103,232,249,.3)'; c.lineWidth = 1;
  for (let a = 1; a < 4; a++) { c.beginPath(); c.arc(w / 2, h / 2, a * h * 0.12, 0, 6.3); c.stroke(); }
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
  c.fillStyle = GREEN; c.beginPath(); c.arc(w * 0.6, h * 0.4, 5, 0, 6.3); c.fill();
  stencil(c, 'SURFACE NAV', w / 2, h * 0.08, h * 0.09, CYAN);
}

export function drawSystems(c, w, h) {
  c.textBaseline = 'middle'; c.textAlign = 'left';
  [['O2', 0.92, GREEN], ['PWR', 0.78, GREEN], ['CO2', 0.31, AMBER], ['H2O', 0.94, CYAN], ['TEMP', 0.6, GREEN]].forEach(([name, f, col], i) => {
    const y = h * (0.14 + i * 0.17);
    c.font = `700 ${h * 0.1}px ${MONO}`; c.fillStyle = col; c.fillText(name, 10, y);
    c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(w * 0.3, y - h * 0.04, w * 0.62, h * 0.08);
    c.fillStyle = col; c.fillRect(w * 0.3, y - h * 0.04, w * 0.62 * f, h * 0.08);
  });
}

export function drawPouchAtlas(c) {
  const POUCHES = [['STEW', '#b45309'], ['OATS', '#a16207'], ['COFFEE', '#44403c'], ['RICE', '#0f766e'], ['CURRY', '#c2410c'], ['APPLE', '#65a30d']];
  POUCHES.forEach(([name, color], i) => {
    const x = (i % 3) * 256, y = Math.floor(i / 3) * 256;
    c.fillStyle = '#e9e4d6'; c.fillRect(x, y, 256, 256);
    c.fillStyle = color; c.fillRect(x, y, 256, 96);
    stencil(c, name, x + 128, y + 160, 46, '#16181b');
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x + 40, y + 206, 176, 8);
  });
}
export const pouchAtlas = () => memo('pouch', () => {
  const canvas = makeCanvas(768, 512);
  drawPouchAtlas(canvas.getContext('2d'));
  return canvasTexture(canvas);
});
