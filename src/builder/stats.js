// ShipSpec from an Assembly (contract.js SHIP_SPEC_SHAPE). Pure JS: planets and g0 are passed in, never written here.
import { partRadius } from './assembly.js';

export const TWR_MIN = 1.2;
export const RELIABILITY_MIN = 0.8;
export const COLD_TEMP_C = 5;

/** Mass, cost, thrust and Isp of one engine definition { fuel, nozzle, pump } from data/engines.json. */
export function engineStats(def, engines, g0) {
  const fuel = engines.fuels[def.fuel] ?? engines.fuels.methalox;
  const nozzle = engines.nozzles[def.nozzle] ?? engines.nozzles.vac;
  const pump = engines.pumps[def.pump] ?? engines.pumps.M;
  const [ispSL, ispVac] = fuel.isp[def.nozzle in engines.nozzles ? def.nozzle : 'vac'];
  const thrust = pump.thrust;
  const veSL = ispSL * g0;
  const veVac = ispVac * g0;
  return {
    fuel: def.fuel, nozzle: def.nozzle, pump: def.pump,
    thrust, // N in vacuum
    thrustSL: thrust * (ispSL / ispVac), // N at sea level (same mass flow, lower exhaust speed)
    mass: pump.mass + fuel.chamberMass + nozzle.mass,
    cost: pump.cost + fuel.chamberCost + nozzle.cost,
    ispSL, ispVac, veSL, veVac,
    mdotVac: thrust / veVac, // kg/s
    mdotSL: thrust / veVac, // the pump moves the same mass; the sea-level thrust is what drops
    heatRate: pump.heatRate,
    special: fuel.special ?? '',
  };
}

const sum = (xs, f) => xs.reduce((acc, x, i) => acc + f(x, i), 0);

/**
 * computeShipSpec(assembly, { catalog, engines, launch, balance, planets, g0 })
 * → { spec, breakdown, blocks } where blocks are the hard blocks that need no money check (OVER_BUDGET is added by gonogo.js).
 */
export function computeShipSpec(assembly, { catalog, engines, launch, balance, planets, g0, materials = null }) {
  const layout = assembly.layout();
  const slot = (launch.slots ?? []).find((s) => s.id === assembly.launch.slot) ?? launch.slots?.[0] ?? { id: 'mild', tempC: 15, fee: 0 };
  const flags = (e) => e.def.flags ?? {};
  // material of a part: factors on dry mass, cost and reliability (data/materials.json); the first option is the default
  const materialOf = (e) => {
    const fam = materials?.families?.[e.def.materialFamily];
    if (!fam) return null;
    return fam.options.find((o) => o.id === e.material) ?? fam.options[0];
  };
  const massFactor = (e) => materialOf(e)?.mass ?? 1;
  const costFactor = (e) => materialOf(e)?.cost ?? 1;
  const reliabilityDelta = (e) => materialOf(e)?.reliability ?? 0;

  // Engines
  const engineDefOf = (e) => e.engine ?? { fuel: 'methalox', nozzle: 'vac', pump: String(e.def.size).toUpperCase() };
  const engineEntries = layout.filter((e) => e.def.engine);
  const engineSpecs = engineEntries.map((e) => engineStats(engineDefOf(e), engines, g0));
  const thrust = sum(engineSpecs, (s) => s.thrust);
  const thrustSL = sum(engineSpecs, (s) => s.thrustSL);
  const ispVac = thrust > 0 ? sum(engineSpecs, (s) => s.ispVac * s.thrust) / thrust : 0;
  const ispSL = thrust > 0 ? sum(engineSpecs, (s) => s.ispSL * s.thrust) / thrust : 0;
  const mainFuel = engineSpecs[0]?.fuel ?? null;

  // Masses (engine hardware mass and cost scale with the chamber material)
  const engineFactor = (e) => (e.def.engine ? { m: massFactor(e), c: costFactor(e) } : { m: 1, c: 1 });
  const partMass = sum(layout, (e) => e.def.mass * massFactor(e)) + sum(engineEntries, (e, i) => engineSpecs[i].mass * engineFactor(e).m);
  const usableFuel = sum(layout, (e) => (e.def.fuel && e.def.fuel.type === mainFuel ? e.def.fuel.mass : 0));
  const deadFuel = sum(layout, (e) => (e.def.fuel && e.def.fuel.type !== mainFuel ? e.def.fuel.mass : 0));
  const dryMass = partMass + deadFuel; // fuel the engine can't burn is just weight
  const fuelMass = usableFuel;
  const wetMass = dryMass + fuelMass;
  const cost = sum(layout, (e) => e.def.cost * costFactor(e)) + sum(engineEntries, (e, i) => engineSpecs[i].cost * engineFactor(e).c);

  // Performance
  const deltaV = fuelMass > 0 && dryMass > 0 ? ispVac * g0 * Math.log(wetMass / dryMass) : 0;
  const twrEarth = wetMass > 0 ? thrustSL / (wetMass * planets.earth.g) : 0;
  const twrMars = wetMass > 0 ? thrust / (wetMass * planets.mars.g) : 0;

  // Centre of mass and pressure (metres from the stack base)
  // Full mass of one part: structure + any fuel inside (usable or not) + the engine hardware.
  const massOf = (e) => e.def.mass * massFactor(e) + (e.def.fuel?.mass ?? 0) + (e.def.engine ? engineStats(engineDefOf(e), engines, g0).mass * massFactor(e) : 0);
  const totalMass = sum(layout, massOf);
  const comY = totalMass > 0 ? sum(layout, (e) => massOf(e) * e.centerY) / totalMass : 0;
  const totalArea = sum(layout, (e) => e.def.aero.sideArea);
  const copY = totalArea > 0 ? sum(layout, (e) => e.def.aero.sideArea * e.centerY) / totalArea : comY;
  const stackHeight = layout.reduce((top, e) => (e.attach === 'axial' ? Math.max(top, e.y + e.height) : top), 0);
  const comOffset = comY - stackHeight / 2;
  const copOffset = copY - stackHeight / 2;

  // Flags
  const has = (key) => layout.some((e) => flags(e)[key]);
  const count = (key) => sum(layout, (e) => Number(flags(e)[key]) || 0);
  const reliability = layout.reduce((r, e) => r * Math.min(1, (e.def.reliability ?? 1) + reliabilityDelta(e)), 1);
  const hasHeatShield = has('heatShield');
  const noseCdA = layout.find((e) => e.def.aero.cdA != null)?.def.aero.cdA;
  const shieldCdA = layout.find((e) => e.def.aero.entryCdA != null)?.def.aero.entryCdA;

  const stats = {
    cost, wetMass, dryMass, fuelMass, thrust, ispSL, ispVac, deltaV, twrEarth, twrMars,
    comOffset, copOffset, reliability,
    hasHeatShield, heatShieldDamaged: has('fragileShield'), hasLegs: has('legs'), hasRCS: has('rcs'),
    hasParachute: has('parachute'), hasAntenna: has('antenna'), hasShelter: has('shelter'), coldRatedSeals: !has('cheapSeals'),
    armorHits: count('armorHits'), spareO2Tanks: count('spareO2Tanks'), power: count('power'),
    // Extras Role 2's FlightController reads when present (not in the contract shape, harmless when ignored).
    ascentCdA: noseCdA ?? 6, cdA: hasHeatShield ? (shieldCdA ?? 80) : 3,
  };

  const dv = balance.deltaVKmS ?? { ascent: 3.3, transfer: 2.1, landing: 0.4, return: 3.1 };
  const dvNeeded = { ascent: dv.ascent * 1000, transfer: dv.transfer * 1000, landing: dv.landing * 1000, return: dv.return * 1000 };
  const oneWay = dvNeeded.ascent + dvNeeded.transfer + dvNeeded.landing;

  const warnings = [];
  if (deltaV < oneWay) warnings.push('LOW_DV');
  if (twrEarth < TWR_MIN) warnings.push('LOW_TWR');
  if (!hasHeatShield) warnings.push('NO_HEAT_SHIELD');
  if (!stats.hasLegs) warnings.push('NO_LEGS');
  if (layout.length && copY >= comY) warnings.push('UNSTABLE');
  if (stats.spareO2Tanks < 1) warnings.push('LOW_O2');
  if (!stats.hasAntenna) warnings.push('NO_ANTENNA');
  if (!stats.hasShelter) warnings.push('NO_SHELTER');
  if (!stats.coldRatedSeals && slot.tempC < COLD_TEMP_C) warnings.push('COLD_SEALS');
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
      variant: e.engine ? `${e.engine.fuel}-${e.engine.nozzle}` : e.def.fuel ? e.def.fuel.type : flags(e).fragileShield ? 'tiles' : flags(e).cheapSeals ? 'cheap_seals' : (materialOf(e)?.id ?? null),
    })),
    engines: engineSpecs.map((s) => ({ fuel: s.fuel, nozzle: s.nozzle, pump: s.pump })),
    stats,
    warnings,
    launch: { tempC: slot.tempC, slot: slot.id },
  };

  const breakdown = {
    parts: layout.map((e) => ({ id: e.id, type: e.type, name: e.def.name, family: e.def.family, mass: massOf(e), fuel: e.def.fuel?.mass ?? 0, y: e.y, height: e.height, sideArea: e.def.aero.sideArea, attach: e.attach, material: materialOf(e)?.name ?? null })),
    fuelPartIds: layout.filter((e) => e.def.fuel).map((e) => e.id),
    enginePartIds: engineEntries.map((e) => e.id),
    finPartIds: layout.filter((e) => /fin/.test(e.type)).map((e) => e.id),
    capsulePartIds: layout.filter((e) => flags(e).capsule).map((e) => e.id),
    comY, copY, stackHeight, dvNeeded, oneWay, roundTrip: oneWay + dvNeeded.return,
    usableFuel, deadFuel, slot, engineSpecs, mainFuel,
    radius: layout.length ? Math.max(...layout.filter((e) => e.attach === 'axial').map((e) => partRadius(e.def))) : 1,
  };

  return { spec, breakdown, blocks };
}

const round = (n) => Math.round(n * 100) / 100;
