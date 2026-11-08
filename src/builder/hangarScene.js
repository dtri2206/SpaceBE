// The hangar: a VAB high bay (v5, approved by the human 2026-11-08) with the real ship standing on a slim open launch
// mount at ML_TOP = 7, decks wrapping it 3/4 round with collars fitted to its hull, the crew access arm at the hatch,
// and a curved bank of four consoles on the front-left diagonal. The engineer walks the ground floor in first person;
// E at a console sits down (back to the ship) and opens its job; leaving it stands up and turns round to look up at
// the ship. index.js owns one of these for HANGAR and GONOGO. Data: public/assets/models/builder/hangar/ (layout.json
// and the v5 fragments); code ported from the sandbox (sandbox/role1.hangar.v5.js and its parts) into bay/vab/.
import * as THREE from 'three';
import { PLANETS, G0 } from '/src/core/index.js';
import { audio } from '/src/audio/index.js';
import { createPlayer } from './bay/player.js';
import { createTestStand } from './bay/teststand.js';
import { partArt } from './bay/partArt.js';
import { mountRadial, skinFor } from './bay/hullArt.js';
import { disposeObject, createDisposalQueue } from './bay/util.js';
import { loadEnvironment } from './bay/loader.js';
import { BANK_DISTANCE, deg, loadVabData, loadVabModules } from './bay/vab/load.js';
import { createHall, groundColliders, resolveCollisions } from './bay/vab/hall.js';
import { createDeckCollars } from './bay/vab/collars.js';
import { createCrewArm } from './bay/vab/access.js';
import { createLaunchMount } from './bay/vab/mount.js';
import { createConsoleBank } from './bay/vab/consoles.js';
import { createSmoke } from './bay/vab/smoke.js';
import { measureAxial, measureRadial } from './bay/vab/shipOutline.js';

const HIGHLIGHT = new THREE.Color(0x67e8f9);
const SELECTED = new THREE.Color(0xfbbf24);
const ML_TOP = 7;
const EYE = 1.65; // the player's eye height (player.js)
const LEVELS = [11, 17, 23, 29, 35, 41, 47, 53, 59, 65, 71]; // deck tops (layout.json levels), until the layout is in

// The four consoles of the bank (stage.json banks[22]) and the job each one does. Ids are the builder's own desk ids
// (hangarScreen.js); the director's console runs the readiness poll (GONOGO) instead of opening a panel.
export const CONSOLES = [
  { id: 'launchwindow', console: 'station_window', name: 'Window & weather', role: 'Pad manager', prompt: 'Sit at WINDOW & WEATHER · the launch pad desk' },
  { id: 'integration', console: 'station_builder', name: 'Spacecraft design', role: 'Lead integration engineer', prompt: 'Sit at SPACECRAFT DESIGN' },
  { id: 'teststand', console: 'station_testfire', name: 'Engine test & sim', role: 'Test conductor', prompt: 'Sit at ENGINE TEST & SIM' },
  { id: 'director', console: 'station_launch', name: 'Launch director', role: 'Launch director', prompt: 'Sit at LAUNCH DIRECTOR · readiness poll', action: 'gonogo' },
];
const VIRTUAL = [{ id: 'handbook', name: "Engineer's handbook", role: 'You' }]; // the H key; no desk in the hall

const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const pitchTo = (from, to) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

/** Pitch that frames the whole ship (base Y 7 to the tip) from an eye on the ground: the angular midpoint. */
export function framePitch(eye, top) {
  const d = Math.max(1, Math.hypot(eye.x, eye.z));
  return (Math.atan2(ML_TOP - eye.y, d) + Math.atan2(ML_TOP + top - eye.y, d)) / 2;
}

export function createHangarScene({ renderer }) {
  const scene = new THREE.Scene();
  scene.name = 'vab-hangar';
  scene.background = new THREE.Color('#111719');
  scene.fog = new THREE.FogExp2('#111719', 0.009);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 260);

  // ---------- light: the v5 calm rig (hemisphere + 4 spots, no shadows) and the hangar HDRI ----------
  scene.add(new THREE.HemisphereLight(0xcbd9dc, 0x484335, 0.32));
  const rig = [[2600, 0.3], [3200, 0.48], [520, 0.5], [600, 0.5]].map(([power, angle]) => {
    const light = new THREE.SpotLight(0xe7f0ff, power, 110, angle, 0.65, 2);
    light.castShadow = false;
    scene.add(light, light.target);
    return light;
  });
  function aimRig(h) {
    rig[0].position.set(-6, 73, -6); rig[0].target.position.set(-4, 0, -4);
    rig[1].position.set(12, 73, 12); rig[1].target.position.set(5, 0, 5);
    rig[2].position.set(-3, 9 + h * 0.3, -17); rig[2].target.position.set(0, ML_TOP + h * 0.32, 0);
    rig[3].position.set(-17, Math.min(70, 14 + h * 0.75), -4); rig[3].target.position.set(0, ML_TOP + h * 0.72, 0);
    for (const l of rig) l.target.updateMatrixWorld();
  }
  aimRig(20);
  loadEnvironment('small_hangar_01').then((env) => { if (env && !disposed) { scene.environment = env; scene.environmentIntensity = 0.35; } });

  // ---------- the ship on its mount ----------
  const rocket = new THREE.Group();
  rocket.name = 'vehicle';
  rocket.position.y = ML_TOP;
  scene.add(rocket);
  const mount = createLaunchMount(scene, ML_TOP);
  const smoke = createSmoke(scene);
  const test = createTestStand({ scene, rocket, standTop: ML_TOP, planets: PLANETS, g0: G0 });

  // ---------- the hall, loaded in the background ----------
  let disposed = false, ready = false;
  let data = null, hall = null, collars = null, crewArm = null, bank = null, island = null, assetsLoaded = null;
  let boxes = [], half = 22, levels = LEVELS;
  const bankEye = new THREE.Vector3(-BANK_DISTANCE / Math.SQRT2, EYE, -BANK_DISTANCE / Math.SQRT2);
  const screens = new Map(); // console id -> last setScreen, applied once the bank exists
  const consoleOf = (id) => {
    const def = CONSOLES.find((c) => c.id === id);
    return def && data?.bank?.consoles.find((c) => c.id === def.console);
  };

  const stations = [...CONSOLES, ...VIRTUAL].map((def) => ({
    ...def, position: null, usePoint: null,
    setScreen(s) { if (!def.console) return; screens.set(def.console, s); bank?.setScreen(def.console, { title: def.name, ...s }); },
  }));

  // ---------- the engineer ----------
  renderer.localClippingEnabled = true; // the engineer's body is clipped at the neck so the camera never sits inside the head
  const circles = () => {
    const out = [mount.footprint];
    for (const s of stations) if (s.position) out.push({ x: s.position.x, z: s.position.z, r: 0.95 });
    return out;
  };
  const player = createPlayer(scene, camera, { collide: (p, r) => resolveCollisions(p, r, boxes, circles(), half), start: { x: bankEye.x, z: bankEye.z }, gravity: PLANETS.earth.g });
  player.lookAt(0, 0, framePitch(bankEye, 20));

  (async () => {
    data = await loadVabData();
    if (disposed) return;
    levels = data.layout.levels.map((l) => l.y);
    half = data.halfWidth;
    boxes = groundColliders(data);
    for (const s of stations) {
      const c = consoleOf(s.id);
      if (!c) continue;
      s.position = new THREE.Vector3(c.position[0], 0, c.position[2]);
      s.usePoint = new THREE.Vector3(c.interactPoint[0], 0, c.interactPoint[2]);
    }
    if (data.bank) bankEye.set(data.bank.eye[0], EYE, data.bank.eye[2]);
    assetsLoaded = await loadVabModules(data, renderer, () => !disposed);
    if (disposed) return;
    const { assets, materials } = assetsLoaded;
    hall = createHall({ scene, data, assets, materials, renderer, camera });
    hall.build();
    collars = createDeckCollars({ scene, layout: data.layout, fragment: data.fragments.decks });
    crewArm = createCrewArm(data.fragments.access);
    if (data.bank) {
      const src = assets.get(data.bank.island.module);
      if (src) {
        island = src.clone(true);
        island.name = 'bank_island_v5';
        island.position.fromArray(data.bank.island.position);
        island.rotation.set(0, deg(data.bank.island.rotation[1]), 0);
        scene.add(island);
      }
      bank = createConsoleBank({ scene, assets, layout: data.layout, consoles: data.bank.consoles });
      for (const s of stations) if (s.console && screens.has(s.console)) bank?.setScreen(s.console, { title: s.name, ...screens.get(s.console) });
    }
    ready = true;
    if (layoutCache.length) applyLayout(layoutCache); // measured again at the layout's own deck levels
    if (decksMode === 'retract') { hall.setMode('retract', { instant: true }); crewArm.retracted = true; }
  })().catch((e) => console.warn('[builder] VAB hall:', e.message));

  // ---------- vehicle ----------
  const groups = new Map();
  const glows = new Map();
  const trash = createDisposalQueue();
  let selected = null;
  let layoutCache = [];
  let shipData = null; // { entries, hull, top } in metres above ML_TOP
  let active = true, stale = false;

  /** The vehicle on the mount. Deferred while the design studio covers the hall (setActive(false)). */
  function setLayout(layout) {
    layoutCache = layout;
    if (!active) { stale = true; return; }
    applyLayout(layout);
  }
  function applyLayout(layout) {
    stale = false;
    for (const child of [...rocket.children]) {
      if (child.name === 'vfx-run') continue;
      rocket.remove(child);
      trash.add(child); // disposed after the new parts are drawn, so their shader programs are kept
    }
    groups.clear();
    const at = levels.map((y) => y - ML_TOP);
    // the outer skin (hull.js): on the mount the ship is finished, so the equipment inside it and the parts it covers
    // are not drawn at all (the design studio shows them through the skin while a card is open)
    const { hull, object: skin } = skinFor(layout);
    rocket.add(skin);
    const hidden = new Set([...hull.insideIds, ...hull.coveredIds]);
    for (const e of layout) {
      if (hidden.has(e.id)) continue;
      const art = partArt(e);
      let holder = art;
      if (e.attach === 'radial') { holder = mountRadial(art, e, layout); measureRadial(holder, e, at); }
      else { art.position.y = e.y; measureAxial(art, e, at); }
      holder.userData.partId = e.id;
      rocket.add(holder);
      groups.set(e.id, holder);
    }
    shipData = { entries: layout, hull: hull.segments, top: Math.max(0, ...layout.filter((e) => e.attach === 'axial').map((e) => e.y + e.height)) };
    fitShip();
    applyGlow();
  }
  function fitShip() {
    if (!shipData) return;
    mount.update(shipData);
    aimRig(shipData.top);
    if (!ready) return;
    hall.setFits(collars.fit(shipData.entries, shipData.hull));
    crewArm.fit(shipData);
  }
  function setActive(on) {
    active = Boolean(on);
    if (active && stale) applyLayout(layoutCache);
  }
  const top = () => shipData?.top ?? 20;

  function applyGlow() {
    for (const [id, holder] of groups) {
      const glow = glows.get(id);
      const color = selected === id ? SELECTED : glow ? glow.color : null;
      holder.traverse((o) => {
        if (!o.isMesh || !o.material || !('emissive' in o.material)) return;
        if (!o.material.userData.cloned) {
          o.material = o.material.clone();
          o.material.userData.cloned = true;
          o.material.userData.baseEmissive = o.material.emissive.clone();
          o.material.userData.baseIntensity = o.material.emissiveIntensity;
        }
        if (color) { o.material.emissive.copy(color); o.material.emissiveIntensity = 0.9; }
        else { o.material.emissive.copy(o.material.userData.baseEmissive); o.material.emissiveIntensity = o.material.userData.baseIntensity; }
      });
    }
  }
  function highlight(ids, seconds = 1.6, color = HIGHLIGHT) {
    const until = performance.now() / 1000 + seconds;
    for (const id of ids) if (groups.has(id)) glows.set(id, { until, color });
    applyGlow();
  }
  function select(id) { selected = id; applyGlow(); }

  // ---------- consoles: sit down, stand up and turn around ----------
  let view = null; // null: the player drives the camera; otherwise a seat or a reveal animation
  let seatedId = null;
  const q0 = new THREE.Quaternion(), e0 = new THREE.Euler();
  const quatLooking = (eye, target) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchTo(eye, target), yawTo(eye, target), 0, 'YXZ'));

  function nearestStation() {
    if (view) return null;
    const p = player.position, fwd = player.forward();
    let best = null, bestD = Infinity;
    for (const s of stations) {
      if (!s.position) continue;
      const d = Math.hypot(s.position.x - p.x, s.position.z - p.z);
      if (d > 3.2) continue;
      const to = new THREE.Vector3(s.position.x - p.x, 0, s.position.z - p.z).normalize();
      if (to.dot(fwd) < 0.35) continue;
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }
  function placeAtStation(id) {
    const s = stations.find((st) => st.id === id);
    if (!s?.usePoint) return;
    player.teleport(s.usePoint.x, s.usePoint.z);
    player.lookAt(s.position.x, s.position.z, -0.1);
  }
  /** Sits at a console: the camera goes to the seat, back to the ship, facing the desk (instant for the poll). */
  function sit(id, { instant = false } = {}) {
    seatedId = id;
    const c = consoleOf(id);
    if (!c) return;
    player.teleport(c.interactPoint[0], c.interactPoint[2]);
    player.lookAt(c.position[0], c.position[2], -0.1);
    const eye = new THREE.Vector3(...c.seatedEye), target = new THREE.Vector3(...c.seatedTarget);
    view = { kind: 'seat', t: instant ? 1 : 0, from: camera.position.clone(), fromQ: camera.quaternion.clone(), to: eye, toQ: quatLooking(eye, target) };
  }
  /** Stands up and turns round over the shoulder that faces the bank's centre line, ending looking up at the ship. */
  function standUp() {
    const id = seatedId;
    seatedId = null;
    if (!view || view.kind !== 'seat') { view = null; return; }
    const c = consoleOf(id);
    if (!c) { view = null; return; }
    const to = new THREE.Vector3(c.turnaroundView.position[0], EYE, c.turnaroundView.position[2]);
    const pitch1 = framePitch(to, top());
    e0.setFromQuaternion(camera.quaternion, 'YXZ');
    let dYaw = yawTo(to, new THREE.Vector3(0, 0, 0)) - e0.y;
    while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
    while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
    if (Math.abs(dYaw) > 2.6 && data?.bank) {
      const u = new THREE.Vector3(-Math.SQRT1_2, 0, -Math.SQRT1_2);
      const fwd = new THREE.Vector3(-Math.sin(e0.y), 0, -Math.cos(e0.y));
      const e = camera.position.clone().sub(new THREE.Vector3(...data.bank.centre)).setY(0);
      const v = e.clone().addScaledVector(u, -e.dot(u)).negate();
      const want = fwd.x * v.z - fwd.z * v.x < 0 ? 1 : -1;
      if (Math.sign(dYaw) !== want) dYaw -= Math.sign(dYaw) * 2 * Math.PI;
    }
    view = { kind: 'reveal', t: 0, from: camera.position.clone(), to, yaw0: e0.y, dYaw, pitch0: e0.x, pitch1 };
  }
  function applyView(dt) {
    if (view.kind === 'seat') {
      view.t = Math.min(1, view.t + dt / 0.45);
      const k = smooth(view.t);
      camera.position.lerpVectors(view.from, view.to, k);
      camera.quaternion.slerpQuaternions(view.fromQ, view.toQ, k);
      return;
    }
    view.t = Math.min(1, view.t + dt / 1.5);
    const t = view.t, up = smooth(t / 0.45), turn = smooth((t - 0.15) / 0.85), tilt = smooth((t - 0.4) / 0.6);
    camera.position.set(THREE.MathUtils.lerp(view.from.x, view.to.x, turn), THREE.MathUtils.lerp(view.from.y, view.to.y, up), THREE.MathUtils.lerp(view.from.z, view.to.z, turn));
    camera.quaternion.setFromEuler(e0.set(THREE.MathUtils.lerp(view.pitch0, view.pitch1, tilt), view.yaw0 + view.dYaw * turn, 0, 'YXZ'));
    if (t === 1) {
      player.teleport(view.to.x, view.to.z, view.yaw0 + view.dYaw);
      player.setPitch(view.pitch1);
      view = null;
    }
  }
  /** The engineer stands at the bank and looks up at the ship (the static fire, the investigation board). */
  function lookAtShip({ yawOffset = 0, pitchScale = 1 } = {}) {
    view = null;
    seatedId = null;
    player.teleport(bankEye.x, bankEye.z);
    player.lookAt(0, 0, framePitch(bankEye, top()) * pitchScale);
    if (yawOffset) player.teleport(bankEye.x, bankEye.z, player.yaw + yawOffset);
  }

  // ---------- decks: retract (static fire, launch) and close ----------
  let decksMode = 'close';
  const sfx = []; // [{ at, fn }] scheduled sounds, on the bay clock
  let clock = 0;
  const later = (seconds, fn) => sfx.push({ at: clock + seconds, fn });
  function retract({ sound = true, puffs = true } = {}) {
    if (decksMode === 'retract') return;
    decksMode = 'retract';
    if (crewArm) crewArm.retracted = true;
    if (!hall) return;
    const fits = collars?.fits ?? [];
    hall.setMode('retract');
    if (puffs) {
      for (const s of data.fragments.decks.segments ?? []) {
        const r = deg(s.rotation ?? 0), c = Math.cos(r), sn = Math.sin(r);
        levels.forEach((y, level) => {
          if (fits[level]?.[s.id]?.retract) return; // this deck was already back
          for (const [x, z] of [[13.4, -2.6], [13.4, -7.2]]) smoke.puff(x * c + z * sn, y - 1.3, -x * sn + z * c, (10 - level) * 0.045 + Math.random() * 0.12, s.slideAxis[0], s.slideAxis[2]);
        });
      }
    }
    if (sound) {
      audio.play('cockpit.lock');
      audio.play('engine.rumble', { loop: true, volume: 0.32, rate: 0.55 });
      later(1.25, () => audio.play('impact.small', { volume: 0.7 }));
      later(1.45, () => audio.stop('engine.rumble', { fade: 0.5 }));
    }
  }
  function closeDecks({ instant = false } = {}) {
    decksMode = 'close';
    if (crewArm) crewArm.retracted = false;
    hall?.setMode('close', { instant });
  }

  // ---------- the launch: stand up from the director's console, decks back, then PRELAUNCH ----------
  let launch = null;
  function startLaunch() {
    launch = { t: 0, retracted: false, done: false };
    standUp();
  }

  // ---------- frame ----------
  function update(dt, controls = {}) {
    clock += dt;
    trash.tick();
    const now = performance.now() / 1000;
    let changed = false;
    for (const [id, glow] of glows) if (glow.until < now) { glows.delete(id); changed = true; }
    if (changed) applyGlow();
    for (const [id, holder] of groups) {
      if (!glows.get(id) && selected !== id) continue;
      const pulse = 0.55 + 0.45 * Math.sin(now * 6);
      holder.traverse((o) => { if (o.isMesh && o.material?.userData?.cloned) o.material.emissiveIntensity = 0.5 + 0.7 * pulse; });
    }
    const still = !!view || controls.frozen;
    player.update(dt, still ? { ...controls, frozen: true, forward: 0, right: 0, jump: false, lookDelta: { x: 0, y: 0 } } : controls);
    player.body.visible = !view;
    player.hands.visible = !view;
    if (view) applyView(dt);
    if (hall) {
      hall.update(dt);
      collars.update(hall.offsetOf);
      if (!crewArm.state.settled) hall.repose('crewArm', (holder) => crewArm.pose(holder, dt));
    }
    smoke.update(dt);
    test.update(dt);
    for (let i = sfx.length - 1; i >= 0; i--) if (sfx[i].at <= clock) { const s = sfx.splice(i, 1)[0]; s.fn(); }
    if (launch && !launch.done) {
      launch.t += dt;
      if (!launch.retracted && launch.t >= 0.9) { launch.retracted = true; retract(); }
      if (launch.retracted && launch.t >= 2.6 && (!hall || !hall.sliding() || launch.t > 4.5)) launch.done = true;
    }
  }

  function dispose() {
    disposed = true;
    for (const child of [...rocket.children]) disposeObject(child);
    trash.flush();
    player.dispose();
    hall?.dispose();
    collars?.dispose();
    bank?.dispose();
    mount.dispose();
    smoke.dispose();
  }

  return {
    scene, camera, rocket, player, stations, test,
    setLayout, setActive, highlight, clearHighlight: () => { glows.clear(); applyGlow(); }, select,
    nearestStation, placeAtStation, sit, standUp, lookAtShip, retract, closeDecks, startLaunch, update, dispose,
    /** The static fire: decks and crew arm back, the engineer at the bank looking at the engines. */
    watchTest() { retract({ sound: true, puffs: false }); lookAtShip({ pitchScale: 0.55 }); },
    /** Beside the investigation board: the whole ship on the right of the screen. */
    standBack() { lookAtShip({ yawOffset: 0.3 }); },
    get seated() { return seatedId; },
    get launchDone() { return !!launch?.done; },
    get ready() { return ready; },
    get layout() { return layoutCache; },
    get planets() { return PLANETS; },
    get g0() { return G0; },
    // debug / screenshots only
    get vab() { return { data, hall, collars, crewArm, bank, mount, smoke, shipData, decksMode, assets: assetsLoaded }; },
  };
}
