// The walkable crew cabin of the Mars lander (Role 3). 4 m wide (x -2..2), 8 m long (z -4..4), origin = middle of the
// floor, +Y up, flight-deck bulkhead hatch at -Z, airlock at +Z. Walls are 2.15 m high, then a 45 degree chamfer to the 2.6 m ceiling.
// Role 2 reads group.userData.stations / .props / .setAlarm, and calls userData.onFrame each frame (see surface/index.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr, interiorEnvironment } from './interiors.js';
import { sharedUniforms } from './shared.js';
import { addZeroGDressing } from './cabinZeroG.js';
import {
  box, glow, seeded, makeCanvas, canvasTexture, screen, cyl, sphere, torus, rod, tube, place, quad, bake,
  panelTextures, hullTexture, gratingTextures, hazardTexture, occlusionTexture, fabricTexture, rackAtlas, moduleFace,
  labelAtlas, labelStrip, pouchAtlas, drawMarsView, drawPatch, drawFamilyPhoto, drawNoteBoard, drawWave, drawLink, drawKeys,
  drawGaugeDial, drawWater, drawAirlockSign, drawBikeStats, drawSampleLog, drawPilotNav, drawSystems, stencil, MONO,
} from './cabinParts.js';

const W = 4, L = 8, H = 2.6, WALL_H = 2.15;
// Window openings in the walls (the same list builds the wall holes and the windows): wall, centre, yaw and shape.
const WIN_ROUND = (r, n = 28) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r]);
const WIN_TRAP = (size) => [[-size * 0.5, -size * 0.45], [size * 0.5, -size * 0.45], [size * 0.32, size * 0.45], [-size * 0.32, size * 0.45]];
const WINDOWS = [
  { wall: 'left', x: -W / 2, y: 1.55, z: 1.46, ry: Math.PI / 2, kind: 'round', size: 0.33 },
  { wall: 'right', x: W / 2, y: 1.55, z: 1.55, ry: -Math.PI / 2, kind: 'round', size: 0.33 },
];
// The pressure-bulkhead hatch in the -Z wall (round, on the aisle, sill 0.55 m): 0.75 m clear like the Apollo aft hatch it meets.
const BH = { x: 0, r: 0.375, sill: 0.55, y: 0.55 + 0.375 };
const BH_HOLE = { wall: 'front', x: BH.x, y: BH.y, z: -L / 2, ry: 0, kind: 'round', size: 2 * BH.r };
const HATCH_WIN = { wall: 'right', x: W / 2, y: 1.42, z: -3.62, size: 0.23 };   // the window in the side hatch door
// Wall plane coordinates: s along the wall, v up. at(s, v) -> world, sv(world) -> [s, v]; the texture u runs with s.
const WALLS = {
  left: { len: L, at: (s, v) => [-W / 2, v, L / 2 - s], sv: (p) => [L / 2 - p.z, p.y], mat: 'left' },
  right: { len: L, at: (s, v) => [W / 2, v, s - L / 2], sv: (p) => [p.z + L / 2, p.y], mat: 'right' },
  front: { len: W, at: (s, v) => [s - W / 2, v, -L / 2], sv: (p) => [p.x + W / 2, p.y], mat: 'front' },
  back: { len: W, at: (s, v) => [W / 2 - s, v, L / 2], sv: (p) => [W / 2 - p.x, p.y], mat: 'back' },
};
/** One wall panel with the window openings cut out (textured exactly like the old single quad). */
function wallPanel(name) {
  const wall = WALLS[name];
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(wall.len, 0), new THREE.Vector2(wall.len, WALL_H), new THREE.Vector2(0, WALL_H)]);
  const rot = new THREE.Object3D();
  for (const w of [...WINDOWS, HATCH_WIN, BH_HOLE].filter((q) => q.wall === name)) {
    const pts = w.kind === 'trap' ? WIN_TRAP(w.size) : WIN_ROUND(w.size / 2);
    rot.rotation.y = w.ry ?? 0;
    rot.updateMatrixWorld(true);
    const hole = new THREE.Path(pts.map(([px, py]) => {
      const p = new THREE.Vector3(px, py, 0).applyMatrix4(rot.matrixWorld);   // wall-plane offset of this point
      return new THREE.Vector2(...wall.sv(new THREE.Vector3(w.x + p.x, w.y + p.y, w.z + p.z)));
    }));
    shape.holes.push(hole);
  }
  const g = new THREE.ShapeGeometry(shape);
  const pos = g.attributes.position, n = pos.count;
  const out = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = wall.at(pos.getX(i), pos.getY(i));
    out.set([x, y, z], i * 3);
    uv.set([pos.getX(i) / wall.len, pos.getY(i) / WALL_H], i * 2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // face the room
  const a = new THREE.Vector3().fromArray(out, g.index.getX(0) * 3), b2 = new THREE.Vector3().fromArray(out, g.index.getX(1) * 3), c = new THREE.Vector3().fromArray(out, g.index.getX(2) * 3);
  const normal = b2.sub(a).cross(c.sub(a)).normalize();
  if (normal.dot(new THREE.Vector3(0, 1.3, 0).sub(a)) < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    normal.negate();
  }
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n }, () => normal.toArray()).flat()), 3));
  return g;
}
const hw = W / 2, hl = L / 2, cx = hw - 0.45;

/** The flat ceiling (one quad; same UV mapping as before). */
function ceilingPieces() {
  const q = (a, b2, c, d) => [[a, H, c], [b2, H, c], [b2, H, d], [a, H, d]];
  return [q(-cx, cx, -hl, hl)];
}

// ---- Materials, built once -------------------------------------------------------------------------------------
let M = null;
let litCache = null;
function materials() {
  if (M) return M;
  const fab = fabricTexture();
  const fabric = (color, rough = 0.92) => pbr(color, rough, 0, { map: fab, bumpMap: fab, bumpScale: 0.6 });
  const grating = gratingTextures();
  const hull = hullTexture();
  const mk = (t) => pbr(0xffffff, 0.72, 0.05, { map: t.map, bumpMap: t.bump, bumpScale: 2.2 });
  M = {
    dark: pbr(0x1d2126, 0.5, 0.5),
    rubber: pbr(0x15171a, 0.92, 0),
    paint: pbr(0xe4dcc6, 0.62, 0.08),
    paintGrey: pbr(0x80868b, 0.55, 0.3),
    blueGrey: pbr(0x586a80, 0.5, 0.35),
    rib: pbr(0x9a9382, 0.55, 0.35),
    metal: pbr(0xb0b8c0, 0.28, 0.95),
    brass: pbr(0xc9a24a, 0.3, 0.9),
    anodBlue: pbr(0x2f5d9a, 0.35, 0.8),
    orange: pbr(0xd0622a, 0.5, 0.25),
    red: pbr(0xc42b25, 0.45, 0.3),
    green: pbr(0x2f7d55, 0.4, 0.5),
    hose: pbr(0xd9c24a, 0.6, 0.1),
    cream: pbr(0xd8cdb6, 0.85, 0),
    blanket: fabric(0x5d6672, 0.95),
    sleepBag: fabric(0x3d5a7a, 0.9),
    curtain: pbr(0xb4ab99, 0.95, 0, { side: THREE.DoubleSide }),
    wood: pbr(0x7b5a3e, 0.7, 0.05),
    copper: pbr(0xb4713f, 0.35, 0.9),
    suit: pbr(0xe8e6e0, 0.65, 0.05),
    gold: pbr(0xd9a521, 0.15, 1),
    cabinet: pbr(0x6c7176, 0.55, 0.4),
    leaf: pbr(0x4f9a4a, 0.7, 0),
    soil: pbr(0x3a2a20, 0.95, 0),
    bagSand: fabric(0xeeeadf), bagGrey: fabric(0xe3e0d6), bagBlue: fabric(0xdad8cf), bagOlive: fabric(0xe9e4d2),
    seat: fabric(0xe9e4d4, 0.95), strap: fabric(0x3c3f42, 0.85), webbing: fabric(0xe9e6dc, 0.8),
    blob: new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
    velcro: pbr(0x2a2e33, 1, 0),
    glass: new THREE.MeshStandardMaterial({ color: 0xbcd6e8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, envMap: interiorEnvironment(), envMapIntensity: 0.12, depthWrite: false }),
    modules: pbr(0xffffff, 0.5, 0.15, { map: rackAtlas() }),
    labels: pbr(0xffffff, 0.6, 0, { map: labelAtlas() }),
    pouches: new THREE.MeshBasicMaterial({ map: pouchAtlas(), color: new THREE.Color(0.8, 0.8, 0.8) }),
    foilA: pbr(0xb8bec6, 0.35, 0.8), foilB: pbr(0xc4622c, 0.45, 0.4), foilC: pbr(0x6d8a55, 0.5, 0.3),
    hazard: pbr(0xffffff, 0.6, 0.1, { map: hazardTexture() }),
    floor: pbr(0xffffff, 0.55, 0.55, { map: grating.map, bumpMap: grating.bump, bumpScale: 1 }),
    hull: pbr(0xffffff, 0.6, 0.35, { map: hull }),
    paintLine: pbr(0xe0ae1c, 0.6, 0.1),
    ao: new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: occlusionTexture(), transparent: true, depthWrite: false, opacity: 0.8 }),
    walls: {
      side: mk(panelTextures(L, WALL_H, [], 'side')),
      left: mk(panelTextures(L, WALL_H, [{ text: 'DECK 2', x: 4.3, y: 0.28, size: 40 }, { text: 'STOW', x: 7.0, y: 0.3, size: 40 }], 'left')),
      right: mk(panelTextures(L, WALL_H, [{ text: 'COMMS', x: 2.7, y: 0.28, size: 40 }, { text: 'SAMPLES', x: 4.9, y: 0.28, size: 36 }, { text: 'GALLEY', x: 6.2, y: 0.28, size: 36 }], 'right')),
      front: mk(panelTextures(W, WALL_H, [], 'front')),
      back: mk(panelTextures(W, WALL_H, [{ text: 'EVA ONLY', x: 3.35, y: 0.5, size: 40 }], 'back')),
    },
  };
  return M;
}
const lit = (color, power = 2) => {
  litCache ??= new Map();
  const key = `${color}:${power}`;
  if (!litCache.has(key)) litCache.set(key, glow(color, power));
  return litCache.get(key);
};

let decalMats = null;
function decals() {
  if (decalMats) return decalMats;
  const basic = (draw, w, h, alpha = false, power = 0.85) => {
    const canvas = makeCanvas(w, h);
    draw(canvas.getContext('2d'), w, h);
    return new THREE.MeshBasicMaterial({ map: canvasTexture(canvas), color: new THREE.Color(power, power, power), transparent: alpha });
  };
  decalMats = {
    mars: basic(drawMarsView, 1024, 256, false, 1.05),
    marsRound: basic(drawMarsView, 256, 256, false, 1.05),
    patch: basic(drawPatch, 256, 256, true, 0.9),
    photo: basic(drawFamilyPhoto, 256, 320, false, 0.85),
    notes: basic(drawNoteBoard, 256, 256, false, 0.8),
  };
  return decalMats;
}

// ---- Small building blocks ---------------------------------------------------------------------------------------

/** A grid of rack modules (plates with printed faces, LEDs and handles) filling a w x h area whose back is at z. */
function rackBlock(s, m, x, y, z, w, h, seed = 0, depth = 0.1) {
  const cols = Math.max(1, Math.round(w / 0.4)), rows = Math.max(1, Math.round(h / 0.3));
  const mw = w / cols, mh = h / rows;
  s.add(box(w + 0.06, h + 0.06, 0.02, m.dark, x, y, z, 0));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = x - w / 2 + mw * (i + 0.5), py = y - h / 2 + mh * (j + 0.5);
    const out = 0.02 + ((i * 3 + j * 5 + seed) % 3) * 0.015; // modules sit at slightly different depths
    s.add(box(mw - 0.014, mh - 0.014, depth + out, m.paintGrey, px, py, z + (depth + out) / 2 + 0.01, 0.008));
    const face = new THREE.Mesh(moduleFace(mw - 0.04, mh - 0.04, (i * 5 + j * 3 + seed) % 16), m.modules);
    face.position.set(px, py, z + depth + out + 0.012);
    s.add(face);
    const on = (i + j + seed) % 3 !== 0;
    s.add(box(0.012, 0.012, 0.006, lit(on ? '#34d399' : '#fbbf24', 2.2), px + mw / 2 - 0.03, py + mh / 2 - 0.03, z + depth + out + 0.014, 0));
    s.add(box(0.05, 0.008, 0.014, m.metal, px, py - mh / 2 + 0.018, z + depth + out + 0.018, 0));
  }
}

const handrail = (s, m, a, b2, r = 0.017) => {
  s.add(rod(a, b2, r, m.metal, 10));
  const d = new THREE.Vector3(...b2).sub(new THREE.Vector3(...a));
  for (const t of [0.04, 0.96]) {
    const p = new THREE.Vector3(...a).addScaledVector(d, t);
    s.add(box(0.035, 0.035, 0.07, m.dark, p.x, p.y, p.z - 0.035, 0));
  }
};

const vent = (s, m, w, h, x, y, z) => {
  s.add(box(w, h, 0.02, m.dark, x, y, z, 0));
  const n = Math.max(3, Math.round(h / 0.03));
  for (let i = 0; i < n; i++) s.add(place(box(w - 0.03, 0.012, 0.03, m.paintGrey, x, y - h / 2 + (i + 0.6) * h / n, z + 0.012, 0), -0.5));
  s.add(box(w + 0.03, 0.015, 0.025, m.paintGrey, x, y + h / 2, z + 0.008, 0), box(w + 0.03, 0.015, 0.025, m.paintGrey, x, y - h / 2, z + 0.008, 0));
};

const label = (s, m, w, h, index, x, y, z) => {
  const mesh = new THREE.Mesh(labelStrip(w, h, index), m.labels);
  mesh.position.set(x, y, z);
  s.add(mesh);
};

/** A stowage bag with webbing straps, a velcro patch and a label. */
const bag = (s, m, mat, w, h, d, x, y, z, labelIdx, rz = 0) => {
  s.add(place(box(w, h, d, mat, x, y, z, Math.min(0.05, h / 3)), 0, 0, rz));
  s.add(place(box(0.035, h + 0.012, d + 0.012, m.strap, x - w * 0.28, y, z, 0.004), 0, 0, rz));
  s.add(place(box(0.035, h + 0.012, d + 0.012, m.strap, x + w * 0.28, y, z, 0.004), 0, 0, rz));
  s.add(box(w * 0.34, h * 0.28, 0.008, m.velcro, x, y + h * 0.18, z + d / 2 + 0.003, 0.002));
  s.add(box(0.03, 0.02, 0.012, m.metal, x - w * 0.28, y - h * 0.1, z + d / 2 + 0.004, 0));
  label(s, m, Math.min(0.16, w * 0.6), 0.04, labelIdx, x, y - h * 0.22, z + d / 2 + 0.006);
};

const cableBundle = (s, points, colors, radius = 0.01) => {
  colors.forEach((c, i) => {
    const off = (i - (colors.length - 1) / 2) * radius * 1.9;
    s.add(tube(points.map((p) => [p[0] + off, p[1] + (i % 2) * radius, p[2]]), radius, pbr(c, 0.6, 0.1), 20));
  });
};


// ---- Windows, hatches and the docking tunnel -------------------------------------------------------------------
const blobTexture = () => {
  const cv = makeCanvas(64, 64), c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, '#fff'); g.addColorStop(1, '#000');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return canvasTexture(cv, { srgb: false });
};
const polyShape = (pts) => { const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath(); return sh; };
const circlePts = (r, n = 28) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * 6.2832) * r, Math.sin(i / n * 6.2832) * r]);
const grow = (pts, d) => pts.map(([x, y]) => { const l = Math.hypot(x, y) || 1; return [x + x / l * d, y + y / l * d]; });
/** A flat ring (outline with a hole) extruded +z by depth. */
const slab = (outer, inner, depth, mat) => {
  const sh = polyShape(outer);
  sh.holes.push(polyShape(inner));
  return new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), mat);
};
const shapeFace = (pts, mat) => {
  const g = new THREE.ShapeGeometry(polyShape(pts));
  g.computeBoundingBox();
  const bb = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  return new THREE.Mesh(g, mat);
};
/** A deep-set window: dark bezel 65 mm deep, the outside view at the back, a thin glass pane, a silver retaining lip and bolts.
 *  The group sits on the wall with local +z pointing into the room. */
function addWindow(parent, m, D, { x, y, z, ry = 0, kind = 'round', size = 0.33 }) {
  const w = new THREE.Group();
  w.position.set(x, y, z);
  w.rotation.y = ry;
  const inner = kind === 'round' ? circlePts(size / 2) : [[-size * 0.5, -size * 0.45], [size * 0.5, -size * 0.45], [size * 0.32, size * 0.45], [-size * 0.32, size * 0.45]];
  const depth = 0.065;
  w.add(slab(grow(inner, 0.045), inner, depth, m.dark));
  w.add(slab(grow(inner, 0.024), grow(inner, -0.004), 0.008, m.metal).translateZ(depth));
  const view = shapeFace(inner, D.marsRound);
  view.position.z = 0.004;
  view.userData.dynamic = true;     // painted Mars: hidden when the cabin hangs in a live scene (the wall has a real opening)
  view.userData.windowView = true;
  const glass = shapeFace(inner, m.glass);
  glass.position.z = depth - 0.012;
  w.add(view, glass);
  const step = Math.max(1, Math.round(inner.length / 8));
  grow(inner, 0.034).forEach(([bx, by], i) => { if (i % step === 0) w.add(cyl(0.006, 0.014, m.metal, bx, by, depth + 0.004, 'z', 6)); });
  parent.add(w);
  return w;
}

// A cabin-wide cache of box geometry hands every build the same shells, so only meshes are created per call.
let buildCount = 0;

/**
 * Builds the cabin. Stations and props are in group.userData.stations / .props (same shape as before).
 */
let pooled = null;
/** Builds a cabin ahead of time (warm-up, while the player is on the PRELAUNCH screen) so createCabin() in ORBIT is free of the ~300 ms build. */
export function prebuildCabin() {
  pooled ??= buildCabin();
  return pooled;
}
export function createCabin() {
  if (pooled) { const cabin = pooled; pooled = null; return cabin; }
  return buildCabin();
}
function buildCabin() {
  const m = materials();
  const D = decals();
  const group = new THREE.Group();
  group.name = 'cabin';
  const b = (w, h, d, mat, x, y, z, r = 0.012) => box(w, h, d, mat, x, y, z, r);
  buildCount++;

  // ---- Shell ----
  const shell = [
    [quad([[-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl]], [[0, 0], [W, 0], [W, L], [0, L]]), m.floor],
    ...ceilingPieces().map((c) => [quad(c, c.map(([x, , z]) => [(x + cx) * 0.5, (z + hl) * 0.5])), m.hull]),
    [wallPanel('left'), m.walls.left],
    [wallPanel('right'), m.walls.right],
    [wallPanel('front'), m.walls.front],
    [wallPanel('back'), m.walls.back],
    [quad([[-hw, WALL_H, -hl], [-hw, WALL_H, hl], [-cx, H, hl], [-cx, H, -hl]], [[0, 0], [L / 2, 0], [L / 2, 0.32], [0, 0.32]]), m.hull],
    [quad([[hw, WALL_H, hl], [hw, WALL_H, -hl], [cx, H, -hl], [cx, H, hl]], [[0, 0], [L / 2, 0], [L / 2, 0.32], [0, 0.32]]), m.hull],
    [quad([[-hw, WALL_H, -hl], [hw, WALL_H, -hl], [cx, H, -hl], [-cx, H, -hl]], [[0, 0], [2, 0], [1.8, 0.32], [0.2, 0.32]]), m.hull],
    [quad([[hw, WALL_H, hl], [-hw, WALL_H, hl], [-cx, H, hl], [cx, H, hl]], [[0, 0], [2, 0], [1.8, 0.32], [0.2, 0.32]]), m.hull],
    [quad([[-0.95, 0.004, 3.3], [0.95, 0.004, 3.3], [0.95, 0.004, 3.84], [-0.95, 0.004, 3.84]], [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]), m.hazard],
  ];
  for (const [geometry, material] of shell) group.add(new THREE.Mesh(geometry, material));

  const ao = (corners) => group.add(new THREE.Mesh(quad(corners, [[0, 1], [1, 1], [1, 0], [0, 0]]), m.ao));
  const o = 0.006, aoH = 0.5, aoF = 0.45;
  ao([[-hw + o, 0, hl], [-hw + o, 0, -hl], [-hw + o, aoH, -hl], [-hw + o, aoH, hl]]);
  ao([[hw - o, 0, -hl], [hw - o, 0, hl], [hw - o, aoH, hl], [hw - o, aoH, -hl]]);
  ao([[-hw, 0, -hl + o], [hw, 0, -hl + o], [hw, aoH, -hl + o], [-hw, aoH, -hl + o]]);
  ao([[hw, 0, hl - o], [-hw, 0, hl - o], [-hw, aoH, hl - o], [hw, aoH, hl - o]]);
  ao([[-hw, o, hl], [-hw, o, -hl], [-hw + aoF, o, -hl], [-hw + aoF, o, hl]]);
  ao([[hw, o, -hl], [hw, o, hl], [hw - aoF, o, hl], [hw - aoF, o, -hl]]);
  ao([[-hw, o, -hl], [hw, o, -hl], [hw, o, -hl + aoF], [-hw, o, -hl + aoF]]);
  ao([[hw, o, hl], [-hw, o, hl], [-hw, o, hl - aoF], [hw, o, hl - aoF]]);
  ao([[-hw + o, WALL_H, hl], [-hw + o, WALL_H, -hl], [-hw + o, WALL_H - 0.3, -hl], [-hw + o, WALL_H - 0.3, hl]]);
  ao([[hw - o, WALL_H, -hl], [hw - o, WALL_H, hl], [hw - o, WALL_H - 0.3, hl], [hw - o, WALL_H - 0.3, -hl]]);

  // Aisle edge lines and a flush floor access hatch.
  const stripe = (x0, z0, x1, z1) => group.add(new THREE.Mesh(quad([[x0, 0.004, z0], [x1, 0.004, z0], [x1, 0.004, z1], [x0, 0.004, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]]), m.paintLine));
  stripe(-0.9, -3.0, -0.86, 3.2); stripe(0.86, -3.0, 0.9, 3.2);
  group.add(b(0.7, 0.012, 0.7, m.paintGrey, 0, 0.006, -1.6, 0.004), b(0.14, 0.004, 0.04, m.dark, 0, 0.014, -1.6, 0), b(0.62, 0.003, 0.02, m.dark, 0, 0.012, -1.26, 0));

  // ---- Ribs, ceiling hardware, handrails ----
  for (let z = -hl + 0.8; z < hl; z += 1.6) {
    [-1, 1].forEach((s) => {
      group.add(b(0.1, WALL_H, 0.14, m.rib, s * (hw - 0.05), WALL_H / 2, z));
      group.add(place(b(0.66, 0.09, 0.14, m.rib, s * (hw - 0.225), WALL_H + 0.225, z), 0, 0, s * -Math.PI / 4));
      [1.28, 1.14].forEach((x) => group.add(b(0.1, 0.1, 0.08, m.dark, s * x, H - 0.13, z + 0.1)));
    });
    group.add(b(2 * cx, 0.09, 0.14, m.rib, 0, H - 0.045, z));
  }
  [-1, 1].forEach((s) => {
    group.add(b(0.06, 0.08, L, m.rib, s * (hw - 0.03), 0.04, 0));
    group.add(cyl(0.05, L - 0.1, m.metal, s * 1.28, H - 0.13, 0, 'z', 14));
    group.add(cyl(0.032, L - 0.1, m.copper, s * 1.14, H - 0.1, 0, 'z', 10));
    // Duct clamps.
    for (let z = -3.4; z <= 3.4; z += 0.85) group.add(cyl(0.056, 0.03, m.dark, s * 1.28, H - 0.13, z, 'z', 14));
    // A cable tray (a U channel) with a bundle in it, hugging the chamfer.
    const tx = s * 1.72, ty = 2.42;
    group.add(place(b(0.2, 0.02, L - 0.2, m.paintGrey, tx, ty, 0, 0.004), 0, 0, s * -Math.PI / 4 * 0.9));
    for (let z = -3.6; z <= 3.6; z += 0.9) group.add(place(b(0.22, 0.012, 0.05, m.dark, tx, ty, z, 0.002), 0, 0, s * -Math.PI / 4 * 0.9));
  });
  [0x2b2d30, 0x55585c, 0x1e2022, 0x7a7466, 0x111418].forEach((color, i) => {
    group.add(cyl(0.02, L - 0.1, pbr(color, 0.6, 0.1), -1.72 + (i - 2) * 0.026 + 0.03, 2.43 + (i - 2) * 0.02, 0, 'z', 8));
    group.add(cyl(0.018, L - 0.1, pbr(color, 0.6, 0.1), 1.72 - (i - 2) * 0.026 - 0.03, 2.43 + (i - 2) * 0.02, 0, 'z', 8));
  });
  // Ceiling vent grilles between the lights.
  [[-0.55, -1.6], [0.55, 1.6], [-0.55, 1.6], [0.55, -1.6], [0, 3.4]].forEach(([x, z]) => {
    group.add(b(0.46, 0.02, 0.3, m.dark, x, H - 0.012, z, 0));
    for (let i = 0; i < 5; i++) group.add(b(0.42, 0.01, 0.022, m.paintGrey, x, H - 0.026, z - 0.11 + i * 0.055, 0));
  });
  // Handrails along both walls between the stations, standing off on brackets.
  [[-1, -0.6, -0.1], [-1, 3.0, 3.7], [1, -0.55, -0.15], [1, 3.0, 3.7], [-1, -3.6, -3.0]].forEach(([s, z0, z1]) => {
    handrail(group, m, [s * 1.92, 1.1, z0], [s * 1.92, 1.1, z1]);
  });
  // Vertical grab bars beside the hatch.
  [-1, 1].forEach((s) => {
    group.add(cyl(0.017, 0.7, m.metal, s * 0.95, 1.25, 3.93, 'y', 10), b(0.04, 0.04, 0.06, m.dark, s * 0.95, 0.92, 3.96, 0), b(0.04, 0.04, 0.06, m.dark, s * 0.95, 1.58, 3.96, 0));
  });

  // Ceiling lights: four diffusers in dark frames. The strips are the only emissive surface that dims on alarm.
  const stripMat = glow('#fff1dc', 2.2);
  [-2.4, -0.8, 0.8, 2.4].forEach((z) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.018, 1.2), stripMat);
    strip.position.set(0, H - 0.05, z);   // below the frame's face, or the dark frame hides the emissive strip
    group.add(strip);
    group.add(b(0.46, 0.03, 1.32, m.dark, 0, H - 0.03, z, 0.005));
    group.add(b(0.02, 0.012, 1.2, m.metal, 0, H - 0.014, z, 0));
  });
  const warm = [];
  [-2.4, 0, 2.4].forEach((z) => {
    const light = new THREE.PointLight(0xffd0a0, 8, 8, 2);
    light.position.set(0, H - 0.3, z);
    warm.push(light);
    group.add(light);
  });
  const alarmLight = new THREE.PointLight(0xff2a1f, 0, 7, 2);
  alarmLight.position.set(0, H - 0.4, 0);
  group.add(alarmLight);

  // ---- Windows (five): 2 small trapezoids forward, 2 round on the side walls, 1 round in the side hatch ----
  WINDOWS.forEach(({ wall, ...w }) => addWindow(group, m, D, w));
  // Docking tunnel in the ceiling over the couches: dark collar ring, recessed hatch, latches and a ratchet handle.
  {
    const tz = -3.55, ty = H;
    group.add(place(slab(circlePts(0.47, 36), circlePts(0.4, 36), 0.1, m.dark), Math.PI / 2).translateX(0).translateY(0));
    group.children[group.children.length - 1].position.set(0, ty, tz);
    group.add(place(torus(0.405, 0.016, m.metal, 0, ty - 0.1, tz), Math.PI / 2));
    group.add(cyl(0.385, 0.05, m.paint, 0, ty - 0.055, tz, 'y', 36), place(torus(0.37, 0.012, m.dark, 0, ty - 0.082, tz), Math.PI / 2));
    group.add(cyl(0.07, 0.03, m.paintGrey, 0, ty - 0.09, tz, 'y', 20), cyl(0.035, 0.03, m.metal, 0, ty - 0.11, tz, 'y', 12));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      group.add(place(b(0.09, 0.025, 0.04, m.metal, Math.cos(a) * 0.3, ty - 0.088, tz + Math.sin(a) * 0.3, 0.006), 0, -a, 0));
    }
    group.add(rod([0.035, ty - 0.11, tz], [0.24, ty - 0.115, tz + 0.1], 0.011, m.metal, 8), cyl(0.016, 0.07, m.rubber, 0.26, ty - 0.116, tz + 0.105, 'z', 8));
    group.add(place(b(0.09, 0.02, 0.1, m.paintGrey, 0, ty - 0.085, tz - 0.2, 0.004)));
  }
  // Side hatch on the right wall behind the bike: ring frame, hinged door with a deep-set round window, six latches, ratchet handle.
  {
    const sh = new THREE.Group(), hy = 1.42;
    sh.position.set(hw, 0, -3.62);
    sh.rotation.y = -Math.PI / 2;
    group.add(sh);
    { const ring = slab(circlePts(0.4, 36), circlePts(0.13, 36), 0.05, m.rib); ring.position.set(0, hy, 0); sh.add(ring, place(torus(0.375, 0.016, m.dark, 0, hy, 0.062))); }
    const door = slab(circlePts(0.35, 36), grow(circlePts(0.115), 0.045), 0.065, m.paint);
    door.position.set(0, hy, 0.045);
    sh.add(door, place(torus(0.35, 0.01, m.paintGrey, 0, hy, 0.11)));
    addWindow(sh, m, D, { x: 0, y: hy, z: 0.045, size: 0.23 });
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.5;
      sh.add(place(b(0.1, 0.04, 0.03, m.metal, Math.cos(a) * 0.29, hy + Math.sin(a) * 0.29, 0.125, 0.008), 0, 0, a));
    }
    sh.add(cyl(0.04, 0.05, m.metal, 0, hy - 0.2, 0.135, 'z', 14), cyl(0.05, 0.015, m.dark, 0, hy - 0.2, 0.108, 'z', 14));
    sh.add(rod([0, hy - 0.2, 0.15], [0.2, hy - 0.26, 0.15], 0.011, m.metal, 8), cyl(0.017, 0.09, m.rubber, 0.22, hy - 0.265, 0.15, 'y', 8), b(0.05, 0.03, 0.02, m.dark, 0, hy - 0.2, 0.16, 0.004));
    [-0.12, 0.12].forEach((dy) => sh.add(b(0.05, 0.1, 0.05, m.dark, -0.4, hy + dy * 1.5, 0.06, 0.01)));
  }
  // Velcro strips (25 x 75 mm) in rows on the closeouts, webbing loops, and clamps on the cable bundles.
  {
    const sideRow = (sx, y) => { for (let z = -3.7; z <= 3.7; z += 0.2) group.add(new THREE.Mesh(quad([[sx, y, z - 0.0375], [sx, y, z + 0.0375], [sx, y + 0.025, z + 0.0375], [sx, y + 0.025, z - 0.0375]], [[0, 0], [1, 0], [1, 1], [0, 1]]), m.velcro)); };
    [0.3, 1.98].forEach((y) => { sideRow(-hw + 0.011, y); sideRow(hw - 0.011, y); });
    for (let x = -1.8; x <= 1.81; x += 0.2) {
      for (const y of [2.04]) {
        group.add(new THREE.Mesh(quad([[x - 0.0375, y, -hl + 0.004], [x + 0.0375, y, -hl + 0.004], [x + 0.0375, y + 0.025, -hl + 0.004], [x - 0.0375, y + 0.025, -hl + 0.004]], [[0, 0], [1, 0], [1, 1], [0, 1]]), m.velcro));
      }
    }
    [-1, 1].forEach((sd) => {
      for (let z = -3.4; z <= 3.4; z += 0.85) group.add(place(b(0.16, 0.05, 0.045, m.paintGrey, sd * 1.72, 2.43, z, 0), 0, 0, sd * -Math.PI / 4 * 0.9));
    });
  }
  // Mission patch, note board, first aid, extinguisher.
  {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), D.patch);
    patch.position.set(-1.35, 1.78, hl - 0.004);
    patch.rotation.y = Math.PI;
    group.add(patch);
    const notes = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), D.notes);
    notes.position.set(-1.2, 1.0, -hl + 0.04);
    group.add(notes, b(0.54, 0.54, 0.04, m.wood, -1.2, 1.0, -hl + 0.02, 0.01));
    // First aid kit and extinguisher on the rear wall, right of the hatch.
    group.add(b(0.34, 0.26, 0.1, m.paint, 1.35, 1.35, hl - 0.05, 0.02), b(0.16, 0.05, 0.012, m.red, 1.35, 1.35, hl - 0.106, 0), b(0.05, 0.16, 0.012, m.red, 1.35, 1.35, hl - 0.106, 0), b(0.05, 0.02, 0.03, m.metal, 1.35, 1.49, hl - 0.11, 0));
    group.add(cyl(0.065, 0.42, m.red, 1.32, 0.78, hl - 0.1, 'y', 16), cyl(0.03, 0.06, m.metal, 1.32, 1.02, hl - 0.1), b(0.1, 0.03, 0.03, m.dark, 1.32, 1.07, hl - 0.1, 0));
    group.add(rod([1.32, 1.02, hl - 0.07], [1.4, 0.9, hl - 0.04], 0.008, m.dark), torus(0.05, 0.008, m.metal, 1.32, 0.88, hl - 0.04));
    group.add(b(0.14, 0.03, 0.04, m.dark, 1.32, 0.9, hl - 0.045, 0), b(0.14, 0.03, 0.04, m.dark, 1.32, 0.65, hl - 0.045, 0));
    label(group, m, 0.2, 0.05, 22, 1.35, 1.12, hl - 0.002);
    group.children[group.children.length - 1].rotation.y = Math.PI;
  }

  // ---- Stations and props ----
  const stations = {}, props = {};
  const blinkers = [];
  const addAt = (registry, id, x, z, rotY, build) => {
    const anchor = new THREE.Group();
    anchor.name = `${registry === stations ? 'station' : registry === props ? 'prop' : 'deco'}:${id}`;
    anchor.position.set(x, 0, z);
    anchor.rotation.y = rotY;
    build(anchor);
    group.add(anchor);
    if (registry) registry[id] = new THREE.Vector3(x, 1.2, z);
    return anchor;
  };
  const left = Math.PI / 2, right = -Math.PI / 2;
  const dynamicLamp = (s, color, power, x, y, z) => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.012), glow(color, power));
    lamp.position.set(x, y, z);
    lamp.userData.dynamic = true;
    blinkers.push(lamp);
    s.add(lamp);
  };

  // PILOT SEAT station = the flight-deck bulkhead hatch. The anchor sits at (0, -3.3) with no rotation, so local z = world z + 3.3 and the
  // bulkhead wall is at local z = wz. The round plug door (hinge on +X, vertical axis) opens into the cabin: cabin.userData.openBulkheadHatch(t).
  let bulkheadDoor = null;
  addAt(stations, 'pilotSeat', 0, -3.3, 0, (s) => {
    const wz = -hl + 3.3, hy = BH.y, hx = BH.x;
    const ring = slab(circlePts(0.5, 40), circlePts(BH.r, 40), 0.05, m.rib);        // thick frame ring standing 50 mm off the wall
    ring.position.set(hx, hy, wz);
    const border = slab(circlePts(0.56, 40), circlePts(0.5, 40), 0.006, m.paintLine);   // painted yellow border on the wall
    border.position.set(hx, hy, wz + 0.001);
    s.add(ring, border, place(torus(0.5, 0.012, m.metal, hx, hy, wz + 0.052)));
    for (let i = 0; i < 16; i++) {
      const a = (i + 0.5) / 16 * Math.PI * 2;
      s.add(cyl(0.013, 0.012, m.metal, hx + Math.cos(a) * 0.44, hy + Math.sin(a) * 0.44, wz + 0.056, 'z', 8));
    }
    // hinge knuckles on +X, a stop pad on -X, a threshold step under the sill, a status lamp above
    [-0.22, 0.22].forEach((dy) => { s.add(b(0.07, 0.12, 0.07, m.metal, hx + 0.5, hy + dy, wz + 0.04, 0.01), cyl(0.014, 0.2, m.dark, hx + 0.46, hy + dy, wz + 0.07, 'y', 8)); });
    s.add(b(0.08, 0.08, 0.05, m.metal, hx - 0.5, hy + 0.1, wz + 0.04, 0.008));
    s.add(b(1.0, 0.04, 0.34, m.paintGrey, hx, 0.3, wz + 0.17, 0.008), b(0.04, 0.3, 0.3, m.dark, hx - 0.45, 0.15, wz + 0.17, 0.004), b(0.04, 0.3, 0.3, m.dark, hx + 0.45, 0.15, wz + 0.17, 0.004));
    s.add(b(0.07, 0.04, 0.02, lit('#34d399', 2), hx - 0.2, hy + 0.66, wz + 0.012, 0), b(0.07, 0.04, 0.02, lit('#f87171', 1.4), hx + 0.2, hy + 0.66, wz + 0.012, 0));
    // stencil FLIGHT DECK above the hatch (its own plane: the panel texture caps letters at 40 mm)
    const sc = makeCanvas(1024, 128), sx = sc.getContext('2d');
    stencil(sx, 'FLIGHT DECK', 512, 64, 92, 'rgba(60,54,44,0.9)');
    const sm = pbr(0xffffff, 0.8, 0, { map: canvasTexture(sc), transparent: true, depthWrite: false });
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.1375), sm);
    sp.position.set(hx, 1.8, wz + 0.002);
    s.add(sp);
    // the door: its own group, pivot at the hinge, local -x across the leaf; its meshes stay unmerged (dynamic)
    const door = new THREE.Group();
    door.name = 'bulkheadHatchDoor';
    const hd = 0.44;                           // hinge to hatch centre
    door.position.set(hx + hd, hy, wz);
    const leaf = new THREE.Group();            // the leaf, centred on the hatch when closed
    leaf.position.x = -hd;
    door.add(leaf);
    leaf.add(cyl(0.365, 0.05, m.paint, 0, 0, 0.025, 'z', 40));
    leaf.add(cyl(0.405, 0.016, m.paintGrey, 0, 0, 0.058, 'z', 40));
    leaf.add(place(torus(0.34, 0.012, m.metal, 0, 0, 0.068)));
    leaf.add(cyl(0.065, 0.04, m.metal, 0, 0, 0.08, 'z', 20), b(0.34, 0.03, 0.03, m.metal, 0, 0, 0.1, 0.01), b(0.03, 0.34, 0.03, m.metal, 0, 0, 0.1, 0.01));
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + 0.26, px = Math.cos(a) * 0.37, py = Math.sin(a) * 0.37;
      leaf.add(place(b(0.075, 0.03, 0.026, m.metal, px, py, 0.074, 0.006), 0, 0, a));
    }
    leaf.add(cyl(0.03, 0.04, m.metal, 0.22, 0.2, 0.08, 'z', 14), cyl(0.016, 0.03, m.red, 0.22, 0.2, 0.11, 'z', 10));
    leaf.add(b(0.14, 0.02, 0.01, m.dark, 0, -0.2, 0.068, 0), b(0.2, 0.012, 0.01, m.dark, 0, 0.2, 0.068, 0));
    door.traverse((o) => { if (o.isMesh) o.userData.dynamic = true; });
    // collapse the leaf to one mesh per material (about 12 draw calls fewer than the loose parts)
    leaf.updateMatrixWorld(true);
    const byMat = new Map();
    leaf.children.slice().forEach((o) => {
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      o.updateMatrix();
      g.applyMatrix4(o.matrix);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      o.removeFromParent();
    });
    for (const [mat, gs] of byMat) { const mm = new THREE.Mesh(gs.length === 1 ? gs[0] : mergeGeometries(gs), mat); mm.userData.dynamic = true; leaf.add(mm); }
    s.add(door);
    bulkheadDoor = door;
  });

  // O2 STATION: refill panel with gauges, manifold, hoses and bottles.
  addAt(stations, 'o2Station', -1.72, -1.1, left, (s) => {
    s.add(b(0.9, 0.2, 0.55, m.dark, 0, 0.1, 0.0, 0.02));
    s.add(b(0.92, 1.9, 0.04, m.paint, 0, 0.98, -0.26, 0.01));
    s.add(b(0.92, 0.06, 0.1, m.paintGrey, 0, 1.94, -0.22, 0.01));
    // Bottle rack: shelves, three bottles (shoulder, valve, guard ring) and straps.
    [0.2, 0.7].forEach((y) => s.add(b(0.84, 0.03, 0.32, m.rib, 0, y, -0.08, 0.005)));
    [-1, 0, 1].forEach((i) => {
      const x = i * 0.26;
      s.add(cyl(0.085, 0.82, m.green, x, 0.64, -0.08, 'y', 24));
      s.add(sphere(0.085, m.green, x, 1.05, -0.08, 1, 0.6, 1));
      s.add(cyl(0.03, 0.08, m.brass, x, 1.14, -0.08, 'y', 10), torus(0.05, 0.008, m.metal, x, 1.2, -0.08), cyl(0.017, 0.05, m.red, x, 1.18, -0.08, 'z', 8));
      s.add(cyl(0.088, 0.03, m.metal, x, 0.9, -0.08, 'y', 16), b(0.2, 0.1, 0.012, m.webbing, x, 0.72, 0.02, 0.003));
      s.add(b(0.04, 0.14, 0.02, lit(i === 1 ? '#fbbf24' : '#34d399', 2.2), x, 0.45, 0.095, 0));
      label(s, m, 0.16, 0.04, 10, x, 0.6, 0.0 + 0.012 + 0.0);
      s.children[s.children.length - 1].position.z = 0.012;
    });
    // Manifold: horizontal pipe with valves and dials, hoses with quick disconnects.
    s.add(cyl(0.022, 0.8, m.metal, 0, 1.32, -0.2, 'x', 12));
    [-0.3, 0, 0.3].forEach((x) => {
      s.add(cyl(0.017, 0.12, m.metal, x, 1.24, -0.2, 'y', 8), torus(0.035, 0.008, m.red, x, 1.16, -0.2));
      s.add(cyl(0.055, 0.02, m.dark, x, 1.42, -0.2, 'z', 20));
    });
    [-0.2, 0.2].forEach((x, i) => {
      const g = screen(0.1, 0.1, (c, w, h) => { c.clearRect(0, 0, w, h); drawGaugeDial(c, w, h, i ? 'PSI' : 'O2', i ? 0.7 : 0.92, i ? AMBER_ : GREEN_); }, 1.3, 128);
      g.position.set(x, 1.42, -0.188);
      s.add(g);
    });
    s.add(tube([[0.3, 1.2, -0.18], [0.36, 1.0, 0.06], [0.34, 0.6, 0.2], [0.38, 0.28, 0.16]], 0.017, m.hose, 28));
    s.add(tube([[-0.3, 1.2, -0.18], [-0.38, 1.05, 0.1], [-0.36, 0.5, 0.22]], 0.015, m.paintGrey, 24), cyl(0.03, 0.07, m.metal, -0.36, 0.45, 0.22), cyl(0.035, 0.07, m.dark, 0.38, 0.24, 0.16));
    // Gauge panel with a screen and warning stencils.
    const gauge = screen(0.3, 0.18, (c, w, h) => drawGaugeDial(c, w, h, 'O2 TANK', 0.92), 1.3, 256);
    gauge.position.set(0, 1.7, -0.235);
    s.add(gauge, b(0.34, 0.22, 0.02, m.dark, 0, 1.7, -0.244, 0.008));
    s.add(b(0.62, 0.02, 0.012, lit('#34d399', 2.3), 0, 1.86, -0.236, 0));
    label(s, m, 0.34, 0.07, 10, 0, 1.54, -0.236);
    s.add(b(0.14, 0.14, 0.01, lit('#fbbf24', 1.6), 0.32, 1.7, -0.238, 0.004), b(0.014, 0.07, 0.012, m.dark, 0.32, 1.7, -0.232, 0), b(0.014, 0.014, 0.012, m.dark, 0.32, 1.65, -0.232, 0));
  });

  // SUIT LOCKER: an EVA suit on a hanger, helmet and gloves on a shelf.
  addAt(stations, 'suitLocker', -1.7, 0.7, left, (s) => {
    s.add(b(0.86, 1.95, 0.012, lit('#ff8a1f', 1.7), 0, 1.07, -0.205, 0));
    s.add(b(1, 2.1, 0.06, m.cabinet, 0, 1.05, -0.245));
    [-1, 1].forEach((x) => s.add(b(0.07, 2.1, 0.55, m.cabinet, x * 0.465, 1.05, 0)));
    s.add(b(1, 0.06, 0.55, m.cabinet, 0, 2.07, 0), b(1, 0.12, 0.55, m.dark, 0, 0.06, 0));
    s.add(b(0.8, 0.02, 0.12, lit('#ffb347', 1.8), 0, 2.03, 0.16));
    // Helmet shelf with the helmet (gold visor), gloves and a small tool pouch.
    s.add(b(0.84, 0.03, 0.4, m.paintGrey, 0, 1.76, -0.02, 0.005));
    s.add(sphere(0.15, m.suit, -0.2, 1.93, -0.02), sphere(0.12, m.gold, -0.2, 1.93, 0.07, 1, 0.78, 0.6), cyl(0.12, 0.03, m.metal, -0.2, 1.8, -0.02, 'y', 18));
    s.add(b(0.13, 0.04, 0.2, m.suit, 0.12, 1.79, 0.0, 0.015), b(0.13, 0.04, 0.2, m.suit, 0.3, 1.79, 0.0, 0.015), b(0.17, 0.06, 0.12, m.bagOlive, 0.24, 1.82, -0.1, 0.02));
    // Suit hung by its backpack: hard torso, neck ring, arms, legs, boots, chest controls.
    s.add(b(0.36, 0.5, 0.18, m.suit, 0, 1.38, -0.04, 0.07), b(0.32, 0.44, 0.12, m.paintGrey, 0, 1.4, -0.17, 0.04));
    s.add(cyl(0.085, 0.05, m.metal, 0, 1.66, -0.04), b(0.3, 0.14, 0.2, m.suit, 0, 1.1, -0.04, 0.06));
    s.add(b(0.14, 0.08, 0.012, m.dark, 0, 1.46, 0.062, 0.006), b(0.04, 0.03, 0.012, lit('#34d399', 2), -0.03, 1.46, 0.07, 0), b(0.04, 0.03, 0.012, lit('#f87171', 2), 0.03, 1.46, 0.07, 0));
    s.add(cyl(0.02, 0.05, m.brass, -0.1, 1.3, 0.07, 'z', 10), cyl(0.02, 0.05, m.brass, 0.1, 1.3, 0.07, 'z', 10));
    [-1, 1].forEach((x) => {
      s.add(b(0.13, 0.7, 0.14, m.suit, x * 0.08, 0.68, -0.04, 0.05), b(0.15, 0.1, 0.22, m.dark, x * 0.08, 0.28, 0.0, 0.03));
      s.add(b(0.14, 0.03, 0.14, m.orange, x * 0.08, 0.5, -0.04, 0.01));
      s.add(rod([x * 0.2, 1.54, -0.04], [x * 0.27, 1.06, -0.02], 0.055, m.suit), cyl(0.06, 0.04, m.metal, x * 0.25, 1.22, -0.03, 'y', 12));
      s.add(sphere(0.06, m.dark, x * 0.27, 1.02, -0.02));
    });
    s.add(b(0.02, 0.04, 0.02, m.metal, 0, 1.72, -0.04, 0), cyl(0.012, 0.1, m.metal, 0, 1.73, -0.2, 'z', 6));
    // Glass door with frame and handle, and a stencil.
    s.add(b(0.88, 1.92, 0.012, m.glass, 0, 1.06, 0.262));
    [[0, 2.03, 0.92, 0.04], [0, 0.1, 0.92, 0.04]].forEach(([x, y, w, h]) => s.add(b(w, h, 0.03, m.metal, x, y, 0.265)));
    [-1, 1].forEach((x) => s.add(b(0.04, 1.96, 0.03, m.metal, x * 0.45, 1.06, 0.265)));
    s.add(b(0.02, 0.22, 0.03, m.metal, 0.38, 1.05, 0.29));
    label(s, m, 0.3, 0.075, 1, 0, 2.12, 0.28);
  });

  // COMMS CONSOLE: desk with two screens, a status rack, headset and a keyboard.
  addAt(stations, 'commsConsole', 1.7, -1.3, right, (s) => {
    s.add(b(1.2, 0.05, 0.56, m.paintGrey, 0, 0.76, 0, 0.015));
    [-1, 1].forEach((x) => s.add(b(0.05, 0.74, 0.5, m.dark, x * 0.575, 0.37, 0)));
    s.add(b(1.1, 0.7, 0.03, m.dark, 0, 0.42, -0.25));
    [0.2, 0.5].forEach((y) => s.add(b(1.0, 0.18, 0.02, m.paint, 0, y - 0.03, -0.21, 0.004)));
    label(s, m, 0.26, 0.065, 12, 0.3, 0.48, -0.197);
    rackBlock(s, m, 0, 1.5, -0.26, 1.16, 0.6, 2, 0.12);
    // Two angled screens: spectrum and link status, plus a signal strength column.
    [[-0.3, 0.2, drawWave], [0.3, -0.2, drawLink]].forEach(([x, ry, draw]) => {
      const mesh = place(screen(0.46, 0.3, draw, 1.3), 0, ry, 0);
      mesh.position.set(x, 1.04, -0.02);
      s.add(mesh, place(b(0.5, 0.34, 0.04, m.dark, x, 1.04, -0.05, 0.012), 0, ry, 0), b(0.06, 0.2, 0.06, m.dark, x, 0.88, -0.1));
    });
    s.add(b(0.44, 0.02, 0.16, m.dark, 0, 0.787, 0.14, 0.004));
    const keys = place(screen(0.42, 0.14, drawKeys, 0.9), -Math.PI / 2, 0, 0);
    keys.position.set(0, 0.799, 0.14);
    s.add(keys);
    // Antenna readout: a small round dial and a band of knobs.
    [-0.4, -0.28].forEach((x) => s.add(cyl(0.025, 0.03, m.metal, x, 0.8, 0.18, 'y', 14), b(0.006, 0.012, 0.02, m.orange, x, 0.818, 0.18, 0)));
    for (let i = 0; i < 6; i++) s.add(b(0.03, 0.03, 0.012, lit(i % 2 ? '#34d399' : '#fbbf24', 2.2), -0.28 + i * 0.1, 1.15 - 0.14, -0.1, 0).clone());
    // Headset on a hook at the left of the desk, microphone on a gooseneck, mug and notes.
    s.add(b(0.02, 0.1, 0.03, m.metal, -0.5, 1.2, -0.22, 0), torus(0.07, 0.012, m.dark, -0.5, 1.13, -0.2), sphere(0.04, m.rubber, -0.57, 1.08, -0.2, 0.5, 1, 1), sphere(0.04, m.rubber, -0.43, 1.08, -0.2, 0.5, 1, 1));
    s.add(rod([-0.43, 1.08, -0.18], [-0.35, 0.99, -0.12], 0.006, m.dark));
    s.add(cyl(0.05, 0.02, m.metal, 0.46, 0.8, 0.18));
    s.add(tube([[0.46, 0.8, 0.18], [0.46, 0.92, 0.18], [0.4, 1.0, 0.14], [0.39, 1.03, 0.1]], 0.007, m.metal, 14), sphere(0.03, m.dark, 0.39, 1.04, 0.09, 1, 1.7, 1));
    s.add(cyl(0.035, 0.09, m.cream, -0.46, 0.835, 0.2, 'y', 16), b(0.012, 0.05, 0.03, m.cream, -0.5, 0.835, 0.2, 0));
    s.add(place(b(0.1, 0.1, 0.004, m.paintLine, 0.1, 1.28 - 0.1, -0.245, 0), 0, 0, 0.1));
    // Antenna feed on the wall above, with a cable trunk down to the rack.
    s.add(cyl(0.012, 0.5, m.metal, 0.5, 1.95, -0.22, 'y', 8), sphere(0.03, m.red, 0.5, 2.2, -0.22));
    cableBundle(s, [[-0.45, 1.8, -0.22], [-0.45, 1.3, -0.22], [-0.5, 0.9, -0.2]], [0x2b2d30, 0x55585c, 0x7a7466], 0.007);
  });

  // SAMPLE STORAGE: lower drawers, an upper glovebox with a rack of labelled tubes and containers.
  addAt(stations, 'sampleStorage', 1.72, 0.9, right, (s) => {
    s.add(b(1.1, 0.8, 0.52, m.cabinet, 0, 0.4, 0, 0.02));
    [0.15, 0.4, 0.65].forEach((y, i) => {
      s.add(b(1.02, 0.22, 0.02, m.paintGrey, 0, y, 0.265, 0.006), b(0.3, 0.025, 0.03, m.metal, 0, y + 0.04, 0.29, 0.006));
      s.add(b(0.03, 0.03, 0.012, lit('#a78bfa', 2.4), 0.46, y, 0.28, 0));
      label(s, m, 0.2, 0.05, 17 + i, -0.3, y - 0.02, 0.278);
    });
    // Glovebox: a glazed hood on the counter with two glove ports.
    s.add(b(1.1, 0.04, 0.54, m.metal, 0, 0.82, 0, 0.01));
    s.add(b(1.06, 0.62, 0.04, m.dark, 0, 1.15, -0.25, 0.006), b(1.1, 0.04, 0.5, m.paintGrey, 0, 1.49, -0.02, 0.01));
    [-1, 1].forEach((x) => s.add(b(0.04, 0.66, 0.5, m.paintGrey, x * 0.53, 1.15, -0.02, 0.01)));
    s.add(b(1.04, 0.62, 0.012, m.glass, 0, 1.15, 0.24));
    s.add(b(1.12, 0.04, 0.05, m.metal, 0, 0.85, 0.26, 0.006), b(1.12, 0.04, 0.05, m.metal, 0, 1.46, 0.26, 0.006));
    [-0.22, 0.22].forEach((x) => {
      s.add(cyl(0.085, 0.07, m.dark, x, 1.0, 0.27, 'z', 22), torus(0.085, 0.012, m.metal, x, 1.0, 0.31));
      s.add(tube([[x, 1.0, 0.24], [x, 0.98, 0.1], [x + (x > 0 ? -0.05 : 0.05), 0.95, 0.0]], 0.06, m.rubber, 10));
    });
    // Tube rack with labelled tubes, two canisters and a hand lens, all inside.
    s.add(b(0.9, 0.025, 0.16, m.dark, 0, 0.865, -0.04, 0.004), b(0.9, 0.03, 0.02, m.metal, 0, 0.95, -0.12, 0));
    ['#a855f7', '#c084fc', '#7c3aed', '#d8b4fe', '#9333ea', '#f59e0b', '#34d399'].forEach((color, i) => {
      const x = -0.36 + i * 0.12, fill = 0.05 + (i % 3) * 0.04;
      s.add(cyl(0.022, 0.2, m.glass, x, 0.97, -0.04, 'y', 12), cyl(0.016, fill, lit(color, 1.3), x, 0.875 + fill / 2, -0.04, 'y', 10), cyl(0.026, 0.025, m.dark, x, 1.08, -0.04, 'y', 12));
      s.add(b(0.03, 0.015, 0.005, m.cream, x, 0.99, -0.014, 0));
    });
    s.add(cyl(0.07, 0.14, m.paint, 0.4, 0.94, 0.08, 'y', 18), cyl(0.072, 0.03, m.orange, 0.4, 1.03, 0.08, 'y', 18), cyl(0.06, 0.12, m.paint, -0.4, 0.93, 0.1, 'y', 18), cyl(0.062, 0.03, m.blueGrey, -0.4, 1.0, 0.1, 'y', 18));
    s.add(b(1, 0.025, 0.025, lit('#c4b5fd', 2.2), 0, 1.45, -0.2, 0));
    // Sample log screen on the upper panel and a hazard-free biohazard-style stencil.
    const log = screen(0.34, 0.2, drawSampleLog, 1.3, 256);
    log.position.set(0.3, 1.78, -0.24);
    s.add(log, b(0.38, 0.24, 0.02, m.dark, 0.3, 1.78, -0.25, 0.008));
    s.add(b(1.1, 0.5, 0.02, m.paint, 0, 1.78, -0.26, 0.004));
    label(s, m, 0.3, 0.075, 0, -0.3, 1.78, -0.24);
    s.add(b(0.4, 0.26, 0.28, m.bagGrey, -0.3, 1.98 + 0.0, -0.1, 0.03).clone());
  });

  // AIRLOCK: a round hatch in a hazard-striped frame, with a big wheel, gauge and warning lights.
  addAt(stations, 'airlock', 0, 3.86, Math.PI, (s) => {
    const hatch = m.metal;
    [-1, 1].forEach((x) => s.add(b(0.18, 2.3, 0.25, m.rib, x * 0.59, 1.15, 0, 0.02)));
    s.add(b(1.36, 0.18, 0.25, m.rib, 0, 2.22, 0, 0.02), b(1.36, 0.06, 0.25, m.dark, 0, 0.03, 0, 0.01));
    // Hazard stripes around the frame.
    [-1, 1].forEach((x) => { const side = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 2.1), m.hazard); side.position.set(x * 0.7, 1.15, 0.131); s.add(side); });
    const topStripe = place(new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.08), m.hazard), 0, 0, 0);
    topStripe.position.set(0, 2.36 - 0.0, 0.131);
    s.add(topStripe);
    // Hatch door: thick disc, raised rim, latch dogs around the edge, hinge, window.
    s.add(cyl(0.53, 0.1, hatch, 0, 1.1, 0, 'z', 48), torus(0.5, 0.035, m.orange, 0, 1.1, 0.06), torus(0.34, 0.02, m.paintGrey, 0, 1.1, 0.055));
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      s.add(place(b(0.07, 0.05, 0.04, m.dark, Math.cos(a) * 0.46, 1.1 + Math.sin(a) * 0.46, 0.075, 0.008), 0, 0, a));
    }
    [0.75, 1.45].forEach((y) => s.add(b(0.06, 0.14, 0.07, m.dark, -0.5, y, 0.07, 0.01)));
    s.add(cyl(0.13, 0.05, m.dark, 0, 1.42, 0.07, 'z', 24), cyl(0.1, 0.02, m.glass, 0, 1.42, 0.105, 'z', 24), torus(0.12, 0.012, m.metal, 0, 1.42, 0.1));
    // Handwheel: hub, rim and spokes.
    s.add(cyl(0.05, 0.08, m.metal, 0, 0.93, 0.1, 'z', 16), torus(0.17, 0.02, m.orange, 0, 0.93, 0.12));
    [0, 1, 2, 3].forEach((i) => s.add(place(b(0.34, 0.022, 0.022, m.metal, 0, 0.93, 0.12, 0.005), 0, 0, i * Math.PI / 4)));
    // Pressure gauge, status lights and an emergency release lever.
    const dial = screen(0.1, 0.1, (c, w, h) => { c.clearRect(0, 0, w, h); drawGaugeDial(c, w, h, 'BAR', 1.0, GREEN_); }, 1.3, 128);
    dial.position.set(0.38, 1.72, 0.14);
    s.add(dial, torus(0.058, 0.01, m.metal, 0.38, 1.72, 0.138), cyl(0.06, 0.02, m.dark, 0.38, 1.72, 0.128, 'z', 20));
    s.add(b(0.04, 0.2, 0.04, m.red, -0.38, 0.78, 0.12, 0.01), b(0.08, 0.04, 0.05, m.dark, -0.38, 0.67, 0.12, 0.01));
    const sign = screen(0.5, 0.14, drawAirlockSign, 1.3, 384);
    sign.position.set(0, 1.9, 0.141);
    s.add(sign, b(0.54, 0.18, 0.02, m.dark, 0, 1.9, 0.13, 0.005));
    [['#fbbf24', -1], ['#f87171', 1]].forEach(([color, x]) => {
      dynamicLamp(s, color, 3, x * 0.59, 2.05, 0.15);
      s.add(b(0.1, 0.1, 0.04, m.dark, x * 0.59, 2.05, 0.13, 0.01));
      s.add(b(0.09, 0.09, 0.012, m.dark, x * 0.59, 1.8, 0.13, 0.004), b(0.02, 0.02, 0.012, lit(x < 0 ? '#34d399' : '#fbbf24', 2.2), x * 0.59, 1.8, 0.142, 0));
    });
    s.add(b(0.2, 0.05, 0.012, m.red, -0.38, 1.0, 0.0, 0).clone());
  });

  // BUNK: a sleeping berth with a sleeping bag, pillow, reading light, net pocket, shelf and curtain.
  addAt(stations, 'bunk', -1.55, -2.75, left, (s) => {
    s.add(b(1.96, 0.26, 0.88, m.dark, 0, 0.13, 0, 0.02));
    s.add(b(1.9, 0.12, 0.84, m.paintGrey, 0, 0.32, 0, 0.03));
    s.add(b(1.86, 0.09, 0.8, m.cream, 0, 0.42, 0, 0.04));
    s.add(place(b(0.44, 0.12, 0.34, m.webbing, 0.7, 0.53, 0.0, 0.05), 0, 0.08, 0));
    s.add(b(1.2, 0.14, 0.7, m.sleepBag, -0.2, 0.52, 0.02, 0.06));
    s.add(b(0.04, 0.012, 0.66, m.metal, -0.2, 0.595, 0.02, 0), b(0.24, 0.06, 0.2, m.sleepBag, 0.41, 0.52, 0.03, 0.03));
    for (let i = 0; i < 6; i++) s.add(b(0.04, 0.01, 0.01, m.metal, -0.2, 0.598, -0.29 + i * 0.11, 0));
    s.add(place(b(0.7, 0.07, 0.8, m.blanket, -0.5, 0.57, 0.0, 0.03), 0, 0, 0.03));
    s.add(b(0.04, 0.05, 0.86, m.strap, -0.1, 0.62, 0, 0.01));
    // Canopy, reading light, net pocket and a bar for the curtain.
    s.add(b(1.96, 0.08, 0.88, m.dark, 0, 2.0, 0, 0.02), b(0.2, 0.02, 0.1, lit('#ffd9a0', 2), 0.55, 1.95, 0.2, 0));
    s.add(place(b(0.24, 0.04, 0.12, m.metal, 0.55, 1.97, 0.19), 0.2), cyl(0.012, 1.9, m.metal, 0, 1.95, 0.44, 'x', 10));
    for (let i = 0; i < 6; i++) s.add(b(0.01, 0.2, 0.01, m.rubber, 0.2 + i * 0.07, 1.02, -0.4, 0), b(0.5, 0.01, 0.01, m.rubber, 0.45, 0.92 + i * 0.04, -0.4, 0));
    s.add(b(0.52, 0.27, 0.06, m.bagOlive, 0.45, 0.98, -0.4, 0.02).clone());
    const folds = new THREE.PlaneGeometry(1, 1.5, 28, 1);
    const pos = folds.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 36) * 0.035);
    folds.computeVertexNormals();
    const curtain = new THREE.Mesh(folds, m.curtain);
    curtain.position.set(-0.43, 1.2, 0.44);
    s.add(curtain);
    // Shelf with the family photo, a book and a water bottle.
    s.add(b(0.5, 0.035, 0.2, m.wood, 0.6, 1.15, -0.33));
    const frame = place(b(0.2, 0.26, 0.02, m.wood, 0.6, 1.29, -0.33, 0.01), -0.12);
    const photo = place(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.21), D.photo), -0.12);
    photo.position.set(0.6, 1.29, -0.318);
    s.add(frame, photo);
    s.add(b(0.1, 0.03, 0.14, m.red, 0.82, 1.185, -0.32, 0.005), cyl(0.025, 0.12, m.anodBlue, 0.39, 1.22, -0.33, 'y', 12));
    s.add(b(0.06, 0.1, 0.01, m.paintLine, 0.5, 1.7, -0.4, 0).clone());
  });

  // PROPS Role 2 opens Guidebook entries for.
  addAt(props, 'foodRack', 1.72, 2.3, right, (s) => {
    s.add(b(1, 1.95, 0.02, m.paint, 0, 0.98, -0.25, 0.004));
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => s.add(b(0.04, 1.9, 0.04, m.rib, x * 0.48, 0.95, z * 0.22)));
    const rnd = seeded(5);
    const foils = [m.foilA, m.foilB, m.foilC];
    [0.3, 0.7, 1.1].forEach((y) => {
      s.add(b(1, 0.025, 0.5, m.rib, 0, y, 0, 0.004), b(1, 0.04, 0.02, m.orange, 0, y + 0.02, 0.255, 0.004));
      for (let i = 0; i < 6; i++) {
        const x = -0.4 + i * 0.16, tilt = (rnd() - 0.5) * 0.12, cell = Math.floor(rnd() * 6);
        const pouch = place(b(0.13, 0.2, 0.06, foils[Math.floor(rnd() * 3)], x, y + 0.115, 0.05, 0.015), 0, 0, tilt);
        const tag = new THREE.PlaneGeometry(0.115, 0.115);
        const uv = tag.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, ((cell % 3) + uv.getX(k)) / 3, 1 - (Math.floor(cell / 3) + 1 - uv.getY(k)) / 2);
        const t = place(new THREE.Mesh(tag, m.pouches), 0, 0, tilt);
        t.position.set(x, y + 0.115, 0.082);
        s.add(pouch, t, b(0.06, 0.012, 0.018, m.velcro, x, y + 0.225, 0.07, 0));
      }
    });
    // Galley module on the top shelf: rehydration station with nozzle, a warmer with a display, utensils.
    s.add(b(1, 0.025, 0.5, m.rib, 0, 1.5, 0, 0.004), b(0.4, 0.28, 0.4, m.paintGrey, -0.28, 1.65, 0.0, 0.02), b(0.34, 0.1, 0.012, m.dark, -0.28, 1.66, 0.206, 0.004));
    const disp = screen(0.3, 0.08, (c, w, h) => { c.font = `700 ${h * 0.55}px ${MONO}`; c.fillStyle = AMBER_; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('WARM 65C', w / 2, h / 2); }, 1.2, 192);
    disp.position.set(-0.28, 1.66, 0.213);
    s.add(disp);
    s.add(cyl(0.02, 0.1, m.metal, 0.2, 1.62, 0.1), place(b(0.07, 0.03, 0.12, m.dark, 0.2, 1.7, 0.1, 0.01)), tube([[0.2, 1.7, 0.1], [0.3, 1.6, 0.1], [0.4, 1.4, -0.1]], 0.012, m.hose, 12));
    s.add(b(0.18, 0.12, 0.2, m.orange, 0.38, 1.57, 0.12, 0.02), b(0.2, 0.01, 0.06, m.metal, -0.28, 1.54, 0.26, 0));
    label(s, m, 0.2, 0.05, 13, 0.0, 0.18, 0.258);
    label(s, m, 0.2, 0.05, 14, 0.0, 0.58, 0.258);
    s.add(b(0.96, 0.18, 0.02, m.dark, 0, 1.88, -0.23, 0), b(0.1, 0.02, 0.02, lit('#34d399', 2), 0.4, 1.88, -0.21, 0));
  });

  addAt(props, 'waterRecycler', -1.72, 2.2, left, (s) => {
    // Lower unit: tank, filters, pump, pipework and a status display.
    s.add(b(0.96, 0.9, 0.52, m.cabinet, 0, 0.45, 0, 0.03));
    s.add(cyl(0.2, 0.62, m.glass, -0.22, 0.6, 0.02, 'y', 22), cyl(0.18, 0.44, lit('#3aa0ff', 0.7), -0.22, 0.52, 0.02, 'y', 22));
    s.add(cyl(0.21, 0.04, m.dark, -0.22, 0.92, 0.02, 'y', 22), cyl(0.21, 0.04, m.dark, -0.22, 0.28, 0.02, 'y', 22));
    s.add(cyl(0.05, 0.4, m.paint, 0.22, 0.52, 0.28, 'y', 16), cyl(0.05, 0.4, m.paint, 0.34, 0.52, 0.28, 'y', 16), cyl(0.052, 0.04, m.blueGrey, 0.22, 0.74, 0.28, 'y', 16), cyl(0.052, 0.04, m.blueGrey, 0.34, 0.74, 0.28, 'y', 16));
    const display = screen(0.3, 0.2, drawWater, 1.3, 256);
    display.position.set(0.17, 0.2, 0.266);
    s.add(display, b(0.34, 0.24, 0.02, m.dark, 0.17, 0.2, 0.258, 0.01));
    s.add(tube([[-0.38, 0.9, 0.2], [-0.4, 0.6, 0.3], [-0.38, 0.2, 0.3], [0.0, 0.1, 0.3]], 0.022, m.copper, 24), torus(0.05, 0.012, m.orange, 0.0, 0.12, 0.3), sphere(0.035, m.copper, -0.38, 0.18, 0.3));
    label(s, m, 0.2, 0.05, 7, -0.2, 0.06, 0.266);
    // Growth chamber on top: a lit cabinet with three trays of plants, sealed with a glass door.
    s.add(b(0.96, 0.9, 0.5, m.paint, 0, 1.49, -0.01, 0.02), b(0.84, 0.74, 0.04, m.dark, 0, 1.49, 0.235, 0.01));
    s.add(b(0.84, 0.74, 0.01, m.glass, 0, 1.49, 0.262));
    s.add(b(0.78, 0.03, 0.02, lit('#ff4fd8', 1.0), 0, 1.85, 0.205, 0), b(0.78, 0.03, 0.02, lit('#8b5cf6', 0.9), 0, 1.6, 0.205, 0));
    [1.3, 1.55].forEach((y) => s.add(b(0.78, 0.02, 0.36, m.rib, 0, y, 0.02, 0.004), b(0.7, 0.03, 0.26, m.soil, 0, y + 0.025, 0.02, 0.01)));
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
      const x = -0.28 + i * 0.19, y = 1.35 + r * 0.25;
      for (let k = 0; k < 3; k++) s.add(place(sphere(0.045, m.leaf, x + (k - 1) * 0.03, y + 0.07 + (k % 2) * 0.03, 0.02 + (k - 1) * 0.04, 0.55, 1.4, 0.35), 0, 0, (k - 1) * 0.5));
    }
    const read = screen(0.2, 0.06, (c, w, h) => { c.font = `700 ${h * 0.5}px ${MONO}`; c.fillStyle = GREEN_; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('GROW  DAY 12', w / 2, h / 2); }, 1.2, 192);
    read.position.set(0.0, 1.97, 0.235);
    s.add(read, b(0.24, 0.1, 0.02, m.dark, 0, 1.97, 0.225, 0.005));
    label(s, m, 0.24, 0.06, 28, 0.0, 1.0, 0.264);
  });

  addAt(props, 'exerciseBike', 1.45, -3.1, Math.PI, (s) => {
    s.add(b(0.62, 0.03, 0.9, m.dark, 0, 0.015, 0, 0.01));
    [-0.4, 0.4].forEach((z) => s.add(b(0.58, 0.04, 0.08, m.rubber, 0, 0.05, z, 0.02)));
    s.add(rod([0, 0.1, -0.4], [0, 0.12, 0.4], 0.032, m.orange, 10));
    s.add(rod([0, 0.1, -0.36], [0, 0.78, -0.3], 0.026, m.metal), rod([0, 0.1, 0.36], [0, 1.0, 0.3], 0.026, m.metal));
    s.add(b(0.24, 0.06, 0.3, m.seat, 0, 0.83, -0.3, 0.03), place(b(0.04, 0.12, 0.04, m.dark, 0, 0.79, -0.3)));
    s.add(rod([-0.24, 1.02, 0.3], [0.24, 1.02, 0.3], 0.02, m.dark), sphere(0.03, m.rubber, -0.25, 1.02, 0.3), sphere(0.03, m.rubber, 0.25, 1.02, 0.3));
    s.add(cyl(0.23, 0.07, m.paintGrey, 0, 0.34, 0.26, 'x', 32), cyl(0.16, 0.08, m.orange, 0, 0.34, 0.26, 'x', 24), cyl(0.04, 0.09, m.metal, 0, 0.34, 0.26, 'x', 10));
    s.add(cyl(0.032, 0.24, m.metal, 0, 0.3, 0, 'x', 10), rod([0.12, 0.3, 0], [0.12, 0.14, 0], 0.016, m.metal), rod([-0.12, 0.3, 0], [-0.12, 0.46, 0], 0.016, m.metal));
    s.add(b(0.12, 0.03, 0.08, m.rubber, 0.17, 0.14, 0, 0.01), b(0.12, 0.03, 0.08, m.rubber, -0.17, 0.46, 0, 0.01));
    s.add(b(0.14, 0.012, 0.03, m.strap, 0.17, 0.162, 0, 0), b(0.14, 0.012, 0.03, m.strap, -0.17, 0.482, 0, 0));
    s.add(tube([[0.1, 0.42, 0.26], [0.18, 0.62, 0.3], [0.1, 0.9, 0.3]], 0.008, m.rubber, 12), b(0.04, 0.04, 0.04, m.dark, 0.1, 0.42, 0.26, 0));
    const stats = place(screen(0.2, 0.12, drawBikeStats, 1.3, 256), 0, Math.PI, 0);
    stats.position.set(0, 1.09, 0.265);
    s.add(stats, b(0.23, 0.15, 0.02, m.dark, 0, 1.09, 0.285, 0.008));
    s.add(cyl(0.025, 0.14, m.anodBlue, 0.18, 1.08, 0.3, 'y', 12), cyl(0.02, 0.03, m.dark, 0.18, 1.17, 0.3, 'y', 12));
  });
  props.familyPhoto = group.getObjectByName('station:bunk').localToWorld(new THREE.Vector3(0.6, 1.2, -0.33));

  // ---- Wall racks between the stations (decorative: equipment racks, stowage lockers, grilles) ----
  const rackAnchor = (name, x, z, rotY, build) => addAt(null, name, x, z, rotY, build);
  // Left wall: avionics rack between the O2 station and the suit locker.
  rackAnchor('rackL', -1.72, -0.2, left, (s) => {
    s.add(b(0.8, 1.95, 0.02, m.dark, 0, 0.98, -0.26, 0));
    rackBlock(s, m, 0, 1.25, -0.25, 0.7, 1.5, 3, 0.12);
    s.add(b(0.76, 0.2, 0.48, m.dark, 0, 0.1, 0, 0.01));
    vent(s, m, 0.5, 0.14, 0, 0.2, 0.245);
    handrail(s, m, [-0.3, 1.98, 0.28], [0.3, 1.98, 0.28]);
    cableBundle(s, [[0.34, 0.1, -0.2], [0.36, 0.8, -0.22], [0.3, 2.0, -0.24]], [0x2b2d30, 0x55585c, 0x7a7466, 0x1e2022], 0.009);
  });
  // Left wall, rear: stowage lockers with cargo bags and nets, then a vent panel.
  rackAnchor('stowL', -1.72, 3.2, left, (s) => {
    s.add(b(1.0, 1.95, 0.02, m.paint, 0, 0.98, -0.26, 0), b(1.0, 0.16, 0.5, m.dark, 0, 0.08, 0, 0.01));
    bag(s, m, m.bagSand, 0.42, 0.34, 0.34, -0.24, 0.35, 0.0, 6);
    bag(s, m, m.bagGrey, 0.42, 0.34, 0.34, 0.24, 0.35, 0.0, 4, 0.02);
    bag(s, m, m.bagBlue, 0.42, 0.36, 0.34, -0.24, 0.73, 0.0, 3);
    bag(s, m, m.bagOlive, 0.42, 0.32, 0.34, 0.24, 0.73, 0.0, 5, -0.02);
    bag(s, m, m.bagGrey, 0.9, 0.3, 0.3, 0.0, 1.07, 0.02, 11);
    s.add(b(0.98, 0.02, 0.04, m.metal, 0, 1.26, 0.2, 0));
    rackBlock(s, m, 0, 1.68, -0.25, 0.9, 0.5, 9, 0.1);
    for (let i = 0; i < 5; i++) s.add(b(0.01, 1.0, 0.01, m.rubber, -0.45 + i * 0.225, 0.7, 0.215, 0));
    for (let i = 0; i < 4; i++) s.add(b(0.96, 0.01, 0.01, m.rubber, 0, 0.25 + i * 0.3, 0.215, 0));
  });
  // Right wall: GNC rack between the comms console and the sample cabinet, and a small deck/utility rack up front.
  rackAnchor('rackR', 1.72, -0.2, right, (s) => {
    s.add(b(0.8, 1.95, 0.02, m.dark, 0, 0.98, -0.26, 0));
    rackBlock(s, m, 0, 1.25, -0.25, 0.7, 1.5, 7, 0.12);
    s.add(b(0.76, 0.2, 0.48, m.dark, 0, 0.1, 0, 0.01));
    vent(s, m, 0.5, 0.14, 0, 0.2, 0.245);
    handrail(s, m, [-0.3, 1.98, 0.28], [0.3, 1.98, 0.28]);
    cableBundle(s, [[-0.34, 0.1, -0.2], [-0.36, 0.8, -0.22], [-0.3, 2.0, -0.24]], [0x55585c, 0x2b2d30, 0x7a7466], 0.009);
  });
  rackAnchor('rackR2', 1.72, -2.35, right, (s) => {
    s.add(b(0.9, 1.95, 0.02, m.dark, 0, 0.98, -0.26, 0));
    rackBlock(s, m, 0, 1.3, -0.25, 0.8, 1.2, 11, 0.12);
    s.add(b(0.84, 0.5, 0.48, m.dark, 0, 0.25, 0, 0.01));
    bag(s, m, m.bagBlue, 0.7, 0.2, 0.3, 0, 0.12, 0.05, 12);
    bag(s, m, m.bagSand, 0.7, 0.2, 0.3, 0, 0.37, 0.05, 15);
    vent(s, m, 0.6, 0.16, 0, 1.94, -0.24);
  });
  // Right wall, rear: stowage, between the food rack and the rear wall.
  rackAnchor('stowR', 1.72, 3.3, right, (s) => {
    s.add(b(0.8, 1.95, 0.02, m.paint, 0, 0.98, -0.26, 0), b(0.8, 0.16, 0.5, m.dark, 0, 0.08, 0, 0.01));
    bag(s, m, m.bagOlive, 0.7, 0.34, 0.34, 0, 0.35, 0.0, 8);
    bag(s, m, m.bagGrey, 0.7, 0.34, 0.34, 0, 0.73, 0.0, 9);
    bag(s, m, m.bagSand, 0.7, 0.34, 0.34, 0, 1.11, 0.0, 6);
    rackBlock(s, m, 0, 1.68, -0.25, 0.7, 0.5, 14, 0.1);
    for (let i = 0; i < 4; i++) s.add(b(0.01, 1.2, 0.01, m.rubber, -0.3 + i * 0.2, 0.7, 0.215, 0));
  });
  // Between the suit locker and the water recycler, and between the sample cabinet and the food rack: vent panels.
  rackAnchor('ventL', -1.72, 1.5, left, (s) => { vent(s, m, 0.4, 0.2, 0, 0.5, -0.25); label(s, m, 0.2, 0.05, 6, 0, 1.15, -0.245); });
  rackAnchor('ventR', 1.72, 1.65, right, (s) => { vent(s, m, 0.3, 0.2, 0, 0.5, -0.25); });

  // Eye positions for Role 2's egress (cabin-local, empty Object3Ds, +Y up; rotation.y = PI faces +Z, into the cabin). The old ladder names are kept:
  // ladderBottom = standing 0.8 m in front of the bulkhead in the aisle; ladderTopCabin = just inside the bulkhead hatch, coming out of it.
  group.updateMatrixWorld(true);
  const anchors = group.children.filter((o) => /^(station|prop|deco):/.test(o.name) && o.name !== 'station:pilotSeat').map((o) => ({ name: o.name, box: new THREE.Box3().setFromObject(o) }));
  const zg = addZeroGDressing(group, { m, bag, label, anchors, dims: { hw, hl, H, WALL_H, BH } });
  const ladderBottom = new THREE.Object3D();
  ladderBottom.name = 'ladderBottom';
  ladderBottom.position.set(BH.x, 1.65, -hl + 0.8);
  ladderBottom.rotation.y = Math.PI;
  const ladderTopCabin = new THREE.Object3D();
  ladderTopCabin.name = 'ladderTopCabin';
  ladderTopCabin.position.set(BH.x, BH.y + 0.3, -hl + 0.3);
  ladderTopCabin.rotation.y = Math.PI;
  group.add(ladderBottom, ladderTopCabin);

  const triangles = bake(group);

  // Fixed meshes are merged, so only the dimmable lights and blinking lamps stay live.
  let alarm = false;
  // Zero-g route (Role 2/4): the cabin can sit behind the Apollo cockpit's aft hatch. Attached, it adds no THREE.Light (shaders bake the light
  // count) and the windows show the live scene: cockpit.userData.attachCabin() calls these.
  const ownLights = [...warm, alarmLight];
  const windowViews = [];
  group.traverse((o) => { if (o.userData.windowView) windowViews.push(o); });
  group.userData.bulkheadHatch = { x: BH.x, y: BH.y, z: -hl, r: BH.r };   // cabin-local centre of the round hatch in the -Z bulkhead
  const openRange = 1.75;
  group.userData.openBulkheadHatch = (t = 1) => { const u = Math.min(1, Math.max(0, t)); if (bulkheadDoor) bulkheadDoor.rotation.y = openRange * u * u * (3 - 2 * u); return !!bulkheadDoor; };
  group.userData.openBulkheadHatch(0);
  group.userData.handrails = zg.handrails;           // [{ a, b }] cabin-local segment ends of every grab rail
  group.userData.floatColliders = zg.floatColliders; // [{ min, max }] cabin-local boxes: shell, bulkhead with the hatch opening, furniture
  group.userData.looseItems = zg.loose;
  group.userData.zeroG = (on = true) => zg.zeroG(on);  // loose items drift (true) or fall back to their places (false)
  group.userData.setLights = (on) => ownLights.forEach((l) => (on ? group.add(l) : l.removeFromParent()));
  group.userData.setWindowViews = (on) => windowViews.forEach((v) => { v.visible = on; });
  group.userData.ladderBottom = ladderBottom;
  group.userData.ladderTopCabin = ladderTopCabin;
  group.userData.stations = stations;
  group.userData.props = props;
  group.userData.triangles = triangles;
  group.userData.setAlarm = (on) => { alarm = on; };
  let lastFrame = performance.now();
  group.userData.onFrame = () => {
    const now = performance.now(), dtFrame = (now - lastFrame) / 1000;
    lastFrame = now;
    zg.update(dtFrame);
    const t = sharedUniforms.uTime.value;
    blinkers.forEach((lamp, i) => { lamp.visible = Math.sin(t * (1.1 + i * 0.43) + i * 2) > -0.35; });
    const pulse = 0.5 + 0.5 * Math.sign(Math.sin(t * 5));
    alarmLight.intensity = alarm ? 9 * pulse : 0;
    warm.forEach((light) => { light.intensity = alarm ? 1.8 : 8; });
    stripMat.color.setRGB(...(alarm ? [0.6 + 1.2 * pulse, 0.08, 0.06] : [2.2, 2.2 * 0.945, 2.2 * 0.863]));
  };
  return group;
}

const AMBER_ = '#fbbf24', GREEN_ = '#34d399';
