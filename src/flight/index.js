// Role 2 flight module: owns LAUNCH, ORBIT, ENTRY, LANDING (contract.js STATE_OWNERS).
// Real Newtonian physics (FlightController) + Role 3's cockpit, planets, rocket parts and VFX.
//
//   LAUNCH  pad → ascent; reaching orbit moves to ORBIT on its own.
//   ORBIT   coast; T = transfer burn to Mars (Δv from balance.json deltaVKmS.transfer) → CRUISE (Role 4).
//   ENTRY   Mars entry (heat shield, chute); below 6 km moves to LANDING on its own.
//   LANDING powered descent and touchdown; E after landing → INTERIOR (Role 2 surface).
// Failures emit flight:failed; Role 4's story module charges the penalty and shows the ending.
import * as THREE from 'three';
import { assets, createLaunchSite, createSpaceScene, getTerrainHeight, graphics, cinematic } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { G0, PLANETS, contract, economy, events, getShip, input, requestState, ui } from '/src/core/index.js';
import { astronaut } from '/src/surface/astronaut.js';
import { getMars } from '/src/surface/scenes.js';
import { FlightController } from './FlightController.js';
import { createCockpitControls, createCockpitIndicators } from './cockpitControls.js';
import { ascentGuide, assistReadout, landingGuide, predictPath } from './flightAssist.js';
import { createDebrisField } from './debris.js';
import { atmosphereTop, pressureRatio } from './atmosphere.js';
import { createPacer, createEventDetector, paceContext } from './pacing.js';
import { approachBack, computeCorridor, corridorGauge, predictInterface } from './corridor.js';
import { createChecklist, objectiveText } from './objectives.js';
import { clearPhaseRatings, createPhaseTracker, getPhaseRatings } from './rating.js';
import { dot } from './vec.js';
import { STARTS } from './presets.js';
import { createFlightHUD } from './hud/createFlightHUD.js';
import { createSteeringDisplay, createGuidanceReference } from './steering.js';
import { createPhase0Ritual } from './phase0Ritual.js';
import { stackParts } from './rocketStack.js';
import { ZOOM_DEFAULT, ZOOM_PAD, applyMouse, createChaseState, createOrbit, horizonFrame, liftAboveGround, resetOrbit, stepZoom, updateChase } from './chaseCam.js';

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '∞');

export { FlightController };
// Phase ratings for Role 4's Flight Report: [{ phase: 'ascent'|'entry'|'landing', stars: 1..3, stats, text }] (see rating.js).
export { getPhaseRatings };

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
  parachute: 'Parachute deployed.', debris_hit: 'Debris strike! Armor took the hit.', no_ignition: 'Engine will not relight: no ignitions left.',
};
const MAX_MOUSE_STEP = 300; // px per frame: ignore the jump some browsers report right after pointer lock // m: below this the view switches to Role 3's detailed Mars terrain
const TELEMETRY_EVERY = 0.5; // s (contract: flight:telemetry about twice per second)
const toCockpit = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // nose +Y → cockpit −Z

// Mission state that survives state changes (LAUNCH → ORBIT keeps the same controller; LANDING ⇄ INTERIOR too).
const mission = { fc: null, planetId: null, fuelForMars: null, debrisDone: false, tracker: createPhaseTracker(), card: null, ascentList: createChecklist('ascent'), entryList: createChecklist('entry'), blackout: 'before' };
const ENTRY_FPA = -22.8; // deg at the atmosphere's edge: inside the corridor but off its centre, so a small trim (W/S) pays off
const ENTRY_APPROACH = 40; // s of approach before the atmosphere (time to trim the corridor)
const CARD_SECONDS = 6;
const WARP_KEYS = { Period: 1, Comma: -1 };
let launchAttempts = 0;
let s = null; // per-state session (scene, camera, HUD, controls)

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

function newController(planetId, start, fuel) {
  const fc = new FlightController({ bus: events, planets: PLANETS, g0: G0, planetId, shipSpec: getShip(), start, fuel });
  mission.fc = fc;
  mission.planetId = planetId;
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
    clearPhaseRatings(); // a new mission starts: forget last flight's ratings
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
// the ground and horizon are in view; BURN NOW (hold Space) still turns it retrograde for the burn.
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

// ---------- module ----------
export default {
  init() {
    if (new URLSearchParams(location.search).get('debug') === '1') window.__role2flight = {
      get look() { return s?.look; }, get fc() { return s?.fc; }, get orbit() { return s?.orbit; }, get session() { return s; },
      skipPhase0() { s?.phase0?.skip(); },
      // set the outside camera for screenshots: orbit(yawDeg, pitchDeg, dist); `wheel` fakes a wheel step; chase(on) toggles the view
      orbit(yawDeg, pitchDeg, dist) { if (s) { s.orbit.yaw = THREE.MathUtils.degToRad(yawDeg); s.orbit.pitch = THREE.MathUtils.degToRad(pitchDeg); if (dist) s.orbit.dist = dist; s.cam.ready = false; } return s?.orbit; },
      wheel(delta) { if (s) s.orbit.dist = stepZoom(s.orbit.dist, delta); return s?.orbit.dist; },
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
      look: { yaw: 0, pitch: 0 }, orbit: createOrbit(state === 'LAUNCH' ? ZOOM_PAD : ZOOM_DEFAULT), cam: createChaseState(), chase: false, pacer: createPacer(), events: createEventDetector(), warpInfo: { warp: 1 }, assist: true,
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
    s.controls = createCockpitControls({
      input,
      onToggleAssist: () => { if (s.phase0?.active) return; s.assist = !s.assist; },
      isLanded: () => fc.landed,
      onStandUp: () => requestState('INTERIOR'),
    });
    if (state === 'LAUNCH') s.cam.heading.set(0, 0, 1); // on the pad "behind" is the clear side, away from the tower and tanks
    input.onPress('KeyC', () => {
      if (s.phase0?.active) return;
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
        onCountdown: () => { if (s === session && session.countdown === undefined) { session.countdown = COUNTDOWN; session.countdownAt = performance.now(); } },
        onScrub: () => requestState('HANGAR'),
      });
    }
    fc.onNotice = (type) => {
      if (CALLOUTS[type]) s.callout = { text: CALLOUTS[type], t: CALLOUT_SECONDS };
      if (['maxq_warning', 'fuel_empty', 'parachute', 'debris_near_miss', 'engine_hot', 'g_high'].includes(type)) s.pacer.event(type, fc.t); // key events: back to 1×
      if (type === 'debris_hit' || type === 'parachute' || type === 'fairing_sep') audio.play('impact.small');
      if (['maxq_warning', 'g_high', 'heat_warning', 'engine_hot'].includes(type)) audio.play('alarm.master');
      if (type === 'orbit_achieved') audio.play('radio.blip');
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
    if (Math.abs(mouse.x) < MAX_MOUSE_STEP && Math.abs(mouse.y) < MAX_MOUSE_STEP) {
      if (s.chase) applyMouse(s.orbit, mouse.x, mouse.y); // outside: the mouse orbits the rocket, cockpit look untouched
      else {
        s.look.yaw = s.look.yaw - mouse.x * 0.002;
        s.look.pitch = Math.max(-1.2, Math.min(1.2, s.look.pitch - mouse.y * 0.002));
      }
    }
    if (s.chase) s.orbit.dist = stepZoom(s.orbit.dist, input.wheelDelta?.()); // core input adds wheelDelta; none yet = no zoom

    if (s.phase0?.active) {
      fc.holdDown = true; fc.throttle = 0;
      s.steering.update(null, false, null, performance.now() / 1000);
      s.hud.setSteeringVisible(false);
      s.controls.endFrame();
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
      return; // no physics, pacing, ratings, body or telemetry time during the ritual
    }
    s.controls.poll();
    if (s.countdown > 0) {
      s.countdown = Math.max(0, COUNTDOWN - (performance.now() - s.countdownAt) / 1000);
      if (s.countdown <= IGNITION_AT && fc.throttle === 0) fc.throttle = 1; // main engine start at T-3
      if (s.countdown <= 0) fc.holdDown = false; // T-0: clamps release
    }
    // pacing: time compression + automatic slow-down (pacing.js); physics stays at the fixed step
    const top = atmosphereTop(fc.planet);
    const approaching = fc.planetId === 'mars' && fc.altitude > top && !fc.landed;
    const pilot = { ...s.controls.input };
    if (state === 'ENTRY' && approaching) pilot.trim = pilot.pitch; // W/S trim the entry angle before the atmosphere (RCS, costs fuel)
    const ascent0 = ascentGuide(fc), landing0 = landingGuide(fc);
    const aligned = !ascent0 || dot(fc.forward, ascent0.direction) > Math.cos(THREE.MathUtils.degToRad(6));
    const pace = paceContext(fc, { ascent: ascent0, landing: landing0, countdown: s.countdown > 0, trimming: !!pilot.trim, aligned });
    for (const name of s.events.update(pace)) s.pacer.event(name, pace.t);
    s.warpInfo = s.pacer.decide(pace, Math.min(dt, 0.1));
    fc.update(dt, pilot, { timeWarp: s.warpInfo.warp, stopOnNotice: true });
    s.controls.endFrame();
    const stickValues = s.indicators.update(pilot, fc.throttle, { assist: s.assist, brakeBurn: pilot.brake && fc.engineLit });
    for (const c of [s.view?.cockpit, s.site?.cockpit, s.surface?.cockpit]) c?.userData?.setControls?.(stickValues);
    const t = fc.telemetry;
    const a = assistReadout(fc);
    const air = pressureRatio(fc.planet, t.altitude);
    astronaut.body.update(dt, { env: fc.planetId === 'earth' ? (t.altitude > 100000 ? 'earth_orbit' : 'earth') : 'mars_orbit', gLoad: t.gLoad });

    // Orbital debris encounter, once per mission, some time after reaching orbit (armor = ShipSpec.stats.armorHits)
    if (state === 'ORBIT' && t.phase === 'orbit' && !mission.debrisDone) {
      s.inOrbitFor = (s.inOrbitFor ?? 0) + dt;
      if (s.inOrbitFor > DEBRIS_AFTER_ORBIT) {
        mission.debrisDone = true;
        fc.setObstacles(createDebrisField({ fc, aheadDistance: 3600, count: 45, seed: 2041 }));
        s.debrisWarning = 8;
        s.pacer.event('debris', fc.t, 4);
        audio.play('alarm.master');
      }
    }
    if (s.debrisWarning > 0) s.debrisWarning -= dt;
    if (fc.landed && !s.wasLanded) {
      audio.play('impact.small');
      if (fc.planetId === 'mars') s.callout = { text: 'Touchdown confirmed. Welcome to Mars.', t: CALLOUT_SECONDS * 2 };
    }
    s.wasLanded = fc.landed;

    // phase ratings (stars) + the numbers behind the entry corridor gauge
    const interfaceAngle = approaching ? predictInterface(fc)?.fpaDeg ?? null : null;
    for (const r of mission.tracker.update(fc, { guideDir: ascent0?.direction ?? null, guideStep: ascent0?.step ?? null, corridor: s.corridor, interfaceAngleDeg: interfaceAngle })) mission.card = { text: r.text, t: CARD_SECONDS };
    if (mission.card) { mission.card.t -= dt; if (mission.card.t <= 0) mission.card = null; }

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
      view.path.visible = s.assist && s.chase && !fc.onGround; // seen edge-on from the cockpit: outside camera only
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
      }
      if (s.mode !== 'space') { s.mode = 'space'; graphics.setSunDirection(new THREE.Vector3(0.7, 0.45, 0.55)); graphics.setView(view.scene, view.camera); }
    }

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
      });
    }

    // HUD (Codex's flight HUD) + prograde/retrograde markers projected from the active camera
    if (fc.landed) a.warnings.push({ level: 'amber', text: 'LANDED: press E to stand up' });
    if (s.debrisWarning > 0) a.warnings.unshift({ level: 'red', text: 'ORBITAL DEBRIS AHEAD: steer and burn sideways to dodge' });
    if (state === 'ORBIT' && t.phase === 'orbit') a.warnings.push({ level: 'amber', text: `IN ORBIT: press T for the transfer burn (${fmt((economy.balance.deltaVKmS?.transfer ?? 2.1) * 1000)} m/s)` });
    const guide = s.assist && !(s.countdown > 0) ? ascentGuide(fc) ?? landingGuide(fc) : null;
    if (guide && state === 'ENTRY' && approaching) a.warnings.unshift({ level: 'amber', text: 'Approach: trim the entry angle before the air. Hold W for steeper, S for shallower (small fuel cost)' });
    else if (guide) a.warnings.unshift({ level: 'amber', text: guide.text });
    if (s.callout?.t > 0) {
      s.callout.t -= dt;
      a.warnings.unshift({ level: 'amber', text: `MISSION CONTROL: ${s.callout.text}` });
    }
    if (s.countdown > 0) {
      const n = Math.ceil(s.countdown);
      a.warnings.unshift({ level: n <= IGNITION_AT ? 'red' : 'amber', text: `T-${n}${n <= IGNITION_AT ? ' · MAIN ENGINE START' : ' · clamps on'}` });
    }
    // objective, step checklist, warp indicator, entry corridor gauge
    const earth = fc.planetId === 'earth';
    if (landing0?.blackout) mission.blackout = 'in'; else if (mission.blackout === 'in') mission.blackout = 'after';
    const list = earth ? mission.ascentList : mission.entryList;
    const checklist = list.update(earth ? (ascent0?.step ?? null) : (landing0?.step ?? null), { complete: earth ? t.phase === 'orbit' : fc.landed, blackout: mission.blackout });
    if (earth && ascent0?.step === 'coast' && pace.tApo !== null) a.warnings.unshift({ level: 'amber', text: `Coasting to apoapsis… ${t.altitude > top ? `T-${Math.ceil(pace.tApo)} s` : 'climbing out of the air'}` });
    const gauge = s.corridor && fc.altitude > 60000 && !fc.chuteOpen && !fc.failed ? corridorGauge(fc, s.corridor) : null;
    const warpShown = s.warpInfo.warp > 1 || fc.warpEffective > 1.05;
    s.hud.update(t, a, s.assist, {
      objective: objectiveText(fc, { state, debrisActive: s.debrisWarning > 0 }),
      checklist,
      warp: warpShown ? { value: fc.warpEffective, label: s.warpInfo.label ?? (s.warpInfo.auto ? null : 'manual (, .)'), auto: s.warpInfo.auto } : null,
      card: mission.card,
      gauge,
    });
    const cam = s.mode === 'surface' ? s.surface.camera : s.mode === 'site' ? s.site.camera : view.camera;
    const project = (dir) => {
      if (!dir || !s.assist) return null;
      const world = new THREE.Vector3();
      cam.getWorldPosition(world);
      const p = world.add(v3(dir).multiplyScalar(1000)).project(cam);
      return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 ? { x: (p.x + 1) * 50, y: (1 - p.y) * 50 } : null;
    };
    const activeCockpit = s.mode === 'surface' ? s.surface.cockpit : s.mode === 'site' ? s.site.cockpit : view.cockpit;
    const steering = s.steering.update(activeCockpit, s.assist && !fc.failed,
      () => s.steeringPlan.readout(fc, { ...pilot, cutoff: false }, { corridor: s.corridor, countdown: s.countdown > 0 }), performance.now() / 1000);
    s.hud.setSteeringVisible(steering.fallback);
    const toLocal = (d) => (d && s.mode === 'surface' ? v3(d).applyQuaternion(s.surface.toLocal) : d);
    s.hud.marker('pro', steering.fallback ? project(toLocal(a.prograde)) : null);
    s.hud.marker('retro', steering.fallback ? project(toLocal(a.retrograde)) : null);
    s.hud.marker('guide', steering.fallback ? project(toLocal(guide?.direction)) : null);
    const danger = t.collisionWarning && fc.obstacles.find((o) => o.id === t.collisionWarning.id);
    s.hud.marker('collision', danger ? project(v3(danger.pos).sub(v3(fc.pos)).normalize()) : null);
  },

  exit() {
    if (!s) return;
    // graphics.camera is our flight camera now; hand it back un-parented and level so the next state's owner
    // (for example the ENDING screen) doesn't inherit the ship's attitude and look at the cockpit's rear wall.
    s.steering.dispose();
    s.phase0?.dispose();
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
