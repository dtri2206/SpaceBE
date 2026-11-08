// Node tests for the manual-control windows and the ascent rating rules. Run: node src/flight/tests/manualControl.test.mjs
import assert from 'node:assert/strict';
import { createManualWindow, frameFor, dirFromOffsets, offsetsFromDir, offsetAngleDeg, MANUAL } from '../manualControl.js';
import { rateAscent, getPhaseRatings, clearPhaseRatings, createPhaseTracker } from '../rating.js';
import { FlightController } from '../FlightController.js';
import { MOCK_SHIPS } from '../presets.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { v3, norm, dot } from '../vec.js';

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok', name); } catch (e) { failed++; console.log('FAIL', name, e.message); } };
const cfg = MANUAL.windows.ascent;
const run = (w, seconds, step, make) => {
  let last, t = 0;
  for (let i = 0; i < Math.round(seconds / step); i++) { t += step; last = w.update(step, make(t, w)); }
  return last;
};
const still = () => ({ mouse: { x: 0, y: 0 }, noseOffset: null });
const followTarget = (t, w) => ({ mouse: { x: 0, y: 0 }, noseOffset: w.target });

test('offer, no key: declined after offerSeconds with an event', () => {
  const w = createManualWindow('ascent', cfg);
  assert.equal(w.state, 'idle'); assert.ok(w.offer()); assert.equal(w.state, 'offered');
  run(w, 5.5, 0.1, still); assert.equal(w.state, 'offered');
  const r = w.update(0.6, still()); assert.equal(w.state, 'declined'); assert.deepEqual(r.events, ['declined']);
  assert.equal(w.result().flown, false);
});

test('take, lock refused before 6 s, accepted on target >= 0.5 s after 6 s', () => {
  const w = createManualWindow('ascent', cfg);
  w.offer(); assert.ok(w.take()); assert.equal(w.state, 'active');
  run(w, 5.5, 0.1, followTarget);
  assert.equal(w.lock(), false);
  run(w, 0.3, 0.1, followTarget); // 5.8 s: still too early
  assert.equal(w.lock(), false);
  run(w, 0.6, 0.1, followTarget); // 6.4 s
  assert.equal(w.lock(), true); assert.equal(w.state, 'locked');
  assert.deepEqual([w.result().flown, w.result().accuracyPct], [true, 100]);
});

test('lock refused when off target even after 6 s', () => {
  const w = createManualWindow('ascent', cfg);
  w.offer(); w.take();
  run(w, 8, 0.1, (t, win) => ({ mouse: { x: 0, y: 0 }, noseOffset: { yawDeg: win.target.yawDeg + 8, pitchDeg: win.target.pitchDeg } }));
  assert.equal(w.lock(), false);
  assert.ok(w.readout().accuracy < 0.05);
});

test('auto-lock at 12 s, cancel returns the computer, closed gives no result', () => {
  const w = createManualWindow('ascent', cfg);
  w.offer(); w.take();
  const r = run(w, 12.2, 0.1, followTarget);
  assert.equal(w.state, 'locked'); assert.ok(r.events.length <= 1);
  const c = createManualWindow('ascent', cfg); c.offer(); c.take(); run(c, 3, 0.1, followTarget);
  assert.ok(c.cancel()); assert.equal(c.state, 'cancelled'); assert.equal(c.result().flown, false);
  const k = createManualWindow('ascent', cfg); k.offer(); k.take(); k.close(); assert.equal(k.state, 'closed'); assert.equal(k.result().flown, false);
});

test('autolocked event fires exactly once', () => {
  const w = createManualWindow('ascent', cfg); w.offer(); w.take();
  let n = 0;
  for (let i = 0; i < 140; i++) n += w.update(0.1, { noseOffset: w.target }).events.filter((e) => e === 'autolocked').length;
  assert.equal(n, 1);
});

test('accuracy is 1 when the nose follows the target and about 0 when held 8 deg off', () => {
  const a = createManualWindow('ascent', cfg); a.offer(); a.take();
  assert.ok(run(a, 10, 0.05, followTarget).accuracy > 0.99);
  const b = createManualWindow('ascent', cfg); b.offer(); b.take();
  const r = run(b, 10, 0.05, (t, w) => ({ mouse: { x: 0, y: 0 }, noseOffset: { yawDeg: w.target.yawDeg, pitchDeg: w.target.pitchDeg + 8 } }));
  assert.ok(r.accuracy < 0.01, r.accuracy);
});

test('mouse moves the aim with the right signs and clamps at +-10 deg', () => {
  const w = createManualWindow('ascent', cfg); w.offer(); w.take();
  let r = w.update(0.016, { mouse: { x: 100, y: -100 } });
  assert.ok(Math.abs(r.aim.yawDeg - 2) < 1e-9, 'right = +yaw');
  assert.ok(Math.abs(r.aim.pitchDeg - 2) < 1e-9, 'mouse up = +pitch');
  r = w.update(0.016, { mouse: { x: -200, y: 200 } });
  assert.ok(Math.abs(r.aim.yawDeg + 2) < 1e-9 && Math.abs(r.aim.pitchDeg + 2) < 1e-9);
  for (let i = 0; i < 20; i++) r = w.update(0.016, { mouse: { x: 299, y: -299 } });
  assert.equal(r.aim.yawDeg, 10); assert.equal(r.aim.pitchDeg, 10);
  for (let i = 0; i < 20; i++) r = w.update(0.016, { mouse: { x: -299, y: 299 } });
  assert.equal(r.aim.yawDeg, -10); assert.equal(r.aim.pitchDeg, -10);
});

test('target wanders within the configured amplitudes', () => {
  const w = createManualWindow('ascent', cfg); w.offer(); w.take();
  let maxP = 0, maxY = 0;
  for (let i = 0; i < 240; i++) { const r = w.update(0.05, {}); maxP = Math.max(maxP, Math.abs(r.target.pitchDeg)); maxY = Math.max(maxY, Math.abs(r.target.yawDeg)); if (w.state !== 'active') break; }
  assert.ok(maxP > 1 && maxP <= 4.001 && maxY > 1 && maxY <= 3.001, `${maxP} ${maxY}`);
});

test('frame round trip, pitch-up sign and g near up', () => {
  const up = norm(v3(0.3, 0.9, 0.1));
  const guides = [norm(v3(0.5, 0.8, 0.2)), up, norm(v3(0.3, 0.9 + 1e-9, 0.1)), norm(v3(1, 0.1, 0))];
  for (const g of guides) {
    const fr = frameFor(g, up);
    assert.ok(Math.abs(dot(fr.g, fr.p)) < 1e-9 && Math.abs(dot(fr.g, fr.n)) < 1e-9 && Math.abs(dot(fr.n, fr.p)) < 1e-9);
    for (const [y, p] of [[0, 0], [3, -4], [-7, 6], [10, 10]]) {
      const back = offsetsFromDir(fr, dirFromOffsets(fr, y, p));
      assert.ok(Math.abs(back.yawDeg - y) < 0.01 && Math.abs(back.pitchDeg - p) < 0.01, `${y},${p} -> ${back.yawDeg},${back.pitchDeg}`);
    }
    if (dot(g, up) < 0.9999) assert.ok(dot(dirFromOffsets(fr, 0, 5), up) > dot(g, up), 'pitch + raises toward up');
  }
  const fr = frameFor(up, up);
  assert.ok(Math.abs(offsetAngleDeg({ yawDeg: 0, pitchDeg: 0 }, { yawDeg: 3, pitchDeg: 4 }) - 5) < 0.1);
});

test('ascent rating rules via the tracker: computer flew = 1 star, manual accuracy 85/60', () => {
  const orbitFc = () => {
    const R = PLANETS.earth.radius + 200000;
    const fc = new FlightController({ g0: G0, planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 200000, speed: Math.sqrt((PLANETS.earth.g * PLANETS.earth.radius ** 2) / R), flightPathDeg: 0 } });
    fc.liftoffT = 0; fc.phase = 'orbit';
    return fc;
  };
  const rate = (manualAscent) => {
    clearPhaseRatings();
    const done = createPhaseTracker().update(orbitFc(), { manualAscent });
    assert.equal(done.length, 1);
    return getPhaseRatings()[0];
  };
  const none = rate(null);
  assert.equal(none.stars, 1); assert.equal(none.stats.manualFlown, false); assert.equal(none.stats.manualAccuracyPct, null);
  assert.ok('avgDeviationDeg' in none.stats && 'fuelLeftPct' in none.stats && 'peakG' in none.stats);
  assert.match(none.text, /flown by the computer/);
  const hi = rate({ flown: true, accuracyPct: 90 });
  assert.equal(hi.stats.manualFlown, true); assert.equal(hi.stats.manualAccuracyPct, 90); assert.match(hi.text, /manual accuracy 90 %/);
  assert.ok(hi.stars >= 1 && hi.stars <= 3);
  assert.equal(rateAscent({ fuelLeftPct: 30, peakG: 3, manualFlown: true, manualAccuracyPct: 85 }).stars, 3);
  assert.equal(rateAscent({ fuelLeftPct: 30, peakG: 3, manualFlown: true, manualAccuracyPct: 84 }).stars, 2);
  assert.equal(rateAscent({ fuelLeftPct: 30, peakG: 3, manualFlown: true, manualAccuracyPct: 60 }).stars, 2);
  assert.equal(rateAscent({ fuelLeftPct: 30, peakG: 3, manualFlown: true, manualAccuracyPct: 59 }).stars, 1);
  clearPhaseRatings();
});

console.log(failed ? `${failed} FAILED` : 'all manual-control tests passed');
process.exit(failed ? 1 : 0);
