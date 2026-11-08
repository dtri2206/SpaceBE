import assert from 'node:assert/strict';
import test from 'node:test';
import { ascentGuide } from '../flightAssist.js';
import { FlightController } from '../FlightController.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { createSteeringDisplay, createGuidanceReference, steeringReadout, steeringHint, copyForPrediction } from '../steering.js';
import { qFromTo, qFromAxisAngle, qMul, v3, dot } from '../vec.js';

const controller = (planetId = 'earth', start = { altitude: 12000, speed: 250, flightPathDeg: 70 }) => new FlightController({ planets: PLANETS, g0: G0, planetId, shipSpec: MOCK_SHIPS.reliable, start });
const serial = (fc) => Object.fromEntries(Object.entries(fc).filter(([key]) => !['bus', 'onNotice', 'rng'].includes(key)));

test('predicted and guidance lines share bounded finite coordinates and a correctly oriented ship', () => {
  const fc = controller();
  fc.orient = qFromTo(v3(0, 1, 0), fc.up);
  const data = steeringReadout(fc);
  for (const line of [data.planned, data.predicted]) {
    assert.ok(line.length > 2);
    assert.ok(line.flat().every((n) => Number.isFinite(n) && n >= 0 && n <= 1));
    assert.deepEqual(line[0], [data.ship.x, data.ship.y]);
  }
  assert.ok(Math.abs(data.ship.heading - Math.PI / 2) < 1e-8);
  fc.orient = qFromTo(v3(0, 1, 0), v3(1, 0, 0));
  const horizontal = steeringReadout(fc);
  assert.ok(Math.abs(horizontal.ship.heading) < 1e-8);
});

test('forecast applies held throttle, pitch, brake, fuel and drag with no live mutation or events', () => {
  const fc = controller();
  let emissions = 0, randomCalls = 0;
  fc.bus = { emit() { emissions++; } }; fc.rng = () => { randomCalls++; return .2; };
  fc.obstacles = [{ id: 'far', pos: { x: 1e8, y: 1e8, z: 0 }, vel: v3(), radius: 1 }];
  const before = structuredClone(serial(fc));
  const coast = steeringReadout(fc, { cutoff: true });
  const power = steeringReadout(fc, { throttleUp: true });
  const turn = steeringReadout(fc, { throttleUp: true, pitch: -1 });
  const brake = steeringReadout(fc, { brake: true });
  assert.notDeepEqual(power.predicted, coast.predicted);
  assert.notDeepEqual(power.predicted, turn.predicted);
  assert.notDeepEqual(brake.predicted, coast.predicted);
  assert.deepEqual(serial(fc), before); assert.equal(emissions, 0); assert.equal(randomCalls, 0);
  assert.deepEqual(steeringReadout(fc, { throttleUp: true }), power, 'forecast is deterministic');
});

test('a nose off its gravity-turn target gets an AUTO correcting hint (the computer steers)', () => {
  const fc = controller('earth', { altitude: 18000, speed: 300, flightPathDeg: 70 });
  const roll = qFromAxisAngle(v3(0, 1, 0), -Math.PI / 2);
  fc.orient = roll;
  assert.match(steeringHint(fc).text, /^AUTO · correcting/);
  fc.orient = qMul(qFromAxisAngle(v3(0, 0, 1), -Math.PI / 2), roll);
  assert.match(steeringHint(fc).text, /^AUTO · correcting/);
  assert.match(steeringHint(fc, { manualOffer: true }).text, /press F/);
});

test('orbit, entry and landing provide valid short-horizon guidance with phase-specific hints', () => {
  const radius = PLANETS.earth.radius + 200000;
  const orbit = controller('earth', { altitude: 200000, speed: Math.sqrt(PLANETS.earth.g * PLANETS.earth.radius ** 2 / radius), flightPathDeg: 0 });
  orbit.phase = 'orbit';
  const entry = controller('mars', STARTS.marsEntry);
  const landing = controller('mars', STARTS.marsLanding);
  for (const fc of [orbit, entry, landing]) {
    const data = steeringReadout(fc);
    assert.ok(data.planned.length > 1 && data.predicted.length > 1);
    assert.ok(data.planned.flat().every(Number.isFinite)); assert.ok(data.hint.text.length < 40);
  }
  assert.match(steeringHint(orbit).text, /Orbit · T = transfer burn/);
  entry.setStart({ ...STARTS.marsEntry, altitude: 130000 });
  assert.match(steeringHint(entry, { corridor: { centreDeg: -55, steepDeg: -60, shallowDeg: -50 } }).text, /trimming entry angle/);
  assert.match(steeringHint(entry, { corridor: { centreDeg: -5, steepDeg: -10, shallowDeg: 0 } }).text, /trimming entry angle/);
});

test('bad data returns null; ground and zero velocity produce finite geometry', () => {
  assert.equal(steeringReadout(null), null);
  const fc = controller('earth', 'pad'); assert.ok(steeringReadout(fc));
  fc.pos.x = NaN; assert.equal(steeringReadout(fc), null);
});

test('monitor availability controls fallback and resets the old cockpit, F off and exit', () => {
  const aCalls = [], bCalls = [], data = { planned: [], predicted: [] };
  const a = { userData: { setTrajectory: (d) => aCalls.push(d) } };
  const b = { userData: { setTrajectory: (d) => bCalls.push(d) } };
  const display = createSteeringDisplay();
  assert.deepEqual(display.update(a, true, () => data, 0), { monitor: true, fallback: false });
  display.update(a, true, () => { throw Error('throttled'); }, .1);
  assert.equal(aCalls.length, 1);
  assert.deepEqual(display.update(b, true, () => data, .2), { monitor: true, fallback: false });
  assert.equal(aCalls.at(-1), null);
  assert.deepEqual(display.update(b, false, () => data, .3), { monitor: false, fallback: false });
  assert.equal(bCalls.at(-1), null);
  display.update(a, true, () => data, .4); display.dispose(); assert.equal(aCalls.at(-1), null);
  assert.deepEqual(display.update({}, true, () => data, 1), { monitor: false, fallback: true });
  assert.deepEqual(display.update({ userData: { setTrajectory() { throw Error('old cockpit'); } } }, true, () => data, 2), { monitor: false, fallback: true });
});

test('entry reference follows interface trim instead of a Mars ascent or current-angle correction', () => {
  const fc = controller('mars', { altitude: 130000, speed: 1400, flightPathDeg: -26 });
  const corridor = { centreDeg: -55, steepDeg: -60, shallowDeg: -50 };
  const data = steeringReadout(fc, { trim: -1 }, { corridor });
  assert.match(data.hint.text, /trimming entry angle/);
  assert.deepEqual(data.planned, data.predicted, 'reference applies same steeper-entry trim the hint announces');
});

test('monitor mode hides steering symbols and reticle; collision warning remains independent', async () => {
  const { createFlightHUD } = await import('../hud/createFlightHUD.js');
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.selectors = new Map(); this.children = []; }
    set innerHTML(html) {
      this.fields = [...html.matchAll(/data-id="([^"]+)"/g)].map((match) => { const el = new Element(); el.dataset.id = match[1]; return el; });
    }
    querySelectorAll() { return this.fields; }
    querySelector(key) { if (!this.selectors.has(key)) this.selectors.set(key, new Element()); return this.selectors.get(key); }
    append(...children) { this.children.push(...children); }
  }
  const old = globalThis.document;
  globalThis.document = { createElement: () => new Element(), body: new Element() };
  try {
    const hud = createFlightHUD();
    for (const kind of ['pro', 'retro', 'guide', 'collision']) hud.marker(kind, { x: 50, y: 50 });
    hud.setSteeringVisible(false);
    for (const kind of ['pro', 'retro', 'guide', 'reticle']) assert.equal(hud.root.querySelector(`.${kind}`).style.display, 'none');
    assert.equal(hud.root.querySelector('.collision').style.display, 'block');
    hud.setSteeringVisible(true); hud.marker('guide', { x: 30, y: 40 });
    assert.equal(hud.root.querySelector('.guide').style.display, 'block');
    assert.equal(hud.root.querySelector('.reticle').style.display, 'block');
  } finally { globalThis.document = old; }
});

test('both throttle directions and W/S change the cyan rollout with live controls isolated', () => {
  const fc = controller(); fc.throttle = .6; fc.engineLit = true;
  fc.orient = qFromAxisAngle(v3(0, 1, 0), -Math.PI / 2);
  const before = structuredClone(serial(fc));
  const up = steeringReadout(fc, { throttleUp: true });
  const down = steeringReadout(fc, { throttleDown: true });
  const w = steeringReadout(fc, { pitch: -1 });
  const s = steeringReadout(fc, { pitch: 1 });
  assert.notDeepEqual(up.predicted, down.predicted);
  assert.notDeepEqual(w.predicted, s.predicted);
  assert.deepEqual(serial(fc), before);
});

test('the aim input the computer sends reduces real-controller pointing error', () => {
  const roll = qFromAxisAngle(v3(0, 1, 0), -Math.PI / 2);
  for (const orientation of [roll, qMul(qFromAxisAngle(v3(0, 0, 1), -Math.PI / 2), roll)]) {
    const fc = controller('earth', { altitude: 18000, speed: 300, flightPathDeg: 70 });
    fc.orient = orientation;
    const target = ascentGuide(fc).direction;
    const before = dot(fc.forward, target);
    const copy = copyForPrediction(fc);
    for (let n = 0; n < 5; n++) copy.update(.1, { aim: target });
    assert.ok(dot(copy.forward, target) > before);
  }
});

test('persistent reference cannot follow a displaced ship; UI switches and F retain that reference', () => {
  const fc = controller('earth', 'pad');
  const plan = createGuidanceReference();
  const display = createSteeringDisplay();
  const a = { userData: { setTrajectory() {} } }, b = { userData: { setTrajectory() {} } };
  const initial = plan.readout(fc, {});
  assert.deepEqual(initial.planned[0], [initial.ship.x, initial.ship.y]);
  display.update(a, true, () => plan.readout(fc, {}), 0);
  display.update(a, false, () => { throw Error('F off must not rebuild the reference'); }, 1);
  fc.pos.y += 10000; // Deliberate pilot deviation; elapsed time and reference stay fixed.
  fc.onGround = false; fc.phase = 'ascent';
  fc.orient = qFromTo(v3(0, 1, 0), ascentGuide(fc).direction); // Attitude alone is on target.
  const displaced = plan.readout(fc, {});
  assert.notDeepEqual(displaced.planned[0], [displaced.ship.x, displaced.ship.y]);
  assert.equal(displaced.hint.level, 'warn');
  assert.match(displaced.hint.text, /Off track/);
  let afterSwitch;
  display.update(b, true, () => (afterSwitch = plan.readout(fc, {})), 2);
  assert.deepEqual(afterSwitch.planned, displaced.planned);
  assert.equal(afterSwitch.hint.level, 'warn');
});

test('manual hint wins over every other hint and follows lockReady', () => {
  const fc = controller('earth', { altitude: 18000, speed: 300, flightPathDeg: 70 });
  const fly = steeringHint(fc, { manualOffer: true, manual: { lockReady: false } });
  assert.deepEqual(fly, { text: 'MANUAL · keep ○ on +', level: 'warn' });
  const lock = steeringHint(fc, { manualOffer: true, countdown: true, manual: { lockReady: true } });
  assert.deepEqual(lock, { text: 'LOCK READY · SPACE or CLICK', level: 'ok' });
  assert.deepEqual(steeringHint(fc, { manual: { free: true } }), { text: 'MANUAL · F gives it back', level: 'ok' });
  assert.match(steeringHint(fc, { manual: null }).text, /^AUTO/);
  const ro = steeringReadout(fc, {}, { manual: { lockReady: true } });
  if (ro) assert.equal(ro.hint.text, 'LOCK READY · SPACE or CLICK');
});
