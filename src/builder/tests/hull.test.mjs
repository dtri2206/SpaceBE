// Outer skin checks (hull agent), Node only: node src/builder/tests/hull.test.mjs
// Builds every nose × body × tail shape combination on the Reliable preset and checks that the skin makes one
// continuous body (no radius jump without a cone, no gap, no overlapping skins, no double cones on adapters), that it
// clears what it covers, that equipment riding inside sits inside the skin and never in the propellant (what fits
// nowhere goes into one automatic equipment bay, never a pod on the outside), that the
// ShipSpec positions keep Role 2's flight stack right, that masses and costs are real, that the physics behaves
// (heat and cork, buckling, drag), that the presets still reach Mars, and that everything is deterministic.
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
const H = await imp('src/builder/hull.js');

const sectionFiles = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), sectionFiles);
const sections = SEC.createSections(sectionFiles);
const catalog = createCatalog(partsJson, internalsJson);
const hullData = read('src/builder/data/hull.json');
const explainHull = read('src/builder/data/explain-hull.json');
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad };
const presets = Object.fromEntries(['reliable', 'workhorse', 'coldMorning', 'thinSkin'].map((p) => [p, read(`src/builder/data/presets/${p}.json`)]));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const PHYS = hullData.physics;
const TOL = PHYS.lipTolerance + 1e-6;
const EPS = 1e-3;
const widthOf = (def) => Math.min(0.9, Math.max(0.3, (def.height ?? 0.6) * 0.6));
const byId = (id) => H.hullChoices('body').find((m) => m.id === id);

// ---------- materials ----------
const mats = H.hullChoices('body');
check(mats.length >= 4 && mats[0].id === 'al2219', `${mats.length} skin materials, aluminium 2219 first (the default)`);
for (const m of mats) {
  const bad = [];
  if (!m.name || !m.short || !m.note || !m.real || !m.pros?.length || !m.cons?.length) bad.push('text');
  if (!(m.massPerM2 >= 3 && m.massPerM2 <= 30)) bad.push('massPerM2');
  if (!(m.costPerM2 > 0)) bad.push('costPerM2');
  if (!(m.maxTempC >= 100 && m.maxTempC <= 1200)) bad.push('maxTempC');
  if (!(m.strengthKPa > 20 && m.strengthKPa < 100)) bad.push('strengthKPa');
  if (!(m.fatiguePerFlight > 0 && m.fatiguePerFlight < 0.5)) bad.push('fatiguePerFlight');
  if (!(m.cdAFactor > 0.9 && m.cdAFactor <= 1.05)) bad.push('cdAFactor');
  if (!(m.specificHeat > 300 && m.density > 1000)) bad.push('thermal');
  if (!m.sources?.length || !m.sources.some((s) => /strengthKPa .*game rating/.test(s))) bad.push('sources (and the strength marked as a game rating)');
  check(!bad.length, `material ${m.id}: fields sane${bad.length ? ` (bad: ${bad.join(', ')})` : ''}`);
  const ex = explainHull.entries?.[`hull:${m.id}`];
  const full = (o) => !!(o?.what && o?.why && o?.without && o?.analogy);
  check(full(ex?.en) && full(ex?.vi) && ex.vi.name && ex.vi.pros?.length === m.pros.length && ex.vi.cons?.length === m.cons.length && ex.vi.real, `explain-hull.json hull:${m.id}: English and Vietnamese what, why, without, analogy, plus the Vietnamese name, pros, cons and real`);
}
check(H.hullMaterial({ body: 'nope' }, 'body').id === 'al2219' && H.hullMaterial({ body: 'steel' }, 'body').id === 'steel', 'hullMaterial: the chosen id, or the default for an unknown one');
// buckling ratings follow the thin-shell rule: load per m² goes as E (m/ρ)² for solid sheets; sandwiches are stiffer
{
  const E = { al2219: 73.1, al2195: 76, steel: 193 };
  const solid = (id) => E[id] * (byId(id).massPerM2 / byId(id).density) ** 2;
  const ratio = (id) => solid(id) / solid('al2219');
  const s = (id) => byId(id).strengthKPa;
  check(s('al2195') <= s('al2219') && Math.abs(s('al2195') / s('al2219') - ratio('al2195')) < 0.04 && Math.abs(s('steel') / s('al2219') - ratio('steel')) < 0.04, `buckling ratings follow E(m/ρ)²: 2195 ${s('al2195')} ≤ 2219 ${s('al2219')} kPa, steel ${s('steel')} kPa (${(ratio('steel') * 100).toFixed(0)} % of 2219)`);
  check(s('honeycomb') >= s('al2219') && s('carbon') >= s('al2219'), 'sandwich skins (carbon, honeycomb) resist buckling at least as well as 2219');
}
check(PHYS.safeFactor === 1.4 && H.buckleChance(mats[0]) === 0 && H.buckleChance(byId('steel')) > 0 && H.buckleChance(byId('steel')) < 0.06, `Max-Q: crewed factor of safety ${PHYS.safeFactor}; the default skin cannot buckle, thin steel has a small chance (${(H.buckleChance(byId('steel')) * 100).toFixed(1)} %)`);
check(H.peakSkinTempC(mats[0], 0.5) > H.peakSkinTempC(mats[0], 40), 'heat: a skin right behind the nose tip runs hotter than one far behind it (in between, the air turns turbulent and heats again)');
check(H.peakSkinTempC(mats[0], 2, 2) > H.peakSkinTempC(mats[0], 2) + 40, 'heat: a 30° flare runs much hotter than a plain skirt at the same place');
check(H.peakSkinTempC(mats[0], 2, 2, PHYS.cork.resistance) < H.peakSkinTempC(mats[0], 2), 'heat: cork keeps the metal under a flare cooler than a bare plain skirt');
check(H.peakSkinTempC(mats[0], 1.2) < mats[0].maxTempC - PHYS.heatMarginC - 30, `heat: a plain default skin 1.2 m behind the nose tip peaks at ${H.peakSkinTempC(mats[0], 1.2).toFixed(0)} °C, far below its ${mats[0].maxTempC} °C limit`);

// ---------- which side parts ride inside ----------
const g = (id) => catalog.get(id);
const insideList = ['battery', 'o2_bottle', 'spectrometer', 'solar_panel', 'helium_copv', 'radiation_shelter', 'parachute', 'seals_cheap', 'gimbal_ring'];
const outsideList = ['srb_l', 'fin_m', 'fin_grid_m', 'legs_m', 'antenna_low', 'rcs_pack', 'abort_pusher_pod', 'aft_fairing_m', 'verniers', 'jet_vanes'];
check(insideList.every((id) => H.ridesInside(g(id))), `inside the skin: ${insideList.join(', ')}`);
check(outsideList.every((id) => !H.ridesInside(g(id))), `outside the skin: ${outsideList.join(', ')}`);

// ---------- every shape combination ----------
const base = presets.reliable;
// Every pair of shapes meets at least once (nose-body, body-tail, nose-tail): about 2,600 ships instead of every
// triple (25,000+, minutes). HULL_FULL=1 runs every combination.
const combos = [];
{
  const N = sections.nose.shapes, B = sections.body.shapes, T = sections.tail.shapes;
  if (process.env.HULL_FULL) { for (const n of N) for (const b of B) for (const t of T) combos.push([n, b, t]); }
  else {
    const seen = new Set();
    const add = (i, j, k) => { const key = i + ':' + j + ':' + k; if (!seen.has(key)) { seen.add(key); combos.push([N[i], B[j], T[k]]); } };
    N.forEach((_, i) => B.forEach((_, j) => add(i, j, (i + j) % T.length)));
    B.forEach((_, j) => T.forEach((_, k) => add((j + k) % N.length, j, k)));
    N.forEach((_, i) => T.forEach((_, k) => add(i, (i + 2 * k) % B.length, k)));
  }
}
const problems = { overlap: [], jump: [], gap: [], uncovered: [], clearance: [], inside: [], wall: [], propellant: [], axis: [], flight: [], mass: [], adapterCone: [], steep: [], determinism: [], cache: [], bay: [], stage: [] };
let maxMass = 0, maxMassCombo = '', withSkin = 0, bays = 0, maxBay = 0, steepest = 0, steepestTag = '';
for (const [n, b, t] of combos) {
  const tag = `${n.id}+${b.id}+${t.id}`;
  const a = new Assembly(base, catalog);
  SEC.applyShape(a, sections.tail, t); SEC.applyShape(a, sections.body, b); SEC.applyShape(a, sections.nose, n);
  const lay = a.layout();
  const hull = H.computeHull(lay, { catalog, hull: a.hull });
  const skin = H.buildSkin(lay);
  if (skin !== H.buildSkin(lay)) problems.cache.push(tag);
  const ring = hull.segments;
  if (ring.length) withSkin += 1;
  // the automatic equipment bay: only when something fits nowhere else, one at most, items standing round it apart
  const baySegs = ring.filter((s) => s.kind === 'bay');
  const inBay = lay.filter((e) => e.attach === 'radial' && e.bay === 'bay');
  if (ring.some((s) => s.kind === 'pod') || lay.some((e) => e.bay === 'pod' || e.bay === 'orphan')) problems.bay.push(`${tag}: a pod or a homeless item`);
  if (baySegs.length > 1 || (baySegs.length === 1) !== (inBay.length > 0)) problems.bay.push(`${tag}: ${baySegs.length} bays for ${inBay.length} items`);
  if (baySegs.length) {
    bays += 1;
    const b = baySegs[0], H = b.y1 - b.y0;
    maxBay = Math.max(maxBay, H);
    if (H < hullData.inside.bay.minHeight - EPS || H > hullData.inside.bay.maxHeight + EPS || Math.abs(lay.equipmentBay.y0 - b.y0) > EPS) problems.bay.push(`${tag}: bay ${H.toFixed(2)} m`);
    for (const e of inBay) if (e.y < b.y0 - EPS || e.y + e.height > b.y1 + EPS + 0.3) problems.bay.push(`${tag}: ${e.type} outside the bay`);
    for (let i = 0; i < inBay.length; i++) for (let k = i + 1; k < inBay.length; k++) {
      const p = inBay[i], q = inBay[k];
      if (Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y) <= 0) continue; // different rings
      const r = b.r0 - 0.04 - Math.max(widthOf(p.def), widthOf(q.def)) / 2;
      const d = Math.abs(((p.angle - q.angle + 540) % 360) - 180) * (Math.PI / 180) * r;
      if (d < (widthOf(p.def) + widthOf(q.def)) / 2 - EPS) problems.bay.push(`${tag}: ${p.type} and ${q.type} overlap in the bay`);
    }
  }
  // the stack is honest about the bay: everything above it was lifted, so the stack height includes it
  if (baySegs.length && Math.abs(Math.max(...lay.filter((e) => e.attach === 'axial').map((e) => e.y + e.height)) - skin.top) > EPS) problems.bay.push(`${tag}: stack top`);
  // the bay never splits a stage: no tank (or a part hanging from it) right above it with its own aft skirt, hung tank
  // or lattice right under it
  if (baySegs.length) {
    const joined = skin.elements.filter((el) => el.kind !== 'engine' && el.kind !== 'tower');
    const i = joined.findIndex((el) => el.kind === 'bay');
    const up = joined[i - 1], down = joined[i + 1];
    if (up && down && H.isStagePart(down) && (up.def.fuel || H.isStagePart(up))) problems.stage.push(`${tag}: ${up.def.id} | bay | ${down.def.id}`);
  }
  if (hull.mass > maxMass) { maxMass = hull.mass; maxMassCombo = tag; }
  // no two skins at the same height
  const segs = [...ring].sort((x, y) => x.y0 - y.y0);
  for (let i = 0; i < segs.length - 1; i++) if (segs[i].y1 > segs[i + 1].y0 + EPS) problems.overlap.push(tag);
  // cones no steeper than they must be: a 60° shoulder only where nothing narrower is there to climb onto
  for (const s of ring) {
    const deg = (Math.atan2(Math.abs(s.r1 - s.r0), s.y1 - s.y0) * 180) / Math.PI;
    if (deg > steepest) { steepest = deg; steepestTag = `${tag} ${s.section} ${s.kind}`; }
    if (deg > 60) problems.steep.push(`${tag}: ${s.section} ${s.kind} ${deg.toFixed(0)}°`);
  }
  // the outer line: touching bands meet at the same radius (capsules, caps and covers are made to mate)
  const bands = skin.bands;
  const nose = (bd) => bd.skin < 0 && (bd.kind === 'own' || bd.kind === 'cover');
  const solid = [...bands.map((bd) => [bd.y0, bd.y1])];
  for (const el of skin.elements) if (el.kind === 'engine' || el.kind === 'tower') solid.push([el.y0, el.y1]);
  for (let i = 0; i < bands.length - 1; i++) {
    const up = bands[i], dn = bands[i + 1];
    if (Math.abs(up.y0 - dn.y1) > EPS) continue;
    if (nose(up) && nose(dn)) continue;
    if (Math.abs(up.rB - dn.rT) > TOL) problems.jump.push(`${tag} at ${up.y0.toFixed(2)} m: ${up.rB.toFixed(2)} → ${dn.rT.toFixed(2)}`);
  }
  // no gap: bands plus engines and towers cover the whole stack
  solid.sort((x, y) => x[0] - y[0]);
  let reach = 0;
  for (const [y0, y1] of solid) { if (y0 > reach + EPS) problems.gap.push(`${tag} ${reach.toFixed(2)}-${y0.toFixed(2)}`); reach = Math.max(reach, y1); }
  // inner hardware is always covered, and the skin clears it
  const covered = new Set(hull.coveredIds);
  for (const el of skin.elements) {
    if (el.kind === 'inner' && !covered.has(el.id)) problems.uncovered.push(`${tag}: ${el.def.id}`);
    if (!covered.has(el.id)) continue;
    const need = el.kind === 'inner' ? el.need - PHYS.clearance : el.R;
    for (const y of [el.y0 + 0.01, el.y1 - 0.01]) {
      const r = H.radiusAt(skin, y);
      if (r < need - 0.01) problems.clearance.push(`${tag}: ${el.def.id} at ${y.toFixed(2)} m needs ${need.toFixed(2)}, skin ${r.toFixed(2)}`);
    }
  }
  // equipment riding inside: within the skin, never in propellant (helium bottles excepted), ShipSpec x/z the inner face
  const axialById = new Map(skin.elements.map((el) => [el.id, el]));
  for (const e of lay) {
    if (e.attach !== 'radial' || !e.inside) continue;
    const r = Math.hypot(e.x, e.z), w = widthOf(e.def), h = e.height;
    if (e.bay === 'axis') {
      if (Math.abs(r - e.radius) > EPS) problems.axis.push(`${tag}: ${e.type} at r ${r.toFixed(2)}, its host's wall is ${e.radius.toFixed(2)}`);
      continue;
    }
    if (!(r >= 0) || r + w > e.skinR + EPS || Math.abs(r - (e.mountR - w / 2)) > EPS) problems.inside.push(`${tag}: ${e.type} (${e.bay}) inner face ${r.toFixed(2)} + ${w.toFixed(2)} vs skin ${e.skinR.toFixed(2)}`);
    // and within the real outer line all along its height (a shaped tank's wall, the N1's cone, narrows)
    const wallMin = Math.min(...[0, 0.5, 1].map((fr) => H.radiusAt(skin, e.y + e.height * fr)).filter((x) => x > 0));
    if (r + w > wallMin + EPS) problems.wall.push(`${tag}: ${e.type} (${e.bay}) reaches ${(r + w).toFixed(2)} m, the wall is ${wallMin.toFixed(2)} m`);
    const host = axialById.get(e.parentId);
    const safe = (hullData.inside.tankSafeIds ?? []).includes(e.def.id) || (hullData.inside.tankSafeFlags ?? []).some((f) => e.def.flags?.[f]);
    if (host?.def.fuel && !safe) {
      const bay = e.bayPart ? axialById.get(e.bayPart) : null;
      const wet = e.bay === 'part' || (e.bay !== 'skirt' && bay?.def.fuel);
      if (wet) problems.propellant.push(`${tag}: ${e.type} (${e.bay})`);
      if (bay && e.bay !== 'skirt' && (e.y < bay.y0 - EPS || e.y + h > bay.y1 + EPS)) problems.propellant.push(`${tag}: ${e.type} sticks out of its ${e.bay} bay`);
    }
  }
  if (!lay.filter((e) => e.attach === 'radial' && e.inside).every((e) => hull.insideIds.includes(e.id))) problems.inside.push(`${tag}: insideIds misses an inside part`);
  // Role 2's flight stacks every ShipSpec part within 0.05 m of the axis: only axial parts may be there
  const spec = computeShipSpec(a, deps).spec;
  const axialIds = new Set(lay.filter((e) => e.attach === 'axial').map((e) => e.id));
  const onAxis = spec.parts.filter((p) => Math.hypot(p.x ?? 0, p.z ?? 0) < 0.05);
  if (onAxis.length !== axialIds.size || onAxis.some((p) => !axialIds.has(p.id))) problems.flight.push(`${tag}: ${onAxis.filter((p) => !axialIds.has(p.id)).map((p) => p.type).join(', ')}`);
  // real masses and costs: each segment has area, its material's mass per m² (plus any cork), and a price
  for (const s of hull.segments) {
    const m = H.hullMaterial(a.hull, s.section);
    const want = s.area * m.massPerM2 + (s.cork ? s.area * PHYS.cork.massPerM2 : 0);
    if (!(s.area > 0 && s.mass > 0 && s.cost > 0) || Math.abs(s.mass - want) > 1e-6 || !(s.y1 > s.y0)) problems.mass.push(`${tag}: ${s.kind} ${s.mass}`);
  }
  if (!(hull.mass >= 0 && hull.mass < 1500)) problems.mass.push(`${tag}: total ${hull.mass.toFixed(0)} kg`);
  // adapters already are cones: no skin over them
  for (const e of lay.filter((x) => x.def.adapter)) for (const s of ring) if (Math.min(s.y1, e.y + e.height) - Math.max(s.y0, e.y) > EPS) problems.adapterCone.push(`${tag}: ${e.type}`);
  // determinism
  const again = H.computeHull(a.layout(), { catalog, hull: a.hull });
  if (JSON.stringify(again) !== JSON.stringify(hull)) problems.determinism.push(tag);
}
const show = (list) => (list.length ? ` (${list.length}: ${[...new Set(list)].slice(0, 4).join('; ')})` : '');
check(!problems.overlap.length, `${combos.length} combinations: no two skins overlap${show(problems.overlap)}`);
check(!problems.jump.length, `${combos.length} combinations: every joint meets at the same radius or a cone${show(problems.jump)}`);
check(!problems.gap.length, `${combos.length} combinations: no gap in the outer line${show(problems.gap)}`);
check(!problems.uncovered.length, `${combos.length} combinations: trusses, payload adapters, kick motors and spin tables are always covered${show(problems.uncovered)}`);
check(!problems.clearance.length, `${combos.length} combinations: the skin clears everything it covers${show(problems.clearance)}`);
check(!problems.steep.length, `${combos.length} combinations: no skin cone steeper than 60° (steepest ${steepest.toFixed(0)}°: ${steepestTag})${show(problems.steep)}`);
check(!problems.inside.length, `${combos.length} combinations: equipment inside the skin sits within it, its ShipSpec x/z the inner face${show(problems.inside)}`);
check(!problems.propellant.length, `${combos.length} combinations: no equipment rides inside propellant (only helium bottles may)${show(problems.propellant)}`);
check(!problems.bay.length, `${combos.length} combinations: no pods; an equipment bay only where something fits nowhere else (${bays} ships, the tallest ${maxBay.toFixed(2)} m), its items standing apart round it, the stack lifted to make room${show(problems.bay)}`);
check(!problems.stage.length, `${combos.length} combinations: the equipment bay never splits a stage (a tank from its aft skirt, hung tank or lattice)${show(problems.stage)}`);
check(!problems.wall.length, `${combos.length} combinations: inside equipment stays within the real wall all along its height (shaped tanks included)${show(problems.wall)}`);
check(!problems.axis.length, `${combos.length} combinations: seals and gimbal actuators keep their ShipSpec position on the host's wall${show(problems.axis)}`);
check(!problems.flight.length, `${combos.length} combinations: only axial parts sit on the axis in the ShipSpec (Role 2's flight stack)${show(problems.flight)}`);
check(!problems.mass.length, `${combos.length} combinations: skin masses and costs are positive and match their material and cork${show(problems.mass)}`);
check(!problems.adapterCone.length, `${combos.length} combinations: no extra cone over an adapter${show(problems.adapterCone)}`);
check(!problems.determinism.length && !problems.cache.length, `${combos.length} combinations: the same ship gives the same skin, built once per layout${show([...problems.determinism, ...problems.cache])}`);
check(maxMass < 1000, `heaviest default skin ${maxMass.toFixed(0)} kg (${maxMassCombo}): a few hundred kg, not tonnes; ${withSkin} of ${combos.length} combinations need some skin`);

// ---------- the user's bad combination becomes one body ----------
{
  const a = new Assembly(base, catalog);
  for (const [sec, id] of [['tail', 'space_shuttle'], ['body', 'centaur_balloon'], ['nose', 'dawn_stack']]) SEC.applyShape(a, sections[sec], sections[sec].shapes.find((s) => s.id === id));
  const lay = a.layout();
  const hull = H.computeHull(lay, { catalog, hull: a.hull });
  const fairing = hull.segments.find((s) => s.kind === 'fairing');
  const byType = (t) => lay.find((e) => e.type === t);
  const covered = new Set(hull.coveredIds);
  check(!!fairing && fairing.section === 'nose' && Math.abs(fairing.y1 - byType('nose_biconic_m').y) < EPS && Math.abs(fairing.y0 - byType('spin_table_clamp').y) < EPS, 'Dawn nose: one payload fairing from the nose cone down past the spin table');
  check(['capsule_m', 'heat_shield_m', 'paf_m', 'kick_motor_s', 'spin_table_clamp'].every((t) => covered.has(byType(t).id)), 'Dawn nose: capsule, heat shield, payload adapter, kick motor and spin table ride inside it');
  check(lay.filter((e) => e.def.section === 'nose' && e.attach === 'radial').every((e) => e.inside), 'Dawn nose: everything clamped to the capsule rides inside the fairing, antennas included');
  check(H.hullHasSkin(lay, 'nose') && !H.hullHasSkin([], 'nose'), 'hullHasSkin: the Dawn nose has skin, an empty stand has none');
}
{
  const a = new Assembly(base, catalog);
  for (const [sec, id] of [['tail', 'space_shuttle'], ['body', 'saturn_sivb'], ['nose', 'big_cabin']]) SEC.applyShape(a, sections[sec], sections[sec].shapes.find((s) => s.id === id));
  const hull = H.computeHull(a.layout(), { catalog, hull: a.hull });
  check(!hull.segments.some((s) => s.kind !== 'bay'), 'Orion cabin on an S-IVB: already one diameter, so no skirt, cone or fairing is needed (only the equipment bay)');
}
{
  // a stowed inflatable shield between a capsule and a wider tank: packed, and a cone that climbs the capsule's base
  const a = new Assembly({ name: 'hiad', parts: [{ id: 'p1', type: 'capsule_m', parent: null }, { id: 'p2', type: 'heat_shield_hiad', parent: 'p1', node: 'bottom' }, { id: 'p3', type: 'tank_l_methalox', parent: 'p2', node: 'bottom' }, { id: 'p4', type: 'engine_l', parent: 'p3', node: 'bottom', engine: { fuel: 'methalox', nozzle: 'sl', pump: 'L' } }] }, catalog);
  const lay = a.layout();
  const hull = H.computeHull(lay, { hull: {} });
  const cone = hull.segments.find((s) => s.covers.includes('p2'));
  const deg = cone ? (Math.atan2(Math.abs(cone.r1 - cone.r0), cone.y1 - cone.y0) * 180) / Math.PI : 99;
  check(!!cone && cone.y1 > lay.find((e) => e.id === 'p1').y + 0.05 && deg < 45 && lay.find((e) => e.id === 'p2').covered, `inflatable shield: covered and packed, its cone climbs the capsule's base (${deg.toFixed(0)}°)`);
}
{
  const empty = H.computeHull([], {});
  check(empty.limits.maxQKPa === null && empty.limits.maxTempC === null && empty.mass === 0 && empty.cdAFactor === 1, 'no ship: no skin, limits null (not Infinity)');
}

// ---------- presets ----------
for (const [key, json] of Object.entries(presets)) {
  const a = new Assembly(json, catalog);
  const r = computeShipSpec(a, deps);
  const hull = r.breakdown.hull;
  const hottest = Math.max(...hull.segments.map((s) => s.peakTempC - H.hullMaterial(a.hull, s.section).maxTempC));
  const bay = hull.segments.find((s) => s.kind === 'bay');
  check(hull && hull.mass > 0 && hull.mass < 500 && hull.risk.maxQ === 0 && hull.risk.heat === 0 && Number.isFinite(hull.limits.maxQKPa) && hottest < -30, `${key}: ${hull.mass.toFixed(0)} kg of default skin (cork ${Math.round(hull.segments.reduce((t, s) => t + (s.corkMass ?? 0), 0))} kg${bay ? `, a ${(bay.y1 - bay.y0).toFixed(2)} m equipment bay of ${bay.mass.toFixed(0)} kg at ${bay.y0.toFixed(2)} m` : ''}), $${Math.round(hull.cost).toLocaleString('en-US')}, no buckling or heat risk, ${Math.round(-hottest)} °C under its limit at the hottest spot`);
  check(hull.cdAFactor >= 0.9 && hull.cdAFactor <= 1.05, `${key}: cdAFactor ${hull.cdAFactor.toFixed(3)} (steps smoothed; equipment boxes were never charged)`);
  if (key === 'reliable' || key === 'workhorse') check(!r.spec.warnings.length && r.spec.stats.deltaV >= r.breakdown.oneWay && r.spec.stats.twrEarth >= 1.2, `${key}: still reaches Mars without warnings (Δv ${Math.round(r.spec.stats.deltaV)} m/s)`);
  const inside = new Set(hull.insideIds);
  const lay = a.layout();
  check(r.spec.parts.filter((p) => inside.has(p.id)).every((p) => { const e = lay.find((x) => x.id === p.id); return e.bay === 'axis' || Math.hypot(p.x, p.z) + widthOf(e.def) <= e.skinR + EPS; }), `${key}: ShipSpec puts the ${inside.size} inside parts inside the skin`);
  check(Math.abs(r.breakdown.stackHeight - Math.max(...lay.filter((e) => e.attach === 'axial').map((e) => e.y + e.height))) < EPS && r.breakdown.stabilityMargin > 0, `${key}: stack height ${r.breakdown.stackHeight.toFixed(2)} m includes any bay; stable (margin ${(r.breakdown.stabilityMargin * 100).toFixed(1)} %)`);
}
{
  const a = new Assembly(presets.coldMorning, catalog);
  const spec = computeShipSpec(a, deps).spec;
  check(spec.warnings.includes('COLD_SEALS'), 'Cold Morning still warns COLD_SEALS');
  const seals = spec.parts.find((p) => p.type === 'seals_cheap');
  check(seals && Math.hypot(seals.x, seals.z) > 0.5, 'Cold Morning: the cheap seals stay off the axis in the ShipSpec, so the flight stack keeps 4 parts');
}
// materials change the numbers the way the physics says
{
  const a = new Assembly(presets.reliable, catalog);
  const al = H.computeHull(a.layout(), { hull: {} });
  const carbon = H.computeHull(a.layout(), { hull: { nose: 'carbon', body: 'carbon' } });
  const steel = H.computeHull(a.layout(), { hull: { nose: 'steel', body: 'steel' } });
  check(carbon.mass < al.mass && al.mass < steel.mass && carbon.cost > al.cost && steel.cost < al.cost, `Reliable skin: carbon ${carbon.mass.toFixed(0)} kg < aluminium ${al.mass.toFixed(0)} kg < steel ${steel.mass.toFixed(0)} kg; carbon dearest, steel cheapest`);
  check(steel.risk.maxQ > 0 && steel.risk.maxQ < 0.1 && steel.limits.maxQKPa < al.limits.maxQKPa && steel.risk.detail.some((d) => d.kind === 'maxQ' && /times/.test(d.en) && /áp lực gió/.test(d.vi)), `thin steel skin: a small buckling chance (${(steel.risk.maxQ * 100).toFixed(1)} %), explained as a safety margin in both languages`);
  const flare = al.segments.find((s) => s.kind === 'cone' && s.r0 > s.r1);
  check(!!flare && flare.cork && flare.heatFactor > 1.5 && flare.peakTempC < 120, `Reliable: the flare under the capsule heats ${flare?.heatFactor.toFixed(2)}× faster, so it gets cork (${flare?.corkMass.toFixed(0)} kg) and the metal under it stays at ${flare?.peakTempC.toFixed(0)} °C`);
  const honey = H.computeHull(a.layout(), { hull: { nose: 'honeycomb', body: 'honeycomb' } });
  check(honey.fatiguePerFlight > al.fatiguePerFlight && steel.fatiguePerFlight < al.fatiguePerFlight, 'reuse: each skin wears per flight; honeycomb bonds the fastest, steel the slowest');
  check(carbon.cdAFactor <= al.cdAFactor, 'smooth moulded carbon has a little less drag than riveted aluminium');
}
{
  // a light skin far forward can run hot: honeycomb on a payload fairing right behind its nose cover
  const a = new Assembly(base, catalog);
  for (const [sec, id] of [['tail', 'single_engine'], ['body', 'methalox_core'], ['nose', 'dawn_stack']]) SEC.applyShape(a, sections[sec], sections[sec].shapes.find((s) => s.id === id));
  const honey = H.computeHull(a.layout(), { hull: { nose: 'honeycomb' } });
  const fairing = honey.segments.find((s) => s.kind === 'fairing');
  check(!!fairing && (fairing.cork || honey.risk.heat > 0), `honeycomb fairing behind the nose cover: ${fairing?.cork ? `needs cork (${fairing.corkMass.toFixed(0)} kg)` : `a heat chance of ${(honey.risk.heat * 100).toFixed(1)} %`}`);
  check(honey.risk.detail.every((d) => d.en && d.vi), 'every risk has a reason in English and Vietnamese');
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll hull checks passed.');
process.exit(failures ? 1 : 0);
