// Role 1 logic checks, Node only: node src/builder/tests/builder.test.mjs
// Checks the data files against their schema and the contract, exercises the assembly, and prints each preset's stats.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const contract = await import(pathToFileURL(path.join(ROOT, 'src/core/contract.js')).href);
const { PLANETS, G0 } = await import(pathToFileURL(path.join(ROOT, 'src/core/planets.js')).href);
const { Assembly, createCatalog, SYMMETRIES } = await import(pathToFileURL(path.join(ROOT, 'src/builder/assembly.js')).href);
const { computeShipSpec, engineStats } = await import(pathToFileURL(path.join(ROOT, 'src/builder/stats.js')).href);
const { evaluate } = await import(pathToFileURL(path.join(ROOT, 'src/builder/gonogo.js')).href);

const partsJson = read('src/builder/data/parts.json');
const engines = read('src/builder/data/engines.json');
const launch = read('src/builder/data/launch.json');
const text = read('src/builder/data/text.json');
const balance = read('src/core/balance.json');
const presets = { reliable: read('src/builder/data/presets/reliable.json'), coldMorning: read('src/builder/data/presets/coldMorning.json'), thinSkin: read('src/builder/data/presets/thinSkin.json') };

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

// ---------- parts.json ----------
const catalog = createCatalog(partsJson);
const familyIds = new Set(catalog.families.map((f) => f.id));
const seenIds = new Set();
for (const p of catalog.parts) {
  const where = `parts.json ${p.id}`;
  if (seenIds.has(p.id)) fail(`${where}: duplicate id`);
  seenIds.add(p.id);
  if (!familyIds.has(p.family)) fail(`${where}: unknown family "${p.family}"`);
  if (!['s', 'm', 'l'].includes(p.size)) fail(`${where}: size must be s, m or l`);
  if (!['axial', 'radial'].includes(p.attach)) fail(`${where}: attach must be axial or radial`);
  if (p.attach === 'axial' && !p.nodes.some((n) => n === 'top' || n === 'bottom')) fail(`${where}: axial parts need a top or bottom node`);
  if (p.attach === 'radial' && p.nodes.length) fail(`${where}: radial parts take no children (nodes must be empty)`);
  for (const n of p.nodes) if (!['top', 'bottom', 'radial'].includes(n)) fail(`${where}: bad node "${n}"`);
  if (!(p.height > 0)) fail(`${where}: height must be > 0`);
  if (!(p.reliability > 0 && p.reliability <= 1)) fail(`${where}: reliability must be in (0, 1]`);
  if (p.fuel && !contract.FUELS.includes(p.fuel.type)) fail(`${where}: fuel.type must be one of ${contract.FUELS.join(', ')}`);
  if (p.engine && !/^engine_[sml]$/.test(p.id)) fail(`${where}: engine parts must be named engine_s, engine_m or engine_l`);
  if (p.engine && (p.mass !== 0 || p.cost !== 0)) fail(`${where}: engine parts keep mass and cost at 0 (the workbench adds them)`);
}
check(catalog.parts.some((p) => p.flags.capsule), 'parts.json has a capsule');
check(catalog.parts.some((p) => p.engine), 'parts.json has engines');
check(catalog.parts.some((p) => p.fuel), 'parts.json has tanks');
for (const flag of ['heatShield', 'legs', 'rcs', 'parachute', 'antenna', 'shelter', 'cheapSeals', 'spareO2Tanks']) {
  check(catalog.parts.some((p) => p.flags[flag]), `parts.json has a part with flag ${flag}`);
}

// ---------- engines.json ----------
for (const f of contract.FUELS) check(engines.fuels[f]?.isp?.sl?.length === 2 && engines.fuels[f]?.isp?.vac?.length === 2, `engines.json fuel ${f} has isp.sl and isp.vac pairs`);
for (const n of contract.NOZZLES) check(!!engines.nozzles[n], `engines.json nozzle ${n}`);
for (const p of contract.PUMPS) check(engines.pumps[p]?.thrust > 0, `engines.json pump ${p}`);
check(engines.pumps.S.thrust < engines.pumps.M.thrust && engines.pumps.M.thrust < engines.pumps.L.thrust, 'pump thrust ordering S < M < L');
check(engines.fuels.kerolox.isp.vac[1] < engines.fuels.methalox.isp.vac[1] && engines.fuels.methalox.isp.vac[1] < engines.fuels.hydrolox.isp.vac[1], 'Isp ordering kerolox < methalox < hydrolox');

// ---------- launch.json and text.json ----------
check(launch.slots.some((s) => s.id === 'cold' && s.tempC < 5), 'launch.json has a cold slot below 5 °C');
check(launch.slots.some((s) => s.id === 'mild'), 'launch.json has a mild slot');
const consoleIds = new Set((text.gonogo.consoles ?? []).map((c) => c.id));
for (const id of [...contract.HARD_BLOCKS, ...contract.WARNINGS]) {
  const entry = text.gonogo.problems?.[id];
  if (!entry) fail(`text.json gonogo.problems is missing ${id}`);
  else if (!consoleIds.has(entry.console)) fail(`text.json ${id}: console "${entry.console}" is not in consoles`);
}
for (const c of consoleIds) if (!text.gonogo.go?.[c]) fail(`text.json gonogo.go is missing a GO line for ${c}`);
for (const f of ['weight', 'twr', 'rocketEquation', 'centerOfMass', 'deltaVBudget']) check(!!text.formulas?.[f]?.formula, `text.json formulas.${f}`);
ok(`text.json: ${contract.HARD_BLOCKS.length} blocks and ${contract.WARNINGS.length} warnings covered`);

// ---------- assembly behaviour ----------
{
  const a = new Assembly(null, catalog);
  check(a.attach('capsule_m').length === 1, 'attach a root capsule');
  check(a.attach('fin_m').length === 0, 'a radial part cannot be the root');
  const root = a.root.id;
  check(a.attach('tank_m_methalox', root, 'bottom').length === 1, 'stack a tank below');
  const tank = a.children(root, 'bottom')[0].id;
  check(a.attach('tank_s_kerolox', root, 'bottom').length === 0, 'a used bottom node refuses a second part');
  a.setSymmetry(4);
  check(a.attach('fin_m', tank, 'radial').length === 4, 'symmetry ×4 adds four fins');
  check(a.attach('engine_m', tank, 'bottom').length === 1, 'engine below the tank');
  const engine = a.children(tank, 'bottom')[0];
  check(engine.engine?.pump === 'M', 'engine gets a default definition matching its size');
  check(a.setEngine(engine.id, { fuel: 'kerolox', nozzle: 'sl', pump: 'L' }) && a.part(engine.id).type === 'engine_l', 'setEngine swaps the part to the pump size');
  const fin = a.parts.find((p) => p.type === 'fin_m');
  const before = a.parts.length;
  a.remove(fin.id);
  check(a.parts.length === before - 4, 'removing one fin removes its symmetry group');
  check(a.undo() && a.parts.length === before, 'undo restores the fins');
  check(a.redo() && a.parts.length === before - 4, 'redo removes them again');
  const code = a.toShareCode();
  const b = Assembly.fromShareCode(code, catalog);
  check(b && b.parts.length === a.parts.length && b.validate().length === 0, 'share code round-trips');
  check(Assembly.fromShareCode('garbage', catalog) === null, 'bad share code returns null');
  const lay = a.layout();
  const engineEntry = lay.find((e) => e.id === engine.id);
  check(engineEntry && Math.abs(engineEntry.y) < 1e-9, 'layout puts the lowest axial part at y = 0');
  check(SYMMETRIES.includes(6), 'symmetry options include ×6');
  const es = engineStats({ fuel: 'methalox', nozzle: 'vac', pump: 'M' }, engines, G0);
  check(es.thrust === engines.pumps.M.thrust && es.ispVac === engines.fuels.methalox.isp.vac[1], 'engineStats reads the tables');
}

// ---------- presets ----------
const deps = { catalog, engines, launch, balance, planets: PLANETS, g0: G0 };
const shapeKeys = Object.keys(contract.SHIP_SPEC_SHAPE.stats);
for (const [key, json] of Object.entries(presets)) {
  const a = new Assembly(json, catalog);
  const errors = a.validate();
  if (errors.length) fail(`preset ${key}: ${errors.join('; ')}`);
  const { spec, breakdown, blocks } = computeShipSpec(a, deps);
  for (const k of shapeKeys) if (!(k in spec.stats)) fail(`preset ${key}: spec.stats is missing ${k}`);
  for (const w of spec.warnings) if (!contract.WARNINGS.includes(w)) fail(`preset ${key}: unknown warning ${w}`);
  const slot = launch.slots.find((s) => s.id === a.launch.slot);
  const g = evaluate(spec, { blocks, money: balance.startMoney, fee: slot?.fee ?? 0, text, oneWay: breakdown.oneWay, roundTrip: breakdown.roundTrip });
  const s = spec.stats;
  console.log(`\n${json.name}: cost $${Math.round(s.cost).toLocaleString('en-US')} (+ slot fee $${(slot?.fee ?? 0).toLocaleString('en-US')}), wet ${Math.round(s.wetMass)} kg, dry ${Math.round(s.dryMass)} kg, fuel ${Math.round(s.fuelMass)} kg`);
  console.log(`  thrust ${Math.round(s.thrust / 1000)} kN, Isp ${s.ispSL}/${s.ispVac} s, Δv ${Math.round(s.deltaV)} m/s (one-way ${Math.round(breakdown.oneWay)}, round trip ${Math.round(breakdown.roundTrip)}), TWR Earth ${s.twrEarth.toFixed(2)}, Mars ${s.twrMars.toFixed(2)}`);
  console.log(`  CoM ${breakdown.comY.toFixed(2)} m, CoP ${breakdown.copY.toFixed(2)} m of ${breakdown.stackHeight.toFixed(2)} m, reliability ${(s.reliability * 100).toFixed(0)} %, tempC ${spec.launch.tempC}`);
  console.log(`  blocks: ${g.blocks.join(', ') || 'none'} | warnings: ${g.warnings.join(', ') || 'none'}`);
  if (g.blocks.length) fail(`preset ${key} has hard blocks: ${g.blocks.join(', ')}`);
  if (key === 'reliable') {
    check(g.warnings.length === 0, 'Reliable has no warnings');
    check(s.deltaV >= breakdown.oneWay, 'Reliable reaches Mars one-way');
  }
  if (key === 'coldMorning') {
    check(g.warnings.includes('COLD_SEALS') && g.warnings.includes('NO_SHELTER') && g.warnings.includes('LOW_RELIABILITY'), 'Cold Morning warns COLD_SEALS, NO_SHELTER, LOW_RELIABILITY');
    check(spec.launch.tempC < 5 && !s.coldRatedSeals, 'Cold Morning launches cold with cheap seals');
  }
  if (key === 'thinSkin') check(s.heatShieldDamaged && !s.hasParachute, 'Thin Skin has a fragile shield and no parachute');
  check(g.lines.length >= (text.gonogo.consoles ?? []).length, `${key}: one Go/No-Go line per console at least`);
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll builder checks passed.');
process.exit(failures ? 1 : 0);
