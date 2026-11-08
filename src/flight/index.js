// Role 2 flight module: owns LAUNCH, ORBIT, ENTRY, LANDING (contract.js STATE_OWNERS).
// Real Newtonian physics (FlightController) + Role 3's cockpit, planets, rocket parts and VFX.
//
//   LAUNCH  pad → ascent; reaching orbit moves to ORBIT on its own.
//   ORBIT   coast; T = transfer burn to Mars (Δv from balance.json deltaVKmS.transfer) → CRUISE (Role 4).
//   ENTRY   Mars entry (heat shield, chute); below 6 km moves to LANDING on its own.
//   LANDING powered descent and touchdown; E after landing → INTERIOR (Role 2 surface).
// Failures emit flight:failed; Role 4's story module charges the penalty and shows the ending.
import * as THREE from 'three';
import { assets, createLaunchSite, createSpaceScene, getTerrainHeight, graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { G0, PLANETS, economy, events, getShip, input, requestState, ui } from '/src/core/index.js';
import { astronaut } from '/src/surface/astronaut.js';
import { getMars } from '/src/surface/scenes.js';
import { FlightController } from './FlightController.js';
import { createCockpitControls } from './cockpitControls.js';
import { ascentGuide, assistReadout, landingGuide, predictPath } from './flightAssist.js';
import { createDebrisField } from './debris.js';
import { pressureRatio } from './atmosphere.js';
import { STARTS } from './presets.js';
import { createFlightHUD } from './hud/createFlightHUD.js';
import { stackParts } from './rocketStack.js';

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '∞');

export { FlightController };

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
const mission = { fc: null, planetId: null, fuelForMars: null, debrisDone: false };
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
    return newController('earth', STARTS.earthPad);
  }
  if (state === 'ORBIT') {
    if (fc && mission.planetId === 'earth' && !fc.failed && fc.phase === 'orbit') return fc;
    return newController('earth', circularOrbitStart('earth', 200000));
  }
  const marsFuel = mission.fuelForMars ?? getShip().stats.fuelMass * 0.25;
  if (state === 'ENTRY') return newController('mars', STARTS.marsEntry, marsFuel);
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
  const { rocket, eyeY } = buildRocket(getShip());
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
  return { scene, camera, planet, rig, cockpit, plasma, flame, exhaust, rocketRoot, frame, path, debris: new Map() };
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
  return { rocket, eyeY };
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
  const { rocket, eyeY } = buildRocket(getShip());
  const flame = assets.get('vfx:engineFlame');
  const exhaust = assets.get('vfx:exhaust');
  rocket.add(flame, exhaust);
  const rocketRoot = new THREE.Group();
  rocketRoot.position.copy(site.rocketBase);
  rocketRoot.add(rocket);
  rocketRoot.userData.role2 = rig.userData.role2 = true;
  site.scene.add(rocketRoot, rig);
  site.setAltitude(0);
  return { ...site, camera, rig, cockpit, rocketRoot, flame, exhaust, eyeY };
}

// Low over Mars: Role 2's shared Mars scene (pre-built at boot by src/surface/scenes.js). Our ship IS the lander,
// so the parked lander model is hidden while we fly; surface shows it again on SURFACE.
function buildSurfaceView(fc) {
  const { scene, lander } = getMars();
  for (const old of scene.children.filter((o) => o.userData.role2Flight)) scene.remove(old);
  lander.visible = false;
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 2e5);
  const rig = new THREE.Group();
  rig.add(assets.get('cockpit'), camera);
  const dust = assets.get('vfx:landingDust');
  rig.userData.role2Flight = dust.userData.role2Flight = true;
  scene.add(rig, dust);
  // tangent frame at the point under the ship when this view starts: east = +X, north = −Z, up = +Y
  const up = v3(fc.up);
  const east = v3(fc.vel).projectOnPlane(up).normalize();
  if (east.lengthSq() < 0.5) east.set(1, 0, 0).projectOnPlane(up).normalize();
  const north = new THREE.Vector3().crossVectors(east, up);
  const toLocal = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()).invert());
  return { scene, camera, rig, dust, origin: up.clone().multiplyScalar(fc.planet.radius), east, north, toLocal };
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
    setTimeout(prepareLaunchSite, 0); // after boot finished its own work
  },

  enter(state) {
    const fc = controllerFor(state);
    if ((state === 'ORBIT' || state === 'ENTRY') && fc.throttle === 0) faceTheLimb(fc);
    if (state === 'LANDING' && !fc.landed && fc.throttle === 0) faceTheGround(fc);
    const view = buildSpaceView(fc.planetId);
    s = {
      state, fc, view, surface: null, mode: null,
      look: { yaw: 0, pitch: 0 }, chase: false, warp: 1, assist: true,
      sinceTelemetry: 0, engineSound: false, done: false,
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
      onToggleAssist: () => { s.assist = !s.assist; },
      isLanded: () => fc.landed,
      onStandUp: () => requestState('INTERIOR'),
    });
    input.onPress('KeyC', () => { s.chase = !s.chase; });
    input.onPress('Period', () => { s.warp = Math.min(100, s.warp * 10); });
    input.onPress('Comma', () => { s.warp = Math.max(1, s.warp / 10); });
    input.onPress('KeyB', () => fc.setObstacles(createDebrisField({ fc, seed: Math.floor(Math.random() * 1e6) })));
    if (state === 'ORBIT') input.onPress('KeyT', transferBurn);
    s.lockOnClick = () => input.lockPointer();
    window.addEventListener('click', s.lockOnClick);

    if (state === 'LAUNCH' && fc.onGround && fc.liftoffT === null) {
      s.countdown = COUNTDOWN;
      fc.holdDown = true;
    }
    fc.onNotice = (type) => {
      if (CALLOUTS[type]) s.callout = { text: CALLOUTS[type], t: CALLOUT_SECONDS };
      if (type === 'debris_hit' || type === 'parachute' || type === 'fairing_sep') audio.play('impact.small');
      if (['maxq_warning', 'g_high', 'heat_warning', 'engine_hot'].includes(type)) audio.play('alarm.master');
      if (type === 'orbit_achieved') audio.play('radio.blip');
    };
    events.emit('flight:phase', { phase: fc.phase });

    // Dev shortcut (only with ?debug=1): Enter skips to the next state, or starts the transfer burn in ORBIT.
    if (new URLSearchParams(location.search).get('debug') === '1') {
      const next = { LAUNCH: 'ORBIT', ENTRY: 'LANDING', LANDING: 'INTERIOR' }[state];
      input.onPress('Enter', () => (next ? requestState(next) : transferBurn()));
    }
  },

  update(dt, state) {
    if (!s) return;
    const { fc, view } = s;
    const mouse = input.mouseDelta();
    if (Math.abs(mouse.x) < MAX_MOUSE_STEP && Math.abs(mouse.y) < MAX_MOUSE_STEP) {
      s.look.yaw = s.look.yaw - mouse.x * 0.002;
      s.look.pitch = Math.max(-1.2, Math.min(1.2, s.look.pitch - mouse.y * 0.002));
    }

    s.controls.poll();
    if (s.countdown > 0) {
      s.countdown -= dt;
      if (s.countdown <= IGNITION_AT && fc.throttle === 0) fc.throttle = 1; // main engine start at T-3
      if (s.countdown <= 0) fc.holdDown = false; // T-0: clamps release
    }
    fc.update(dt, s.controls.input, { timeWarp: s.warp });
    s.controls.endFrame();
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
        audio.play('alarm.master');
      }
    }
    if (s.debrisWarning > 0) s.debrisWarning -= dt;
    if (fc.landed && !s.wasLanded) {
      audio.play('impact.small');
      if (fc.planetId === 'mars') s.callout = { text: 'Touchdown confirmed. Welcome to Mars.', t: CALLOUT_SECONDS * 2 };
    }
    s.wasLanded = fc.landed;

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
        sv.camera.position.copy(eye).add(new THREE.Vector3(0, 0, 1).applyQuaternion(shipQ).multiplyScalar(-40)).add(new THREE.Vector3(18, 6, 0));
        sv.camera.up.set(0, 1, 0);
        sv.camera.lookAt(eye);
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
      sv.rig.position.set(x, t.altitude + ground + 1.6, z);
      sv.rig.quaternion.copy(sv.toLocal).multiply(shipQ).multiply(toCockpit);
      sv.camera.quaternion.copy(lookQ);
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
        const up = v3(fc.up);
        view.camera.position.copy(v3(fc.forward).multiplyScalar(-45)).addScaledVector(up, 12);
        view.camera.up.copy(up);
        view.camera.lookAt(0, 0, 0);
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
    if (guide) a.warnings.unshift({ level: 'amber', text: guide.text });
    if (s.callout?.t > 0) {
      s.callout.t -= dt;
      a.warnings.unshift({ level: 'amber', text: `MISSION CONTROL: ${s.callout.text}` });
    }
    if (s.countdown > 0) {
      const n = Math.ceil(s.countdown);
      a.warnings.unshift({ level: n <= IGNITION_AT ? 'red' : 'amber', text: `T-${n}${n <= IGNITION_AT ? ' · MAIN ENGINE START' : ' · clamps on'}` });
    }
    s.hud.update(t, a, s.assist);
    const cam = s.mode === 'surface' ? s.surface.camera : s.mode === 'site' ? s.site.camera : view.camera;
    const project = (dir) => {
      if (!dir || !s.assist) return null;
      const world = new THREE.Vector3();
      cam.getWorldPosition(world);
      const p = world.add(v3(dir).multiplyScalar(1000)).project(cam);
      return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 ? { x: (p.x + 1) * 50, y: (1 - p.y) * 50 } : null;
    };
    const toLocal = (d) => (d && s.mode === 'surface' ? v3(d).applyQuaternion(s.surface.toLocal) : d);
    s.hud.marker('pro', project(toLocal(a.prograde)));
    s.hud.marker('retro', project(toLocal(a.retrograde)));
    s.hud.marker('guide', project(toLocal(guide?.direction)));
    const danger = t.collisionWarning && fc.obstacles.find((o) => o.id === t.collisionWarning.id);
    s.hud.marker('collision', danger ? project(v3(danger.pos).sub(v3(fc.pos)).normalize()) : null);
  },

  exit() {
    if (!s) return;
    // graphics.camera is our flight camera now; hand it back un-parented and level so the next state's owner
    // (for example the ENDING screen) doesn't inherit the ship's attitude and look at the cockpit's rear wall.
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
