// Role 2 flight module: owns LAUNCH, ORBIT, ENTRY, LANDING (contract.js STATE_OWNERS).
// Real Newtonian physics (FlightController) + Role 3's cockpit, planets, rocket parts and VFX.
//
//   LAUNCH  pad → ascent; reaching orbit moves to ORBIT on its own.
//   ORBIT   coast; T = transfer burn to Mars (Δv from balance.json deltaVKmS.transfer) → CRUISE (Role 4).
//   ENTRY   Mars entry (heat shield, chute); below 6 km moves to LANDING on its own.
//   LANDING powered descent and touchdown; E after landing → INTERIOR (Role 2 surface).
// The flight computer (autopilot.js) flies the whole mission; the player watches and takes the stick in short manual
// windows (manualControl.js): F when offered, mouse to aim, Space to lock, Esc to give it back. Only the ascent window for now.
// Failures emit flight:failed; Role 4's story module charges the penalty and shows the ending.
import * as THREE from 'three';
import { assets, createLaunchSite, createSpaceScene, getTerrainHeight, graphics, cinematic } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { G0, PLANETS, contract, economy, events, getShip, input, requestState, save, ui } from '/src/core/index.js';
import { astronaut } from '/src/surface/astronaut.js';
import { getMars } from '/src/surface/scenes.js';
import { FlightController, TUNING } from './FlightController.js';
import { recordInSave, setPartEffectsRecorder } from './effects/index.js';

// each flight's record of what the chosen parts did (./effects/) is kept in save for the hangar's flight analysis
setPartEffectsRecorder(recordInSave(save));
import { createCockpitControls, createCockpitIndicators } from './cockpitControls.js';
import { ascentGuide, assistReadout, landingGuide, predictPath } from './flightAssist.js';
import { createDebrisField, DEBRIS_ENCOUNTER } from './debris.js';
import { createDebrisWindow, createEncounterTracker, conjunctionAxes, conjunctionPieces, rcsRequest, trackAim } from './conjunction.js';
import { createConjunctionPanel } from './hud/conjunctionPanel.js';
import { atmosphereTop, pressureRatio } from './atmosphere.js';
import { createAutopilot } from './autopilot.js';
import { MANUAL, createManualWindow, createStickState, dirFromOffsets, frameFor, offsetsFromDir } from './manualControl.js';
import { createManualAimPanel } from './hud/manualAimPanel.js';
import { createPacer, createEventDetector, paceContext } from './pacing.js';
import { approachBack, computeCorridor, corridorGauge, predictInterface } from './corridor.js';
import { createChecklist, objectiveText } from './objectives.js';
import { clearPhaseRatings, createPhaseTracker, getPhaseRatings, rateDebris, storeRating } from './rating.js';
import { attitudeDeg } from './attitude.js';
import { dot, qRotate, LOCAL_RIGHT, LOCAL_UP } from './vec.js';
import { STARTS } from './presets.js';
import { createFlightHUD } from './hud/createFlightHUD.js';
import { createEgressOverlay } from './hud/egressOverlay.js';
import { createEgress, markEgressPending } from './egress.js';
import { createSteeringDisplay, createGuidanceReference } from './steering.js';
import { createPhase0Ritual } from './phase0Ritual.js';
import { createFoam, FOAM } from './foam.js';
import { createPadFire, PAD_FIRE } from './padFire.js';
import { createFireFlash } from './hud/fireFlash.js';
import { buttonCentre, hasButton as cockpitHasButton, pickButton } from './phase0Aim.js';
import { stackParts } from './rocketStack.js';
import { ZOOM_DEFAULT, ZOOM_PAD, applyMouse, createChaseState, createOrbit, horizonFrame, liftAboveGround, resetOrbit, stepZoom, updateChase } from './chaseCam.js';

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '∞');

export { FlightController };
// Phase ratings for Role 4's Flight Report: [{ phase: 'ascent'|'debris'|'entry'|'landing', stars: 1..3, stats, text }] (see rating.js).
export { getPhaseRatings };

const EGRESS_CINEMATIC = false; // first-person egress after landing (egress.js); off until the new spaceship interior is designed
const ENTRY_TO_LANDING = 6000; // m: ENTRY hands over to LANDING here
// m: below this the view switches to Role 3's detailed Mars terrain. That patch is about ±900 m wide, so higher up
// the window would look past its edge at empty sky; the textured globe shows the ground better until then.
const LOW_MARS_ALTITUDE = 800;
const LAUNCH_SITE_TOP = 40000; // m: Role 3's launch site shows its detail below this
const DEBRIS_AFTER_ORBIT = 20; // s in orbit before the orbital-debris encounter (TEAM_PROMPT §6.3)
const COUNTDOWN = 10; // s: T-10 … ignition at T-3 … clamps release at T-0
const IGNITION_AT = 3;
const CALLOUT_SECONDS = 3.5;
// Mission Control callouts for local flight notices (TEAM_PROMPT §6.3)
const CALLOUTS = {
  liftoff: 'Liftoff! We have liftoff.', maxq_warning: 'Max-Q: throttle down through the thick air.',
  fairing_sep: 'Fairing separation.', orbit_achieved: 'Orbit achieved.', fuel_empty: 'MECO: main engine cut-off, tanks dry.',
  parachute: 'Parachute deployed.', debris_hit: 'Debris strike! Armor took the hit.', debris_hit_bare: 'Debris strike!', no_ignition: 'Engine will not relight: no ignitions left.',
};
const MAX_MOUSE_STEP = 300; // px per frame: ignore the jump some browsers report right after pointer lock // m: below this the view switches to Role 3's detailed Mars terrain
const TELEMETRY_EVERY = 0.5; // s (contract: flight:telemetry about twice per second)
const toCockpit = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // nose +Y → cockpit −Z

// Mission state that survives state changes (LAUNCH → ORBIT keeps the same controller; LANDING ⇄ INTERIOR too).
const mission = { fc: null, autopilot: createAutopilot(), manualAscent: createManualWindow('ascent', MANUAL.windows.ascent), stick: null, planetId: null, fuelForMars: null, debrisDone: false, debrisWin: createDebrisWindow(), debrisTracker: null, debrisRated: false, cardQueue: [], tracker: createPhaseTracker(), card: null, ascentList: createChecklist('ascent'), entryList: createChecklist('entry'), blackout: 'before', foam: createFoam() };
const ENTRY_FPA = -22.8; // deg at the atmosphere's edge: inside the corridor but off its centre, so a small RCS trim pays off
const ENTRY_APPROACH = 40; // s of approach before the atmosphere (time to trim the corridor)
const CARD_SECONDS = 6;
const WARP_KEYS = { Period: 1, Comma: -1 };
let launchAttempts = 0;
let s = null; // per-state session (scene, camera, HUD, controls)

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

function newController(planetId, start, fuel) {
  const fc = new FlightController({ bus: events, planets: PLANETS, g0: G0, planetId, shipSpec: getShip(), start, fuel });
  mission.fc = fc;
  mission.autopilot = createAutopilot(); // one flight computer per controller
  mission.planetId = planetId;
  mission.foam.applyTo(fc); // a gouged heat shield stays gouged across scenes
  return fc;
}

function circularOrbitStart(planetId, altitude) {
  const p = PLANETS[planetId];
  return { altitude, speed: Math.sqrt((p.g * p.radius ** 2) / (p.radius + altitude)), flightPathDeg: 0, facing: 'prograde' };
}

// Make sure a controller fits the state we are entering (debug jumps can enter any state directly).
function controllerFor(state) {
  const fc = mission.fc;
  if (state === 'LAUNCH') {
    astronaut.reset();
    mission.fuelForMars = null;
    mission.debrisDone = false;
    mission.foam = createFoam();
    mission.debrisWin = createDebrisWindow(); mission.debrisTracker = null; mission.debrisRated = false; mission.cardQueue = [];
    clearPhaseRatings(); // a new mission starts: forget last flight's ratings
    mission.manualAscent = createManualWindow('ascent', MANUAL.windows.ascent); // the ascent window is offered once per mission
    mission.stick = createStickState(mission.manualAscent);
    mission.tracker = createPhaseTracker();
    mission.ascentList = createChecklist('ascent');
    mission.entryList = createChecklist('entry');
    mission.blackout = 'before';
    mission.card = null;
    return newController('earth', STARTS.earthPad);
  }
  if (state === 'ORBIT') {
    if (fc && mission.planetId === 'earth' && !fc.failed && fc.phase === 'orbit') return fc;
    return newController('earth', circularOrbitStart('earth', 200000));
  }
  const marsFuel = mission.fuelForMars ?? getShip().stats.fuelMass * 0.25;
  if (state === 'ENTRY') {
    mission.entryList = createChecklist('entry');
    mission.blackout = 'before';
    const entry = newController('mars', { ...STARTS.marsEntry, flightPathDeg: ENTRY_FPA }, marsFuel);
    approachBack(entry, ENTRY_APPROACH); // start far enough out to trim the angle before the interface
    return entry;
  }
  // LANDING: keep the Mars controller from ENTRY, or the landed one when coming back to the seat.
  if (fc && mission.planetId === 'mars' && !fc.failed && (fc.landed || fc.altitude < ENTRY_TO_LANDING + 1000)) return fc;
  return newController('mars', STARTS.marsLanding, marsFuel);
}

// The best view in orbit and during entry is the planet's limb, but along the orbit (or tail-first) the window shows
// only stars. Turn the ship (attitude only, no velocity change) so its nose points along the motion and tilted
// down to just below the horizon: the planet fills the lower part of the window.
function faceTheLimb(fc) {
  const up = v3(fc.up);
  const along = v3(fc.vel).projectOnPlane(up);
  if (along.lengthSq() < 1) return;
  along.normalize();
  const r = fc.pos ? v3(fc.pos).length() : fc.planet.radius;
  const horizonDip = Math.acos(Math.min(1, fc.planet.radius / r)); // how far below level the horizon is from here
  const tilt = horizonDip + THREE.MathUtils.degToRad(8);
  const nose = along.multiplyScalar(Math.cos(tilt)).addScaledVector(up, -Math.sin(tilt)).normalize();
  // ship axes: +Y nose, +Z cockpit "up" (toward the sky, so the planet sits at the bottom of the window), +X right
  const top = up.clone().addScaledVector(nose, -up.dot(nose)).normalize();
  const right = new THREE.Vector3().crossVectors(nose, top);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, nose, top));
  fc.orient = { x: q.x, y: q.y, z: q.z, w: q.w };
  fc.omega = { x: 0, y: 0, z: 0 };
}

// The physics starts every flight at the top of the planet (+Y). Turn the textured surface so the real site is
// there: Cape Canaveral under the launch, Jezero Crater under the Mars entry and landing. Role 3's globes spin through
// userData.surface; rotation.y = -90° - longitude brings a longitude to +Z, then rotation.x = latitude - 90° lifts it to +Y.
const SITES = { earth: { lat: 28.6, lon: -80.6 }, mars: { lat: 18.4, lon: 77.5 } };
function faceSiteUp(planet, planetId) {
  const site = SITES[planetId];
  const surface = planet.userData.surface;
  if (!site || !surface) return;
  surface.rotation.set(THREE.MathUtils.degToRad(site.lat - 90), THREE.MathUtils.degToRad(-90 - site.lon), 0, 'XYZ');
}

// Show or hide a model WITHOUT changing the scene's light count: hiding a group that holds lights makes three.js
// recompile every lit material (a visible hitch). Lights stay; only meshes, lines and points are toggled.
function showModel(object, on) {
  object.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints || o.isSprite) o.visible = on;
  });
}

// Under the parachute the ship hangs nose-up, so the window shows only sky. Tip the nose forward and 35° down so
// the ground and horizon are in view; the flight computer still turns it retrograde for the burn.
function faceTheGround(fc) {
  const up = v3(fc.up);
  const along = v3(fc.vel).projectOnPlane(up);
  if (along.lengthSq() < 0.01) along.set(1, 0, 0).projectOnPlane(up);
  along.normalize();
  const tilt = THREE.MathUtils.degToRad(35);
  const nose = along.multiplyScalar(Math.cos(tilt)).addScaledVector(up, -Math.sin(tilt)).normalize();
  const top = up.clone().addScaledVector(nose, -up.dot(nose)).normalize();
  const right = new THREE.Vector3().crossVectors(nose, top);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, nose, top));
  fc.orient = { x: q.x, y: q.y, z: q.z, w: q.w };
  fc.omega = { x: 0, y: 0, z: 0 };
}

// ---------- views ----------
function buildSpaceView(planetId) {
  const scene = createSpaceScene();
  graphics.setSunDirection(new THREE.Vector3(0.7, 0.45, 0.55));
  const sunLight = new THREE.DirectionalLight(0xfff4e6, 3);
  sunLight.position.set(0.7, 0.45, 0.55);
  scene.add(sunLight, new THREE.AmbientLight(0x8ea4c8, 0.25));
  const planet = assets.get(`planet:${planetId}`);
  planet.scale.setScalar(PLANETS[planetId].radius);
  faceSiteUp(planet, planetId);
  scene.add(planet);

  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 1e10);
  const cockpit = assets.get('cockpit');
  const plasma = assets.get('vfx:entryPlasma');
  cockpit.add(plasma);
  rig.add(cockpit, camera);
  scene.add(rig);

  // the player's own rocket for the chase camera (local +Y = nose, same as the physics)
  const { rocket, eyeY, mid } = buildRocket(getShip());
  const flame = assets.get('vfx:engineFlame');
  const exhaust = assets.get('vfx:exhaust');
  rocket.add(flame, exhaust);
  rocket.position.y = -eyeY; // the capsule sits where the physics point (and the cockpit camera) is
  const rocketRoot = new THREE.Group();
  rocketRoot.add(rocket);
  scene.add(rocketRoot);

  // planet-centred frame (moves with −pos like the planet): trajectory line + debris live here
  const frame = new THREE.Group();
  const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x72e6e0, transparent: true, opacity: 0.65 }));
  path.frustumCulled = false;
  frame.add(path);
  scene.add(frame);
  return { scene, camera, planet, rig, cockpit, plasma, flame, exhaust, rocketRoot, frame, path, debris: new Map(), centreY: mid - eyeY };
}

// Builds the rocket from ShipSpec.parts (Role 1's builder; metres, y along the axis, rotation in degrees about the
// axis). Parts on the axis are re-stacked in their y order using each model's real height (userData.height), so
// the stack never gaps or overlaps even if the spec's y values are rough; side parts (legs, fins) follow the axial
// part they sit next to. Falls back to a simple stack when the ship has no parts. eyeY = height of the capsule window.
function buildRocket(spec) {
  const rocket = new THREE.Group();
  const parts = spec?.parts?.length ? spec.parts : ['engine_m', 'tank_l', 'tank_l', 'capsule_m'].map((type, i) => ({ id: `d${i}`, type, x: 0, y: i, z: 0 }));
  const models = new Map(parts.map((p) => [p, assets.get(`rocketPart:${p.type}`)]));
  const { placed, top } = stackParts(parts, (p) => models.get(p).userData.height ?? 2);
  let eyeY = top - 1;
  for (const p of parts) {
    const part = models.get(p);
    part.position.set(p.x ?? 0, placed.get(p), p.z ?? 0);
    part.rotation.y = THREE.MathUtils.degToRad(p.rotation ?? 0);
    rocket.add(part);
    if (/capsule/.test(p.type)) eyeY = placed.get(p) + (part.userData.height ?? 2) * 0.55;
  }
  return { rocket, eyeY, mid: top / 2 };
}

const debrisGeometry = new THREE.DodecahedronGeometry(1, 0);
const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.45 });

// Debris meshes follow fc.obstacles (planet frame), tumbling with the provided spin.
function syncDebris(view, fc, dt) {
  const alive = new Set();
  for (const o of fc.obstacles) {
    alive.add(o.id);
    let m = view.debris.get(o.id);
    if (!m) {
      m = new THREE.Mesh(debrisGeometry, debrisMaterial);
      m.scale.set(o.radius, o.radius * 0.6, o.radius * 0.9);
      view.frame.add(m);
      view.debris.set(o.id, m);
    }
    m.position.set(o.pos.x, o.pos.y, o.pos.z);
    m.rotation.x += o.spin.x * dt;
    m.rotation.y += o.spin.y * dt;
  }
  for (const [id, m] of view.debris) {
    if (!alive.has(id)) { view.frame.remove(m); view.debris.delete(id); }
  }
}

// Role 3's launch complex is big: build it once and compile its shaders in the background at boot, so entering
// LAUNCH never freezes on the first frame. Until it's ready, LAUNCH shows the space view.
const siteCache = { site: null, ready: false };
function prepareLaunchSite() {
  try {
    siteCache.site = createLaunchSite();
    const compile = graphics.renderer?.compileAsync?.(siteCache.site.scene, graphics.camera);
    if (compile) compile.then(() => { siteCache.ready = true; }, () => { siteCache.ready = true; });
    else siteCache.ready = true;
  } catch (error) {
    console.warn('[flight] launch site unavailable, using the space view:', error);
  }
}

// Our rocket stands at rocketBase; the site and Earth slide down as we climb (setAltitude).
function buildSiteView() {
  const site = siteCache.site;
  for (const old of site.scene.children.filter((o) => o.userData.role2)) site.scene.remove(old); // last flight's rocket
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 1e10);
  const rig = new THREE.Group();
  const cockpit = assets.get('cockpit');
  rig.add(cockpit, camera);
  const { rocket, eyeY, mid } = buildRocket(getShip());
  const flame = assets.get('vfx:engineFlame');
  const exhaust = assets.get('vfx:exhaust');
  rocket.add(flame, exhaust);
  const rocketRoot = new THREE.Group();
  rocketRoot.position.copy(site.rocketBase);
  rocketRoot.add(rocket);
  rocketRoot.userData.role2 = rig.userData.role2 = true;
  site.scene.add(rocketRoot, rig);
  site.setAltitude(0);
  return { ...site, camera, rig, cockpit, rocketRoot, flame, exhaust, eyeY, centreY: mid };
}

// Low over Mars: Role 2's shared Mars scene (pre-built at boot by src/surface/scenes.js). Our ship IS the lander,
// so the parked lander model is hidden while we fly; surface shows it again on SURFACE.
function buildSurfaceView(fc) {
  const { scene, lander } = getMars();
  for (const old of scene.children.filter((o) => o.userData.role2Flight)) scene.remove(old);
  lander.visible = false;
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 2e5);
  const rig = new THREE.Group();
  const cockpit = assets.get('cockpit');
  rig.add(cockpit, camera);
  const dust = assets.get('vfx:landingDust');
  // the outside view: our own rocket, pivoting about its base like on the launch pad
  const { rocket, mid } = buildRocket(getShip());
  const flame = assets.get('vfx:engineFlame');
  const exhaust = assets.get('vfx:exhaust');
  rocket.add(flame, exhaust);
  const rocketRoot = new THREE.Group();
  rocketRoot.add(rocket);
  showModel(rocketRoot, false);
  rig.userData.role2Flight = dust.userData.role2Flight = rocketRoot.userData.role2Flight = true;
  scene.add(rig, dust, rocketRoot);
  // tangent frame at the point under the ship when this view starts: east = +X, north = −Z, up = +Y
  const up = v3(fc.up);
  const east = v3(fc.vel).projectOnPlane(up).normalize();
  if (east.lengthSq() < 0.5) east.set(1, 0, 0).projectOnPlane(up).normalize();
  const north = new THREE.Vector3().crossVectors(east, up);
  const toLocal = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()).invert());
  return { scene, camera, rig, dust, cockpit, rocketRoot, flame, exhaust, centreY: mid, origin: up.clone().multiplyScalar(fc.planet.radius), east, north, toLocal };
}

// ---------- outside camera ----------
const UP = new THREE.Vector3(0, 1, 0);
const camOffset = new THREE.Vector3();
const shipForward = (q) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);

// Orbit the camera around `centre` in the local-horizon frame (up = away from the planet, yaw 0 = behind the ship's
// motion). The offset is eased relative to the rocket, so the rocket stays centred at any speed. `heightOverGround`
// (or null) keeps the camera from sinking into the ground near the pad.
function placeChaseCamera(camera, centre, branch, vel, forward, dt, heightOverGround, up) {
  if (s.cam.branch !== branch) { s.cam.branch = branch; s.cam.ready = false; } // new frame: snap, don't ease across scenes
  const frame = horizonFrame(up, vel, forward, s.cam.heading);
  updateChase(s.cam, s.orbit, frame, dt, false, camOffset);
  if (heightOverGround !== null) liftAboveGround(camOffset, frame.up, heightOverGround, 2);
  camera.position.copy(centre).add(camOffset);
  camera.up.copy(frame.up);
  camera.lookAt(centre);
}

// ---------- manual control (windows: manualControl.js) ----------
const SMOOTH = (x) => x * x * (3 - 2 * x);
const ZOOM_SECONDS = 0.6;
const ZOOM_FILL = 0.75; // the display's height fills this much of the camera's vertical FOV
const BRAKE_PULSE = 0.3; // s the ASSIST/brake switch pulses after a lock (animation only)
const whoosh = (now) => { if (s && now - (s.whooshAt ?? -9) > 0.8) { s.whooshAt = now; audio.play('debris.whoosh'); } };
const callout = (text, t = CALLOUT_SECONDS) => { if (s) s.callout = { text, t }; };

function offerManualUi() {
  if (!s) return;
  callout('Gravity turn coming up. The stick is yours if you want it.', MANUAL.windows.ascent.offerSeconds);
  audio.play('cockpit.manualOffer');
  s.pacer.event('manual_offer', s.fc.t, 0.5); // back to 1× now
}

// Orbital debris encounter: field placed ahead, alarm, offer to dodge (F). A player flying free goes straight into the window.
function placeDebris() {
  const fc = s?.fc;
  if (!fc) return false;
  mission.debrisDone = true;
  fc.setObstacles(createDebrisField({ fc, ...DEBRIS_ENCOUNTER }));
  mission.debrisTracker = createEncounterTracker();
  mission.debrisRated = false;
  const dw = mission.debrisWin = createDebrisWindow();
  s.debrisWarning = MANUAL.windows.debris.offerSeconds;
  s.debrisAt = fc.t;
  s.pacer.event('debris', fc.t, 4); // back to 1× (the offer / window also pins it)
  audio.play('alarm.master');
  audio.play('cockpit.manualOffer');
  dw.offer();
  if (stick().free) { stick().giveBack(); dw.take(); callout('Debris ahead. Your stick is scored now.'); }
  else callout('Debris conjunction ahead. Take the stick to dodge, or the computer burns for you.', 6);
  return true;
}

const state0Orbit = () => placeDebris();
const FREE_STATES = ['LAUNCH', 'ORBIT', 'ENTRY', 'LANDING'];
const stick = () => (mission.stick ??= createStickState(mission.manualAscent));
const hasStick = () => stick().has || mission.debrisWin.active;
const DEBRIS_LESSON = 'Real ISS crews have dodged orbital debris more than 30 times since 1999. About 36,000 tracked pieces larger than 10 cm circle the Earth.';
const rcsLimit = (fc) => (fc.ship.hasRCS ? TUNING.rcsAccel.rcs : TUNING.rcsAccel.noRcs);
function zoomIn() {
  s.chase = false; // always from the cockpit (the camera zooms into its centre display)
  try { input.lockPointer(); } catch { /* pointer lock may be refused */ }
  audio.play('cockpit.switch');
  callout('You have the stick.');
  s.zoom.target = 1;
}

// Heat-shield inspection (foam.js): the RCS camera sweep, seen from the cockpit display.
function startSweep() {
  const fc = s?.fc;
  if (!fc) return;
  s.chase = false;
  s.zoom.target = 1;
  audio.play('cockpit.switch');
  fc.fuel = Math.max(0, fc.fuel - FOAM.sweepFuelKg);
  callout(FOAM.copy.scanning, FOAM.sweepSeconds);
}
function sweepFound() {
  const fc = s?.fc;
  if (!fc) return;
  mission.foam.reveal(fc);
  s.corridor = fc.planetId === 'mars' && fc.altitude > atmosphereTop(fc.planet) ? computeCorridor(fc) : s.corridor;
  s.zoom.target = 0;
  audio.play('cockpit.lock');
  callout(`${FOAM.copy.found} ${FOAM.copy.warning}.`, 7);
}

// F: toggle between the flight computer and the player (a window offer is taken / locked / cancelled the same way)
function toggleManual() {
  const w = mission.manualAscent;
  const fc = s?.fc;
  if (!s || s.phase0?.active) return null;
  const dw = mission.debrisWin;
  if (mission.foam.offered && fc?.planetId === 'earth') { mission.foam.take(); startSweep(); return 'inspect'; }
  if (dw.offered) { dw.take(); zoomIn(); callout('You have the stick. Dodge!'); return 'window'; }
  if (dw.active) { dw.cancel(); finishManual('Computer has it.'); return 'cancel'; }
  if (!w.busy && (!FREE_STATES.includes(s.stateName) || s.countdown > 0 || !fc || fc.liftoffT === null || fc.landed || fc.failed)) return null;
  const was = stick().mode;
  const r = stick().toggle({ planetId: fc.planetId });
  if (r === 'window') zoomIn();
  else if (r === 'lock') finishManual('Guidance locked. Computer has it.', { lock: true });
  else if (r === 'cancel' || r === 'giveBack') finishManual('Computer has it.');
  else if (r === 'free') { s.freeHold = { x: fc.forward.x, y: fc.forward.y, z: fc.forward.z }; zoomIn(); }
  return was === stick().mode ? null : r;
}
const startManual = toggleManual;

// ends = text of the callout; sound/pulse only for a lock
function finishManual(text, { lock = false } = {}) {
  if (!s) return;
  callout(text);
  if (lock) { audio.play('cockpit.lock'); s.brakePulse = BRAKE_PULSE; }
  s.zoom.target = 0;
}

// Space / click: lock inside the window, give the stick back when flying free
function lockManual() {
  const w = mission.manualAscent;
  if (!s || s.phase0?.active) return;
  if (w.lock()) finishManual('Guidance locked. Computer has it.', { lock: true });
  else if (stick().giveBack()) finishManual('Computer has it.');
}

// Esc: give the stick back
function cancelManual() {
  if (!s) return;
  if (mission.debrisWin.cancel() || mission.manualAscent.cancel() || stick().giveBack()) finishManual('Computer has it.');
}

// Zoom pose for a cockpit: in the rig's local frame (camera = child of the rig at the pilot's eye = origin).
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
function displayInfo(rig, camera, cockpit) {
  const cached = s.zoomCache.get(cockpit);
  if (cached !== undefined && (cached === null || Math.abs(cached.aspect - camera.aspect) < 0.05)) return cached;
  const mesh = cockpit.getObjectByName('centreDisplay');
  if (!mesh?.geometry) { s.zoomCache.set(cockpit, null); return null; }
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const local = [];
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) local.push(new THREE.Vector3(x, y, z));
  rig.updateWorldMatrix(true, true);
  const toRig = _m.copy(rig.matrixWorld).invert().multiply(mesh.matrixWorld).clone();
  const pts = local.map((p) => p.clone().applyMatrix4(toRig));
  const centre = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const eyeDir = centre.clone().negate();
  const dist = eyeDir.length();
  if (dist < 1e-4) { s.zoomCache.set(cockpit, null); return null; }
  eyeDir.normalize();
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(centre.clone().add(eyeDir), centre, UP));
  const inv = quat.clone().invert();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { const v = p.clone().sub(centre).applyQuaternion(inv); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  let d = Math.max((maxY - minY) / (2 * tan * ZOOM_FILL), (maxX - minX) / (2 * tan * camera.aspect * 0.9));
  d = Math.min(d, dist); // never beyond the eye
  const pos = centre.clone().addScaledVector(eyeDir, d);
  const info = { mesh, corners: local, pos, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, centre, UP)), aspect: camera.aspect };
  s.zoomCache.set(cockpit, info);
  return info;
}

// Blend the cockpit camera from the normal pose (origin, lookQ) to the display zoom pose.
function applyZoom(camera, rig, cockpit, lookQ) {
  const e = SMOOTH(s.zoom.k);
  if (e <= 0) return;
  const info = displayInfo(rig, camera, cockpit);
  if (!info) return;
  camera.position.copy(info.pos).multiplyScalar(e);
  camera.quaternion.copy(lookQ).slerp(info.quat, e);
}

// Bounding rect (CSS px) of the centre display seen from `camera`, or null.
function displayRect(camera, rig, cockpit) {
  const info = displayInfo(rig, camera, cockpit);
  if (!info) return null;
  camera.updateWorldMatrix(true, false);
  info.mesh.updateWorldMatrix(true, false);
  const el = graphics.renderer?.domElement;
  const box = el?.getBoundingClientRect?.();
  const W = box?.width || window.innerWidth, H = box?.height || window.innerHeight, L = box?.left || 0, T = box?.top || 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of info.corners) {
    const p = info.mesh.localToWorld(c.clone()).project(camera);
    if (p.z > 1) return null;
    const x = L + (p.x + 1) / 2 * W, y = T + (1 - p.y) / 2 * H;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

const clampUnit = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

// ---------- transfer burn (ORBIT → CRUISE) ----------
function transferBurn() {
  const fc = mission.fc;
  if (!fc || fc.failed) return;
  const dv = (economy.balance.deltaVKmS?.transfer ?? 2.1) * 1000;
  const ve = fc.ship.ispVac * fc.g0;
  const mAfter = fc.mass / Math.exp(dv / ve); // rocket equation: m1 = m0 / e^(Δv / ve)
  const fuelAfter = mAfter - fc.ship.dryMass;
  if (fuelAfter < 0) {
    events.emit('flight:failed', {
      endingId: 'adrift',
      cause: `The transfer burn needed ${fmt(dv)} m/s but the ship only had ${fmt(fc.deltaVLeft())} m/s left, so it drifts between the planets.`,
      causeId: 'transfer_short',
    });
    return;
  }
  mission.fuelForMars = fuelAfter;
  requestState('CRUISE');
}

// ---------- first-person egress (LANDING → INTERIOR), timeline in egress.js ----------
function startEgress() {
  if (!s || s.egress || s.done) return;
  s.chase = false;
  const overlay = createEgressOverlay();
  const v = s.mode === 'surface' ? s.surface : s.mode === 'site' ? s.site : s.view;
  if (!v?.camera || !v?.rig || !v?.cockpit) { s.egress = { overlay, fallback: true, t: 0 }; return; } // no cockpit: just fade out and change state
  v.rig.updateMatrixWorld(true);
  const aftNode = v.cockpit.getObjectByName('aft');
  let aft = null;
  if (aftNode) { const l = v.rig.worldToLocal(aftNode.getWorldPosition(new THREE.Vector3())); aft = { x: l.x, z: l.z }; }
  const look0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.look.pitch, s.look.yaw, 0, 'YXZ'));
  s.egress = { overlay, drv: createEgress(aft), look0, v, t: 0 };
  input.onPress('Space', () => s?.egress?.drv?.skip());
}

function stepEgress(dt) {
  const e = s.egress;
  s.hud.root.style.opacity = '0';
  s.zoom.k = 0; s.zoom.target = 0;
  const finish = () => { s.done = true; markEgressPending(); requestState('INTERIOR'); };
  if (e.fallback) {
    e.t += dt;
    e.overlay.setFade(e.t / 0.8);
    if (e.t >= 0.8) finish();
    return;
  }
  const { pose, fired } = e.drv.update(dt);
  for (const name of fired) {
    if (name === 'harness') audio.play('crew.harness');
    else if (name === 'step') audio.play('impact.small', { volume: 0.25 });
    else if (name === 'hatch') audio.play('cockpit.hatch');
  }
  e.t += dt;
  let q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.pitch, pose.yaw, pose.roll, 'YXZ'));
  const k = Math.min(1, e.t / 0.6); // ease from wherever the player was looking
  if (k < 1) q = e.look0.clone().slerp(q, k * k * (3 - 2 * k));
  e.v.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
  e.v.camera.quaternion.copy(q);
  e.overlay.setFade(pose.fade);
  e.overlay.setCaption(pose.caption);
  if (e.drv.done) finish();
}

// ---------- module ----------
export default {
  init() {
    if (new URLSearchParams(location.search).get('debug') === '1') window.__role2flight = {
      get look() { return s?.look; }, get fc() { return s?.fc; }, get orbit() { return s?.orbit; }, get session() { return s; },
      skipPhase0() { s?.phase0?.skip(); },
      // Foam (Columbia): damage the heat shield now, as a debris strike would, and start the inspection offer (F)
      foam() { if (!s) return null; mission.foam.strike(s.fc); callout(FOAM.copy.impact, 6); return mission.foam.state; },
      // Phase 0 aim-and-click: aimAt(id) turns the look so the reticle sits on that button ('hatch'|'cabin'|'o2'|'arm'); clickAim() clicks it
      aimAt(id) {
        const v = s && (s.site ?? s.view);
        if (!v?.cockpit || !s.look) return false;
        v.rig.updateMatrixWorld(true);
        const p = buttonCentre(v.cockpit, id);
        if (!p) return false;
        v.rig.worldToLocal(p); p.normalize();
        s.look.pitch = Math.asin(p.y); s.look.yaw = Math.atan2(-p.x, -p.z);
        return true;
      },
      clickAim() { return !!s?.phase0?.click(); },
      egress() { startEgress(); return !!s?.egress; }, // start the first-person egress now (landed or not)
      // set the outside camera for screenshots: orbit(yawDeg, pitchDeg, dist); `wheel` fakes a wheel step; chase(on) toggles the view
      orbit(yawDeg, pitchDeg, dist) { if (s) { s.orbit.yaw = THREE.MathUtils.degToRad(yawDeg); s.orbit.pitch = THREE.MathUtils.degToRad(pitchDeg); if (dist) s.orbit.dist = dist; s.cam.ready = false; } return s?.orbit; },
      wheel(delta) { if (s) s.orbit.dist = stepZoom(s.orbit.dist, delta); return s?.orbit.dist; },
      debris() { return state0Orbit(); }, // place the debris field now and start the warning/offer
      manual: {
        get state() { return mission.manualAscent.state; },
        get debris() { return mission.debrisWin.state; },
        offer() { // force-offer the ascent window now, even if the guide step is not 'turn'
          if (!s || !mission.manualAscent.offer()) return false;
          s.debugDir = { ...s.fc.forward };
          offerManualUi();
          return true;
        },
        toggle() { toggleManual(); return stick().mode; },
        get mode() { return stick().mode; },
        take() { startManual(); return mission.manualAscent.state; },
        lock() { lockManual(); return mission.manualAscent.state; },
        cancel() { cancelManual(); return mission.manualAscent.state; },
        aim(yawDeg, pitchDeg) { // debris window: panel units (|v| ≤ 1) or metres in the conjunction plane (x = orbit normal, y = up)
          const dw = mission.debrisWin;
          if (dw.busy) { const k = Math.max(Math.abs(yawDeg), Math.abs(pitchDeg)) > 1 ? 1 / MANUAL.windows.debris.rangeMetres : 1; dw.setAim(yawDeg * k, pitchDeg * k); return dw.aim; }
          mission.manualAscent.setAim(yawDeg, pitchDeg); return mission.manualAscent.readout().aim; },
        track(on) { if (s) s.manualTrack = !!on; return !!s?.manualTrack; },
      },
      chase(on) { if (s && !s.phase0?.active && s.chase !== on) { s.chase = on; if (on) { resetOrbit(s.orbit); s.cam.ready = false; } } return s?.chase; },
    }; // debug only
    setTimeout(prepareLaunchSite, 0); // after boot finished its own work
  },

  enter(state, data) {
    const fc = controllerFor(state);
    if ((state === 'ORBIT' || state === 'ENTRY') && fc.throttle === 0) faceTheLimb(fc);
    if (state === 'LANDING' && !fc.landed && fc.throttle === 0) faceTheGround(fc);
    const view = buildSpaceView(fc.planetId);
    s = {
      state, fc, view, surface: null, mode: null,
      look: { yaw: 0, pitch: 0 }, orbit: createOrbit(state === 'LAUNCH' ? ZOOM_PAD : ZOOM_DEFAULT), cam: createChaseState(), chase: false, zoom: { k: 0, target: 0 }, zoomCache: new Map(), brakePulse: 0, stateName: state, freeHold: null, manualTrack: false, debugDir: null, pacer: createPacer(), events: createEventDetector(), warpInfo: { warp: 1 },
      corridor: fc.planetId === 'mars' && fc.altitude > atmosphereTop(fc.planet) ? computeCorridor(fc) : null,
      sinceTelemetry: 0, engineSound: false, done: false, indicators: createCockpitIndicators(), steering: createSteeringDisplay(), steeringPlan: createGuidanceReference(),
    };
    const hudLayer = document.createElement('div');
    hudLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    hudLayer.dataset.screen = state;
    ui.mount(hudLayer, { layer: 'hud' });
    hudLayer.style.pointerEvents = 'none'; // ui.mount enables clicks; the HUD must never block buttons under it
    s.hud = createFlightHUD({ parent: hudLayer });
    const guideMark = document.createElement('span');
    guideMark.className = 'marker guide';
    guideMark.textContent = '◎';
    guideMark.style.color = '#7dffa8';
    s.hud.root.append(guideMark);
    s.aimPanel = createManualAimPanel({ parent: hudLayer });
    s.conjPanel = createConjunctionPanel({ parent: hudLayer });
    s.controls = createCockpitControls({
      input,
      onManual: startManual,
      onLock: lockManual,
      isLanded: () => fc.landed,
      onStandUp: () => { if (EGRESS_CINEMATIC) startEgress(); else requestState('INTERIOR'); },
    });
    input.onEscape(cancelManual); // Esc during manual control gives the stick back (core clears it on every state change)
    if (state === 'LAUNCH') s.cam.heading.set(0, 0, 1); // on the pad "behind" is the clear side, away from the tower and tanks
    input.onPress('KeyC', () => {
      if (s.phase0?.active || hasStick() || s.egress) return;
      s.chase = !s.chase;
      if (s.chase) { resetOrbit(s.orbit); s.cam.ready = false; } // behind and above, zoom kept
    });
    input.onPress('Period', () => { if (!s.phase0?.active) s.pacer.stepManual(WARP_KEYS.Period); }); // manual warp: 1 · 2 · 4 · 10 · 50 · 100 (the physics caps it in the air)
    input.onPress('Comma', () => { if (!s.phase0?.active) s.pacer.stepManual(WARP_KEYS.Comma); });
    input.onPress('KeyB', () => { if (!s.phase0?.active) fc.setObstacles(createDebrisField({ fc, seed: Math.floor(Math.random() * 1e6) })); });
    if (state === 'ORBIT') input.onPress('KeyT', transferBurn);
    s.lockOnClick = (event) => { if (!event.target.closest?.('button,textarea,input,select,a')) input.lockPointer(); };
    window.addEventListener('click', s.lockOnClick);

    if (state === 'LAUNCH' && fc.onGround && fc.liftoffT === null) {
      fc.holdDown = true;
      fc.throttle = 0;
      const session = s;
      s.phase0 = createPhase0Ritual({ parent: hudLayer, hud: s.hud, input, audio, graphics, cinematic, contract, economy,
        ship: getShip(), attempt: ++launchAttempts, data,
        getCockpit: () => (session.site ?? session.view)?.cockpit,
        hasButton: (id) => cockpitHasButton((session.site ?? session.view)?.cockpit, id),
        getSite: () => {
          if (!siteCache.ready) return null;
          session.site ??= buildSiteView();
          return session.site;
        },
        setBoardingView: (site) => {
          showModel(site.cockpit, false); showModel(site.rocketRoot, true);
          site.rig.position.set(0, 0, 0); site.rig.quaternion.identity();
          graphics.setSunDirection(new THREE.Vector3(0.5, 0.55, -0.67));
          graphics.setView(site.scene, site.camera); session.mode = 'site';
        },
        onCountdown: (info) => { if (s === session && session.countdown === undefined) { session.countdown = COUNTDOWN; session.countdownAt = performance.now(); if (info?.padFire) session.padFire = createPadFire(); } },
        onScrub: () => requestState('HANGAR'),
      });
    }
    fc.onNotice = (type, data) => {
      // a hit the skin or a tank wall took (no armour used) is not 'Armor took the hit' (part effects)
      const key = type === 'debris_hit' && data && data.armorUsed === 0 ? 'debris_hit_bare' : type;
      if (CALLOUTS[key]) s.callout = { text: CALLOUTS[key], t: CALLOUT_SECONDS };
      if (type === 'debris_hit' && data?.heatShieldDamaged) { mission.foam.hit(); s.callout = { text: FOAM.copy.impact, t: 6 }; }
      if (['maxq_warning', 'fuel_empty', 'parachute', 'debris_near_miss', 'engine_hot', 'g_high'].includes(type)) s.pacer.event(type, fc.t); // key events: back to 1×
      if (type === 'debris_hit' || type === 'parachute' || type === 'fairing_sep') audio.play('impact.small');
      if (['maxq_warning', 'g_high', 'heat_warning', 'engine_hot'].includes(type)) audio.play('alarm.master');
      if (type === 'orbit_achieved') audio.play('radio.blip');
      if (type === 'debris_near_miss') whoosh(fc.t);
    };
    events.emit('flight:phase', { phase: fc.phase });

    // Dev shortcut (only with ?debug=1): Enter skips to the next state, or starts the transfer burn in ORBIT.
    if (new URLSearchParams(location.search).get('debug') === '1') {
      const next = { LAUNCH: 'ORBIT', ENTRY: 'LANDING', LANDING: 'INTERIOR' }[state];
      input.onPress('Enter', () => { if (!s?.phase0?.active) return next ? requestState(next) : transferBurn(); });
    }
  },

  update(dt, state) {
    if (!s) return;
    const { fc, view } = s;
    const mouse = input.mouseDelta();
    const mouseOk = Math.abs(mouse.x) < MAX_MOUSE_STEP && Math.abs(mouse.y) < MAX_MOUSE_STEP;
    const manualWin = mission.manualAscent;
    if (s.egress || hasStick()) { /* the mouse is ignored while the egress plays; otherwise it aims the ○ (below), it neither looks around nor orbits */ }
    else if (mouseOk) {
      if (s.chase) applyMouse(s.orbit, mouse.x, mouse.y); // outside: the mouse orbits the rocket, cockpit look untouched
      else {
        s.look.yaw = s.look.yaw - mouse.x * 0.002;
        s.look.pitch = Math.max(-1.2, Math.min(1.2, s.look.pitch - mouse.y * 0.002));
      }
    }
    if (s.chase && !hasStick()) s.orbit.dist = stepZoom(s.orbit.dist, input.wheelDelta?.()); // core input adds wheelDelta; none yet = no zoom

    if (s.phase0?.active) {
      fc.holdDown = true; fc.throttle = 0;
      s.steering.update(null, false, null, performance.now() / 1000);
      s.hud.setSteeringVisible(false);
      s.phase0.update();
      s.hud.update(fc.telemetry, assistReadout(fc), true, { objective: s.phase0.objective });
      if (s.phase0.boarding) return; // cinematic owns the camera
      const site = s.site;
      const ritualView = site ?? view;
      if (site) {
        site.rig.position.copy(site.rocketBase).add(new THREE.Vector3(0, site.eyeY, 0));
        site.rig.quaternion.copy(toCockpit); s.siteChase = false;
      } else {
        view.planet.position.set(-fc.pos.x, -fc.pos.y, -fc.pos.z);
        view.frame.position.copy(view.planet.position);
        ritualView.rig.quaternion.copy(toCockpit);
      }
      showModel(ritualView.cockpit, true); showModel(ritualView.rocketRoot, false);
      ritualView.camera.position.set(0, 0, 0); ritualView.camera.up.set(0, 1, 0);
      ritualView.camera.quaternion.setFromEuler(new THREE.Euler(s.look.pitch, s.look.yaw, 0, 'YXZ'));
      graphics.setView(ritualView.scene, ritualView.camera);
      ritualView.rig.updateMatrixWorld(true);
      s.phase0.setAim(pickButton(ritualView.cockpit, ritualView.camera)); // the centre reticle: which checklist button is under it
      return; // no physics, pacing, ratings, body or telemetry time during the ritual
    }
    if (s.countdown > 0) {
      s.countdown = Math.max(0, COUNTDOWN - (performance.now() - s.countdownAt) / 1000);
      if (s.countdown <= IGNITION_AT && fc.throttle === 0) fc.throttle = 1; // main engine start at T-3
      if (s.countdown <= 0) fc.holdDown = false; // T-0: clamps release
      for (const e of s.padFire?.update(s.countdown, performance.now() / 1000) ?? []) {
        if (e === 'alarm') { audio.play('alarm.master'); callout('Fire in the cockpit!', 3); s.fireFlash ??= createFireFlash({ parent: s.hud.root.parentElement ?? s.hud.root }); s.fireFlash.start(PAD_FIRE.fadeSeconds); }
        else if (e === 'fail') { fc.throttle = 0; fc.failWith('pureOxygen', 'pad_fire', {}, 'apollo1'); }
      }
    }
    const top = atmosphereTop(fc.planet);
    const approaching = fc.planetId === 'mars' && fc.altitude > top && !fc.landed;
    const ascent0 = ascentGuide(fc), landing0 = landingGuide(fc);

    // manual-control window (ascent): offer at the gravity turn, once per mission
    const win = mission.manualAscent;
    if (win.state === 'idle' && MANUAL.windows.ascent.enabled && fc.planetId === 'earth' && fc.liftoffT !== null && !fc.failed
        && ascent0?.step === 'turn' && state === 'LAUNCH') {
      if (stick().offer() === 'converted') { // already flying free: straight into the scored window
        callout('Gravity turn. Your stick is scored now.');
        s.pacer.event('manual_offer', fc.t, 0.5);
      } else offerManualUi();
    }
    if (win.busy && (fc.failed || fc.planetId !== 'earth' || fc.landed)) { win.close(); s.zoom.target = 0; } // a failure ends the window: no stars
    const auto = mission.autopilot.update(fc, { countdown: s.countdown > 0, corridor: s.corridor, holdDodge: mission.debrisWin.busy });
    let pilot = auto;
    let readout = null;
    const dtMan = Math.min(dt, 0.1);
    if (win.active) {
      const guideDir = ascent0?.direction ?? s.debugDir;
      if (!guideDir) { win.forceLock(); finishManual('Computer has it.', { lock: true }); } // the guide vanished
      else {
        s.manualFrame = frameFor(guideDir, fc.up);
        if (s.manualTrack) win.setAim(win.target.yawDeg, win.target.pitchDeg);
        readout = win.update(dtMan, { mouse: mouseOk ? mouse : { x: 0, y: 0 }, noseOffset: offsetsFromDir(s.manualFrame, fc.forward) });
        s.manualReadout = readout;
        if (win.active) pilot = { ...auto, aim: dirFromOffsets(s.manualFrame, readout.aim.yawDeg, readout.aim.pitchDeg) };
        else if (readout.events.includes('autolocked')) finishManual('Time. Computer has it.', { lock: true });
      }
    } else if (stick().free) {
      if (fc.failed || fc.landed || stick().changedPlanet(fc.planetId) || !FREE_STATES.includes(s.stateName)) { stick().giveBack(); finishManual('Computer has it.'); }
      else if (auto.brake) { stick().giveBack(); finishManual('Computer has it for the retro burn.'); }
      else {
        const guideDir = ascent0?.direction ?? auto.aim ?? s.freeHold ?? fc.forward;
        s.manualFrame = frameFor(guideDir, fc.up);
        readout = stick().update(dtMan, { mouse: mouseOk ? mouse : { x: 0, y: 0 }, noseOffset: offsetsFromDir(s.manualFrame, fc.forward) });
        s.manualReadout = readout;
        pilot = { ...auto, aim: dirFromOffsets(s.manualFrame, readout.aim.yawDeg, readout.aim.pitchDeg) };
      }
    }
    // ---- debris dodge window: conjunction view, aim ○ = sideways RCS thrust (conjunction.js) ----
    const dw = mission.debrisWin;
    s.debrisReadout = null;
    if (mission.debrisTracker && !mission.debrisRated && !fc.failed) {
      const snap = mission.debrisTracker.update(fc, dtMan);
      const pieces = conjunctionPieces(fc, fc.obstacles);
      if (dw.busy && (fc.planetId !== 'earth' || state !== 'ORBIT')) { dw.close(); s.zoom.target = 0; }
      if (dw.busy) {
        if (s.manualTrack && dw.active) { const a = trackAim(pieces, rcsLimit(fc)); dw.setAim(a.x, a.y); }
        const r = dw.update(dtMan, { mouse: dw.active && mouseOk ? mouse : { x: 0, y: 0 }, pieces, ahead: snap.ahead, dv: snap.dv, hits: snap.hits, passed: snap.passed, total: snap.total });
        s.debrisReadout = r;
        if (dw.active) pilot = { ...auto, rcs: rcsRequest(conjunctionAxes(fc.pos, fc.vel), dw.aim, rcsLimit(fc)) };
        // cockpit sounds: RCS puffs while the player pushes (or the computer trims/dodges), whoosh for close passes
        const push = dw.active ? Math.hypot(dw.aim.x, dw.aim.y) : 0;
        const cpuRcs = !dw.active && !!auto.rcs;
        s.rcsPuffT = Math.max(0, (s.rcsPuffT ?? 0) - dtMan);
        if ((push > 0.1 || cpuRcs || (pilot.trim && !dw.active)) && s.rcsPuffT === 0) { audio.play('rcs.puff'); s.rcsPuffT = 0.25; }
        for (const o of fc.obstacles) if (!o.whooshed && o.minDist < 40) { o.whooshed = true; whoosh(fc.t); }
        for (const ev of r.events) {
          if (ev === 'declined') callout('Computer has it.');
          else if (ev === 'clear' || ev === 'timeout') { finishManual('Clear of the debris. Computer has it.'); audio.play('cockpit.lock'); }
        }
      }
      if (snap.ahead === 0 && fc.t - s.debrisAt > 2) { // the whole field has passed: rate it, then the lesson
        mission.debrisRated = true;
        const rating = storeRating(rateDebris({ manualFlown: dw.result().flown, ...mission.debrisTracker.stats(fc) }));
        mission.cardQueue.push({ text: rating.text, t: CARD_SECONDS }, { text: DEBRIS_LESSON, t: CARD_SECONDS + 2 });
      }
    } else if (dw.busy && fc.failed) { dw.close(); s.zoom.target = 0; }
    if (win.offered) {
      for (const ev of win.update(dtMan).events) if (ev === 'declined') { callout('Computer has it.'); s.zoom.target = 0; }
    }
    if (!win.busy && !stick().free) s.manualReadout = null;
    s.zoom.k = Math.max(0, Math.min(1, s.zoom.k + (s.zoom.target > s.zoom.k ? dt : -dt) / ZOOM_SECONDS));
    if (!hasStick() && !mission.foam.scanning && s.zoom.target === 1) s.zoom.target = 0;
    // pacing: time compression + automatic slow-down (pacing.js); physics stays at the fixed step
    const aligned = !ascent0 || dot(fc.forward, ascent0.direction) > Math.cos(THREE.MathUtils.degToRad(6));
    const pace = paceContext(fc, { ascent: ascent0, landing: landing0, countdown: s.countdown > 0, trimming: !!pilot.trim, aligned, manual: win.busy || stick().free || mission.debrisWin.busy });
    for (const name of s.events.update(pace)) s.pacer.event(name, pace.t);
    s.warpInfo = s.pacer.decide(pace, Math.min(dt, 0.1));
    // heat-shield inspection offer / sweep (the sweep fast-forwards its 40 mission seconds into a few real ones)
    for (const ev of mission.foam.update(dtMan, { busy: mission.debrisWin.busy || hasStick() || fc.failed || state !== 'ORBIT' })) {
      if (ev === 'offered') { audio.play('cockpit.manualOffer'); s.pacer.event('foam', fc.t, FOAM.offerSeconds); }
      else if (ev === 'found') sweepFound();
    }
    fc.update(dt, pilot, { timeWarp: mission.foam.scanning ? FOAM.sweepGameSeconds / FOAM.sweepSeconds : s.warpInfo.warp, stopOnNotice: true });
    // cockpit stick/lever (animation only, never fed to physics)
    const manualNow = hasStick();
    let stickPitch = 0, stickYaw = 0;
    if (manualNow && readout) {
      const nose = offsetsFromDir(s.manualFrame, fc.forward);
      stickPitch = clampUnit((readout.aim.pitchDeg - nose.pitchDeg) / 5);
      stickYaw = clampUnit((readout.aim.yawDeg - nose.yawDeg) / 5);
    } else if (fc.omega) {
      stickPitch = clampUnit(dot(fc.omega, qRotate(fc.orient, LOCAL_RIGHT)) / TUNING.maxTurnRate);
      stickYaw = clampUnit(-dot(fc.omega, qRotate(fc.orient, LOCAL_UP)) / TUNING.maxTurnRate);
    }
    s.brakePulse = Math.max(0, s.brakePulse - dt);
    const engineOff = fc.liftoffT !== null && fc.throttle === 0 && !fc.landed && fc.phase !== 'landed';
    const stickValues = s.indicators.update({ pitch: stickPitch, yaw: stickYaw, brake: s.brakePulse > 0, cutoff: engineOff }, fc.throttle, { assist: manualNow, brakeBurn: !!pilot.brake && fc.engineLit });
    for (const c of [s.view?.cockpit, s.site?.cockpit, s.surface?.cockpit]) c?.userData?.setControls?.(stickValues);
    const t = fc.telemetry;
    const a = assistReadout(fc);
    const air = pressureRatio(fc.planet, t.altitude);
    astronaut.body.update(dt, { env: fc.planetId === 'earth' ? (t.altitude > 100000 ? 'earth_orbit' : 'earth') : 'mars_orbit', gLoad: t.gLoad });

    // Orbital debris encounter, once per mission, some time after reaching orbit (armor = ShipSpec.stats.armorHits)
    if (state === 'ORBIT' && t.phase === 'orbit' && !mission.debrisDone) {
      s.inOrbitFor = (s.inOrbitFor ?? 0) + dt;
      if (s.inOrbitFor > DEBRIS_AFTER_ORBIT) {
        placeDebris();
      }
    }
    if (s.debrisWarning > 0) s.debrisWarning -= dt;
    if (fc.landed && !s.wasLanded) {
      audio.play('impact.small');
      s.zoom.target = 0; s.freeHold = null; // touchdown: back to the plain forward cockpit view, no display zoom left over
      if (fc.planetId === 'mars') s.callout = { text: 'Touchdown confirmed. Welcome to Mars.', t: CALLOUT_SECONDS * 2 };
    }
    s.wasLanded = fc.landed;

    // phase ratings (stars) + the numbers behind the entry corridor gauge
    const interfaceAngle = approaching ? predictInterface(fc)?.fpaDeg ?? null : null;
    for (const r of mission.tracker.update(fc, { guideDir: ascent0?.direction ?? null, guideStep: ascent0?.step ?? null, corridor: s.corridor, interfaceAngleDeg: interfaceAngle, manualAscent: win.result() })) mission.card = { text: r.text, t: CARD_SECONDS };
    if (mission.card) { mission.card.t -= dt; if (mission.card.t <= 0) mission.card = mission.cardQueue.shift() ?? null; }
    else if (mission.cardQueue.length) mission.card = mission.cardQueue.shift();

    // automatic state moves
    if (!s.done && !fc.failed) {
      if (state === 'LAUNCH' && t.phase === 'orbit') { s.done = true; requestState('ORBIT'); return; }
      if (state === 'ENTRY' && t.altitude < ENTRY_TO_LANDING) { s.done = true; requestState('LANDING'); return; }
    }

    // camera + views
    const shipQ = new THREE.Quaternion(fc.orient.x, fc.orient.y, fc.orient.z, fc.orient.w);
    const lookQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.look.pitch, s.look.yaw, 0, 'YXZ'));
    const lowMars = fc.planetId === 'mars' && t.altitude < LOW_MARS_ALTITUDE;
    const atSite = siteCache.ready && fc.planetId === 'earth' && t.altitude < LAUNCH_SITE_TOP && state === 'LAUNCH';
    if (atSite) {
      s.site ??= buildSiteView();
      const sv = s.site;
      sv.setAltitude(Math.max(0, t.altitude));
      sv.rocketRoot.quaternion.copy(shipQ);
      if (s.siteChase !== s.chase) { s.siteChase = s.chase; showModel(sv.rocketRoot, s.chase); showModel(sv.cockpit, !s.chase); }
      const eye = new THREE.Vector3(0, sv.eyeY, 0).applyQuaternion(shipQ).add(sv.rocketBase);
      if (s.chase) {
        sv.rig.quaternion.identity();
        sv.rig.position.set(0, 0, 0);
        const centre = new THREE.Vector3(0, sv.centreY, 0).applyQuaternion(shipQ).add(sv.rocketBase);
        placeChaseCamera(sv.camera, centre, 'site', v3(fc.vel), shipForward(shipQ), dt, centre.y + Math.max(0, t.altitude), UP);
      } else {
        sv.rig.position.copy(eye);
        sv.rig.quaternion.copy(shipQ).multiply(toCockpit);
        sv.camera.position.set(0, 0, 0);
        sv.camera.up.set(0, 1, 0);
        sv.camera.quaternion.copy(lookQ);
        applyZoom(sv.camera, sv.rig, sv.cockpit, lookQ);
      }
      const thr = t.thrust > 0 ? fc.throttle : 0;
      sv.flame.userData.set({ throttle: thr, airDensity: air });
      sv.exhaust.userData.set({ throttle: thr, airDensity: air });
      if (s.mode !== 'site') { s.mode = 'site'; graphics.setSunDirection(new THREE.Vector3(0.5, 0.55, -0.67)); graphics.setView(sv.scene, sv.camera); }
    } else if (lowMars) {
      s.surface ??= buildSurfaceView(fc);
      const sv = s.surface;
      const d = v3(fc.pos).sub(sv.origin);
      const x = d.dot(sv.east), z = -d.dot(sv.north);
      const ground = getTerrainHeight(x, z);
      const localQ = sv.toLocal.clone().multiply(shipQ);
      if (s.surfaceChase !== s.chase) { s.surfaceChase = s.chase; showModel(sv.rocketRoot, s.chase); showModel(sv.cockpit, !s.chase); }
      sv.rocketRoot.position.set(x, t.altitude + ground, z);
      sv.rocketRoot.quaternion.copy(localQ);
      if (s.chase) {
        sv.rig.position.set(0, 0, 0);
        sv.rig.quaternion.identity();
        const centre = new THREE.Vector3(0, sv.centreY, 0).applyQuaternion(localQ).add(sv.rocketRoot.position);
        placeChaseCamera(sv.camera, centre, 'mars', v3(fc.vel).applyQuaternion(sv.toLocal), shipForward(shipQ).applyQuaternion(sv.toLocal), dt, null, UP);
        const camGround = getTerrainHeight(sv.camera.position.x, sv.camera.position.z);
        if (sv.camera.position.y < camGround + 2) { sv.camera.position.y = camGround + 2; sv.camera.lookAt(centre); }
      } else {
        sv.rig.position.set(x, t.altitude + ground + 1.6, z);
        sv.rig.quaternion.copy(localQ).multiply(toCockpit);
        sv.camera.position.set(0, 0, 0);
        sv.camera.up.set(0, 1, 0);
        sv.camera.quaternion.copy(lookQ);
        applyZoom(sv.camera, sv.rig, sv.cockpit, lookQ);
      }
      const thr = t.thrust > 0 ? fc.throttle : 0;
      sv.flame.userData.set({ throttle: thr, airDensity: air });
      sv.exhaust.userData.set({ throttle: thr, airDensity: air });
      sv.dust.position.set(x, ground, z);
      sv.dust.userData.set({ intensity: t.thrust > 0 ? Math.max(0, 1 - t.altitude / 40) : 0 });
      if (s.mode !== 'surface') { s.mode = 'surface'; graphics.setView(sv.scene, sv.camera); }
    } else {
      view.planet.position.set(-fc.pos.x, -fc.pos.y, -fc.pos.z);
      view.frame.position.copy(view.planet.position);
      syncDebris(view, fc, dt);
      s.pathTimer = (s.pathTimer ?? 0) - dt;
      view.path.visible = s.chase && !fc.onGround; // seen edge-on from the cockpit: outside camera only
      if (view.path.visible && s.pathTimer <= 0) {
        s.pathTimer = 0.5;
        const pts = predictPath(fc, { seconds: t.phase === 'orbit' ? 3500 : 600 });
        view.path.geometry.dispose();
        view.path.geometry = new THREE.BufferGeometry().setFromPoints(pts.map(v3));
      }
      view.rocketRoot.quaternion.copy(shipQ);
      if (s.spaceChase !== s.chase) { s.spaceChase = s.chase; showModel(view.rocketRoot, s.chase); showModel(view.cockpit, !s.chase); }
      if (s.chase) {
        view.rig.quaternion.identity();
        const centre = new THREE.Vector3(0, view.centreY, 0).applyQuaternion(shipQ);
        placeChaseCamera(view.camera, centre, 'space', v3(fc.vel), v3(fc.forward), dt, null, v3(fc.up));
      } else {
        view.rig.quaternion.copy(shipQ).multiply(toCockpit);
        view.camera.position.set(0, 0, 0);
        view.camera.up.set(0, 1, 0);
        view.camera.quaternion.copy(lookQ);
        applyZoom(view.camera, view.rig, view.cockpit, lookQ);
      }
      if (s.mode !== 'space') { s.mode = 'space'; graphics.setSunDirection(new THREE.Vector3(0.7, 0.45, 0.55)); graphics.setView(view.scene, view.camera); }
    }

    if (s.egress) stepEgress(dt);

    // VFX, screen effects, sound
    const heatFrac = t.heatLimit ? t.heatFlux / t.heatLimit : 0;
    const throttle = t.thrust > 0 ? fc.throttle : 0;
    view.plasma.userData.set({ intensity: heatFrac > 0.05 ? Math.min(1, heatFrac * 1.4) : 0 }); // no faint streaks under the chute
    view.flame.userData.set({ throttle, airDensity: air });
    view.exhaust.userData.set({ throttle, airDensity: air });
    graphics.setEffects({
      vignette: Math.max(0, Math.min(1, (t.gLoad - 3.5) / 3)),
      shake: Math.min(1, (throttle > 0 ? 0.15 + 0.35 * throttle * (0.3 + air) : 0) + (t.dynamicPressure / t.maxQ) * 0.5 + heatFrac * 0.4),
    });
    audio.setAir(air);
    const burning = t.thrust > 0;
    if (burning !== s.engineSound) {
      s.engineSound = burning;
      if (burning) audio.play('engine.rumble', { loop: true });
      else audio.stop('engine.rumble');
    }

    // black box (contract flight:telemetry, about twice per second)
    s.sinceTelemetry += dt;
    if (s.sinceTelemetry >= TELEMETRY_EVERY) {
      s.sinceTelemetry = 0;
      events.emit('flight:telemetry', {
        t: fc.t, phase: t.phase, altitude: t.altitude, speed: t.speed, gForce: t.gLoad, q: t.dynamicPressure,
        fuelKg: t.fuel, engineTemp: t.engineTemp, radiationMsv: astronaut.body.doseMSv,
        verticalSpeed: t.verticalSpeed, throttle: t.thrust > 0 ? fc.throttle : 0, fuelMax: fc.ship.fuelMass, fuelFrac: t.fuelFrac,
        thrust: t.thrust, twr: t.twr, isp: t.isp, deltaVLeft: t.deltaVLeft, maxQ: t.maxQ, ...attitudeDeg(fc),
      });
    }

    // HUD (Codex's flight HUD) + prograde/retrograde markers projected from the active camera
    if (fc.landed) a.warnings.push({ level: 'amber', text: 'LANDED: press E to stand up' });
    if (s.debrisWarning > 0) a.warnings.unshift({ level: 'red', text: 'ORBITAL DEBRIS AHEAD: steer and burn sideways to dodge' });
    if (state === 'ORBIT' && t.phase === 'orbit') a.warnings.push({ level: 'amber', text: `IN ORBIT: press T for the transfer burn (${fmt((economy.balance.deltaVKmS?.transfer ?? 2.1) * 1000)} m/s)` });
    const guide = !(s.countdown > 0) ? ascent0 ?? landing0 : null;
    const status = mission.autopilot.status;
    if (state === 'ENTRY' && approaching && !(s.countdown > 0)) a.warnings.unshift({ level: 'amber', text: 'Approach: the computer trims the entry angle with small RCS pushes (costs a little fuel)' });
    else if (!(s.countdown > 0) && status.step !== 'standby' && status.step !== 'landed') a.warnings.unshift({ level: 'amber', text: status.text });
    if (s.callout?.t > 0) {
      s.callout.t -= dt;
      a.warnings.unshift({ level: 'amber', text: `MISSION CONTROL: ${s.callout.text}` });
    }
    if (s.countdown > 0) {
      const n = Math.ceil(s.countdown);
      a.warnings.unshift({ level: n <= IGNITION_AT ? 'red' : 'amber', text: `T-${n}${n <= IGNITION_AT ? ' · MAIN ENGINE START' : ' · clamps on'}` });
    }
    if (win.offered) a.warnings.unshift({ level: 'manual-offer', text: 'MANUAL CONTROL AVAILABLE · press F (gravity turn, scored)' });
    if (mission.debrisWin.offered) a.warnings.unshift({ level: 'manual-offer', text: 'DEBRIS AHEAD · press F to dodge (scored)' });
    if (mission.foam.offered) a.warnings.unshift({ level: 'manual-offer', text: FOAM.copy.offer });
    if (mission.foam.inspected && !fc.failed) a.warnings.unshift({ level: 'amber', text: FOAM.copy.warning });
    // objective, step checklist, warp indicator, entry corridor gauge
    const earth = fc.planetId === 'earth';
    if (landing0?.blackout) mission.blackout = 'in'; else if (mission.blackout === 'in') mission.blackout = 'after';
    const list = earth ? mission.ascentList : mission.entryList;
    const checklist = list.update(earth ? (ascent0?.step ?? null) : (landing0?.step ?? null), { complete: earth ? t.phase === 'orbit' : fc.landed, blackout: mission.blackout });
    if (earth && ascent0?.step === 'coast' && pace.tApo !== null) a.warnings.unshift({ level: 'amber', text: `Coasting to apoapsis… ${t.altitude > top ? `T-${Math.ceil(pace.tApo)} s` : 'climbing out of the air'}` });
    const gauge = s.corridor && fc.altitude > 60000 && !fc.chuteOpen && !fc.failed ? corridorGauge(fc, s.corridor) : null;
    const warpShown = s.warpInfo.warp > 1 || fc.warpEffective > 1.05;
    s.hud.update(t, a, true, {
      objective: objectiveText(fc, { state, debrisActive: s.debrisWarning > 0 }),
      checklist,
      warp: warpShown ? { value: fc.warpEffective, label: s.warpInfo.label ?? (s.warpInfo.auto ? null : 'manual (, .)'), auto: s.warpInfo.auto } : null,
      card: mission.card,
      gauge,
    });
    const cam = s.mode === 'surface' ? s.surface.camera : s.mode === 'site' ? s.site.camera : view.camera;
    const project = (dir) => {
      if (!dir) return null;
      const world = new THREE.Vector3();
      cam.getWorldPosition(world);
      const p = world.add(v3(dir).multiplyScalar(1000)).project(cam);
      return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 ? { x: (p.x + 1) * 50, y: (1 - p.y) * 50 } : null;
    };
    const activeCockpit = s.mode === 'surface' ? s.surface.cockpit : s.mode === 'site' ? s.site.cockpit : view.cockpit;
    const steering = s.steering.update(activeCockpit, !fc.failed,
      () => s.steeringPlan.readout(fc, pilot, { corridor: s.corridor, countdown: s.countdown > 0, manualOffer: win.offered, debris: mission.debrisWin.offered ? 'offer' : mission.debrisWin.active ? 'dodge' : null, manual: win.active ? { lockReady: !!s.manualReadout?.lockReady } : stick().free ? { free: true } : null }), performance.now() / 1000);
    s.hud.setSteeringVisible(steering.fallback);
    const toLocal = (d) => (d && s.mode === 'surface' ? v3(d).applyQuaternion(s.surface.toLocal) : d);
    s.hud.marker('pro', steering.fallback ? project(toLocal(a.prograde)) : null);
    s.hud.marker('retro', steering.fallback ? project(toLocal(a.retrograde)) : null);
    s.hud.marker('guide', steering.fallback ? project(toLocal(guide?.direction)) : null);
    // manual-control overlay: Role 3's setAim if the cockpit has it, else our panel on the projected centre display
    s.hud.setManual(hasStick());
    const rig = s.mode === 'surface' ? s.surface.rig : s.mode === 'site' ? s.site.rig : view.rig;
    const live = hasStick() ? s.manualReadout : null;
    if (typeof activeCockpit?.userData?.setAim === 'function') {
      s.aimPanel.update(null, null);
      if (s.aimShown && s.aimShown !== activeCockpit) { s.aimShown.userData.setAim?.(null); s.aimShown = null; }
      if (live) {
        const R = MANUAL.rangeDeg;
        const at = (o) => ({ x: 0.5 + o.yawDeg / (2 * R), y: 0.5 + o.pitchDeg / (2 * R) });
        const nz = s.manualFrame ? offsetsFromDir(s.manualFrame, mission.fc.forward) : null;
        activeCockpit.userData.setAim({ target: at(live.target), aim: at(live.aim), nose: nz ? at(nz) : undefined, radius: MANUAL.toleranceDeg / (2 * R), accuracy: live.accuracy, timeLeft: live.timeLeft, lockReady: live.lockReady, label: live.label });
        s.aimShown = activeCockpit;
      } else if (s.aimShown) { s.aimShown.userData.setAim?.(null); s.aimShown = null; }
    } else {
      s.aimPanel.update(live, live ? displayRect(cam, rig, activeCockpit) : null, s.callout?.t > 0 ? s.callout.text : null);
    }
    // debris conjunction view: always our HTML panel (Role 3's in-display aim cannot draw many objects)
    const dLive = mission.debrisWin.active ? s.debrisReadout : null;
    if (dLive) { activeCockpit?.userData?.setAim?.(null); s.aimShown = null; }
    const setConj = activeCockpit?.userData?.setConjunction;
    if (typeof setConj === 'function') {
      s.conjPanel.update(null, null, null);
      if (s.conjShown && s.conjShown !== activeCockpit) { s.conjShown.userData.setConjunction?.(null); s.conjShown = null; }
      if (dLive) { // same projection as the HTML panel: x/R, y/R in -1..1 (y up) -> 0..1; radius = danger/R -> /2
        const R = dLive.range;
        setConj.call(activeCockpit.userData, {
          objects: dLive.pieces.slice(0, 40).map((p) => ({ x: 0.5 + p.x / (2 * R), y: 0.5 + p.y / (2 * R), r: Math.max(0.035, p.danger / R) / 2, t: p.t })),
          aim: { x: 0.5 + dLive.aim.x / 2, y: 0.5 + dLive.aim.y / 2 },
          range: R, label: dLive.label, dv: dLive.dv, hits: dLive.hits, passed: dLive.passed,
        });
        s.conjShown = activeCockpit;
      } else if (s.conjShown) { s.conjShown.userData.setConjunction?.(null); s.conjShown = null; }
    } else s.conjPanel.update(dLive, dLive ? displayRect(cam, rig, activeCockpit) : null, s.callout?.t > 0 ? s.callout.text : null);
    const danger = t.collisionWarning && fc.obstacles.find((o) => o.id === t.collisionWarning.id);
    s.hud.marker('collision', danger ? project(v3(danger.pos).sub(v3(fc.pos)).normalize()) : null);
  },

  exit() {
    if (!s) return;
    // graphics.camera is our flight camera now; hand it back un-parented and level so the next state's owner
    // (for example the ENDING screen) doesn't inherit the ship's attitude and look at the cockpit's rear wall.
    s.steering.dispose();
    s.phase0?.dispose();
    s.fireFlash?.dispose();
    stick().giveBack();
    mission.manualAscent.close(); // a state change ends an open window (no stars)
    mission.debrisWin.close();
    s.aimPanel.dispose();
    s.conjPanel.dispose();
    s.egress?.overlay.dispose();
    s.aimShown?.userData?.setAim?.(null);
    s.conjShown?.userData?.setConjunction?.(null);
    s.hud.setManual(false);
    const cam = graphics.camera;
    cam.removeFromParent();
    cam.position.set(0, 0, 0);
    cam.quaternion.identity();
    cam.up.set(0, 1, 0);
    cam.updateMatrixWorld();
    if (s.surface) s.surface.scene.remove(s.surface.rig, s.surface.dust); // the shared Mars scene is walked on next
    s.controls.dispose();
    window.removeEventListener('click', s.lockOnClick);
    graphics.setEffects({ vignette: 0, shake: 0 });
    audio.stop('engine.rumble');
    if (mission.fc) mission.fc.onNotice = null;
    s = null;
  },
};
