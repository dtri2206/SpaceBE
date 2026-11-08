import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pbr, interiorEnvironment } from './interiors.js';

/**
 * createRover() serves the Blender model public/assets/models/rover.glb (scripts/blender/rover.py) once it has loaded and
 * falls back to the code-built rover below until then (or if the file is missing).
 *
 * Crewed Mars rover in the style of a modern lunar terrain vehicle: a dark carbon-weave exoskeleton (sloped A-pillars, a thick
 * roof slab, thick rear pillars) around a high-waisted open cabin with no glass, big white faceted side panels with the game
 * logo, a row of three battery modules under each side, gold suspension brackets, very wide woven airless tyres on deep dark
 * hubs, and an open rear equipment bay under a solar roof with a folded robotic arm. Role 2 drives it (src/surface/roverModel.js).
 * Metres, +Y up, forward is -Z, +X is the rover's right. The origin is on the ground at the middle of the wheelbase and track,
 * the wheels rest on y = 0 and the root has no transform.
 *
 *   root
 *    +- body meshes (static, merged per material)
 *    +- wheelFL / wheelFR / wheelRL / wheelRR  pivots at the wheel centres: Role 2 sets pivot.rotation.y (steering)
 *         +- children[0]  the spinning wheel, symmetric around the X axle: Role 2 sets rotation.x
 *
 * userData.setDust(0..1) turns the paint and fabric dusty and dulls the LEDs. Every rover has its own materials, geometries
 * are shared. No lights: LED strips, markers and screens glow through emissive materials only.
 */

const WHEELBASE = 2.29, TRACK = 1.83, R = 0.41;
const HB = WHEELBASE / 2, HT = TRACK / 2;
const HW = 0.8;                  // half width of the cabin body
const ZF = -1.4, ZR = 1.6;      // nose and tail
const BT = 0.012;                // bevel on panels: gives the recessed seams
const DUST = new THREE.Color(0xb27a54);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------------------------------------------------------------- shared textures and geometries */

const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

function canvasTexture(w, h, paint, { colour = true, repeat = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(canvas);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Dash display: attitude ball, heading, speed, range, power and temperature, as an emissive texture.
const consoleScreen = () => memo('screen', () => canvasTexture(512, 288, (c, w, h) => {
  c.fillStyle = '#031014';
  c.fillRect(0, 0, w, h);
  const cyan = '#5ad8ee', amber = '#f2a53c';
  c.strokeStyle = cyan;
  c.fillStyle = cyan;
  c.lineWidth = 3;
  c.font = 'bold 22px monospace';
  c.save();
  c.beginPath(); c.arc(110, 140, 82, 0, 6.3); c.clip();
  c.fillStyle = '#12606f'; c.fillRect(0, 0, 220, 140);
  c.fillStyle = '#6b4a1a'; c.fillRect(0, 140, 220, 160);
  c.restore();
  c.beginPath(); c.arc(110, 140, 82, 0, 6.3); c.stroke();
  c.beginPath(); c.moveTo(40, 140); c.lineTo(180, 140); c.moveTo(110, 120); c.lineTo(110, 160); c.stroke();
  c.fillText('ATT', 82, 252);
  c.beginPath(); c.arc(300, 98, 50, 0, 6.3); c.stroke();
  for (let a = 0; a < 12; a++) { c.beginPath(); c.moveTo(300 + Math.cos(a * 0.5236) * 42, 98 + Math.sin(a * 0.5236) * 42); c.lineTo(300 + Math.cos(a * 0.5236) * 50, 98 + Math.sin(a * 0.5236) * 50); c.stroke(); }
  c.fillStyle = amber; c.beginPath(); c.moveTo(300, 54); c.lineTo(308, 98); c.lineTo(292, 98); c.fill();
  c.fillStyle = cyan; c.fillText('HDG 247', 244, 186);
  c.fillText('SPD  8.2', 224, 224);
  c.fillText('RNG 12.4', 224, 256);
  c.fillText('PWR', 410, 60);
  c.fillText('TMP', 410, 170);
  c.strokeRect(412, 72, 70, 20); c.fillStyle = cyan; c.fillRect(416, 76, 52, 12);
  c.strokeRect(412, 182, 70, 20); c.fillStyle = amber; c.fillRect(416, 186, 38, 12);
}));

// Small status panel.
const stationScreen = () => memo('station', () => canvasTexture(256, 160, (c, w, h) => {
  c.fillStyle = '#031014';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#5ad8ee';
  c.fillStyle = '#5ad8ee';
  c.lineWidth = 2;
  c.font = 'bold 18px monospace';
  c.fillText('CARGO  OK', 16, 30);
  c.fillText('LOCK   ON', 16, 56);
  for (let i = 0; i < 6; i++) c.strokeRect(16 + i * 38, 84, 30, 14);
  for (let i = 0; i < 4; i++) c.fillRect(18 + i * 38, 86, 26, 10);
  c.fillStyle = '#f2a53c';
  c.fillText('SAMPLES 3', 16, 136);
}));

// Dark blue solar cells with thin silver grid lines.
const solarTexture = () => memo('solar', () => canvasTexture(512, 256, (c, w, h) => {
  c.fillStyle = '#0a1738';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#10265a';
  for (let x = 0; x < w; x += 32) for (let y = 0; y < h; y += 32) c.fillRect(x + 2, y + 2, 28, 28);
  c.strokeStyle = '#aab8d0';
  c.lineWidth = 1.5;
  for (let x = 0; x <= w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = 0; y <= h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.strokeStyle = '#d4deee';
  c.lineWidth = 3;
  for (let x = 0; x <= w; x += 128) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  c.fillStyle = 'rgba(140,180,240,0.12)';
  c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.5, 0); c.lineTo(0, h * 0.7); c.fill();
}));

// Subtle carbon twill for the frame (tiles; the batch maps it in world space).
const carbonTexture = () => memo('carbon', () => canvasTexture(64, 64, (c, w, h) => {
  c.fillStyle = '#9aa6b4';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const on = (i + j) % 2 === 0;
      c.fillStyle = on ? '#98a5b4' : '#b4bfcb';
      c.fillRect(i * 8, j * 8, 8, 8);
      c.strokeStyle = on ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
      c.lineWidth = 1;
      for (let k = 0; k < 8; k += 2) {
        c.beginPath();
        if (on) { c.moveTo(i * 8, j * 8 + k); c.lineTo(i * 8 + 8, j * 8 + k); } else { c.moveTo(i * 8 + k, j * 8); c.lineTo(i * 8 + k, j * 8 + 8); }
        c.stroke();
      }
    }
  }
}, { repeat: true }));

// Faint hexagon facets on the white panels: two hexagons across, four rows.
const hexTexture = () => memo('hex', () => canvasTexture(104, 180, (c, w, h) => {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(120,135,150,0.28)';
  c.lineWidth = 1.5;
  const s = 30.02;
  for (let row = -1; row <= 4; row++) {
    for (let col = -1; col <= 2; col++) {
      const cx = col * 52 + (row & 1 ? 26 : 0), cy = row * 45;
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        c[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * s, cy + Math.sin(a) * s);
      }
      c.closePath();
      c.stroke();
    }
  }
}, { repeat: true }));

// Square steel mesh for the grille panels.
const meshTexture = () => memo('mesh', () => canvasTexture(32, 32, (c, w, h) => {
  c.fillStyle = '#0c1014';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#8f9ba8';
  c.lineWidth = 3;
  c.strokeRect(0, 0, w, h);
}, { repeat: true }));

// Fine knit of the airless tyre: light stitches over dark gaps (also used as the bump map).
const knitTexture = () => memo('knit', () => {
  const t = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#4d535a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e6eaee';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    for (let y = 0; y < h; y += 8) {
      for (let x = 0; x < w; x += 16) {
        c.beginPath(); c.moveTo(x, y + 1); c.lineTo(x + 8, y + 7); c.lineTo(x + 16, y + 1); c.stroke();
      }
    }
  }, { repeat: true });
  t.repeat.set(16, 5);
  return t;
});

// Side decal on the big white panel: emblem (cyan circle with a small rocket), game name and mission code on transparent.
const decalTexture = () => memo('decal', () => canvasTexture(1024, 512, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  // emblem
  c.fillStyle = '#12b5d0';
  c.beginPath(); c.arc(140, 150, 110, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#0b3d48'; c.lineWidth = 8;
  c.beginPath(); c.arc(140, 150, 98, 0, Math.PI * 2); c.stroke();
  c.save();
  c.translate(140, 150); c.rotate(0.7);
  c.fillStyle = '#ffffff';
  c.beginPath(); c.moveTo(0, -78); c.quadraticCurveTo(26, -34, 22, 32); c.lineTo(-22, 32); c.quadraticCurveTo(-26, -34, 0, -78); c.fill();
  c.fillStyle = '#0b3d48';
  c.beginPath(); c.arc(0, -16, 11, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath(); c.moveTo(-22, 8); c.lineTo(-44, 46); c.lineTo(-22, 34); c.fill();
  c.beginPath(); c.moveTo(22, 8); c.lineTo(44, 46); c.lineTo(22, 34); c.fill();
  c.fillStyle = '#ffb02e';
  c.beginPath(); c.moveTo(-10, 34); c.lineTo(0, 66); c.lineTo(10, 34); c.fill();
  c.restore();
  c.fillStyle = '#20252b';
  c.font = '900 118px "Arial Black", Arial, Helvetica, sans-serif';
  c.textBaseline = 'alphabetic';
  c.fillText('SPACEB&E', 280, 120);
  c.font = 'bold 82px Arial, Helvetica, sans-serif';
  c.fillStyle = '#3a4048';
  c.fillText('MR-01', 282, 232);
  c.fillStyle = '#12b5d0';
  c.fillRect(282, 262, 700, 12);
  c.fillStyle = '#20252b';
  c.fillRect(282, 292, 150, 7);
}));

const unitBox = () => memo('box', () => new THREE.BoxGeometry(1, 1, 1));
const unitTube = () => memo('tube', () => new THREE.CylinderGeometry(1, 1, 1, 10));
const rbox = (w, h, d, r) => memo(`rbox${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));

const flat = (g) => (g.index ? g.toNonIndexed() : g);
const mergeAll = (list) => mergeGeometries(list.map(flat), false);

// UVs from world position, by dominant normal axis: textures keep the same scale on every part. k = tiles per metre.
function worldUV(g, k) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) * k, p.getY(i) * k);
    else if (ay >= az) uv.setXY(i, p.getX(i) * k, p.getZ(i) * k);
    else uv.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
}

/* ---------------------------------------------------------------- panel geometry */

// A side profile (z, y points) extruded across x from x0 to x1, with bevelled edges that read as panel seams.
function sideExtrude(points, x0, x1, bevel = BT) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, bevel);
  g.rotateY(-Math.PI / 2); // local x -> world z, local z -> world -x
  g.translate(x1, 0, 0);
  return g;
}

// A top-view outline (x, z points) extruded upward from y0 by h.
function slab(points, y0, h, bevel = BT, segs = 1) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: segs });
  g.translate(0, 0, bevel);
  g.rotateX(-Math.PI / 2); // local y -> -z, local z -> up
  g.translate(0, y0, 0);
  return g;
}

// Rounded rectangle outline (x, z), counter-clockwise points.
function rrect(x0, x1, z0, z1, r, seg = 4) {
  const pts = [];
  const corner = (cx, cz, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  corner(x1 - r, z1 - r, 0);
  corner(x0 + r, z1 - r, Math.PI / 2);
  corner(x0 + r, z0 + r, Math.PI);
  corner(x1 - r, z0 + r, Math.PI * 1.5);
  return pts;
}

/* ---------------------------------------------------------------- body batching */

// Collects static parts and merges them into one mesh per material, so the body costs a handful of draw calls.
function createBatch() {
  const groups = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const up = V(0, 1, 0);
  const put = (material, geometry, position, quaternion, scale = one) => {
    m.compose(position, quaternion, scale);
    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push(flat(geometry).clone().applyMatrix4(m));
  };
  const api = {
    geo(material, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale) {
      put(material, geometry, V(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), scale);
    },
    box(material, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
      put(material, unitBox(), V(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), V(w, h, d));
    },
    strut(material, a, b, radius) {
      const dir = b.clone().sub(a);
      put(material, unitTube(), a.clone().add(b).multiplyScalar(0.5), q.setFromUnitVectors(up, dir.clone().normalize()), V(radius, dir.length(), radius));
    },
    // a flat bar from a to b: `width` across x, `t` thick; never exactly vertical
    bar(material, a, b, width, t) {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const o = new THREE.Object3D();
      o.position.copy(mid);
      o.lookAt(b);
      put(material, unitBox(), mid, o.quaternion, V(width, t, a.distanceTo(b)));
    },
    build(parent) {
      for (const [material, list] of groups) {
        const geometry = mergeGeometries(list, false);
        if (material.userData.worldUV) worldUV(geometry, material.userData.worldUV);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        list.forEach((g) => g.dispose());
      }
    },
  };
  return api;
}

/* ---------------------------------------------------------------- materials (one set per rover, so dust is per rover) */

function createMaterials() {
  const dusty = [];
  const glowing = [];
  const make = (color, roughness, metalness, extra = {}, dust = 0.8, uvScale = 0) => {
    const material = pbr(color, roughness, metalness, { envMapIntensity: metalness > 0.5 ? 0.9 : 0.55, ...extra });
    if (uvScale) material.userData.worldUV = uvScale;
    dusty.push({ material, base: new THREE.Color(color), roughness, metalness, dust });
    return material;
  };
  const led = (color, emissive, intensity) => {
    const material = pbr(color, 0.4, 0, { emissive, emissiveIntensity: intensity });
    glowing.push({ material, intensity });
    return material;
  };
  const materials = {
    white: make(0xeceff2, 0.24, 0.12, { map: hexTexture(), envMapIntensity: 0.75 }, 0.9, 3),
    silver: make(0xc3c9cf, 0.3, 0.45, { envMapIntensity: 0.8 }, 0.9),
    frame: make(0x4f6074, 0.4, 0.4, { map: carbonTexture() }, 0.85, 9),
    graphite: make(0x24282d, 0.5, 0.35),
    inset: make(0x3b4048, 0.5, 0.4),
    liner: make(0x15181c, 0.8, 0.1, { side: THREE.DoubleSide }, 0.8),
    seat: make(0x2c3036, 0.85, 0.02, {}, 0.7),
    strap: make(0x4b5159, 0.8, 0, {}, 0.6),
    tyre: make(0xc9ced3, 0.9, 0, { side: THREE.DoubleSide, map: knitTexture(), bumpMap: knitTexture(), bumpScale: 1.6, envMapIntensity: 0.45 }, 0.95),
    dish: make(0x0a0e15, 0.5, 0.55, { side: THREE.DoubleSide }, 0.7),
    spoke: make(0x55606b, 0.4, 0.7, {}, 0.8),
    ring: make(0xe3e8ec, 0.22, 0.9),
    gold: make(0xb48c3c, 0.38, 0.8, {}, 0.7),
    grille: make(0x7b8794, 0.5, 0.5, { map: meshTexture(), side: THREE.DoubleSide }, 0.7, 22),
    solar: make(0xffffff, 0.3, 0.45, { map: solarTexture(), envMapIntensity: 1 }, 0.6),
    decal: make(0xffffff, 0.45, 0, { map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }, 0.6),
    ledCyan: led(0x0a2c33, 0x67e8f9, 1.0),
    screen: pbr(0x05080a, 0.35, 0, { emissive: 0xffffff, emissiveMap: consoleScreen(), emissiveIntensity: 0.85 }),
    station: pbr(0x05080a, 0.35, 0, { emissive: 0xffffff, emissiveMap: stationScreen(), emissiveIntensity: 0.8 }),
  };
  glowing.push({ material: materials.screen, intensity: 0.85 }, { material: materials.station, intensity: 0.8 });
  const tmp = new THREE.Color();
  const setDust = (amount) => {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const d of dusty) {
      d.material.color.copy(tmp.copy(d.base).lerp(DUST, 0.8 * t * d.dust));
      d.material.roughness = THREE.MathUtils.lerp(d.roughness, 0.95, t * d.dust);
      d.material.metalness = THREE.MathUtils.lerp(d.metalness, d.metalness * 0.3, t * d.dust);
    }
    for (const g of glowing) g.material.emissiveIntensity = g.intensity * (1 - 0.35 * t);
  };
  return { materials, setDust };
}

/* ---------------------------------------------------------------- wheels */

// Wide airless tyre with bulging balloon sidewalls, and a deep dark dish hub with six thick spokes and a ring.
const wheelParts = () => memo('wheelParts', () => {
  const half = [[0.24, 0.165], [0.265, 0.184], [0.31, 0.196], [0.355, 0.192], [0.385, 0.17], [0.402, 0.13], [0.409, 0.07], [0.41, 0]];
  const profile = [...half.map(([r, a]) => [r, -a]), ...half.slice(0, -1).reverse().map(([r, a]) => [r, a])].map(([r, a]) => new THREE.Vector2(r, a));
  const tyre = new THREE.LatheGeometry(profile, 56).rotateZ(Math.PI / 2);

  const dishList = [], spokes = [], rings = [], caps = [];
  for (const sx of [-1, 1]) {
    // dish: the rim lip is at the tyre opening, the floor sits 10 cm deeper
    const d = [[0.256, 0.18], [0.248, 0.13], [0.22, 0.095], [0.15, 0.07], [0.07, 0.058], [0.0, 0.058]].map(([r, a]) => new THREE.Vector2(r, -sx * a));
    dishList.push(new THREE.LatheGeometry(d, 28).rotateZ(Math.PI / 2));
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BoxGeometry(0.07, 0.13, 0.1);
      g.translate(sx * 0.1, 0.165, 0);
      g.rotateX((i / 6) * Math.PI * 2);
      spokes.push(g);
    }
    caps.push(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 18).rotateZ(Math.PI / 2).translate(sx * 0.095, 0, 0));
    rings.push(new THREE.TorusGeometry(0.256, 0.017, 6, 40).rotateY(Math.PI / 2).translate(sx * 0.178, 0, 0));
  }
  caps.push(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12).rotateZ(Math.PI / 2));
  return { tyre, dish: mergeAll(dishList), spokes: mergeAll([...spokes, ...caps]), ring: mergeAll(rings) };
});

// Symmetric around the X axle: tyre, dark dishes, spokes and rings. Role 2 spins this group around x.
function createWheel(materials) {
  const g = wheelParts();
  const spin = new THREE.Group();
  spin.name = 'wheelSpin';
  for (const [geometry, material] of [[g.tyre, materials.tyre], [g.dish, materials.dish], [g.spokes, materials.spoke], [g.ring, materials.ring]]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    spin.add(mesh);
  }
  return spin;
}

/* ---------------------------------------------------------------- parts of the body */

// Underbody, floor, and the three battery modules under each side.
function chassis(b, mat) {
  b.box(mat.graphite, 1.16, 0.14, 2.5, 0, 0.32, 0.0); // skid tub, narrow enough for the steered tyres
  b.box(mat.liner, 1.4, 0.03, 0.95, 0, 0.405, -0.44); // cabin floor
  b.box(mat.inset, 0.9, 0.03, 0.5, 0, 0.245, 0.2); // skid plate
  b.box(mat.inset, 0.7, 0.03, 0.5, 0, 0.245, -1.1);
  for (const sx of [-1, 1]) {
    b.box(mat.frame, 0.22, 0.04, 1.5, sx * 0.69, 0.24, 0); // rail under the modules
    b.box(mat.graphite, 0.18, 0.3, 1.36, sx * 0.69, 0.43, 0); // dark back plate, shows as gaps
    for (let i = -1; i <= 1; i++) {
      const z = i * 0.44;
      b.geo(mat.graphite, rbox(0.2, 0.34, 0.4, 0.05), sx * 0.69, 0.43, z);
      b.box(mat.inset, 0.012, 0.04, 0.3, sx * 0.795, 0.565, z); // lighter bevel strip along the top
      b.box(mat.ledCyan, 0.014, 0.026, 0.026, sx * 0.797, 0.46, z); // status LED
      b.box(mat.inset, 0.012, 0.18, 0.3, sx * 0.794, 0.42, z); // recessed face
    }
  }
}

// White nose with angled facets, hood ledge, the low walls under the window and the dash.
function nose(b, mat) {
  // lower nose: narrow so the steered tyres clear it
  b.geo(mat.white, sideExtrude([[-1.26, 0.5], [ZF, 0.64], [ZF, 0.8], [-1.3, 0.88], [-0.62, 0.88], [-0.62, 0.5]], -0.6, 0.6, 0.02));
  b.geo(mat.white, sideExtrude([[-1.3, 0.82], [ZF, 0.89], [ZF, 0.95], [-0.7, 0.95], [-0.7, 0.82]], -HW, HW, 0.02)); // upper tier above the tyres
  b.geo(mat.frame, slab(rrect(-0.84, 0.84, ZF - 0.04, -0.7, 0.07, 3), 0.95, 0.055, 0.016)); // hood ledge
  b.box(mat.graphite, 1.4, 0.62, 0.03, 0, 0.7, -0.715); // dash face under the ledge
  b.box(mat.frame, 1.0, 0.09, 0.07, 0, 0.55, ZF - 0.03); // bumper
  b.box(mat.inset, 0.9, 0.1, 0.02, 0, 0.74, ZF - 0.012); // grille
  for (let i = 0; i < 4; i++) b.box(mat.graphite, 0.82, 0.008, 0.01, 0, 0.7 + i * 0.026, ZF - 0.026);
  b.box(mat.ledCyan, 0.62, 0.022, 0.012, 0, 0.84, ZF - 0.012); // light strip across the nose
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) b.box(mat.graphite, 0.34, 0.006, 0.026, sx * 0.4, 1.011, -1.2 + i * 0.1); // vents on the ledge
  for (const sx of [-1, 1]) {
    b.geo(mat.white, sideExtrude([[-0.66, 0.6], [-0.66, 0.95], [-0.38, 0.95], [-0.38, 0.6]], sx > 0 ? 0.7 : -HW, sx > 0 ? HW : -0.7, 0.014));
    b.geo(mat.frame, slab(rrect(sx * 0.76 - 0.1, sx * 0.76 + 0.1, -0.72, -0.36, 0.03, 2), 0.95, 0.055, 0.014)); // sill rails
    b.box(mat.liner, 0.012, 0.36, 0.5, sx * 0.694, 0.78, -0.5); // inner wall liner
    // C-shaped LED bracket at each lower front corner
    const x = sx * 0.63, z = ZF - 0.03;
    b.box(mat.graphite, 0.1, 0.2, 0.03, x, 0.7, z + 0.008);
    b.box(mat.ledCyan, 0.016, 0.16, 0.014, x + sx * 0.04, 0.7, z - 0.006);
    for (const dy of [-0.08, 0.08]) b.box(mat.ledCyan, 0.08, 0.016, 0.014, x, 0.7 + dy, z - 0.006);
    b.box(mat.ledCyan, 0.03, 0.03, 0.03, sx * 0.797, 0.66, ZF + 0.3); // marker on the side
  }
}

// The hero: tall white faceted panels with the logo, carbon edges, and the exoskeleton pillars.
function sidesAndFrame(b, mat) {
  const hex = [[-0.4, 1.0], [-0.15, 1.72], [0.4, 1.72], [0.45, 1.0], [0.4, 0.6], [-0.3, 0.6]];
  const decalPlane = memo('decalPlane', () => new THREE.PlaneGeometry(0.66, 0.33));
  for (const sx of [-1, 1]) {
    const [x0, x1] = sx > 0 ? [0.72, 0.845] : [-0.845, -0.72];
    b.geo(mat.white, sideExtrude(hex, x0, x1, 0.018));
    b.bar(mat.frame, V(sx * 0.842, 0.99, -0.4), V(sx * 0.842, 1.71, -0.15), 0.05, 0.07); // diagonal front edge
    b.box(mat.frame, 0.05, 0.1, 0.6, sx * 0.842, 0.62, 0.05);
    b.geo(mat.decal, decalPlane, sx * 0.849, 1.08, 0.1, 0, sx * Math.PI / 2, 0);
    b.box(mat.graphite, 0.006, 0.012, 0.4, sx * 0.848, 1.5, 0.2); // seam lines
    b.bar(mat.graphite, V(sx * 0.848, 0.72, -0.2), V(sx * 0.848, 0.9, 0.35), 0.006, 0.012);
    b.box(mat.graphite, 0.006, 0.012, 0.55, sx * 0.848, 0.86, 0.1);

    // A-pillar: steep and thick from the nose up to the roof front
    b.bar(mat.frame, V(sx * HW, 0.98, -1.38), V(sx * HW, 1.76, -0.95), 0.16, 0.14);
    b.bar(mat.frame, V(sx * 0.72, 1.0, -1.24), V(sx * 0.72, 1.72, -0.9), 0.05, 0.05); // inner slim member
    b.box(mat.frame, 0.16, 0.1, 0.15, sx * HW, 0.99, -1.4); // foot
    // rear pillar of the white block and the thick C-pillar
    b.box(mat.frame, 0.14, 0.74, 0.12, sx * HW, 1.36, 0.51);
    b.bar(mat.frame, V(sx * HW, 0.97, ZR + 0.05), V(sx * HW, 1.7, ZR - 0.05), 0.14, 0.14);
    // LED marker dots
    for (const [y, z] of [[1.22, -1.27], [1.5, -1.1]]) b.box(mat.ledCyan, 0.012, 0.03, 0.03, sx * (HW + 0.088), y, z);
    b.box(mat.ledCyan, 0.012, 0.03, 0.03, sx * (HW + 0.078), 1.7, 0.51);
    b.box(mat.ledCyan, 0.03, 0.03, 0.012, sx * (HW - 0.01), 1.0, ZR + 0.052);
    b.box(mat.ledCyan, 0.012, 0.03, 0.03, sx * (HW + 0.078), 1.2, ZR - 0.05);
  }
}

function seats(b, mat) {
  const dz = -0.67; // seats sit forward, under the cabin opening
  const shell = memo('seatShell', () => sideExtrude([[0.05, 0.42], [0.05, 0.58], [0.34, 0.55], [0.5, 1.06], [0.6, 1.04], [0.62, 0.42]], -0.23, 0.23));
  for (const x of [-0.32, 0.32]) {
    b.geo(mat.seat, shell, x, 0, dz);
    for (const sx of [-1, 1]) b.box(mat.seat, 0.06, 0.2, 0.36, x + sx * 0.215, 0.66, 0.24 + dz, 0.3);
    b.box(mat.seat, 0.07, 0.38, 0.1, x - 0.2, 0.86, 0.52 + dz, 0.3);
    b.box(mat.seat, 0.07, 0.38, 0.1, x + 0.2, 0.86, 0.52 + dz, 0.3);
    b.geo(mat.seat, rbox(0.3, 0.2, 0.09, 0.03), x, 1.2, 0.56 + dz, 0.25); // headrest
    b.box(mat.silver, 0.1, 0.06, 0.1, x, 1.0, 0.5 + dz, 0.25);
    for (const ddx of [-0.1, 0.1]) b.bar(mat.strap, V(x + ddx, 1.12, 0.5 + dz), V(x + ddx * 1.6, 0.6, 0.2 + dz), 0.045, 0.01);
    b.bar(mat.strap, V(x - 0.22, 0.52, 0.45 + dz), V(x - 0.04, 0.6, 0.18 + dz), 0.045, 0.01);
    b.bar(mat.strap, V(x + 0.22, 0.52, 0.45 + dz), V(x + 0.04, 0.6, 0.18 + dz), 0.045, 0.01);
    b.box(mat.silver, 0.07, 0.025, 0.05, x, 0.6, 0.17 + dz);
    b.box(mat.inset, 0.5, 0.04, 0.4, x, 0.42, 0.3 + dz);
  }
  b.box(mat.graphite, 1.44, 0.9, 0.04, 0, 0.9, 0.02); // rear wall behind the seats
  b.box(mat.inset, 0.2, 0.3, 0.5, 0, 0.55, -0.37); // centre console
  b.box(mat.inset, 0.13, 0.04, 0.1, 0, 0.72, -0.57);
  b.strut(mat.silver, V(0, 0.72, -0.57), V(0, 0.92, -0.57), 0.014);
  b.box(mat.graphite, 0.05, 0.06, 0.07, 0, 0.94, -0.57);
}

// Low dash pod on the hood ledge with two emissive displays (everything stays under y 1.05).
function dash(b, mat) {
  const z0 = -0.86;
  b.box(mat.graphite, 1.3, 0.05, 0.28, 0, 1.03, z0);
  const tilt = -0.65;
  for (const [x, w, h, m] of [[-0.32, 0.46, 0.1, mat.screen], [0.32, 0.4, 0.1, mat.station]]) {
    b.box(mat.graphite, w + 0.03, h + 0.025, 0.03, x, 1.045, z0 - 0.01, tilt);
    b.geo(m, memo(`face${w}`, () => new THREE.PlaneGeometry(w, h)), x, 1.045 + 0.0165 * Math.sin(-tilt), z0 - 0.01 + 0.0165 * Math.cos(tilt), tilt);
  }
}

// One thick cabin roof slab with a raised centre over the cabin and white block, a lower flat solar roof over the bay.
function roof(b, mat) {
  const y0 = 1.72;
  b.geo(mat.frame, slab(rrect(-0.88, 0.88, -1.0, 0.5, 0.2, 5), y0, 0.12, 0.036, 2));
  b.geo(mat.frame, slab(rrect(-0.6, 0.6, -0.8, 0.3, 0.15, 4), y0 + 0.12, 0.02, 0.008));
  b.box(mat.inset, 1.7, 0.012, 1.4, 0, y0 - 0.004, -0.25);
  // bay roof with the solar panel, continuing to the back
  b.geo(mat.frame, slab(rrect(-0.84, 0.84, 0.44, ZR + 0.02, 0.06, 3), 1.64, 0.07, 0.014));
  b.geo(mat.solar, memo('solarPlane', () => new THREE.PlaneGeometry(1.5, 1.04).rotateX(-Math.PI / 2)), 0, 1.7145, 1.06);
  for (const sx of [-1, 1]) {
    b.box(mat.graphite, 0.08, 0.045, 0.52, sx * 0.78, 1.86, -0.7);
    b.box(mat.ledCyan, 0.05, 0.03, 0.5, sx * 0.78, 1.882, -0.7);
    b.box(mat.ledCyan, 0.03, 0.03, 0.03, sx * 0.9, 1.78, -0.8);
  }
  // dish and camera mast above the white block, whip antenna at the back
  b.strut(mat.silver, V(-0.2, 1.86, 0.02), V(-0.2, 1.97, 0.02), 0.022);
  b.geo(mat.silver, memo('dish', () => {
    const p = [];
    for (let i = 0; i <= 8; i++) { const r = (i / 8) * 0.17; p.push(new THREE.Vector2(r, 1.4 * r * r)); }
    return new THREE.LatheGeometry(p, 20);
  }), -0.2, 1.995, 0.0, -0.55);
  b.geo(mat.graphite, memo('dishDisc', () => new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8)), -0.2, 1.995, 0.02);
  b.strut(mat.silver, V(-0.2, 2.0, 0.02), V(-0.2, 2.0 + Math.cos(0.55) * 0.17, 0.02 - Math.sin(0.55) * 0.17 - 0.02), 0.005);
  b.strut(mat.silver, V(0.4, 1.86, 0.25), V(0.4, 2.0, 0.25), 0.02);
  b.geo(mat.graphite, rbox(0.12, 0.09, 0.12, 0.025), 0.4, 2.05, 0.25);
  b.box(mat.ledCyan, 0.035, 0.035, 0.012, 0.4, 2.05, 0.19);
  b.strut(mat.graphite, V(0.74, 1.71, 1.5), V(0.74, 2.3, 1.5), 0.007);
}

// Open rear bay: frame box, shelf with equipment, grille panels, light strips, and a folded robotic arm.
function bay(b, mat) {
  b.geo(mat.graphite, sideExtrude([[0.45, 0.5], [0.45, 0.9], [ZR, 0.9], [ZR, 0.5]], -0.6, 0.6, 0.02));
  b.geo(mat.silver, slab(rrect(-0.82, 0.82, 0.45, ZR + 0.02, 0.05, 3), 0.9, 0.09, 0.014)); // shelf deck
  b.box(mat.ledCyan, 0.5, 0.02, 0.012, 0, 0.7, ZR + 0.012);
  b.box(mat.frame, 1.6, 0.1, 0.1, 0, 1.02, ZR - 0.05); // rear sill beam
  b.box(mat.frame, 1.6, 0.12, 0.12, 0, 1.6, ZR - 0.06); // rear header
  b.box(mat.frame, 1.6, 0.1, 0.1, 0, 1.6, 0.52); // front beam under the bay roof
  const pts = [[0.9, 1.1], [1.52, 1.1], [1.52, 1.56], [1.15, 1.56]];
  for (const sx of [-1, 1]) {
    // diagonal mesh grille panel on the side (front edge slanted)
    b.geo(mat.grille, memo(`grille${sx}`, () => {
      const shape = new THREE.Shape();
      pts.forEach(([z, y], i) => (i ? shape.lineTo(sx > 0 ? -z : z, y) : shape.moveTo(sx > 0 ? -z : z, y)));
      return new THREE.ShapeGeometry(shape).rotateY(sx * Math.PI / 2);
    }), sx * (HW - 0.02), 0, 0);
    b.bar(mat.frame, V(sx * (HW - 0.02), 1.1, 0.9), V(sx * (HW - 0.02), 1.56, 1.15), 0.04, 0.04);
    b.box(mat.frame, 0.04, 0.04, 0.64, sx * (HW - 0.02), 1.1, 1.21);
    b.box(mat.frame, 0.04, 0.04, 0.4, sx * (HW - 0.02), 1.56, 1.35);
    b.box(mat.frame, 0.04, 0.5, 0.04, sx * (HW - 0.02), 1.33, 1.52);
    b.box(mat.ledCyan, 0.05, 0.018, 0.5, sx * 0.45, 1.622, 1.05); // light strips under the bay roof
    b.box(mat.graphite, 0.08, 0.014, 0.54, sx * 0.45, 1.63, 1.05);
  }
  // equipment on the shelf: graphite boxes with cyan labels, a silver tank
  b.geo(mat.graphite, rbox(0.46, 0.34, 0.4, 0.03), -0.42, 1.14, 0.98);
  b.box(mat.ledCyan, 0.3, 0.02, 0.01, -0.42, 1.18, 1.18);
  b.box(mat.silver, 0.44, 0.02, 0.38, -0.42, 1.315, 0.98);
  b.geo(mat.graphite, rbox(0.4, 0.22, 0.36, 0.03), 0.06, 1.06, 0.96);
  b.box(mat.ledCyan, 0.2, 0.02, 0.01, 0.06, 1.08, 1.15);
  b.geo(mat.inset, rbox(0.34, 0.14, 0.3, 0.025), 0.06, 1.24, 0.96);
  b.strut(mat.silver, V(0.52, 0.99, 0.8), V(0.52, 1.45, 0.8), 0.08);
  b.box(mat.ledCyan, 0.1, 0.015, 0.012, 0.52, 1.2, 0.88);
  b.geo(mat.graphite, rbox(0.5, 0.2, 0.28, 0.025), -0.2, 1.08, 1.4);
  b.box(mat.ledCyan, 0.2, 0.02, 0.01, -0.2, 1.1, 1.55);
  b.geo(mat.graphite, rbox(0.3, 0.26, 0.28, 0.025), 0.4, 1.12, 1.35);
  // folded robotic arm at the rear right corner: base, two links, elbow, gripper
  const ax = 0.66;
  b.geo(mat.graphite, rbox(0.17, 0.24, 0.17, 0.03), ax, 1.14, ZR + 0.1);
  b.box(mat.ledCyan, 0.03, 0.03, 0.012, ax, 1.2, ZR + 0.19);
  b.strut(mat.silver, V(ax, 1.22, ZR + 0.1), V(ax, 1.74, ZR + 0.12), 0.032);
  b.geo(mat.graphite, new THREE.SphereGeometry(0.05, 12, 8), ax, 1.74, ZR + 0.12);
  b.strut(mat.silver, V(ax, 1.74, ZR + 0.12), V(ax, 1.42, ZR + 0.15), 0.026);
  b.box(mat.graphite, 0.07, 0.1, 0.07, ax, 1.34, ZR + 0.15);
  for (const dx of [-0.026, 0.026]) b.box(mat.silver, 0.014, 0.1, 0.04, ax + dx, 1.26, ZR + 0.15);
}

// Gold suspension: a bracket above the inner top of each tyre and two arms into the body (static, does not steer).
function suspension(b, mat) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const zc = sz * HB;
      b.geo(mat.gold, rbox(0.08, 0.15, 0.16, 0.03), sx * 0.84, 0.915, zc);
      b.box(mat.graphite, 0.1, 0.03, 0.14, sx * 0.835, 0.845, zc);
      b.box(mat.gold, 0.08, 0.2, 0.14, sx * 0.66, 0.7, zc);
      for (const dz of [-0.08, 0.08]) {
        b.strut(mat.gold, V(sx * 0.68, 0.68, zc + dz), V(sx * 0.5, 0.4, zc + dz * 1.5), 0.022);
        b.strut(mat.gold, V(sx * 0.7, 0.58, zc + dz), V(sx * 0.46, 0.34, zc + dz * 1.2), 0.016);
      }
    }
  }
}

/* ---------------------------------------------------------------- the rover */

let logged = false;

function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return n;
}

function createProceduralRover() {
  const root = new THREE.Group();
  root.name = 'rover';
  const { materials: mat, setDust } = createMaterials();

  const body = new THREE.Group();
  body.name = 'body';
  const batch = createBatch();
  chassis(batch, mat);
  nose(batch, mat);
  sidesAndFrame(batch, mat);
  seats(batch, mat);
  dash(batch, mat);
  roof(batch, mat);
  bay(batch, mat);
  suspension(batch, mat);
  batch.build(body);
  root.add(body);

  // wheel pivots: steering turns the pivot, spin turns children[0]
  for (const [name, sx, sz] of [['wheelFL', -1, -1], ['wheelFR', 1, -1], ['wheelRL', -1, 1], ['wheelRR', 1, 1]]) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(sx * HT, R, sz * HB);
    pivot.add(createWheel(mat));
    root.add(pivot);
  }

  root.userData.eye = new THREE.Vector3(-0.32, 1.45, -0.45);
  root.userData.setDust = setDust;
  root.userData.triangles = countTriangles(root);
  if (!logged) {
    logged = true;
    console.info(`[rover] ${Math.round(root.userData.triangles)} triangles`);
  }
  return root;
}

/* ---------------------------------------------------------------- the Blender model (GLB) */

const GLB_URL = '/assets/models/rover.glb';
const EYE = new THREE.Vector3(-0.32, 1.45, -0.45);
let template = null;
let loading = null;

/** Starts loading the GLB (once). Resolves with the template or null if it could not be loaded. */
export function loadRoverModel() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(GLB_URL).then((gltf) => {
      template = gltf.scene;
      template.name = 'rover';
      template.userData.triangles = countTriangles(template);
      console.info(`[rover] Blender model loaded, ${Math.round(template.userData.triangles)} triangles`);
      return template;
    }).catch((error) => {
      console.warn('[rover] rover.glb not loaded, using the code-built rover:', error?.message ?? error);
      return null;
    });
  }
  return loading;
}
if (typeof window !== 'undefined') loadRoverModel();

// A clone of the template with its own materials (dust is per rover), env reflections and shadows.
function cloneRoverModel() {
  const root = template.clone(true);
  const dusty = [], glowing = [];
  const env = interiorEnvironment();
  const owned = new Map();
  const own = (m) => {
    if (!owned.has(m)) {
      const c = m.clone();
      c.envMap = env;
      const emissive = c.emissive && c.emissive.getHex() !== 0;
      c.envMapIntensity = emissive ? 0.3 : c.metalness > 0.5 || c.clearcoat > 0 ? 0.9 : 0.6;
      if (emissive) glowing.push({ material: c, intensity: c.emissiveIntensity });
      else dusty.push({ material: c, base: c.color.clone(), roughness: c.roughness, metalness: c.metalness, dust: c.map && !c.normalMap ? 0.6 : 0.85 });
      owned.set(m, c);
    }
    return owned.get(m);
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  const tmp = new THREE.Color();
  root.userData.setDust = (amount) => {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const d of dusty) {
      d.material.color.copy(tmp.copy(d.base).lerp(DUST, 0.8 * t * d.dust));
      d.material.roughness = THREE.MathUtils.lerp(d.roughness, 0.95, t * d.dust);
      d.material.metalness = THREE.MathUtils.lerp(d.metalness, d.metalness * 0.3, t * d.dust);
      if (d.material.clearcoat) d.material.clearcoat = (1 - t) * 0.7;
    }
    for (const g of glowing) g.material.emissiveIntensity = g.intensity * (1 - 0.35 * t);
  };
  root.userData.eye = EYE.clone();
  root.userData.triangles = template.userData.triangles;
  return root;
}

/** The rover for Role 2: the Blender model when loaded, else the procedural one. */
export function createRover() {
  return template ? cloneRoverModel() : createProceduralRover();
}
