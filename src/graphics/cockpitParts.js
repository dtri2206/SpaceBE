// Cockpit interior below and around the pilot: seat, suited body, controllers, pedestal, side consoles, floor, lower walls,
// rear lockers and overhead fittings. Origin is the pilot's eye, forward -Z, +Y up (same frame as createCockpit()).
// Everything static is merged per material; only the two controllers move. Called once from createCockpit().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MONO = '"IBM Plex Mono", monospace';
// The glass display panel: its centre, and its tilt towards the pilot (local +y runs up the panel, +z out of it).
export const DASH = { x: 0, y: -0.62, z: -0.70, tilt: 0.785 };
// Inner capsule wall: |x| of the surface at height y and depth z. It sits at 0.97 at console height, leans inward as it rises,
// curves inward behind the pilot and rolls over into the ceiling (a truncated cone, not a box).
export function wallX(y, z) {
  const k = Math.min(1, Math.max(0, (z + 1.05) / 0.7)); // straight at the front, where it meets the window surround
  const up = Math.max(0, (y + 0.9) / 1.75), rear = Math.max(0, (z - 0.1) / 0.55), f = Math.max(0, (y - 0.6) / 0.24);
  return 0.97 - k * (0.13 * up * up + 0.04 * up + 0.23 * f * f) - 0.07 * rear * rear;
}
// x for something that used to sit `old` from the centre on the flat wall, now following the curve
const X = (s, old, y, z) => s * (wallX(y, z) - (0.97 - Math.abs(old)));
const dashPos = (lx, ly, lz) => [DASH.x + lx, DASH.y + ly * Math.cos(DASH.tilt) + lz * Math.sin(DASH.tilt), DASH.z - ly * Math.sin(DASH.tilt) + lz * Math.cos(DASH.tilt)];
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tex(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Quilted fabric: diamond stitching and a stitched border on a fine weave. Colour and bump share the drawing.
function fabricMaps(base = '#2f3a48', stitch = '#566678') {
  const color = canvas(256, 256), bump = canvas(256, 256);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  const r = rng(11);
  c.fillStyle = base;
  c.fillRect(0, 0, 256, 256);
  b.fillStyle = '#909090';
  b.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const x = r() * 256, y = r() * 256, v = r();
    c.fillStyle = v > 0.5 ? 'rgba(120,140,165,.08)' : 'rgba(10,14,20,.14)';
    c.fillRect(x, y, 2, 1);
    b.fillStyle = v > 0.5 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.14)';
    b.fillRect(x, y, 2, 1);
  }
  for (const [ctx, col, w] of [[c, stitch, 1.5], [b, '#000', 4]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(12, 12, 232, 232);
    ctx.beginPath();
    for (let k = -256; k <= 256; k += 64) { ctx.moveTo(12 + k, 12); ctx.lineTo(244 + k, 244); ctx.moveTo(244 + k, 12); ctx.lineTo(12 + k, 244); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return [tex(color), tex(bump, { srgb: false })];
}

// Pressure-suit cloth: cool off-white weave, long seams with stitching, soft fold bands across the limb.
function suitMaps() {
  const color = canvas(256, 256), bump = canvas(256, 256);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  const r = rng(5);
  c.fillStyle = '#e6eaef';
  c.fillRect(0, 0, 256, 256);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3500; i++) {
    const x = r() * 256, y = r() * 256, v = r();
    c.fillStyle = v > 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(80,95,115,.16)';
    c.fillRect(x, y, 3, 1);
  }
  for (let y = 10; y < 256; y += 42) { // horizontal fold bands
    const g = b.createLinearGradient(0, y - 9, 0, y + 9);
    g.addColorStop(0, 'rgba(128,128,128,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(128,128,128,0)');
    b.fillStyle = g;
    b.fillRect(0, y - 9, 256, 18);
    const gc = c.createLinearGradient(0, y - 9, 0, y + 9);
    gc.addColorStop(0, 'rgba(120,135,155,0)'); gc.addColorStop(0.5, 'rgba(120,135,155,.28)'); gc.addColorStop(1, 'rgba(120,135,155,0)');
    c.fillStyle = gc;
    c.fillRect(0, y - 9, 256, 18);
  }
  for (const x of [64, 192]) { // lengthwise seams, double-stitched
    for (const [ctx, col, w] of [[c, '#8d98a6', 3], [b, '#000', 5]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
    }
    for (const [ctx, col] of [[c, '#5a6572'], [b, '#fff']]) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      for (const dx of [-6, 6]) { ctx.beginPath(); ctx.moveTo(x + dx, 0); ctx.lineTo(x + dx, 256); ctx.stroke(); }
      ctx.setLineDash([]);
    }
  }
  return [tex(color), tex(bump, { srgb: false })];
}

// 2x2 twill carbon-fibre weave, colour and bump.
function carbonMaps() {
  const color = canvas(128, 128), bump = canvas(128, 128);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = '#07090b'; c.fillRect(0, 0, 128, 128);
  b.fillStyle = '#808080'; b.fillRect(0, 0, 128, 128);
  const n = 8, cell = 128 / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dir = ((i >> 1) + (j >> 1)) % 2;
    const g = c.createLinearGradient(i * cell, j * cell, i * cell + (dir ? cell : 0), j * cell + (dir ? 0 : cell));
    g.addColorStop(0, '#2a3037'); g.addColorStop(0.5, '#0c0f12'); g.addColorStop(1, '#222830');
    c.fillStyle = g; c.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
    b.fillStyle = dir ? '#b0b0b0' : '#707070'; b.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
  }
  return [tex(color), tex(bump, { srgb: false })];
}

// Wall panels for the capsule shell: padded off-white panels in a grid of dark stringers, stitched borders, 6 x 4 over the shell.
function shellMaps() {
  const W = 1024, H = 960, color = canvas(W, H), bump = canvas(W, H);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  const r = rng(21);
  c.fillStyle = '#23272c'; c.fillRect(0, 0, W, H);
  b.fillStyle = '#303030'; b.fillRect(0, 0, W, H);
  const cols = 6, rows = 4, gx = 16, cw = W / cols, ch = H / rows;
  const rr = (ctx, x, y, w, h, rad) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * cw + gx / 2, y = j * ch + gx / 2, w = cw - gx, h = ch - gx;
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#a3a9b1'); g.addColorStop(0.5, '#b4bac2'); g.addColorStop(1, '#9ea4ac');
    c.fillStyle = g; rr(c, x, y, w, h, 34); c.fill();
    b.fillStyle = '#9a9a9a'; rr(b, x, y, w, h, 34); b.fill();
    for (let k = 0; k < 500; k++) { c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.09)' : 'rgba(40,50,65,.08)'; c.fillRect(x + r() * w, y + r() * h, 3, 1); }
    c.strokeStyle = '#6f7782'; c.lineWidth = 2; c.setLineDash([9, 7]); rr(c, x + 16, y + 16, w - 32, h - 32, 22); c.stroke();
    b.strokeStyle = '#000'; b.lineWidth = 4; rr(b, x + 16, y + 16, w - 32, h - 32, 22); b.stroke();
    c.setLineDash([]);
    c.strokeStyle = '#8b929b'; c.lineWidth = 2; c.setLineDash([9, 7]); // quilting diagonals
    c.beginPath(); c.moveTo(x + 40, y + 40); c.lineTo(x + w - 40, y + h - 40); c.moveTo(x + w - 40, y + 40); c.lineTo(x + 40, y + h - 40); c.stroke(); c.setLineDash([]);
  }
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) { c.fillStyle = '#6b727b'; c.beginPath(); c.arc(i * cw, j * ch, 5, 0, 7); c.fill(); } // rivets at stringer crossings
  const t1 = tex(color), t2 = tex(bump, { srgb: false });
  t1.wrapS = t1.wrapT = t2.wrapS = t2.wrapT = THREE.ClampToEdgeWrapping;
  return [t1, t2];
}

function outsideTexture() { // what the small side windows show: stars and the planet limb
  const c = canvas(256, 192), x = c.getContext('2d');
  x.fillStyle = '#02050a'; x.fillRect(0, 0, 256, 192);
  const r = rng(9);
  for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; x.fillRect(r() * 256, r() * 192, 1.5, 1.5); }
  const g = x.createRadialGradient(150, 330, 120, 150, 330, 215);
  g.addColorStop(0, '#0c3a66'); g.addColorStop(0.9, '#1a6fb0'); g.addColorStop(1, '#9fd8ff');
  x.fillStyle = g; x.beginPath(); x.arc(150, 330, 215, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function webbingMaps() {
  const color = canvas(64, 64), bump = canvas(64, 64);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = '#3b4048'; c.fillRect(0, 0, 64, 64);
  b.fillStyle = '#808080'; b.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) { c.fillStyle = 'rgba(160,170,185,.25)'; c.fillRect(0, y, 64, 1); b.fillStyle = '#000'; b.fillRect(0, y, 64, 2); }
  c.fillStyle = '#9aa3ad'; c.fillRect(6, 0, 2, 64); c.fillRect(56, 0, 2, 64);
  return [tex(color), tex(bump, { srgb: false })];
}

function floorMaps() {
  const color = canvas(128, 128), bump = canvas(128, 128);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = '#3a4048';
  c.fillRect(0, 0, 128, 128);
  b.fillStyle = '#707070';
  b.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = x * 16 + (y % 2) * 8 + 4, cy = y * 16 + 8;
      for (const [ctx, col] of [[c, '#59616b'], [b, '#e0e0e0']]) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + 5, cy);
        ctx.lineTo(cx, cy + 5);
        ctx.lineTo(cx - 5, cy);
        ctx.fill();
      }
    }
  }
  return [color, bump];
}

function hazardCanvas() {
  const c = canvas(64, 64), x = c.getContext('2d');
  x.fillStyle = '#e8b400';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#101010';
  for (let i = -2; i < 6; i++) {
    x.beginPath();
    x.moveTo(i * 16, 0);
    x.lineTo(i * 16 + 8, 0);
    x.lineTo(i * 16 + 8 + 64, 64);
    x.lineTo(i * 16 + 64, 64);
    x.fill();
  }
  return c;
}

// A flat silk-screened label sheet: items are { t, x, y, s } in pixels.
function labelMaterial(w, h, items, tint = '#9fb4c7', bg = '#0b0e12') {
  const c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(150,170,190,.28)';
  x.lineWidth = 2;
  x.strokeRect(3, 3, w - 6, h - 6);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const it of items) {
    x.font = `700 ${it.s || 14}px ${MONO}`;
    x.fillStyle = it.c || tint;
    x.fillText(it.t, it.x, it.y);
    if (it.line) {
      x.strokeStyle = tint;
      x.beginPath();
      x.moveTo(it.x - it.line, it.y + (it.s || 14) * 0.8);
      x.lineTo(it.x + it.line, it.y + (it.s || 14) * 0.8);
      x.stroke();
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.7, 0.7, 0.7) });
}

function netTexture() {
  const c = canvas(128, 128), x = c.getContext('2d');
  x.strokeStyle = '#6b7684';
  x.lineWidth = 5;
  for (let i = 0; i <= 128; i += 32) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke();
  }
  return tex(c);
}

function grilleTexture() {
  const c = canvas(128, 128), x = c.getContext('2d');
  x.fillStyle = '#07090b';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#46505b';
  x.lineWidth = 3;
  for (let r = 10; r < 62; r += 9) { x.beginPath(); x.arc(64, 64, r, 0, 7); x.stroke(); }
  x.lineWidth = 4;
  for (let a = 0; a < 6.28; a += 0.785) { x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); x.stroke(); }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * @param {object} d  { pbr, glow, matte, trim, panel, shell, low }
 * @returns {{ group: THREE.Group, blinkers: THREE.Mesh[], bind: (root: THREE.Object3D) => { setControls: Function, setButton: Function, press: Function, update: Function } }}
 */
export function buildCockpitInterior({ pbr, glow, matte, trim, panel, shell, low = false }) {
  const group = new THREE.Group();
  group.name = 'cockpitInterior';

  // ---- materials
  const [fabricMap, fabricBump] = fabricMaps();
  const fabric = pbr(0xffffff, 0.92, 0.0, { map: fabricMap, bumpMap: fabricBump, bumpScale: 1.2, envMapIntensity: 0.12 });
  const [webC, webB] = webbingMaps();
  const strapMat = pbr(0xffffff, 0.9, 0.0, { map: webC, bumpMap: webB, bumpScale: 1, envMapIntensity: 0.1 });
  const [suitC, suitB] = suitMaps();
  const suit = pbr(0xc9ced6, 0.88, 0.0, { map: suitC, bumpMap: suitB, bumpScale: 2.2, envMapIntensity: 0.15 });
  const suitShade = pbr(0xa3aab4, 0.85, 0.0, { map: suitC, bumpMap: suitB, bumpScale: 2.2, envMapIntensity: 0.12 });
  const pad = pbr(0x8b929c, 0.6, 0.15, { envMapIntensity: 0.2 });
  const boot = pbr(0xb3b8bf, 0.7, 0.05, { map: suitC, bumpMap: suitB, bumpScale: 1.5, envMapIntensity: 0.18 });
  const [quiltC, quiltB] = fabricMaps('#656c76', '#4c545f');
  const quilt = pbr(0xffffff, 0.9, 0.0, { map: quiltC, bumpMap: quiltB, bumpScale: 1.4, envMapIntensity: 0.1 });
  const [padC, padB] = fabricMaps('#7a8089', '#5f6671');
  const padLight = pbr(0xffffff, 0.9, 0.0, { map: padC, bumpMap: padB, bumpScale: 1.3, envMapIntensity: 0.12 });
  const [carbC, carbB] = carbonMaps();
  carbC.repeat.set(8, 8); carbB.repeat.set(8, 8);
  const carbon = pbr(0xffffff, 0.34, 0.45, { map: carbC, bumpMap: carbB, bumpScale: 1.2, envMapIntensity: 0.5 });
  const lightPanel = pbr(0x646a72, 0.7, 0.1, { envMapIntensity: 0.15 });
  const led = glow('#2dd4bf', 0.95), ledBlue = glow('#38bdf8', 0.85);
  const [bagC, bagB] = fabricMaps('#3a3f36', '#5d6455');
  const bagMat = pbr(0xffffff, 0.95, 0.0, { map: bagC, bumpMap: bagB, bumpScale: 1.2, envMapIntensity: 0.08 });
  const cableDark = pbr(0x14171b, 0.7, 0.1), cableRed = pbr(0x8e1d18, 0.7, 0.1), cableBlue = pbr(0x1d3f7a, 0.7, 0.1);
  const sole = pbr(0x16191c, 0.9, 0.0, { envMapIntensity: 0.05 });
  const rubber = pbr(0x0b0d10, 0.85, 0.05, { envMapIntensity: 0.1 });
  const dark = pbr(0x090b0e, 0.9, 0.1, { envMapIntensity: 0.05 });
  const metal = pbr(0x8a929b, 0.35, 0.9);
  const [fc, fb] = floorMaps();
  const floorMat = (rep) => pbr(0xffffff, 0.8, 0.3, { map: tex(fc, { repeat: rep }), bumpMap: tex(fb, { srgb: false, repeat: rep }), bumpScale: 1.5, envMapIntensity: 0.12 });
  const floor = floorMat(9);
  const plate = floorMat(1.4);
  const red = pbr(0xb3261e, 0.5, 0.2, { envMapIntensity: 0.25 });
  const yellow = pbr(0xd9a400, 0.5, 0.2, { envMapIntensity: 0.25 });
  const orange = pbr(0xc2561a, 0.7, 0.1);
  const hazardEdge = new THREE.MeshStandardMaterial({ map: tex(hazardCanvas(), { repeat: 1 }), roughness: 0.6, metalness: 0.2 });
  hazardEdge.map.repeat.set(30, 1);
  const hazardMap = tex(hazardCanvas(), { repeat: 1 });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardMap, roughness: 0.55, metalness: 0.2 });
  const lamp = {
    cyan: glow('#22d3ee', 2.4), amber: glow('#fbbf24', 2.4), green: glow('#34d399', 2.2), red: glow('#f87171', 2.6),
    off: new THREE.MeshBasicMaterial({ color: 0x1b2630 }),
  };

  // ---- static geometry merged per material
  const buckets = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function put(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    q.setFromEuler(e.set(rx, ry, rz));
    m4.compose(v.set(x, y, z), q, one.clone().set(sx, sy, sz));
    geo.applyMatrix4(m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  const rb = (w, h, d, mat, x, y, z, r = 0.02, rx = 0, ry = 0, rz = 0) =>
    put(new RoundedBoxGeometry(w, h, d, w * h * d > 0.004 ? 2 : 1, Math.min(r, w / 2, h / 2, d / 2)), mat, x, y, z, rx, ry, rz);
  const cyl = (rt, rbm, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 12) => put(new THREE.CylinderGeometry(rt, rbm, h, seg), mat, x, y, z, rx, ry, rz);
  // capsule limb between two points, optionally flattened (sx, sz)
  function limb(a, b, r, mat, sx = 1, sz = 1) {
    const dir = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const len = dir.length();
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10);
    const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize());
    m4.compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), quat, new THREE.Vector3(sx, 1, sz));
    geo.applyMatrix4(m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  // flat strap between two points
  function strap(a, b, w, t, mat) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const geo = new THREE.BoxGeometry(w, t, len);
    const o = new THREE.Object3D();
    o.position.copy(A).add(B).multiplyScalar(0.5);
    o.lookAt(B);
    o.updateMatrix();
    geo.applyMatrix4(o.matrix);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  const lampBox = new THREE.BoxGeometry(0.011, 0.006, 0.011);
  const lampAt = (mat, x, y, z) => put(lampBox.clone(), mat, x, y, z);

  // ---- seat: single-piece carbon-fibre shell with white/grey cushion pads (headrest sits behind the eye, z > 0)
  rb(0.58, 0.07, 0.62, carbon, 0, -0.865, 0.2, 0.03, -0.06); // seat pan shell
  rb(0.46, 0.06, 0.5, padLight, 0, -0.81, 0.2, 0.03, -0.08); // seat cushion
  [-1, 1].forEach((s) => rb(0.06, 0.15, 0.56, carbon, s * 0.31, -0.78, 0.2, 0.03, -0.08)); // pan side bolsters
  rb(0.58, 1.0, 0.05, carbon, 0, -0.34, 0.38, 0.03, 0.16); // back shell
  rb(0.44, 0.74, 0.07, padLight, 0, -0.36, 0.33, 0.03, 0.16); // back cushion
  rb(0.3, 0.13, 0.05, padLight, 0, -0.67, 0.3, 0.02, 0.16); // lumbar pad
  [-1, 1].forEach((s) => rb(0.07, 0.74, 0.2, carbon, s * 0.3, -0.38, 0.3, 0.03, 0.16, -s * 0.3)); // back side wings
  rb(0.32, 0.3, 0.05, carbon, 0, 0.1, 0.45, 0.03, 0.18); // headrest shell
  rb(0.24, 0.2, 0.05, padLight, 0, 0.08, 0.415, 0.025, 0.18); // headrest pad
  [-1, 1].forEach((s) => { // headrest wings curving forward around the head
    rb(0.05, 0.3, 0.15, carbon, s * 0.19, 0.1, 0.38, 0.025, 0.18, -s * 0.6);
    rb(0.03, 0.2, 0.09, padLight, s * 0.165, 0.08, 0.35, 0.015, 0.18, -s * 0.6);
  });
  // seat frame: base down to the floor
  rb(0.56, 0.5, 0.5, dark, 0, -1.18, 0.22, 0.03);
  rb(0.08, 0.2, 0.2, metal, 0, -0.45, 0.45, 0.015, 0.16);
  [-1, 1].forEach((s) => {
    rb(0.1, 0.62, 0.34, dark, s * 0.43, -1.2, 0.26, 0.02); // armrest column
    rb(0.14, 0.05, 0.52, carbon, s * 0.42, -0.71, 0.27, 0.025); // carbon armrest
    rb(0.1, 0.025, 0.4, padLight, s * 0.42, -0.675, 0.27, 0.012); // armrest pad
  });

  // ---- harness: five points (two shoulder, two lap, one crotch) to a rotary buckle
  const buckle = [0, -0.58, 0.02];
  [-1, 1].forEach((s) => {
    strap([s * 0.14, -0.17, 0.1], [s * 0.04, -0.54, 0.03], 0.042, 0.012, strapMat); // shoulder, lying on the chest
    strap([s * 0.28, -0.7, 0.17], [s * 0.04, -0.6, 0.0], 0.045, 0.012, strapMat); // lap
    rb(0.045, 0.02, 0.03, metal, s * 0.1, -0.3, 0.085, 0.006); // strap adjusters
  });
  strap([0, -0.58, 0.0], [0, -0.74, -0.2], 0.04, 0.012, strapMat); // crotch strap
  cyl(0.032, 0.032, 0.018, metal, ...buckle, Math.PI / 2 - 0.4, 0, 0, 16);
  cyl(0.012, 0.012, 0.02, red, buckle[0], buckle[1] + 0.006, buckle[2] - 0.006, Math.PI / 2 - 0.4, 0, 0, 8);

  // ---- the pilot's body: white pressure suit. Tapered limbs, bellows at the joints, seams and folds from the cloth maps.
  const V = (a) => new THREE.Vector3(...a);
  function tube(a, b, r0, r1, mat, seg = 14) { // tapered cylinder from a (radius r0) to b (radius r1)
    const dir = V(b).sub(V(a));
    const geo = new THREE.CylinderGeometry(r1, r0, dir.length(), seg, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize());
    m4.compose(V(a).add(V(b)).multiplyScalar(0.5), quat, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  function ring(c, dir, R, t, mat) { // torus with its axis along dir (a bellows or collar ring)
    const geo = new THREE.TorusGeometry(R, t, 6, 14);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    m4.compose(V(c), quat, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  limb([0, -0.74, 0.17], [0, -0.1, 0.2], 0.17, suit, 1.3, 0.78); // torso, chest behind the eye plane
  rb(0.12, 0.08, 0.03, pad, 0, -0.38, 0.065, 0.012); // chest connector box
  cyl(0.012, 0.012, 0.02, metal, -0.03, -0.38, 0.05, Math.PI / 2, 0, 0, 8);
  cyl(0.012, 0.012, 0.02, red, 0.03, -0.38, 0.05, Math.PI / 2, 0, 0, 8);
  [-1, 1].forEach((s) => {
    const hip = [s * 0.14, -0.74, 0.12], knee = [s * 0.19, -0.6, -0.34], ankle = [s * 0.19, -0.95, -0.5], toe = [s * 0.19, -1.0, -0.62];
    const tu = V(knee).sub(V(hip)).normalize(), su = V(ankle).sub(V(knee)).normalize();
    tube(hip, V(knee).addScaledVector(tu, -0.05).toArray(), 0.082, 0.064, suit); // thigh, about 0.16 m across at the top
    for (const k of [-1.5, -0.5]) ring(V(knee).addScaledVector(tu, k * 0.024), tu, 0.066, 0.013, suitShade); // knee bellows
    for (const k of [0.5, 1.5]) ring(V(knee).addScaledVector(su, k * 0.024), su, 0.066, 0.013, suitShade);
    put(new THREE.SphereGeometry(0.06, 10, 8), suitShade, knee[0], knee[1] - 0.005, knee[2], 0, 0, 0, 1, 0.9, 1);
    tube(V(knee).addScaledVector(su, 0.05).toArray(), ankle, 0.06, 0.046, suit); // shin
    rb(0.12, 0.045, 0.12, pad, knee[0], knee[1] + 0.06, knee[2] - 0.015, 0.02, -0.25); // knee pad
    rb(0.14, 0.012, 0.02, strapMat, knee[0], knee[1] + 0.085, knee[2] + 0.04, 0.004, -0.25); // pad strap
    rb(0.05, 0.03, 0.11, suitShade, knee[0] + s * 0.07, (hip[1] + knee[1]) / 2 + 0.03, (hip[2] + knee[2]) / 2 - 0.02, 0.012, 0, 0, -s * 0.1); // thigh pocket
    rb(0.016, 0.034, 0.08, metal, s * 0.19, -0.755, 0.04, 0.005, 0.08); // suit-hose connector on the thigh
    // boot: collar, upper, toe cap, thick lugged sole, straps and laces
    ring(ankle, su, 0.052, 0.012, pad);
    rb(0.1, 0.1, 0.14, boot, ankle[0], ankle[1] - 0.04, ankle[2] - 0.02, 0.03);
    rb(0.1, 0.07, 0.2, boot, toe[0], toe[1] - 0.03, toe[2] + 0.02, 0.03);
    rb(0.102, 0.05, 0.06, rubber, toe[0], toe[1] - 0.04, toe[2] - 0.07, 0.02); // toe cap
    rb(0.108, 0.03, 0.27, sole, toe[0], toe[1] - 0.085, toe[2] + 0.04, 0.012); // sole
    for (let i = 0; i < 4; i++) rb(0.11, 0.008, 0.012, rubber, toe[0], toe[1] - 0.1, toe[2] + 0.12 - i * 0.065, 0.003); // sole lugs
    for (const z of [-0.0, -0.1]) rb(0.108, 0.014, 0.035, strapMat, toe[0], toe[1] + 0.012, toe[2] + 0.1 + z * 0.5 + 0.02, 0.004); // velcro straps
    for (let i = 0; i < 4; i++) rb(0.05, 0.006, 0.008, suit, toe[0], toe[1] + 0.008 + i * 0.002, toe[2] - 0.0 + 0.07 + i * 0.012, 0.002); // laces
    // footrest: tilted tread plate on struts, rubber toe bar
    rb(0.2, 0.025, 0.3, plate, s * 0.19, -1.075, -0.52, 0.01, 0.35);
    rb(0.2, 0.04, 0.03, rubber, s * 0.19, -1.0, -0.68, 0.01);
    cyl(0.012, 0.012, 0.08, metal, s * 0.19, -1.11, -0.4, 0, 0, 0, 8);
  });
  // sleeves: shoulder cap, upper arm, elbow bellows, forearm and a wrist ring
  [-1, 1].forEach((s) => {
    const shoulder = [s * 0.23, -0.14, 0.2], elbow = [s * 0.4, -0.6, 0.31], wrist = [s * 0.43, -0.67, s > 0 ? -0.15 : -0.07];
    const uu = V(elbow).sub(V(shoulder)).normalize(), fu = V(wrist).sub(V(elbow)).normalize();
    put(new THREE.SphereGeometry(0.058, 12, 8), suit, shoulder[0], shoulder[1] - 0.01, shoulder[2], 0, 0, 0, 1.15, 0.8, 1);
    ring(V(shoulder).add(new THREE.Vector3(s * 0.02, -0.045, 0)), uu, 0.058, 0.01, metal); // shoulder bearing ring
    tube(shoulder, V(elbow).addScaledVector(uu, -0.04).toArray(), 0.062, 0.05, suit);
    for (const k of [-1, 0]) ring(V(elbow).addScaledVector(uu, k * 0.022 - 0.01), uu, 0.052, 0.011, suitShade);
    for (const k of [1, 2]) ring(V(elbow).addScaledVector(fu, k * 0.022 - 0.01), fu, 0.05, 0.011, suitShade);
    tube(V(elbow).addScaledVector(fu, 0.05).toArray(), wrist, 0.05, 0.04, suit);
    tube(V(wrist).addScaledVector(fu, -0.035).toArray(), V(wrist).addScaledVector(fu, 0.005).toArray(), 0.047, 0.047, metal, 16); // wrist ring
    ring(V(wrist).addScaledVector(fu, 0.008), fu, 0.045, 0.006, rubber);
  });

  // ---- pedestal between the shins: guarded switches, dial, ABORT T-handle
  rb(0.17, 0.2, 0.36, panel, 0, -0.98, -0.62, 0.025);
  rb(0.165, 0.025, 0.3, dark, 0, -0.87, -0.62, 0.01, -0.12);
  const pedSwitches = [-0.05, 0.05];
  pedSwitches.forEach((x) => [-0.5, -0.62].forEach((z) => {
    rb(0.04, 0.03, 0.04, dark, x, -0.875, z, 0.01, -0.12);
    rb(0.032, 0.014, 0.05, yellow, x, -0.855, z + (z > -0.55 ? 0.005 : 0), 0.004, -0.12); // guard flap
    cyl(0.004, 0.004, 0.026, metal, x, -0.86, z, 0, 0, 0.3, 6);
  }));
  cyl(0.026, 0.028, 0.02, dark, 0, -0.865, -0.7, -0.12, 0, 0, 16); // rotary dial
  cyl(0.02, 0.02, 0.022, metal, 0, -0.855, -0.7, -0.12, 0, 0, 16);
  rb(0.006, 0.006, 0.026, red, 0, -0.842, -0.703, 0.002, -0.12);
  // ABORT: guard bracket, stem, striped handle
  rb(0.15, 0.04, 0.024, red, 0, -0.985, -0.44, 0.01);
  rb(0.014, 0.065, 0.014, metal, 0, -0.945, -0.44, 0.005);
  const abortGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.115, 12);
  abortGeo.rotateZ(Math.PI / 2);
  const abortMesh = new THREE.Mesh(abortGeo, hazard);
  abortMesh.position.set(0, -0.905, -0.44);
  group.add(abortMesh);
  [-1, 1].forEach((s) => rb(0.014, 0.075, 0.022, red, s * 0.074, -0.9, -0.44, 0.005)); // guard arms
  lampAt(lamp.red, 0.06, -0.87, -0.7);
  lampAt(lamp.amber, -0.06, -0.87, -0.7);

  // ---- side consoles under the armrests: switch rows, silk-screen labels, lamps
  const labelsL = [
    { t: 'RCS', x: 40, y: 18, s: 14 }, { t: 'ATT', x: 110, y: 18, s: 14 }, { t: 'FUEL', x: 180, y: 18, s: 14 },
    { t: 'PWR', x: 250, y: 18, s: 14 }, { t: 'COMMS', x: 320, y: 18, s: 14 }, { t: 'THERM', x: 390, y: 18, s: 14 },
    { t: 'MAIN A', x: 70, y: 150, s: 12 }, { t: 'MAIN B', x: 170, y: 150, s: 12 }, { t: 'CABIN', x: 270, y: 150, s: 12 }, { t: 'SUIT', x: 370, y: 150, s: 12 },
  ];
  const consoleLabels = [labelMaterial(450, 180, labelsL), labelMaterial(450, 180, labelsL.map((it) => ({ ...it, t: it.t === 'RCS' ? 'LIGHTS' : it.t === 'ATT' ? 'O2' : it.t })))];
  const blinkers = [];
  [-1, 1].forEach((s, side) => {
    const cx = s * 0.66;
    rb(0.62, 0.26, 1.15, panel, cx, -1.0, -0.43, 0.025); // console body
    rb(0.6, 0.015, 1.05, dark, cx, -0.866, -0.45, 0.005);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.56), consoleLabels[side]);
    label.rotation.set(-Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    label.geometry = new THREE.PlaneGeometry(0.56, 0.22); // long edge runs along the console (z)
    label.position.set(cx + s * 0.1, -0.858, -0.45);
    group.add(label);
    const rows = low ? 1 : 2;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < 6; i++) {
        const x = cx + s * (0.2 - r * 0.2), zz = -0.45 + (i - 2.5) * 0.17, up = (i + r) % 2;
        if (r === 1 && i === 3) continue; // the flight-switch pads sit here (z -0.42..-0.25)
        rb(0.026, 0.012, 0.026, dark, x, -0.86, zz, 0.004);
        cyl(0.0035, 0.0035, 0.034, metal, x, -0.845, zz, up ? 0.45 : -0.45, 0, 0, 6);
        lampAt([lamp.cyan, lamp.green, lamp.amber, lamp.cyan, lamp.off, lamp.red][(i * 2 + r + side) % 6], x, -0.858, zz + 0.04);
      }
    }
    // row of indicator lamps along the console's inner edge
    for (let i = 0; i < 10; i++) {
      const m = [lamp.cyan, lamp.green, lamp.amber, lamp.off][(i + side * 2) % 4];
      lampAt(m, s * 0.39, -0.862, -0.9 + i * 0.075);
    }
  });

  // ---- throttle quadrant plate and joystick base (static parts); moving parts are built below
  const stickBase = new THREE.Vector3(0.43, -0.862, -0.2);
  const thrBase = new THREE.Vector3(-0.43, -0.862, -0.1);
  cyl(0.052, 0.07, 0.04, rubber, stickBase.x, stickBase.y + 0.02, stickBase.z, 0, 0, 0, 20); // stick mount
  rb(0.11, 0.025, 0.4, dark, thrBase.x, thrBase.y + 0.005, thrBase.z - 0.04, 0.01); // quadrant plate
  rb(0.02, 0.01, 0.3, rubber, thrBase.x, thrBase.y + 0.02, thrBase.z - 0.04, 0.004); // slot
  // detent marks on the quadrant plate
  for (let i = 0; i <= 10; i++) rb(i % 5 === 0 ? 0.04 : 0.025, 0.003, 0.004, metal, thrBase.x + 0.04, thrBase.y + 0.019, thrBase.z + 0.1 - i * 0.028, 0.001);
  const thrLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04), labelMaterial(96, 64, [{ t: 'THR', x: 48, y: 22, s: 20 }, { t: 'IDLE   MAX', x: 48, y: 48, s: 10 }]));
  thrLabel.rotation.x = -Math.PI / 2;
  thrLabel.position.set(thrBase.x - 0.035, thrBase.y + 0.019, thrBase.z + 0.1);
  group.add(thrLabel);

  // ---- floor, lower walls, kick plates (everything closes down to the floor)
  rb(2.4, 0.1, 2.7, floor, 0, -1.6, -0.45, 0.01);
  [-1, 1].forEach((s) => {
    rb(0.2, 0.62, 2.3, shell, s * 1.0, -1.28, -0.55, 0.04); // lower side wall under the existing wall (y -1.0 down to the floor)
    rb(0.04, 0.2, 2.1, trim, s * 0.9, -1.5, -0.55, 0.01); // kick rail
    cyl(0.018, 0.018, 2.1, dark, s * 0.84, -1.5, -0.55, Math.PI / 2, 0, 0, 8); // cable conduit
    cyl(0.012, 0.012, 2.1, dark, s * 0.8, -1.52, -0.55, Math.PI / 2, 0, 0, 8);
  });
  rb(2.1, 0.12, 0.1, matte, 0, -1.1, -0.62, 0.02); // closes the gap under the instrument face
  rb(2.4, 0.5, 0.15, shell, 0, -1.32, 0.75, 0.03); // lower rear bulkhead
  rb(2.4, 0.2, 0.5, lightPanel, 0, 0.94, 0.55, 0.05); // overhead behind the pilot (closes the gap to the rear bulkhead)
  rb(2.4, 0.2, 0.3, lightPanel, 0, 0.94, 0.8, 0.05);
  // floor hatch frame and ribs
  rb(0.5, 0.012, 0.5, plate, 0, -1.544, 0.5, 0.004);
  rb(0.5, 0.02, 0.02, trim, 0, -1.54, 0.25, 0.004);
  rb(0.5, 0.02, 0.02, trim, 0, -1.54, 0.75, 0.004);

  // ---- storage and equipment on the lower walls
  const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, color: new THREE.Color(0.55, 0.6, 0.66), side: THREE.DoubleSide, alphaTest: 0.2 });
  const grilleMat = new THREE.MeshBasicMaterial({ map: grilleTexture(), color: new THREE.Color(0.8, 0.8, 0.8) });
  const wallR = 0.965; // inner face of the side walls
  [-1, 1].forEach((s) => { // cloth pouches on the lower walls (the wall's inner face is at |x| = 0.9)
    rb(0.05, 0.26, 0.5, bagMat, s * 0.875, -1.28, -0.28, 0.02);
    rb(0.055, 0.04, 0.52, strapMat, s * 0.872, -1.16, -0.28, 0.01); // flap
    rb(0.056, 0.2, 0.03, strapMat, s * 0.872, -1.28, -0.28, 0.008); // strap
    rb(0.016, 0.03, 0.04, metal, s * 0.848, -1.17, -0.28, 0.005); // buckle
  });
  // cargo net on the right wall, behind the console
  const net = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), netMat);
  net.material.map.repeat.set(3, 2.5);
  net.rotation.y = -Math.PI / 2;
  net.position.set(X(1, 0.955, -0.45, 0.3), -0.45, 0.3);
  group.add(net);
  // oxygen bottle (left wall) and fire extinguisher (right wall)
  cyl(0.065, 0.065, 0.52, metal, -0.8, -1.22, 0.42, 0, 0, 0, 16);
  cyl(0.03, 0.04, 0.05, metal, -0.8, -0.935, 0.42, 0, 0, 0, 12);
  rb(0.06, 0.06, 0.03, red, -0.8, -0.9, 0.42, 0.01);
  cyl(0.068, 0.068, 0.012, strapMat, -0.8, -1.1, 0.42, 0, 0, 0, 16);
  cyl(0.068, 0.068, 0.012, strapMat, -0.8, -1.35, 0.42, 0, 0, 0, 16);
  cyl(0.055, 0.055, 0.42, red, 0.8, -1.26, 0.42, 0, 0, 0, 16);
  cyl(0.03, 0.035, 0.05, dark, 0.8, -1.02, 0.42, 0, 0, 0, 12);
  rb(0.03, 0.03, 0.1, dark, 0.8, -1.0, 0.37, 0.01); // handle
  cyl(0.058, 0.058, 0.012, strapMat, 0.8, -1.15, 0.42, 0, 0, 0, 16);
  cyl(0.058, 0.058, 0.012, strapMat, 0.8, -1.38, 0.42, 0, 0, 0, 16);
  // hatch with a handle on the left wall
  const hx = (old) => X(-1, old, -0.38, 0.3);
  cyl(0.19, 0.19, 0.02, trim, hx(0.96), -0.38, 0.3, 0, 0, Math.PI / 2, 24);
  cyl(0.16, 0.16, 0.03, shell, hx(0.955), -0.38, 0.3, 0, 0, Math.PI / 2, 24);
  rb(0.03, 0.04, 0.2, metal, hx(0.93), -0.38, 0.3, 0.01);
  cyl(0.025, 0.025, 0.03, metal, hx(0.935), -0.38, 0.3, 0, 0, Math.PI / 2, 12);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; cyl(0.008, 0.008, 0.02, metal, hx(0.95), -0.38 + Math.sin(a) * 0.175, 0.3 + Math.cos(a) * 0.175, 0, 0, Math.PI / 2, 6); }
  // rear bulkhead lockers: 2 x 3 doors, handles and a fan grille
  const rearZ = 0.66;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = -0.85 + i * 0.35, y = -0.78 + j * 0.42 + 0.0;
      rb(0.32, 0.38, 0.03, lightPanel, x, y, rearZ, 0.012);
      rb(0.1, 0.02, 0.025, metal, x, y + 0.12, rearZ - 0.02, 0.008);
      lampAt(lamp[['green', 'amber', 'cyan'][(i + j) % 3]], x + 0.12, y - 0.14, rearZ - 0.02);
    }
  }
  [0.25, 0.55, 0.85].forEach((x) => rb(0.26, 0.5, 0.03, lightPanel, x, -0.55, rearZ, 0.012));
  [0.25, 0.55, 0.85].forEach((x) => rb(0.1, 0.02, 0.025, metal, x, -0.4, rearZ - 0.02, 0.008));
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), grilleMat);
  grille.position.set(0.55, 0.0, rearZ - 0.018);
  grille.rotation.y = Math.PI;
  group.add(grille);
  rb(0.38, 0.38, 0.02, trim, 0.55, 0.0, rearZ - 0.005, 0.01);
  const rearLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.12), labelMaterial(300, 60, [{ t: 'STOWAGE   LIFE SUPPORT   FILTER', x: 150, y: 30, s: 13 }]));
  rearLabel.position.set(-0.4, 0.2, rearZ - 0.018);
  rearLabel.rotation.y = Math.PI;
  group.add(rearLabel);
  // overhead: switch panel and a dome light fixture (emissive only)
  rb(0.9, 0.012, 0.4, dark, 0, 0.834, -0.1, 0.004);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) {
    const x = -0.38 + i * 0.095, z = -0.24 + r * 0.14;
    rb(0.022, 0.01, 0.022, trim, x, 0.827, z, 0.004);
    cyl(0.003, 0.003, 0.025, metal, x, 0.815, z, ((i + r) % 2 ? 0.4 : -0.4), 0, 0, 6);
    if ((i + r) % 3 === 0) lampAt(lamp[['cyan', 'green', 'amber'][(i + r) % 3 === 0 ? i % 3 : 0]], x, 0.828, z + 0.045);
  }
  cyl(0.11, 0.12, 0.02, trim, 0, 0.84, 0.3, 0, 0, 0, 24);
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 24), glow('#ffe6c4', 1.6));
  dome.position.set(0, 0.832, 0.3);
  group.add(dome);

  // ---- wall structure: padded quilted panels, handholds, placards, velcro, stowage bags, cable bundles, status strips
  const cableZ = (x, y, z0, z1) => { // a bundle of three cables along z
    const len = z1 - z0, zc = (z0 + z1) / 2;
    cyl(0.009, 0.009, len, cableDark, x, y, zc, Math.PI / 2, 0, 0, 6);
    cyl(0.008, 0.008, len, cableRed, x + Math.sign(x) * -0.014, y + 0.008, zc, Math.PI / 2, 0, 0, 6);
    cyl(0.008, 0.008, len, cableBlue, x + Math.sign(x) * -0.014, y - 0.008, zc, Math.PI / 2, 0, 0, 6);
    for (let z = z0 + 0.05; z < z1; z += 0.22) rb(0.03, 0.04, 0.014, metal, x + Math.sign(x) * -0.006, y, z, 0.004); // clips
  };
  const placard = (side, z, y, w, h, items) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMaterial(Math.round(w * 700), Math.round(h * 700), items));
    m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    m.position.set(X(side, 0.9375, y, z), y, z);
    group.add(m);
  };
  [-1, 1].forEach((s, side) => {
    // handholds: U-shaped bars standing off the wall
    for (const z of [-0.12, 0.45]) {
      cyl(0.008, 0.008, 0.05, orange, X(s, 0.915, 0.38, z), 0.38, z - 0.07, 0, 0, Math.PI / 2, 8);
      cyl(0.008, 0.008, 0.05, orange, X(s, 0.915, 0.38, z), 0.38, z + 0.07, 0, 0, Math.PI / 2, 8);
      cyl(0.011, 0.011, 0.16, orange, X(s, 0.89, 0.38, z), 0.38, z, Math.PI / 2, 0, 0, 10);
    }
    // velcro patches and a cloth bag on the panels
    for (const [z, y] of [[0.0, 0.62], [0.35, 0.5], [0.3, 0.12]]) {
      rb(0.01, 0.05, 0.11, dark, X(s, 0.94, y, z), y, z, 0.004);
      rb(0.011, 0.04, 0.09, rubber, X(s, 0.936, y, z), y, z, 0.003);
    }
    const by = side ? 0.18 : 0.46;
    rb(0.08, 0.2, 0.22, bagMat, X(s, 0.89, by, 0.5), by, 0.5, 0.03);
    rb(0.084, 0.02, 0.225, strapMat, X(s, 0.887, by, 0.5), by - 0.06, 0.5, 0.006);
    rb(0.084, 0.02, 0.225, strapMat, X(s, 0.887, by, 0.5), by + 0.06, 0.5, 0.006);
    // cable bundles along the ceiling edge and the panel base, following the curve
    cableZ(X(s, 0.9, 0.7, 0.1), 0.7, -0.4, 0.62);
    cableZ(X(s, 0.9, -0.04, 0.1), -0.04, -0.3, 0.62);
    // status strips
    rb(0.006, 0.01, 0.16, lamp[side ? 'cyan' : 'green'], X(s, 0.936, 0.6, 0.05), 0.6, 0.05, 0.002);
    rb(0.006, 0.01, 0.08, lamp.amber, X(s, 0.936, 0.6, 0.28), 0.6, 0.28, 0.002);
    rb(0.006, 0.01, 0.12, lamp[side ? 'green' : 'cyan'], X(s, 0.936, -0.01, 0.42), -0.01, 0.42, 0.002);
  });
  placard(1, -0.1, 0.45, 0.2, 0.05, [{ t: 'HANDHOLD  25 kg', x: 70, y: 17, s: 11 }]);
  placard(-1, 0.1, 0.62, 0.26, 0.06, [{ t: 'EMERGENCY EXIT', x: 90, y: 21, s: 14, c: '#f1c40f' }]);
  placard(1, 0.35, 0.02, 0.2, 0.05, [{ t: 'CONTAINER B-3', x: 70, y: 17, s: 11 }]);
  placard(-1, 0.3, -0.17, 0.2, 0.05, [{ t: 'DO NOT BLOCK', x: 70, y: 17, s: 12, c: '#f87171' }]);
  // ceiling beams (stringers) and cable runs, inside the rolled-over ceiling edge
  [-0.5, 0.5].forEach((x) => { rb(0.05, 0.03, 1.5, trim, x, 0.83, 0.1, 0.01); cableZ(x + Math.sign(x) * 0.06, 0.8, -0.3, 0.6); });
  [-0.2, 0.2, 0.55].forEach((z) => rb(1.1, 0.03, 0.04, trim, 0, 0.83, z, 0.01));
  // step edge markings (yellow and black, only where the floor changes height)
  rb(2.0, 0.008, 0.045, hazardEdge, 0, -1.147, -0.37, 0.002);
  [-1, 1].forEach((s) => rb(0.045, 0.01, 0.6, hazardEdge, s * 0.58, -1.548, 0.45, 0.002));
  // floor panel seams and tread plates under the seat
  [-0.3, 0.3].forEach((x) => rb(0.012, 0.006, 2.1, dark, x, -1.549, 0.15, 0.002));
  [0.0, 0.5, 1.0].forEach((z) => rb(2.2, 0.006, 0.012, dark, 0, -1.549, z - 0.1, 0.002));

  // ---- hard-button row under the displays, with a yellow-and-black emergency pull handle in the centre
  const T = -DASH.tilt;
  const rbT = (w, h, d, mat, lx, ly, lz, r = 0.01) => rb(w, h, d, mat, ...dashPos(lx, ly, lz), r, T);
  const lampT = (mat, lx, ly, lz) => put(lampBox.clone(), mat, ...dashPos(lx, ly, lz), T);
  rbT(1.84, 0.1, 0.05, dark, 0, -0.3, 0.0, 0.015); // ledge
  rbT(1.78, 0.012, 0.052, trim, 0, -0.35, 0.0, 0.004);
  // Each button is its own small group named `btn:<id>` (cap + lamp), so cockpit.userData.setButton/press can drive it per instance.
  // Left to right (8, then 7 after the emergency handle in the middle). The last field is the lamp colour it shows until setButton is called.
  const BUTTONS = [
    ['fire', 'FIRE', metal, 'green'], ['dump', 'DUMP', yellow, 'cyan'], ['rcs-a', 'RCS A', metal, 'amber'], ['rcs-b', 'RCS B', red, 'green'],
    ['main', 'MAIN', metal, 'cyan'], ['apu', 'APU', yellow, 'off'], ['pwr', 'PWR', metal, 'green'], ['comms', 'COMMS', metal, 'cyan'],
    ['hatch', 'HATCH', red, 'off'], ['cabin', 'CABIN', yellow, 'off'], ['o2', 'O2', red, 'off'], ['arm', 'ARM ENG', red, 'off'],
    ['dock', 'DOCK', metal, 'green'], ['para', 'PARA', yellow, 'cyan'], ['entry', 'ENTRY', metal, 'amber'],
  ];
  const labelItems = [];
  const capGeo = new RoundedBoxGeometry(0.036, 0.02, 0.02, 1, 0.007);
  BUTTONS.forEach((def, i) => {
    const [id, label, capMat, initial] = def;
    const cx = i < 8 ? -(0.13 + (7 - i) * 0.098) : 0.13 + (i - 8) * 0.098; // 8 left and 7 right of the centre handle
    rbT(0.05, 0.03, 0.022, dark, cx, -0.305, 0.034, 0.006); // guard base
    const btn = new THREE.Group();
    btn.name = `btn:${id}`;
    btn.userData.initial = initial;
    btn.position.set(...dashPos(cx, -0.305, 0));
    btn.rotation.x = T;
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.name = 'btnCap';
    cap.position.set(0, 0, 0.05);
    const light = new THREE.Mesh(lampBox, lamp[initial] ?? lamp.off); // shared material until bind() gives this instance its own
    light.name = 'btnLamp';
    light.position.set(0, 0.033, 0.027);
    light.scale.set(1.5, 1.5, 1.5);
    btn.add(cap, light);
    group.add(btn);
    labelItems.push({ t: label, x: ((cx + 0.87) / 1.74) * 1280, y: 24, s: label.length > 6 ? 13 : 17 });
  });
  labelItems.push({ t: 'EMERGENCY', x: 640, y: 24, s: 15, c: '#e8b400' });
  const labelStrip = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.0475), labelMaterial(1280, 48, labelItems, '#9fb4c7', '#06090c'));
  labelStrip.position.set(...dashPos(0, -0.34, 0.0262));
  labelStrip.rotation.x = T;
  group.add(labelStrip);
  rbT(0.17, 0.08, 0.022, red, 0, -0.3, 0.032, 0.01); // handle housing
  [-1, 1].forEach((sg) => rbT(0.012, 0.04, 0.05, metal, sg * 0.05, -0.3, 0.07, 0.004));
  rbT(0.13, 0.028, 0.028, hazard, 0, -0.3, 0.1, 0.012); // striped pull bar
  lampT(lamp.red, -0.075, -0.265, 0.045);
  lampT(lamp.red, 0.075, -0.265, 0.045);

  // ---- mood lighting: teal LED strips (emissive only) along the ceiling, display panel, console and floor edges
  const strip = (w, h, d, mat, x, y, z, rx = 0) => rb(w, h, d, mat, x, y, z, 0.002, rx);
  [-1, 1].forEach((sg) => {
    strip(0.012, 0.008, 1.3, led, sg * 0.6, 0.835, 0.05); // ceiling edge
    strip(0.012, 0.008, 2.0, led, sg * 0.87, -1.545, -0.35); // floor edge
        rbT(0.006, 0.5, 0.006, led, sg * 0.915, 0, 0.0, 0.002); // display panel side edge
  });
  strip(1.8, 0.008, 0.012, led, 0, 0.828, -0.62); // ceiling front
  rbT(1.84, 0.006, 0.006, led, 0, 0.268, 0.012, 0.002); // above the displays
  rbT(1.76, 0.006, 0.006, ledBlue, 0, -0.362, 0.005, 0.002); // under the button ledge: under-dash glow
  strip(1.6, 0.008, 0.012, led, 0, -1.37, -0.46); // footwell front edge

  // ---- cabin details: mounted tablet with a checklist, a cabin camera, a clipboard on an elastic strap
  const tabCanvas = canvas(512, 320), tc = tabCanvas.getContext('2d');
  tc.fillStyle = '#04101a'; tc.fillRect(0, 0, 512, 320);
  tc.fillStyle = '#7ee7f7'; tc.font = `600 24px ${MONO}`; tc.textBaseline = 'middle'; tc.fillText('CHECKLIST  /  ASCENT', 22, 30);
  tc.fillStyle = 'rgba(126,231,247,.3)'; tc.fillRect(22, 54, 468, 2);
  [['SUIT PRESSURE', 1], ['HARNESS LOCKED', 1], ['COMMS CHECK', 1], ['ABORT ARMED', 1], ['MAIN ENGINE START', 0], ['PITCH PROGRAM', 0]].forEach(([t, done], i) => {
    const y = 90 + i * 38;
    tc.strokeStyle = done ? '#34d399' : '#7ee7f7'; tc.lineWidth = 2.5; tc.strokeRect(24, y - 11, 22, 22);
    if (done) { tc.beginPath(); tc.moveTo(29, y); tc.lineTo(35, y + 6); tc.lineTo(43, y - 7); tc.stroke(); }
    tc.fillStyle = done ? '#9fe8c8' : '#eaf6fb'; tc.font = `500 22px ${MONO}`; tc.fillText(t, 62, y);
  });
  const tabTex = new THREE.CanvasTexture(tabCanvas);
  tabTex.colorSpace = THREE.SRGBColorSpace;
  const tablet = new THREE.Group();
  tablet.add(new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.17, 0.02, 2, 0.012), dark));
  const tabScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.15), new THREE.MeshBasicMaterial({ map: tabTex, color: new THREE.Color(1.1, 1.1, 1.1) }));
  tabScreen.position.z = 0.0105;
  tablet.add(tabScreen);
  tablet.position.set(X(-1, 0.8, -0.28, -0.3), -0.28, -0.3);
  tablet.lookAt(new THREE.Vector3(0, -0.2, 0.1));
  group.add(tablet);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8), metal);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(X(-1, 0.89, -0.28, -0.3), -0.28, -0.3);
  group.add(arm);
  rb(0.03, 0.06, 0.06, metal, X(-1, 0.93, -0.28, -0.3), -0.28, -0.3, 0.01);
  // cabin camera on the right wall near the ceiling
  cyl(0.032, 0.036, 0.02, dark, X(1, 0.93, 0.5, -0.5), 0.5, -0.5, 0, 0, Math.PI / 2, 14);
  put(new THREE.SphereGeometry(0.026, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), rubber, X(1, 0.915, 0.5, -0.5), 0.5, -0.5, 0, 0, Math.PI / 2);
  put(new THREE.SphereGeometry(0.008, 6, 4), lamp.red, X(1, 0.9, 0.5, -0.5), 0.5, -0.5);
  // clipboard and elastic strap on the right wall
  rb(0.012, 0.2, 0.14, padLight, X(1, 0.935, 0.06, -0.12), 0.06, -0.12, 0.006);
  rb(0.016, 0.03, 0.05, metal, X(1, 0.925, 0.17, -0.12), 0.17, -0.12, 0.004);
  rb(0.018, 0.012, 0.19, strapMat, X(1, 0.93, 0, -0.12), 0.0, -0.12, 0.003);
  rb(0.018, 0.012, 0.19, strapMat, X(1, 0.93, 0.1, -0.12), 0.1, -0.12, 0.003);
  // faint teal glow on the footwell under the dash (a soft additive sprite, no light)
  const glowCanvas = canvas(128, 64), gc = glowCanvas.getContext('2d');
  const gg = gc.createRadialGradient(64, 32, 2, 64, 32, 62);
  gg.addColorStop(0, 'rgba(45,212,191,.55)'); gg.addColorStop(1, 'rgba(45,212,191,0)');
  gc.fillStyle = gg; gc.fillRect(0, 0, 128, 64);
  const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.7), new THREE.MeshBasicMaterial({ map: tex(glowCanvas), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
  glowMesh.map = null;
  glowMesh.material.map.wrapS = glowMesh.material.map.wrapT = THREE.ClampToEdgeWrapping;
  glowMesh.material.map.repeat.set(1, 1);
  glowMesh.rotation.x = -Math.PI / 2;
  glowMesh.position.set(0, -1.13, -0.62);
  group.add(glowMesh);

  // flush merged meshes
  let tris = 0;
  for (const [mat, geos] of buckets) {
    const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g)); // some sources are indexed, some not
    for (const g of flat) { // same attribute set everywhere, so merging cannot fail
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    let merged = null;
    try { merged = mergeGeometries(flat, false); } catch { merged = null; }
    if (merged) {
      tris += merged.attributes.position.count / 3;
      group.add(new THREE.Mesh(merged, mat));
    } else { // never let a merge problem break the cockpit: add the pieces one by one
      for (const g of flat) { tris += g.attributes.position.count / 3; group.add(new THREE.Mesh(g, mat)); }
    }
  }
  group.userData.triangles = tris;

  // ---- moving controllers
  const sg = new THREE.Group(); // joystick, pivot at the mount
  sg.name = 'stick';
  sg.position.copy(stickBase).add(new THREE.Vector3(0, 0.04, 0));
  const addTo = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };
  addTo(sg, new THREE.CylinderGeometry(0.014, 0.018, 0.1, 10), metal, 0, 0.05, 0);
  addTo(sg, new RoundedBoxGeometry(0.056, 0.13, 0.06, 2, 0.022), rubber, 0, 0.16, 0.0, -0.12); // moulded grip
  addTo(sg, new THREE.SphereGeometry(0.03, 10, 8), rubber, 0, 0.225, 0.0).scale.set(1.1, 0.7, 1);
  addTo(sg, new RoundedBoxGeometry(0.012, 0.03, 0.02, 2, 0.005), metal, 0, 0.17, -0.04, -0.2); // trigger
  addTo(sg, new THREE.CylinderGeometry(0.011, 0.011, 0.01, 10), metal, 0.0, 0.248, -0.005); // thumb hat
  addTo(sg, new THREE.BoxGeometry(0.01, 0.006, 0.01), lamp.red, -0.02, 0.236, -0.02); // button
  // right glove: back of hand, four fingers curled around the grip, thumb on the hat
  const glove = suitShade;
  const rbm = (w, h, d, mat, r) => new RoundedBoxGeometry(w, h, d, 1, r);
  addTo(sg, rbm(0.07, 0.1, 0.04, glove, 0.016), glove, 0, 0.16, 0.04, -0.12); // palm and back of hand
  for (let i = 0; i < 4; i++) {
    const y = 0.115 + i * 0.026;
    addTo(sg, rbm(0.066, 0.022, 0.026, glove, 0.009), glove, 0, y, -0.034, -0.12); // finger across the front
    addTo(sg, rbm(0.014, 0.022, 0.05, glove, 0.006), glove, -0.032, y, -0.008, -0.12);
    addTo(sg, rbm(0.014, 0.022, 0.05, glove, 0.006), glove, 0.032, y, -0.008, -0.12);
  }
  addTo(sg, rbm(0.06, 0.012, 0.02, rubber, 0.004), rubber, 0, 0.215, 0.05, -0.12); // knuckle guard
  addTo(sg, new THREE.CapsuleGeometry(0.0125, 0.032, 3, 8), glove, -0.02, 0.232, -0.012, 0.9, 0, 0.5); // thumb
  group.add(sg);

  const tg = new THREE.Group(); // throttle lever, pivot at the quadrant
  tg.name = 'throttle';
  tg.position.copy(thrBase).add(new THREE.Vector3(0, 0.03, 0));
  addTo(tg, new THREE.CylinderGeometry(0.012, 0.016, 0.13, 10), metal, 0, 0.065, 0);
  addTo(tg, new RoundedBoxGeometry(0.05, 0.07, 0.1, 2, 0.02), rubber, 0, 0.16, 0.0, 0.1); // knob
  addTo(tg, rbm(0.075, 0.03, 0.09, glove, 0.012), glove, 0, 0.21, 0.01, 0.1); // back of the hand on top of the knob
  for (let i = 0; i < 4; i++) {
    addTo(tg, rbm(0.074, 0.02, 0.026, glove, 0.008), glove, 0, 0.13 + i * 0.024, -0.056, 0.1); // fingers curl around the front
    addTo(tg, rbm(0.012, 0.02, 0.06, glove, 0.005), glove, -0.036, 0.13 + i * 0.024, -0.02, 0.1);
    addTo(tg, rbm(0.012, 0.02, 0.06, glove, 0.005), glove, 0.036, 0.13 + i * 0.024, -0.02, 0.1);
  }
  addTo(tg, new THREE.CapsuleGeometry(0.012, 0.03, 3, 8), glove, 0.03, 0.19, 0.04, 0.4, 0, 0.9); // thumb
  group.add(tg);
  // throttle scale: ten emissive ticks beside the quadrant light up with the throttle
  const ticks = [];
  for (let i = 0; i < 10; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.005, 0.016), lamp.off);
    t.position.set(thrBase.x + 0.065, thrBase.y + 0.02, thrBase.z + 0.1 - i * 0.03 - 0.0);
    t.name = 'tick';
    group.add(t);
  }

  // ---- flight switches within reach of the hands (X engine cut-off, Space lock guidance, F take manual control).
  // Left pad beside the throttle: a guarded red CUT-OFF toggle and an amber SPACE LOCK push button. Right pad beside the stick: a cyan F MANUAL push button.
  // The parts named cutoffGuard, cutoffSwitch, retroButton and assistButton move in bind() (setControls); cutoffLamp, retroCap and assistCap light up.
  const padGeo = new RoundedBoxGeometry(0.24, 0.02, 0.17, 2, 0.008);
  const posGeo = new THREE.BoxGeometry(0.008, 0.06, 0.008);
  const guardGeo = new RoundedBoxGeometry(0.05, 0.005, 0.058, 1, 0.002);
  const leverGeo = new THREE.CylinderGeometry(0.004, 0.005, 0.022, 8);
  const knobGeo = new THREE.SphereGeometry(0.0085, 10, 8);
  const ringGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.006, 20);
  const baseGeo = new THREE.CylinderGeometry(0.017, 0.019, 0.01, 16);
  const pushGeo = new THREE.CylinderGeometry(0.0165, 0.0165, 0.012, 20);
  const dimLamp = new THREE.MeshBasicMaterial({ color: 0x2a0f0e });
  const makePad = (x, labelItemsPad, w, labelZ = 0.058) => {
    const pad = new THREE.Group();
    pad.position.set(x, -0.835, -0.335);
    pad.rotation.x = 0.18; // tilts the panel up towards the pilot; the block below fills the gap to the console
    pad.add(new THREE.Mesh(padGeo, dark));
    const under = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, 0.05, 0.15), dark);
    under.position.y = -0.03;
    pad.add(under);
    pad.children[0].scale.x = w / 0.24;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, 0.034), labelMaterial(Math.round(w * 2000), 68, labelItemsPad));
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.0115, labelZ);
    pad.add(label);
    return pad;
  };
  const pushButton = (pad, name, x, mat, z = -0.012) => { // ring + moving cap (the cap's own material is replaced per instance in bind())
    const ring = new THREE.Mesh(ringGeo, metal);
    ring.position.set(x, 0.008, z);
    const holder = new THREE.Group();
    holder.name = name;
    holder.position.set(x, 0.019, z);
    const cap = new THREE.Mesh(pushGeo, mat);
    cap.name = name.replace('Button', 'Cap');
    holder.add(cap);
    pad.add(ring, holder);
  };
  const leftPad = makePad(-0.55, [{ t: 'X  CUT-OFF', x: 87, y: 34, s: 26, c: '#f87171' }, { t: 'SPACE  LOCK', x: 371, y: 34, s: 26, c: '#fbbf24' }], 0.24);
  const hingeZ = -0.045;
  const tx = -0.07; // toggle x on the pad
  const toggleBase = new THREE.Mesh(baseGeo, metal);
  toggleBase.position.set(tx, 0.01, -0.012);
  const hinge = new THREE.Group(); // the guard flips up and forward about its front edge
  hinge.name = 'cutoffGuard';
  hinge.position.set(tx, 0.056, hingeZ);
  const guardPlate = new THREE.Mesh(guardGeo, red);
  guardPlate.position.set(0, 0, 0.029);
  hinge.add(guardPlate);
  [-1, 1].forEach((sg) => { const post = new THREE.Mesh(posGeo, metal); post.position.set(tx + sg * 0.029, 0.03, hingeZ); leftPad.add(post); });
  const lever = new THREE.Group(); // toggle lever, pivot on the base
  lever.name = 'cutoffSwitch';
  lever.position.set(tx, 0.017, -0.012);
  const stem = new THREE.Mesh(leverGeo, metal); stem.position.y = 0.011;
  const knob = new THREE.Mesh(knobGeo, red); knob.position.y = 0.025;
  lever.add(stem, knob);
  const cutLamp = new THREE.Mesh(lampBox, dimLamp);
  cutLamp.name = 'cutoffLamp';
  cutLamp.scale.set(1.6, 1.6, 1.6);
  cutLamp.position.set(tx, 0.0115, 0.03);
  leftPad.add(toggleBase, lever, hinge, cutLamp);
  pushButton(leftPad, 'retroButton', 0.06, dimLamp);
  group.add(leftPad);
  const rightPad = makePad(0.57, [{ t: 'F  MANUAL', x: 240, y: 34, s: 26, c: '#67e8f9' }], 0.24, 0.03); // the button sits at the front edge: the gloved hand covers the near part of this pad
  pushButton(rightPad, 'assistButton', 0, dimLamp, -0.05);
  group.add(rightPad);
  // a few slowly blinking lamps
  [[0.39, -0.862, -0.9], [0.39, -0.862, -0.6], [-0.39, -0.862, -0.75]].forEach(([x, y, z], i) => {
    const m = new THREE.Mesh(lampBox, [lamp.amber, lamp.green, lamp.red][i].clone());
    m.position.set(x, y + 0.002, z);
    group.add(m);
    blinkers.push(m);
  });

  // ---- control state, smoothed. The geometry and materials above are built once and shared; each cockpit instance
  // is a clone of the group, and bind() attaches fresh control state to that clone's own stick, lever and ticks.
  function bind(root) {
    const stick = root.getObjectByName('stick'), lever = root.getObjectByName('throttle');
    const tickMeshes = [];
    root.traverse((o) => { if (o.name === 'tick') tickMeshes.push(o); });
    const target = { pitch: 0, yaw: 0, throttle: 0 }, cur = { pitch: 0, yaw: 0, throttle: 0 };
    const clampTo = (x, lo, hi) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
    let lit = -1;

    // Flight switches. Materials are per instance (they change colour), geometry stays shared.
    const guard = root.getObjectByName('cutoffGuard'), toggle = root.getObjectByName('cutoffSwitch');
    const retro = root.getObjectByName('retroButton'), assist = root.getObjectByName('assistButton');
    const cutLampMesh = root.getObjectByName('cutoffLamp');
    const glowMat = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
    const own = {
      cut: [glowMat('#f87171', 0.16), glowMat('#f87171', 1.5)],
      retro: [glowMat('#fbbf24', 0.3), glowMat('#fbbf24', 1.3)], // big caps: a small factor, or they wash out to white
      assist: [glowMat('#22d3ee', 0.3), glowMat('#22d3ee', 1.3)],
    };
    if (cutLampMesh) cutLampMesh.material = own.cut[0];
    if (retro) retro.children[0].material = own.retro[0];
    if (assist) assist.children[0].material = own.assist[0];
    const sw = { cutoff: false, brake: false, assist: false }; // requested
    const pos = { guard: 0, toggle: 0, retro: 0, assist: 0 }; // 0..1 animation positions
    let lockHold = 0; // seconds the LOCK button stays pressed after a brake pulse, so even a one-frame pulse shows a full press
    const PUSH_DEPTH = 0.008, GUARD_OPEN = -1.9, TOGGLE_FLIP = 0.55;
    const shown = { cut: false, retro: false, assist: false };
    function applySwitches(dt) {
      // the guard lifts first and the toggle flips after; on release the toggle goes back before the guard closes
      const guardGoal = sw.cutoff || pos.toggle > 0.15 ? 1 : 0;
      const toggleGoal = sw.cutoff && pos.guard > 0.7 ? 1 : 0;
      const kG = 1 - Math.exp(-14 * dt), kT = 1 - Math.exp(-22 * dt), kP = 1 - Math.exp(-30 * dt);
      pos.guard += (guardGoal - pos.guard) * kG;
      pos.toggle += (toggleGoal - pos.toggle) * kT;
      lockHold = Math.max(0, lockHold - dt);
      const lockDown = sw.brake || lockHold > 0;
      pos.retro += ((lockDown ? 1 : 0) - pos.retro) * kP;
      pos.assist += ((sw.assist ? 1 : 0) - pos.assist) * kP;
      if (guard) guard.rotation.x = pos.guard * GUARD_OPEN;
      if (toggle) toggle.rotation.x = (pos.toggle * 2 - 1) * TOGGLE_FLIP; // forward = RUN, back towards the pilot = CUT-OFF
      if (retro) retro.position.y = 0.019 - pos.retro * PUSH_DEPTH;
      if (assist) assist.position.y = 0.019 - pos.assist * PUSH_DEPTH;
      const cutOn = pos.toggle > 0.5;
      if (cutOn !== shown.cut && cutLampMesh) { shown.cut = cutOn; cutLampMesh.material = own.cut[+cutOn]; }
      if (lockDown !== shown.retro && retro) { shown.retro = lockDown; retro.children[0].material = own.retro[+lockDown]; }
      if (sw.assist !== shown.assist && assist) { shown.assist = sw.assist; assist.children[0].material = own.assist[+sw.assist]; }
    }

    // Phase 0 buttons: lamp colour (emissive only) and a short press-in animation.
    const LAMP = { off: '#1b2630', amber: '#fbbf24', green: '#34d399', red: '#f87171', cyan: '#22d3ee' };
    const LAMP_POWER = { off: 1, amber: 1.2, green: 1.1, red: 1.3, cyan: 1.2 };
    const buttons = new Map();
    root.traverse((o) => {
      if (!o.name.startsWith('btn:')) return;
      const lampMesh = o.getObjectByName('btnLamp'), cap = o.getObjectByName('btnCap');
      if (!lampMesh || !cap) return;
      lampMesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const b = { id: o.name.slice(4), cap, lampMesh, state: null, pressT: -1, capZ: cap.position.z };
      buttons.set(b.id, b);
      setLamp(b, o.userData.initial ?? 'off');
    });
    function setLamp(b, state) {
      if (!LAMP[state]) return;
      b.state = state;
      b.lampMesh.material.color.set(LAMP[state]).multiplyScalar(LAMP_POWER[state]);
    }
    const find = (id) => buttons.get(String(id ?? '').toLowerCase().replace(/^btn:/, ''));

    function apply() {
      stick.rotation.set(cur.pitch * 0.26, cur.yaw * 0.2, -cur.yaw * 0.1); // pitch about X, yaw as a small twist and side tilt
      lever.rotation.set(0.55 - cur.throttle * 1.1, 0, 0); // idle back toward the pilot, full forward
      const n = Math.round(cur.throttle * 10);
      if (n !== lit) {
        lit = n;
        tickMeshes.forEach((t, i) => { t.material = i < n ? (i > 7 ? lamp.amber : lamp.green) : lamp.off; });
      }
    }
    apply();
    applySwitches(1);
    return {
      // Stable API: every cockpit redesign must keep these arguments. Omitted keys keep their last value.
      setControls({ pitch, yaw, throttle, cutoff, brake, assist: assistOn } = {}) {
        if (pitch !== undefined) target.pitch = clampTo(pitch, -1, 1);
        if (yaw !== undefined) target.yaw = clampTo(yaw, -1, 1);
        if (throttle !== undefined) target.throttle = clampTo(throttle, 0, 1);
        if (cutoff !== undefined) sw.cutoff = !!cutoff;
        if (brake !== undefined) { sw.brake = !!brake; if (brake) lockHold = 0.3; }
        if (assistOn !== undefined) sw.assist = !!assistOn;
      },
      /** state: 'off' | 'amber' | 'green' | 'red'. Ids work with or without the `btn:` prefix. Returns false for an unknown id or state. */
      setButton(id, state) {
        const b = find(id);
        if (!b || !LAMP[state]) return false;
        setLamp(b, state);
        return true;
      },
      /** A short press-in and out (about 0.15 s each way). */
      press(id) {
        const b = find(id);
        if (!b) return false;
        b.pressT = 0;
        return true;
      },
      update(dt) {
        const k = 1 - Math.exp(-12 * Math.min(dt, 0.1));
        cur.pitch += (target.pitch - cur.pitch) * k;
        cur.yaw += (target.yaw - cur.yaw) * k;
        cur.throttle += (target.throttle - cur.throttle) * k;
        apply();
        applySwitches(Math.min(dt, 0.1));
        for (const b of buttons.values()) {
          if (b.pressT < 0) continue;
          b.pressT += dt;
          const u = b.pressT / 0.15;
          const depth = u >= 2 ? 0 : u < 1 ? u : 2 - u;
          if (u >= 2) b.pressT = -1;
          b.cap.position.z = b.capZ - 0.011 * depth;
        }
      },
    };
  }
  const [shellC, shellB] = shellMaps();
  group.add(buildSides({
    shellMat: pbr(0xffffff, 0.88, 0.0, { map: shellC, bumpMap: shellB, bumpScale: 1.4, envMapIntensity: 0.1, side: THREE.DoubleSide, vertexColors: true }),
    padMat: pbr(0x757b83, 0.75, 0.05, { envMapIntensity: 0.15 }),
    sealMat: rubber, dark, metal, yellow, lamp,
  }));
  return { group, blinkers, bind };
}

// ---- Window: one wide panoramic pane in a soft, wrap-around surround ------------------------------------------------
// The surface bends towards the pilot at the sides (and a little at top and bottom), so the opening follows the capsule
// wall. Parts: a dark bulkhead plate with a rounded hole, a deep inner reveal, a fat padded trim ring, a thin rubber seal
// and the glass with a faint edge vignette. No flat square cut, no bars.
const WIN = { cx: 0, cy: 0.2, hw: 1.1, hh: 0.64, r: 0.24, z: -1.42 };
const wz = (x, y) => WIN.z + 0.17 * (x / 1.1) ** 2 + 0.05 * ((y - WIN.cy) / 0.75) ** 2;

function roundedRectPath(hw, hh, r, seg = 8, step = 0.09) {
  const pts = [];
  const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, Math.PI / 2], [-(hw - r), -(hh - r), Math.PI], [hw - r, -(hh - r), Math.PI * 1.5]];
  corners.forEach(([cx, cy, a0], k) => {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (j / seg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    const [nx, ny, na] = corners[(k + 1) % 4];
    const sx = pts[pts.length - 1][0], sy = pts[pts.length - 1][1];
    const ex = nx + r * Math.cos(na), ey = ny + r * Math.sin(na);
    const n = Math.max(1, Math.round(Math.hypot(ex - sx, ey - sy) / step));
    for (let j = 1; j < n; j++) pts.push([sx + ((ex - sx) * j) / n, sy + ((ey - sy) * j) / n]);
  });
  return pts;
}

// A closed strip of quads through `rows` (each row is an array of [x,y,z], same length).
function stripGeometry(rows) {
  const n = rows[0].length, pos = [], idx = [];
  rows.forEach((row) => row.forEach((p) => pos.push(p[0], p[1], p[2])));
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < n; i++) {
    const a = r * n + i, b = r * n + ((i + 1) % n), c = (r + 1) * n + i, d = (r + 1) * n + ((i + 1) % n);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildWindow({ plateMat, padMat, revealMat, sealMat }) {
  const group = new THREE.Group();
  group.name = 'window';
  const { cx, cy, hw, hh, r } = WIN;
  const hole = roundedRectPath(hw, hh, r);
  const at = (p, grow = 0) => { // a hole point pushed outwards by `grow`
    const dx = p[0], dy = p[1], l = Math.hypot(dx, dy) || 1;
    return [dx + (dx / l) * grow * 0, dy + (dy / l) * grow * 0, 0];
  };
  void at;
  const lift = (p, dz = 0, grow = 0) => { // point on the bent surface; grow offsets along the outline normal approx
    const x = cx + p[0], y = cy + p[1];
    return [x, y, wz(x, y) + dz];
  };
  // dark bulkhead plate: radial rows from the hole outwards to a box that tucks into the walls, overhead and shield
  const rows = [];
  const R = 7;
  for (let k = 0; k <= R; k++) {
    const t = k / R, e = t * t;
    rows.push(hole.map((p) => {
      const s = Math.min(1.35 / Math.max(Math.abs(p[0]), 1e-3), 0.95 / Math.max(Math.abs(p[1]), 1e-3), 1e3);
      const ox = p[0] * s, oy = p[1] * s; // where the ray from the centre meets the outer box
      const x = p[0] + (ox - p[0]) * e, y = p[1] + (oy - p[1]) * e;
      return lift([x, y]);
    }));
  }
  const plate = new THREE.Mesh(stripGeometry(rows), plateMat);
  plate.material = plateMat.clone();
  plate.material.side = THREE.DoubleSide;
  group.add(plate);
  // deep reveal: the hull thickness seen inside the opening
  const revealRows = [0, 0.04, 0.08].map((d) => hole.map((p) => lift(p, -d)));
  const reveal = new THREE.Mesh(stripGeometry(revealRows), revealMat.clone());
  reveal.material.side = THREE.DoubleSide;
  group.add(reveal);
  // fat padded trim ring along the hole edge, and a thin rubber seal just inside it
  const ringPts = hole.map((p) => new THREE.Vector3(...lift(p, 0.0)));
  const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts, true, 'centripetal'), hole.length * 2, 0.05, 10, true), padMat);
  group.add(ring);
  const sealPts = hole.map((p) => {
    const l = Math.hypot(p[0] / hw, p[1] / hh) || 1;
    return new THREE.Vector3(...lift([p[0] * (1 - 0.035 / l / hw), p[1] * (1 - 0.035 / l / hh)], -0.045));
  });
  const seal = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sealPts, true, 'centripetal'), hole.length * 2, 0.011, 6, true), sealMat);
  group.add(seal);
  // glass: a curved sheet just behind the ring with a faint tint, edge vignette and sheen
  const gc = canvas(256, 160), g = gc.getContext('2d');
  g.clearRect(0, 0, 256, 160);
  g.fillStyle = 'rgba(160,200,240,0.035)';
  g.fillRect(0, 0, 256, 160);
  for (const [x0, y0, x1, y1] of [[0, 0, 40, 0], [256, 0, 216, 0], [0, 0, 0, 30], [0, 160, 0, 130]]) {
    const lg = g.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, 'rgba(20,40,70,0.32)');
    lg.addColorStop(1, 'rgba(20,40,70,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 160);
  }
  const lg2 = g.createLinearGradient(0, 0, 256, 160);
  lg2.addColorStop(0.25, 'rgba(255,255,255,0)'); lg2.addColorStop(0.36, 'rgba(210,235,255,0.08)'); lg2.addColorStop(0.47, 'rgba(255,255,255,0)');
  g.fillStyle = lg2; g.fillRect(0, 0, 256, 160);
  const gt = new THREE.CanvasTexture(gc);
  gt.colorSpace = THREE.SRGBColorSpace;
  const GX = 40, GY = 24, pos = [], uv = [], idx = [];
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) {
    const x = cx - hw - 0.1 + ((2 * hw + 0.2) * i) / GX, y = cy - hh - 0.1 + ((2 * hh + 0.2) * j) / GY;
    pos.push(x, y, wz(x, y) - 0.06);
    uv.push(i / GX, j / GY);
  }
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const a = j * (GX + 1) + i;
    idx.push(a, a + 1, a + GX + 1, a + 1, a + GX + 2, a + GX + 1);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  gg.setIndex(idx);
  gg.computeVertexNormals();
  const glass = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  glass.renderOrder = 2;
  group.add(glass);
  return group;
}


// ---- Capsule side shell, small side windows and angled switch panels -------------------------------------------------
export function buildSides({ shellMat, padMat, revealMat, sealMat, dark, metal, yellow, lamp }) {
  const group = new THREE.Group();
  group.name = 'sides';
  const sideMeshes = (s) => {
    const NZ = 30, NY = 24, z0 = -1.15, z1 = 0.66, y0 = -1.0, y1 = 0.84, pos = [], uv = [], idx = [], col = [];
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NZ; i++) {
      const z = z0 + ((z1 - z0) * i) / NZ, y = y0 + ((y1 - y0) * j) / NY;
      pos.push(s * wallX(y, z), y, z);
      uv.push(i / NZ, j / NY);
      const t = Math.min(1, Math.max(0, (z + 0.9) / 0.7)); // dark towards the window (the HUD text sits over it), light behind the pilot
      const lv = 0.22 + 0.78 * t * t * (3 - 2 * t);
      col.push(lv, lv, lv);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NZ; i++) {
      const a = j * (NZ + 1) + i;
      idx.push(a, a + 1, a + NZ + 1, a + 1, a + NZ + 2, a + NZ + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, shellMat);
    return m;
  };
  const labelRows = [['MAIN A', 'MAIN B', 'RCS', 'O2', 'COMMS', 'PWR'], ['CABIN', 'FANS', 'LIGHTS', 'SUIT', 'ALARM', 'TEST']];
  const toggleGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.034, 6);
  const baseGeo = new RoundedBoxGeometry(0.03, 0.03, 0.014, 1, 0.005);
  const guardGeo = new RoundedBoxGeometry(0.034, 0.012, 0.026, 1, 0.004);
  const lampGeo = new THREE.BoxGeometry(0.012, 0.007, 0.004);
  for (const s of [-1, 1]) {
    group.add(sideMeshes(s));
    // small rounded side window, with the same soft padded surround as the main window
    const wy = 0.28, wz0 = -0.78, hole = roundedRectPath(0.17, 0.12, 0.075, 6, 0.05);
    const wx = (y, z) => s * wallX(y, z);
    const ringPts = hole.map((p) => new THREE.Vector3(wx(wy + p[1], wz0 + p[0]) - s * 0.004, wy + p[1], wz0 + p[0]));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts, true, 'centripetal'), hole.length * 2, 0.026, 8, true), padMat));
    const sealPts = hole.map((p) => new THREE.Vector3(wx(wy + p[1] * 0.93, wz0 + p[0] * 0.93) + s * 0.012, wy + p[1] * 0.93, wz0 + p[0] * 0.93));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sealPts, true, 'centripetal'), hole.length * 2, 0.006, 5, true), sealMat));
    const shape = new THREE.Shape(hole.map((p) => new THREE.Vector2(p[0] * 0.94, p[1] * 0.94)));
    const gg = new THREE.ShapeGeometry(shape);
    const gp = gg.attributes.position, uvs = [];
    for (let i = 0; i < gp.count; i++) uvs.push(gp.getX(i) / 0.34 + 0.5, gp.getY(i) / 0.24 + 0.5);
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    gg.rotateY(-s * Math.PI / 2);
    const glass = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ map: outsideTexture(), color: new THREE.Color(0.8, 0.8, 0.8), side: THREE.DoubleSide }));
    glass.position.set(wx(wy, wz0) + s * 0.03, wy, wz0);
    group.add(glass);
    // angled switch panel at armrest height, turned toward the pilot (Orion / Starliner style)
    const panel = new THREE.Group();
    panel.position.set(wx(-0.5, -0.72) - s * 0.03, -0.5, -0.72);
    panel.rotation.y = Math.atan2(-s * 0.9, 0.7);
    panel.add(new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.24, 0.04, 2, 0.015), dark));
    const items = [];
    labelRows.forEach((row, r) => row.forEach((t, i) => items.push({ t, x: 30 + i * 60, y: 14 + r * 62, s: 10 })));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), labelMaterial(360, 160, items));
    lab.position.z = 0.0205;
    panel.add(lab);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
      const px = -0.208 + i * 0.0833 + 0.0, py = 0.04 - r * 0.087;
      const base = new THREE.Mesh(baseGeo, dark); base.position.set(px, py - 0.012, 0.027); panel.add(base);
      const guard = new THREE.Mesh(guardGeo, (i + r) % 3 === 0 ? yellow : metal); guard.position.set(px, py + 0.012, 0.04); panel.add(guard);
      const tog = new THREE.Mesh(toggleGeo, metal); tog.position.set(px, py - 0.012, 0.038); tog.rotation.x = Math.PI / 2 - 0.4; panel.add(tog);
      const l = new THREE.Mesh(lampGeo, [lamp.green, lamp.cyan, lamp.amber, lamp.green, lamp.off, lamp.cyan][(i * 2 + r) % 6]); l.position.set(px, py + 0.043, 0.0225); panel.add(l);
    }
    group.add(panel);
  }
  return group;
}
