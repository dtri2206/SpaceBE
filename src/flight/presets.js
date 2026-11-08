// Role 2 test ships + start conditions. Real ships come from Role 1's builder (getShip() in core);
// core's own mocks are in src/core/mocks/. Shapes and units follow contract.js SHIP_SPEC_SHAPE (kg, N).
// Planets/gravity always come from core (PLANETS, G0): never write them here.

const base = {
  cost: 2800000,
  dryMass: 6000, // kg
  fuelMass: 20000, // kg
  thrust: 400000, // N (vacuum)
  ispSL: 330,
  ispVac: 350, // methalox
  hasHeatShield: true,
  heatShieldDamaged: false,
  hasLegs: true,
  hasRCS: true,
  hasParachute: true,
  hasAntenna: true,
  hasShelter: true,
  coldRatedSeals: true,
  armorHits: 1,
  spareO2Tanks: 2,
};

const spec = (name, stats, { launch = { tempC: 18 }, warnings = [] } = {}) => ({
  name,
  parts: [],
  engines: [{ fuel: 'methalox', nozzle: 'vac', pump: 'M' }],
  stats: { ...base, ...stats },
  warnings,
  launch,
});

export const MOCK_SHIPS = {
  reliable: spec('Reliable', {}),
  // Challenger launched at about 2 °C (36 °F)
  coldMorning: spec('Cold Morning', { coldRatedSeals: false, cost: 2300000 }, { launch: { tempC: 2 }, warnings: ['COLD_SEALS'] }),
  thinSkin: spec('Thin Skin', { heatShieldDamaged: true }),
  noShield: spec('No Shield', { hasHeatShield: false }, { warnings: ['NO_HEAT_SHIELD'] }),
  // what's left of the ship when it reaches Mars (most fuel spent on the way)
  marsArrival: spec('Mars arrival', { fuelMass: 4000, thrust: 200000 }),
};

// Start conditions for FlightController({ start })
export const STARTS = {
  earthPad: 'pad',
  // Entry corridor (scaled Mars): about -22° to -30° at 1.4 km/s works. Shallower than ~-20° skips off
  // (1.4 km/s is above Mars escape speed up there), steeper than ~-40° can't slow down in the thin air.
  marsEntry: { altitude: 99000, speed: 1400, flightPathDeg: -26 },
  // just after the chute: start of powered descent (real landers light engines at ~2 km, ~100 m/s)
  marsLanding: { altitude: 3000, speed: 120, flightPathDeg: -65 },
};
