// Astronaut body stats (Role 2 logic) → HUD + black box (TEAM_PROMPT §8, §11 "Fragility").
//
// const body = createBodyStats({ onNotice });
// each frame: body.update(dt, { env, gLoad, heartRate, inShelter, solarStorm, daysPerSecond });
//   env: 'earth' | 'earth_orbit' | 'cruise' | 'mars_orbit' | 'mars' | 'cabin_mars'
//   daysPerSecond: game days that pass per real second (time-warp in the cruise), default: 1 real s = 1 game s
//
// Radiation dose rates (mSv per day), real measurements, sourced for the Guidebook:
//   - Deep-space cruise ≈ 1.8 mSv/day: Curiosity's RAD instrument on the way to Mars (Zeitlin et al., Science 2013)
//   - Mars surface ≈ 0.64–0.67 mSv/day: Curiosity RAD at Gale crater (Hassler et al., Science 2014; NASA/JPL 2013)
//   - Low Earth orbit (ISS) ≈ 0.5 mSv/day (NASA, typical ISS crew dose; varies ~0.3–0.8)
//   - Earth surface ≈ 0.0066 mSv/day (≈ 2.4 mSv/year world average natural background, UNSCEAR)
// Solar particle events can add tens to hundreds of mSv in hours without shielding; a water/polyethylene
// "storm shelter" cuts that several-fold. The storm numbers below are GAMEPLAY values, marked TODO tune.
// NASA's career limit (2022 standard) is 600 mSv. Acute radiation sickness starts around 1 Sv (1000 mSv).
//
// Local notices (onNotice, not on the bus): 'alert' { type: 'radiation_high' | 'radiation_career_limit' | 'g_peak', ... }.
// The module that owns the state puts doseMSv / heartRate into contract's flight:telemetry for the black box.

export const DOSE_RATE_MSV_PER_DAY = {
  earth: 0.0066,
  earth_orbit: 0.5,
  cruise: 1.8,
  mars_orbit: 1.8,
  mars: 0.67,
  cabin_mars: 0.67 * 0.7, // the hull adds a little shielding (TODO verify factor)
};

export const BODY_TUNING = {
  stormMultiplier: 60, // × cruise rate during a solar particle event (TODO tune: ≈ 100 mSv/day unshielded)
  shelterFactor: 0.2, // storm shelter lets through ~20 % (TODO verify)
  highDoseMSv: 100, // HUD alert
  careerLimitMSv: 600, // NASA career limit (2022)
  gPeakAlert: 5,
  publishEvery: 0.5, // s
};

const SECONDS_PER_DAY = 86400;

export function createBodyStats({ onNotice } = {}) {
  const notify = onNotice ?? (() => {});
  const st = { dose: 0, rate: 0, peakG: 0, fatigue: 0, heartRate: 72, timer: 0, alerts: new Set() };

  const alert = (type, data = {}) => {
    if (st.alerts.has(type)) return;
    st.alerts.add(type);
    notify('alert', { type, ...data });
  };

  return {
    get doseMSv() { return st.dose; },
    get rateMSvPerDay() { return st.rate; },
    get peakG() { return st.peakG; },
    get fatigue() { return st.fatigue; },

    update(dt, { env = 'cruise', gLoad = 1, heartRate = 72, inShelter = false, solarStorm = false, daysPerSecond = 1 / SECONDS_PER_DAY } = {}) {
      if (dt <= 0) return;
      let rate = DOSE_RATE_MSV_PER_DAY[env] ?? DOSE_RATE_MSV_PER_DAY.cruise;
      if (solarStorm && env !== 'earth' && env !== 'mars' && env !== 'cabin_mars') {
        rate *= BODY_TUNING.stormMultiplier * (inShelter ? BODY_TUNING.shelterFactor : 1);
      }
      st.rate = rate;
      st.dose += rate * dt * daysPerSecond;
      st.peakG = Math.max(st.peakG, gLoad);
      st.heartRate = heartRate;
      // fatigue 0..1: hard work and high g tire you out, calm time recovers (simple model, TODO tune)
      const exertion = Math.max(0, (heartRate - 80) / 80) + Math.max(0, gLoad - 2) * 0.1;
      st.fatigue = Math.min(1, Math.max(0, st.fatigue + (exertion * 0.01 - 0.002) * dt));

      if (st.dose > BODY_TUNING.highDoseMSv) alert('radiation_high', { doseMSv: st.dose });
      if (st.dose > BODY_TUNING.careerLimitMSv) alert('radiation_career_limit', { doseMSv: st.dose });
      if (gLoad > BODY_TUNING.gPeakAlert) alert('g_peak', { g: gLoad });

    },

    snapshot() { return { doseMSv: st.dose, peakG: st.peakG, fatigue: st.fatigue, heartRate: st.heartRate }; },
  };
}
