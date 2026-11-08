// Propulsion flight traits, Node only: node src/builder/tests/traits-propulsion.test.mjs
// The real numbers of traits/propulsion.json (throttle floors, starts, steering, in-flight failure, the pad), the
// trade-offs between options, neutral behaviour without data, plain JSON, and the presets.
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
const { propulsionTraits } = await imp('src/builder/traits/propulsion.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const data = read('src/builder/traits/propulsion.json');
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData: { propulsion: data } };
const preset = (key) => read(`src/builder/data/presets/${key}.json`);

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

const build = (json) => new Assembly(json, catalog);
const traitsOf = (a) => computeShipSpec(a, deps).spec.stats.traits.propulsion;
const engineOf = (a) => a.layout().find((e) => e.def.engine);
/** Reliable with its engine's options set (cycle, injector, igniter…). */
function reliableWith(options = {}, fuel = null) {
  const a = build(preset('reliable'));
  const e = engineOf(a);
  for (const [k, v] of Object.entries(options)) if (!a.setOption(e.id, k, v)) throw new Error(`option ${k}=${v} not set`);
  return a;
}
function withTail(shapeId, base = 'reliable') {
  const a = build(preset(base));
  const shape = sections.tail.shapes.find((s) => s.id === shapeId);
  if (!shape) return null;
  SEC.applyShape(a, sections.tail, shape);
  return a;
}

// ---------- the data file ----------
{
  const ids = new Set(data.sources.map((s) => s.id));
  const refs = [];
  const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'src' && typeof v === 'string') refs.push(v); else walk(v); } };
  walk({ cycle: data.cycle, injector: data.injector, pairs: data.pairs, igniter: data.igniter, containment: data.containment, solid: data.solid, steering: data.steering, rcs: data.rcs });
  check(refs.length > 20 && refs.every((r) => ids.has(r)), `every number names a source in propulsion.json (${refs.length} refs, ${ids.size} sources)`);
  check(data.sources.every((s) => s.id && s.what && s.source), 'every source has id, what and source');
  const kit = internalsJson.kits.engine;
  for (const slot of ['cycle', 'injector', 'igniter']) {
    const missing = kit.slots.find((s) => s.key === slot).options.filter((o) => !data[slot]?.[o.id]).map((o) => o.id);
    check(!missing.length, `every engine ${slot} option has real numbers${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  }
  check(near(data.inFlightShare, 1 - L.LUCK.factoryShare), `the in-flight share is what the factory leaves: 1 − ${L.LUCK.factoryShare} = ${data.inFlightShare}`);
  for (const [what, t] of Object.entries(data.notes)) if (!(t.en && t.vi)) fail(`note template ${what}: needs en and vi`);
  check(['ignition', 'liftoff', 'towerClear', 'padHeld', 'engineOut', 'hover', 'ignitions', 'throttleFloor'].every((w) => w === 'ignition' || data.notes[w]), 'templates for every recorded fact (the per-start "ignition" note is for the wear model)');
  check(/stop-gap/i.test(data._about) && ids.has('stopgap'), 'the Mars start stop-gap (Role 2 entry flicker) is stated in the data');
}

// ---------- neutral without data ----------
{
  const a = build(preset('reliable'));
  const neutral = propulsionTraits(a.layout(), {}, null);
  check(JSON.stringify(neutral) === '{}', 'no data: no traits (the flight as before)');
  const n2 = propulsionTraits(a.layout(), {}, { neutral: { minThrottle: 0, ignitions: null } });
  check(n2.minThrottle === 0 && n2.ignitions === null && !n2.engines, 'only the neutral block: the neutral values');
  const r = computeShipSpec(a, { ...deps, traitsData: null });
  check(r.spec.stats.minThrottle === 0 && r.spec.stats.ignitions === null, 'without traitsData the flat minThrottle is 0 and ignitions unlimited (FlightController as before)');
  const empty = propulsionTraits([], { engines: deps.engines }, data);
  check(empty.minThrottle === 0 && !empty.engines, 'no engines: neutral');
}

// ---------- throttle floors of real engines (cycle × injector) ----------
{
  const floorWith = (opts) => traitsOf(reliableWith(opts)).engines[0].floor;
  const rows = [
    ['Merlin 1D (gas generator, pintle)', { cycle: 'gg', injector: 'pintle' }, 0.4],
    ['RS-25 (fuel-rich staged combustion, coaxial)', { cycle: 'sc_fuel', injector: 'coaxial' }, 0.67],
    ['F-1 (gas generator, impinging): on/off', { cycle: 'gg', injector: 'impinging' }, 1],
    ['RS-68A (gas generator, coaxial)', { cycle: 'gg', injector: 'coaxial' }, 0.58],
    ['Raptor (full flow, swirl)', { cycle: 'ffsc', injector: 'swirl' }, 0.4],
    ['RL10A-5 (expander, coaxial), as on the DC-X: a measured pair', { cycle: 'expander', injector: 'coaxial' }, 0.3],
    ['expander with swirl elements: the injector limits it', { cycle: 'expander', injector: 'swirl' }, 0.3],
    ['expander with a pintle: the pintle limits it (the CECE demonstrator reached 8 %)', { cycle: 'expander', injector: 'pintle' }, 0.1],
    ['LMDE (pressure-fed, pintle)', { cycle: 'pressure', injector: 'pintle' }, 0.1],
    ['AJ10 (pressure-fed, impinging): no throttle', { cycle: 'pressure', injector: 'impinging' }, 1],
  ];
  for (const [name, opts, want] of rows) {
    let got = null;
    try { got = floorWith(opts); } catch (e) { fail(`${name}: ${e.message}`); continue; }
    check(near(got, want), `${name}: floor ${Math.round(got * 100)} % (real ${Math.round(want * 100)} %)`);
  }
  const a = reliableWith({ injector: 'pintle' });
  const s = computeShipSpec(a, deps).spec.stats;
  check(near(s.minThrottle, 0.4) && near(s.traits.propulsion.throttleDepth, 0.6), 'the flat minThrottle FlightController reads is the ship floor (Merlin-like single engine: 40 %)');
}

// ---------- clusters: an engine-out structure flies on one engine ----------
{
  const f9 = withTail('octaweb');
  if (f9) {
    const p = traitsOf(f9);
    const e = p.engines[0];
    check(e.count === 9 && e.engineOut && e.canShutDown && near(e.floor, 0.4) && near(p.minThrottle, 0.4 / 9), `Falcon 9 Octaweb: 9 Merlins, engine-out, ship floor ${(p.minThrottle * 100).toFixed(1)} % (one engine at 40 %)`);
    check(!e.pairOut && e.catastrophic < 0.2, `an Octaweb contains a failure (uncontained share ${Math.round(e.catastrophic * 100)} % < a single engine's 20 %)`);
  } else fail('octaweb shape missing');
  const sic = withTail('saturn_sic');
  if (sic) {
    const p = traitsOf(sic);
    check(p.engines[0].count === 5 && near(p.engines[0].floor, 1) && near(p.minThrottle, 0.2), `Saturn V S-IC: five on/off F-1s; shutting four down leaves 1/5 = ${Math.round(p.minThrottle * 100)} %`);
  }
  const n1 = withTail('n1');
  if (n1) {
    const e = traitsOf(n1).engines[0];
    check(e.engineOut && e.pairOut, 'N1: KORD shuts a failed engine down with its opposite partner (ring steered by throttle)');
  }
  // a cluster without engine-out cannot shut engines down on its own: all engines at their floor
  const twin = withTail('titan_ii');
  if (twin) {
    const p = traitsOf(twin);
    check(p.engines[0].count === 2 && !p.engines[0].engineOut && p.engines[0].pairOut && near(p.minThrottle, p.engines[0].floor), 'Titan II: two engines, no engine-out: the ship floor is the engines\' floor and a failure takes both');
  }
}

// ---------- engine starts ----------
{
  const startsWith = (igniter, extra = {}) => traitsOf(reliableWith({ igniter, ...extra })).ignitions;
  check(startsWith('spark') === null, 'spark torch igniter: no limit (null, not Infinity)');
  check(startsWith('tea_teb') === 6, 'TEA-TEB: the pad start from the ground supply plus 5 carried = 6 (an estimate)');
  check(startsWith('pyro') === 1 && startsWith('ampoule') === 1, 'pyrotechnic cartridge and start ampoule: one start');
  check(startsWith('pyro', { cycle: 'pressure' }) === null, 'a pressure-fed (hypergolic) engine relights without limit whatever the igniter');
  const fail1 = (igniter) => traitsOf(reliableWith({ igniter })).engines[0].restartFail;
  check(fail1('ampoule') < fail1('tea_teb') && fail1('tea_teb') < fail1('spark'), `a restart fails less with chemistry (ampoule ${fail1('ampoule')}, TEA-TEB ${fail1('tea_teb')}) than with a spark (${fail1('spark')})`);
  check(traitsOf(reliableWith({ cycle: 'pressure' })).engines[0].restartFail < fail1('ampoule'), 'hypergolic propellants light most surely of all');
  const json = JSON.stringify(computeShipSpec(reliableWith({ igniter: 'spark' }), deps).spec.stats.traits);
  check(!/Infinity|NaN/.test(json) && JSON.parse(json).propulsion.ignitions === null, 'traits are plain JSON: no Infinity or NaN');
}

// ---------- trade-offs: every option is best at something ----------
{
  // igniters: spark (no limit), TEA-TEB (sure relights, limited), pyro (cheapest), ampoule (surest start)
  const opt = (slot, id) => internalsJson.kits.engine.slots.find((s) => s.key === slot).options.find((o) => o.id === id);
  check((opt('igniter', 'pyro').costD ?? 0) < Math.min(opt('igniter', 'spark').costD ?? 0, opt('igniter', 'tea_teb').costD ?? 0, opt('igniter', 'ampoule').costD ?? 0), 'pyro: the cheapest igniter (one start)');
  // injectors: pintle throttles deepest; coaxial and swirl burn better (Isp); impinging is cheapest
  check(data.injector.pintle.floor < data.injector.swirl.floor && (opt('injector', 'pintle').isp ?? 0) < (opt('injector', 'swirl').isp ?? 0), 'pintle throttles deepest, swirl burns better (Isp)');
  check((opt('injector', 'impinging').costD ?? 0) < (opt('injector', 'pintle').costD ?? 0) && data.injector.impinging.floor === 1, 'impinging is the cheapest injector but cannot throttle');
  // cycles: staged combustion and full flow gain Isp; gas generator and expander are gentler; pressure-fed relights
  check((opt('cycle', 'ffsc').isp ?? 0) > (opt('cycle', 'gg').isp ?? 0) && data.cycle.ffsc.catastrophic > data.cycle.gg.catastrophic, 'full flow: more Isp, but a failure is more violent than a gas generator\'s');
  check(data.cycle.expander.catastrophic < data.cycle.gg.catastrophic && data.cycle.expander.floor < data.cycle.gg.floor && (opt('cycle', 'expander').thrustF ?? 1) < 1, 'expander: gentle and deep, but weaker');
  check(data.cycle.pressure.hypergolic && (opt('cycle', 'pressure').thrustF ?? 1) <= 0.5, 'pressure-fed: endless relights, half the thrust');
}

// ---------- steering ----------
{
  const steer = (shapeId) => { const a = withTail(shapeId); return a ? traitsOf(a).steering : null; };
  const rel = traitsOf(build(preset('reliable'))).steering;
  check(rel.tvc === 0 && rel.rcs === 1, 'Reliable: a fixed engine, so only its RCS turns it');
  const ns = steer('new_shepard'), red = steer('single_engine'), soy = steer('soyuz');
  if (ns && red && soy) {
    check(near(ns.tvc, 1, 0.01), `a hydraulic gimbal is the reference authority (New Shepard: ${ns.tvc})`);
    check(red.vanes && red.vanes.k > 0 && red.vanes.loss > 0 && red.vanes.lifeS > 0 && red.tvc === 0, `Redstone jet vanes: authority ${red.vanes.k}, but ${Math.round(red.vanes.loss * 100)} % of the thrust and ${red.vanes.lifeS} s of life`);
    check(soy.verniers > 0 && soy.verniers < 1, `Soyuz verniers: ${soy.verniers} of a gimbal, but at their own thrust (they steer as well at low throttle)`);
  } else fail('steering shapes missing');
  const S = data.steering;
  const k = (d) => d.side * (2 * d.rateDegS) / (d.rateDegS + 10);
  check(k(S.gimbal_emech) > k(S.gimbal_ring) && S.gimbal_emech.rateDegS < S.gimbal_ring.rateDegS, 'electric actuators swing further, hydraulic ones faster');
}

// ---------- in-flight failure ----------
{
  const p = traitsOf(build(preset('reliable')));
  const e = p.engines[0];
  check(near(e.inFlightFail, data.inFlightShare * (1 - e.reliability), 1e-5) && e.inFlightFail > 0 && e.inFlightFail < 0.02, `Reliable's engine fails in flight with ${(e.inFlightFail * 100).toFixed(1)} % (0.4 × (1 − ${e.reliability}))`);
  check(p.burnRefS > 100 && p.burnRefS < 400, `rated burn time ${p.burnRefS} s (its propellant at full thrust)`);
  const w = traitsOf(build(preset('workhorse')));
  check(w.boosters.length === 2 && w.boosters.every((b) => !b.liquid && b.catastrophic >= 0.9 && b.burnTime > 0), 'Workhorse\'s solids cannot be shut down: a failure is a burst');
  const soyuz = withTail('soyuz');
  if (soyuz) check(traitsOf(soyuz).boosters.every((b) => b.liquid && b.catastrophic < 0.5), 'Soyuz\'s liquid boosters fail like engines, not like solids');
}

// ---------- the pad ----------
{
  const atBase = computeShipSpec(build({ ...preset('workhorse'), launch: { site: 'slc40' } }), deps);
  const atSmall = computeShipSpec(build({ ...preset('workhorse'), launch: { site: 'slc4e' } }), deps);
  const pb = atBase.spec.stats.traits.propulsion.pad, ps = atSmall.spec.stats.traits.propulsion.pad;
  check(pb.heldThrottle === 1 && ps.heldThrottle < 1 && near(ps.heldThrottle, atSmall.breakdown.padFx.throttle), `Workhorse: full thrust on SLC-40, held at ${Math.round(ps.heldThrottle * 100)} % on SLC-4E's smaller trench`);
  check(ps.clearM > ps.stackM && ps.thrustKN > ps.heatLimitKN, `it must clear a ${ps.clearM} m tower; it pushes ${ps.thrustKN} kN on a pad that takes ${ps.heatLimitKN} kN`);
  check(atSmall.spec.stats.fuelMass === atBase.spec.stats.fuelMass, 'the builder takes no propellant for it (the flight holds the thrust back)');
}

// ---------- presets ----------
for (const key of ['reliable', 'workhorse', 'coldMorning', 'thinSkin']) {
  const r = computeShipSpec(build(preset(key)), deps);
  const p = r.spec.stats.traits.propulsion;
  check(!r.spec.stats.traits.errors && p.engines.length >= 1 && p.minThrottle > 0 && p.minThrottle < 1, `${key}: traits computed, floor ${Math.round(p.minThrottle * 100)} %, ${p.ignitions ?? 'unlimited'} starts`);
}

console.log(failures ? `\n${failures} propulsion trait check(s) FAILED` : '\nAll propulsion trait checks passed.');
process.exit(failures ? 1 : 0);
