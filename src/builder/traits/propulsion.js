// Flight traits, propulsion: engines and the launch pad: how deep each engine throttles, how many times it can light, how fast and far it steers, how it may fail in flight (an engine-out a cluster survives), how hard the pad lets the ship leave.
// Pure (Node-testable, no browser or core imports). Owner: the wave-5 propulsion agent (see src/builder/CLAUDE.md §8).
// Real numbers live in propulsion.json next to this file (per part id and per kit option id), never in the section folders;
// they arrive as `data` (catalogData.js imports the JSON for the game, the tests read it), so this file stays pure.
// Returns plain JSON (no Infinity: use null for "unlimited"), so it survives save() and the flight scenes.
//
// The physics, in short (every number and its source is in propulsion.json):
//  - Throttle floor of one engine = the most limiting of its cycle (turbomachinery) and its injector (a fixed-area
//    injector chugs below about half flow; a pintle throttles deep), unless a measured pair says otherwise. Ship floor = the lowest share of the full thrust
//    the ship can make: all engines at their floor, or, on an engine-out structure that can shut engines down, one
//    engine at its floor (Falcon 9 lands on its centre engine). Solid motors are merged into the one stage the flight
//    flies, so the floor counts the liquid engines only (game scaling, stated).
//  - Starts: the igniter's (spark: no limit; TEA-TEB: the pad start plus the slugs carried; pyrotechnic and ampoule:
//    one); a pressure-fed engine burns hypergolic propellants in reality, so it relights without limit.
//  - In-flight failure: each engine fails in flight with inFlightShare × (1 − reliability) over the rated burn time
//    (the factory share was rolled at confirm by asBuilt.js); a share of those failures is uncontained.
//  - Steering authority of the devices on each engine, relative to a standard hydraulic gimbal.
//  - The pad: held throttle and the height of the tower it must clear (sections/pad/effects.js computes the throttle).

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fin = (x) => Number.isFinite(x);
const sum = (xs, f) => xs.reduce((t, x, i) => t + f(x, i), 0);
const round = (x, d = 4) => (fin(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
/** Same cap as stats.js: a part that can fail keeps at least 1 failure in 2,000 flights. */
const MAX_PART_RELIABILITY = 0.9995;

/** The material of a layout entry (data/materials.json), its own or the part's default. */
function materialOf(e, materials) {
  const fam = materials?.families?.[e.def?.materialFamily];
  if (!fam) return null;
  return fam.options.find((o) => o.id === e.material) ?? fam.options.find((o) => o.id === e.def.defaultMaterial) ?? fam.options[0];
}
/** A part's reliability with its material and options, as stats.js rates it. */
function reliabilityOf(e, opts, materials) {
  const base = e.def?.reliability ?? 1;
  const r = base + (materialOf(e, materials)?.reliability ?? 0) + sum(Object.values(opts ?? {}), (o) => o?.rel ?? 0);
  return Math.min(base >= 1 ? 1 : MAX_PART_RELIABILITY, Math.max(0.01, r));
}
/** Steering authority of one device: side force share × rate factor (2 · rate / (rate + 10 °/s)). */
const authority = (d) => (d ? (d.side ?? 0) * (fin(d.rateDegS) && d.rateDegS > 0 ? (2 * d.rateDegS) / (d.rateDegS + 10) : 0) : 0);

/**
 * propulsionTraits(layout, ctx, data) → this group's traits for ShipSpec.stats.traits.propulsion.
 * layout: assembly.layout() entries; ctx: { catalog, engines, materials, hull, padFx, stats, g0, optionsOf(entry) };
 * data: the parsed propulsion.json. Without data or engines it returns the neutral values (the flight as before).
 * → {
 *   minThrottle (ship floor, share of full thrust), throttleDepth (1 − minThrottle), ignitions (starts, null = no limit),
 *   engines: [{ partId, name, count, thrustShare, floor, shipFloor, cycle, injector, igniter, starts, restartFail,
 *               reliability, inFlightFail, catastrophic, engineOut, pairOut, canShutDown, hypergolic }],
 *   boosters: [{ partId, name, liquid, thrustShare, burnTime, inFlightFail, catastrophic, nozzle }],
 *   burnRefS (rated burn time, s), settle (RCS or an ullage module), inFlightShare,
 *   steering: { tvc, verniers, solids: { share, k }, vanes: { k, loss, lifeS } | null, rcs, rcsMassFloor, refTwr, min, max, base,
 *               devices } (authorities relative to a standard hydraulic gimbal),
 *   pad: { heldThrottle, heatLimitKN, thrustKN, excess, clearM, stackM, maxHoldS, minHeldTwr, holdS, debrisAfterS },
 *   restart: { spaceUnsettled }, deadDriftS
 * }
 */
export function propulsionTraits(layout, ctx = {}, data) {
  const neutral = { ...(data?.neutral ?? {}) };
  if (!data?.cycle || !Array.isArray(layout)) return neutral;
  const optionsOf = (e) => ctx.optionsOf?.(e) ?? {};
  const pumps = ctx.engines?.pumps ?? {};
  const byId = new Map(layout.map((e) => [e.id, e]));
  const engineEntries = layout.filter((e) => e.def?.engine);
  const boosterEntries = layout.filter((e) => e.def?.booster);
  if (!engineEntries.length && !boosterEntries.length) return neutral;

  // thrust of each entry (vacuum, N): the pump's thrust × the options' thrust factors (stats.js engineStats), × the cluster
  const thrustF = (opts) => Object.values(opts ?? {}).reduce((t, o) => t * (o?.thrustF ?? 1), 1);
  const countOf = (e) => e.cluster?.count ?? 1;
  const engines = engineEntries.map((e) => {
    const opts = optionsOf(e);
    const pump = e.engine?.pump ?? String(e.def.size ?? 'M').toUpperCase();
    const unit = (pumps[pump]?.thrust ?? 0) * thrustF(opts);
    return { e, opts, unit, thrust: unit * countOf(e) };
  });
  const boosters = boosterEntries.map((e) => {
    const opts = optionsOf(e);
    return { e, opts, thrust: (e.def.booster.thrust ?? 0) * thrustF(opts) };
  });
  const liquidThrust = sum(engines, (x) => x.thrust);
  const total = liquidThrust + sum(boosters, (x) => x.thrust);

  // ---------- each liquid engine (one entry = one type, a cluster of count) ----------
  const inFlightShare = fin(data.inFlightShare) ? data.inFlightShare : 0.4;
  const engineTraits = engines.map(({ e, opts, unit, thrust }) => {
    const count = countOf(e);
    const cyc = data.cycle[opts.cycle?.id] ?? data.cycle.gg ?? {};
    const inj = data.injector?.[opts.injector?.id] ?? data.injector?.coaxial ?? {};
    const ign = data.igniter?.[opts.igniter?.id] ?? data.igniter?.spark ?? {};
    const hypergolic = !!cyc.hypergolic;
    // a measured cycle + injector pair overrides the rule (the RL10A-5 of the DC-X: expander + coaxial at 30 %)
    const pair = data.pairs?.[`${opts.cycle?.id}+${opts.injector?.id}`];
    const floor = clamp(fin(pair?.floor) ? pair.floor : Math.max(cyc.floor ?? 0, inj.floor ?? 0), 0, 1);
    const host = byId.get(e.parentId);
    const engineOut = count > 1 && !!host?.def?.flags?.engineOut;
    const hostOpts = host?.def?.internals ? optionsOf(host) : {};
    // an engine-out structure contains a failure by its base heat shield, and prevalves cut the burning engine's feed
    const C = data.containment ?? {};
    const contain = engineOut ? clamp((C.baseShield?.[hostOpts.baseShield?.id] ?? 1) * (hostOpts.feed?.id === 'prevalves' ? C.prevalves ?? 1 : 1), 0, 1) : 1;
    const reliability = reliabilityOf(e, opts, ctx.materials);
    return {
      partId: e.id, name: e.def.name ?? e.type, count,
      thrustShare: round(total > 0 ? thrust / total : 0),
      unitShare: round(total > 0 ? unit / total : 0),
      floor,
      // an engine-out structure can shut engines down and fly on one: the ship goes as low as one engine at its floor
      shipFloor: round(engineOut ? floor / count : floor),
      cycle: opts.cycle?.id ?? null, injector: opts.injector?.id ?? null, igniter: hypergolic ? 'hypergolic' : opts.igniter?.id ?? null,
      starts: hypergolic ? null : (fin(ign.starts) ? ign.starts : null),
      restartFail: round((hypergolic ? data.hypergolicRestartFail ?? 0.05 : ign.restartFail ?? 0.3) * (1 - reliability), 6),
      reliability: round(reliability, 5),
      inFlightFail: round(inFlightShare * (1 - reliability), 6),
      catastrophic: round(clamp((cyc.catastrophic ?? 0.2) * contain, 0, 1)),
      engineOut,
      // without engine-out the failed engine's opposite is shut down too; the N1 ring steering by throttle does the same
      pairOut: count > 1 && (!engineOut || hostOpts.steer?.id === 'throttle'),
      canShutDown: engineOut,
    };
  });

  // ---------- strap-on boosters (solid motors, and liquid boosters such as the Soyuz's: ids not starting srb_) ----------
  const solidCat = data.solid?.catastrophic ?? 0.9;
  const liquidCat = data.solid?.liquidCatastrophic ?? 0.25;
  const boosterTraits = boosters.map(({ e, opts, thrust }) => {
    const r = reliabilityOf(e, opts, ctx.materials);
    const liquid = !/^srb/.test(e.type);
    return {
      partId: e.id, name: e.def.name ?? e.type, liquid,
      thrustShare: round(total > 0 ? thrust / total : 0),
      burnTime: e.def.booster.burnTime ?? null,
      reliability: round(r, 5),
      inFlightFail: round(inFlightShare * (1 - r), 6),
      catastrophic: liquid ? liquidCat : solidCat,
      nozzle: opts.nozzle?.id ?? null,
    };
  });

  // ---------- the ship: throttle floor and starts ----------
  // floor thrust of each type: every engine at its floor, or (engine-out) one of them; the ship's floor is the lowest
  // the computer can reach with every type that has to keep running (a type that can shut down to one engine sets it)
  let minThrottle = 0;
  if (liquidThrust > 0) {
    const floors = engineTraits.map((t, i) => engines[i].thrust * (t.canShutDown ? t.floor / t.count : t.floor));
    minThrottle = clamp(sum(floors, (f) => f) / liquidThrust, 0, 1);
  }
  const startsAll = engineTraits.map((t) => t.starts).filter((s) => fin(s));
  const ignitions = startsAll.length ? Math.min(...startsAll) : null;

  // ---------- steering ----------
  const S = data.steering ?? {};
  const refK = authority({ side: S.refSide ?? 0.122, rateDegS: S.refRateDegS ?? 12 }) || 1;
  const devicesOf = (eng) => layout.filter((x) => x.parentId === eng.id && x.def?.flags?.gimbal);
  let tvc = 0, vern = 0, vane = 0, vaneLoss = 0, vaneLife = null;
  const devices = [];
  engines.forEach(({ e, thrust }) => {
    const share = liquidThrust > 0 ? thrust / liquidThrust : 0;
    const host = byId.get(e.parentId);
    const ringSteer = host?.def?.internals ? optionsOf(host).steer?.id : null;
    const own = devicesOf(e);
    let kG = 0, kV = 0, kJ = 0;
    for (const d of own) {
      const spec = S[d.type];
      if (!spec) continue;
      devices.push({ partId: d.id, type: d.type });
      // verniers run at their own thrust; jet vanes erode and cost thrust; gimbals swing the whole engine
      if (spec.independent) kV = Math.max(kV, authority(spec));
      else if (fin(spec.thrustLoss)) { kJ = Math.max(kJ, authority(spec)); vaneLoss = Math.max(vaneLoss, spec.thrustLoss * share); vaneLife = spec.lifeS ?? vaneLife; }
      else kG = Math.max(kG, authority(spec));
    }
    // the N1 ring steers by throttling opposite engines (weak, slow) unless its outer engines gimbal
    if (ringSteer === 'throttle') kG = Math.max(kG, authority(S.ringThrottle));
    if (ringSteer === 'gimbals') kG = Math.max(kG, authority(S.gimbal_ring));
    tvc += kG * share;
    vern += kV * share;
    vane += kJ * share;
  });
  // solids steer too while they burn (flexible nozzles, liquid injection); a fixed nozzle does not
  const solidShare = total > 0 ? sum(boosters, (x) => x.thrust) / total : 0;
  const solidK = boosters.length ? sum(boosters, ({ thrust, opts }) => authority(S.solidNozzle?.[opts.nozzle?.id] ?? { side: 0 }) * thrust) / Math.max(1, sum(boosters, (x) => x.thrust)) : 0;
  // RCS: thrust class of every RCS source, relative to a Draco-class hypergolic pack
  const R = data.rcs ?? {};
  let rcs = 0;
  for (const x of layout) {
    if (!x.def?.flags?.rcs) continue;
    const kind = R.parts?.[x.type];
    if (kind === 'kit') rcs += R.propellant?.[optionsOf(x).propellant?.id ?? 'hypergolic'] ?? 1;
    else if (typeof kind === 'string') rcs += R.propellant?.[kind] ?? 1;
    else if (fin(kind)) rcs += kind;
    else rcs += R.serviceModule ?? 1;
  }
  rcs = Math.min(R.cap ?? 1.5, rcs);
  const settle = rcs > 0 || layout.some((x) => x.def?.flags?.bonusGroup === 'settling');

  // ---------- rated burn time: the ship's propellant at full thrust ----------
  const st = ctx.stats ?? {};
  const g0 = ctx.g0;
  const burnRefS = fin(g0) && st.thrust > 0 && st.fuelMass > 0 && st.ispVac > 0 ? (st.fuelMass * st.ispVac * g0) / st.thrust : null;

  // ---------- the pad ----------
  const fx = ctx.padFx ?? {};
  const P = data.pad ?? {};
  const stackM = layout.reduce((top, e) => (e.attach === 'axial' ? Math.max(top, (e.y ?? 0) + (e.height ?? 0)) : top), 0);
  const heatLimitKN = fin(fx.heatLimitKN) ? fx.heatLimitKN : null;
  const pad = {
    heldThrottle: round(fin(fx.throttle) ? clamp(fx.throttle, 0, 1) : 1),
    heatLimitKN: round(heatLimitKN, 1),
    // the push on the pad: the sea-level thrust (stats: vacuum thrust × ispSL / ispVac, as stats.js sums it)
    thrustKN: round(st.thrust > 0 && st.ispVac > 0 ? (st.thrust * (st.ispSL ?? st.ispVac)) / st.ispVac / 1000 : null, 1),
    excess: round(fx.excess ?? 0),
    stackM: round(stackM, 2),
    clearM: round(stackM * (P.clearFactor ?? 1.2), 2),
    maxHoldS: P.maxHoldS ?? 20,
    minHeldTwr: P.minHeldTwr ?? 1.02,
    holdS: fx.holdS ?? null,
    debrisAfterS: P.debrisAfterS ?? 1,
  };

  return {
    ...neutral,
    minThrottle: round(minThrottle),
    throttleDepth: round(1 - minThrottle),
    ignitions,
    engines: engineTraits,
    boosters: boosterTraits,
    burnRefS: round(burnRefS, 1),
    inFlightShare,
    settle,
    steering: {
      tvc: round(tvc / refK), verniers: round(vern / refK),
      solids: { share: round(solidShare), k: round(solidK / refK) },
      vanes: vaneLoss > 0 ? { k: round(vane / refK), loss: round(vaneLoss), lifeS: vaneLife } : null,
      rcs: round(rcs), rcsMassFloor: R.massFloor ?? 0.25,
      refTwr: S.refTwr ?? 1.4, min: S.min ?? 0.15, max: S.max ?? 1.6, base: S.base ?? 0.8,
      devices,
    },
    pad,
    restart: { spaceUnsettled: data.spaceUnsettled ?? 3 },
    deadDriftS: data.deadDriftS ?? 5,
  };
}
