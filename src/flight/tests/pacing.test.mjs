// Node tests for flight pacing, corridor, objectives and ratings. Run: node src/flight/tests/pacing.test.mjs
import assert from 'node:assert/strict';
import { FlightController as RawFC, FIXED_DT, WARP_IN_AIR } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { createPacer, createEventDetector, paceContext, timeToApoapsis, tierFor, PACE } from '../pacing.js';
import { predictInterface, computeCorridor, corridorGauge, approachBack, flightPathDeg } from '../corridor.js';
import { createChecklist, objectiveText } from '../objectives.js';
import { rateAscent, rateEntry, rateLanding, getPhaseRatings, clearPhaseRatings, storeRating } from '../rating.js';
import { simulateAscent, simulateEntry } from './paceSim.mjs';

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok', name); } catch (e) { failed++; console.log('FAIL', name, e.message); } };
const mk = (o) => new RawFC({ g0: G0, planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, ...o });
const R = PLANETS.earth.radius;
const orbitStart = (alt) => ({ altitude: alt, speed: Math.sqrt((PLANETS.earth.g * R * R) / (R + alt)) });

test('warp in the air is sub-stepped at 1/120 s: same result as 1x, capped at 4x, steps per frame are budgeted', () => {
  const a = mk({ start: { altitude: 20000, speed: 400, flightPathDeg: 60 } });
  const b = mk({ start: { altitude: 20000, speed: 400, flightPathDeg: 60 } });
  for (let i = 0; i < 60; i++) a.update(1 / 60, {}, { timeWarp: 4 });
  for (let i = 0; i < 240; i++) b.update(1 / 60, {}, { timeWarp: 1 });
  assert.ok(Math.abs(a.t - 4) < 0.02 && Math.abs(b.t - 4) < 0.02);
  assert.ok(Math.abs(a.altitude - b.altitude) < 5, `${a.altitude} vs ${b.altitude}`); // identical physics, just compressed
  const c = mk({ start: orbitStart(200000) });
  c.update(0.25, {}, { timeWarp: 100, maxSteps: 300 }); // would need 3000 steps
  assert.ok(c.warpEffective < 15 && c.warpEffective > 5, `effective ${c.warpEffective}`);
  assert.ok(c.accumulator < FIXED_DT * 2, 'over-budget time is dropped, no spiral');
  const pad = mk();
  pad.update(0.1, {}, { timeWarp: 50 });
  assert.equal(pad.warpEffective, 1);
});

test('stopOnNotice ends a warped frame right after a notice', () => {
  const fc = mk({ start: { altitude: 20000, speed: 300, flightPathDeg: 40 }, fuel: 300 });
  fc.throttle = 0.3;
  let when = null;
  fc.onNotice = (type) => { if (type === 'fuel_empty') when = fc.t; };
  for (let i = 0; i < 4000 && when === null && !fc.failed; i++) fc.update(1 / 60, {}, { timeWarp: 4, stopOnNotice: true });
  assert.ok(when !== null);
  assert.ok(Math.abs(fc.t - when) < 2 * FIXED_DT, 'stopped within a step of the notice');
});

test('timeToApoapsis (Kepler) matches the numerical coast in vacuum', () => {
  const fc = mk({ start: { altitude: 150000, speed: 2000, flightPathDeg: 25 } });
  const predicted = timeToApoapsis(fc);
  let t = 0;
  while (fc.telemetry.verticalSpeed > 0 && t < 3000) { fc.update(FIXED_DT, {}); t += FIXED_DT; }
  assert.ok(Math.abs(predicted - t) < 1.5, `kepler ${predicted.toFixed(1)} s, numeric ${t.toFixed(1)} s`);
});

test('tierFor never overshoots: big window → 50x, tiny window → 1x', () => {
  assert.equal(tierFor(200, 1 / 60, 50), 50);
  assert.equal(tierFor(0.2, 1 / 60, 50), 4);
  assert.equal(tierFor(0.03, 1 / 60, 50), 1);
  assert.ok(tierFor(200, 1 / 60, 10) === 10, 'cap respected');
});

const coastCtx = (over = {}) => ({ t: 100, planetId: 'earth', phase: 'ascent', altitude: 90000, atmoTop: 76500, vVert: 500, throttle: 0, onGround: false, countdown: false,
  failed: false, landed: false, chuteOpen: false, airDensity: 0, ascentStep: 'coast', landingStep: null, blackout: false, sinceLiftoff: 200, qFrac: 0, gLoad: 0,
  aligned: true, trimming: false, tApo: 120, tInterface: null, approaching: false, ...over });

test('pacer: auto-warps the ascent coast, back to 1x 10 s before the apoapsis, with a reason label', () => {
  const p = createPacer();
  const d = p.decide(coastCtx());
  assert.equal(d.warp, 50); assert.equal(d.auto, true); assert.match(d.label, /AUTO WARP · coasting/);
  assert.equal(p.decide(coastCtx({ tApo: 10 })).warp, 1);
  assert.ok(p.decide(coastCtx({ tApo: 10.5 })).warp <= 10, 'ramps down: no overshoot into the last 10 s');
  assert.equal(p.decide(coastCtx({ ascentStep: 'circularise', tApo: null })).warp, 1);
});

test('pacer: gravity turn is warped only while on the guide and out of Max-Q', () => {
  const turn = (o) => createPacer().decide(coastCtx({ ascentStep: 'turn', throttle: 1, altitude: 20000, ...o }));
  assert.equal(turn({}).warp, 4);
  assert.equal(turn({ aligned: false }).warp, 1);
  assert.equal(turn({ qFrac: 0.7 }).warp, 1);
  assert.equal(turn({ sinceLiftoff: 20 }).warp, 1);
  assert.equal(turn({ countdown: true }).warp, 1);
  assert.equal(turn({ onGround: true }).warp, 1);
});

test('pacer: key events drop to 1x, cancel manual warp, and auto warp resumes after the hold', () => {
  const p = createPacer();
  p.stepManual(1); p.stepManual(1); p.stepManual(1);
  assert.equal(p.manual, 10);
  assert.equal(p.decide(coastCtx({ ascentStep: null })).warp, 10);
  p.event('maxq_warning', 100);
  assert.equal(p.manual, 1);
  assert.equal(p.decide(coastCtx({ t: 101 })).warp, 1);
  assert.equal(p.decide(coastCtx({ t: 100 + PACE.eventHold + 0.1 })).warp, 50);
});

test('event detector: MECO, circularise, BURN NOW, parachute, interface, below 1 km', () => {
  const d = createEventDetector();
  const base = coastCtx({ throttle: 1, ascentStep: 'turn', sinceLiftoff: 100 });
  assert.deepEqual(d.update(base), []);
  assert.deepEqual(d.update({ ...base, throttle: 0 }), ['meco']);
  assert.deepEqual(d.update({ ...base, throttle: 0, ascentStep: 'circularise' }), ['circularise']);
  const m = { ...base, planetId: 'mars', phase: 'entry', throttle: 0, ascentStep: null, atmoTop: 99900, altitude: 100500 };
  d.update(m);
  assert.deepEqual(d.update({ ...m, altitude: 99000 }), ['interface']);
  assert.deepEqual(d.update({ ...m, altitude: 8000, landingStep: 'chute', chuteOpen: true }), ['parachute']);
  assert.deepEqual(d.update({ ...m, altitude: 900, landingStep: 'burn', chuteOpen: true }).sort(), ['burn_now', 'low_mars']);
});

test('corridor: bisection edges agree with the real FlightController (skip-off shallow, too fast steep)', () => {
  const m = mk({ planetId: 'mars', start: STARTS.marsEntry, fuel: 5000 });
  const c = computeCorridor(m);
  assert.ok(c.steepDeg < c.shallowDeg && c.shallowDeg < -10 && c.steepDeg > -45, JSON.stringify(c));
  const fly = (deg) => {
    const f = mk({ planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: deg }, fuel: 5000 });
    let rose = false;
    for (let i = 0; i < 60000 && !f.failed && f.altitude > 3000 && !rose; i++) { f.update(FIXED_DT, {}); if (f.telemetry.verticalSpeed > 0 && f.altitude > 15000) rose = true; }
    return { rose, speedLow: f.telemetry.speed };
  };
  assert.equal(fly(c.shallowDeg - 1).rose, false);
  assert.equal(fly(c.shallowDeg + 1.5).rose, true, 'just shallower than the edge: skips off');
  assert.ok(fly(c.steepDeg + 1).speedLow < 250);
  assert.ok(fly(c.steepDeg - 1.5).speedLow > 250, 'just steeper than the edge: still too fast at 3 km');
});

test('corridor: approachBack arrives at the chosen angle; gauge status; trim changes the angle and costs fuel', () => {
  const m = mk({ planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel: 5000 });
  approachBack(m, 40);
  const pred = predictInterface(m);
  assert.ok(Math.abs(pred.fpaDeg + 22.8) < 0.5, `${pred.fpaDeg}`);
  assert.ok(Math.abs(pred.time - 40) < 2.5, `${pred.time}`);
  const c = computeCorridor(m);
  const g0 = corridorGauge(m, c);
  assert.ok(g0.position > 0.25 && g0.position < 0.75);
  const fuel0 = m.fuel, ang0 = pred.fpaDeg;
  for (let i = 0; i < 120 * 5; i++) m.update(FIXED_DT, { trim: -1 }); // 5 s of W: steeper
  const ang1 = predictInterface(m).fpaDeg;
  assert.ok(ang1 < ang0 - 0.5, `${ang0} → ${ang1}`);
  assert.ok(m.fuel < fuel0 && fuel0 - m.fuel < 400, `fuel used ${fuel0 - m.fuel}`);
  const way = mk({ planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -15 } });
  assert.equal(corridorGauge(way, c).status, 'shallow');
  assert.match(corridorGauge(way, c).hint, /Hold W/);
  const steep = mk({ planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -40 } });
  assert.equal(corridorGauge(steep, c).status, 'steep');
  assert.match(corridorGauge(steep, c).hint, /Hold S/);
});

test('trim does nothing in the atmosphere, with the engine on, or without fuel', () => {
  const inAir = mk({ planetId: 'mars', start: { altitude: 50000, speed: 1400, flightPathDeg: -25 } });
  const v0 = inAir.vel.y; inAir.update(0.1, { trim: 1 }); assert.ok(Math.abs(inAir.trimmedDv) === 0);
  const dry = mk({ planetId: 'mars', start: { altitude: 150000, speed: 1400, flightPathDeg: -25 }, fuel: 0 });
  dry.update(0.1, { trim: 1 }); assert.equal(dry.trimmedDv, 0); assert.ok(v0 !== undefined);
});

test('objectives: one line per phase; checklist steps only move forward and tick when done', () => {
  const pad = mk();
  assert.match(objectiveText(pad, { state: 'LAUNCH' }), /Reach orbit/);
  const m = mk({ planetId: 'mars', start: STARTS.marsEntry });
  assert.match(objectiveText(m, { state: 'ENTRY' }), /corridor, survive the heat/);
  const land = mk({ planetId: 'mars', start: STARTS.marsLanding }); land.update(0.1, {});
  assert.match(objectiveText(land, { state: 'LANDING' }), /Touch down under 3 m\/s/);
  const a = createChecklist('ascent');
  assert.deepEqual(a.update('climb').steps.map((s) => s.status), ['current', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(a.update('coast').steps.map((s) => s.status), ['done', 'done', 'current', 'todo', 'todo']);
  assert.equal(a.update('turn').steps[2].status, 'current', 'never goes back');
  assert.deepEqual(a.update(null, { complete: true }).steps.map((s) => s.status), ['done', 'done', 'done', 'done', 'done']);
  const e = createChecklist('entry');
  assert.deepEqual(e.update('entry').steps.map((s) => s.label), ['Corridor', 'Blackout', 'Parachute', 'Burn', 'Touchdown']);
  assert.equal(e.update('entry', { blackout: 'in' }).steps[1].status, 'current');
  assert.equal(e.update('chute', { blackout: 'after' }).steps[3].status, 'current');
});

test('pacing: a manual-control window forces 1x', () => {
  const fc = mk({ start: { altitude: 20000, speed: 400, flightPathDeg: 60 } });
  const p = createPacer();
  p.stepManual(1); p.stepManual(1);
  assert.equal(p.decide(paceContext(fc, { countdown: false }), 1 / 60).warp, 4);
  const d = p.decide(paceContext(fc, { manual: true }), 1 / 60);
  assert.equal(d.warp, 1); assert.equal(d.reason, 'manual');
});

test('ratings: documented thresholds, text, stored in order, cleared on a new mission', () => {
  const good = rateAscent({ fuelLeftPct: 34, peakG: 3.8, manualFlown: true, manualAccuracyPct: 90 });
  assert.equal(good.stars, 3); assert.match(good.text, /^ASCENT ★★★ · manual accuracy 90 % · fuel left 34 % · peak 3\.8 g/);
  assert.equal(rateAscent({ fuelLeftPct: 34, peakG: 3.8, manualFlown: true, manualAccuracyPct: 70 }).stars, 2);
  assert.equal(rateAscent({ fuelLeftPct: 1, peakG: 3.8, manualFlown: true, manualAccuracyPct: 95 }).stars, 1);
  assert.equal(rateAscent({ fuelLeftPct: 30, peakG: 6.5, manualFlown: true, manualAccuracyPct: 95 }).stars, 2);
  const auto = rateAscent({ fuelLeftPct: 34, peakG: 3.8 });
  assert.equal(auto.stars, 1); assert.match(auto.text, /^ASCENT ★☆☆ · flown by the computer · fuel left 34 % · peak 3\.8 g/);
  const land = rateLanding({ touchdownSpeed: 1.4, offsetM: 42, fuelLeftPct: 12 });
  assert.equal(land.stars, 3); assert.match(land.text, /^LANDING ★★★ · 1\.4 m\/s · 42 m from target · fuel 12 %/);
  assert.equal(rateLanding({ touchdownSpeed: 2.9, offsetM: 42, fuelLeftPct: 12 }).stars, 1);
  assert.equal(rateLanding({ touchdownSpeed: 1.4, offsetM: 120, fuelLeftPct: 12 }).stars, 2);
  assert.equal(rateEntry({ centreOffsetHalfWidths: 0.2, peakG: 3.7, interfaceAngleDeg: -25, centreOffsetDeg: 0.5, peakHeatPct: 6 }).stars, 3);
  assert.equal(rateEntry({ centreOffsetHalfWidths: 0.7, peakG: 3.7, interfaceAngleDeg: -25, centreOffsetDeg: 0.5, peakHeatPct: 6 }).stars, 2);
  clearPhaseRatings();
  storeRating(good); storeRating(land);
  const all = getPhaseRatings();
  assert.deepEqual(all.map((r) => r.phase), ['ascent', 'landing']);
  assert.ok(all.every((r) => r.stars >= 1 && r.stars <= 3 && typeof r.text === 'string' && typeof r.stats === 'object'));
  all[0].stats.peakG = 99; assert.equal(getPhaseRatings()[0].stats.peakG, 3.8, 'copies, not the store');
  clearPhaseRatings(); assert.deepEqual(getPhaseRatings(), []);
});

test('pacing simulation: liftoff → orbit about 2.5 min, Mars entry → touchdown about 2 min, still winnable', () => {
  clearPhaseRatings();
  const up = simulateAscent();
  assert.ok(up.ok, JSON.stringify(up.failed));
  assert.ok(up.countdownPlusReal < 160, `ascent ${up.countdownPlusReal.toFixed(0)} s incl. countdown`);
  assert.equal(up.ratings.length, 1);
  const down = simulateEntry();
  assert.ok(down.ok, JSON.stringify(down.failed));
  assert.ok(down.realSeconds < 135, `entry ${down.realSeconds.toFixed(0)} s`);
  const bo = down.marks['slowing'] - down.marks['entry+bo'];
  assert.ok(bo > 18 && bo < 35, `blackout plays ${bo.toFixed(0)} real s`);
  assert.deepEqual(getPhaseRatings().map((r) => r.phase), ['ascent', 'entry', 'landing']);
  console.log(`    (ascent ${up.countdownPlusReal.toFixed(0)} s real incl. 10 s countdown; entry→touchdown ${down.realSeconds.toFixed(0)} s real; blackout ${bo.toFixed(0)} s)`);
});

console.log(failed ? `${failed} FAILED` : 'all pacing tests passed');
process.exit(failed ? 1 : 0);
