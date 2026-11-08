// Flight pacing: time compression and automatic slow-down (pure, no three.js, testable in node).
//
// Rule of the plan: every minute holds a decision, a strong sensation or a lesson; dead time is compressed.
// Physics never changes: FlightController sub-steps at FIXED_DT whatever the warp (see allowedWarp there).
//
//   const pacer = createPacer();
//   const ctx = paceContext(fc, { ascent, landing, countdown, trimming, aligned });  // facts about the ship
//   for (const name of detector.update(ctx)) pacer.event(name, ctx.t);                // key events → 1×
//   const { warp, auto, label } = pacer.decide(ctx, dtReal);
//   fc.update(dtReal, input, { timeWarp: warp });
//
// Policy (all inside decide()):
//   LAUNCH   countdown, liftoff and the first 35 s of the climb: 1×. Gravity turn: 4× while you follow the guide
//            (pointing within 6° of it, Max-Q and g in the green), else 1×. Circularise: 1×.
//            Coast after engine cut-off: up to 50× (tiers 50/10/4/2) until 10 s before the apoapsis, then 1×.
//   ENTRY    approach: first 8 s at 1× (time to trim the corridor with W/S, 1× while a trim key is down), then up to
//            10× until 5 s before the atmosphere. Heating: 4× (10× in the almost-empty top air), blackout included.
//            Parachute deploy: 1× for a moment, then 4× for the quiet fall down to 2 km; below 2 km, BURN NOW, touchdown: 1×.
//   Key events drop to 1× for a moment and cancel any manual warp: Max-Q warning, engine cut-off, entering the
//   circularise step, debris warning, entry interface, parachute, BURN NOW, below 1 km on Mars.

import { dot, len, cross } from './vec.js';
import { atmosphereTop, airDensity } from './atmosphere.js';
import { predictInterface } from './corridor.js';
import { WARP_IN_AIR, WARP_THIN_AIR, WARP_THIN_DENSITY } from './FlightController.js';

export const WARP_LADDER = [1, 2, 4, 10, 50, 100]; // manual keys (, and .) walk this ladder
export const PACE = {
  climbNoWarp: 35, // s after liftoff before the climb may be warped
  turnWarp: 4,
  turnAlignDeg: 6,
  turnQFrac: 0.6, // of Max-Q
  turnG: 3.6,
  coastWarpMax: 50,
  coastLead: 10, // s before the apoapsis: back to 1×
  approachGrace: 8, // s of game time at 1× at the start of the Mars approach (trim time)
  approachWarpMax: 10,
  approachLead: 5, // s before the atmosphere: back to 1×
  eventHold: 2.5, // s of game time at 1× after an event
  lowMarsAltitude: 1000,
  chuteWarpAltitude: 2000, // m: under the parachute the wait is warped down to here
};

// Time until the apoapsis (s) from the position/velocity, Kepler's equation. null if not bound or not climbing.
export function timeToApoapsis(fc) {
  const r = len(fc.pos), v = len(fc.vel);
  const energy = (v * v) / 2 - fc.mu / r;
  if (energy >= 0) return null;
  const a = -fc.mu / (2 * energy);
  const h = len(cross(fc.pos, fc.vel));
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (fc.mu * a)));
  const vv = dot(fc.vel, fc.up);
  if (e < 1e-6) return null; // circular: no apoapsis to wait for
  const cosE = Math.max(-1, Math.min(1, (1 - r / a) / e));
  let E = Math.acos(cosE); // 0..π on the way up
  if (vv < 0) E = 2 * Math.PI - E;
  const M = E - e * Math.sin(E);
  const n = Math.sqrt(fc.mu / (a * a * a));
  const dtM = vv >= 0 ? Math.PI - M : 3 * Math.PI - M;
  return Math.max(0, dtM / n);
}

// Largest ladder step that cannot overshoot `gameSeconds` within ~1.5 frames of real time.
export function tierFor(gameSeconds, dtReal, cap) {
  let best = 1;
  for (const w of [1, 2, 4, 10, 50, 100]) {
    if (w <= cap && w * Math.max(dtReal, 1 / 60) * 1.5 <= gameSeconds) best = w;
  }
  return best;
}

// Facts about the ship the policy needs. `ascent`/`landing` are ascentGuide(fc) / landingGuide(fc) (or null).
export function paceContext(fc, { ascent = null, landing = null, countdown = false, trimming = false, aligned = true, interface: iface } = {}) {
  const t = fc.telemetry;
  const top = atmosphereTop(fc.planet);
  const mars = fc.planetId === 'mars';
  const approaching = mars && t.altitude > top && t.verticalSpeed < 0 && !fc.landed;
  return {
    t: fc.t, planetId: fc.planetId, phase: t.phase, altitude: t.altitude, atmoTop: top, vVert: t.verticalSpeed,
    throttle: fc.throttle, onGround: fc.onGround, countdown, failed: !!fc.failed, landed: fc.landed, chuteOpen: fc.chuteOpen,
    airDensity: airDensity(fc.planet, t.altitude),
    ascentStep: ascent?.step ?? null, landingStep: landing?.step ?? null, blackout: !!landing?.blackout,
    sinceLiftoff: fc.liftoffT === null ? 0 : fc.t - fc.liftoffT,
    qFrac: t.dynamicPressure / t.maxQ, gLoad: t.gLoad, aligned, trimming,
    tApo: ascent?.step === 'coast' ? timeToApoapsis(fc) : null,
    tInterface: approaching ? (iface !== undefined ? iface : predictInterface(fc)?.time ?? null) : null,
    approaching,
  };
}

// Which key events happened between two contexts (names only; the pacer reacts to them).
export function createEventDetector() {
  let prev = null;
  return {
    reset() { prev = null; },
    update(ctx) {
      const out = [];
      if (prev) {
        if (prev.throttle > 0 && ctx.throttle === 0 && ctx.planetId === 'earth' && ctx.phase !== 'orbit' && ctx.sinceLiftoff > 5) out.push('meco');
        if (ctx.ascentStep === 'circularise' && prev.ascentStep !== 'circularise') out.push('circularise');
        if (ctx.landingStep === 'burn' && prev.landingStep !== 'burn') out.push('burn_now');
        if (ctx.chuteOpen && !prev.chuteOpen) out.push('parachute');
        if (ctx.planetId === 'mars' && prev.altitude >= ctx.atmoTop && ctx.altitude < ctx.atmoTop) out.push('interface');
        if (ctx.planetId === 'mars' && prev.altitude >= PACE.lowMarsAltitude && ctx.altitude < PACE.lowMarsAltitude) out.push('low_mars');
      }
      prev = ctx;
      return out;
    },
  };
}

export function createPacer() {
  const p = { manual: 1, suspendUntil: -Infinity, lastEvent: null };
  return {
    get manual() { return p.manual; },
    get lastEvent() { return p.lastEvent; },
    // , / . keys: step the manual warp along the ladder
    stepManual(dir) {
      const i = Math.max(0, WARP_LADDER.indexOf(p.manual));
      p.manual = WARP_LADDER[Math.max(0, Math.min(WARP_LADDER.length - 1, i + dir))];
    },
    // A key event: drop to 1× now (manual warp too) and hold auto warp off briefly.
    event(name, t, hold = PACE.eventHold) {
      p.manual = 1;
      p.suspendUntil = t + hold;
      p.lastEvent = name;
    },
    // → { warp, auto, reason, label }: warp is the REQUEST (FlightController.allowedWarp applies the physics limits)
    decide(ctx, dtReal = 1 / 60) {
      const one = (reason = null) => ({ warp: 1, auto: false, reason, label: null });
      if (ctx.failed || ctx.landed || ctx.onGround || ctx.countdown) return one();
      if (ctx.t < p.suspendUntil) return one('event');
      const auto = (warp, reason) => (warp > 1 ? { warp, auto: true, reason, label: `AUTO WARP · ${reason}` } : one(reason));
      const manual = () => ({ warp: p.manual, auto: false, reason: null, label: null });

      if (ctx.planetId === 'mars') {
        if (ctx.landingStep === 'burn' || ctx.landingStep === 'touchdown' || ctx.altitude < PACE.lowMarsAltitude || ctx.phase === 'landed') return one();
        // under the open parachute the fall is a quiet wait: 4× until 2 km, then 1× for the powered descent (you decide when to burn)
        if (ctx.chuteOpen) return ctx.altitude > PACE.chuteWarpAltitude && ctx.vVert < 0 ? auto(WARP_IN_AIR, 'parachute descent') : one();
        if (ctx.approaching && ctx.altitude > ctx.atmoTop) { // approach: trim time, then compress the coast
          if (ctx.trimming || ctx.t < PACE.approachGrace) return one('trim');
          const lead = ctx.tInterface === null ? Infinity : ctx.tInterface - PACE.approachLead;
          return auto(tierFor(lead, dtReal, PACE.approachWarpMax), 'approach');
        }
        if (ctx.altitude < ctx.atmoTop) { // heating: the plasma blackout is played at up to 4× (10× in the thin top air)
          const w = ctx.airDensity < WARP_THIN_DENSITY ? WARP_THIN_AIR : WARP_IN_AIR;
          return auto(w, ctx.blackout ? 'plasma blackout' : 'entry heating');
        }
        return manual();
      }

      // Earth ascent
      if (ctx.ascentStep === 'circularise') return one();
      if (ctx.ascentStep === 'coast' && ctx.throttle === 0) {
        const lead = ctx.tApo === null ? 0 : ctx.tApo - PACE.coastLead;
        const w = tierFor(lead, dtReal, PACE.coastWarpMax);
        return w > 1 ? auto(w, 'coasting') : one('coasting');
      }
      if (ctx.ascentStep === 'turn' && ctx.sinceLiftoff > PACE.climbNoWarp && ctx.aligned
          && ctx.qFrac < PACE.turnQFrac && ctx.gLoad < PACE.turnG && ctx.throttle > 0) return auto(PACE.turnWarp, 'gravity turn');
      return manual();
    },
  };
}

