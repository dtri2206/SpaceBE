// Phase ratings (1–3 stars) at the end of each flight phase. Pure, no three.js.
//
// PUBLIC API for other roles (re-exported from src/flight/index.js; Role 4's Flight Report may call it, optionally):
//
//   getPhaseRatings() → Array<{ phase: 'ascent' | 'entry' | 'landing', stars: 1 | 2 | 3, stats: {...}, text: string }>
//     In the order the phases were finished; a phase that was not flown (or not finished) is simply missing.
//     Cleared when a new mission starts (LAUNCH). `text` is the one-line card the pilot saw, e.g.
//       'ASCENT ★☆☆ · flown by the computer · fuel left 34 % · peak 3.8 g'
//       'ASCENT ★★☆ · manual accuracy 78 % · fuel left 34 % · peak 3.8 g'
//       'ENTRY ★★★ · corridor centre 1.2° off · peak 0.9 g · heat 6 % of limit'
//       'LANDING ★★★ · 1.4 m/s · 42 m from target · fuel 12 %'
//     stats: ascent  { avgDeviationDeg, fuelLeftPct, peakG, manualFlown, manualAccuracyPct }
//            entry   { interfaceAngleDeg, centreOffsetDeg, peakG, peakHeatPct, trimDv }
//            landing { touchdownSpeed, offsetM, fuelLeftPct }
//
// Thresholds (stars = the worst of the listed metrics):
//   ASCENT   the flight computer flies the climb; stars come from the manual gravity-turn window (manualControl.js):
//            not flown by the player:                           1 star (flown by the computer)
//            manual accuracy (nose within 2.5° of the target):  ≥ 85 % → 3 · ≥ 60 % → 2 · else 1
//            peak g:                                            ≤ 5.5 → 3 · ≤ 7 → 2 · else 1
//            fuel left in orbit:                                ≥ 8 % → 3 · ≥ 2 % → 2 · else 1
//   ENTRY    interface angle vs the corridor centre, in half-widths: ≤ 0.5 → 3 · ≤ 0.85 → 2 · else 1
//            peak g:                                            ≤ 4 → 3 · ≤ 6 → 2 · else 1
//   LANDING  touchdown speed (limit 3 m/s):                     ≤ 2 → 3 · ≤ 2.7 → 2 · else 1
//            distance from the aim point (where you were at 1 km up, straight below): ≤ 60 m → 3 · ≤ 200 m → 2 · else 1
//            fuel left:                                         ≥ 3 % → 3 · ≥ 0.5 % → 2 · else 1

import { dot, len, norm, sub, scale } from './vec.js';
import { flightPathDeg } from './corridor.js';

export const RATING_LIMITS = {
  ascent: { dev: [5, 10], manual: [85, 60], g: [5.5, 7], fuel: [8, 2] },
  entry: { centre: [0.5, 0.85], g: [4, 6] },
  landing: { speed: [2, 2.7], offset: [60, 200], fuel: [3, 0.5] },
};

const lowerIsBetter = (v, [three, two]) => (v <= three ? 3 : v <= two ? 2 : 1);
const higherIsBetter = (v, [three, two]) => (v >= three ? 3 : v >= two ? 2 : 1);
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export function rateAscent(st) {
  const L = RATING_LIMITS.ascent;
  const gf = Math.min(lowerIsBetter(st.peakG, L.g), higherIsBetter(st.fuelLeftPct, L.fuel));
  const flown = !!st.manualFlown;
  const stars = flown ? Math.min(higherIsBetter(st.manualAccuracyPct ?? 0, L.manual), gf) : 1;
  const lead = flown ? `manual accuracy ${f(st.manualAccuracyPct)} %` : 'flown by the computer';
  return { phase: 'ascent', stars, stats: st, text: `ASCENT ${starText(stars)} · ${lead} · fuel left ${f(st.fuelLeftPct)} % · peak ${f(st.peakG, 1)} g` };
}

export function rateEntry(st) {
  const L = RATING_LIMITS.entry;
  const stars = Math.min(lowerIsBetter(st.centreOffsetHalfWidths ?? 0, L.centre), lowerIsBetter(st.peakG, L.g));
  return { phase: 'entry', stars, stats: st, text: `ENTRY ${starText(stars)} · angle ${f(st.interfaceAngleDeg, 1)}° (${f(st.centreOffsetDeg, 1)}° off centre) · peak ${f(st.peakG, 1)} g · heat ${f(st.peakHeatPct)} % of limit` };
}

export function rateLanding(st) {
  const L = RATING_LIMITS.landing;
  const stars = Math.min(lowerIsBetter(st.touchdownSpeed, L.speed), lowerIsBetter(st.offsetM, L.offset), higherIsBetter(st.fuelLeftPct, L.fuel));
  return { phase: 'landing', stars, stats: st, text: `LANDING ${starText(stars)} · ${f(st.touchdownSpeed, 1)} m/s · ${f(st.offsetM)} m from target · fuel ${f(st.fuelLeftPct)} %` };
}

// Stored ratings (module state: survives LAUNCH → ORBIT → ENTRY → LANDING scene changes).
let ratings = [];
export const getPhaseRatings = () => ratings.map((r) => ({ ...r, stats: { ...r.stats } }));
export function clearPhaseRatings() { ratings = []; }
export function storeRating(r) {
  ratings = ratings.filter((x) => x.phase !== r.phase).concat(r);
  return r;
}

// Collects the numbers while the phases are flown. Feed it every frame: tracker.update(fc, { guideDir, guideStep, corridor, interfaceAngleDeg, manualAscent }).
// manualAscent = { flown, accuracyPct } from the ascent manual window (null = not flown).
// Returns the ratings that were finished by this update (usually none).
export function createPhaseTracker() {
  const a = { n: 0, sum: 0, peakG: 0, rated: false, flown: false };
  const e = { peakG: 0, peakHeat: 0, angle: null, offset: null, rated: false, seen: false };
  const l = { aim: null, rated: false };
  return {
    update(fc, { guideDir = null, guideStep = null, corridor = null, interfaceAngleDeg = null, manualAscent = null } = {}) {
      const done = [];
      const t = fc.telemetry;
      if (fc.failed) return done;
      // ascent: angle between the nose and the guide while the engine burns on climb/turn/circularise
      if (fc.planetId === 'earth' && fc.liftoffT !== null && !a.rated) {
        a.flown = true;
        a.peakG = Math.max(a.peakG, t.gLoad);
        if (guideDir && t.thrust > 0 && guideStep !== 'coast') {
          const c = Math.max(-1, Math.min(1, dot(fc.forward, norm(guideDir))));
          a.sum += (Math.acos(c) * 180) / Math.PI;
          a.n++;
        }
        if (t.phase === 'orbit') {
          a.rated = true;
          done.push(storeRating(rateAscent({ avgDeviationDeg: a.n ? a.sum / a.n : 0, fuelLeftPct: t.fuelFrac * 100, peakG: a.peakG, manualFlown: !!manualAscent?.flown, manualAccuracyPct: manualAscent?.flown ? manualAscent.accuracyPct : null })));
        }
      }
      // entry: peak loads from the interface to the parachute
      if (fc.planetId === 'mars' && !e.rated) {
        if (interfaceAngleDeg !== null) e.angle = interfaceAngleDeg; // last prediction before the interface stays
        else if (e.angle === null) e.angle = flightPathDeg(fc);
        e.seen = true;
        e.peakG = Math.max(e.peakG, t.gLoad);
        e.peakHeat = Math.max(e.peakHeat, t.heatLimit ? t.heatFlux / t.heatLimit : 0);
        if (fc.chuteOpen && corridor && e.angle !== null) {
          e.rated = true;
          const off = e.angle - corridor.centreDeg;
          const half = corridor.halfWidthDeg ?? 1;
          done.push(storeRating(rateEntry({
            interfaceAngleDeg: e.angle, centreOffsetDeg: Math.abs(off), centreOffsetHalfWidths: Math.abs(off) / half,
            peakG: e.peakG, peakHeatPct: e.peakHeat * 100, trimDv: fc.trimmedDv ?? 0,
          })));
        }
      }
      // landing: aim point = straight below the ship when it first passes 1 km on Mars
      if (fc.planetId === 'mars' && !l.rated) {
        if (l.aim === null && t.altitude < 1000) l.aim = scale(norm(fc.pos), fc.planet.radius);
        if (fc.landed && l.aim) {
          l.rated = true;
          const off = len(sub(scale(norm(fc.pos), fc.planet.radius), l.aim));
          done.push(storeRating(rateLanding({ touchdownSpeed: fc.landingSpeed ?? len(fc.vel), offsetM: off, fuelLeftPct: t.fuelFrac * 100 })));
        }
      }
      return done;
    },
  };
}
