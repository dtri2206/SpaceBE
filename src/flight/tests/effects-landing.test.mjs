// Landing, power and comms effects (wave 5), Node only: node src/flight/tests/effects-landing.test.mjs
// The flight hooks of src/flight/effects/landing.js (legs, tip-over, chutes, records), the rovers' power from the ship
// (src/surface/rovers.js, RoverController.js), neutral behaviour without traits, seeded dice, and the presets landing.
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
const FX = await imp('src/flight/effects/index.js');
const LFX = await imp('src/flight/effects/landing.js');
const { FlightController, TUNING } = await imp('src/flight/FlightController.js');
const { createAutopilot } = await imp('src/flight/autopilot.js');
const { approachBack, computeCorridor } = await imp('src/flight/corridor.js');
const { STARTS, MOCK_SHIPS } = await imp('src/flight/presets.js');
const { RoverController, ROVER, ROVER_MR01 } = await imp('src/surface/RoverController.js');
const RV = await imp('src/surface/rovers.js');
const { roverWhPerMetre, roverReachMetres } = await imp('src/surface/explore.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const traitsData = Object.fromEntries(['propulsion', 'structure', 'life', 'landing'].map((g) => [g, read(`src/builder/traits/${g}.json`)]));
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData };
const preset = (k) => read(`src/builder/data/presets/${k}.json`);
const specOf = (json) => computeShipSpec(new Assembly(json, catalog), deps).spec;
const gM = PLANETS.mars.g;

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

/** A flight record as the effects index makes one, for the hooks alone. */
function flightOf(spec, seed = 1) { FX.resetPartEffects(); return FX.flightFor(spec, { fresh: true, rng: seeded(seed) }); }
/** A stand-in FlightController with what the hooks read. */
function fakeFc({ mass = 20000, alt = 0, vel = { x: 0, y: -2, z: 0 }, forward = { x: 0, y: 1, z: 0 }, chuteOpen = false, onGround = false } = {}) {
  return { mass, altitude: alt, vel, forward, up: { x: 0, y: 1, z: 0 }, chuteOpen, onGround, planet: PLANETS.mars, t: 100 };
}

const reliable = specOf(preset('reliable'));
const L = reliable.stats.traits.landing;

// ---------- neutral: no traits, as before ----------
{
  const f = flightOf(MOCK_SHIPS.reliable);
  const ctx = { fc: fakeFc(), alt: 5000 };
  check(LFX.touchdownLimit(3, ctx, f) === 3, 'no traits: the touchdown limit stays TUNING\'s');
  check(LFX.chuteCdA(300, ctx, f) === 300 && LFX.chuteDeploy({ maxSpeed: 500, maxAltitude: 15000 }, ctx, f).maxSpeed === 500, 'no traits: chute drag and deploy limits unchanged');
  check(LFX.step(ctx, f) === null, 'no traits: step does nothing');
  check(f.notes.length === 0, 'no traits: no records');
  const r = new RoverController({ gravity: gM, ship: MOCK_SHIPS.reliable });
  check(r.batteryWh === ROVER.batteryWh && r.capacityWh === ROVER.batteryWh && !r.power, 'no traits: the rover keeps its real 8.7 kWh and never charges');
  const n = new RoverController({ gravity: gM });
  check(n.batteryWh === 8700 && !n.power, 'in Node with no ship: the rover as before');
}

// ---------- legs ----------
{
  const f = flightOf(reliable, 3);
  const at = (mass) => LFX.touchdownLimit(3, { fc: fakeFc({ mass }) }, f);
  check(at(22000) > 3 && at(22000) < 3.6, `Reliable on Mars at 22 t: the legs take ${at(22000).toFixed(2)} m/s`);
  check(at(34000) < at(22000) && at(12000) > at(22000), 'the same legs on a heavier ship take less, on a lighter one more');
  const ref = L.touchdown;
  check(Math.abs(LFX.legLimit(ref, ref.refMassKg, gM) - ref.limitMps) < 0.01, 'the flight\'s formula and the builder\'s agree');
  check(Math.abs(LFX.tipLimit(ref, gM) - ref.tipMps) < 0.01, 'the tip-over formula agrees too');
  // a touchdown sideways faster than the stance stands → tipped over (Role 2's tipped_over cause)
  const st = f.state.landing;
  st.legDefect = null;
  const side = LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: ref.tipMps + 0.4, y: -1, z: 0 } }) }, f);
  check(side?.endingId === 'rud' && side.cause === 'tipped_over', `sideways ${(ref.tipMps + 0.4).toFixed(1)} m/s on a ${ref.spanM} m stance: the ship falls over`);
  const soft = LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: 0.5, y: -1.5, z: 0 } }) }, f);
  check(soft === null, 'a soft upright touchdown stands');
  const crash = LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: 5, y: -20, z: 0 } }) }, f);
  check(crash === null, 'far too fast: left to FlightController\'s crash_landing (not a tip-over)');
  // folding legs that did not lock (Jason-3): the ship falls even on a soft touchdown
  const fold = specOf((() => { const j = preset('reliable'); j.parts.find((p) => p.type === 'legs_m').type = 'legs_falcon_m'; return j; })());
  const ff = flightOf(fold, 3);
  ff.state.landing.legDefect = 'legLock';
  const locked = LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: 0.3, y: -1.2, z: 0 } }) }, ff);
  check(locked?.cause === 'tipped_over' && ff.notes.some((n) => n.what === 'legLock'), 'a folding leg that did not lock: the ship tips over (Falcon 9 / Jason-3, 2016)');
  // three legs, one does not lock: the stance on that side is gone, the ship falls (no stance factor ≈ 0 slips through)
  const f3 = flightOf(fold, 3);
  f3.traits = { ...f3.traits, landing: { ...f3.traits.landing, touchdown: { ...f3.traits.landing.touchdown, count: 3 } } };
  f3.state.landing.legDefect = 'legLock';
  check(LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: 0, y: -1.2, z: 0 } }) }, f3)?.cause === 'tipped_over', 'three legs with one unlocked: the ship falls even straight down');
  // a weak strut: less energy, by the factor the traits carry
  const fw = flightOf(reliable, 3);
  fw.state.landing.legDefect = 'weakCore';
  check(LFX.touchdownLimit(3, { fc: fakeFc({ mass: 22000 }) }, fw) < at(22000), 'a weak shock absorber takes less');
  fw.traits = { ...fw.traits, landing: { ...fw.traits.landing, touchdown: { ...fw.traits.landing.touchdown, defects: { weakCore: 0.5, bagTear: 0.5 } } } };
  check(LFX.touchdownLimit(3, { fc: fakeFc({ mass: 22000 }) }, fw) < LFX.legLimit(ref, 22000, gM, 0.75), 'the weak-strut factor comes from the traits (landing.json legDefects)');
  // the lean that counts is the one along the drift: leaning back against it helps, leaning into it hurts
  const lean = (deg, vx) => { const r = (deg * Math.PI) / 180; const fl = flightOf(reliable, 3); fl.state.landing.legDefect = null; return LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: vx, y: -1, z: 0 }, forward: { x: Math.sin(r), y: Math.cos(r), z: 0 } }) }, fl); };
  const v = ref.tipMps + 0.3;
  check(lean(0, v)?.cause === 'tipped_over' && lean(-12, v) === null, `sideways ${v.toFixed(1)} m/s: falls standing straight, stands leaning 12° back against the drift`);
  check(lean(10, ref.tipMps - 0.3)?.cause === 'tipped_over' && lean(-10, ref.tipMps - 0.3) === null, 'leaning 10° into the drift it falls at less, leaning away it stands');
  const sideLean = (() => { const r = (12 * Math.PI) / 180; const fl = flightOf(reliable, 3); fl.state.landing.legDefect = null; return LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: ref.tipMps - 0.3, y: -1, z: 0 }, forward: { x: 0, y: Math.cos(r), z: Math.sin(r) } }) }, fl); })();
  check(sideLean === null, 'leaning 12° across the drift (not into it): judged as standing straight');
  // leaning past the tip angle with no drift: it falls, and the record says why
  const past = flightOf(reliable, 3);
  past.state.landing.legDefect = null;
  const r25 = ((ref.tipAngleDeg + 3) * Math.PI) / 180;
  const fellStill = LFX.step({ fc: fakeFc({ mass: 22000, alt: -0.01, vel: { x: 0, y: -1, z: 0 }, forward: { x: Math.sin(r25), y: Math.cos(r25), z: 0 } }) }, past);
  check(fellStill?.cause === 'tipped_over' && past.notes.some((n) => n.what === 'tipTilt'), `no drift, leaning ${(ref.tipAngleDeg + 3).toFixed(0)}° (past ${ref.tipAngleDeg}°): it falls over, noted as a lean`);
}

// ---------- dice: seeded and about the part's real failure rate ----------
{
  const roll = (seed) => { const f = flightOf(reliable, seed); return JSON.stringify(f.state.landing); };
  check(roll(7) === roll(7), 'the same seed gives the same legs, canopies and antennas');
  let legs = 0, chutes = 0, ants = 0;
  const N = 4000;
  for (let i = 1; i <= N; i++) { const st = flightOf(reliable, i).state.landing; if (st.legDefect) legs++; if (Object.values(st.canopies).some((c) => c.fails)) chutes++; if (st.antennaFailed.length) ants++; }
  const pct = (x) => (100 * x) / N;
  check(Math.abs(pct(legs) - 1) < 0.5, `legs defect ${pct(legs).toFixed(2)} % (part reliability 99 %)`);
  check(Math.abs(pct(chutes) - 1) < 0.5, `chute canopy failure ${pct(chutes).toFixed(2)} % (reliability 99 %)`);
  check(pct(ants) < 0.6, `antenna failure ${pct(ants).toFixed(2)} % (reliability 99.8 %)`);
}

// ---------- chutes: each canopy waits for its own Mach limit ----------
{
  const withCanopy = (type, canopy) => { const j = preset('reliable'); const p = j.parts.find((x) => x.type === 'parachute'); if (type) p.type = type; if (canopy) p.options = { ...(p.options ?? {}), canopy }; return specOf(j); };
  const a = L.chute.soundSpeedMps;
  const run = (spec, speeds, seed = 2) => {
    const f = flightOf(spec, seed);
    for (const c of Object.values(f.state.landing.canopies)) c.fails = false;
    let fc = null;
    for (const [alt, v] of speeds) { fc = fakeFc({ alt, vel: { x: v * 0.3, y: -v * 0.954, z: 0 }, chuteOpen: true }); LFX.step({ fc }, f); }
    return { f, cdA: LFX.chuteCdA(0, { fc }, f), notes: f.notes.map((n) => n.what) };
  };
  const dgb = run(reliable, [[8000, 560], [5000, 505], [3000, 300]]);
  check(dgb.cdA === 300 && dgb.notes[0] === 'chuteOpen' && dgb.f.notes[0].value <= 2.2, `disk-gap-band: opens at Mach ${dgb.f.notes[0].value} (≤ 2.2), full drag`);
  const ring = withCanopy(null, 'ringsail');
  const early = run(ring, [[8000, 505]]);
  check(early.cdA === 0 && early.notes.length === 0, 'ringsail at Mach 2.2: the computer waits (subsonic canopy)');
  const later = run(ring, [[8000, 505], [2000, 0.6 * a]]);
  check(later.cdA > 300 && later.notes[0] === 'chuteOpen', `ringsail below Mach 0.7: opens, ${later.cdA} m² (15 % more drag than the DGB)`);
  const floor = run(ring, [[8000, 505], [L.chute.floorM - 1, 1.5 * a]]);
  check(floor.cdA === 0 && floor.notes[0] === 'chuteTorn' && floor.f.notes[0].trait === 'chute.byPart.{partId}.maxMach', `still Mach 1.5 at ${L.chute.floorM} m: the backup fires it anyway and it tears`);
  const tornNote = floor.f.notes[0];
  const altTraits = specOf(preset('reliable')).stats.traits.landing;
  check(tornNote.value > tornNote.limit && getPath(altTraits, tornNote.trait.replace('{partId}', tornNote.partId)) > tornNote.value, 'what-if: with the disk-gap-band the same opening would have held');
  // a cluster lands on one canopy less; a single canopy is simply lost; Soyuz' reserve gives about 57 %
  const fail = (spec) => { const f = flightOf(spec, 4); for (const c of Object.values(f.state.landing.canopies)) c.fails = true; const fc = fakeFc({ alt: 3000, vel: { x: 0, y: -150, z: 0 }, chuteOpen: true }); LFX.step({ fc }, f); return { cdA: LFX.chuteCdA(0, { fc }, f), notes: f.notes.map((n) => n.what) }; };
  const cl = fail(withCanopy('chute_cluster_3')), one = fail(reliable), soy = fail(withCanopy('chute_single_main'));
  check(Math.abs(cl.cdA - 620 * 2 / 3) < 1 && cl.notes.includes('chuteLostOne'), `three mains, one fails: ${cl.cdA.toFixed(0)} m² left (Apollo 15)`);
  check(one.cdA === 0 && one.notes.includes('chuteLost'), 'one supersonic chute that fails: no chute');
  check(Math.abs(soy.cdA - 330 * 0.57) < 1 && soy.notes.includes('chuteReserve'), `Soyuz main fails: the reserve gives ${soy.cdA.toFixed(0)} m²`);
  // the computer's trigger (FlightController hook): the fastest canopy on board, anything below the floor
  const f = flightOf(withCanopy(null, 'ribbon'), 1);
  check(Math.abs(LFX.chuteDeploy({ maxSpeed: 500, maxAltitude: 15000 }, { alt: 9000 }, f).maxSpeed - 2.5 * a) < 1e-9, 'a ribbon canopy lets the computer open it earlier (Mach 2.5)');
  check(LFX.chuteDeploy({ maxSpeed: 500, maxAltitude: 15000 }, { alt: 200 }, f).maxSpeed === Infinity, 'below the floor the computer fires whatever is packed');
  // the drag hook is pure and counts a packed canopy the moment the ship is slow enough (no one-step lag; the
  // trajectory prediction, which runs no step(), sees it too)
  const fp = flightOf(reliable, 2);
  for (const c of Object.values(fp.state.landing.canopies)) c.fails = false;
  const fcp = fakeFc({ alt: 5000, chuteOpen: true });
  check(LFX.chuteCdA(300, { fc: fcp, speed: 2.2 * a - 1 }, fp) === 300 && LFX.chuteCdA(300, { fc: fcp, speed: 2.2 * a + 5 }, fp) === 0, 'a packed DGB counts from the step the ship drops below Mach 2.2, not before');
  check(Object.values(fp.state.landing.canopies).every((c) => c.state === 'packed'), 'and the hook changes nothing (pure)');
  for (const c of Object.values(fp.state.landing.canopies)) c.fails = true;
  check(LFX.chuteCdA(300, { fc: fcp, speed: 300 }, fp) === 0, 'a canopy that will fail is not counted ahead');
}

// ---------- records: the touchdown note follows the notes contract ----------
{
  const f = flightOf(reliable, 5);
  const fc = fakeFc({ mass: 21800, alt: -0.01, vel: { x: 0.4, y: -1.8, z: 0 } });
  LFX.step({ fc }, f);
  LFX.end({ fc, landed: true, touchdownSpeed: 1.85 }, f);
  const td = f.notes.find((n) => n.what === 'touchdown');
  check(td && td.value === 1.85 && td.limit > 3 && td.group === 'landing' && td.partId === L.touchdown.partId, `touchdown note: ${td?.value} m/s against ${td?.limit} m/s`);
  const lim = getPath(reliable.stats.traits.landing, td.trait.replace('{partId}', td.partId));
  check(Math.abs(lim - td.limit) < 0.1, `its trait path (${td.trait}) gives the same limit for this landed mass (${lim})`);
  check(f.notes.some((n) => n.what === 'power' && n.value === L.power.generationW), 'the ship\'s power on Mars is recorded at touchdown');
  const crashF = flightOf(reliable, 5);
  LFX.end({ fc: fakeFc({ mass: 21800 }), failed: { causeId: 'crash_landing', touchdownSpeed: 9 } }, crashF);
  check(crashF.notes.some((n) => n.what === 'touchdown' && n.value === 9 && n.value > n.limit), 'a crash is recorded too (speed over the limit)');
  // FlightController's own upright check (over 20°) ends it: a lean note, and the touchdown is not called good
  const tilted = flightOf(reliable, 5);
  const r21 = (20.5 * Math.PI) / 180;
  const fct = fakeFc({ mass: 21800, alt: -0.01, vel: { x: 0, y: -1.5, z: 0 }, forward: { x: Math.sin(r21), y: Math.cos(r21), z: 0 } });
  LFX.step({ fc: fct }, tilted);
  LFX.end({ fc: fct, failed: { causeId: 'tipped_over', touchdownSpeed: 1.5 } }, tilted);
  const tt = tilted.notes.find((n) => n.what === 'tipTilt'), tdn = tilted.notes.find((n) => n.what === 'touchdown');
  check(tt && tt.value === 20.5 && tt.limit === 20 && tdn?.tone === 'bad', `FlightController's tipped_over at 20.5°: "${tt?.what}" note (limit ${tt?.limit}°), touchdown marked bad`);
  // a sideways fall: its trait points at the sideways limit for the lean it had
  const sideF = flightOf(reliable, 5);
  const r8 = (8 * Math.PI) / 180;
  LFX.step({ fc: fakeFc({ mass: 21800, alt: -0.01, vel: { x: 2.5, y: -1, z: 0 }, forward: { x: Math.sin(r8), y: Math.cos(r8), z: 0 } }) }, sideF);
  const tip = sideF.notes.find((n) => n.what === 'tipOver');
  const tipAlt = getPath(reliable.stats.traits.landing, tip?.trait?.replace('{partId}', tip.partId) ?? '');
  check(tip && /tipByTiltDeg\.10$/.test(tip.trait) && Math.abs(tipAlt - tip.limit) < 0.4, `tip-over note at an 8° lean: trait ${tip?.trait} (${tipAlt} m/s) against the flight's ${tip?.limit} m/s`);
}

// ---------- the presets on Mars with the real FlightController and autopilot ----------
function descend(spec, seed, fuelFrac = 0.25) {
  const rng = seeded(seed);
  FX.resetPartEffects();
  FX.flightFor(spec, { fresh: true, rng });
  const m = new FlightController({ g0: G0, planets: PLANETS, shipSpec: spec, rng, planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel: spec.stats.fuelMass * fuelFrac });
  approachBack(m, 40);
  const corridor = computeCorridor(m);
  const ap = createAutopilot();
  for (let i = 0; !m.failed && !m.landed && i < 60 * 1500; i++) m.update(1 / 60, ap.update(m, { corridor }), { timeWarp: m.altitude > 3000 ? 4 : 1 });
  return m;
}
// only this group's effects (the other groups' traits and the flat minThrottle / ignitions taken out), so the check
// answers for the landing effects alone; the line after it shows the whole ship as it flies today, for information
const landingOnly = (spec) => ({ ...spec, stats: { ...spec.stats, minThrottle: 0, ignitions: null, traits: { version: spec.stats.traits.version, landing: spec.stats.traits.landing } } });
{
  const say = (runs) => `${runs.filter((m) => m.landed).length}/${runs.length}, touchdown ${runs.map((m) => m.landingSpeed?.toFixed(2) ?? m.failed?.causeId).join(', ')}`;
  for (const k of ['reliable', 'workhorse', 'coldMorning']) {
    const spec = specOf(preset(k));
    const runs = [11, 12, 13].map((s) => descend(landingOnly(spec), s));
    check(runs.every((m) => m.landed), `${k}: lands on Mars with the landing effects (${say(runs)} m/s)`);
    console.log(`      ${k} with every group's effects: ${say([11, 12].map((s) => descend(spec, s)))}`);
  }
  const thin = descend(landingOnly(specOf(preset('thinSkin'))), 11);
  check(thin.failed?.endingId === 'theFoam', 'Thin Skin still loses its shield the Columbia way');
  {
    const j = preset('reliable'); j.parts.find((p) => p.type === 'parachute').options = { canopy: 'ringsail' };
    const ring = descend(landingOnly(specOf(j)), 11);
    const open = ring.fx.flight.notes.find((n) => n.what === 'chuteOpen' || n.what === 'chuteTorn');
    check(ring.landed && open?.what === 'chuteOpen' && open.value <= 0.7 + 1e-9, `a ringsail on the Reliable opens only subsonic (Mach ${open?.value}) and the ship still lands`);
  }
}

// ---------- the rovers' power from the ship ----------
{
  let now = 0;
  const saved = { data: { partEffects: { flights: [{ id: 'f1', name: reliable.name, notes: [] }] } } };
  const save = { load: () => saved.data, update: (p) => { saved.data = { ...saved.data, ...p }; return saved.data; } };
  RV.configureRoverPower({ ship: () => reliable, save, clock: () => now });
  const lrv = new RoverController({ gravity: gM, start: { x: 6.5, z: 7 } });
  const mr = new RoverController({ gravity: gM, spec: ROVER_MR01, start: { x: -7, z: 7 } });
  check(Math.abs(lrv.capacityWh - 8700 / 87) < 1e-9 && lrv.batteryFrac === 1, `with the ship's traits the LRV battery runs on the suit's clock: ${lrv.capacityWh.toFixed(0)} Wh (8.7 kWh ÷ 87), full on arrival`);
  const flatKm = lrv.capacityWh / (roverWhPerMetre(ROVER, gM, 1)) / 1000;
  check(flatKm > 1 && flatKm < 1.6, `a full LRV drives about ${flatKm.toFixed(2)} km on the flat; reach out and back ${roverReachMetres(ROVER, lrv.capacityWh, gM).toFixed(0)} m`);
  // drive 300 m away, then come back and park by the lander
  const drive = (r, seconds, input) => { for (let t = 0; t < seconds; t += 1 / 60) { now += 1 / 60; r.update(1 / 60, input); } };
  drive(lrv, 60, { throttle: 1 });
  const afterDrive = lrv.batteryWh;
  check(afterDrive < lrv.capacityWh * 0.9, `a minute at full speed uses ${(100 * (1 - lrv.batteryFrac)).toFixed(0)} % of the LRV battery`);
  drive(lrv, 10, { brake: true });
  const far = lrv.batteryWh;
  now += 120;
  check(Math.abs(lrv.batteryWh - far) < 1e-9 && !lrv.pluggedIn, 'parked far from the lander: no charge');
  lrv.x = 6.5; lrv.z = 7; lrv.speed = 0;
  const before = lrv.batteryWh;
  now += 60;
  const gained = lrv.batteryWh - before;
  check(lrv.pluggedIn && Math.abs(gained - (ROVER.chargeW * 60) / 3600) < 0.5, `parked by the lander: +${gained.toFixed(1)} Wh in a minute (the LRV's own 870 W charger; the ship's battery covers what the panel cannot)`);
  now += 3600;
  check(lrv.batteryFrac === 1, 'given time, the ship fills it');
  check(mr.batteryFrac === 1 && mr.power === lrv.power, 'both rovers share the ship\'s power');
  const note = saved.data.partEffects.flights[0].notes.find((n) => n.what === 'roverEnergy');
  check(note && note.via === 'save' && note.value > 0 && note.chargedWh > 0 && note.km > 0, `recorded for the hangar: ${note?.km} km on ${note?.value} Wh, ${note?.chargedWh} Wh charged back`);
  // a weak power system: a solar panel only (no battery) charges slowly; nothing at all never
  const weak = { ...reliable, stats: { ...reliable.stats, traits: { ...reliable.stats.traits, landing: { ...L, power: { ...L.power, batteryWh: 0, batteryMaxW: 0, storeWh: 0 } } } } };
  RV.configureRoverPower({ ship: () => weak, save: null, clock: () => now });
  const w = new RoverController({ gravity: gM, start: { x: 6.5, z: 7 } });
  w.batteryWh = 0;
  now += 60;
  const minute = w.batteryWh;
  check(Math.abs(minute - (L.power.solarMarsW * 60) / 3600) < 0.05, `panel only: +${minute.toFixed(2)} Wh a minute (${L.power.solarMarsW} W after Mars sunlight, night and dust): a full charge takes ${(w.capacityWh / minute).toFixed(0)} minutes`);
  const none = specOf(preset('coldMorning'));
  RV.configureRoverPower({ ship: () => none, save: null, clock: () => now });
  const n = new RoverController({ gravity: gM, start: { x: 6.5, z: 7 } });
  const n0 = n.batteryWh;
  now += 600;
  check(Math.abs(n.batteryFrac - 0.84) < 1e-9 && n.batteryWh === n0, 'no power parts: the rover arrives at 84 % and nothing charges it');
  // a new mission's ship: the rover's charge follows the new ship
  let ship = reliable;
  RV.configureRoverPower({ ship: () => ship, save: null, clock: () => now });
  const m2 = new RoverController({ gravity: gM, start: { x: 6.5, z: 7 } });
  m2.batteryWh = 1;
  ship = specOf(preset('workhorse'));
  check(m2.batteryFrac === 1, 'a new ship (a new mission): the rover is charged again for it');
  RV.configureRoverPower({ ship: null, save: null, clock: null });
}

console.log(failures ? `\n${failures} FAILED` : '\nall landing effects checks passed');
process.exit(failures ? 1 : 0);
