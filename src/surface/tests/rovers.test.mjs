// Node tests for the two rovers (LRV + MR-01) and the MR-01 unlock. Run: node src/surface/tests/rovers.test.mjs
import assert from 'node:assert/strict';
import { RoverController, ROVER, ROVER_MR01 } from '../RoverController.js';
import { createMr01Unlock, MR01_LOCKED_PROMPT } from '../rovers.js';
import { PLANETS } from '../../core/planets.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const drive = (r, seconds, input, dt = 1 / 120) => { for (let t = 0; t < seconds; t += dt) r.update(dt, input); };
const gM = PLANETS.mars.g;

test('LRV stays at 3.6 m/s; MR-01 reaches about 5.5 m/s (20 km/h)', () => {
  const lrv = new RoverController({ gravity: gM });
  const mr = new RoverController({ gravity: gM, spec: ROVER_MR01 });
  drive(lrv, 25, { throttle: 1 });
  drive(mr, 40, { throttle: 1 });
  assert.ok(Math.abs(lrv.speed - 3.6) < 0.15, `lrv ${lrv.speed}`);
  assert.ok(Math.abs(mr.speed - 5.5) < 0.2, `mr01 ${mr.speed}`);
  assert.ok(mr.telemetry.speedKmh > 19 && mr.telemetry.speedKmh < 21);
  assert.equal(lrv.telemetry.name, 'LRV');
  assert.equal(mr.telemetry.name, 'MR-01');
});

test('battery sizes: LRV 8.7 kWh, MR-01 30 kWh, fractions follow each spec', () => {
  const lrv = new RoverController({ gravity: gM });
  const mr = new RoverController({ gravity: gM, spec: ROVER_MR01 });
  assert.equal(lrv.batteryWh, 8700);
  assert.equal(mr.batteryWh, 30000);
  drive(lrv, 30, { throttle: 1 });
  drive(mr, 30, { throttle: 1 });
  assert.ok(lrv.batteryFrac < 1 && mr.batteryFrac < 1);
  assert.ok(mr.batteryWh < 30000 && 1 - mr.batteryFrac < 1 - lrv.batteryFrac, 'bigger battery drains slower in fraction');
});

test('MR-01 turns and stops like a rover (wheelbase/track shared with the LRV)', () => {
  assert.equal(ROVER_MR01.wheelbase, ROVER.wheelbase);
  assert.equal(ROVER_MR01.track, ROVER.track);
  const mr = new RoverController({ gravity: gM, spec: ROVER_MR01 });
  drive(mr, 20, { throttle: 1, steer: 1 });
  assert.ok(Math.abs(mr.heading) > 0.5);
  drive(mr, 20, { brake: true });
  assert.equal(mr.speed, 0);
});

test('unlock: locked below 50 %, unlocks once at >= 50 %, notice fires once', () => {
  let calls = 0;
  const u = createMr01Unlock({ onUnlock: () => calls++ });
  assert.equal(u.setPercent(0), false);
  assert.equal(u.setPercent(49.9), false);
  assert.equal(u.unlocked, false);
  assert.equal(u.takeNotice(), false);
  assert.equal(u.setPercent(50), true);
  assert.equal(u.unlocked, true);
  assert.equal(u.setPercent(80), false);
  assert.equal(calls, 1);
  assert.equal(u.takeNotice(), true);
  assert.equal(u.takeNotice(), false);
  u.setPercent(20); // progress never re-locks within a mission
  assert.equal(u.unlocked, true);
  assert.equal(u.setPercent('junk'), false);
  assert.match(MR01_LOCKED_PROMPT, /50%/);
});

test('unlock: reset per mission re-locks; debug unlock works and fires once', () => {
  let calls = 0;
  const u = createMr01Unlock({ onUnlock: () => calls++ });
  assert.equal(u.debugUnlock(), true);
  assert.equal(u.debugUnlock(), false);
  assert.equal(calls, 1);
  u.reset();
  assert.equal(u.unlocked, false);
  assert.equal(u.takeNotice(), false);
  u.setPercent(100);
  assert.equal(u.unlocked, true);
  assert.equal(calls, 2);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ok  ' : '  FAIL', r[1], r[2] ? `\n${r[2].stack}` : '');
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
