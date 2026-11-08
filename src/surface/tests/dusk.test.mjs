// Node tests for the Mars dusk / Pale Blue Dot logic and the debug oxygen shortcut. Run: node src/surface/tests/dusk.test.mjs
import assert from 'node:assert/strict';
import { createSolClock, sunAt, easeFov, angleToEarthDeg, isLookingAtEarth, createEarthCaption, EARTH_DIRECTION,
  DAY_ELEVATION, DUSK_ELEVATION, DUSK_AFTER_S, FAST_DUSK_S, FAST_DUSK_AFTER_S, shouldStartFastDusk, fastDuskMission, resetFastDusk, NORMAL_FOV, ZOOM_FOV } from '../dusk.js';
import { createOxygen } from '../oxygen.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };

test('sun starts at the landing day elevation and ends at dusk', () => {
  assert.equal(sunAt(0).elevation, DAY_ELEVATION);
  assert.ok(Math.abs(sunAt(1).elevation - DUSK_ELEVATION) < 1e-9);
  assert.ok(sunAt(0.5).elevation < DAY_ELEVATION && sunAt(0.5).elevation > DUSK_ELEVATION);
});

test('sol clock reaches dusk after DUSK_AFTER_S seconds and stays there', () => {
  const clock = createSolClock({ apply() {} });
  assert.equal(clock.isDusk, false);
  for (let t = 0; t < DUSK_AFTER_S + 10; t += 0.1) clock.update(0.1);
  assert.equal(clock.progress, 1);
  assert.equal(clock.isDusk, true);
  assert.ok(Math.abs(clock.elevation - DUSK_ELEVATION) < 1e-9);
});

test('sun updates are throttled to about 4 per second', () => {
  let n = 0;
  const clock = createSolClock({ apply() { n++; } });
  for (let i = 0; i < 600; i++) clock.update(1 / 60); // 10 s at 60 fps
  assert.ok(n >= 38 && n <= 41, `${n} updates in 10 s`);
});

test('debug jump goes straight to dusk and applies immediately', () => {
  const calls = [];
  const clock = createSolClock({ apply: (e, a) => calls.push([e, a]) });
  clock.jumpToDusk();
  assert.equal(clock.isDusk, true);
  assert.ok(Math.abs(calls.at(-1)[0] - DUSK_ELEVATION) < 1e-9);
  assert.equal(clock.update(0.01), false); // nothing left to change
});

test('zoom eases toward the zoomed FOV and back, and settles exactly', () => {
  let fov = NORMAL_FOV;
  for (let i = 0; i < 90; i++) { const next = easeFov(fov, true, 1 / 30); assert.ok(next <= fov); fov = next; }
  assert.equal(fov, ZOOM_FOV);
  for (let i = 0; i < 60; i++) fov = easeFov(fov, false, 1 / 30);
  assert.equal(fov, NORMAL_FOV);
  const mid = easeFov(NORMAL_FOV, true, 0.05);
  assert.ok(mid < NORMAL_FOV && mid > ZOOM_FOV);
});

test('looking at Earth: within 3 degrees and zoomed only', () => {
  assert.ok(angleToEarthDeg(EARTH_DIRECTION) < 1e-3);
  assert.ok(isLookingAtEarth(EARTH_DIRECTION, 8));
  assert.equal(isLookingAtEarth(EARTH_DIRECTION, 70), false);
  const tilt = (deg) => { const r = (deg * Math.PI) / 180; return { x: EARTH_DIRECTION.x, y: EARTH_DIRECTION.y + Math.tan(r) * Math.hypot(EARTH_DIRECTION.x, EARTH_DIRECTION.z), z: EARTH_DIRECTION.z }; };
  assert.ok(isLookingAtEarth(tilt(2), 8));
  assert.equal(isLookingAtEarth(tilt(5), 8), false);
  assert.equal(isLookingAtEarth({ x: 0, y: 0, z: 1 }, 8), false);
});

test('Earth caption shows once for 8 s per mission', () => {
  const c = createEarthCaption({ seconds: 8 });
  assert.equal(c.update(0.1, false), false);
  assert.equal(c.update(0.1, true), true);
  for (let i = 0; i < 90; i++) c.update(0.1, true);
  assert.equal(c.visible, false);
  assert.equal(c.update(0.1, true), false); // never again
});

test('oxygen.debugSetPercent sets the tank, publishes and walks through the cautions', () => {
  const events = [];
  const o2 = createOxygen({ bus: { emit: (n, d) => events.push([n, d]) }, tankSeconds: 300 });
  o2.debugSetPercent(32);
  assert.ok(Math.abs(o2.percent - 32) < 1e-9);
  assert.equal(o2.level, 'ok');
  assert.equal(events.at(-1)[1].percent, 32);
  o2.update(7, { inside: false }); // 32 % - 2.33 % = 29.7 %
  assert.equal(o2.level, 'caution');
  o2.debugSetPercent(-5);
  assert.equal(o2.percent, 0);
  o2.debugSetPercent(500);
  assert.equal(o2.percent, 100);
});

test('debugSetPercent does not revive a depleted suit', () => {
  const o2 = createOxygen({ tankSeconds: 10 });
  o2.update(11, { inside: false });
  assert.equal(o2.depleted, true);
  o2.debugSetPercent(50);
  assert.equal(o2.percent, 0);
});

test('fast dusk trigger mirrors Role 4: 30 percent, 25 s outside, once, not at dusk', () => {
  const ok = { percent: 30, secondsOutside: FAST_DUSK_AFTER_S };
  assert.equal(shouldStartFastDusk(ok), true);
  assert.equal(shouldStartFastDusk({ ...ok, percent: 29 }), false);
  assert.equal(shouldStartFastDusk({ ...ok, secondsOutside: 24 }), false);
  assert.equal(shouldStartFastDusk({ ...ok, started: true }), false);
  assert.equal(shouldStartFastDusk({ ...ok, isDusk: true }), false);
  assert.ok(FAST_DUSK_AFTER_S < 30);
});

test('fast dusk eases from the current sun to dusk in FAST_DUSK_S and then the clock stays at dusk', () => {
  const seen = [];
  const clock = createSolClock({ apply: (e) => seen.push(e) });
  for (let t = 0; t < 100; t += 0.1) clock.update(0.1);
  const before = clock.elevation;
  assert.equal(clock.startFastDusk(), true);
  assert.equal(clock.startFastDusk(), false);
  assert.ok(Math.abs(clock.elevation - before) < 1e-9);
  let prev = before;
  for (let t = 0; t < FAST_DUSK_S / 2; t += 0.1) { clock.update(0.1); assert.ok(clock.elevation <= prev + 1e-9); prev = clock.elevation; }
  assert.equal(clock.isDusk, false);
  for (let t = 0; t < FAST_DUSK_S / 2 + 0.5; t += 0.1) clock.update(0.1);
  assert.equal(clock.isDusk, true);
  assert.ok(Math.abs(clock.elevation - DUSK_ELEVATION) < 1e-9);
  assert.equal(clock.fastDusk, false);
  assert.equal(clock.progress, 1);
  assert.equal(clock.startFastDusk(), false);
});

test('fast dusk does nothing when it is already dusk', () => {
  const clock = createSolClock({ apply() {} });
  clock.jumpToDusk();
  assert.equal(clock.startFastDusk(), false);
});

test('the once-per-mission flag resets', () => {
  fastDuskMission.started = true;
  resetFastDusk();
  assert.equal(fastDuskMission.started, false);
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} dusk tests passed`);
process.exit(fails ? 1 : 0);
