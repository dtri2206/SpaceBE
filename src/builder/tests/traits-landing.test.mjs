// Landing, power and comms traits (wave 5), Node only: node src/builder/tests/traits-landing.test.mjs
// The real numbers in src/builder/traits/landing.json, the trade-offs between the options, neutral behaviour without
// data, and the four presets.
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
const T = await imp('src/builder/traits/landing.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const data = read('src/builder/traits/landing.json');
const traitsData = { propulsion: read('src/builder/traits/propulsion.json'), structure: read('src/builder/traits/structure.json'), life: read('src/builder/traits/life.json'), landing: data };
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData };
const preset = (k) => read(`src/builder/data/presets/${k}.json`);
const PRESETS = ['reliable', 'workhorse', 'coldMorning', 'thinSkin'];
const gM = PLANETS.mars.g;

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const build = (json) => new Assembly(json, catalog);
const landingOf = (a) => computeShipSpec(a, deps).spec.stats.traits.landing;
const idOf = (a, type) => a.parts.find((p) => p.type === type)?.id;
/** A preset with one part type swapped (same place) and options set on it. */
function variant(key, { swap = null, options = {} } = {}) {
  const a = build(preset(key));
  if (swap) { const id = idOf(a, swap[0]); if (!a.replace(id, swap[1])) throw new Error(`cannot swap ${swap[0]} → ${swap[1]}`); }
  for (const [type, opts] of Object.entries(options)) { const id = idOf(a, type); for (const [slot, o] of Object.entries(opts)) a.setOption(id, slot, o); }
  return a;
}

// ---------- the data file ----------
{
  const ids = new Set(data.sources.map((s) => s.id));
  const cited = [];
  const walk = (o) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (k.startsWith('_') && k.toLowerCase().includes('src') && Array.isArray(v)) cited.push(...v); else walk(v); } };
  walk(data);
  const missing = [...new Set(cited)].filter((id) => !ids.has(id));
  check(cited.length > 20 && !missing.length, `every number names a source (${cited.length} citations, missing: ${missing.join(', ') || 'none'})`);
  check(data.sources.every((s) => s.what && s.source), 'every source says what it gives and where it comes from');
  for (const id of Object.keys(data.legs)) check(!!catalog.get(id)?.flags?.legs, `legs data ${id} is a real legs part`);
  for (const id of Object.keys(data.chutes)) check(Number(catalog.get(id)?.flags?.chuteCdA) > 0, `chute data ${id} is a real chute part`);
  for (const id of Object.keys(data.antennas)) check(!!catalog.get(id)?.flags?.antenna, `antenna data ${id} is a real antenna part`);
  const legs = Object.values(catalog.byId ?? {}).filter((d) => d.flags?.legs).map((d) => d.id);
  check(legs.every((id) => data.legs[id]), `every legs part in the catalogue has landing data (${legs.length})`);
  const chutes = Object.values(catalog.byId ?? {}).filter((d) => Number(d.flags?.chuteCdA) > 0).map((d) => d.id);
  check(chutes.every((id) => data.chutes[id]), `every chute part has landing data (${chutes.length})`);
  const canopyIds = catalog.kit(catalog.get('parachute'))?.slots.find((s) => s.key === 'canopy')?.options.map((o) => o.id) ?? [];
  check(canopyIds.length === 4 && canopyIds.every((id) => data.canopyTypes[id]), `every canopy option has a Mach limit (${canopyIds.join(', ')})`);
  const whats = ['touchdown', 'tipOver', 'tipTilt', 'legLock', 'legWeak', 'chuteOpen', 'chuteTorn', 'chuteLostOne', 'chuteReserve', 'chuteLost', 'power', 'roverEnergy', 'upload', 'uploadMinutes', 'uploadDays', 'antennaDead'];
  check(whats.every((w) => data.notes[w]?.en && data.notes[w]?.vi), 'a note template in English and Vietnamese for every note this group writes');
  check(data.notes.touchdown.whatIfFail && data.notes.touchdown.whatIfPass && data.notes.chuteTorn.whatIfPass, 'what-if texts for the touchdown and the chutes');
  check(/\{value\}/.test(data.notes.touchdown.en) && /\{limit\}/.test(data.notes.touchdown.en), 'touchdown note: speed (value) against the legs (limit), the notes contract');
  check(typeof data.gameScale.surfaceTimeWhy === 'string' && typeof data.gameScale.upload === 'string' && typeof data.gameScale.chuteLoad === 'string', 'the game scaling is written out, not hidden');
}

// ---------- neutral ----------
{
  check(JSON.stringify(T.landingTraits([], {}, null)) === '{}', 'no data: neutral (empty) traits');
  check(JSON.stringify(T.landingTraits([], {}, { neutral: {} })) === '{}', 'data without parts tables: neutral');
  const r = computeShipSpec(build(preset('reliable')), { ...deps, traitsData: null });
  check(JSON.stringify(r.spec.stats.traits.landing) === '{}', 'computeShipSpec without traitsData: landing traits empty (the flight as before)');
  const empty = T.landingTraits([], { stats: {} }, data);
  check(empty.touchdown === null && empty.chute === null && empty.comms.rateBps === 0, 'an empty ship: no legs, no chutes, no antenna');
  check(empty.power && empty.power.generationW === 0 && empty.power.arrivalFrac < 1, 'no power parts: nothing to spare, rovers arrive a little flat');
}

// ---------- legs: real physics ----------
{
  const leg = { designMps: 3.05, designMassKg: 24000, strokeM: 0.81, maxOverDesign: 2 };
  check(near(T.legLimitAt(leg, 24000, gM), 3.05, 1e-6), 'at their design mass the legs take exactly their design speed (Apollo LM: 10 ft/s)');
  check(T.legLimitAt(leg, 34000, gM) < 3.05 && T.legLimitAt(leg, 14000, gM) > 3.05, 'heavier ship → softer touchdown needed; lighter → may come down harder');
  check(near(T.legLimitAt(leg, 2000, gM), 6.1, 1e-6), 'a very light ship is capped at twice the design speed');
  check(T.legLimitAt(leg, 200000, gM) === 0, 'far too heavy: the struts bottom out under the weight alone');
  check(near(T.legLimitAt({ ...leg, energyF: 1.1 }, 24000, gM, 1) / 3.05, 1, 0.2) && T.legLimitAt({ ...leg, energyF: 1.1 }, 24000, gM) > 3.05, 'a stronger shock absorber takes more');
  // tipping: a wider stance stands more sideways speed, a taller centre of mass less
  const base = { edgeM: 3.3, cgM: 8.3, heightM: 16.3 };
  const v0 = T.tipSpeed(base, gM), wide = T.tipSpeed({ ...base, edgeM: 5 }, gM), tall = T.tipSpeed({ ...base, cgM: 11 }, gM);
  check(v0 > 1.5 && v0 < 4 && wide > v0 && tall < v0, `tip-over: ${v0.toFixed(2)} m/s, wide stance ${wide.toFixed(2)}, high centre of mass ${tall.toFixed(2)}`);
  check(T.tipSpeed(base, gM, 10) < v0 && T.tipSpeed(base, gM, 30) === 0, 'leaning toward the edge leaves less margin; past the tip angle it falls');
  check(T.tipSpeed(base, gM, -10) > v0, 'leaning back against the drift leaves more margin');
  check(T.tipSpeed({ ...base, edgeM: 0 }, gM) === 0, 'no stance on that side (a missing leg): it falls');
  check(T.tipSpeed({ ...base, slideF: 1.4 }, gM) > v0, 'feet that slide instead of digging in let more sideways speed pass');
}

// ---------- the presets ----------
const traits = Object.fromEntries(PRESETS.map((k) => [k, landingOf(build(preset(k)))]));
{
  for (const k of PRESETS) {
    const L = traits[k];
    check(!!L.touchdown && L.touchdown.limitMps >= 3, `${k}: legs take ${L.touchdown?.limitMps} m/s at ${(L.touchdown?.refMassKg / 1000).toFixed(1)} t (≥ the 3 m/s the HUD asks for)`);
    check(L.touchdown.tipAngleDeg >= 20, `${k}: stance ${L.touchdown.spanM} m, tips past ${L.touchdown.tipAngleDeg}° (≥ the flight's 20° upright limit)`);
    check(L.touchdown.tipMps > 2, `${k}: stands ${L.touchdown.tipMps} m/s sideways`);
    const bp = L.touchdown.byPart[L.touchdown.partId];
    const table = bp.limitByMassT;
    check(Object.keys(table).length === 50 && table[2] >= table[40], `${k}: the what-if table of leg limits by landed mass (2 to 100 t)`);
    const tilts = Object.values(bp.tipByTiltDeg);
    check(Object.keys(bp.tipByTiltDeg).join() === '0,5,10,15,20,25,30' && tilts.every((x, i) => i === 0 || x <= tilts[i - 1]) && bp.tipByTiltDeg[0] === L.touchdown.tipMps, `${k}: the what-if table of sideways limits by lean (0 to 30°): ${tilts.join(', ')} m/s`);
    check(L.touchdown.defects.weakCore === 0.75 && L.touchdown.defects.bagTear === 0.5, `${k}: the defect factors travel with the traits`);
    check(L.comms.rateBps > 0, `${k}: an antenna sends ${L.comms.rateBps} bit/s home`);
    check(JSON.stringify(L) === JSON.stringify(JSON.parse(JSON.stringify(L))) && !JSON.stringify(L).includes('Infinity'), `${k}: plain JSON`);
  }
  check(traits.reliable.chute.canopies[0].canopy === 'dgb' && traits.reliable.chute.canopies[0].maxMach === 2.2, 'Reliable: one disk-gap-band, good to Mach 2.2 (Viking to Perseverance)');
  check(traits.workhorse.chute.canopies.length === 2 && traits.workhorse.chute.cdA === 410, 'Workhorse: supersonic chute and drogue, 410 m² together (as stats.chuteCdA)');
  check(traits.thinSkin.chute === null, 'Thin Skin carries no chute');
  check(near(traits.reliable.power.solarMarsW, 2000 * 0.431 * 0.174 * 0.95, 1), `Reliable: a 2 kW panel gives ${traits.reliable.power.solarMarsW} W averaged over a Mars sol (43 % sunlight, 17.4 % of the sol, 5 % landing dust)`);
  check(traits.reliable.power.batteryWh === 30000, 'Reliable: the 200 kg battery stores 30 kWh (150 Wh/kg)');
  check(traits.workhorse.power.solarMarsW > traits.reliable.power.solarMarsW * 2, 'Workhorse: the 5 kW wing gives 2.5× the small panel');
  check(traits.coldMorning.power.generationW === 0 && traits.coldMorning.power.arrivalFrac === 0.84, 'Cold Morning: no power parts (the capsule runs only the cabin): rovers arrive at 84 %');
  // reliability as stats.js rates it (catalogue + material + options, capped), not the bare catalogue value
  const r = computeShipSpec(build(preset('reliable')), deps);
  const rated = (id) => r.breakdown.parts.find((p) => p.id === id)?.reliability;
  const Lr = r.spec.stats.traits.landing;
  check(near(Lr.touchdown.reliability, rated(Lr.touchdown.partId), 1e-5) && near(Lr.chute.canopies[0].reliability, rated(Lr.chute.canopies[0].partId), 1e-5) && near(Lr.comms.antennas[0].reliability, rated(Lr.comms.antennas[0].partId), 1e-5), `the dice use each part's rated reliability (legs ${Lr.touchdown.reliability}, chute ${Lr.chute.canopies[0].reliability}, antenna ${Lr.comms.antennas[0].reliability})`);
  const better = landingOf(variant('reliable', { options: { legs_m: { shock: 'telescope', pads: 'dish', probes: 'loadcells' }, parachute: { reefing: 'staged' } } }));
  check(better.touchdown.reliability > Lr.touchdown.reliability && better.chute.canopies[0].reliability > Lr.chute.canopies[0].reliability && better.touchdown.reliability <= 0.9995, `better options lower the odds of a defect (legs ${better.touchdown.reliability}, capped at 99.95 %)`);
  // determinism: the same build gives the same traits
  check(JSON.stringify(landingOf(build(preset('reliable')))) === JSON.stringify(traits.reliable), 'the same build gives the same traits');
}

// ---------- trade-offs: every option best at something ----------
{
  const lim = (a) => landingOf(a).touchdown;
  const shock = Object.fromEntries(['honeycomb', 'hydraulic', 'telescope'].map((o) => [o, lim(variant('reliable', { options: { legs_m: { shock: o } } }))]));
  check(shock.hydraulic.limitMps > shock.telescope.limitMps && shock.telescope.limitMps > shock.honeycomb.limitMps, `shock absorber: honeycomb ${shock.honeycomb.limitMps}, telescope ${shock.telescope.limitMps}, hydraulic ${shock.hydraulic.limitMps} m/s (honeycomb is the lightest and cheapest)`);
  const pads = Object.fromEntries(['small', 'large', 'dish'].map((o) => [o, lim(variant('reliable', { options: { legs_m: { pads: o } } }))]));
  check(pads.small.tipMps < pads.large.tipMps && pads.large.tipMps < pads.dish.tipMps, `foot pads: sideways ${pads.small.tipMps} / ${pads.large.tipMps} / ${pads.dish.tipMps} m/s (small pads are the lightest)`);
  const set = Object.fromEntries(['legs_m', 'legs_l', 'legs_falcon_m', 'legs_glenn_l', 'legs_shepard_m', 'airbags'].map((t) => [t, lim(t === 'legs_m' ? build(preset('reliable')) : variant('reliable', { swap: ['legs_m', t] }))]));
  const r = (t) => `${set[t].limitMps}/${set[t].tipMps}`;
  console.log(`      legs on the Reliable (touchdown / sideways m/s): ${Object.keys(set).map((t) => `${t} ${r(t)}`).join(', ')}`);
  check(set.legs_glenn_l.limitMps > set.legs_m.limitMps && set.legs_l.limitMps > set.legs_m.limitMps, 'heavy legs take a harder touchdown than the standard set');
  check(set.legs_falcon_m.tipMps > set.legs_m.tipMps && set.legs_falcon_m.deploys, 'Falcon-style folding legs: the widest stance for their mass, but they must lock open');
  check(set.legs_shepard_m.tipMps < set.legs_m.tipMps && set.legs_shepard_m.limitMps < set.legs_m.limitMps, 'New Shepard gear: a short stance and a lighter touchdown on a heavy ship');
  check(set.legs_glenn_l.count === 6 && set.legs_glenn_l.edgeM / (set.legs_glenn_l.spanM / 2) > 0.85, 'six legs: the edge between two feet is closer to a full radius (cos 30°)');
  check(set.airbags.kind === 'airbags' && set.airbags.limitMps < set.legs_m.limitMps, `airbags on a heavy ship take less than legs (${set.airbags.limitMps} m/s)`);
  const light = landingOf(variant('coldMorning', { swap: ['legs_m', 'airbags'] })).touchdown;
  check(light.limitMps > 5, `airbags on a light ship (Cold Morning): ${light.limitMps} m/s`);
  check(landingOf(variant('coldMorning', { swap: ['legs_m', 'airbags'] })).power.plumeDust === 0, 'an airbag landing blows no dust on the panels');

  const canopy = (o) => landingOf(variant('reliable', { options: { parachute: { canopy: o } } })).chute.canopies[0];
  const c = Object.fromEntries(['dgb', 'ringsail', 'ribbon', 'parafoil'].map((o) => [o, canopy(o)]));
  check(c.ribbon.maxMach > c.dgb.maxMach && c.dgb.maxMach > c.ringsail.maxMach && c.ringsail.maxMach > c.parafoil.maxMach, `canopy Mach limits: ribbon ${c.ribbon.maxMach}, DGB ${c.dgb.maxMach}, ringsail ${c.ringsail.maxMach}, parafoil ${c.parafoil.maxMach}`);
  check(c.ringsail.cdA > c.dgb.cdA && c.ribbon.cdA < c.dgb.cdA && c.parafoil.cdA < c.dgb.cdA, `drag: ringsail ${c.ringsail.cdA} m² > DGB ${c.dgb.cdA} > parafoil ${c.parafoil.cdA} > ribbon ${c.ribbon.cdA} (ribbon opens fastest, ringsail drags most)`);
  const cl3 = landingOf(variant('reliable', { swap: ['parachute', 'chute_cluster_3'] })).chute.canopies[0];
  const single = landingOf(variant('reliable', { swap: ['parachute', 'chute_single_main'] })).chute.canopies[0];
  check(cl3.count === 3 && single.reserve > 0.5, 'a cluster of three lands on two; Soyuz\' single main has a reserve of about 57 %');

  const p = (swap) => landingOf(variant('reliable', { swap })).power;
  const rtg = p(['solar_panel', 'rtg']), cell = p(['solar_panel', 'fuel_cell']), wing = p(['solar_panel', 'solar_wing_l']);
  check(rtg.rtgW === 107 && rtg.solarMarsW === 0, 'RTG: 107 W on Mars, day and night, whatever the dust (MMRTG)');
  check(cell.fuelCellW === 2500 && cell.fuelCellWh === 110000 && cell.generationW === 0, 'fuel cell: 2.5 kW, but only the reactants it brought (110 kWh)');
  check(wing.solarMarsW > rtg.rtgW * 3 && rtg.rtgW > p(['solar_panel', 'battery']).generationW, 'solar wing: the most watts in sunlight; RTG: steady; battery: a store only');
  const triple = landingOf(variant('reliable', { options: { solar_panel: { cells: 'triple', drive: 'tracking' } } })).power;
  check(near(triple.solarMarsW / traits.reliable.power.solarMarsW, 1.3 * 1.2, 0.02), 'triple-junction cells and a Sun-tracking drive raise the Mars watts as on the card (×1.3 × 1.2)');

  const ant = (t) => landingOf(variant('reliable', { swap: ['antenna_low', t] })).comms;
  const A = { relay: ant('relay_sat'), dish: ant('antenna_high'), horn: ant('antenna_medium'), omni: traits.reliable.comms };
  check(A.relay.rateBps > A.dish.rateBps && A.dish.rateBps > A.horn.rateBps && A.horn.rateBps > A.omni.rateBps, `data rates: relay ${A.relay.rateBps}, dish ${A.dish.rateBps}, horn ${A.horn.rateBps}, omni ${A.omni.rateBps} bit/s`);
  check(A.relay.antennas[0].windowS < A.dish.antennas[0].windowS, `the relay's next pass (${A.relay.antennas[0].windowS / 3600} h) comes sooner than Earth for a direct antenna (${(A.dish.antennas[0].windowS / 3600).toFixed(1)} h)`);
  check(A.relay.realSPerLog < A.dish.realSPerLog && A.dish.realSPerLog < A.horn.realSPerLog && A.horn.realSPerLog < A.omni.realSPerLog, `a log leaves the ship in ${(A.relay.realSPerLog / 3600).toFixed(1)} h by relay, ${(A.dish.realSPerLog / 3600).toFixed(1)} h by dish, ${(A.horn.realSPerLog / 3600).toFixed(1)} h by horn, ${(A.omni.realSPerLog / 86400).toFixed(0)} days by omni`);
  const both = landingOf((() => { const a = variant('reliable', { swap: ['antenna_low', 'antenna_high'] }); return a; })()).comms;
  check(both.bestPartId === both.antennas[0].partId, 'the antenna that gets the logs off soonest is the one that sends');
}

// ---------- the upload clock ----------
{
  const u = traits.reliable.comms.upload;
  const W = read('src/builder/traits/landing.json').linkWindow;
  const wait = (bps, windowS, logs = 2) => T.uploadWaitSeconds(windowS + (logs * u.logMB * 8e6) / bps, u);
  const w = { relay: wait(1e6, W.relayS), dish: wait(5e5, W.directS), horn: wait(1e3, W.directS), omni: wait(20, W.directS) };
  console.log(`      two logs: relay ${w.relay.toFixed(1)} s, dish ${w.dish.toFixed(1)} s, horn ${w.horn.toFixed(1)} s, omni ${w.omni.toFixed(1)} s`);
  check(w.relay < w.dish && w.dish < w.horn && w.horn < w.omni && w.omni <= 60 && w.relay >= 3, 'faster link, shorter wait; seconds, not hours (3 to 60 s)');
  check(near(T.uploadWaitSeconds(600, u) - T.uploadWaitSeconds(60, u), 6, 1e-9), 'every ten times longer in reality adds 6 s');
}

console.log(failures ? `\n${failures} FAILED` : '\nall landing traits checks passed');
process.exit(failures ? 1 : 0);
