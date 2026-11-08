// The only place gravity may be written. Never hard-code g anywhere else.
export const PLANETS = {
  earth: { g: 9.81, radius: 637e3,   realRadius: 6371e3,   seaLevelDensity: 1.225, scaleHeight: 8500 },
  mars:  { g: 3.71, radius: 339.5e3, realRadius: 3389.5e3, seaLevelDensity: 0.020, scaleHeight: 11100 },
};
export const G0 = 9.80665; // standard gravity for Isp
