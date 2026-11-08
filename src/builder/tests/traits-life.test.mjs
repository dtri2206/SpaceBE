// Life-support traits (wave 5): the suit's oxygen in kg, the ship's spare oxygen per tank, the gas each trip outside
// vents, CO₂ scrubbing and its backups, water, radiation shielding; and what the presets do over many cruises.
//   node src/builder/tests/traits-life.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { PLANETS, G0 } = await imp('src/core/planets.js');
const { Assembly, createCatalog } = await imp('src/builder/assembly.js');
const { computeShipSpec } = await imp('src/builder/stats.js');
const SEC = await imp('src/builder/sections.js');
const { lifeTraits, o2KgPerHour, o2KgPerM3, usableKg, tripsLeft } = await imp('src/builder/traits/life.js');
const { createCruiseLife, seededRng, stormDoseBehind } = await imp('src/cruise/life.js');
const cruiseData = read('src/cruise/data.json');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const lifeData = read('src/builder/traits/life.json');
const traitsData = { propulsion: read('src/builder/traits/propulsion.json'), structure: read('src/builder/traits/structure.json'), life: lifeData, landing: read('src/builder/traits/landing.json') };
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData };
const preset = (key) => read(`src/builder/data/presets/${key}.json`);

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`ok    ${msg}`); else { failures += 1; console.log(`FAIL  ${msg}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const specOf = (json) => computeShipSpec(new Assembly(json, catalog), deps).spec;
const lifeOf = (json) => specOf(json).stats.traits.life;
/** A preset with its parts changed: edit(parts) returns the new list. */
const variant = (key, edit) => { const j = preset(key); j.parts = edit(j.parts.map((p) => ({ ...p }))); return j; };
const swapType = (from, to) => (parts) => parts.map((p) => (p.type === from ? { ...p, type: to } : p));
const capsuleOpts = (opts) => (parts) => parts.map((p) => (p.parent == null ? { ...p, options: { ...(p.options ?? {}), ...opts } } : p));
const addRadial = (type, parentType = 'capsule_m', angle = 200) => (parts) => {
  const parent = parts.find((p) => p.type === parentType) ?? parts[0];
  return [...parts, { id: `x${parts.length + 1}`, type, parent: parent.id, node: 'radial', angle, yFrac: 0.5, variant: null, group: null }];
};

// ---------- the numbers ----------
{
  check(near(o2KgPerHour(293), 0.0746, 0.0005), `walking at 293 W (1000 BTU/h) burns ${o2KgPerHour(293).toFixed(4)} kg O₂/h (Weir: 20.2 kJ per litre)`);
  check(near(o2KgPerHour(136) * 24, 0.84, 0.02), `resting at 136 W is ${(o2KgPerHour(136) * 24).toFixed(2)} kg/day, NASA's 0.84 kg/day`);
  const life = lifeOf(preset('reliable'));
  check(near(life.suit.hours, 7.3, 0.1), `the EMU's 0.544 kg of primary O₂ lasts ${life.suit.hours} h walking (rated 7 h + 30 min)`);
  check(near(life.suit.evaScale * 300 / 3600, life.suit.hours, 0.01) && life.suit.gameSecondsPerFill === 300, `one fill is still 300 game seconds: the game runs the suit ${life.suit.evaScale}× faster`);
  check(near(life.suit.runMultiplier, 1.6, 0.01), 'running (469 W, Apollo lunar peaks) burns 1.6× walking, as before');
  check(near(o2KgPerM3(21.3), 0.278, 0.002) && near(o2KgPerM3(34.5), 0.45, 0.003), 'a cubic metre of cabin air holds 0.28 kg of O₂ at sea level, 0.45 kg in a 5 psi pure-oxygen cabin');
  const b = life.o2.tanks[0];
  check(b.type === 'o2_bottle' && b.kg === 10.4 && near(b.residualKg, 10.4 * 62 / 150, 0.01), 'one 50 L steel bottle at 150 bar holds 10.4 kg; the last 41 % (below the suit\'s 62 bar) cannot fill the suit');
  check(life.o2.tanks.length === 2 && near(life.o2.usableKg, 2 * 10.4 * (1 - 62 / 150), 0.02), `Reliable's two bottles give ${life.o2.usableKg} kg of usable oxygen`);
  check(life.cabin.exitVia === 'cabin' && near(life.cabin.exitKg, 4 * 0.278, 0.01), `with no airlock each trip out empties the 4 m³ cabin: ${life.cabin.exitKg} kg of O₂`);
  check(near(life.o2.cabinKgPerTrip, 0.84 * (24.66 - life.suit.hours) / 24, 0.002), `between walks the cabin breathes ${life.o2.cabinKgPerTrip} kg of spare oxygen (0.84 kg/day for the 17.4 h of the sol out of the suit)`);
  check(near(life.o2.n2.perTripKg, 4 * 0.913, 0.01) && life.o2.n2.kg === 30, `each emptying of the 4 m³ sea-level cabin also loses ${life.o2.n2.perTripKg} kg of nitrogen, from a 30 kg allowance`);
  check(near(life.o2.tripKg, 0.544 + life.cabin.exitKg + life.o2.cabinKgPerTrip, 1e-3), `a trip outside costs ${life.o2.tripKg} kg of oxygen: the suit, the cabin air, the cabin breathing`);
  check(life.o2.refills === tripsLeft(life.o2.usableKg, 30, { tripKg: life.o2.tripKg, n2PerTrip: life.o2.n2.perTripKg, tripKgNoN2: life.o2.tripKgNoN2 }), `trips outside = usable kg / trip cost, counting the nitrogen: ${life.o2.refills}`);
  check(tripsLeft(30, 6, { tripKg: 2, n2PerTrip: 3, tripKgNoN2: 4 }) === 2 + Math.floor(26 / 4), 'once the nitrogen is gone, each trip costs the 5 psi oxygen refill instead');
  check(life.co2.primary === 'loop' && life.co2.units[0].kind === 'lioh' && life.water.recovery === 0, 'the default open loop scrubs with LiOH and carries its water');
  check(life.radiation.wallGcm2 === 5 && near(life.radiation.shelterGcm2, 5 + 1.3 * 600 / 8 / 10, 0.01), `the 600 kg water shelter around an 8 m² nook gives ${life.radiation.shelterGcm2} g/cm² (aluminium-equivalent)`);
  check(JSON.stringify(life) === JSON.stringify(lifeOf(preset('reliable'))), 'deterministic: the same ship gives the same traits');
  check(!JSON.stringify(life).includes('Infinity') && JSON.parse(JSON.stringify(life)) != null, 'plain JSON, no Infinity');
}

// ---------- neutral without data ----------
{
  check(JSON.stringify(lifeTraits([], {}, null)) === '{}', 'no life.json: neutral (the game as before)');
  check(JSON.stringify(lifeTraits([], {}, { neutral: {} })) === '{}', 'life.json without suit data: neutral');
  const r = computeShipSpec(new Assembly(preset('reliable'), catalog), { ...deps, traitsData: null });
  check(JSON.stringify(r.spec.stats.traits.life) === '{}' && r.spec.stats.spareO2Tanks === 2, 'a ShipSpec built without trait data has an empty life group and its old spareO2Tanks');
  const l = lifeTraits([{ id: 'p1', type: 'mystery_capsule', def: { flags: { capsule: true, spareO2Tanks: 3 } } }], {}, lifeData);
  check(l.o2.tanks.length === 3 && l.cabin.cabinM3 === 4, 'an unknown part with spare O₂ counts as bottles; an unknown capsule as 4 m³ (estimates)');
}

// ---------- trade-offs ----------
{
  const two = lifeOf(preset('reliable'));
  const big = lifeOf(variant('reliable', (ps) => { let first = true; return ps.filter((p) => (p.type === 'o2_bottle' ? (first ? ((first = false), true) : false) : true)).map((p) => (p.type === 'o2_bottle' ? { ...p, type: 'o2_tank_l' } : p)); }));
  check(big.o2.tanks.length === 1 && big.o2.tanks[0].kind === 'copv' && near(big.o2.usableKg, 36.3 * (1 - 62 / 414), 0.05), `the composite double tank: 36.3 kg at 414 bar, ${big.o2.usableKg} kg usable (two bottles: ${two.o2.usableKg})`);
  check(big.o2.refills >= 10 && two.o2.refills >= 5 && two.o2.refills <= 6, `trips outside: the double tank ${big.o2.refills}, two bottles ${two.o2.refills}`);
  check(big.o2.leakKgPerDay < two.o2.leakKgPerDay, 'the double tank seeps less (one valve)…');
  check(big.o2.separateTanks < two.o2.separateTanks, '…but it is one tank: the emergency reaches all of it');
  const lock = lifeOf(variant('reliable', addRadial('volga_airlock')));
  check(lock.cabin.exitVia === 'airlock' && lock.cabin.exitKg < two.cabin.exitKg, `an airlock vents ${lock.cabin.exitKg} kg a trip instead of ${two.cabin.exitKg} kg`);
  const orion = lifeOf(variant('reliable', swapType('capsule_m', 'capsule_orion')));
  check(orion.cabin.exitKg > two.cabin.exitKg && orion.o2.refills < two.o2.refills, `a roomy Orion cabin vents more (${orion.cabin.exitKg} kg), so fewer trips outside (${orion.o2.refills} vs ${two.o2.refills})`);
  const orionLock = lifeOf(variant('reliable', (ps) => addRadial('volga_airlock', 'capsule_orion')(swapType('capsule_m', 'capsule_orion')(ps))));
  check(orionLock.o2.refills > orion.o2.refills, `an airlock on Orion wins trips back (${orionLock.o2.refills})`);
  const pure = lifeOf(variant('reliable', capsuleOpts({ atmosphere: 'pure_o2' })));
  check(pure.cabin.prebreathe === 0 && two.cabin.prebreathe === 1, 'a pure-oxygen cabin needs no prebreathe, sea-level air the full one');
  check(pure.cabin.exitKg > two.cabin.exitKg, 'but it vents more oxygen each trip (34.5 kPa of O₂ instead of 21.3)');
  const regen = lifeOf(variant('reliable', capsuleOpts({ lifeSupport: 'regenerative' })));
  check(regen.co2.regenerable && regen.water.recovery === 0.98 && regen.co2.backups === 0, 'the regenerative loop: regenerable CO₂ beds and 98 % of the water back, no backup of its own');
  check(regen.o2.cabinKgPerTrip === 0 && regen.o2.refills > two.o2.refills, `its oxygen generator breathes for the cabin, so the tanks give ${regen.o2.refills} trips instead of ${two.o2.refills}`);
  const regenLioh = lifeOf(variant('reliable', (ps) => addRadial('lioh_canisters')(capsuleOpts({ lifeSupport: 'regenerative' })(ps))));
  const can = regenLioh.co2.units.find((u) => u.type === 'lioh_canisters');
  check(can && near(can.crewDays, 40 * 0.6 * 0.919 * 0.75 / 1.04, 0.2), `40 kg of LiOH canisters last ${can?.crewDays} crew-days (weeks, not months)`);
  const scrub = lifeOf(variant('reliable', addRadial('co2_scrubber')));
  check(scrub.co2.primary !== 'loop' && scrub.co2.units[0].regenerable && scrub.co2.units[1].id === 'loop', 'a regenerable scrubber part becomes the primary; the LiOH loop is its backup');
  const noShelter = lifeOf(variant('reliable', (ps) => ps.filter((p) => p.type !== 'radiation_shelter')));
  check(noShelter.radiation.shelterGcm2 === null && noShelter.radiation.gcrFactor === 1 && two.radiation.gcrFactor < 1, 'no shelter: no storm refuge, and no sleeping behind water');
  const wall = (g) => Math.round(stormDoseBehind(g, { refMsv: cruiseData.solarStorm.doseIgnored, refGcm2: cruiseData.solarStorm.doseRefGcm2, lambda: cruiseData.solarStorm.attenuationGcm2 }));
  const dShelter = wall(two.radiation.shelterGcm2), dImpro = wall(two.radiation.improvisedGcm2), dWall = wall(two.radiation.wallGcm2);
  check(cruiseData.solarStorm.attenuationGcm2 === 8 && dWall === 150 && near(dImpro, 78, 2) && near(dShelter, 44, 2), `the storm (e-fold every 8 g/cm², Townsend TM-100620): ${dWall} mSv behind the wall, ${dImpro} behind the food and water, ${dShelter} in the shelter`);
  const apollo = lifeOf(variant('reliable', addRadial('apollo_sm')));
  check(apollo.o2.tanks.filter((t) => t.kind === 'cryo').length === 2 && apollo.o2.storeKg > 300, 'an Apollo service module adds two cryogenic tanks of 145 kg');
}

// ---------- the cruise: tanks, the emergency, CO₂ ----------
{
  const life = lifeOf(preset('reliable'));
  const run = (l, seed, wrong = 0, kind = 'shelter') => {
    const c = createCruiseLife(l, { tripDays: cruiseData.tripDays, rng: seededRng(seed), cfg: { ...cruiseData.life, doseMsvPerDay: cruiseData.doseMsvPerDay } });
    let f = null;
    for (let d = 0; d < cruiseData.tripDays && !f; d += 5) {
      f = c.step(5);
      if (Math.abs(c.day - cruiseData.solarStorm.day) < 2.5) c.storm(kind, { refMsv: 150, refGcm2: 5, lambda: 8 });
      if (Math.abs(c.day - cruiseData.malfunction.day) < 2.5) { for (let i = 0; i < wrong; i++) c.malfunctionAttempt(false); c.malfunctionAttempt(true); }
    }
    return { c, f };
  };
  const a = run(life, 'f1'), b = run(life, 'f1');
  check(JSON.stringify(a.c.summary()) === JSON.stringify(b.c.summary()), 'deterministic with a seeded rng');
  const s = a.c.summary();
  check(near(s.doseMsv, 1.8 * life.radiation.gcrFactor * 259 + s.stormMsv, 1), `cruise dose ${s.doseMsv} mSv: 1.8 mSv/day × ${life.radiation.gcrFactor} × 259 days + the storm`);
  check(s.usableKg > 0.99 * s.startUsableKg && s.usableKg < s.startUsableKg, 'steel bottles lose only grams to their valves over 259 days');
  const cryo = run(lifeOf(variant('reliable', addRadial('apollo_sm'))), 'f1').c.summary();
  check(cryo.lost.boil > 200, `but cryogenic tanks boil off ${Math.round(cryo.lost.boil)} kg of their 290 kg on the way`);
  const two = run(life, 'f2', 2).c.summary(), one = run(lifeOf(variant('reliable', (ps) => { let first = true; return ps.filter((p) => (p.type === 'o2_bottle' ? (first ? ((first = false), true) : false) : true)).map((p) => (p.type === 'o2_bottle' ? { ...p, type: 'o2_tank_l' } : p)); })), 'f2', 2).c.summary();
  check(two.lost.malfunction > 0 && one.lost.malfunction > 1.9 * two.lost.malfunction, `two wrong answers vent ${two.lost.malfunction} kg from separate bottles, ${one.lost.malfunction} kg from one big tank`);
  check(run(life, 'f3', 0).c.summary().lost.malfunction === 0, 'the right answer first time costs no spare oxygen');
  // a leak recorded by the flight
  const leaky = createCruiseLife(life, { tripDays: 259, rng: seededRng('x'), leak: { airKgPerDay: 20 }, cfg: cruiseData.life });
  for (let i = 0; i < 10; i++) leaky.step(1);
  check(near(leaky.summary().lost.leak, 20 * 0.232, 0.01), 'a 20 kg/day cabin leak, sealed after a day, costs 4.6 kg of spare oxygen…');
  check(near(leaky.summary().n2Kg, 30 - 20 * 0.768, 0.01), '…and 15.4 kg of the nitrogen kept for refilling the cabin on Mars');
  // CO₂: a regenerative loop that fails with no backup kills; with LiOH it holds for weeks; the open loop rigs its canisters
  const forced = (l) => { const c = createCruiseLife({ ...l, co2: { ...l.co2, units: l.co2.units.map((u, i) => (i === 0 ? { ...u, failPerTrip: 1 } : u)) } }, { tripDays: 259, rng: seededRng('co2'), cfg: cruiseData.life }); let f = null; for (let d = 0; d < 259 && !f; d += 1) f = c.step(1); return { c, f }; };
  const regen = forced(lifeOf(variant('reliable', capsuleOpts({ lifeSupport: 'regenerative' }))));
  check(regen.f?.endingId === 'outOfBreath' && /no backup/.test(regen.f.cause), `regenerative loop, no backup: ${regen.f?.cause}`);
  const open = forced(life);
  check(!open.f && open.c.summary().co2PeakmmHg >= 15 && open.c.summary().scrubber.by === 'rigged', 'open loop: the crew rigs the canisters (Apollo 13), CO₂ peaks at 15 mmHg, everyone lives');
  const regenScrub = forced(lifeOf(variant('reliable', (ps) => addRadial('co2_scrubber')(capsuleOpts({ lifeSupport: 'regenerative' })(ps)))));
  check(!regenScrub.f && regenScrub.c.summary().scrubber.by === 'backupRegen', 'regenerative loop with a scrubber part as backup: fine');
  const openLioh = forced(lifeOf(variant('reliable', addRadial('lioh_canisters'))));
  check(!openLioh.f && openLioh.c.summary().scrubber.by === 'rigged' && openLioh.c.summary().scrubber.spentDay > 0, 'open loop + LiOH canisters: the backup runs 16 days, then the crew rigs the trip\'s own canisters and lives');
  const regenLioh = forced(lifeOf(variant('reliable', (ps) => addRadial('lioh_canisters')(capsuleOpts({ lifeSupport: 'regenerative' })(ps)))));
  check(regenLioh.f?.endingId === 'outOfBreath' && /ran out/.test(regenLioh.f.cause), 'regenerative loop + LiOH canisters: no LiOH stock behind them, so once they are spent the air turns (unless Mars is near)');
}

// ---------- presets over many cruises ----------
{
  const N = 2000;
  for (const key of ['reliable', 'workhorse', 'coldMorning', 'thinSkin']) {
    const life = lifeOf(preset(key));
    let failed = 0, minRefills = Infinity;
    for (let i = 0; i < N; i++) {
      const c = createCruiseLife(life, { tripDays: 259, rng: seededRng(`${key}${i}`), cfg: cruiseData.life });
      let f = null;
      for (let d = 0; d < 259 && !f; d += 5) f = c.step(5);
      if (f) failed += 1;
      minRefills = Math.min(minRefills, tripsLeft(c.usableKg, c.summary().n2Kg ?? 0, { tripKg: life.o2.tripKg, n2PerTrip: life.o2.n2?.perTripKg ?? 0, tripKgNoN2: life.o2.tripKgNoN2 }));
    }
    check(failed / N <= 0.002, `${key}: ${failed} of ${N} cruises lost to life support (rare)`);
    check(minRefills >= 1, `${key}: lands with at least ${minRefills} refills of spare oxygen (${life.o2.refills} at launch)`);
  }
  // the user's calibration (2026-11-08): the cheapest about 2–3 trips, mid-range about 5–6, the best 10 or more
  const trips = Object.fromEntries(['reliable', 'workhorse', 'coldMorning', 'thinSkin'].map((k) => [k, lifeOf(preset(k)).o2.refills]));
  trips.reliableAirlock = lifeOf(variant('reliable', addRadial('volga_airlock'))).o2.refills;
  check(trips.reliable === 5 && trips.reliableAirlock === 7 && trips.coldMorning === 3 && trips.thinSkin === 2 && trips.workhorse === 12, `trips outside: ${JSON.stringify(trips)}`);
  const wh = lifeOf(preset('workhorse'));
  check(wh.radiation.shelterGcm2 > wh.radiation.wallGcm2 && lifeOf(preset('coldMorning')).radiation.shelterGcm2 === null, 'Workhorse has its shelter; Cold Morning has none (as its NO_SHELTER warning says)');
}

// ---------- notes templates ----------
{
  const notesUsed = ['evaMinutes', 'o2Used', 'exitGas', 'o2Arrival', 'o2Boiloff', 'o2Seep', 'cabinLeak', 'malfunctionLoss', 'malfunctionHeld', 'co2Peak', 'scrubberFailed', 'water', 'waterStored', 'cruiseDose', 'stormDose'];
  check(notesUsed.every((k) => lifeData.notes[k]?.en && lifeData.notes[k]?.vi), 'every note the cruise and the surface write has an English and a Vietnamese template');
  const c = createCruiseLife(lifeOf(preset('reliable')), { tripDays: 259, rng: seededRng('n'), cfg: cruiseData.life });
  for (let d = 0; d < 259; d += 5) c.step(5);
  c.storm('shelter', { refMsv: 150, refGcm2: 5, lambda: 8 });
  const notes = c.notes();
  check(notes.every((n) => lifeData.notes[n.what] && n.group === 'life'), `the cruise writes ${notes.length} notes, all with templates`);
  const fields = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !['value', 'pct', 'part', 't', 'section'].includes(k));
  check(notes.every((n) => fields(lifeData.notes[n.what].en).every((k) => k in n) && fields(lifeData.notes[n.what].vi).every((k) => k in n)), 'every placeholder in those templates is a field of the note');
  check(lifeData.sources.length >= 20 && lifeData.sources.every((s) => s.id && s.text), `${lifeData.sources.length} sources listed`);
  const ids = new Set(lifeData.sources.map((s) => s.id));
  const cited = [...JSON.stringify(lifeData).matchAll(/"_src":\s*"([^"]*)"/g)].flatMap((m) => m[1].split(/[,;( ]+/)).filter((w) => /^[a-z][A-Za-z0-9]+$/.test(w) && ids.has(w));
  check(cited.length > 10, 'the numbers name their sources');
  check(usableKg([{ kg: 10, residualKg: 3 }, { kg: 2, residualKg: 3 }]) === 7, 'usable oxygen never counts the gas below the suit\'s fill pressure');
}

console.log(failures ? `\n${failures} life trait failure(s).` : '\nAll life trait checks passed.');
process.exit(failures ? 1 : 0);
