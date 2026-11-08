// The flight computer must never kill a reasonable ship during the ascent, node only: node src/flight/tests/ascentLimits.test.mjs
// Bug (player report): "a mechanism speeds up by itself and then the rocket dies". Flown like the game (index.js): the
// real ShipSpec the builder hands to getShip() (as flown, part traits and effects included), autopilot.update ->
// paceContext -> pacer.decide -> fc.update(dt, input, { timeWarp, stopOnNotice: true }), T-3 throttle 1, T-0 release,
// at 60 fps and at a slow browser's dt = 0.1 s. Before the fix the computer held full throttle in the climb and in the
// circularise burn: a strong ship hit Max-Q at 10 s (TWR 4+), blacked out in the circularise burn (6.4 g for 4 s), and
// a big-fuel ship with a hot pump cooked its engine (full throttle for 250 s).
// A ship that is unflyable by its design (TWR under the builder's 1.2, not enough propellant, the Cold Morning seals)
// is the player's choice and stays a failure (Challenger lesson): only the computer's own mistakes are tested here.
import { readFileSync, readdirSync } from 'node:fs';
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
const { FlightController, TUNING } = await imp('src/flight/FlightController.js');
const { createAutopilot } = await imp('src/flight/autopilot.js');
const { MOCK_SHIPS } = await imp('src/flight/presets.js');
const { ascentGuide } = await imp('src/flight/flightAssist.js');
const { createPacer, createEventDetector, paceContext } = await imp('src/flight/pacing.js');
const { dot } = await imp('src/flight/vec.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const traitsData = Object.fromEntries(['propulsion', 'structure', 'life', 'landing'].map((g) => [g, read(`src/builder/traits/${g}.json`)]));
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData };
const flownOf = (json, serial = 1) => { const a = new Assembly(json, catalog); const r = computeShipSpec(a, deps); return L.buildAsFlown(r, { g0: G0, planets: PLANETS, layout: a.layout(), catalog, engines: deps.engines, materials: deps.materials, hull: a.hull, serial }).spec; };
const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

/** The whole ascent as the game flies it. */
function ascend(spec, dt, seed = 1) {
  FX.resetPartEffects();
  const fc = new FlightController({ g0: G0, planets: PLANETS, shipSpec: spec, planetId: 'earth', start: 'pad', rng: seeded(seed) });
  const ap = createAutopilot(), pacer = createPacer(), det = createEventDetector();
  fc.holdDown = true; fc.throttle = 1; // T-3: engine start, clamps hold
  for (let i = 0; i < 180; i++) fc.update(1 / 60, {}, {});
  fc.holdDown = false; // T-0
  let peakQ = 0, peakG = 0, peakTemp = 0, maxWarp = 1;
  while (!fc.failed && fc.phase !== 'orbit' && fc.t < 1500) {
    const guide = ascentGuide(fc);
    const input = ap.update(fc, {});
    const aligned = guide ? dot(fc.forward, guide.direction) > Math.cos((6 * Math.PI) / 180) : true;
    const ctx = paceContext(fc, { ascent: guide, aligned });
    for (const e of det.update(ctx)) pacer.event(e, ctx.t);
    const d = pacer.decide(ctx, Math.min(dt, 0.1));
    fc.update(dt, input, { timeWarp: d.warp, stopOnNotice: true });
    const t = fc.telemetry;
    peakQ = Math.max(peakQ, t.dynamicPressure / t.maxQ); peakG = Math.max(peakG, t.gLoad); peakTemp = Math.max(peakTemp, t.engineTemp); maxWarp = Math.max(maxWarp, fc.warpEffective);
  }
  return { fc, orbit: fc.phase === 'orbit' && !fc.failed, cause: fc.failed?.causeId ?? null, peakQ, peakG, peakTemp, maxWarp };
}

// ---- the ships the game can fly ------------------------------------------------------------------------------------
const ships = {};
ships['mock reliable'] = MOCK_SHIPS.reliable; ships['mock thinSkin'] = MOCK_SHIPS.thinSkin; ships['mock noShield'] = MOCK_SHIPS.noShield;
for (const f of readdirSync(path.join(ROOT, 'src/core/mocks'))) if (f.startsWith('ship.') && !/cold/i.test(f)) ships[`core ${f}`] = read(`src/core/mocks/${f}`);
for (const f of readdirSync(path.join(ROOT, 'src/builder/data/presets'))) {
  const key = f.replace('.json', '');
  if (key === 'coldMorning') continue;
  for (const serial of [1, 2]) ships[`builder ${key} #${serial}`] = flownOf(read(`src/builder/data/presets/${f}`), serial);
}
// strong, light, hot-pump designs (TWR 1.6 to 11): full throttle all the way is deadly for these
const strong = (thrust, fuelMass, pump = 'M') => ({ ...MOCK_SHIPS.reliable, engines: [{ fuel: 'methalox', nozzle: 'vac', pump }], stats: { ...MOCK_SHIPS.reliable.stats, thrust, fuelMass } });
for (const [thrust, fuel, pump] of [[500e3, 20e3, 'M'], [700e3, 20e3, 'S'], [1000e3, 20e3, 'M'], [1500e3, 20e3, 'L'], [3000e3, 20e3, 'M'], [500e3, 40e3, 'L'], [1000e3, 40e3, 'L']]) ships[`strong ${thrust / 1e3}kN ${fuel / 1e3}t pump ${pump}`] = strong(thrust, fuel, pump);

for (const [name, spec] of Object.entries(ships)) {
  for (const dt of [1 / 60, 0.1]) {
    const r = ascend(spec, dt);
    const lim = `${name} dt ${dt.toFixed(3)}`;
    const good = r.orbit && r.peakQ <= 0.95 && r.peakG < TUNING.gSustainedLimit - 0.5 && r.peakTemp < 0.9;
    check(good, `${lim}: orbit, no failure (${r.cause ?? 'none'}), peak q ${(r.peakQ * 100).toFixed(0)} % of Max-Q, peak ${r.peakG.toFixed(2)} g, engine ${(r.peakTemp * 100).toFixed(0)} %, warp up to ${r.maxWarp.toFixed(1)}x`);
  }
}

// ---- a design that is meant to fail still fails, the Challenger way ----------------------------------------------------
{
  const cold = { mock: MOCK_SHIPS.coldMorning, builder: flownOf(read('src/builder/data/presets/coldMorning.json'), 1) };
  for (const [k, spec] of Object.entries(cold)) for (const dt of [1 / 60, 0.1]) {
    const r = ascend(spec, dt);
    check(!r.orbit && r.cause === 'seal_failure_cold', `Cold Morning (${k}) dt ${dt.toFixed(3)} still fails with cold seals (${r.cause})`);
  }
}

// ---- the pacer does not warp when a limit is close ----------------------------------------------------------------------
{
  const fc = new FlightController({ g0: G0, planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, planetId: 'earth', start: 'pad' });
  fc.holdDown = true; fc.throttle = 1; for (let i = 0; i < 180; i++) fc.update(1 / 60, {}, {}); fc.holdDown = false;
  const ap = createAutopilot();
  while (fc.t < 50) { ascentGuide(fc); fc.update(1 / 60, ap.update(fc, {}), {}); }
  const guide = ascentGuide(fc);
  const base = paceContext(fc, { ascent: guide, aligned: true });
  const pacer = createPacer();
  const w = (patch) => pacer.decide({ ...base, ascentStep: 'turn', sinceLiftoff: 60, qFrac: 0.2, gLoad: 1.5, engineTemp: 0.1, throttle: 1, ...patch }, 1 / 60).warp;
  check(w({}) === 4, 'a quiet gravity turn is warped');
  check(w({ qFrac: 0.7 }) === 1, 'no warp at 70 % of Max-Q');
  check(w({ gLoad: 3.8 }) === 1, 'no warp at 3.8 g');
  check(w({ engineTemp: 0.75 }) === 1, 'no warp with a hot engine');
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
