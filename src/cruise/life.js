// The crew's life on the way to Mars (Role 1 wave 5, all four roles agreed; see src/builder/CLAUDE.md §8): what the
// life-support parts the player chose do in the cruise. Pure: no three.js, DOM or core imports, so Node can test it.
// It reads ShipSpec.stats.traits.life (src/builder/traits/life.js; the real numbers and their sources are in
// src/builder/traits/life.json) and keeps the cruise's own numbers in ./data.json. index.js drives it; without
// traits it is never created and the cruise runs exactly as before.
//
//   spare oxygen   each tank seeps past its valve or (cryogenic) boils off, day by day; a cabin leak recorded by the
//                  flight (state.structure.cabinLeak) is made up from it (and its nitrogen from the cabin's nitrogen
//                  allowance) until the crew seals the hole; in the oxygen tank emergency every wrong move lets the
//                  damaged line vent more of the tank on it. The crew's breathing in the cruise is the capsule's
//                  planned store, never the spare tanks.
//   CO₂            the primary scrubber can stop (1 − its reliability per trip, seeded); a backup takes over, the
//                  crew rigs the open loop's LiOH canisters (Apollo 13; also once a backup's canisters are spent),
//                  or, with only regenerable beds and nothing left, the cabin air becomes poison
//   radiation      1.8 mSv/day (MSL RAD) × the shielding's factor; the solar storm's dose falls off with the
//                  shielding the crew hides behind (g/cm², aluminium-equivalent)
//   water          recycled or carried: a record for the hangar, the planned stores cover the trip
//
// No UI: the existing cruise HUD shows the dose; the rest reaches the black box (telemetry co2, in mmHg) and the
// hangar's flight analysis (notes, appended to the flight's record in save.partEffects).

const MMHG_PER_KPA = 7.50062;
const R = 8.314;
const M_CO2 = 0.044;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, f = 0) => (Number.isFinite(Number(x)) ? Number(x) : f);
const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const usable = (tanks) => tanks.reduce((t, k) => t + Math.max(0, k.kg - k.residualKg), 0);

/** Air lost per day (kg) through a hole of `holeMm2` from cabin pressure into vacuum: choked flow, Cd 0.6. */
export function chokedAirKgPerDay(holeMm2, { kPa = 101.3, kelvin = 295, cd = 0.6 } = {}) {
  const g = 1.4, Rair = 287;
  const flux = kPa * 1000 * Math.sqrt(g / (Rair * kelvin)) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1))); // kg/(s·m²)
  return Math.max(0, num(holeMm2)) * 1e-6 * flux * cd * 86400;
}

/**
 * The cabin leak the flight recorded (structure group), as { airKgPerDay, holeMm2, partId } or null. holeMm2 is the
 * hole itself, or the hole that would leak that much at this cabin pressure.
 */
export function leakFrom(structureState, { kPa = 101.3 } = {}) {
  const s = structureState ?? {};
  const l = s.cabinLeak ?? null;
  const kgPerDay = Number.isFinite(l?.kgPerDay) ? l.kgPerDay : Number.isFinite(s.cabinLeakKgPerDay) ? s.cabinLeakKgPerDay : Number.isFinite(l?.holeMm2) ? chokedAirKgPerDay(l.holeMm2, { kPa }) : null;
  if (!(kgPerDay > 0)) return null;
  const holeMm2 = Number.isFinite(l?.holeMm2) ? l.holeMm2 : kgPerDay / chokedAirKgPerDay(1, { kPa });
  return { airKgPerDay: kgPerDay, holeMm2, partId: l?.partId ?? null };
}

/**
 * Days until the crew finds and seals a hole of `holeMm2`. A slow leak (up to Soyuz MS-09's 2 mm hole, 3.1 mm²) takes
 * about a day to find (cfg.leakPatchDays). A bigger hole hisses and the pressure visibly drops, so it is found sooner:
 * a power law from that day down to cfg.leakAudibleMinutes for a hole of cfg.leakAudibleMm2, never under
 * cfg.leakFloorMinutes (the time to grab the patch kit and close it). Audible point and floor: estimates.
 */
export function sealDays(holeMm2, cfg = {}) {
  const days = num(cfg.leakPatchDays, 1);
  const slow = num(cfg.leakSlowMm2, 3.14);
  const audible = Math.max(slow * 1.01, num(cfg.leakAudibleMm2, 10));
  const audibleDays = num(cfg.leakAudibleMinutes, 30) / 1440;
  const floor = num(cfg.leakFloorMinutes, 15) / 1440;
  if (!(num(holeMm2) > slow)) return days;
  const k = Math.log(days / audibleDays) / Math.log(audible / slow);
  return Math.max(floor, days * Math.pow(slow / holeMm2, k));
}

/** Dose (mSv) from the storm behind `gcm2` of shielding: ref.msv behind ref.gcm2, falling e-fold every lambda g/cm². */
export function stormDoseBehind(gcm2, { refMsv = 150, refGcm2 = 5, lambda = 8 } = {}) {
  return refMsv * Math.exp(-(num(gcm2, refGcm2) - refGcm2) / Math.max(0.1, lambda));
}

/** mmHg of CO₂ added per day in a sealed cabin of `m3` by `kgPerDay` of breath. */
export const co2RisePerDay = (kgPerDay, m3, kelvin = 295) => ((num(kgPerDay) / M_CO2) * R * kelvin / Math.max(0.5, num(m3, 4))) / 1000 * MMHG_PER_KPA;

/**
 * createCruiseLife(life, { tripDays, rng, leak, cfg }) → the crew's life for one cruise.
 * life: traits.life; rng: () → [0, 1) (seed it per flight); leak: leakFrom(...) or null; cfg: data.json `life` block.
 */
export function createCruiseLife(life, { tripDays = 259, rng = Math.random, leak = null, cfg = {} } = {}) {
  const words = life.words ?? {};
  const w = (k) => words[k] ?? { en: k, vi: k };
  const cabinM3 = num(life.cabin?.cabinM3, 4);
  const tanks = (life.o2?.tanks ?? []).map((t) => ({ ...t, kg0: t.kg }));
  const startKg = tanks.reduce((t, k) => t + k.kg, 0);
  const startUsable = usable(tanks);
  const units = life.co2?.units ?? [];
  const primary = units[0] ?? { id: 'loop', kind: 'lioh', regenerable: false, mmHg: 2, peakmmHg: 4, failPerTrip: 0.001, planned: true };
  const lethal = num(life.co2?.lethalmmHg, 60);
  // the leak runs until the crew finds and seals the hole: about a day for a slow one, minutes for a loud one
  if (leak && !Number.isFinite(leak.holeMm2)) leak = { ...leak, holeMm2: leak.airKgPerDay / chokedAirKgPerDay(1) };
  const patchDays = leak ? sealDays(leak.holeMm2, cfg) : 0;
  const bleedShare = num(cfg.malfunctionBleedShare, 0.25);
  const doseRate = num(cfg.doseMsvPerDay, 1.8) * num(life.radiation?.gcrFactor, 1);
  // the primary scrubber stops on this day (or never): one seeded roll for the whole cruise
  const failDay = rng() < num(primary.failPerTrip, 0) ? rng() * tripDays : null;

  const st = {
    day: 0, dose: 0, stormDose: 0, storm: null, co2: primary.mmHg, co2Peak: primary.peakmmHg, unit: primary,
    lost: { seep: 0, boil: 0, leak: 0, malfunction: 0, n2: 0 }, perTank: tanks.map(() => 0),
    n2Kg: Number.isFinite(life.o2?.n2?.kg) ? life.o2.n2.kg : null, // nitrogen for refilling a sea-level cabin
    scrubber: null, // { day, by: 'backup' | 'lioh' | 'rigged' | 'none', until? }
    rising: false, failed: null, attempts: 0, held: false,
  };

  function draw(kg) {
    let left = kg;
    for (const t of tanks) { if (left <= 0) break; const take = Math.min(t.kg, left); t.kg -= take; left -= take; }
    return kg - left;
  }

  // what takes over when the primary stops on `day`
  function onScrubberFailure(day) {
    const backups = units.slice(1);
    const regen = backups.find((u) => u.regenerable);
    const planned = backups.find((u) => u.planned); // the open loop's canisters, packed for the whole trip
    const lioh = backups.filter((u) => !u.regenerable && Number.isFinite(u.crewDays));
    const liohDays = lioh.reduce((t, u) => t + u.crewDays / Math.max(1, num(life.crew, 1)), 0);
    if (regen || planned) { st.scrubber = { day, by: regen ? 'backupRegen' : 'backupLioh' }; st.unit = regen ?? planned; }
    else if (liohDays > 0) { st.scrubber = { day, by: 'backupLioh', until: day + liohDays }; st.unit = lioh[0]; }
    else if (!primary.regenerable) { st.scrubber = { day, by: 'rigged' }; st.co2Peak = Math.max(st.co2Peak, num(life.co2?.riggedmmHg, 15)); }
    else { st.scrubber = { day, by: 'none' }; st.rising = true; }
    st.co2Peak = Math.max(st.co2Peak, primary.mmHg + num(life.co2?.afterFailuremmHg, 4));
  }

  return {
    get day() { return st.day; },
    get dose() { return st.dose; },
    get failed() { return st.failed; },
    get usableKg() { return usable(tanks); },
    get tanks() { return tanks.map((t) => ({ partId: t.partId, unit: t.unit, kg: round(t.kg, 3) })); },
    /** Cabin CO₂ now (mmHg), for the black box: a LiOH canister's 12-hour sawtooth, or a steady regenerable bed. */
    get co2mmHg() {
      const u = st.unit;
      if (st.rising) return round(st.co2, 1);
      const saw = u.regenerable ? 0 : ((st.day * 2) % 1);
      return round(u.mmHg + (num(u.peakmmHg, u.mmHg) - u.mmHg) * saw, 2);
    },

    /** Advance by `dDays`; returns a failure { endingId, cause, historyHint } once, or null. */
    step(dDays) {
      if (!(dDays > 0) || st.failed) return null;
      const d0 = st.day, d1 = Math.min(tripDays, d0 + dDays), dd = d1 - d0;
      if (dd <= 0) return null;
      // seep and boil-off
      tanks.forEach((t, i) => {
        const lost = t.kg * (1 - Math.exp(-num(t.leakPerDay) * dd));
        t.kg -= lost; st.perTank[i] += lost;
        if (t.kind === 'cryo') st.lost.boil += lost; else st.lost.seep += lost;
      });
      // the cabin leak runs from the start of the cruise until the crew finds and seals it
      if (leak) {
        const overlap = Math.max(0, Math.min(d1, patchDays) - d0);
        const share = num(life.cabin?.o2MassShare, 0.232);
        if (overlap > 0) {
          st.lost.leak += draw(leak.airKgPerDay * overlap * share);
          // the nitrogen in that air comes from the allowance kept for refilling the cabin on Mars
          if (st.n2Kg != null) { const n2 = Math.min(st.n2Kg, leak.airKgPerDay * overlap * (1 - share)); st.n2Kg -= n2; st.lost.n2 += n2; }
        }
      }
      // radiation from galactic cosmic rays
      st.dose += doseRate * dd;
      // CO₂
      if (failDay != null && !st.scrubber && failDay <= d1) onScrubberFailure(Math.max(d0, failDay));
      if (st.scrubber?.until != null && d1 > st.scrubber.until && !st.rising) {
        if (!primary.regenerable) {
          // the backup canisters are spent, but the open loop's own LiOH stock for the trip is still aboard: the crew
          // tapes those canisters into the backup's box (Apollo 13)
          st.scrubber = { day: st.scrubber.day, by: 'rigged', spentDay: st.scrubber.until };
          st.unit = primary;
          st.co2Peak = Math.max(st.co2Peak, num(life.co2?.riggedmmHg, 15));
        } else { st.rising = true; st.co2 = st.unit.mmHg; }
      }
      if (st.rising) {
        const from = Math.max(d0, st.scrubber.until ?? st.scrubber.day);
        st.co2 += co2RisePerDay(num(life.co2?.co2KgPerDay, 1.04) * num(life.crew, 1), cabinM3) * Math.max(0, d1 - from);
        st.co2Peak = Math.max(st.co2Peak, st.co2);
        if (st.co2 >= lethal) {
          st.day = d1;
          const spent = st.scrubber.until != null;
          st.failed = {
            endingId: 'outOfBreath', historyHint: 'apollo13', causeId: 'cabin_co2',
            cause: spent ? `The CO₂ scrubber failed on day ${Math.round(st.scrubber.day)}, the spare LiOH canisters ran out, and the cabin air became poison.`
              : `The CO₂ scrubber failed on day ${Math.round(st.scrubber.day)} with no backup on board, and the cabin air became poison.`,
          };
          return st.failed;
        }
      }
      st.day = d1;
      return null;
    },

    /** The storm's dose for where the crew waited: 'shelter' | 'improvised' | 'ignored'. Adds it and returns mSv. */
    storm(kind, ref = {}) {
      const r = life.radiation ?? {};
      const gcm2 = kind === 'shelter' ? (r.shelterGcm2 ?? r.improvisedGcm2) : kind === 'improvised' ? r.improvisedGcm2 : r.wallGcm2;
      const dose = Math.round(stormDoseBehind(gcm2, ref));
      st.dose += dose; st.stormDose += dose; st.storm = { kind, gcm2: round(num(gcm2, 5), 1), dose };
      return dose;
    },

    /** One answer in the oxygen-tank emergency. A wrong one lets the damaged line vent a share of the tank on it. */
    malfunctionAttempt(correct) {
      st.attempts += 1;
      if (correct) return 0;
      const line = tanks.length >= 2 ? [tanks[0]] : tanks; // separate bottles: only the one on the damaged line vents
      let lost = 0;
      for (const t of line) { const x = t.kg * bleedShare; t.kg -= x; lost += x; }
      st.lost.malfunction += lost;
      if (tanks.length >= 2) st.held = true;
      return lost;
    },

    /** Plain summary kept on the flight's record (record.life.cruise) for the surface. */
    summary() {
      return {
        day: round(st.day, 1), tanks: this.tanks, usableKg: round(usable(tanks), 2), startKg: round(startKg, 2), startUsableKg: round(startUsable, 2),
        ...(st.n2Kg != null ? { n2Kg: round(st.n2Kg, 3) } : {}),
        lost: Object.fromEntries(Object.entries(st.lost).map(([k, v]) => [k, round(v, 3)])),
        doseMsv: round(st.dose, 1), stormMsv: st.stormDose, co2PeakmmHg: round(st.co2Peak, 1), scrubber: st.scrubber,
      };
    },

    /** Notes for the hangar analysis ({ group, what, value, … }; templates in traits/life.json `notes`). */
    notes() {
      const out = [];
      const add = (what, value, extra = {}) => out.push({ group: 'life', what, value, ...extra });
      const r = life.radiation ?? {};
      add('cruiseDose', round(st.dose, 0), { nasaLimit: num(r.careerLimitMsv, 600) });
      if (st.storm) {
        const where = w(st.storm.kind);
        add('stormDose', st.storm.dose, { gcm2: st.storm.gcm2, where: where.en, whereVi: where.vi, kind: st.storm.kind, nasaLimit: num(r.thirtyDayLimitMsv, 250), ...(st.storm.kind === 'shelter' && r.shelterPartId ? { partId: r.shelterPartId } : {}) });
      }
      add('co2Peak', round(st.co2Peak, 1), { nasaLimit: num(life.co2?.limitmmHg, 3) });
      if (st.scrubber && st.scrubber.by !== 'none') {
        const u = w(primary.kind), b = w(st.scrubber.by);
        add('scrubberFailed', Math.round(st.scrubber.day), { unit: u.en, unitVi: u.vi, backup: b.en, backupVi: b.vi, ...(primary.partId ? { partId: primary.partId } : {}) });
      }
      if (tanks.length) add('o2Arrival', round(usable(tanks), 1), { start: round(startUsable, 1) });
      const byPart = new Map(); // one line per part (a service module's two tanks are one part)
      tanks.forEach((t, i) => { const p = byPart.get(t.partId) ?? { kind: t.kind, lost: 0 }; p.lost += st.perTank[i]; byPart.set(t.partId, p); });
      for (const [partId, p] of byPart) {
        if (p.kind === 'cryo' && p.lost > 0.5) add('o2Boiloff', round(p.lost, 0), { partId });
        else if (p.kind !== 'cryo' && p.lost > 0) add('o2Seep', round(p.lost * 1000, 0), { partId, days: Math.round(st.day) });
      }
      if (st.lost.leak > 0) add('cabinLeak', round(st.lost.leak, 1), { hours: round(patchDays * 24, 1), holeMm2: round(leak.holeMm2, 1), ...(leak?.partId ? { partId: leak.partId } : {}) });
      if (st.lost.malfunction > 0) add('malfunctionLoss', round(st.lost.malfunction, 1));
      if (st.held) add('malfunctionHeld', tanks.length);
      const need = num(life.water?.needKgPerDay, 3) * st.day * num(life.crew, 1);
      const rec = clamp(num(life.water?.recovery), 0, 1);
      const carried = rec > 0 ? need * (1 - rec) + num(life.water?.bufferDays, 7) * num(life.water?.needKgPerDay, 3) : need;
      if (rec > 0) add('water', rec, { carried: Math.round(carried), open: Math.round(need) });
      else add('waterStored', Math.round(need), { days: Math.round(st.day) });
      return out;
    },
  };
}

/** A small seeded stream (mulberry32) from a string, so a flight's cruise is the same every time it is replayed. */
export function seededRng(text) {
  let h = 2166136261 >>> 0;
  for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
