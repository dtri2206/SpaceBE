// Atmosphere, drag and entry heating. Pure functions, SI units.
//
// World scale (TEAM_PROMPT §6.1): planet RADII are 1/10 of real, surface gravity is real.
// Speeds are therefore ~sqrt(10) lower than real, so entry heating (∝ v³) is ~10^1.5 lower.
// HEAT_REAL_SCALE converts game heating into a "real-equivalent" value for limits and the HUD.

export const RADIUS_SCALE = 0.1;
export const SPEED_REAL_SCALE = Math.sqrt(1 / RADIUS_SCALE); // ≈ 3.16
export const HEAT_REAL_SCALE = SPEED_REAL_SCALE ** 3; // ≈ 31.6

// Sutton–Graves constants (W·m⁻²·(kg/m³)^-½·m^½·(m/s)^-3). Earth air / Mars CO2.
export const SUTTON_GRAVES_K = { earth: 1.7415e-4, mars: 1.9027e-4 };

// Exponential atmosphere: rho(h) = rho0 * exp(-h / H)
export function airDensity(planet, altitude) {
  if (!planet.seaLevelDensity) return 0;
  if (altitude < 0) altitude = 0;
  const rho = planet.seaLevelDensity * Math.exp(-altitude / planet.scaleHeight);
  return rho < 1e-9 ? 0 : rho;
}

// Fraction of sea-level pressure (≈ density ratio for an isothermal model). 1 at ground, 0 in vacuum.
export function pressureRatio(planet, altitude) {
  if (!planet.seaLevelDensity) return 0;
  return airDensity(planet, altitude) / planet.seaLevelDensity;
}

// Dynamic pressure q = ½ ρ v²  (Pa)
export const dynamicPressure = (rho, speed) => 0.5 * rho * speed * speed;

// Drag force magnitude F = ½ ρ v² · CdA  (N)
export const dragForce = (rho, speed, cdA) => dynamicPressure(rho, speed) * cdA;

// Stagnation-point heat flux q = k · sqrt(ρ / r_nose) · v³  (W/m²), game units.
export function heatFlux(planetId, rho, speed, noseRadius = 1) {
  const k = SUTTON_GRAVES_K[planetId] ?? SUTTON_GRAVES_K.earth;
  return k * Math.sqrt(rho / noseRadius) * speed ** 3;
}

// Altitude above which we treat the planet as "out of the atmosphere" (for orbit checks / HUD).
export const atmosphereTop = (planet) => (planet.seaLevelDensity ? planet.scaleHeight * 9 : 0);
