// The vehicle's outer skin (Role 1 agent "hull" owns this file). Pure: no browser or core imports (only data/hull.json).
//
// Real rockets are one smooth body from the outside: interstages, skirts, intertanks, fairings and conical adapters
// cover every narrower part, so the air sees one body and the loads run through one shell. This module works out that
// outer mould line from the layout and prices it. The player picks one skin material per section (nose, body, tail).
//
// How the shell is found (data/hull.json "profiles" says how each axial part looks from outside):
//   - shell parts (tanks, intertanks, interstages, thrust structures, heat shields…) already are the outer skin: no
//     extra skin there, so the mass stays realistic.
//   - inner parts (trusses, spin tables, payload adapters, kick motors, a stowed inflatable shield) are narrower or open:
//     a cylindrical skirt or a conical interstage covers each run of them, from the part above to the part below.
//   - a nose cover (fairing) sitting on a capsule that fits inside it becomes a payload fairing: it runs down round the
//     capsule, its heat shield and any payload hardware below, to the first real stage structure.
//   - wherever two parts of different diameter meet without an adapter, a cone (30° half-angle where there is room)
//     runs over the end of the narrower part; adapters (adapter_* from sections.js composeChain) already are cones.
//   - capsules, nose covers, escape towers and engines keep their own shape; a short narrow structure sandwiched
//     between two wider parts is filled over instead of getting two cones (no hour-glass necks).
//   - the open lower part of a single-engine thrust frame gets a skirt (Redstone, Delta II engine sections).
// Then the physics (constants and sources in data/hull.json "physics"): mass and cost per square metre, the peak skin
// temperature on the climb (a thin skin heated by a turbulent boundary layer along a reference climb through the 1976
// standard atmosphere, faster on flares and fairing shoulders, cooled by its own radiation; cork is glued where real
// engineers would), the chance the skin wrinkles at Max-Q (against the crewed factor of safety 1.4), and how much
// smoother the skinned body is than the bare stack (cdAFactor). Side equipment that really rides inside a rocket
// (data/hull.json "inside") is placed by fitEquipment(), which assembly.layout() calls: in a dry bay (under the skin, in
// a dry structure, in the cabin, or in a tank's forward or aft skirt), never in the propellant. What fits nowhere goes
// into one automatic equipment bay: a short cylinder of skin at the body's diameter, like a service module (Apollo SM,
// Orion ESM, Soyuz instrument compartment, Dragon trunk), just under the capsule or payload; everything above it moves
// up by its height.
import HULL from './data/hull.json' with { type: 'json' };

/** Sections that get a skin. */
export const HULL_SECTIONS = ['nose', 'body', 'tail'];

const PHYS = HULL.physics;
const SIZE_SCALE = { s: 0.75, m: 1, l: 1.35 }; // the same scales as assembly.js SIZE_SCALE (kept here so this file imports nothing)
const BASE_R = 1.25; // assembly.js BASE_RADIUS
const NECK = 0.45; // radius of the docking ring every capsule nose part seats on (sections/nose/art.js)
const TOL = PHYS.lipTolerance; // radius differences up to this are lips and ring frames, not steps
const TAN = Math.tan((PHYS.coneHalfAngleDeg * Math.PI) / 180);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, k = 100) => Math.round(v * k) / k;
const sizeRadius = (size) => BASE_R * (SIZE_SCALE[size] ?? 1);

const MATERIALS = Object.freeze(HULL.materials.map((m) => Object.freeze({ ...m, pros: [...(m.pros ?? [])], cons: [...(m.cons ?? [])] })));

/**
 * The skin materials a section may use; the first one is the default. Every section offers the same six.
 * Each: { id, name, short, note, pros, cons, real, massPerM2 (kg), costPerM2 ($), maxTempC, strengthKPa (the Max-Q its
 * standard skin takes), fatiguePerFlight (share of its life one flight uses), cdAFactor (surface finish), density,
 * specificHeat, sources }.
 */
export function hullChoices(sectionId) {
  void sectionId;
  return MATERIALS;
}

/** The material a section uses now (assembly.hull[sectionId], or the default). */
export function hullMaterial(hull, sectionId) {
  const list = hullChoices(sectionId);
  return list.find((m) => m.id === hull?.[sectionId]) ?? list[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Which side-mounted parts ride inside the skin
// ---------------------------------------------------------------------------------------------------------------
const INSIDE = HULL.inside;
const outsideMatch = INSIDE.outsideMatch ? new RegExp(INSIDE.outsideMatch) : null;

/** Does this radial part ride inside the skin wherever it is clamped (data/hull.json "inside")? */
export function ridesInside(def) {
  if (!def || def.attach !== 'radial') return false;
  if (def.hullSide === 'outside') return false; // a part may say where it rides (parts.json hullSide)
  if (def.hullSide === 'inside') return true;
  if (INSIDE.alwaysInside?.includes(def.id)) return true;
  if (INSIDE.outsideBoosters && def.booster) return false;
  if (INSIDE.outsideIds?.includes(def.id)) return false;
  if (outsideMatch && outsideMatch.test(def.id)) return false;
  if (INSIDE.outsideFlags?.some((f) => def.flags?.[f])) return false;
  return true;
}

/** Parts drawn round the rocket's axis (seals in the joints, gimbal actuators): their mount is the axis itself. */
export const ridesOnAxis = (def) => !!def && (INSIDE.axisFlags ?? []).some((f) => def.flags?.[f]);

// ---------------------------------------------------------------------------------------------------------------
// The shape of each axial part seen from outside
// ---------------------------------------------------------------------------------------------------------------
function profileOf(def) {
  if (def.id === BAY_ID) return { kind: 'bay' };
  const p = def.hullProfile ?? HULL.profiles[def.id]; // a part may declare its own outside shape (parts.json hullProfile)
  if (p) return p;
  if (def.engine) return { kind: 'engine' };
  if (def.adapter) return { kind: 'adapter' };
  if (def.flags?.capsule) return { kind: 'own' };
  if (def.family === 'abort') return { kind: 'tower' };
  return { kind: 'shell' };
}

/** r at a height inside a [rFrac, yFrac] profile (linear between points). */
function profileAt(points, R, h, yLocal) {
  const f = clamp(yLocal / h, 0, 1);
  for (let i = 0; i < points.length - 1; i++) {
    const [r0, y0] = points[i], [r1, y1] = points[i + 1];
    if (f >= y0 && f <= y1) return R * (y1 > y0 ? r0 + ((r1 - r0) * (f - y0)) / (y1 - y0) : r1);
  }
  return R * points[points.length - 1][0];
}

/** The id of the automatic equipment bay's virtual element. */
export const BAY_ID = 'equipment-bay';
/** Tank finishes (insulation options) a stage wears end to end, so its equipment bay wears them too. */
const BAY_FINISHES = new Set(['foam', 'foam_white', 'tiodize']);

/** Elements of the axial stack, top first: { id, entry, def, section, kind, y0, y1, h, R, rT, rB, need, bareT, bareB, climb, rAt }. */
function elementsOf(layout) {
  const axial = layout.filter((e) => e.attach === 'axial' && e.def);
  const bay = layout.equipmentBay;
  if (bay) {
    // the automatic equipment bay is a plain cylinder of skin in the stack (no part: the layout left room for it)
    const def = { id: BAY_ID, name: 'Equipment bay', section: bay.section, size: 'm', height: bay.y1 - bay.y0, aero: { sideArea: 0 }, flags: {}, finish: bay.finish ?? null };
    axial.push({ id: BAY_ID, type: BAY_ID, def, attach: 'axial', y: bay.y0, height: bay.y1 - bay.y0, radius: bay.R });
  }
  axial.sort((a, b) => b.y - a.y);
  const els = axial.map((e) => {
    const def = e.def, p = profileOf(def), R = e.radius ?? sizeRadius(def.size), h = e.height ?? def.height;
    const el = { id: e.id, entry: e, def, section: def.section ?? null, kind: p.kind, y0: e.y, y1: e.y + h, h, R, rT: R, rB: R, need: R, bareT: R, bareB: R, climb: 0, rAt: () => R, openBelow: p.openBelow ?? 0, heatShield: !!def.flags?.heatShield };
    if (p.kind === 'adapter') {
      el.rT = sizeRadius(def.adapter?.top ?? def.size);
      el.rB = sizeRadius(def.adapter?.bottom ?? def.size);
      el.rAt = (y) => el.rB + ((el.rT - el.rB) * clamp(y / h, 0, 1));
      el.bareT = el.rT; el.bareB = el.rB;
    } else if (p.kind === 'inner') {
      el.need = R * (p.rMax ?? 1) + PHYS.clearance;
      el.rT = el.rB = R * (p.rMax ?? 1);
      el.bareT = el.bareB = R * (p.bareR ?? p.rMax ?? 1);
    } else if (p.kind === 'own') {
      if (p.profile) {
        el.rAt = (y) => profileAt(p.profile, R, h, y);
        el.rB = el.rAt(0); el.rT = el.rAt(h); // a waisted part (Soyuz Blok A) meets the joint below at its own radius: the skin cones it
        el.climb = PHYS.capsuleClimb;
      } else {
        el.rT = el.rB = p.absR ?? R;
        el.rAt = () => el.rB;
      }
      el.need = el.rB;
      el.bareT = el.rT; el.bareB = el.rB;
    } else if (p.kind === 'cover') {
      el.bt = p.bt ?? 0.36;
    } else if (p.kind === 'engine' || p.kind === 'tower') {
      el.rT = el.rB = null;
    }
    return el;
  });
  // a nose cover becomes a fairing when a capsule narrow enough to fit inside it sits under it, right below or under
  // modules that fit too (Soyuz: fairing, orbital module, descent capsule); otherwise it seats on the capsule's docking
  // ring with a boat-tail. entry.shrouded tells sections/nose/art.js (capsuleBelow) to stop the cover at its base ring.
  els.forEach((el, i) => {
    if (el.kind !== 'cover') return;
    let k = i + 1, cap = null;
    while (els[k] && els[k].R != null && els[k].R <= el.R + 0.01 && els[k].section === el.section && els[k].kind !== 'engine' && els[k].kind !== 'tower') {
      if (els[k].def.flags?.capsule) { cap = els[k]; break; }
      k += 1;
    }
    el.shroud = !!cap;
    el.shroudTo = cap ? k : null;
    if (el.entry) el.entry.shrouded = el.shroud;
    if (el.shroud) { el.rB = el.R; el.bareB = el.R; } else {
      el.rB = NECK; el.bareB = NECK; el.climb = el.bt;
      el.rAt = (y) => (y >= el.bt ? el.R : NECK + ((el.R - NECK) * y) / el.bt);
    }
    el.rT = 0; el.bareT = 0;
  });
  return els;
}

const joins = (el) => el && el.kind !== 'engine' && el.kind !== 'tower'; // takes part in the outer line
const noseKind = (el) => el && (el.kind === 'own' || el.kind === 'cover');
const coneLength = (dr) => clamp(Math.abs(dr) / TAN, PHYS.coneMinLength, PHYS.coneMaxLength);

// ---------------------------------------------------------------------------------------------------------------
// The skin geometry (no materials yet)
// ---------------------------------------------------------------------------------------------------------------
/**
 * buildSkin(layout) → { segments, bands, covered (Set of axial ids fully under the skin), elements, top }.
 * segments: [{ section, kind: 'skirt' | 'cone' | 'fairing', y0, y1, r0, r1, covers: [ids] }], y0 < y1, r0 at y0, r1 at y1.
 * bands: the outer line from the top of the stack down, [{ y0, y1, rB, rT, skin (segment index or -1), id }].
 */
const SKIN_CACHE = new WeakMap(); // layout array → its skin (assembly.layout() and computeHull share one build)
export function buildSkin(layout) {
  if (layout && typeof layout === 'object' && SKIN_CACHE.has(layout)) return SKIN_CACHE.get(layout);
  const built = buildSkinNow(layout);
  if (layout && typeof layout === 'object') SKIN_CACHE.set(layout, built);
  return built;
}
function buildSkinNow(layout) {
  const els = elementsOf(layout ?? []);
  const segments = [];
  const covered = new Set();
  const top = els.length ? els[0].y1 : 0;
  if (!els.length) return { segments, bands: [], covered, elements: els, top };

  // 1. a short narrow structure between two wider parts is filled over, not necked (one pass, plain shells only)
  els.forEach((el, i) => {
    if (el.kind !== 'shell' || el.heatShield) return;
    const a = els[i - 1], b = els[i + 1];
    if (!joins(a) || !joins(b) || a.kind === 'inner' || b.kind === 'inner') return;
    const ra = a.rB, rb = b.rT;
    if (ra > el.R + TOL && rb > el.R + TOL && el.h < coneLength(ra - el.R) + coneLength(rb - el.R)) {
      el.kind = 'inner'; el.need = el.R + PHYS.clearance; el.filled = true;
    }
  });

  const sectionOfSpan = (list) => {
    const len = {};
    for (const { el, take } of list) len[el.section] = (len[el.section] ?? 0) + take;
    return Object.entries(len).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  };
  // skin elements replace the spans they cover in the outer line
  const spans = []; // { i0, i1 (indices into els, inclusive), segs: [segment indices], rT, rB }

  // 2. payload fairings: a nose cover over a capsule runs down round the capsule, heat shields and inner hardware
  for (let i = 0; i < els.length; i++) {
    const cover = els[i];
    if (cover.kind !== 'cover' || !cover.shroud) continue;
    let j = cover.shroudTo ?? i + 1;
    const inside = els.slice(i + 1, j + 1); // the capsule and any modules between it and the cover
    while (els[j + 1] && (els[j + 1].kind === 'inner' || els[j + 1].heatShield)) { j += 1; inside.push(els[j]); }
    const yTop = cover.y0, yBot = els[j].y0;
    const Rf = Math.max(cover.R, ...inside.map((e) => (e.kind === 'inner' ? e.need : e.R)));
    const below = els[j + 1];
    const rBelow = joins(below) ? below.rT : null;
    const segIdx = [];
    const sec = cover.section;
    const ids = inside.map((e) => e.id);
    if (rBelow != null && rBelow > Rf + TOL) {
      // flare out at the bottom to the wider stage below, over the payload hardware (never into the capsule)
      const capBottom = inside[0].y0;
      const L = Math.min(coneLength(rBelow - Rf), Math.max(0.15, capBottom - yBot), (yTop - yBot) * 0.6);
      segIdx.push(segments.push({ section: sec, kind: 'fairing', y0: yBot + L, y1: yTop, r0: Rf, r1: Rf, covers: ids }) - 1);
      segIdx.push(segments.push({ section: sec, kind: 'cone', y0: yBot, y1: yBot + L, r0: rBelow, r1: Rf, covers: ids }) - 1);
      spans.push({ i0: i + 1, i1: j, segs: segIdx, rT: Rf, rB: rBelow });
    } else {
      segIdx.push(segments.push({ section: sec, kind: 'fairing', y0: yBot, y1: yTop, r0: Rf, r1: Rf, covers: ids }) - 1);
      spans.push({ i0: i + 1, i1: j, segs: segIdx, rT: Rf, rB: Rf });
    }
    for (const e of inside) { covered.add(e.id); e.inFairing = true; }
    i = j;
  }

  // 3. runs of inner parts: a skirt (same diameter above and below) or a conical interstage
  for (let i = 0; i < els.length; i++) {
    if (els[i].kind !== 'inner' || els[i].inFairing) continue;
    let j = i;
    while (els[j + 1] && els[j + 1].kind === 'inner' && !els[j + 1].inFairing) j += 1;
    const run = els.slice(i, j + 1);
    const a = els[i - 1], b = els[j + 1];
    const yTop = run[0].y1, yBot = run[run.length - 1].y0;
    const needMax = Math.max(...run.map((e) => e.need));
    const spanAbove = spans.find((s) => s.i1 === i - 1), spanBelow = spans.find((s) => s.i0 === j + 1);
    let ra = spanAbove ? spanAbove.rB : joins(a) ? a.rB : null;
    let rb = spanBelow ? spanBelow.rT : joins(b) ? b.rT : null;
    if (ra == null && rb == null) { ra = rb = needMax; }
    if (ra == null) ra = Math.max(rb, needMax);
    if (rb == null) rb = Math.max(ra, needMax);
    const sec = sectionOfSpan(run.map((el) => ({ el, take: el.h })));
    const ids = run.map((e) => e.id);
    // widening below a capsule in too short a run (a stowed inflatable shield): the cone runs up the capsule's base
    let ext = 0, rTop = ra;
    if (!spanAbove && a?.kind === 'own' && a.climb > 0 && rb > ra + TOL && yTop - yBot < coneLength(rb - ra)) {
      ext = Math.min(a.climb, coneLength(rb - ra) - (yTop - yBot));
      rTop = a.rAt(ext);
      a.climbedBottom = ext;
    }
    const coneAt = (y) => rb + ((rTop - rb) * (y - yBot)) / Math.max(1e-6, yTop + ext - yBot);
    const fits = run.every((e) => coneAt(e.y0) >= e.need - 1e-6 && coneAt(e.y1) >= e.need - 1e-6);
    if (!fits && ext) { ext = 0; rTop = ra; a.climbedBottom = 0; }
    const segIdx = [];
    if (fits) {
      segIdx.push(segments.push({ section: sec, kind: Math.abs(rTop - rb) <= TOL ? 'skirt' : 'cone', y0: yBot, y1: yTop + ext, r0: rb, r1: rTop, covers: ext ? [...ids, a.id] : ids }) - 1);
    } else {
      // something inside is wider than the line between the neighbours: a cylinder round it, short cones to each end
      const Rc = Math.max(needMax, Math.min(ra, rb));
      const span = yTop - yBot;
      const Lt = Math.abs(Rc - ra) > TOL ? Math.min(coneLength(Rc - ra), span * 0.3) : 0;
      const Lb = Math.abs(Rc - rb) > TOL ? Math.min(coneLength(Rc - rb), span * 0.3) : 0;
      if (Lt > 0) segIdx.push(segments.push({ section: sec, kind: 'cone', y0: yTop - Lt, y1: yTop, r0: Rc, r1: ra, covers: ids }) - 1);
      segIdx.push(segments.push({ section: sec, kind: 'skirt', y0: yBot + Lb, y1: yTop - Lt, r0: Rc, r1: Rc, covers: ids }) - 1);
      if (Lb > 0) segIdx.push(segments.push({ section: sec, kind: 'cone', y0: yBot, y1: yBot + Lb, r0: rb, r1: Rc, covers: ids }) - 1);
    }
    for (const e of run) covered.add(e.id);
    spans.push({ i0: i, i1: j, segs: segIdx, rT: ra, rB: rb });
    i = j;
  }

  // the outer line before the step cones: skin spans and the parts that join it
  spans.sort((x, y) => x.i0 - y.i0);
  const line = []; // { kind: 'span' | 'part', el?, span?, rT, rB, y0, y1 }
  for (let i = 0; i < els.length; i++) {
    const span = spans.find((s) => s.i0 === i);
    if (span) {
      line.push({ kind: 'span', span, rT: span.rT, rB: span.rB, y0: els[span.i1].y0, y1: els[span.i0].y1 });
      i = span.i1;
      continue;
    }
    const el = els[i];
    line.push({ kind: joins(el) ? 'part' : 'gap', el, rT: el.rT, rB: el.rB, y0: el.y0, y1: el.y1, coverTop: 0, coverBottom: el.climbedBottom ?? 0 });
  }

  // 4. steps between parts of different diameter: a cone over the end of the narrower part
  const climbable = (item) => item.kind === 'part' && item.el.kind !== 'adapter' && item.el.kind !== 'bay';
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k], b = line[k + 1];
    if (a.kind === 'gap' || b.kind === 'gap') continue;
    if (a.kind === 'part' && b.kind === 'part' && noseKind(a.el) && noseKind(b.el)) continue; // capsule, caps and covers are made to mate
    const dr = b.rT - a.rB;
    if (Math.abs(dr) <= TOL) continue;
    const up = dr > 0; // the narrower part is above the joint
    const Rw = up ? b.rT : a.rB;
    const want = coneLength(dr);
    const joint = a.y0;
    let got = 0, rEnd = up ? a.rB : b.rT;
    const took = [];
    for (let m = up ? k : k + 1; m >= 0 && m < line.length; m += up ? -1 : 1) {
      const item = line[m];
      if (!climbable(item)) break;
      const el = item.el;
      const rHere = up ? el.rB : el.rT;
      if (took.length && rHere > rEnd + TOL) break; // wider again: stop
      if (el.kind === 'own' || el.kind === 'cover') {
        const free = Math.max(0, Math.min(el.climb, el.h - (up ? item.coverBottom : item.coverTop)));
        const take = Math.min(free, want - got);
        if (take > 0.02) { took.push({ el, take, item }); got += take; rEnd = el.rAt(up ? take : el.h - take); }
        break;
      }
      const free = Math.max(0, el.h - item.coverTop - item.coverBottom);
      const take = Math.min(free, want - got);
      if (take <= 0.02) break;
      took.push({ el, take, item });
      got += take;
      rEnd = up ? el.rT : el.rB;
      if (got >= want - 1e-6 || take < free - 1e-6) break;
    }
    if (got < 0.05) continue; // nothing to climb onto (an adapter or an engine): the drag model still sees the step
    for (const t of took) {
      if (up) t.item.coverBottom += t.take; else t.item.coverTop += t.take;
      if (t.item.coverTop + t.item.coverBottom >= t.el.h - 1e-6) covered.add(t.el.id);
    }
    const sec = sectionOfSpan(took);
    const seg = up
      ? { section: sec, kind: 'cone', y0: joint, y1: joint + got, r0: Rw, r1: rEnd, covers: took.map((t) => t.el.id) }
      : { section: sec, kind: 'cone', y0: joint - got, y1: joint, r0: rEnd, r1: Rw, covers: took.map((t) => t.el.id) };
    const idx = segments.push(seg) - 1;
    if (up) a.stepBelow = idx; else b.stepAbove = idx;
  }

  // 5. the automatic equipment bay is skin all round; the open lower part of a single-engine thrust frame (Redstone,
  // Delta II) gets its skirt
  for (const el of els) if (el.kind === 'bay') segments.push({ section: el.section, kind: 'bay', y0: el.y0, y1: el.y1, r0: el.R, r1: el.R, covers: [], finish: el.def.finish ?? null });
  for (const el of els) {
    if (el.kind !== 'shell' || !el.openBelow) continue;
    segments.push({ section: el.section, kind: 'skirt', y0: el.y0, y1: el.y0 + el.h * el.openBelow, r0: el.R, r1: el.R, covers: [el.id], openFrame: true });
  }

  // the outer line from the top down, as bands
  const bands = [];
  const segBand = (idx) => { const s = segments[idx]; bands.push({ y0: s.y0, y1: s.y1, rB: s.r0, rT: s.r1, skin: idx, id: null }); };
  for (const item of line) {
    if (item.kind === 'gap') continue;
    if (item.kind === 'span') { [...item.span.segs].sort((x, y) => segments[y].y1 - segments[x].y1).forEach(segBand); continue; }
    const el = item.el;
    const yTopFree = el.y1 - item.coverTop, yBotFree = el.y0 + item.coverBottom;
    if (item.stepAbove != null) segBand(item.stepAbove);
    // (an own-shape part keeps its real profile between the ends: a capsule's wall is not a straight cone)
    if (yTopFree - yBotFree > 1e-6) bands.push({ y0: yBotFree, y1: yTopFree, rB: el.rAt(yBotFree - el.y0), rT: el.rAt(yTopFree - el.y0), skin: -1, id: el.id, kind: el.kind, ...(el.kind === 'own' ? { at: (y) => el.rAt(y - el.y0) } : {}) });
    if (item.stepBelow != null) segBand(item.stepBelow);
  }
  // the band shapes of own parts: their real radius at each end (capsule taper, cover boat-tail)
  for (const b of bands) {
    if (b.skin >= 0 || !b.id) continue;
    const el = els.find((e) => e.id === b.id);
    if (el.kind === 'cover') { b.rT = 0; b.rB = el.rAt(b.y0 - el.y0); }
  }
  return { segments, bands, covered, elements: els, top };
}

/** Outer radius of the skinned stack at height y (largest band there), 0 above the top or in an engine/tower gap. */
export function radiusAt(skin, y) {
  let r = 0;
  for (const b of skin.bands) {
    if (y < b.y0 - 1e-6 || y > b.y1 + 1e-6) continue;
    if (b.at) { r = Math.max(r, b.at(clamp(y, b.y0, b.y1))); continue; }
    const f = b.y1 > b.y0 ? clamp((y - b.y0) / (b.y1 - b.y0), 0, 1) : 0;
    r = Math.max(r, b.rB + (b.rT - b.rB) * f);
  }
  return r;
}

/** The radius of the hardware inside the outer line at height y (what equipment in a skin bay must clear). */
function coreRadiusAt(skin, y) {
  let r = 0;
  for (const el of skin.elements) {
    if (!joins(el) || el.kind === 'bay' || y < el.y0 - 1e-6 || y > el.y1 + 1e-6) continue;
    r = Math.max(r, el.kind === 'inner' ? el.need - PHYS.clearance : el.rAt(y - el.y0));
  }
  return r;
}

/** A side part's rough width (its art is about this deep), for seating it inside the skin. */
export const widthOf = (def) => clamp((def.height ?? 0.6) * 0.6, 0.3, 0.9);

const tankSafe = (def) => !!def && ((INSIDE.tankSafeIds ?? []).includes(def.id) || (INSIDE.tankSafeFlags ?? []).some((f) => def.flags?.[f]));

/**
 * The dry places inside the outer line where equipment can ride (never in the propellant):
 *   skin  - the ring between a skirt, cone or fairing and what it covers
 *   dry   - inside a dry structure (intertank, interstage, centerbody, instrument ring, crew trunk, engine section)
 *   cabin - inside a crew capsule (only for nose equipment: life support, chutes, the crew's own gear)
 *   skirt - a tank's forward or aft skirt: the dry ring between its dome and its wall, skirtFrac x radius tall
 * Each: { kind, y0, y1, partId, room(y) → free depth from the wall inwards, wall(y) → the wall's inner radius }.
 */
function dryBays(skin) {
  const bays = [];
  skin.segments.forEach((s, i) => {
    if (s.kind === 'bay') return; // the equipment bay holds the items it was sized for (layout.equipmentBay.slots)
    bays.push({
      kind: 'skin', y0: s.y0, y1: s.y1, partId: null, seg: i,
      wall: (y) => radiusAt(skin, y) - 0.04,
      room: (y) => radiusAt(skin, y) - 0.04 - coreRadiusAt(skin, y),
    });
  });
  for (const el of skin.elements) {
    if (!joins(el) || el.heatShield || el.kind === 'cover' || el.kind === 'bay' || (el.kind === 'inner' && el.def.booster)) continue; // (a kick motor fills its own frame)
    if (el.def.fuel) {
      if (el.kind === 'inner') continue; // a tank hung inside a skirt: the skin's ring round it is the bay
      const s = Math.min(el.h / 2, (INSIDE.skirtFrac ?? 0.35) * el.R);
      const depth = Math.min(INSIDE.skirtDepth ?? 0.5, el.R * 0.4);
      // the skirt's wall is the tank's own wall at that height (a shaped tank, the N1's cone or Blok A's waist, narrows)
      const wallAt = (y) => el.rAt(y - el.y0) - 0.04;
      for (const [y0, y1] of [[el.y1 - s, el.y1], [el.y0, el.y0 + s]]) bays.push({ kind: 'skirt', y0, y1, partId: el.id, wall: wallAt, room: (y) => Math.min(depth, wallAt(y) * 0.4) });
      continue;
    }
    if (el.kind === 'own' && !el.def.flags?.capsule) continue; // nose caps are solid
    const capsule = !!el.def.flags?.capsule;
    const wallAt = (y) => (el.kind === 'inner' ? el.need - PHYS.clearance : el.rAt(y - el.y0)) - 0.04;
    bays.push({ kind: capsule ? 'cabin' : 'dry', y0: el.y0, y1: el.y1, partId: el.id, wall: wallAt, room: (y) => wallAt(y) - el.R * 0.15 });
  }
  return bays;
}

/** Where an item of depth w and height h fits in a bay, closest to height yWant: { y, mount (centre radius), skinR } or null. */
function fitIn(bay, w, h, yWant) {
  if (bay.y1 - bay.y0 < h - 0.02) return null;
  const lo = bay.y0, hi = Math.max(bay.y0, bay.y1 - h);
  const tryAt = (y) => {
    let room = Infinity, wall = Infinity;
    for (const f of [0, 0.5, 1]) { const yy = Math.min(bay.y1, y + h * f); room = Math.min(room, bay.room(yy)); wall = Math.min(wall, bay.wall(yy)); }
    return room >= w && wall > 0 ? { y, mount: wall - w / 2, skinR: wall + 0.04 } : null;
  };
  const start = clamp(yWant, lo, hi);
  const first = tryAt(start);
  if (first) return first;
  for (let d = 0.15; d <= hi - lo + 0.15; d += 0.15) { // the nearest height in the bay where it fits
    for (const y of [start - d, start + d]) if (y >= lo - 1e-6 && y <= hi + 1e-6) { const r = tryAt(y); if (r) return r; }
  }
  return null;
}

const placedLayouts = new WeakSet();

/**
 * Where the side-mounted parts that ride inside the skin go. Mutates the entries of `layout`:
 *   axial parts: covered = true when the skin covers them completely.
 *   radial parts that ride inside: inside = true, bay, mountR (metres from the axis to the art's centre), skinR (the
 *   outer line's radius there), bayPart (the part whose wall encloses it, for the see-through view), and x / z: the
 *   ShipSpec attachment point (README setRocketPartArt: origin at the attachment point, +x outwards), which is the
 *   part's inner face, mountR - width / 2.
 *   bay: 'skin' (the ring under a skirt, cone or fairing), 'dry' (a dry structure), 'cabin' (a crew capsule), 'skirt'
 *   (a tank's forward or aft skirt), 'bay' (the automatic equipment bay; its angle is reassigned so the items stand
 *   round the bay), 'part' (a helium bottle left in its tank, as on Falcon 9, or an item sharing a host's room),
 *   'orphan' (no room anywhere yet: fitEquipment() makes the equipment bay for these) or 'axis' (seals, gimbal
 *   actuators drawn round the axis; x / z stay on the host's wall).
 * Equipment never rides inside propellant: an item clamped to a tank moves (y changes) to the nearest dry bay.
 * Returns the skin it used.
 */
export function placeInside(layout, skin = buildSkin(layout)) {
  if (Array.isArray(layout)) placedLayouts.add(layout);
  for (const e of layout) if (e.attach === 'axial') e.covered = skin.covered.has(e.id);
  let bays = null;
  const eqBay = layout.equipmentBay ?? null;
  for (const e of layout) {
    if (e.attach !== 'radial' || !e.def) continue;
    if (!(ridesInside(e.def) || skin.covered.has(e.parentId))) continue;
    e.inside = true;
    if (ridesOnAxis(e.def)) { e.bay = 'axis'; e.mountR = 0; e.skinR = e.radius; e.bayPart = null; continue; } // x / z stay on the host's wall
    const w = widthOf(e.def), h = e.height ?? e.def.height ?? 0.5;
    const slot = eqBay?.slots?.[e.id];
    if (slot) { intoBay(e, eqBay, slot, w); continue; }
    const a = ((e.angle ?? 0) * Math.PI) / 180;
    bays ??= dryBays(skin);
    const host = skin.elements.find((el) => el.id === e.parentId);
    const inPropellant = !!host?.def.fuel;
    const allowed = (b) => (b.kind !== 'cabin' || (INSIDE.cabinFor ?? ['nose']).includes(e.def.section)) && !(inPropellant && tankSafe(e.def) && b.partId === host.id && b.kind === 'skirt');
    let best = null;
    if (!(inPropellant && tankSafe(e.def))) {
      // its host's own dry volume first, then the nearest dry bay above or below
      // (a capsule inside a fairing lends its outside, the ring under the fairing, before its cabin)
      const own = (b) => b.partId && b.partId === e.parentId && b.kind !== 'skirt' && !skin.covered.has(e.parentId);
      const order = bays.filter(allowed).map((b) => ({ b, d: own(b) ? -1 : Math.max(0, b.y0 - (e.y + h), e.y - b.y1) + (b.kind === 'cabin' ? 0.01 : 0) })).sort((p, q) => p.d - q.d);
      for (const { b, d } of order) {
        if (best && d > best.dist) break;
        const fit = fitIn(b, w, h, e.y);
        if (!fit) continue;
        const dist = Math.abs(fit.y - e.y) + (d < 0 ? -1 : 0);
        if (!best || dist < best.dist) best = { ...fit, bay: b, d, dist };
      }
    }
    if (best) {
      const dy = best.y - e.y;
      e.y += dy; e.centerY += dy;
      e.bay = best.bay.kind;
      e.bayPart = best.bay.partId;
      e.mountR = Math.max(best.mount, w / 2);
      e.skinR = best.skinR;
    } else if (inPropellant && tankSafe(e.def)) {
      // a helium bottle in its tank, as on Falcon 9 (it sits in the liquid oxygen)
      const wall = Math.max(0.3, Math.min(radiusAt(skin, e.y), radiusAt(skin, e.y + h) || Infinity) - 0.04);
      e.bay = 'part';
      e.bayPart = e.parentId;
      e.mountR = Math.max(w / 2 + 0.1, wall - w / 2);
      e.skinR = wall + 0.04;
    } else if (!inPropellant && host && skin.covered.has(host.id)) {
      // under a fairing with no free ring big enough: it shares the room under the skin with its host (a capsule)
      const y = h <= host.h ? clamp(e.y, host.y0, host.y1 - h) : host.y0;
      const wall = Math.min(radiusAt(skin, y), radiusAt(skin, y + h / 2), radiusAt(skin, y + h)) - 0.04;
      const dy = y - e.y;
      e.y += dy; e.centerY += dy;
      e.bay = 'part';
      e.bayPart = host.id;
      e.mountR = Math.max(w / 2 + 0.1, wall - w / 2);
      e.skinR = wall + 0.04;
    } else if (eqBay) {
      // the equipment bay was sized without it (rare: its first choice moved): it squeezes in at the bay's base
      intoBay(e, eqBay, { dy: 0.1, angle: e.angle ?? 0 }, w);
      continue;
    } else {
      // no dry room big enough anywhere near (a tank wall, or a shelter too big for a small capsule): the equipment
      // bay is made for it (fitEquipment); it waits on its host's wall meanwhile
      e.bay = 'orphan';
      e.bayPart = null;
      e.mountR = e.radius + w * 0.45;
      e.skinR = e.radius;
      continue;
    }
    const face = Math.max(0, e.mountR - w / 2); // the attachment point: its inner face, the art reaches out to the skin
    e.x = face * Math.cos(a);
    e.z = -face * Math.sin(a);
  }
  return skin;
}

/** An item in its slot of the equipment bay: on the bay wall, at the slot's height and angle. */
function intoBay(e, bay, slot, w) {
  const y = bay.y0 + slot.dy;
  e.centerY += y - e.y;
  e.y = y;
  e.angle = slot.angle;
  e.bay = 'bay';
  e.bayPart = null;
  e.mountR = bay.R - 0.04 - w / 2;
  e.skinR = bay.R;
  const face = Math.max(0.1, e.mountR - w / 2), a = (slot.angle * Math.PI) / 180;
  e.x = face * Math.cos(a);
  e.z = -face * Math.sin(a);
}

/** A real intertank or centerbody (data/hull.json inside.bay.intertankMatch): dry structure between two tanks. */
const isIntertank = (el) => new RegExp(INSIDE.bay.intertankMatch).test(el.def.id);
/** A part of the stage above it: its aft skirt, a lattice, or a tank hung inside the skirt (inside.bay.stagePartMatch). */
export const isStagePart = (el) => new RegExp(INSIDE.bay.stagePartMatch).test(el.def.id) || (!!el.def.fuel && el.kind === 'inner');

/**
 * Where the automatic equipment bay goes and how tall it is, for the items placeInside() could not fit (bay 'orphan'),
 * or null when nothing needs it. Where (data/hull.json inside.bay.prefer, the first that exists): 'intertank', next to
 * a real intertank or centerbody right under the topmost tank (real intertanks carry avionics), otherwise below that
 * tank's own aft skirt, hung tank or lattice (never splitting a stage: S-IVB, DCSS, Blok I); 'nose', just under the capsule or
 * payload on top of the body's first part below any adapter (where service modules ride); else on top of the topmost
 * tank. The intertank comes first because a bay up front puts its side area ahead of the centre of mass and tipped
 * the presets into UNSTABLE. Its diameter is that of the part below it (or of the part above, if that one is wider
 * with no adapter between, so the step still resolves on the narrower side). Height: the items stand round the bay wall in rings, each ring as tall as its
 * tallest item plus room to reach in, inside ring frames at both ends (data/hull.json inside.bay).
 * Returns { y0 (where it is inserted, before anything moves), height, R, section, slots: { id: { dy, angle } } }.
 */
export function planEquipmentBay(layout, skin = buildSkin(layout)) {
  const orphans = layout.filter((e) => e.attach === 'radial' && e.bay === 'orphan');
  if (!orphans.length) return null;
  const B = INSIDE.bay;
  const els = skin.elements.filter(joins);
  let below = null, above = null, spot = null;
  const tryNose = () => {
    const noseLow = [...els].reverse().find((el) => el.section === 'nose' && el.kind !== 'cover');
    if (!noseLow) return;
    const i = els.indexOf(noseLow);
    const next = els.slice(i + 1).find((el) => el.kind !== 'adapter');
    if (next && next.section === 'body' && els.slice(i + 1, els.indexOf(next)).every((el) => el.kind === 'adapter')) { below = next; above = els[els.indexOf(next) - 1]; }
  };
  const tryIntertank = () => {
    // where real stages carry avionics between their tanks: a real intertank or centerbody right under the topmost
    // tank (the bay joins it); otherwise below that tank's own aft skirt, hung tank or lattice, never between a tank and
    // a part of its own stage, and still low, for stability
    const tank = els.find((el) => el.def.fuel && el.section === 'body') ?? els.find((el) => el.def.fuel);
    if (!tank) return;
    let k = els.indexOf(tank);
    if (els[k + 1] && isIntertank(els[k + 1])) { below = els[k + 1]; above = tank; return; }
    while (els[k + 1] && isStagePart(els[k + 1]) && Math.abs(els[k + 1].y1 - els[k].y0) < 1e-6) k += 1;
    const last = els[k], after = els[k + 1];
    if (after && Math.abs(after.y1 - last.y0) < 1e-6) { below = after; above = last; } else spot = { y0: last.y0, R: last.rB, section: tank.section };
    if (below) spot = { section: tank.section };
  };
  for (const where of B.prefer ?? ['nose', 'intertank']) { if (!below && !spot) (where === 'nose' ? tryNose : tryIntertank)(); }
  if (!below && !spot) {
    const tank = els.find((el) => el.def.fuel);
    if (tank) { below = tank; above = els[els.indexOf(tank) - 1] ?? null; }
  }
  if (!below && !spot?.R) return null;
  let R = spot?.R ?? (below.kind === 'inner' ? below.R : below.rT);
  if (below && above && above.kind !== 'adapter' && above.kind !== 'cover' && (above.rB ?? 0) > R + TOL) R = above.rB;
  // rings round the wall, tallest items first
  const items = orphans.map((e) => ({ e, w: widthOf(e.def), h: e.height ?? e.def.height ?? 0.5 })).sort((p, q) => q.h - p.h || p.e.id.localeCompare(q.e.id));
  const wMax = Math.max(...items.map((it) => it.w));
  const around = 2 * Math.PI * Math.max(0.3, R - 0.04 - wMax / 2) * B.useOfRing;
  const rings = [];
  for (const it of items) {
    const ring = rings[rings.length - 1];
    if (ring && ring.arc + it.w + B.gap <= around) { ring.items.push(it); ring.arc += it.w + B.gap; ring.h = Math.max(ring.h, it.h); } else rings.push({ items: [it], arc: it.w + B.gap, h: it.h });
  }
  const height = clamp(B.frame * 2 + rings.reduce((t, r) => t + r.h + B.headroom, 0) - B.headroom, B.minHeight, B.maxHeight);
  const slots = {};
  let dy = B.frame;
  for (const ring of rings) {
    // keep the items in the order they stood round the rocket, spaced evenly round the ring
    const order = [...ring.items].sort((p, q) => (p.e.angle ?? 0) - (q.e.angle ?? 0));
    const start = order[0].e.angle ?? 0;
    const spare = (around / B.useOfRing - ring.arc) / order.length;
    const rMid = Math.max(0.3, R - 0.04 - wMax / 2);
    let s0 = 0;
    for (const it of order) {
      slots[it.e.id] = { dy: Math.min(dy, Math.max(B.frame, height - B.frame - it.h)), angle: Math.round((start + ((s0 + (it.w + B.gap) / 2) / rMid) * (180 / Math.PI)) % 360 * 10) / 10 };
      s0 += it.w + B.gap + spare;
    }
    dy += ring.h + B.headroom;
  }
  const section = spot?.section ?? (below.section === 'nose' || below.section === 'tail' ? 'body' : below.section ?? 'body');
  // a bay in a stage whose tanks wear one finish end to end (the Atlas V core's copper Tiodize, the orange foam of the
  // Shuttle tank and SLS, Long March 5's white foam) wears it too, as the intertank does, so the stage stays one colour
  const finishOf = (el) => (el?.def?.fuel ? el.entry?.options?.insulation : null);
  const fin = [above, below].map(finishOf).find((f) => BAY_FINISHES.has(f)) ?? null;
  return { y0: spot?.y0 ?? below.y1, height, R, section, slots, finish: fin };
}

/** Lifts everything above the equipment bay by its height and records the bay on the layout (layout.equipmentBay). */
export function applyEquipmentBay(layout, plan) {
  const lifted = new Set();
  for (const e of layout) if (e.attach === 'axial' && e.y >= plan.y0 - 1e-6) { e.y += plan.height; e.centerY += plan.height; lifted.add(e.id); }
  for (const e of layout) if (e.attach === 'radial' && lifted.has(e.parentId)) { e.y += plan.height; e.centerY += plan.height; }
  Object.defineProperty(layout, 'equipmentBay', { value: { y0: plan.y0, y1: plan.y0 + plan.height, R: plan.R, section: plan.section, slots: plan.slots, finish: plan.finish ?? null }, enumerable: false });
  return layout;
}

/** Items with no room and no equipment bay to go to (a stack with no tank): they share their host's room. */
function settleOrphans(layout, skin) {
  for (const e of layout) {
    if (e.attach !== 'radial' || e.bay !== 'orphan') continue;
    const w = widthOf(e.def), h = e.height ?? e.def.height ?? 0.5;
    const wall = Math.max(w + 0.14, Math.min(radiusAt(skin, e.y) || e.radius, radiusAt(skin, e.y + h) || e.radius) - 0.04);
    e.bay = 'part';
    e.bayPart = e.parentId;
    e.mountR = wall - w / 2;
    e.skinR = wall + 0.04;
    const face = e.mountR - w / 2, a = ((e.angle ?? 0) * Math.PI) / 180;
    e.x = face * Math.cos(a);
    e.z = -face * Math.sin(a);
  }
}

/**
 * The layout with every inside item placed (assembly.layout() calls this with a function that lays the parts out from
 * scratch): place what fits in the dry bays; if anything is left over, lay out again with an equipment bay inserted
 * for it (everything above it moves up) and place again.
 */
export function fitEquipment(makeLayout) {
  let out = makeLayout();
  const skin = placeInside(out);
  const plan = planEquipmentBay(out, skin);
  if (plan) {
    out = applyEquipmentBay(makeLayout(), plan);
    placeInside(out);
  }
  settleOrphans(out, buildSkin(out));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------------------------------------------
const coneArea = (s) => Math.PI * (s.r0 + s.r1) * Math.hypot(s.y1 - s.y0, s.r1 - s.r0);

// The air on the reference climb: the US Standard Atmosphere 1976 (data/hull.json physics.atmosphere), density
// interpolated in log, temperature linearly.
function air(h) {
  const t = PHYS.atmosphere;
  if (h <= t[0][0]) return { rho: t[0][1], T: t[0][2] };
  for (let i = 0; i < t.length - 1; i++) {
    const [h0, r0, T0] = t[i], [h1, r1, T1] = t[i + 1];
    if (h <= h1) { const f = (h - h0) / (h1 - h0); return { rho: Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * f), T: T0 + (T1 - T0) * f }; }
  }
  const last = t[t.length - 1];
  return { rho: last[1], T: last[2] };
}
const SIGMA = 5.670374e-8; // Stefan-Boltzmann constant, W/m²/K⁴
function climbAt(t) {
  const pts = PHYS.ascent;
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, h0, v0] = pts[i], [t1, h1, v1] = pts[i + 1];
    if (t >= t0 && t <= t1) { const f = (t - t0) / (t1 - t0); return [h0 + (h1 - h0) * f, v0 + (v1 - v0) * f]; }
  }
  return pts[pts.length - 1].slice(1);
}

/**
 * How much faster a skin segment heats than a flat plate at the same place: a forward-facing cone (a flare that
 * widens towards the tail) by 1 + flareHeatK sin(half-angle), a payload fairing's shoulder by shoulderHeat; others 1.
 * These are the spots where real rockets glue cork.
 */
export function heatFactor(seg) {
  if (seg.kind === 'fairing') return PHYS.shoulderHeat;
  if (seg.kind === 'cone' && seg.r0 > seg.r1 + 1e-6) return 1 + PHYS.flareHeatK * Math.sin(Math.atan2(seg.r0 - seg.r1, seg.y1 - seg.y0));
  return 1;
}

const peakCache = new Map();
/**
 * Peak skin temperature on the climb x metres behind the nose tip (data/hull.json physics._about): a thin skin of the
 * material's mass and specific heat, heated by the boundary layer (flat plate: laminar Stanton number 0.332 Re_x^-0.5
 * Pr^-2/3 below the transition Reynolds number physics.transitionRe, turbulent 0.0296 Re_x^-0.2 Pr^-2/3 above it;
 * recovery factor 0.89) along the reference climb through the 1976 standard atmosphere, times `factor` once
 * supersonic (a flare or a fairing shoulder, ramping in from Mach 1 to 2), through a cork layer of thermal resistance
 * corkR (m²K/W, 0 = bare), and cooled by its own radiation. Deterministic.
 */
export function peakSkinTempC(material, x, factor = 1, corkR = 0) {
  const xx = Math.max(0.5, Math.round(x * 10) / 10);
  const ff = Math.round(factor * 100) / 100;
  const key = `${material.id}:${material.massPerM2}:${material.specificHeat}:${xx}:${ff}:${corkR}`;
  if (peakCache.has(key)) return peakCache.get(key);
  const heatCap = material.massPerM2 * material.specificHeat; // J/m²/K
  const dt = PHYS.stepS, end = PHYS.ascent[PHYS.ascent.length - 1][0];
  let Tw = PHYS.launchTempC + 273.15, peak = Tw;
  for (let t = 0; t < end; t += dt) {
    const [h, v] = climbAt(t);
    const { rho, T: Ta } = air(h);
    const mach = v / Math.sqrt(1.4 * 287.05 * Ta);
    const Taw = Ta * (1 + PHYS.recovery * 0.2 * mach * mach); // adiabatic wall (recovery) temperature
    const mu = (1.458e-6 * Ta ** 1.5) / (Ta + 110.4); // Sutherland
    const re = Math.max(1, (rho * v * xx) / mu);
    const local = 1 + (ff - 1) * clamp(mach - 1, 0, 1);
    const st = re < (PHYS.transitionRe ?? 0) ? 0.332 * re ** -0.5 : 0.0296 * re ** -0.2; // laminar below the transition, turbulent above
    const hc = st * 0.72 ** (-2 / 3) * rho * v * 1005 * local; // W/m²/K
    const q = (Taw - Tw) / (1 / hc + corkR) - PHYS.emissivity * SIGMA * (Tw ** 4 - Ta ** 4); // a cork layer (corkR, m²K/W) in series
    Tw += (q * dt) / heatCap;
    peak = Math.max(peak, Tw);
  }
  const out = peak - 273.15;
  peakCache.set(key, out);
  return out;
}

/**
 * The peak temperature of a skin segment, with cork where real engineers would glue it: a flare or a shoulder (factor
 * > 1) that would come within cork.triggerMarginC of its material's margin gets a cork layer (its mass and price are
 * added; the skin under it runs much cooler). Returns { peak, cork, corkMass, corkCost }.
 */
function corked(mat, x, factor, area) {
  const bare = peakSkinTempC(mat, x, factor);
  const C = PHYS.cork;
  if (!(factor > 1) || bare <= mat.maxTempC - PHYS.heatMarginC - C.triggerMarginC) return { peak: bare, cork: false, corkMass: 0, corkCost: 0 };
  return { peak: peakSkinTempC(mat, x, factor, C.resistance), cork: true, corkMass: area * C.massPerM2, corkCost: area * C.costPerM2 };
}

/** Chance the standard skin of this material wrinkles at Max-Q on one flight (before scaling by how much skin there is). */
export function buckleChance(material) {
  const fs = material.strengthKPa / PHYS.maxQLimitKPa;
  if (fs >= PHYS.safeFactor) return 0;
  return Math.min(PHYS.buckleMax, PHYS.buckleMax * Math.pow((PHYS.safeFactor - fs) / PHYS.buckleSpan, PHYS.buckleExp));
}

/** Chance a skin this hot fails on the climb (0 below its limit minus the margin). */
export function heatChance(tempC, maxTempC) {
  const over = tempC - (maxTempC - PHYS.heatMarginC);
  if (over <= 0) return 0;
  return Math.min(PHYS.heatMax, PHYS.heatMax * Math.pow(over / PHYS.heatSpanC, 1.5));
}

/** Drag area of the steps along a profile [{ rT, rB, len, nose }], top first (m²). */
function stepDrag(list) {
  const D = PHYS.drag;
  let cdA = 0;
  const step = (rFront, rBack, theta) => {
    const dA = Math.PI * Math.abs(rBack * rBack - rFront * rFront);
    if (dA < 1e-6) return;
    const s = Math.sin(theta);
    cdA += rBack > rFront ? D.forwardStepCd * s * s * dA : D.backStepCd * s * dA;
  };
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.len > 0 && Math.abs(p.rT - p.rB) > 1e-6 && !p.nose) step(p.rT, p.rB, Math.atan2(Math.abs(p.rB - p.rT), p.len));
    const q = list[i + 1];
    if (q && !(p.nose && q.nose)) step(p.rB, q.rT, Math.PI / 2);
  }
  return cdA;
}

const SECTION_WORD = { en: { nose: 'nose', body: 'body', tail: 'tail' }, vi: { nose: 'mũi', body: 'thân', tail: 'đuôi' } };
const VI_MATERIAL = { al2219: 'nhôm 2219', al2195: 'nhôm-liti 2195', carbon: 'sợi carbon', steel: 'thép không gỉ', honeycomb: 'nhôm tổ ong', titanium: 'titan' };
const fmt = (v, lang) => (lang === 'vi' ? String(v).replace('.', ',') : String(v));

/** Does this section have any skin on this layout (so its skin material changes anything)? */
export function hullHasSkin(layout, sectionId) {
  const lay = layout ?? [];
  const skin = buildSkin(lay);
  if (Array.isArray(lay) && !placedLayouts.has(lay)) { placeInside(lay, skin); settleOrphans(lay, skin); }
  return skin.segments.some((s) => s.section === sectionId);
}

/**
 * computeHull(layout, { catalog, hull }) → the skin around the stack.
 *   segments: [{ section, kind: 'skirt' | 'cone' | 'fairing' | 'bay', y0, y1, r0, r1, material, mass, cost, sideArea,
 *               centerY, area, covers, peakTempC, heatFactor, cork, corkMass }]  (y0 < y1 in metres from the stack base;
 *               r0 at y0, r1 at y1). 'bay' is the automatic equipment bay (layout.equipmentBay), its items in
 *               insideIds with bay 'bay'.
 *   mass, cost, sideArea: totals added to the ship by stats.js (sideArea is what the skin adds to the side silhouette:
 *               the parts it covers already count their own)
 *   cdAFactor: multiplies the ascent drag area: clamp(skinned steps / bare steps, minFactor, maxFactor) x the skins'
 *               surface finish (equipment boxes count in neither: the game's drag never charged them)
 *   bySection: { nose: { material, name, mass, cost, area, segments, peakTempC, maxTempC, strengthKPa, fatiguePerFlight,
 *               buckleChance, heatChance }, body: …, tail: … }
 *   insideIds: radial parts that ride inside the skin (drawn only while their section's card is open)
 *   coveredIds: axial parts the skin covers completely (likewise drawn only while their card is open)
 *   risk: { maxQ: 0..1, heat: 0..1, notes: [English strings], detail: [{ kind, section, material, chance, en, vi, … }] }
 *   limits: { maxQKPa, maxTempC } of the weakest skin on the ship; both null when the ship has no skin at all
 *   fatiguePerFlight: the most any of the ship's skins wears per flight (0 without skin)
 */
export function computeHull(layout, { catalog = null, hull = {} } = {}) {
  void catalog;
  const lay = layout ?? [];
  const skin = buildSkin(lay);
  if (Array.isArray(lay) && !placedLayouts.has(lay)) { placeInside(lay, skin); settleOrphans(lay, skin); }
  const D = PHYS.drag;
  const insideIds = lay.filter((e) => e.attach === 'radial' && e.def && e.inside).map((e) => e.id);
  const axial = skin.elements;
  const partArea = (el, y0, y1) => {
    const overlap = Math.max(0, Math.min(el.y1, y1) - Math.max(el.y0, y0));
    return el.h > 0 ? ((el.entry.def.aero?.sideArea ?? 2 * el.R * el.h) * overlap) / el.h : 0;
  };

  const ring = skin.segments.map((s) => {
    const mat = hullMaterial(hull, s.section ?? 'body');
    const area = coneArea(s);
    const projected = (s.r0 + s.r1) * (s.y1 - s.y0);
    const coveredArea = axial.filter((el) => joins(el)).reduce((t, el) => t + partArea(el, s.y0, s.y1), 0);
    const x = skin.top - s.y1;
    const f = heatFactor(s);
    const heat = corked(mat, x, f, area);
    return {
      section: s.section, kind: s.kind, y0: round(s.y0, 1000), y1: round(s.y1, 1000), r0: round(s.r0, 1000), r1: round(s.r1, 1000),
      material: mat.id, area, mass: area * mat.massPerM2 + heat.corkMass, cost: area * mat.costPerM2 + heat.corkCost,
      sideArea: Math.max(0, projected - coveredArea), centerY: (s.y0 + s.y1) / 2, covers: [...s.covers], peakTempC: heat.peak, heatFactor: f, cork: heat.cork, corkMass: heat.corkMass,
      ...(s.finish ? { finish: s.finish } : {}),
    };
  });
  const segments = ring;

  const bySection = {};
  for (const sec of HULL_SECTIONS) {
    const mat = hullMaterial(hull, sec);
    const mine = segments.filter((s) => s.section === sec);
    const area = mine.reduce((t, s) => t + s.area, 0);
    const peak = mine.reduce((t, s) => Math.max(t, s.peakTempC), -Infinity);
    bySection[sec] = {
      material: mat.id, name: mat.name, mass: mine.reduce((t, s) => t + s.mass, 0), cost: mine.reduce((t, s) => t + s.cost, 0), area, segments: mine.length,
      corkMass: mine.reduce((t, s) => t + s.corkMass, 0),
      peakTempC: mine.length ? peak : null, maxTempC: mat.maxTempC, strengthKPa: mat.strengthKPa, fatiguePerFlight: mat.fatiguePerFlight,
      buckleChance: mine.length ? buckleChance(mat) * Math.min(1, 0.4 + area / PHYS.buckleAreaRef) : 0,
      heatChance: mine.reduce((t, s) => 1 - (1 - t) * (1 - heatChance(s.peakTempC, mat.maxTempC)), 0),
    };
  }

  // risk for the luck roll (asBuilt.js) and the investigation board, in plain words
  const detail = [];
  let keepMaxQ = 1, keepHeat = 1;
  for (const sec of HULL_SECTIONS) {
    const b = bySection[sec];
    if (!b.segments) continue;
    const mat = hullMaterial(hull, sec);
    const en = SECTION_WORD.en[sec], vi = SECTION_WORD.vi[sec], viMat = VI_MATERIAL[mat.id] ?? mat.name;
    if (b.buckleChance > 0) {
      keepMaxQ *= 1 - b.buckleChance;
      const margin = Math.round((mat.strengthKPa / PHYS.maxQLimitKPa) * 100) / 100;
      detail.push({
        kind: 'maxQ', section: sec, material: mat.id, chance: b.buckleChance, strengthKPa: mat.strengthKPa, limitKPa: PHYS.maxQLimitKPa, margin, wanted: PHYS.safeFactor,
        en: `The ${mat.name.toLowerCase()} on the ${en} can take about ${mat.strengthKPa} kPa of air pressure. A hard climb can reach ${PHYS.maxQLimitKPa} kPa at Max-Q, so it has only ${fmt(margin, 'en')} times what it needs, where crewed rockets are built with ${fmt(PHYS.safeFactor, 'en')} times: a small chance it buckles.`,
        vi: `Vỏ ${viMat} ở phần ${vi} chịu được áp lực gió khoảng ${mat.strengthKPa} kPa. Khi bay lên gắt, áp lực gió ở Max-Q có thể lên tới ${PHYS.maxQLimitKPa} kPa, nên vỏ chỉ chắc gấp ${fmt(margin, 'vi')} lần mức cần, trong khi tàu chở người được làm chắc gấp ${fmt(PHYS.safeFactor, 'vi')} lần: có một chút khả năng vỏ bị móp.`,
      });
    }
    if (b.heatChance > 0) {
      keepHeat *= 1 - b.heatChance;
      const t = Math.round(b.peakTempC);
      detail.push({
        kind: 'heat', section: sec, material: mat.id, chance: b.heatChance, peakTempC: t, maxTempC: mat.maxTempC,
        en: `The air rubbing past the ${en} heats its ${mat.name.toLowerCase()} to about ${t} °C on the climb, but this material starts to weaken at about ${mat.maxTempC} °C: a small chance it gives way.`,
        vi: `Không khí cọ xát làm vỏ ${viMat} ở phần ${vi} nóng tới khoảng ${t} °C khi bay lên, trong khi vật liệu này bắt đầu yếu đi ở khoảng ${mat.maxTempC} °C: có một chút khả năng vỏ bị hỏng.`,
      });
    }
  }

  // drag: how lumpy the bare stack is (steps and open structures) and how much of that the skin takes away
  const joined = axial.filter(joins);
  // (adapters are cones in both: their taper counts the same way; capsules and covers are the nose, already in noseCdA)
  const bare = stepDrag(joined.map((el) => ({ rT: el.kind === 'cover' ? el.bareB : el.bareT, rB: el.bareB, len: el.kind === 'adapter' ? el.h : 0, nose: noseKind(el) })));
  const smooth = stepDrag(skin.bands.map((b) => ({ rT: b.rT, rB: b.rB, len: b.y1 - b.y0, nose: b.skin < 0 && (b.kind === 'own' || b.kind === 'cover') })));
  const noseCdA = lay.find((e) => e.def?.aero?.cdA != null)?.def.aero.cdA ?? D.noseCdA;
  const wetted = joined.filter((el) => el.kind !== 'bay').reduce((t, el) => t + 2 * Math.PI * Math.max(el.rT ?? 0, el.rB ?? 0) * el.h, 0) + segments.reduce((t, s) => t + s.area, 0);
  const finish = wetted > 0 ? 1 + segments.reduce((t, s) => t + (hullMaterial(hull, s.section ?? 'body').cdAFactor - 1) * s.area, 0) / wetted : 1;
  const shape = clamp((noseCdA + smooth) / (noseCdA + bare), D.minFactor, D.maxFactor);
  const cdAFactor = lay.length ? shape * finish : 1;

  const withSkin = HULL_SECTIONS.filter((sec) => bySection[sec].segments);
  const mats = withSkin.map((sec) => hullMaterial(hull, sec));
  const maxQ = 1 - keepMaxQ, heat = 1 - keepHeat;
  return {
    segments,
    mass: segments.reduce((t, s) => t + s.mass, 0),
    cost: segments.reduce((t, s) => t + s.cost, 0),
    sideArea: segments.reduce((t, s) => t + s.sideArea, 0),
    cdAFactor,
    bySection,
    insideIds,
    coveredIds: [...skin.covered],
    risk: { maxQ, heat, notes: detail.map((d) => d.en), detail },
    limits: { maxQKPa: mats.length ? Math.min(...mats.map((m) => m.strengthKPa)) : null, maxTempC: mats.length ? Math.min(...mats.map((m) => m.maxTempC)) : null },
    fatiguePerFlight: mats.length ? Math.max(...mats.map((m) => m.fatiguePerFlight)) : 0,
    drag: { noseCdA, bare, smooth, shape, finish },
  };
}
