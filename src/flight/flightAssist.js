// Flight Assist data (TEAM_PROMPT §6.5). Pure functions: Role 3 / HUD code draws the result.
//
//   predictPath(fc)      → coasting trajectory points (planet-centred, metres) for the trajectory line
//   assistReadout(fc)    → arrows, warnings, burn-now marker, formula cards (§6.4 MVP)

import { v3, add, sub, scale, len, norm, dot } from './vec.js';
import steeringData from './steering.json' with { type: 'json' };
import { atmosphereTop } from './atmosphere.js';

// Coast (gravity only) from the current state. Adaptive step: bigger steps when far/slow.
export function predictPath(fc, { seconds = 600, maxPoints = 240 } = {}) {
  let pos = { ...fc.pos };
  let vel = { ...fc.vel };
  const R = fc.planet.radius;
  const points = [{ ...pos }];
  const dt = seconds / maxPoints;
  const sub = 8;
  const h = dt / sub;
  for (let i = 0; i < maxPoints; i++) {
    for (let k = 0; k < sub; k++) {
      const r = len(pos);
      const acc = scale(pos, -fc.mu / (r * r * r));
      vel = add(vel, scale(acc, h));
      pos = add(pos, scale(vel, h));
    }
    points.push({ ...pos });
    if (len(pos) <= R) { points.impact = true; break; }
  }
  return points;
}

// Stopping distance for a vertical retro-burn: d = v² / (2 · (a_engine − g)). Infinity if the engine can't beat gravity.
export function stoppingDistance(verticalSpeed, engineAccel, gravity) {
  const net = engineAccel - gravity;
  if (net <= 0) return Infinity;
  return (verticalSpeed * verticalSpeed) / (2 * net);
}

export function assistReadout(fc) {
  const t = fc.telemetry;
  const up = fc.up;
  const engineAccel = fc.thrustNow() / fc.mass;
  const descending = t.verticalSpeed < 0;
  const stopDist = descending ? stoppingDistance(t.verticalSpeed, engineAccel, t.gravity) : Infinity;
  const margin = 1.25; // start the burn with 25% altitude to spare
  const burnNow = descending && t.altitude < 20000 && stopDist * margin >= t.altitude;

  const warnings = [];
  if (t.dynamicPressure > t.maxQ * 0.8) warnings.push({ id: 'maxq', level: t.dynamicPressure > t.maxQ * 0.95 ? 'red' : 'amber', text: 'MAX-Q: throttle down' });
  if (t.gLoad > 4) warnings.push({ id: 'g', level: t.gLoad > 6 ? 'red' : 'amber', text: `G-FORCE ${t.gLoad.toFixed(1)} g` });
  if (t.engineTemp > 0.8) warnings.push({ id: 'engine', level: t.engineTemp > 0.92 ? 'red' : 'amber', text: 'ENGINE HOT: reduce throttle' });
  if (t.heatFlux > t.heatLimit * 0.7) warnings.push({ id: 'heat', level: t.heatFlux > t.heatLimit ? 'red' : 'amber', text: 'HEATING: shallower entry' });
  if (t.fuelFrac < 0.1 && t.fuelFrac > 0) warnings.push({ id: 'fuel', level: 'amber', text: 'FUEL LOW' });
  if (t.fuel <= 0) warnings.push({ id: 'fuel', level: 'red', text: 'NO FUEL' });
  if (descending && t.altitude < 3000 && -t.verticalSpeed > 30) warnings.push({ id: 'landing', level: burnNow ? 'red' : 'amber', text: burnNow ? 'BURN NOW' : 'DESCENT RATE HIGH' });

  const speed = t.speed;
  return {
    thrustDir: fc.forward, // orange arrow (world, planet-centred frame)
    velocityDir: speed > 0.1 ? norm(fc.vel) : v3(), // cyan arrow
    prograde: speed > 0.1 ? norm(fc.vel) : null,
    retrograde: speed > 0.1 ? scale(norm(fc.vel), -1) : null,
    pointingVsMovingDeg: speed > 0.1 ? (Math.acos(Math.max(-1, Math.min(1, dot(fc.forward, norm(fc.vel))))) * 180) / Math.PI : 0,
    burnNow,
    stoppingDistance: stopDist,
    burnTimeLeft: t.thrust > 0 ? fc.fuel / (t.thrust / (t.isp * fc.g0)) : fc.fuel / (fc.thrustNow() / (t.isp * fc.g0) || Infinity),
    aboveAtmosphere: t.altitude > atmosphereTop(fc.planet),
    warnings,
    // Formula cards (§6.4 MVP): show the formula, the numbers, the result.
    cards: {
      liftoff: {
        formula: 'a = F/m − g',
        numbers: `a = ${(t.thrust / 1000).toFixed(0)} kN / ${(t.mass / 1000).toFixed(1)} t − ${t.gravity.toFixed(2)}`,
        result: `${(t.thrust / t.mass - t.gravity).toFixed(2)} m/s²`,
      },
      orbit: {
        formula: 'v = √(GM / r)',
        numbers: `circular speed here = ${t.circularSpeed.toFixed(0)} m/s, you: ${t.horizontalSpeed.toFixed(0)} m/s sideways`,
        result: t.horizontalSpeed >= t.circularSpeed ? 'Fast enough to orbit' : `${(t.circularSpeed - t.horizontalSpeed).toFixed(0)} m/s more sideways speed needed`,
        realNote: 'Real Earth low orbit ≈ 7.8 km/s (this world is 1/10 scale).',
      },
      stopping: {
        formula: 'd = v² / (2·(a_engine − g))',
        numbers: `d = ${(t.verticalSpeed ** 2).toFixed(0)} / (2·(${engineAccel.toFixed(1)} − ${t.gravity.toFixed(2)}))`,
        result: Number.isFinite(stopDist) ? `${stopDist.toFixed(0)} m` : 'engine too weak to stop',
      },
    },
  };
}

// Ascent guide (Flight Assist): the gravity turn that the whole-mission test flies (≈ 4.1 km/s to orbit).
// Teaches the real steps: climb straight up, tip over gradually toward the horizon, cut the engine when the
// apoapsis is high enough, coast up to it, then burn sideways (prograde) to make the orbit round.
// Returns null when no guide applies (not on an ascent, or already in orbit).
export const ASCENT_PROFILE = { turnStart: 2000, metresPerDegree: 400, targetApoapsis: 95000 };

export function ascentGuide(fc, profile = ASCENT_PROFILE) {
  const t = fc.telemetry;
  if (fc.failed || t.phase === 'orbit' || !fc.planet.seaLevelDensity || t.altitude > 200000) return null;
  if (t.phase !== 'prelaunch' && t.phase !== 'ascent' && t.phase !== 'coast') return null;
  const up = fc.up;
  // "east": the horizontal direction we are already moving, or the default launch direction
  const vh = sub(fc.vel, scale(up, t.verticalSpeed));
  let east = len(vh) > 5 ? norm(vh) : norm(v3(up.y, -up.x, 0));
  if (len(east) < 0.5) east = v3(1, 0, 0);
  const tilt = (deg) => {
    const p = (deg * Math.PI) / 180;
    return norm(add(scale(up, Math.cos(p)), scale(east, Math.sin(p))));
  };
  const top = atmosphereTop(fc.planet);
  if (t.apoapsis < profile.targetApoapsis) {
    if (t.altitude < profile.turnStart) return { step: 'climb', direction: up, text: 'Climbing straight up at full throttle' };
    const deg = Math.min(89, (t.altitude - profile.turnStart) / profile.metresPerDegree);
    return { step: 'turn', direction: tilt(deg), pitchDeg: deg, text: steeringData.turnText.replace('{degrees}', deg.toFixed(0)) };
  }
  if (t.verticalSpeed > 15 && t.altitude < t.apoapsis - 3000) {
    return { step: 'coast', direction: east, text: `Engine off: coasting up to the apoapsis (${(t.apoapsis / 1000).toFixed(0)} km)` };
  }
  if (t.periapsis < top) return { step: 'circularise', direction: east, text: 'At the apoapsis: burning sideways (prograde) to round the orbit' };
  return null;
}

// Share of the heat limit above which the plasma blocks the radio (a good Mars entry peaks at ~6 % of the limit, so 4 % = the hot core of the entry).
export const BLACKOUT_HEAT_FRAC = 0.04;
const TOUCHDOWN_HINT = 3; // m/s, matches FlightController TUNING.touchdownLimit.legs

// Entry + landing guide (Flight Assist), the real Mars "7 minutes of terror" sequence:
// heat shield → supersonic chute → retro burn at the last moment (BURN NOW) → gentle touchdown.
export function landingGuide(fc) {
  const t = fc.telemetry;
  if (fc.failed || fc.landed || fc.onGround || !fc.planet.seaLevelDensity) return null;
  if (t.phase !== 'entry' && t.phase !== 'landing') return null;
  const a = assistReadout(fc);
  if (t.heatFlux > 0 && !fc.chuteOpen && t.altitude > 15000) {
    const blackout = t.heatFlux > t.heatLimit * BLACKOUT_HEAT_FRAC; // hot plasma around the ship blocks the radio (real effect)
    return { step: 'entry', blackout, text: blackout ? 'PLASMA BLACKOUT: no radio. The heat shield takes the heat, ride it down' : 'Entry: the heat shield takes the heat. The computer holds the attitude, ride it down' };
  }
  if (!fc.chuteOpen && t.speed > 500) return { step: 'slowing', text: 'Too fast for the parachute yet: the air is slowing you down' };
  if (t.altitude < 200 && t.verticalSpeed > -12) {
    return { step: 'touchdown', text: `Easing down: touchdown under ${TOUCHDOWN_HINT} m/s, nose up` };
  }
  if (a.burnNow) return { step: 'burn', text: 'BURN NOW: retro burn' };
  if (fc.chuteOpen) return { step: 'chute', text: `Parachute out. Wait for BURN NOW (${Number.isFinite(a.stoppingDistance) ? a.stoppingDistance.toFixed(0) : '—'} m to stop)` };
  return { step: 'wait', text: 'Falling: wait for BURN NOW' };
}
