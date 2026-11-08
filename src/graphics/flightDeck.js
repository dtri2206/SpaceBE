import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { events, getShip } from '/src/core/index.js';
import {
  drawAttitudePage, drawPropulsionPage, drawTrajectoryPage, normaliseAim, normaliseTrajectory,
} from './cockpitScreens.js';

const URL = '/assets/models/flightdeck.glb';
const DECK_ALBEDO = 0.2; // see loadDeck
const loader = new GLTFLoader();
let deckTemplate = null;
let deckLoad = null;
const live = {
  t: null, phase: 'ASCENT', altitude: null, speed: null, verticalSpeed: null, throttle: null, fuelKg: null,
  fuelMax: 0, fuelFrac: null, thrust: null, twr: null, isp: null, deltaVLeft: null, gForce: null, q: null,
  maxQ: null, engineTemp: null, history: [], pitch: null, roll: null, yaw: null,
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

function loadDeck() {
  if (!deckLoad) {
    deckLoad = loader.loadAsync(URL).then(({ scene }) => {
      scene.name = 'flightdeck:v3.1';
      // The pad's sun and sky lights are strong, so the light grey deck washed out to white and the ceiling fixtures bloomed.
      // Darken the unlit-colour materials a little and cap emissive glow, so the deck keeps the contrast of the Blender renders.
      const seen = new Set();
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || seen.has(m)) continue;
          seen.add(m);
          if (m.name === 'fixture') m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.35);
          else if (m.name === 'label2') m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.8);
          else if (m.isMeshStandardMaterial && m.emissive.getHex() === 0 && !m.transparent && m.metalness < 0.3 && !/^fabric/.test(m.name)) m.color.multiplyScalar(DECK_ALBEDO);
        }
      });
      deckTemplate = scene;
      return scene;
    }).catch((err) => {
      console.error('[flightdeck] model failed to load; keeping procedural cockpit', err);
      return null;
    });
  }
  return deckLoad;
}

events.on('flight:telemetry', (p = {}) => {
  if (finite(p.t) && finite(live.t) && p.t < live.t - 1) live.history = [];
  for (const key of ['t', 'phase', 'altitude', 'speed', 'verticalSpeed', 'throttle', 'fuelKg', 'fuelMax', 'fuelFrac', 'thrust', 'twr', 'isp', 'deltaVLeft', 'gForce', 'q', 'maxQ', 'engineTemp', 'pitch', 'roll', 'yaw']) {
    if (p[key] !== undefined) live[key] = p[key];
  }
  if (live.fuelMax > 0 && finite(live.fuelKg)) live.fuelFrac = clamp(live.fuelKg / live.fuelMax, 0, 1);
  if (finite(live.altitude)) {
    live.history.push(live.altitude);
    if (live.history.length > 240) live.history.shift();
  }
});
events.on('state:changed', ({ to }) => {
  if (to !== 'LAUNCH') return;
  Object.assign(live, { t: null, phase: 'ASCENT', altitude: null, speed: null, verticalSpeed: null, throttle: null, fuelKg: null, fuelFrac: null, history: [] });
  live.fuelMax = getShip()?.stats?.fuelMass || 0;
});

// Start loading during boot, while the player is in the menu or hangar.
if (typeof window !== 'undefined') loadDeck();

function screenCanvas(mesh, width, height, draw) {
  if (!mesh?.isMesh) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // The GLB exporter has already converted the UV origin for glTF; CanvasTexture's
  // default vertical flip would turn every display page upside down on these quads.
  texture.flipY = false;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide });
  mesh.material = material;
  mesh.userData.canvas = canvas;
  mesh.userData.redraw = () => {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
    texture.needsUpdate = true;
  };
  mesh.userData.redraw();
  return mesh;
}

function colourMaterial(object, colour, power = 1) {
  const mesh = object?.isMesh ? object : null;
  if (!mesh) return null;
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), toneMapped: false });
  mesh.material = mat;
  return mat;
}

function installDeck(group) {
  if (!deckTemplate) return false;
  const model = deckTemplate.clone(true);
  model.name = 'flightdeck:v3.1';
  group.clear();
  group.add(model);
  group.userData.triangles = 56500;

  const named = (name) => model.getObjectByName(name);
  const cabinLight = new THREE.PointLight(0xfff0e2, 2.6, 5, 1.6);
  cabinLight.position.set(0, 0.45, 0.05);
  const screenLight = new THREE.PointLight(0x67e8f9, 0.22, 2, 2);
  screenLight.position.set(0, -0.2, -0.62);
  const alarmGlow = new THREE.PointLight(0xff2a1f, 0, 5, 2);
  alarmGlow.position.set(0, 0.75, -0.4);
  group.add(cabinLight, screenLight, alarmGlow);
  const centre = named('centreDisplay');
  const left = named('displayLeft');
  const right = named('displayRight');
  let trajectory = null, aim = null;
  let lastDraw = 0, lastFrame = performance.now(), alarm = false, alarmPhase = 0;
  const redraw = (now = performance.now(), force = false) => {
    if (!force && now - lastDraw < 100) return;
    lastDraw = now;
    left?.userData.redraw?.(); right?.userData.redraw?.();
    centre?.userData.redraw?.();
  };
  screenCanvas(left, 640, 640, (c, w, h) => drawPropulsionPage(c, w, h, live));
  screenCanvas(right, 640, 640, (c, w, h) => drawAttitudePage(c, w, h, live));
  screenCanvas(centre, 1024, 826, (c, w, h) => drawTrajectoryPage(c, w, h, trajectory, aim, { live, phase: String(live.phase || 'ASCENT').toUpperCase() }));

  // Give mutable meshes private materials; every cockpit gets independent lamps and switches.
  model.traverse((o) => {
    if (!o.isMesh || ['displayLeft', 'centreDisplay', 'displayRight'].includes(o.name)) return;
    if (/^(cutoffLamp|alarmLamp|tick\.?\d+|btnLamp)/.test(o.name) || ['assistCap', 'retroCap'].includes(o.name)) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    }
  });

  const stick = named('stick'), throttle = named('throttle');
  const cutoffGuard = named('cutoffGuard'), cutoffSwitch = named('cutoffSwitch');
  const assistCap = named('assistCap');
  const retroCap = named('retroCap');
  // FLIGHT MODE sits on the tilted instrument panel (17 deg): its caps press in along the panel normal, not along world y.
const PANEL_NORMAL = new THREE.Vector3(0, Math.sin(0.2967), Math.cos(0.2967));
const assistBase = assistCap?.position.clone(), retroBase = retroCap?.position.clone();
  const cutoffLamp = named('cutoffLamp'), alarmLamp = named('alarmLamp');
  const ticks = Array.from({ length: 10 }, (_, i) => named(`tick${i}`));
  const controls = { pitch: 0, yaw: 0, throttle: 0, targetPitch: 0, targetYaw: 0, targetThrottle: 0, cutoff: false, lock: false, manual: false, lockHold: 0 };
  const buttonMap = new Map();
  // GLTFLoader strips '.', ':' and brackets from node names: 'btn:hatch' arrives as 'btnhatch', 'btnCap.hatch' as 'btnCaphatch'.
  model.traverse((o) => {
    const m = /^btn(?!Cap|Lamp)(.+)$/.exec(o.name);
    if (!m) return;
    const id = m[1];
    const cap = named(`btnCap${id}`), lamp = named(`btnLamp${id}`);
    if (cap && lamp) buttonMap.set(id, { cap, lamp, originalZ: cap.position.z, press: -1 });
  });
  const setLamp = (b, state) => {
    const colors = { off: 0x1b2630, amber: 0xffb41f, green: 0x3df07a, red: 0xff4d3d };
    if (!b || colors[state] === undefined) return;
    const mat = b.lamp.material;
    mat.color.set(colors[state]);
    if (mat.emissive) { mat.emissive.set(state === 'off' ? 0x000000 : colors[state]); mat.emissiveIntensity = state === 'off' ? 0 : 1.6; }
  };
  const shown = { cutoff: false, lock: false, manual: false };
  const setButton = (id, state) => {
    const key = String(id ?? '').toLowerCase().replace(/^btn:/, '');
    const b = buttonMap.get(key);
    if (!b || !['off', 'amber', 'green', 'red'].includes(state)) return false;
    b.state = state;
    setLamp(b, state);
    return true;
  };
  group.userData.setControls = ({ pitch, yaw, throttle: thr, cutoff, brake, assist } = {}) => {
    if (pitch !== undefined) controls.targetPitch = clamp(pitch, -1, 1);
    if (yaw !== undefined) controls.targetYaw = clamp(yaw, -1, 1);
    if (thr !== undefined) { controls.targetThrottle = clamp(thr, 0, 1); live.throttle = controls.targetThrottle; }
    if (cutoff !== undefined) controls.cutoff = !!cutoff;
    if (brake !== undefined) { controls.lock = !!brake; if (brake) controls.lockHold = 0.3; }
    if (assist !== undefined) controls.manual = !!assist;
  };
  group.userData.setButton = setButton;
  group.userData.press = (id) => {
    const b = buttonMap.get(String(id ?? '').toLowerCase().replace(/^btn:/, ''));
    if (!b) return false;
    b.press = 0;
    return true;
  };
  group.userData.setTrajectory = (data) => {
    trajectory = data == null ? null : normaliseTrajectory(data);
    redraw(performance.now(), true);
  };
  group.userData.setAim = (data) => {
    aim = data == null ? null : normaliseAim(data);
    redraw(performance.now(), true);
  };
  group.userData.setAlarm = (on) => { alarm = !!on; };

  if (getShip()?.stats) {
    const stats = getShip().stats;
    live.fuelMax = stats.fuelMass || 0;
    live.thrust = stats.thrust ?? null;
    live.twr = stats.twrEarth ?? null;
    live.isp = stats.ispSL ?? null;
    live.deltaVLeft = stats.deltaV ?? null;
  }
  group.userData.onFrame = () => {
    const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const k = 1 - Math.exp(-12 * dt);
    controls.pitch += (controls.targetPitch - controls.pitch) * k;
    controls.yaw += (controls.targetYaw - controls.yaw) * k;
    controls.throttle += (controls.targetThrottle - controls.throttle) * k;
    if (stick) stick.rotation.set(controls.pitch * 0.26, controls.yaw * 0.2, -controls.yaw * 0.1);
    if (throttle) throttle.rotation.x = 0.55 - controls.throttle * 1.1;
    const lit = Math.round(controls.throttle * 10);
    ticks.forEach((tick, i) => { if (tick?.isMesh) tick.material.color.set(i < lit ? (i > 7 ? 0xffb41f : 0x3df07a) : 0x263238); });
    const guardGoal = controls.cutoff ? 1 : 0, swGoal = controls.cutoff ? 1 : 0;
    cutoffGuard && (cutoffGuard.rotation.x += (guardGoal * -1.9 - cutoffGuard.rotation.x) * (1 - Math.exp(-14 * dt)));
    cutoffSwitch && (cutoffSwitch.rotation.x += ((swGoal * 2 - 1) * 0.55 - cutoffSwitch.rotation.x) * (1 - Math.exp(-22 * dt)));
    controls.lockHold = Math.max(0, controls.lockHold - dt);
    const lockDown = controls.lock || controls.lockHold > 0;
    if (retroCap) retroCap.position.copy(retroBase).addScaledVector(PANEL_NORMAL, lockDown ? -0.004 : 0);
    if (assistCap) assistCap.position.copy(assistBase).addScaledVector(PANEL_NORMAL, controls.manual ? -0.004 : 0);
    if (cutoffLamp && shown.cutoff !== controls.cutoff) { shown.cutoff = controls.cutoff; colourMaterial(cutoffLamp, '#f87171', controls.cutoff ? 1.5 : 0.16); }
    if (retroCap && shown.lock !== lockDown) { shown.lock = lockDown; colourMaterial(retroCap, '#fbbf24', lockDown ? 1.3 : 0.3); }
    if (assistCap && shown.manual !== controls.manual) { shown.manual = controls.manual; colourMaterial(assistCap, '#22d3ee', controls.manual ? 1.3 : 0.3); }
    for (const b of buttonMap.values()) {
      if (b.press < 0) continue;
      b.press += dt;
      const u = b.press / 0.15;
      const depth = u >= 2 ? 0 : u < 1 ? u : 2 - u;
      b.cap.position.z = b.originalZ - 0.005 * depth;
      if (u >= 2) b.press = -1;
    }
    if (alarmLamp?.isMesh) {
      alarmPhase += dt;
      alarmGlow.intensity = alarm ? 3 * (0.5 + 0.5 * Math.sign(Math.sin(alarmPhase * 5))) : 0;
      cabinLight.intensity = alarm ? 0.35 : 2.6;
      if (alarm !== shown.alarm) {
        shown.alarm = alarm;
        colourMaterial(alarmLamp, '#ff342c', alarm ? 0.35 : 0.06);
      }
      if (alarm && Math.sin(alarmPhase * 8) > 0) alarmLamp.material.color.setRGB(3, 0.2, 0.17);
      else if (alarm) alarmLamp.material.color.setRGB(0.35, 0.025, 0.02);
    }
    redraw(now);
  };
  return true;
}

/** Preserve the old cockpit as a fallback while the GLB loads; hot-swap the model as soon as it is ready. */
export function createFlightDeck(createFallback) {
  const group = deckTemplate ? new THREE.Group() : createFallback();
  group.name = 'cockpit';
  const oldFrame = group.userData.onFrame;
  let installed = false;
  const install = () => {
    if (installed || !deckTemplate) return;
    installed = installDeck(group);
  };
  if (deckTemplate) {
    install();
    return group;
  }
  loadDeck().then(install);
  group.userData.onFrame = (...args) => {
    install();
    if (!installed) oldFrame?.(...args);
  };
  return group;
}
