// 3D art for the outer skin (hull agent): the skirts, cones and fairings hull.js works out, in the look of their
// material (light brushed aluminium 2219 with rivet rows, slightly darker welded aluminium-lithium, black carbon twill,
// bright welded stainless rings, bonded aluminium honeycomb panels), with ring frames at their ends and along long
// skirts. Payload fairings and cork-covered flares are painted white, as real ones are; fairings also get their
// separation rails, and the automatic equipment bay its access doors. Also the one placement rule for side-mounted parts both 3D
// views share (designScene.js, hangarScene.js), now that equipment can ride inside the skin.
// Units: metres, in the vehicle's frame (y = 0 at the stack base). Textures are drawn once per material and reused.
import * as THREE from 'three';
import { canvasTexture, DEG } from './util.js';
import { computeHull } from '../hull.js';

const OFFSET = 0.012; // the skin is drawn this far outside the line hull.js works out, so it never flickers against a part
const TILE = 0.8; // metres of skin per texture tile (a material's look may set its own: bonded honeycomb panels are bigger)
const TAU = Math.PI * 2;

/**
 * Each material's look. Metalness stays moderate: the studio has little to reflect, and fully metallic skins read as
 * dark grey cans. bumpScale is in the bump texture's grey levels.
 */
const LOOKS = {
  al2219: { color: 0xdfe2e6, roughness: 0.42, metalness: 0.45, frame: 0x9aa0a6, bump: 0.006, pattern: 'riveted' },
  al2195: { color: 0xcdd2d8, roughness: 0.44, metalness: 0.45, frame: 0x8a9198, bump: 0.004, pattern: 'welded' },
  carbon: { color: 0xffffff, roughness: 0.32, metalness: 0.2, frame: 0x34383d, bump: 0.003, pattern: 'twill' },
  steel: { color: 0xeef1f3, roughness: 0.24, metalness: 0.5, frame: 0xb7bdc3, bump: 0.003, pattern: 'rings' },
  honeycomb: { color: 0xe6e3da, roughness: 0.5, metalness: 0.3, frame: 0xa3a19a, bump: 0.004, pattern: 'bonded', tile: 1.6 },
  titanium: { color: 0xb9bcc0, roughness: 0.38, metalness: 0.55, frame: 0x7e848b, bump: 0.004, pattern: 'welded' }, // Ti-6Al-4V: darker, warmer grey than aluminium
};
/** The tank finishes an equipment bay may wear, in the colours sections/body/art.js gives the tanks. */
const BAY_FINISH = {
  tiodize: { color: 0xc4916a, roughness: 0.5, metalness: 0.35 },
  foam: { color: 0xc46a2c, roughness: 0.95, metalness: 0 },
  foam_white: { color: 0xefebe3, roughness: 0.85, metalness: 0 },
};
const PAINT = 0xf1f0ec; // the white of the nose covers (sections/nose/art.js), for fairings, cork and pods
const lookOf = (id) => LOOKS[id] ?? LOOKS.al2219;

// ---------- textures (drawn once) ----------
const BASE = new Map();
const REPEATS = new Map();
function baseTex(key, draw, data = false) {
  if (BASE.has(key)) return BASE.get(key);
  const { texture, redraw } = canvasTexture(512, 512);
  redraw(draw);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (data) texture.colorSpace = THREE.NoColorSpace;
  BASE.set(key, texture);
  return texture;
}
function rep(texture, rx, ry) {
  const k = `${texture.uuid}:${rx.toFixed(1)}:${ry.toFixed(1)}`;
  if (REPEATS.has(k)) return REPEATS.get(k);
  const t = texture.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  REPEATS.set(k, t);
  return t;
}
// a fixed pseudo-random sequence, so the brushed streaks look the same every time
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Colour map: brushed metal streaks, carbon twill, steel sheen, honeycomb panel tone. */
function colorMap(id) {
  return baseTex(`hull-color:${id}`, (ctx, w, h) => {
    seed = 11;
    if (id === 'carbon') {
      // 2x2 twill: diagonal steps of over-under tows, two shades of black with a soft sheen across each tow
      const n = 16, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const warp = ((i + j) >> 1) % 2 === 0;
        const g = warp ? ctx.createLinearGradient(i * s, 0, (i + 1) * s, 0) : ctx.createLinearGradient(0, j * s, 0, (j + 1) * s);
        g.addColorStop(0, warp ? '#15171a' : '#1d2024');
        g.addColorStop(0.5, warp ? '#3a3f45' : '#2c3036');
        g.addColorStop(1, warp ? '#15171a' : '#1d2024');
        ctx.fillStyle = g;
        ctx.fillRect(i * s, j * s, s, s);
      }
      return;
    }
    const base = id === 'al2195' ? 168 : id === 'steel' ? 222 : id === 'honeycomb' ? 214 : 200;
    ctx.fillStyle = `rgb(${base},${base},${base + 3})`;
    ctx.fillRect(0, 0, w, h);
    // brushed or rolled grain running round the rocket (horizontal streaks)
    const streaks = id === 'honeycomb' ? 120 : 420;
    for (let i = 0; i < streaks; i++) {
      const v = base + (rnd() - 0.5) * (id === 'steel' ? 26 : id === 'honeycomb' ? 10 : 22);
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 4) | 0},0.55)`;
      ctx.fillRect(rnd() * w - 60, rnd() * h, 80 + rnd() * 260, 1 + rnd() * 1.6);
    }
    if (id === 'honeycomb') {
      // bonded panels: slightly different tones, with sealant lines between them
      ctx.fillStyle = 'rgba(0,0,0,0.03)'; ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = 'rgba(90,88,82,0.45)';
      ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, 0, 3, h);
    }
    if (id === 'steel') {
      // a weld seam across the tile and a faint heat tint along it
      ctx.fillStyle = 'rgba(150,120,90,0.25)'; ctx.fillRect(0, h * 0.5 - 6, w, 12);
      ctx.fillStyle = 'rgba(120,124,128,0.9)'; ctx.fillRect(0, h * 0.5 - 1.5, w, 3);
    }
    if (id === 'al2195') {
      // friction-stir weld seams: a panel join each way
      ctx.fillStyle = 'rgba(120,126,132,0.9)'; ctx.fillRect(0, h * 0.5 - 2, w, 4); ctx.fillRect(w * 0.5 - 2, 0, 4, h);
      ctx.fillStyle = 'rgba(200,205,210,0.5)';
      for (let x = 0; x < w; x += 6) ctx.fillRect(x, h * 0.5 - 2, 3, 4);
    }
  });
}

/** Bump map: stringer lines and rivet rows (2219), weld beads (2195, steel), bonded seams (honeycomb), weave (carbon). */
function bumpMap(id) {
  return baseTex(`hull-bump:${id}`, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    const dot = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
    if (id === 'al2219') {
      // four stringers per tile, each a raised line with a rivet row; a ring-frame rivet row across the middle
      for (let i = 0; i < 4; i++) {
        const x = (w / 4) * i + w / 8;
        const g = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
        g.addColorStop(0, '#808080'); g.addColorStop(0.5, '#a8a8a8'); g.addColorStop(1, '#808080');
        ctx.fillStyle = g; ctx.fillRect(x - 6, 0, 12, h);
        for (let y = 6; y < h; y += 16) dot(x, y, 2.4, '#c8c8c8');
      }
      for (let x = 8; x < w; x += 16) { dot(x, h * 0.5, 2.4, '#c8c8c8'); dot(x, h * 0.5 + 9, 2.4, '#c8c8c8'); }
      ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, h * 0.5 - 5, w, 2); // the lap joint
    } else if (id === 'al2195' || id === 'steel') {
      ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, h * 0.5 - 3, w, 6);
      if (id === 'al2195') ctx.fillRect(w * 0.5 - 3, 0, 6, h);
    } else if (id === 'honeycomb') {
      ctx.fillStyle = '#6a6a6a';
      ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, 0, 3, h);
      for (let x = 12; x < w; x += 24) dot(x, 10, 2, '#a0a0a0'); // fasteners along the panel's edge
    } else if (id === 'carbon') {
      const n = 16, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        ctx.fillStyle = ((i + j) >> 1) % 2 === 0 ? '#8c8c8c' : '#747474';
        ctx.fillRect(i * s + 1, j * s + 1, s - 2, s - 2);
      }
    }
  }, true);
}

function skinMaterial(id, rx, ry, painted = false) {
  const look = lookOf(id);
  if (painted) {
    // white paint over the material: its panel seams and rivets still show through as relief
    return new THREE.MeshStandardMaterial({ color: PAINT, roughness: 0.46, metalness: 0.08, bumpMap: rep(bumpMap(id), rx, ry), bumpScale: look.bump * 0.7, side: THREE.DoubleSide });
  }
  return new THREE.MeshStandardMaterial({
    color: look.color, roughness: look.roughness, metalness: look.metalness,
    map: rep(colorMap(id), rx, ry), bumpMap: rep(bumpMap(id), rx, ry), bumpScale: look.bump,
    side: THREE.DoubleSide,
  });
}

function ringFrame(r, y, mat, thick = 0.024) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, thick, 6, 72), mat);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}

const tagged = (g, seg, index) => {
  g.userData = { hull: true, hullSection: seg.section, hullIndex: index, hullMaterial: seg.material };
  g.traverse((o) => { o.userData.hull = true; o.userData.hullSection = seg.section; o.userData.hullIndex = index; o.userData.hullMaterial = seg.material; });
  return g;
};

/** One skin segment { kind, y0, y1, r0, r1, material, section }: shell, frames, and rails on a fairing. */
function segmentArt(seg, index) {
  const g = new THREE.Group();
  const len = seg.y1 - seg.y0;
  if (!(len > 0.005)) return g;
  const rb = seg.r0 + OFFSET, rt = seg.r1 + OFFSET;
  const slant = Math.hypot(len, rt - rb);
  const tile = lookOf(seg.material).tile ?? TILE;
  const around = (TAU * Math.max(rb, rt)) / tile;
  const painted = seg.kind === 'fairing' || !!seg.cork;
  // an equipment bay in a stage with one finish end to end wears that finish (sections/body/art.js draws the tanks)
  const finish = seg.kind === 'bay' ? BAY_FINISH[seg.finish] : null;
  const shell = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(rb, seg.y0), new THREE.Vector2(rt, seg.y1)], 72), finish ? new THREE.MeshStandardMaterial(finish) : skinMaterial(seg.material, Math.max(1, Math.round(around)), Math.max(0.5, slant / tile), painted));
  g.add(shell);
  const look = lookOf(seg.material);
  const frameMat = new THREE.MeshStandardMaterial({ color: painted ? 0xc9ccd0 : look.frame, roughness: 0.45, metalness: seg.material === 'carbon' ? 0.3 : 0.5 });
  const at = (f) => ({ y: seg.y0 + len * f, r: rb + (rt - rb) * f + 0.006 });
  // ring frames at both ends (where it bolts to its neighbours) and every 1.2 m along a long skirt
  for (const f of [Math.min(0.5, 0.035 / len), Math.max(0.5, 1 - 0.035 / len)]) { const p = at(f); g.add(ringFrame(p.r, p.y, frameMat)); }
  const bays = Math.floor(len / 1.2);
  if (seg.material !== 'carbon') for (let i = 1; i <= bays; i++) { const p = at(i / (bays + 1)); g.add(ringFrame(p.r, p.y, frameMat, seg.material === 'steel' ? 0.01 : 0.016)); }
  if (seg.kind === 'bay') {
    // the equipment bay: two access doors and an umbilical plate, as on a service module
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.6, metalness: 0.4 });
    const r = rb + 0.008, h = Math.min(0.9, len * 0.6);
    for (const [az, w] of [[35, 0.6], [215, 0.45]]) {
      const door = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12, 1, true, (az * DEG) + Math.PI / 2 - w / r / 2, w / r), new THREE.MeshStandardMaterial({ color: new THREE.Color(look.color).multiplyScalar(0.8), roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
      door.position.y = (seg.y0 + seg.y1) / 2;
      g.add(door);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, Math.min(0.3, len * 0.3), 0.36), dark);
    const az = 125 * DEG;
    plate.position.set(Math.cos(az) * (r + 0.02), (seg.y0 + seg.y1) / 2, -Math.sin(az) * (r + 0.02));
    plate.rotation.y = az;
    g.add(plate);
  }
  if (seg.kind === 'fairing') {
    // the two halves' separation rails and the clamp band at the base
    const rail = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.55, metalness: 0.6 });
    for (const az of [0, 180]) {
      const a = az * DEG;
      const r = (rb + rt) / 2 + 0.012;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, len - 0.06, 0.03), rail);
      b.position.set(Math.cos(a) * r, (seg.y0 + seg.y1) / 2, -Math.sin(a) * r);
      g.add(b);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rb + 0.008, rb + 0.008, 0.07, 72, 1, true), rail);
    band.position.y = seg.y0 + 0.06;
    g.add(band);
  }
  return tagged(g, seg, index);
}

/** The whole skin: a group with one child group per segment (child i is segment i). */
export function hullArt(segments) {
  const g = new THREE.Group();
  g.name = 'skin';
  (segments ?? []).forEach((s, i) => g.add(segmentArt(s, i)));
  return g;
}

/** The skin of a layout (materials from layout.hullMaterials): { hull (computeHull result), object }. */
export function skinFor(layout) {
  const hull = computeHull(layout, { hull: layout.hullMaterials ?? {} });
  return { hull, object: hullArt(hull.segments) };
}

/**
 * Puts the art of a side-mounted layout entry in place and returns the pivot to add to the vehicle. Outside parts
 * sit on their host's wall as before; equipment riding inside the skin (entry.inside, from
 * assembly.layout()) sits at entry.mountR, pulled in so its real width stays inside the skin; rings and steering
 * hardware drawn round the axis stay on the axis (only in the art: their ShipSpec position stays on the wall).
 */
export function mountRadial(art, e, layout) {
  const pivot = new THREE.Group();
  pivot.position.set(0, e.y, 0);
  pivot.rotation.y = e.angle * DEG;
  const isFin = /fin/.test(e.type), isLegs = /leg/.test(e.type), isSrb = !!art.userData.srb;
  if (e.inside) {
    if (art.userData.ring) art.position.x = 0;
    else if (e.def?.flags?.gimbal) art.position.x = e.radius + (art.userData.width ?? 0.6) * 0.45; // drawn round the axis already
    else {
      const box = new THREE.Box3().setFromObject(art);
      const half = Number.isFinite(box.min.x) ? (box.max.x - box.min.x) / 2 : 0.3;
      const mid = Number.isFinite(box.min.x) ? (box.min.x + box.max.x) / 2 : 0;
      const room = Number.isFinite(e.skinR) ? e.skinR - 0.04 - half : e.mountR;
      art.position.x = Math.max((e.skinR ?? e.radius) * 0.2, Math.min(e.mountR ?? e.radius, room)) - mid;
    }
  } else {
    const host = layout.find((x) => x.id === e.parentId);
    const taper = host?.def.flags?.capsule ? 1 - 0.3 * Math.max(0, e.yFrac - 0.4) : 1; // capsules narrow towards the top
    if (isSrb) art.position.x = e.radius + (art.userData.width ?? 0.9) * 0.5 + 0.05;
    else if (!isFin && !isLegs) art.position.x = e.radius * taper + (art.userData.width ?? 0.6) * 0.45;
    if (isFin) art.position.x = e.radius - 1.2;
  }
  pivot.add(art);
  return pivot;
}
