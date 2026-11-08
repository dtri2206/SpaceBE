// The four sections of the design page: nose, body, tail (parts of the vehicle, top to bottom) and pad (the launch
// site and its equipment, not part of the vehicle). Pure JS, no imports: Node tests and the browser both use it.
//
// Data lives in src/builder/sections/<id>/: section.json (shapes and the rows of the vertical list), parts.json (the
// parts that belong to that section), internals.json (their internal kits), art.js (their 3D art). Each section
// folder is owned by one person or agent, so they can work in parallel without touching each other's files.

export const VEHICLE_SECTIONS = Object.freeze(['nose', 'body', 'tail']);
export const SECTION_IDS = Object.freeze(['nose', 'body', 'tail', 'pad']);

/** Merges the shared families and every section's parts and kits into the shapes createCatalog expects. */
export function mergeSectionData(familiesJson, sectionFiles) {
  const families = [...(familiesJson.families ?? [])];
  const parts = [];
  const kits = {};
  for (const id of SECTION_IDS) {
    const f = sectionFiles[id] ?? {};
    for (const fam of f.parts?.families ?? []) if (!families.some((x) => x.id === fam.id)) families.push(fam);
    for (const p of f.parts?.parts ?? []) parts.push({ ...p, section: p.section ?? id });
    Object.assign(kits, f.internals?.kits ?? {});
  }
  return { partsJson: { version: 3, families, parts }, internalsJson: { kits } };
}

/** Normalises the four section.json files into { id, name, shapes, rows, ... }. */
export function createSections(sectionFiles) {
  const out = {};
  for (const id of SECTION_IDS) {
    const s = sectionFiles[id]?.section ?? {};
    out[id] = {
      id, name: s.name ?? id, short: s.short ?? s.name ?? id, blurb: s.blurb ?? '', order: SECTION_IDS.indexOf(id),
      shapes: (s.shapes ?? []).map((sh) => {
        const items = (sh.stack ?? []).map((it) => (typeof it === 'string' ? { type: it } : { ...it }));
        return { radial: [], pros: [], cons: [], ...sh, stack: items.map((it) => it.type), stackItems: items };
      }),
      rows: (s.rows ?? []).map((r) => ({ mode: 'radial', pick: {}, ...r })),
      ...(id === 'pad' ? { sites: s.sites ?? [], equipment: s.equipment ?? [] } : {}),
    };
  }
  return out;
}

export const sectionOf = (def) => def?.section ?? null;

/** Does a part definition match a row's pick? pick: { families, flags, ids, has: ['fuel'|'engine'|'booster'|'mounts'|'adapter'] }. */
export function matchPick(def, pick = {}) {
  if (!def) return false;
  if (pick.ids?.includes(def.id)) return true;
  if (pick.families?.includes(def.family)) return true;
  if (pick.flags?.some((f) => def.flags?.[f])) return true;
  if (pick.has?.some((k) => !!def[k])) return true;
  if (pick.match && new RegExp(pick.match).test(def.id)) return true;
  return false;
}

/** The catalogue parts a row offers (its section's parts that match the pick, in catalogue order). */
export function rowCandidates(catalog, section, row) {
  return catalog.parts.filter((p) => p.section === section.id && matchPick(p, row.pick) && (row.mode !== 'stack' || p.attach === 'axial') && (row.mode !== 'radial' || p.attach === 'radial'));
}

/** Which row of a section a part belongs to (first matching row), or null. */
export function rowOf(section, def) {
  return section.rows.find((r) => matchPick(def, r.pick) && ((r.mode === 'stack' || r.mode === 'auto') ? def.attach === 'axial' : def.attach === 'radial')) ?? null;
}

/** The installed parts of a section: { axial: [part], radial: [part] } using each part's own section. */
export function sectionParts(assembly, sectionId) {
  const axial = [], radial = [];
  for (const p of assembly.chain()) if (assembly.catalog.get(p.type)?.section === sectionId) axial.push(p);
  for (const p of assembly.parts) if (p.node === 'radial' && assembly.catalog.get(p.type)?.section === sectionId) radial.push(p);
  return { axial, radial };
}

/** The installed parts of one row, symmetry twins collapsed to one: [{ part, twins }]. */
export function rowItems(assembly, section, row) {
  const { axial, radial } = sectionParts(assembly, section.id);
  const pool = row.mode === 'radial' ? radial : axial;
  const seen = new Set();
  const out = [];
  for (const p of pool) {
    const def = assembly.catalog.get(p.type);
    if (rowOf(section, def) !== row) continue;
    if (p.group) {
      if (seen.has(p.group)) continue;
      seen.add(p.group);
    }
    out.push({ part: p, twins: p.group ? assembly.parts.filter((q) => q.group === p.group).length : 1 });
  }
  return out;
}

const isAdapter = (def) => !!def?.adapter;

/** Adapter id between two sizes, or null when the catalogue has none. */
function adapterBetween(catalog, top, bottom) {
  if (!top || !bottom || top === bottom) return null;
  const id = `adapter_${top}_${bottom}`;
  return catalog.get(id) ? id : null;
}

/**
 * Builds the new chain for a stack with `bySection` = { nose: [...], body: [...], tail: [...] } (items as for restack),
 * dropping old adapters and putting fresh ones where two sections of different diameter meet.
 */
function composeChain(catalog, bySection) {
  const out = [];
  const typeOf = (it) => it.type ?? it.typeId;
  let prev = null;
  for (const sec of VEHICLE_SECTIONS) {
    const items = (bySection[sec] ?? []).filter((it) => !isAdapter(catalog.get(typeOf(it))));
    if (!items.length) continue;
    const first = catalog.get(typeOf(items[0]));
    if (prev && first) {
      const prevDef = catalog.get(typeOf(prev));
      // the tail's engines are narrower than the body by nature; only a thrust structure needs to match
      const needs = prevDef && !prevDef.engine && !first.engine && prevDef.nodes.includes('bottom') && first.nodes.includes('top');
      const id = needs ? adapterBetween(catalog, prevDef.size, first.size) : null;
      if (id) out.push({ type: id, origin: 'adapter' });
    }
    out.push(...items);
    prev = items[items.length - 1];
  }
  return out;
}

const itemOfPart = (p) => p; // existing part objects are passed through to restack unchanged

/** The chain split by section, as part objects. */
function chainBySection(assembly) {
  const by = { nose: [], body: [], tail: [] };
  for (const p of assembly.chain()) {
    const sec = assembly.catalog.get(p.type)?.section;
    if (by[sec]) by[sec].push(itemOfPart(p));
  }
  return by;
}

/** A host for a radial part of `def` in the given chain: the part a technician would clamp it to. */
export function pickHost(assembly, chain, def, rule = null) {
  const catalog = assembly.catalog;
  const lay = new Map(assembly.layout().map((e) => [e.id, e]));
  const withRadial = chain.filter((p) => catalog.get(p.type)?.nodes.includes('radial'));
  if (!withRadial.length) return null;
  const sec = def.section;
  const inSec = withRadial.filter((p) => catalog.get(p.type)?.section === sec);
  const pool = inSec.length ? inSec : withRadial;
  const d = (p) => catalog.get(p.type);
  const by = (score) => pool.slice().sort((a, b) => score(b) - score(a))[0];
  const r = rule ?? def.host ?? null;
  if (r === 'capsule') return (pool.find((p) => d(p).flags?.capsule) ?? withRadial.find((p) => d(p).flags?.capsule) ?? pool[0]).id;
  if (r === 'thrust') return (withRadial.find((p) => d(p).mounts) ?? withRadial.filter((p) => d(p).fuel).at(-1) ?? pool.at(-1)).id;
  if (r === 'engine') return (withRadial.find((p) => d(p).engine) ?? withRadial.find((p) => d(p).mounts) ?? pool.at(-1)).id;
  if (r === 'lowestTank') return (withRadial.filter((p) => d(p).fuel).at(-1) ?? pool.at(-1)).id;
  if (r === 'top') return pool[0].id;
  // default: the biggest tank in the section, else the tallest part
  const tanks = pool.filter((p) => d(p).fuel);
  if (tanks.length) return tanks.slice().sort((a, b) => d(b).fuel.mass - d(a).fuel.mass)[0].id;
  void lay;
  return by((p) => d(p).height).id;
}

/** Default host rule for a radial part by its section and kind. */
function hostRuleFor(def) {
  if (def.host) return def.host;
  if (def.flags?.legs || def.flags?.gimbal) return 'engine';
  if (def.booster || /fin/.test(def.id)) return 'thrust';
  if (def.section === 'nose') return 'capsule';
  return null;
}

/**
 * Applies a section shape: the section's stack becomes shape.stack, its shape-made radial parts (origin === section)
 * are replaced by shape.radial, everything else is kept and re-hosted when its host goes. The tail keeps the player's
 * engine settings when the new shape has an engine. Returns the new chain ids.
 */
/** The propellant most of these stack items hold (by mass), or null. */
function mainFuelOf(catalog, items) {
  const mass = {};
  for (const it of items) { const f = catalog.get(it.type)?.fuel; if (f) mass[f.type] = (mass[f.type] ?? 0) + f.mass; }
  return Object.entries(mass).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Rows whose parts the ship still needs after a new shape that brings nothing for them (the legs). */
const KEEP_ROWS = new Set(['landing']);

export function applyShape(assembly, section, shape) {
  const catalog = assembly.catalog;
  const by = chainBySection(assembly);
  const oldEngine = by[section.id].map((p) => p).find((p) => catalog.get(p.type)?.engine);
  // engines burn what the tanks hold: a technician would set the chamber to match
  const bodyFuel = section.id === 'body' ? mainFuelOf(catalog, shape.stack.map((type) => ({ type }))) : mainFuelOf(catalog, by.body);
  const tailEngines = section.id === 'body' ? by.tail.filter((p) => catalog.get(p.type)?.engine && p.engine && bodyFuel && p.engine.fuel !== bodyFuel) : [];
  by[section.id] = shape.stack.map((type, i) => {
    const def = catalog.get(type);
    const extra = shape.stackItems?.[i] ?? {};
    const it = { type, origin: section.id, ...(extra.options ? { options: { ...extra.options } } : {}), ...(extra.material ? { material: extra.material } : {}) };
    if (def?.engine && oldEngine?.engine) it.engine = { fuel: oldEngine.engine.fuel, nozzle: oldEngine.engine.nozzle };
    if (def?.engine && shape.engine) it.engine = { fuel: shape.engine.fuel ?? it.engine?.fuel ?? 'methalox', nozzle: shape.engine.nozzle ?? it.engine?.nozzle ?? 'sl' };
    if (def?.engine && bodyFuel) it.engine = { nozzle: 'sl', ...(it.engine ?? {}), fuel: bodyFuel };
    return it;
  });
  const items = composeChain(catalog, by);
  const offset = items.findIndex((it) => !it.id && it.origin === section.id && shape.stack.includes(it.type));
  const radials = (shape.radial ?? []).map((r) => ({ ...r, on: offset + (r.on ?? 0), origin: section.id }));
  const shapeRows = new Set((shape.radial ?? []).map((r) => rowOf(section, catalog.get(r.type))?.id).filter(Boolean));
  // in a row that picks by job (flags: oxygen, shelter, airlock…), the shape replaces only what does the same jobs as
  // what it brings: Voskhod's airlock must not take the ship's spare oxygen and storm shelter with it
  const shapeJobs = new Map();
  for (const r of shape.radial ?? []) {
    const def = catalog.get(r.type), row = rowOf(section, def);
    if (!row?.pick?.flags) continue;
    const jobs = shapeJobs.get(row.id) ?? new Set();
    for (const fl of row.pick.flags) if (def.flags?.[fl]) jobs.add(fl);
    shapeJobs.set(row.id, jobs);
  }
  const sameJob = (row, def) => !shapeJobs.has(row.id) || row.pick.flags.some((fl) => def.flags?.[fl] && shapeJobs.get(row.id).has(fl));
  return assembly.restack(items, {
    radials,
    before: () => { for (const p of tailEngines) p.engine = { ...p.engine, fuel: bodyFuel }; },
    dropRadial: (r) => {
      const def = catalog.get(r.type);
      if (def?.section !== section.id) return false;
      const row = rowOf(section, def);
      // the landing legs stay when the new shape brings none (a ship has to land on Mars), whoever put them there;
      // other shape-made trim (fins, boosters, verniers) goes with the shape that brought it
      if (row && KEEP_ROWS.has(row.id) && !shapeRows.has(row.id)) return false;
      if (r.origin === section.id) return true;
      return !!row && shapeRows.has(row.id) && sameJob(row, def);
    },
    rehost: (r, chain) => { const def = catalog.get(r.type); return def ? pickHost(assembly, chain, def, hostRuleFor(def)) : null; },
  });
}

/** Removes a section from the vehicle (its stack and its own radial parts); other sections' equipment is re-hosted. */
export function clearSection(assembly, section) {
  const catalog = assembly.catalog;
  const by = chainBySection(assembly);
  by[section.id] = [];
  const items = composeChain(catalog, by);
  return assembly.restack(items, {
    dropRadial: (r) => catalog.get(r.type)?.section === section.id,
    rehost: (r, chain) => { const def = catalog.get(r.type); return def ? pickHost(assembly, chain, def, hostRuleFor(def)) : null; },
  });
}

/**
 * Adds a part through a row. Stack rows insert it in the section's stack at the row's place (rows are listed top to
 * bottom); radial rows clamp it to the row's host with the row's symmetry. Returns { ids, message }.
 */
export function addThroughRow(assembly, section, row, typeId) {
  const catalog = assembly.catalog;
  const def = catalog.get(typeId);
  if (!def) return { ids: [], message: 'Unknown part.' };
  if (def.attach === 'axial') {
    const by = chainBySection(assembly);
    const list = by[section.id];
    const rank = (d) => { const r = rowOf(section, d); return r ? section.rows.indexOf(r) : 99; };
    const myRank = section.rows.indexOf(row);
    let at = list.length;
    for (let i = 0; i < list.length; i++) if (rank(catalog.get(list[i].type)) > myRank) { at = i; break; }
    // a nose cone has no top node: it always goes first; an engine has no bottom node: it always goes last
    if (!def.nodes.includes('top')) at = 0;
    if (!def.nodes.includes('bottom')) at = list.length;
    const fresh = { type: typeId, origin: 'player' };
    list.splice(at, 0, fresh);
    const items = composeChain(catalog, by);
    const before = new Set(assembly.parts.map((p) => p.id));
    assembly.restack(items, { rehost: (r, chain) => { const d = catalog.get(r.type); return d ? pickHost(assembly, chain, d, hostRuleFor(d)) : null; } });
    const ids = assembly.parts.filter((p) => !before.has(p.id) && p.type === typeId).map((p) => p.id);
    return { ids, message: ids.length ? `${def.name} added to the ${section.short.toLowerCase()}.` : 'That part does not fit there.' };
  }
  const chain = assembly.chain();
  if (!chain.length) return { ids: [], message: 'Build a stack first: side equipment needs a body to clamp to.' };
  const host = pickHost(assembly, chain, def, row.host ?? hostRuleFor(def));
  if (!host) return { ids: [], message: 'Nothing to clamp that part to.' };
  const siblings = assembly.children(host, 'radial').length;
  const symmetry = row.symmetry ?? def.symmetry ?? 1;
  const angle = (siblings * 137.5 + 20) % 360;
  const ids = assembly.attach(typeId, host, 'radial', { angle, symmetry });
  return { ids, message: ids.length ? `${def.name}${symmetry > 1 ? ` ×${symmetry}` : ''} clamped to the ${catalog.get(assembly.part(host).type).name}.` : 'Could not clamp that part.' };
}

/** Which shape (if any) the installed section matches exactly by its stack types. */
export function currentShape(assembly, section) {
  const { axial, radial } = sectionParts(assembly, section.id);
  const types = axial.map((p) => p.type).filter((t) => !assembly.catalog.get(t)?.adapter);
  const same = section.shapes.filter((sh) => sh.stack.length === types.length && sh.stack.every((t, i) => t === types[i]));
  if (same.length <= 1) return same[0] ?? null;
  // shapes with the same stack differ by their side parts (fins, solids, legs): compare what the shape put there
  const sig = (list) => list.slice().sort().join();
  const made = sig(radial.filter((p) => p.origin === section.id).map((p) => p.type));
  return same.find((sh) => sig((sh.radial ?? []).flatMap((r) => Array(r.symmetry ?? 1).fill(r.type))) === made) ?? same[0];
}

/** Where a warning or block shows up: the section whose card should carry it (null = the whole vehicle). */
export const WARNING_SECTION = Object.freeze({
  NO_CAPSULE: 'nose', NO_HEAT_SHIELD: 'nose', LOW_O2: 'nose', NO_ANTENNA: 'nose', NO_SHELTER: 'nose',
  NO_FUEL: 'body', LOW_DV: 'body',
  NO_ENGINE: 'tail', LOW_TWR: 'tail', NO_LEGS: 'tail', UNSTABLE: 'tail',
  COLD_SEALS: 'pad',
  NOT_CONNECTED: null, OVER_BUDGET: null, LOW_RELIABILITY: null,
});

/** The pad: site, slot and equipment choices with defaults filled in. */
export function padState(assembly, pad) {
  const site = pad.sites.find((s) => s.id === assembly.launch.site) ?? pad.sites[0] ?? null;
  const slots = site?.slots ?? [];
  const slot = slots.find((s) => s.id === assembly.launch.slot) ?? slots[0] ?? null;
  const equipment = pad.equipment.map((eq) => ({ eq, option: eq.options.find((o) => o.id === assembly.launch.pad?.[eq.key]) ?? eq.options[0] }));
  return { site, slot, equipment };
}
