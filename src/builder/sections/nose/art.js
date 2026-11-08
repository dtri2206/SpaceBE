// 3D art for the nose section's own parts. Owned by whoever builds the nose section.
// The shared code (bay/partArt.js, bay/internalsArt.js) asks here first and falls back to the procedural hardware in
// bay/partMeshes.js and the real NASA models (each part's `model` field) when these return null.
// Units: metres; a part stands on y = 0, centred on the stack axis (axial) or with its root at x = 0 pointing +x (radial).
//
// Everything that sits on a capsule meets it at one standard docking ring (NECK, 0.9 m across, about the size of a
// real docking tunnel), so towers, covers, nose caps and fairings all seat on the capsule's nose without gaps.
// Capsules are real blunt cones (Mercury 24°, Gemini/Dragon 19°, Apollo/Orion 24°): side equipment on a capsule is
// tilted onto the cone and pulled in to its surface (see seatFor), because the shared scene assumes a nearly
// cylindrical capsule.
import * as THREE from 'three';
import { canvasTexture, std, tube } from '../../bay/util.js';
import { chuteMesh, instrumentMesh, moduleMesh } from '../../bay/partMeshes.js';
import { nasaPartArt } from '../../bay/nasa.js';
import noseParts from './parts.json';

const NECK = 0.45; // radius of the docking ring on every capsule's nose, m
const DEG = Math.PI / 180;
const WHITE = 0xf2f1ed, DARK = 0x23272c, STEEL = 0xaab1b8, CHAR = 0x2b211b, TOWER_RED = 0xa8402c;
const textures = new Map();

// ---------- small helpers ----------
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
const lathe = (pts, mat, seg = 64) => mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg), mat);
const cyl = (rt, rb, h, mat, seg = 32, open = false) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
const box = (w, h, d, mat) => mesh(new THREE.BoxGeometry(w, h, d), mat);
const ball = (r, mat) => mesh(new THREE.SphereGeometry(r, 24, 16), mat);
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const group = (...objs) => { const g = new THREE.Group(); if (objs.length) g.add(...objs); return g; };
const metal = (color = STEEL, roughness = 0.35, metalness = 0.85) => std(color, { roughness, metalness });
function ring(r, y, thick, mat, seg = 64) {
  const t = mesh(new THREE.TorusGeometry(r, thick, 8, seg), mat);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}
/** A bell nozzle, exit at y = 0, throat at y = len (open, both sides drawn). */
function bell(rt, re, len, mat) {
  return lathe([[re, 0], [re * 0.96, len * 0.08], [rt * 1.35, len * 0.7], [rt, len]], mat, 24);
}
/** A nozzle hanging from (r, y) at azimuth az (deg), its exit canted outward by cant (deg) from straight down. */
function cantedNozzle(rt, re, len, mat, r, y, az, cant) {
  const n = bell(rt, re, len, mat);
  n.position.y = -len; // throat at the pivot
  const tilt = group(n);
  tilt.rotation.z = cant * DEG;
  tilt.position.set(r, y, 0);
  const g = group(tilt);
  g.rotation.y = az * DEG;
  return g;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function bumpTexture(key, draw, repeatX = 1, repeatY = 1) {
  const k = `${key}:${repeatX}:${repeatY}`;
  if (textures.has(k)) return textures.get(k);
  const { texture, redraw } = canvasTexture(512, 512);
  redraw(draw);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.repeat.set(repeatX, repeatY);
  textures.set(k, texture);
  return texture;
}
const shingleBump = (rx, ry) => bumpTexture('shingle', (ctx, w, h) => {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { const g = ctx.createLinearGradient(x, 0, x + 16, 0); g.addColorStop(0, '#5a5a5a'); g.addColorStop(0.5, '#a8a8a8'); g.addColorStop(1, '#5a5a5a'); ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h); }
  ctx.fillStyle = '#3c3c3c'; for (let y = 0; y < h; y += 128) ctx.fillRect(0, y, w, 4);
}, rx, ry);
const tileBump = (rx, ry) => bumpTexture('tile', (ctx, w, h) => {
  ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#5c5c5c'; ctx.lineWidth = 3;
  for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let row = 0; row < 8; row++) for (let x = (row % 2) * 32; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, row * 64); ctx.lineTo(x, row * 64 + 64); ctx.stroke(); }
}, rx, ry);
const panelBump = (rx, ry) => bumpTexture('panel', (ctx, w, h) => {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#626262'; ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke(); }
  for (let i = 0; i < 6; i++) { const x = (w / 6) * i + 20; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
}, rx, ry);
const hexBump = (rx, ry) => bumpTexture('hex', (ctx, w, h) => {
  ctx.fillStyle = '#8c8c8c'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3c3c3c'; ctx.lineWidth = 3;
  const r = 18;
  for (let row = 0; row < 20; row++) for (let col = 0; col < 18; col++) {
    const cx = col * r * 1.75 + (row % 2 ? r * 0.875 : 0), cy = row * r * 1.5;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k + Math.PI / 6; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath(); ctx.stroke();
  }
}, rx, ry);
const corkBump = (rx, ry) => bumpTexture('cork', (ctx, w, h) => {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = Math.random() < 0.5 ? '#6a6a6a' : '#999999'; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
}, rx, ry);

function colorTexture(key, draw, w = 512, h = 512) {
  if (textures.has(key)) return textures.get(key);
  const { texture, redraw } = canvasTexture(w, h);
  redraw(draw);
  textures.set(key, texture);
  return texture;
}
const solarTexture = () => colorTexture('solar', (ctx, w, h) => {
  ctx.fillStyle = '#0d1d36'; ctx.fillRect(0, 0, w, h);
  for (let y = 4; y < h; y += 32) for (let x = 4; x < w; x += 24) { ctx.fillStyle = (x + y) % 3 ? '#1b3561' : '#16305a'; ctx.fillRect(x, y, 20, 28); }
  ctx.fillStyle = '#c9d4e4'; for (let x = 0; x < w; x += 96) ctx.fillRect(x, 0, 3, h);
});
const radiatorTexture = () => colorTexture('radiator', (ctx, w, h) => {
  ctx.fillStyle = '#e9e8e3'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#b9bcc0'; ctx.lineWidth = 3;
  for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.fillStyle = '#9aa0a6'; for (let y = 0; y < h; y += 128) ctx.fillRect(0, y, w, 6);
});
const decalTexture = (text, sub) => colorTexture(`decal:${text}:${sub}`, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1d4ed8'; ctx.fillRect(20, 30, 64, 44);
  for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#dc2626'; ctx.fillRect(84, 30 + i * 6.3, 100, 6.3); }
  ctx.fillStyle = '#111'; ctx.font = '700 70px "IBM Plex Mono", monospace'; ctx.textBaseline = 'top';
  ctx.fillText(text, 20, 96);
  ctx.font = '500 30px "IBM Plex Mono", monospace'; ctx.fillStyle = '#333';
  ctx.fillText(sub, 22, 178);
}, 512, 256);
const decal = (text, sub, w = 0.7) => mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshStandardMaterial({ map: decalTexture(text, sub), transparent: true, roughness: 0.6, depthWrite: false }));

// ---------- capsule geometry (shared by the skin, the side equipment and the exploded view) ----------
/** Outer silhouette of a capsule, [r, y] from the bottom centre to the top centre. */
function capsuleProfile(type, R, h) {
  // a capsule with its own outline in the data (hullProfile.profile, the same one its Blender model follows)
  const own = NOSE_DEFS[type]?.hullProfile?.profile;
  if (own) return [[0, 0], ...own.map(([rf, yf]) => [rf * R, yf * h]), [0, h]];
  const kind = capsuleKind(type, R);
  if (kind === 'mercury') {
    const yc = Math.min(h * 0.7, 0.035 + (R - 0.5) / 0.44);
    return [[0, 0], [R * 0.97, 0], [R, 0.035], [0.5, yc], [0.47, yc + 0.03], [NECK, yc + 0.04], [NECK, h - 0.03], [NECK - 0.03, h], [0, h]];
  }
  if (kind === 'gemini') return [[0, 0], [R * 0.975, 0], [R, 0.05], [0.62, h - 0.12], [0.59, h - 0.085], [0.53, h - 0.08], [0.47, h - 0.08], [NECK, h - 0.07], [NECK, h], [0, h]];
  return [[0, 0], [R * 0.975, 0], [R, 0.06], [0.6, h - 0.2], [0.54, h - 0.12], [0.49, h - 0.095], [NECK, h - 0.09], [NECK, h], [0, h]];
}
function capsuleKind(type, R) {
  if (type === 'capsule_s') return 'mercury';
  if (type === 'capsule_m') return 'gemini';
  if (type === 'capsule_l') return 'apollo';
  return R < 1.1 ? 'mercury' : R < 1.5 ? 'gemini' : 'apollo';
}
/** Surface radius and slope dr/dy of a profile at height y (the outer wall only, caps skipped). */
function surfaceAt(pts, y) {
  const wall = pts.slice(1, -1);
  if (y <= wall[0][1]) return { r: wall[0][0], slope: 0 };
  for (let i = 0; i < wall.length - 1; i++) {
    const [r0, y0] = wall[i], [r1, y1] = wall[i + 1];
    if (y1 > y0 && y >= y0 && y <= y1) return { r: r0 + ((r1 - r0) * (y - y0)) / (y1 - y0), slope: (r1 - r0) / (y1 - y0) };
  }
  return { r: wall[wall.length - 1][0], slope: 0 };
}
/** Exported for the shared scene: the real surface radius of a nose part at a height fraction (null = not a capsule). */
export function surfaceRadius(def, yFrac, radius) {
  if (!def?.flags?.capsule) return null;
  return surfaceAt(capsuleProfile(def.id, radius, def.height), def.height * yFrac).r;
}
/** Puts `obj` (facing +x) on a profile's wall at height y, azimuth az (deg), tilted with the wall. */
function onWall(obj, pts, y, az, out = 0.004) {
  const { r, slope } = surfaceAt(pts, y);
  const t = group(obj);
  t.position.set(r + out, y, 0);
  t.rotation.z = Math.atan(-slope);
  const g = group(t);
  g.rotation.y = az * DEG;
  return g;
}

// windows: [height fraction, azimuth, width, height]
const WINDOWS = {
  mercury: [[0.5, 20, 0.22, 0.28]],
  gemini: [[0.58, 5, 0.26, 0.3], [0.58, 35, 0.26, 0.3]],
  apollo: [[0.62, 345, 0.2, 0.22], [0.62, 15, 0.2, 0.22], [0.42, 300, 0.24, 0.24], [0.42, 60, 0.24, 0.24]],
};
const HATCH = { mercury: [0.32, 95, 0.36, 0.5], gemini: [0.35, 200, 0.5, 0.62], apollo: [0.36, 0, 0.62, 0.62] };

function windowPane(w, h) {
  const glass = box(w, h, 0.02, std(0x0b1422, { roughness: 0.08, metalness: 0.7 }));
  const frame = box(w + 0.07, h + 0.07, 0.012, metal(0x50565c, 0.5, 0.7));
  frame.position.z = -0.006;
  const g = group(frame, glass);
  g.rotation.y = Math.PI / 2;
  return g;
}

function capsuleArt(def, R) {
  const h = def.height;
  const kind = capsuleKind(def.id, R);
  const pts = capsuleProfile(def.id, R, h);
  const g = new THREE.Group();
  let skin;
  if (kind === 'mercury') skin = new THREE.MeshStandardMaterial({ color: 0x2e3035, roughness: 0.45, metalness: 0.6, bumpMap: shingleBump(10, 2), bumpScale: 0.01 });
  else if (kind === 'gemini') skin = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.55, metalness: 0.08, bumpMap: tileBump(8, 3), bumpScale: 0.006 });
  else skin = new THREE.MeshStandardMaterial({ color: 0xd3d7dc, roughness: 0.26, metalness: 0.9, bumpMap: panelBump(6, 2), bumpScale: 0.004 });
  g.add(lathe(pts, skin, 72));
  const dark = metal(0x3a3f45, 0.5, 0.6);
  g.add(ring(R * 1.002, 0.03, 0.022, metal(0x8a9096, 0.4, 0.8)));
  g.add(ring(NECK + 0.01, h - 0.012, 0.018, dark)); // the docking ring
  if (kind === 'mercury') {
    const yc = pts[3][1];
    g.add(ring(0.47, yc + 0.02, 0.02, dark), ring(NECK + 0.004, h - 0.18, 0.012, dark));
    // the recovery compartment's antenna fairing and the periscope door
    g.add(onWall(box(0.04, 0.16, 0.12, dark), pts, yc + 0.2, 200, 0.02));
  } else {
    // a dark band low on the backshell and the umbilical
    g.add(lathe([[surfaceAt(pts, 0.14).r + 0.004, 0.14], [surfaceAt(pts, 0.2).r + 0.004, 0.2]], std(kind === 'gemini' ? 0x2a2e33 : 0x5b6168, { roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }), 72));
    g.add(onWall(box(0.08, 0.22, 0.18, dark), pts, h * 0.22, 250, 0.03));
  }
  for (const [fy, az, w, hh] of WINDOWS[kind]) g.add(onWall(windowPane(w, hh), pts, h * fy, az, 0.006));
  const [hy, haz, hw, hh] = HATCH[kind];
  const hatch = group(box(hw, hh, 0.014, std(kind === 'mercury' ? 0x3a3d42 : kind === 'gemini' ? 0xdedcd5 : 0xc3c8ce, { roughness: 0.45, metalness: kind === 'gemini' ? 0.1 : 0.8 })));
  hatch.add(at(box(0.12, 0.03, 0.04, metal(0x6b7280)), 0, -hh * 0.3, 0.02));
  hatch.children[0].rotation.y = 0; hatch.rotation.y = Math.PI / 2;
  g.add(onWall(hatch, pts, h * hy, haz, 0.008));
  // reaction-control thruster ports in pairs
  const port = () => { const p = group(box(0.07, 0.07, 0.03, std(0x111316, { roughness: 0.8 })), at(box(0.07, 0.07, 0.03, std(0x111316, { roughness: 0.8 })), 0.11, 0, 0)); p.rotation.y = Math.PI / 2; return p; };
  const portY = kind === 'mercury' ? pts[3][1] * 0.8 : h * 0.74;
  for (const az of [45, 135, 225, 315]) g.add(onWall(port(), pts, portY, az, 0.005));
  if (kind !== 'mercury') {
    const d = decal('SB&E', kind === 'gemini' ? 'CREW' : 'COMMAND', R * 0.42);
    d.rotation.y = Math.PI / 2;
    g.add(onWall(d, pts, h * 0.4, 135, 0.008));
  }
  return g;
}

// ---------- heat shields ----------
function heatShieldArt(def, R) {
  const h = def.height;
  const tiles = !!def.flags?.fragileShield;
  const d = h * 0.24; // how far the dish bulges below the rim
  const mat = new THREE.MeshStandardMaterial({ color: tiles ? 0x34373c : CHAR, roughness: tiles ? 0.7 : 0.93, metalness: 0.05, bumpMap: tiles ? tileBump(14, 4) : hexBump(8, 3), bumpScale: tiles ? 0.006 : 0.012 });
  const g = new THREE.Group();
  // no wider than the stack radius: the shield is as wide as the capsule's shoulder, so no lip shows at the joint and it
  // stays inside a see-through payload shroud
  g.add(lathe([[0, 0], [R * 0.45, d * 0.15], [R * 0.75, d * 0.42], [R * 0.92, d * 0.75], [R * 0.995, d], [R, d + h * 0.08], [R, h * 0.55], [R * 0.99, h * 0.9], [R * 0.975, h], [0, h]], mat, 72));
  g.add(ring(R * 0.97, h - 0.015, 0.012, metal(0x8f969c, 0.4, 0.8)));
  // compression pads round the edge, where the capsule sat on the stage below (Apollo)
  for (const az of [30, 150, 270]) {
    const pad = box(0.03, h * 0.3, 0.16, std(0x9a8f7e, { roughness: 0.8, metalness: 0.1 }));
    const p = group(at(pad, R * 0.995, h * 0.45, 0));
    p.rotation.y = az * DEG;
    g.add(p);
  }
  return g;
}

// ---------- fairings and nose covers ----------
const FAIRING_KIND = {
  nose_pointed_s: 'ogive', nose_pointed_m: 'ogive', nose_pointed_l: 'ogive', nose_blunt_m: 'blunt', nose_hammerhead_m: 'hammer',
  nose_vonkarman_m: 'haack', nose_biconic_m: 'biconic', fairing_composite_l: 'composite',
  // wave 4 (their Blender models replace this art once loaded; it shows while they download)
  vostok_shroud: 'blunt', fairing_newglenn: 'ogive', fairing_h2: 'ogive', fairing_h2b: 'ogive', fairing_cz5: 'haack', fairing_pslv: 'blunt',
};
const CYL_FRACTION = { ogive: 0.04, blunt: 0.12, hammer: 0.34, haack: 0.03, biconic: 0.05, composite: 0.3 };

/**
 * [r, y] outline of a fairing: a boat-tail from the docking ring up to R (or, as a shroud over a capsule, straight down
 * to the base), a cylinder, then the nose curve. topR > 0 cuts the nose flat at that radius for a part standing on it.
 */
function fairingProfile(kind, R, H, { shroud = false, topR = 0 } = {}) {
  const bt = shroud ? 0 : kind === 'hammer' || kind === 'composite' ? clamp((R - NECK) * 0.6, 0.3, 0.7) : clamp((R - NECK) * 0.45, 0.22, 0.45);
  const yc = bt + (H - bt) * Math.max(CYL_FRACTION[kind] ?? 0.2, shroud ? 0.1 : 0);
  const L = H - yc;
  const pts = shroud ? [[0, 0], [R, 0], [R, yc]] : [[0, 0], [NECK, 0], [NECK + 0.02, 0.03], [R - 0.02, bt - 0.03], [R, bt], [R, yc]];
  const N = 36;
  for (let i = 1; i <= N; i++) {
    const t = i / N, x = t * L; // distance up from the shoulder
    let r;
    if (kind === 'haack') {
      const s = L - x; // distance from the tip
      const th = Math.acos(clamp(1 - (2 * s) / L, -1, 1));
      r = (R / Math.sqrt(Math.PI)) * Math.sqrt(Math.max(0, th - Math.sin(2 * th) / 2));
    } else if (kind === 'blunt') {
      r = R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)));
    } else if (kind === 'biconic') {
      r = t < 0.62 ? R * (1 - (0.48 * t) / 0.62) : t < 0.93 ? R * (0.52 - (0.38 * (t - 0.62)) / 0.31) : R * 0.14 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.93) / 0.07, 2)));
    } else {
      const rho = (R * R + L * L) / (2 * R);
      r = Math.sqrt(Math.max(0, rho * rho - x * x)) + R - rho;
      if (kind === 'composite' && t > 0.96) r = Math.max(r, R * 0.05 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.96) / 0.04, 2))));
    }
    if (topR > 0) r = topR + ((R - topR) * Math.max(0, r)) / R; // same curve, ending in a flat top
    pts.push([Math.max(0, r), yc + x]);
  }
  if (topR > 0) { pts[pts.length - 1] = [topR, H]; pts.push([0, H]); } else pts[pts.length - 1] = [0, H];
  return { pts, bt, yc };
}

/** A thin strip that follows an outline at one azimuth (fairing separation rails). */
function railAlong(pts, az, mat, from = 0, to = Infinity) {
  const a = az * DEG;
  const path = pts.filter(([r, y]) => r > 0.05 && y >= from && y <= to).map(([r, y]) => new THREE.Vector3(Math.cos(a) * (r + 0.008), y, -Math.sin(a) * (r + 0.008)));
  if (path.length < 2) return group();
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), path.length * 2, 0.014, 6, false), mat);
}

const TOP_R = 0.48; // radius of the flat top a cover gets when a tower stands on it
const SIZE_RADIUS = { s: 0.9375, m: 1.25, l: 1.6875 };
const NOSE_DEFS = Object.fromEntries((noseParts.parts ?? []).map((p) => [p.id, p]));
/** The capsule right under this part, when it is narrow enough for a shroud of radius R to enclose: { h, r } or null. */
function capsuleBelow(entry, R) {
  if (entry?.shrouded) return { h: 0, r: R }; // hull.js found a capsule further down, under modules that fit inside
  const d = NOSE_DEFS[entry?.below];
  if (!d?.flags?.capsule) return null;
  const r = SIZE_RADIUS[d.size] ?? 1.25;
  return r <= R + 0.01 ? { h: d.height, r } : null;
}
// A cover over a capsule that fits inside it is the top of a payload fairing: the rest of that fairing, down round the
// capsule, its heat shield and any payload hardware, is the outer skin (hull.js, drawn by bay/hullArt.js), which turns
// see-through while the nose card is open. So the cover itself stops at its base ring here.

function fairingArt(def, R, entry) {
  const kind = FAIRING_KIND[def.id] ?? 'ogive';
  const H = def.height;
  const cap = capsuleBelow(entry, R);
  const topR = entry?.above ? TOP_R : 0;
  const { pts, bt, yc } = fairingProfile(kind, R, H, { shroud: !!cap, topR });
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: kind === 'composite' ? 0xf4f3ef : WHITE, roughness: 0.42, metalness: 0.08, bumpMap: panelBump(5, 3), bumpScale: 0.003 });
  g.add(lathe(pts, skin, 72));
  const dark = metal(DARK, 0.55, 0.6);
  if (cap) g.add(ring(R + 0.006, 0.02, 0.02, dark)); // the joint with the fairing skin below
  else g.add(ring(NECK + 0.01, 0.02, 0.02, metal(0x8f969c, 0.4, 0.8)), ring(R + 0.004, bt + 0.02, 0.022, dark));
  for (const az of [0, 180]) g.add(railAlong(pts, az, dark, bt, H - 0.08));
  // access doors and vents on the cylinder
  const doorY = Math.max(0.35, (bt + yc) / 2);
  for (const [az, w, hh] of [[60, 0.36, 0.46], [240, 0.26, 0.3]]) {
    const door = box(w, hh, 0.012, std(0xdedcd5, { roughness: 0.5 }));
    door.rotation.y = Math.PI / 2;
    g.add(onWall(door, pts, doorY, az, 0.004));
  }
  const d = decal('SB&E', kind === 'composite' ? 'FAIRING' : 'NOSE', Math.min(0.9, R * 0.6));
  d.rotation.y = Math.PI / 2;
  g.add(onWall(d, pts, Math.min(yc + 0.2, (yc + H) / 2), 120, 0.006));
  if (topR) g.add(ring(topR - 0.01, H - 0.01, 0.02, metal(0x8f969c, 0.4, 0.8))); // the attach ring for the part on top
  else if (kind === 'ogive' || kind === 'haack' || kind === 'composite' || kind === 'hammer') {
    const tipH = H * 0.06;
    g.add(at(mesh(new THREE.ConeGeometry(surfaceAt(pts, H - tipH).r + 0.003, tipH, 24), metal(STEEL, 0.3, 0.9)), 0, H - tipH / 2, 0));
  }
  if (kind === 'biconic') g.add(ring(surfaceAt(pts, yc + (H - yc) * 0.62).r + 0.003, yc + (H - yc) * 0.62, 0.012, dark));
  return g;
}


/** Truss between corner lists (bottom and top, [x, z]) with horizontal rings and X-bracing in each bay. */
function truss(bottom, top, y0, y1, bays, mat, r = 0.025) {
  const g = new THREE.Group();
  const lerp = (k) => bottom.map(([x, z], i) => [x + (top[i][0] - x) * k, y0 + (y1 - y0) * k, z + (top[i][1] - z) * k]);
  const n = bottom.length;
  for (let i = 0; i < n; i++) g.add(tube([bottom[i][0], y0, bottom[i][1]], [top[i][0], y1, top[i][1]], r * 1.25, mat));
  for (let b = 0; b <= bays; b++) {
    const lv = lerp(b / bays);
    for (let i = 0; i < n; i++) g.add(tube(lv[i], lv[(i + 1) % n], r * 0.8, mat));
    if (b === bays) break;
    const up = lerp((b + 1) / bays);
    for (let i = 0; i < n; i++) {
      g.add(tube(lv[i], up[(i + 1) % n], r * 0.7, mat));
      g.add(tube(lv[(i + 1) % n], up[i], r * 0.7, mat));
    }
  }
  return g;
}
const polarCorners = (n, r, start = 90) => Array.from({ length: n }, (_, i) => { const a = (start + (360 / n) * i) * DEG; return [Math.cos(a) * r, -Math.sin(a) * r]; });
const squareCorners = (hs) => [[hs, hs], [-hs, hs], [-hs, -hs], [hs, -hs]];

/** Pieces of the escape towers: where each motor sits (m from the tower's base). */
// canard: [height, radius] where folded canards hug the tower; acm: [height, radius] of an attitude control ring
const TOWERS = {
  les_tower_mercury: { motor: [1.25, 2.05, 0.13], jet: [2.05, 2.35, 0.095], nose: 2.35, canard: [2.2, 0.1], acm: [1.95, 0.13] },
  les_tower_apollo: { motor: [1.55, 3.15, 0.3], jet: [3.15, 3.55, 0.3], nose: 3.75, canard: [3.86, 0.2], acm: [3.05, 0.3] },
  las_soyuz: { motor: [3.65, 5.25, 0.24], jet: [4.95, 5.25, 0.24], nose: 5.25, canard: [5.0, 0.24], acm: [3.8, 0.24] },
  las_orion: { motor: [0.45, 2.9, 0.44], jet: [2.9, 3.6, 0.38], acmSpan: [3.6, 3.95], nose: 3.95, canard: [3.35, 0.4], acm: null, steerY: 3.78 },
  // CZ-2F and Gaganyaan escape systems: a shroud with grid fins and a tower on top, drawn like the Soyuz SAS
  las_shenzhou: { motor: [2.62, 3.85, 0.2], jet: [3.6, 3.85, 0.17], nose: 3.85, canard: [3.7, 0.2], acm: [2.8, 0.2], yc: 1.95, yt: 2.55 },
  las_gaganyaan: { motor: [2.65, 4.0, 0.28], jet: [3.7, 4.0, 0.2], nose: 4.0, canard: [3.85, 0.22], acm: [2.9, 0.28], yc: 1.85, yt: 2.65 },
};

function mercuryTower(def, opts) {
  const H = def.height;
  const T = TOWERS.les_tower_mercury;
  const red = std(TOWER_RED, { roughness: 0.55, metalness: 0.4 });
  const g = new THREE.Group();
  g.add(ring(NECK - 0.03, 0.03, 0.03, metal(0x3a3f45, 0.5, 0.6)));
  g.add(truss(polarCorners(3, 0.4), polarCorners(3, 0.12), 0.04, T.motor[0], 3, red, 0.022));
  const [m0, m1, mr] = T.motor;
  const caseMat = std(0xe2e0da, { roughness: 0.45, metalness: 0.3 });
  g.add(at(cyl(mr, mr, m1 - m0, caseMat), 0, (m0 + m1) / 2, 0), at(cyl(mr, mr * 0.55, 0.08, caseMat), 0, m0 - 0.04, 0));
  for (const az of [30, 150, 270]) g.add(cantedNozzle(0.03, 0.065, 0.16, std(0x2a2e33, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }), mr * 0.55, m0 - 0.03, az, 22));
  g.add(ring(mr, m0 + 0.25, 0.008, metal(DARK)), ring(mr, m1 - 0.02, 0.01, metal(DARK)));
  const [j0, j1, jr] = T.jet;
  g.add(at(cyl(jr, mr, j1 - j0, std(0xb9bdc2, { roughness: 0.4, metalness: 0.7 })), 0, (j0 + j1) / 2, 0));
  for (const az of [90, 210, 330]) g.add(cantedNozzle(0.012, 0.025, 0.05, metal(0x2a2e33), jr, j0 + 0.06, az, 60));
  g.add(at(mesh(new THREE.ConeGeometry(jr, H - 0.05 - j1, 24), metal(STEEL, 0.3, 0.9)), 0, j1 + (H - 0.05 - j1) / 2, 0));
  g.add(at(cyl(0.008, 0.012, 0.08, metal()), 0, H - 0.04, 0)); // the aerospike
  addSteering(g, opts, T);
  return g;
}

function apolloTower(def, opts) {
  const H = def.height;
  const T = TOWERS.les_tower_apollo;
  const red = std(TOWER_RED, { roughness: 0.55, metalness: 0.4 });
  const g = new THREE.Group();
  for (const [x, z] of squareCorners(0.32)) g.add(at(box(0.09, 0.06, 0.09, metal(0x3a3f45, 0.5, 0.6)), x, 0.03, z));
  g.add(truss(squareCorners(0.32), squareCorners(0.2), 0.05, T.motor[0] - 0.08, 3, red, 0.03));
  const [m0, m1, mr] = T.motor;
  const caseMat = std(0xe6e4de, { roughness: 0.45, metalness: 0.25 });
  g.add(at(cyl(mr * 0.85, 0.24, 0.1, metal(0x50565c, 0.5, 0.7)), 0, m0 - 0.05, 0)); // the skirt where the truss meets the motor
  g.add(at(cyl(mr, mr, m1 - m0, caseMat), 0, (m0 + m1) / 2, 0));
  for (const az of [45, 135, 225, 315]) g.add(cantedNozzle(0.05, 0.11, 0.24, std(0x24272b, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }), mr * 0.72, m0 + 0.02, az, 35));
  g.add(ring(mr, m0 + 0.35, 0.01, metal(DARK)), ring(mr, m1 - 0.3, 0.01, metal(DARK)));
  const [j0, j1, jr] = T.jet;
  g.add(at(cyl(jr, jr, j1 - j0, std(0xc8ccd1, { roughness: 0.4, metalness: 0.6 })), 0, (j0 + j1) / 2, 0));
  for (const az of [90, 270]) g.add(cantedNozzle(0.03, 0.06, 0.12, metal(0x24272b), jr, j0 + 0.1, az, 55));
  g.add(at(cyl(0.2, jr, 0.2, caseMat), 0, j1 + 0.1, 0)); // pitch control motor and ballast
  const nose = lathe([[0.2, T.nose], [0.19, T.nose + 0.12], [0.15, T.nose + 0.3], [0.09, T.nose + 0.45], [0.05, H - 0.1], [0, H - 0.08]], std(0xe6e4de, { roughness: 0.45, metalness: 0.25 }), 32);
  g.add(nose, at(cyl(0.2, 0.2, 0.2, caseMat), 0, T.nose - 0.1, 0));
  g.add(at(ball(0.06, metal(0xd9dde2, 0.3, 0.9)), 0, H - 0.07, 0), at(cyl(0.006, 0.006, 0.08, metal()), 0, H - 0.03, 0)); // the Q-ball
  addSteering(g, { ...opts, steering: opts?.steering === 'acm' ? 'acm' : 'canards' }, T);
  return g;
}

/** Canards folded flat on the nose, or the attitude control ring, as the player chose. */
function addSteering(g, opts, T) {
  const s = opts?.steering;
  if (s === 'canards' && T.canard) {
    const [y, r] = T.canard;
    const len = Math.min(0.42, r * 2.2);
    for (const az of [0, 180]) {
      const c = mesh(new THREE.CylinderGeometry(r + 0.015, r + 0.015, len, 16, 1, true, -0.5, 1.0), std(0xd9d7d1, { roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide }));
      c.position.y = y;
      c.rotation.y = (az + 90) * DEG;
      g.add(c);
    }
  } else if (s === 'acm' && T.acm) {
    const [y, r] = T.acm;
    g.add(at(cyl(r + 0.02, r + 0.02, 0.12, metal(0x4b5563, 0.5, 0.6)), 0, y, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = cyl(0.02, 0.02, 0.05, std(0x111316));
      p.rotation.z = Math.PI / 2;
      p.rotation.y = -a;
      g.add(at(p, Math.cos(a) * (r + 0.04), y, Math.sin(a) * (r + 0.04)));
    }
  }
}

function soyuzLas(def, R, opts, entry) {
  const H = def.height;
  const T = TOWERS[def.id] ?? TOWERS.las_soyuz; // Soyuz SAS; the CZ-2F and Gaganyaan systems share its layout
  const g = new THREE.Group();
  // the fairing: a shroud round the capsule below (or a boat-tail down to a bare nose), cylinder, then a cone up to the tower
  const cap = capsuleBelow(entry, R);
  const bt = cap ? 0 : 0.55, yc = T.yc ?? 2.4, yt = T.yt ?? 3.3;
  const pts = cap ? [[0, 0], [R, 0], [R, yc], [R * 0.97, yc + 0.06], [0.42, yt], [0, yt]] : [[0, 0], [NECK, 0], [NECK + 0.02, 0.03], [R - 0.02, bt - 0.03], [R, bt], [R, yc], [R * 0.97, yc + 0.06], [0.42, yt], [0, yt]];
  // (round a capsule, the fairing below this cone is the outer skin: hull.js)
  g.add(lathe(pts, new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.45, metalness: 0.1, bumpMap: panelBump(5, 2), bumpScale: 0.003 }), 72));
  const dark = metal(DARK, 0.55, 0.6);
  g.add(ring(R + 0.004, bt + 0.02, 0.02, dark));
  if (!cap) g.add(ring(NECK + 0.01, 0.02, 0.02, metal(0x8f969c, 0.4, 0.8)));
  for (const az of [90, 270]) g.add(railAlong(pts, az, dark, bt, yt - 0.05));
  // four grid fins, folded flat against the fairing
  const finMat = metal(0x9aa0a6, 0.45, 0.8);
  for (const az of [45, 135, 225, 315]) {
    const fin = new THREE.Group();
    const w = 0.56, hh = 0.86;
    for (const x of [-w / 2, w / 2]) fin.add(at(box(0.025, hh, 0.04, finMat), 0, 0, x));
    for (const y of [-hh / 2, hh / 2]) fin.add(at(box(0.025, 0.025, w, finMat), 0, y, 0));
    for (let i = 1; i < 4; i++) fin.add(at(box(0.012, hh, 0.02, finMat), 0, 0, -w / 2 + (w / 4) * i));
    for (let i = 1; i < 6; i++) fin.add(at(box(0.012, 0.012, w, finMat), 0, -hh / 2 + (hh / 6) * i, 0));
    fin.add(at(box(0.03, 0.06, 0.1, dark), -0.02, hh / 2 - 0.02, 0)); // the hinge
    const p = group(at(fin, R + 0.05, Math.min(1.25, yc * 0.5), 0));
    p.rotation.y = az * DEG;
    g.add(p);
  }
  // the fairing's own escape motors (they saved Soyuz MS-10)
  for (const az of [0, 180]) for (const off of [-9, 9]) {
    const a = (az + off) * DEG;
    g.add(at(cyl(0.06, 0.06, 0.5, std(0xd5d3cc, { roughness: 0.5 })), Math.cos(a) * (R + 0.06), yc - 0.3, -Math.sin(a) * (R + 0.06)));
  }
  // the tower: short truss, the motor with its ring of nozzles, separation nozzles and the spike
  g.add(truss(polarCorners(4, 0.36, 45), polarCorners(4, 0.22, 45), yt, T.motor[0], 1, std(0x8f969c, { roughness: 0.45, metalness: 0.8 }), 0.022));
  const [m0, m1, mr] = T.motor;
  const caseMat = std(0xe8e7e1, { roughness: 0.45, metalness: 0.25 });
  g.add(at(cyl(mr, mr, m1 - m0, caseMat), 0, (m0 + m1) / 2, 0));
  const nozMat = std(0x26292d, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  for (let i = 0; i < 12; i++) g.add(cantedNozzle(0.018, 0.04, 0.09, nozMat, mr, m0 + 0.75, i * 30, 40));
  g.add(ring(mr + 0.005, m0 + 0.72, 0.03, metal(0x50565c, 0.5, 0.7)));
  for (let i = 0; i < 4; i++) g.add(cantedNozzle(0.014, 0.03, 0.06, nozMat, mr, m1 - 0.12, i * 90 + 45, 70));
  g.add(at(mesh(new THREE.ConeGeometry(mr, H - 0.06 - m1, 24), caseMat), 0, m1 + (H - 0.06 - m1) / 2, 0));
  g.add(at(cyl(0.006, 0.01, 0.07, metal()), 0, H - 0.035, 0));
  addSteering(g, opts, T);
  return g;
}

function orionLas(def, opts) {
  const H = def.height;
  const T = TOWERS.las_orion;
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xedece7, roughness: 0.45, metalness: 0.1, bumpMap: panelBump(4, 4), bumpScale: 0.002 });
  const [m0, m1, mr] = T.motor;
  const [j0, j1, jr] = T.jet;
  const [a0, a1] = T.acmSpan;
  // from the bottom: the cap over the crew module's nose, the abort motor, the jettison motor, the attitude control ring, the nose cone
  g.add(lathe([[0, 0], [0.55, 0], [0.56, 0.04], [0.5, 0.3], [mr, m0], [mr, m1], [0, m1]], white, 64));
  g.add(ring(0.555, 0.03, 0.018, metal(0x8f969c, 0.4, 0.8)), ring(mr + 0.003, m0 + 0.05, 0.012, metal(DARK)), ring(mr + 0.003, m1 - 0.5, 0.012, metal(DARK)));
  // four reverse-flow exhaust nozzles near the top of the abort motor, blowing down and out
  const nozMat = std(0x24272b, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  for (const az of [45, 135, 225, 315]) {
    const n = bell(0.07, 0.15, 0.34, nozMat);
    n.position.y = -0.34;
    const tilt = group(n);
    tilt.rotation.z = 28 * DEG;
    tilt.position.set(mr - 0.02, m1 - 0.12, 0);
    g.add(group(tilt)).children.at(-1).rotation.y = az * DEG;
    g.add(group(at(box(0.16, 0.2, 0.18, white), mr + 0.02, m1 - 0.18, 0))).children.at(-1).rotation.y = az * DEG;
  }
  // the jettison motor, narrowing up from the abort motor, with four small canted nozzles at its base
  g.add(at(cyl(jr, mr, j1 - j0, white), 0, (j0 + j1) / 2, 0));
  for (const az of [0, 90, 180, 270]) g.add(cantedNozzle(0.03, 0.06, 0.12, nozMat, mr - 0.03, j0 + 0.14, az, 50));
  // the attitude control motor at the very top: a darker ring with eight valve ports
  g.add(at(cyl(jr, jr, a1 - a0, std(0x6b7280, { roughness: 0.5, metalness: 0.6 })), 0, (a0 + a1) / 2, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; const p = cyl(0.045, 0.045, 0.03, std(0x111316, { roughness: 0.8 })); p.rotation.z = Math.PI / 2; p.rotation.y = -a; g.add(at(p, Math.cos(a) * jr, (a0 + a1) / 2, Math.sin(a) * jr)); }
  const noseL = H - T.nose;
  const rho = (jr * jr + noseL * noseL) / (2 * jr);
  const nose = [];
  for (let i = 0; i <= 16; i++) { const x = (i / 16) * noseL; nose.push([Math.sqrt(Math.max(0, rho * rho - x * x)) + jr - rho, T.nose + x]); }
  nose.push([0, H]);
  g.add(lathe(nose, white, 40));
  addSteering(g, opts, T);
  return g;
}

function bpcArt(def) {
  const H = def.height;
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xeeede8, roughness: 0.7, metalness: 0.05, bumpMap: corkBump(4, 1), bumpScale: 0.004 });
  const pts = [[0, 0], [0.53, 0], [0.54, 0.03], [0.5, H * 0.75], [0.47, H - 0.02], [0.44, H], [0, H]];
  g.add(lathe(pts, mat, 64));
  g.add(ring(0.535, 0.02, 0.016, metal(0x8f969c, 0.4, 0.8)), railAlong(pts, 90, metal(DARK), 0.03, H - 0.02));
  for (const [x, z] of squareCorners(0.32)) g.add(at(box(0.1, 0.05, 0.1, metal(0x3a3f45, 0.5, 0.6)), x, H - 0.02, z));
  const win = box(0.14, 0.12, 0.012, std(0x0b1422, { roughness: 0.1, metalness: 0.7 }));
  win.rotation.y = Math.PI / 2;
  g.add(onWall(win, pts, H * 0.45, 0, 0.004));
  return g;
}

function noseCapArt(def, entry) {
  const H = def.height;
  const g = new THREE.Group();
  // a dome over the docking port; flat-topped with an attach ring when a tower stands on it
  const dome = entry?.above ? [[0, 0], [0.5, 0], [0.5, 0.07], [0.49, 0.2], [0.47, 0.34], [0.45, H - 0.03], [0.42, H], [0, H]] : [[0, 0], [0.5, 0], [0.5, 0.07], [0.48, 0.2], [0.42, 0.32], [0.32, 0.43], [0.18, 0.51], [0, H]];
  g.add(lathe(dome, std(0xf0efea, { roughness: 0.5, metalness: 0.08 }), 64));
  if (entry?.above) g.add(ring(0.43, H - 0.01, 0.018, metal(0x8f969c, 0.4, 0.8)));
  g.add(ring(0.5, 0.04, 0.02, metal(0x2a2e33, 0.5, 0.5)));
  g.add(at(box(0.1, 0.08, 0.3, metal(0x6b7280, 0.45, 0.7)), 0.52, 0.06, 0)); // the hinge
  g.add(at(box(0.06, 0.05, 0.12, metal(0x2a2e33)), -0.5, 0.06, 0)); // the latch
  return g;
}

function geminiNoseArt(def, entry) {
  const H = def.height;
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.45, metalness: 0.6, bumpMap: shingleBump(6, 1), bumpScale: 0.01 });
  g.add(lathe([[0, 0], [NECK, 0], [NECK, 0.62], [0.31, 0.82], [0, 0.82]], black, 48));
  g.add(ring(NECK + 0.004, 0.02, 0.018, metal(0x8f969c, 0.4, 0.8)), ring(NECK + 0.004, 0.62, 0.014, metal(0x50565c, 0.5, 0.7)));
  // re-entry control thrusters, two rings of four
  for (const y of [0.22, 0.46]) for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + (y > 0.3 ? Math.PI / 4 : 0);
    const n = cyl(0.025, 0.04, 0.06, std(0x15181b, { roughness: 0.7 }), 12);
    n.rotation.z = -Math.PI / 2;
    n.rotation.y = -a;
    g.add(at(n, Math.cos(a) * (NECK + 0.02), y, Math.sin(a) * (NECK + 0.02)));
  }
  // the rendezvous radar under its radome
  g.add(at(cyl(0.29, 0.29, 0.02, std(0xbfc4c8, { roughness: 0.4, metalness: 0.6 })), 0, 0.83, 0));
  if (entry?.above) { // a tower on top: a short adapter instead of the radome
    g.add(lathe([[0, 0.84], [0.29, 0.84], [0.42, H - 0.04], [0.42, H], [0, H]], std(0xd9d7d1, { roughness: 0.5, metalness: 0.3 }), 32), ring(0.42, H - 0.01, 0.016, metal(0x8f969c, 0.4, 0.8)));
  } else g.add(lathe([[0, 0.84], [0.22, 0.84], [0.22, 0.95], [0.17, 1.03], [0.08, H - 0.01], [0, H]], std(0xf1f0ec, { roughness: 0.6 }), 32));
  return g;
}

function trunkArt(def, R) {
  const H = def.height;
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [R * 0.97, 0], [R, 0.05], [R, H - 0.05], [R * 0.99, H], [0, H]], std(0xeceae4, { roughness: 0.5, metalness: 0.1 }), 72));
  const cells = new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.3, metalness: 0.5 });
  cells.map.wrapS = THREE.RepeatWrapping;
  const sol = mesh(new THREE.CylinderGeometry(R + 0.006, R + 0.006, H * 0.78, 64, 1, true, 0, Math.PI), cells);
  sol.position.y = H * 0.5;
  const rad = mesh(new THREE.CylinderGeometry(R + 0.005, R + 0.005, H * 0.7, 64, 1, true, Math.PI + 0.25, Math.PI - 0.5), new THREE.MeshStandardMaterial({ map: radiatorTexture(), roughness: 0.45, metalness: 0.2 }));
  rad.position.y = H * 0.5;
  g.add(sol, rad);
  const frame = metal(0x8f969c, 0.4, 0.8);
  g.add(ring(R + 0.006, 0.05, 0.02, frame), ring(R + 0.006, H - 0.05, 0.02, frame));
  // a short collar the heat shield nests in, so the capsule sits down into the trunk as on Crew Dragon
  const collar = cyl(R * 1.045, R * 1.03, 0.1, std(0xe2e0da, { roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }), 72, true);
  collar.position.y = H + 0.04;
  g.add(collar);
  // four small abort fins at the base
  const finShape = new THREE.Shape([[0, 0], [0.34, 0.06], [0.34, 0.32], [0, 0.72]].map(([x, y]) => new THREE.Vector2(x, y)));
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.04, bevelEnabled: false });
  for (const az of [45, 135, 225, 315]) {
    const f = mesh(finGeo, std(0xe6e4de, { roughness: 0.5, metalness: 0.15 }));
    f.position.set(R - 0.01, 0.06, -0.02);
    g.add(group(f)).children.at(-1).rotation.y = az * DEG;
  }
  const d = decal('SB&E', 'TRUNK', 0.8);
  d.rotation.y = Math.PI / 2;
  g.add(onWall(d, [[0, 0], [R, 0], [R, H], [0, H]], H * 0.5, 200, 0.012));
  return g;
}

// ---------- side equipment ----------
/** Three main parachute packs side by side on one mounting plate. */
function chuteClusterArt(def) {
  const h = def.height;
  const g = new THREE.Group();
  const plate = box(0.1, h * 0.9, 0.78, metal(0x6b7280, 0.5, 0.6));
  plate.position.set(-0.22, h * 0.45, 0);
  g.add(plate);
  const colors = [0xe08a3a, 0xf1f0ec, 0xe08a3a];
  [[-0.02, -0.24], [0.1, 0], [-0.02, 0.24]].forEach(([x, z], i) => {
    g.add(at(cyl(0.15, 0.16, h * 0.78, std(colors[i], { roughness: 0.65, metalness: 0.1 }), 24), x, h * 0.39, z));
    g.add(at(cyl(0.155, 0.155, h * 0.07, metal(0xd9dde2, 0.4, 0.6), 24), x, h * 0.82, z));
    g.add(at(mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 16), metal()), x, h * 0.9, z));
  });
  g.add(at(box(0.04, 0.04, 0.6, metal(0xf59e0b, 0.5, 0.4)), 0.02, h * 0.55, 0)); // the riser bundle
  g.userData.width = 0.6;
  return g;
}

/** A SuperDraco-style pod: a faired housing in the wall with two engine bells canted out at the bottom. */
function abortPodArt(def) {
  const h = def.height;
  const g = new THREE.Group();
  const housing = lathe([[0, 0.16], [0.16, 0.16], [0.18, 0.3], [0.18, h - 0.2], [0.12, h - 0.06], [0, h]], std(0xeae8e2, { roughness: 0.5, metalness: 0.12 }), 32);
  housing.scale.set(0.75, 1, 1.25);
  g.add(housing);
  const nozMat = std(0x2a2b2e, { roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide });
  for (const z of [-0.1, 0.1]) {
    const n = bell(0.04, 0.085, 0.2, nozMat);
    n.position.y = -0.2;
    const t = group(n);
    t.position.set(0.03, 0.2, z);
    t.rotation.z = 18 * DEG;
    t.rotation.x = (z > 0 ? -1 : 1) * 8 * DEG;
    g.add(t);
  }
  g.add(at(box(0.02, h * 0.5, 0.3, std(0x1a1c1f, { roughness: 0.7 })), 0.135, h * 0.52, 0)); // the intake door
  g.userData.width = 0.36;
  return g;
}

/** A rack of square lithium hydroxide canisters with red caps. */
function liohArt(def) {
  const h = def.height;
  const g = new THREE.Group();
  const frame = metal(0x8f969c, 0.4, 0.8);
  g.add(at(box(0.06, h, 0.5, frame), -0.18, h / 2, 0));
  for (const y of [0.04, h - 0.04]) g.add(at(box(0.34, 0.03, 0.5, frame), -0.02, y, 0));
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const x = -0.06 + row * 0.15, z = -0.16 + col * 0.16;
    g.add(at(box(0.13, h * 0.78, 0.13, std(0xd6d3c8, { roughness: 0.6, metalness: 0.2 })), x, h * 0.46, z));
    g.add(at(box(0.135, 0.05, 0.135, std(0xb91c1c, { roughness: 0.5 })), x, h * 0.86, z));
  }
  g.userData.width = 0.42;
  return g;
}

/** A steerable high-gain dish on a boom: parabolic reflector, three feed struts and a feed horn, aimed out and up. */
function dishArt(def) {
  const h = def.height, D = h * 0.92, f = D * 0.42; // diameter and focal length
  const g = new THREE.Group();
  const frame = metal(0x8f969c, 0.4, 0.8);
  g.add(at(box(0.08, 0.3, 0.22, metal(0x4b5563, 0.5, 0.6)), -0.06, 0.15, 0)); // the mounting bracket
  g.add(tube([-0.04, 0.2, 0], [0.16, h * 0.45, 0], 0.03, frame));
  g.add(at(cyl(0.06, 0.06, 0.12, metal(0x374151, 0.5, 0.6), 16), 0.16, h * 0.45, 0)); // the two-axis gimbal
  const dish = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 12; i++) { const r = (D / 2) * (i / 12); prof.push([r, (r * r) / (4 * f)]); }
  const depth = prof[prof.length - 1][1];
  dish.add(lathe(prof, std(0xeceae3, { roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }), 48));
  dish.add(ring(D / 2, depth, 0.015, frame, 48));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    dish.add(tube([Math.cos(a) * D * 0.48, depth, Math.sin(a) * D * 0.48], [0, f * 0.9, 0], 0.008, frame));
  }
  dish.add(at(cyl(0.03, 0.05, 0.1, std(0xc9a24a, { roughness: 0.3, metalness: 0.9 }), 16), 0, f * 0.9, 0)); // the feed horn
  dish.add(at(cyl(0.05, 0.08, 0.08, metal(0x374151, 0.5, 0.6), 16), 0, -0.03, 0));
  dish.rotation.z = -62 * DEG; // aimed out and up
  dish.position.set(0.22, h * 0.5, 0);
  g.add(dish);
  g.userData.width = 0.5;
  return g;
}

/** A low-gain omni: a flat base box on the wall and a whip with a ball tip pointing out and up. */
function lowGainArt(def) {
  const h = def.height;
  const g = new THREE.Group();
  const base = metal(0x4b5563, 0.5, 0.6);
  g.add(at(box(0.04, 0.16, 0.2, base), -0.11, 0.08, 0)); // flush mounting plate
  g.add(at(box(0.1, 0.1, 0.14, std(0xe6e4de, { roughness: 0.5, metalness: 0.2 })), -0.05, 0.08, 0)); // the matching unit
  g.add(at(cyl(0.025, 0.035, 0.06, std(0x1f2937, { roughness: 0.6 }), 12), 0, 0.12, 0)); // the insulator
  const tip = [0.26, h * 0.92, 0];
  g.add(tube([0, 0.14, 0], tip, 0.008, metal(0xd9dde2, 0.3, 0.9)));
  g.add(at(ball(0.022, metal(0xd9dde2, 0.3, 0.9)), ...tip));
  g.userData.width = 0.26;
  return g;
}

/** A medium-gain horn: a bracket on the wall, a short boom and a gold pyramidal horn aimed out and up. */
function mediumHornArt(def) {
  const h = def.height;
  const g = new THREE.Group();
  const frame = metal(0x8f969c, 0.4, 0.8);
  g.add(at(box(0.04, 0.24, 0.2, metal(0x4b5563, 0.5, 0.6)), -0.12, 0.12, 0));
  g.add(tube([-0.1, 0.12, 0], [0.02, h * 0.42, 0], 0.025, frame));
  const horn = mesh(new THREE.CylinderGeometry(0.17, 0.035, h * 0.45, 4, 1, true), std(0xc9a24a, { roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide }));
  horn.rotation.y = Math.PI / 4; // square mouth
  const feed = at(cyl(0.035, 0.035, 0.08, metal(0x374151, 0.5, 0.6), 12), 0, -h * 0.225 - 0.04, 0);
  const aim = group(horn, feed);
  aim.rotation.z = -55 * DEG; // mouth out and up
  aim.position.set(0.12, h * 0.55, 0);
  g.add(aim);
  g.userData.width = 0.36;
  return g;
}

// side equipment drawn from the shared meshes or the real NASA models (seated on capsules here)
const SHARED_RADIAL = {
  parachute: (def) => chuteMesh(def, 0xe08a3a),
  drogue_chute: (def) => chuteMesh(def, 0xd9d7d1),
  splash_floats: (def) => moduleMesh(def, 0xb45309),
  star_tracker: (def) => instrumentMesh(def, 'tracker'),
};
const OWN_RADIAL = { chute_cluster_3: chuteClusterArt, abort_pusher_pod: abortPodArt, lioh_canisters: liohArt, antenna_high: dishArt, antenna_low: lowGainArt, antenna_medium: mediumHornArt };

// capsules seen in the current scene build, so side equipment knows when it hangs on one (layout order puts a host
// before its side parts; the y check throws away entries left over from an older layout)
const capsuleHosts = new Map();
function seatFor(entry) {
  if (!entry.parentId) return null;
  const host = capsuleHosts.get(entry.parentId);
  if (!host || Math.abs(host.radius - entry.radius) > 1e-6) return null;
  const f = entry.yFrac ?? 0.5;
  if (Math.abs(host.y + host.height * f - entry.y) > 1e-4) return null;
  const pts = capsuleProfile(host.type, host.radius, host.height);
  const { r, slope } = surfaceAt(pts, host.height * f);
  const taper = 1 - 0.3 * Math.max(0, f - 0.4); // the capsule taper designScene and hangarScene assume
  return { dx: r - host.radius * taper, tilt: Math.atan(-slope) };
}
function seated(content, seat, width) {
  const root = new THREE.Group();
  const holder = group(content);
  holder.position.x = seat.dx;
  holder.rotation.z = seat.tilt;
  root.add(holder);
  Object.assign(root.userData, content.userData, { width });
  return root;
}
// the last seat of each side part type on a capsule of each radius: the exploded view lines its pieces up with the part
const seatCache = new Map();
function radialArt(entry) {
  const def = entry.def;
  const seat = entry.inside ? null : seatFor(entry); // equipment riding inside the skin is placed by hull.js, not seated on the wall
  if (entry.parentId) { if (seat) seatCache.set(`${def.id}:${entry.radius}`, seat); else seatCache.delete(`${def.id}:${entry.radius}`); }
  let content = null;
  if (OWN_RADIAL[def.id]) content = OWN_RADIAL[def.id](def);
  else if (!seat) return null; // not on a capsule: the shared art is already right
  else if (SHARED_RADIAL[def.id]) content = SHARED_RADIAL[def.id](def);
  else if (def.model?.model) {
    content = nasaPartArt(def.id);
    if (!content) return null; // still downloading: the shared stand-in shows until it arrives
    content.userData.width = Math.min(1.2, def.height ?? 0.8);
  } else {
    content = moduleMesh(def, 0x3b4148);
  }
  const width = content.userData.width ?? 0.6;
  return seat ? seated(content, seat, width) : content;
}

/** Art for one placed part: entry = { type, def, attach, height, radius }. Return an Object3D, or null for the default. */
export function partArt(entry) {
  const def = entry?.def;
  if (!def) return null;
  const R = entry.radius ?? 1.25;
  if (entry.attach === 'radial' || def.attach === 'radial') return radialArt(entry);
  const opts = entry.options ?? null;
  if (def.flags?.capsule) {
    if (entry.id) capsuleHosts.set(entry.id, { y: entry.y ?? 0, height: entry.height ?? def.height, radius: R, type: def.id });
    return capsuleArt(def, R);
  }
  switch (def.id) {
    case 'les_tower_mercury': return mercuryTower(def, opts);
    case 'les_tower_apollo': return apolloTower(def, opts);
    case 'las_soyuz': return soyuzLas(def, R, opts, entry);
    case 'las_orion': return orionLas(def, opts);
    case 'las_shenzhou': case 'las_gaganyaan': return soyuzLas(def, R, opts, entry);
    case 'bpc_apollo': return bpcArt(def);
    case 'nosecap_dragon': return noseCapArt(def, entry);
    case 'nose_gemini_rr': return geminiNoseArt(def, entry);
    case 'crew_trunk_m': return trunkArt(def, R);
    default: break;
  }
  if (FAIRING_KIND[def.id]) return fairingArt(def, R, entry);
  if (def.flags?.heatShield && !/hiad/.test(def.id)) return heatShieldArt(def, R);
  if (MODULE_LOOK[def.id] || def.internals === 'service_module' || def.internals === 'module') return moduleDrumArt(def, R);
  return null;
}

/**
 * Dresses a loaded Blender model of a nose part (bay/partArt.js calls this after the slot choices are applied; null
 * keeps the model as it is now):
 * - a capsule registers itself, so side equipment seats on its real cone (seatFor), and a side part's model is seated;
 * - covers carry two bases (src/builder/tools/blender/nose/fairings.py): form_shroud, a cylinder down round a capsule
 *   that fits inside, and form_neck, a boat-tail onto the docking ring; the one hull.js chose shows (entry.shrouded);
 * - a cover or nose cap with a part standing on it uses the drawn art, which ends in a flat top with an attach ring.
 */
export function wrapModel(model, entry) {
  const def = entry?.def;
  if (!def || def.section !== 'nose') return null;
  const R = entry.radius ?? 1.25;
  if (def.flags?.capsule && entry.id) capsuleHosts.set(entry.id, { y: entry.y ?? 0, height: entry.height ?? def.height, radius: R, type: def.id });
  if (entry.attach === 'radial') {
    // a side part's model has its origin on the host's wall, +x out (tools/blender/README.md), while the shared mount
    // (bay/hullArt.js mountRadial) moves drawn art out by 0.45 x its width: a width of 0 keeps the model on the wall.
    // On a capsule it is then pulled in and tilted onto the real cone, like the drawn side parts (a SuperDraco pod).
    model.userData.width = 0;
    const seat = entry.inside ? null : seatFor(entry);
    if (entry.parentId) { if (seat) seatCache.set(`${def.id}:${entry.radius}`, seat); else seatCache.delete(`${def.id}:${entry.radius}`); }
    return seat ? seated(model, seat, 0) : null;
  }
  if (entry.above && entry.attach === 'axial') {
    if (FAIRING_KIND[def.id]) return fairingArt(def, R, entry);
    if (def.id === 'nosecap_dragon') return noseCapArt(def, entry);
    if (def.id === 'nose_gemini_rr') return geminiNoseArt(def, entry);
  }
  const shroud = model.getObjectByName('form_shroud'), neck = model.getObjectByName('form_neck');
  if (shroud && neck) {
    // Orion's abort-system cover hangs below its base round the crew module (only that capsule fits it); every other
    // cover runs on down round a capsule when hull.js made it a shroud
    const encloses = def.model?.encloses ?? ENCLOSES[def.id];
    const wraps = encloses ? entry.below === encloses : !!entry.shrouded;
    shroud.visible = wraps;
    neck.visible = !wraps;
  }
  return null;
}
const ENCLOSES = { las_orion: 'capsule_orion' }; // until the part data says it (model.encloses)

// ---------- service, orbital and cargo modules (their Blender models replace this while they download) ----------
const MODULE_LOOK = {
  soyuz_orbital_module: 0x646b55, soyuz_service_module: 0x646b55, soyuz_7k_service_module: 0x646b55, progress_cargo_module: 0x646b55,
  apollo_sm: 0xc4c8cc, cygnus_sm: 0xc49a45, htv_logistics: 0xc49a45, htv_propulsion: 0xc49a45, vostok_instrument_module: 0xbfc3c6,
  voskhod_backup_retro: 0x34383d, retropack_mercury: 0xa3a8ad, cruise_stage_mars: 0xb7b8b2,
};
/** A plain drum (or the module's own outline) at the width the outer skin sees, with frames top and bottom. */
function moduleDrumArt(def, R) {
  const H = def.height;
  const p = def.hullProfile ?? {};
  const color = MODULE_LOOK[def.id] ?? 0xe9e8e3;
  const skin = std(color, { roughness: 0.55, metalness: color === 0xc4c8cc ? 0.6 : 0.15 });
  const g = new THREE.Group();
  const r = p.kind === 'inner' ? R * (p.rMax ?? 1) : R;
  const pts = p.kind === 'own' && p.profile ? [[0, 0], ...p.profile.map(([rf, yf]) => [rf * R, yf * H]), [0, H]] : [[0, 0], [r, 0], [r, H], [0, H]];
  g.add(lathe(pts, skin, 64));
  const dark = metal(DARK, 0.55, 0.6);
  g.add(ring(pts[1][0] + 0.004, 0.02, 0.015, dark), ring(pts[pts.length - 2][0] + 0.004, H - 0.02, 0.015, dark));
  return g;
}

// ---------- the exploded view ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function capsuleInternals(def, options, R, h) {
  const opt = (k) => options?.[k]?.id;
  const kind = capsuleKind(def.id, R);
  const pts = capsuleProfile(def.id, R, h);
  const inner = (y) => surfaceAt(pts, y).r - 0.12;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const n = opt('computer') === 'quad' ? 5 : opt('computer') === 'triple' ? 3 : 1;
  const comp = new THREE.Group();
  const yc = h * 0.32, rc = inner(yc) * 0.8;
  for (let i = 0; i < n; i++) comp.add(at(box(0.24, 0.14, 0.18, std(i === 4 ? 0xb45309 : 0x1f2937, { roughness: 0.5, metalness: 0.5 })), -rc, yc + Math.floor(i / 3) * 0.17, -0.3 + (i % 3) * 0.3));
  add('computer', 'Flight computer', comp, V(-1, 0.2, -0.3));
  const ecls = group(at(box(0.36, 0.28, 0.26, std(0x0e7490, { roughness: 0.5, metalness: 0.5 })), inner(h * 0.2) * 0.75, h * 0.2, 0.2), at(cyl(0.04, 0.04, 0.3, metal()), inner(h * 0.2) * 0.75, h * 0.38, 0.05));
  if (opt('lifeSupport') === 'regenerative') ecls.add(at(cyl(0.11, 0.11, 0.3, metal(0xd9dde2)), inner(h * 0.25) * 0.6, h * 0.42, 0.38), at(box(0.26, 0.18, 0.18, std(0x166534, { roughness: 0.5 })), inner(h * 0.25) * 0.4, h * 0.25, 0.42));
  add('lifeSupport', 'Life support', ecls, V(1, 0.1, 0.2));
  const seats = kind === 'mercury' ? 1 : kind === 'gemini' ? 2 : 3;
  const couch = new THREE.Group();
  const rub = std(0x15181b, { roughness: 0.95, metalness: 0 });
  for (let i = 0; i < seats; i++) {
    const z = (i - (seats - 1) / 2) * 0.48;
    const seat = group(at(box(0.4, 0.06, 0.38, rub), 0, 0, 0), at(box(0.06, 0.42, 0.38, rub), -0.2, 0.2, 0));
    if (opt('couches') === 'shock') seat.add(at(cyl(0.022, 0.022, h * 0.14, metal()), 0.1, -h * 0.07, 0.12), at(cyl(0.022, 0.022, h * 0.14, metal()), 0.1, -h * 0.07, -0.12));
    if (opt('couches') === 'ejection') {
      seat.add(at(box(0.03, 0.7, 0.03, metal(0x6b7280)), -0.28, 0.25, 0.14), at(box(0.03, 0.7, 0.03, metal(0x6b7280)), -0.28, 0.25, -0.14));
      seat.add(at(cyl(0.05, 0.05, 0.5, std(0x9a3412, { roughness: 0.5 })), -0.3, 0.25, 0), at(mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), std(0xfacc15)), 0.18, 0.08, 0));
    }
    seat.position.set(0.05, h * 0.16, z);
    couch.add(seat);
  }
  add('couches', 'Crew couches', couch, V(0.3, -1, 0.6));
  const win = new THREE.Group();
  const big = opt('windows') === 'panoramic';
  for (const [fy, az, w, hh] of WINDOWS[kind]) win.add(onWall(windowPane(w * (big ? 1.6 : 1), hh * (big ? 1.6 : 1)), pts, h * fy, az, 0.01));
  add('windows', 'Windows', win, V(1, 0.4, 0.3));
  const [hy, haz, hw, hh] = HATCH[kind];
  const hatchPanel = box(hw, hh, 0.05, metal(0xd9dde2, 0.4, 0.7));
  hatchPanel.rotation.y = Math.PI / 2;
  const hatch = onWall(group(hatchPanel, at(mesh(new THREE.TorusGeometry(0.08, 0.014, 6, 16), metal(DARK)), 0.03, 0, 0)), pts, h * hy, haz, opt('hatch') === 'inward' ? -0.1 : 0.02);
  const a = haz * DEG;
  add('hatch', 'Hatch', hatch, V(Math.cos(a), 0.2, -Math.sin(a)));
  // the wave-4 slots (a capsule's Blender model replaces these with its own pieces: docking, suits, landing)
  const top = h - 0.1;
  const dk = opt('docking') ?? 'none';
  const dock = new THREE.Group();
  if (dk !== 'none') {
    dock.add(at(cyl(NECK - 0.06, NECK - 0.04, 0.07, metal(0xb9bdc2, 0.4, 0.7)), 0, top, 0));
    if (dk === 'probe_drogue' || dk === 'ssvp') dock.add(at(cyl(0.03, 0.06, 0.22, metal()), 0, top + 0.06, 0));
    else if (dk === 'cbm') dock.add(at(box(0.5, 0.04, 0.5, metal(0xd9dde2, 0.4, 0.7)), 0, top + 0.04, 0));
    else for (let i = 0; i < 3; i++) { const q = (i / 3) * Math.PI * 2; const pet = box(0.18, 0.16, 0.02, metal(0xd9dde2, 0.4, 0.7)); pet.position.set(Math.cos(q) * 0.3, top + 0.1, Math.sin(q) * 0.3); pet.rotation.y = -q + Math.PI / 2; pet.rotation.x = 0.3; dock.add(pet); }
  }
  add('docking', 'Docking mechanism', dock, V(0, 1, 0));
  const air = group(at(ball(0.14, metal(0x3b82c4, 0.4, 0.5)), inner(h * 0.45) * 0.55, h * 0.45, -0.35), at(ball(0.12, metal(0xd9dde2)), inner(h * 0.45) * 0.55, h * 0.45, 0.0));
  if (opt('atmosphere') === 'pure_o2') air.children[1].visible = false;
  add('atmosphere', 'Cabin air', air, V(0.7, 0.3, -0.6));
  const suitMat = std(opt('suits') === 'pressure' ? 0xe2e0d8 : 0x6c7480, { roughness: 0.8, metalness: 0 });
  const suits = new THREE.Group();
  for (let i = 0; i < seats; i++) {
    const z = (i - (seats - 1) / 2) * 0.48;
    suits.add(at(box(0.5, 0.16, 0.3, suitMat), 0.1, h * 0.16 + 0.12, z));
    if (opt('suits') === 'pressure') suits.add(at(ball(0.13, suitMat), -0.22, h * 0.16 + 0.32, z));
  }
  add('suits', 'Suits', suits, V(-0.3, 0.4, 1));
  const ld = opt('landing') ?? 'splash';
  const land = group(at(cyl(0.16, 0.16, 0.36, std(0xcfc6ad, { roughness: 0.9 })), inner(h * 0.7) * 0.6, h * 0.62, 0.3));
  if (ld === 'rockets') for (let i = 0; i < 6; i++) { const q = (i / 6) * Math.PI * 2; land.add(at(cyl(0.05, 0.05, 0.26, metal()), Math.cos(q) * R * 0.5, 0.16, Math.sin(q) * R * 0.5)); }
  if (ld === 'airbags') for (let i = 0; i < 6; i++) { const q = (i / 6) * Math.PI * 2; const bag = box(0.4, 0.07, 0.3, std(0xd8c69a, { roughness: 0.85 })); bag.position.set(Math.cos(q) * R * 0.6, 0.05, Math.sin(q) * R * 0.6); bag.rotation.y = -q; land.add(bag); }
  add('landing', 'Landing system', land, V(0.4, -1, 0.5));
  return out;
}

/** Service modules (kit service_module): power (wings, body cells, fuel cells, batteries) and the engine. */
function serviceInternals(def, options, R, h) {
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const r = R * (def.hullProfile?.kind === 'inner' ? def.hullProfile.rMax ?? 1 : 1);
  const pw = opt('power') ?? 'solar_wings';
  const power = new THREE.Group();
  if (pw === 'solar_wings') for (const s of [-1, 1]) power.add(at(box(0.06, h * 0.6, Math.min(1, r * 0.7), std(0x18233e, { roughness: 0.35, metalness: 0.4 })), s * (r - 0.15), h * 0.45, 0));
  else if (pw === 'body_cells') power.add(at(mesh(new THREE.CylinderGeometry(r - 0.03, r - 0.03, h * 0.6, 40, 1, true, 0, Math.PI), std(0x18233e, { roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide })), 0, h * 0.45, 0));
  else if (pw === 'fuel_cells') for (let i = 0; i < 3; i++) { const q = (i / 3) * Math.PI * 2; power.add(at(cyl(0.13, 0.13, 0.5, metal(0xbfc3c7)), Math.cos(q) * r * 0.55, h * 0.45, Math.sin(q) * r * 0.55)); }
  else for (let i = 0; i < 4; i++) { const q = (i / 4) * Math.PI * 2 + 0.78; power.add(at(box(0.3, 0.22, 0.4, metal(DARK)), Math.cos(q) * r * 0.6, h * 0.45, Math.sin(q) * r * 0.6)); }
  add('power', 'Power', power, V(1, 0.2, 0.3));
  const en = opt('engine') ?? 'main';
  const engine = new THREE.Group();
  const nozMat = std(0x3b3e42, { roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  if (en !== 'thrusters_only') engine.add(at(bell(r * 0.1, r * 0.3, Math.min(h * 0.5, r * 0.8), nozMat), 0, 0.02, 0));
  if (en === 'main_backup') for (const s of [-1, 1]) engine.add(at(bell(r * 0.04, r * 0.1, h * 0.25, nozMat), s * r * 0.5, 0.02, 0));
  if (en === 'thrusters_only') for (let i = 0; i < 4; i++) { const q = (i / 4) * Math.PI * 2 + 0.78; engine.add(at(box(0.1, 0.12, 0.1, metal(0x8d9296)), Math.cos(q) * r * 0.8, 0.12, Math.sin(q) * r * 0.8)); }
  for (let i = 0; i < 2; i++) engine.add(at(ball(r * 0.22, metal(i ? 0xd9dde2 : 0xa3a8ad)), (i ? 1 : -1) * r * 0.42, h * 0.55, 0));
  add('engine', 'Engine and tanks', engine, V(0, -1, 0));
  return out;
}

/** Orbital and cargo modules (kit module): the docking port on top and the stowage inside. */
function moduleInternals(def, options, R, h) {
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const r = R * (def.hullProfile?.rMax ?? 1);
  const dk = opt('docking') ?? 'none';
  const dock = new THREE.Group();
  if (dk !== 'none') {
    dock.add(at(cyl(NECK - 0.06, NECK - 0.04, 0.07, metal(0xb9bdc2, 0.4, 0.7)), 0, h - 0.1, 0));
    if (dk === 'probe_drogue' || dk === 'ssvp') dock.add(at(cyl(0.03, 0.06, 0.22, metal()), 0, h - 0.16, 0));
    if (dk === 'cbm') dock.add(at(box(0.5, 0.04, 0.5, metal(0xd9dde2, 0.4, 0.7)), 0, h - 0.06, 0));
  }
  add('docking', 'Docking port', dock, V(0, 1, 0));
  const st = opt('stowage') ?? 'bags';
  const stow = new THREE.Group();
  const mat = std(st === 'water_wall' ? 0x3c5f9a : st === 'racks' ? 0xd9d8d2 : 0xcfc6ad, { roughness: 0.85 });
  for (let i = 0; i < 6; i++) { const q = (i / 6) * Math.PI * 2; const b = box(0.3, h * 0.5, 0.45, mat); b.position.set(Math.cos(q) * r * 0.6, h * 0.5, Math.sin(q) * r * 0.6); b.rotation.y = -q; stow.add(b); }
  add('stowage', 'Stowage', stow, V(1, 0.1, 0.4));
  return out;
}

/** RCS packs (kit rcs): the propellant tanks and the thruster rings. */
function rcsInternals(options, h) {
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const prop = opt('propellant') ?? 'hypergolic';
  const tanks = group(at(ball(0.08, metal(prop === 'cold_gas' ? 0x3b82c4 : 0xd9dde2)), 0, h * 0.55, -0.08));
  if (prop === 'hypergolic') tanks.add(at(ball(0.08, std(0x9a3412, { roughness: 0.5, metalness: 0.4 })), 0, h * 0.55, 0.08));
  add('propellant', 'Propellant', tanks, V(1, 0.3, 0));
  const rings = group();
  const n = opt('rings') === 'dual' ? 2 : 1;
  for (let k = 0; k < n; k++) for (let i = 0; i < 4; i++) { const q = (i / 4) * Math.PI * 2; rings.add(at(cyl(0.015, 0.03, 0.06, metal(0x2a2e33)), 0.05 + Math.cos(q) * 0.06, h * (0.3 + 0.2 * k), Math.sin(q) * 0.06)); }
  add('rings', 'Thruster rings', rings, V(0, -1, 0.3));
  return out;
}

function towerInternals(def, options, h) {
  const T = TOWERS[def.id];
  if (!T) return null;
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const [m0, m1, mr] = T.motor;
  const nozMat = std(0x24272b, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  const motor = group(at(cyl(mr * 0.92, mr * 0.92, m1 - m0, std(0x8a7a5a, { roughness: 0.9 })), 0, (m0 + m1) / 2, 0), at(cyl(mr * 0.3, mr * 0.3, (m1 - m0) * 1.01, std(0x15181b, { roughness: 1 })), 0, (m0 + m1) / 2, 0));
  const kind = opt('motor') ?? 'canted';
  if (kind === 'ring') for (let i = 0; i < 12; i++) motor.add(cantedNozzle(mr * 0.12, mr * 0.2, mr * 0.4, nozMat, mr, (m0 + m1) / 2, i * 30, 40));
  else if (kind === 'reverse') for (const az of [45, 135, 225, 315]) motor.add(cantedNozzle(mr * 0.15, mr * 0.32, mr * 0.7, nozMat, mr * 0.9, m1 - mr * 0.2, az, 28));
  else for (const az of [45, 135, 225, 315]) motor.add(cantedNozzle(mr * 0.16, mr * 0.34, mr * 0.75, nozMat, mr * 0.6, m0, az, 35));
  add('motor', 'Escape motor', motor, V(1, 0, 0));
  const [j0, j1, jr] = T.jet;
  const jet = new THREE.Group();
  if (opt('jettison') !== 'shared') {
    jet.add(at(cyl(jr * 0.9, jr * 0.9, j1 - j0, std(0x8a7a5a, { roughness: 0.9 })), 0, (j0 + j1) / 2, 0));
    for (const az of [90, 270]) jet.add(cantedNozzle(jr * 0.12, jr * 0.24, jr * 0.4, nozMat, jr, j0 + (j1 - j0) * 0.2, az, 55));
  }
  const igniters = opt('jettison') === 'backup' ? 2 : 1;
  for (let i = 0; i < igniters; i++) jet.add(at(cyl(0.04, 0.04, 0.12, std(0xf59e0b, { roughness: 0.5, metalness: 0.4 })), (i - (igniters - 1) / 2) * 0.12, j1 + 0.05, 0));
  add('jettison', 'Tower jettison', jet, V(0, 1, 0.3));
  const steer = new THREE.Group();
  const s = opt('steering') ?? 'ballast';
  const sy = T.steerY ?? Math.min(h - 0.2, T.nose + 0.1);
  if (s === 'canards') for (const z of [-1, 1]) { const c = box(0.02, 0.4, 0.3, std(0xd9d7d1, { roughness: 0.45, metalness: 0.4 })); c.position.set(0, sy, z * (jr + 0.18)); c.rotation.x = z * 0.5; steer.add(c); }
  else if (s === 'acm') { steer.add(at(cyl(jr, jr, 0.14, metal(0x4b5563, 0.5, 0.6)), 0, sy, 0)); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const p = cyl(0.025, 0.025, 0.08, std(0x111316)); p.rotation.z = Math.PI / 2; p.rotation.y = -a; steer.add(at(p, Math.cos(a) * (jr + 0.05), sy, Math.sin(a) * (jr + 0.05))); } }
  else steer.add(at(cyl(jr * 0.6, jr * 0.6, 0.18, std(0x3f3f46, { roughness: 0.4, metalness: 0.9 })), 0, sy, 0));
  add('steering', 'Steering after an abort', steer, V(-1, 0.3, 0));
  return out;
}

function podInternals(options, h) {
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const printed = opt('chamber') !== 'machined';
  const mat = printed ? std(0x4a4d52, { roughness: 0.75, metalness: 0.5, side: THREE.DoubleSide }) : std(0xb8bcc2, { roughness: 0.25, metalness: 0.95, side: THREE.DoubleSide });
  const eng = new THREE.Group();
  for (const z of [-0.1, 0.1]) eng.add(at(bell(0.04, 0.085, 0.2, mat), 0.03, 0.02, z), at(cyl(0.05, 0.05, 0.12, mat), 0.03, 0.28, z));
  add('chamber', 'Engine chambers', eng, V(0.3, -1, 0));
  const tanks = new THREE.Group();
  tanks.add(at(ball(0.08, metal(0xd9dde2)), -0.02, h * 0.55, -0.08), at(ball(0.08, std(0x9a3412, { roughness: 0.5, metalness: 0.4 })), -0.02, h * 0.55, 0.08));
  if (opt('propellant') === 'dedicated') tanks.add(at(ball(0.06, metal(0xd9dde2)), -0.02, h * 0.78, -0.06), at(ball(0.06, std(0x9a3412, { roughness: 0.5, metalness: 0.4 })), -0.02, h * 0.78, 0.06), at(box(0.05, 0.05, 0.05, std(0xf59e0b)), 0.05, h * 0.66, 0));
  add('propellant', 'Propellant', tanks, V(1, 0.3, 0));
  return out;
}

function shieldInternals(options, R, h) {
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const thick = opt('thickness') === 'thick';
  add('thickness', 'Ablator layer', group(lathe([[0, 0], [R * 0.75, h * 0.1], [R * 1.0, h * (thick ? 0.7 : 0.45)], [0, h * (thick ? 0.7 : 0.45)]], std(CHAR, { roughness: 0.92, metalness: 0.05 }), 48)), V(0, -1, 0));
  const seams = new THREE.Group();
  const seamMat = std(0x6b7280, { roughness: 0.8 });
  if (opt('gaps') !== 'monolithic') for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const s = box(R * 0.95, 0.02, 0.02, seamMat); s.position.set(Math.cos(a) * R * 0.48, h * 0.35, Math.sin(a) * R * 0.48); s.rotation.y = -a; seams.add(s); }
  else seams.add(ring(R * 0.6, h * 0.35, 0.015, seamMat));
  add('gaps', 'Seams', seams, V(0, 1, 0));
  const kind = opt('ablator') ?? 'avcoat';
  const plateMat = kind === 'pica' ? std(0x111214, { roughness: 0.95, metalness: 0 }) : kind === 'sla' ? new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95, bumpMap: corkBump(2, 2), bumpScale: 0.01 }) : new THREE.MeshStandardMaterial({ color: 0x9c9080, roughness: 0.9, bumpMap: hexBump(2, 2), bumpScale: 0.02 });
  const plate = box(R * 0.7, 0.08, R * 0.7, plateMat);
  plate.position.set(R * 0.2, h * 0.5, 0);
  add('ablator', 'Ablator', group(plate), V(-1, 0.2, 0.4));
  return out;
}

/**
 * The pieces inside a part, for the exploded view: [{ key (the kit slot), name, object, dir (THREE.Vector3) }], or null
 * for the default pieces in bay/internalsArt.js. options = { slotKey: chosenOption }, dims = { radius, height }.
 */
/** Parachute pieces for the side-mounted chutes (the same as the shared ones, plus the conical-ribbon canopy). */
function chuteInternals(options, h) {
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.normalize() });
  const kind = opt('canopy') ?? 'dgb';
  const canopyMat = std(kind === 'ringsail' ? 0xe08a3a : 0xf1f0ec, { roughness: 0.9, side: THREE.DoubleSide });
  const canopy = group(at(mesh(new THREE.SphereGeometry(h * 0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat), 0, h * 1.1, 0));
  if (kind === 'dgb') canopy.add(ring(h * 0.55, h * 1.2, 0.02, metal(DARK)));
  if (kind === 'ribbon') for (let i = 1; i < 5; i++) { const a = (i / 5) * (Math.PI / 2); canopy.add(ring(h * 0.6 * Math.sin(a) + 0.005, h * 1.1 + h * 0.6 * Math.cos(a), 0.008, metal(0xb45309, 0.6, 0.2))); }
  add('canopy', 'Canopy', canopy, V(0, 1, 0));
  const reef = group(at(cyl(0.02, 0.02, h * 0.3, metal()), 0, h * 0.75, 0));
  if (opt('reefing') === 'staged') reef.add(at(box(0.06, 0.06, 0.06, std(0xf59e0b)), 0, h * 0.85, 0), at(box(0.06, 0.06, 0.06, std(0xf59e0b)), 0, h * 0.68, 0));
  add('reefing', 'Reefing', reef, V(1, 0, 0));
  return out;
}

export function internalsArt(def, options, dims) {
  if (!def) return null;
  const R = dims?.radius ?? 1.25, h = dims?.height ?? def.height ?? 1;
  let out = null;
  if (def.internals === 'capsule' && def.flags?.capsule) out = capsuleInternals(def, options, R, h);
  else if (def.internals === 'escape_tower') out = towerInternals(def, options, h);
  else if (def.internals === 'abort_pod') out = podInternals(options, h);
  else if (def.internals === 'ablative_shield') out = shieldInternals(options, R, h);
  else if (def.internals === 'chute' && def.attach === 'radial') out = chuteInternals(options, h);
  else if (def.internals === 'service_module') out = serviceInternals(def, options, R, h);
  else if (def.internals === 'module') out = moduleInternals(def, options, R, h);
  else if (def.internals === 'rcs') out = rcsInternals(options, h);
  if (!out) return null;
  // a side part on a capsule is pulled in and tilted onto the cone (seatFor): its pieces start from the same place
  const seat = def.attach === 'radial' ? seatCache.get(`${def.id}:${R}`) : null;
  if (seat) for (const piece of out) { const holder = group(piece.object); holder.position.x = seat.dx; holder.rotation.z = seat.tilt; piece.object = holder; }
  for (const piece of out) piece.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return out;
}
