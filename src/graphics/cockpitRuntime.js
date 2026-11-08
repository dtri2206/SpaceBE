// Shared runtime of the cockpits (Role 3): live telemetry, the display canvases, the controls API (setControls / setButton / press /
// setTrajectory / setAim / setConjunction / setAlarm / onFrame) and the gloved hands (reach). flightDeck.js (Shuttle-style deck for the
// lifting-body and Starship cabins) and capsuleCockpit.js (one cabin per capsule) both call installControls() on their model, so every
// cockpit answers the same userData API.
import * as THREE from 'three';
import { events, getShip } from '/src/core/index.js';
import {
  drawAttitudePage, drawPropulsionPage, drawConjunctionPage, drawTrajectoryPage, normaliseAim, normaliseConjunction, normaliseTrajectory,
} from './cockpitScreens.js';

export const isSaturated = (c) => { const hi = Math.max(c.r, c.g, c.b), lo = Math.min(c.r, c.g, c.b); return hi > 0.05 && (hi - lo) / hi > 0.6; }; // red guards, yellow, lamps keep their colour
export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const clamp = (v, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export const live = {
  t: null, phase: 'ASCENT', altitude: null, speed: null, verticalSpeed: null, throttle: null, fuelKg: null,
  fuelMax: 0, fuelFrac: null, thrust: null, twr: null, isp: null, deltaVLeft: null, gForce: null, q: null,
  maxQ: null, engineTemp: null, history: [], pitch: null, roll: null, yaw: null, pitchRate: null, rollRate: null, yawRate: null,
};
// Static ship numbers fill thrust, TWR, Isp and delta-v until the first flight:telemetry arrives (live values then win).
export function applyShipFallback() {
  const stats = getShip()?.stats;
  if (!stats) return;
  live.fuelMax = stats.fuelMass || live.fuelMax || 0;
  live.thrust = stats.thrust ?? null;
  live.twr = stats.twrEarth ?? null;
  live.isp = stats.ispSL ?? null;
  live.deltaVLeft = stats.deltaV ?? null;
}

events.on('flight:telemetry', (p = {}) => {
  if (finite(p.t) && finite(live.t) && p.t < live.t - 1) live.history = [];
  for (const key of ['t', 'phase', 'altitude', 'speed', 'verticalSpeed', 'throttle', 'fuelKg', 'fuelMax', 'fuelFrac', 'thrust', 'twr', 'isp', 'deltaVLeft', 'gForce', 'q', 'maxQ', 'engineTemp', 'pitch', 'roll', 'yaw', 'pitchRate', 'rollRate', 'yawRate']) {
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
  Object.assign(live, { t: null, phase: 'ASCENT', altitude: null, speed: null, verticalSpeed: null, throttle: null, fuelKg: null, fuelFrac: null, history: [], pitch: null, roll: null, yaw: null, pitchRate: null, rollRate: null, yawRate: null });
  live.fuelMax = getShip()?.stats?.fuelMass || 0;
  applyShipFallback();
});

export function screenCanvas(mesh, width, height, draw) {
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

export function colourMaterial(object, colour, power = 1) {
  const mesh = object?.isMesh ? object : null;
  if (!mesh) return null;
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), toneMapped: false });
  mesh.material = mat;
  return mat;
}

const norm = (id) => String(id ?? '').toLowerCase().replace(/^btn:/, '');
const ease = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/**
 * Wire the cockpit API onto `group` for a loaded cockpit `model` (already added to group).
 * opts: panelNormal (direction the FLIGHT MODE caps press in, in the caps' parent frame), lights { cabinLight, alarmGlow, cabinBase },
 *       hands (true when the model has gloves and arm bones: see installHands).
 */
export function installControls(group, model, opts = {}) {
  const named = (name) => model.getObjectByName(name);
  const { cabinLight, alarmGlow, cabinBase = 2.6 } = opts.lights || {};
  const panelNormal = opts.panelNormal || new THREE.Vector3(0, 0, 1);
  const centre = named('centreDisplay');
  const left = named('displayLeft');
  const right = named('displayRight');
  let trajectory = null, aim = null, conjunction = null;
  let lastDraw = 0, lastFrame = performance.now(), alarm = false, alarmPhase = 0;
  const redraw = (now = performance.now(), force = false) => {
    if (!force && now - lastDraw < 100) return;
    lastDraw = now;
    left?.userData.redraw?.(); right?.userData.redraw?.();
    centre?.userData.redraw?.();
  };
  screenCanvas(left, 640, 640, (c, w, h) => drawPropulsionPage(c, w, h, live));
  screenCanvas(right, 640, 640, (c, w, h) => drawAttitudePage(c, w, h, live));
  screenCanvas(centre, 1024, 826, (c, w, h) => conjunction ? drawConjunctionPage(c, w, h, conjunction, { live }) : drawTrajectoryPage(c, w, h, trajectory, aim, { live, phase: String(live.phase || 'ASCENT').toUpperCase() }));

  // Give mutable meshes private materials; every cockpit gets independent lamps and switches.
  model.traverse((o) => {
    if (!o.isMesh || ['displayLeft', 'centreDisplay', 'displayRight'].includes(o.name)) return;
    if (/^(cutoffLamp|alarmLamp|tick\.?\d+|btnLamp)/.test(o.name) || ['assistCap', 'retroCap'].includes(o.name)) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    }
  });

  const stick = named('stick'), throttle = named('throttle');
  const stickBase = stick?.quaternion.clone(), throttleBase = throttle?.quaternion.clone();
  const cutoffGuard = named('cutoffGuard'), cutoffSwitch = named('cutoffSwitch');
  const guardBase = cutoffGuard?.quaternion.clone(), switchBase = cutoffSwitch?.quaternion.clone();
  const assistCap = named('assistCap');
  const retroCap = named('retroCap');
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
    const b = buttonMap.get(norm(id));
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
  const press = (id) => {
    const b = buttonMap.get(norm(id));
    if (!b) return false;
    b.press = 0;
    return true;
  };
  group.userData.press = press;
  group.userData.setTrajectory = (data) => {
    trajectory = data == null ? null : normaliseTrajectory(data);
    redraw(performance.now(), true);
  };
  group.userData.setAim = (data) => {
    aim = data == null ? null : normaliseAim(data);
    redraw(performance.now(), true);
  };
  group.userData.setConjunction = (data) => {
    conjunction = data == null ? null : normaliseConjunction(data);
    redraw(performance.now(), true);
  };
  group.userData.setAlarm = (on) => { alarm = !!on; };

  if (live.thrust === null || live.t === null) applyShipFallback(); // before the first telemetry only
  const _e = new THREE.Euler(), _q = new THREE.Quaternion();
  const extra = [];
  group.userData.onFrame = () => {
    const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const k = 1 - Math.exp(-12 * dt);
    controls.pitch += (controls.targetPitch - controls.pitch) * k;
    controls.yaw += (controls.targetYaw - controls.yaw) * k;
    controls.throttle += (controls.targetThrottle - controls.throttle) * k;
    if (stick) stick.quaternion.copy(stickBase).multiply(_q.setFromEuler(_e.set(controls.pitch * 0.26, controls.yaw * 0.2, -controls.yaw * 0.1)));
    if (throttle) throttle.quaternion.copy(throttleBase).multiply(_q.setFromEuler(_e.set(0.55 - controls.throttle * 1.1, 0, 0)));
    const lit = Math.round(controls.throttle * 10);
    ticks.forEach((tick, i) => { if (tick?.isMesh) tick.material.color.set(i < lit ? (i > 7 ? 0xffb41f : 0x3df07a) : 0x263238); });
    const guardGoal = controls.cutoff ? 1 : 0, swGoal = controls.cutoff ? 1 : 0;
    if (cutoffGuard) { cutoffGuard.userData.rx = (cutoffGuard.userData.rx || 0); cutoffGuard.userData.rx += (guardGoal * -1.9 - cutoffGuard.userData.rx) * (1 - Math.exp(-14 * dt)); cutoffGuard.quaternion.copy(guardBase).multiply(_q.setFromEuler(_e.set(cutoffGuard.userData.rx, 0, 0))); }
    if (cutoffSwitch) { cutoffSwitch.userData.rx = (cutoffSwitch.userData.rx || 0); cutoffSwitch.userData.rx += ((swGoal * 2 - 1) * 0.55 - cutoffSwitch.userData.rx) * (1 - Math.exp(-22 * dt)); cutoffSwitch.quaternion.copy(switchBase).multiply(_q.setFromEuler(_e.set(cutoffSwitch.userData.rx, 0, 0))); }
    controls.lockHold = Math.max(0, controls.lockHold - dt);
    const lockDown = controls.lock || controls.lockHold > 0;
    if (retroCap) retroCap.position.copy(retroBase).addScaledVector(panelNormal, lockDown ? -0.004 : 0);
    if (assistCap) assistCap.position.copy(assistBase).addScaledVector(panelNormal, controls.manual ? -0.004 : 0);
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
      if (alarmGlow) alarmGlow.intensity = alarm ? 3 * (0.5 + 0.5 * Math.sign(Math.sin(alarmPhase * 5))) : 0;
      if (cabinLight) cabinLight.intensity = alarm ? 0.35 : cabinBase;
      if (alarm !== shown.alarm) {
        shown.alarm = alarm;
        colourMaterial(alarmLamp, '#ff342c', alarm ? 0.35 : 0.06);
      }
      if (alarm && Math.sin(alarmPhase * 8) > 0) alarmLamp.material.color.setRGB(3, 0.2, 0.17);
      else if (alarm) alarmLamp.material.color.setRGB(0.35, 0.025, 0.02);
    }
    for (const fn of extra) fn(dt, now);
    redraw(now);
  };
  return { named, buttonMap, press, controls, addFrame: (fn) => extra.push(fn) };
}

// ------------------------------------------------------------------ gloved hands
const HAND_HOME = { out: 0.45, back: 0.4 };

/**
 * Hands: nodes gloveR / gloveL (children of stick / throttle: they follow setControls), wristR / wristL, shoulderR / shoulderL and the arm
 * bones armR_upper, armR_fore, armL_upper, armL_fore (bone meshes are built along their local -Z). Two-bone IK is solved every frame so the
 * sleeves always connect shoulder, elbow and glove. reach(id): the nearest glove leaves its controller, presses the button and returns.
 * Returns { reach, update } and sets group.userData.reach.
 */
export function installHands(group, model, ctrl, { tip } = {}) {
  const named = (n) => model.getObjectByName(n);
  const sides = {};
  for (const s of ['R', 'L']) {
    const glove = named(`glove${s}`), wrist = named(`wrist${s}`), shoulder = named(`shoulder${s}`);
    if (!glove || !wrist || !shoulder) continue;
    const controller = glove.parent;
    sides[s] = {
      glove, wrist, shoulder, controller, home: { p: glove.position.clone(), q: glove.quaternion.clone() },
      upper: named(`arm${s}_upper`), fore: named(`arm${s}_fore`), reach: null, sign: s === 'R' ? 1 : -1, tip: tip ? tip[s] : null,
    };
  }
  if (!Object.keys(sides).length) return null;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e2 = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
  const AXIS = new THREE.Vector3(0, 0, -1);
  const toGroup = (obj, out) => { obj.updateWorldMatrix(true, false); group.updateWorldMatrix(true, false); _inv.copy(group.matrixWorld).invert(); return out.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(_inv); };
  function solveArm(S) {
    if (!S.upper || !S.fore) return;
    toGroup(S.shoulder, _a); toGroup(S.wrist, _b);
    const l1 = S.upper.userData.len ?? (S.upper.userData.len = boneLength(S.upper, 0));
    const l2 = S.fore.userData.len ?? (S.fore.userData.len = boneLength(S.fore, 0.03));
    const d = _c.copy(_b).sub(_a);
    const dist = Math.min(d.length(), l1 + l2 - 1e-4);
    if (dist < 1e-4) return;
    d.normalize();
    const aa = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - aa * aa));
    // elbow pushed out to the side, down toward the couch and back toward the heat shield
    const pole = _d.set(S.sign * 0.6, -0.1, 0.9);
    pole.addScaledVector(d, -pole.dot(d));
    if (pole.lengthSq() < 1e-6) pole.set(0, 0, 1);
    pole.normalize();
    const el = _e2.copy(_a).addScaledVector(d, aa).addScaledVector(pole, h);
    S.upper.position.copy(_a);
    S.upper.quaternion.setFromUnitVectors(AXIS, _d.copy(el).sub(_a).normalize());
    S.fore.position.copy(el);
    S.fore.quaternion.setFromUnitVectors(AXIS, _d.copy(_b).sub(el).normalize());
  }
  function boneLength(node, trim) {
    let len = 0.3;
    node.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); len = Math.max(len === 0.3 ? 0 : len, -o.geometry.boundingBox.min.z); } });
    return Math.max(0.1, len - trim);
  }
  let active = null;
  function reach(id) {
    const b = ctrl.buttonMap.get(norm(id));
    if (!b) return 0;
    toGroup(b.cap, _a);
    const S = (_a.x >= 0 ? sides.R : sides.L) || sides.R || sides.L;
    if (!S) { ctrl.press(id); return 0; }
    // normal of the pad: cap local +z in the group frame
    b.cap.updateWorldMatrix(true, false);
    const nrm = new THREE.Vector3(0, 0, 1).transformDirection(b.cap.matrixWorld);
    group.updateWorldMatrix(true, false);
    nrm.transformDirection(_inv.copy(group.matrixWorld).invert());
    const target = _a.clone().addScaledVector(nrm, 0.014);
    // start from wherever the glove is now
    group.attach(S.glove);
    S.reach = { id, target, nrm, t: 0, phase: 'out', pressed: false, p0: S.glove.position.clone(), q0: S.glove.quaternion.clone() };
    active = S;
    return HAND_HOME.out;
  }
  // fingertip of the glove in its own frame (front of the fist): the part that touches the cap
  const TIP = new THREE.Vector3(0, -0.06, -0.115);
  const tipFor = (S) => S.tip || TIP;
  function stepReach(S, dt) {
    const r = S.reach;
    r.t += dt;
    if (r.phase === 'out') {
      const u = ease(r.t / HAND_HOME.out);
      // hand points at the button
      _q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), _a.copy(r.target).sub(r.p0).normalize());
      const qT = _q.clone().multiply(S.home.q);
      const qNow = r.q0.clone().slerp(qT, u);
      const posT = _b.copy(r.target).sub(_c.copy(tipFor(S)).applyQuaternion(qT));
      S.glove.quaternion.copy(qNow);
      S.glove.position.copy(r.p0).lerp(posT, u);
      if (r.t >= HAND_HOME.out) { ctrl.press(r.id); r.phase = 'back'; r.t = 0; r.pPress = S.glove.position.clone(); r.qPress = S.glove.quaternion.clone(); }
    } else {
      const u = ease(r.t / HAND_HOME.back);
      // the home pose is where the controller (which keeps moving) carries it
      S.controller.updateWorldMatrix(true, false);
      const hp = S.home.p.clone().applyMatrix4(S.controller.matrixWorld).applyMatrix4(_inv.copy(group.matrixWorld).invert());
      const hq = new THREE.Quaternion();
      S.controller.getWorldQuaternion(hq);
      group.getWorldQuaternion(_q); hq.premultiply(_q.clone().invert()).multiply(S.home.q);
      S.glove.position.copy(r.pPress).lerp(hp, u);
      S.glove.quaternion.copy(r.qPress).slerp(hq, u);
      if (r.t >= HAND_HOME.back) {
        S.controller.attach(S.glove);
        S.glove.position.copy(S.home.p); S.glove.quaternion.copy(S.home.q);
        S.reach = null;
      }
    }
  }
  function update(dt) {
    for (const S of Object.values(sides)) {
      if (S.reach) stepReach(S, dt);
      solveArm(S);
    }
  }
  ctrl.addFrame(update);
  group.userData.reach = reach;
  return { reach, update, sides };
}

// ------------------------------------------------------------------ procedural gloves for cockpits whose model has none (the Shuttle-style deck)
/**
 * Adds gloveR / gloveL (children of `stick` / `throttle`), wristR / wristL, shoulderR / shoulderL and the arm bones to a loaded model, using the
 * same node names and conventions as the capsule models, so installHands() drives them: the glove's local -Y is its finger direction and
 * its origin is the controller's pivot. `grip` = where the fist sits in the controller's local frame.
 */
export function addProceduralHands(model, { grips = {}, shoulders = {} } = {}) {
  const mats = {
    glove: new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.7 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x66665f, roughness: 0.85 }),
  };
  const box = (w, h, d, x, y, z, m = mats.glove) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
  const bone = (len, r0, r1, name) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 10).rotateX(-Math.PI / 2).translate(0, 0, -len / 2); // along local -Z
    const o = new THREE.Mesh(g, mats.suit); o.name = name; return o;
  };
  const defs = { R: ['stick', { x: 0, y: 0.33, z: 0 }, 0.24], L: ['throttle', { x: 0, y: 0.17, z: 0 }, -0.24] };
  let any = false;
  for (const [s, [ctlName, g0, sx]] of Object.entries(defs)) {
    const ctl = model.getObjectByName(ctlName);
    if (!ctl) continue;
    const g = grips[s] || g0;
    const glove = new THREE.Group(); glove.name = `glove${s}`;
    glove.add(box(0.09, 0.075, 0.1, g.x, g.y, g.z));
    for (let f = 0; f < 4; f++) glove.add(box(0.02, 0.07, 0.024, g.x + (f - 1.5) * 0.022, g.y - 0.05, g.z - 0.045));
    glove.add(box(0.026, 0.05, 0.03, g.x + (s === 'R' ? -0.05 : 0.05), g.y + 0.01, g.z - 0.02));
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.05, 12).rotateX(Math.PI / 2), mats.dark);
    cuff.position.set(g.x, g.y + 0.02, g.z + 0.09); glove.add(cuff);
    const wrist = new THREE.Object3D(); wrist.name = `wrist${s}`; wrist.position.set(g.x, g.y + 0.02, g.z + 0.085);
    glove.add(wrist);
    ctl.add(glove);
    const sh = new THREE.Object3D(); sh.name = `shoulder${s}`;
    const p = shoulders[s] || { x: sx, y: -0.27, z: 0.0 };
    sh.position.set(p.x, p.y, p.z);
    model.add(sh, bone(0.31, 0.055, 0.05, `arm${s}_upper`), bone(0.29, 0.05, 0.043, `arm${s}_fore`));
    any = true;
  }
  return any;
}
