// One first-person cockpit per crew capsule (Role 3). The capsule's crew cabin IS the cockpit: the crew lie on their backs in reclined couches,
// the instrument panel hangs above the knees, and the windows, hatch and docking port sit exactly where Role 1's exterior model has them.
// Models: public/assets/models/cockpit/<id>.glb, built by scripts/blender/capsuleCockpit.py. Eye = origin, looking up the capsule axis (-Z).
// Same userData API as flightDeck.js (setControls, setButton, press, setTrajectory, setAim, setConjunction, setAlarm, onFrame) plus
// reach(id) (gloved hand presses a button), openHatch(t) and the aftHatch / ladderTop / aft nodes for Role 2's egress.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { events, getShip } from '/src/core/index.js';
import { installControls, installHands, isSaturated } from './cockpitRuntime.js';
import { createFlightDeck } from './flightDeck.js';
import { createCabin } from './cabin.js';
import { state as gfx } from './shared.js';

const BASE = '/assets/models/cockpit/';
// builder part type -> cabin model. The generic cones have no exterior model: Mk1 = Mercury, Mk2 = Dragon, Mk3 = Apollo.
// The game uses ONE crew cockpit for every capsule (the user's decision, 2026-11-08): the Apollo room with the hatch to the cabin.
const CAPSULE_TYPES = [
  'capsule_vostok', 'capsule_mercury', 'capsule_gemini', 'capsule_apollo', 'capsule_soyuz', 'capsule_shenzhou', 'capsule_orion', 'capsule_dragon',
  'capsule_starliner', 'capsule_gaganyaan', 'capsule_newshepard', 'capsule_mengzhou', 'capsule_s', 'capsule_m', 'capsule_l',
];
export const CAPSULE_MODELS = Object.fromEntries(CAPSULE_TYPES.map((t) => [t, 'apollo']));
const STYLES = ['small', 'panoramic', 'cupola'];
const HATCHES = ['side', 'inward', 'top'];
const ALBEDO = 0.2; // the pad's sun and sky lights are strong: keep the cabin lining at the contrast of the Blender renders
const loader = new GLTFLoader();
const templates = new Map();   // id -> THREE.Group
const loads = new Map();       // id -> Promise
const failed = new Set();

/** The capsule model for a ShipSpec (its crew cabin part), or null for Dream Chaser, Starship and ships without a capsule. */
export function capsuleIdFor(ship = getShip()) {
  const cabinType = ship?.stats?.cabin?.type; // Role 1's cabin record names the capsule (e.g. 'capsule_apollo') when present
  if (cabinType && CAPSULE_MODELS[cabinType]) return CAPSULE_MODELS[cabinType];
  for (const p of ship?.parts || []) if (CAPSULE_MODELS[p.type]) return CAPSULE_MODELS[p.type];
  return null;
}

function prepare(scene, id) {
  scene.name = `cockpit:${id}`;
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // the cabin is always around the camera
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      if (/^glass/.test(m.name)) {
        // thick window glass: a faint dark tint and a soft reflection, never a bright disc (the sun's specular on a mirror-smooth pane read as a white disc in space)
        m.transparent = true; m.opacity = 0.1; m.depthWrite = false; m.side = THREE.DoubleSide;
        m.roughness = 0.45; m.metalness = 0; m.envMapIntensity = 0.1; m.color.multiplyScalar(0.25);
        if ('specularIntensity' in m) m.specularIntensity = 0.2;
        continue;
      }
      m.side = THREE.DoubleSide;
      if (m.name === 'plate') { m.roughness = 1; m.metalness = 0; m.color.multiplyScalar(0.7); continue; }
      if (/^pass_|^strap/.test(m.name)) { m.roughness = Math.max(m.roughness, 0.5); continue; } // aft hatch, passage and harness: authored at final albedo
      if (m.isMeshStandardMaterial && m.emissive.getHex() === 0 && !m.transparent && m.metalness < 0.5 && !isSaturated(m.color)) m.color.multiplyScalar(ALBEDO);
      if (m.name === 'alarm') m.emissiveIntensity = Math.min(m.emissiveIntensity, 1.5);
    }
  });
  return scene;
}

export function loadCapsule(id) {
  if (templates.has(id)) return Promise.resolve(templates.get(id));
  if (!loads.has(id)) {
    loads.set(id, loader.loadAsync(`${BASE}${id}.glb`).then(({ scene }) => {
      templates.set(id, prepare(scene, id));
      return scene;
    }).catch((err) => {
      failed.add(id);
      console.error(`[capsule cockpit] ${id} failed to load; using the flight deck`, err);
      return null;
    }));
  }
  return loads.get(id);
}

/** Resolve when the cockpit this ship will use is ready (warm-up waits for it). */
export function preloadCockpit(ship = getShip()) {
  const id = capsuleIdFor(ship);
  return id ? loadCapsule(id) : Promise.resolve(null);
}
if (typeof window !== 'undefined') events.on('ship:built', ({ shipSpec } = {}) => { preloadCockpit(shipSpec?.parts ? shipSpec : getShip()); });

/** The window / hatch variant the ship asks for (stats.cabin from Role 1 when present, else the defaults). */
export function variantFor(id, ship = getShip()) {
  const cabin = ship?.stats?.cabin || {};
  let windows = STYLES.includes(cabin.windows) ? cabin.windows : (id === 'newshepard' ? 'panoramic' : 'small');
  let hatch = { outward: 'side', side: 'side', inward: 'inward', top: 'top' }[cabin.hatch] || 'side';
  if (windows === 'cupola' && hatch === 'top') hatch = 'side'; // the dome replaces the docking port the top hatch opens into
  return { windows, hatch };
}

function applyVariant(model, { windows, hatch }) {
  for (const s of STYLES) { const n = model.getObjectByName(`win_${s}`); if (n) n.visible = s === windows; }
  for (const h of HATCHES) { const n = model.getObjectByName(`hatch_${h}`); if (n) n.visible = h === hatch; }
  const dock = model.getObjectByName('docking'); if (dock) dock.visible = windows !== 'cupola';
  const cap = model.getObjectByName('dock_cap'); if (cap) cap.visible = windows !== 'cupola' && hatch !== 'top';
  // the nodes Role 2's egress looks for. A capsule with an aft access hatch (Apollo) uses it as aftHatch / ladderTop; its side hatch becomes sideHatch.
  const aftDoor = model.getObjectByName('door_aft');
  const door = model.getObjectByName(`door_${hatch}`);
  const ladder = model.getObjectByName(`ladderTop_${hatch}`);
  const plug = model.getObjectByName(`plug_${hatch}`);
  if (aftDoor) {
    if (door) door.name = 'sideHatch';
    if (ladder) ladder.name = 'sideLadderTop';
    aftDoor.name = 'aftHatch';
    const lt = model.getObjectByName('ladderTop_aft');
    if (lt) lt.name = 'ladderTop';
  } else {
    if (door) door.name = 'aftHatch';
    if (ladder) ladder.name = 'ladderTop';
  }
  if (plug) plug.visible = false;
  const lt = model.getObjectByName('ladderTop');
  if (lt) {
    const aft = new THREE.Object3D();
    aft.name = 'aft';
    model.add(aft);
    model.updateWorldMatrix(true, true);
    aft.position.copy(model.worldToLocal(lt.getWorldPosition(new THREE.Vector3())));
  }
  return { door: aftDoor || door, plug: aftDoor ? null : plug, inward: !aftDoor && hatch === 'inward', top: hatch === 'top', aft: !!aftDoor, side: aftDoor ? door : null };
}

function installCapsule(group, id) {
  const template = templates.get(id);
  if (!template) return false;
  const model = template.clone(true);
  model.name = `cockpit:${id}`;
  group.clear();
  group.add(model);
  const variant = variantFor(id);
  const { door, plug, inward, aft: hasAft, side: sideDoor } = applyVariant(model, variant);
  group.userData.capsule = id;
  group.userData.variant = variant;
  let tri = 0;
  model.traverse((o) => { if (o.isMesh && o.visible) tri += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  group.userData.triangles = Math.round(tri);

  const cabinLight = new THREE.PointLight(0xfff0e2, 2.6, 5, 1.6);
  cabinLight.position.set(0, 0.1, -0.3);
  const screenLight = new THREE.PointLight(0x67e8f9, 0.22, 2, 2);
  screenLight.position.set(0, -0.15, -0.4);
  const alarmGlow = new THREE.PointLight(0xff2a1f, 0, 5, 2);
  alarmGlow.position.set(0, 0.3, -0.4);
  group.add(cabinLight, screenLight, alarmGlow);
  const ctrl = installControls(group, model, { panelNormal: new THREE.Vector3(0, 0, 1), lights: { cabinLight, alarmGlow, cabinBase: 2.6 } });
  installHands(group, model, ctrl);

  // hatch: pivot at the hinge, local y = hinge axis. openHatch(t) 0 closed .. 1 open (plug hatch swings in, the others out; the aft hatch swings up toward the crew).
  const doorBase = door?.quaternion.clone();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const swing = (node, base, a) => node.quaternion.copy(base).multiply(_q.setFromEuler(_e.set(0, a, 0)));
  group.userData.openHatch = (t = 1) => {
    const u = Math.min(1, Math.max(0, t));
    if (!door) return false;
    const a = (inward ? 1 : -1) * (hasAft ? 1.62 : 1.75) * u * u * (3 - 2 * u);
    swing(door, doorBase, a);
    if (plug) plug.visible = u > 0.02;
    return true;
  };
  if (hasAft && sideDoor) {
    const sideBase = sideDoor.quaternion.clone();
    group.userData.openSideHatch = (t = 1) => {
      const u = Math.min(1, Math.max(0, t));
      swing(sideDoor, sideBase, -1.75 * u * u * (3 - 2 * u));
      return true;
    };
  }
  if (hasAft) installAft(group, model, ctrl, { screenLight });
  return true;
}

// ---- Aft hatch route (Apollo): harness, float path, cabin attachment ------------------------------------------------------------
const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
const STRAPS = { shL: [1.05, 1.45, 0.5, 0.9], shR: [0.95, 1.5, 0.55, 0.8], lpL: [0.85, 1.2, 0.7, 1.0], lpR: [0.9, 1.35, 0.6, 0.9], cr: [0.7, 1.1, 0.15, -0.5] }; // lift a, lift b, side a, side b (rad)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Quaternion();

function installAft(group, model, ctrl, { screenLight }) {
  // --- harness(t): 0 buckled .. 1 released. Each strap is a 2-segment chain, local x along the strap, z up (toward the apex).
  model.updateMatrixWorld(true);
  const seats = [];
  for (let i = 0; i < 3; i++) {
    const buckle = model.getObjectByName(`hs${i}_buckle`);
    if (!buckle) continue;
    const cap = model.getObjectByName(`hs${i}_cap`);
    const straps = [];
    for (const [key, [la, lb, sa, sb]] of Object.entries(STRAPS)) {
      const a = model.getObjectByName(`hs${i}_${key}_a`), b = model.getObjectByName(`hs${i}_${key}_b`);
      if (!a || !b) continue;
      // outward side in the strap's own frame: left straps drift to -x of the couch, right straps to +x
      const outward = _v.set(key.endsWith('L') ? -1 : key.endsWith('R') ? 1 : 0.4, 0, 0);
      const yAxis = _w.set(0, 1, 0).applyQuaternion(a.getWorldQuaternion(_x));
      const sgn = Math.sign(yAxis.dot(outward)) || 1;
      straps.push({ a, b, qa: a.quaternion.clone(), qb: b.quaternion.clone(), la, lb, sa: sa * sgn, sb: sb * sgn, ph: i * 1.7 + straps.length * 0.9 });
    }
    seats.push({ buckle, cap, capBase: cap?.quaternion.clone(), straps });
  }
  let released = 0;
  const setStraps = (u, time) => {
    const open = smooth(u * 1.15 - 0.15);
    for (const s of seats) {
      if (s.cap) s.cap.quaternion.copy(s.capBase).multiply(_q2.setFromEuler(_e2.set(0, 0, 1.3 * smooth(u * 4))));
      for (const st of s.straps) {
        const wob = u >= 0.999 ? 1 : 0;
        const w1 = wob * 0.12 * Math.sin(time * 0.9 + st.ph), w2 = wob * 0.2 * Math.sin(time * 1.3 + st.ph * 1.6);
        st.a.quaternion.copy(st.qa).multiply(_q2.setFromEuler(_e2.set(0, -st.la * open + w1, st.sa * open + w2 * 0.5)));
        st.b.quaternion.copy(st.qb).multiply(_q2.setFromEuler(_e2.set(0, -st.lb * open * 0.8 + w2, st.sb * open - w1)));
      }
    }
  };
  group.userData.harness = (t = 1) => { released = Math.min(1, Math.max(0, t)); setStraps(released, performance.now() / 1000); return seats.length > 0; };
  ctrl.addFrame((dt, now) => { if (released >= 0.999) setStraps(1, now / 1000); });
  ctrl.addFrame(() => { warmStep?.(); });

  // --- float path: waypoints are Object3Ds in the cockpit frame (couch eye, over the head rest, in front of the hatch, hatch mouth, collar end)
  const named = (n) => model.getObjectByName(n);
  const wp = ['wp_couch', 'wp_over', 'wp_front', 'wp_mouth', 'passageEnd'].map(named).filter(Boolean);
  group.userData.floatPath = wp;
  const passageEnd = named('passageEnd');

  // --- the cabin: stands upright behind the aft bulkhead, in the cockpit's frame (identity rotation); its -Z bulkhead hatch meets the collar end (passageEnd)
  let attached = null;
  let warmStep = null; // prepareCabin's per-frame GPU upload, run from the frame hook below
  const viewer = new THREE.Vector3();
  const lightTarget = new THREE.Vector3();
  const _cabinLocal = new THREE.Vector3();
  let lightOn = false;
  group.userData.attachCabin = (cabin) => {
    if (!cabin || !passageEnd) return null;
    const bh = cabin.userData.bulkheadHatch || { x: 0, y: 0.925, z: -4, r: 0.375 };
    if (attached && attached !== cabin) group.userData.detachCabin();
    cabin.visible = true;
    cabin.userData.attached = true;
    cabin.userData.setLights?.(false);   // light counts are baked into shaders: the cockpit's own lights light the cabin while attached
    cabin.userData.setWindowViews?.(false); // windows show the real scene
    cabin.quaternion.identity();
    cabin.position.set(passageEnd.position.x - bh.x, passageEnd.position.y - bh.y, passageEnd.position.z - bh.z);
    cabin.updateMatrixWorld(true);
    group.add(cabin);
    cabin.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    attached = cabin;
    group.userData.cabin = cabin;
    // float path continues through the collar into the aisle: standing eye height, 1.1 m in, facing +Z
    const entry = new THREE.Object3D();
    entry.name = 'cabinEntry';
    cabin.add(entry);
    entry.position.set(bh.x, 1.65, bh.z + 1.1);
    entry.rotation.y = Math.PI;
    cabin.userData.cabinEntry = entry;
    group.userData.floatPath = [...wp, entry];
    return cabin;
  };
  // Optional, call it a few seconds before attachCabin (e.g. on entering ORBIT): builds the cabin if none is given, hangs it hidden under the cockpit and
  // compiles its shaders in the scene the cockpit is really in, so attachCabin and the first frame in the cabin do not stall. Resolves with the cabin.
  group.userData.prepareCabin = async (cabin = createCabin()) => {
    const renderer = gfx.renderer;
    if (!renderer || !passageEnd) return cabin;
    group.userData.attachCabin(cabin);
    let root = group;
    while (root.parent) root = root.parent;
    cabin.traverse((o) => { if (o.isMesh) for (const mat of [o.material].flat()) { for (const k of ['map', 'bumpMap', 'alphaMap', 'emissiveMap']) if (mat[k]) renderer.initTexture?.(mat[k]); } });
    if (root.isScene && renderer.compileAsync) {
      const { graphics } = await import('./index.js');
      const target = graphics.composer?.inputBuffer ?? null, previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        const done = renderer.compileAsync(root, graphics.camera || new THREE.PerspectiveCamera()).catch(() => {});
        cabin.visible = false; // the traversal is done: nothing draws it until attachCabin shows it
        renderer.setRenderTarget(previous);
        await done;
      } finally { renderer.setRenderTarget(previous); }
      await new Promise((resolve) => {
        const step = makeCabinUploader(renderer, root, cabin, graphics);
        warmStep = () => { let done = true; try { done = step(); } catch { /* the warm-up is only an optimisation */ } if (done) { warmStep = null; resolve(); } };
      });
    }
    cabin.visible = false;
    group.userData.preparedCabin = cabin;
    return cabin;
  };
  group.userData.detachCabin = () => {
    if (!attached) return null;
    const cabin = attached;
    attached = null;
    cabin.removeFromParent();
    cabin.position.set(0, 0, 0); cabin.quaternion.identity();
    cabin.userData.openBulkheadHatch?.(0);
    cabin.userData.attached = false;
    cabin.userData.setLights?.(true);
    cabin.userData.setWindowViews?.(true);
    cabin.userData.cabinEntry?.removeFromParent();
    group.userData.cabin = null;
    group.userData.floatPath = wp;
    return cabin;
  };
  // the viewer (camera) position is read while the cockpit draws; the cabin's one light follows it a frame later
  model.traverse((o) => {
    if (o.isMesh && !o.userData.viewerHook) {
      o.userData.viewerHook = true;
      if (!group.userData._hooked) { group.userData._hooked = true; o.onBeforeRender = (r, s, cam) => { viewer.setFromMatrixPosition(cam.matrixWorld); }; }
    }
  });
  ctrl.addFrame((dt) => {
    const on = !!attached && attached.visible;
    if (on !== lightOn) {
      lightOn = on;   // the cockpit's cyan screen light becomes the cabin's one warm light while a visible cabin is attached
      if (on) { screenLight.color.set(0xffe6c8); screenLight.distance = 12; screenLight.decay = 1.7; screenLight.intensity = 9; }
      else { screenLight.color.set(0x67e8f9); screenLight.distance = 2; screenLight.decay = 2; screenLight.intensity = 0.22; }
    }
    if (!on) return;
    _cabinLocal.copy(viewer);
    group.worldToLocal(_cabinLocal);
    attached.worldToLocal(_cabinLocal);
    const bh = attached.userData.bulkheadHatch || { x: 0, y: 0.925, z: -4, r: 0.375 };
    // inside the cabin (past the bulkhead plane) the light rides under the ceiling over the viewer; in the cockpit it hangs in the aisle just beyond the hatch
    const inCabin = _cabinLocal.z > bh.z + 0.05;
    lightTarget.set(inCabin ? Math.max(-1.5, Math.min(1.5, _cabinLocal.x)) : bh.x, 2.25, inCabin ? Math.max(-3.4, Math.min(3.4, _cabinLocal.z)) : bh.z + 1.0);
    attached.localToWorld(lightTarget);
    group.worldToLocal(lightTarget);
    const k = 1 - Math.exp(-6 * Math.min(0.1, dt));
    screenLight.position.lerp(lightTarget, k);
    screenLight.intensity += ((inCabin ? 9 : 5) - screenLight.intensity) * k;
  });
}
const _q2 = new THREE.Quaternion(), _e2 = new THREE.Euler();

// First draw of the cabin uploads ~115k triangles and its textures and builds the GPU pipelines of its materials (a stall of 100 to 250 ms in one frame). Do it ahead of time,
// a few meshes per frame (graphics calls the cockpit's frame hooks before it renders, so the extra draw never nests in a frame), into the composer's own input buffer
// (same attachments as the real frame, so the pipelines built now are the ones the real frame uses), scissored to a 16 px corner, with the real camera (the cockpit's
// viewer hook reads that camera). Returns a per-frame step: step() -> true when everything has been drawn once.
function makeCabinUploader(renderer, root, cabin, graphics) {
  const camera = graphics.camera;
  const meshes = [];
  cabin.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  const target = graphics.composer?.inputBuffer ?? null;
  const box = new THREE.Vector4();
  let i = 0, n = 3; // meshes per frame, adapted to the measured CPU cost of the draw (uploads happen inside it)
  return () => {
    if (!camera || !cabin.parent || i >= meshes.length) { meshes.forEach((m) => { m.visible = true; }); cabin.visible = false; return true; }
    const slice = new Set(meshes.slice(i, i + n));
    i += slice.size;
    meshes.forEach((m) => { m.visible = slice.has(m); });
    const previous = renderer.getRenderTarget(), scissorWas = renderer.getScissorTest();
    renderer.getScissor(box);
    cabin.visible = true;
    renderer.setRenderTarget(target);
    renderer.setScissorTest(true); renderer.setScissor(0, 0, 16, 16);
    const t0 = performance.now();
    try { renderer.render(root, camera); } finally {
      const ms = performance.now() - t0;
      renderer.setScissorTest(scissorWas); renderer.setScissor(box); renderer.setRenderTarget(previous);
      cabin.visible = false;
      n = ms > 8 ? Math.max(1, n >> 1) : ms < 3 ? Math.min(30, n * 2) : n;
    }
    if (i >= meshes.length) { meshes.forEach((m) => { m.visible = true; }); return true; }
    return false;
  };
}


/** Flight-deck cockpit first (it is the fallback while the GLB loads and when it fails); hot-swap the capsule cabin in when ready. */
export function createCapsuleCockpit(id, createFallback) {
  const ready = templates.has(id);
  const group = ready ? new THREE.Group() : createFlightDeck(createFallback);
  group.name = 'cockpit';
  let installed = false;
  const install = () => { if (!installed && templates.has(id)) installed = installCapsule(group, id); };
  if (ready) { install(); return group; }
  const swap = group.userData.onFrame;
  loadCapsule(id).then(install);
  group.userData.onFrame = (...args) => { if (!installed) { install(); if (!installed) swap?.(...args); } else group.userData.onFrame?.(...args); };
  return group;
}

/** assets.get('cockpit'): the capsule's own cabin, or the Shuttle-style deck for Dream Chaser, Starship and anything else. */
export function createShipCockpit(createFallback) {
  const id = capsuleIdFor();
  if (!id || failed.has(id)) return createFlightDeck(createFallback);
  return createCapsuleCockpit(id, createFallback);
}
