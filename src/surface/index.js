// Role 2 surface module: owns INTERIOR (walkable cabin) and SURFACE (Mars EVA) (contract.js STATE_OWNERS).
// First-person walking with Mars gravity, suit O₂, cabin stations, airlock, Role 3's cabin and Mars terrain,
// and the suit HUD (helmet frame + life support panel).
//
//   INTERIOR  stations: pilotSeat (→ LANDING cockpit, or → RETURN when Mars Exploration is 100 %), suitLocker,
//             o2Station, commsConsole, sampleStorage, bunk, airlock (suit on → 3 s cycle → SURFACE).
//   SURFACE   walk Jezero; O₂ drains (30/15/5 % cautions, 0 % → flight:failed outOfBreath); the hatch → INTERIOR.
//             Two crewed rovers are parked by the lander: the Apollo LRV (E to drive) and the futuristic MR-01
//             (locked until Mars Exploration reaches 50 %). E to drive, E to get out.
//
// registerInteractable({ id, position, prompt, onUse, hold?, radius?, state? }) is the README/contract API for
// Role 4's tasks. `state` ('SURFACE' or 'INTERIOR') limits where it can be used; positions are in that scene's
// metres (SURFACE: Role 3 terrain, landing site at the origin, y from getTerrainHeight). Returns an unregister function.
import * as THREE from 'three';
import { getTerrainHeight, graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { PLANETS, events, getState, input, requestState, ui } from '/src/core/index.js';
import { getProgress } from '/src/missions/index.js';
import { WalkController } from './WalkController.js';
import { createInteractables } from './interactables.js';
import { createShipInterior, CABIN, PREBREATHE_DEBUG_S } from './shipInterior.js';
import { createSuitHUD } from './hud/createSuitHUD.js';
import { astronaut } from './astronaut.js';
import { getCabin, getMars, getMarsSunSetter, prepareScenes } from './scenes.js';
import { createSolClock, createEarthCaption, easeFov, isLookingAtEarth, shouldStartFastDusk, fastDuskMission, NORMAL_FOV } from './dusk.js';
import { RoverController, ROVER, ROVER_MR01 } from './RoverController.js';
import { mr01Unlock, MR01_LOCKED_PROMPT, MR01_UNLOCKED_NOTICE } from './rovers.js';
import { createRoverModel } from './roverModel.js';
import { createGroundMarks } from './groundMarks.js';
import {
  exploration, createFirstStepSequence, FIRST_STEP_LINE, MAX_FIRST_WORDS,
  walkReachMetres, roverReachMetres, reachLine, parseTargetDistance, targetBeyondReach,
} from './explore.js';

const TELEMETRY_EVERY = 0.5;
const LANDER_RADIUS = 3.2; // m, the lander's legs: you can't walk through them
const HATCH = { x: 0, z: 3.6 }; // where you climb back in (in front of the lander)
const MAX_MOUSE_STEP = 300; // px per frame: ignore the jump some browsers report right after pointer lock
const ROVER_PARKING = { x: 6.5, z: 7, heading: -0.6 }; // the Apollo LRV, unfolded next to the lander
// MR-01 on the other side of the lander, mirrored so the two rovers frame the hatch view; inside Role 3's flat landing zone (60 m)
const MR01_PARKING = { x: -7, z: 7, heading: 0.6 };
// Crew-life props in the cabin open these Guidebook entries (Role 4 writes them; ids listed in the README).
export const PROP_ENTRIES = { exerciseBike: 'crew-exercise', waterRecycler: 'crew-water', foodRack: 'crew-food', familyPhoto: 'family-photo' };

// Mars dusk / "Pale Blue Dot" texts (Role 4 may edit them here).
export const EARTH_HINT = 'Look for Earth: low in the sky, hold Z to zoom';
export const EARTH_CAPTION = ['EARTH · about 225 million km away', 'Everyone you have ever loved is on that dot.']; // wording approved by Role 4 (spec §11)

// ---- Exports for Role 4 (optional calls: guard with try/catch or `typeof`) ----
// getFirstWords() -> string | null
//   What the astronaut said at the foot of the ladder ("your first words on Mars", max 80 chars; "Hello, Mars." when skipped).
//   null until the first step has been taken this mission; reset with every new mission. Use it in the endings.
// getReach() -> { walkMetres, roverMetres, roverName, origin: { x, z }, ship: { x, z } } | null
//   How far the astronaut can still go AND come back (20 % margin), SURFACE only (null inside the ship or in other states).
//   walkMetres: current suit tank only (no spares) at a walking pace. roverMetres/roverName: the rover being driven, else the
//   nearest one, from its battery (null if none). origin: where the astronaut is now (centre for map reach rings);
//   ship: the hatch (the way home). Metres in SURFACE scene coordinates (x, z).
export function getFirstWords() { return exploration.firstWords; }
export function getReach() {
  if (!s || s.inside) return null;
  return computeReach();
}

const registry = createInteractables();

export function registerInteractable(def) {
  const allowed = def.enabled;
  return registry.register({
    ...def,
    enabled: () => (!def.state || def.state === getState()) && (typeof allowed === 'function' ? allowed() : allowed !== false),
  });
}

// The hatch on the landed ship (always there on the surface).
registerInteractable({
  id: 'hatch', state: 'SURFACE', radius: 3, minFacing: 0.3, prompt: 'E: climb back into the airlock',
  position: { x: HATCH.x, y: getTerrainHeight(HATCH.x, HATCH.z) + 1.5, z: HATCH.z },
  onUse: () => requestState('INTERIOR'),
});

// Both rovers keep their place, battery and odometer across visits outside (module-level, like the astronaut).
// An entry: { key, spec, assetName, parking, spot (interactable position), collider (walker + other rover can't pass), rover, model }.
function makeFleetEntry(key, spec, assetName, parking) {
  return {
    key, spec, assetName, parking, rover: null, model: null,
    spot: { x: parking.x, y: 0, z: parking.z },
    collider: { x: parking.x, z: parking.z, r: 1.6 },
  };
}
const fleet = {
  lrv: makeFleetEntry('lrv', ROVER, 'rover:lrv', ROVER_PARKING),
  mr01: makeFleetEntry('mr01', ROVER_MR01, 'rover', MR01_PARKING),
};
const fleetList = Object.values(fleet);
let active = null; // the fleet entry being driven
function getRover(entry) {
  if (!entry.rover) {
    const other = entry === fleet.lrv ? fleet.mr01 : fleet.lrv;
    entry.rover = new RoverController({
      gravity: PLANETS.mars.g, getGroundHeight: getTerrainHeight, start: entry.parking, spec: entry.spec,
      colliders: [{ x: 0, z: 0, r: LANDER_RADIUS }, other.collider], onNotice: (type, d) => roverNotice(type, d),
    });
    entry.model = createRoverModel(entry.assetName);
  }
  return entry.rover;
}
const syncSpot = (e) => { // keep the interactable and collider on the rover
  if (!e.rover) return;
  e.spot.x = e.collider.x = e.rover.x;
  e.spot.z = e.collider.z = e.rover.z;
  e.spot.y = e.rover.y + 1.0;
};
registerInteractable({
  id: 'rover', state: 'SURFACE', radius: 3.2, minFacing: 0.3, position: fleet.lrv.spot,
  prompt: 'E: drive the Apollo LRV',
  enabled: () => !s?.driving && !fleet.lrv.rover?.overturned,
  onUse: () => boardRover('lrv'),
});
registerInteractable({
  id: 'rover:mr01', state: 'SURFACE', radius: 3.2, minFacing: 0.3, position: fleet.mr01.spot,
  prompt: () => (mr01Unlock.unlocked ? 'E: drive MR-01' : MR01_LOCKED_PROMPT),
  enabled: () => !s?.driving && !fleet.mr01.rover?.overturned,
  onUse: () => boardRover('mr01'), // does nothing while locked
});

// Wheel tracks and boot prints persist across visits (module-level); added to the Mars scene only while outside.
let marks = null;
const getMarks = () => (marks ??= createGroundMarks({ getGroundHeight: getTerrainHeight }));
const isDebug = () => new URLSearchParams(location.search).get('debug') === '1';

// The sol clock keeps its time across visits outside (module-level, like the rover); it only runs outside.
let solClock = null;
const getSolClock = () => (solClock ??= createSolClock({ apply: getMarsSunSetter() }));
let earthHintShown = false;
let surfaceSince = 0; // like Role 4: set on every SURFACE entry
let cachedPercent = 0; // Mars Exploration percent (progress:changed / getProgress)
const earthCaption = createEarthCaption({ seconds: 8 });
const earthDir = new THREE.Vector3();

let s = null;
let previous = null; // the surface state we just left (to spawn inside the airlock when coming back in)

function roverNotice(type, d) {
  if (!s) return;
  if (type === 'rollover') {
    audio.play('impact.small');
    audio.play('alarm.master');
    s.notice = { text: 'ROVER OVERTURNED: press E to climb out. Keep side slopes under 40° and slow down for crests.', t: 8 };
  } else if (type === 'hard_landing') {
    astronaut.dust.burst(0.12);
    audio.play('impact.small');
    s.notice = { text: `The suspension bottomed out (${d.impact.toFixed(1)} m/s). Low gravity means long hops: slow down over crests.`, t: 5 };
  } else if (type === 'bump') {
    astronaut.dust.burst(Math.min(0.15, Math.abs(d?.speed ?? 2) * 0.02));
    audio.play('impact.small');
  } else if (type === 'battery_empty') {
    s.notice = { text: 'ROVER BATTERY EMPTY: walk back to the ship.', t: 8 };
  }
}

function boardRover(key = 'lrv') {
  const entry = fleet[key] ?? fleet.lrv;
  if (!s || s.inside || s.driving) return;
  if (entry === fleet.mr01 && !mr01Unlock.unlocked) return; // locked: E does nothing
  getRover(entry);
  active = entry;
  s.driving = true;
  s.look = { yaw: 0, pitch: -0.08 };
  s.notice = { text: 'Driving: W/S throttle and reverse · A/D steer · SPACE brake · E get out', t: 6 };
}

function leaveRover() {
  if (!s?.driving) return;
  s.driving = false;
  // step off on the driver's (left) side, facing the way the rover points
  const rover = active.rover;
  const r = rover.right;
  const x = rover.x - r.x * 1.7, z = rover.z - r.z * 1.7;
  s.walker.pos.x = x;
  s.walker.pos.z = z;
  s.walker.pos.y = getTerrainHeight(x, z);
  s.walker.vel.x = s.walker.vel.y = s.walker.vel.z = 0;
  s.walker.yaw = rover.heading;
  s.walker.pitch = 0;
  syncSpot(active);
  active = null;
}

// Reach: how far can I still go and come back? (maths in explore.js). Outside only.
function nearestRoverEntry() {
  const w = s.walker.pos;
  if (active) return active;
  let best = null, bestD = Infinity;
  for (const e of fleetList) {
    if (!e.rover) continue;
    const d = Math.hypot(e.rover.x - w.x, e.rover.z - w.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
function computeReach() {
  const w = s.walker.pos;
  const e = nearestRoverEntry();
  return {
    walkMetres: walkReachMetres(astronaut.oxygen.secondsLeft),
    roverMetres: e ? roverReachMetres(e.spec, e.rover.batteryWh, PLANETS.mars.g) : null,
    roverName: e ? e.spec.name : null,
    origin: { x: w.x, z: w.z },
    ship: { x: HATCH.x, z: HATCH.z },
  };
}
// Role 4's mission HUD shows "<target> · 123 m"; read the distance back so we can warn when it is out of reach.
function nextTargetMetres() {
  const el = document.querySelector('.role4-mission-target');
  if (!el || el.style.display === 'none') return null;
  return parseTargetDistance(el.textContent);
}
function updateReach(dt) {
  s.reachClock = (s.reachClock ?? 99) + dt;
  if (s.reachClock < 0.25) return s.reachHud ?? null;
  s.reachClock = 0;
  const r = computeReach();
  const target = nextTargetMetres();
  const range = s.driving && r.roverMetres != null ? r.roverMetres : r.walkMetres; // driving: the rover is how you get there
  s.reachHud = { text: reachLine(r), warn: targetBeyondReach(target, range) };
  return s.reachHud;
}

// First step on Mars (once per mission): scripted moment + "your first words" prompt.
const FS_CSS = 'font:14px/1.7 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;text-shadow:0 0 8px rgba(0,0,0,.8)';
function createFirstStepUI(hudLayer) {
  const line = document.createElement('div');
  line.style.cssText = `position:absolute;left:50%;top:25%;transform:translateX(-50%);text-align:center;color:var(--hud-cyan,#67e8f9);${FS_CSS};font-size:17px;letter-spacing:.2em;white-space:nowrap;opacity:0;transition:opacity 1.6s ease`;
  line.textContent = FIRST_STEP_LINE(1);
  const box = document.createElement('form'); // Enter = submit (no key listeners outside core/input.js)
  box.style.cssText = `position:absolute;left:50%;top:33%;transform:translateX(-50%);width:min(560px,calc(100vw - 120px));text-align:center;pointer-events:auto;display:none;color:#d6eeee;padding:14px 18px;background:#07171bcc;border-radius:4px;${FS_CSS}`;
  const label = document.createElement('div');
  label.textContent = 'YOUR FIRST WORDS ON MARS';
  label.style.cssText = 'font-size:11px;color:#a1babe;margin-bottom:8px';
  const field = document.createElement('input');
  field.type = 'search'; // Chrome: Esc clears the field and fires 'search'; we treat that as skip
  field.maxLength = MAX_FIRST_WORDS;
  field.placeholder = 'Say something the world will remember…';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.setAttribute('aria-label', 'Your first words on Mars');
  field.style.cssText = 'width:100%;padding:11px 14px;background:#07171bd8;color:#eaffff;border:1px solid #81e7df88;border-radius:3px;outline:none;text-align:center;font:inherit;letter-spacing:.06em';
  const hint = document.createElement('div');
  hint.textContent = 'Enter to confirm · Esc or empty to skip';
  hint.style.cssText = 'font-size:10px;color:#a1babe;margin-top:8px';
  const css = document.createElement('style');
  css.textContent = '.fs-words::-webkit-search-cancel-button{display:none}';
  field.className = 'fs-words';
  box.append(css, label, field, hint);
  hudLayer.append(line, box);
  return { line, box, field };
}

function startFirstStep() {
  const ui_ = createFirstStepUI(s.hudLayer);
  s.fs = { seq: createFirstStepSequence(), ...ui_ };
  try { audio.fadeTo('suit.breath', 2.2, 1.2); } catch { /* the breath stays at normal volume */ }
  const { field } = s.fs;
  s.fs.box.addEventListener('submit', (ev) => { ev.preventDefault(); finishFirstStep(field.value); });
  field.addEventListener('search', () => { if (!field.value) finishFirstStep(''); });
}

// Boot print in the regolith, a little ahead of the feet (right foot).
function stampFirstBoot() {
  const { walker } = s;
  const fx = -Math.sin(walker.yaw), fz = -Math.cos(walker.yaw);
  getMarks().stamp({ x: walker.pos.x + fx * 0.85, z: walker.pos.z + fz * 0.85, dirX: fx, dirZ: fz, side: 1 });
}

function enterWordsPhase() {
  const { box, field } = s.fs;
  box.style.display = '';
  input.unlockPointer(); // typing needs the mouse back; keys typed in the field never reach the game (core input)
  field.focus();
}

function finishFirstStep(text, silent = false) {
  const fs = s?.fs;
  if (!fs || fs.seq.phase === 'done') return;
  const words = exploration.setFirstWords(text);
  fs.seq.finish();
  fs.field.blur();
  fs.box.style.display = 'none';
  fs.line.style.opacity = '0';
  try { audio.fadeTo('suit.breath', 1, 1.5); } catch { /* ignore */ }
  if (!silent) {
    input.lockPointer(); // Enter is a key press, so the browser allows this; a click also works
    s.notice = { text: `“${words}”`, t: 4.5, calm: true };
  }
}

function skipFirstStep() {
  const fs = s?.fs;
  if (!fs || fs.seq.phase !== 'scene') return;
  if (fs.seq.skip().stamp) stampFirstBoot();
  enterWordsPhase();
}

// Outside only: advance the sol clock, ease the helmet zoom, hint and caption for Earth.
function updateDusk(dt, zoomHeld) {
  const { camera } = s;
  const clock = getSolClock();
  clock.update(dt);
  const fov = easeFov(camera.fov, zoomHeld, dt);
  if (fov !== camera.fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (shouldStartFastDusk({ percent: cachedPercent, secondsOutside: (performance.now() - surfaceSince) / 1000, started: fastDuskMission.started, isDusk: clock.isDusk })) {
    fastDuskMission.started = true; // mid-mission (>= 30 %): bring the dusk so every player gets the Pale Blue Dot moment
    clock.startFastDusk();
    if (!earthHintShown) { earthHintShown = true; s.notice = { text: EARTH_HINT, t: 8, calm: true }; }
  }
  if (clock.isDusk && !earthHintShown) {
    earthHintShown = true;
    s.notice = { text: EARTH_HINT, t: 8, calm: true };
  }
  camera.getWorldDirection(earthDir);
  const show = earthCaption.update(dt, clock.isDusk && isLookingAtEarth(earthDir, camera.fov));
  s.earthEl.style.opacity = show ? '1' : '0';
}

export default {
  init() {
    setTimeout(prepareScenes, 0); // build Mars + cabin in the background so entering them never freezes
    events.on('progress:changed', ({ percent }) => { cachedPercent = percent; mr01Unlock.setPercent(percent); }); // cached; MR-01 unlocks at 50 %
    // debug handle for automated checks (only with ?debug=1)
    if (isDebug()) {
      window.__role2 = {
        boardRover: (name = 'lrv') => boardRover(name === 'mr01' || name === 'mr-01' ? 'mr01' : 'lrv'), leaveRover, unlockMr01: () => mr01Unlock.debugUnlock(),
        get rovers() { return { lrv: fleet.lrv.rover, mr01: fleet.mr01.rover }; }, get unlock() { return mr01Unlock; },
        setO2: (p) => astronaut.oxygen.debugSetPercent(p), dusk: () => getSolClock().jumpToDusk(),
        lookAt(d) { const v = new THREE.Vector3(d.x, d.y, d.z).normalize(); if (s?.walker) { s.walker.yaw = Math.atan2(-v.x, -v.z); s.walker.pitch = Math.asin(v.y); } },
        get fov() { return s?.camera.fov; }, get sol() { return solClock; },
        get dust() { return astronaut.dust; }, get marks() { return marks; }, get walker() { return s?.walker; }, get camera() { return s?.camera; },
        get cabin() { return s?.cabin; },
        get firstStep() { return s?.fs?.seq; }, firstWords: () => exploration.firstWords, reach: () => getReach(),
        // debug only: drive the rover n metres in steps (marks, dust and odometer follow), then park it
        driveMetres(n, steer = 0.4, name) { const e = name ? fleet[name === 'mr01' ? 'mr01' : 'lrv'] : (active ?? fleet.lrv); const rover = getRover(e), roverModel = e.model; for (let m = 0; m < n; m += 0.1) { rover.update(0.05, { throttle: 1, steer }); astronaut.dust.accumulate(0.05, { speed: rover.speed, mode: 'drive' }); marks?.update({ mode: 'drive', rover }); } roverModel?.update(rover, 0); syncSpot(e); },
        walkMetres(n, yaw = 0) { for (let m = 0; m < n; m += 0.1) { s.walker.pos.x -= Math.sin(yaw) * 0.1; s.walker.pos.z -= Math.cos(yaw) * 0.1; s.walker.pos.y = getTerrainHeight(s.walker.pos.x, s.walker.pos.z); marks?.update({ mode: 'walk', walker: s.walker }); } }, get rover() { return (active ?? fleet.lrv).rover; }, get driving() { return !!s?.driving; } };
    }
  },

  enter(state) {
    const inside = state === 'INTERIOR';
    if (!inside) surfaceSince = performance.now(); // Role 4 does the same on every SURFACE entry
    const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 2e5);
    const hudLayer = document.createElement('div');
    hudLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    hudLayer.dataset.screen = state;
    ui.mount(hudLayer, { layer: 'hud' });
    hudLayer.style.pointerEvents = 'none'; // ui.mount enables clicks; the HUD must never block buttons under it
    s = { state, inside, camera, hudLayer, fs: null, cabin: null, sinceTelemetry: 0, hud: createSuitHUD({ parent: hudLayer }), offs: [], notice: null };
    // short alert line under the helmet header (falls, suit breach)
    s.noticeEl = document.createElement('div');
    s.noticeEl.className = 'hud-label';
    s.noticeEl.style.cssText = 'position:absolute;left:50%;top:13%;transform:translateX(-50%);color:var(--hud-red,#ff7f87);letter-spacing:.12em;text-align:center';
    hudLayer.append(s.noticeEl);
    s.earthEl = document.createElement('div'); // "Pale Blue Dot" caption
    s.earthEl.style.cssText = 'position:absolute;left:50%;top:30%;transform:translateX(-50%);text-align:center;font:14px/1.7 ui-monospace,Menlo,Consolas,monospace;'
      + 'letter-spacing:.12em;color:var(--hud-cyan,#67e8f9);text-shadow:0 0 8px rgba(0,0,0,.8);opacity:0;transition:opacity 1.6s ease;white-space:nowrap';
    s.earthEl.innerHTML = EARTH_CAPTION.map((l) => `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
    hudLayer.append(s.earthEl);
    s.roverEl = document.createElement('div'); // rover readout while driving
    s.roverEl.className = 'hud-label';
    s.roverEl.style.cssText = 'position:absolute;left:50%;top:18%;transform:translateX(-50%);color:var(--hud-cyan,#67e8f9);letter-spacing:.1em;text-align:center';
    hudLayer.append(s.roverEl);

    if (inside) {
      const { scene, art } = getCabin();
      graphics.setView(scene, camera);
      // coming in from Mars: start just inside the airlock, facing the cabin
      const fromOutside = previous === 'SURFACE';
      s.walker = new WalkController({
        gravity: PLANETS.mars.g, bounds: CABIN.bounds, mode: 'cabin',
        start: fromOutside ? { x: 0, z: 3.0 } : CABIN.spawn, yaw: fromOutside ? 0 : CABIN.spawnYaw,
      });
      s.cabin = createShipInterior({
        bus: events, interactables: registry, oxygen: astronaut.oxygen,
        stations: art.userData.stations, props: art.userData.props,
        prebreatheSeconds: isDebug() ? Number(new URLSearchParams(location.search).get('prebreathe')) || PREBREATHE_DEBUG_S : undefined, // ?debug=1 → 1 s (&prebreathe=N to override)
        onSeat: () => requestState(getProgress().percent >= 100 ? 'RETURN' : 'LANDING'),
        onExit: () => requestState('SURFACE'),
        onNotice: (type, d) => {
          if (type === 'suit') astronaut.suited = d.suited;
          if (type === 'prebreathe' && d.stage === 'cancelled') s.notice = { text: 'Prebreathe cancelled: stay at the airlock for the full countdown.', t: 4 };
          if (type === 'airlock') art.userData.setAlarm?.(d.stage === 'cycling');
          if (type === 'o2Empty') audio.play('ui.error');
          if (type === 'prop' && PROP_ENTRIES[d.id]) events.emit('guidebook:open', { entryId: PROP_ENTRIES[d.id] });
        },
      });
      s.cabin.suited = astronaut.suited;
      if (fromOutside && astronaut.dust.level > 0.01) {
        astronaut.dust.clear();
        s.notice = { text: 'Airlock: dust brushed off the suit (Mars dust contains toxic perchlorates)', t: 6, calm: true };
      }
      audio.play('ambience.ship', { loop: true });
    } else {
      const mars = getMars();
      mars.lander.visible = true;
      graphics.setView(mars.scene, camera);
      astronaut.suited = true;
      s.walker = new WalkController({
        onNotice: (type, d) => {
          if (type !== 'fall') return;
          astronaut.dust.burst(d.severity === 'severe' ? 0.25 : 0.08);
          audio.play('impact.small');
          if (d.severity === 'severe') {
            astronaut.oxygen.setLeak(3);
            audio.play('alarm.o2');
            s.notice = { text: 'SUIT BREACH: O₂ is leaking 3× faster. Get to the O₂ station in the ship.', t: 6 };
          } else {
            s.notice = { text: `Hard landing (${d.impactSpeed.toFixed(1)} m/s). Mars gravity is weak, but a fall still hurts.`, t: 4 };
          }
        },
        gravity: PLANETS.mars.g, getGroundHeight: getTerrainHeight, colliders: [{ x: 0, z: 0, r: LANDER_RADIUS }, fleet.lrv.collider, fleet.mr01.collider],
        mode: 'suit', start: { x: HATCH.x, z: HATCH.z + 2 }, yaw: Math.PI, // step out facing away from the ship
      });
      try { cachedPercent = getProgress().percent; mr01Unlock.setPercent(cachedPercent); } catch { /* Role 4's module not ready: keep the cached value */ }
      mars.scene.add(getMarks().object);
      for (const e of fleetList) { // only while we are outside (the shared Mars scene is also the landing view)
        getRover(e);
        mars.scene.add(e.model.object);
        e.model.update(e.rover, 0);
        syncSpot(e);
      }
      audio.play('ambience.mars', { loop: true });
      audio.play('suit.breath', { loop: true });
    }

    if (!inside && exploration.claimFirstStep(previous === 'INTERIOR')) startFirstStep(); // only when you really step out of the airlock
    input.onPress('KeyE', () => (s?.fs?.seq.phase === 'scene' ? skipFirstStep() : s?.driving ? leaveRover() : registry.press()));
    input.onPress('Space', () => { if (s?.fs?.seq.phase === 'scene') skipFirstStep(); });
    s.lockOnClick = () => { if (s?.fs?.seq.phase !== 'words') input.lockPointer(); }; // while typing, leave the mouse alone
    window.addEventListener('click', s.lockOnClick);

    // Dev shortcuts (only with ?debug=1): O goes outside / back in, R starts the return (INTERIOR only).
    if (new URLSearchParams(location.search).get('debug') === '1') {
      input.onPress('KeyO', () => requestState(inside ? 'SURFACE' : 'INTERIOR'));
      if (inside) input.onPress('KeyR', () => requestState('RETURN'));
      else {
        input.onPress('KeyK', () => astronaut.oxygen.debugSetPercent(32)); // 30 % caution a few seconds later
        input.onPress('KeyN', () => getSolClock().jumpToDusk()); // nightfall
        input.onPress('KeyU', () => mr01Unlock.debugUnlock()); // unlock MR-01 now
      }
    }
  },

  update(dt, state) {
    if (!s) return;
    const { walker, camera, inside } = s;
    const mouse = input.mouseDelta();
    const mouseOk = Math.abs(mouse.x) < MAX_MOUSE_STEP && Math.abs(mouse.y) < MAX_MOUSE_STEP;
    const k = input.isDown;
    const oxygen = astronaut.oxygen;
    let ui_ = { focused: null };
    let hudTelemetry, hudYaw;

    if (s.driving) {
      const rover = active.rover, roverModel = active.model;
      // ---- driving the rover: look around from the driver's seat ----
      if (mouseOk) {
        const zs = camera.fov / NORMAL_FOV; // slower look while zoomed
        s.look.yaw = Math.max(-2.2, Math.min(2.2, s.look.yaw - mouse.x * 0.0022 * zs));
        s.look.pitch = Math.max(-1.1, Math.min(0.9, s.look.pitch - mouse.y * 0.0022 * zs));
      }
      rover.update(dt, {
        throttle: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
        steer: (k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0),
        brake: k('Space'),
      });
      roverModel.update(rover, dt);
      getMarks().update({ mode: 'drive', rover });
      syncSpot(active);
      astronaut.dust.accumulate(dt, { speed: rover.onGround ? Math.abs(rover.speed) : 0, mode: 'drive' });
      roverModel.object.updateMatrixWorld(true);
      const eye = roverModel.eye.clone().applyMatrix4(roverModel.object.matrixWorld);
      camera.position.copy(eye);
      camera.quaternion.copy(roverModel.object.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(s.look.pitch, s.look.yaw, 0, 'YXZ')));
      walker.pos.x = rover.x; // the astronaut rides along (beacon, telemetry)
      walker.pos.z = rover.z;
      oxygen.update(dt, { inside: false, running: false, suited: true });
      astronaut.body.update(dt, { env: 'mars', heartRate: walker.heartRate });
      graphics.setEffects({ shake: rover.onGround ? Math.min(0.35, rover.telemetry.speed * 0.05 + rover.slip * 0.3) : 0.1 });
      const rt = rover.telemetry;
      hudTelemetry = { heartRate: Math.round(walker.heartRate), gravity: walker.gravity, pos: rt.pos, speed: rt.speed, running: false, onGround: rt.onGround };
      hudYaw = rover.heading + s.look.yaw;
      s.roverPanelText = `${rt.name} · ${rt.speedKmh.toFixed(1)} km/h · battery ${(rt.batteryFrac * 100).toFixed(0)} % · slope ${rt.pitchDeg.toFixed(0)}° / roll ${rt.rollDeg.toFixed(0)}° · ${rt.odometerKm.toFixed(2)} km`
        + (rt.overturned ? ' · OVERTURNED' : rt.slip > 0.15 ? ' · SLIDING' : !rt.onGround ? ' · AIRBORNE' : '');
    } else if (s.fs && s.fs.seq.phase !== 'done') {
      // ---- first step on Mars: the player is a spectator for a few seconds ----
      const seq = s.fs.seq;
      if (seq.update(dt).stamp) stampFirstBoot();
      if (seq.phase === 'words' && s.fs.box.style.display === 'none') enterWordsPhase();
      s.fs.line.style.opacity = String(seq.lineAlpha);
      walker.update(dt, {}); // settle on the ground, no input
      const eye = walker.eye;
      camera.position.set(eye.x, eye.y, eye.z);
      const pitch = walker.pitch + (-1.0 - walker.pitch) * seq.tilt; // bow the head to the boot
      camera.quaternion.setFromEuler(new THREE.Euler(pitch, walker.yaw, 0, 'YXZ'));
      astronaut.body.update(dt, { env: 'mars', heartRate: walker.heartRate });
      hudTelemetry = walker.telemetry;
      hudYaw = walker.yaw;
      s.roverPanelText = '';
    } else {
      // ---- on foot ----
      if (mouseOk) walker.look(mouse.x * (camera.fov / NORMAL_FOV), mouse.y * (camera.fov / NORMAL_FOV));
      walker.update(dt, {
        forward: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
        right: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
        run: k('ShiftLeft') || k('ShiftRight'),
        jump: k('Space'),
      });
      s.cabin?.update(dt, walker.pos);
      if (!inside) {
        getMarks().update({ mode: 'walk', walker });
        if (walker.onGround) astronaut.dust.accumulate(dt, { speed: walker.telemetry.speed, mode: 'walk' });
      }
      oxygen.update(dt, { inside, running: walker.running, suited: inside ? astronaut.suited : true });
      astronaut.body.update(dt, { env: inside ? 'cabin_mars' : 'mars', heartRate: walker.heartRate });
      if (!inside) for (const e of fleetList) if (e.rover) { e.model.update(e.rover, dt); syncSpot(e); }
      ui_ = registry.update(dt, walker.eye, walker.lookDir, k('KeyE'));

      // head bob: one bob per step; Mars steps are slower and floatier (step rate ∝ √g), suits bounce less
      const speed = walker.telemetry.speed;
      if (walker.onGround && speed > 0.2) s.stepPhase = (s.stepPhase ?? 0) + dt * speed * 2.2 * Math.sqrt(walker.gravity / PLANETS.earth.g);
      const bob = walker.onGround ? Math.sin((s.stepPhase ?? 0) * Math.PI) ** 2 * Math.min(1, speed / 2) * (inside ? 0.035 : 0.05) : 0;
      const eye = walker.eye;
      camera.position.set(eye.x, eye.y - bob, eye.z);
      camera.quaternion.setFromEuler(new THREE.Euler(walker.pitch, walker.yaw, 0, 'YXZ'));
      hudTelemetry = walker.telemetry;
      hudYaw = walker.yaw;
      s.roverPanelText = '';
    }

    if (!inside) {
      updateDusk(dt, k('KeyZ'));
      if (mr01Unlock.unlocked && mr01Unlock.takeNotice()) s.notice = { text: MR01_UNLOCKED_NOTICE, t: 7, calm: true };
    }

    const level = inside ? 'ok' : oxygen.level;
    if (level !== s.lastLevel) {
      // alarm each time O₂ crosses into a worse caution level (30 / 15 / 5 %)
      if (['caution', 'warning', 'critical'].indexOf(level) > ['caution', 'warning', 'critical'].indexOf(s.lastLevel ?? 'ok')) audio.play('alarm.o2');
      s.lastLevel = level;
    }
    graphics.setEffects({ vignette: level === 'critical' ? 0.8 : level === 'warning' ? 0.4 : 0 });
    if (!s.driving) graphics.setEffects({ shake: 0 });
    s.hud.update(dt, {
      telemetry: hudTelemetry, oxygen, suited: inside ? astronaut.suited : true, inside,
      focused: ui_.focused, yaw: hudYaw, shipPosition: { x: HATCH.x, z: HATCH.z },
      bodyStats: astronaut.body.snapshot(), airlockProgress: s.cabin?.airlockProgress ?? 0,
      prebreathe: s.cabin?.prebreathe ?? null, dust: astronaut.dust.level, driving: !!s.driving,
      reach: inside ? null : updateReach(dt),
    });

    if (s.notice?.t > 0) s.notice.t -= dt;
    const noticeText = s.notice?.t > 0 ? s.notice.text : !inside && oxygen.leaking ? 'SUIT BREACH: O₂ leaking' : '';
    if (s.noticeEl.textContent !== noticeText) {
      s.noticeEl.textContent = noticeText;
      // calm notices (hints, facts) in cyan; warnings stay red
      s.noticeEl.style.color = s.notice?.t > 0 && s.notice.calm ? 'var(--hud-cyan,#67e8f9)' : 'var(--hud-red,#ff7f87)';
    }
    if (s.roverEl.textContent !== s.roverPanelText) s.roverEl.textContent = s.roverPanelText;

    s.sinceTelemetry += dt;
    if (s.sinceTelemetry >= TELEMETRY_EVERY) {
      s.sinceTelemetry = 0;
      events.emit('flight:telemetry', {
        t: performance.now() / 1000, phase: inside ? 'interior' : s.driving ? 'rover' : 'eva', o2Percent: oxygen.percent,
        speed: s.driving ? active.rover.telemetry.speed : walker.telemetry.speed,
        heartRate: Math.round(walker.heartRate), radiationMsv: astronaut.body.doseMSv,
      });
    }
  },

  exit() {
    if (!s) return;
    previous = s.state;
    if (s.fs) finishFirstStep(s.fs.field.value, true); // left mid-moment: keep what was typed (or the default)
    if (!s.inside) { for (const e of fleetList) e.model?.object.removeFromParent(); marks?.object.removeFromParent(); }
    if (s.driving) { syncSpot(active); active = null; }
    graphics.setEffects({ shake: 0 });
    s.cabin?.dispose();
    s.hud.dispose();
    window.removeEventListener('click', s.lockOnClick);
    graphics.setEffects({ vignette: 0 });
    audio.stop('ambience.ship');
    audio.stop('ambience.mars');
    audio.stop('suit.breath');
    s = null;
  },
};
