// Propulsion effects in flight (wave 5), Node only: node src/flight/tests/effects-propulsion.test.mjs
// src/flight/effects/propulsion.js: the pad holding a strong ship back, the throttle floor and the hoverslam it forces
// (src/flight/autopilot.js), engine starts across the scenes, a restart that fails, an engine failing in flight
// (engine-out or not), steering authority, the records, neutral behaviour without traits, seeded dice, the presets.
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
const L = await imp('src/builder/asBuilt.js');
const FX = await imp('src/flight/effects/index.js');
const P = await imp('src/flight/effects/propulsion.js');
const { FlightController, TUNING } = await imp('src/flight/FlightController.js');
const { createAutopilot, SLAM } = await imp('src/flight/autopilot.js');
const { approachBack, computeCorridor } = await imp('src/flight/corridor.js');
const { STARTS, MOCK_SHIPS } = await imp('src/flight/presets.js');
const { createDebrisField } = await imp('src/flight/debris.js');
const { cross, norm, dot, sub } = await imp('src/flight/vec.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const traitsData = Object.fromEntries(['propulsion', 'structure', 'life', 'landing'].map((g) => [g, read(`src/builder/traits/${g}.json`)]));
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData };
const preset = (k) => read(`src/builder/data/presets/${k}.json`);
const build = (json) => new Assembly(json, catalog);
const resultOf = (json) => { const a = build(json); return { a, r: computeShipSpec(a, deps) }; };
const specOf = (json) => resultOf(json).r.spec;
/** The ShipSpec that flies (asBuilt.js, a fixed build serial: deterministic). */
const flownOf = (json, serial = 1) => { const { a, r } = resultOf(json); return L.buildAsFlown(r, { g0: G0, planets: PLANETS, layout: a.layout(), catalog, engines: deps.engines, materials: deps.materials, hull: a.hull, serial }); };
const withTail = (shapeId, base = 'reliable') => { const a = build(preset(base)); SEC.applyShape(a, sections.tail, sections.tail.shapes.find((s) => s.id === shapeId)); return a; };
/** mulberry32: a seeded rng for the flight's dice. */
const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const FRAME = 1 / 60;
const fcOn = (spec, o = {}) => new FlightController({ g0: G0, planets: PLANETS, shipSpec: spec, rng: o.rng ?? seeded(1), ...o });
const notesOf = (fc, what) => fc.fx.flight.notes.filter((n) => n.group === 'propulsion' && (!what || n.what === what));
/** The countdown as src/flight/index.js flies it: clamps on, engine start at T−3 s, release at T−0. */
function countdown(fc) { fc.holdDown = true; fc.throttle = 1; for (let i = 0; i < 180; i++) fc.update(FRAME, {}, {}); fc.holdDown = false; }
/** Straight up at full throttle until `alt` m or `s` seconds. */
function climb(fc, { alt = 200, s = 60 } = {}) { const t0 = fc.t; while (!fc.failed && fc.altitude < alt && fc.t - t0 < s) fc.update(FRAME, { aim: fc.up }, {}); }
/** Mars entry to touchdown with the game's autopilot (fixed fuel). */
function landOnMars(spec, { fuel = 1500, rng = seeded(1), fresh = true } = {}) {
  if (fresh) FX.resetPartEffects();
  const m = fcOn(spec, { planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel, rng });
  approachBack(m, 40);
  const corridor = computeCorridor(m);
  const ap = createAutopilot();
  let f = 0;
  while (!m.failed && !m.landed && f < 60 * 1500) { m.update(FRAME, ap.update(m, { corridor }), { timeWarp: m.altitude > 3000 ? 4 : 1 }); f++; }
  return m;
}
/** A whole mission like the game: pad, orbit, transfer burn (rocket equation, as index.js), Mars entry, touchdown. */
function mission(spec, seed = 1) {
  FX.resetPartEffects();
  const rng = seeded(seed);
  const fc = fcOn(spec, { rng });
  const ap = createAutopilot();
  countdown(fc);
  let f = 0;
  while (!fc.failed && fc.phase !== 'orbit' && f < 60 * 1500) { fc.update(FRAME, ap.update(fc, {}), { timeWarp: 4 }); f++; }
  if (fc.failed || fc.phase !== 'orbit') return { fc, failed: fc.failed ?? { endingId: 'stuck' } };
  // the orbital debris encounter src/flight/index.js runs in every mission, 20 s into the orbit
  for (let i = 0; i < 60 * 2 && !fc.failed; i++) fc.update(FRAME, ap.update(fc, {}), { timeWarp: 10 });
  fc.setObstacles(createDebrisField({ fc, aheadDistance: 3600, count: 45, seed: 2041 }));
  const steps = new Set();
  for (let i = 0; i < 60 * 100 && !fc.failed; i++) { fc.update(FRAME, ap.update(fc, {}), { timeWarp: 1 }); steps.add(ap.status.step); }
  if (fc.failed) return { fc, failed: fc.failed, steps };
  const dv = (deps.balance.deltaVKmS?.transfer ?? 1) * 1000;
  const fuel = fc.mass / Math.exp(dv / (fc.ship.ispVac * G0)) - fc.ship.dryMass;
  if (fuel < 0) return { fc, failed: { endingId: 'adrift' } };
  const m = landOnMars(spec, { fuel, rng, fresh: false });
  return { fc, m, failed: m.failed, landed: m.landed, steps };
}

// ---------- neutral without traits ----------
{
  FX.resetPartEffects();
  const fc = fcOn(MOCK_SHIPS.reliable);
  const ctx = { fc, alt: 0, dt: FIXED(), speed: 0, phase: fc.phase };
  check(fc.fx.value('thrust', 123456, ctx) === 123456 && fc.fx.value('ignite', true, { fc }) === true && fc.fx.value('turnAccel', 0.8, { fc }) === 0.8, 'a ShipSpec without traits: thrust, ignitions and steering exactly as before');
  check(fc.ship.minThrottle === 0 && fc.ship.ignitions === Infinity, 'no traits: no throttle floor, unlimited starts (FlightController defaults)');
  check(P.step({ fc, dt: FIXED() }, fc.fx.flight) === null && fc.fx.flight.state.propulsion === undefined, 'no traits: begin keeps no state and step does nothing');
}
function FIXED() { return 1 / 120; }

// ---------- the pad: a cheap pad holds a strong ship back ----------
{
  const lift = (site) => {
    const spec = specOf({ ...preset('workhorse'), launch: { site } });
    FX.resetPartEffects();
    const fc = fcOn(spec);
    countdown(fc);
    const p = spec.stats.traits.propulsion.pad;
    climb(fc, { alt: p.clearM + 5, s: 40 });
    const tc = notesOf(fc, 'towerClear')[0];
    return { fc, p, clearS: tc?.value ?? null, acc: notesOf(fc, 'liftoff')[0]?.value ?? null, held: notesOf(fc, 'padHeld')[0] ?? null };
  };
  const good = lift('slc40'), cheap = lift('slc4e');
  check(good.p.heldThrottle === 1 && !good.held && cheap.p.heldThrottle < 1 && cheap.held, `Workhorse: full thrust off SLC-40; held at ${Math.round(cheap.p.heldThrottle * 100)} % on SLC-4E (a smaller trench)`);
  check(cheap.acc < good.acc && cheap.clearS > good.clearS, `the cheap pad is a slow climb: lift-off ${cheap.acc} vs ${good.acc} m/s², tower cleared after ${cheap.clearS} vs ${good.clearS} s`);
  const n = cheap.fc.thrustNow() * cheap.fc.throttle;
  check(Math.abs(cheap.fc.fx.value('thrust', n, { fc: cheap.fc, alt: cheap.fc.altitude }) - n) < 1e-6, 'above the tower the engines throttle up to full');
  check(cheap.held?.limit === cheap.p.heatLimitKN && cheap.held?.trait === 'pad.heatLimitKN' && cheap.held.value > cheap.held.limit, 'the record carries the pad\'s limit for the what-if (value > limit = held back)');
  // the flight computer's status line stays honest while the pad holds the thrust back (no new message)
  const statusOff = (site) => { const spec = specOf({ ...preset('workhorse'), launch: { site } }); FX.resetPartEffects(); const fc = fcOn(spec); countdown(fc); fc.update(FRAME, { aim: fc.up }, {}); const ap = createAutopilot(); ap.update(fc, {}); return ap.status.text; };
  check(statusOff('slc40') === 'Climbing straight up at full throttle' && statusOff('slc4e') === 'Climbing straight up', 'held back, the computer no longer says "at full throttle"');
}

// ---------- throttle floor, the hoverslam it forces, and the hangar's record ----------
{
  const spec = specOf(preset('reliable'));
  FX.resetPartEffects();
  check(Math.abs(fcOn(spec).ship.minThrottle - 0.58) < 1e-9, 'Reliable\'s engine (gas generator, coaxial injector) goes no lower than 58 %: FlightController honours it');
  // Reliable on Mars: at its floor the engine still pushes about 10 × its weight, so it cannot hover: the computer slams
  for (const floor of [0.1, 0.4, 0.67, 1.0]) {
    const flown = flownOf(preset('reliable'), 1).spec;
    const s = { ...flown, stats: { ...flown.stats, minThrottle: floor } };
    const m = landOnMars(s, { fuel: 1500 });
    check(m.landed && !m.failed && m.landingSpeed <= 3, `Reliable at a ${Math.round(floor * 100)} % floor lands on one late burn: ${m.landed ? `${m.landingSpeed.toFixed(2)} m/s` : JSON.stringify(m.failed?.causeId)}`);
  }
  // a heavy arrival (a quarter of its propellant left: 51 t, 900 m/s of drift under the chute) brakes the drift at full
  // thrust first, then lands, and never relights in the last centimetres (a ship pushed back up on Mars would be flown
  // as an Earth ascent): the regression the landing group found
  for (const seed of [11, 12]) {
    const wh = flownOf(preset('workhorse'), seed).spec;
    const heavy = landOnMars(wh, { fuel: wh.stats.fuelMass * 0.25, rng: seeded(seed) });
    check(heavy.landed && heavy.landingSpeed <= 3, `heavy Workhorse (${Math.round(wh.stats.fuelMass * 0.25)} kg left) brakes its drift and lands: ${heavy.landed ? heavy.landingSpeed.toFixed(2) + ' m/s' : JSON.stringify(heavy.failed?.causeId)}`);
  }
  const m = landOnMars(flownOf(preset('reliable'), 1).spec, { fuel: 1500 });
  const hover = notesOf(m, 'hover')[0], floorNote = notesOf(m, 'throttleFloor')[0];
  check(hover && hover.value > hover.limit && hover.trait === 'throttleDepth' && hover.need < hover.floor, `the record: hovering needed ${hover?.need} % but the floor is ${hover?.floor} % (value > limit = could not hover)`);
  check(floorNote && floorNote.value >= 0.58 - 1e-9, `the record: the lowest throttle used was ${Math.round((floorNote?.value ?? 0) * 100)} %`);
  // a deep-throttling engine-out cluster (Falcon 9: one Merlin at 40 % of nine) can hover-land instead; its TEA-TEB
  // starts are few, so the computer keeps the engines lit at their floor near the ground instead of cut-and-relight
  const f9 = computeShipSpec(withTail('octaweb'), deps).spec;
  const shipFloor = f9.stats.minThrottle;
  check(shipFloor < 0.05, `Octaweb ship floor ${(shipFloor * 100).toFixed(1)} %: deep enough to hover`);
  for (const base of ['workhorse', 'reliable']) for (const fuel of [3000, 8000]) {
    const a = build(preset(base)); SEC.applyShape(a, sections.tail, sections.tail.shapes.find((x) => x.id === 'octaweb'));
    const { r } = { r: computeShipSpec(a, deps) };
    const spec = L.buildAsFlown(r, { g0: G0, planets: PLANETS, layout: a.layout(), catalog, engines: deps.engines, materials: deps.materials, hull: a.hull, serial: 1 }).spec;
    FX.resetPartEffects();
    const m = fcOn(spec, { planetId: 'mars', start: STARTS.marsLanding, fuel, rng: seeded(4) });
    const ap = createAutopilot();
    const left0 = m.ignitionsLeft;
    for (let f = 0; !m.failed && !m.landed && f < 60 * 600; f++) m.update(FRAME, ap.update(m, {}), { timeWarp: 1 });
    check(m.landed && m.landingSpeed <= 3 && left0 - m.ignitionsLeft <= 3, `Octaweb on ${base} (${fuel} kg) hover-lands on TEA-TEB within the 3 starts a Mars arrival carries: ${m.landed ? m.landingSpeed.toFixed(2) + ' m/s' : m.failed?.causeId}, ${left0 - m.ignitionsLeft} used`);
  }
  const a = createAutopilot();
  check(typeof SLAM.hoverMargin === 'number' && a.update, 'the hoverslam tunables are exported for Role 2 (SLAM)');
}

// ---------- engine starts ----------
{
  const spec = specOf(preset('workhorse')); // Merlin-like: TEA-TEB, the pad start plus 5 (an estimate)
  check(spec.stats.ignitions === 6, 'Workhorse (TEA-TEB) has 6 starts');
  FX.resetPartEffects();
  const fc = fcOn(spec);
  countdown(fc);
  climb(fc, { alt: 300, s: 20 });
  check(fc.ignitionsLeft === 5 && notesOf(fc, 'ignition').length === 1 && notesOf(fc, 'ignition')[0].pad, 'the pad start is the first of 6 (one ignition note per start, for the wear model)');
  fc.update(FRAME, { throttleTarget: 0 }, {});
  for (let i = 0; i < 30; i++) fc.update(FRAME, {}, {});
  fc.update(FRAME, { throttleTarget: 1 }, {});
  for (let i = 0; i < 5; i++) fc.update(FRAME, { throttleTarget: 1 }, {});
  const starts = notesOf(fc, 'ignition').length;
  check(fc.ignitionsLeft === 4 && starts === 2, `a relight costs one start (${starts} starts, ${fc.ignitionsLeft} left)`);
  // the next scene of the same launch (Mars) carries what is left, less the transfer burn made between the scenes
  const mars = new FlightController({ g0: G0, planets: PLANETS, shipSpec: spec, planetId: 'mars', start: STARTS.marsLanding, fuel: 3000, rng: seeded(2) });
  check(mars.ignitionsLeft === 3, `Mars gets the starts left after the transfer burn: 6 − 2 − 1 = ${mars.ignitionsLeft}`);
  // stop-gap (Role 2 entry flicker): above 3 km on Mars a start is given back
  FX.resetPartEffects();
  const high = new FlightController({ g0: G0, planets: PLANETS, shipSpec: spec, planetId: 'mars', start: { altitude: 20000, speed: 500, flightPathDeg: -20 }, fuel: 3000, rng: seeded(3) });
  const before = high.ignitionsLeft, k0 = high.fx.flight.notes.length;
  const newNotes = (what) => high.fx.flight.notes.slice(k0).filter((n) => n.what === what);
  high.update(FRAME, { throttleTarget: 1 }, {}); high.update(FRAME, { throttleTarget: 0 }, {}); high.update(FRAME, {}, {});
  check(high.ignitionsLeft === before && newNotes('ignitionRefunded').length === 1 && !newNotes('ignition').length, 'a start above 3 km on Mars is not charged nor worn (stop-gap until Role 2 fixes the entry flicker)');
  // the same by altitude alone: a ship with unlimited starts gets no wear from the flicker either
  FX.resetPartEffects();
  const free = new FlightController({ g0: G0, planets: PLANETS, shipSpec: specOf(preset('reliable')), planetId: 'mars', start: { altitude: 20000, speed: 500, flightPathDeg: -20 }, fuel: 3000, rng: seeded(3) });
  free.update(FRAME, { throttleTarget: 1 }, {}); free.update(FRAME, { throttleTarget: 0 }, {}); free.update(FRAME, {}, {});
  check(notesOf(free, 'ignitionRefunded').length === 1 && !notesOf(free, 'ignition').length, 'a spark-lit ship (no start limit) gets no ignition note or wear from a start above 3 km on Mars either');
}

// ---------- a restart that fails to light ----------
{
  const spec = specOf(preset('reliable'));
  FX.resetPartEffects();
  const fc = fcOn(spec, { rng: () => 0 }); // every die rolls 0: every restart fails, every unit... is rolled at 0 too
  fc.fx.flight.state.propulsion.units = []; // keep the engines healthy for this check
  countdown(fc);
  climb(fc, { alt: 300, s: 20 });
  check(fc.engineLit && !fc.failed, 'the pad start never fails here (the pad and the clamps check it: asBuilt.js)');
  fc.update(FRAME, { throttleTarget: 0 }, {});
  for (let i = 0; i < 10; i++) fc.update(FRAME, {}, {});
  fc.update(FRAME, { throttleTarget: 1 }, {});
  fc.update(FRAME, {}, {});
  const nf = notesOf(fc, 'ignitionFailed').length;
  check(!fc.engineLit && nf >= 1 && fc.fx.flight.state.propulsion.ign.failed === nf, `a restart in flight can fail to light (${nf} tries recorded, each start spent)`);
  const p = spec.stats.traits.propulsion;
  check(p.engines[0].restartFail > 0 && p.engines[0].restartFail < 0.02, `Reliable's restart fails ${(p.engines[0].restartFail * 100).toFixed(2)} % of the time (spark, 0.3 × (1 − reliability))`);
  // the ignite hook is pure: asking twice gives the same answer and changes nothing
  const st = JSON.stringify(fc.fx.flight.state.propulsion);
  const a1 = fc.fx.value('ignite', true, { fc }), a2 = fc.fx.value('ignite', true, { fc });
  check(a1 === a2 && JSON.stringify(fc.fx.flight.state.propulsion) === st, 'the ignite hook is pure (the trajectory prediction may call it)');
}

// ---------- an engine failing in flight ----------
{
  const run = (json, unit, s = 3) => {
    const spec = computeShipSpec(json instanceof Assembly ? json : build(json), deps).spec;
    FX.resetPartEffects();
    const fc = fcOn(spec);
    const st = fc.fx.flight.state.propulsion;
    st.units = [{ ...unit, partId: spec.stats.traits.propulsion.engines[0].partId, done: false }];
    countdown(fc);
    const n0 = fc.thrustNow() * fc.throttle;
    const t0 = fc.t;
    while (!fc.failed && fc.t - t0 < s) fc.update(FRAME, { aim: fc.up }, {});
    return { fc, spec, st, n0, n1: fc.fx.value('thrust', fc.thrustNow() * fc.throttle, { fc, alt: fc.altitude }) / (fc.thrustNow() * fc.throttle) };
  };
  const nine = withTail('octaweb');
  const eo = run(nine, { kind: 'engine', at: 1, mode: 'out', share: computeShipSpec(nine, deps).spec.stats.traits.propulsion.engines[0].unitShare });
  check(!eo.fc.failed && Math.abs(eo.n1 - 8 / 9) < 0.01 && notesOf(eo.fc, 'engineOut').length === 1, `Octaweb loses one engine of nine and flies on at ${(eo.n1 * 100).toFixed(1)} % thrust (CRS-1)`);
  const burst = run(preset('reliable'), { kind: 'engine', at: 1, mode: 'burst', share: 1 });
  check(burst.fc.failed?.endingId === 'rud' && notesOf(burst.fc, 'engineBurst').length === 1, `an uncontained failure loses the ship: "${burst.fc.failed?.cause}"`);
  const shut = run(preset('reliable'), { kind: 'engine', at: 30, mode: 'shutdown', share: 1 }, 32);
  check(!shut.fc.failed && shut.st.dead && shut.fc.fx.value('thrust', 1e6, { fc: shut.fc, alt: shut.fc.altitude }) === 0 && !shut.fc.fx.value('ignite', true, { fc: shut.fc }), 'a single engine that shuts down is lost for the flight: no thrust, no relight (the player must cope)');
  // in orbit with no engine left, the ship drifts
  FX.resetPartEffects();
  const orb = new FlightController({ g0: G0, planets: PLANETS, shipSpec: specOf(preset('reliable')), start: { altitude: 200000, speed: Math.sqrt((PLANETS.earth.g * PLANETS.earth.radius ** 2) / (PLANETS.earth.radius + 200000)), flightPathDeg: 0, facing: 'prograde' }, rng: seeded(4) });
  const so = orb.fx.flight.state.propulsion;
  so.lost = 1; so.lostLiquid = 1; so.dead = true;
  for (let i = 0; i < 60 * 8 && !orb.failed; i++) orb.update(FRAME, {}, {});
  check(orb.failed?.endingId === 'adrift' && notesOf(orb, 'drift').length === 1, 'in orbit with no working engine the ship drifts (Adrift)');
  // the odds: about 0.4 × (1 − reliability) per engine over a full burn
  const p = specOf(preset('reliable')).stats.traits.propulsion;
  let n = 0; const N = 4000;
  for (let i = 0; i < N; i++) { const flight = { traits: { propulsion: p }, state: {}, spec: {}, rng: seeded(100 + i) }; P.begin(flight); if (flight.state.propulsion.units.some((u) => u.kind === 'engine' && u.at <= p.burnRefS)) n++; }
  const want = p.engines[0].inFlightFail;
  check(Math.abs(n / N - want) < 0.006, `in-flight engine failures within the rated burn: ${(n / N * 100).toFixed(2)} % of flights (rated ${(want * 100).toFixed(2)} %)`);
}

// ---------- determinism ----------
{
  const p = specOf(preset('workhorse')).stats.traits.propulsion;
  const roll = (seed) => { const flight = { traits: { propulsion: p }, state: {}, spec: {}, rng: seeded(seed) }; P.begin(flight); return JSON.stringify(flight.state.propulsion); };
  check(roll(7) === roll(7) && roll(7) !== roll(8), 'the same seed rolls the same flight; another seed another');
  const src = readFileSync(path.join(ROOT, 'src/flight/effects/propulsion.js'), 'utf8');
  check((src.match(/Math\.random/g) ?? []).length <= 1, 'dice come from flight.rng (Math.random only as the fallback when none is given)');
}

// ---------- as-built defects realised in time ----------
{
  const spec = specOf(preset('reliable'));
  const id = spec.stats.traits.propulsion.engines[0].partId;
  const flown = { ...spec, stats: { ...spec.stats, asBuiltDefects: [{ kind: 'debris', partId: id, unit: 0, count: 1, pct: 0.1 }] } };
  FX.resetPartEffects();
  const fc = fcOn(flown);
  const before = fc.fx.value('thrust', 1000, { fc, alt: 0 });
  countdown(fc);
  climb(fc, { alt: 1000, s: 3 });
  const after = fc.fx.value('thrust', 1000, { fc, alt: fc.altitude });
  check(Math.abs(before - 1000 / 0.9) < 1e-6 && Math.abs(after - 1000) < 1e-6 && notesOf(fc, 'debrisHit').length === 1, 'pad debris rolled at confirm hits the engine just after lift-off (the flown thrust already lacks it; the flight gives it back until then)');
}

// ---------- steering ----------
{
  FX.resetPartEffects();
  const rel = fcOn(specOf(preset('reliable')));
  countdown(rel);
  const aLift = rel._turnAccel();
  check(aLift >= 0.15 && aLift < 0.4, `Reliable (fixed engine, RCS only) turns slowly when full: ${aLift.toFixed(2)} rad/s²`);
  FX.resetPartEffects();
  const ns = fcOn(computeShipSpec(withTail('new_shepard'), deps).spec);
  countdown(ns);
  check(ns._turnAccel() > aLift, `with a hydraulic gimbal the same climb turns faster: ${ns._turnAccel().toFixed(2)} rad/s²`);
  FX.resetPartEffects();
  const cm = fcOn(specOf(preset('coldMorning')));
  check(Math.abs(cm._turnAccel() - TUNING.turnAccel.noRcs) < 1e-9, 'no RCS and the engine off: the game\'s minimum steering, as before');
}

// ---------- a debris field with no burn left: nose into the stream ----------
{
  const p = PLANETS.earth, alt = 200000;
  const orbitStart = { altitude: alt, speed: Math.sqrt((p.g * p.radius ** 2) / (p.radius + alt)), flightPathDeg: 0, facing: 'prograde' };
  /** One pass through the game's debris field (index.js: 45 pieces 3.6 km ahead); broadside = the old aim forced. */
  const pass = (spec, seed, { broadside = false } = {}) => {
    FX.resetPartEffects();
    const fc = fcOn(spec, { start: orbitStart, rng: seeded(seed) });
    fc.setObstacles(createDebrisField({ fc, aheadDistance: 3600, count: 45, seed }));
    const ap = createAutopilot();
    const steps = new Set();
    let facing = -1;
    for (let f = 0; f < 60 * 90 && !fc.failed; f++) {
      const input = { ...ap.update(fc, {}) };
      steps.add(ap.status.step);
      if (ap.status.step === 'brace') {
        if (broadside) input.aim = norm(cross(fc.pos, fc.vel));
        const piece = fc.obstacles.find((o) => o.id === fc.telemetry.collisionWarning?.id);
        if (piece) facing = Math.max(facing, dot(fc.forward, norm(sub(fc.vel, piece.vel))));
      }
      fc.update(FRAME, input, { timeWarp: 1 });
    }
    const hits = fc.fx.flight.notes.filter((n) => n.group === 'structure' && n.what === 'hit');
    return { lost: !!fc.failed, steps, facing, holes: hits.filter((n) => /puncture|fatal/.test(n.outcome ?? '')).length };
  };
  const base = flownOf(preset('reliable'), 1).spec;
  const noStarts = { ...base, stats: { ...base.stats, ignitions: 0 } };
  const runs = (o) => [0, 1, 2, 3, 4, 5].map((i) => pass(noStarts, 2041 + i, o));
  const nose = runs(), side = runs({ broadside: true });
  const lost = (rs) => rs.filter((r) => r.lost).length, holes = (rs) => rs.reduce((t, r) => t + r.holes, 0);
  check(nose.every((r) => r.steps.has('brace') && !r.steps.has('dodge')) && nose.every((r) => r.facing > 0.95), 'no start left: the computer holds the nose into the stream (within 18°) instead of a dodge it cannot burn');
  check(lost(nose) < lost(side) && holes(nose) < holes(side), `nose-first survives the pass better than broadside: lost ${lost(nose)}/6 vs ${lost(side)}/6, holes ${holes(nose)} vs ${holes(side)}`);
  const free = pass(base, 2041);
  check(free.steps.has('dodge') && !free.steps.has('brace'), 'a ship that can burn still dodges');
  const teateb = flownOf(preset('workhorse'), 1).spec;
  const scarce = pass({ ...teateb, stats: { ...teateb.stats, ignitions: 3 } }, 2041);
  check(scarce.steps.has('brace') && !scarce.steps.has('dodge'), 'a TEA-TEB ship with only the starts the transfer and the landing need keeps them and braces');
}

// ---------- the presets fly their stories ----------
{
  const rel = mission(flownOf(preset('reliable'), 1).spec, 1);
  check(rel.landed && !rel.failed, `Reliable flies to Mars and lands (${rel.landed ? rel.m.landingSpeed.toFixed(2) + ' m/s' : JSON.stringify(rel.failed)})`);
  const wh = mission(flownOf(preset('workhorse'), 1).spec, 1);
  check(wh.landed && !wh.failed, `Workhorse flies to Mars and lands on its TEA-TEB relights (${wh.landed ? wh.m.landingSpeed.toFixed(2) + ' m/s' : JSON.stringify(wh.failed)})`);
  check(rel.steps?.has('dodge') && (wh.steps?.has('brace') || wh.steps?.has('dodge')), `through the orbital debris pass: Reliable dodges (${[...(rel.steps ?? [])].join(', ')}), Workhorse keeps its starts and braces (${[...(wh.steps ?? [])].join(', ')})`);
  const cold = mission(flownOf(preset('coldMorning'), 2).spec, 1);
  check(cold.failed?.endingId === 'coldMorning', `Cold Morning still ends the Challenger way (${cold.failed?.endingId})`);
  const thin = mission(flownOf(preset('thinSkin'), 1).spec, 1);
  check(thin.failed?.endingId === 'theFoam', `Thin Skin still loses its shield the Columbia way (${thin.failed?.endingId})`);
}

console.log(failures ? `\n${failures} propulsion effect check(s) FAILED` : '\nAll propulsion effect checks passed.');
process.exit(failures ? 1 : 0);
