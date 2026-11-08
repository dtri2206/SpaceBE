// Node tests for the flight physics. Run: node src/flight/tests/flight.test.mjs
import assert from 'node:assert/strict';
import { FlightController as RawFC, FIXED_DT, TUNING } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import * as contract from '../../core/contract.js';
import { readFileSync } from 'node:fs';
const coreJson = (rel) => JSON.parse(readFileSync(new URL(`../../core/${rel}`, import.meta.url)));
import { MOCK_SHIPS, STARTS } from '../presets.js';
const MOCK_PLANETS = PLANETS;
class FlightController extends RawFC { constructor(o) { super({ g0: G0, ...o }); } }
import { predictPath, stoppingDistance, assistReadout, ascentGuide, landingGuide } from '../flightAssist.js';
import { len, dot, v3, scale, qFromTo, LOCAL_FORWARD, norm, add } from '../vec.js';
import { createDebrisField, closestApproach } from '../debris.js';
import { stackParts } from '../rocketStack.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); }
}
const mkBus = () => { const log = []; return { log, emit: (n, p) => log.push([n, p]) }; };
const run = (fc, seconds, input = {}) => { for (let t = 0; t < seconds; t += FIXED_DT) fc.update(FIXED_DT, input); };
const spec = (stats) => ({ ...MOCK_SHIPS.reliable, stats: { ...MOCK_SHIPS.reliable.stats, ...stats } });

test('free fall from rest accelerates at local g (Mars 3.71 m/s²)', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, planetId: 'mars', shipSpec: MOCK_SHIPS.reliable, start: { altitude: 200000, speed: 0 } });
  run(fc, 1);
  const r = MOCK_PLANETS.mars.radius + 200000;
  const gHere = PLANETS.mars.g * (MOCK_PLANETS.mars.radius / r) ** 2; // 1/r² law
  assert.ok(Math.abs(-fc.telemetry.verticalSpeed - gHere) / gHere < 0.01, `v=${fc.telemetry.verticalSpeed} g=${gHere}`);
});

test('engine off on the pad: ship stays put; TWR < 1 cannot lift off', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, shipSpec: spec({ thrust: 200000 }) }); // 200 kN vs 26 t · g = 255 kN
  run(fc, 3, { throttleUp: true });
  assert.equal(fc.onGround, true);
  assert.ok(fc.telemetry.twr < 1);
});

test('rocket equation: burning all fuel in vacuum gives Δv = Isp·g0·ln(m0/mf)', () => {
  const s = spec({ thrust: 300000, ispSL: 350, ispVac: 350 });
  const fc = new FlightController({ planets: { space: { g: 1e-9, radius: 1 } }, planetId: 'space', shipSpec: s, start: { altitude: 1e9, speed: 0 } });
  const expected = 350 * G0 * Math.log(26 / 6);
  assert.ok(Math.abs(fc.deltaVLeft() - expected) < 1);
  fc.throttle = 1;
  run(fc, 2000);
  assert.equal(fc.fuel, 0);
  const dv = len(fc.vel);
  assert.ok(Math.abs(dv - expected) / expected < 0.005, `dv=${dv.toFixed(1)} expected=${expected.toFixed(1)}`);
});

test('circular orbit keeps its altitude for one full period (energy conserved)', () => {
  const R = MOCK_PLANETS.earth.radius;
  const alt = 200000; // above the drag (at 120 km the thin air slowly drags the orbit down — real effect)
  const mu = PLANETS.earth.g * R * R;
  const vc = Math.sqrt(mu / (R + alt));
  const fc = new FlightController({ planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: alt, speed: vc, flightPathDeg: 0 } });
  assert.equal(fc.phase, 'orbit');
  const period = 2 * Math.PI * Math.sqrt((R + alt) ** 3 / mu);
  let minAlt = Infinity, maxAlt = -Infinity;
  for (let t = 0; t < period; t += FIXED_DT * 10) {
    for (let k = 0; k < 10; k++) fc.update(FIXED_DT, {});
    minAlt = Math.min(minAlt, fc.altitude); maxAlt = Math.max(maxAlt, fc.altitude);
  }
  assert.ok(maxAlt - minAlt < 500, `altitude drift ${(maxAlt - minAlt).toFixed(0)} m over ${period.toFixed(0)} s`);
  assert.equal(fc.failed, null);
});

test('time warp: capped at 4x in the air (10x in near-vacuum air), honoured in orbit, sub-stepped at the fixed step', () => {
  const R = MOCK_PLANETS.earth.radius;
  const vc = Math.sqrt((PLANETS.earth.g * R * R) / (R + 150000));
  const fc = new FlightController({ planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 150000, speed: vc } });
  fc.update(0.1, {}, { timeWarp: 50 });
  assert.ok(Math.abs(fc.t - 5) < 0.02, `t=${fc.t}`);
  const low = new FlightController({ planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 20000, speed: 300 } });
  low.update(0.1, {}, { timeWarp: 50 });
  assert.ok(Math.abs(low.t - 0.4) < 0.02, `low.t=${low.t}`); // 20 km: air thick enough → 4x
  assert.ok(Math.abs(low.warpEffective - 4) < 0.1);
});

test('liftoff emits events; a sensible gravity turn reaches orbit', () => {
  const bus = mkBus();
  const fc = new FlightController({ bus, planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable });
  const notices = [];
  fc.onNotice = (type) => notices.push(type);
  fc.throttle = 1;
  // simple autopilot: vertical, then pitch over gradually, cut when apoapsis is high, circularise at apoapsis
  let circularising = false;
  for (let t = 0; t < 1500 && !fc.failed && fc.phase !== 'orbit'; t += FIXED_DT) {
    const tel = fc.telemetry;
    const up = fc.up;
    const east = norm(v3(up.y, -up.x, 0)); // horizontal, prograde for +X motion
    const pitchDeg = Math.min(85, Math.max(0, (tel.altitude - 1000) / 450)); // 0° at 1 km → 85° at ~39 km
    const p = (pitchDeg * Math.PI) / 180;
    const target = norm({ x: up.x * Math.cos(p) + east.x * Math.sin(p), y: up.y * Math.cos(p) + east.y * Math.sin(p), z: 0 });
    fc.orient = qFromTo(LOCAL_FORWARD, circularising ? norm(fc.vel) : target);
    if (fc.liftoffT === null) { fc.update(FIXED_DT, {}); continue; }
    if (!circularising) {
      fc.throttle = tel.dynamicPressure > 25000 || tel.gLoad > 3.5 ? 0.6 : 1;
      if (tel.apoapsis > 110000) { fc.throttle = 0; circularising = true; }
    } else {
      fc.throttle = tel.verticalSpeed < 50 && tel.altitude > 90000 ? (tel.gLoad > 3.5 ? 0.5 : 1) : 0;
    }
    fc.update(FIXED_DT, {});
  }
  const names = [...bus.log.map(([n]) => n), ...notices];
  assert.ok(names.includes('liftoff'), 'liftoff event');
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  assert.equal(fc.phase, 'orbit', `phase=${fc.phase} alt=${fc.altitude.toFixed(0)} peri=${fc.telemetry.periapsis.toFixed(0)}`);
  assert.ok(names.includes('orbit_achieved'));
  console.log(`    (orbit reached: Δv left ${fc.deltaVLeft().toFixed(0)} m/s, peri ${(fc.telemetry.periapsis / 1000).toFixed(0)} km)`);
});

test('Challenger demo: cold launch with cheap seals fails a minute in, with history hint', () => {
  const bus = mkBus();
  const fc = new FlightController({ bus, planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.coldMorning, rng: () => 0.9 }); // launch.tempC = 2
  fc.throttle = 0.7;
  run(fc, 90);
  assert.equal(fc.failed?.endingId, 'coldMorning');
  assert.equal(fc.failed?.causeId, 'seal_failure_cold');
  assert.ok(bus.log.some(([n, p]) => n === 'flight:failed' && typeof p.cause === 'string' && p.cause.endsWith('.')));
  assert.equal(fc.failed?.historyHint, 'challenger');
  assert.ok(fc.failed.t > 55 && fc.failed.t < 76, `t=${fc.failed.t}`);
});

test('warm launch with the same cheap seals does NOT fail', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, shipSpec: { ...MOCK_SHIPS.coldMorning, launch: { tempC: 18 } } });
  fc.throttle = 0.7;
  run(fc, 90);
  assert.equal(fc.failed, null);
});

test('Mars entry: good shield + chute slows to <200 m/s by 3 km; damaged shield burns up (Columbia hint); no shield burns up', () => {
  const arrive = (stats) => ({ ...MOCK_SHIPS.marsArrival, stats: { ...MOCK_SHIPS.marsArrival.stats, ...stats } });
  const fly = (stats) => {
    const fc = new FlightController({ planets: MOCK_PLANETS, planetId: 'mars', shipSpec: arrive(stats), start: STARTS.marsEntry });
    for (let t = 0; t < 400 && !fc.failed && fc.altitude > 3000; t += FIXED_DT) fc.update(FIXED_DT, {});
    return fc;
  };
  const ok = fly({});
  assert.equal(ok.failed, null, JSON.stringify(ok.failed));
  assert.ok(ok.chuteOpen, 'supersonic chute opened');
  assert.ok(ok.telemetry.speed < 200, `speed at 3 km: ${ok.telemetry.speed.toFixed(0)} m/s`);
  const dmg = fly({ heatShieldDamaged: true });
  assert.equal(dmg.failed?.endingId, 'theFoam');
  assert.equal(dmg.failed?.historyHint, 'columbia');
  const none = fly({ hasHeatShield: false });
  assert.equal(none.failed?.endingId, 'burnup');
  assert.equal(none.failed?.causeId, 'no_heat_shield');
});

test('landing: hold Space (brake) + throttle near the ground → gentle touchdown on Mars', () => {
  const bus = mkBus();
  const fc = new FlightController({ bus, planets: MOCK_PLANETS, planetId: 'mars', shipSpec: MOCK_SHIPS.marsArrival, start: STARTS.marsLanding });
  // pilot: brake while fast, then hover-ish descent using the BURN NOW logic
  for (let t = 0; t < 400 && !fc.failed && !fc.landed; t += FIXED_DT) {
    const tel = fc.telemetry;
    const a = assistReadout(fc);
    if (tel.horizontalSpeed > 2 || a.burnNow) {
      fc.update(FIXED_DT, { brake: true });
    } else {
      // upright + gentle burn to keep descent ~2 m/s near the ground
      fc.orient = qFromTo(LOCAL_FORWARD, fc.up);
      const want = tel.altitude > 50 ? -8 : -1.5;
      const engineAcc = fc.thrustNow() / fc.mass;
      const need = tel.gravity + (want - tel.verticalSpeed) * 2;
      fc.throttle = Math.max(0, Math.min(1, need / engineAcc));
      fc.update(FIXED_DT, {});
    }
  }
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  assert.equal(fc.landed, true);
  const landed = bus.log.find(([n]) => n === 'flight:landed');
  assert.ok(landed && landed[1].touchdownSpeed <= TUNING.touchdownLimit.legs);
});

test('entry too shallow and fast skips off into space → adrift (skipped_off)', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, planetId: 'mars', shipSpec: { ...MOCK_SHIPS.marsArrival, stats: { ...MOCK_SHIPS.marsArrival.stats, fuelMass: 0 } }, start: { altitude: 99000, speed: 1650, flightPathDeg: -12 } });
  run(fc, 900);
  assert.equal(fc.failed?.endingId, 'adrift');
  assert.equal(fc.failed?.causeId, 'skipped_off');
});

test('shallow but slower entry: drag captures the ship into a long orbit (aerocapture), no failure', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, planetId: 'mars', shipSpec: MOCK_SHIPS.marsArrival, start: { altitude: 99000, speed: 1400, flightPathDeg: -12 } });
  run(fc, 400);
  assert.equal(fc.failed, null);
  assert.ok(fc.telemetry.eccentricity < 1, `e=${fc.telemetry.eccentricity}`);
});

test('hitting the ground fast = crash landing (rud)', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, planetId: 'mars', shipSpec: MOCK_SHIPS.marsArrival, start: { altitude: 500, speed: 60, flightPathDeg: -90 } });
  run(fc, 30);
  assert.equal(fc.failed?.endingId, 'rud');
  assert.equal(fc.failed?.causeId, 'crash_landing');
});

test('out of fuel in a stable orbit → adrift', () => {
  const R = MOCK_PLANETS.earth.radius;
  const vc = Math.sqrt((PLANETS.earth.g * R * R) / (R + 150000));
  const fc = new FlightController({ planets: MOCK_PLANETS, shipSpec: spec({ fuelMass: 0 }), start: { altitude: 150000, speed: vc } });
  run(fc, 7);
  assert.equal(fc.failed?.endingId, 'adrift');
});

test('Max-Q: full throttle straight through the thick air breaks the rocket', () => {
  const fc = new FlightController({ planets: MOCK_PLANETS, shipSpec: spec({ thrust: 1400000, cdA: 4 }) });
  fc.throttle = 1;
  run(fc, 120);
  assert.ok(['max_q_exceeded', 'g_force_blackout'].includes(fc.failed?.causeId), JSON.stringify(fc.failed));
});

test('predictPath hits the ground for a suborbital hop and loops for an orbit', () => {
  const hop = new FlightController({ planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 50000, speed: 800, flightPathDeg: 30 } });
  assert.equal(predictPath(hop, { seconds: 1500 }).impact, true);
  const R = MOCK_PLANETS.earth.radius;
  const vc = Math.sqrt((PLANETS.earth.g * R * R) / (R + 150000));
  const orb = new FlightController({ planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 150000, speed: vc } });
  assert.notEqual(predictPath(orb, { seconds: 1500 }).impact, true);
});

test('stopping distance formula d = v²/(2(a−g))', () => {
  assert.equal(stoppingDistance(-20, 13.71, 3.71), 20);
  assert.equal(stoppingDistance(-20, 3, 3.71), Infinity);
});

test('brake (Space) turns the nose retrograde before burning', () => {
  const fc = new FlightController({ planets: { space: { g: 1e-9, radius: 1 } }, planetId: 'space', shipSpec: MOCK_SHIPS.reliable, start: { altitude: 1e9, speed: 100 } });
  fc.orient = qFromTo(LOCAL_FORWARD, norm(fc.vel)); // nose prograde: worst case
  run(fc, 30, { brake: true });
  assert.ok(len(fc.vel) < 100, `speed ${len(fc.vel)}`);
  assert.ok(dot(fc.forward, scale(norm(fc.vel), -1)) > 0.9 || len(fc.vel) < 1);
});

// ---------- Tier 1: debris, engine limits, heat warning ----------
const orbitFc = (stats = {}, bus) => {
  const R = MOCK_PLANETS.earth.radius;
  const vc = Math.sqrt((PLANETS.earth.g * R * R) / (R + 200000));
  const fc = new FlightController({ bus, planets: MOCK_PLANETS, shipSpec: spec(stats), start: { altitude: 200000, speed: vc } });
  if (bus) fc.onNotice = (type, data) => bus.log.push(['notice', { type, ...data }]);
  return fc;
};
const noticed = (bus, type) => bus.log.some(([n, p]) => (n === 'notice' || n === 'flight:event') && p.type === type);

test('debris on the path: armor absorbs one hit, the next hit destroys the ship', () => {
  const bus = mkBus();
  const fc = orbitFc({ armorHits: 1 }, bus);
  const dir = norm(fc.vel);
  const piece = (id, d) => ({ id, pos: add(fc.pos, scale(dir, d)), vel: add(fc.vel, scale(dir, -100)), radius: 1 });
  fc.setObstacles([piece('a', 300), piece('b', 900)]);
  assert.ok(fc.telemetry.collisionWarning, 'collision warning before impact');
  run(fc, 4);
  assert.equal(fc.armorLeft, 0);
  assert.ok(bus.log.some(([n, p]) => n === 'flight:event' && p.type === 'debris_hit'), 'debris_hit is a contract flight:event');
  assert.equal(fc.failed, null);
  run(fc, 8);
  assert.equal(fc.failed?.causeId, 'debris_impact');
});

test('dodging works: a piece passing 30 m to the side is only a near-miss (no hit)', () => {
  const bus = mkBus();
  const fc = orbitFc({ armorHits: 0 }, bus);
  const dir = norm(fc.vel);
  const side = norm({ x: 0, y: 0, z: 1 });
  fc.setObstacles([{ id: 'x', pos: add(add(fc.pos, scale(dir, 600)), scale(side, 14)), vel: add(fc.vel, scale(dir, -100)), radius: 0.5 }]);
  run(fc, 10);
  assert.equal(fc.failed, null);
  assert.ok(noticed(bus, 'debris_near_miss'));
});

test('createDebrisField is deterministic per seed and some pieces sit on the path', () => {
  const fc = orbitFc();
  const a = createDebrisField({ fc, seed: 7 }), b = createDebrisField({ fc, seed: 7 });
  assert.deepEqual(a.map((p) => p.pos), b.map((p) => p.pos));
  const onPath = a.filter((p) => closestApproach(fc.pos, fc.vel, p).missDistance < p.radius + 2).length;
  assert.ok(onPath >= 2, `on-path pieces: ${onPath}`);
});

test('limited ignitions: after the last restart, Q no longer lights the engine', () => {
  const bus = mkBus();
  const fc = orbitFc({ ignitions: 2 }, bus);
  const burn = () => { run(fc, 0.5, { throttleUp: true }); fc.update(FIXED_DT, { cutoff: true }); run(fc, 0.2); };
  burn(); burn();
  assert.equal(fc.ignitionsLeft, 0);
  run(fc, 0.5, { throttleUp: true });
  assert.equal(fc.throttle, 0);
  assert.ok(noticed(bus, 'no_ignition'));
});

test('min throttle: throttle jumps to 40 % on ignition and E cannot go below it (only X shuts down)', () => {
  const fc = orbitFc({ minThrottle: 0.4 });
  fc.update(FIXED_DT, { throttleUp: true });
  assert.ok(fc.throttle >= 0.4);
  run(fc, 5, { throttleDown: true });
  assert.equal(fc.throttle, 0.4);
  fc.update(FIXED_DT, { cutoff: true });
  assert.equal(fc.throttle, 0);
});

test('heat warning fires before a damaged shield burns up', () => {
  const bus = mkBus();
  const ship = { ...MOCK_SHIPS.marsArrival, stats: { ...MOCK_SHIPS.marsArrival.stats, heatShieldDamaged: true } };
  const fc = new FlightController({ bus, planets: MOCK_PLANETS, planetId: 'mars', shipSpec: ship, start: STARTS.marsEntry });
  fc.onNotice = (type, data) => bus.log.push(['notice', { type, ...data }]);
  run(fc, 300);
  const warnIdx = bus.log.findIndex(([n, p]) => n === 'notice' && p.type === 'heat_warning');
  const failIdx = bus.log.findIndex(([n]) => n === 'flight:failed');
  assert.ok(warnIdx >= 0 && failIdx > warnIdx);
});

test('only contract flight:event types and ending ids reach the bus', () => {
  const bus = mkBus();
  const fc = new FlightController({ bus, planets: MOCK_PLANETS, shipSpec: spec({ thrust: 1400000, cdA: 4 }) });
  fc.throttle = 1;
  run(fc, 120);
  for (const [n, p] of bus.log) {
    assert.ok(n in contract.EVENTS, `event ${n}`);
    if (n === 'flight:event') assert.ok(contract.FLIGHT_EVENT_TYPES.includes(p.type), `type ${p.type}`);
    if (n === 'flight:failed') assert.ok(p.endingId in contract.ENDINGS, `ending ${p.endingId}`);
  }
});

test('whole mission is winnable with the core Reliable mock and balance.json (ascent → transfer → entry → landing)', () => {
  const ship = coreJson('mocks/ship.reliable.json');
  const balance = coreJson('balance.json');
  // 1. ascent: a good gravity turn to a ~95 km orbit
  const fc = new FlightController({ planets: PLANETS, shipSpec: ship });
  fc.throttle = 1;
  let circ = false;
  for (let t = 0; t < 3000 && !fc.failed && fc.phase !== 'orbit'; t += FIXED_DT) {
    const tel = fc.telemetry;
    if (fc.liftoffT !== null) {
      const up = fc.up, east = norm(v3(up.y, -up.x, 0));
      const p = (Math.min(89, Math.max(0, (tel.altitude - 2000) / 400)) * Math.PI) / 180;
      if (!circ) {
        fc.orient = qFromTo(LOCAL_FORWARD, norm({ x: up.x * Math.cos(p) + east.x * Math.sin(p), y: up.y * Math.cos(p) + east.y * Math.sin(p), z: 0 }));
        fc.throttle = tel.dynamicPressure > 30000 ? 0.5 : tel.gLoad > 4.5 ? 0.6 : 1;
        if (tel.apoapsis > 95000) { fc.throttle = 0; circ = true; }
      } else {
        fc.orient = qFromTo(LOCAL_FORWARD, east);
        fc.throttle = tel.verticalSpeed < 15 && tel.altitude > 85000 ? 1 : 0;
      }
    }
    fc.update(FIXED_DT, {});
  }
  assert.equal(fc.phase, 'orbit', JSON.stringify(fc.failed));
  const ascentUsed = fc.deltaVLeft.call({ ship: fc.ship, g0: G0, mass: fc.ship.dryMass + fc.ship.fuelMass }) - fc.deltaVLeft();
  assert.ok(ascentUsed <= balance.deltaVKmS.ascent * 1000 * 1.05, `ascent used ${ascentUsed.toFixed(0)} m/s`);
  // 2. transfer burn exactly as src/flight/index.js does it (rocket equation)
  const dv = balance.deltaVKmS.transfer * 1000;
  const fuelForMars = fc.mass / Math.exp(dv / (fc.ship.ispVac * G0)) - fc.ship.dryMass;
  assert.ok(fuelForMars > 0, `no fuel left after the transfer (${fuelForMars.toFixed(0)} kg)`);
  // 3. entry + landing: chute, then a last-moment retro burn (what BURN NOW tells the player)
  const m = new FlightController({ planets: PLANETS, planetId: 'mars', shipSpec: ship, start: STARTS.marsEntry, fuel: fuelForMars });
  for (let t = 0; t < 900 && !m.failed && !m.landed; t += FIXED_DT) {
    const tel = m.telemetry;
    if (tel.altitude > 3000) { m.update(FIXED_DT, {}); continue; }
    const a = assistReadout(m);
    if ((a.burnNow || tel.horizontalSpeed > 2) && tel.verticalSpeed < -4) { m.update(FIXED_DT, { brake: true }); continue; }
    m.orient = qFromTo(LOCAL_FORWARD, m.up);
    if (tel.altitude < 60 || tel.verticalSpeed > -4) {
      const want = tel.altitude > 15 ? -4 : -1.5;
      m.throttle = Math.max(0, Math.min(1, (tel.gravity + (want - tel.verticalSpeed) * 3) / (m.thrustNow() / m.mass)));
    } else m.throttle = 0;
    m.update(FIXED_DT, {});
  }
  assert.equal(m.failed, null, JSON.stringify(m.failed));
  assert.equal(m.landed, true);
  console.log(`    (mission: ascent ${ascentUsed.toFixed(0)} m/s, ${fuelForMars.toFixed(0)} kg fuel at Mars, ${m.deltaVLeft().toFixed(0)} m/s left after landing)`);
});

test('stackParts re-stacks axial parts by real height in spec order; side parts follow their axial part', () => {
  const parts = [
    { type: 'capsule_m', x: 0, y: 6, z: 0 }, { type: 'tank_l', x: 0, y: 2.8, z: 0 }, { type: 'engine_m', x: 0, y: 0, z: 0 },
    { type: 'leg_s', x: 1.4, y: 0.4, z: 0 },
  ];
  const h = { capsule_m: 2, tank_l: 6, engine_m: 2.3, leg_s: 1 };
  const { placed, top } = stackParts(parts, (p) => h[p.type]);
  assert.equal(placed.get(parts[2]), 0);
  assert.equal(placed.get(parts[1]), 2.3);
  assert.equal(placed.get(parts[0]), 8.3);
  assert.equal(top, 10.3);
  assert.ok(Math.abs(placed.get(parts[3]) - 0.4) < 1e-9, 'leg stays 0.4 m above the engine base');
});

test('ascent guide: straight up on the pad, ~45° at 20 km, coast once the apoapsis is high, nothing in orbit', () => {
  const pad = new FlightController({ planets: PLANETS, shipSpec: MOCK_SHIPS.reliable });
  assert.equal(ascentGuide(pad).step, 'climb');
  const mid = new FlightController({ planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 20000, speed: 400, flightPathDeg: 60 } });
  mid.liftoffT = 0;
  const g = ascentGuide(mid);
  assert.equal(g.step, 'turn');
  assert.ok(Math.abs(g.pitchDeg - 45) < 0.01, `${g.pitchDeg}`);
  const high = new FlightController({ planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 60000, speed: 1900, flightPathDeg: 20 } });
  high.liftoffT = 0;
  assert.ok(high.telemetry.apoapsis > 95000);
  assert.equal(ascentGuide(high).step, 'coast');
  const R = PLANETS.earth.radius;
  const orbit = new FlightController({ planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 200000, speed: Math.sqrt((PLANETS.earth.g * R * R) / (R + 200000)) } });
  assert.equal(ascentGuide(orbit), null);
});

test('landing guide walks through entry → chute → BURN NOW → touchdown on Mars', () => {
  const m = new FlightController({ planets: PLANETS, planetId: 'mars', shipSpec: MOCK_SHIPS.marsArrival, start: STARTS.marsEntry });
  const steps = new Set();
  for (let t = 0; t < 900 && !m.failed && !m.landed; t += FIXED_DT) {
    const g = landingGuide(m);
    if (g) steps.add(g.step);
    const tel = m.telemetry;
    if (tel.altitude > 3000) { m.update(FIXED_DT, {}); continue; }
    const a = assistReadout(m);
    if ((a.burnNow || tel.horizontalSpeed > 2) && tel.verticalSpeed < -4) { m.update(FIXED_DT, { brake: true }); continue; }
    m.orient = qFromTo(LOCAL_FORWARD, m.up);
    m.throttle = tel.altitude < 60 || tel.verticalSpeed > -4 ? Math.max(0, Math.min(1, (tel.gravity + ((tel.altitude > 15 ? -4 : -1.5) - tel.verticalSpeed) * 3) / (m.thrustNow() / m.mass))) : 0;
    m.update(FIXED_DT, {});
  }
  assert.equal(m.landed, true, JSON.stringify(m.failed));
  for (const step of ['entry', 'chute', 'burn', 'touchdown']) assert.ok(steps.has(step), `missing step ${step}: ${[...steps]}`);
  assert.equal(landingGuide(m), null, 'no guide once landed');
});

test('a half-built ShipSpec (zeros, strings, missing stats) never produces NaN', () => {
  const fc = new FlightController({ planets: PLANETS, shipSpec: { stats: { dryMass: 0, fuelMass: -5, thrust: 'x', ispSL: 0 } } });
  run(fc, 2, { throttleUp: true });
  const t = fc.telemetry;
  for (const k of ['altitude', 'speed', 'deltaVLeft', 'twr', 'mass', 'gLoad']) assert.ok(Number.isFinite(t[k]), `${k} = ${t[k]}`);
  const empty = new FlightController({ planets: PLANETS, shipSpec: {} });
  run(empty, 1);
  assert.ok(Number.isFinite(empty.telemetry.deltaVLeft));
});

test('launch clamps (holdDown) keep a full-thrust rocket on the pad until released', () => {
  const fc = new FlightController({ planets: PLANETS, shipSpec: MOCK_SHIPS.reliable });
  fc.holdDown = true;
  fc.throttle = 1;
  run(fc, 3);
  assert.equal(fc.onGround, true);
  assert.equal(fc.liftoffT, null);
  assert.ok(fc.fuel < fc.ship.fuelMass, 'engines burn while clamped (real pad ignition)');
  fc.holdDown = false;
  run(fc, 2);
  assert.ok(fc.liftoffT !== null && fc.altitude > 1);
});

import { cockpitStickValues, createCockpitIndicators } from '../cockpitControls.js';
test('cockpit stick values: W = -1 pitch, D = +1 yaw, clamped and NaN-safe', () => {
  const a = cockpitStickValues({ pitch: -1, yaw: 1 }, 0.5);
  assert.deepEqual(a, { pitch: -1, yaw: 1, throttle: 0.5, cutoff: false, brake: false, assist: false });
  assert.deepEqual(cockpitStickValues({ pitch: NaN, yaw: 5 }, 7), { pitch: 0, yaw: 1, throttle: 1, cutoff: false, brake: false, assist: false });
});

test('cockpit switches receive X before it is consumed, latch the guard and follow Space/F without changing physics inputs', () => {
  const indicators = createCockpitIndicators();
  const pilot = { cutoff: true, brake: false, pitch: -.5, yaw: .2 };
  const before = { ...pilot };
  const cut = indicators.update(pilot, 0, { assist: true });
  assert.equal(cut.cutoff, true); assert.equal(cut.assist, true); assert.equal(cut.brake, false);
  assert.deepEqual(pilot, before);
  for (let i = 0; i < 20; i++) assert.equal(indicators.update({}, 0).cutoff, true);
  assert.equal(indicators.update({}, .4).cutoff, false);
  indicators.update({ cutoff: true }, 0);
  const retro = indicators.update({ brake: true }, 0, { brakeBurn: true, assist: false });
  assert.equal(retro.cutoff, false); assert.equal(retro.brake, true); assert.equal(retro.assist, false);
});

let fails = 0;
for (const [s, name, e] of results) {
  console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`);
  if (e) { fails++; console.log('     ', e.message); }
}
console.log(`\n${results.length - fails}/${results.length} flight tests passed`);
process.exit(fails ? 1 : 0);

