// Node tests for the polish features: ground marks, prebreathe, visor dust. Run: node src/surface/tests/polish.test.mjs
import assert from 'node:assert/strict';
import { createRingCursor, createDistanceSampler, createStepper, TRACK_SPACING, STEP_STRIDE } from '../groundMarks.js';
import { createShipInterior, resolveStations, PREBREATHE_S, AIRLOCK_CYCLE_SECONDS } from '../shipInterior.js';
import { createVisorDust, MAX_DUST_OPACITY } from '../visorDust.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };

test('track points are dropped every 0.25 m of travel, not before', () => {
  const smp = createDistanceSampler(TRACK_SPACING);
  assert.equal(smp.update(0, 0), null); // first call only records the start
  assert.equal(smp.update(0.1, 0), null);
  assert.equal(smp.update(0.2, 0), null);
  const p = smp.update(0.26, 0);
  assert.ok(p && p.fromX === 0 && p.x === 0.26);
  let n = 0;
  for (let x = 0.27; x <= 10; x += 0.01) if (smp.update(x, 0)) n++;
  assert.ok(n >= 36 && n <= 41, `${n} points over ~10 m`);
});

test('a teleport (more than 5 m in one step) restarts the trail instead of drawing a ribbon', () => {
  const smp = createDistanceSampler(TRACK_SPACING);
  smp.update(0, 0);
  assert.equal(smp.update(50, 0), null);
  assert.ok(smp.update(50.3, 0));
});

test('ring buffer is capped and overwrites the oldest slot', () => {
  const ring = createRingCursor(5);
  const seen = [];
  for (let i = 0; i < 12; i++) seen.push(ring.next());
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
  assert.equal(ring.count, 5);
});

test('boot prints alternate left/right every 0.7 m and carry the walking direction', () => {
  const st = createStepper(STEP_STRIDE);
  const prints = [];
  for (let z = 0; z >= -5; z -= 0.05) { const p = st.update(0, z); if (p) prints.push(p); }
  assert.ok(prints.length >= 6 && prints.length <= 8, `${prints.length} prints over 5 m`);
  prints.forEach((p, i) => { if (i) assert.notEqual(p.side, prints[i - 1].side); });
  assert.ok(Math.abs(prints[0].dirZ + 1) < 1e-9 && Math.abs(prints[0].dirX) < 1e-9, 'walking toward -Z');
  assert.ok(Math.abs(prints[1].z - prints[0].z) >= STEP_STRIDE - 1e-9);
});

// ---- prebreathe ----
const mkBus = () => { const log = []; return { log, emit: (n, p) => log.push([n, p]), names: () => log.map(([n]) => n) }; };
function mkCabin(opts = {}) {
  const bus = mkBus(), defs = new Map(), notices = [];
  const reg = { register: (def) => { defs.set(def.id, def); return () => {}; }, defs };
  let exited = 0;
  const cabin = createShipInterior({ bus, interactables: reg, prebreatheState: { done: false }, onExit: () => exited++, onNotice: (t, d) => notices.push([t, d?.stage]), ...opts });
  cabin.suited = true;
  return { bus, cabin, notices, exited: () => exited, reg, run: (s, pos, dt = 0.1) => { for (let t = 0; t < s - 1e-9; t += dt) cabin.update(dt, pos); } };
}
const airlockUse = (c) => c.reg.defs.get('airlock').onUse();

test('prebreathe: counts down PREBREATHE_S, then the 3 s cycle runs, then onExit', () => {
  assert.equal(PREBREATHE_S, 10);
  const c = mkCabin();
  airlockUse(c);
  assert.ok(c.cabin.prebreathe && Math.abs(c.cabin.prebreathe.remaining - 10) < 1e-9);
  assert.equal(c.cabin.airlockProgress, 0);
  c.run(7.0);
  assert.ok(Math.abs(c.cabin.prebreathe.remaining - 3) < 0.15, `${c.cabin.prebreathe.remaining}`);
  assert.equal(c.exited(), 0);
  c.run(3.2);
  assert.equal(c.cabin.prebreathe, null);
  assert.ok(c.cabin.airlockProgress > 0, 'airlock cycle started right after');
  c.run(AIRLOCK_CYCLE_SECONDS + 0.2);
  assert.equal(c.exited(), 1);
});

test('prebreathe: pressing E again cancels it cleanly, and it can be restarted', () => {
  const c = mkCabin();
  airlockUse(c);
  c.run(2);
  airlockUse(c);
  assert.equal(c.cabin.prebreathe, null);
  assert.equal(c.cabin.airlockProgress, 0);
  assert.ok(c.notices.some(([t, s]) => t === 'prebreathe' && s === 'cancelled'));
  c.run(5);
  assert.equal(c.exited(), 0);
  airlockUse(c);
  assert.ok(c.cabin.prebreathe && c.cabin.prebreathe.remaining === 10);
});

test('prebreathe: walking away from the airlock cancels it', () => {
  const c = mkCabin();
  const a = resolveStations().airlock;
  airlockUse(c);
  c.run(1, { x: a.x, z: a.z - 0.5 });
  assert.ok(c.cabin.prebreathe);
  c.run(0.2, { x: 0, z: a.z - 6 });
  assert.equal(c.cabin.prebreathe, null);
  c.run(15, { x: 0, z: a.z - 6 });
  assert.equal(c.exited(), 0);
});

test('prebreathe is skipped after a completed one (same mission), and the debug length is short', () => {
  const state = { done: false };
  const c = mkCabin({ prebreatheState: state, prebreatheSeconds: 1 });
  airlockUse(c);
  c.run(1.2);
  assert.equal(state.done, true);
  c.run(AIRLOCK_CYCLE_SECONDS + 0.2);
  assert.equal(c.exited(), 1);
  airlockUse(c); // second trip out: straight to the cycle
  assert.equal(c.cabin.prebreathe, null);
  c.run(0.2);
  assert.ok(c.cabin.airlockProgress > 0);
});

test('prebreathe: unsuited player cannot start it; interior:interact still fires on every use', () => {
  const c = mkCabin();
  c.cabin.suited = false;
  airlockUse(c);
  assert.equal(c.cabin.prebreathe, null);
  assert.deepEqual(c.bus.log.filter(([n]) => n === 'interior:interact').map(([, p]) => p.stationId), ['airlock']);
});

// ---- visor dust ----
test('visor dust: accumulates faster driving than walking, scales with speed, ignores standing still', () => {
  const walk = createVisorDust(), drive = createVisorDust(), still = createVisorDust();
  for (let i = 0; i < 60; i++) { walk.accumulate(0.1, { speed: 1.5, mode: 'walk' }); drive.accumulate(0.1, { speed: 3.6, mode: 'drive' }); still.accumulate(0.1, { speed: 0 }); }
  assert.ok(drive.level > walk.level * 4, `${drive.level} vs ${walk.level}`);
  assert.equal(still.level, 0);
  const slow = createVisorDust(), fast = createVisorDust();
  slow.accumulate(10, { speed: 1, mode: 'drive' }); fast.accumulate(10, { speed: 3, mode: 'drive' });
  assert.ok(fast.level > slow.level * 2.9);
});

test('visor dust: bursts add, level and overlay opacity are capped, clear() wipes it', () => {
  const d = createVisorDust();
  d.burst(0.2);
  assert.ok(Math.abs(d.level - 0.2) < 1e-9);
  d.burst(5);
  for (let i = 0; i < 1000; i++) d.accumulate(1, { speed: 4, mode: 'drive' });
  assert.equal(d.level, 1);
  assert.ok(d.opacity <= MAX_DUST_OPACITY + 1e-12 && MAX_DUST_OPACITY <= 0.35);
  d.clear();
  assert.equal(d.level, 0);
  assert.equal(d.opacity, 0);
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} polish tests passed`);
process.exit(fails ? 1 : 0);
