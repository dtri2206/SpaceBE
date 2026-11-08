// Cockpit interior below and around the pilot: seat, suited body, controllers, pedestal, side consoles, floor, lower walls,
// rear lockers and overhead fittings. Origin is the pilot's eye, forward -Z, +Y up (same frame as createCockpit()).
// Everything static is merged per material; only the two controllers move. Called once from createCockpit().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MONO = '"IBM Plex Mono", monospace';
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
 * @returns {{ group: THREE.Group, blinkers: THREE.Mesh[], bind: (root: THREE.Object3D) => { setControls: Function, update: Function } }}
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
  const [quiltC, quiltB] = fabricMaps('#454c55', '#6d7885');
  const quilt = pbr(0xffffff, 0.95, 0.0, { map: quiltC, bumpMap: quiltB, bumpScale: 1.4, envMapIntensity: 0.08 });
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

  // ---- seat: pan, side bolsters, back, headrest (headrest sits behind the eye, z > 0)
  rb(0.52, 0.12, 0.52, fabric, 0, -0.80, 0.2, 0.05, -0.08); // seat pan, front slightly raised
  [-1, 1].forEach((s) => rb(0.09, 0.13, 0.5, fabric, s * 0.3, -0.74, 0.2, 0.04, -0.08)); // pan bolsters
  rb(0.5, 0.82, 0.1, fabric, 0, -0.36, 0.3, 0.05, 0.16);
  [-1, 1].forEach((s) => rb(0.08, 0.7, 0.14, fabric, s * 0.28, -0.4, 0.27, 0.04, 0.16)); // back bolsters
  rb(0.3, 0.26, 0.1, fabric, 0, 0.06, 0.37, 0.05, 0.18); // headrest
  [-1, 1].forEach((s) => { // padded head wings that curve forward around the head
    rb(0.07, 0.26, 0.15, fabric, s * 0.19, 0.05, 0.3, 0.032, 0.18, s * 0.5);
    rb(0.05, 0.2, 0.06, fabric, s * 0.235, 0.05, 0.24, 0.02, 0.18, s * 0.9);
  });
  rb(0.34, 0.1, 0.06, fabric, 0, -0.66, 0.12, 0.03); // lumbar
  // seat frame: rails and base down to the floor
  rb(0.56, 0.5, 0.5, dark, 0, -1.18, 0.22, 0.03);
  rb(0.08, 0.2, 0.2, metal, 0, -0.45, 0.4, 0.015, 0.16);
  [-1, 1].forEach((s) => {
    rb(0.04, 0.9, 0.05, metal, s * 0.34, -0.5, 0.42, 0.01, 0.16);
    rb(0.1, 0.62, 0.34, dark, s * 0.43, -1.2, 0.26, 0.02); // armrest column
    rb(0.14, 0.07, 0.52, fabric, s * 0.42, -0.69, 0.27, 0.03); // armrest pad
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
  rb(2.4, 0.2, 0.5, shell, 0, 0.94, 0.55, 0.05); // overhead behind the pilot (closes the gap to the rear bulkhead)
  rb(2.4, 0.2, 0.3, shell, 0, 0.94, 0.8, 0.05);
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
  net.position.set(0.955, -0.45, 0.3);
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
  cyl(0.19, 0.19, 0.02, trim, -0.96, -0.38, 0.3, 0, 0, Math.PI / 2, 24);
  cyl(0.16, 0.16, 0.03, shell, -0.955, -0.38, 0.3, 0, 0, Math.PI / 2, 24);
  rb(0.03, 0.04, 0.2, metal, -0.93, -0.38, 0.3, 0.01);
  cyl(0.025, 0.025, 0.03, metal, -0.935, -0.38, 0.3, 0, 0, Math.PI / 2, 12);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; cyl(0.008, 0.008, 0.02, metal, -0.95, -0.38 + Math.sin(a) * 0.175, 0.3 + Math.cos(a) * 0.175, 0, 0, Math.PI / 2, 6); }
  // rear bulkhead lockers: 2 x 3 doors, handles and a fan grille
  const rearZ = 0.66;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = -0.85 + i * 0.35, y = -0.78 + j * 0.42 + 0.0;
      rb(0.32, 0.38, 0.03, panel, x, y, rearZ, 0.012);
      rb(0.1, 0.02, 0.025, metal, x, y + 0.12, rearZ - 0.02, 0.008);
      lampAt(lamp[['green', 'amber', 'cyan'][(i + j) % 3]], x + 0.12, y - 0.14, rearZ - 0.02);
    }
  }
  [0.25, 0.55, 0.85].forEach((x) => rb(0.26, 0.5, 0.03, panel, x, -0.55, rearZ, 0.012));
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
    m.position.set(side * 0.9375, y, z);
    group.add(m);
  };
  [-1, 1].forEach((s, side) => {
    for (const y of [0.58, 0.18]) for (const z of [-0.15, 0.17, 0.49]) rb(0.03, y > 0.5 ? 0.36 : 0.34, 0.3, quilt, s * 0.955, y, z, 0.012); // quilted panels
    rb(0.03, 0.26, 0.3, quilt, s * 0.955, -0.12, -0.15, 0.012);
    rb(0.025, 0.045, 1.0, dark, s * 0.958, 0.38, 0.17, 0.01); // seam rail between panel rows
    // handholds: U-shaped bars standing off the wall
    for (const z of [-0.12, 0.45]) {
      cyl(0.008, 0.008, 0.05, orange, s * 0.915, 0.38, z - 0.07, 0, 0, Math.PI / 2, 8);
      cyl(0.008, 0.008, 0.05, orange, s * 0.915, 0.38, z + 0.07, 0, 0, Math.PI / 2, 8);
      cyl(0.011, 0.011, 0.16, orange, s * 0.89, 0.38, z, Math.PI / 2, 0, 0, 10);
    }
    // velcro patches and a cloth bag on the panels
    for (const [z, y] of [[0.0, 0.62], [0.35, 0.58], [0.3, 0.12]]) {
      rb(0.01, 0.05, 0.11, dark, s * 0.94, y, z, 0.004);
      rb(0.011, 0.04, 0.09, rubber, s * 0.936, y, z, 0.003);
    }
    rb(0.08, 0.2, 0.22, bagMat, s * 0.89, side ? 0.18 : 0.56, 0.5, 0.03);
    rb(0.084, 0.02, 0.225, strapMat, s * 0.887, side ? 0.12 : 0.5, 0.5, 0.006);
    rb(0.084, 0.02, 0.225, strapMat, s * 0.887, side ? 0.24 : 0.62, 0.5, 0.006);
    // cable bundles along the ceiling edge and the panel base
    cableZ(s * 0.9, 0.79, -0.4, 0.62);
    cableZ(s * 0.9, -0.04, -0.3, 0.62);
    // status strips
    rb(0.006, 0.01, 0.16, lamp[side ? 'cyan' : 'green'], s * 0.936, 0.76, 0.05, 0.002);
    rb(0.006, 0.01, 0.08, lamp.amber, s * 0.936, 0.76, 0.28, 0.002);
    rb(0.006, 0.01, 0.12, lamp[side ? 'green' : 'cyan'], s * 0.936, -0.01, 0.42, 0.002);
  });
  placard(1, -0.1, 0.45, 0.2, 0.05, [{ t: 'HANDHOLD  25 kg', x: 70, y: 17, s: 11 }]);
  placard(-1, 0.1, 0.75, 0.26, 0.06, [{ t: 'EMERGENCY EXIT', x: 90, y: 21, s: 14, c: '#f1c40f' }]);
  placard(1, 0.35, 0.02, 0.2, 0.05, [{ t: 'CONTAINER B-3', x: 70, y: 17, s: 11 }]);
  placard(-1, 0.3, -0.17, 0.2, 0.05, [{ t: 'DO NOT BLOCK', x: 70, y: 17, s: 12, c: '#f87171' }]);
  // ceiling beams, cable runs and clips
  [-0.7, 0.7].forEach((x) => { rb(0.05, 0.03, 1.5, trim, x, 0.83, 0.1, 0.01); cableZ(x * 1.0 + Math.sign(x) * 0.07, 0.8, -0.3, 0.6); });
  [-0.2, 0.2, 0.55].forEach((z) => rb(1.5, 0.03, 0.04, trim, 0, 0.83, z, 0.01));
  // step edge markings (yellow and black, only where the floor changes height)
  rb(2.0, 0.008, 0.045, hazardEdge, 0, -1.147, -0.37, 0.002);
  [-1, 1].forEach((s) => rb(0.045, 0.01, 0.6, hazardEdge, s * 0.58, -1.548, 0.45, 0.002));
  // floor panel seams and tread plates under the seat
  [-0.3, 0.3].forEach((x) => rb(0.012, 0.006, 2.1, dark, x, -1.549, 0.15, 0.002));
  [0.0, 0.5, 1.0].forEach((z) => rb(2.2, 0.006, 0.012, dark, 0, -1.549, z - 0.1, 0.002));

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
    return {
      setControls({ pitch, yaw, throttle } = {}) {
        if (pitch !== undefined) target.pitch = clampTo(pitch, -1, 1);
        if (yaw !== undefined) target.yaw = clampTo(yaw, -1, 1);
        if (throttle !== undefined) target.throttle = clampTo(throttle, 0, 1);
      },
      update(dt) {
        const k = 1 - Math.exp(-12 * Math.min(dt, 0.1));
        cur.pitch += (target.pitch - cur.pitch) * k;
        cur.yaw += (target.yaw - cur.yaw) * k;
        cur.throttle += (target.throttle - cur.throttle) * k;
        apply();
      },
    };
  }
  return { group, blinkers, bind };
}
