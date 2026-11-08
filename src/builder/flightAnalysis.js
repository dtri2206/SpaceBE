// The flight analysis (wave 5, src/builder/CLAUDE.md §8). No messages while the ship flies; afterwards, after every
// flight (success or failure), the hangar shows what each part did, section by section (nose, body, tail, launch pad),
// with its wear, and what the choices the player did not make would have done. Pure: no browser or core imports, so
// Node can test it. The view is createFlightAnalysis in investigation.js; index.js wires it.
//
// What it reads:
//  - the builder's flight record (index.js recordFlight): the design flown, as built against on paper, defects, the
//    pad, the weather, the wear before the flight, and (closeFlight, at the ending) the flight log and the wear after;
//  - the flight's part-effects record (save.partEffects.flights, src/flight/effects/index.js recordInSave): the notes
//    each group wrote ({ group, partId?, section?, what, value?, limit?, trait?, t? }), rendered through that group's
//    "notes" templates in src/builder/traits/<group>.json, so a new note needs no code here (the notes contract:
//    "<what>": { en, vi, section?, tone?, digits?, scale?, whatIfFail?, whatIfPass? });
//  - the flight telemetry the builder logged (createFlightLog): Δv left phase by phase, peak Max-Q, engine heat, hits.
// The comparisons rebuild the ship with each alternative (another skin, material, ablator or pad) through the same pure
// computeShipSpec the design page uses, and the same wear model (asBuilt.js), under this flight's loads.
import { Assembly } from './assembly.js';
import { computeShipSpec } from './stats.js';
import { HULL_SECTIONS, hullChoices, hullMaterial } from './hull.js';
import { describeDefect, localNumber, localText, partWear, refurbish, shieldType, skinWear, wearAfterFlight, wearKind, wearOfFlight, wornReliability, WEAR } from './asBuilt.js';
import { fmtMoneyShort } from './format.js';
import { tr } from './i18n.js';

export const SECTIONS = ['ship', 'nose', 'body', 'tail', 'pad'];
/** Where a group's notes go when they name neither a part nor a section. */
const GROUP_SECTION = { propulsion: 'tail', structure: 'body', life: 'nose', landing: 'tail' };
/** Flight phases (FlightController) → the legs the analysis names. */
const LEG_OF = { prelaunch: 'climb', ascent: 'climb', orbit: 'orbit', coast: 'orbit', entry: 'entry', landing: 'landing', landed: 'landing' };
const LEGS = ['climb', 'orbit', 'entry', 'landing'];
/** The touchdown speed the legs take when the landing group gives none (FlightController TUNING.touchdownLimit.legs). */
const LEGS_LIMIT = 3;
const MAX_ALTS = 24; // alternatives tried for one data-driven what-if
/** The notes contract's wear inputs: a group's note without a part goes to the row of this kind. */
const WHAT_ROW = { touchdown: 'legs', shieldUse: 'shield', heatLoad: 'shield', heatPeak: 'shield', burnThrough: 'shield', ignition: 'engine', ignitions: 'engine', ignitionsFree: 'engine', peakQ: 'skin', skinTemp: 'skin', skinShed: 'skin', hit: 'skin', impact: 'skin' };

const fin = Number.isFinite;
const fill = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// ---------- the flight log (index.js feeds it flight:telemetry, flight:event and flight:landed) ----------
/**
 * createFlightLog() → { reset(), telemetry(t), event(e), landed(p), summary() }. summary() is plain JSON for the save:
 * { samples, dvStart, dvEnd, used: { climb, orbit, entry, landing }, peakQ, qLimit, peakG, peakEngineTemp, hits,
 *   touchdownSpeed, entered, landed }.
 */
export function createFlightLog() {
  let s;
  const reset = () => { s = { samples: 0, dvStart: null, dvEnd: null, used: {}, leg: null, legDv: null, peakQ: null, qLimit: null, peakG: null, peakEngineTemp: null, hits: 0, touchdownSpeed: null, entered: false, landed: false }; };
  reset();
  const peak = (k, v) => { if (fin(v)) s[k] = Math.max(s[k] ?? -Infinity, v); };
  return {
    reset,
    telemetry(t) {
      if (!t || typeof t !== 'object') return;
      s.samples += 1;
      if (t.phase === 'entry') s.entered = true;
      peak('peakQ', t.q);
      peak('peakG', t.gForce);
      peak('peakEngineTemp', t.engineTemp);
      if (fin(t.maxQ)) s.qLimit = t.maxQ;
      const dv = t.deltaVLeft;
      if (!fin(dv)) return;
      const leg = LEG_OF[t.phase] ?? null;
      if (s.dvStart == null) s.dvStart = dv;
      // a new leg: the old one gets everything down to this first sample, so the drop between scenes (the transfer burn
      // between ORBIT and ENTRY) counts for the leg that made it, not the next one
      if (leg !== s.leg) { if (s.leg && fin(s.legDv)) s.used[s.leg] = (s.used[s.leg] ?? 0) + Math.max(0, s.legDv - dv); s.leg = leg; s.legDv = dv; }
      s.dvEnd = dv;
    },
    event(e) { if (e?.type === 'debris_hit') s.hits += 1; },
    landed(p) { s.landed = true; if (fin(p?.touchdownSpeed)) s.touchdownSpeed = p.touchdownSpeed; },
    summary() {
      const used = { ...s.used };
      if (s.leg && fin(s.legDv) && fin(s.dvEnd)) used[s.leg] = (used[s.leg] ?? 0) + Math.max(0, s.legDv - s.dvEnd);
      const out = { samples: s.samples, dvStart: s.dvStart, dvEnd: s.dvEnd, used, peakQ: s.peakQ, qLimit: s.qLimit, peakG: s.peakG, peakEngineTemp: s.peakEngineTemp, hits: s.hits, touchdownSpeed: s.touchdownSpeed, entered: s.entered, landed: s.landed };
      for (const [k, v] of Object.entries(out)) if (typeof v === 'number' && !fin(v)) out[k] = null;
      return out;
    },
  };
}

// ---------- the part-effects record of a flight ----------
/** The time a part-effects record was started (its id is `f` + Date.now() in base 36). */
export const effectsTime = (id) => { const n = parseInt(String(id ?? '').slice(1), 36); return fin(n) ? n : null; };
/**
 * The part-effects record of this builder flight record: by the id stored at the ending, else the first one started
 * after this flight was confirmed (and before the next one).
 */
export function matchEffects(record, flights = [], next = null) {
  if (!record || !Array.isArray(flights)) return null;
  if (record.effectsId) return flights.find((f) => f.id === record.effectsId) ?? null;
  const at = Number(record.at) || 0, until = Number(next?.at) || Infinity;
  const mine = flights.filter((f) => { const t = effectsTime(f.id); return t != null && t >= at - 2000 && t < until; });
  return mine.sort((x, y) => effectsTime(x.id) - effectsTime(y.id))[0] ?? null;
}

/**
 * The loads one flight put on the ship, for the wear model (asBuilt.js partWear, skinWear), from the groups' notes
 * (the notes contract: peakQ, skinTemp, hit, shieldUse, touchdown, ignition) and the flight log. Missing = nominal.
 */
export function flightLoads(effects, flown = null) {
  const notes = Array.isArray(effects?.notes) ? effects.notes : [];
  const by = (what) => notes.filter((n) => n?.what === what);
  const vals = (what) => by(what).map((n) => n.value).filter(fin);
  const measured = notes.length > 0 || (flown?.samples ?? 0) > 0;
  const loads = { measured };
  const q = [...vals('peakQ'), flown?.peakQ].filter(fin);
  if (q.length) loads.peakQ = Math.max(...q);
  const temps = {};
  for (const n of by('skinTemp')) if (n.section && fin(n.value)) temps[n.section] = Math.max(temps[n.section] ?? -Infinity, n.value);
  if (Object.keys(temps).length) loads.skinTempC = temps;
  const hits = by('hit').map((n) => ({ section: n.section ?? null, partId: n.partId ?? null, damage: fin(n.value) ? n.value : 1 }));
  // a hit the armour took (telemetry) still dents the skin when the structure group did not say more
  if (!hits.length && (flown?.hits ?? 0) > 0) for (let i = 0; i < flown.hits; i++) hits.push({ section: null, partId: null, damage: 0.5 });
  if (hits.length) loads.hits = hits;
  const shields = by('shieldUse').filter((n) => fin(n.value));
  if (shields.length) {
    const own = shields.filter((n) => n.partId);
    loads.shieldUse = own.length ? Object.fromEntries(own.map((n) => [n.partId, n.value])) : shields.at(-1).value;
  }
  // engine starts: one "ignition" note per start, or a count ("ignitions", "ignitionsFree": value = starts this flight)
  const starts = by('ignition').length || Math.max(0, ...['ignitions', 'ignitionsFree'].flatMap((w) => vals(w)));
  if (starts) loads.starts = starts;
  if (fin(flown?.peakEngineTemp)) loads.engineTempPeak = flown.peakEngineTemp;
  const td = by('touchdown').filter((n) => fin(n.value)).at(-1);
  if (td) { loads.touchdownSpeed = td.value; if (fin(td.limit)) loads.touchdownLimit = td.limit; loads.landed = true; }
  else if (fin(flown?.touchdownSpeed)) { loads.touchdownSpeed = flown.touchdownSpeed; loads.landed = true; }
  else if ((flown?.samples ?? 0) > 0) loads.landed = !!flown.landed;
  if (fin(loads.touchdownSpeed) && !fin(loads.touchdownLimit)) loads.touchdownLimit = LEGS_LIMIT;
  if ((flown?.samples ?? 0) > 0) loads.entered = !!flown.entered || shields.length > 0;
  else if (shields.length) loads.entered = true;
  return loads;
}

// ---------- the ship flown ----------
/** The design of a record rebuilt: { assembly, layout, result (computeShipSpec), hull } or null. */
export function rebuild(design, catalog, deps) {
  if (!design?.parts?.length || !catalog || !deps) return null;
  try {
    const assembly = new Assembly(design, catalog);
    if (!assembly.parts.length) return null;
    const result = computeShipSpec(assembly, deps);
    return { assembly, layout: assembly.layout(), result, hull: assembly.hull };
  } catch { return null; }
}

/**
 * At the end of a flight (index.js noteEnding): the flight log, the part-effects record and the wear the flight really
 * caused, by its loads. → { effectsId, flown, wear: { before, after, loads }, home } (merge it into the record).
 */
export function closeFlight(record, { effects = null, flown = null, catalog = null, deps = null } = {}) {
  const out = { effectsId: effects?.id ?? record?.effectsId ?? null, flown: flown ?? record?.flown ?? null };
  const ship = rebuild(record?.design, catalog, deps);
  if (!ship) return out;
  const loads = flightLoads(effects, out.flown);
  const before = record?.home?.before ?? null;
  const after = wearAfterFlight(before, { layout: ship.layout, hull: ship.hull, flight: loads, breakdown: ship.result.breakdown, materials: deps.materials ?? null, traits: ship.result.spec.stats.traits ?? null });
  out.wear = { before, after, loads };
  if (record?.home) out.home = { ...record.home, wear: after };
  return out;
}

// ---------- words ----------
/**
 * One note in words through its group's template (traits/<group>.json "notes"), or null when it has none.
 * Placeholders: {value} (value × scale), {pct} (value × 100), {part}, {t}, {section}, {count} (notes of this kind on
 * this part), and every other field of the note.
 */
export function renderNote(note, templates, { lang = 'en', partName = '', sectionName = '', count = 1 } = {}) {
  const tmpl = templates?.[note?.what];
  if (!tmpl || typeof tmpl !== 'object' && typeof tmpl !== 'string') return null;
  const vars = noteVars(note, tmpl, lang);
  vars.part = partName || vars.part || '';
  vars.section = sectionName || vars.section || '';
  vars.count = localNumber(count, lang);
  // a field the note did not carry: its bracketed aside goes; a sentence still missing one is not shown half-said
  const text = fill(tr(tmpl, lang), vars).replace(/\s*\([^()]*\{\w+\}[^()]*\)/g, '').trim();
  const past = fin(note.value) && fin(note.limit) && note.value > note.limit; // the notes contract: value > limit = it did not hold
  return text && !/\{\w+\}/.test(text) ? { text, tone: note.tone ?? (past ? 'bad' : null) ?? tmpl.tone ?? 'info' } : null;
}
const digitsFor = (x) => (Math.round(x) === x ? 0 : Math.abs(x) < 1 ? 2 : Math.abs(x) < 10 ? 1 : 0);
/**
 * A note's fields as words: every number in the reader's style; value, limit and altLimit (the same quantity) × the
 * template's scale with its digits; pct = value × 100.
 */
function noteVars(note, tmpl, lang, extra = {}) {
  const vars = {};
  for (const [k, x] of Object.entries(note)) if (x != null && typeof x !== 'object') vars[k] = typeof x === 'number' ? localNumber(x, lang, digitsFor(x)) : String(x);
  const scale = fin(tmpl?.scale) ? tmpl.scale : 1;
  const same = (x) => { const v = x * scale; return localNumber(v, lang, fin(tmpl?.digits) ? tmpl.digits : digitsFor(v)); };
  if (fin(note.value)) { vars.value = same(note.value); vars.pct = localNumber(note.value * 100, lang, Math.abs(note.value) < 0.1 ? 1 : 0); }
  if (fin(note.limit)) vars.limit = same(note.limit);
  for (const [k, x] of Object.entries(extra)) vars[k] = typeof x === 'number' ? same(x) : String(x ?? '');
  if (fin(note.t)) vars.t = localNumber(note.t, lang);
  return vars;
}

const getPath = (obj, path) => String(path ?? '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);

// ---------- the analysis ----------
/**
 * analyseFlight({ record, effects, history, catalog, deps, traitsData, text, lang, cache }) → {
 *   title, sub, outcome ('home' | 'lost' | 'flying'), summary: [line],
 *   sections: [{ id, title, rows: [{ key, partIds, name, did: [line], wear: { delta, total, consumed, trend } | null,
 *     whatIf: [line] }] }] }
 * line = { text, tone: 'good' | 'bad' | 'info' }. cache: an object kept between calls (the rebuilt ship and every
 * alternative), so switching EN | VI is cheap. history: the builder's flight records (for the wear trend).
 */
export function analyseFlight({ record, effects = null, history = [], catalog = null, deps = null, traitsData = {}, text = {}, lang = 'en', cache = {} } = {}) {
  const A = text.analysis ?? {};
  const T = (entry, vars = {}) => fill(tr(entry, lang), vars);
  const n = (v, d = 0) => localNumber(v, lang, d);
  const money = (v) => localText(fmtMoneyShort(v), lang);
  const pct = (x, d = null) => `${n(x * 100, d ?? (Math.abs(x) < 0.1 ? 1 : 0))} %`;
  const plusPct = (x) => T(A.wear?.delta, { pct: n(x * 100, x < 0.1 ? 1 : 0) });

  if (!('ship' in cache)) cache.ship = rebuild(record?.design, catalog, deps);
  const ship = cache.ship;
  const layout = ship?.layout ?? [];
  const bd = ship?.result?.breakdown ?? null;
  const stats = ship?.result?.spec?.stats ?? null;
  const traits = stats?.traits ?? null;
  const materials = deps?.materials ?? null;
  const loads = record?.wear?.loads ?? flightLoads(effects, record?.flown);
  const before = record?.wear?.before ?? record?.home?.before ?? null;
  const after = record?.wear?.after ?? (ship ? wearAfterFlight(before, { layout, hull: ship.hull, flight: loads, breakdown: bd, materials, traits }) : null);
  const why = ship ? wearOfFlight({ layout, hull: ship.hull, flight: loads, breakdown: bd, materials, traits }).why : {};
  const entryOf = new Map(layout.map((e) => [e.id, e]));
  const nameOf = (id) => entryOf.get(id)?.def?.name ?? record?.partNames?.[id] ?? id;
  const sectionOf = (id) => { const e = entryOf.get(id); return e?.def?.section ?? (e?.parentId ? sectionOf(e.parentId) : null); };
  const sectionName = (s) => T(A.sections?.[s]) || s;
  const outcome = !record?.outcome?.final ? 'flying' : record.outcome.endingId === 'homecoming' ? 'home' : 'lost';

  // ---- rows ----
  const sections = new Map(SECTIONS.map((s) => [s, new Map()]));
  const rowOf = (section, key, name, partIds = []) => {
    const rows = sections.get(SECTIONS.includes(section) ? section : 'body');
    if (!rows.has(key)) rows.set(key, { key, partIds, name, did: [], wear: null, whatIf: [], order: rows.size });
    return rows.get(key);
  };
  const keyOf = (e) => (e.group ? `g:${e.group}` : e.id);
  const twinsOf = (e) => (e.group ? layout.filter((x) => x.group === e.group) : [e]);
  const wearDelta = (id) => Math.max(0, (after?.parts?.[id] ?? 0) - (before?.parts?.[id] ?? 0));
  const trend = trendOf(record, history);
  const trendFor = (get) => (trend.length >= 2 ? trend.map((r) => ({ n: r.n, w: get(r.wear?.after ?? r.home?.wear) })).filter((x) => fin(x.w)) : []);

  const units = new Map((record?.units ?? []).map((u) => [u.partId, u]));
  const noteList = Array.isArray(effects?.notes) ? effects.notes : [];
  const groupSays = (what) => noteList.some((x) => x?.what === what && traitsData?.[x.group]?.notes?.[what]);
  const defectsBy = new Map();
  for (const d of record?.defects ?? []) if (d.partId) defectsBy.set(d.partId, [...(defectsBy.get(d.partId) ?? []), d]);

  // the parts that have something to tell: those that wear, those the factory or the flight touched
  const KEY_KINDS = ['engine', 'booster', 'tank', 'shield', 'capsule', 'legs'];
  for (const e of [...layout].sort((x, y) => y.y - x.y)) {
    const kind = wearKind(e);
    if (!KEY_KINDS.includes(kind) && !defectsBy.has(e.id)) continue;
    const twins = twinsOf(e);
    if (rowsHave(sections, keyOf(e))) continue;
    const row = rowOf(sectionOf(e.id), keyOf(e), `${e.def.name}${twins.length > 1 ? ` ×${twins.length}` : e.cluster?.count > 1 ? ` ×${e.cluster.count}` : ''}`, twins.map((x) => x.id));
    row.kind = kind;
    // what it did: as built, defects, heat, starts, the landing, the shield
    const u = units.get(e.id);
    if (u) {
      const w = text.board?.words ?? {};
      const bits = [];
      const add = (x, word) => { if (fin(x) && Math.abs(x) >= 0.001) bits.push(`${tr(word, lang)} ${x >= 0 ? '+' : '−'}${n(Math.abs(x) * 100, 1)} %`); };
      add(u.thrustPct, w.thrust); add(u.ispPct, w.isp); add(u.fuelPct, w.propellant);
      if (bits.length) row.did.push({ text: T(A.asBuilt, { list: bits.join(', ') }), tone: 'info' });
    }
    for (const d of twins.flatMap((x) => defectsBy.get(x.id) ?? [])) row.did.push({ text: describeDefect(d, text.luck?.defects, lang), tone: 'bad' });
    const wy = why[e.id];
    if (kind === 'engine') {
      // only when it ran hot: a cool engine says nothing
      if (fin(loads.engineTempPeak) && loads.engineTempPeak >= 0.8) row.did.push({ text: T(A.engineHot, { pct: n(loads.engineTempPeak * 100) }), tone: 'bad' });
      if (fin(loads.starts) && !['ignition', 'ignitions', 'ignitionsFree'].some(groupSays)) row.did.push({ text: T(loads.starts === 1 ? A.startOne : A.starts, { n: n(loads.starts) }), tone: 'info' });
    }
    if (kind === 'legs') {
      if (groupSays('touchdown')) { /* the landing group says it */ } else if (fin(loads.touchdownSpeed)) row.did.push({ text: T(A.touchdown, { v: n(loads.touchdownSpeed, 1), limit: n(loads.touchdownLimit ?? LEGS_LIMIT, 1) }), tone: loads.touchdownSpeed > 0.8 * (loads.touchdownLimit ?? LEGS_LIMIT) ? 'bad' : 'good' });
      else if (loads.landed === false && outcome !== 'lost') row.did.push({ text: T(A.noTouchdown), tone: 'info' }); // (about wear: a lost ship has none to speak of)
    }
    if (kind === 'shield') {
      const type = shieldType(e);
      const price = bd?.parts?.find((p) => p.id === e.id)?.cost ?? 0;
      const used = after?.consumed?.[e.id] ?? wy?.consumed ?? 0;
      if (type === 'ablator') {
        if (loads.entered === false) { if (outcome !== 'lost') row.did.push({ text: T(A.shieldUnused), tone: 'info' }); }
        else if (!groupSays('shieldUse')) row.did.push({ text: T(loads.shieldUse != null ? A.shieldUsed : A.shieldNominal, { pct: n(used * 100), money: money(price * used) }), tone: used > 0.8 ? 'bad' : 'info' });
      } else if (type === 'inflatable') row.did.push({ text: T(A.inflatable, { money: money(price) }), tone: 'info' });
      else if (type === 'heatSink') row.did.push({ text: T(A.heatSink), tone: 'good' });
      else row.did.push({ text: T(A.tiles), tone: 'info' });
    }
    if (kind === 'capsule') {
      const h = (loads.hits ?? []).filter((x) => x.partId === e.id).length;
      if (h) row.did.push({ text: T(h === 1 ? A.hitOnce : A.hits, { n: n(h) }), tone: 'bad' });
    }
    const consumed = twins.reduce((t, x) => Math.max(t, after?.consumed?.[x.id] ?? 0), 0);
    const delta = Math.max(...twins.map((x) => wearDelta(x.id)), 0);
    const total = Math.max(...twins.map((x) => after?.parts?.[x.id] ?? 0), 0);
    if (consumed > 0 || delta > 0 || total > 0) row.wear = { delta, total, consumed, trend: consumed > 0 ? [] : trendFor((w) => w?.parts?.[e.id]) };
  }

  // the skin, one row per section that has one
  const bySection = bd?.hull?.bySection ?? {};
  for (const s of HULL_SECTIONS) {
    const info = bySection[s];
    if (!ship || !((info?.area ?? 0) > 0)) continue;
    const mat = hullMaterial(ship.hull, s);
    const row = rowOf(s, `skin:${s}`, mat.name);
    row.kind = 'skin';
    row.section = s;
    const wy = why[`skin:${s}`] ?? skinWear(mat, s, loads, { info, traits });
    if (groupSays('peakQ')) { /* the structure group says it */ } else if (fin(loads.peakQ)) row.did.push({ text: T(A.skinQ, { q: n(loads.peakQ / 1000, 1), limit: n(mat.strengthKPa) }), tone: loads.peakQ / 1000 > 0.85 * mat.strengthKPa ? 'bad' : 'info' });
    else if (fin(mat.strengthKPa)) row.did.push({ text: T(A.skinQRated, { limit: n(mat.strengthKPa) }), tone: 'info' });
    if (fin(wy.tempC) && !groupSays('skinTemp')) row.did.push({ text: T(A.skinTemp, { temp: n(wy.tempC), limit: n(mat.maxTempC) }), tone: wy.tempC > 0.85 * mat.maxTempC ? 'bad' : 'info' });
    if (wy.hits > 0 && !groupSays('hit')) row.did.push({ text: T(wy.hits === 1 ? A.hitOnce : A.hits, { n: n(wy.hits) }), tone: 'bad' });
    for (const d of (record?.defects ?? []).filter((x) => !x.partId && x.section === s)) row.did.push({ text: describeDefect(d, text.luck?.defects, lang), tone: 'bad' });
    const delta = Math.max(0, (after?.hull?.[s] ?? 0) - (before?.hull?.[s] ?? 0));
    row.wear = { delta, total: after?.hull?.[s] ?? delta, consumed: 0, trend: trendFor((w) => w?.hull?.[s]) };
  }

  // the launch pad
  const padFx = bd?.padFx ?? null;
  const pad = record?.pad ?? {};
  if (padFx || record?.pad) {
    const row = rowOf('pad', 'pad', padFx?.complex?.name ?? sectionName('pad'));
    row.kind = 'pad';
    const thrustKN = (record?.asBuilt?.thrustSL ?? bd?.thrustSL ?? 0) / 1000;
    const limit = padFx?.heatLimitKN ?? null;
    if (groupSays('padHeld')) { /* the propulsion group says how the flight held the engines back */ } else if ((pad.excess ?? padFx?.excess ?? 0) > 0) row.did.push({ text: T(A.pad?.held, { limit: n(limit), thrust: n(thrustKN), throttle: n((padFx?.throttle ?? 1) * 100), mps: n(pad.liftoffLossMps ?? padFx?.liftoffLossMps ?? 0) }), tone: 'bad' });
    else if (fin(limit)) row.did.push({ text: T(A.pad?.full, { limit: n(limit), thrust: n(thrustKN) }), tone: 'good' });
    for (const d of (record?.defects ?? []).filter((x) => x.source === 'pad')) row.did.push({ text: describeDefect(d, text.luck?.defects, lang), tone: 'bad' });
    if ((pad.repairFee ?? 0) > 0) row.did.push({ text: T(A.pad?.repairs, { money: money(pad.repairFee) }), tone: 'bad' });
    if (record?.scrubs?.length) {
      row.did.push({ text: T(record.scrubs.length === 1 ? A.pad?.scrubOne : A.pad?.scrubs, { n: n(record.scrubs.length) }), tone: 'info' });
      const clamps = (padFx?.choices ?? []).find((c) => c.eq?.key === 'clamps')?.option;
      if (clamps?.holdLine) row.did.push({ text: T(clamps.holdLine, { holdS: n(clamps.holdS ?? 3) }), tone: 'info' });
    }
  }

  // the groups' notes, through their templates (grouped: one line per part, kind and section, with a count)
  // a group's notes on no part in particular: one row per group in that section, named after the group
  const general = (s, group) => rowOf(s, `general:${s}:${group ?? ''}`, T(A.groups?.[group]) || sectionName(s));
  const rowOfKind = (kind, sec) => {
    if (!kind) return null;
    if (kind === 'skin') return findRow(sections, `skin:${sec}`) ?? null;
    const all = [...sections.values()].flatMap((rows) => [...rows.values()]).filter((r) => r.kind === kind);
    return all.find((r) => r.partIds?.some((id) => sectionOf(id) === sec)) ?? all[0] ?? null;
  };
  const seen = new Map();
  for (const note of effects?.notes ?? []) {
    if (!note?.what) continue;
    const k = `${note.group}|${note.partId ?? ''}|${note.section ?? ''}|${note.what}`;
    seen.set(k, { note, count: (seen.get(k)?.count ?? 0) + 1 });
  }
  for (const { note, count } of seen.values()) {
    const templates = traitsData?.[note.group]?.notes ?? null;
    const tmpl = templates?.[note.what];
    // where it goes: the note's own section, else its template's, else its part's, else the group's
    const sec = note.section ?? (typeof tmpl === 'object' ? tmpl?.section : null) ?? (note.partId ? sectionOf(note.partId) : null) ?? GROUP_SECTION[note.group] ?? 'body';
    const line = renderNote(note, templates, { lang, partName: note.partId ? nameOf(note.partId) : '', sectionName: tr(text.luck?.defects?.sections?.[sec], lang) || sectionName(sec), count });
    if (!line) continue;
    let row = null;
    if (sec === 'ship') row = general('ship', note.group); // the whole ship: one row per group
    else if (sec === 'pad') row = findRow(sections, 'pad') ?? general('pad', note.group); // the pad, even about an engine
    else if (note.partId && entryOf.has(note.partId)) {
      const e = entryOf.get(note.partId);
      row = findRow(sections, keyOf(e)) ?? rowOf(sectionOf(e.id) ?? sec, keyOf(e), e.def.name, twinsOf(e).map((x) => x.id));
    } else row = rowOfKind(WHAT_ROW[note.what], sec) ?? general(sec, note.group);
    // in the part's own row, "Spare O₂ tank: only 54 g…" reads "Only 54 g…"
    const own = note.partId && row.partIds?.includes(note.partId) ? `${nameOf(note.partId)}: ` : null;
    if (own && line.text.startsWith(own)) line.text = line.text.charAt(own.length).toUpperCase() + line.text.slice(own.length + 1);
    row.did.push(line);
    const wi = whatIfNote(note, line, row);
    if (wi) row.whatIf.push(wi);
  }

  // ---- comparisons with the choices not made ----
  if (ship && deps) {
    const W = A.whatIf ?? {};
    const sDiff = (o) => ({ dCost: o.result.spec.stats.cost - stats.cost, dDv: o.result.spec.stats.deltaV - stats.deltaV, dMass: o.result.spec.stats.dryMass - stats.dryMass });
    const alt = altBuilder(record.design, catalog, deps, cache);
    for (const rows of sections.values()) {
      for (const row of rows.values()) {
        // one comparison per part (no clutter): the most telling one; a group's own verdict line may come before it
        if (row.whatIf.length >= 2) continue;
        let lines = [];
        try {
          if (row.kind === 'skin') lines = skinWhatIf(row.section);
          else if (row.kind === 'pad') lines = row.whatIf.length ? [] : padWhatIf(); // a group's own pad comparison first
          else if (row.kind === 'shield') lines = shieldWhatIf(entryOf.get(row.partIds[0]));
          else if (['engine', 'tank', 'booster'].includes(row.kind)) lines = materialWhatIf(entryOf.get(row.partIds[0]));
        } catch { /* a comparison that cannot be built is left out */ }
        row.whatIf = [...row.whatIf, ...lines.filter(Boolean).slice(0, 1)].slice(0, 2);
      }
    }

    function extras({ dMass = 0, dCost = 0, dDv = 0, dFee = 0 } = {}) {
      let s = '';
      if (Math.abs(dMass) >= 5) s += T(dMass > 0 ? W.heavier : W.lighter, { kg: n(Math.abs(dMass)) });
      if (Math.abs(dCost) >= 1000) s += T(dCost > 0 ? W.dearer : W.cheaperBy, { money: money(Math.abs(dCost)) });
      if (Math.abs(dDv) >= 5) s += T(dDv > 0 ? W.dvMore : W.dvLess, { mps: n(Math.abs(dDv)) });
      if (Math.abs(dFee) >= 1000) s += T(dFee > 0 ? W.feesMore : W.feesLess, { money: money(Math.abs(dFee)) });
      return s;
    }
    function skinWhatIf(s) {
      const mine = hullMaterial(ship.hull, s);
      const myWear = why[`skin:${s}`]?.delta ?? 0;
      const options = hullChoices(s).filter((m) => m.id !== mine.id).map((m) => {
        const o = alt(`skin:${s}:${m.id}`, (a) => a.setHull(s, m.id));
        if (!o) return null;
        const info = o.result.breakdown.hull?.bySection?.[s] ?? null;
        // the alternative's own predicted peak on the reference climb (hull.js): another metal heats differently, so this
        // flight's measured temperature is not carried over to it
        const temp = info?.peakTempC ?? null;
        const w = skinWear(m, s, { ...loads, skinTempC: { ...(loads.skinTempC ?? {}), [s]: temp } }, { info, traits: o.result.spec.stats.traits }).delta;
        const heatFail = fin(temp) && temp > m.maxTempC;
        const qFail = fin(loads.peakQ) && loads.peakQ / 1000 > m.strengthKPa;
        return { m, w, temp, heatFail, qFail, ...sDiff(o) };
      }).filter(Boolean);
      return compareLines(options, myWear, (x) => x.m.name, (x) => (x.heatFail ? T(W.heat, { alt: x.m.name, limit: n(x.m.maxTempC), temp: n(x.temp) }) : x.qFail ? T(W.q, { alt: x.m.name, limit: n(x.m.strengthKPa), q: n(loads.peakQ / 1000, 1) }) : null));
    }

    function materialWhatIf(e) {
      const fam = materials?.families?.[e?.def?.materialFamily];
      if (!fam) return [];
      const myWear = wearDelta(e.id) || why[e.id]?.delta || 0;
      const mineId = e.material ?? e.def.defaultMaterial ?? fam.options[0]?.id;
      const options = fam.options.filter((o) => o.id !== mineId).map((m) => {
        const o = alt(`mat:${e.id}:${m.id}`, (a) => a.setMaterial(e.id, m.id));
        const ae = o?.layout.find((x) => x.id === e.id);
        if (!ae) return null;
        return { m, w: partWear(ae, loads, { materials, sectionOf }).delta, ...sDiff(o) };
      }).filter(Boolean);
      return compareLines(options, myWear, (x) => x.m.name, () => null);
    }

    function shieldWhatIf(e) {
      if (!e || shieldType(e) !== 'ablator') return [];
      const slot = catalog.kit?.(e.def)?.slots?.find((s) => s.key === 'ablator');
      if (!slot) return [];
      const mineId = e.options?.ablator ?? slot.options[0]?.id;
      const myUse = after?.consumed?.[e.id] ?? why[e.id]?.consumed ?? 0;
      const myRate = WEAR.shield.ablator[mineId] ?? WEAR.shield.ablatorDefault;
      if (!(myUse > 0)) return [];
      const options = slot.options.filter((o) => o.id !== mineId && o.id !== 'heat_sink').map((opt) => {
        const o = alt(`opt:${e.id}:ablator:${opt.id}`, (a) => a.setOption(e.id, 'ablator', opt.id));
        if (!o) return null;
        const rate = WEAR.shield.ablator[opt.id] ?? WEAR.shield.ablatorDefault;
        return { opt, use: Math.min(1, myUse * (rate / myRate)), ...sDiff(o) };
      }).filter(Boolean);
      const best = options.filter((x) => x.use < myUse - 0.02).sort((x, y) => x.use - y.use || x.dCost - y.dCost)[0];
      const lines = [];
      if (best) lines.push({ text: T(W.shield, { alt: best.opt.name, altUse: n(best.use * 100), use: n(myUse * 100), extra: extras(best) }), tone: 'info' });
      const cheap = options.filter((x) => x.dCost < -1000 && x !== best).sort((x, y) => x.dCost - y.dCost)[0];
      if (cheap) lines.push({ text: T(W.shield, { alt: cheap.opt.name, altUse: n(cheap.use * 100), use: n(myUse * 100), extra: extras(cheap) }), tone: 'info' });
      return lines;
    }

    function padWhatIf() {
      const sites = deps.pad?.sites ?? [];
      const mine = padFx?.complex?.id ?? null;
      const myLoss = pad.liftoffLossMps ?? padFx?.liftoffLossMps ?? 0;
      const options = sites.filter((s) => s.id !== mine).map((site) => {
        const o = alt(`pad:${site.id}`, (a) => a.setLaunch({ site: site.id, pad: {} }));
        const fx = o?.result.breakdown.padFx;
        if (!fx) return null;
        return { site, loss: fx.liftoffLossMps ?? 0, limit: fx.heatLimitKN, repair: fx.repairFee ?? 0, dFee: (o.result.breakdown.launchFee ?? 0) - (bd.launchFee ?? 0) };
      }).filter(Boolean);
      if (myLoss > 0) {
        const better = options.filter((x) => x.loss < myLoss - 1).sort((x, y) => x.loss - y.loss || x.dFee - y.dFee)[0];
        return better ? [{ text: T(W.padBetter, { alt: better.site.name, limit: n(better.limit), mps: n(myLoss - better.loss), extra: extras({ dFee: better.dFee }) }), tone: 'good' }] : [];
      }
      // left at full thrust: the cheapest pad that would have held it back shows what a weak pad does
      const worse = options.filter((x) => x.loss > 1).sort((x, y) => x.dFee - y.dFee || y.loss - x.loss)[0];
      return worse ? [{ text: T(W.padWorse, { alt: worse.site.name, limit: n(worse.limit), mps: n(worse.loss), extra: extras({ dFee: worse.dFee }) + (worse.repair > 0 ? T(W.repairs, { money: money(worse.repair) }) : '') }), tone: 'bad' }] : [];
    }

    /**
     * The comparisons, most telling first: one that would have failed on this flight (fail(x) gives its line), then the
     * alternative that wears least (when it beats mine), then the cheapest one (or the lightest) and what it would cost.
     */
    function compareLines(options, myWear, label, fail) {
      const lines = [];
      const fmtW = (w) => plusPct(w);
      const ok = options.filter((x) => !fail(x));
      const failing = options.filter((x) => fail(x)).sort((x, y) => x.dCost - y.dCost)[0];
      if (failing) lines.push({ text: fail(failing), tone: 'bad' });
      const best = ok.filter((x) => x.w < myWear * 0.9).sort((x, y) => x.w - y.w || x.dCost - y.dCost)[0];
      if (best) lines.push({ text: T(W.wear, { alt: label(best), altWear: fmtW(best.w), wear: fmtW(myWear), extra: extras(best) }), tone: 'good' });
      {
        const cheap = ok.filter((x) => x !== best && x.dCost < -1000).sort((x, y) => x.dCost - y.dCost)[0];
        // no cheaper choice: the one that buys the most Δv (a lighter part), and what it costs in wear
        const light = cheap ? null : ok.filter((x) => x !== best && x.dDv >= 5).sort((x, y) => y.dDv - x.dDv)[0];
        if (cheap) lines.push({ text: T(W.cheaper, { alt: label(cheap), money: money(-cheap.dCost), altWear: fmtW(cheap.w), wear: fmtW(myWear), extra: extras({ dMass: cheap.dMass, dDv: cheap.dDv }) }), tone: cheap.w > myWear ? 'bad' : 'info' });
        else if (light) lines.push({ text: T(W.wear, { alt: label(light), altWear: fmtW(light.w), wear: fmtW(myWear), extra: extras(light) }), tone: light.w > myWear ? 'bad' : 'info' });
      }
      return lines;
    }
  }

  /** A note that carries limit and trait: would another choice have flipped the verdict? (the notes contract §2) */
  function whatIfNote(note, line, row) {
    if (!ship || !deps || !fin(note.value) || !fin(note.limit) || !note.trait) return null;
    const alt = altBuilder(record.design, catalog, deps, cache);
    const path = fill(note.trait, { section: note.section ?? '', partId: note.partId ?? '' });
    // compare like with like: this ship's own trait at the same path, rebuilt fresh, against each alternative's
    const mineLimit = fin(getPath(traits?.[note.group], path)) ? getPath(traits?.[note.group], path) : note.limit;
    const failedNow = note.value > mineLimit;
    const tmpl = traitsData?.[note.group]?.notes?.[note.what] ?? {};
    const tries = [];
    const e = note.partId ? entryOf.get(note.partId) : null;
    if (e) {
      const fam = materials?.families?.[e.def.materialFamily];
      const mineMat = e.material ?? e.def.defaultMaterial ?? fam?.options[0]?.id;
      const mineMatName = fam?.options.find((o) => o.id === mineMat)?.name ?? mineMat;
      for (const m of fam?.options ?? []) if (m.id !== mineMat) tries.push({ key: `mat:${e.id}:${m.id}`, label: m.name, mine: mineMatName, apply: (a) => a.setMaterial(e.id, m.id) });
      for (const slot of catalog.kit?.(e.def)?.slots ?? []) {
        const mine = e.options?.[slot.key] ?? slot.options[0]?.id;
        const mineName = slot.options.find((o) => o.id === mine)?.name ?? mine;
        for (const o of slot.options) if (o.id !== mine) tries.push({ key: `opt:${e.id}:${slot.key}:${o.id}`, label: o.name, mine: mineName, apply: (a) => a.setOption(e.id, slot.key, o.id) });
      }
    } else if (note.section && HULL_SECTIONS.includes(note.section)) {
      const mine = hullMaterial(ship.hull, note.section);
      for (const m of hullChoices(note.section)) if (m.id !== mine.id) tries.push({ key: `skin:${note.section}:${m.id}`, label: m.name, mine: mine.name, apply: (a) => a.setHull(note.section, m.id) });
    } else if (note.section === 'pad') {
      for (const s of deps.pad?.sites ?? []) if (s.id !== padFx?.complex?.id) tries.push({ key: `pad:${s.id}`, label: s.name, mine: padFx?.complex?.name ?? '', apply: (a) => a.setLaunch({ site: s.id, pad: {} }) });
    }
    const flips = [];
    for (const t of tries.slice(0, MAX_ALTS)) {
      const o = alt(t.key, t.apply);
      const altLimit = getPath(o?.result?.spec?.stats?.traits?.[note.group], path);
      if (!fin(altLimit) || altLimit === mineLimit) continue;
      if ((note.value > altLimit) !== failedNow) flips.push({ ...t, altLimit, dCost: o.result.spec.stats.cost - (stats?.cost ?? 0) });
    }
    if (!flips.length) return null;
    const pick = flips.sort((x, y) => x.dCost - y.dCost)[0];
    const vars = { ...noteVars({ ...note, limit: mineLimit }, tmpl, lang, { altLimit: pick.altLimit }), alt: pick.label, mine: pick.mine, part: note.partId ? nameOf(note.partId) : '' };
    const entry = failedNow ? (tmpl.whatIfPass ?? A.whatIf?.pass) : (tmpl.whatIfFail ?? A.whatIf?.fail);
    void line; void row;
    return { text: T(entry, vars), tone: failedNow ? 'good' : 'bad' };
  }

  // ---- the whole ship ----
  const summary = [];
  const fl = record?.flown;
  if (fin(fl?.dvStart) && fin(fl?.dvEnd)) {
    const used = Math.max(0, fl.dvStart - fl.dvEnd);
    const had = fl.dvStart; // the flight computer's own count at the pad (record.asBuilt.deltaV is the same ship on paper)
    const legs = LEGS.filter((k) => (fl.used?.[k] ?? 0) >= 1).map((k) => T(A.dvLeg, { leg: T(A.legs?.[k]), mps: n(fl.used[k]) }));
    summary.push({ text: T(legs.length ? A.dvUsedLegs : A.dvUsed, { used: n(used), had: n(had), pct: n(had > 0 ? (used / had) * 100 : 0), list: legs.join(' · ') }), tone: 'info' });
  } else if (fin(record?.asBuilt?.deltaV) && fin(record?.designed?.deltaV)) {
    const d = record.asBuilt.deltaV - record.designed.deltaV;
    summary.push({ text: T(A.dvBuilt, { built: n(record.asBuilt.deltaV), paper: n(record.designed.deltaV), diff: `${d >= 0 ? '+' : '−'}${n(Math.abs(d))} m/s` }), tone: 'info' });
  }
  if (ship && after && outcome === 'home') {
    const fee = refurbish(stats.cost, { wear: after, breakdown: bd }).fee;
    const carry = { parts: after.parts, hull: after.hull };
    summary.push({ text: T(A.refly, { fee: money(fee), cost: money(stats.cost), now: pct(wornReliability(stats.reliability, bd, carry, layout), 1), fresh: pct(stats.reliability, 1) }), tone: 'info' });
  }

  const ending = record?.outcome?.endingId ? (tr(text.board?.endings?.[record.outcome.endingId], lang) || record.outcome.endingId) : '';
  return {
    title: T(A.title),
    sub: T(A.flight, { n: record?.n ?? '', ship: record?.name ?? '' }),
    outcome,
    outcomeText: T(A.outcome?.[outcome], { ending }),
    showWear: outcome !== 'lost', // a lost ship flies no more: its wear says nothing
    summary,
    sections: SECTIONS.map((id) => ({ id, title: sectionName(id), rows: mergeAlike([...sections.get(id).values()].filter((r) => r.did.length || r.whatIf.length || (outcome !== 'lost' && r.wear)).sort((x, y) => x.order - y.order)) })).filter((s) => s.rows.length),
  };
}

/** Two parts of the same kind that did exactly the same (two spare O₂ bottles) read as one row, "×2". */
function mergeAlike(rows) {
  const out = [];
  const sig = (r) => JSON.stringify([r.name, r.did, r.whatIf, r.wear]);
  for (const r of rows) {
    const twin = r.partIds?.length ? out.find((x) => x.partIds?.length && sig(x) === sig(r)) : null;
    if (twin) { twin.partIds = [...twin.partIds, ...r.partIds]; twin.count = (twin.count ?? 1) + 1; continue; }
    out.push({ ...r });
  }
  for (const r of out) if (r.count > 1) r.name = `${r.name} ×${r.count}`;
  return out;
}

const rowsHave = (sections, key) => [...sections.values()].some((rows) => rows.has(key));
const findRow = (sections, key) => { for (const rows of sections.values()) if (rows.has(key)) return rows.get(key); return null; };

/** Builds (once each, kept in cache) the ship with one change applied: (key, apply(assembly)) → rebuild() or null. */
function altBuilder(design, catalog, deps, cache) {
  const memo = cache.alts ?? (cache.alts = new Map());
  return (key, apply) => {
    if (memo.has(key)) return memo.get(key);
    let out = null;
    try {
      const a = new Assembly(design, catalog);
      if (apply(a) !== false) out = rebuild(a.toJSON(), catalog, deps);
    } catch { out = null; }
    memo.set(key, out);
    return out;
  };
}

/**
 * The flights of this same ship up to this one (a reflown ship keeps its design signature and build serial), oldest
 * first: their wear after each flight draws the trend.
 */
export function trendOf(record, history = []) {
  const sig = record?.home?.sig, serial = record?.home?.serial;
  if (!sig) return [];
  return (history ?? []).filter((r) => r?.home?.sig === sig && r.home.serial === serial && (r.n ?? 0) <= (record.n ?? 0)).sort((x, y) => x.n - y.n);
}
