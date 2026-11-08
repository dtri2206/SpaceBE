import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, qualitySettings, sharedUniforms } from './shared.js';
import { assets } from './assets.js';
import { pbr } from './interiors.js';
import { COVER_HALF, buildCoverTexture, buildEarthGround, buildTrees, drop as curve, earthHeight, roadX, shoreX } from './earthLand.js';

/**
 * A coastal launch complex on Earth, for the ascent. The pad is at the origin, +Y is up and Earth's centre is 637 km below.
 * Returns { scene, root, rocketBase, setAltitude(metres) }. Keep the camera near the origin and call setAltitude as the
 * rocket climbs: the whole site (and the planet) slides down instead.
 */

const R = 637e3;
const GROUND_LIFT = 1; // the planet sits this far below the pad, so the ground mesh never z-fights it
const FENCE = 105;
const TWO_PI = Math.PI * 2;

// Earth curves away (3 m at 2 km), and the land rises in hills beyond the complex (earthLand.js).
const drop = (x, z) => curve(x, z) + earthHeight(x, z);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---------------------------------------------------------------- canvas textures */

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(canvas, { repeat = false, colour = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Poured concrete: panel tones, grain, blotches, cracks and joints. Returns the colour canvas and a matching bump canvas.
function paintConcrete(size, { panels = 0, tone = [146, 143, 136], seed = 1, grain = 1 } = {}) {
  const r = rng(seed);
  const colour = makeCanvas(size), bump = makeCanvas(size);
  const c = colour.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = `rgb(${tone})`;
  c.fillRect(0, 0, size, size);
  b.fillStyle = 'rgb(150,150,150)';
  b.fillRect(0, 0, size, size);
  if (panels) {
    const s = size / panels;
    for (let i = 0; i < panels; i++) for (let j = 0; j < panels; j++) {
      const v = (r() - 0.5) * 34;
      c.fillStyle = v > 0 ? `rgba(255,250,240,${v / 255})` : `rgba(20,18,16,${-v / 255})`;
      c.fillRect(i * s, j * s, s, s);
    }
  }
  const grains = Math.round(size * size / 9 * grain);
  for (let i = 0; i < grains; i++) {
    const x = r() * size, y = r() * size, a = r() * 0.16, w = r() < 0.12 ? 2 : 1;
    c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    c.fillRect(x, y, w, w);
    b.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a * 1.6})` : `rgba(0,0,0,${a * 1.6})`;
    b.fillRect(x, y, w, w);
  }
  for (let i = 0; i < 46; i++) {
    const x = r() * size, y = r() * size, rad = size * (0.03 + r() * 0.16);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    const warm = r() < 0.5;
    g.addColorStop(0, warm ? 'rgba(104,92,76,0.11)' : 'rgba(210,208,200,0.09)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  if (panels) {
    const s = size / panels;
    c.strokeStyle = 'rgba(34,31,28,0.75)';
    b.strokeStyle = 'rgba(20,20,20,0.95)';
    c.lineWidth = b.lineWidth = Math.max(1.5, size / 650);
    for (let i = 0; i <= panels; i++) {
      for (const ctx of [c, b]) {
        ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(size, i * s); ctx.stroke();
      }
    }
  }
  c.lineWidth = Math.max(1, size / 1100);
  b.lineWidth = c.lineWidth;
  for (let i = 0; i < 14; i++) {
    let x = r() * size, y = r() * size, a = r() * TWO_PI;
    c.strokeStyle = 'rgba(30,27,24,0.55)';
    b.strokeStyle = 'rgba(30,30,30,0.9)';
    c.beginPath(); b.beginPath(); c.moveTo(x, y); b.moveTo(x, y);
    for (let k = 0; k < 9; k++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * size * 0.02; y += Math.sin(a) * size * 0.02;
      c.lineTo(x, y); b.lineTo(x, y);
    }
    c.stroke(); b.stroke();
  }
  return { colour, bump };
}

// The 80 m apron: concrete plus oil, soot, rust, repair patches and the pad markings. 1 px is about 4 cm at 2048.
function paintApron(size) {
  const { colour, bump } = paintConcrete(size, { panels: 8, seed: 7, grain: 1.1 });
  const c = colour.getContext('2d');
  const k = size / 80;
  const X = (m) => (m + 40) * k, Z = (m) => (m + 40) * k;
  const r = rng(99);

  // Repair patches in a slightly different tone.
  for (let i = 0; i < 9; i++) {
    const x = (r() - 0.5) * 66, z = (r() - 0.5) * 66, w = 2 + r() * 6, h = 1.5 + r() * 4;
    c.fillStyle = `rgba(${r() < 0.5 ? '70,66,60' : '190,186,176'},0.16)`;
    c.fillRect(X(x), Z(z), w * k, h * k);
    c.strokeStyle = 'rgba(30,28,26,0.5)'; c.lineWidth = 0.05 * k;
    c.strokeRect(X(x), Z(z), w * k, h * k);
  }
  // Oil and tyre stains.
  for (let i = 0; i < 34; i++) {
    const x = (r() - 0.5) * 70, z = (r() - 0.5) * 70, rad = (0.6 + r() * 2.4) * k;
    const g = c.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rad);
    g.addColorStop(0, 'rgba(26,22,18,0.34)'); g.addColorStop(0.6, 'rgba(34,28,22,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.save(); c.translate(X(x), Z(z)); c.rotate(r() * 3); c.scale(1.7, 1);
    c.fillRect(-rad, -rad, rad * 2, rad * 2);
    c.restore();
  }
  // Soot from engine firings: a dark bloom at the centre, longer along the flame trench (to -X).
  const soot = c.createRadialGradient(X(0), Z(0), 0, X(0), Z(0), 21 * k);
  soot.addColorStop(0, 'rgba(14,12,10,0.88)'); soot.addColorStop(0.45, 'rgba(24,20,16,0.55)'); soot.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = soot; c.fillRect(0, 0, size, size);
  const streak = c.createLinearGradient(X(8), 0, X(-40), 0);
  streak.addColorStop(0, 'rgba(18,15,12,0.62)'); streak.addColorStop(1, 'rgba(18,15,12,0)');
  c.fillStyle = streak; c.fillRect(X(-40), Z(-11), 48 * k, 22 * k);
  for (let i = 0; i < 26; i++) { // soot spray, in streaks away from the centre
    const a = r() * TWO_PI, d = 6 + r() * 22;
    c.strokeStyle = `rgba(16,14,12,${0.07 + r() * 0.12})`; c.lineWidth = (0.2 + r() * 0.6) * k;
    c.beginPath(); c.moveTo(X(Math.cos(a) * d), Z(Math.sin(a) * d));
    c.lineTo(X(Math.cos(a) * (d + 4 + r() * 12)), Z(Math.sin(a) * (d + 4 + r() * 12))); c.stroke();
  }
  // Rust runs below the steel on the south and north sides.
  for (let i = 0; i < 18; i++) {
    const x = (r() - 0.5) * 12, z = -15 + r() * 3 - (i % 2) * 24;
    const g = c.createLinearGradient(0, Z(z), 0, Z(z + 3 + r() * 6));
    g.addColorStop(0, 'rgba(120,64,34,0.28)'); g.addColorStop(1, 'rgba(120,64,34,0)');
    c.fillStyle = g; c.fillRect(X(x), Z(z), (0.4 + r() * 0.8) * k, 9 * k);
  }
  // Markings: yellow edge line, white target rings, cross, pad name.
  c.lineJoin = 'miter';
  c.strokeStyle = 'rgba(224,178,34,0.9)'; c.lineWidth = 0.55 * k;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * TWO_PI, rr = 38.2 / Math.cos(Math.PI / 8);
    const x = X(Math.cos(a) * rr), z = Z(Math.sin(a) * rr);
    if (i === 0) c.moveTo(x, z); else c.lineTo(x, z);
  }
  c.closePath(); c.stroke();
  c.strokeStyle = 'rgba(232,230,222,0.85)'; c.lineWidth = 0.38 * k;
  for (const rad of [14, 27]) { c.beginPath(); c.arc(X(0), Z(0), rad * k, 0, TWO_PI); c.stroke(); }
  c.setLineDash([2.2 * k, 1.6 * k]); c.lineWidth = 0.3 * k;
  c.beginPath(); c.arc(X(0), Z(0), 21 * k, 0, TWO_PI); c.stroke(); c.setLineDash([]);
  c.strokeStyle = 'rgba(224,178,34,0.88)'; c.lineWidth = 0.5 * k;
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TWO_PI + Math.PI / 4;
    c.beginPath(); c.moveTo(X(Math.cos(a) * 14), Z(Math.sin(a) * 14)); c.lineTo(X(Math.cos(a) * 27), Z(Math.sin(a) * 27)); c.stroke();
  }
  c.save(); c.translate(X(0), Z(33)); c.fillStyle = 'rgba(232,230,222,0.82)';
  c.font = `bold ${5.5 * k}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('LC-3', 0, 0);
  c.restore();
  // Wear on the paint.
  for (let i = 0; i < size * size / 260; i++) {
    c.fillStyle = `rgba(${130 + r() * 30},${127 + r() * 30},${120 + r() * 30},${0.1 + r() * 0.3})`;
    c.fillRect(r() * size, r() * size, 1 + r() * 3, 1 + r() * 2);
  }
  return { colour, bump };
}

function paintAsphalt() {
  const w = 256, h = 512, c0 = makeCanvas(w, h), c = c0.getContext('2d'), r = rng(31);
  c.fillStyle = '#3b3c3e'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) {
    const a = r() * 0.3;
    c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`;
    c.fillRect(r() * w, r() * h, 1 + (r() < 0.2 ? 1 : 0), 1);
  }
  for (let i = 0; i < 6; i++) { // tyre polish, two lanes
    const x = w * (i < 3 ? 0.27 : 0.73) + (r() - 0.5) * 30;
    const g = c.createLinearGradient(x - 14, 0, x + 14, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(10,10,10,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - 14, 0, 28, h);
  }
  c.fillStyle = 'rgba(214,210,196,0.8)';
  c.fillRect(w * 0.06, 0, 5, h); c.fillRect(w * 0.94 - 5, 0, 5, h);
  c.fillStyle = 'rgba(224,182,52,0.85)';
  c.fillRect(w / 2 - 3, 20, 6, 170); c.fillRect(w / 2 - 3, 270, 6, 170);
  for (let i = 0; i < 8; i++) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(r() * w, r() * h, 1, 20 + r() * 80); } // cracks
  return c0;
}

function paintFacade() {
  const w = 1024, h = 256, c0 = makeCanvas(w, h), c = c0.getContext('2d'), r = rng(52);
  c.fillStyle = '#c9c6bb'; c.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 12) { // corrugated cladding
    c.fillStyle = 'rgba(0,0,0,0.13)'; c.fillRect(x, 0, 3, h);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 6, 0, 2, h);
  }
  for (let i = 0; i < 90; i++) { // rain streaks
    const g = c.createLinearGradient(0, 0, 0, h * 0.8);
    g.addColorStop(0, 'rgba(70,56,40,0.25)'); g.addColorStop(1, 'rgba(70,56,40,0)');
    c.fillStyle = g; c.fillRect(r() * w, 0, 1 + r() * 5, h * (0.3 + r() * 0.6));
  }
  const dirt = c.createLinearGradient(0, h * 0.75, 0, h);
  dirt.addColorStop(0, 'rgba(90,76,58,0)'); dirt.addColorStop(1, 'rgba(90,76,58,0.55)');
  c.fillStyle = dirt; c.fillRect(0, h * 0.75, w, h * 0.25);
  c.fillStyle = '#e1ddd0'; c.fillRect(0, 0, w, 14); // trim
  for (let i = 0; i < 5; i++) { // windows
    const x = 70 + i * 150;
    c.fillStyle = '#2a343c'; c.fillRect(x, 72, 96, 62);
    const g = c.createLinearGradient(x, 72, x + 96, 134);
    g.addColorStop(0, 'rgba(180,210,230,0.5)'); g.addColorStop(0.5, 'rgba(120,150,170,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x, 72, 96, 62);
    c.strokeStyle = '#8b8a84'; c.lineWidth = 4; c.strokeRect(x, 72, 96, 62);
    c.beginPath(); c.moveTo(x + 48, 72); c.lineTo(x + 48, 134); c.stroke();
  }
  c.fillStyle = '#6c7076'; c.fillRect(860, 70, 96, 186); // roller door
  for (let y = 78; y < 256; y += 14) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(860, y, 96, 2); }
  c.fillStyle = '#c0392b'; c.fillRect(0, 158, 1024, 10); // stripe
  return c0;
}

function paintTank() {
  const c0 = makeCanvas(512, 256), c = c0.getContext('2d'), r = rng(63);
  c.fillStyle = '#d8d6cf'; c.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 140; i++) {
    const g = c.createLinearGradient(0, 0, 0, 256);
    const rust = r() < 0.5;
    g.addColorStop(0, rust ? 'rgba(128,72,40,0.5)' : 'rgba(60,60,56,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(r() * 512, 0, 1 + r() * 4, 70 + r() * 170);
  }
  c.fillStyle = 'rgba(40,60,100,0.82)'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.fillText('H2O', 128, 150);
  c.fillText('H2O', 384, 150);
  for (let y = 0; y < 256; y += 64) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, y, 512, 2); }
  return c0;
}

/* ---------------------------------------------------------------- shared materials and geometry */

let cache = null;

function materials() {
  if (cache) return cache;
  const q = qualitySettings();
  const apronSize = q.rocks > 1000 ? 2048 : 1024;
  const apron = paintApron(apronSize);
  const tile = paintConcrete(512, { panels: 2, seed: 13, tone: [150, 147, 140] });
  const dark = paintConcrete(512, { panels: 2, seed: 21, tone: [78, 74, 70] });
  const apronMap = canvasTexture(apron.colour), apronBump = canvasTexture(apron.bump, { colour: false });
  const tileMap = canvasTexture(tile.colour, { repeat: true }), tileBump = canvasTexture(tile.bump, { repeat: true, colour: false });
  const darkMap = canvasTexture(dark.colour, { repeat: true }), darkBump = canvasTexture(dark.bump, { repeat: true, colour: false });
  for (const t of [apronMap, tileMap, darkMap]) t.needsUpdate = true;
  const road = canvasTexture(paintAsphalt(), { repeat: true });
  const facade = canvasTexture(paintFacade(), { repeat: true });
  const tank = canvasTexture(paintTank(), { repeat: true });
  const rough = { roughness: 0.92, metalness: 0 };
  cache = {
    apronTop: pbr(0xffffff, 0.9, 0, { map: apronMap, bumpMap: apronBump, bumpScale: 1.2, envMapIntensity: 0.15 }),
    apronSide: pbr(0x9a978f, 0.95, 0, { map: tileMap, bumpMap: tileBump, bumpScale: 1, envMapIntensity: 0.1 }),
    concrete: pbr(0xffffff, 0.92, 0, { map: tileMap, bumpMap: tileBump, bumpScale: 1.2, envMapIntensity: 0.15 }),
    scorched: pbr(0xffffff, 0.95, 0, { map: darkMap, bumpMap: darkBump, bumpScale: 1.4, envMapIntensity: 0.1 }),
    road: pbr(0xffffff, 0.88, 0, { map: road, envMapIntensity: 0.1 }),
    facade: pbr(0xffffff, 0.8, 0.1, { map: facade }),
    roof: pbr(0x59605f, 0.7, 0.5),
    tank: pbr(0xffffff, 0.55, 0.3, { map: tank }),
    steel: pbr(0xffffff, 0.55, 0.65, { envMapIntensity: 0.5 }),
    grating: pbr(0x3a3d41, 0.7, 0.6),
    white: pbr(0xe4e1d8, 0.5, 0.1),
    insulation: pbr(0xd7dad8, 0.45, 0.1),
    dark: pbr(0x2a2d31, 0.7, 0.4),
    orange: pbr(0xc8651c, 0.5, 0.3),
    pole: pbr(0x8b9096, 0.5, 0.7),
    post: pbr(0x74634f, 0.9, 0),
    scrub: pbr(0xffffff, 1, 0, { flatShading: true, envMapIntensity: 0.1 }),
    wire: new THREE.LineBasicMaterial({ color: 0x7c8087, transparent: true, opacity: 0.8 }),
    work: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.9, 0.7).multiplyScalar(3) }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.12, 0.06) }),
    redMast: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.12, 0.06) }),
    unit: new THREE.BoxGeometry(1, 1, 1),
  };
  return cache;
}

// Box UVs in metres so a tiled texture keeps one scale on every face.
function metricUV(geometry, tile) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
    else if (ax > 0.5) uv.setXY(i, p.getZ(i) / tile, p.getY(i) / tile);
    else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  }
  return geometry;
}

function slab(w, h, d, material, x, y, z, { tile = 6, cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(metricUV(new THREE.BoxGeometry(w, h, d), tile), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function tube(a, b, radius, material, segments = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), segments), material);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.castShadow = true;
  return mesh;
}

/* ---------------------------------------------------------------- steel lattice */

// Rectangular truss between two points: four chords, a ring at every bay and a diagonal on each face.
function truss(a, b, w, h, bays, { chord = 0.42, ring = 0.2, diag = 0.17 } = {}) {
  const axis = new THREE.Vector3().subVectors(b, a);
  const length = axis.length();
  axis.normalize();
  const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const corner = (i, k) => a.clone().addScaledVector(axis, length * i / bays)
    .addScaledVector(u, signs[k][0] * w / 2).addScaledVector(v, signs[k][1] * h / 2);
  const members = [];
  for (let i = 0; i <= bays; i++) {
    for (let k = 0; k < 4; k++) {
      if (i < bays) {
        members.push({ a: corner(i, k), b: corner(i + 1, k), t: chord });
        members.push({ a: corner(i, k), b: corner(i + 1, (k + 1) % 4), t: diag });
      }
      if (i > 0 || bays === 1) members.push({ a: corner(i, k), b: corner(i, (k + 1) % 4), t: ring });
    }
  }
  return members;
}

function instancedMembers(members, material, seed = 3) {
  const { unit } = materials();
  const mesh = new THREE.InstancedMesh(unit, material, members.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), d = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), colour = new THREE.Color(), r = rng(seed);
  members.forEach(({ a, b, t }, i) => {
    d.subVectors(b, a);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    m.compose(p.addVectors(a, b).multiplyScalar(0.5), q, s.set(t, len, t));
    mesh.setMatrixAt(i, m);
    // Faded red-orange paint over grey galvanising, with rust here and there.
    const rust = r();
    colour.setRGB(0.5 + rust * 0.14, 0.16 + rust * 0.07, 0.1 + rust * 0.04).multiplyScalar(0.75 + r() * 0.5);
    if (t < 0.19) colour.lerp(new THREE.Color(0.42, 0.43, 0.44), 0.75);
    mesh.setColorAt(i, colour);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function instancedBoxes(list, material, shadow = true) {
  const { unit } = materials();
  const mesh = new THREE.InstancedMesh(unit, material, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  list.forEach(([x, y, z, sx, sy, sz, ry = 0], i) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------------------------------------------------------------- ground */

function groundMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, transparent: true, fog: false });
  const uniforms = {
    uHaze: { value: new THREE.Color(0.6, 0.75, 0.95) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 1 },
    uAir: { value: 1 },
    uTime: sharedUniforms.uTime,
    uCover: { value: buildCoverTexture() },
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vHt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);\nvHt = transformed.y + dot(transformed.xz, transformed.xz) / 1274000.;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vWP; varying vec3 vWN; varying float vHt;
        uniform sampler2D uCover;
        uniform vec3 uHaze; uniform vec3 uSunCol; uniform float uFade; uniform float uAir;
        uniform float uTime;
        float ocean_ = 0.;
        ${GLSL_NOISE}
        float shoreX(float z) { return 1250. + 300. * sin(z * .0011 + 1.3) + 130. * sin(z * .0041 + .4) + 45. * sin(z * .013); }`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          vec2 p = vWP.xz;
          if (p.x < 6.5 && p.x > -83. && abs(p.y) < 5.6) discard;
          float r0 = length(p);
          float n1 = fbm(vec3(p / 1100., 1.7), 4);
          float n2 = fbm(vec3(p / 170., 4.1), 4);
          float n3 = fbm(vec3(p / 24., 9.3), 3);
          float n4 = vnoise(vec3(p / 3.1, 2.2));
          float n5 = vnoise(vec3(p / .55, 5.));
          float shore = shoreX(p.y) + (n1 - .5) * 260. + (n3 - .5) * 36.;
          float dd = p.x - shore;
          // Coastal scrub plain: green-dominant, with tan dry patches. Several scales, no large pattern.
          float broad = n1 * .5 + n2 * .5;
          float dry = smoothstep(.44, .58, n2 * .55 + n3 * .3 + n1 * .15);
          float wet = smoothstep(.3, .1, broad);
          vec3 grass = mix(vec3(.095, .15, .045), vec3(.16, .215, .075), n3);
          grass = mix(grass, vec3(.075, .14, .06), wet * .6);
          vec3 straw = mix(vec3(.2, .19, .09), vec3(.26, .24, .12), n3);
          vec3 land = mix(grass, straw * .85, dry * .5);
          float clump = smoothstep(.5, .78, n4 * .55 + n5 * .45);
          land = mix(land, grass * vec3(.55, .7, .5), clump * .45);
          land *= (.84 + .32 * n2) * (.92 + .16 * n4) * (.93 + .14 * n5);
          float wash = smoothstep(.62, .78, fbm(vec3(p / 60. + 31., 7.), 3));
          land = mix(land, vec3(.5, .44, .27), wash * .3);
          // Land cover from the same map the trees are placed from: farm fields, then woodland floor.
          vec4 cv = texture2D(uCover, (p + ${COVER_HALF}.) / ${2 * COVER_HALF}.) * step(max(abs(p.x), abs(p.y)), ${COVER_HALF - 2}.);
          float fh = cv.g;
          vec3 crop = fh < .25 ? vec3(.12, .2, .06) : fh < .5 ? vec3(.2, .27, .08) : fh < .75 ? vec3(.26, .19, .11) : vec3(.4, .35, .19);
          crop *= .88 + .24 * n4 + .06 * sin(dot(p, vec2(.9, .43)) * 1.3);
          land = mix(land, crop, cv.b * (1. - smoothstep(.1, .5, cv.r)) * .9);
          land = mix(land, mix(vec3(.04, .07, .03), vec3(.06, .1, .04), n3) * (.85 + .3 * n5), smoothstep(.1, .6, cv.r) * .92);
          // Hills: forest on the slopes, bare rock on steep faces and high ground.
          float hillF = smoothstep(14., 90., vHt) * (1. - smoothstep(330., 520., vHt));
          land = mix(land, vec3(.045, .085, .04) * (.8 + .5 * n2), hillF * (.55 + .3 * n3));
          float rock = max(smoothstep(.2, .4, 1. - vWN.y), smoothstep(420., 640., vHt + (n2 - .5) * 120.));
          land = mix(land, vec3(.3, .27, .23) * (.8 + .4 * n3), rock * smoothstep(40., 140., vHt));
          // From height the plain reads as Florida green: scrub and woodland merge towards the colour of the globe's land.
          float far_ = smoothstep(1200., 6000., r0);
          land = mix(land, mix(vec3(.05, .09, .035), vec3(.075, .12, .05), n2) * (.85 + .3 * n3), far_ * .75);
          float bare = 1. - smoothstep(18., 70., r0 + (n2 - .5) * 70.);
          vec3 dirt = mix(vec3(.3, .25, .16), vec3(.4, .34, .22), n3) * (.92 + .16 * n5) * (.92 + .16 * n4);
          land = mix(land, dirt, bare);
          float beach = smoothstep(-210., -40., dd);
          vec3 sand = mix(vec3(.4, .34, .23), vec3(.5, .44, .32), n3) * (.88 + .24 * n5);
          sand = mix(sand, vec3(.26, .21, .15), smoothstep(-34., -2., dd) * .8);
          vec3 col = mix(land, sand, beach);
          float w = smoothstep(-2., 2., dd);
          vec3 water = mix(mix(vec3(.06, .27, .25), vec3(.03, .17, .22), smoothstep(0., 160., dd)), vec3(.01, .06, .2), smoothstep(80., 800., dd));
          float foam = (1. - smoothstep(0., 8., abs(dd - 5. - 3. * sin(p.y * .05 + uTime * .5)))) * smoothstep(.3, .65, n3 + n4 * .3);
          water = mix(water, vec3(.8), foam * .65);
          ocean_ = w;
          col = mix(col, water, w);
          diffuseColor.rgb = col;
          diffuseColor.a = (1. - smoothstep(11500., 14800., r0)) * uFade;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .16, ocean_);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          vec2 q = vWP.xz;
          float dist_ = length(vViewPosition);
          float e = .12;
          float h0 = vnoise(vec3(q * 7., 3.)) * .5 + vnoise(vec3(q * 19., 1.)) * .5;
          float hx = vnoise(vec3((q + vec2(e, 0.)) * 7., 3.)) * .5 + vnoise(vec3((q + vec2(e, 0.)) * 19., 1.)) * .5;
          float hz = vnoise(vec3((q + vec2(0., e)) * 7., 3.)) * .5 + vnoise(vec3((q + vec2(0., e)) * 19., 1.)) * .5;
          vec2 g = vec2(hx - h0, hz - h0) / e * .05 * (1. - smoothstep(15., 110., dist_));
          vec2 wq = q * .22 + vec2(uTime * .25, uTime * .13);
          float w0 = vnoise(vec3(wq, 2.)), wx = vnoise(vec3(wq + vec2(.05, 0.), 2.)), wz = vnoise(vec3(wq + vec2(0., .05), 2.));
          vec2 wv = vec2(wx - w0, wz - w0) / .05 * .09 * (1. - smoothstep(400., 3500., dist_));
          g = mix(g, wv, ocean_);
          normal = normalize(normal - mat3(viewMatrix) * vec3(g.x, 0., g.y));
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float fr = pow(1. - clamp(dot(Vv, normal), 0., 1.), 5.);
          totalEmissiveRadiance += ocean_ * uHaze * (.01 + .6 * fr) * (.2 + .8 * uAir);
          #if NUM_DIR_LIGHTS > 0
          vec3 Hh = normalize(directionalLights[0].direction + Vv);
          float nh = max(dot(normal, Hh), 0.);
          float sp = pow(nh, 500.) * 4. + pow(nh, 60.) * .04;
          totalEmissiveRadiance += ocean_ * uSunCol * sp * smoothstep(0., .08, dot(normal, directionalLights[0].direction));
          #endif
        }`)
      .replace('#include <opaque_fragment>', /* glsl */ `
        {
          float hz_ = 1. - exp(-length(vViewPosition) * .00018 * uAir * (1. - .55 * ocean_));
          outgoingLight = mix(outgoingLight, uHaze * vec3(.5, .68, .9), hz_);
        }
        #include <opaque_fragment>`);
  };
  return material;
}

/* ---------------------------------------------------------------- pad, tower and surroundings */

function buildApron(m) {
  const group = new THREE.Group();
  const a = 40, rr = a / Math.cos(Math.PI / 8);
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i + 0.5) / 8 * TWO_PI;
    pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
  }
  // Insert the flame-trench notch on the -X side, between the vertices at 157.5 and 202.5 degrees.
  const outline = [];
  for (let i = 0; i < 8; i++) {
    outline.push(pts[i]);
    if (i === 3) outline.push([-a, 5], [6.5, 5], [6.5, -5], [-a, -5]);
  }
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  // Top and bottom faces use the painted map across 80 m; the sides repeat the tile.
  const uv = geometry.attributes.uv, pos = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 80 + 0.5, -pos.getZ(i) / 80 + 0.5);
  geometry.groups.forEach((g) => { g.materialIndex = g.materialIndex ?? 0; });
  const apron = new THREE.Mesh(geometry, [m.apronTop, m.apronSide]);
  apron.receiveShadow = true;
  group.add(apron);

  // Flame trench: floor with a ramp up to the ground, and two walls.
  const profile = new THREE.Shape([[6.5, -6.6], [-83, -6.6], [-83, 0.02], [-61, -6], [6.5, -6]].map(([x, y]) => new THREE.Vector2(x, y)));
  const floor = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: 10.2, bevelEnabled: false }), m.scorched);
  floor.position.z = -5.1;
  floor.receiveShadow = true;
  group.add(floor);
  for (const s of [-1, 1]) {
    const wall = slab(89.5, 7.1, 1.3, m.scorched, -38.25, -6.6, s * 5.65, { tile: 4 });
    group.add(wall);
    group.add(slab(89.5, 0.12, 1.5, m.concrete, -38.25, 0.5, s * 5.65, { tile: 4, cast: false })); // coping
  }
  group.add(slab(1.4, 6.6, 10.2, m.scorched, 7.2, -6.6, 0, { tile: 4 }));
  return group;
}

function buildMount(m) {
  const group = new THREE.Group();
  const table = new THREE.Mesh(metricUV(new THREE.CylinderGeometry(5.6, 5.6, 1.0, 8), 4), m.concrete);
  table.position.y = 2.5;
  table.rotation.y = Math.PI / 8;
  table.castShadow = table.receiveShadow = true;
  group.add(table);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    group.add(slab(2.2, 1.7, 2, m.concrete, sx * 3.8, 0.45, sz * 5.7, { tile: 3 }));
  }
  // Hold-down clamps and a deflector under the table.
  const clamps = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TWO_PI + Math.PI / 4;
    clamps.push([Math.cos(a) * 2.1, 3.25, Math.sin(a) * 2.1, 0.7, 0.5, 0.7, -a]);
  }
  group.add(instancedBoxes(clamps, m.dark));
  const deflector = slab(5, 3.2, 8.4, m.scorched, -2.5, -6, 0, { tile: 3 });
  deflector.rotation.z = 0.5;
  deflector.position.set(-2.2, -4.2, 0);
  group.add(deflector);
  return group;
}

function buildTower(m) {
  const group = new THREE.Group();
  const bays = 12, height = 62, W = 6.2;
  const tz = -16;
  const members = truss(new THREE.Vector3(0, 0, tz), new THREE.Vector3(0, height, tz), W, W, bays);
  // Crew access arm at 48 m, a hammerhead crane above, and service girders.
  members.push(...truss(new THREE.Vector3(0, 48, tz + W / 2), new THREE.Vector3(0, 48, -2.4), 1.7, 2.3, 4, { chord: 0.3, ring: 0.15, diag: 0.14 }));
  members.push(...truss(new THREE.Vector3(0, 64.2, tz - 11), new THREE.Vector3(0, 64.2, tz + 12), 1.5, 1.7, 7, { chord: 0.32, ring: 0.16, diag: 0.14 }));
  for (const y of [18, 31, 40]) members.push(...truss(new THREE.Vector3(0, y, tz + W / 2), new THREE.Vector3(0, y, tz + W / 2 + 6), 1.2, 0.9, 2, { chord: 0.26, ring: 0.14, diag: 0.12 }));
  members.push({ a: new THREE.Vector3(0, height, tz), b: new THREE.Vector3(0, height + 11, tz), t: 0.16 });
  group.add(instancedMembers(members, m.steel, 5));

  const decks = [];
  for (let k = 3; k <= 12; k += 3) decks.push([0, k * height / bays, tz, W + 0.6, 0.16, W + 0.6]);
  decks.push([0, 48 - 1.2, -7.4, 2.2, 0.1, 10.5]);
  group.add(instancedBoxes(decks, m.grating));

  // Crew access room at the end of the arm, crane counterweight and hoist, base plinth.
  group.add(slab(2.8, 2.9, 2.6, m.white, 0, 46.9, -2.0, { tile: 2 }));
  group.add(slab(3, 3, 3, m.dark, 0, 62.5 + 2, tz - 12, { tile: 2 }));
  group.add(slab(W + 2.6, 0.9, W + 2.6, m.concrete, 0, 0, tz, { tile: 3 }));
  group.add(tube(new THREE.Vector3(0, 64, tz + 10), new THREE.Vector3(0, 52, tz + 10), 0.06, m.dark, 4));
  group.add(slab(0.8, 1.2, 0.8, m.orange, 0, 50.8, tz + 10, { tile: 1 }));

  // Propellant and power lines: insulated pipes to the table, then risers up the face of the tower.
  const pipe = (a, b, r, mat) => group.add(tube(new THREE.Vector3(...a), new THREE.Vector3(...b), r, mat));
  pipe([-1.3, 1.5, tz + 4], [-1.3, 1.5, -5.4], 0.3, m.insulation);
  pipe([0, 1.5, tz + 4], [0, 1.5, -5.4], 0.24, m.insulation);
  pipe([1.3, 1.5, tz + 4], [1.3, 1.5, -5.4], 0.3, m.orange);
  for (const [x, mat, r] of [[-1.4, m.insulation, 0.3], [-0.6, m.insulation, 0.2], [1.2, m.orange, 0.22]]) {
    pipe([x, 1.4, tz + W / 2 + 0.5], [x, 46, tz + W / 2 + 0.5], r, mat);
  }
  const supports = [];
  for (let z = tz + 4; z < -5; z += 3.2) supports.push([0, 0.7, z, 3.6, 1.1, 0.35]);
  group.add(instancedBoxes(supports, m.concrete));
  // Ground-level tank farm next to the tower.
  for (const [x, z, r, h] of [[-12, -22, 2.6, 9], [-6.5, -25, 2.6, 9], [-16, -14, 1.9, 6]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), m.white);
    t.position.set(x, 0.9 + h / 2, z);
    t.castShadow = t.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 5, 0, TWO_PI, 0, Math.PI / 2), m.white);
    cap.position.y = h / 2;
    t.add(cap);
    group.add(t, slab(r * 2.4, 0.9, r * 2.4, m.concrete, x, 0, z, { tile: 3 }));
  }
  return group;
}

function buildLights(m) {
  const group = new THREE.Group();
  // Work lights on the tower decks and light poles at the apron corners.
  const works = [];
  for (let k = 3; k <= 12; k += 3) {
    const y = k * 62 / 12 + 0.5;
    for (const [x, z] of [[-3.1, -12.9], [3.1, -12.9], [3.1, -19.1], [-3.1, -19.1]]) works.push([x, y, z, 0.5, 0.28, 0.2]);
  }
  works.push([0, 45.9, -2.4, 0.5, 0.2, 0.25]);
  const poles = [];
  for (const [x, z] of [[36, 36], [-36, 36], [36, -36], [-36, -36]]) {
    group.add(tube(new THREE.Vector3(x, 0.4, z), new THREE.Vector3(x, 17, z), 0.17, m.pole, 6));
    works.push([x, 17.3, z, 1.5, 0.22, 0.5]);
    poles.push(x);
  }
  group.add(instancedBoxes(works, m.work, false));
  return group;
}

function buildMasts(m) {
  const group = new THREE.Group();
  const lines = [];
  const lights = [];
  for (const [x, z] of [[92, 92], [-92, 92], [92, -92], [-92, -92]]) {
    const H = 96;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.55, H, 8, 1), m.pole);
    mast.position.set(x, H / 2, z);
    mast.castShadow = true;
    group.add(mast);
    group.add(tube(new THREE.Vector3(x, H, z), new THREE.Vector3(x, H + 5, z), 0.05, m.pole, 4));
    group.add(slab(2.2, 0.9, 2.2, m.concrete, x, 0, z, { tile: 2 }));
    const light = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), m.redMast);
    light.position.set(x, H + 0.4, z);
    lights.push(light);
    group.add(light);
    for (let i = 0; i < 3; i++) { // guy wires
      const a = i / 3 * TWO_PI + Math.atan2(z, x);
      lines.push(x, H * 0.72, z, x + Math.cos(a) * 34, 0.2, z + Math.sin(a) * 34);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  group.add(new THREE.LineSegments(g, m.wire));
  return group;
}

function buildSupport(m, high) {
  const group = new THREE.Group();
  // Hardstand beside the apron, joined to it, and the service building behind.
  group.add(slab(58, 0.35, 30, m.concrete, 69, 0, -6, { tile: 8 }));
  group.add(slab(6, 0.35, 16, m.concrete, 41.5, 0, -6, { tile: 8 }));
  const b = new THREE.Mesh(metricUV(new THREE.BoxGeometry(26, 6.4, 12), 4), [m.facade, m.facade, m.roof, m.concrete, m.facade, m.facade]);
  b.position.set(70, 3.2, -36);
  b.castShadow = b.receiveShadow = true;
  group.add(b);
  group.add(slab(27.2, 0.5, 13.2, m.roof, 70, 6.4, -36, { tile: 3 }));
  group.add(instancedBoxes([[60, 6.9, -36, 2.4, 1.0, 2.4], [66, 6.9, -34, 2.4, 1.0, 2.4], [78, 6.7, -38, 1.6, 0.7, 5]], m.white));
  group.add(instancedBoxes([[57.2, 4, -30.2, 0.9, 1.4, 0.2], [82.8, 4, -30.2, 0.9, 1.4, 0.2]], m.work, false));

  // Elevated water tank on four legs.
  const [tx, tz] = [-62, -60];
  const tankBody = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12), m.tank);
  tankBody.position.set(tx, 18.5, tz);
  tankBody.scale.y = 0.92;
  tankBody.castShadow = tankBody.receiveShadow = true;
  group.add(tankBody);
  group.add(slab(0.4, 1.0, 0.4, m.steel, tx, 22.4, tz, { tile: 1 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    group.add(tube(new THREE.Vector3(tx + sx * 3.6, 0.2, tz + sz * 3.6), new THREE.Vector3(tx + sx * 2.5, 16, tz + sz * 2.5), 0.2, m.steel, 6));
  }
  const rods = [];
  for (const y of [5, 10.5]) for (let i = 0; i < 4; i++) {
    const s0 = 3.6 - (y / 16) * 1.1, a0 = i / 4 * TWO_PI + Math.PI / 4;
    const a = [Math.cos(a0) * s0 * 1.41, y, Math.sin(a0) * s0 * 1.41];
    const a1 = [Math.cos(a0 + Math.PI / 2) * s0 * 1.41, y, Math.sin(a0 + Math.PI / 2) * s0 * 1.41];
    rods.push({ a: new THREE.Vector3(tx + a[0], a[1], tz + a[2]), b: new THREE.Vector3(tx + a1[0], a1[1], tz + a1[2]), t: 0.1 });
  }
  group.add(instancedMembers(rods, m.steel, 9));
  group.add(slab(9.4, 0.3, 9.4, m.concrete, tx, 0, tz, { tile: 4 }));

  // Fence: posts every 7 m and two strands of wire. The road gate is left open.
  const posts = [];
  const wires = [];
  const edge = (x0, z0, x1, z1) => {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 7);
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
      if (Math.abs(x - roadX(Math.max(z, 8))) < 6 && z > 0) continue;
      posts.push([x, 1.1, z, 0.14, 2.2, 0.14]);
      if (i < n) for (const y of [0.5, 1.0, 1.5, 2.0]) wires.push(x, y, z, x + (x1 - x0) / n, y, z + (z1 - z0) / n);
    }
  };
  edge(-FENCE, -FENCE, FENCE, -FENCE); edge(FENCE, -FENCE, FENCE, FENCE);
  edge(FENCE, FENCE, -FENCE, FENCE); edge(-FENCE, FENCE, -FENCE, -FENCE);
  group.add(instancedBoxes(posts, m.post, false));
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  group.add(new THREE.LineSegments(wg, m.wire));
  return group;
}

function buildRoad(m) {
  const pts = [];
  for (let z = 6; z < 2600; z += z < 400 ? 12 : 40) pts.push(z);
  const positions = [], uvs = [], indices = [];
  let along = 0;
  pts.forEach((z, i) => {
    const x = roadX(z), dx = (roadX(z + 1) - roadX(z - 1)) / 2, len = Math.hypot(dx, 1);
    const nx = 1 / len, nz = -dx / len; // normal across the road
    if (i) along += Math.hypot(x - roadX(pts[i - 1]), z - pts[i - 1]);
    for (const side of [-1, 1]) {
      const px = x + nx * side * 4.2, pz = z + nz * side * 4.2;
      positions.push(px, drop(px, pz) + 0.07, pz);
      uvs.push(side < 0 ? 0 : 1, along / 16);
    }
    if (i) { const a = (i - 1) * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const road = new THREE.Mesh(g, m.road);
  road.receiveShadow = true;
  road.frustumCulled = false;
  return road;
}

function buildScrub(m, count) {
  // One clump is three squashed lumps; they are placed in groups, as palmetto and sea grape grow.
  const lumps = [[0, 0, 0, 1, 0.55], [0.7, 0, 0.3, 0.7, 0.5], [-0.4, 0, -0.6, 0.6, 0.65]].map(([x, y, z, s, h]) => {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(s, h * s, s);
    g.translate(x, y, z);
    return g;
  });
  const mesh = new THREE.InstancedMesh(mergeGeometries(lumps), m.scrub, count);
  const r = rng(77);
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), colour = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 40) {
    const rad = 45 + 900 * Math.pow(r(), 2.6), a = r() * TWO_PI;
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const members = 3 + Math.floor(r() * 6), spread = 2 + r() * 8;
    for (let i = 0; i < members && placed < count; i++) {
      const x = cx + (r() - 0.5) * spread * 2, z = cz + (r() - 0.5) * spread * 2;
      const inside = Math.abs(x) < FENCE + 12 && Math.abs(z) < FENCE + 12;
      if (inside || x > shoreX(z) - 190 || (z > 0 && Math.abs(x - roadX(z)) < 9)) continue;
      const s = 0.8 + r() * r() * 2.2;
      e.set(0, r() * TWO_PI, 0);
      mat.compose(new THREE.Vector3(x, drop(x, z) + s * 0.05, z), q.setFromEuler(e), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(placed, mat);
      const k = r();
      colour.setRGB(0.05 + k * 0.06, 0.11 + k * 0.08, 0.03 + k * 0.03);
      if (r() < 0.25) colour.setRGB(0.16 + k * 0.06, 0.12 + k * 0.05, 0.05); // dry brown clumps
      mesh.setColorAt(placed, colour);
      placed++;
    }
  }
  mesh.count = placed;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------------------------------------------------------------- the site */

// Rotates the globe so Cape Canaveral sits at the top with the Atlantic to the east (+X).
function placeGlobe(planet, latDeg = 28.5, lonDeg = -80.6) {
  const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
  const at = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon));
  const up = new THREE.Vector3(0, 1, 0);
  const q1 = new THREE.Quaternion().setFromUnitVectors(at, up);
  east.applyQuaternion(q1);
  const q2 = new THREE.Quaternion().setFromUnitVectors(east, new THREE.Vector3(1, 0, 0));
  planet.userData.surface.quaternion.copy(q2.multiply(q1));
}

export function createLaunchSite() {
  const settings = qualitySettings();
  const high = settings.rocks > 1000;
  const m = materials();
  const scene = new THREE.Scene();
  scene.name = 'launch-site';
  const root = new THREE.Group();
  root.name = 'launch-site-root';
  const rocketBase = new THREE.Vector3(0, 3, 0);

  // Sky at infinity, then the planet itself: its atmosphere shell supplies the sky from inside the air.
  const sky = assets.get('sky:space');
  const planet = assets.get('planet:earth');
  planet.scale.setScalar(R);
  planet.position.y = -R - GROUND_LIFT;
  placeGlobe(planet);
  root.add(planet);

  const sun = new THREE.DirectionalLight(0xffffff, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(settings.shadowMap);
  const reach = 150;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 20, far: 900 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.25;
  sun.shadow.radius = 2.5;
  const hemi = new THREE.HemisphereLight(0x9cc0f5, 0x9c8a66, 1.3);
  root.add(sun, sun.target, hemi);
  scene.fog = new THREE.FogExp2(0xa8c4e6, 0.00022);

  // Everything below disappears above 40 km, fading the ground first.
  const detail = new THREE.Group();
  detail.name = 'launch-site-detail';
  const material = groundMaterial();
  const ground = new THREE.Group();
  for (const geometry of buildEarthGround(high)) {
    const tier = new THREE.Mesh(geometry, material);
    tier.receiveShadow = true;
    tier.frustumCulled = false;
    ground.add(tier);
  }
  const trees = buildTrees(high);
  detail.add(ground, trees, buildApron(m), buildMount(m), buildTower(m), buildLights(m), buildMasts(m), buildSupport(m, high), buildRoad(m), buildScrub(m, high ? 2200 : 700));
  root.add(detail);

  // Blinking aviation lights, sun-driven lighting and haze.
  const haze = new THREE.Color(), dir = new THREE.Vector3();
  root.userData.onFrame = () => {
    const t = sharedUniforms.uTime.value;
    dir.copy(sharedUniforms.uSunDir.value);
    sun.position.copy(dir).multiplyScalar(420);
    const e = dir.y;
    const up = THREE.MathUtils.smoothstep(e, -0.04, 0.12);
    const warm = THREE.MathUtils.smoothstep(e, 0.02, 0.5);
    sun.color.setRGB(1, 0.6 + 0.36 * warm, 0.36 + 0.58 * warm);
    sun.intensity = 5.4 * up;
    const day = THREE.MathUtils.smoothstep(e, -0.12, 0.3);
    hemi.color.setRGB(0.5, 0.66, 0.95);
    hemi.groundColor.setRGB(0.5, 0.42, 0.3);
    hemi.intensity = 0.35 + 1.15 * day;
    haze.setRGB(0.5 + 0.12 * (1 - warm), 0.66 + 0.05 * (1 - warm), 0.9 - 0.08 * (1 - warm)).multiplyScalar(0.1 + 0.9 * day);
    scene.fog.color.copy(haze);
    material.userData.uniforms.uHaze.value.copy(haze);
    material.userData.uniforms.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.35);
    const on = Math.sin(t * 3.9) > 0.55 ? 3.2 : 0.18;
    m.red.color.setRGB(on, on * 0.04, on * 0.02);
    const on2 = Math.sin(t * 3.9 + 1.7) > 0.55 ? 3.2 : 0.18;
    m.redMast.color.setRGB(on2, on2 * 0.04, on2 * 0.02);
  };

  // Red beacons on the tower.
  const beacons = [];
  for (const [x, y, z] of [[3.3, 62.2, -12.7], [-3.3, 62.2, -19.3], [3.3, 62.2, -19.3], [-3.3, 62.2, -12.7], [3.2, 31, -12.8], [-3.2, 31, -19.2], [0, 76, -16], [0, 64.8, -27]]) {
    const light = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), m.red);
    light.position.set(x, y, z);
    beacons.push(light);
  }
  detail.add(...beacons);

  const setAltitude = (metres) => {
    root.position.y = -metres;
    material.userData.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(metres, 28000, 40000);
    material.userData.uniforms.uAir.value = Math.exp(-metres / 2200);
    detail.visible = metres < 40000;
    trees.visible = metres < 9000; // specks by then
  };

  scene.add(sky, root);
  const site = { scene, root, rocketBase, setAltitude };
  latestSite = new WeakRef(site);
  return site;
}

let latestSite = null;
/** The most recently built launch site, or null. warmup.js compiles LAUNCH's shaders against its scene. */
export function latestLaunchSite() {
  return latestSite?.deref() ?? null;
}
