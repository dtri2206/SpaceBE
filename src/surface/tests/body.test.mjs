// Node tests for body stats. Run: node src/surface/tests/body.test.mjs
import assert from 'node:assert/strict';
import { createBodyStats, DOSE_RATE_MSV_PER_DAY, BODY_TUNING } from '../bodyStats.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const mkBus = () => { const log = []; return { log, emit: (n, p) => log.push([n, p]) }; };

test('a 180-day cruise at 1.8 mSv/day gives ~324 mSv (Curiosity RAD rate)', () => {
  const b = createBodyStats();
  for (let d = 0; d < 180; d++) b.update(1, { env: 'cruise', daysPerSecond: 1 }); // 1 real s = 1 game day (time warp)
  assert.ok(Math.abs(b.doseMSv - 324) < 1e-6, `${b.doseMSv}`);
});

test('Mars surface dose rate is lower than deep space; the cabin a bit lower still', () => {
  assert.ok(DOSE_RATE_MSV_PER_DAY.mars < DOSE_RATE_MSV_PER_DAY.cruise);
  assert.ok(DOSE_RATE_MSV_PER_DAY.cabin_mars < DOSE_RATE_MSV_PER_DAY.mars);
});

test('solar storm multiplies the dose; the shelter cuts it by the shelter factor; no storm effect on the surface', () => {
  const open = createBodyStats(), shelter = createBodyStats(), surface = createBodyStats();
  open.update(1, { env: 'cruise', solarStorm: true, daysPerSecond: 1 });
  shelter.update(1, { env: 'cruise', solarStorm: true, inShelter: true, daysPerSecond: 1 });
  surface.update(1, { env: 'mars', solarStorm: true, daysPerSecond: 1 });
  assert.ok(Math.abs(open.doseMSv - 1.8 * BODY_TUNING.stormMultiplier) < 1e-9);
  assert.ok(Math.abs(shelter.doseMSv / open.doseMSv - BODY_TUNING.shelterFactor) < 1e-9);
  assert.ok(Math.abs(surface.doseMSv - DOSE_RATE_MSV_PER_DAY.mars) < 1e-9);
});

test('alerts fire once: high dose, career limit, g peak', () => {
  const alerts = [];
  const b = createBodyStats({ onNotice: (type, p) => alerts.push(p.type) });
  for (let i = 0; i < 10; i++) b.update(1, { env: 'cruise', solarStorm: true, gLoad: 6, daysPerSecond: 1 });
  assert.deepEqual(alerts.sort(), ['g_peak', 'radiation_career_limit', 'radiation_high']);
  assert.equal(b.peakG, 6);
});

test('fatigue rises with hard work and recovers at rest, stays within 0..1', () => {
  const b = createBodyStats();
  for (let i = 0; i < 600; i++) b.update(1, { env: 'mars', heartRate: 140 });
  const tired = b.fatigue;
  for (let i = 0; i < 600; i++) b.update(1, { env: 'mars', heartRate: 70 });
  assert.ok(tired > 0.5 && tired <= 1, `${tired}`);
  assert.ok(b.fatigue < tired);
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} body tests passed`);
process.exit(fails ? 1 : 0);
