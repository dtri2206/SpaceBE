// ShipSpec from an Assembly (contract.js SHIP_SPEC_SHAPE). Pure JS: planets and g0 are passed in, never written here.
import { computeHull } from './hull.js';
import { weatherFor } from './weather.js';
import { padEffects } from './sections/pad/effects.js';
import { partRadius } from './assembly.js';
import { flightTraits, flatTraits } from './traits/index.js';

export const TWR_MIN = 1.2;
export const RELIABILITY_MIN = 0.8;
export const COLD_TEMP_C = 5;
/** With active steering the centre of pressure may sit up to this share of the stack height ahead of the centre of mass. */
export const STEERING_MARGIN = 0.06;
/**
 * Series production (Wright's law, decided with the user): each doubling of the number of identical engines built for
 * one ship cuts the cost of the next one to this share. Aerospace learning rates run about 0.80–0.90 (T. P. Wright 1936,
 * aircraft; NASA cost estimating uses 0.85–0.95); 0.85 here. A cluster of n engines costs one engine × seriesFactor(n).
 */
export const LEARNING_RATE = 0.85;
/** Cost of n identical units relative to one: sum of i^log2(LEARNING_RATE) for i = 1..n (1 for one, about 19 for 33). */
export function seriesFactor(n) {
  const b = Math.log2(LEARNING_RATE);
  let t = 0;
  for (let i = 1; i <= Math.max(1, Math.round(n)); i++) t += Math.pow(i, b);
  return t;
}
const BONUS_CAP = 0.06; // the most the "good engineering" flags (avionics, wiring tunnel, spheres…) may add to reliability

/** Mass, cost, thrust and Isp of one engine definition { fuel, nozzle, pump } from data/engines.json. */
export function engineStats(def, engines, g0, mods = null) {
  const fuel = engines.fuels[def.fuel] ?? engines.fuels.methalox;
  const nozzle = engines.nozzles[def.nozzle] ?? engines.nozzles.vac;
  const pump = engines.pumps[def.pump] ?? engines.pumps.M;
  const [baseSL, baseVac] = fuel.isp[def.nozzle in engines.nozzles ? def.nozzle : 'vac'];
  const m = mods ?? NO_MODS;
  const ispSL = Math.max(1, baseSL + m.isp);
  const ispVac = Math.max(ispSL, baseVac + m.isp);
  const thrust = pump.thrust * m.thrustF;
  const veSL = ispSL * g0;
  const veVac = ispVac * g0;
  return {
    fuel: def.fuel, nozzle: def.nozzle, pump: def.pump,
    thrust, // N in vacuum
    thrustSL: thrust * (ispSL / ispVac), // N at sea level (same mass flow, lower exhaust speed)
    // the chamber and nozzle scale with the pump (pump.chamberScale, 1 for the large pump)
    mass: (pump.mass + (fuel.chamberMass + nozzle.mass) * (pump.chamberScale ?? 1) + m.massD) * m.massF,
    cost: (pump.cost + (fuel.chamberCost + nozzle.cost) * (pump.chamberScale ?? 1) + m.costD) * m.costF,
    ispSL, ispVac, veSL, veVac,
    mdotVac: thrust / veVac, // kg/s
    mdotSL: thrust / veVac, // the pump moves the same mass; the sea-level thrust is what drops
    heatRate: pump.heatRate,
    special: fuel.special ?? '',
  };
}

const NO_MODS = Object.freeze({ massF: 1, massD: 0, costF: 1, costD: 0, rel: 0, isp: 0, thrustF: 1, powerF: 1, chuteF: 1 });

/** Combined effect of a part's chosen internal options (sections/<id>/internals.json): factors multiply, deltas add. */
export function optionMods(options) {
  const m = { ...NO_MODS };
  for (const o of Object.values(options ?? {})) {
    if (!o) continue;
    m.massF *= o.massF ?? 1;
    m.massD += o.massD ?? 0;
    m.costF *= o.costF ?? 1;
    m.costD += o.costD ?? 0;
    m.rel += o.rel ?? 0;
    m.isp += o.isp ?? 0;
    m.thrustF *= o.thrustF ?? 1;
    m.powerF *= o.powerF ?? 1;
    m.chuteF *= o.chuteF ?? 1;
  }
  return m;
}

const sum = (xs, f) => xs.reduce((acc, x, i) => acc + f(x, i), 0);

/**
 * A part that can fail stays imperfect: however good its options and material, it keeps at least 1 failure in 2,000
 * flights, so the luck rule (a manufacturing defect with chance 1 − reliability) still applies and no card reads 100 %.
 * A passive part with no failure mode of its own (base reliability 1 or none) may stay at 1.
 */
export const MAX_PART_RELIABILITY = 0.9995;
const capRel = (r, base) => Math.min((base ?? 1) >= 1 ? 1 : MAX_PART_RELIABILITY, Math.max(0.01, r));

/**
 * computeShipSpec(assembly, { catalog, engines, launch, balance, planets, g0, materials, pad, traitsData })
 * → { spec, breakdown, blocks } where blocks are the hard blocks that need no money check (OVER_BUDGET is added by gonogo.js).
 * Solid motors (def.booster) add their thrust and propellant to the single stage the flight model flies; their casings
 * ride along as dry mass. Internal options (sections/<id>/internals.json) modify mass, cost, reliability, Isp, thrust and power.
 */
export function computeShipSpec(assembly, { catalog, engines, launch, balance, planets, g0, materials = null, pad = null, traitsData = null }) {
  const layout = assembly.layout();
  // launch-day weather (weather.js) and the outer skin (hull.js); the pad's effects follow once the thrust is known
  const weather = weatherFor(assembly.launch, { pad, launchData: launch });
  const slot = weather.slot ?? { id: 'mild', tempC: weather.tempC, fee: 0 };
  const site = weather.site ?? null;
  const hull = computeHull(layout, { catalog, hull: assembly.hull });
  const flags = (e) => e.def.flags ?? {};
  // material of a part: factors on dry mass, cost and reliability (data/materials.json); the first option is the default
  const materialOf = (e) => {
    const fam = materials?.families?.[e.def.materialFamily];
    if (!fam) return null;
    return fam.options.find((o) => o.id === e.material) ?? fam.options.find((o) => o.id === e.def.defaultMaterial) ?? fam.options[0];
  };
  const massFactor = (e) => materialOf(e)?.mass ?? 1;
  const costFactor = (e) => materialOf(e)?.cost ?? 1;
  const reliabilityDelta = (e) => materialOf(e)?.reliability ?? 0;
  const shipFuel = layout.find((e) => e.engine?.fuel)?.engine.fuel ?? null; // options that need a propellant follow the engines'
  const modsOf = (e) => (e.def.internals && catalog.optionsOf ? optionMods(catalog.optionsOf(e.def, e.options, e.engine?.fuel ?? shipFuel)) : NO_MODS);
  const mods = new Map(layout.map((e) => [e.id, modsOf(e)]));
  const mod = (e) => mods.get(e.id) ?? NO_MODS;

  // Liquid engines
  const engineDefOf = (e) => e.engine ?? { fuel: 'methalox', nozzle: 'vac', pump: String(e.def.size).toUpperCase() };
  const engineEntries = layout.filter((e) => e.def.engine);
  const countOf = (e) => e.cluster?.count ?? 1; // engines in a cluster (the thrust structure above sets it)
  const engineSpecs = engineEntries.map((e) => engineStats(engineDefOf(e), engines, g0, mod(e)));
  const engineCount = sum(engineEntries, countOf);
  // Solid motors: fixed thrust and Isp, their own propellant, a casing that stays
  const boosterEntries = layout.filter((e) => e.def.booster);
  const boosterSpecs = boosterEntries.map((e) => {
    const b = e.def.booster, m = mod(e);
    const ispSL = Math.max(1, b.ispSL + m.isp), ispVac = Math.max(ispSL, b.ispVac + m.isp);
    const thrust = b.thrust * m.thrustF;
    return { id: e.id, thrust, thrustSL: thrust * (ispSL / ispVac), ispSL, ispVac, propellant: b.propellant, burnTime: b.burnTime ?? 0 };
  });
  const n = (i) => countOf(engineEntries[i]);
  const thrust = sum(engineSpecs, (s, i) => s.thrust * n(i)) + sum(boosterSpecs, (s) => s.thrust);
  const thrustSL = sum(engineSpecs, (s, i) => s.thrustSL * n(i)) + sum(boosterSpecs, (s) => s.thrustSL);
  const ispVac = thrust > 0 ? (sum(engineSpecs, (s, i) => s.ispVac * s.thrust * n(i)) + sum(boosterSpecs, (s) => s.ispVac * s.thrust)) / thrust : 0;
  const ispSL = thrust > 0 ? (sum(engineSpecs, (s, i) => s.ispSL * s.thrust * n(i)) + sum(boosterSpecs, (s) => s.ispSL * s.thrust)) / thrust : 0;
  const mainFuel = engineSpecs[0]?.fuel ?? null;

  // Masses (engine hardware mass and cost scale with the chamber material; options add on top)
  const dryOf = (e) => (e.def.mass * massFactor(e) + mod(e).massD) * mod(e).massF;
  const engineHardwareMass = (e, i) => engineSpecs[i].mass * massFactor(e) * countOf(e);
  const partMass = sum(layout, dryOf) + sum(engineEntries, engineHardwareMass) + (hull.mass ?? 0);
  const usableFuel = sum(layout, (e) => (e.def.fuel && e.def.fuel.type === mainFuel ? e.def.fuel.mass : 0)) + sum(boosterSpecs, (s) => s.propellant);
  const deadFuel = sum(layout, (e) => (e.def.fuel && e.def.fuel.type !== mainFuel ? e.def.fuel.mass : 0));
  const dryMass = partMass + deadFuel; // fuel the engine can't burn is just weight
  // an over-strong ship on a weak pad throttles back for the first seconds: that propellant is spent on the pad
  const fullWet = dryMass + usableFuel;
  // the pad (sections/pad/effects.js) compares its heat limit with the thrust on it and knows the ship's weight
  const padFx = padEffects(assembly.launch, { pad, weather, thrustSL, engineCount, g: planets.earth.g, wetMass: fullWet });
  const padChoices = padFx.choices ?? [];
  const launchFee = padFx.fee ?? 0;
  const padReliability = padFx.reliability ?? 0;
  // the flight holds the thrust back itself on a pad that cannot take full thrust (src/flight/effects/propulsion.js,
  // traits.propulsion), so no propellant is taken here; padFx.liftoffLossMps stays as the estimate the words use
  const liftoffBurn = 0;
  const fuelMass = usableFuel - liftoffBurn;
  const wetMass = dryMass + fuelMass;
  // identical strap-on boosters are a production series too (seriesFactor): n of them cost n × seriesFactor(n) / n each
  const boosterCount = {};
  for (const e of boosterEntries) boosterCount[e.type] = (boosterCount[e.type] ?? 0) + 1;
  const seriesShare = (e) => (e.def.booster && boosterCount[e.type] > 1 ? seriesFactor(boosterCount[e.type]) / boosterCount[e.type] : 1);
  const cost = sum(layout, (e) => (e.def.cost * costFactor(e) + mod(e).costD) * mod(e).costF * seriesShare(e)) + sum(engineEntries, (e, i) => engineSpecs[i].cost * costFactor(e) * seriesFactor(countOf(e))) + (hull.cost ?? 0);

  // Performance (one stage: the flight model burns everything with the thrust-weighted Isp)
  const deltaV = fuelMass > 0 && dryMass > 0 ? ispVac * g0 * Math.log(wetMass / dryMass) : 0;
  const twrEarth = wetMass > 0 ? thrustSL / (wetMass * planets.earth.g) : 0;
  const twrMars = wetMass > 0 ? thrust / (wetMass * planets.mars.g) : 0;

  // Centre of mass and pressure (metres from the stack base)
  // Full mass of one part: structure + any propellant inside (usable or not) + the engine hardware.
  const massOf = (e) => dryOf(e) + (e.def.fuel?.mass ?? 0) + (e.def.booster?.propellant ?? 0) + (e.def.engine ? engineStats(engineDefOf(e), engines, g0, mod(e)).mass * massFactor(e) * countOf(e) : 0);
  const skin = hull.segments ?? [];
  const totalMass = sum(layout, massOf) + sum(skin, (g) => g.mass ?? 0);
  const comY = totalMass > 0 ? (sum(layout, (e) => massOf(e) * e.centerY) + sum(skin, (g) => (g.mass ?? 0) * (g.centerY ?? 0))) / totalMass : 0;
  // equipment riding inside the skin (hull.insideIds) is out of the airflow
  const inside = new Set(hull.insideIds ?? []);
  const areaOf = (e) => (inside.has(e.id) ? 0 : e.def.aero.sideArea);
  const totalArea = sum(layout, areaOf) + sum(skin, (g) => g.sideArea ?? 0);
  const copY = totalArea > 0 ? (sum(layout, (e) => areaOf(e) * e.centerY) + sum(skin, (g) => (g.sideArea ?? 0) * (g.centerY ?? 0))) / totalArea : comY;
  const stackHeight = layout.reduce((top, e) => (e.attach === 'axial' ? Math.max(top, e.y + e.height) : top), 0);
  const comOffset = comY - stackHeight / 2;
  const copOffset = copY - stackHeight / 2;

  // Flags
  const has = (key) => layout.some((e) => flags(e)[key]);
  const count = (key) => sum(layout, (e) => Number(flags(e)[key]) || 0);
  // A cluster of n engines: with engine-out capability (the thrust structure's flag) the ship survives one failure,
  // so n engines count as about 1 + 0.2 (n - 1) single engines; without it every engine must work (r^n).
  const partReliability = (e) => {
    const r = capRel((e.def.reliability ?? 1) + reliabilityDelta(e) + mod(e).rel, e.def.reliability);
    const k = countOf(e);
    if (k <= 1) return r;
    const engineOut = layout.find((x) => x.id === e.parentId)?.def.flags?.engineOut;
    return Math.pow(r, engineOut ? 1 + (k - 1) * 0.2 : k);
  };
  const baseReliability = layout.reduce((r, e) => r * partReliability(e), 1);
  // reliability bonuses: parts in the same group (flags.bonusGroup, e.g. 'steering', 'abort') count once, the best of them
  const grouped = {};
  let ungrouped = 0;
  for (const e of layout) {
    const b = Number(flags(e).reliabilityBonus) || 0;
    if (!b) continue;
    const g = flags(e).bonusGroup;
    if (g) grouped[g] = Math.max(grouped[g] ?? 0, b); else ungrouped += b;
  }
  const bonusSum = ungrouped + Object.values(grouped).reduce((t, b) => t + b, 0);
  const bonus = Math.min(BONUS_CAP, bonusSum + Math.min(0.015, sum(layout, (e) => Number(flags(e).rigidity) || 0)));
  const reliability = Math.min(1, baseReliability * (1 + bonus) * (1 + padReliability));
  const hasHeatShield = has('heatShield');
  const noseCdA = layout.find((e) => e.def.aero.cdA != null)?.def.aero.cdA;
  const shieldCdA = layout.find((e) => e.def.aero.entryCdA != null)?.def.aero.entryCdA;
  const chuteCdA = sum(layout, (e) => (Number(flags(e).chuteCdA) || 0) * mod(e).chuteF);
  const power = sum(layout, (e) => (Number(flags(e).power) || 0) * mod(e).powerF);

  const stats = {
    cost, wetMass, dryMass, fuelMass, thrust, ispSL, ispVac, deltaV, twrEarth, twrMars,
    comOffset, copOffset, reliability,
    hasHeatShield, heatShieldDamaged: has('fragileShield'), hasLegs: has('legs'), hasRCS: has('rcs'),
    hasParachute: has('parachute'), hasAntenna: has('antenna'), hasShelter: has('shelter'), coldRatedSeals: !has('cheapSeals'),
    armorHits: count('armorHits'), spareO2Tanks: count('spareO2Tanks'), power: Math.round(power),
    // Extras Role 2's FlightController reads when present (not in the contract shape, harmless when ignored).
    ascentCdA: (noseCdA ?? 6) * (hull.cdAFactor ?? 1), cdA: hasHeatShield ? (shieldCdA ?? 80) : 3,
    ...(chuteCdA > 0 ? { chuteCdA } : {}),
  };
  // what each chosen part does in flight and on Mars (traits/, wave 5): stats.traits, plus the flat minThrottle and
  // ignitions FlightController already reads
  stats.traits = flightTraits(layout, { catalog, engines, materials, hull, padFx, stats, g0, optionsOf: (e) => (e.def.internals && catalog.optionsOf ? catalog.optionsOf(e.def, e.options, e.engine?.fuel ?? shipFuel) : {}), traitsData });
  Object.assign(stats, flatTraits(stats.traits));
  // the crew cabin the player chose (promised to Role 3, 2026-11-08): which capsule and how its windows, hatch, docking
  // port and seats were fitted, so the walkable interior can match the outside. Optional for readers.
  const cabinEntry = layout.find((e) => e.def.flags?.capsule);
  if (cabinEntry) {
    const opts = catalog.optionsOf ? catalog.optionsOf(cabinEntry.def, cabinEntry.options) : {};
    const life = stats.traits?.life?.cabin ?? {};
    stats.cabin = {
      type: cabinEntry.type,
      windows: opts.windows?.id ?? null, hatch: opts.hatch?.id ?? null, docking: opts.docking?.id ?? null,
      couches: opts.couches?.id ?? null, atmosphere: opts.atmosphere?.id ?? null, suits: opts.suits?.id ?? null,
      volumeM3: Number.isFinite(life.cabinM3) ? life.cabinM3 : null,
    };
  }

  const dv = balance.deltaVKmS ?? { ascent: 3.3, transfer: 2.1, landing: 0.4, return: 3.1 };
  const dvNeeded = { ascent: dv.ascent * 1000, transfer: dv.transfer * 1000, landing: dv.landing * 1000, return: dv.return * 1000 };
  const oneWay = dvNeeded.ascent + dvNeeded.transfer + dvNeeded.landing;

  const warnings = [];
  if (deltaV < oneWay) warnings.push('LOW_DV');
  if (twrEarth < TWR_MIN) warnings.push('LOW_TWR');
  if (!hasHeatShield) warnings.push('NO_HEAT_SHIELD');
  if (!stats.hasLegs) warnings.push('NO_LEGS');
  const steering = layout.some((e) => flags(e).gimbal || flags(e).steering);
  const margin = stackHeight > 0 ? (comY - copY) / stackHeight : 0; // > 0: the air pushes behind the balance point
  if (layout.length && (steering ? margin < -STEERING_MARGIN : copY >= comY)) warnings.push('UNSTABLE');
  if (stats.spareO2Tanks < 1) warnings.push('LOW_O2');
  if (!stats.hasAntenna) warnings.push('NO_ANTENNA');
  if (!stats.hasShelter) warnings.push('NO_SHELTER');
  if (!stats.coldRatedSeals && weather.tempC < COLD_TEMP_C) warnings.push('COLD_SEALS');
  if (reliability < RELIABILITY_MIN) warnings.push('LOW_RELIABILITY');

  const blocks = [];
  if (!has('capsule')) blocks.push('NO_CAPSULE');
  if (!engineEntries.length) blocks.push('NO_ENGINE');
  if (!(fuelMass > 0)) blocks.push('NO_FUEL');
  if (assembly.validate().length) blocks.push('NOT_CONNECTED');

  const spec = {
    name: assembly.name,
    parts: layout.map((e) => ({
      id: e.id, type: e.type, x: round(e.x), y: round(e.y), z: round(e.z), rotation: e.angle,
      variant: e.engine ? `${e.engine.fuel}-${e.engine.nozzle}` : e.def.fuel ? e.def.fuel.type : e.def.booster ? 'solid' : flags(e).fragileShield ? 'tiles' : flags(e).cheapSeals ? 'cheap_seals' : (materialOf(e)?.id ?? null),
    })),
    engines: engineSpecs.flatMap((s, i) => Array.from({ length: n(i) }, () => ({ fuel: s.fuel, nozzle: s.nozzle, pump: s.pump }))),
    stats,
    warnings,
    launch: { ...(padFx.launch ?? {}), tempC: weather.tempC },
  };

  const breakdown = {
    parts: layout.map((e) => ({ id: e.id, type: e.type, name: e.def.name, family: e.def.family, mass: massOf(e), dry: dryOf(e) + (e.def.engine ? engineStats(engineDefOf(e), engines, g0, mod(e)).mass * massFactor(e) * countOf(e) : 0), cost: (e.def.cost * costFactor(e) + mod(e).costD) * mod(e).costF * seriesShare(e) + (e.def.engine ? engineStats(engineDefOf(e), engines, g0, mod(e)).cost * costFactor(e) * seriesFactor(countOf(e)) : 0), fuel: (e.def.fuel?.mass ?? 0) + (e.def.booster?.propellant ?? 0), y: e.y, height: e.height, sideArea: e.def.aero.sideArea, attach: e.attach, material: materialOf(e)?.name ?? null, reliability: capRel((e.def.reliability ?? 1) + reliabilityDelta(e) + mod(e).rel, e.def.reliability) })),
    fuelPartIds: layout.filter((e) => e.def.fuel || e.def.booster).map((e) => e.id),
    enginePartIds: [...engineEntries, ...boosterEntries].map((e) => e.id),
    finPartIds: layout.filter((e) => /fin/.test(e.type)).map((e) => e.id),
    capsulePartIds: layout.filter((e) => flags(e).capsule).map((e) => e.id),
    comY, copY, stackHeight, steering, stabilityMargin: margin, dvNeeded, oneWay, roundTrip: oneWay + dvNeeded.return,
    usableFuel, deadFuel, liftoffBurn, slot, site, padChoices, launchFee, padReliability, weather, padFx, hull, engineSpecs, engineCount, boosterSpecs, mainFuel, thrustSL, baseReliability, reliabilityBonus: bonus,
    radius: layout.length ? Math.max(...layout.filter((e) => e.attach === 'axial').map((e) => partRadius(e.def))) : 1,
  };

  return { spec, breakdown, blocks };
}

/** Numbers for one catalogue part on its own (cards and the detail panel), with material and options applied. */
export function partFigures(def, { engines, g0, materials = null, catalog = null, materialId = null, options = null, engineDef = null, count = 1 }) {
  const fam = materials?.families?.[def.materialFamily];
  const mat = fam ? (fam.options.find((o) => o.id === materialId) ?? fam.options.find((o) => o.id === def.defaultMaterial) ?? fam.options[0]) : null;
  const m = def.internals && catalog?.optionsOf ? optionMods(catalog.optionsOf(def, options, engineDef?.fuel ?? null)) : NO_MODS;
  const matMass = mat?.mass ?? 1, matCost = mat?.cost ?? 1;
  let mass = (def.mass * matMass + m.massD) * m.massF;
  let cost = (def.cost * matCost + m.costD) * m.costF;
  let engine = null;
  if (def.engine) {
    engine = engineStats(engineDef ?? { fuel: 'methalox', nozzle: 'sl', pump: String(def.size).toUpperCase() }, engines, g0, m);
    engine = { ...engine, count, totalThrust: engine.thrust * count, totalThrustSL: engine.thrustSL * count };
    mass += engine.mass * matMass * count;
    cost += engine.cost * matCost * seriesFactor(count);
  }
  const booster = def.booster ? { thrust: def.booster.thrust * m.thrustF, ispSL: def.booster.ispSL + m.isp, ispVac: def.booster.ispVac + m.isp, propellant: def.booster.propellant, burnTime: def.booster.burnTime } : null;
  return {
    mass, cost, dry: mass, wet: mass + (def.fuel?.mass ?? 0) + (def.booster?.propellant ?? 0),
    reliability: capRel((def.reliability ?? 1) + (mat?.reliability ?? 0) + m.rel, def.reliability),
    power: (Number(def.flags?.power) || 0) * m.powerF, chuteCdA: (Number(def.flags?.chuteCdA) || 0) * m.chuteF,
    engine, booster, material: mat, mods: m,
  };
}

const round = (n) => Math.round(n * 100) / 100;
