// Node tests for the two historical failures Role 2 owns. Run: node src/flight/tests/foam.test.mjs
//   The Foam (Columbia, 2003): debris strike -> unseen heat-shield damage -> burn-up at Mars entry unless inspected.
//   Pure Oxygen (Apollo 1, 1967): padFire.js timing + the flight:failed payload (the checklist side is in phase0Ritual.test.mjs).
import assert from 'node:assert/strict';
import { FlightController as RawFC, FIXED_DT, TUNING } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import * as contract from '../../core/contract.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { createAutopilot } from '../autopilot.js';
import { approachBack, computeCorridor } from '../corridor.js';
import { createFoam, FOAM } from '../foam.js';
import { createPadFire, PAD_FIRE } from '../padFire.js';

const mk = (o) => new RawFC({ g0: G0, planets: PLANETS, ...o });
const mkBus = () => { const log = []; return { log, emit: (n, p) => log.push([n, p]) }; };
const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const circular = (altitude) => ({ altitude, speed: Math.sqrt((PLANETS.earth.g * PLANETS.earth.radius ** 2) / (PLANETS.earth.radius + altitude)), flightPathDeg: 0, facing: 'prograde' });

function strikeInOrbit(stats = {}) {
  const bus = mkBus();
  const ship = { ...MOCK_SHIPS.reliable, stats: { ...MOCK_SHIPS.reliable.stats, armorHits: 1, ...stats } };
  const fc = mk({ bus, shipSpec: ship, start: circular(200000) });
  // one piece right on the ship's path, drifting with it
  fc.setObstacles([{ id: 'x1', radius: 1, minDist: Infinity, pos: { x: fc.pos.x, y: fc.pos.y + 2, z: fc.pos.z }, vel: { ...fc.vel } }]);
  for (let t = 0; t < 3 && fc.armorLeft === 1; t += FIXED_DT) fc.update(FIXED_DT, {});
  return { fc, bus };
}

// Mars entry the way index.js starts it: 40 s of approach at -22.8 deg, the computer plans the corridor, then flies it.
function marsEntry(foam) {
  const bus = mkBus();
  const fc = mk({ bus, shipSpec: MOCK_SHIPS.marsArrival, planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel: 5000 });
  foam.applyTo(fc);
  approachBack(fc, 40);
  const corridor = computeCorridor(fc), ap = createAutopilot();
  let peak = 0, limit = 0;
  for (let t = 0; t < 900 && !fc.failed && !fc.landed; t += FIXED_DT) {
    fc.update(FIXED_DT, ap.update(fc, { corridor }));
    peak = Math.max(peak, fc.telemetry.heatFlux ?? 0); limit = fc.telemetry.heatLimit;
  }
  return { fc, bus, corridor, peak, limit };
}

test('a debris hit absorbed by armor in Earth orbit damages the heat shield (unseen) and still emits debris_hit', () => {
  const { fc, bus } = strikeInOrbit();
  assert.equal(fc.armorLeft, 0); assert.equal(fc.failed, null);
  assert.equal(fc.ship.heatShieldDamaged, true); assert.equal(fc.ship.heatShieldUnseen, true);
  const ev = bus.log.filter(([n, p]) => n === 'flight:event' && p.type === 'debris_hit');
  assert.equal(ev.length, 1); assert.ok(contract.FLIGHT_EVENT_TYPES.includes(ev[0][1].type)); assert.equal(ev[0][1].data.heatShieldDamaged, true);
});

test('a clean dodge changes nothing; a ship without a heat shield has nothing to damage', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, start: circular(200000) });
  for (let t = 0; t < 5; t += FIXED_DT) fc.update(FIXED_DT, {});
  assert.equal(fc.ship.heatShieldDamaged, false); assert.equal(fc.ship.heatShieldUnseen, false);
  assert.equal(strikeInOrbit({ hasHeatShield: false }).fc.ship.heatShieldDamaged, false);
});

test('the inspection offer waits for the dodge window, lasts 12 s, can be taken (F) and finds the gouge after the sweep', () => {
  const f = createFoam();
  assert.deepEqual(f.update(1), []); f.hit(); f.hit();
  assert.deepEqual(f.update(1, { busy: true }), []); assert.equal(f.state, 'pending');
  assert.deepEqual(f.update(1), ['offered']); assert.equal(f.offered, true);
  assert.deepEqual(f.update(11.9), []); assert.deepEqual(f.update(0.2), ['ignored']); assert.equal(f.take(), false);
  const g = createFoam(); g.hit(); g.update(0.1); assert.equal(g.take(), true); assert.equal(g.scanning, true);
  assert.deepEqual(g.update(FOAM.sweepSeconds - 0.1), []); assert.deepEqual(g.update(0.2), ['found']); assert.equal(g.inspected, true);
  assert.equal(FOAM.offerSeconds, 12);
});

test('IGNORED: the Mars entry ends in theFoam / columbia with the plain cause sentence', () => {
  const foam = createFoam(); foam.strike({ ship: { hasHeatShield: true } }); foam.update(0.1); foam.update(13); // offered, then timed out
  assert.equal(foam.state, 'ignored');
  const { fc, bus } = marsEntry(foam);
  assert.equal(fc.failed?.endingId, 'theFoam'); assert.equal(fc.failed?.historyHint, 'columbia');
  assert.equal(fc.failed?.cause, 'A debris strike in Earth orbit had damaged the heat shield, and no one inspected it. On entry, hot gas got in.');
  const ev = bus.log.find(([n]) => n === 'flight:failed')[1];
  assert.ok(ev.endingId in contract.ENDINGS && ev.historyHint in contract.HISTORY_LESSONS);
});

test('INSPECTED: the computer flies a shallow corridor, the damaged shield stays under its limit and the ship lands', () => {
  const foam = createFoam(); foam.strike({ ship: { hasHeatShield: true } }); foam.update(0.1); foam.take(); foam.update(FOAM.sweepSeconds + 0.1);
  assert.equal(foam.inspected, true);
  const healthy = createFoam(); healthy.strike({ ship: { hasHeatShield: true } });
  const blind = marsEntry(healthy).corridor;
  const r = marsEntry(foam);
  console.log(`    (inspected: corridor ${r.corridor.steepDeg.toFixed(2)}..${r.corridor.shallowDeg.toFixed(2)} deg, centre ${r.corridor.centreDeg.toFixed(2)} vs uninspected centre ${blind.centreDeg.toFixed(2)}; peak heat ${r.peak.toFixed(0)} of limit ${r.limit}; touchdown ${r.fc.landingSpeed?.toFixed(2)} m/s)`);
  assert.equal(r.fc.failed, null, JSON.stringify(r.fc.failed)); assert.equal(r.fc.landed, true);
  assert.equal(r.limit, TUNING.heatLimit.damagedMapped); assert.ok(r.peak < r.limit, `peak ${r.peak} limit ${r.limit}`);
  assert.ok(r.corridor.centreDeg > blind.centreDeg + 4, 'the planned entry is shallower');
  assert.ok(r.fc.landingSpeed <= 3);
});

test('a ship the builder already gave a fragile shield keeps its old behaviour (known damage, old cause)', () => {
  const fc = mk({ shipSpec: { ...MOCK_SHIPS.marsArrival, stats: { ...MOCK_SHIPS.marsArrival.stats, heatShieldDamaged: true } }, planetId: 'mars', start: STARTS.marsEntry });
  for (let t = 0; t < 300 && !fc.failed; t += FIXED_DT) fc.update(FIXED_DT, {});
  assert.equal(fc.failed?.endingId, 'theFoam'); assert.equal(fc.failed?.causeId, 'heat_shield_damaged');
});

test('pad fire: alarm at T-6.5, failure 2 s later (before the T-3 ignition), never twice', () => {
  const f = createPadFire();
  assert.deepEqual(f.update(10, 0), []); assert.deepEqual(f.update(6.6, 3.4), []);
  assert.deepEqual(f.update(6.5, 3.5), ['alarm']); assert.deepEqual(f.update(5, 5), []);
  assert.deepEqual(f.update(4.5, 5.5), ['fail']); assert.deepEqual(f.update(2, 8), []);
  assert.ok(PAD_FIRE.alarmAt - PAD_FIRE.fadeSeconds > 3);
});

test('pad fire failure goes through the normal flight:failed path with pureOxygen / apollo1 and the plain sentence', () => {
  const bus = mkBus();
  const fc = mk({ bus, shipSpec: MOCK_SHIPS.reliable });
  fc.failWith('pureOxygen', 'pad_fire', {}, 'apollo1');
  fc.failWith('rud', 'engine_overheat'); // a second failure never replaces the first
  const [name, p] = bus.log.find(([n]) => n === 'flight:failed');
  assert.equal(name, 'flight:failed'); assert.equal(bus.log.filter(([n]) => n === 'flight:failed').length, 1);
  assert.equal(p.endingId, 'pureOxygen'); assert.equal(p.historyHint, 'apollo1');
  assert.ok(contract.ENDINGS[p.endingId] && contract.HISTORY_LESSONS[p.historyHint]);
  assert.equal(p.cause, 'A wiring spark in a pure-oxygen cabin started a fire during the pad test; in pure oxygen it spread in seconds.');
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.stack ?? e.message); } }
console.log(`\n${results.length - fails}/${results.length} foam tests passed`);
process.exit(fails ? 1 : 0);
