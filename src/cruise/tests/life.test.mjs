// The crew's life in the cruise (src/cruise/life.js): leak physics, storm shielding, CO₂ in a sealed cabin, the
// LiOH backup running out, the oxygen-tank emergency, notes. Node only:  node src/cruise/tests/life.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chokedAirKgPerDay, co2RisePerDay, createCruiseLife, leakFrom, sealDays, seededRng, stormDoseBehind } from '../life.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(HERE, '../data.json'), 'utf8'));
const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['fail', name, e]); } };
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

// a hand-made traits.life: one 14 kg bottle, an open LiOH loop, a 4 m³ cabin
const life = (over = {}) => ({
  crew: 1,
  cabin: { cabinM3: 4, o2MassShare: 0.232, ...over.cabin },
  o2: { tanks: over.tanks ?? [{ partId: 'b0', unit: 0, kind: 'steel_hp', kg: 14, residualKg: 4.34, leakPerDay: 0.000015 }] },
  co2: { units: over.units ?? [{ id: 'loop', kind: 'lioh', regenerable: false, failPerTrip: 0.001, mmHg: 2, peakmmHg: 4, planned: true }], lethalmmHg: 60, riggedmmHg: 15, afterFailuremmHg: 4, limitmmHg: 3, co2KgPerDay: 1.04 },
  water: { recovery: over.recovery ?? 0, needKgPerDay: 3, bufferDays: 7 },
  radiation: { wallGcm2: 5, shelterGcm2: 14.75, improvisedGcm2: 10.2, gcrFactor: 0.975, careerLimitMsv: 600, thirtyDayLimitMsv: 250 },
  words: {},
});
const cfg = { ...data.life, doseMsvPerDay: data.doseMsvPerDay };
const fly = (c, days = 259, step = 1) => { let f = null; for (let d = 0; d < days && !f; d += step) f = c.step(step); return f; };

test('a hole in the cabin: choked flow, about 0.14 g/s per mm² at sea-level pressure (Cd 0.6)', () => {
  near(chokedAirKgPerDay(1) / 86400 * 1000, 0.144, 0.005, 'g/s');
  near(chokedAirKgPerDay(3.14), 39, 1, 'a 2 mm hole (Soyuz MS-09) kg/day');
  near(chokedAirKgPerDay(1, { kPa: 34.5 }) / chokedAirKgPerDay(1), 34.5 / 101.3, 1e-9, 'scales with cabin pressure');
});

test('the structure group\'s leak record, in any of its shapes', () => {
  assert.equal(leakFrom(null), null);
  assert.equal(leakFrom({}), null);
  near(leakFrom({ cabinLeak: { kgPerDay: 12, partId: 'p1' } }).airKgPerDay, 12, 1e-9);
  assert.equal(leakFrom({ cabinLeak: { kgPerDay: 12, partId: 'p1' } }).partId, 'p1');
  near(leakFrom({ cabinLeakKgPerDay: 5 }).airKgPerDay, 5, 1e-9);
  near(leakFrom({ cabinLeak: { holeMm2: 1 } }).airKgPerDay, chokedAirKgPerDay(1), 1e-9);
});

test('the storm: the cruise\'s 150 mSv behind 5 g/cm², falling e-fold every 8 g/cm² (Townsend TM-100620)', () => {
  const ref = { refMsv: data.solarStorm.doseIgnored, refGcm2: data.solarStorm.doseRefGcm2, lambda: data.solarStorm.attenuationGcm2 };
  assert.equal(data.solarStorm.attenuationGcm2, 8);
  near(stormDoseBehind(5, ref), 150, 1e-9);
  near(stormDoseBehind(10.2, ref), 150 * Math.exp(-5.2 / 8), 1e-9, 'behind the food and water');
  near(stormDoseBehind(14.75, ref), 44, 1, 'in the 600 kg water shelter');
  near(stormDoseBehind(13, ref) / stormDoseBehind(5, ref), Math.exp(-1), 1e-9, 'one e-fold from 5 to 13 g/cm²');
  const c = createCruiseLife(life(), { rng: seededRng('s'), cfg });
  const d = c.storm('ignored', ref);
  assert.equal(d, 150);
  assert.equal(c.dose, 150);
});

test('CO₂ in a sealed 4 m³ cabin rises about 109 mmHg a day: a scrubber failure must be met within hours', () => {
  near(co2RisePerDay(1.04, 4), (1.04 / 0.044) * 8.314 * 295 / 4 / 1000 * 7.50062, 1e-6); // 23.6 mol/day · RT / V
  near(co2RisePerDay(1.04, 4), 109, 1);
  near(co2RisePerDay(1.04, 8), 54, 1, 'twice the cabin, half the rise');
});

test('a regenerable primary with only LiOH canisters as backup: fine for 16 days, then the canisters are spent', () => {
  const units = [{ id: 'loop', kind: 'zeolite', regenerable: true, failPerTrip: 1, mmHg: 3, peakmmHg: 3.5 }, { id: 'p9', kind: 'lioh', regenerable: false, crewDays: 15.9, failPerTrip: 0.001, mmHg: 2, peakmmHg: 4 }];
  const c = createCruiseLife(life({ units }), { tripDays: 259, rng: () => 0.5, cfg }); // fails on day 129.5
  const f = fly(c);
  assert.equal(f?.endingId, 'outOfBreath');
  assert.match(f.cause, /ran out/);
  near(c.day, 129.5 + 15.9, 1.5, 'day');
  const late = createCruiseLife(life({ units }), { tripDays: 259, rng: (() => { const xs = [0, 0.99]; return () => xs.shift() ?? 0.5; })(), cfg }); // fails on day 256
  assert.equal(fly(late), null, 'a failure near Mars: the canisters last to arrival');
});

test('an open LiOH loop with LiOH canisters as backup: when the backup is spent, the trip\'s own canisters are rigged', () => {
  const units = [{ id: 'loop', kind: 'lioh', regenerable: false, failPerTrip: 1, mmHg: 2, peakmmHg: 4, planned: true }, { id: 'p9', kind: 'lioh', regenerable: false, crewDays: 15.9, failPerTrip: 0.001, mmHg: 2, peakmmHg: 4 }];
  const c = createCruiseLife(life({ units }), { tripDays: 259, rng: () => 0.3, cfg }); // fails on day 77.7
  assert.equal(fly(c), null, 'everyone lives');
  const s = c.summary();
  assert.equal(s.scrubber.by, 'rigged');
  near(s.scrubber.spentDay, 77.7 + 15.9, 0.2, 'spent day');
  assert.equal(s.co2PeakmmHg, 15);
  const alone = createCruiseLife(life({ units: units.slice(0, 1) }), { tripDays: 259, rng: () => 0.3, cfg });
  assert.equal(fly(alone), null, 'and the same ship without the canisters lives too');
});

test('time to seal: about a day for a slow leak (Soyuz MS-09), minutes for a hole the crew can hear', () => {
  near(sealDays(1, cfg), 1, 1e-9, 'a 1 mm² hole');
  near(sealDays(3.14, cfg), 1, 1e-9, 'MS-09\'s 2 mm hole');
  near(sealDays(10, cfg) * 1440, 30, 1e-6, 'an audible 10 mm² hole: half an hour');
  near(sealDays(32, cfg) * 1440, 15, 1e-6, 'a 32 mm² hole: the 15-minute floor');
  assert.ok(sealDays(5, cfg) < 1 && sealDays(5, cfg) > sealDays(10, cfg), 'in between, the bigger hole is found sooner');
  near(leakFrom({ cabinLeak: { kgPerDay: chokedAirKgPerDay(8) } }).holeMm2, 8, 1e-9, 'a rate turns back into its hole');
});

test('a big hole: 32 mm² leaks about 400 kg of air a day, but it is sealed in 15 minutes and costs about 1 kg of O₂', () => {
  const big = leakFrom({ cabinLeak: { holeMm2: 32, partId: 'p1' } });
  near(big.airKgPerDay, 398, 5);
  const c = createCruiseLife(life(), { rng: seededRng('big'), leak: big, cfg });
  fly(c, 3, 0.25);
  const lost = c.summary().lost.leak;
  near(lost, big.airKgPerDay * (15 / 1440) * 0.232, 0.001); // the summary keeps grams
  assert.ok(lost < 1.5 && c.usableKg > 8, `${lost} kg of oxygen lost, ${c.usableKg} kg usable left`);
  const note = c.notes().find((n) => n.what === 'cabinLeak');
  assert.ok(note && note.hours === 0.3 && note.holeMm2 === 32 && note.partId === 'p1');
  const slow = createCruiseLife(life(), { rng: seededRng('slow'), leak: leakFrom({ cabinLeak: { holeMm2: 1 } }), cfg });
  fly(slow, 3, 0.25);
  near(slow.summary().lost.leak, chokedAirKgPerDay(1) * 1 * 0.232, 0.001, 'the slow leak still runs its full day');
});

test('a cabin leak takes its nitrogen from the allowance kept for refilling the cabin on Mars', () => {
  const l = life();
  l.o2.n2 = { kg: 30, perTripKg: 3.65, exitKgNoN2: 1.8 };
  const c = createCruiseLife(l, { rng: seededRng('n2'), leak: { airKgPerDay: 10 }, cfg });
  fly(c, 5);
  near(c.summary().n2Kg, 30 - 10 * 0.768, 1e-6);
  near(c.summary().lost.leak, 10 * 0.232, 1e-6);
  assert.equal(createCruiseLife(life(), { rng: seededRng('n2'), cfg }).summary().n2Kg, undefined, 'a pure-oxygen cabin has no nitrogen to track');
});

test('the oxygen-tank emergency: wrong answers vent the tank on the damaged line', () => {
  const one = createCruiseLife(life(), { rng: seededRng('m'), cfg });
  one.malfunctionAttempt(false); one.malfunctionAttempt(true);
  near(one.summary().lost.malfunction, 14 * 0.25, 1e-6);
  const two = createCruiseLife(life({ tanks: [0, 1].map((i) => ({ partId: `b${i}`, unit: 0, kind: 'steel_hp', kg: 7, residualKg: 2.17, leakPerDay: 0 })) }), { rng: seededRng('m'), cfg });
  two.malfunctionAttempt(false); two.malfunctionAttempt(true);
  near(two.summary().lost.malfunction, 7 * 0.25, 1e-6, 'separate bottles: only one vents');
  assert.ok(two.notes().some((n) => n.what === 'malfunctionHeld'));
});

test('the dose, the water note and the arrival summary', () => {
  const c = createCruiseLife(life({ recovery: 0.98 }), { tripDays: 259, rng: seededRng('d'), cfg });
  fly(c, 259, 5);
  near(c.dose, 1.8 * 0.975 * 259, 0.5);
  const notes = c.notes();
  const w = notes.find((n) => n.what === 'water');
  assert.ok(w && w.value === 0.98 && w.carried < w.open / 10, `${w?.carried} of ${w?.open} kg`);
  const sum = c.summary();
  assert.ok(sum.tanks.length === 1 && sum.usableKg < sum.startUsableKg && sum.day === 259);
  assert.ok(notes.every((n) => n.group === 'life' && typeof n.what === 'string'));
  assert.ok(JSON.parse(JSON.stringify(sum)));
});

test('seeded: the same flight id gives the same cruise', () => {
  const a = seededRng('f123|cruise'), b = seededRng('f123|cruise');
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.notEqual(seededRng('f1')(), seededRng('f2')());
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} cruise life tests passed`);
process.exit(fails ? 1 : 0);
