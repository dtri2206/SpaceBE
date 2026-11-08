// Structure flight traits (wave 5), Node only: node src/builder/tests/traits-structure.test.mjs
// Checks the numbers against their sources (NASA's ballistic-limit equations, crack mechanics, the crewed factor of
// safety, heat-shield limits), the trade-offs between options, the neutral case, determinism and the four presets.
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
const ST = await imp('src/builder/traits/structure.js');
const { flightTraits } = await imp('src/builder/traits/index.js');

const sectionFiles = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), sectionFiles);
const sections = SEC.createSections(sectionFiles);
const catalog = createCatalog(partsJson, internalsJson);
const data = read('src/builder/traits/structure.json');
const hullData = read('src/builder/data/hull.json');
const traitsData = { propulsion: read('src/builder/traits/propulsion.json'), structure: data, life: read('src/builder/traits/life.json'), landing: read('src/builder/traits/landing.json') };
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData };
const presets = Object.fromEntries(['reliable', 'workhorse', 'coldMorning', 'thinSkin'].map((p) => [p, read(`src/builder/data/presets/${p}.json`)]));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const build = (json, edit = null) => { const j = JSON.parse(JSON.stringify(json)); edit?.(j); return computeShipSpec(new Assembly(j, catalog), deps); };
const T = (r) => r.spec.stats.traits.structure;
const D = data.debris;
const mat = (id) => ST.materialProps(data, id);

// ---------- the data ----------
check(Array.isArray(data.sources) && data.sources.length >= 15 && data.sources.every((s) => typeof s === 'string' && s.length > 30), `${data.sources.length} sources, each a real sentence`);
check(['TP-2003-210788', 'NASA-STD-5001', '20090007776', 'LOFTID', 'Stardust', 'SLA-561V'].every((k) => data.sources.join(' ').includes(k)), 'sources name the NASA reports the numbers come from');
check(JSON.stringify(data.neutral) === '{}', 'neutral: no traits (the flight as before)');
const notesOk = Object.entries(data.notes).every(([, n]) => n.en && n.vi && n.en.includes('{') === n.vi.includes('{'));
check(notesOk && ['peakQ', 'skinTemp', 'hit', 'shieldUse', 'impact', 'heatLoad', 'heatPeak', 'cabinLeak'].every((k) => data.notes[k]), 'notes: an English and a Vietnamese template for every note the flight writes');

// ---------- ballistic limits against NASA's worked numbers ----------
{
  const d7 = { ...data, debris: { ...D, speedKmS: 7 } };
  // TP-2003-210788 fig. 4-5: 0.127 cm 6061 bumper, 10.7 cm, 0.32 cm 2219-T87 rear wall, normal impact at 7 km/s: about 0.65 cm
  const e = ST.whippleJ(d7, { m: mat('al2219'), tCm: 0.32 }, { tCm: 0.127, rho: 2.7 }, 10.7);
  const dc = ST.diameterOf(e, 2.8, 7);
  check(near(dc, 0.66, 0.06), `Whipple (TP-2003 example) stops ${dc.toFixed(2)} cm at 7 km/s (about 0.65)`);
  // ISS U.S. Lab stuffed Whipple: 0.48 cm 2219 rear wall, 11.4 cm: about 1.3 cm at 7 km/s
  const s = ST.diameterOf(ST.stuffedJ(d7, { m: mat('al2219'), tCm: 0.48 }, 11.4), 2.8, 7);
  check(near(s, 1.33, 0.12), `stuffed Whipple (ISS Lab) stops ${s.toFixed(2)} cm at 7 km/s (about 1.3)`);
  // a 3 mm aluminium wall is perforated by about a 0.8-1 mm particle at 7 km/s (t ≈ 3-4 d for thin walls)
  const one = ST.diameterOf(ST.singleWallJ(d7, mat('al2219'), 0.3, 1.8), 2.8, 7);
  check(one > 0.07 && one < 0.12, `a 3 mm 2219 wall is holed by a ${(one * 10).toFixed(2)} mm particle at 7 km/s`);
  // the limits are (nearly) energy limits: the critical energy barely changes with speed (TP-2003 sec. 4.2)
  const e9 = ST.whippleJ(data, { m: mat('al2219'), tCm: 0.32 }, { tCm: 0.2, rho: 2.7 }, 10);
  const e12 = ST.whippleJ({ ...data, debris: { ...D, speedKmS: 12 } }, { m: mat('al2219'), tCm: 0.32 }, { tCm: 0.2, rho: 2.7 }, 10);
  check(Math.abs(e12 / e9 - 1) < 0.01, 'Whipple limit as energy: the same at 9 and 12 km/s');
  // titanium: Ratliff et al. 2009 need 2.4/2.2 of the Cour-Palais thickness, so 0.77 of the energy
  const tiPlain = ST.singleWallJ(data, { ...mat('titanium'), tiBle: false }, 0.2, 1.8), ti = ST.singleWallJ(data, mat('titanium'), 0.2, 1.8);
  check(near(ti / tiPlain, (2.2 / 2.4) ** 3, 0.03), `titanium's measured limit is ${(ti / tiPlain).toFixed(2)} of the Cour-Palais prediction`);
  // crack mechanics: twice (K_IC / sigma)^2 / pi at half the yield stress
  const hole = (id) => ST.criticalHoleCm(mat(id), 0.5 * mat(id).yieldMPa);
  check(near(hole('al2219'), 1.8, 0.1) && near(hole('al2195'), 1.0, 0.1) && hole('steel') > 5 && hole('carbon') < 0.5, `critical hole: 2219 ${hole('al2219').toFixed(2)} cm, Al-Li ${hole('al2195').toFixed(2)}, titanium ${hole('titanium').toFixed(2)}, steel ${hole('steel').toFixed(1)}, carbon ${hole('carbon').toFixed(2)}`);
}

// ---------- toughness: a pure material factor, 2219 skin = 1 ----------
{
  const t = Object.fromEntries(['al2219', 'al2195', 'carbon', 'steel', 'honeycomb', 'titanium'].map((m) => [m, ST.materialToughness(data, m)]));
  check(t.al2219 === 1, 'aluminium 2219 skin = 1');
  check(t.steel > 2 && t.titanium > 1.3 && t.honeycomb > 1 && t.carbon < 0.5 && t.al2195 > 1, `steel ${t.steel.toFixed(2)}, titanium ${t.titanium.toFixed(2)}, honeycomb ${t.honeycomb.toFixed(2)}, Al-Li ${t.al2195.toFixed(2)}, carbon ${t.carbon.toFixed(2)}`);
  check(t.steel > t.titanium && t.titanium > t.al2195, 'per square metre of skin: steel > titanium > aluminium-lithium > 2219');
  const off = hullData.materials.filter((m) => !(Math.abs((m.toughness ?? -1) - ST.materialToughness(data, m.id)) < 0.01)).map((m) => m.id);
  check(!off.length, `every hull.json skin carries the toughness these equations give${off.length ? ` (off: ${off})` : ''}`);
}

// ---------- the presets ----------
const R = Object.fromEntries(Object.entries(presets).map(([k, j]) => [k, build(j)]));
for (const [k, r] of Object.entries(R)) {
  const t = T(r);
  const plain = JSON.stringify(t) === JSON.stringify(JSON.parse(JSON.stringify(t))) && !/Infinity|NaN/.test(JSON.stringify(t));
  check(plain && !r.spec.stats.traits.errors, `${k}: plain JSON, no errors`);
  check(t.version === 1 && near(t.maxQ.limitPa, (58 * 1000) / 1.4, 1), `${k}: max-Q ${t.maxQ.limitPa} Pa (2219 58 kPa / 1.4), about the flight model's 40 kPa`);
  check(Object.values(t.skin).every((s) => s.toughness > 0 && s.walls.length && s.walls.every((w) => w.perforateJ > 0 && w.incipientJ < w.perforateJ)), `${k}: every section's walls have limits`);
  check(JSON.stringify(t).length < 12000, `${k}: traits are small (${(JSON.stringify(t).length / 1024).toFixed(1)} KB)`);
}
check(T(R.thinSkin).shield.type === 'tiles' && T(R.thinSkin).shield.fragile && R.thinSkin.spec.stats.heatShieldDamaged === true, 'Thin Skin: fragile tiles, flown damaged (the Columbia ending stays)');
check(T(R.reliable).shield.ablator === 'avcoat' && T(R.reliable).shield.peakWcm2 === 500 && T(R.reliable).shield.loadJcm2 === 5000, 'Reliable: a standard Avcoat shield, 500 W/cm² and 5,000 J/cm²');
check(T(R.reliable).skin.body.walls.some((w) => w.kind === 'tank' && w.material === 'al_li' && w.critHoleCm > 0.9 && w.critHoleCm < 1.1), 'Reliable: Al-Li tank walls burst at a 1 cm hole');
check(T(R.reliable).skin.nose.walls.some((w) => w.kind === 'cabin' && w.perforateJ > 50 * T(R.reliable).refPunctureJ), 'a crew cabin is a double wall: far harder to hole than a bare skin');
check(T(R.workhorse).armor.length === R.workhorse.spec.stats.armorHits, 'armour entries match stats.armorHits');

// ---------- options change the numbers ----------
{
  const skin = (m) => (j) => { j.hull = { nose: m, body: m, tail: m }; };
  const steel = T(build(presets.reliable, skin('steel'))), carbon = T(build(presets.reliable, skin('carbon')));
  check(near(steel.maxQ.limitPa, (51 * 1000) / 1.4, 1) && near(carbon.maxQ.limitPa, (62 * 1000) / 1.4, 1), `skin sets max-Q: steel ${steel.maxQ.limitPa}, carbon ${carbon.maxQ.limitPa} Pa`);
  check(steel.skin.body.toughness > 2 && carbon.skin.body.toughness < 0.5 && steel.skin.body.maxTempC === 650, 'steel skin: tough and heat-proof; carbon: holed easily');
  const tank = (m) => (j) => { for (const p of j.parts) if (/^tank_/.test(p.type)) p.material = m; };
  const crit = (t) => t.skin.body.walls.find((w) => w.kind === 'tank').critHoleCm;
  const ti = T(build(presets.reliable, tank('titanium'))), ss = T(build(presets.reliable, tank('stainless'))), cf = T(build(presets.reliable, tank('carbon')));
  check(crit(ti) > 1.5 * crit(T(R.reliable)) && crit(ss) > crit(ti) && crit(cf) < crit(T(R.reliable)), `tank material: the hole a tank survives: titanium ${crit(ti)} cm, stainless ${crit(ss)}, Al-Li ${crit(T(R.reliable))}, carbon ${crit(cf)}`);
  const tiWall = ti.skin.body.walls.find((w) => w.kind === 'tank');
  check(tiWall.tMm < 2 && tiWall.perforateJ < T(R.reliable).skin.body.walls.find((w) => w.kind === 'tank').perforateJ, 'trade-off: the lighter titanium tank wall is thinner, so it is holed more easily, but it does not burst');
  const armor = (type) => (j) => { const host = j.parts.find((p) => /^tank_/.test(p.type)); j.parts.push({ id: 'px', type, parent: host.id, node: 'radial', angle: 200, yFrac: 0.5 }); };
  const wh = T(build(presets.reliable, armor('whipple_shield'))), pl = T(build(presets.reliable, armor('armor_plate')));
  const tankArmor = (t) => t.skin.body.walls.find((w) => w.kind === 'tank').armorJ[0];
  check(wh.armor[0].kind === 'whipple' && pl.armor[0].kind === 'stuffed' && tankArmor(wh) > 100 * 43 && tankArmor(pl) > 3 * tankArmor(wh), `armour: Whipple ${tankArmor(wh)} J, stuffed plate ${tankArmor(pl)} J in front of a tank (bare 43 J)`);
  const shield = (opts) => (j) => { const p = j.parts.find((q) => q.type === 'heat_shield_m'); p.options = { ...(p.options ?? {}), ...opts }; };
  const pica = T(build(presets.reliable, shield({ ablator: 'pica' }))).shield, thick = T(build(presets.reliable, shield({ thickness: 'thick' }))).shield, mono = T(build(presets.reliable, shield({ gaps: 'monolithic' }))).shield, sla = T(build(presets.reliable, shield({ ablator: 'sla' }))).shield;
  check(pica.peakWcm2 === 1100 && pica.loadJcm2 === 4500 && sla.peakWcm2 === 200 && sla.loadJcm2 === 3000, 'ablator option: PICA 1,100 W/cm² / 4,500 J/cm², SLA-561V 200 / 3,000');
  check(thick.loadJcm2 === 6250 && mono.peakWcm2 === 550, 'thick ablator +25 % heat load, one-piece shield +10 % peak');
  const hiad = T(build(presets.reliable, (j) => { j.parts.find((q) => q.type === 'heat_shield_m').type = 'heat_shield_hiad'; })).shield;
  check(hiad.type === 'inflatable' && hiad.peakWcm2 === 80, 'HIAD: flexible TPS, 80 W/cm² (Gen-2 capability)');
}

// ---------- trade-offs: no option strictly worse than another ----------
{
  const dominated = (rows, dims) => rows.filter((a) => rows.some((b) => b !== a && dims.every(([k, up]) => (up ? b[k] >= a[k] : b[k] <= a[k])) && dims.some(([k, up]) => (up ? b[k] > a[k] : b[k] < a[k])))).map((a) => a.id);
  const skins = hullData.materials.map((m) => ({ id: m.id, q: m.strengthKPa, heat: m.maxTempC, tough: ST.materialToughness(data, m.id), mass: m.massPerM2, cost: m.costPerM2, wear: m.fatiguePerFlight }));
  const ds = dominated(skins, [['q', true], ['heat', true], ['tough', true], ['mass', false], ['cost', false], ['wear', false]]);
  check(!ds.length, `skins: none strictly worse than another${ds.length ? ` (dominated: ${ds})` : ''}`);
  const kit = internalsJson.kits.ablative_shield.slots.find((s) => s.key === 'ablator').options;
  const abl = kit.map((o) => { const a = data.shields.ablators[o.id]; return { id: o.id, peak: a.peakWcm2, load: a.loadJcm2, mass: o.massF ?? 1, cost: o.costF ?? 1, rel: o.rel ?? 0 }; });
  check(kit.every((o) => data.shields.ablators[o.id]), `every ablator option (${kit.length}) has real numbers`);
  const da = dominated(abl, [['peak', true], ['load', true], ['mass', false], ['cost', false], ['rel', true]]);
  check(!da.length, `ablators: none strictly worse than another${da.length ? ` (dominated: ${da})` : ''}`);
}

// ---------- neutral and deterministic ----------
{
  check(JSON.stringify(ST.structureTraits([], {}, { neutral: {} })) === '{}', 'no physics data: the neutral (empty) traits');
  check(JSON.stringify(ST.structureTraits(null, {}, data)) === '{}', 'no layout: the neutral traits');
  const a = JSON.stringify(T(build(presets.workhorse))), b = JSON.stringify(T(build(presets.workhorse)));
  check(a === b, 'the same design gives the same traits');
  const noData = flightTraits(new Assembly(JSON.parse(JSON.stringify(presets.reliable)), catalog).layout(), { traitsData: {} });
  check(JSON.stringify(noData.structure) === '{}', 'flightTraits without structure.json: neutral');
}

console.log(failures ? `\n${failures} failure(s)` : '\nall structure trait checks passed');
process.exit(failures ? 1 : 0);
