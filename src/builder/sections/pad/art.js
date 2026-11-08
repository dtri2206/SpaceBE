// 3D art for the launch pad under the vehicle in the design studio. Owned by whoever builds the pad section.
// padArt(state, { radius, height, layout, icon, only }) → { object: THREE.Object3D, top: metres } where `top` is the
// height the vehicle stands on. state = { site (the launch complex), slot: { tempC } (launch-day temperature, snow
// below 0 °C), equipment: [{ eq, option }] } (designPad.js builds it from effects.js padSetup); layout = the vehicle's
// layout entries (heights above the vehicle's base), used to fit the arms and clamps to the real hull. `icon` leaves out
// the ground and the far-off storage and weather gear (a card picture); `only` = an equipment key draws just that piece.
//
// Everything is procedural and modelled on real pads: LC-39A/B at Kennedy (flame trench, mobile launcher platform,
// fixed and rotating service structures, water tower and rainbirds, catenary lightning towers, slidewire escape
// baskets, cryogenic spheres), SpaceX's strongback, Saturn V hold-down arms, Starbase's raised launch mount and its
// tower with catch arms, the flame pit, support arms and swing-up gantry of the Soyuz pads, the mobile service towers
// of Kourou, Vostochny and Sriharikota. The pieces are merged into one mesh per material, so the studio draws the whole
// pad in about a dozen draw calls every frame.
//
// Sizes follow the ratio rules of src/builder/tools/blender/README.md ("Ground models"), with D = the ship's width:
// service tower top 1.10 × H above its deck (a complex may say look.towerH), catch tower mount top + 1.05 × H,
// strongback 1.02 × H, tower 1.3 D wide about 1 D off the hull, a mobile service tower 3 D square, the opening under
// the ship 1.2 D, a launch ring about 1.9 D, a mobile platform deck about 3 D, a flame trench 1.9 D wide.
//
// Blender models (wave 4): src/builder/tools/blender/pad/ builds the ground pieces (public/assets/models/builder/pad/,
// PAD_MODELS below; pieces.json there lists each one's anchor, nodes and budget), all for the reference ship
// (20 m × 2.5 m). padArt asks for the files the complex needs (bay/nasa.js loadGroundModel, each file once) and draws
// the code pieces meanwhile; when they arrive the pad redraws itself in place with the models, scaled along one axis
// family (towers and masts in height by the ratio rules, mounts across with D / 2.5, far-field gear to the size the
// code gives it) and posed (arms, chopsticks, doors) to fit the ship. A missing file keeps the code piece. Card
// pictures (`icon`) always use the code pieces. `opts.models` (id → loaded scene) may hand models in directly.
//
// Layout (in the pad's own frame, before it is turned): the service tower stands on +x. The pad is then turned so the
// tower sits behind and to the right of the vehicle as the studio first frames it, at 67.5°: between the 45° legs and
// the 90° fins, clear of the side boosters that shapes put at 0° and 180°. The tower and strongback also step back
// from any side part that reaches out towards them (from `layout`).
import * as THREE from 'three';
import { BASE_RADIUS, SIZE_SCALE } from '../../assembly.js';
import * as noseArt from '../nose/art.js'; // read-only: the real surface radius of a capsule (surfaceRadius)
import { loadGroundModel } from '../../bay/nasa.js';

const DEG = Math.PI / 180;
const FACING_DEG = 67.5; // where the tower ends up (radial-part angle convention: 0° = +x, 90° = -z)
const FACING = FACING_DEG * DEG;
// Shapes put fins at 0/90/180/270° (or 45°…), landing legs at 45/135/225/315° and side boosters at 0/180°: the gear at
// the ship's base goes in between, at 22.5° + k·45° (world angles, turned into the pad's frame here).
const wa = (worldDeg) => worldDeg - FACING_DEG;

const mat = (color, roughness = 0.7, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const M = {
  concrete: mat(0xa7a8a4, 0.95, 0.02),
  concreteOld: mat(0x7d7c76, 0.95, 0.02),
  scorch: mat(0x2c2925, 1, 0),
  trench: mat(0x18191b, 1, 0),
  brick: mat(0x8c5b45, 0.95, 0),
  steel: mat(0x9ea5ab, 0.45, 0.7),
  steelDark: mat(0x4a5158, 0.55, 0.6),
  deck: mat(0x7f878d, 0.6, 0.45),
  red: mat(0xb3472f, 0.6, 0.3),
  grey: mat(0x8d949a, 0.55, 0.45),
  white: mat(0xe6e8ea, 0.5, 0.08),
  glass: mat(0x24313c, 0.25, 0.3),
  yellow: mat(0xe0b03a, 0.5, 0.2),
  wire: mat(0x2a2d31, 0.6, 0.5),
  rubber: mat(0x1b1c1e, 0.9, 0),
  earth: mat(0x7d6c52, 1, 0),
  water: new THREE.MeshStandardMaterial({ color: 0x58b4ec, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.62 }), // spray, card pictures only
  bag: new THREE.MeshStandardMaterial({ color: 0xbfe3f5, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.7 }), // water bags over the holes
  orange: mat(0xd9792b, 0.7, 0.05), // the escape chute's fabric
  green: mat(0x4f7d68, 0.6, 0.3), // the Soyuz support arms' paint
};
/** A complex's tower colour (site.look.tower): Saturn-era red by default. */
const TOWER = { red: M.red, white: M.white, grey: M.grey, dark: M.steelDark };

/**
 * The Blender models of the pad (wave 4): equipment option → model id (public/assets/models/builder/pad/<id>.glb);
 * some mounts are picked by complex (padModelIds). Built by src/builder/tools/blender/pad/build.py.
 */
export const PAD_MODELS = Object.freeze({
  mount: { slab: 'pad/slab', trench: 'pad/trench', raised: 'pad/mount_raised', deflector: 'pad/pit', mlp: 'pad/mlp_shuttle' },
  mountBySite: { lc39a: 'pad/mlp_saturn', lc39b: 'pad/ml1', ela3: 'pad/table_ela3', lc34: 'pad/pedestal_lc34', starbase2: 'pad/mount_olm2' },
  tower: { strongback: 'pad/strongback', gantry: 'pad/soyuz_gantry', fixed: 'pad/tower_fixed', rss: 'pad/tower_fixed', catch: 'pad/catch_tower', mst: 'pad/mst' },
  rss: 'pad/rss',
  clamps: { tulip: 'pad/soyuz_launcher', hold: 'pad/holddown', release: 'pad/holddown' },
  holddown: 'pad/holddown', // clamps, Saturn arms and tail service masts
  deluge: { tower: 'pad/water_tower', iop: 'pad/water_tower' },
  lightning: { mast: 'pad/lightning_tower', catenary: 'pad/lightning_tower' },
  crewArm: 'pad/crew_arm', // every crew access option boards by the arm
  access: { slidewire: 'pad/egress', blastroom: 'pad/egress' },
  propellant: { auto: ['pad/sphere', 'pad/sphere_lox'], loadgo: ['pad/sphere', 'pad/sphere_lox'] },
  weather: { radar: 'pad/weather_gear' },
});
/** Complexes whose mobile platform rolls to a fixed tower standing at the pad (Wenchang LC-101, Jiuquan LC-43/921). */
const TOWER_AT_PAD = new Set(['wenchang', 'jiuquan']);
/**
 * The model ids one pad uses ({ mount, trench, tower, rss, tulip, holddown, crewArm, water, lightning, egress, spheres,
 * weather }). At sea (Sea Launch) the code's steel deck stays and there is no shore gear.
 */
export function padModelIds(o, siteId, sea = false) {
  const bySite = o.mount === 'mlp' || o.mount === 'raised' || o.mount === 'deflector' ? PAD_MODELS.mountBySite[siteId] : null;
  const mount = sea ? null : bySite ?? (o.mount === 'mlp' && o.tower === 'fixed' && !TOWER_AT_PAD.has(siteId) ? 'pad/mlp_saturn' : PAD_MODELS.mount[o.mount] ?? null);
  return {
    mount,
    trench: o.mount === 'trench' || (o.mount === 'mlp' && mount !== 'pad/table_ela3') ? 'pad/trench' : null,
    tower: mount === 'pad/ml1' ? null : PAD_MODELS.tower[o.tower] ?? null,
    rss: o.tower === 'rss' ? PAD_MODELS.rss : null,
    tulip: o.clamps === 'tulip' ? PAD_MODELS.clamps.tulip : null,
    holddown: o.clamps === 'hold' || o.clamps === 'release' || o.tower === 'tsm' || (o.mount === 'mlp' && o.tower !== 'strongback') ? PAD_MODELS.holddown : null,
    crewArm: o.access !== 'none' ? PAD_MODELS.crewArm : null,
    water: PAD_MODELS.deluge[o.deluge] ?? null,
    lightning: PAD_MODELS.lightning[o.lightning] ?? null,
    egress: PAD_MODELS.access[o.access] ?? null,
    spheres: sea ? [] : PAD_MODELS.propellant[o.propellant] ?? [],
    weather: sea ? null : PAD_MODELS.weather[o.weather] ?? null,
  };
}

// ---------- the Blender models: each file loads once and stays here; every pad that shows one draws a copy ----------
const groundModels = new Map(); // id -> { scene: THREE.Object3D | null, settled: boolean, promise }
function requestGround(id) {
  if (!groundModels.has(id)) {
    const entry = { scene: null, settled: false, promise: null };
    entry.promise = loadGroundModel(id).then(
      (scene) => { entry.scene = scene; entry.box = scene ? new THREE.Box3().setFromObject(scene) : null; entry.settled = true; return scene; },
      () => { entry.settled = true; return null; },
    );
    groundModels.set(id, entry);
  }
  return groundModels.get(id);
}
/** A fresh copy of a loaded model (or of one node of it), its materials copied so a scene may dim and dispose them. */
function copyOf(source, nodeName = null) {
  const src = nodeName ? source?.getObjectByName(nodeName) : source;
  if (!src) return null;
  const c = src.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.scale.set(1, 1, 1);
  c.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    o.castShadow = true;
    o.receiveShadow = true;
    o.userData.padModel = true; // its geometry is shared with the loaded model: never disposed here
  });
  // a big concrete hardstand only receives shadows (casting them on itself at grazing light makes the studio's shadow
  // map ripple across it)
  c.getObjectByName('hardstand')?.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return c;
}
/** Shrinks a placed model across (x, z) where it would reach past the ground disc of radius r (a long flame trench). */
function keepInside(obj, id, r) {
  const b = groundModels.get(id)?.box;
  if (!b) return obj;
  const ex = Math.max(-b.min.x, b.max.x) * obj.scale.x, ez = Math.max(-b.min.z, b.max.z) * obj.scale.z;
  if (ex > r - 1) obj.scale.x *= (r - 1) / ex;
  if (ez > r - 1) obj.scale.z *= (r - 1) / ez;
  return obj;
}
/** Recolours a model's `paint` material (a tower's colour). */
function paint(obj, color) {
  obj.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.name === 'paint') m.color.copy(color); });
  return obj;
}
/** Hides the named nodes of a model copy. */
function hide(obj, ...names) {
  for (const n of names) { const c = obj.getObjectByName(n); if (c) c.visible = false; }
  return obj;
}

/**
 * Swaps a drawn pad's contents for a fresh drawing once its models have arrived, keeping the caller's group and the
 * look a scene gave it (designScene dims and tints the pad through cloned materials: the new ones get the same).
 */
function redrawInPlace(g, made) {
  let look = null;
  g.traverse((o) => { if (!look && o.isMesh) { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m?.userData?.vdCloned) look = m; } });
  let flagPad = false;
  g.traverse((o) => { if (o.userData.pad) flagPad = true; });
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      if (o.geometry && !o.userData.padModel) o.geometry.dispose();
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose?.();
    });
  }
  for (const c of [...made.object.children]) g.add(c);
  g.userData.fit = made.object.userData.fit;
  g.traverse((o) => {
    if (flagPad) o.userData.pad = true;
    if (!look || !o.isMesh) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      const c = m.clone();
      c.userData = { ...m.userData, vdCloned: true, baseOpacity: m.opacity, baseTransparent: m.transparent, baseEmissive: m.emissive ? m.emissive.clone() : null, baseEmissiveIntensity: m.emissiveIntensity ?? 1 };
      c.transparent = look.transparent;
      c.opacity = Math.min(m.opacity, look.opacity);
      c.depthWrite = look.depthWrite;
      if (c.emissive && look.emissive) { c.emissive.copy(look.emissive); c.emissiveIntensity = look.emissiveIntensity; }
      m.dispose();
      return c;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
}

// ---------- ground: a soft disc of the site's own land ----------
// keyed by a complex's climate.ground (or its id)
const GROUNDS = {
  cape: { base: '#b9ad87', spots: ['#78814f', '#cdc29c', '#8e9160'] }, // sand and palmetto scrub
  vandenberg: { base: '#a8925b', spots: ['#5f6a43', '#c3ad73', '#7a7a4c'] }, // dry golden grass, chaparral
  starbase: { base: '#d2c59f', spots: ['#b3a481', '#e3d9b9', '#9c9375'] }, // beach sand, tidal flats
  kourou: { base: '#4d7237', spots: ['#8b5337', '#3a5d2a', '#6a8a45'] }, // rain forest, red laterite
  baikonur: { base: '#a99c77', spots: ['#8b8a69', '#c0b48f', '#9a8c66'] }, // dusty steppe
  plesetsk: { base: '#3f5435', spots: ['#2b3c26', '#56684a', '#6f7a66'] }, // taiga
  wenchang: { base: '#58873f', spots: ['#c8bc93', '#44703a', '#7a9e55'] }, // tropical green and sand
  tanegashima: { base: '#5a8a44', spots: ['#3e6a33', '#7ca35a', '#b9b08a'] }, // green hills by the sea
  mahia: { base: '#76984f', spots: ['#5d7e3e', '#93ad66', '#a9a27a'] }, // sheep pasture
  wallops: { base: '#8f8a6a', spots: ['#6e6a4c', '#a9a27e', '#5d6b52'] }, // winter salt marsh, dead grass, sand
  gobi: { base: '#b29f7c', spots: ['#8f7f62', '#c9b896', '#7a6d58'] }, // Gobi gravel desert
  xichang: { base: '#6d7a4a', spots: ['#9a5d3c', '#4f5f36', '#8a8f5c'] }, // mountain valley, red earth, pines
  sriharikota: { base: '#cdbf98', spots: ['#5f7d45', '#e0d4b1', '#7c9256'] }, // coastal sand, casuarina
  naro: { base: '#557a44', spots: ['#3f5f34', '#7a9a5e', '#a39a7a'] }, // pine-covered island hills
  alcantara: { base: '#5b7f3a', spots: ['#a0583a', '#46682f', '#7d9a4a'] }, // tropical green, red laterite
  atoll: { base: '#e6dcc0', spots: ['#cfc3a3', '#6f9a52', '#f1ead6'] }, // coral sand, palms
  kagoshima: { base: '#557f45', spots: ['#3d6534', '#7da15d', '#9d9a82'] }, // green mountain plateau
  amur: { base: '#4d5d3e', spots: ['#36452c', '#66765a', '#8a8a74'] }, // Far East taiga
  ocean: { base: '#2f5d7c', spots: ['#244c66', '#3c6f90', '#6f95ad'] }, // open sea around Sea Launch's platform deck
};
const groundTextures = new Map();
function groundTexture(id, snow = false) {
  const site = GROUNDS[id] ? id : 'cape';
  const key = snow ? `${site}:snow` : site;
  if (groundTextures.has(key)) return groundTextures.get(key);
  if (typeof document === 'undefined') return null;
  const g = GROUNDS[site];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = g.base;
  ctx.fillRect(0, 0, 256, 256);
  let seed = [...site].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 420; i++) {
    ctx.globalAlpha = 0.2 + rnd() * 0.5;
    ctx.fillStyle = g.spots[i % g.spots.length];
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 256, 1.5 + rnd() * 11, 1.5 + rnd() * 7, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  if (snow) {
    // below freezing: a thin cover of snow, the darker ground showing through in patches
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#e9eef2';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = 0.3 + rnd() * 0.5;
      ctx.fillStyle = i % 3 ? '#f4f7f9' : '#cfd8de';
      ctx.beginPath();
      ctx.ellipse(rnd() * 256, rnd() * 256, 2 + rnd() * 12, 2 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // fade to nothing at the rim so the land melts into the dark studio
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  const grad = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  groundTextures.set(key, tex);
  return tex;
}

// ---------- a kit of pieces merged into one mesh per material ----------
class Kit {
  constructor() { this.byMat = new Map(); this.stack = [new THREE.Matrix4()]; }
  push(m) { this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m)); }
  pop() { this.stack.pop(); }
  add(geo, material, m = null) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const top = this.stack[this.stack.length - 1];
    g.applyMatrix4(m ? top.clone().multiply(m) : top);
    if (!this.byMat.has(material)) this.byMat.set(material, []);
    this.byMat.get(material).push(g);
  }
  build(group) {
    for (const [material, list] of this.byMat) {
      let n = 0;
      for (const g of list) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let at = 0;
      for (const g of list) {
        pos.set(g.attributes.position.array, at * 3);
        nor.set(g.attributes.normal.array, at * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, at * 2);
        at += g.attributes.position.count;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = !material.userData.flat;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// unit pieces, scaled into place (only ever cloned, never drawn themselves)
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONE = new THREE.CylinderGeometry(0.15, 1, 1, 10);
const SPH = new THREE.SphereGeometry(1, 20, 14);
const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function trs(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}
const turn = (deg) => new THREE.Matrix4().makeRotationY(deg * DEG);
/** A box of w × h × d centred at (x, y, z). */
const box = (kit, m, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) => kit.add(BOX, m, trs(x, y, z, w, h, d, rx, ry, rz));
/** A vertical cylinder of radius r from y0 up h. */
const post = (kit, m, r, h, x, y0, z, geo = CYL) => kit.add(geo, m, trs(x, y0 + h / 2, z, r, h, r));
const sphere = (kit, m, r, x, y, z, sy = 1) => kit.add(SPH, m, trs(x, y, z, r, r * sy, r));
/** A straight member from a to b ([x, y, z]); thickness t (a box) or radius t (geo = CYL8). */
function beam(kit, m, a, b, t, geo = BOX) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  if (len < 1e-4) return;
  _q.setFromUnitVectors(Y, d.divideScalar(len));
  kit.add(geo, m, new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), _q, _s.set(t, len, t)));
}
const pipe = (kit, m, a, b, r) => beam(kit, m, a, b, r, CYL8);
/** A hanging cable from a to b that sags `sag` metres in the middle; returns its curve. */
function cable(kit, m, a, b, sag, r = 0.035) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  mid.y -= sag * 2; // a quadratic curve's middle point sits half way to its control point
  const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
  const g = new THREE.TubeGeometry(curve, 24, r, 5, false);
  kit.add(g, m);
  g.dispose();
  return curve;
}
/** A flat disc on the ground (or any level). */
function disc(kit, m, r, x, y, z, segs = 40) {
  const g = new THREE.CircleGeometry(r, segs);
  kit.add(g, m, trs(x, y, z, 1, 1, 1, -Math.PI / 2));
  g.dispose();
}
/** A polygon of [x, z] points extruded up from y0 by h. */
function prism(kit, m, pts, y0, h) {
  if (pts.length < 3) return;
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  kit.add(g, m, trs(0, y0, 0, 1, 1, 1, -Math.PI / 2));
  g.dispose();
}
/** Keeps the part of a polygon where nx·x + nz·z >= c (one Sutherland–Hodgman pass). */
function clip(pts, nx, nz, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const da = nx * a[0] + nz * a[1] - c, db = nx * b[0] + nz * b[1] - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
const octagon = (r) => Array.from({ length: 8 }, (_, k) => { const a = (22.5 + 45 * k) * DEG; return [Math.cos(a) * r, Math.sin(a) * r]; });
/** A point at angle a (degrees, 0 = +x, 90 = -z) and distance d. */
const polar = (a, d) => [Math.cos(a * DEG) * d, -Math.sin(a * DEG) * d];

/** A square lattice tower: four columns, a ring of beams every bay, alternating diagonals on each face. */
function lattice(kit, m, { x = 0, z = 0, w, d = w, y0, y1, bay = 2.4, t = 0.16, ry = 0 }) {
  kit.push(trs(x, 0, z, 1, 1, 1, 0, ry * DEG, 0));
  const hx = w / 2, hz = d / 2, h = y1 - y0;
  const n = Math.max(1, Math.round(h / bay)), step = h / n, tt = t * 0.7;
  for (const [cx, cz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) box(kit, m, t, h, t, cx, y0 + h / 2, cz);
  for (let i = 0; i <= n; i++) {
    const y = y0 + i * step;
    box(kit, m, w, tt, tt, 0, y, -hz); box(kit, m, w, tt, tt, 0, y, hz);
    box(kit, m, tt, tt, d, -hx, y, 0); box(kit, m, tt, tt, d, hx, y, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = y0 + i * step, b = a + step, f = i % 2 ? 1 : -1;
    beam(kit, m, [-hx * f, a, -hz], [hx * f, b, -hz], tt * 0.8);
    beam(kit, m, [hx * f, a, hz], [-hx * f, b, hz], tt * 0.8);
    beam(kit, m, [-hx, a, -hz * f], [-hx, b, hz * f], tt * 0.8);
    beam(kit, m, [hx, a, hz * f], [hx, b, -hz * f], tt * 0.8);
  }
  kit.pop();
}

/** A swing arm: a truss from the tower face (x0) to the ship (x1) at height y, with an umbilical plate at the ship. */
function swingArm(kit, m, x0, x1, y) {
  const L = x0 - x1, cx = (x0 + x1) / 2;
  for (const z of [-0.3, 0.3]) {
    box(kit, m, L, 0.09, 0.09, cx, y + 0.25, z);
    box(kit, m, L, 0.09, 0.09, cx, y - 0.25, z);
    const n = Math.max(1, Math.round(L / 0.6));
    for (let i = 0; i < n; i++) {
      const a = x1 + (L * i) / n, b = x1 + (L * (i + 1)) / n;
      beam(kit, m, [a, y - 0.25, z], [b, y + 0.25, z], 0.06);
    }
  }
  for (let i = 0; i <= Math.round(L / 0.6); i++) box(kit, m, 0.06, 0.06, 0.6, x1 + (L * i) / Math.max(1, Math.round(L / 0.6)), y + 0.25, 0);
  pipe(kit, M.rubber, [x0, y - 0.05, 0.12], [x1 + 0.1, y - 0.05, 0.12], 0.07); // the propellant line
  box(kit, M.steelDark, 0.14, 0.62, 0.7, x1 + 0.07, y, 0); // umbilical plate on the ship
}

/** Pushes a frame that swings an arm built along -x from the tower face x0 back against the tower (an empty stand). */
function swungBack(kit, x0, towerW) {
  kit.push(new THREE.Matrix4().makeTranslation(x0 - 0.4, 0, -towerW / 2 - 0.05).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-x0, 0, 0)));
}

// ---------- the ship, read from its layout ----------
const sizeR = (letter) => BASE_RADIUS * (SIZE_SCALE[letter] ?? 1);
const angDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
/** Surface radius of an axial part at a fraction f of its height. */
function surfaceOf(e, f) {
  const d = e.def ?? {};
  if (d.flags?.capsule) {
    const r = noseArt.surfaceRadius?.(d, Math.min(1, Math.max(0, f)), e.radius);
    return Number.isFinite(r) ? r : e.radius * (1 - 0.5 * f);
  }
  if (d.adapter) return sizeR(d.adapter.bottom) + (sizeR(d.adapter.top) - sizeR(d.adapter.bottom)) * f;
  if (d.engine) return e.radius * 0.55;
  if (!(d.nodes ?? []).includes('top')) return e.radius * Math.sqrt(Math.max(0.02, 1 - f * f)); // a nose cone or fairing
  return e.radius;
}
/** How far out a side part reaches (from the axis), how wide it is and over which heights (ship coordinates). */
function sideSpan(e) {
  const d = e.def ?? {}, h = d.height ?? e.height ?? 1, type = e.type ?? '';
  const w = (d.aero?.sideArea ?? 0.3) / Math.max(0.1, h);
  const inner = e.radius * 0.95;
  if (/leg/.test(type)) return { angle: e.angle, inner, reach: e.radius + (/falcon/.test(type) ? Math.min(3, Math.max(1.3, e.y * 0.85)) : 1.5), half: 0.3, ylo: 0, yhi: e.y + 0.3 };
  if (d.booster) { const bw = Math.max(0.6, w); return { angle: e.angle, inner, reach: e.radius + bw + 0.1, half: bw / 2, ylo: e.y - h * 0.3, yhi: e.y + h }; }
  if (/fin_grid/.test(type)) return { angle: e.angle, inner, reach: e.radius + 0.6, half: 0.5, ylo: e.y - 0.2, yhi: e.y + h };
  if (/fin/.test(type)) return { angle: e.angle, inner, reach: e.radius - 1.2 + Math.max(w, 0.68 * h) + 0.05, half: 0.1, ylo: e.y - 0.3 * h, yhi: e.y + h };
  const pw = /solar_wing/.test(type) ? Math.max(w, 0.42 * h) : Math.min(1.5, Math.max(0.3, w));
  return { angle: e.angle, inner, reach: e.radius + pw + 0.1, half: /solar/.test(type) ? 0.15 : 0.35, ylo: e.y - 0.1, yhi: e.y + h };
}
/** The hull, its side parts and the questions the pad asks of them. Heights are metres above the vehicle's base. */
function shipModel(layout) {
  const axial = (layout ?? []).filter((e) => e.attach === 'axial' && e.def).sort((a, b) => a.y - b.y);
  const sides = (layout ?? []).filter((e) => e.attach === 'radial' && e.def).map(sideSpan);
  const partAt = (h) => axial.find((e) => h >= e.y && h < e.y + e.height) ?? null;
  const hullAt = (h) => { const e = partAt(h); return e ? surfaceOf(e, (h - e.y) / e.height) : 0; };
  const hullMax = (h0, h1) => { let r = 0; for (let h = h0; h <= h1 + 1e-6; h += 0.1) r = Math.max(r, hullAt(h)); return r; };
  /** The farthest (along `angle`, world degrees) any side part reaches within `half` metres either side of that line. */
  const clearance = (angle, half) => {
    let best = 0;
    for (const sp of sides) {
      const dA = angDiff(sp.angle, angle) * DEG;
      if (Math.abs(dA) >= Math.PI / 2) continue;
      const lim = (half + sp.half + 0.3) / Math.max(1e-3, Math.abs(Math.sin(dA)));
      const rho = Math.min(sp.reach, lim);
      if (rho >= sp.inner) best = Math.max(best, rho * Math.cos(dA));
    }
    return best;
  };
  /** Is a piece coming in from `angle` between heights h0 and h1 (half-width `half`) in a side part's way? */
  const blocked = (angle, h0, h1, half = 0.35) => sides.some((sp) => {
    const dA = angDiff(sp.angle, angle) * DEG;
    if (Math.abs(dA) >= Math.PI / 2 || h1 < sp.ylo || h0 > sp.yhi) return false;
    return sp.inner * Math.abs(Math.sin(dA)) < half + sp.half + 0.1;
  });
  /** A height near h for an arm from `angle`: on a part's flank (not a joint, an engine or a nose tip) and clear of side parts. */
  const armHeight = (angle, h, avoid = []) => {
    for (const dh of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6]) {
      const hh = h + dh, e = partAt(hh);
      if (!e || e.def.engine) continue;
      const lo = hh - e.y, hi = e.y + e.height - hh;
      if (Math.min(lo, hi) < Math.min(0.3, e.height * 0.25)) continue;
      if (!(e.def.nodes ?? []).includes('top') && !e.def.flags?.capsule && lo / e.height > 0.5) continue;
      if (avoid.some((a) => Math.abs(a - hh) < 1.4)) continue;
      if (blocked(angle, hh - 0.45, hh + 0.45)) continue;
      return hh;
    }
    return null;
  };
  const capsule = axial.find((e) => e.def.flags?.capsule) ?? null;
  const lowest = axial.find((e) => !e.def.engine) ?? null;
  return { axial, sides, partAt, hullAt, hullMax, clearance, blocked, armHeight, capsule, lowest, empty: !axial.length };
}

// ---------- the pad ----------
export function padArt(state, opts = {}) {
  const { radius = 1.25, height = 20, layout = null, icon = false, only = null, models = null } = opts;
  const R = Math.max(0.9, radius || 1.25);
  const H = height > 0.5 ? height : 16; // an empty pad is sized for a typical ship
  const ship = shipModel(layout);
  const empty = ship.empty || !(height > 0.5);
  const pick = (key, fallback) => state?.equipment?.find((c) => c.eq.key === key)?.option?.id ?? fallback;
  const o = {
    mount: pick('mount', 'slab'), tower: pick('tower', 'none'), clamps: pick('clamps', 'none'), deluge: pick('deluge', 'none'),
    lightning: pick('lightning', 'none'), access: pick('access', 'none'), propellant: pick('propellant', 'manual'), weather: pick('weather', 'none'),
  };
  // `only`: one piece of equipment on a bare slab (a card picture); the other pieces are left out
  if (only) for (const k of Object.keys(o)) if (k !== only && k !== 'mount') o[k] = { tower: 'none', clamps: 'none', deluge: 'none', lightning: 'none', access: 'none', propellant: 'none', weather: 'none' }[k];
  if (only && only !== 'mount') o.mount = 'slab';
  const near = only === 'propellant' || only === 'weather'; // far-off gear drawn close in, for its picture
  const bare = only === 'deluge' || only === 'clamps'; // gear at the ship's base, drawn close up with no pad under it
  const far = (d) => (near ? d * 0.22 : d);
  const site = state?.site ?? null;
  const kit = new Kit();
  // the Blender models this pad uses: the loaded ones replace code pieces; pending ones redraw the pad when they arrive
  const ids = padModelIds(o, site?.id, site?.climate?.ground === 'ocean');
  const wanted = icon || near || bare ? [] : [...new Set([ids.mount, ids.trench, ids.tower, ids.rss, ids.tulip, ids.holddown, ids.crewArm, ids.water, ids.lightning, ids.egress, ...ids.spheres, ids.weather].filter(Boolean))];
  const pending = [];
  const modelOf = (id) => {
    if (!id || !wanted.includes(id)) return null;
    if (models) return models[id] ?? null;
    const e = requestGround(id);
    if (!e.settled) pending.push(e.promise);
    return e.scene;
  };
  const extras = []; // model copies, in the pad's frame
  const kitPoint = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(kit.stack[kit.stack.length - 1]);

  // sizes shared by the pieces (the ratio rules: README "Ground models"; D = the ship's width)
  const D = 2 * R;
  const hole = D * 1.2; // the opening under the ship (real: 1.2–1.4 × the span)
  const ringS = Math.max(hole + 0.8, D * 1.9); // a launch ring or table, outside (1.8–2 × the width)
  const trenchW = D * 1.9; // a flame trench 1.8–2.1 × the width
  // tower width and its centre's distance from the ship's axis: about one width off the hull, and back far enough to
  // clear any side part reaching its way
  const across = D / 2.5; // the scale across of a mount or arm model (built for a ship 2.5 m wide)
  let towerW = Math.min(5, Math.max(2.2, D * 1.3)), towerD = Math.max(R + D + towerW / 2, ship.clearance(FACING_DEG, towerW / 2) + towerW / 2 + 0.5);
  if (ids.mount === 'pad/ml1') { towerW = 3.67 * across; towerD = Math.max(5.94 * across, towerD); } // ML-1's own tower (NASA model)
  // a mobile platform deck about 3 × the width; a launch umbilical tower rides on it, so the deck reaches under the tower
  const towerOnDeck = o.tower === 'fixed' && !TOWER_AT_PAD.has(site?.id);
  const mlpHZ = D * 1.5, mlpX0 = -D * 1.5, mlpX1 = towerOnDeck ? towerD + towerW / 2 + 0.4 : D * 1.5;
  // hardstand radius (a card picture keeps it tight)
  const RH = Math.max(icon ? R * 3.4 : Math.max(8.5, R * 5.5), o.mount === 'mlp' ? Math.hypot(Math.max(-mlpX0, mlpX1), mlpHZ) + 0.8 : 0);
  // Sea Launch: the pad is a steel platform deck on the open sea
  const sea = site?.climate?.ground === 'ocean';
  const C = sea ? M.deck : M.concrete;
  // far-field placement (pass 2): a mobile service tower rolls back at least 1.3 × the ship's height (ELS 80 m, Vostochny
  // 80-140 m, ELA-4 120 m beside 46-63 m rockets), lightning towers stand at least 1.2 × its height out (Pad 39B); the
  // ground disc grows to hold them
  const F_MST = D * 3;
  const mstX0 = o.tower !== 'mst' ? 0 : Math.max(R + 1.4, ship.clearance(FACING_DEG, F_MST / 2) + 0.6) + (icon ? F_MST * 0.6 : 0);
  const mstFace = o.tower === 'mst' && !icon ? Math.max(mstX0, 1.3 * H) : mstX0;
  const farR = Math.max(8.5, 1.2 * H);
  const groundR = Math.max(26, RH + 14, o.tower === 'mst' && !icon ? mstFace + F_MST + 3 : 0, o.lightning === 'mast' || o.lightning === 'catenary' ? farR + 5 : 0);
  let peak = null; // the top of the tallest tower drawn: { x, y, z } (a lightning rod goes there)

  // the complex's land (no ground on a card picture)
  if (!icon) {
    const tex = groundTexture(site?.climate?.ground ?? site?.id, !sea && (state?.slot?.tempC ?? 10) < 0);
    const groundMat = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0x8a8466, map: tex, transparent: !!tex, roughness: 1, metalness: 0 });
    groundMat.userData.flat = true;
    disc(kit, groundMat, groundR, 0, 0.015, 0, 64);
  }

  // ----- launch mount and flame trench -----
  let hs, top; // hardstand height, height the ship stands on
  const oct = octagon(RH);
  const ring = (S, t, y) => { // a square steel launch ring of outer size S and thickness t around the hole, its top at y
    box(kit, M.steel, S, t, (S - hole) / 2, 0, y - t / 2, (S + hole) / 4);
    box(kit, M.steel, S, t, (S - hole) / 2, 0, y - t / 2, -(S + hole) / 4);
    box(kit, M.steel, (S - hole) / 2, t, hole, (S + hole) / 4, y - t / 2, 0);
    box(kit, M.steel, (S - hole) / 2, t, hole, -(S + hole) / 4, y - t / 2, 0);
  };
  if (near) {
    hs = 0; top = 0; // storage and weather gear on their own: no pad under them
  } else if (bare) {
    hs = 0; top = 0.35;
    if (only === 'clamps') {
      // the base of a ship standing on its launch ring: an engine bell under a tank, the clamps (if any) at its rim
      ring(ringS, 0.35, top);
      kit.add(CONE, M.steelDark, trs(0, top + 0.35, 0, R * 0.55, 0.7, R * 0.55));
      post(kit, M.white, R * 0.98, 1.9, 0, top + 0.6, 0);
    } else if (o.deluge === 'none') {
      // no water: a scorched, cracked patch of concrete
      box(kit, M.concreteOld, R * 3.2, 0.35, R * 3.2, 0, 0.175, 0);
      disc(kit, M.scorch, R * 1.3, 0, 0.36, 0);
      for (const [a, l] of [[20, 1.5], [140, 1.2], [250, 1.7]]) { const [cx, cz] = polar(a, l / 2 + 0.6); box(kit, M.trench, l, 0.02, 0.06, cx, 0.37, cz, a * DEG); }
    }
  } else if (o.mount === 'deflector') {
    // a one-way flame pit or bucket (Gagarin's Start, Pad 39B's ramp, Starbase Pad 2): the ship stands on a ring over
    // the edge of a deep pit that opens out on one side (-x); a sloped deflector at its bottom sends the fire that way.
    // Starbase Pad 2: a square mount on four legs over a dug trench (the model's heights: pad 2.0, table 5.0 at D 2.5)
    const olm2 = ids.mount === 'pad/mount_olm2';
    const sy = olm2 ? across : (1.2 + Math.max(2.4, D * 1.2)) / 4.2; // the pit model: pad 1.2 m, ring top 4.2 m at D 2.5
    hs = olm2 ? 2.0 * across : 1.2 * sy;
    const mountH = olm2 ? 3.0 * across : 3.0 * sy, S = ringS, pitW = trenchW * 1.3;
    top = hs + mountH;
    const mm = modelOf(ids.mount);
    if (mm) {
      const c = copyOf(mm);
      c.scale.set(across, sy, across);
      extras.push(keepInside(c, ids.mount, groundR));
    } else {
    prism(kit, C, clip(oct, 1, 0, hole / 2), 0, hs);
    prism(kit, C, clip(clip(oct, -1, 0, -hole / 2), 0, 1, pitW / 2), 0, hs);
    prism(kit, C, clip(clip(oct, -1, 0, -hole / 2), 0, -1, pitW / 2), 0, hs);
    // the pit: a dark floor running out past the pad, its earth walls sloping up and out like a quarry's
    const pitL = RH + (icon ? 4 : 16), end = hole / 2 - pitL;
    if (!sea) {
      // (at sea the fire falls off the platform's edge into the water: no pit, no banks)
      box(kit, M.trench, pitL, 0.1, pitW, (hole / 2 + end) / 2, 0.05, 0);
      for (const s of [-1, 1]) box(kit, M.earth, -RH - end, 0.3, 6.5, (-RH + end) / 2, 1.05, s * (pitW / 2 + 3.0), 0, -s * 0.33);
      if (!icon) box(kit, M.scorch, 9, 0.03, pitW * 1.6, end - 2.5, 0.03, 0);
    }
    // a sloped steel deflector under the ship
    const run = hole + 1.6, drop = hs - 0.15;
    box(kit, M.steelDark, Math.hypot(run, drop), 0.3, pitW - 0.1, hole / 2 - run / 2, (hs + 0.15) / 2, 0, 0, 0, Math.atan2(drop, run));
    // the steel launch ring on four concrete legs (the Soyuz support arms, when chosen, are drawn with the clamps)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(kit, M.concreteOld, 0.8, mountH - 0.5, 0.8, sx * (S / 2 - 0.4), hs + (mountH - 0.5) / 2, sz * (S / 2 - 0.4));
    ring(S, 0.5, top);
    }
  } else if (o.mount === 'raised') {
    // Starbase-style launch mount: a heavy steel table on six legs, the bare concrete (or a water-cooled steel plate) under it;
    // 1.2–2.2 × the ship's width tall, by the size of the complex (Starbase tall, Mahia low)
    hs = 0.45;
    const mountH = Math.max(3.2, R * 3.4 * Math.min(1.1, 0.55 + (site?.scale ?? 1) * 0.4)), S = ringS + 0.4;
    top = hs + mountH;
    const mm = modelOf(ids.mount);
    if (mm) {
      // the models: Starbase's mount (table top 5.0 m at D 2.5) or LC-34's pedestal (3.45 m), fitted to this height
      const c = copyOf(mm);
      c.scale.set(across, top / (ids.mount === 'pad/pedestal_lc34' ? 3.45 : 5.0), across);
      hide(c, 'holddown'); // the clamps are drawn below, fitted to the ship
      if (o.deluge === 'none') hide(c, 'plate');
      extras.push(c);
    } else {
    prism(kit, C, oct, 0, hs);
    if (o.deluge !== 'none') {
      box(kit, M.steelDark, S + 1.0, 0.25, S + 1.0, 0, hs + 0.125, 0); // the water-cooled steel plate
      for (let i = -2; i <= 2; i++) box(kit, M.steel, 0.12, 0.06, S + 0.6, i * (S / 5), hs + 0.28, 0);
    } else disc(kit, M.scorch, R * 2.8, 0, hs + 0.012, 0);
    {
      for (let k = 0; k < 6; k++) {
        const [lx, lz] = polar(30 + 60 * k, S / 2 + 0.1);
        box(kit, M.steelDark, 0.95, mountH - 0.9, 0.95, lx, hs + (mountH - 0.9) / 2, lz, (30 + 60 * k) * DEG);
        const [bx, bz] = polar(60 * k, (S / 2 + 0.1) * 0.87);
        box(kit, M.steel, (S / 2 + 0.1) * 1.0, 0.3, 0.3, bx, hs + mountH * 0.45, bz, (60 * k + 90) * DEG); // bracing between the legs
      }
      ring(S, 0.9, top);
      box(kit, M.steelDark, S + 0.2, 0.12, S + 0.2, 0, top - 0.95, 0);
    }
    }
  } else if (o.mount === 'mlp' && ids.mount === 'pad/table_ela3') {
    // ELA-3: the Ariane 5 launch table on its concrete pad over the flame duct (the model: pad 2.875 m, deck 4.625 m)
    hs = 2.875 * across;
    top = 4.625 * across;
    const mm = modelOf(ids.mount);
    if (mm) {
      const c = copyOf(mm);
      c.scale.setScalar(across);
      extras.push(keepInside(c, ids.mount, groundR));
    } else {
      prism(kit, C, clip(oct, 1, 0, trenchW / 2), 0, hs);
      prism(kit, C, clip(oct, -1, 0, trenchW / 2), 0, hs);
      box(kit, M.trench, trenchW, 0.1, 2 * RH + 10, 0, 0.05, 0);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(kit, M.grey, 0.4, top - hs, 0.4, sx * (D * 1.5 - 0.3), (hs + top) / 2, sz * (D * 1.2 - 0.3));
      box(kit, M.deck, D * 3, 0.5, D * 2.4, 0, top - 0.25, 0);
    }
  } else if (o.mount === 'trench' || o.mount === 'mlp') {
    hs = Math.max(2.4, D * 1.2); // the pad stands about 1.2 × the ship's width above the trench floor (LC-39: 12 m / 10.1 m)
    const mt = modelOf(ids.trench);
    if (mt) {
      // the trench model (pad 3.0 m at D 2.5): its launch table spans the trench when there is no platform; Pad 39B has
      // its one-way ramp, the others the two-way wedge; under NASA's big ML-1 the hardstand reaches further
      const c = copyOf(mt);
      const st = across * (ids.mount === 'pad/ml1' ? 1.45 : 1);
      c.scale.set(st, hs / 3.0, st);
      if (o.mount !== 'trench') hide(c, 'table');
      hide(c, site?.id === 'lc39b' ? 'deflector_wedge' : 'deflector_ramp');
      extras.push(keepInside(c, ids.trench, groundR));
    } else {
    prism(kit, C, clip(oct, 1, 0, trenchW / 2), 0, hs);
    prism(kit, C, clip(oct, -1, 0, trenchW / 2), 0, hs);
    // trench floor running out past the pad both ways, heat-proof brick on its walls
    box(kit, M.trench, trenchW, 0.1, 2 * RH + (icon ? 2 : 10), 0, 0.05, 0);
    for (const s of [-1, 1]) box(kit, M.brick, 0.06, hs - 0.3, 2 * RH * 0.88, s * (trenchW / 2 - 0.03), (hs - 0.3) / 2 + 0.1, 0);
    if (!icon) for (const s of [-1, 1]) box(kit, M.scorch, trenchW * 2.4, 0.03, 6, 0, 0.03, s * (RH + 5.5));
    // the two-way deflector: a steel roof under the ship that splits the fire along the trench
    const ridge = hs - 0.8, run = 2.8;
    for (const s of [-1, 1]) {
      const len = Math.hypot(run, ridge - 0.12);
      box(kit, M.steelDark, trenchW - 0.12, 0.3, len, 0, (ridge + 0.12) / 2, s * run / 2, 0, s * Math.atan2(ridge - 0.12, run));
    }
    }
    if (o.mount === 'trench') {
      // a steel launch table spanning the trench
      const S = ringS, t = 0.7;
      top = hs + t;
      if (!mt) {
        box(kit, M.steel, S, t, (S - hole) / 2, 0, hs + t / 2, (S + hole) / 4);
        box(kit, M.steel, S, t, (S - hole) / 2, 0, hs + t / 2, -(S + hole) / 4);
        box(kit, M.steel, (S - hole) / 2, t, hole, (S + hole) / 4, hs + t / 2, 0);
        box(kit, M.steel, (S - hole) / 2, t, hole, -(S + hole) / 4, hs + t / 2, 0);
      }
    } else {
      // the mobile launcher platform: a two-storey steel deck on pedestals, set down over the trench. About 3 × the ship's
      // width across, 0.75 × its width high on pedestals 0.65 × its width (Saturn and Shuttle: 49 × 41 × 7.6 m on 6.7 m);
      // a launch umbilical tower rides on it, so on that side the deck reaches under the tower
      const ped = Math.max(1.0, D * 0.65), deckH = Math.max(1.4, D * 0.75), y0 = hs + ped;
      top = y0 + deckH;
      const L = mlpX1 - mlpX0, cx = (mlpX0 + mlpX1) / 2, Wd = 2 * mlpHZ;
      const mp = modelOf(ids.mount);
      if (mp) {
        // the platform models: Saturn V's (deck 3.5 m at D 2.5, reaching under its tower), the Shuttle's, NASA's ML-1
        const c = copyOf(mp);
        c.position.y = hs;
        const ys = (ped + deckH) / 3.5;
        if (ids.mount === 'pad/ml1') {
          const base = c.getObjectByName('base'), tower = c.getObjectByName('tower');
          base.scale.set(across, (ped + deckH) / 3.509, across);
          tower.position.set(towerD, top - hs, 0);
          tower.scale.set(across, (H * (site?.look?.towerH ?? 1.10)) / 22.0, across);
          hide(c, 'attach_deck', 'attach_tower');
        } else if (ids.mount === 'pad/mlp_saturn') {
          c.scale.set(Math.max(across, mlpX1 / 7.5), ys, across);
          hide(c, 'holddown', 'tsm');
        } else {
          c.scale.set(across, ys, across);
          hide(c, 'tsm', 'posts');
        }
        extras.push(c);
      } else {
        for (const px of [mlpX0 + 0.65, mlpX1 - 0.65]) for (const s of [-1, 1]) box(kit, M.concreteOld, 1.3, ped, 1.3, px, hs + ped / 2, s * (mlpHZ - 0.65));
        box(kit, M.deck, -hole / 2 - mlpX0, deckH, Wd, (mlpX0 - hole / 2) / 2, y0 + deckH / 2, 0);
        box(kit, M.deck, mlpX1 - hole / 2, deckH, Wd, (mlpX1 + hole / 2) / 2, y0 + deckH / 2, 0);
        for (const s of [-1, 1]) box(kit, M.deck, hole, deckH, mlpHZ - hole / 2, 0, y0 + deckH / 2, s * (mlpHZ + hole / 2) / 2);
        // a darker band of side panels marks the two storeys
        box(kit, M.steelDark, L + 0.04, 0.12, Wd + 0.04, cx, y0 + deckH * 0.5, 0);
        // safety railings round the deck edge, and a few deck hatches
        for (const [len, ex, ez, alongX] of [[L, cx, mlpHZ - 0.15, true], [L, cx, -mlpHZ + 0.15, true], [Wd, mlpX1 - 0.15, 0, false], [Wd, mlpX0 + 0.15, 0, false]]) {
          box(kit, M.yellow, alongX ? len - 0.3 : 0.06, 0.06, alongX ? 0.06 : len - 0.3, ex, top + 1.0, ez);
          const n = Math.max(1, Math.round(len / 1.6));
          for (let i = 0; i <= n; i++) { const t = -len / 2 + 0.15 + ((len - 0.3) * i) / n; box(kit, M.yellow, 0.06, 1.0, 0.06, alongX ? ex + t : ex, top + 0.5, alongX ? ez : t); }
        }
        for (const [hx, hz] of [[mlpX0 * 0.7, mlpHZ * 0.6], [mlpX0 * 0.7, -mlpHZ * 0.6], [mlpX1 * 0.75, -mlpHZ * 0.6]]) box(kit, M.steelDark, 0.9, 0.04, 0.7, hx, top + 0.02, hz);
      }
      // the crawlerway ramp it came up, from the hardstand's edge (the model's, with its slope, or the code's), and its
      // two gravel lanes, which stop inside the ground disc
      if (!icon) {
        const edge = mt ? 7.85 * across * (ids.mount === 'pad/ml1' ? 1.45 : 1) : RH * 0.924;
        const rampL = Math.max(8, hs * 3.2), x1 = -edge - rampL, rim = Math.max(26, RH + 14) - 2;
        box(kit, M.concreteOld, Math.hypot(rampL, hs), 0.4, 9, -edge - rampL / 2 + 0.3, hs / 2 - 0.15, 0, 0, 0, Math.atan2(hs, rampL));
        if (rim + x1 > 2) for (const s of [-1, 1]) box(kit, M.concreteOld, rim + x1, 0.05, 3.2, (x1 - rim) / 2, 0.04, s * 2.8);
      }
    }
  } else {
    // a flat concrete slab, scorched where the engines fire straight down
    hs = 0.45;
    top = hs;
    const mm = modelOf(ids.mount);
    if (mm && !sea) {
      const c = copyOf(mm);
      c.scale.set(RH / 8.5, 1, RH / 8.5);
      extras.push(c);
    } else {
      prism(kit, C, oct, 0, hs);
      disc(kit, M.scorch, R * 2.6, 0, hs + 0.012, 0);
    }
  }
  const base = o.mount === 'mlp' && towerOnDeck ? top : hs; // where towers stand
  const y = (f) => top + H * f; // a height on the ship, as a fraction of its length
  // a service tower stands 1.10 × the ship's height above the deck it serves (LC-34: 0.95 × above its pedestal)
  const towerTop = top + H * (site?.look?.towerH ?? 1.10);
  const hull = (h) => (empty ? 1.25 : ship.hullAt(h)); // hull radius at h metres above the ship's base

  // a small umbilical mast at the base: how propellant and power get in when nothing else reaches the ship
  if (o.tower !== 'strongback' && o.tower !== 'tsm' && o.mount !== 'mlp' && o.mount !== 'raised' && (!only || only === 'tower')) {
    kit.push(turn(wa(67.5)));
    box(kit, M.steelDark, 0.6, top + 1.4 - hs, 0.6, R + 1.1, hs + (top + 1.4 - hs) / 2, 0);
    box(kit, M.steelDark, 0.9, 0.3, 0.35, R + 0.55, top + 0.9, 0);
    pipe(kit, M.rubber, [R + 1.1, top + 0.6, 0.25], [R + 0.15, top + 0.7, 0.25], 0.07);
    kit.pop();
  }
  // tail service masts beside the ship's base, about 1.15 × its width tall on a platform deck (Shuttle 9.4 m, SLS 10 m):
  // on every mobile platform (a strongback carries its own umbilicals) and wherever they are the chosen tower
  if (!near && !bare && ((o.mount === 'mlp' && o.tower !== 'strongback') || o.tower === 'tsm')) {
    const onDeck = o.mount === 'mlp' || o.mount === 'slab';
    const y0m = onDeck ? top : hs, hm = (top - y0m) + D * (onDeck ? 1.15 : 0.6);
    const mh = modelOf(ids.holddown);
    for (const a of [wa(67.5), wa(247.5)]) {
      const [tx, tz] = polar(a, Math.max(R + 1.2, hole / 2 + 0.7));
      const tsmModel = mh && copyOf(mh, 'tsm');
      if (tsmModel) {
        // the model: housing, umbilical carrier and blast hood, 2.875 m tall at D 2.5, its carrier toward the ship
        tsmModel.position.set(tx, y0m, tz);
        tsmModel.rotation.y = a * DEG;
        tsmModel.scale.set(across * 0.85, hm / 2.875, across * 0.85);
        extras.push(tsmModel);
      } else {
        box(kit, M.steelDark, 0.8, hm - 0.35, 1.0, tx, y0m + (hm - 0.35) / 2, tz, a * DEG);
        box(kit, M.grey, 1.0, 0.35, 1.2, tx, y0m + hm - 0.175, tz, a * DEG); // the hood that drops shut at liftoff
      }
      const [ix, iz] = polar(a, R + 0.1);
      pipe(kit, M.rubber, [tx, y0m + hm * 0.75, tz], [ix, top + Math.min(1.2, hm * 0.5), iz], 0.08); // the umbilical to the tail
    }
  }

  // ----- where the crew boards: the capsule's mid-height (or near the top of an uncrewed ship) -----
  const access = o.access !== 'none';
  let crewH = ship.capsule ? ship.capsule.y + ship.capsule.height / 2 : Math.max(H * 0.55, H - 2.0);
  if (access && !empty) {
    const ca = FACING_DEG + (o.tower === 'strongback' ? 55 : o.tower === 'mst' ? -70 : 0);
    if (ship.capsule) {
      const c = ship.capsule;
      for (const dh of [0, 0.25, -0.25, 0.45, -0.45]) {
        const hh = c.y + c.height / 2 + dh;
        if (!ship.blocked(ca, hh - 0.45, hh + 0.45)) { crewH = hh; break; }
      }
    } else crewH = ship.armHeight(ca, crewH) ?? crewH;
  }
  const accessY = top + crewH;
  const fit = { towerD: +towerD.toFixed(2), crewH: access ? +crewH.toFixed(2) : null, arms: [] }; // what the art fitted to, for checks
  let crew = null; // { angle, d, w, own } the tower that carries the crew access arm

  // ----- service tower -----
  if (o.tower === 'fixed' || o.tower === 'rss') {
    const tm = TOWER[site?.look?.tower] ?? M.red; // Saturn-era red, or a complex's own colour
    // the models: the umbilical tower (22 m above its deck at H 20, 3.25 m wide: body stretched to the ratio rule, the
    // crane carried to the top), or NASA's ML-1 which brings its own tower and arms
    const mTower = modelOf(ids.tower);
    const mlTower = ids.mount === 'pad/ml1' && !!modelOf(ids.mount);
    const sw = towerW / 3.25;
    if (mTower) {
      const c = paint(copyOf(mTower), tm.color);
      hide(c, 'top_mast', 'pose_arm_1', 'pose_arm_2', 'pose_arm_3');
      c.position.set(towerD, base, 0);
      c.scale.set(sw, 1, sw);
      c.getObjectByName('body').scale.y = (towerTop - base) / 22;
      const head = c.getObjectByName('head');
      head.position.y = towerTop - base;
      head.scale.y = (towerTop - base) / 22;
      extras.push(c);
    } else if (!mlTower) {
      lattice(kit, tm, { x: towerD, w: towerW, y0: base, y1: towerTop, bay: 2.4, t: 0.18 });
      box(kit, tm, towerW * 2.4, 0.35, 0.4, towerD - towerW * 0.5, towerTop + 0.2, 0); // hammerhead crane
      box(kit, tm, 0.6, 1.2, 0.6, towerD, towerTop + 0.6, 0);
    }
    peak = { x: towerD, y: towerTop + 1.2 * ((towerTop - base) / 22), z: 0 };
    // swing arms at three levels, each moved onto the flank of a part and reaching that part's own hull
    const x0 = towerD - towerW / 2;
    const used = access ? [crewH] : [];
    for (const f of [0.3, 0.58, 0.84]) {
      const hh = empty ? H * f : ship.armHeight(FACING_DEG, H * f, used);
      if (hh == null || (empty && access && Math.abs(hh - crewH) < 1.4)) continue;
      used.push(hh);
      fit.arms.push([+hh.toFixed(2), +((empty ? 1.25 : ship.hullMax(hh - 0.31, hh + 0.31))).toFixed(2)]);
      if (mlTower) continue; // ML-1's own arms
      box(kit, M.grey, towerW + 0.6, 0.12, towerW + 0.6, towerD, top + hh - 0.32, 0); // service floor
      const xh = (empty ? 1.25 : ship.hullMax(hh - 0.31, hh + 0.31)) + 0.02;
      if (mTower) {
        // the model's swing arm (2.5 m long at H 20), stretched to reach this hull, or swung back along the tower face
        const arm = paint(copyOf(mTower, 'pose_arm_1'), tm.color);
        arm.position.set(x0 - 0.05, top + hh, 0);
        arm.scale.set(Math.max(0.3, x0 - 0.05 - xh) / 2.5, sw, sw);
        if (empty) arm.rotation.y = -Math.PI / 2;
        extras.push(arm);
        continue;
      }
      if (empty) swungBack(kit, x0, towerW);
      swingArm(kit, tm, x0, xh, top + hh);
      if (empty) kit.pop();
    }
    if (access) crew = { angle: 0, d: towerD, w: towerW };
    if (o.tower === 'rss') {
      // the rotating service structure, swung back 120° on its hinge column beside the tower
      const Dr = 2.6, P = [towerD - towerW / 2 - 0.1, -(R + 0.2 + Dr / 2)];
      const Lr = P[0] + R + 1.2, yb = y(0.28), yt = y(0.93);
      const mr = modelOf(ids.rss);
      if (mr) {
        // the model: mated along -x from its hinge (6.1 m long, 18.6 m tall at H 20), swung back 120 degrees
        const c = copyOf(mr);
        c.position.set(P[0], base, P[1]);
        c.scale.set(1, (yt - base) / 18.6, 1);
        const rot = c.getObjectByName('pose_rss');
        rot.scale.x = Lr / 6.1;
        rot.rotation.y = -120 * DEG;
        c.getObjectByName('rail').scale.set(Lr / 6.1, 1, Lr / 6.1);
        extras.push(c);
      } else {
      kit.push(trs(P[0], 0, P[1], 1, 1, 1, 0, -120 * DEG, 0));
      box(kit, M.white, Lr, yt - yb, Dr, -Lr / 2, (yb + yt) / 2, 0);
      for (let k = 1; k < 4; k++) box(kit, M.grey, Lr + 0.06, 0.14, Dr + 0.06, -Lr / 2, yb + ((yt - yb) * k) / 4, 0);
      box(kit, M.glass, 0.06, (yt - yb) * 0.7, Dr * 0.6, -Lr - 0.01, (yb + yt) / 2, 0); // the payload changeout room doors
      post(kit, M.steel, 0.35, yt - base, 0, base, 0); // hinge column
      for (const z of [-Dr / 2 + 0.3, Dr / 2 - 0.3]) box(kit, M.grey, 0.4, yb - base, 0.4, -Lr + 0.4, base + (yb - base) / 2, z);
      box(kit, M.steelDark, 1.2, 0.6, Dr, -Lr + 0.4, base + 0.3, 0); // wheel truck on the rail
      kit.pop();
      const rail = new THREE.TorusGeometry(Lr - 0.4, 0.07, 4, 36, 120 * DEG);
      kit.add(rail, M.steel, trs(P[0], base + 0.05, P[1], 1, 1, 1, -Math.PI / 2, 60 * DEG, 0));
      rail.dispose();
      }
    }
  } else if (o.tower === 'catch') {
    // Starbase-style integration tower: a wide square lattice, a carriage with two long catch arms ('chopsticks')
    // that pass either side of the ship near its top, and a quick-disconnect arm that feeds the upper ship
    // its top stands 1.05 × the ship's height above the mount top (Starbase: 146 m beside a 121–124 m Starship)
    const W = towerW + 0.6, x0 = towerD - W / 2, catchTop = top + H * 1.05;
    const ch = empty ? H * 0.82 : Math.min(H * 0.86, Math.max(H * 0.6, ship.capsule ? ship.capsule.y - 0.8 : H * 0.8));
    const yc = top + ch;
    const rArm = (empty ? 1.25 : ship.hullMax(ch - 0.6, ch + 0.6)) + 0.55;
    const tipX = empty ? x0 - 2.5 : -R * 0.7, open = empty ? 2.6 : rArm;
    fit.chopsticks = [+ch.toFixed(2), +rArm.toFixed(2)];
    const qh = empty ? H * 0.55 : ship.armHeight(FACING_DEG, H * 0.6, [ch, ...(access ? [crewH] : [])]);
    const qr = qh == null ? 0 : (empty ? 1.25 : ship.hullMax(qh - 0.31, qh + 0.31)) + 0.02;
    if (qh != null) fit.arms.push([+qh.toFixed(2), +qr.toFixed(2)]);
    const mc = modelOf(ids.tower);
    if (mc) {
      // the model (3.85 m wide, 26 m tall beside a 5 m mount at H 20): body stretched to mount top + 1.05 H, the
      // carriage at the catch height, the chopsticks turned to pass either side of the ship, the QD arm at its height
      const c = copyOf(mc), sw = W / 3.85, sy = (catchTop - base) / 30.5; // 26.5 m of tower and a 4 m rod at H 20
      c.position.set(towerD, base, 0);
      c.scale.set(sw, 1, sw);
      c.getObjectByName('body').scale.y = sy;
      const head = c.getObjectByName('head');
      head.position.y = 26.5 * sy;
      head.scale.y = sy;
      c.getObjectByName('pose_carriage').position.y = yc - base;
      for (const [name, s] of [['pose_chopstick_a', -1], ['pose_chopstick_b', 1]]) {
        const arm = c.getObjectByName(name);
        const px = towerD - 2.875 * sw, pz = s * 1.825 * sw; // its hinge in the pad's frame
        arm.rotation.y = Math.atan2(s * open - pz, px - Math.min(0, tipX + 2));
      }
      const qd = c.getObjectByName('pose_arm_qd');
      if (qh == null) qd.visible = false;
      else {
        qd.position.y = top + qh - base;
        qd.scale.x = Math.max(0.3, x0 - 0.05 - qr) / (2.5 * sw);
        if (empty) qd.rotation.y = -Math.PI / 2;
      }
      extras.push(c);
      peak = { x: towerD, y: catchTop, z: 0, rod: true };
    } else {
      lattice(kit, M.steelDark, { x: towerD, w: W, y0: base, y1: catchTop, bay: 2.6, t: 0.22 });
      box(kit, M.steelDark, W + 0.4, 0.4, W + 0.4, towerD, catchTop + 0.2, 0);
      post(kit, M.steel, 0.12, Math.max(1.5, H * 0.08), towerD, catchTop + 0.4, 0, CYL8); // lightning rod and antennas on the top
      peak = { x: towerD, y: catchTop + 0.4 + Math.max(1.5, H * 0.08), z: 0, rod: true };
      box(kit, M.grey, W + 0.9, 2.2, W + 0.9, towerD, yc, 0); // the carriage around the tower
      for (const s of [-1, 1]) {
        beam(kit, M.steel, [x0 - 0.2, yc, s * (W / 2 - 0.2)], [tipX, yc, s * open], 0.62);
        box(kit, M.yellow, 0.5, 0.5, 0.25, tipX, yc - 0.1, s * (open - 0.35)); // catch pads
      }
      // the quick-disconnect arm, lower down, reaching the hull
      if (qh != null) {
        if (empty) swungBack(kit, x0, W);
        swingArm(kit, M.steelDark, x0, qr, top + qh);
        if (empty) kit.pop();
      }
    }
    if (access) crew = { angle: 0, d: towerD, w: W };
  } else if (o.tower === 'strongback') {
    // close to the ship, but clear of the fins, legs and boosters near it
    const depth = 1.0, W = Math.max(2.0, R * 1.5);
    const x0 = Math.max(R + 1.0, ship.clearance(FACING_DEG, W / 2) + 0.35), sbTop = y(1.02), px = x0 + depth;
    fit.strongback = +x0.toFixed(2);
    const clamps = [];
    for (const f of [0.22, 0.52, 0.82]) {
      // clamp arms, opened: they stop a hand's width off the hull at their own height
      const hh = empty ? H * f : ship.armHeight(FACING_DEG, H * f, clamps.map((c) => c.hh));
      if (hh == null) continue;
      const xt = (empty ? 1.25 : ship.hullMax(hh - 0.35, hh + 0.35)) + 0.25;
      clamps.push({ hh, len: Math.max(0.3, x0 - xt) });
    }
    const ms = modelOf(ids.tower);
    if (ms) {
      // the model (1 x 2 m frame, 20 m above its 0.4 m hinge at H 20): leaned back 4 degrees on its hinge, the frame
      // stretched to 1.02 H, its three clamp arms moved to the fitted heights and lengths
      const c = copyOf(ms);
      c.position.set(x0 + depth / 2, base, 0);
      c.scale.set(1, 1, W / 2.0);
      c.getObjectByName('pose_frame').rotation.z = -4 * DEG;
      c.getObjectByName('body').scale.y = (sbTop - base - 0.4) / 20.0;
      for (let i = 0; i < 3; i++) {
        const node = c.getObjectByName(`pose_clamp_${i + 1}`);
        const cl = clamps[i];
        if (!cl) { node.visible = false; continue; }
        node.position.y = top + cl.hh - base - 0.4;
        node.scale.x = cl.len / 0.75;
      }
      extras.push(c);
    } else {
    kit.push(new THREE.Matrix4().makeTranslation(px, base, 0).multiply(new THREE.Matrix4().makeRotationZ(-4 * DEG)).multiply(new THREE.Matrix4().makeTranslation(-px, -base, 0)));
    lattice(kit, M.white, { x: x0 + depth / 2, w: depth, d: W, y0: base + 0.4, y1: sbTop, bay: 2.0, t: 0.24 });
    for (const { hh, len } of clamps) {
      box(kit, M.white, len, 0.3, 0.3, x0 - len / 2, top + hh, 0);
      box(kit, M.steelDark, 0.12, 0.7, 1.1, x0 - len - 0.06, top + hh, 0); // clamp jaws, open
    }
    pipe(kit, M.rubber, [x0 + 0.05, base + 0.6, W / 2 - 0.2], [x0 + 0.05, y(0.85), W / 2 - 0.2], 0.08);
    kit.pop();
    // the transporter-erector it stands on, and its lifting pistons
    box(kit, M.grey, 3.6, 0.6, W + 0.6, px + 1.6, base + 0.3, 0);
    for (const s of [-1, 1]) pipe(kit, M.steel, [px + 2.9, base + 0.6, s * (W / 2 - 0.2)], [px + Math.sin(4 * DEG) * H * 0.3, y(0.3), s * (W / 2 - 0.2)], 0.14);
    }
    peak = { x: x0 + depth / 2 + Math.sin(4 * DEG) * (sbTop - base), y: sbTop, z: 0 };
    if (access) crew = { angle: 55, d: Math.max(towerD, ship.clearance(FACING_DEG + 55, 1.0) + 1.5), w: 2.0, own: true };
  } else if (o.tower === 'gantry') {
    // the Soyuz service gantry: two halves hinged at their feet either side of the ship, about 0.95 × its height; they
    // close round the ship for the work and are lowered before launch, so the pad shows them lowered most of the way
    // (its own card picture shows them only just swinging back); work floors face the ship
    const gTop = top + H * 0.95, depth = Math.max(1.2, D * 0.5), wide = D * 1.6, tilt = (only === 'tower' ? 18 : 62) * DEG;
    for (const a of [90, 270]) {
      const dist = Math.max(R + 0.9, ship.clearance(FACING_DEG + a, wide / 2) + 0.4) + depth / 2, px = dist + depth / 2;
      kit.push(turn(a));
      kit.push(new THREE.Matrix4().makeTranslation(px, base, 0).multiply(new THREE.Matrix4().makeRotationZ(-tilt)).multiply(new THREE.Matrix4().makeTranslation(-px, -base, 0)));
      const mg = modelOf(ids.tower);
      if (mg) {
        // the model (one half: 1.4 m deep, 4 m wide, 19 m tall at H 20), in the same turned and tilted frame
        const c = copyOf(mg);
        c.scale.set(depth / 1.4, (gTop - base) / 19, wide / 4.0);
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(kit.stack[kit.stack.length - 1]).multiply(new THREE.Matrix4().makeTranslation(dist, base, 0));
        holder.add(c);
        extras.push(holder);
      } else {
        lattice(kit, M.grey, { x: dist, w: depth, d: wide, y0: base + 0.3, y1: gTop, bay: 2.2, t: 0.16 });
        for (let f = 0.15; f < 0.95; f += 0.16) box(kit, M.grey, 0.9, 0.1, wide * 0.85, dist - depth / 2 - 0.45, top + H * f, 0); // floors toward the ship
      }
      kit.pop();
      box(kit, M.steelDark, 1.0, 0.7, wide, px, base + 0.35, 0); // hinge block and its rams
      pipe(kit, M.steel, [px + 1.4, base + 0.2, wide * 0.3], [px - 0.4, base + H * 0.25, wide * 0.3], 0.12);
      kit.pop();
    }
    if (access) crew = { angle: 0, d: Math.max(R + 3.8, ship.clearance(FACING_DEG, 1.0) + 1.5), w: 2.0, own: true };
  } else if (o.tower === 'mst') {
    // a mobile service tower, rolled back along its rails before launch: about 3 × the ship's width square and 1.15 × its
    // height (Vostochny 48 m and 24.5 m square beside a 46 m Soyuz; ELS 52 m), its doors open toward the pad
    const F = F_MST, mH = H * 1.15;
    const x0 = mstFace, xc = x0 + F / 2;
    for (const s of [-1, 1]) box(kit, M.steel, xc + F / 2 + 2, 0.12, 0.2, (xc + F / 2 + 2) / 2 - 1, base + 0.06, s * F * 0.36); // its rails
    const mm = modelOf(ids.tower);
    if (mm) {
      // the model (7.5 m square, 23 m tall at H 20), rolled back with its door leaves swung open toward the pad
      const c = copyOf(mm);
      c.position.set(xc, base, 0);
      c.scale.set(F / 7.5, mH / 23, F / 7.5);
      c.getObjectByName('pose_door_a').rotation.y = -0.55 * Math.PI;
      c.getObjectByName('pose_door_b').rotation.y = 0.55 * Math.PI;
      extras.push(c);
    } else {
      for (const s of [-1, 1]) box(kit, M.white, F, mH, 0.25, xc, base + 0.6 + mH / 2, s * F / 2); // side walls
      box(kit, M.white, 0.25, mH, F, xc + F / 2, base + 0.6 + mH / 2, 0); // back wall
      for (const s of [-1, 1]) box(kit, M.white, F * 0.5, mH * 0.95, 0.18, x0 + F * 0.25, base + 0.6 + mH * 0.475, s * (F / 2 + 0.25)); // door leaves folded open
      for (let k = 1; k <= 6; k++) box(kit, M.grey, F - 0.4, 0.12, F - 0.4, xc, base + 0.6 + (mH * k) / 7, 0); // work floors inside
      for (const [cx, cz] of [[x0, F / 2], [x0, -F / 2], [xc + F / 2, F / 2], [xc + F / 2, -F / 2]]) box(kit, M.grey, 0.45, mH + 0.1, 0.45, cx, base + 0.6 + mH / 2, cz); // corner frames
      box(kit, M.grey, F + 0.4, 0.4, F + 0.4, xc, base + 0.8 + mH, 0); // roof
      box(kit, M.grey, F * 0.8, 0.5, 0.6, xc - F * 0.1, base + 1.3 + mH, 0); // roof crane
      for (const [cx, cz] of [[x0 + 0.8, F * 0.36], [x0 + 0.8, -F * 0.36], [xc + F / 2 - 0.8, F * 0.36], [xc + F / 2 - 0.8, -F * 0.36]]) box(kit, M.steelDark, 1.4, 0.6, 0.7, cx, base + 0.3, cz); // wheel bogies
    }
    peak = { x: xc, y: base + 1.0 + mH, z: 0 };
    if (access) crew = { angle: -70, d: Math.max(R + 3.8, ship.clearance(FACING_DEG - 70, 1.0) + 1.5), w: 2.0, own: true }; // clear of the rolled-back tower
  } else if (access) {
    crew = { angle: 0, d: Math.max(R + 3.8, ship.clearance(FACING_DEG, 1.0) + 1.5), w: 2.0, own: true };
  }

  // ----- crew access arm and escape -----
  if (crew) {
    kit.push(turn(crew.angle));
    if (crew.own) {
      // a slim stair tower just for the crew
      lattice(kit, M.grey, { x: crew.d, w: crew.w, y0: base, y1: accessY + 2.6, bay: 2.2, t: 0.15 });
      box(kit, M.grey, crew.w + 0.5, 0.15, crew.w + 0.5, crew.d, accessY + 2.6, 0);
    }
    const x0 = crew.d - crew.w / 2, room = 1.5;
    box(kit, M.grey, crew.w + 0.6, 0.14, crew.w + 0.6, crew.d, accessY - 1.05, 0); // crew level
    // the white room stands off the widest hull beside it; a short boxed seal reaches in to the capsule wall at the hatch
    const rHatch = hull(crewH), xr = (empty ? 1.25 : ship.hullMax(crewH - 0.95, crewH + 1.05)) + 0.03;
    fit.crew = [+rHatch.toFixed(2), +xr.toFixed(2), +crew.d.toFixed(2)];
    const mca = modelOf(ids.crewArm);
    const arm = mca && copyOf(mca, 'pose_arm');
    if (arm) {
      // the model: hinge on the tower face, walkway (1 m at D 2.5) stretched to the white room, which keeps its size;
      // on an empty stand it is swung back along the tower face
      const walk = Math.max(0.3, x0 - (xr + room));
      arm.position.copy(kitPoint(x0, accessY - 0.95, 0));
      arm.rotation.y = (crew.angle + (empty ? -90 : 0)) * DEG;
      arm.getObjectByName('walkway').scale.x = walk / 1.0;
      arm.getObjectByName('white_room').position.x = -walk;
      extras.push(arm);
      if (!empty && xr - rHatch > 0.29) box(kit, M.grey, xr - rHatch - 0.21, 1.1, 1.1, (xr + rHatch - 0.25) / 2, accessY + 0.05, 0); // the hatch seal
    } else {
      if (empty) swungBack(kit, x0, crew.w);
      box(kit, M.white, x0 - (xr + room), 1.9, 1.3, (x0 + xr + room) / 2, accessY, 0); // the walkway
      for (const s of [-1, 1]) box(kit, M.glass, x0 - (xr + room) - 0.2, 0.35, 0.04, (x0 + xr + room) / 2, accessY + 0.35, s * 0.66);
      box(kit, M.white, room, 2.0, 1.8, xr + room / 2, accessY + 0.05, 0); // the white room at the hatch
      box(kit, M.grey, room + 0.1, 0.12, 1.9, xr + room / 2, accessY + 1.1, 0);
      if (!empty && xr - rHatch > 0.04) box(kit, M.grey, xr - rHatch + 0.04, 1.1, 1.1, (xr + rHatch) / 2, accessY + 0.05, 0); // the hatch seal
      if (empty) kit.pop();
    }
    if (o.access === 'chute') {
      // SLC-40's escape chute: packed at the crew level, two guide cables to an anchor on the ground; deployed in its
      // own card picture
      const xs = crew.d + crew.w / 2 + 0.5, xe = crew.d + Math.max(5, (accessY - base) * 0.45);
      for (const z of [-0.5, 0.5]) pipe(kit, M.wire, [xs, accessY - 0.4, z], [xe, 0.35, z], 0.025);
      box(kit, M.orange, 0.9, 0.9, 1.2, xs, accessY - 0.7, 0); // the packed chute
      box(kit, M.concreteOld, 1.0, 0.5, 1.6, xe + 0.3, 0.25, 0); // the anchor at the bottom
      if (only === 'access') beam(kit, M.orange, [xs, accessY - 1.1, 0], [xe - 0.3, 0.7, 0], 0.5, CYL8);
    }
    if (o.access === 'blastroom') {
      // Apollo's way down: a slide tube from the platform base into a blast room under the pad (its hatch and vent here)
      const bx = crew.d + crew.w / 2 + 2.2, bz = -crew.w;
      pipe(kit, M.steel, [crew.d, base + 1.2, bz * 0.5], [bx - 0.6, 0.3, bz], 0.45);
      box(kit, M.concreteOld, 2.4, 0.9, 2.4, bx, 0.45, bz); // the blast room's entrance block
      box(kit, M.steelDark, 0.06, 0.7, 0.9, bx - 1.22, 0.45, bz); // its vault door
      post(kit, M.steel, 0.18, 1.4, bx + 0.6, 0, bz + 0.6, CYL8); // air vent
    }
    if (o.access === 'slidewire' || o.access === 'blastroom') {
      // steel wires from the crew level down to a bunker, escape baskets parked at the top
      const xs = crew.d + crew.w / 2, xe = crew.d + (icon ? 8 : 17);
      const me = modelOf(ids.egress);
      // the model's baskets (Artemis: up to five people each) are about 2 m tall: the wires spread to fit them
      const zs = me ? [-1.5, -0.5, 0.5, 1.5] : [-0.8, -0.27, 0.27, 0.8];
      for (const z of zs) {
        const curve = cable(kit, M.wire, [xs, accessY - 0.3, z], [xe, 0.9, z * (me ? 1.2 : 1.6)], 0.6, 0.025);
        const p = curve.getPoint(0.05);
        const basket = me && copyOf(me, 'basket');
        if (basket) {
          basket.position.copy(kitPoint(p.x, p.y, p.z));
          basket.rotation.y = crew.angle * DEG;
          basket.scale.setScalar(0.8);
          extras.push(basket);
          continue;
        }
        box(kit, M.wire, 0.03, 0.5, 0.03, p.x, p.y - 0.25, p.z);
        box(kit, M.yellow, 0.75, 0.55, 0.55, p.x, p.y - 0.75, p.z);
        box(kit, M.yellow, 0.85, 0.06, 0.65, p.x, p.y - 0.42, p.z);
      }
      const bunker = me && copyOf(me, 'bunker');
      if (bunker) {
        // the model: the bunker with its blast door toward the wires, earth banked on that side, the catch-net posts
        bunker.position.copy(kitPoint(xe + 2.4, 0, 0));
        bunker.rotation.y = crew.angle * DEG;
        extras.push(bunker);
      } else {
        for (const s of [-1, 1]) post(kit, M.steel, 0.1, 2.4, xe - 0.5, 0, s * 2.2); // catch-net posts
        box(kit, M.concreteOld, 3.2, 1.7, 3.6, xe + 2.4, 0.85, 0); // the bunker
        box(kit, M.concreteOld, 4.4, 0.8, 4.8, xe + 2.4, 0.4, 0);
        box(kit, M.trench, 0.05, 1.1, 1.0, xe + 0.79, 0.75, 0);
      }
    }
    kit.pop();
  }

  // ----- hold-down clamps: they grip the bottom of the lowest part above the engines -----
  if (o.clamps === 'hold' || o.clamps === 'release') {
    const big = o.clamps === 'release';
    const gy = bare ? 0.6 : Math.min(4.5, Math.max(0.5, ship.lowest ? ship.lowest.y : 0.6)); // grip height above the ship's base
    const rg = ship.lowest ? surfaceOf(ship.lowest, 0.02) : R;
    const rc = rg + (big ? 0.75 : 0.5); // the column's distance from the axis
    fit.grip = [+gy.toFixed(2), +rg.toFixed(2)];
    const mh = modelOf(ids.holddown);
    for (const a0 of [22.5, 112.5, 202.5, 292.5]) {
      // the usual angle, or a little either side if a side part comes down there
      const a = [a0, a0 + 11.25, a0 - 11.25].find((t) => empty || !ship.blocked(t, 0, gy + 0.3, 0.4));
      if (a == null) continue;
      kit.push(turn(wa(a)));
      // the model: base, a column stretched to the grip and the head at the grip (a Saturn arm needs room for its base)
      const kind = big ? 'arm_saturn' : 'clamp', baseH = big ? 0.5 : 0.35;
      if (mh && gy >= baseH + 0.15) {
        const parts = [copyOf(mh, `${kind}_base`), copyOf(mh, `${kind}_column`), copyOf(mh, `${kind}_head`)];
        if (parts.every(Boolean)) {
          const [b, c, h] = parts;
          for (const [obj, yy] of [[b, top], [c, top + baseH], [h, top + gy]]) {
            obj.position.copy(kitPoint(rc, yy, 0));
            obj.rotation.y = wa(a) * DEG;
            extras.push(obj);
          }
          c.scale.y = Math.max(0.05, gy - baseH - (big ? 0.0 : 0.02));
          kit.pop();
          continue;
        }
      }
      if (big) {
        // a Saturn-style hold-down arm: a heavy column, its blast hood, the arm over the rim, a controlled-release pin
        box(kit, M.steelDark, 1.0, 0.5, 0.9, rc, top + 0.25, 0);
        box(kit, M.steelDark, 0.55, gy, 0.6, rc, top + gy / 2, 0);
        box(kit, M.steel, 0.6, 0.45, 0.75, rc + 0.05, top + gy + 0.3, 0, 0, 0, 0.35);
        beam(kit, M.steel, [rc, top + gy + 0.05, 0], [rg - 0.12, top + gy + 0.05, 0], 0.24);
        box(kit, M.steel, 0.12, 0.42, 0.4, rg - 0.12, top + gy - 0.08, 0);
        post(kit, M.yellow, 0.07, 0.7, rc, top + Math.max(0.5, gy - 0.6), 0.48, CYL8);
      } else {
        // a clamp column with a jaw that hooks under the rim, and its hydraulic cylinder
        box(kit, M.steel, 0.6, 0.35, 0.5, rc, top + 0.18, 0);
        box(kit, M.steel, 0.32, gy, 0.36, rc, top + gy / 2, 0);
        box(kit, M.steel, rc - rg + 0.3, 0.16, 0.34, (rc + rg - 0.12) / 2, top + gy - 0.1, 0);
        box(kit, M.steelDark, 0.1, 0.3, 0.34, rg + 0.07, top + gy + 0.05, 0);
        pipe(kit, M.steelDark, [rc + 0.35, top + 0.05, 0], [rc + 0.12, top + gy * 0.8, 0], 0.06);
      }
      kit.pop();
    }
  }
  // ----- the Soyuz support arms ('tulip'): they hold the ship by its sides over the opening, by its own weight, and
  // swing back on their counterweights as it rises -----
  if (o.clamps === 'tulip' && !near) {
    const gy = bare ? 0.9 : Math.min(3.2, Math.max(0.9, ship.lowest ? ship.lowest.y + 0.3 : 1.2));
    const rg = empty || !ship.lowest ? R : surfaceOf(ship.lowest, 0.05);
    const px = Math.max(hole / 2 + 0.35, rg + 0.7);
    const wy = Math.max(hs + 0.45, top - 1.6); // the counterweight hangs below the ring where there is room
    const mt = modelOf(ids.tulip);
    fit.tulip = [+gy.toFixed(2), +rg.toFixed(2)];
    for (const a0 of [22.5, 112.5, 202.5, 292.5]) {
      const a = [a0, a0 + 11.25, a0 - 11.25].find((t) => empty || !ship.blocked(t, 0, gy + 0.3, 0.4));
      if (a == null) continue;
      kit.push(turn(wa(a)));
      box(kit, M.steelDark, 0.7, 0.6, 0.7, px, top + 0.3, 0); // the pivot block on the ring
      const tip = empty ? [px + 1.4, top + gy + 1.6, 0] : [rg + 0.08, top + gy, 0];
      if (mt) {
        // the model's arm: hinge at its origin 0.3 m above the ring, +x outward, its head 0.69 m in and 2.4 m up at
        // D 2.5; turned and scaled about its hinge so the head meets this ship's side (or stands open)
        const arm = copyOf(mt, 'pose_arm_1');
        const hy = top + 0.3 * across, vx = tip[0] - px, vy = tip[1] - hy;
        arm.position.copy(kitPoint(px, hy, 0));
        arm.rotation.set(0, wa(a) * DEG, Math.atan2(vy, vx) - Math.atan2(2.4, -0.69));
        arm.scale.setScalar(Math.hypot(vx, vy) / Math.hypot(0.69, 2.4));
        extras.push(arm);
        kit.pop();
        continue;
      }
      beam(kit, M.green, [px, top + 0.6, 0], tip, 0.32);
      box(kit, M.steelDark, 0.25, 0.7, 0.55, tip[0] + 0.1, tip[1], 0); // the grip on the ship's side
      beam(kit, M.green, [px, top + 0.6, 0], [px + 1.2, wy + 0.4, 0], 0.28); // the counterweight lever
      box(kit, M.concreteOld, 0.9, 0.9, 0.9, px + 1.3, wy, 0); // the counterweight
      kit.pop();
    }
  }
  // with nothing to hold it, the ship stands on four short support posts at the rim of the opening
  if (o.clamps === 'none' && o.mount !== 'slab' && !near && !only) {
    const rg = empty || !ship.lowest ? R : surfaceOf(ship.lowest, 0.02);
    for (const a of [22.5, 112.5, 202.5, 292.5]) {
      kit.push(turn(wa(a)));
      const x1 = hole / 2 + 0.35, x0 = Math.min(rg * 0.85, hole / 2 - 0.1);
      box(kit, M.steelDark, x1 - x0, 0.3, 0.45, (x0 + x1) / 2, top + 0.15, 0);
      kit.pop();
    }
  }

  // ----- sound suppression water -----
  if (o.deluge !== 'none') {
    const ringR = o.mount === 'slab' ? R * 1.6 : hole * 0.62 + 0.25;
    const ring = new THREE.TorusGeometry(ringR, 0.1, 6, 40);
    kit.add(ring, M.steel, trs(0, top + 0.12, 0, 1, 1, 1, Math.PI / 2));
    ring.dispose();
    for (let k = 0; k < 12; k++) {
      const [nx, nz] = polar(k * 30 + 15, ringR - 0.12);
      post(kit, M.steelDark, 0.05, 0.16, nx, top + 0.12, nz, CYL8);
    }
    // the feed: out to the edge of the mount, down to the pad, then away along the concrete
    const fa = wa(300);
    const edge = o.mount === 'deflector' || o.mount === 'trench' ? ringS / 2 + 0.25 : ringR + 1.1;
    const at = (r, h) => { const [px, pz] = polar(fa, r); return [px, h, pz]; };
    pipe(kit, M.steel, at(ringR, top + 0.12), at(edge, top + 0.12), 0.1);
    if (only === 'deluge') {
      // its card picture shows the water on: a fan of spray rising from every nozzle
      for (let k = 0; k < 12; k++) {
        const [nx, nz] = polar(k * 30 + 15, ringR - 0.12);
        kit.add(CONE, M.water, trs(nx * 0.93, top + 0.75, nz * 0.93, 0.28, 1.1, 0.28, Math.PI));
      }
    }
    if (o.mount !== 'mlp') {
      if (top - hs > 0.2) pipe(kit, M.steel, at(edge, top + 0.17), at(edge, hs + 0.07), 0.1);
      pipe(kit, M.steel, at(edge, hs + 0.12), at(RH * 0.85, hs + 0.12), 0.1);
    }
    if (o.deluge === 'iop') {
      // the overpressure water: bags of water stretched across the opening under the engines (they burst into a wall of spray)
      for (const s of [-1, 1]) box(kit, M.bag, hole * 0.9, 0.22, hole * 0.32, 0, top - 0.25, s * hole * 0.24);
    }
    if (o.deluge === 'tower' || o.deluge === 'iop') {
      // rainbird nozzles around the ship, and the tall water tower that feeds them
      const rbY = o.mount === 'slab' || o.mount === 'mlp' ? top : hs;
      const rbR = o.mount === 'mlp' ? hole * 0.5 + 1.6 : o.mount === 'slab' ? R * 2.4 : ringS / 2 + 1.0;
      for (let k = 0; k < 6; k++) {
        const a = wa(k * 60 + 30);
        const [bx, bz] = polar(a, rbR), [nx, nz] = polar(a, rbR - 0.6);
        post(kit, M.steel, 0.12, 1.4, bx, rbY, bz, CYL8);
        pipe(kit, M.steel, [bx, rbY + 1.35, bz], [nx, rbY + 1.6, nz], 0.1);
        post(kit, M.steelDark, 0.16, 0.25, nx, rbY + 1.5, nz, CYL8);
        if (only === 'deluge') cable(kit, M.water, [nx, rbY + 1.6, nz], [nx * 0.2, top + 0.3, nz * 0.2], -0.7, 0.2); // a rainbird's arc of water
      }
      const [wx, wz] = polar(80, icon ? RH + 2.5 : 14);
      const wh = Math.max(12, H * 0.75 + 4);
      const mw = modelOf(ids.water);
      if (mw) {
        // the model is Pad 39B's real tower (88.8 m): drawn at the size the code gives it here, its outlet toward the pad
        const c = copyOf(mw);
        c.scale.setScalar((wh + 4.4) / 88.8);
        c.position.set(wx, 0, wz);
        c.rotation.y = Math.atan2(-wz, wx);
        extras.push(c);
      } else {
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) beam(kit, M.grey, [wx + dx * 1.9, 0, wz + dz * 1.9], [wx + dx * 1.2, wh, wz + dz * 1.2], 0.22);
      for (let h = 3; h < wh; h += 3.5) box(kit, M.grey, 2.9 - (h / wh) * 1.2, 0.14, 2.9 - (h / wh) * 1.2, wx, h, wz);
      post(kit, M.steel, 0.35, wh, wx, 0, wz); // riser
      post(kit, M.white, 2.2, 3.4, wx, wh, wz);
      sphere(kit, M.white, 2.2, wx, wh + 3.4, wz, 0.45);
      pipe(kit, M.steel, [wx, 0.25, wz], [wx * 0.45, 0.25, wz * 0.45], 0.25);
      }
    }
  }

  // ----- lightning protection -----
  if (o.lightning === 'mast') {
    let mx, mz, mt;
    if (peak && (o.tower === 'fixed' || o.tower === 'rss' || o.tower === 'catch')) { mx = peak.x; mz = 0; mt = peak.y; }
    else {
      [mx, mz] = polar(o.tower === 'mst' ? 160 : -30, icon ? RH * 0.8 : farR); // clear of a rolled-back service tower and of the camera's line
      mt = towerTop;
      const ml = modelOf(ids.lightning);
      if (ml) {
        const c = copyOf(ml);
        c.scale.setScalar((mt + Math.max(5, H * 0.28)) / 183.8);
        c.position.set(mx, 0, mz);
        extras.push(c);
      } else lattice(kit, M.grey, { x: mx, z: mz, w: 1.1, y0: 0, y1: mt, bay: 2.6, t: 0.14 });
    }
    const onTower = !!(peak && (o.tower === 'fixed' || o.tower === 'rss' || o.tower === 'catch'));
    const mh = onTower ? H * 0.12 : Math.max(5, H * 0.28);
    if (!onTower && modelOf(ids.lightning)) { /* the model has its own fibreglass mast */ } else kit.add(CONE, M.white, trs(mx, mt + mh / 2, mz, 0.22, mh, 0.22));
    // the cable from the mast tip to an anchor on each side
    const dir = o.tower === 'fixed' || o.tower === 'rss' || o.tower === 'catch' ? [0, 1] : [-Math.sin(30 * DEG), Math.cos(30 * DEG)];
    for (const s of [-1, 1]) {
      const reach = icon ? 6 : 13, ax = mx + s * dir[0] * reach, az = mz + s * dir[1] * reach;
      cable(kit, M.wire, [mx, mt + mh - 0.3, mz], [ax, 0.5, az], 1.2, 0.03);
      box(kit, M.concreteOld, 0.9, 0.6, 0.9, ax, 0.3, az);
    }
  } else if (o.lightning === 'rod') {
    // a lightning rod on the top of the tallest tower (a catch tower already carries one), else on a pole beside the pad
    const rh = Math.max(1.5, H * 0.12);
    if (peak && !peak.rod) post(kit, M.steel, 0.07, rh, peak.x, peak.y, peak.z, CYL8);
    else if (!peak) {
      const [px, pz] = polar(-30, icon ? RH * 0.8 : 8.5), ph = top + H * 0.75;
      post(kit, M.grey, 0.14, ph, px, 0, pz, CYL8);
      post(kit, M.steel, 0.05, rh, px, ph, pz, CYL8);
    }
  } else if (o.lightning === 'catenary') {
    const Rc = icon ? RH + 1.5 : Math.max(12.5, farR), hc = top + H * (icon ? 1.15 : 1.45) + 3, mh = Math.max(5, H * 0.3);
    const tops = [];
    for (const a of [20, 140, 260]) {
      const [cx, cz] = polar(a, Rc);
      const ml = modelOf(ids.lightning);
      if (ml) {
        const c = copyOf(ml);
        c.scale.setScalar((hc + mh) / 183.8);
        c.position.set(cx, 0, cz);
        c.rotation.y = a * DEG;
        extras.push(c);
      } else {
        lattice(kit, M.grey, { x: cx, z: cz, w: 1.0, y0: 0, y1: hc, bay: 3, t: 0.12, ry: a });
        kit.add(CONE, M.white, trs(cx, hc + mh / 2, cz, 0.25, mh, 0.25));
      }
      tops.push([cx, hc + mh * 0.8, cz]);
      if (!icon) {
        const [ox, oz] = polar(a, Rc + 3.5);
        cable(kit, M.wire, [cx, hc + mh * 0.8, cz], [ox, 0.5, oz], 1.0, 0.035);
        box(kit, M.concreteOld, 0.9, 0.6, 0.9, ox, 0.3, oz);
      }
    }
    for (let k = 0; k < 3; k++) cable(kit, M.wire, tops[k], tops[(k + 1) % 3], 3.0, 0.035);
  }

  // ----- propellant loading (left out of a complex's card picture; drawn close in for its own picture) -----
  const showFar = (!icon || near) && !(sea && !near); // at sea: no storage, tanker or weather station on the water
  const feed = (x, z, r = 0.2) => {
    // a pipe along the ground from storage to the pad's edge, then up to the umbilical
    if (near) return;
    const len = Math.hypot(x, z), ex = (x / len) * RH * 0.9, ez = (z / len) * RH * 0.9;
    pipe(kit, M.steel, [x, 0.3, z], [ex, 0.3, ez], r);
  };
  if (showFar && o.propellant === 'manual') {
    // a road tanker backed up to the pad, its hose run up onto the concrete
    const rc = near ? 0 : RH + 3.8;
    const [tx, tz] = polar(150, rc);
    kit.push(trs(tx, 0, tz, 1, 1, 1, 0, 150 * DEG, 0));
    box(kit, M.steelDark, 6.0, 0.35, 1.9, 0, 0.75, 0);
    kit.add(CYL, M.steel, trs(-0.7, 1.75, 0, 0.95, 4.4, 0.95, 0, 0, Math.PI / 2));
    box(kit, M.white, 1.5, 2.0, 2.0, 2.2, 1.55, 0);
    box(kit, M.glass, 0.05, 0.6, 1.7, 2.96, 2.05, 0);
    for (const wx of [-2.2, -1.3, 2.3]) for (const s of [-1, 1]) kit.add(CYL, M.rubber, trs(wx, 0.5, s * 0.95, 0.5, 0.35, 0.5, Math.PI / 2));
    kit.pop();
    if (!near) {
      const [hx0, hz0] = polar(150, rc - 3.0), [ex, ez] = polar(150, RH - 0.5);
      cable(kit, M.rubber, [hx0, 1.0, hz0], [ex, hs + 0.15, ez], 0.3, 0.08);
    }
  } else if (showFar && (o.propellant === 'auto' || o.propellant === 'loadgo')) {
    // insulated storage spheres, the oxidiser (bigger) and the fuel
    [[105, 2.4], [124, 2.0]].forEach(([a, r], i) => {
      const [sx, sz] = polar(near ? a * 3 : a, near ? 3.2 : 15.5);
      const legH = 1.5;
      const ms = modelOf(ids.spheres[i]);
      if (ms) {
        const c = copyOf(ms);
        c.scale.setScalar((legH + 2 * r) / (i === 0 ? 26.7 : 24.6));
        c.position.set(sx, 0, sz);
        c.rotation.y = Math.atan2(-sz, sx);
        extras.push(c);
      } else {
        for (let k = 0; k < 8; k++) { const [lx, lz] = polar(k * 45, r * 0.7); post(kit, M.grey, 0.12, legH + r * 0.6, sx + lx, 0, sz + lz, CYL8); }
        sphere(kit, M.white, r, sx, legH + r, sz);
        box(kit, M.grey, 1.0, 0.1, 1.0, sx, legH + 2 * r + 0.05, sz);
      }
      feed(sx, sz);
    });
    if (o.propellant === 'loadgo') {
      // the propellant chilling plant: storage bullets and a heat exchanger with its fans
      const [cx, cz] = polar(210, near ? 6 : 16);
      kit.push(trs(cx, 0, cz, 1, 1, 1, 0, 120 * DEG, 0));
      for (const s of [-1, 1]) {
        kit.add(CYL, M.white, trs(0, 1.3, s * 1.2, 0.85, 4.2, 0.85, 0, 0, Math.PI / 2));
        for (const e of [-1, 1]) sphere(kit, M.white, 0.85, e * 2.1, 1.3, s * 1.2, 1);
        for (const e of [-1.4, 1.4]) box(kit, M.grey, 0.3, 0.7, 0.9, e, 0.35, s * 1.2);
      }
      box(kit, M.grey, 2.6, 1.8, 1.8, 0, 0.9, -3.4);
      for (const fx of [-0.8, 0, 0.8]) post(kit, M.steelDark, 0.38, 0.25, fx, 1.8, -3.4);
      kit.pop();
      feed(cx, cz, 0.16);
    }
  }

  // ----- weather watch (left out of a complex's card picture) -----
  if (near && only === 'weather' && o.weather === 'none') {
    // looking at the sky: a windsock on a pole is all there is
    post(kit, M.steel, 0.08, 6, 0, 0, 0, CYL8);
    kit.add(CONE, M.red, trs(1.1, 5.6, 0, 0.45, 2.2, 0.45, 0, 0, -Math.PI / 2 + 0.2));
  }
  if (showFar && (o.weather === 'balloons' || o.weather === 'radar')) {
    const [hx, hz] = polar(-50, near ? far(11) : Math.min(groundR - 4, Math.max(11, farR)));
    box(kit, M.white, 2.2, 1.8, 1.8, hx, 0.9, hz);
    box(kit, M.grey, 2.5, 0.15, 2.1, hx, 1.88, hz);
    // a weather balloon on its way up, and wind towers with cup anemometers
    const by = near ? 7 : 15;
    sphere(kit, M.white, 0.7, hx - 1.5, by, hz + 1.0, 1.1);
    box(kit, M.wire, 0.015, 1.6, 0.015, hx - 1.5, by - 1.6, hz + 1.0);
    for (const [a, d, h0] of [[-50, 12.6, 10], [30, 9.5, 8], [280, 9.5, 8]]) {
      const h = near ? h0 * 0.55 : h0;
      const [px, pz] = a === -50 ? [hx + 1.6, hz] : polar(a, far(d) + (near ? 2.5 : 0));
      post(kit, M.steel, 0.08, h, px, 0, pz, CYL8);
      for (const k of [0.55, 1]) { box(kit, M.steel, 1.0, 0.05, 0.05, px, h * k, pz); sphere(kit, M.steelDark, 0.09, px + 0.5, h * k + 0.08, pz); sphere(kit, M.steelDark, 0.09, px - 0.5, h * k + 0.08, pz); }
    }
  }
  if (showFar && o.weather === 'radar') {
    // a weather radar under its dome, and field mills that measure the charge in the air
    const [rx, rz] = polar(-35, near ? 4.5 : 15);
    const mr = modelOf(ids.weather);
    if (mr) {
      const c = copyOf(mr, 'radar');
      c.position.set(rx, 0, rz);
      c.rotation.y = Math.atan2(-rz, rx);
      extras.push(c);
    } else {
      lattice(kit, M.grey, { x: rx, z: rz, w: 1.8, y0: 0, y1: 6, bay: 2, t: 0.15 });
      box(kit, M.grey, 2.4, 0.2, 2.4, rx, 6.1, rz);
      sphere(kit, M.white, 1.8, rx, 7.6, rz, 1);
    }
    for (const a of [-100, -10, 75, 162, 220]) {
      const [fx, fz] = polar(a, near ? 6 : 10.5);
      const mill = mr && copyOf(mr, 'field_mill');
      if (mill) { mill.position.set(fx, 0, fz); extras.push(mill); continue; }
      post(kit, M.steel, 0.06, 0.9, fx, 0, fz, CYL8);
      post(kit, M.steelDark, 0.28, 0.14, fx, 0.9, fz);
    }
  }

  // a card picture of a whole complex: a plain white rocket on the mount, so it reads as a launch pad
  if (icon && !only) {
    const rr = R * 0.92, hb = H * 0.78;
    post(kit, M.steelDark, rr * 0.6, 1.0, 0, top, 0);
    post(kit, M.white, rr, hb, 0, top + 1.0, 0);
    kit.add(CONE, M.white, trs(0, top + 1.0 + hb + 1.6, 0, rr, 3.2, rr));
    post(kit, M.steelDark, rr * 1.01, 0.3, 0, top + 1.0 + hb * 0.62, 0); // a dark band between the tanks
  }

  const g = new THREE.Group();
  g.name = 'launch-pad';
  const inner = new THREE.Group();
  inner.rotation.y = FACING;
  kit.build(inner);
  for (const e of extras) inner.add(e); // Blender models placed instead of procedural pieces
  g.add(inner);
  g.userData.padOptions = { site: site?.id ?? null, ...o };
  g.userData.fit = fit;
  g.userData.padModels = wanted;
  if (icon) g.scale.setScalar(0.4); // the picture camera sees about 100 m: keep the whole complex well inside it
  // models still on their way: when they have all arrived (or failed), draw again and swap the contents in place, as
  // long as the pad is still in a scene (a scene that moved on to another pad has dropped this one)
  if (pending.length) {
    Promise.all(pending).then(() => {
      if (!g.parent) return;
      if (!wanted.some((id) => groundModels.get(id)?.scene)) return;
      redrawInPlace(g, padArt(state, opts));
    });
  }
  return { object: g, top };
}
