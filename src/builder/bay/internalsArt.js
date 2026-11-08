// What a part looks like inside: small 3D pieces for every slot of a kit (sections/<id>/internals.json), so the design page
// can pull a selected part apart like an exploded engineering drawing. Each piece stands where it lives in the part
// (metres, part base at y = 0) and carries the direction it slides out in when the view explodes.
import { isBuilderModel, modelSlotPiece, modelSlotHides } from './nasa.js';
import * as THREE from 'three';
import { std } from './util.js';
import { sectionInternalsArt } from './partArt.js';

const STEEL = std(0xaab1b8, { roughness: 0.35, metalness: 0.9 });
const COPPER = std(0xb87333, { roughness: 0.35, metalness: 0.9 });
const DARK = std(0x2a2e33, { roughness: 0.55, metalness: 0.6 });
const GOLD = std(0xc9a24a, { roughness: 0.3, metalness: 0.9 });
const ALU = std(0xd9dde2, { roughness: 0.35, metalness: 0.8 });
const RUBBER = std(0x15181b, { roughness: 0.95, metalness: 0 });
const AMBER = std(0xf59e0b, { roughness: 0.5, metalness: 0.4 });
const FOAM = std(0xd9772f, { roughness: 0.95, metalness: 0 });
const GLASS = () => new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });

const cyl = (rt, rb, h, m, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const sphere = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m);
const torus = (r, t, m) => { const o = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 48), m); o.rotation.x = Math.PI / 2; return o; };
const lathe = (pts, m) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40), m);
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const group = (...objs) => { const g = new THREE.Group(); g.add(...objs); return g; };

/**
 * Pieces for one part: [{ key, name, object, dir: THREE.Vector3 }]. `key` is the kit slot key; the chosen option
 * changes small details (a second computer, a longer skirt). `radius` and `height` are the part's.
 */
export function internalsArt(def, options, dims = {}) {
  const pieces = internalsArtDrawn(def, options, dims) ?? [];
  // Role 1's Blender model may carry its own inner pieces (nodes slot_<key>): they replace the drawn ones
  if (!isBuilderModel(def.id)) return pieces;
  for (const p of pieces) {
    const own = modelSlotPiece(def.id, p.key, options?.[p.key]?.id ?? null);
    if (own) p.object = own;
  }
  // a piece another chosen piece replaces (the docking port under a glass dome) is not drawn, as on the ship
  const ids = Object.fromEntries(Object.entries(options ?? {}).map(([k, o]) => [k, o?.id ?? null]));
  const hidden = modelSlotHides(def.id, ids);
  return pieces.filter((p) => !hidden[p.key]);
}

function internalsArtDrawn(def, options, { radius = 1.25, height = 1 } = {}) {
  const own = sectionInternalsArt(def, options, { radius, height });
  if (own) return own;
  const kit = def.internals;
  const h = height, r = radius;
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.clone().normalize() });
  const L = new THREE.Vector3(-1, 0, 0), R = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3(0, 1, 0), D = new THREE.Vector3(0, -1, 0), F = new THREE.Vector3(0, 0, 1);

  if (kit === 'engine') {
    // turbopump pack above the chamber: two pump housings on a shaft, a gas generator, ducts
    const pump = group(at(cyl(0.22 * r, 0.22 * r, 0.3 * h, STEEL), -0.18 * r, 0.86 * h, 0), at(cyl(0.2 * r, 0.2 * r, 0.26 * h, STEEL), 0.2 * r, 0.86 * h, 0), at(box(0.55 * r, 0.06, 0.06, DARK), 0, 0.86 * h, 0));
    if (opt('cycle') === 'gg') pump.add(at(sphere(0.1 * r, DARK), 0, 0.98 * h, 0.16 * r), at(cyl(0.03, 0.03, 0.4 * h, DARK), 0.3 * r, 0.7 * h, 0.2 * r));
    if (opt('cycle') === 'sc') pump.add(at(cyl(0.12 * r, 0.12 * r, 0.16 * h, COPPER), 0, 1.0 * h, 0), at(cyl(0.04, 0.04, 0.3 * h, COPPER), -0.1 * r, 0.75 * h, 0.15 * r));
    if (opt('cycle') === 'expander') pump.add(at(cyl(0.05, 0.05, 0.5 * h, GOLD), 0.33 * r, 0.55 * h, 0), at(cyl(0.05, 0.05, 0.5 * h, GOLD), -0.33 * r, 0.55 * h, 0));
    if (opt('cycle') === 'electric') pump.add(at(box(0.5 * r, 0.14 * h, 0.3 * r, std(0x1f2937, { roughness: 0.5, metalness: 0.5 })), 0, 1.02 * h, -0.2 * r));
    if (opt('cycle') === 'pressure') { pump.clear(); pump.add(at(cyl(0.08, 0.08, 0.3 * h, STEEL), 0, 0.86 * h, 0), at(torus(0.3 * r, 0.03, STEEL), 0, 0.9 * h, 0)); }
    add('cycle', 'Turbopump', pump, U.clone().add(L.clone().multiplyScalar(0.6)));
    // injector plate
    const inj = group(at(cyl(0.3 * r, 0.3 * r, 0.05, COPPER), 0, 0.68 * h, 0));
    const n = opt('injector') === 'pintle' ? 1 : opt('injector') === 'impinging' ? 12 : 36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = n === 1 ? 0 : (0.08 + (i % 3) * 0.07) * r;
      inj.add(at(cyl(n === 1 ? 0.06 * r : 0.012, n === 1 ? 0.04 * r : 0.012, n === 1 ? 0.12 : 0.04, n === 1 ? STEEL : DARK, 8), Math.cos(a) * rr, 0.68 * h - 0.04, Math.sin(a) * rr));
    }
    add('injector', 'Injector plate', inj, R);
    // nozzle skirt
    const ext = opt('nozzleExt');
    const skirtMat = ext === 'radiative' ? std(0x8a6a4a, { roughness: 0.4, metalness: 0.8, emissive: 0x4a1a00, emissiveIntensity: 0.5 }) : ext === 'carbon' ? std(0x1a1d20, { roughness: 0.8, metalness: 0.1 }) : COPPER;
    const skirt = group(lathe([[0.3 * r, 0.3 * h], [0.62 * r, 0.02], [0.66 * r, 0.02], [0.33 * r, 0.3 * h]], skirtMat));
    if (ext === 'extendable') skirt.add(lathe([[0.62 * r, 0.02], [0.8 * r, -0.2 * h], [0.84 * r, -0.2 * h], [0.66 * r, 0.02]], std(0x1a1d20, { roughness: 0.8, metalness: 0.1 })));
    if (ext === 'regen') for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; skirt.add(at(cyl(0.012, 0.012, 0.28 * h, COPPER, 6), Math.cos(a) * 0.47 * r, 0.16 * h, Math.sin(a) * 0.47 * r)); }
    add('nozzleExt', 'Nozzle extension', skirt, D);
    // igniter
    const ign = opt('igniter') === 'pyro' ? group(at(cyl(0.03, 0.03, 0.14, AMBER), 0, 0.6 * h, 0.3 * r)) : opt('igniter') === 'tea_teb' ? group(at(cyl(0.05, 0.05, 0.16, std(0x16a34a, { roughness: 0.4, metalness: 0.5 })), 0, 0.58 * h, 0.32 * r), at(cyl(0.05, 0.05, 0.16, std(0x16a34a, { roughness: 0.4, metalness: 0.5 })), 0.12, 0.58 * h, 0.3 * r)) : group(at(cyl(0.025, 0.025, 0.2, STEEL), 0, 0.6 * h, 0.3 * r), at(box(0.06, 0.06, 0.04, DARK), 0, 0.7 * h, 0.3 * r));
    add('igniter', 'Igniter', ign, F.clone().add(R));
  } else if (kit === 'tank') {
    const dome = group(at(lathe([[0, 0.3 * r], [0.5 * r, 0.26 * r], [0.85 * r, 0.12 * r], [0.95 * r, 0]], ALU), 0, 0.72 * h, 0));
    if (opt('bulkhead') === 'common') dome.add(at(lathe([[0, 0.24 * r], [0.5 * r, 0.2 * r], [0.85 * r, 0.09 * r], [0.95 * r, 0]], FOAM), 0, 0.72 * h + 0.03, 0));
    else dome.add(at(lathe([[0, 0], [0.5 * r, 0.04 * r], [0.85 * r, 0.18 * r], [0.95 * r, 0.3 * r]], ALU), 0, 0.72 * h - 0.4 * r, 0));
    add('bulkhead', opt('bulkhead') === 'common' ? 'Common bulkhead' : 'Bulkheads', dome, U.clone().add(R.clone().multiplyScalar(0.4)));
    const press = new THREE.Group();
    if (opt('pressurisation') === 'autogenous') press.add(at(cyl(0.03, 0.03, 0.8 * h, GOLD), 0.55 * r, 0.5 * h, 0.3 * r), at(sphere(0.07, GOLD), 0.55 * r, 0.9 * h, 0.3 * r));
    else for (const [x, z] of [[0.4, 0.3], [-0.4, 0.3], [0, -0.45]]) press.add(at(sphere(0.14 * r, STEEL), x * r, 0.3 * h, z * r));
    add('pressurisation', 'Pressurisation', press, L);
    const baf = new THREE.Group();
    if (opt('baffles') !== 'none') for (const f of [0.25, 0.45, 0.65]) baf.add(at(torus(0.78 * r, 0.03, ALU), 0, f * h, 0));
    else baf.add(at(torus(0.78 * r, 0.012, std(0x4b5563, { roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.35 })), 0, 0.45 * h, 0));
    add('baffles', 'Slosh baffles', baf, R);
    const ins = opt('insulation');
    const skin = group(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 0.5, 40, 1, true, 0.2, 1.2), ins === 'foam' ? FOAM : ins === 'mli' ? GOLD : std(0xe6e3dc, { roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide })));
    skin.children[0].material.side = THREE.DoubleSide;
    skin.children[0].position.y = h * 0.5;
    add('insulation', 'Insulation', skin, new THREE.Vector3(Math.sin(0.8), 0, Math.cos(0.8)));
    const feed = group(at(cyl(0.06, 0.06, 0.9 * h, STEEL), -0.3 * r, 0.47 * h, -0.5 * r), at(cyl(0.09, 0.09, 0.1, AMBER), -0.3 * r, 0.06 * h, -0.5 * r));
    if (opt('feedline') === 'dual') feed.add(at(cyl(0.06, 0.06, 0.9 * h, STEEL), 0.3 * r, 0.47 * h, -0.5 * r), at(cyl(0.09, 0.09, 0.1, AMBER), 0.3 * r, 0.06 * h, -0.5 * r));
    add('feedline', 'Feed lines', feed, D.clone().add(F.clone().multiplyScalar(-0.8)));
  } else if (kit === 'capsule') {
    const nComp = opt('computer') === 'quad' ? 5 : opt('computer') === 'triple' ? 3 : 1;
    const comp = new THREE.Group();
    for (let i = 0; i < nComp; i++) comp.add(at(box(0.26, 0.14, 0.2, std(i === 4 ? 0xb45309 : 0x1f2937, { roughness: 0.5, metalness: 0.5 })), -0.35 * r + (i % 3) * 0.3, 0.3 * h + Math.floor(i / 3) * 0.18, -0.45 * r));
    add('computer', 'Flight computer', comp, F.clone().multiplyScalar(-1).add(L.clone().multiplyScalar(0.5)));
    const ecls = group(at(box(0.4, 0.3 * h, 0.3, std(0x0e7490, { roughness: 0.5, metalness: 0.5 })), 0.45 * r, 0.2 * h, 0.2 * r), at(cyl(0.05, 0.05, 0.3 * h, STEEL), 0.6 * r, 0.3 * h, 0.1 * r));
    if (opt('lifeSupport') === 'regenerative') ecls.add(at(cyl(0.12, 0.12, 0.3 * h, ALU), 0.5 * r, 0.5 * h, 0.35 * r), at(box(0.3, 0.2, 0.2, std(0x166534, { roughness: 0.5 })), 0.3 * r, 0.48 * h, 0.4 * r));
    add('lifeSupport', 'Life support', ecls, R);
    const couch = new THREE.Group();
    for (const dx of [-0.25, 0.25]) {
      const seat = group(at(box(0.36, 0.06, 0.4, RUBBER), 0, 0.26 * h, 0), at(box(0.36, 0.4, 0.06, RUBBER), 0, 0.46 * h, -0.2));
      if (opt('couches') === 'shock') seat.add(at(cyl(0.025, 0.025, 0.2 * h, STEEL), -0.12, 0.14 * h, 0), at(cyl(0.025, 0.025, 0.2 * h, STEEL), 0.12, 0.14 * h, 0));
      seat.position.set(dx * r, 0, 0.15 * r);
      couch.add(seat);
    }
    add('couches', 'Crew couches', couch, D.clone().add(F));
    const win = new THREE.Group();
    const big = opt('windows') === 'panoramic';
    for (const a of big ? [-0.6, 0, 0.6] : [-0.5, 0.5]) win.add(at(new THREE.Mesh(new THREE.CylinderGeometry(big ? 0.22 : 0.12, big ? 0.22 : 0.12, 0.04, 20), GLASS()), Math.sin(a) * 0.78 * r, 0.62 * h, Math.cos(a) * 0.78 * r)).children.at(-1).rotation.set(Math.PI / 2, 0, -a);
    add('windows', 'Windows', win, F);
    const hatch = group(at(box(0.5, 0.6, 0.05, ALU), -0.8 * r, 0.5 * h, 0), at(torus(0.1, 0.015, DARK), -0.84 * r, 0.5 * h, 0));
    hatch.children[0].rotation.y = Math.PI / 2;
    hatch.children[1].rotation.set(0, Math.PI / 2, 0);
    if (opt('hatch') === 'inward') hatch.children[0].position.x = -0.68 * r;
    add('hatch', 'Hatch', hatch, L);
  } else if (kit === 'avionics') {
    const n = opt('computer') === 'triple' ? 3 : 2;
    const comp = new THREE.Group();
    for (let i = 0; i < n; i++) comp.add(at(box(0.36, 0.5 * h, 0.2, std(0x1f2937, { roughness: 0.5, metalness: 0.5 })), -0.4 + i * 0.4, 0.5 * h, -0.7 * r));
    add('computer', 'Flight computer', comp, F.clone().multiplyScalar(-1));
    const imuKind = opt('imu');
    const imu = imuKind === 'mems' ? group(at(box(0.12, 0.08, 0.12, std(0x0b1220, { roughness: 0.4 })), 0.7 * r, 0.5 * h, 0)) : imuKind === 'fog' ? group(at(torus(0.14, 0.03, GOLD), 0.7 * r, 0.5 * h, 0), at(torus(0.14, 0.03, GOLD), 0.7 * r, 0.5 * h, 0)) : group(at(box(0.3, 0.3, 0.3, std(0x374151, { roughness: 0.5, metalness: 0.6 })), 0.7 * r, 0.5 * h, 0), at(new THREE.Mesh(new THREE.TetrahedronGeometry(0.1), GOLD), 0.7 * r, 0.5 * h + 0.2, 0));
    if (imuKind === 'fog') imu.children[1].rotation.set(0, Math.PI / 2, 0);
    add('imu', 'Inertial measurement unit', imu, R);
    const radio = group(at(box(0.3, 0.4 * h, 0.16, std(0x4b5563, { roughness: 0.5, metalness: 0.6 })), 0, 0.5 * h, 0.72 * r), at(cyl(0.02, 0.02, 0.3, STEEL), 0.1, 0.9 * h, 0.72 * r));
    if (opt('transponder') === 'dual') radio.add(at(box(0.3, 0.4 * h, 0.16, std(0x4b5563, { roughness: 0.5, metalness: 0.6 })), 0.36, 0.5 * h, 0.7 * r));
    add('transponder', 'Telemetry & range safety', radio, F);
  } else if (kit === 'booster') {
    const rr = Math.max(0.25, h * 0.07);
    const grainShape = opt('grain') === 'star' ? 7 : opt('grain') === 'highthrust' ? 12 : 4;
    const grain = group(at(cyl(rr * 0.85, rr * 0.85, h * 0.5, std(0x8a7a5a, { roughness: 0.9, metalness: 0 }), grainShape), 0, 0.55 * h, 0), at(cyl(rr * 0.3, rr * 0.3, h * 0.52, std(0x15181b, { roughness: 1, metalness: 0 }), grainShape), 0, 0.55 * h, 0));
    add('grain', 'Propellant grain', grain, R);
    const noz = group(lathe([[rr * 0.3, 0.02], [rr * 0.9, 0.02], [rr * 0.4, h * 0.11], [rr * 0.3, h * 0.11]], std(0x2a2e33, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide })));
    if (opt('nozzle') === 'tvc') noz.add(at(torus(rr * 0.5, 0.03, RUBBER), 0, h * 0.11, 0), at(cyl(0.025, 0.025, h * 0.1, STEEL), rr * 0.7, h * 0.16, 0), at(cyl(0.025, 0.025, h * 0.1, STEEL), -rr * 0.7, h * 0.16, 0));
    add('nozzle', 'Nozzle', noz, D);
  } else if (kit === 'fairing') {
    const split = new THREE.Group();
    const petals = opt('split') === 'trisector' ? 3 : 2;
    for (let i = 0; i < petals; i++) {
      const a0 = (i / petals) * Math.PI * 2;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.98, h * 0.5, 40, 1, true, a0, (Math.PI * 2) / petals - 0.08), std(0xf1f0ec, { roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide }));
      shell.position.y = h * 0.3;
      split.add(shell);
    }
    add('split', 'Separation line', split, U);
    const blanket = group(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.76, r * 0.9, h * 0.4, 40, 1, true), opt('acoustic') === 'blankets' ? std(0xe8e0c8, { roughness: 1, metalness: 0, side: THREE.DoubleSide }) : std(0xf1f0ec, { roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.3 })));
    blanket.children[0].position.y = h * 0.3;
    add('acoustic', 'Acoustic blankets', blanket, L);
    const push = new THREE.Group();
    for (const s of [-1, 1]) push.add(at(cyl(0.04, 0.04, 0.25, opt('pushers') === 'pneumatic' ? STEEL : AMBER), s * r * 0.5, 0.06, 0));
    add('pushers', 'Release pushers', push, D);
  } else if (kit === 'shield') {
    const thick = opt('thickness') === 'thick';
    const layer = group(at(lathe([[0, 0], [r * 0.7, 0.03], [r * 1.0, h * (thick ? 0.8 : 0.55)], [0, h * (thick ? 0.8 : 0.55)]], std(0x2a211c, { roughness: 0.92, metalness: 0.05 })), 0, -0.02, 0));
    add('thickness', 'Ablator', layer, D);
    const seams = new THREE.Group();
    if (opt('gaps') !== 'monolithic') for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; seams.add(at(box(r * 0.9, 0.02, 0.02, std(0x6b7280, { roughness: 0.8 })), Math.cos(a) * r * 0.5, h * 0.3, Math.sin(a) * r * 0.5)).children.at(-1).rotation.y = -a; }
    else seams.add(at(torus(r * 0.6, 0.015, std(0x6b7280, { roughness: 0.8 })), 0, h * 0.3, 0));
    add('gaps', 'Seams', seams, U);
  } else if (kit === 'legs') {
    const shock = group(at(cyl(0.05, 0.05, h * 0.5, opt('shock') === 'hydraulic' ? STEEL : ALU), 0, h * 0.5, 0), at(cyl(0.07, 0.07, h * 0.2, opt('shock') === 'hydraulic' ? DARK : std(0xd9b26f, { roughness: 0.8, metalness: 0.3 })), 0, h * 0.7, 0));
    add('shock', 'Shock absorber', shock, R);
    const pad = group(at(cyl(opt('pads') === 'large' ? 0.3 : 0.16, opt('pads') === 'large' ? 0.34 : 0.18, 0.05, DARK), 0, 0.03, 0));
    add('pads', 'Foot pad', pad, D);
  } else if (kit === 'solar') {
    const cells = group(at(box(h * 0.4, h * 0.6, 0.02, std(opt('cells') === 'triple' ? 0x12264a : 0x1e3a5f, { roughness: 0.25, metalness: 0.6 })), 0, h * 0.5, 0.06));
    add('cells', 'Solar cells', cells, F);
    const drive = opt('drive') === 'tracking' ? group(at(cyl(0.06, 0.06, 0.12, STEEL), 0, h * 0.1, 0), at(torus(0.08, 0.015, GOLD), 0, h * 0.1, 0)) : group(at(box(0.16, 0.06, 0.1, DARK), 0, h * 0.1, 0));
    add('drive', 'Array drive', drive, D);
  } else if (kit === 'chute') {
    const canopy = group(new THREE.Mesh(new THREE.SphereGeometry(h * 0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(opt('canopy') === 'ringsail' ? 0xe08a3a : 0xf1f0ec, { roughness: 0.9, side: THREE.DoubleSide })));
    canopy.children[0].position.y = h * 1.1;
    if (opt('canopy') === 'dgb') canopy.add(at(torus(h * 0.55, 0.02, DARK), 0, h * 1.2, 0));
    add('canopy', 'Canopy', canopy, U);
    const reef = group(at(cyl(0.02, 0.02, h * 0.3, STEEL), 0, h * 0.75, 0));
    if (opt('reefing') === 'staged') reef.add(at(box(0.06, 0.06, 0.06, AMBER), 0, h * 0.85, 0), at(box(0.06, 0.06, 0.06, AMBER), 0, h * 0.68, 0));
    add('reefing', 'Reefing', reef, R);
  }
  for (const piece of out) piece.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return out;
}
