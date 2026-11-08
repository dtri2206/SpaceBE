// Life support on Mars (wave 5): the suit's oxygen in kilograms, refills from the ship's tanks, the gas each trip
// outside vents, the prebreathe by cabin air, and the old seconds model when a ship has no traits.
//   node src/surface/tests/lifeEffects.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOxygen, lifeOxygen } from '../oxygen.js';
import { createShipInterior, CABIN, AIRLOCK_CYCLE_SECONDS, PREBREATHE_S, resetPrebreathe, setCabinAir, prebreatheFor } from '../shipInterior.js';
import { createInteractables } from '../interactables.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const { lifeTraits } = await import(pathToFileURL(path.join(ROOT, 'src/builder/traits/life.js')).href);
const lifeData = JSON.parse(readFileSync(path.join(ROOT, 'src/builder/traits/life.json'), 'utf8'));

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['fail', name, e]); } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const mkBus = () => { const log = []; return { log, emit: (n, d) => log.push([n, d]) }; };

// a small ship: a capsule (with its kit) and parts; the def flags are the builder's
const capsule = (type = 'capsule_m', options = {}) => ({ id: 'c', type, def: { internals: 'capsule', flags: { capsule: true } }, options });
const part = (id, type, flags, mass = 80) => ({ id, type, def: { flags, mass, name: type } });
const KIT = { lifeSupport: { open: { id: 'open' }, regenerative: { id: 'regenerative' } }, atmosphere: { mixed: { id: 'mixed' }, pure_o2: { id: 'pure_o2' } } };
const traits = (layout) => lifeTraits(layout, { optionsOf: (e) => ({ lifeSupport: KIT.lifeSupport[e.options?.lifeSupport ?? 'open'], atmosphere: KIT.atmosphere[e.options?.atmosphere ?? 'mixed'] }) }, lifeData);
const bottles = (n) => Array.from({ length: n }, (_, i) => part(`b${i}`, 'o2_bottle', { spareO2Tanks: 1 }));
const reliable = traits([capsule(), ...bottles(2)]);

test('the EMU on one fill: 300 game seconds of walking = 7.3 real hours, cautions at 30/15/5 %, 0 % = outOfBreath', () => {
  const bus = mkBus();
  const o2 = createOxygen({ bus, life: lifeOxygen(reliable) });
  near(o2.kg, 0.544, 1e-9, 'kg');
  near(o2.secondsLeft, 300, 1e-6, 'seconds');
  o2.update(50, { inside: true });
  assert.equal(o2.percent, 100);
  o2.update(10, { running: true });
  near(o2.percent, 100 - (100 * 10 * reliable.suit.runMultiplier) / 300, 1e-6, 'running 1.6×');
  for (let i = 0; i < 300; i++) o2.update(1, {});
  const levels = bus.log.filter(([n]) => n === 'eva:oxygen').map(([, p]) => p.level);
  for (const l of ['caution', 'warning', 'critical']) assert.ok(levels.includes(l), l);
  assert.ok(bus.log.some(([n, p]) => n === 'flight:failed' && p.endingId === 'outOfBreath'));
  const st = o2.stats();
  near(st.breathedKg, 0.544, 1e-6, 'all of it breathed');
  near(st.minutesOutside, (300 - 6) * reliable.suit.evaScale / 60, 1, 'real minutes outside');
});

test('refills follow the kilograms: each trip vents the cabin, the station tops the suit up, the count falls', () => {
  const o2 = createOxygen({ life: lifeOxygen(reliable) });
  const trips0 = o2.spareTanks;
  assert.equal(trips0, reliable.o2.refills);
  const store0 = o2.storeKg;
  o2.useAirlock(); // out through the cabin
  near(store0 - o2.storeKg, reliable.cabin.exitKg + reliable.o2.cabinKgPerTrip, 1e-6, 'the cabin air, and the cabin breathing for the rest of the sol');
  o2.update(150, {}); // half the suit
  const before = o2.storeKg;
  assert.equal(o2.swapTank(), true);
  near(before - o2.storeKg, 0.272, 1e-3, 'only what was used');
  assert.equal(o2.percent, 100);
  assert.ok(o2.spareTanks < trips0);
  assert.equal(o2.stats().refills, 1);
});

test('an empty store: a last partial top-up, then the station has nothing', () => {
  const life = lifeOxygen(traits([capsule('capsule_orion'), ...bottles(1)]));
  const o2 = createOxygen({ life });
  let trips = 0;
  while (o2.storeKg > 0.001 && trips < 50) { o2.useAirlock(); o2.update(300, {}); o2.refill(); trips++; } // each trip: the cabin, a whole suit
  assert.ok(trips >= 1 && trips <= 6, `${trips} trips`);
  o2.update(100, {});
  assert.equal(o2.swapTank(), false, 'nothing left to give');
});

test('trade-offs: an airlock and a small cabin give more trips outside; a pure-oxygen cabin fewer', () => {
  const trips = (layout) => createOxygen({ life: lifeOxygen(traits(layout)) }).spareTanks;
  const base = trips([capsule('capsule_orion'), ...bottles(2)]);
  assert.ok(trips([capsule('capsule_orion'), ...bottles(2), part('a', 'volga_airlock', { airlock: true }, 250)]) > base, 'airlock');
  assert.ok(trips([capsule('capsule_mercury'), ...bottles(2)]) > base, 'small cabin');
  assert.ok(trips([capsule('capsule_orion', { atmosphere: 'pure_o2' }), ...bottles(2)]) < base, 'pure oxygen');
  assert.ok(trips([capsule('capsule_orion'), part('t', 'o2_tank_l', { spareO2Tanks: 2 }, 150)]) > base, 'the double tank');
  assert.ok(trips([capsule('capsule_m', { lifeSupport: 'regenerative' }), ...bottles(2)]) > trips([capsule('capsule_m'), ...bottles(2)]), 'the regenerative loop breathes for the cabin');
  assert.equal(trips([capsule('capsule_orion', { lifeSupport: 'regenerative' }), ...bottles(2)]), base, 'but a big sea-level cabin runs out of nitrogen first');
});

test('nitrogen: each emptying of a sea-level cabin loses it; with none left, the cabin is refilled with 5 psi of oxygen', () => {
  const life = lifeOxygen(traits([capsule('capsule_m'), part('t', 'o2_tank_l', { spareO2Tanks: 2 }, 150)]));
  const o2 = createOxygen({ life });
  near(life.n2.kg, 30, 1e-9);
  const costs = [];
  for (let i = 0; i < 10; i++) { const before = o2.storeKg; o2.useAirlock(); costs.push(before - o2.storeKg); }
  const st = o2.stats();
  assert.equal(st.n2OutAfter, 8, 'the 30 kg lasts 8 emptyings of 3.65 kg');
  near(st.n2VentedKg, 30, 1e-6);
  assert.ok(costs[9] > costs[0] + 0.6, `oxygen per trip after the nitrogen: ${costs[9].toFixed(2)} vs ${costs[0].toFixed(2)} kg`);
  const pure = createOxygen({ life: lifeOxygen(traits([capsule('capsule_m', { atmosphere: 'pure_o2' }), ...bottles(1)])) });
  assert.equal(pure.stats().n2Kg, 0, 'a pure-oxygen cabin has no nitrogen to lose');
});

test('the regenerative loop: the tanks pay only the suit and the vented air', () => {
  const regen = traits([capsule('capsule_m', { lifeSupport: 'regenerative' }), ...bottles(2)]);
  const o2 = createOxygen({ life: lifeOxygen(regen) });
  const before = o2.storeKg;
  o2.useAirlock();
  near(before - o2.storeKg, regen.cabin.exitKg, 1e-6);
  assert.ok(o2.spareTanks > createOxygen({ life: lifeOxygen(reliable) }).spareTanks);
});

test('the cruise\'s losses arrive with the ship: fewer trips after the tanks lost oxygen', () => {
  const full = createOxygen({ life: lifeOxygen(reliable) });
  const cruise = { tanks: reliable.o2.tanks.map((t) => ({ partId: t.partId, unit: t.unit, kg: t.partId === 'b0' ? 5 : t.kg })) };
  const after = createOxygen({ life: lifeOxygen(reliable, cruise) });
  assert.ok(after.spareTanks < full.spareTanks);
  full.setTanks(cruise.tanks);
  assert.equal(full.spareTanks, after.spareTanks, 'setTanks gives the same as starting with them');
});

test('MOXIE / ice electrolysis adds one full trip of oxygen', () => {
  const o2 = createOxygen({ life: lifeOxygen(reliable) });
  const n = o2.spareTanks;
  o2.addSpareTank(1);
  assert.equal(o2.spareTanks, n + 1);
});

test('suit breach: 3× drain until the station patches it (kg model too)', () => {
  const o2 = createOxygen({ life: lifeOxygen(reliable) });
  o2.setLeak(3);
  o2.update(10, {});
  near(o2.percent, 90, 1e-6);
  o2.swapTank();
  assert.equal(o2.leaking, false);
  o2.update(10, {});
  near(o2.percent, 100 - 100 * 10 / 300, 1e-6);
});

test('records: coming back inside, refilling and running out each hand the numbers over', () => {
  const got = [];
  const o2 = createOxygen({ life: lifeOxygen(reliable), onRecord: (s) => got.push(s) });
  o2.useAirlock();
  o2.update(60, {});
  o2.update(1, { inside: true });
  o2.swapTank();
  assert.deepEqual(got.map((s) => s.why), ['inside', 'refill']);
  assert.ok(got[0].minutesOutside > 0 && got[0].minutesAvailable > got[0].minutesOutside && got[0].ventedKg > 0);
});

test('no traits: the old seconds model, exactly', () => {
  assert.equal(lifeOxygen({}), null);
  assert.equal(lifeOxygen(null), null);
  const o2 = createOxygen({ tankSeconds: 100, spareTanks: 1 });
  o2.update(80, {});
  assert.equal(o2.swapTank(), true);
  assert.equal(o2.percent, 100);
  assert.equal(o2.swapTank(), false);
  assert.equal(o2.useAirlock, undefined);
});

test('prebreathe by cabin air: sea-level air the full time, pure oxygen none; the airlock vents the cabin', () => {
  const run = (prebreathe) => {
    setCabinAir({ prebreathe });
    resetPrebreathe();
    const ia = createInteractables();
    const o2 = createOxygen({ life: lifeOxygen(reliable) });
    let exits = 0;
    const cabin = createShipInterior({ interactables: ia, oxygen: o2, onExit: () => exits++ });
    const S = CABIN.stations;
    const useAt = (pos) => { const eye = { x: pos.x * 0.6, y: pos.y, z: Math.abs(pos.x) > 1 ? pos.z : pos.z - Math.sign(pos.z) * 0.8 }; const d = { x: pos.x - eye.x, z: pos.z - eye.z }; const l = Math.hypot(d.x, d.z); ia.press(); ia.update(0.016, eye, { x: d.x / l, y: 0, z: d.z / l }); };
    useAt(S.suitLocker);
    const store = o2.storeKg;
    useAt(S.airlock);
    cabin.update(AIRLOCK_CYCLE_SECONDS + 0.1, { x: S.airlock.x, z: S.airlock.z - 0.5 });
    return { get exits() { return exits; }, vented: store - o2.storeKg, cabin };
  };
  setCabinAir({});
  assert.equal(prebreatheFor(), PREBREATHE_S, 'default: the full prebreathe');
  const pure = run(0);
  assert.equal(pure.exits, 1, 'pure oxygen: straight out');
  near(pure.vented, reliable.cabin.exitKg + reliable.o2.cabinKgPerTrip, 1e-6, 'and the cabin air is vented (plus the cabin breathing)');
  const air = run(1);
  assert.equal(air.exits, 0, 'sea-level air: the prebreathe first');
  for (let t = 0; t < PREBREATHE_S + AIRLOCK_CYCLE_SECONDS + 1; t += 0.5) air.cabin.update(0.5, { x: CABIN.stations.airlock.x, z: CABIN.stations.airlock.z - 0.5 });
  assert.equal(air.exits, 1, 'then out');
  setCabinAir({});
  assert.equal(prebreatheFor(), PREBREATHE_S, 'reset to sea-level air');
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} life effects tests passed`);
process.exit(fails ? 1 : 0);
