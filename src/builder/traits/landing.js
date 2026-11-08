// Flight traits, landing: landing, power and comms: the touchdown speed the legs stand, how slowly the chutes let the ship down, the energy for the rovers, how fast the antenna sends data home.
// Pure (Node-testable, no browser or core imports). Owner: the wave-5 landing agent (see src/builder/CLAUDE.md §8).
// Real numbers live in landing.json next to this file (per part id and per kit option id), never in the section folders;
// they arrive as `data` (catalogData.js imports the JSON for the game, the tests read it), so this file stays pure.
// Returns plain JSON (no Infinity: use null for "unlimited"), so it survives save() and the flight scenes.
//
// What each part does (landing.json says where each number comes from):
//  - legs: crushable struts take a touchdown energy E = ½·M·v² + M·g·s at their design point (mass M, speed v, stroke
//    s); a ship of mass m then stands v(m) = √(2·(E − m·g·s) / m). A wide stance keeps a tall ship from tipping over
//    (the edge between two feet against the height of the centre of mass). Folding legs can fail to lock (Jason-3).
//  - chutes: each canopy type has a Mach limit (a disk-gap-band works supersonic, a ringsail only subsonic); the
//    drag area is the builder's (chuteCdA × the canopy option). A cluster lands on one canopy less; a reserve helps.
//  - power: solar at Mars (43 % of Earth's sunlight, dust, night), the RTG's steady watts, fuel-cell reactants and
//    batteries in Wh: what the ship can put back into the rovers on Mars.
//  - comms: each antenna's real data rate from Mars, and the wait for its link: a direct antenna waits for Earth to be
//    up (about half of each sol), the relay smallsat for its next pass overhead.
// Each part's reliability is rated as stats.js rates it: catalogue value + material + the options' rel, capped.

const fin = Number.isFinite;
const num = (x, d = 0) => (fin(Number(x)) ? Number(x) : d);
const round = (x, k = 2) => (fin(x) ? Math.round(x * 10 ** k) / 10 ** k : null);
const product = (opts, key) => Object.values(opts ?? {}).reduce((f, o) => f * num(o?.[key], 1), 1);
const MAX_PART_RELIABILITY = 0.9995; // stats.js: a part that can fail keeps at least 1 failure in 2,000 flights

function materialOf(e, materials) {
  const fam = materials?.families?.[e.def?.materialFamily];
  if (!fam) return null;
  return fam.options.find((o) => o.id === e.material) ?? fam.options.find((o) => o.id === e.def.defaultMaterial) ?? fam.options[0];
}
/** A part's reliability with its material and options, as stats.js rates it (capRel). */
export function reliabilityOf(e, opts, materials) {
  const base = num(e.def?.reliability, 1);
  const r = base + num(materialOf(e, materials)?.reliability) + Object.values(opts ?? {}).reduce((s, o) => s + num(o?.rel), 0);
  return Math.min(base >= 1 ? 1 : MAX_PART_RELIABILITY, Math.max(0.01, r));
}

/**
 * landingTraits(layout, ctx, data) → this group's traits for ShipSpec.stats.traits.landing:
 *   { touchdown, chute, power, comms } (each null when the ship has none of those parts).
 * layout: assembly.layout() entries; ctx: { catalog, engines, materials, hull, padFx, stats, g0, optionsOf(entry) };
 * data: the parsed landing.json. Without data it returns the neutral values: the flight behaves exactly as before.
 */
export function landingTraits(layout, ctx, data) {
  if (!data?.legs) return { ...(data?.neutral ?? {}) };
  const entries = Array.isArray(layout) ? layout : [];
  const optionsOf = (e) => { try { return ctx?.optionsOf?.(e) ?? {}; } catch { return {}; } };
  const stats = ctx?.stats ?? {};
  const g = marsGravity(stats);
  return {
    touchdown: touchdownTraits(entries, { ...ctx, optionsOf }, data, g),
    chute: chuteTraits(entries, optionsOf, data, ctx?.materials),
    power: powerTraits(entries, optionsOf, data),
    comms: commsTraits(entries, optionsOf, data, ctx?.materials),
  };
}

/** Mars gravity from the ship's own numbers (TWR on Mars = thrust / (wet mass × g)), so no constant is written here. */
function marsGravity(s) {
  const g = s.thrust > 0 && s.wetMass > 0 && s.twrMars > 0 ? s.thrust / (s.wetMass * s.twrMars) : null;
  return fin(g) && g > 0 ? g : null;
}

// ---------------------------------------------------------------- legs ----------------------------------------------
/**
 * The touchdown speed a set of legs stands at a landed mass m (kg) under gravity g:
 * v(m) = √(2·(f·E − m·g·s) / m), capped at maxOverDesign × the design speed. leg = traits.landing.touchdown.
 * f: the energy factor (shock-absorber option, a weak strut). Also used by the flight (src/flight/effects/landing.js
 * keeps its own copy, since it may not import the builder).
 */
export function legLimitAt(leg, m, g, f = 1) {
  if (!leg || !(m > 0) || !(g > 0)) return null;
  const E = legEnergy(leg, g) * f;
  const s = num(leg.strokeM, 0);
  const v = Math.sqrt(Math.max(0, (2 * (E - m * g * s)) / m));
  const cap = leg.designMps > 0 ? leg.designMps * num(leg.maxOverDesign, 2) : Infinity;
  return Math.min(v, cap);
}
/** Energy (J) the legs absorb at their design point: ½·M·v² + M·g·s (airbags: their own energy). */
export function legEnergy(leg, g) {
  if (fin(leg?.energyJ)) return leg.energyJ;
  const M = num(leg?.designMassKg), v = num(leg?.designMps), s = num(leg?.strokeM);
  return (0.5 * M * v * v + M * g * s) * num(leg?.energyF, 1);
}
/**
 * How fast sideways (m/s) a ship can touch down before it tips over the edge between two feet, leaning leanDeg along
 * its drift (negative: leaning back against it, which helps). Rigid body pivoting about the foot that catches: the
 * angular momentum m·v·h becomes rotation, and it tips if that energy lifts the centre of mass over the edge:
 * v² = 2·g·(L − h′)·(k² + L²) / h′². L: centre of mass to the edge, h′: its height above the edge, k² = H²/12 (a
 * slender stack of height H). slideF: feet that slide instead of digging in let more speed pass. Returns 0 when the
 * ship already leans past the edge (or has no stance on that side).
 */
export function tipSpeed({ edgeM, cgM, heightM, slideF = 1 }, g, leanDeg = 0) {
  if (!(cgM > 0) || !(g > 0) || !fin(edgeM)) return null;
  if (edgeM <= 1e-6) return 0;
  const L = Math.hypot(edgeM, cgM);
  const margin = Math.min(Math.atan2(edgeM, cgM) - (num(leanDeg) * Math.PI) / 180, (89 * Math.PI) / 180);
  if (margin <= 0) return 0;
  const h = L * Math.cos(margin);
  const k2 = (num(heightM, 2 * cgM) ** 2) / 12;
  return (Math.sqrt((2 * g * (L - h) * (k2 + L * L))) / h) * slideF;
}

const MASS_STEP_T = 2; // limitByMassT keys: every 2 t up to 100 t (the analysis' what-if reads the one of this flight)
const TILT_STEP_DEG = 5; // tipByTiltDeg keys: the sideways limit leaning 0, 5, … 30° along the drift
function touchdownTraits(layout, ctx, data, g) {
  const legs = layout.filter((e) => e.def?.flags?.legs && data.legs[e.type]);
  if (!legs.length) return null;
  const opt = data.legOptions ?? {};
  const cg = dryCentreOfMass(layout, ctx);
  const stackH = layout.reduce((top, e) => (e.attach === 'axial' ? Math.max(top, num(e.y) + num(e.height)) : top), 0);
  const byPart = {};
  let best = null;
  for (const e of legs) {
    const d = data.legs[e.type];
    const opts = ctx.optionsOf(e);
    const shock = opt.shock?.[opts.shock?.id]?.energyF ?? 1;
    const slideF = opt.pads?.[opts.pads?.id]?.slideF ?? 1;
    const leg = {
      partId: e.id, type: e.type, name: e.def?.name ?? e.type, kind: d.kind, count: d.count ?? 4, deploys: !!d.deploys,
      reliability: round(reliabilityOf(e, opts, ctx.materials), 5), shock: opts.shock?.id ?? null, pads: opts.pads?.id ?? null,
      designMps: d.designMps ?? null, designMassKg: d.designMassKg ?? null, strokeM: num(d.strokeM), energyF: shock,
      maxOverDesign: num(data.maxOverDesign, 2), slideF,
    };
    if (d.kind === 'airbags') {
      // a ring of bags around the base: the energy grows with the bags' mass, the stance is the body plus the bags
      leg.energyJ = Math.round(num(d.energyJPerKg) * num(e.def?.mass) * shock);
      leg.spanM = round(2 * (num(e.radius, 1.25) + num(d.bagThicknessM, 1)), 2);
      leg.designMps = null;
    } else {
      leg.spanM = d.spanM;
    }
    // the edge between two neighbouring feet is closer than a foot: r·cos(π/n)
    leg.edgeM = round((leg.spanM / 2) * Math.cos(Math.PI / Math.max(3, leg.count)), 3);
    if (g) leg.energyJ = Math.round(legEnergy(leg, g));
    byPart[e.id] = leg;
    if (!best || num(leg.energyJ) > num(best.energyJ)) best = leg;
  }
  // the gear that lands the ship: the strongest set (a second set only adds weight)
  const refMassKg = Math.round(num(ctx.stats?.dryMass) + 0.1 * num(ctx.stats?.fuelMass)); // dry ship + a landing reserve (estimate)
  const defects = data.legDefects ?? {};
  const out = {
    ...best, cgM: round(cg, 2), heightM: round(stackH, 2), refMassKg,
    // what a defect leaves of the energy the set absorbs (begin() in the flight rolls it with 1 − reliability)
    defects: { weakCore: num(defects.weakCore, 0.75), bagTear: num(defects.bagTear, 0.5) },
    tipAngleDeg: cg > 0 ? round((Math.atan2(best.edgeM, cg) * 180) / Math.PI, 1) : null,
    limitMps: g ? round(legLimitAt(best, refMassKg, g), 2) : null,
    tipMps: g ? round(tipSpeed({ edgeM: best.edgeM, cgM: cg, heightM: stackH, slideF: best.slideF }, g), 2) : null,
    byPart: {},
  };
  for (const [id, leg] of Object.entries(byPart)) {
    const table = {}, tips = {};
    const stance = { edgeM: leg.edgeM, cgM: cg, heightM: stackH, slideF: leg.slideF };
    if (g) for (let t = MASS_STEP_T; t <= 100; t += MASS_STEP_T) table[t] = round(legLimitAt(leg, t * 1000, g), 2);
    if (g) for (let d = 0; d <= 30; d += TILT_STEP_DEG) tips[d] = round(tipSpeed(stance, g, d), 2);
    out.byPart[id] = {
      limitMps: g ? round(legLimitAt(leg, refMassKg, g), 2) : null,
      tipMps: g ? round(tipSpeed(stance, g), 2) : null,
      tipAngleDeg: cg > 0 ? round((Math.atan2(leg.edgeM, cg) * 180) / Math.PI, 1) : null,
      energyJ: leg.energyJ ?? null, spanM: leg.spanM, limitByMassT: table, tipByTiltDeg: tips,
    };
  }
  return out;
}

/** Height of the dry ship's centre of mass above the stack base (m): parts, engine hardware and the outer skin. */
function dryCentreOfMass(layout, ctx) {
  let m = 0, my = 0;
  const add = (mass, y) => { if (mass > 0 && fin(y)) { m += mass; my += mass * y; } };
  for (const e of layout) {
    add(num(e.def?.mass), num(e.centerY, num(e.y) + num(e.height) / 2));
    if (e.def?.engine) add(engineMass(e, ctx) * (e.cluster?.count ?? 1), num(e.centerY));
  }
  for (const s of ctx.hull?.segments ?? []) add(num(s.mass), num(s.centerY, (num(s.y0) + num(s.y1)) / 2));
  return m > 0 ? my / m : null;
}
/** Engine hardware mass as stats.js counts it (pump + chamber and nozzle scaled with the pump), without options. */
function engineMass(e, ctx) {
  const E = ctx.engines;
  const def = e.engine ?? { fuel: 'methalox', nozzle: 'vac', pump: String(e.def?.size ?? 'm').toUpperCase() };
  const pump = E?.pumps?.[def.pump], fuel = E?.fuels?.[def.fuel], nozzle = E?.nozzles?.[def.nozzle];
  if (!pump) return 0;
  return num(pump.mass) + (num(fuel?.chamberMass) + num(nozzle?.mass)) * num(pump.chamberScale, 1);
}

// ---------------------------------------------------------------- chutes --------------------------------------------
function chuteTraits(layout, optionsOf, data, materials) {
  const parts = layout.filter((e) => num(e.def?.flags?.chuteCdA) > 0);
  if (!parts.length) return null;
  const canopies = parts.map((e, i) => {
    const opts = optionsOf(e);
    const type = opts.canopy?.id ?? 'dgb';
    const d = data.chutes?.[e.type] ?? {};
    const c = data.canopyTypes?.[type] ?? data.canopyTypes?.dgb ?? {};
    return {
      partId: e.id, type: e.type, name: e.def?.name ?? e.type, canopy: type, canopyName: opts.canopy?.name ?? type,
      cdA: round(num(e.def.flags.chuteCdA) * product(opts, 'chuteF'), 1), maxMach: num(c.maxMach, 2.2),
      count: Math.max(1, num(d.count, 1)), reserve: num(d.reserve, 0), reliability: round(reliabilityOf(e, opts, materials), 5), order: i,
    };
  });
  // the computer fires the canopy that stands the highest Mach first (the drogue), the others as the ship slows
  canopies.sort((a, b) => b.maxMach - a.maxMach || a.order - b.order);
  const byPart = Object.fromEntries(canopies.map((c) => [c.partId, { maxMach: c.maxMach, cdA: c.cdA }]));
  return {
    canopies, byPart, cdA: round(canopies.reduce((t, c) => t + c.cdA, 0), 1),
    soundSpeedMps: num(data.mars?.soundSpeedMps, 232), floorM: num(data.chuteFloorM, 300),
  };
}

// ---------------------------------------------------------------- power ---------------------------------------------
/**
 * The ship's power on Mars (real units): generationW (sol average: solar after distance, air, night and the landing
 * plume's dust, plus the RTG), stores (battery Wh, fuel-cell reactant Wh) and how fast they give it back.
 */
function powerTraits(layout, optionsOf, data) {
  const P = data.power ?? {};
  const mars = data.mars ?? {};
  const sources = [];
  let solarRatedW = 0, rtgW = 0, fuelCellW = 0, fuelCellWh = 0, batteryWh = 0, batteryMaxW = 0;
  const airbags = layout.some((e) => data.legs?.[e.type]?.kind === 'airbags');
  for (const e of layout) {
    const rated = num(e.def?.flags?.power);
    if (!(rated > 0)) continue;
    const opts = optionsOf(e);
    let kind = P.kinds?.[e.type] ?? null;
    if (!kind && e.def?.internals === 'service_module') kind = P.serviceModule?.[opts.power?.id] ?? 'solar';
    if (!kind || kind === 'cabin') continue; // a capsule's own power runs the cabin, not the rovers
    const W = rated * product(opts, 'powerF');
    const row = { partId: e.id, kind, ratedW: Math.round(W) };
    if (kind === 'solar') { solarRatedW += W; row.marsW = null; }
    else if (kind === 'rtg') { rtgW += num(P.rtgMarsW, 107); row.marsW = num(P.rtgMarsW, 107); }
    else if (kind === 'fuelCell') { fuelCellW += W; const wh = W * num(P.fuelCellReactantHours, 44); fuelCellWh += wh; row.wh = Math.round(wh); }
    else if (kind === 'battery') {
      const wh = num(P.batteryWhPerKg, 150) * num(e.def?.mass);
      batteryWh += wh; batteryMaxW += wh * num(P.batteryMaxC, 0.5); row.wh = Math.round(wh);
    } else if (kind === 'spentBattery') row.wh = 0; // silver-zinc batteries charged on the ground ran the ship on the way
    sources.push(row);
  }
  // (no power parts at all is still a power system: nothing to spare, so the rovers get nothing back on Mars)
  const dust = airbags ? 0 : num(P.plumeDust, 0.05); // a rocket landing blows dust on the ship's own panels
  const solarMarsW = solarRatedW * num(mars.sunShare, 0.431) * num(mars.surfaceSolFactor, 0.174) * (1 - dust);
  for (const r of sources) if (r.kind === 'solar') r.marsW = Math.round(solarRatedW > 0 ? (r.ratedW / solarRatedW) * solarMarsW : 0);
  const generationW = solarMarsW + rtgW;
  return {
    solarRatedW: Math.round(solarRatedW), solarMarsW: Math.round(solarMarsW), rtgW: Math.round(rtgW),
    fuelCellW: Math.round(fuelCellW), fuelCellWh: Math.round(fuelCellWh), batteryWh: Math.round(batteryWh), batteryMaxW: Math.round(batteryMaxW),
    generationW: Math.round(generationW), storeWh: Math.round(batteryWh + fuelCellWh),
    plumeDust: dust, dustPerSol: num(mars.dustPerSol, 0.0028), solLengthS: num(mars.solLengthS, 88775),
    // the rovers ride in the ship for 8.5 months: kept topped up by anything that makes power, else they lose some
    arrivalFrac: generationW > 0 ? 1 : round(1 - num(P.cruiseSelfDischarge, 0.16), 3),
    cableReachM: num(P.cableReachM, 15), surfaceTime: num(data.gameScale?.surfaceTime, 87),
    rovers: Object.fromEntries(Object.entries(data.rovers ?? {}).map(([k, v]) => [k, { chargeW: num(v.chargeW) }])),
    sources,
  };
}

// ---------------------------------------------------------------- comms ---------------------------------------------
function commsTraits(layout, optionsOf, data, materials) {
  const W = data.linkWindow ?? {};
  const U = data.upload ?? {};
  const logBits = num(U.logMB, 5) * 8e6;
  const antennas = layout.filter((e) => e.def?.flags?.antenna).map((e) => {
    const d = data.antennas?.[e.type] ?? { kind: e.def.flags.relay ? 'relay' : e.def.flags.highGain ? 'high' : 'low', rateBps: e.def.flags.relay ? 1e6 : e.def.flags.highGain ? 5e5 : 20 };
    // the wait for the link: a direct antenna for Earth to be up, the relay smallsat for its next pass (expected values)
    const windowS = d.kind === 'relay' ? num(W.relayS, 3600) : num(W.directS, 11100);
    const rateBps = num(d.rateBps);
    return { partId: e.id, type: e.type, name: e.def?.name ?? e.type, kind: d.kind, rateBps, windowS, realSPerLog: rateBps > 0 ? Math.round(windowS + logBits / rateBps) : null, reliability: round(reliabilityOf(e, optionsOf(e), materials), 5) };
  });
  // the antenna that gets the logs off the ship soonest (the relay's wait is the shortest; the omni's rate the slowest)
  const best = antennas.filter((a) => a.rateBps > 0).reduce((b, a) => (!b || a.realSPerLog < b.realSPerLog ? a : b), null);
  return {
    antennas, bestPartId: best?.partId ?? null, rateBps: best?.rateBps ?? 0, realSPerLog: best?.realSPerLog ?? null, relay: antennas.some((a) => a.kind === 'relay'),
    upload: { logMB: num(U.logMB, 5), minS: num(U.minS, 3), baseS: num(U.baseS, 60), perDecadeS: num(U.perDecadeS, 6), maxS: num(U.maxS, 60) },
  };
}

/**
 * Seconds the game waits for an upload that takes realSeconds in reality (landing.json gameScale.upload): 3 s for
 * anything under a minute, plus 6 s for every ten times longer, at most 60 s. u = traits.landing.comms.upload.
 */
export function uploadWaitSeconds(realSeconds, u = {}) {
  const minS = num(u.minS, 3), baseS = num(u.baseS, 60), per = num(u.perDecadeS, 6), maxS = num(u.maxS, 60);
  if (!(realSeconds > 0)) return minS;
  return Math.min(maxS, minS + per * Math.log10(Math.max(1, realSeconds / baseS)));
}
