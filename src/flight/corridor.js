// Mars entry corridor (pure, no three.js). The flight-path angle (FPA, degrees, negative = descending) at the
// atmosphere's edge decides the entry:
//   too shallow → the ship skips off the atmosphere (FlightController 'skip_off' / 'skipped_off': it leaves and, on an
//                 escape path or with no fuel, never comes back; on a bound path it loops for minutes)
//   too steep   → the g-load or the heating is too much (FlightController 'g_force_blackout' / 'heat_overload'),
//                 or the ship is still far too fast when the chute and engine must work (crash)
// The limits come from the same TUNING numbers the FlightController uses (gSustainedLimit, heatLimit, heatGrace),
// found by bisection on a light-weight copy of the same physics (gravity, drag, Sutton-Graves heating, chute).
//
//   flightPathDeg(fc)            current FPA in degrees
//   predictInterface(fc)         gravity-only prediction of the FPA when the ship reaches the atmosphere's edge
//   computeCorridor(fc)          { steepDeg, shallowDeg, centreDeg } (steepDeg < shallowDeg < 0) for this ship and speed
//   corridorGauge(fc, corridor)  { angleDeg, position 0..1 (0 = shallow side, 1 = steep side), status, hint }
//   approachBack(fc, seconds)    move a fresh entry controller back along its gravity-only path (time to trim)

import { add, scale, len, dot, norm, sub } from './vec.js';
import { airDensity, atmosphereTop, heatFlux } from './atmosphere.js';
import { TUNING, heatLimitFor } from './FlightController.js';

const DEG = 180 / Math.PI;

export function flightPathDeg(fc) {
  const up = fc.up;
  const vv = dot(fc.vel, up);
  const vh = len(sub(fc.vel, scale(up, vv)));
  return Math.atan2(vv, vh) * DEG;
}

function gravityStep(mu, pos, vel, dt) {
  const r = len(pos);
  vel = add(vel, scale(pos, (-mu / (r * r * r)) * dt));
  return { pos: add(pos, scale(vel, dt)), vel };
}

// Gravity-only prediction up to the atmosphere's edge. Returns null if the ship never gets there.
export function predictInterface(fc) {
  const top = atmosphereTop(fc.planet);
  const R = fc.planet.radius;
  let pos = { ...fc.pos }, vel = { ...fc.vel };
  const fpaOf = (p, v) => {
    const u = norm(p), vv = dot(v, u);
    return Math.atan2(vv, len(sub(v, scale(u, vv)))) * DEG;
  };
  if (len(pos) - R <= top) return { fpaDeg: fpaOf(pos, vel), time: 0, speed: len(vel) };
  const dt = 0.25;
  for (let t = 0; t < 1500; t += dt) {
    ({ pos, vel } = gravityStep(fc.mu, pos, vel, dt));
    if (len(pos) - R <= top) return { fpaDeg: fpaOf(pos, vel), time: t + dt, speed: len(vel) };
  }
  return null;
}

// Light-weight descent from the atmosphere's edge. Returns how it ended and the loads on the way.
function simulateEntry(fc, fpaDeg, speed) {
  const p = fc.planet, R = p.radius, top = atmosphereTop(p);
  const s = fc.ship;
  const f = (fpaDeg * Math.PI) / 180;
  let pos = { x: 0, y: R + top, z: 0 };
  let vel = { x: Math.cos(f) * speed, y: Math.sin(f) * speed, z: 0 };
  const limit = heatLimitFor(s, { planned: true }); // an unseen strike gouge is invisible to the computer's plan
  const mass = fc.mass;
  let chute = false, heatTime = 0, peakG = 0, peakHeat = 0;
  const dt = 0.1;
  for (let t = 0; t < 900; t += dt) {
    const r = len(pos), alt = r - R, up = scale(pos, 1 / r), spd = len(vel);
    const vv = dot(vel, up);
    const rho = airDensity(p, alt);
    if (!chute && s.chuteCdA && vv < 0 && alt < TUNING.chuteMaxAltitude && spd < TUNING.chuteMaxSpeed && rho > 0) chute = true;
    const drag = (0.5 * rho * spd * spd * (s.cdA + (chute ? s.chuteCdA : 0))) / mass;
    const dragAcc = spd > 0 ? scale(vel, -drag / spd) : { x: 0, y: 0, z: 0 };
    if (vv < 0) {
      const hf = heatFlux(fc.planetId, rho, spd, s.noseRadius);
      peakHeat = Math.max(peakHeat, hf);
      heatTime = hf > limit ? heatTime + dt : 0;
      if (heatTime > TUNING.heatGrace) return { result: 'steep', why: 'heat', peakG, peakHeat };
    }
    peakG = Math.max(peakG, drag / fc.g0);
    if (peakG > TUNING.gSustainedLimit) return { result: 'steep', why: 'g', peakG, peakHeat };
    const g = -fc.mu / (r * r);
    vel = add(vel, scale(up, g * dt));
    vel = add(vel, scale(dragAcc, dt));
    pos = add(pos, scale(vel, dt));
    if (alt < 3000) return { result: spd > 250 ? 'steep' : 'ok', why: 'speed', peakG, peakHeat };
    // leaving the atmosphere again = skipping off: on a bound path it comes back only after minutes, on an escape path never
    if (alt > top && vv > 0) return { result: 'shallow', why: 'skip', peakG, peakHeat };
  }
  return { result: 'ok', peakG, peakHeat };
}

// Bisection for the two edges. Speed = the speed at the atmosphere's edge (falls back to the current speed).
export function computeCorridor(fc) {
  const pred = predictInterface(fc);
  const speed = pred?.speed ?? len(fc.vel);
  const ok = (deg) => simulateEntry(fc, deg, speed).result === 'ok';
  const find = (good, bad) => { // good/bad: angles; returns the edge between them
    for (let i = 0; i < 14; i++) {
      const mid = (good + bad) / 2;
      if (ok(mid)) good = mid; else bad = mid;
    }
    return good;
  };
  // find one good angle by scanning, then bisect outward
  let good = null;
  for (let deg = -8; deg >= -80; deg -= 2) if (ok(deg)) { good = deg; break; }
  // a damaged shield leaves a corridor under a degree wide: a coarse scan can step right over it
  if (good === null && fc.ship.heatShieldDamaged) for (let deg = -12; deg >= -30; deg -= 0.1) if (ok(deg)) { good = deg; break; }
  if (good === null) return { steepDeg: -45, shallowDeg: -15, centreDeg: -30, none: true };
  const shallowDeg = find(good, -3);
  const steepDeg = find(good, -89);
  return { steepDeg, shallowDeg, centreDeg: (steepDeg + shallowDeg) / 2, halfWidthDeg: (shallowDeg - steepDeg) / 2, speed };
}

// Gauge data for the HUD. position: 0 = shallow end, 1 = steep end of the displayed range; the corridor sits in the middle.
export function corridorGauge(fc, corridor) {
  if (!corridor) return null;
  const pred = predictInterface(fc);
  const angleDeg = pred ? pred.fpaDeg : flightPathDeg(fc);
  const half = corridor.halfWidthDeg ?? (corridor.shallowDeg - corridor.steepDeg) / 2;
  const lo = corridor.centreDeg + half * 2; // shallow end of the display (corridor = middle half of the bar)
  const hi = corridor.centreDeg - half * 2;
  const position = Math.max(0, Math.min(1, (lo - angleDeg) / (lo - hi)));
  const margin = Math.min(corridor.shallowDeg - angleDeg, angleDeg - corridor.steepDeg); // > 0 inside
  const status = margin < half * 0.3 && margin >= 0 ? 'edge' : margin < 0 ? (angleDeg > corridor.centreDeg ? 'shallow' : 'steep') : 'ok';
  const nearShallow = angleDeg > corridor.centreDeg;
  const hint = status === 'edge' ? (nearShallow ? 'Near the edge. Hold W: steeper' : 'Near the edge. Hold S: shallower') : status === 'shallow' ? 'Hold W: steeper' : status === 'steep' ? 'Hold S: shallower' : 'Angle is good. W steeper · S shallower';
  return { angleDeg, position, status, hint, margin, corridor, centreOffset: Math.abs(angleDeg - corridor.centreDeg) / half };
}

// Walk a fresh controller back along its gravity-only path so there is time to trim before the interface.
export function approachBack(fc, seconds) {
  let pos = { ...fc.pos }, vel = scale(fc.vel, -1);
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) ({ pos, vel } = gravityStep(fc.mu, pos, vel, dt));
  fc.pos = pos;
  fc.vel = scale(vel, -1);
}
