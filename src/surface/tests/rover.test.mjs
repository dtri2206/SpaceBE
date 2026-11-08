// Node tests for the Mars rover. Run: node src/surface/tests/rover.test.mjs
import assert from 'node:assert/strict';
import { RoverController, ROVER } from '../RoverController.js';
import { PLANETS } from '../../core/planets.js';

const gM = PLANETS.mars.g, gE = PLANETS.earth.g;
const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const drive = (r, seconds, input, dt = 1 / 120) => { for (let t = 0; t < seconds; t += dt) r.update(dt, input); };

test('flat ground, full throttle: reaches the LRV design speed (≈13 km/h) and the governor holds it', () => {
  const r = new RoverController({ gravity: gM });
  drive(r, 20, { throttle: 1 });
  assert.ok(Math.abs(r.speed - ROVER.topSpeed) < 0.15, `speed ${r.speed.toFixed(2)} m/s`);
});

test('driving up a 15° slope is slower than on the flat (power-limited), and gravity pulls it back when stopped', () => {
  const slope = Math.tan((15 * Math.PI) / 180);
  const up = new RoverController({ gravity: gM, getGroundHeight: (x, z) => -z * slope }); // heading 0 drives toward −z = uphill
  drive(up, 20, { throttle: 1 });
  assert.ok(up.speed > 0.3 && up.speed < ROVER.topSpeed - 0.5, `uphill speed ${up.speed.toFixed(2)}`);
  assert.ok(up.telemetry.pitchDeg > 14 && up.telemetry.pitchDeg < 16);
  drive(up, 5, {});
  assert.ok(up.speed < 0, 'rolls back downhill with no throttle and no brake');
  const held = new RoverController({ gravity: gM, getGroundHeight: (x, z) => -z * Math.tan((5 * Math.PI) / 180) });
  drive(held, 5, { brake: true });
  assert.equal(held.speed, 0, 'brakes hold it on a gentle slope');
});

test('slow full-lock turn has the LRV turning radius (3.1 m)', () => {
  const r = new RoverController({ gravity: gM });
  r.speed = 1;
  const h0 = r.heading;
  drive(r, 1, { throttle: 0.2, steer: 1 }); // let the steering reach full lock
  const h1 = r.heading, v = r.speed;
  drive(r, 0.5, { throttle: 0.2, steer: 1 });
  const yawRate = (r.heading - h1) / 0.5;
  const radius = v / yawRate;
  assert.ok(Math.abs(radius - ROVER.turnRadius) < 0.25, `radius ${radius.toFixed(2)} m`);
  assert.ok(r.heading > h0, 'steer +1 turns left');
});

test('a fast full-lock turn slides on Mars (grip μ·g), but less on Earth', () => {
  const slide = (g) => {
    const r = new RoverController({ gravity: g });
    r.speed = 3.5;
    drive(r, 1.2, { throttle: 1, steer: 1 });
    return r.slip;
  };
  const mars = slide(gM), earth = slide(gE);
  assert.ok(mars > 0.2, `mars slip ${mars.toFixed(2)}`);
  assert.ok(earth < mars, `earth slip ${earth.toFixed(2)} vs mars ${mars.toFixed(2)}`);
});

test('a crest launches the rover; with weaker gravity it stays in the air longer', () => {
  const hop = (g) => {
    // flat run-up, then the ground falls away steeply after z = −20
    const r = new RoverController({ gravity: g, getGroundHeight: (x, z) => (z < -20 ? (z + 20) * 1.2 : 0) });
    r.speed = 3.6;
    let air = 0, wasAir = false;
    for (let t = 0; t < 10; t += 1 / 240) {
      r.update(1 / 240, { throttle: 1 });
      if (!r.onGround) { air += 1 / 240; wasAir = true; } else if (wasAir) break;
    }
    return air;
  };
  const mars = hop(gM), earth = hop(gE);
  assert.ok(mars > 0.2, `mars airtime ${mars.toFixed(2)} s`);
  assert.ok(mars > earth * 1.5, `mars ${mars.toFixed(2)} s vs earth ${earth.toFixed(2)} s`);
});

test('a side slope steeper than 40° rolls the rover over and it stops', () => {
  const notes = [];
  const r = new RoverController({ gravity: gM, getGroundHeight: (x) => -x * Math.tan((45 * Math.PI) / 180), onNotice: (t) => notes.push(t) });
  drive(r, 0.5, { throttle: 1 });
  assert.equal(r.overturned, true);
  assert.ok(notes.includes('rollover'));
  drive(r, 2, { throttle: 1 });
  assert.ok(Math.abs(r.speed) < 0.05);
});

test('battery drains with the work done (≈ rolling resistance × distance / efficiency)', () => {
  const r = new RoverController({ gravity: gM });
  drive(r, 20, { throttle: 1 });
  const wh0 = r.batteryWh, d0 = r.odometer;
  drive(r, 60, { throttle: 1 });
  const usedWh = wh0 - r.batteryWh, dist = r.odometer - d0;
  const expectedWh = (ROVER.rollingResistance * ROVER.mass * gM * dist) / ROVER.efficiency / 3600;
  assert.ok(Math.abs(usedWh - expectedWh) / expectedWh < 0.15, `used ${usedWh.toFixed(2)} Wh, expected ${expectedWh.toFixed(2)} Wh`);
  const range = (ROVER.batteryWh / (usedWh / dist)) / 1000;
  assert.ok(range > 50, `range ${range.toFixed(0)} km (Apollo 15 drove 28 km on less than half its charge)`);
});

test('brakes stop the rover; it cannot drive through the lander', () => {
  const r = new RoverController({ gravity: gM, colliders: [{ x: 0, z: -15, r: 3.2 }] });
  drive(r, 15, { throttle: 1 });
  assert.ok(r.z > -15 + 3.2 + ROVER.track / 2 + 0.3 - 1e-6, `z ${r.z.toFixed(2)}`);
  r.speed = 3;
  drive(r, 3, { brake: true });
  assert.equal(r.speed, 0);
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} rover tests passed`);
process.exit(fails ? 1 : 0);
