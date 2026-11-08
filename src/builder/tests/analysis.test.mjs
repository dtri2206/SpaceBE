// Flight analysis checks (wave 5: what each part did, its wear, the choices not made), Node only:
//   node src/builder/tests/analysis.test.mjs
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
const H = await imp('src/builder/hull.js');
const FA = await imp('src/builder/flightAnalysis.js');
const { TRAIT_GROUPS } = await imp('src/builder/traits/index.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const materials = read('src/builder/data/materials.json');
const text = read('src/builder/data/text.json');
const traitsData = Object.fromEntries(TRAIT_GROUPS.map((g) => [g, read(`src/builder/traits/${g}.json`)]));
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: read('src/builder/data/launch.json'), balance: read('src/core/balance.json'), planets: PLANETS, g0: G0, materials, pad: sections.pad, traitsData };
const preset = (key) => read(`src/builder/data/presets/${key}.json`);

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const pc = (x) => `${(x * 100).toFixed(1)} %`;

/** A builder flight record as index.js recordFlight writes it, for this design, then closed as noteEnding does. */
function flight(json, { n = 1, serial = 3, endingId = 'homecoming', telemetry = null, effects = null, before = null, at = Date.now() - 60000 } = {}) {
  const a = new Assembly(json, catalog);
  const r = computeShipSpec(a, deps);
  const layout = a.layout();
  const flown = L.buildAsFlown(r, { g0: G0, planets: PLANETS, layout, catalog, engines: deps.engines, materials, hull: a.hull, serial, wear: before });
  const sig = L.designSignature(a.toJSON());
  const rec = {
    n, at, name: a.name, sig, serial, design: a.toJSON(), designed: flown.designed, asBuilt: flown.asBuilt, need: flown.need, defects: flown.defects,
    notes: flown.notes, units: flown.units, weather: flown.weather, pad: flown.pad, scrubs: [], groups: L.partGroups(layout),
    partNames: Object.fromEntries(layout.map((e) => [e.id, e.def.name])),
    home: { sig, serial, flights: n, before, wear: L.wearAfterFlight(before, { layout, hull: a.hull, breakdown: r.breakdown, materials }) },
    outcome: endingId ? { endingId, final: true } : null,
  };
  const log = FA.createFlightLog();
  for (const t of telemetry ?? []) log.telemetry(t);
  if (endingId) Object.assign(rec, FA.closeFlight(rec, { effects, flown: telemetry ? log.summary() : null, catalog, deps }));
  return { rec, a, r, layout };
}
const TEL = [['prelaunch', 5600, 0], ['ascent', 5590, 14000], ['ascent', 3000, 33000], ['ascent', 1500, 9000], ['orbit', 1450, 0], ['orbit', 420, 0], ['entry', 410, 0], ['landing', 380, 0], ['landed', 100, 0]]
  .map(([phase, deltaVLeft, q]) => ({ t: 0, phase, deltaVLeft, q, maxQ: 40000, engineTemp: 0.5, gForce: 3 }));
const analyse = (rec, extra = {}) => FA.analyseFlight({ record: rec, history: [rec], catalog, deps, traitsData, text, lang: 'en', cache: {}, ...extra });
const rowsOf = (m) => m.sections.flatMap((s) => s.rows.map((r) => ({ ...r, section: s.id })));
const allText = (m) => [...m.summary.map((l) => l.text), ...rowsOf(m).flatMap((r) => [...r.did, ...r.whatIf].map((l) => l.text))].join('\n');

// ---------- the flight log ----------
{
  const log = FA.createFlightLog();
  for (const t of TEL) log.telemetry(t);
  log.event({ type: 'debris_hit' }); log.event({ type: 'maxq' });
  log.landed({ touchdownSpeed: 1.6 });
  const s = log.summary();
  // the drop between two legs belongs to the leg that ended (the transfer burn, between ORBIT and ENTRY, is orbit's)
  check(s.dvStart === 5600 && s.dvEnd === 100 && Math.round(s.used.climb) === 4150 && Math.round(s.used.orbit) === 1040 && Math.round(s.used.entry) === 30 && Math.round(s.used.landing) === 280, `Δv by leg: climb ${Math.round(s.used.climb)}, orbit and transfer ${Math.round(s.used.orbit)}, entry ${Math.round(s.used.entry)}, landing ${Math.round(s.used.landing)}`);
  check(s.peakQ === 33000 && s.qLimit === 40000 && s.hits === 1 && s.touchdownSpeed === 1.6 && s.entered && s.landed, 'peak Max-Q, the limit, hits, touchdown, entry');
  check(JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s), 'the summary is plain JSON for the save');
  log.reset();
  check(log.summary().samples === 0 && log.summary().dvStart === null, 'reset starts a new flight');
  log.telemetry({ phase: 'cruise', radiationMsv: 3 });
  check(log.summary().dvStart === null, 'cruise telemetry without Δv changes nothing');
}

// ---------- the part-effects record ----------
{
  const at = Date.UTC(2026, 10, 8, 10);
  const mk = (ms) => ({ id: `f${(at + ms).toString(36)}`, notes: [] });
  const flights = [mk(-50000), mk(30000), mk(90000)];
  check(FA.effectsTime(flights[1].id) === at + 30000, 'a part-effects id carries its start time');
  check(FA.matchEffects({ at }, flights) === flights[1], 'the first part-effects record after the confirm is this flight');
  check(FA.matchEffects({ at, effectsId: flights[2].id }, flights) === flights[2], 'an id stored at the ending wins');
  check(FA.matchEffects({ at }, flights, { at: at + 10000 }) === null, 'none before the next flight: no record (it was dropped from the save)');
  const loads = FA.flightLoads({ notes: [
    { group: 'structure', what: 'peakQ', value: 36000 }, { group: 'structure', what: 'skinTemp', section: 'body', value: 140 }, { group: 'structure', what: 'skinTemp', section: 'body', value: 120 },
    { group: 'structure', what: 'hit', section: 'body', value: 0 }, { group: 'structure', what: 'shieldUse', partId: 'p2', value: 0.4 },
    { group: 'landing', what: 'touchdown', value: 2.1, limit: 3 }, { group: 'propulsion', what: 'ignition' }, { group: 'propulsion', what: 'ignition' },
  ] }, { samples: 3, peakQ: 30000, peakEngineTemp: 0.7, entered: true, hits: 2 });
  check(loads.peakQ === 36000 && loads.skinTempC.body === 140 && loads.hits.length === 1 && loads.hits[0].damage === 0 && loads.shieldUse.p2 === 0.4 && loads.touchdownSpeed === 2.1 && loads.touchdownLimit === 3 && loads.starts === 2 && loads.engineTempPeak === 0.7 && loads.landed && loads.entered, 'flightLoads reads the notes contract (peakQ, skinTemp, hit, shieldUse, touchdown, ignition) and the flight log');
  const bare = FA.flightLoads(null, { samples: 4, hits: 2, landed: false, entered: false });
  check(bare.hits.length === 2 && bare.landed === false && bare.entered === false && !('peakQ' in bare), 'without notes: the telemetry hits dent the skin, no touchdown, no entry');
  check(Object.keys(FA.flightLoads(null, null)).join() === 'measured' && FA.flightLoads(null, null).measured === false, 'with nothing at all: a nominal flight');
}

// ---------- notes through the groups' templates ----------
{
  const templates = { peakQ: { en: 'Max-Q {value} kPa ({pct} of the limit {limit}).', vi: 'Max-Q {value} kPa.', scale: 0.001, digits: 1 }, ignition: { en: '{part}: lit {count} times.', vi: '{part}: khởi động {count} lần.' } };
  const a = FA.renderNote({ group: 'structure', what: 'peakQ', value: 31234, limit: 40000 }, templates, { lang: 'en' });
  check(a?.text === 'Max-Q 31.2 kPa (3,123,400 of the limit 40.0).', `placeholders filled, the limit in the value's own scale and digits: "${a?.text}"`);
  check(FA.renderNote({ what: 'peakQ', value: 31234 }, templates, { lang: 'vi' }).text === 'Max-Q 31,2 kPa.', 'numbers in the reader\'s style (31,2 in Vietnamese)');
  check(FA.renderNote({ what: 'ignition' }, templates, { partName: 'Merlin', count: 3 }).text === 'Merlin: lit 3 times.', '{part} and {count}');
  check(FA.renderNote({ what: 'unknown', value: 1 }, templates) === null, 'a note without a template is not shown');
  const half = { hit: { en: 'A hit on the {section} ({outcomeText}).', vi: '…' }, dose: { en: 'Dose {value} mSv; the limit is {nasaLimit} mSv.', vi: '…' } };
  check(FA.renderNote({ what: 'hit', value: 1 }, half, { sectionName: 'body' })?.text === 'A hit on the body.' && FA.renderNote({ what: 'dose', value: 5 }, half) === null, 'a missing field drops its bracketed aside; a sentence still missing one is not shown');
  // a new note works without code: a template and a note are enough, in the part's own row
  const { rec } = flight(preset('reliable'), { telemetry: TEL });
  const custom = { ...traitsData, propulsion: { ...traitsData.propulsion, notes: { ...(traitsData.propulsion.notes ?? {}), testLiftoff: { en: 'Left the pad in {value} s.', vi: 'Rời bệ sau {value} giây.', section: 'pad', tone: 'good' }, testEngine: { en: '{part} gimballed {value}°.', vi: '{part} xoay {value}°.' } } } };
  const effects = { id: 'fx1', notes: [{ group: 'propulsion', what: 'testLiftoff', value: 4.2 }, { group: 'propulsion', partId: 'p4', what: 'testEngine', value: 3 }, { group: 'propulsion', partId: 'p4', what: 'testEngine', value: 4 }, { group: 'propulsion', what: 'noTemplate', value: 1 }] };
  const m = FA.analyseFlight({ record: rec, effects, history: [rec], catalog, deps, traitsData: custom, text, lang: 'en', cache: {} });
  const rows = rowsOf(m);
  const padRow = rows.find((r) => r.key === 'pad'), engRow = rows.find((r) => r.partIds?.includes('p4'));
  check(padRow?.did.some((l) => l.text === 'Left the pad in 4.2 s.' && l.tone === 'good'), 'a note with "section": "pad" goes to the launch pad row');
  check(engRow?.did.filter((l) => /gimballed/.test(l.text)).length === 1 && engRow.did.some((l) => l.text === 'Engine, large pump gimballed 4°.'), 'notes on a part land in its row, one line per kind (the last value)');
  check(!/noTemplate/.test(allText(m)), 'an untemplated note stays out');
  // the group's own words win over the analysis' built-in line, and land in the row of the part they are about
  const land = { id: 'fx2', notes: [{ group: 'landing', what: 'touchdown', value: 1.9, limit: 3.2, vVert: 1.8, vHoriz: 0.4, massT: 9.6 }, { group: 'life', what: 'evaMinutes', value: 40, available: 90 }] };
  const withLand = { ...custom, landing: { ...traitsData.landing, notes: { ...(traitsData.landing.notes ?? {}), touchdown: traitsData.landing.notes?.touchdown ?? { en: 'Touched down at {value} m/s ({limit}).', vi: 'Chạm đất {value} m/s.', section: 'tail' } } }, life: { ...traitsData.life, notes: { ...(traitsData.life.notes ?? {}), evaMinutes: traitsData.life.notes?.evaMinutes ?? { en: 'Outside {value} min of {available}.', vi: 'Ngoài trời {value} phút.', section: 'nose' } } } };
  const m2 = FA.analyseFlight({ record: rec, effects: land, history: [rec], catalog, deps, traitsData: withLand, text, lang: 'en', cache: {} });
  const legsRow = rowsOf(m2).find((x) => x.kind === 'legs');
  check(legsRow?.did.length === 1 && /1\.9 m\/s/.test(legsRow.did[0].text) && !/the legs take/.test(legsRow.did[0].text), `the landing group's touchdown line replaces the built-in one, in the legs row: "${legsRow?.did[0]?.text}"`);
  const crew = rowsOf(m2).find((x) => x.key === 'general:nose:life');
  check(crew?.name === 'Crew and life support' && crew.did.length === 1, `a group's notes on no part get a row named after the group ("${crew?.name}")`);
  // two parts that did the same read as one row; "{part}: " is not repeated in the part's own row
  const seep = { id: 'fx3', notes: ['p13', 'p14'].map((partId) => ({ group: 'life', partId, what: 'testSeep', value: 54 })) };
  const withSeep = { ...custom, life: { ...traitsData.life, notes: { ...(traitsData.life.notes ?? {}), testSeep: { en: '{part}: only {value} g seeped out.', vi: '{part}: chỉ {value} g rò ra.', section: 'nose' } } } };
  const m3 = FA.analyseFlight({ record: rec, effects: seep, history: [rec], catalog, deps, traitsData: withSeep, text, lang: 'en', cache: {} });
  const o2 = rowsOf(m3).filter((x) => x.did.some((l) => /seeped/.test(l.text)));
  check(o2.length === 1 && / ×2$/.test(o2[0].name) && o2[0].did[0].text === 'Only 54 g seeped out.' && o2[0].partIds.length === 2, `alike rows merge: "${o2[0]?.name}" · "${o2[0]?.did[0]?.text}"`);
}

// ---------- the analysis of each preset ----------
for (const key of ['reliable', 'workhorse', 'coldMorning', 'thinSkin']) {
  const { rec, r } = flight(preset(key), { telemetry: TEL, endingId: key === 'coldMorning' ? 'coldMorning' : 'homecoming' });
  const m = analyse(rec);
  const ids = m.sections.map((s) => s.id);
  const rows = rowsOf(m);
  const home = key !== 'coldMorning';
  check(ids.join() === ['nose', 'body', 'tail', 'pad'].filter((s) => ids.includes(s)).join() && ids.includes('body') && ids.includes('tail') && ids.includes('pad'), `${key}: sections in order (${ids.join(', ')})`);
  check(rows.some((x) => x.kind === 'skin' && x.wear?.delta > 0) && rows.some((x) => x.kind === 'engine' && x.wear?.delta > 0) && rows.some((x) => x.kind === 'pad' && x.did.length), `${key}: rows for the skin, the engine and the pad`);
  check(/used .* of the .* m\/s/.test(m.summary[0]?.text ?? ''), `${key}: "${m.summary[0]?.text}"`);
  check(home ? m.showWear && m.summary.some((l) => /refurbishment .*; reliability [\d.]+ % \(new: [\d.]+ %\)/.test(l.text)) : !m.showWear && !m.summary.some((l) => /refurbishment/.test(l.text)), `${key}: ${home ? `the price and reliability of a reflight on one line: "${m.summary.at(-1)?.text}"` : 'a lost ship shows no wear and no reflight'}`);
  check(m.summary.length <= 2, `${key}: a short summary (${m.summary.length} line(s))`);
  check(m.outcome === (home ? 'home' : 'lost'), `${key}: outcome ${m.outcome} ("${m.outcomeText}")`);
  check(rows.every((x) => x.did.length + x.whatIf.length > 0 || x.wear), `${key}: no empty row`);
  void r;
}

// ---------- plain words, real comparisons ----------
{
  const { rec } = flight(preset('reliable'), { telemetry: TEL });
  const cache = {};
  const m = analyse(rec, { cache });
  const rows = rowsOf(m);
  const skin = rows.find((x) => x.key === 'skin:body'), tank = rows.find((x) => x.partIds?.includes('p3')), eng = rows.find((x) => x.partIds?.includes('p4')), shield = rows.find((x) => x.kind === 'shield'), pad = rows.find((x) => x.key === 'pad');
  check(skin?.whatIf.length === 1 && /^.+ instead: wear \+[\d.]+ % instead of \+[\d.]+ %, \d+ kg (heavier|lighter)|is good to \d+ °C only|takes only about \d+ kPa/.test(skin.whatIf[0].text), `the skin: "${skin?.whatIf[0]?.text}"`); // the most telling alternative skin
  // a heat verdict comes from the alternative's own predicted peak, never from this flight's temperature scaled
  {
    const mild = flight(preset('reliable'), { telemetry: TEL, effects: { id: 'fx9', notes: [{ group: 'structure', what: 'skinTemp', section: 'body', value: 109 }] } }).rec;
    const mm = analyse(mild);
    const line = rowsOf(mm).find((x) => x.key === 'skin:body')?.whatIf[0]?.text ?? '';
    const named = H.hullChoices('body').find((x) => line.startsWith(x.name));
    const own = named ? (() => { const a = new Assembly(preset('reliable'), catalog); a.setHull('body', named.id); return computeShipSpec(a, deps).breakdown.hull.bySection.body.peakTempC; })() : null;
    check(!/°C only/.test(line) || (own > named.maxTempC), `after a mild 109 °C climb, no false heat verdict: "${line}"`);
  }
  check(tank?.whatIf.some((l) => /^Titanium Ti-6Al-4V instead: wear .* lighter, \$\d+k dearer, Δv \+\d+ m\/s/.test(l.text)), `a tank: "${tank?.whatIf[0]?.text}"`);
  check(eng?.whatIf.length === 1 && /^Inconel 718 chamber instead: wear \+[\d.]+ % instead of \+[\d.]+ %, \d+ kg heavier/.test(eng.whatIf[0].text), `the engine: "${eng?.whatIf.map((l) => l.text).join(' | ')}"`);
  check(shield?.wear?.consumed > 0 && shield.whatIf.some((l) => /^PICA .* instead: about 30 % burned away instead of 50 %/.test(l.text)), `the heat shield: "${shield?.whatIf[0]?.text}"`);
  check(pad?.did[0]?.tone === 'good' && /left the pad at full thrust/.test(pad.did[0].text) && pad.whatIf.some((l) => /would have been held back/.test(l.text)), `the pad, a strong one: "${pad?.did[0]?.text}" / "${pad?.whatIf[0]?.text}"`);
  check(rows.every((x) => x.whatIf.length <= 1), 'one comparison per part (two only with a group\'s own verdict)');
  const t0 = performance.now();
  const vi = analyse(rec, { cache, lang: 'vi' });
  const fast = performance.now() - t0;
  check(fast < 60 && /Nếu dùng/.test(allText(vi)) && /\d+,\d %/.test(allText(vi)), `the same analysis in Vietnamese from the cache (${fast.toFixed(0)} ms), numbers like 4,4 %`);
  check(JSON.stringify(analyse(rec)) === JSON.stringify(m), 'the same record gives the same analysis');
  // a cheap pad holds a strong ship back; the analysis names a pad that would not have
  const weakPad = sections.pad.sites.map((s) => s).sort((x, y) => (x.fee ?? 0) - (y.fee ?? 0)).find((s) => {
    const a = new Assembly(preset('workhorse'), catalog); a.setLaunch({ site: s.id, pad: {} });
    return (computeShipSpec(a, deps).breakdown.padFx.liftoffLossMps ?? 0) > 1;
  });
  if (weakPad) {
    const json = { ...preset('workhorse'), launch: { ...preset('workhorse').launch, site: weakPad.id, pad: {} } };
    const held = flight(json, { telemetry: TEL }).rec;
    const p = rowsOf(analyse(held)).find((x) => x.key === 'pad');
    check(p?.did[0]?.tone === 'bad' && /held at \d+ % for the first 7 s/.test(p.did[0].text) && p.whatIf.some((l) => /would have left at full thrust and kept/.test(l.text)), `a cheap pad (${weakPad.name}): "${p?.did[0]?.text}" / "${p?.whatIf[0]?.text}"`);
  } else ok('no pad holds Workhorse back: cheap-pad check skipped');
}

// ---------- wear: closeFlight uses what the flight did ----------
{
  const calm = flight(preset('reliable'), { telemetry: TEL.map((t) => ({ ...t, q: Math.min(t.q, 20000) })) }).rec;
  const rough = flight(preset('reliable'), { telemetry: TEL.map((t) => ({ ...t, q: t.q ? 39000 : 0 })), effects: { id: 'fx', notes: [{ group: 'structure', what: 'hit', section: 'body', value: 1 }, { group: 'structure', what: 'skinTemp', section: 'body', value: 185 }] } }).rec;
  check(rough.wear.after.hull.body > 2 * calm.wear.after.hull.body && rough.wear.after.parts.p3 > calm.wear.after.parts.p3, `a rough flight wears more: body skin ${pc(rough.wear.after.hull.body)} against ${pc(calm.wear.after.hull.body)}, tank ${pc(rough.wear.after.parts.p3)} against ${pc(calm.wear.after.parts.p3)}`);
  check(rough.home.wear === rough.wear.after && calm.wear.loads.measured, 'the ship that comes home carries the real wear (the fleet reads home.wear)');
  const short = flight(preset('reliable'), { telemetry: TEL.slice(0, 4), endingId: 'rud' }).rec;
  check(!(short.wear.after.consumed?.p2 > 0) && !(short.wear.after.parts.p2 > 0) && !(short.wear.after.parts.p5 > 0), 'a flight lost on the climb used no ablator and no legs');
  const noLog = flight(preset('reliable')).rec;
  check(noLog.wear.after.consumed.p2 === L.WEAR.shield.ablator.avcoat && noLog.wear.after.parts.p4 === L.WEAR.engine.base, 'with no flight log: the nominal wear');
}

// ---------- the trend over a reflown ship ----------
{
  const json = preset('reliable');
  let before = null;
  const history = [];
  for (let n = 1; n <= 4; n++) {
    const { rec } = flight(json, { n, serial: 3, telemetry: TEL, before });
    history.push(rec);
    before = { parts: rec.wear.after.parts, hull: rec.wear.after.hull };
  }
  const other = flight(preset('workhorse'), { n: 5, serial: 9, telemetry: TEL }).rec;
  history.push(other);
  check(FA.trendOf(history[3], history).length === 4 && FA.trendOf(other, history).length === 1, 'the trend follows one physical ship (design and build serial)');
  const m = FA.analyseFlight({ record: history[3], history, catalog, deps, traitsData, text, lang: 'en', cache: {} });
  const eng = rowsOf(m).find((x) => x.partIds?.includes('p4'));
  const pts = eng?.wear?.trend ?? [];
  check(pts.length === 4 && pts.every((p, i) => i === 0 || p.w > pts[i - 1].w) && Math.abs(eng.wear.total - pts.at(-1).w) < 1e-9, `the engine's wear after each flight: ${pts.map((p) => pc(p.w)).join(' → ')}`);
  const sh = rowsOf(m).find((x) => x.kind === 'shield');
  check(sh?.wear?.consumed > 0 && !sh.wear.trend.length, 'a consumed ablator shows its use, not a trend (it is new every flight)');
  const fees = history.slice(0, 4).map((r) => L.refurbFee(computeShipSpec(new Assembly(json, catalog), deps).spec.stats.cost, r.n, { wear: r.wear.after, breakdown: computeShipSpec(new Assembly(json, catalog), deps).breakdown }));
  check(fees.every((x, i) => i === 0 || x > fees[i - 1]), `the reflight price follows the wear: ${fees.map((x) => `$${(x / 1e6).toFixed(2)}M`).join(', ')}`);
}

// ---------- old records and missing data ----------
{
  const { rec } = flight(preset('reliable'), { telemetry: TEL });
  const old = { ...rec };
  delete old.design; delete old.wear; delete old.flown;
  let m = null, err = null;
  try { m = analyse(old); } catch (e) { err = e; }
  check(!err && m && /As built, the tanks held/.test(m.summary[0]?.text ?? ''), `a record from before wave 5 still shows what is known${err ? `: ${err.message}` : ''}`);
  check(!!FA.analyseFlight({ record: null, text }) && FA.analyseFlight({ record: null, text }).sections.length === 0, 'no record: an empty analysis, no crash');
  const fresh = flight(preset('reliable'), { endingId: null }).rec;
  check(analyse(fresh).outcome === 'flying', 'a flight still in the air says so');
}

// ---------- data-driven what-if (a note with limit and trait) ----------
{
  // works once a group's traits differ by choice: find a numeric structure trait that changes with the body skin
  const base = computeShipSpec(new Assembly(preset('reliable'), catalog), deps).spec.stats.traits?.structure ?? {};
  const flat = (o, at = '') => Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${at}${k}.`) : Number.isFinite(v) ? [[`${at}${k}`, v]] : []));
  const alt = new Assembly(preset('reliable'), catalog); alt.setHull('body', 'steel');
  const altTraits = computeShipSpec(alt, deps).spec.stats.traits?.structure ?? {};
  const varying = flat(base).find(([k, v]) => { const w = flat(altTraits).find(([k2]) => k2 === k)?.[1]; return Number.isFinite(w) && w !== v; });
  if (varying) {
    const [trait, mine] = varying;
    const steelValue = flat(altTraits).find(([k]) => k === trait)[1];
    const value = (mine + steelValue) / 2; // between the two: one holds, the other does not
    const { rec } = flight(preset('reliable'), { telemetry: TEL });
    const note = { group: 'structure', section: 'body', what: 'testLimit', value, limit: mine, trait };
    const custom = { ...traitsData, structure: { ...traitsData.structure, notes: { ...(traitsData.structure.notes ?? {}), testLimit: { en: 'Took {value} of {limit}.', vi: 'Chịu {value} trên {limit}.', section: 'body' } } } };
    const m = FA.analyseFlight({ record: rec, effects: { id: 'fx', notes: [note] }, history: [rec], catalog, deps, traitsData: custom, text, lang: 'en', cache: {} });
    const line = rowsOf(m).flatMap((x) => x.whatIf).find((l) => /instead of .*, (this would have failed|it would have held)/.test(l.text));
    check(!!line, `a trait that differs by skin (${trait}): "${line?.text}"`);
  } else ok('no structure trait varies with the skin yet: the data-driven what-if check waits for the structure group');
}

// ---------- every text in both languages ----------
{
  const missing = [];
  const walk = (o, at) => { if (o && typeof o === 'object') { if ('en' in o && !o.vi) missing.push(at); for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`); } };
  walk(text.analysis, 'analysis');
  check(!missing.length && !!text.board.toAnalysis?.vi, `every analysis text has Vietnamese${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  for (const g of TRAIT_GROUPS) {
    const notes = traitsData[g]?.notes ?? {};
    const bad = Object.entries(notes).filter(([, t]) => !t?.en || !t?.vi).map(([k]) => k);
    check(!bad.length, `${g}: ${Object.keys(notes).length} note template(s), each in English and Vietnamese${bad.length ? `: missing ${bad.join(', ')}` : ''}`);
  }
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll analysis checks passed.');
process.exit(failures ? 1 : 0);
