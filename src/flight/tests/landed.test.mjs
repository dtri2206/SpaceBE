// Landed ships stay landed: engine off after touchdown, autopilot never lifts off again. Run: node src/flight/tests/landed.test.mjs
import assert from 'node:assert/strict';
import { FlightController as RawFC } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { createAutopilot } from '../autopilot.js';
import { ascentGuide } from '../flightAssist.js';
import { approachBack, computeCorridor } from '../corridor.js';
import { dot } from '../vec.js';

const FRAME = 1 / 60;
const mk = (o) => new RawFC({ g0: G0, planets: PLANETS, ...o });
const results = [];
function test(name, fn) {
  try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); }
}
const tiltDeg = (fc) => (Math.acos(Math.max(-1, Math.min(1, dot(fc.forward, fc.up)))) * 180) / Math.PI;

test('Mars landing by the autopilot: stays landed, engine off, for 120 s after touchdown', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel: 5000 });
  approachBack(fc, 40);
  const corridor = computeCorridor(fc);
  const ap = createAutopilot();
  let frames = 0;
  while (!fc.failed && !fc.landed && frames < 60 * 900) { fc.update(FRAME, ap.update(fc, { corridor }), { timeWarp: 1 }); frames++; }
  assert.equal(fc.landed, true);
  fc.update(FRAME, ap.update(fc, { corridor }), { timeWarp: 1 });
  const fuel = fc.fuel;
  for (let f = 0; f < 60 * 120; f++) {
    const input = ap.update(fc, { corridor });
    assert.equal(ascentGuide(fc) === null || ap.status.step === 'landed', true);
    fc.update(FRAME, input, { timeWarp: 1 });
    assert.equal(fc.landed, true, `lifted off at +${(f * FRAME).toFixed(1)} s`);
  }
  assert.equal(fc.onGround, true);
  assert.equal(fc.throttle, 0);
  assert.equal(fc.engineLit, false);
  assert.equal(fc.phase, 'landed');
  assert.ok(Math.abs(fc.altitude) < 0.01);
  assert.equal(fc.fuel, fuel);
  assert.equal(ap.status.step, 'landed');
  assert.ok(tiltDeg(fc) <= 5, `tilt ${tiltDeg(fc)}`);
});

test('touchdown with throttle 0.4 left on: engine is off right away, and stays off', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, planetId: 'mars', start: { altitude: 0.03, speed: 2.8, flightPathDeg: -90, facing: 'up' }, fuel: 100 });
  fc.throttle = 0.4; fc.engineLit = true;
  for (let i = 0; i < 120 && !fc.landed && !fc.failed; i++) fc.update(FRAME, {}, { timeWarp: 1 });
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  assert.equal(fc.landed, true);
  assert.equal(fc.throttle, 0);
  assert.equal(fc.engineLit, false);
  for (let i = 0; i < 300; i++) fc.update(FRAME, { throttleTarget: 1, throttleUp: true }, { timeWarp: 1 });
  assert.equal(fc.landed, true);
  assert.equal(fc.throttle, 0);
});

test('a ship that lands tilted is stood upright within ~1 s', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, planetId: 'mars', start: { altitude: 0.3, speed: 1, flightPathDeg: -90, facing: 'up' }, fuel: 100 });
  const a = (15 * Math.PI) / 180;
  fc.orient = { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }; // rolled 15° about X
  for (let i = 0; i < 120 && !fc.landed && !fc.failed; i++) fc.update(FRAME, {}, { timeWarp: 1 });
  assert.equal(fc.landed, true, JSON.stringify(fc.failed));
  assert.ok(tiltDeg(fc) > 1, `starting tilt ${tiltDeg(fc)}`);
  for (let i = 0; i < 90; i++) fc.update(FRAME, {}, { timeWarp: 1 });
  assert.ok(tiltDeg(fc) <= 1, `tilt ${tiltDeg(fc)}`);
});

let failed = 0;
for (const [status, name, e] of results) {
  console.log(`${status === 'ok' ? 'ok  ' : 'FAIL'} ${name}`);
  if (e) { failed++; console.log(e); }
}
if (failed) process.exit(1);
