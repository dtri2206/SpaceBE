// Node tests for the debris dodge window: projection, gap finder, window state, RCS physics, rating.
// Run: node src/flight/tests/conjunction.test.mjs
import assert from 'node:assert/strict';
import { FlightController as FC, TUNING } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS } from '../presets.js';
import { createDebrisField, DEBRIS_ENCOUNTER } from '../debris.js';
import { createAutopilot } from '../autopilot.js';
import { conjunctionAxes, conjunctionPieces, rcsRequest, trackAim, findDodge, createDebrisWindow, createEncounterTracker, DEBRIS_WINDOW } from '../conjunction.js';
import { rateDebris } from '../rating.js';
import { dot, len } from '../vec.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const p = PLANETS.earth, alt = 200000, F = 1 / 60;
const orbitFc = (stats = {}) => new FC({ g0: G0, planets: PLANETS, shipSpec: { ...MOCK_SHIPS.reliable, stats: { ...MOCK_SHIPS.reliable.stats, ...stats } }, start: { altitude: alt, speed: Math.sqrt(p.g * p.radius ** 2 / (p.radius + alt)), flightPathDeg: 0, facing: 'prograde' } });
const field = (fc, seed = DEBRIS_ENCOUNTER.seed) => fc.setObstacles(createDebrisField({ fc, ...DEBRIS_ENCOUNTER, seed }));

// mode: 'none' | 'player' (scripted: steers toward the largest gap, reacts every 0.1 s) | 'auto' (flight computer, held 8 s like the declined offer)
function fly(seed, mode, stats) {
  const fc = orbitFc(stats);
  field(fc, seed);
  const tr = createEncounterTracker(), ap = createAutopilot();
  const limit = fc.ship.hasRCS ? TUNING.rcsAccel.rcs : TUNING.rcsAccel.noRcs;
  let aim = { x: 0, y: 0 }, startHits = 0;
  for (let f = 0; f < 60 * 45 && !fc.failed; f++) {
    const t = f * F;
    if (mode === 'player' && f % 6 === 0) aim = trackAim(conjunctionPieces(fc, fc.obstacles), limit);
    tr.update(fc, F);
    const base = ap.update(fc, { holdDodge: mode === 'player' || (mode === 'auto' && t < DEBRIS_WINDOW.offerSeconds) });
    const input = mode === 'player' ? { ...base, rcs: rcsRequest(conjunctionAxes(fc.pos, fc.vel), aim, limit) } : mode === 'none' ? {} : base;
    fc.update(F, input, { timeWarp: 1 });
  }
  return { fc, ...tr.stats(fc) };
}

test('axes: x = orbit normal, y = radial up, perpendicular to the velocity', () => {
  const fc = orbitFc();
  const a = conjunctionAxes(fc.pos, fc.vel);
  assert.ok(Math.abs(dot(a.n, a.vhat)) < 1e-9 && Math.abs(dot(a.up, a.vhat)) < 1e-9 && Math.abs(dot(a.n, a.up)) < 1e-9);
  assert.ok(dot(a.up, fc.up) > 0.99);
});

test('field: pieces arrive spread over 8+ s, first about 14 s out, the first window shows several pieces', () => {
  const fc = orbitFc(); field(fc);
  const all = conjunctionPieces(fc, fc.obstacles, { horizon: 60, maxMiss: 1e9 });
  assert.ok(all[0].t > 11 && all[0].t < 18, `first ${all[0].t}`);
  assert.ok(all.at(-1).t - all[0].t > 7, 'spread');
  const near = conjunctionPieces(fc, fc.obstacles, { horizon: 60 });
  assert.ok(near.length >= 5 && near.length <= 25, `${near.length} pieces in the panel range`);
});

test('no input: at least one predicted hit and at least one real hit', () => {
  const fc = orbitFc(); field(fc);
  const predicted = conjunctionPieces(fc, fc.obstacles, { horizon: 60 }).filter((q) => q.miss < q.hitRadius);
  assert.ok(predicted.length >= 1, 'predicted hits');
  const r = fly(DEBRIS_ENCOUNTER.seed, 'none');
  assert.ok(r.hits >= 1, `hits ${r.hits}`);
});

test('scripted player steering to the gap: 0 hits, dv <= 15 m/s, 3-star clearance, several seeds', () => {
  for (const seed of [DEBRIS_ENCOUNTER.seed, 1, 2, 3, 4, 5, 6, 7]) {
    const r = fly(seed, 'player');
    assert.equal(r.fc.failed, null);
    assert.equal(r.hits, 0, `seed ${seed}`);
    assert.ok(r.dvMs <= 15, `seed ${seed} dv ${r.dvMs}`);
    assert.ok(r.minRatio > 2, `seed ${seed} ratio ${r.minRatio}`);
  }
});

test('autopilot fallback (offer declined, computer starts 8 s in) loses at most the armor', () => {
  for (const seed of [DEBRIS_ENCOUNTER.seed, 1, 2, 3]) {
    const r = fly(seed, 'auto');
    assert.equal(r.fc.failed, null, `seed ${seed} ${JSON.stringify(r.fc.failed)}`);
    assert.ok(r.hits <= r.fc.ship.armorHits, `seed ${seed} hits ${r.hits}`);
  }
});

test('rcs input: clamped to the RCS limit, costs fuel, no rotation, none without fuel', () => {
  const fc = orbitFc();
  const v0 = { ...fc.vel }, fuel0 = fc.fuel, q0 = { ...fc.orient };
  for (let i = 0; i < 4; i++) fc.update(0.25, { rcs: { x: 100, y: 0, z: 0 } }, { timeWarp: 1 });
  assert.ok(Math.abs(fc.rcsDv - TUNING.rcsAccel.rcs) < 0.05, `dv ${fc.rcsDv}`);
  assert.ok(fc.fuel < fuel0);
  assert.ok(Math.abs(len(fc.orient) - len(q0)) < 1e-6 && Math.abs(fc.orient.w - q0.w) < 1e-3);
  const noRcs = orbitFc({ hasRCS: false }); for (let i = 0; i < 4; i++) noRcs.update(0.25, { rcs: { x: 100, y: 0, z: 0 } }, { timeWarp: 1 });
  assert.ok(Math.abs(noRcs.rcsDv - TUNING.rcsAccel.noRcs) < 0.05);
  const dry = orbitFc(); dry.fuel = 0; dry.update(0.25, { rcs: { x: 5, y: 0, z: 0 } }, { timeWarp: 1 });
  assert.equal(dry.rcsDv, 0);
});

test('findDodge: a piece dead ahead makes the pilot move sideways, a clear sky asks for nothing', () => {
  const d = findDodge([{ x: 0, y: 0, t: 10, danger: 4 }]);
  assert.ok(Math.hypot(d.ux, d.uy) * 10 >= 2.2 * 4 - 0.5 * 10);
  assert.deepEqual(findDodge([]), { ux: 0, uy: 0, minRatio: Infinity });
  assert.deepEqual(trackAim([], 3), { x: 0, y: 0 });
});

test('window: offer expires, take accumulates the mouse into a clamped aim, ends when clear', () => {
  const w = createDebrisWindow();
  assert.ok(w.offer() && w.offered);
  assert.ok(w.take() && w.active);
  w.update(0.1, { mouse: { x: 100, y: -200 }, ahead: 5, pieces: [] });
  assert.ok(w.aim.x > 0 && w.aim.y > 0);
  w.update(0.1, { mouse: { x: 1e5, y: 1e5 }, ahead: 5 });
  assert.ok(Math.hypot(w.aim.x, w.aim.y) <= 1 + 1e-9);
  const r = w.update(1, { ahead: 0 });
  assert.equal(w.state, 'ended'); assert.ok(r.events.includes('clear')); assert.equal(w.result().flown, true);
  const d = createDebrisWindow(); d.offer();
  let ev = []; for (let i = 0; i < 90; i++) ev = ev.concat(d.update(0.1).events);
  assert.equal(d.state, 'declined'); assert.deepEqual(ev, ['declined']); assert.equal(d.result().flown, false);
  const c = createDebrisWindow(); c.offer(); c.take(); assert.ok(c.cancel()); assert.equal(c.result().flown, false);
  const t = createDebrisWindow(); t.offer(); t.take();
  for (let i = 0; i < 300; i++) t.update(0.1, { ahead: 3 });
  assert.equal(t.state, 'ended');
});

test('rating: computer 1 star; player 3 / 2 / 1 stars by hits and clearance', () => {
  assert.equal(rateDebris({ manualFlown: false, hits: 0, closestM: 5, minRatio: 5, dvMs: 0 }).stars, 1);
  const three = rateDebris({ manualFlown: true, hits: 0, closestM: 41.2, minRatio: 3, dvMs: 9 });
  assert.equal(three.stars, 3); assert.equal(three.text, 'DEBRIS ★★★ · 0 hits · closest 41 m · Δv 9 m/s');
  assert.equal(rateDebris({ manualFlown: true, hits: 0, closestM: 5, minRatio: 1.5, dvMs: 3 }).stars, 2);
  assert.equal(rateDebris({ manualFlown: true, hits: 1, closestM: 0, minRatio: 0.2, dvMs: 3 }).stars, 1);
  assert.equal(rateDebris({ manualFlown: true, hits: 0, closestM: 5, minRatio: 3, dvMs: 3 }).phase, 'debris');
});

let failed = 0;
for (const [status, name, e] of results) { console.log(`${status === 'ok' ? 'ok  ' : 'FAIL'} ${name}`); if (e) { failed++; console.log(e); } }
process.exit(failed ? 1 : 0);
