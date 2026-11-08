// Role 2 surface module: owns INTERIOR (walkable cabin) and SURFACE (Mars EVA) (contract.js STATE_OWNERS).
// First-person walking with Mars gravity, suit O₂, cabin stations, airlock, Role 3's cabin and Mars terrain,
// and the suit HUD (helmet frame + life support panel).
//
//   INTERIOR  stations: pilotSeat (→ LANDING cockpit, or → RETURN when Mars Exploration is 100 %), suitLocker,
//             o2Station, commsConsole, sampleStorage, bunk, airlock (suit on → 3 s cycle → SURFACE).
//   SURFACE   walk Jezero; O₂ drains (30/15/5 % cautions, 0 % → flight:failed outOfBreath); the hatch → INTERIOR.
//             The crewed rover (Apollo LRV-style, RoverController) is parked by the lander: E to drive, E to get out.
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
import { createSolClock, createEarthCaption, easeFov, isLookingAtEarth, NORMAL_FOV } from './dusk.js';
import { RoverController } from './RoverController.js';
import { createRoverModel } from './roverModel.js';
import { createGroundMarks } from './groundMarks.js';

const TELEMETRY_EVERY = 0.5;
const LANDER_RADIUS = 3.2; // m, the lander's legs: you can't walk through them
const HATCH = { x: 0, z: 3.6 }; // where you climb back in (in front of the lander)
const MAX_MOUSE_STEP = 300; // px per frame: ignore the jump some browsers report right after pointer lock
const ROVER_PARKING = { x: 6.5, z: 7, heading: -0.6 }; // unfolded next to the lander, like the Apollo LRVs
// Crew-life props in the cabin open these Guidebook entries (Role 4 writes them; ids listed in the README).
export const PROP_ENTRIES = { exerciseBike: 'crew-exercise', waterRecycler: 'crew-water', foodRack: 'crew-food', familyPhoto: 'family-photo' };

// Mars dusk / "Pale Blue Dot" texts (Role 4 may edit them here).
export const EARTH_HINT = 'Look for Earth: low in the sky, hold Z to zoom';
export const EARTH_CAPTION = ['EARTH · about 225 million km away', 'Everyone you have ever loved is on that dot.'];

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

// The rover keeps its place, battery and odometer across visits outside (module-level, like the astronaut).
const roverSpot = { x: ROVER_PARKING.x, y: 0, z: ROVER_PARKING.z }; // interactable position, follows the rover
const roverCollider = { x: ROVER_PARKING.x, z: ROVER_PARKING.z, r: 1.6 }; // the walker can't walk through it
let rover = null;
let roverModel = null;
function getRover() {
  if (!rover) {
    rover = new RoverController({
      gravity: PLANETS.mars.g, getGroundHeight: getTerrainHeight, start: ROVER_PARKING,
      colliders: [{ x: 0, z: 0, r: LANDER_RADIUS }], onNotice: (type, d) => roverNotice(type, d),
    });
    roverModel = createRoverModel();
  }
  return rover;
}
registerInteractable({
  id: 'rover', state: 'SURFACE', radius: 2.6, minFacing: 0.3, position: roverSpot,
  prompt: () => (rover?.overturned ? 'The rover is on its side' : 'E: drive the rover'),
  enabled: () => !s?.driving && !rover?.overturned,
  onUse: () => boardRover(),
});

// Wheel tracks and boot prints persist across visits (module-level); added to the Mars scene only while outside.
let marks = null;
const getMarks = () => (marks ??= createGroundMarks({ getGroundHeight: getTerrainHeight }));
const isDebug = () => new URLSearchParams(location.search).get('debug') === '1';

// The sol clock keeps its time across visits outside (module-level, like the rover); it only runs outside.
let solClock = null;
const getSolClock = () => (solClock ??= createSolClock({ apply: getMarsSunSetter() }));
let earthHintShown = false;
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

function boardRover() {
  if (!s || s.inside || s.driving) return;
  s.driving = true;
  s.look = { yaw: 0, pitch: -0.08 };
  s.notice = { text: 'Driving: W/S throttle and reverse · A/D steer · SPACE brake · E get out', t: 6 };
}

function leaveRover() {
  if (!s?.driving) return;
  s.driving = false;
  // step off on the driver's (left) side, facing the way the rover points
  const r = rover.right;
  const x = rover.x - r.x * 1.7, z = rover.z - r.z * 1.7;
  s.walker.pos.x = x;
  s.walker.pos.z = z;
  s.walker.pos.y = getTerrainHeight(x, z);
  s.walker.vel.x = s.walker.vel.y = s.walker.vel.z = 0;
  s.walker.yaw = rover.heading;
  s.walker.pitch = 0;
}

// Outside only: advance the sol clock, ease the helmet zoom, hint and caption for Earth.
function updateDusk(dt, zoomHeld) {
  const { camera } = s;
  const clock = getSolClock();
  clock.update(dt);
  const fov = easeFov(camera.fov, zoomHeld, dt);
  if (fov !== camera.fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
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
    // debug handle for automated checks (only with ?debug=1)
    if (isDebug()) {
      window.__role2 = {
        boardRover, leaveRover,
        setO2: (p) => astronaut.oxygen.debugSetPercent(p), dusk: () => getSolClock().jumpToDusk(),
        lookAt(d) { const v = new THREE.Vector3(d.x, d.y, d.z).normalize(); if (s?.walker) { s.walker.yaw = Math.atan2(-v.x, -v.z); s.walker.pitch = Math.asin(v.y); } },
        get fov() { return s?.camera.fov; }, get sol() { return solClock; },
        get dust() { return astronaut.dust; }, get marks() { return marks; }, get walker() { return s?.walker; }, get camera() { return s?.camera; },
        get cabin() { return s?.cabin; },
        // debug only: drive the rover n metres in steps (marks, dust and odometer follow), then park it
        driveMetres(n, steer = 0.4) { for (let m = 0; m < n; m += 0.1) { rover.update(0.05, { throttle: 1, steer }); astronaut.dust.accumulate(0.05, { speed: rover.speed, mode: 'drive' }); marks?.update({ mode: 'drive', rover }); } roverModel?.update(rover, 0); },
        walkMetres(n, yaw = 0) { for (let m = 0; m < n; m += 0.1) { s.walker.pos.x -= Math.sin(yaw) * 0.1; s.walker.pos.z -= Math.cos(yaw) * 0.1; s.walker.pos.y = getTerrainHeight(s.walker.pos.x, s.walker.pos.z); marks?.update({ mode: 'walk', walker: s.walker }); } }, get rover() { return rover; }, get driving() { return !!s?.driving; } };
    }
  },

  enter(state) {
    const inside = state === 'INTERIOR';
    const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 2e5);
    const hudLayer = document.createElement('div');
    hudLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    hudLayer.dataset.screen = state;
    ui.mount(hudLayer, { layer: 'hud' });
    hudLayer.style.pointerEvents = 'none'; // ui.mount enables clicks; the HUD must never block buttons under it
    s = { state, inside, camera, cabin: null, sinceTelemetry: 0, hud: createSuitHUD({ parent: hudLayer }), offs: [], notice: null };
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
        gravity: PLANETS.mars.g, getGroundHeight: getTerrainHeight, colliders: [{ x: 0, z: 0, r: LANDER_RADIUS }, roverCollider],
        mode: 'suit', start: { x: HATCH.x, z: HATCH.z + 2 }, yaw: Math.PI, // step out facing away from the ship
      });
      getRover();
      mars.scene.add(getMarks().object);
      mars.scene.add(roverModel.object); // only while we are outside (the shared Mars scene is also the landing view)
      roverModel.update(rover, 0);
      audio.play('ambience.mars', { loop: true });
      audio.play('suit.breath', { loop: true });
    }

    input.onPress('KeyE', () => (s?.driving ? leaveRover() : registry.press()));
    s.lockOnClick = () => input.lockPointer();
    window.addEventListener('click', s.lockOnClick);

    // Dev shortcuts (only with ?debug=1): O goes outside / back in, R starts the return (INTERIOR only).
    if (new URLSearchParams(location.search).get('debug') === '1') {
      input.onPress('KeyO', () => requestState(inside ? 'SURFACE' : 'INTERIOR'));
      if (inside) input.onPress('KeyR', () => requestState('RETURN'));
      else {
        input.onPress('KeyK', () => astronaut.oxygen.debugSetPercent(32)); // 30 % caution a few seconds later
        input.onPress('KeyN', () => getSolClock().jumpToDusk()); // nightfall
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
      s.roverPanelText = `LRV · ${rt.speedKmh.toFixed(1)} km/h · battery ${(rt.batteryFrac * 100).toFixed(0)} % · slope ${rt.pitchDeg.toFixed(0)}° / roll ${rt.rollDeg.toFixed(0)}° · ${rt.odometerKm.toFixed(2)} km`
        + (rt.overturned ? ' · OVERTURNED' : rt.slip > 0.15 ? ' · SLIDING' : !rt.onGround ? ' · AIRBORNE' : '');
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
      if (rover && !inside) {
        roverModel.update(rover, dt);
        roverSpot.x = roverCollider.x = rover.x;
        roverSpot.z = roverCollider.z = rover.z;
        roverSpot.y = rover.y + 1.0;
      }
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

    if (!inside) updateDusk(dt, k('KeyZ'));

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
      prebreathe: s.cabin?.prebreathe ?? null, dust: astronaut.dust.level,
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
        speed: s.driving ? rover.telemetry.speed : walker.telemetry.speed,
        heartRate: Math.round(walker.heartRate), radiationMsv: astronaut.body.doseMSv,
      });
    }
  },

  exit() {
    if (!s) return;
    previous = s.state;
    if (!s.inside && roverModel) { roverModel.object.removeFromParent(); marks?.object.removeFromParent(); }
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
