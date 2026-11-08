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
const { computeShipSpec, engineStats, partFigures, optionMods } = await import(pathToFileURL(path.join(ROOT, 'src/builder/stats.js')).href);
const { autoAttach } = await import(pathToFileURL(path.join(ROOT, 'src/builder/autoplace.js')).href);
const SEC = await import(pathToFileURL(path.join(ROOT, 'src/builder/sections.js')).href);
const { evaluate } = await import(pathToFileURL(path.join(ROOT, 'src/builder/gonogo.js')).href);

const sectionFiles = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), sectionFiles);
const sections = SEC.createSections(sectionFiles);
const engines = read('src/builder/data/engines.json');
const internals = internalsJson;
const materials = read('src/builder/data/materials.json');
const launch = read('src/builder/data/launch.json');
const text = read('src/builder/data/text.json');
const balance = read('src/core/balance.json');
const presets = { reliable: read('src/builder/data/presets/reliable.json'), coldMorning: read('src/builder/data/presets/coldMorning.json'), thinSkin: read('src/builder/data/presets/thinSkin.json'), workhorse: read('src/builder/data/presets/workhorse.json') };

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

// ---------- parts.json ----------
const catalog = createCatalog(partsJson, internals);
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
  if (p.engine && !/^engine_[sml]/.test(p.id)) fail(`${where}: engine part ids start with engine_s, engine_m or engine_l (the pump size)`);
  if (!SEC.VEHICLE_SECTIONS.includes(p.section)) fail(`${where}: section must be nose, body or tail`);
  if (p.engine && (p.mass !== 0 || p.cost !== 0)) fail(`${where}: engine parts keep mass and cost at 0 (the workbench adds them)`);
  if (p.internals && !internals.kits[p.internals]) fail(`${where}: unknown internals kit "${p.internals}"`);
  if (p.materialFamily && !materials.families[p.materialFamily]) fail(`${where}: unknown materialFamily "${p.materialFamily}"`);
  if (p.booster && !(p.booster.thrust > 0 && p.booster.ispVac >= p.booster.ispSL && p.booster.propellant > 0)) fail(`${where}: booster needs thrust, ispSL <= ispVac and propellant`);
  if (!p.role || !p.detail || !(p.pros?.length)) fail(`${where}: needs role, detail and pros for the cards`);
}
// ---------- internals.json, materials.json, engine references ----------
for (const [kitId, kit] of Object.entries(internals.kits)) {
  for (const slot of kit.slots ?? []) {
    const ids = new Set();
    if (!slot.options?.length) fail(`internals ${kitId}.${slot.key}: no options`);
    for (const o of slot.options ?? []) {
      if (ids.has(o.id)) fail(`internals ${kitId}.${slot.key}: duplicate option ${o.id}`);
      ids.add(o.id);
      for (const k of ['massF', 'costF', 'thrustF', 'powerF', 'chuteF']) if (o[k] != null && !(o[k] > 0)) fail(`internals ${kitId}.${slot.key}.${o.id}: ${k} must be > 0`);
      if (!o.name || !o.note) fail(`internals ${kitId}.${slot.key}.${o.id}: needs name and note`);
    }
  }
}
ok(`internals.json: ${Object.keys(internals.kits).length} kits`);
for (const [famId, fam] of Object.entries(materials.families)) {
  if (!fam.options?.length) fail(`materials ${famId}: no options`);
  for (const o of fam.options ?? []) if (!(o.mass > 0 && o.cost > 0)) fail(`materials ${famId}.${o.id}: mass and cost factors must be > 0`);
}
ok(`materials.json: ${Object.keys(materials.families).length} families`);
for (const r of engines.references ?? []) {
  if (!contract.FUELS.includes(r.fuel) || !contract.NOZZLES.includes(r.nozzle) || !contract.PUMPS.includes(r.pump)) fail(`engines.json reference ${r.id}: fuel/nozzle/pump must be contract values`);
  for (const [k, v] of Object.entries(r.options ?? {})) if (!internals.kits.engine.slots.find((s) => s.key === k)?.options.some((o) => o.id === v)) fail(`engines.json reference ${r.id}: unknown option ${k}=${v}`);
}
ok(`engines.json: ${engines.references?.length ?? 0} reference engines`);
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
  // internals: options change the numbers, survive share codes and reset on replace
  const eng = a.parts.find((p) => p.type === 'engine_l');
  check(a.setOption(eng.id, 'cycle', 'sc') && a.options(eng.id).cycle.id === 'sc', 'setOption picks a staged-combustion cycle');
  check(!a.setOption(eng.id, 'cycle', 'warp'), 'setOption refuses an unknown option');
  const mods = optionMods(a.options(eng.id));
  check(mods.isp === 12 && mods.costF > 1, 'optionMods sums the deltas and factors');
  const c2 = Assembly.fromShareCode(a.toShareCode(), catalog);
  check(c2.part(eng.id)?.options?.cycle === 'sc', 'options survive the share code');
  a.replace(eng.id, 'engine_m');
  check(!a.part(eng.id).options, 'replace resets options');
  const figBase = partFigures(catalog.get('tank_l_methalox'), { engines, g0: G0, materials, catalog });
  const figCommon = partFigures(catalog.get('tank_l_methalox'), { engines, g0: G0, materials, catalog, options: { bulkhead: 'common' } });
  check(figCommon.mass < figBase.mass && figCommon.cost > figBase.cost, 'a common bulkhead makes the tank lighter and dearer');
  const figSteel = partFigures(catalog.get('tank_l_methalox'), { engines, g0: G0, materials, catalog, materialId: 'stainless' });
  check(figSteel.mass > figBase.mass && figSteel.cost < figBase.cost, 'stainless steel makes the tank heavier and cheaper');
  // boosters add thrust and propellant
  const b2 = new Assembly(presets.reliable, catalog);
  const depsB = { catalog, engines, launch, balance, planets: PLANETS, g0: G0, materials };
  const base0 = computeShipSpec(b2, depsB).spec.stats;
  const placed = autoAttach(b2, 'srb_s');
  check(placed.ids.length === 2, 'autoAttach puts two strap-on solids on the lowest tank');
  const after = computeShipSpec(b2, depsB).spec.stats;
  check(after.thrust > base0.thrust && after.fuelMass > base0.fuelMass && after.twrEarth > base0.twrEarth, 'solids raise thrust, propellant and TWR');
  check(after.ispVac < base0.ispVac, 'solids pull the average Isp down');
  const ring = autoAttach(b2, 'avionics_ring_m');
  check(ring.ids.length === 1 && computeShipSpec(b2, depsB).spec.stats.reliability > after.reliability, 'a guidance ring raises reliability');
  for (const id of ['helium_copv', 'star_tracker', 'wiring_tunnel', 'relay_sat', 'kick_motor_s', 'nose_hammerhead_m', 'paf_m']) {
    const r = autoAttach(b2, id);
    if (!r.ids.length) fail(`autoAttach could not place ${id}: ${r.message}`);
  }
  ok('autoAttach places the new families');
  check(b2.validate().length === 0, 'the stack stays connected after automatic placement');
}

// ---------- sections ----------
{
  const depsS = { catalog, engines, launch, balance, planets: PLANETS, g0: G0, materials, pad: sections.pad };
  for (const id of SEC.VEHICLE_SECTIONS) {
    const sec = sections[id];
    if (!sec.rows.length) fail(`section ${id}: no rows`);
    for (const row of sec.rows) if (!SEC.rowCandidates(catalog, sec, row).length && row.mode !== 'auto') fail(`section ${id} row ${row.id}: no part matches its pick`);
    for (const p of catalog.parts.filter((x) => x.section === id)) if (!SEC.rowOf(sec, p)) fail(`section ${id}: part ${p.id} is in no row, so the player can never pick it`);
    if (!sec.shapes.length) fail(`section ${id}: no shapes`);
    for (const shape of sec.shapes) {
      const where = `section ${id} shape ${shape.id}`;
      for (const t of shape.stack) { const d = catalog.get(t); if (!d) fail(`${where}: unknown part ${t}`); else if (d.section !== id) fail(`${where}: ${t} belongs to the ${d.section} section`); else if (d.attach !== 'axial') fail(`${where}: ${t} is not a stack part`); }
      for (const r of shape.radial ?? []) { const d = catalog.get(r.type); if (!d || d.attach !== 'radial') fail(`${where}: radial ${r.type} is unknown or not side-mounted`); if (!(r.on >= 0 && r.on < shape.stack.length)) fail(`${where}: radial ${r.type} has a bad 'on' index`); }
      // on its own, and on top of the Reliable preset
      const alone = new Assembly(null, catalog);
      SEC.applyShape(alone, sec, shape);
      if (alone.validate().length) fail(`${where}: alone, the stack does not connect: ${alone.validate().join('; ')}`);
      const types = alone.chain().map((p) => p.type);
      if (types.join() !== shape.stack.join()) fail(`${where}: alone, got ${types.join()} instead of ${shape.stack.join()}`);
      const radialWanted = (shape.radial ?? []).reduce((n, r) => n + (r.symmetry ?? 1), 0);
      const radialGot = alone.parts.filter((p) => p.node === 'radial').length;
      if (radialGot !== radialWanted) fail(`${where}: ${radialGot} side parts placed, expected ${radialWanted} (does every host have a radial node?)`);
      const onPreset = new Assembly(presets.reliable, catalog);
      SEC.applyShape(onPreset, sec, shape);
      const r = computeShipSpec(onPreset, depsS);
      if (r.blocks.includes('NOT_CONNECTED')) fail(`${where}: on Reliable, parts end up disconnected`);
      if (!SEC.currentShape(onPreset, sec) || SEC.currentShape(onPreset, sec).id !== shape.id) fail(`${where}: currentShape does not recognise it after applying`);
    }
    ok(`section ${id}: ${sec.shapes.length} shapes, ${sec.rows.length} rows`);
  }
  // build a whole ship from nothing, section by section, in any order
  const a = new Assembly(null, catalog);
  SEC.applyShape(a, sections.tail, sections.tail.shapes[0]);
  SEC.applyShape(a, sections.nose, sections.nose.shapes[0]);
  SEC.applyShape(a, sections.body, sections.body.shapes[0]);
  const order = a.chain().map((p) => catalog.get(p.type).section);
  check(order.join() === [...order].sort((x, y) => SEC.VEHICLE_SECTIONS.indexOf(x) - SEC.VEHICLE_SECTIONS.indexOf(y)).join() && a.validate().length === 0, 'tail, then nose, then body: the stack comes out nose → body → tail');
  check(a.chain().some((p) => catalog.get(p.type).adapter) || a.chain().every((p, i, arr) => i === 0 || catalog.get(p.type).size === catalog.get(arr[i - 1].type).size || catalog.get(p.type).engine || catalog.get(arr[i - 1].type).section === catalog.get(p.type).section), 'an adapter joins sections of different diameter');
  // clusters
  const octa = sections.tail.shapes.find((sh) => sh.stack.some((t) => (catalog.get(t).mounts?.count ?? 1) > 1));
  if (octa) {
    const b = new Assembly(presets.reliable, catalog);
    SEC.applyShape(b, sections.tail, octa);
    const n = catalog.get(octa.stack.find((t) => catalog.get(t).mounts)).mounts.count;
    const r = computeShipSpec(b, depsS);
    check(r.spec.engines.length === n && r.breakdown.engineCount === n, `a ${n}-engine tail lists ${n} engines in the ShipSpec`);
    const single = new Assembly(presets.reliable, catalog);
    SEC.applyShape(single, sections.tail, { ...octa, stack: [octa.stack[0], octa.stack[1]] });
    check(r.spec.stats.thrust === n * engineStats(r.spec.engines[0], engines, G0).thrust, 'cluster thrust is engines × one engine');
    const partsCost = r.breakdown.parts.reduce((t, p) => t + p.cost, 0);
    check(Math.abs(partsCost + (r.breakdown.hull?.cost ?? 0) - r.spec.stats.cost) < 1, 'the cost per part plus the outer skin adds up to the ship cost with a cluster (section cards sum it)');
  }
  // rows: add and clear
  const c = new Assembly(presets.reliable, catalog);
  const sciRow = sections.body.rows.find((r) => r.id === 'science');
  const added = SEC.addThroughRow(c, sections.body, sciRow, 'seismometer');
  check(added.ids.length === 1 && SEC.rowItems(c, sections.body, sciRow).some((it) => it.part.type === 'seismometer'), 'a science instrument added through its row shows in that row');
  SEC.clearSection(c, sections.nose);
  check(!c.chain().some((p) => catalog.get(p.type).section === 'nose') && c.validate().length === 0, 'clearing the nose leaves a connected body and tail');
  // pad
  // the pad: real launch complexes, each with a kit of equipment and a climate (more in tests/pad.test.mjs)
  const pad = sections.pad;
  check(pad.sites.length >= 25 && pad.sites.every((st) => st.kit && st.climate && Number.isFinite(st.climate.meanC)), 'pad: every complex has a kit and a climate');
  for (const st of pad.sites) for (const [k, v] of Object.entries(st.kit)) if (!pad.equipment.find((eq) => eq.key === k)?.options.some((o) => o.id === v)) fail(`pad complex ${st.id}: kit ${k}=${v} is not an option`);
  for (const eq of pad.equipment) if (!eq.options.length || (eq.options[0].fee ?? 0) !== 0 || (eq.options[0].reliability ?? 0) !== 0) fail(`pad equipment ${eq.key}: the first option must be the free, neutral default`);
  const d = new Assembly(presets.reliable, catalog);
  const base = computeShipSpec(d, depsS);
  const eq = pad.equipment[0];
  const cur = base.breakdown.padFx.choices.find((c) => c.eq.key === eq.key).option;
  const top = eq.options[eq.options.length - 1];
  check(top.id !== cur.id, `pad: the preset's ${eq.key} is not already the top option`);
  d.setPadOption(eq.key, top.id);
  const after = computeShipSpec(d, depsS);
  check(after.breakdown.launchFee > base.breakdown.launchFee && after.spec.stats.reliability > base.spec.stats.reliability, 'pad equipment adds a fee and reliability');
  check(after.breakdown.padFx.heatLimitKN > base.breakdown.padFx.heatLimitKN, 'a bigger launch mount takes more thrust');
  check(new Assembly(d.toJSON(), catalog).launch.pad[eq.key] === top.id, 'pad choices survive save and share codes');
  check(base.breakdown.padFx.excess === 0 && base.breakdown.padFx.liftoffLossMps === 0 && base.breakdown.weather.forecastC >= 10, 'Reliable: no excess, no loss, a mild day on its pad');
}

// ---------- presets ----------
const deps = { catalog, engines, launch, balance, planets: PLANETS, g0: G0, materials, pad: sections.pad };
const shapeKeys = Object.keys(contract.SHIP_SPEC_SHAPE.stats);
for (const [key, json] of Object.entries(presets)) {
  const a = new Assembly(json, catalog);
  const errors = a.validate();
  if (errors.length) fail(`preset ${key}: ${errors.join('; ')}`);
  const { spec, breakdown, blocks } = computeShipSpec(a, deps);
  for (const k of shapeKeys) if (!(k in spec.stats)) fail(`preset ${key}: spec.stats is missing ${k}`);
  for (const w of spec.warnings) if (!contract.WARNINGS.includes(w)) fail(`preset ${key}: unknown warning ${w}`);
  const fee = breakdown.launchFee ?? 0; // complex + equipment + days of HOLD (sections/pad/effects.js)
  const g = evaluate(spec, { blocks, money: balance.startMoney, fee, text, oneWay: breakdown.oneWay, roundTrip: breakdown.roundTrip });
  const s = spec.stats;
  console.log(`\n${json.name}: cost $${Math.round(s.cost).toLocaleString('en-US')} (+ launch fees $${fee.toLocaleString('en-US')}), wet ${Math.round(s.wetMass)} kg, dry ${Math.round(s.dryMass)} kg, fuel ${Math.round(s.fuelMass)} kg`);
  console.log(`  thrust ${Math.round(s.thrust / 1000)} kN, Isp ${Math.round(s.ispSL)}/${Math.round(s.ispVac)} s, Δv ${Math.round(s.deltaV)} m/s (one-way ${Math.round(breakdown.oneWay)}, round trip ${Math.round(breakdown.roundTrip)}), TWR Earth ${s.twrEarth.toFixed(2)}, Mars ${s.twrMars.toFixed(2)}`);
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
  if (key === 'workhorse') {
    check(breakdown.boosterSpecs.length === 2 && s.twrEarth >= 1.2, 'Workhorse flies two solids and lifts briskly');
    check(s.deltaV >= breakdown.oneWay, 'Workhorse reaches Mars one-way');
    check(g.warnings.length === 0, 'Workhorse has no warnings');
  }
  check(g.lines.length >= (text.gonogo.consoles ?? []).length, `${key}: one Go/No-Go line per console at least`);
}

// ---------- the Apollo demo preset and ShipSpec.stats.cabin (for Role 3's interior) ----------
{
  const apollo = read('src/builder/data/presets/apollo.json');
  const { spec, breakdown, blocks } = computeShipSpec(new Assembly(apollo, catalog), { catalog, engines, launch, balance, planets: PLANETS, g0: G0, materials, pad: sections.pad });
  const total = spec.stats.cost + breakdown.launchFee;
  check(!blocks.length && spec.warnings.length === 0 && total <= balance.startMoney, `Apollo preset flies with no warning within the starting money ($${Math.round(total).toLocaleString('en-US')}, Δv ${Math.round(spec.stats.deltaV)} m/s)`);
  const c = spec.stats.cabin;
  check(c?.type === 'capsule_apollo' && c.windows === 'small' && c.hatch && c.docking && c.couches, `stats.cabin names the cabin and its fittings (${JSON.stringify(c)})`);
  const rel = computeShipSpec(new Assembly(presets.reliable, catalog), { catalog, engines, launch, balance, planets: PLANETS, g0: G0, materials, pad: sections.pad });
  check(rel.spec.stats.cabin?.type === 'capsule_m', 'the Reliable preset reports its generic Mk2 cabin');
  JSON.parse(JSON.stringify(c));
}

// ---------- no part that can fail reaches 100 % with its best options ----------
{
  const perfect = [];
  for (const def of catalog.parts) {
    if (!((def.reliability ?? 1) < 1) || !catalog.kit(def)) continue;
    const best = Object.fromEntries(catalog.kit(def).slots.map((sl) => [sl.key, [...sl.options].sort((a, b) => (b.rel ?? 0) - (a.rel ?? 0))[0].id]));
    const fam = materials.families?.[def.materialFamily];
    const mat = fam ? [...fam.options].sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0))[0].id : null;
    const f = partFigures(def, { engines, g0: G0, materials, catalog, materialId: mat, options: best, engineDef: def.engine ? { fuel: 'methalox', nozzle: 'sl', pump: String(def.size).toUpperCase() } : null });
    if (!(f.reliability < 1)) perfect.push(def.id);
  }
  check(!perfect.length, `no part that can fail reads 100 % with its best options${perfect.length ? ` (${perfect.slice(0, 8).join(', ')})` : ''}`);
}

// ---------- options bound to a propellant ("fuels"): they fall back on another fuel ----------
{
  const eng = catalog.get('engine_m');
  const cycle = catalog.kit(eng)?.slots.find((sl) => sl.key === 'cycle');
  const bound = cycle?.options.find((o) => o.fuels && !o.fuels.includes('kerolox'));
  check(!!bound, 'the engine kit has a cycle that cannot burn kerosene');
  if (bound) {
    const onKero = catalog.optionsOf(eng, { cycle: bound.id }, 'kerolox').cycle;
    const onOwn = catalog.optionsOf(eng, { cycle: bound.id }, bound.fuels[0]).cycle;
    check(onKero.id !== bound.id && catalog.fitsFuel(onKero, 'kerolox') && onOwn.id === bound.id, `${bound.id} falls back to ${onKero.id} on kerosene and stays on ${bound.fuels[0]}`);
  }
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll builder checks passed.');
process.exit(failures ? 1 : 0);
