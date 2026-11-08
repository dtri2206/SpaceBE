// Phase objective line + step checklist for the HUD (pure). Built from the real guide steps in flightAssist.js.
//
//   objectiveText(fc, { state, debrisActive })   → one line, e.g. 'Reach orbit: periapsis above 77 km (the apoapsis ≈ 95 km)'
//   createChecklist(kind)                        → { update(step, flags) → { title, steps:[{id,label,status}] } }
//   kind 'ascent': Climb · Gravity turn · Coast · Circularise · Orbit
//   kind 'entry' : Corridor · Blackout · Parachute · Burn · Touchdown
// Steps only move forward (status: 'done' | 'current' | 'todo'); the last one gets a tick when it is reached.

import { atmosphereTop } from './atmosphere.js';
import { ASCENT_PROFILE } from './flightAssist.js';
import { TUNING } from './FlightController.js';

export const ASCENT_STEPS = [
  { id: 'climb', label: 'Climb' }, { id: 'turn', label: 'Gravity turn' }, { id: 'coast', label: 'Coast' },
  { id: 'circularise', label: 'Circularise' }, { id: 'orbit', label: 'Orbit' },
];
export const ENTRY_STEPS = [
  { id: 'corridor', label: 'Corridor' }, { id: 'blackout', label: 'Blackout' }, { id: 'parachute', label: 'Parachute' },
  { id: 'burn', label: 'Burn' }, { id: 'touchdown', label: 'Touchdown' },
];

export function objectiveText(fc, { state, debrisActive = false } = {}) {
  const t = fc.telemetry;
  const km = (m) => (m / 1000).toFixed(0);
  if (fc.failed) return null;
  if (state === 'ORBIT' || t.phase === 'orbit') {
    return debrisActive ? 'Dodge the debris: steer and burn sideways' : 'Press T for the transfer burn to Mars';
  }
  if (fc.planetId === 'earth') {
    return `Reach orbit: periapsis above ${km(atmosphereTop(fc.planet))} km (apo ≈ ${km(ASCENT_PROFILE.targetApoapsis)} km)`;
  }
  if (fc.landed) return 'Touched down: press E to stand up';
  if (fc.chuteOpen || t.phase === 'landing' || state === 'LANDING') return `Touch down under ${TUNING.touchdownLimit.legs} m/s`;
  return 'Enter the corridor, survive the heat';
}

export function createChecklist(kind) {
  const steps = kind === 'ascent' ? ASCENT_STEPS : ENTRY_STEPS;
  let idx = 0;
  let finished = false;
  const indexOf = (id) => steps.findIndex((s) => s.id === id);
  return {
    // step: the guide step id (ascentGuide / landingGuide, or null); complete: orbit reached / landed;
    // blackout: 'before' | 'in' | 'after' the plasma blackout (entry only)
    update(step, { complete = false, blackout = 'before' } = {}) {
      let target = idx;
      if (step !== null && kind === 'ascent') target = indexOf(step);
      if (step !== null && kind === 'entry') {
        const entryStep = { before: 'corridor', in: 'blackout', after: 'parachute' }[blackout];
        const map = { entry: entryStep, slowing: 'parachute', wait: 'parachute', chute: 'burn', burn: 'burn', touchdown: 'touchdown' };
        target = indexOf(map[step] ?? 'corridor');
      }
      if (complete) finished = true;
      idx = Math.max(idx, target < 0 ? idx : target);
      return {
        title: kind === 'ascent' ? 'ASCENT' : 'ENTRY & LANDING',
        steps: steps.map((s, i) => ({
          ...s,
          status: finished ? 'done' : i < idx ? 'done' : i === idx ? 'current' : 'todo',
        })),
      };
    },
  };
}
