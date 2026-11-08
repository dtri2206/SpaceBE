// 3D art for the tail section's own parts: procedural engines (turbopump, feed lines, chamber, the right bell for the
// nozzle and fuel), the thrust structures of real rockets (Octaweb plate, S-IC quadrants, boattail skirt, Shuttle
// triangle…), strap-on boosters (GEM solids, a Shuttle-type SRB from NASA's model, a Soyuz liquid booster), fins, grid
// fins, engine fairings, folding legs and the steering hardware. Owned by the tail section.
// The shared code (bay/partArt.js, bay/internalsArt.js) asks here first; returning null keeps the shared default.
// Units: metres; an axial part stands on y = 0 centred on the stack axis, a radial part has its root at x = 0 pointing +x.
//
// Two quirks of the shared placement code this file relies on (see NOTES.md):
// - bay/partArt.js draws a cluster engine at every mount scaled by mounts.scale and lifted by height × (1 − scale);
//   engineArt() undoes that so it can size each engine to the real gaps between the mounts.
// - designScene / hangarScene shift every part whose id contains "fin" by (host radius − 1.2) m (made for Role 3's fin,
//   which carries a +1.2 m offset), so the fins here carry the same +1.2 m offset and end up on the skin.
import * as THREE from 'three';
import { std, canvasTexture } from '../../bay/util.js';
import { nasaPartArt } from '../../bay/nasa.js';
import tailInternals from './internals.json';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const FIN_SHIFT = 1.2; // see the header

// ---------- small geometry helpers ----------
const lathe = (pts, m, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), seg), m);
const cyl = (rt, rb, h, m, seg = 16, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m);
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const ball = (r, m, seg = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.75))), m);
const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };
const group = (...objs) => { const g = new THREE.Group(); for (const o of objs) if (o) g.add(o); return g; };
function ring(r, t, m, y = 0, seg = 48) {
  const o = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, seg), m);
  o.rotation.x = Math.PI / 2;
  o.position.y = y;
  return o;
}
/** A cylinder from point a to point b. */
function rod(a, b, r, m, seg = 8, r2 = r) {
  const A = V(...a), B = V(...b);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, A.distanceTo(B), seg), m);
  o.position.copy(A).lerp(B, 0.5);
  o.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return o;
}
/** A box from a to b (in a vertical plane through the axis): `depth` along the plane's horizontal, `width` across it. */
function beam(a, b, depth, width, m) {
  const A = V(...a), B = V(...b);
  const o = new THREE.Mesh(new THREE.BoxGeometry(depth, A.distanceTo(B), width), m);
  o.position.copy(A).lerp(B, 0.5);
  o.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return o;
}
const polar = (deg, r, y = 0) => V(Math.cos((deg * Math.PI) / 180) * r, y, Math.sin((deg * Math.PI) / 180) * r);
const minGap = (pts, scale) => {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) d = Math.min(d, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) * scale);
  return d;
};

// ---------- materials (fresh per drawing: the design page clones and fades them per part) ----------
function palette() {
  const make = {
    white: () => std(0xf1f0ec, { roughness: 0.45, metalness: 0.12 }),
    grey: () => std(0xd3d6d8, { roughness: 0.45, metalness: 0.2 }),
    soyuz: () => std(0xbfc6bc, { roughness: 0.5, metalness: 0.15 }),
    black: () => std(0x1d2024, { roughness: 0.6, metalness: 0.35 }),
    dark: () => std(0x2b3036, { roughness: 0.55, metalness: 0.6 }),
    steel: () => std(0xaab1b8, { roughness: 0.32, metalness: 0.9 }),
    alu: () => std(0xc9ccd0, { roughness: 0.38, metalness: 0.85 }),
    chamber: () => std(0x80878e, { roughness: 0.34, metalness: 0.85 }),
    inner: () => new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.95, metalness: 0.1, side: THREE.BackSide }),
    fabric: () => std(0xd8d1bd, { roughness: 0.95, metalness: 0 }),
    gold: () => std(0xc9a24a, { roughness: 0.3, metalness: 0.9 }),
    copper: () => std(0xb87333, { roughness: 0.35, metalness: 0.9 }),
    amber: () => std(0xf59e0b, { roughness: 0.5, metalness: 0.4 }),
    carbon: () => std(0x1b1d20, { roughness: 0.55, metalness: 0.3 }),
    titanium: () => std(0x63676b, { roughness: 0.45, metalness: 0.75 }),
    graphite: () => std(0x2a2a2c, { roughness: 0.85, metalness: 0.1 }),
    insul: () => std(0xeae6dc, { roughness: 0.9, metalness: 0 }),
    foam: () => std(0xc8783a, { roughness: 0.85, metalness: 0 }),
    foamTan: () => std(0xc89a62, { roughness: 0.85, metalness: 0 }),
    greenGrey: () => std(0xb7beb3, { roughness: 0.55, metalness: 0.12 }),
    shield: () => std(0xb9bcc0, { roughness: 0.4, metalness: 0.85 }),
    plate: () => std(0x3a3e44, { roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide }),
    nozzle: () => std(0x2e3135, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
  };
  const cache = {};
  return new Proxy(cache, { get: (t, k) => (t[k] ??= (make[k] ?? make.dark)()) });
}

let tubeTexture = null;
/** Bump map of brazed cooling tubes for regeneratively cooled bells (made once, shared). */
function tubeBump() {
  if (tubeTexture) return tubeTexture;
  const { texture, redraw } = canvasTexture(512, 8);
  redraw((ctx, w, h) => {
    for (let i = 0; i < 128; i++) {
      const x = i * 4;
      const grad = ctx.createLinearGradient(x, 0, x + 4, 0);
      grad.addColorStop(0, '#4a4a4a'); grad.addColorStop(0.5, '#e0e0e0'); grad.addColorStop(1, '#4a4a4a');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 4, h);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  tubeTexture = texture;
  return texture;
}

// ---------- engines ----------
const BELL_COLOR = { kerolox: 0x6e5240, methalox: 0x9a6a46, hydrolox: 0xb9a27e };

/**
 * One liquid engine He metres tall, standing on y = 0 (the nozzle exit) with its gimbal block at He.
 * vac: long, wide vacuum bell; fuel tints the regenerative bell; cycle and ext are the chosen internals.
 */
function buildEngine(He, { vac, fuel, cycle, ext }, M) {
  const g = new THREE.Group();
  const p = vac ? { Re: 0.4, Lb: 0.66, Rt: 0.058, Rc: 0.1, c0: 0.035, c1: 0.13, dome: 0.18 } : { Re: 0.28, Lb: 0.54, Rt: 0.075, Rc: 0.12, c0: 0.05, c1: 0.2, dome: 0.26 };
  const Re = p.Re * He, Lb = p.Lb * He, Rt = p.Rt * He, Rc = p.Rc * He;
  const yC0 = Lb + p.c0 * He, yC1 = Lb + p.c1 * He, yDome = Lb + p.dome * He;
  const rAt = (t) => Rt + (Re - Rt) * Math.pow(1 - t, 0.62); // bell radius at a fraction t of its length (0 = exit)
  const N = 14;
  const bell = Array.from({ length: N + 1 }, (_, i) => [rAt(i / N), (Lb * i) / N]);
  const regen = new THREE.MeshStandardMaterial({ color: BELL_COLOR[fuel] ?? BELL_COLOR.methalox, roughness: 0.38, metalness: 0.85, bumpMap: tubeBump(), bumpScale: 0.8 });
  const extMat = ext === 'radiative' ? std(0x5a4a3e, { roughness: 0.45, metalness: 0.75, emissive: 0x2a0c00, emissiveIntensity: 0.4 })
    : ext === 'carbon' || ext === 'extendable' ? M.carbon : ext === 'ablative' ? std(0x3a3430, { roughness: 0.9, metalness: 0.1 }) : null;
  if (ext === 'ablative') g.add(lathe(bell, extMat));
  else if (extMat) {
    const s = Math.round(N * 0.5);
    g.add(lathe(bell.slice(0, s + 1), extMat), lathe(bell.slice(s), regen));
    g.add(ring(rAt(s / N) + 0.006 * He, 0.012 * He, M.steel, (Lb * s) / N, 40));
    if (ext === 'extendable') g.add(ring(rAt(0.25) + 0.004 * He, 0.008 * He, M.steel, Lb * 0.25, 40));
  } else g.add(lathe(bell, regen));
  g.add(lathe(bell.map(([r, y]) => [r * 0.975, y]), M.inner));
  g.add(ring(Re, 0.014 * He, ext === 'regen' || !ext ? M.steel : M.dark, 0.01 * He, 48)); // exit lip / coolant return manifold
  // throat, chamber and injector dome
  g.add(lathe([[Rt, Lb], [Rc * 0.86, Lb + (yC0 - Lb) * 0.6], [Rc, yC0], [Rc, yC1], [Rc * 0.86, yC1 + (yDome - yC1) * 0.5], [Rc * 0.45, yDome], [0.001, yDome + 0.004 * He]], M.chamber, 24));
  g.add(ring(Rc * 1.02, 0.012 * He, M.steel, yC0, 32), ring(Rc * 1.02, 0.01 * He, M.steel, yC1 - 0.01 * He, 32)); // coolant manifolds
  // thrust cone and gimbal block at the top
  g.add(lathe([[Rc * 0.55, yDome], [Rc * 0.3, He - 0.06 * He], [0.001, He - 0.06 * He]], M.dark, 16));
  g.add(at(box(0.14 * He, 0.06 * He, 0.14 * He, M.dark), 0, He - 0.03 * He, 0));
  g.add(at(cyl(0.02 * He, 0.02 * He, 0.2 * He, M.steel, 10), 0, He - 0.04 * He, 0)).children.at(-1).rotation.z = Math.PI / 2;
  // turbomachinery on the +x side
  const yP = (yC0 + yDome) / 2 + 0.02 * He;
  const fuelLine = fuel === 'hydrolox' ? M.insul : M.steel;
  const pump = (side) => {
    const x = side * (Rc + 0.075 * He);
    const pg = group(
      at(cyl(0.05 * He, 0.05 * He, 0.16 * He, M.steel, 16), x, yP, 0),
      ring(0.05 * He, 0.018 * He, M.alu, yP + 0.07 * He, 20), ring(0.05 * He, 0.016 * He, M.alu, yP - 0.02 * He, 20),
      at(cyl(0.062 * He, 0.062 * He, 0.045 * He, M.dark, 16), x, yP - 0.1 * He, 0),
      rod([side * 0.04 * He, He - 0.03 * He, 0.05 * He], [x, yP + 0.09 * He, 0.03 * He], 0.026 * He, M.steel), // oxygen inlet duct
      rod([-side * 0.03 * He, He - 0.03 * He, -0.05 * He], [x, yP + 0.03 * He, -0.045 * He], 0.026 * He, fuelLine), // fuel inlet duct
      rod([x, yP, 0.02 * He], [side * Rc * 0.7, yDome - 0.01 * He, 0.02 * He], 0.022 * He, M.steel), // to the injector
      rod([x, yP - 0.05 * He, -0.04 * He], [side * Rc * 1.0, yC0, -0.05 * He], 0.02 * He, fuelLine), // to the cooling jacket
    );
    pg.children[1].position.x = x; pg.children[2].position.x = x;
    return pg;
  };
  const exhaust = (side) => {
    const x = side * (Rc + 0.075 * He), t = 0.34;
    return group(
      rod([x, yP - 0.12 * He, 0], [side * (rAt(t) + 0.04 * He), Lb * t, 0], 0.024 * He, M.dark),
      at(cyl(0.035 * He, 0.022 * He, 0.05 * He, M.dark, 12), side * (rAt(t) + 0.04 * He), Lb * t - 0.02 * He, 0),
    );
  };
  if (cycle === 'pressure') {
    // no pump: tank pressure pushes the propellants straight in through two valves
    g.add(rod([0.05 * He, He - 0.03 * He, 0.05 * He], [Rc * 0.7, yDome, 0.04 * He], 0.026 * He, M.steel), rod([-0.05 * He, He - 0.03 * He, -0.05 * He], [-Rc * 0.7, yDome, -0.04 * He], 0.026 * He, fuelLine));
    g.add(at(ball(0.04 * He, M.amber, 10), Rc * 0.62, yDome + 0.05 * He, 0.045 * He), at(ball(0.04 * He, M.amber, 10), -Rc * 0.62, yDome + 0.05 * He, -0.045 * He));
  } else {
    g.add(pump(1));
    if (cycle === 'ffsc') g.add(pump(-1));
    if (cycle === 'gg' || cycle === 'tapoff' || !cycle) {
      g.add(exhaust(1));
      if (cycle === 'tapoff') g.add(rod([Rc, yC0 + 0.02 * He, 0.06 * He], [Rc + 0.075 * He, yP - 0.1 * He, 0.03 * He], 0.016 * He, M.copper));
      else g.add(at(cyl(0.028 * He, 0.028 * He, 0.07 * He, M.dark, 12), Rc + 0.11 * He, yP - 0.13 * He, 0.06 * He)); // gas generator
    }
    const preburner = (side) => group(
      at(cyl(0.045 * He, 0.04 * He, 0.1 * He, M.copper, 14), side * (Rc + 0.075 * He), yP + 0.14 * He, 0),
      rod([side * (Rc + 0.075 * He), yP + 0.19 * He, 0], [side * 0.02 * He, yDome + 0.02 * He, 0], 0.034 * He, M.copper), // hot-gas duct into the injector head
    );
    if (cycle === 'sc') g.add(preburner(1));
    if (cycle === 'ffsc') g.add(preburner(1), preburner(-1));
    if (cycle === 'expander') g.add(rod([rAt(0.5) + 0.02 * He, Lb * 0.5, 0.05 * He], [Rc + 0.07 * He, yP - 0.1 * He, 0.05 * He], 0.016 * He, M.gold), rod([rAt(0.5) + 0.02 * He, Lb * 0.5, -0.05 * He], [Rc + 0.07 * He, yP - 0.1 * He, -0.05 * He], 0.016 * He, M.gold));
    if (cycle === 'electric') g.add(at(box(0.1 * He, 0.07 * He, 0.1 * He, M.black), Rc + 0.075 * He, yP - 0.15 * He, 0), rod([Rc + 0.12 * He, yP - 0.15 * He, 0], [0.06 * He, He - 0.02 * He, -0.07 * He], 0.01 * He, M.amber));
  }
  return g;
}

/** An engine part (engine_s / engine_m / engine_l), alone or as one copy of a cluster. Top at the part height, base at 0. */
function engineArt(entry) {
  const H = entry.height ?? entry.def.height;
  const c = entry.cluster && (entry.cluster.count ?? 1) > 1 ? entry.cluster : null;
  const vac = entry.engine?.nozzle === 'vac';
  const fuel = entry.engine?.fuel ?? 'methalox';
  const opts = entry.options ?? {};
  const k = c ? clusterFit(c, entry, H, vac ? 0.4 : 0.28) : 1;
  const He = H * k;
  noteEngine(entry, { H, jetR: (vac ? 0.4 : 0.28) * He, headR: (vac ? 0.1 : 0.12) * He * 1.1 });
  const engine = buildEngine(He, { vac, fuel, cycle: opts.cycle ?? 'gg', ext: opts.nozzleExt ?? 'regen' }, palette());
  engine.position.y = H - He;
  return c ? hangFromFrame(engine, c, H) : engine;
}

/**
 * The nozzle each engine was last drawn with (engine part id -> { H, jetR, headR }): the jet vanes and the gimbal ring
 * hung on that engine (their entry's parentId) are sized and placed from it, so they fit a vacuum bell, a cone or an
 * aerospike as well as the sea-level bell. jetR: the jet's radius at the exit (y = 0 of the engine part).
 */
const ENGINE_LOOK = new Map();
function noteEngine(entry, look) {
  if (entry?.id != null) ENGINE_LOOK.set(entry.id, look);
}

/**
 * How much to shrink one engine of a cluster so it fits the real gaps between the mounts (bells may touch, never
 * overlap) and the frame rim. exitFrac: the bell's exit radius over the engine height.
 */
function clusterFit(c, entry, H, exitFrac) {
  const hr = c.hostRadius ?? entry.radius ?? 1.25;
  const pts = (c.layout ?? [[0, 0]]).slice(0, c.count);
  const gap = minGap(pts, hr);
  let maxR = 0.47 * gap;
  for (const [x, z] of pts) maxR = Math.min(maxR, Math.max(0.3 * gap, hr * 1.25 - Math.hypot(x, z) * hr));
  return Math.min(1, maxR / (exitFrac * H));
}

/** bay/partArt.js scales each cluster copy by s and lifts it to H(1 - s): cancel both so the engine hangs from the frame. */
function hangFromFrame(engine, c, H) {
  const s = c.scale ?? 0.4;
  const wrap = new THREE.Group();
  wrap.scale.setScalar(1 / s);
  wrap.add(at(group(engine), 0, -H * (1 - s), 0));
  return wrap;
}

// ---------- thrust structures ----------
const FRAME_LOOK = {
  thrust_single_s: { kind: 'single', skin: 'white' },
  thrust_single_m: { kind: 'single', skin: 'white' },
  thrust_single_l: { kind: 'single', skin: 'white' },
  thrust_boattail_m: { kind: 'boattail', skin: 'white' },
  thrust_twin_m: { kind: 'skirt', skin: 'grey', band: 'dark', bandFrac: 0.22 },
  thrust_triad_m: { kind: 'skirt', skin: 'white', band: 'black', bandFrac: 0.4 },
  thrust_quad_m: { kind: 'skirt', skin: 'soyuz', taper: 0.94 },
  thrust_five_l: { kind: 'skirt', skin: 'white', quadrants: true },
  thrust_seven_l: { kind: 'skirt', skin: 'white', band: 'dark', bandFrac: 0.25 },
  thrust_octaweb_m: { kind: 'skirt', skin: 'white', band: 'black', bandFrac: 0.3, octagon: true },
  // wave 4 frames: the look while their Blender models download (tools/blender/tail/thrust.py)
  thrust_atlas_m: { kind: 'skirt', skin: 'steel' },
  thrust_twin_l: { kind: 'skirt', skin: 'white', band: 'dark', bandFrac: 0.2 },
  thrust_triad_l: { kind: 'skirt', skin: 'white', band: 'black', bandFrac: 0.4 },
  thrust_sib_l: { kind: 'skirt', skin: 'white', band: 'black', bandFrac: 0.3 },
  thrust_sii_l: { kind: 'skirt', skin: 'white' },
  thrust_sls_l: { kind: 'boattail', skin: 'foam' },
  thrust_superheavy_l: { kind: 'skirt', skin: 'steel', band: 'dark', bandFrac: 0.3 },
  thrust_starship_l: { kind: 'skirt', skin: 'steel', band: 'black', bandFrac: 0.5 },
  thrust_electron_s: { kind: 'skirt', skin: 'carbon' },
  thrust_proton_l: { kind: 'skirt', skin: 'grey' },
  thrust_n1_l: { kind: 'skirt', skin: 'grey' },
  thrust_energia_l: { kind: 'skirt', skin: 'white', band: 'dark', bandFrac: 0.2 },
};

/** The opening of each mount in a plate of radius rPlate: holeR, smaller near the rim, 0 when the mount is past the edge. */
function mountHoles(pts, Rpos, rPlate, holeR, octagon = false) {
  const inner = octagon ? rPlate * Math.cos(Math.PI / 8) : rPlate;
  return pts.map(([fx, fz]) => { const r = Math.min(holeR, inner - Math.hypot(fx, fz) * Rpos - 0.04); return r >= 0.1 ? r : 0; });
}

/** The base plate under the engines with one opening per mount, as an extruded shape (y from 0 to t). */
function basePlate(R, pts, holeR, t, m, octagon = false, Rpos = R) {
  const holes = mountHoles(pts, Rpos, R, holeR, octagon);
  const shape = new THREE.Shape();
  if (octagon) {
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; const x = Math.cos(a) * R, y = Math.sin(a) * R; if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
  } else shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  pts.forEach(([fx, fz], i) => { if (!holes[i]) return; const hole = new THREE.Path(); hole.absarc(fx * Rpos, -fz * Rpos, holes[i], 0, Math.PI * 2, true); shape.holes.push(hole); });
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 28 });
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, m);
}

function thrustArt(entry, M) {
  const g = thrustFrame(entry, M);
  if (entry.id != null) return g; // on the vehicle the real engines hang below
  const R = entry.radius ?? 1.25, m = entry.def.mounts ?? { count: 1, layout: [[0, 0]] };
  const pts = (m.layout ?? [[0, 0]]).slice(0, m.count ?? 1);
  const bellR = pts.length > 1 ? Math.min(0.46 * minGap(pts, R), 0.42 * R) : 0.42 * R;
  const bell = new THREE.MeshStandardMaterial({ color: BELL_COLOR.methalox, roughness: 0.38, metalness: 0.85, bumpMap: tubeBump(), bumpScale: 0.8 });
  for (const [fx, fz] of pts) {
    const L = bellR * 1.9;
    g.add(at(lathe([[bellR, -L - 0.12], [bellR * 0.62, -L * 0.45 - 0.12], [bellR * 0.32, -0.12], [bellR * 0.4, 0]], bell, 24), fx * R, 0, fz * R));
    g.add(at(lathe([[bellR * 0.97, -L - 0.12], [bellR * 0.6, -L * 0.45 - 0.12], [bellR * 0.3, -0.12]], M.inner, 24), fx * R, 0, fz * R));
  }
  return g;
}

/** The thrust structure itself, without engines. */
function thrustFrame(entry, M) {
  const def = entry.def, R = entry.radius ?? 1.25, h = def.height;
  const look = FRAME_LOOK[def.id] ?? { kind: 'skirt', skin: 'white' };
  const m = def.mounts ?? { count: 1, layout: [[0, 0]] };
  const pts = (m.layout ?? [[0, 0]]).slice(0, m.count ?? 1);
  const shield = entry.options?.baseShield ?? 'curtains';
  const skinMat = M[look.skin];
  skinMat.side = THREE.DoubleSide;
  const g = new THREE.Group();
  const holeR = pts.length > 1 ? Math.min(0.42 * minGap(pts, R), 0.3 * R) : 0.3 * R;
  const mountsAt = (y) => pts.map(([fx, fz]) => V(fx * R, y, fz * R));
  g.add(ring(R, 0.035, M.dark, h - 0.035, 64)); // the ring that bolts to the tank above
  const stringers = (y0, y1, rTop, rBot, n = 24) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360 + 360 / n / 2;
      g.add(beam(polar(a, rTop + 0.014, y1).toArray(), polar(a, rBot + 0.014, y0).toArray(), 0.035, 0.035, M.alu));
    }
  };
  let holes = pts.map(() => holeR); // per-mount openings; the skirt section narrows them near the rim
  const boots = (y, scale = 1) => {
    mountsAt(y).forEach((p, i) => {
      const hr = holes[i];
      if (hr) g.add(at(lathe([[hr * 0.98, 0], [hr * 0.62 * scale + hr * 0.38 * (1 - scale), -0.16 * scale]], M.fabric, 24), p.x, p.y, p.z));
      else g.add(at(box(0.22, 0.14, 0.22, M.dark), p.x, p.y + 0.07, p.z)); // a thrust post for an engine that hangs past the rim
    });
  };
  const mountRings = (y) => { mountsAt(y).forEach((p, i) => { if (holes[i]) g.add(at(ring(holes[i], 0.022, M.steel, 0, 28), p.x, p.y, p.z)); }); };

  if (look.kind === 'single') {
    // skirt on top, an open cone of beams below gathering the thrust at one gimbal point (Delta II, Redstone)
    const yS = h * 0.4;
    g.add(lathe([[R, yS], [R, h]], skinMat, 48));
    stringers(yS, h, R, R, 20);
    g.add(ring(R * 0.995, 0.03, M.dark, yS, 64));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 360 + 22.5;
      g.add(beam(polar(a, R * 0.92, yS + 0.02).toArray(), polar(a, R * 0.12, 0.06).toArray(), 0.06, 0.08, M.alu));
    }
    g.add(ring(R * 0.13, 0.04, M.dark, 0.06, 24), at(cyl(R * 0.15, R * 0.12, 0.08, M.dark, 20), 0, 0.04, 0));
    if (shield === 'rigid') g.add(at(basePlate(R * 0.97, [[0, 0]], holeR, 0.05, M.shield, false, R), 0, yS - 0.05, 0));
    if (shield === 'curtains') g.add(at(lathe([[holeR * 1.1, 0], [holeR * 0.55, -0.18]], M.fabric, 24), 0, 0.04, 0));
    return g;
  }

  if (look.kind === 'boattail') {
    // a tapering skirt that wraps the top of the engine (Atlas V, Delta IV)
    const drop = Math.min(0.6, h * 0.5), rLow = R * 0.74;
    g.add(lathe([[rLow, -drop], [R * 0.86, h * 0.25], [R, h * 0.72], [R, h]], skinMat, 48));
    g.add(ring(rLow, 0.03, M.dark, -drop + 0.01, 48), ring(R * 0.995, 0.02, M.dark, h * 0.72, 64));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 360 + 11.25;
      g.add(beam(polar(a, R + 0.008, h * 0.98).toArray(), polar(a, R + 0.008, h * 0.72).toArray(), 0.02, 0.04, M.alu));
      g.add(beam(polar(a, R + 0.008, h * 0.72).toArray(), polar(a, rLow + 0.01, -drop + 0.04).toArray(), 0.02, 0.04, M.alu));
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rLow + 0.012, rLow + 0.05, 0.18, 48, 1, true), M.dark);
    band.position.y = -drop + 0.12;
    g.add(band);
    if (shield !== 'none') g.add(at(basePlate(R * 0.9, [[0, 0]], holeR, 0.05, shield === 'rigid' ? M.shield : M.plate, false, R), 0, 0, 0));
    if (shield === 'curtains') boots(0.0);
    return g;
  }

  // a cylindrical engine section with a base plate (Octaweb, S-IC, Shuttle aft, New Glenn, Soyuz core, Titan)
  const taper = look.taper ?? 1;
  if (look.quadrants) {
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h - 0.02, 12, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4), i % 2 ? M.black : skinMat);
      seg.material.side = THREE.DoubleSide;
      seg.position.y = h / 2;
      g.add(seg);
    }
  } else {
    g.add(lathe([[R * taper, 0], [R, h]], skinMat, 48));
    if (look.band) {
      const bh = h * look.bandFrac;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * (1 - (1 - taper) * (1 - look.bandFrac)) + 0.006, R * taper + 0.006, bh, 48, 1, true), M[look.band]);
      band.position.y = bh / 2;
      g.add(band);
    }
  }
  stringers(0.04, h - 0.04, R, R * taper, look.quadrants ? 32 : 24);
  g.add(ring(R * taper, 0.03, M.dark, 0.03, 64));
  const rPlate = R * taper * 0.985;
  holes = mountHoles(pts, R, rPlate, holeR, !!look.octagon);
  if (shield === 'none') {
    // bare thrust beams across the base, with a ring at every mount
    for (const a of [0, 90]) g.add(at(box(rPlate * 2, 0.1, 0.1, M.alu), 0, 0.08, 0)).children.at(-1).rotation.y = (a * Math.PI) / 180;
    mountRings(0.04);
    for (const p of mountsAt(0.04)) g.add(at(box(holeR * 0.5, 0.08, holeR * 0.5, M.dark), p.x, p.y, p.z));
  } else {
    g.add(basePlate(rPlate, pts, holeR, shield === 'rigid' ? 0.07 : 0.05, shield === 'rigid' ? M.shield : M.plate, !!look.octagon, R));
    mountRings(0.0);
    if (shield === 'curtains') boots(0.0, pts.length > 1 ? 0.8 : 1);
  }
  if (def.id === 'thrust_twin_m') g.add(at(box(R * 1.7, 0.12, 0.16, M.dark), 0, 0.14, 0)); // the cross-beam both engines hang from (seen through the openings)
  return g;
}

// ---------- strap-on boosters ----------
/** How far a booster reaches below its clamp point: a quarter of its length, never into the ground. */
const boosterDrop = (entry, h) => (Number.isFinite(entry.y) ? Math.max(0, Math.min(h * 0.25, entry.y - 0.3)) : 0);

/** Two clamp struts from the booster's inner side (−x) to the core skin, plus a ball joint. */
function struts(r, y0, y1, M, reach = 0.08) {
  return group(
    at(box(reach + 0.06, 0.07, 0.1, M.dark), -r - reach / 2 + 0.02, y0, 0),
    rod([-r + 0.02, y1 - 0.25, 0.12], [-r - reach, y1, 0.0], 0.03, M.steel),
    rod([-r + 0.02, y1 - 0.25, -0.12], [-r - reach, y1, 0.0], 0.03, M.steel),
    at(ball(0.06, M.dark, 10), -r - reach, y1, 0),
  );
}

/** A graphite-epoxy solid (GEM-40, GEM-63): long white case, pointed nose, short aft skirt and nozzle. */
function gemArt(entry, M) {
  const h = entry.def.height, r = h * 0.085, drop = boosterDrop(entry, h);
  const g = new THREE.Group();
  const yN = h * 0.11; // nozzle length below the case
  const caseH = h * 0.74;
  const caseMat = M.white;
  g.add(at(cyl(r, r, caseH, caseMat, 32), 0, yN + caseH / 2, 0));
  const nose = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; nose.push([r * Math.pow(1 - Math.pow(t, 1.7), 0.8) + 0.004 * (1 - t), yN + caseH + t * (h - yN - caseH)]); } // pointed ogive
  g.add(lathe(nose, caseMat, 32));
  g.add(lathe([[r * 1.04, yN], [r * 1.06, yN + h * 0.04], [r * 1.0, yN + h * 0.05]], M.dark, 32)); // aft skirt
  g.add(lathe([[r * 0.78, 0], [r * 0.5, yN * 0.7], [r * 0.34, yN]], M.nozzle, 28), lathe([[r * 0.76, 0.01], [r * 0.48, yN * 0.7], [r * 0.32, yN]], M.inner, 28));
  for (const f of [0.35, 0.6]) g.add(ring(r + 0.004, 0.012, M.steel, yN + caseH * f, 32));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.004, r + 0.004, h * 0.03, 32, 1, true), M.dark);
  band.position.y = yN + caseH * 0.92;
  g.add(band, at(box(0.08, caseH * 0.8, 0.06, M.grey), r + 0.01, yN + caseH * 0.5, 0)); // systems tunnel
  g.add(struts(r, yN + h * 0.06, yN + caseH * 0.82, M, 0.08));
  g.position.y = -drop;
  const out = group(g);
  out.userData.srb = true;
  out.userData.width = r * 2;
  return out;
}

/** Procedural Space Shuttle-type segmented booster, used until NASA's SRB model has loaded. */
function srbLProcedural(h, M) {
  const r = h * 0.058, g = new THREE.Group();
  const yN = h * 0.075, yCase0 = yN + h * 0.09, yCase1 = h * 0.82;
  g.add(lathe([[r * 0.95, 0], [r * 0.62, yN * 0.8], [r * 0.5, yN]], M.nozzle, 28), lathe([[r * 0.93, 0.01], [r * 0.6, yN * 0.8], [r * 0.48, yN]], M.inner, 28));
  g.add(lathe([[r * 1.55, yN], [r * 1.2, yN + h * 0.05], [r, yCase0]], M.white, 32)); // flared aft skirt
  g.add(at(cyl(r, r, yCase1 - yCase0, M.white, 32), 0, (yCase0 + yCase1) / 2, 0));
  for (let i = 1; i < 4; i++) g.add(ring(r + 0.006, 0.02, M.grey, yCase0 + ((yCase1 - yCase0) * i) / 4, 32)); // field joints
  g.add(ring(r + 0.02, 0.035, M.dark, yCase0 + 0.15, 32)); // the aft attach ring
  g.add(lathe([[r, yCase1], [r, yCase1 + h * 0.05], [r * 0.62, h * 0.95], [r * 0.25, h * 0.995], [0.001, h]], M.white, 32)); // forward skirt, frustum, nose
  return { object: g, r, width: r * 3.1 };
}

/** Space Shuttle-type segmented booster: NASA's real SRB model when it has loaded, wrapped with clamp struts. */
function srbLArt(entry, M) {
  const h = entry.def.height, drop = boosterDrop(entry, h);
  const real = nasaPartArt(entry.type);
  let core, r, width;
  if (real) {
    const size = new THREE.Box3().setFromObject(real).getSize(V(0, 0, 0));
    width = Math.max(size.x, size.z);
    r = width * 0.32; // the case; the flared aft skirt is the widest part
    core = real;
  } else ({ object: core, r, width } = srbLProcedural(h, M));
  // the aft skirt just clears the core; the case stands off on struts, as on the Shuttle
  const placeWidth = Math.max(2 * r, width - 0.1);
  const g = group(core, struts(r, h * 0.16, h * 0.78, M, placeWidth / 2 + 0.05 - r + 0.02));
  g.position.y = -drop;
  const out = group(g);
  out.userData.srb = true;
  out.userData.width = placeWidth;
  if (real) out.userData.nasa = real.userData.nasa ?? 'srb';
  return out;
}

/** A Soyuz-style liquid booster: cylinder at the base, a long cone leaning in to the core, four chambers, two verniers. */
function liquidBoosterArt(entry, M) {
  const h = entry.def.height, rb = 0.62, drop = boosterDrop(entry, h);
  const g = new THREE.Group();
  const yE = 0.32; // engine bay height under the tanks
  const yCyl = h * 0.27;
  const body = M.soyuz;
  g.add(at(cyl(rb, rb * 0.98, yCyl - yE, body, 32), 0, (yE + yCyl) / 2, 0));
  const coneH = h * 0.69;
  const cone = new THREE.CylinderGeometry(rb * 0.17, rb, coneH, 32, 6);
  cone.translate(0, coneH / 2, 0);
  const lean = rb * 0.8; // the tip stops just short of the core, even where the body above is wider
  cone.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, -lean / coneH, 0, 0, 0)); // the tip leans in to the core
  g.add(at(new THREE.Mesh(cone, body), 0, yCyl, 0));
  g.add(at(lathe([[rb * 0.17, 0], [rb * 0.12, h * 0.025], [0.001, h * 0.04]], M.dark, 20), -lean, yCyl + coneH, 0));
  g.add(at(ball(0.09, M.steel, 12), -lean - rb * 0.12, yCyl + coneH * 0.985, 0)); // the ball joint that carries its thrust into the core
  g.add(ring(rb + 0.005, 0.02, M.dark, yCyl, 32), ring(rb + 0.005, 0.02, M.dark, yE + 0.02, 32));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(rb + 0.004, rb + 0.004, h * 0.05, 32, 1, true), M.grey);
  band.position.y = yCyl - h * 0.06;
  g.add(band);
  // engine bay: four main chambers in a square and two swivelling verniers
  g.add(at(cyl(rb * 0.96, rb * 0.9, yE, M.dark, 24, true), 0, yE / 2, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, x = Math.cos(a) * rb * 0.45, z = Math.sin(a) * rb * 0.45;
    g.add(at(lathe([[rb * 0.24, -0.38], [rb * 0.16, -0.12], [rb * 0.09, 0.02], [rb * 0.12, 0.12]], M.nozzle, 18), x, 0, z));
  }
  for (const s of [-1, 1]) g.add(at(lathe([[0.09, -0.26], [0.05, -0.08], [0.035, 0.04]], M.nozzle, 14), 0, 0, s * rb * 0.88));
  // the triangular air rudder on the outer side
  const fin = new THREE.Shape([[0, 0], [0.55, -0.05], [0.55, 0.15], [0, 0.75]].map(([x, y]) => new THREE.Vector2(x, y)));
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.04, bevelEnabled: false });
  finGeo.translate(0, 0, -0.02);
  g.add(at(new THREE.Mesh(finGeo, body), rb - 0.02, yE, 0));
  g.add(at(box(0.14, 0.08, 0.12, M.dark), -rb - 0.05, yE + 0.25, 0)); // the aft tie that holds the base
  g.position.y = -drop;
  const out = group(g);
  out.userData.srb = true;
  out.userData.width = rb * 2;
  return out;
}

/**
 * The wave 4 liquid strap-ons (Delta IV CBC, Falcon Heavy side core, Energia Blok A, Angara URM-1, Long March 5),
 * drawn simply while their Blender models (tools/blender/tail/boosters.py) download: tank, nose, engines.
 * Diameter: the real booster / core ratio of the rocket that uses it (NOTES.md).
 */
const STRAP = {
  booster_cbc_l: { d: 3.375, body: 'foamTan', base: 'white', nose: 0.9, bells: [[0, 0, 0.24]] },
  booster_f9_m: { d: 2.5, body: 'white', base: 'black', nose: 0.95, bells: [[0, 0, 0.11], ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [0.66 * Math.cos((k * Math.PI) / 4), 0.66 * Math.sin((k * Math.PI) / 4), 0.11])] },
  booster_blok_a_m: { d: 1.71, body: 'grey', base: 'dark', nose: 1.4, bells: [0, 1, 2, 3].map((k) => [0.42 * Math.cos(((k + 0.5) * Math.PI) / 2), 0.42 * Math.sin(((k + 0.5) * Math.PI) / 2), 0.19]) },
  booster_urm1_m: { d: 2.5, body: 'greenGrey', base: 'dark', nose: 0.95, bells: [[0, 0, 0.25]] },
  booster_cz5_m: { d: 2.26, body: 'white', base: 'white', nose: 1.45, bells: [[0, -0.48, 0.19], [0, 0.48, 0.19]] },
};

function strapArt(entry, M) {
  const s = STRAP[entry.type ?? entry.def.id];
  const h = entry.def.height, D = s.d, r = D / 2, drop = boosterDrop(entry, h);
  const g = new THREE.Group();
  const le = 0.55 * D, ys = le * 0.9, yn = h - s.nose * D;
  for (const [fx, fz, re] of s.bells) {
    const R = re * D;
    g.add(at(lathe([[R, 0], [R * 0.6, le * 0.35], [R * 0.3, le * 0.6], [R * 0.45, le]], M.nozzle, 18), fx * r, 0, fz * r));
  }
  g.add(at(cyl(r, r * 0.9, ys * 0.5, M[s.base], 32), 0, ys + ys * 0.25, 0));
  g.add(at(cyl(r, r, yn - ys * 1.5, M[s.body], 32), 0, (yn + ys * 1.5) / 2, 0));
  g.add(at(lathe([[r, 0], [r * 0.5, (h - yn) * 0.6], [0.001, h - yn]], M.white, 32), 0, yn, 0));
  g.add(struts(r, ys + D * 0.5, yn - D * 0.3, M, 0.08));
  g.position.y = -drop;
  const out = group(g);
  out.userData.srb = true;
  out.userData.width = D;
  return out;
}

/**
 * Dresses a Blender model before the shared code places it (bay/partArt.js singleArt). Returns null to leave it.
 * - A booster: dropped like the drawn ones (boosterDrop), given clamp struts on its core side (-x), and its real width
 *   so the shared placement puts its axis at the right distance from the core.
 * - An engine: its regeneratively cooled bell tinted by the fuel (as the drawn engines).
 */
export function wrapModel(model, entry) {
  const def = entry?.def;
  if (!def) return null;
  if (def.engine) {
    const tint = BELL_COLOR[entry.engine?.fuel] ?? BELL_COLOR.methalox;
    // real regenerative bells are steel grey with a hint of the fuel's soot or heat tint, not copper
    const c = new THREE.Color(tint).lerp(new THREE.Color(0x86837f), 0.78);
    model.traverse((o) => { if (o.isMesh && o.material?.name === 'regen_bell') o.material.color.copy(c); });
    // in a cluster, size it to the real gaps between the mounts like the drawn engines (Blender bells: exit 0.275 H, vacuum 0.36 H)
    const cl = entry.cluster && (entry.cluster.count ?? 1) > 1 ? entry.cluster : null;
    const H = entry.height ?? def.height;
    const vac = entry.engine?.nozzle === 'vac';
    const k = cl ? clusterFit(cl, entry, H, vac ? 0.36 : 0.275) : 1;
    // the jet leaves the bell at its exit radius, a cone at 0.97 of it, an aerospike round its 0.075 H plug base
    const contour = entry.options?.contour?.id ?? entry.options?.contour;
    const exitR = (vac ? 0.36 : 0.275) * H * k;
    noteEngine(entry, { H, jetR: contour === 'aerospike' ? 0.12 * H * k : contour === 'conical' ? exitR * 0.97 : exitR, headR: (vac ? 0.084 : 0.12) * H * k * 1.1 });
    if (!cl) return model;
    model.scale.setScalar(k);
    model.position.y = H - H * k;
    return hangFromFrame(model, cl, H);
  }
  if (def.booster && entry.attach === 'radial') {
    const h = def.height, drop = boosterDrop(entry, h);
    const box = new THREE.Box3().setFromObject(model);
    const inner = Math.max(0.2, -box.min.x); // the axis to the core side, fittings included
    const M = palette();
    const g = group(model, struts(inner - 0.03, h * 0.12, h * 0.78, M, 0.06));
    g.position.y = -drop;
    const out = group(g);
    out.userData.srb = true;
    out.userData.width = inner * 2;
    return out;
  }
  const id = entry.type ?? def.id;
  if (/fin/.test(id) && entry.attach === 'radial') {
    // the shared placement puts fins at (host radius - 1.2): carry the same offset as the drawn fins (FIN_SHIFT)
    const inner = group(model);
    // a Starship flap's tiles face the windward side (+z): mirror the copy on the far side so its tiles do too
    if (id === 'fin_flap_l' && Math.cos(((entry.angle ?? 0) * Math.PI) / 180) < 0) inner.scale.z = -1;
    const out = group(at(inner, FIN_SHIFT, 0, 0));
    out.userData.width = new THREE.Box3().setFromObject(model).max.x;
    return out;
  }
  if (id === 'legs_falcon_m') {
    // one Falcon 9 leg modelled (tools/blender/tail/gear.py), folded flat along the tail as on the pad; four copies
    const R = entry.radius ?? 1.25;
    const deployed = model.getObjectByName('pose_deployed');
    if (deployed) deployed.visible = false;
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const arm = group(at(k === 0 ? model : model.clone(true), R, 0, 0));
      arm.rotation.y = (k * Math.PI) / 2;
      g.add(arm);
    }
    return g;
  }
  if (LEG_COPIES[id]) {
    // one leg modelled; the stage carries six (New Glenn) or four (New Shepard), each swung to put its foot on the ground
    const R = entry.radius ?? 1.25, { n, foot: [fx, fy] } = LEG_COPIES[id]; // the foot pad, relative to the hinge
    const ground = (Number.isFinite(entry.y) ? -entry.y : -2.4) + 0.05;
    const L = Math.hypot(fx, fy), phi = Math.atan2(fy, fx);
    const want = Math.asin(Math.max(-1, Math.min(1, ground / L)));
    const g = new THREE.Group();
    for (let k = 0; k < n; k++) {
      const leg = k === 0 ? model : model.clone(true);
      leg.rotation.z = want - phi;
      const arm = group(at(leg, R * 0.98, 0, 0));
      arm.rotation.y = (k * Math.PI * 2) / n;
      g.add(arm);
    }
    return g;
  }
  return null;
}
// copies per stage, and the bottom of the foot pad at the model's reference pose (tools/blender/tail/gear.py LEGS)
const LEG_COPIES = { legs_glenn_l: { n: 6, foot: [2.3, -3.04] }, legs_shepard_m: { n: 4, foot: [1.05, -2.19] } };

// ---------- fins, grid fins, fairings ----------
/** A swept fin with a doubler at the root and a darker leading edge. Root at x = FIN_SHIFT (see the header). */
function finArt(entry, M) {
  const h = entry.def.height, span = h * 0.62;
  const outline = [[0, -0.25 * h], [span, -0.36 * h], [span, 0.04 * h], [0, 0.75 * h]];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const t = Math.max(0.05, h * 0.035);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelThickness: t * 0.3, bevelSize: t * 0.3, bevelSegments: 2 });
  geo.translate(0, 0, -t / 2);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, M.white));
  g.add(at(box(0.1, h * 1.0, t * 2.4, M.grey), 0.05, 0.25 * h, 0)); // root doubler
  g.add(beam([0.02, 0.75 * h, 0], [span, 0.04 * h, 0], 0.05, t * 1.6, M.dark)); // leading edge
  g.add(beam([span * 0.35, -0.29 * h, 0], [span * 0.35, 0.53 * h, 0], 0.03, t * 1.5, M.grey)); // spar
  const out = group(at(g, FIN_SHIFT, 0, 0));
  out.userData.width = span;
  return out;
}

/** A deployed titanium grid fin: a lattice of thin plates at 45° in a frame, on a hinge. Root at x = FIN_SHIFT. */
function gridFinArt(entry, M) {
  const W = 1.2, D = 0.9, T = 0.26, x0 = 0.16; // panel width (across), reach (outward), depth (along the airflow)
  const g = new THREE.Group();
  const ti = M.titanium;
  g.add(at(box(0.18, 0.5, 0.5, M.dark), 0.09, T / 2, 0)); // hinge and actuator housing
  g.add(at(box(0.08, 0.1, 0.3, M.steel), 0.16, T / 2, 0));
  const frameT = 0.035;
  g.add(at(box(D, T, frameT, ti), x0 + D / 2, T / 2, W / 2), at(box(D, T, frameT, ti), x0 + D / 2, T / 2, -W / 2));
  g.add(at(box(frameT, T, W, ti), x0, T / 2, 0), at(box(frameT, T, W, ti), x0 + D, T / 2, 0));
  const step = 0.13;
  for (const dir of [1, -1]) {
    // lines x − dir·z = c across the rectangle [x0, x0 + D] × [−W/2, W/2]
    for (let c = -2; c <= 2; c += step) {
      const tMin = Math.max(x0, dir > 0 ? -W / 2 + c : c - W / 2), tMax = Math.min(x0 + D, dir > 0 ? W / 2 + c : c + W / 2);
      if (tMax - tMin < 0.03) continue;
      const len = (tMax - tMin) * Math.SQRT2, tm = (tMin + tMax) / 2;
      const plate = box(len, T * 0.96, 0.01, ti);
      plate.position.set(tm, T / 2, dir > 0 ? tm - c : c - tm);
      plate.rotation.y = dir > 0 ? -Math.PI / 4 : Math.PI / 4;
      g.add(plate);
    }
  }
  const out = group(at(g, FIN_SHIFT, 0, 0));
  out.userData.width = D;
  return out;
}

/** A conical shroud over an outer engine (Saturn V S-IC), hugging the skin. */
function fairingArt(entry, M) {
  const top = 0.45, len = 1.9;
  const geo = new THREE.CylinderGeometry(0.06, 0.62, len, 20, 1, true, 0, Math.PI);
  const mat = M.white;
  mat.side = THREE.DoubleSide;
  const g = group(at(new THREE.Mesh(geo, mat), 0, top - len / 2, 0));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 20, Math.PI), M.dark);
  lip.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
  lip.position.y = top - len + 0.02;
  g.add(lip);
  for (const a of [0.35, 0.7, 1.05]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06 + 0.01, 0.62 + 0.01, len, 3, 1, true, a * 2.4, 0.04), M.grey);
    s.material.side = THREE.DoubleSide;
    s.position.y = top - len / 2;
    g.add(s);
  }
  g.userData.width = 0; // the shared placement puts its root right on the skin
  return g;
}

// ---------- landing legs ----------
/** Four Falcon-style carbon legs hinged at the base, open, feet on the ground. Centred on the axis. */
function falconLegsArt(entry, M) {
  const R = entry.radius ?? 1.25;
  const ground = Number.isFinite(entry.y) ? -entry.y : -2.4;
  const reach = Math.min(3.0, Math.max(1.3, Math.abs(ground) * 0.85));
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Group();
    const hinge = [R * 0.97, 0, 0], foot = [R + reach, ground + 0.14, 0];
    leg.add(beam(hinge, foot, 0.14, 0.34, M.carbon));
    leg.add(beam([R * 0.97, 0.05, 0], [R * 0.97 + reach * 0.35, ground * 0.35 + 0.05, 0], 0.05, 0.42, M.carbon)); // the wide upper web
    leg.add(at(box(0.16, 0.22, 0.4, M.alu), R * 0.98, 0.02, 0)); // hinge fitting
    const k = 0.62, mid = [hinge[0] + (foot[0] - hinge[0]) * k, hinge[1] + (foot[1] - hinge[1]) * k, 0];
    const top = [R * 1.0, Math.min(1.6, Math.abs(ground) * 0.55) + 0.2, 0];
    leg.add(rod(top, [top[0] + (mid[0] - top[0]) * 0.55, top[1] + (mid[1] - top[1]) * 0.55, 0], 0.06, M.carbon)); // telescoping pusher
    leg.add(rod([top[0] + (mid[0] - top[0]) * 0.5, top[1] + (mid[1] - top[1]) * 0.5, 0], mid, 0.035, M.steel));
    leg.add(at(box(0.12, 0.12, 0.2, M.dark), ...top));
    leg.add(at(cyl(0.3, 0.34, 0.08, M.dark, 24), foot[0], ground + 0.04, 0), at(cyl(0.12, 0.16, 0.12, M.alu, 16), foot[0], ground + 0.12, 0));
    leg.rotation.y = (i * Math.PI) / 2;
    g.add(leg);
  }
  return g;
}

// ---------- steering ----------
/** Steering hardware drawn around the engine axis; the shared code places radial art at the skin, so undo that. */
function steeringArt(entry, M) {
  const R = entry.radius ?? 1.25, W = 0.3;
  const g = new THREE.Group();
  const id = entry.type;
  if (id === 'verniers') {
    for (let i = 0; i < 4; i++) {
      const v = group(
        lathe([[0.13, -0.42], [0.08, -0.2], [0.045, -0.06], [0.06, 0.04], [0.04, 0.12]], M.nozzle, 16),
        at(cyl(0.06, 0.06, 0.12, M.chamber, 12), 0, 0.1, 0),
        ring(0.085, 0.015, M.steel, 0.02, 20),
        rod([0, 0.16, 0], [-0.25, 0.4, 0], 0.02, M.steel),
        at(box(0.08, 0.2, 0.08, M.dark), 0.14, 0.12, 0),
      );
      const p = polar(i * 90, R * 0.86);
      v.position.set(p.x, 0, p.z);
      v.rotation.y = -i * Math.PI / 2;
      g.add(v);
    }
  } else if (id === 'jet_vanes') {
    // graphite vanes in the jet just behind the nozzle exit of the engine they hang on (sized to its real jet: a bell,
    // a vacuum bell, a cone or an aerospike's plug), on arms from a ring round the exit; on the pad they stop short of
    // the ground
    const host = ENGINE_LOOK.get(entry.parentId);
    const re = host ? host.jetR : R * 0.6;
    const exitY = host ? -(entry.yFrac ?? 0.02) * host.H : 0;
    const vh = Math.max(0.12, re * 0.5);
    const floor = Number.isFinite(entry.y) ? -entry.y + 0.03 + vh / 2 : -Infinity;
    const vy = Math.max(exitY - vh * 0.6, floor);
    const ry = exitY + 0.03, ra = re * 1.15; // the ring clamps round the nozzle's exit lip
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.add(at(box(re * 0.62, vh, Math.max(0.025, re * 0.06), M.graphite), re * 0.52, vy, 0)); // the vane in the jet
      arm.add(at(box(ra - re * 0.8, 0.04, 0.04, M.steel), (re * 0.8 + ra) / 2, vy, 0)); // its shaft out through the jet edge
      arm.add(at(box(0.09, Math.max(0.14, vh * 0.7), 0.09, M.dark), ra, vy + vh * 0.2, 0)); // actuator
      if (ry > vy + vh * 0.55) arm.add(beam([ra, vy + vh * 0.55, 0], [ra, ry, 0], 0.045, 0.045, M.steel)); // hung from the ring
      arm.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
      g.add(arm);
    }
    g.add(ring(ra, 0.028, M.dark, ry, 40));
  } else {
    // round the engine's injector head (its gimbal plane): the ring and two actuators at 90 degrees
    const electric = id === 'gimbal_emech';
    const host = ENGINE_LOOK.get(entry.parentId);
    const hr = host ? Math.max(R * 0.24, host.headR * 1.15) : R * 0.24;
    g.add(ring(hr, 0.035, M.steel, 0, 32));
    for (const a of [0, 90]) {
      const lo = polar(a, hr * 1.08, 0), hi = polar(a, hr * 2.1, 0.5);
      const mid = lo.clone().lerp(hi, 0.45);
      g.add(rod(hi.toArray(), mid.toArray(), electric ? 0.045 : 0.06, electric ? M.alu : M.dark), rod(mid.toArray(), lo.toArray(), 0.025, M.steel));
      if (electric) g.add(at(cyl(0.07, 0.07, 0.2, M.black, 12), hi.x, hi.y + 0.05, hi.z));
      else g.add(rod(hi.toArray(), polar(a + 25, R * 0.6, 0.6).toArray(), 0.012, M.amber));
    }
    if (electric) g.add(at(box(0.3, 0.2, 0.18, M.black), ...polar(225, R * 0.55, 0.45).toArray()));
    else g.add(at(cyl(0.09, 0.09, 0.3, M.steel, 14), ...polar(225, R * 0.55, 0.45).toArray()));
  }
  const out = group(at(g, -(R + W * 0.45), 0, 0));
  out.userData.width = W;
  return out;
}

// ---------- entry points ----------
/** Art for one placed part: entry = { type, def, attach, height, radius, cluster?, engine?, options?, y? }. Null = default. */
export function partArt(entry) {
  const def = entry?.def;
  if (!def) return null;
  const id = entry.type ?? def.id;
  const M = palette();
  if (def.engine) return engineArt(entry);
  if (def.mounts) return thrustArt(entry, M);
  if (id === 'srb_s' || id === 'srb_m') return gemArt(entry, M);
  if (id === 'srb_l') return srbLArt(entry, M);
  if (id === 'booster_liquid_m') return liquidBoosterArt(entry, M);
  if (STRAP[id]) return strapArt(entry, M);
  if (id === 'fin_grid_m') return gridFinArt(entry, M);
  if (/^fin_[sml]$/.test(id)) return finArt(entry, M);
  if (id === 'aft_fairing_m') return fairingArt(entry, M);
  if (id === 'legs_falcon_m') return falconLegsArt(entry, M);
  if (def.flags?.gimbal) return steeringArt(entry, M);
  return null;
}

// ---------- internals (exploded view) ----------
/**
 * The engine kit's pieces, laid out like the Blender engine (tools/blender/tail/engine.py: bell to 0.54 h, chamber to
 * 0.73 h, dome to 0.82 h, turbopump on +x). Once the model has loaded, its own slot pieces replace these.
 */
function engineInternals(opt, h, M, add) {
  const Rt = 0.069 * h, Rc = 0.12 * h, Re = 0.275 * h, yT = 0.54 * h, yI = 0.73 * h;
  const cycle = group(at(cyl(0.06 * h, 0.06 * h, 0.2 * h, M.steel, 12), 0.2 * h, 0.74 * h, 0));
  const c = opt('cycle') ?? 'gg';
  if (c === 'gg' || c === 'tapoff' || c === 'expander_bleed') cycle.add(rod([0.2 * h, 0.64 * h, 0], [Re + 0.04 * h, 0.1 * h, 0], 0.025 * h, M.dark));
  if (c === 'sc' || c === 'ffsc' || c === 'sc_fuel') cycle.add(at(cyl(0.03 * h, 0.03 * h, 0.08 * h, M.copper, 10), 0.2 * h, 0.88 * h, 0), rod([0.2 * h, 0.9 * h, 0], [0.04 * h, 0.8 * h, 0], 0.03 * h, M.copper));
  if (c === 'ffsc' || c === 'sc_fuel') cycle.add(at(cyl(0.06 * h, 0.06 * h, 0.2 * h, M.steel, 12), -0.2 * h, 0.74 * h, 0));
  if (c === 'electric') cycle.add(at(box(0.08 * h, 0.08 * h, 0.08 * h, M.black), 0.2 * h, 0.6 * h, 0));
  if (c === 'pressure') cycle.clear().add(at(ball(0.03 * h, M.amber, 10), 0.15 * h, 0.8 * h, 0.04 * h), at(ball(0.03 * h, M.amber, 10), 0.15 * h, 0.8 * h, -0.04 * h));
  add('cycle', 'Turbopump', cycle, DIR.R);
  add('injector', 'Injector', group(at(cyl(Rc * 0.96, Rc * 0.96, 0.01 * h, M.copper, 24), 0, yI, 0), lathe([[Rc * 1.1, yI], [Rc * 0.45, 0.81 * h], [0.001, 0.82 * h]], M.chamber, 24)), DIR.U);
  const ch = opt('chamber') ?? 'channels';
  add('chamber', 'Combustion chamber', group(lathe([[Rt, yT], [Rc * 0.9, yT + 0.08 * h], [Rc, yT + 0.12 * h], [Rc, yI]], ch === 'ablative' ? M.graphite : ch === 'tubes' ? M.steel : M.copper, 24)), DIR.L);
  const ct = opt('contour') ?? 'bell';
  const contour = ct === 'aerospike'
    ? group(lathe([[0.08 * h, 0], [0.12 * h, 0.25 * h], [0.18 * h, 0.5 * h], [0.001, 0.52 * h]], M.nozzle, 28))
    : ct === 'conical' ? group(lathe([[Re, 0], [Rt, yT]], M.nozzle, 28)) : group(lathe([[0.21 * h, 0.26 * h], [0.15 * h, 0.4 * h], [Rt, yT]], M.nozzle, 28));
  add('contour', 'Nozzle contour', contour, V(-0.6, -0.4, 0.6));
  const ext = opt('nozzleExt') ?? 'regen';
  add('nozzleExt', 'Nozzle extension', group(lathe([[Re, 0], [0.24 * h, 0.13 * h], [0.21 * h, 0.26 * h]], ext === 'radiative' ? M.titanium : ext === 'regen' ? M.nozzle : M.carbon, 28)), DIR.D);
  add('igniter', 'Igniter', group(at(cyl(0.012 * h, 0.012 * h, 0.06 * h, opt('igniter') === 'pyro' ? M.amber : M.steel, 8), 0, 0.79 * h, Rc)), DIR.F);
  const st = new THREE.Group();
  if (opt('stability') === 'baffles') {
    for (let i = 0; i < 6; i++) {
      const b = at(box(Rc * 0.55, 0.035 * h, 0.004 * h, M.copper), Math.cos((i * Math.PI) / 3) * Rc * 0.65, yI - 0.02 * h, Math.sin((i * Math.PI) / 3) * Rc * 0.65);
      b.rotation.y = -(i * Math.PI) / 3;
      st.add(b);
    }
  }
  if (opt('stability') === 'cavities') st.add(ring(Rc, 0.012 * h, M.graphite, yI - 0.012 * h, 24));
  add('stability', 'Combustion stability', st, V(0, -0.3, -1));
}

/** The gimbal kit's power source: a hydraulic power unit, fuel-driven hydraulics, or an APU turbine. */
function gimbalInternals(opt, r, M, add) {
  const p = new THREE.Group();
  const o = opt('power') ?? 'hpu';
  if (o === 'fueldraulic') p.add(rod([r * 0.4, 0.45, 0.1], [r * 0.25, 0.05, 0.1], 0.02, M.steel), rod([r * 0.4, 0.45, -0.1], [r * 0.25, 0.05, -0.1], 0.02, M.steel));
  else if (o === 'apu') p.add(at(box(0.22, 0.16, 0.16, M.dark), r * 0.45, 0.4, 0), at(cyl(0.07, 0.07, 0.3, M.white, 12), r * 0.45, 0.6, 0.15));
  else p.add(at(box(0.2, 0.14, 0.16, M.dark), r * 0.45, 0.4, 0), at(ball(0.09, M.steel, 14), r * 0.45, 0.6, -0.1));
  add('power', 'Power for the actuators', p, DIR.R);
}

const DIR = { L: V(-1, 0, 0), R: V(1, 0, 0), U: V(0, 1, 0), D: V(0, -1, 0), F: V(0, 0, 1), B: V(0, 0, -1) };

/**
 * The pieces inside a part, for the exploded view: [{ key (the kit slot), name, object, dir (THREE.Vector3) }], or null
 * for the default pieces in bay/internalsArt.js. options = { slotKey: chosenOption }, dims = { radius, height }.
 */
// each kit's slot keys in the card's order (sections/tail/internals.json)
const KIT_ORDER = Object.fromEntries(Object.entries(tailInternals.kits ?? tailInternals).map(([id, k]) => [id, (k.slots ?? []).map((sl) => sl.key)]));

export function internalsArt(def, options, dims) {
  const out = tailPieces(def, options, dims);
  if (!out) return null;
  // in the kit's order, so the numbered markers of the exploded view match the card's numbered list
  const order = KIT_ORDER[def.internals] ?? [];
  const rank = (key) => { const i = order.indexOf(key); return i < 0 ? order.length : i; };
  return out.sort((a, b) => rank(a.key) - rank(b.key));
}

function tailPieces(def, options, dims) {
  const kit = def?.internals;
  if (!['thrust', 'ring', 'strapon', 'legs', 'booster', 'segmented', 'gimbal', 'engine'].includes(kit)) return null;
  const M = palette();
  const r = dims?.radius ?? 1.25, h = dims?.height ?? def.height ?? 1;
  const opt = (k) => options?.[k]?.id;
  const out = [];
  const add = (key, name, object, dir) => out.push({ key, name, object, dir: dir.clone().normalize() });

  if (kit === 'engine') { engineInternals(opt, h, M, add); return out; }
  if (kit === 'gimbal') { gimbalInternals(opt, r, M, add); return out; }

  if (kit === 'thrust' || kit === 'ring') {
    const pts = (def.mounts?.layout ?? [[0, 0]]).slice(0, def.mounts?.count ?? 1);
    const holeR = pts.length > 1 ? Math.min(0.42 * minGap(pts, r), 0.3 * r) : 0.3 * r;
    const shield = opt('baseShield') ?? 'curtains';
    const base = new THREE.Group();
    if (shield === 'none') {
      base.add(at(box(r * 1.9, 0.1, 0.1, M.alu), 0, 0.08, 0), at(box(0.1, 0.1, r * 1.9, M.alu), 0, 0.08, 0));
      for (const [fx, fz] of pts) base.add(at(ring(holeR, 0.02, M.steel, 0, 24), fx * r, 0.05, fz * r));
    } else {
      base.add(basePlate(r * 0.97, pts, holeR, 0.06, shield === 'rigid' ? M.shield : M.plate, def.id === 'thrust_octaweb_m', r));
      const holes = mountHoles(pts, r, r * 0.97, holeR, def.id === 'thrust_octaweb_m');
      if (shield === 'curtains') pts.forEach(([fx, fz], i) => { if (holes[i]) base.add(at(lathe([[holes[i] * 0.98, 0], [holes[i] * 0.62, -0.16]], M.fabric, 24), fx * r, 0, fz * r)); });
    }
    add('baseShield', 'Base heat shield', base, DIR.D);
    const feed = new THREE.Group();
    const yF = h * 0.55;
    if (opt('feed') === 'prevalves') {
      feed.add(ring(r * 0.55, 0.05, M.steel, yF, 40));
      for (const [fx, fz] of pts) {
        const x = fx * r, z = fz * r;
        feed.add(rod([x * 0.5 + (fx === 0 && fz === 0 ? r * 0.55 : 0), yF, z * 0.5], [x, 0.1, z], 0.035, M.steel), at(box(0.12, 0.12, 0.12, M.amber), x, 0.22, z));
      }
    } else {
      for (const [fx, fz] of pts) feed.add(rod([fx * r * 0.6 + 0.08, h * 0.95, fz * r * 0.6], [fx * r + 0.08, 0.1, fz * r], 0.035, M.steel), rod([fx * r * 0.6 - 0.08, h * 0.95, fz * r * 0.6], [fx * r - 0.08, 0.1, fz * r], 0.035, M.alu));
    }
    add('feed', 'Propellant feed', feed, DIR.L);
    const pogo = group(rod([r * 0.3, h * 0.95, r * 0.3], [r * 0.3, 0.15, r * 0.3], 0.045, M.steel));
    if (opt('pogo') === 'accumulator') pogo.add(at(ball(0.13, M.steel, 16), r * 0.3, h * 0.55, r * 0.3), at(ball(0.1, M.steel, 16), r * 0.3, h * 0.3, r * 0.3), at(box(0.06, 0.12, 0.06, M.amber), r * 0.3 + 0.13, h * 0.55, r * 0.3));
    add('pogo', 'POGO suppressor', pogo, V(0.6, 0.5, 0.6));
    if (kit === 'ring') {
      // steering a ring of fixed engines: throttle valves on the outer feeds (KORD), or a pair of actuators per engine
      const steer = new THREE.Group();
      const outer = pts.filter(([fx, fz]) => Math.hypot(fx, fz) > 0.6);
      for (const [fx, fz] of outer) {
        if (opt('steer') === 'gimbals') steer.add(rod([fx * r, 0.05, fz * r], [fx * r * 0.92, 0.25, fz * r * 0.92], 0.018, M.steel));
        else steer.add(at(box(0.08, 0.1, 0.08, M.amber), fx * r * 0.94, h * 0.25, fz * r * 0.94));
      }
      if (opt('steer') !== 'gimbals') steer.add(at(box(0.26, 0.18, 0.2, M.dark), 0, h * 0.5, 0)); // the KORD control unit
      add('steer', 'Steering', steer, V(-0.6, 0.6, 0.5));
    }
    return out;
  }

  if (kit === 'strapon') {
    // the booster art reaches a quarter of its length below its clamp point (boosterDrop)
    const y0 = -h * 0.25, rb = 0.62;
    const chambers = new THREE.Group();
    if (opt('chambers') === 'single') chambers.add(at(lathe([[rb * 0.55, -0.45], [rb * 0.3, -0.12], [rb * 0.16, 0.05], [rb * 0.22, 0.25]], M.nozzle, 24), 0, y0 + 0.32, 0));
    else for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; chambers.add(at(lathe([[rb * 0.24, -0.38], [rb * 0.16, -0.12], [rb * 0.09, 0.02], [rb * 0.12, 0.2]], M.nozzle, 18), Math.cos(a) * rb * 0.45, y0 + 0.32, Math.sin(a) * rb * 0.45)); }
    for (const s of [-1, 1]) chambers.add(at(lathe([[0.09, -0.26], [0.05, -0.08], [0.035, 0.06]], M.nozzle, 14), 0, y0 + 0.32, s * rb * 0.88));
    add('chambers', 'Chambers', chambers, DIR.D);
    const turbine = group(at(cyl(0.12, 0.12, 0.34, M.steel, 16), 0, y0 + 0.75, 0), ring(0.12, 0.04, M.alu, y0 + 0.88));
    if (opt('turbine') === 'gasgen') turbine.add(at(ball(0.1, M.dark, 14), 0.22, y0 + 0.62, 0), rod([0.12, y0 + 0.62, 0], [0.4, y0 + 0.2, 0], 0.04, M.dark));
    else turbine.add(at(cyl(0.16, 0.16, 0.7, M.insul, 16), -0.05, y0 + 1.35, 0.25), rod([-0.05, y0 + 1.0, 0.25], [0, y0 + 0.85, 0.05], 0.03, M.steel));
    add('turbine', 'Turbine drive', turbine, DIR.R);
    return out;
  }

  if (kit === 'booster' || kit === 'segmented') {
    const y0 = -h * 0.25, rr = Math.max(0.3, h * 0.07);
    const grainOpt = opt('grain') ?? 'star';
    const points = grainOpt === 'star' ? 11 : grainOpt === 'highthrust' ? 14 : grainOpt === 'finocyl' ? 6 : 24;
    // one cast segment of propellant, its bore shape showing on the cut face
    const grain = group(at(cyl(rr * 0.85, rr * 0.85, h * 0.3, std(0x8a7a5a, { roughness: 0.9, metalness: 0 }), 32), 0, y0 + h * 0.55, 0));
    const bore = new THREE.Shape();
    const rIn = grainOpt === 'longburn' ? rr * 0.18 : grainOpt === 'bucket' ? rr * 0.4 : rr * 0.22, rOut = grainOpt === 'longburn' ? rr * 0.2 : grainOpt === 'bucket' ? rr * 0.42 : grainOpt === 'finocyl' ? rr * 0.6 : rr * 0.42;
    for (let i = 0; i <= points * 2; i++) { const a = (i / (points * 2)) * Math.PI * 2; const rad = i % 2 ? rIn : rOut; if (i === 0) bore.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else bore.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    const boreGeo = new THREE.ExtrudeGeometry(bore, { depth: h * 0.31, bevelEnabled: false });
    boreGeo.rotateX(-Math.PI / 2);
    grain.add(at(new THREE.Mesh(boreGeo, std(0x15181b, { roughness: 1, metalness: 0 })), 0, y0 + h * 0.395, 0));
    add('grain', 'Propellant grain', grain, DIR.R);
    const noz = group(lathe([[rr * 0.85, y0], [rr * 0.5, y0 + h * 0.08], [rr * 0.34, y0 + h * 0.11]], M.nozzle, 28));
    if (opt('nozzle') === 'tvc' || (kit === 'segmented' && (opt('nozzle') ?? 'flex') === 'flex')) noz.add(ring(rr * 0.42, 0.03, M.black, y0 + h * 0.11), rod([rr * 0.7, y0 + h * 0.05, 0], [rr * 0.7, y0 + h * 0.18, 0], 0.025, M.steel), rod([-rr * 0.7, y0 + h * 0.05, 0], [-rr * 0.7, y0 + h * 0.18, 0], 0.025, M.steel));
    if (opt('nozzle') === 'lit') noz.add(at(ball(rr * 0.35, M.steel, 14), rr * 1.0, y0 + h * 0.15, 0), ring(rr * 0.6, 0.02, M.amber, y0 + h * 0.05));
    add('nozzle', 'Nozzle', noz, DIR.D);
    if (kit === 'segmented') {
      // the field joints between the cast segments: one capture-feature band, or the old two-O-ring tang and clevis
      const joint = new THREE.Group();
      for (const f of [0.35, 0.5, 0.65]) {
        if (opt('joint') === 'tworing') joint.add(ring(rr * 1.0, 0.012, M.dark, y0 + h * f - 0.03), ring(rr * 1.0, 0.012, M.dark, y0 + h * f + 0.03));
        else joint.add(ring(rr * 1.0, 0.025, M.grey, y0 + h * f));
      }
      add('joint', 'Field joints', joint, DIR.L);
    }
    return out;
  }

  // legs (legs_m, legs_l, legs_falcon_m): the pieces sit out where a leg is, below the clamp point
  const x = r + 0.9;
  const shockOpt = opt('shock') ?? 'honeycomb';
  const shock = group(at(cyl(0.06, 0.06, h * 0.5, shockOpt === 'hydraulic' ? M.steel : M.alu, 12), x, -h * 0.25, 0));
  if (shockOpt === 'honeycomb') shock.add(at(cyl(0.09, 0.09, h * 0.18, M.gold, 6), x, -h * 0.1, 0));
  if (shockOpt === 'hydraulic') shock.add(at(cyl(0.085, 0.085, h * 0.22, M.dark, 12), x, -h * 0.08, 0));
  if (shockOpt === 'telescope') shock.add(at(cyl(0.1, 0.1, h * 0.22, M.carbon, 12), x, -h * 0.05, 0), at(cyl(0.075, 0.075, h * 0.14, M.gold, 6), x, -h * 0.3, 0));
  add('shock', 'Shock absorber', shock, DIR.R);
  const padOpt = opt('pads') ?? 'small';
  const pad = padOpt === 'dish' ? group(at(lathe([[0.001, 0], [0.3, 0.03], [0.42, 0.12], [0.44, 0.14]], std(0x2a2e33, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }), 28), x, -h * 0.55, 0))
    : group(at(cyl(padOpt === 'large' ? 0.3 : 0.16, padOpt === 'large' ? 0.34 : 0.18, 0.05, M.dark, 24), x, -h * 0.55, 0));
  add('pads', 'Foot pad', pad, DIR.D);
  const probesOpt = opt('probes') ?? 'none';
  const probes = new THREE.Group();
  if (probesOpt === 'probes') probes.add(rod([x + 0.1, -h * 0.55, 0], [x + 0.1, -h * 0.55 - 1.0, 0], 0.012, M.steel), at(ball(0.035, M.steel, 10), x + 0.1, -h * 0.55 - 1.0, 0));
  else if (probesOpt === 'loadcells') for (const dy of [0.15, 0.35]) probes.add(at(box(0.1, 0.06, 0.1, M.amber), x, -h * dy, 0.08));
  else probes.add(at(box(0.2, 0.1, 0.14, M.dark), r * 0.6, 0.05, 0), at(cyl(0.05, 0.05, 0.03, M.gold, 12), r * 0.6, -0.01, 0));
  add('probes', 'Touchdown sensors', probes, DIR.F);
  return out;
}
