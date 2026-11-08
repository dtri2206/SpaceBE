// FlightController — the reusable Newtonian flight core (Role 2). TEAM_PROMPT §6.
//
// Pure JS, no three.js, testable in node. Units inside: m, s, kg, N, rad.
// Position/velocity are relative to the CURRENT planet's center (one planet per scene).
//
// Usage (src/flight/index.js does this with core's events, PLANETS and G0):
//   const fc = new FlightController({ bus: events, planets: PLANETS, g0: G0, planetId: 'earth', shipSpec, start: 'pad' });
//   every frame: fc.update(dt, controls.input)   // controls from cockpitControls.js
//   read: fc.telemetry  (HUD / Flight Assist / black box)
//   Autopilot inputs (autopilot.js), both optional:
//     input.aim = {x,y,z}          unit vector (planet-centred): steer the nose toward it (same turn-rate limits); ignored with input.brake
//     input.throttleTarget = 0..1  set the throttle at once (<= 0 = engine off; > 0 lights the engine, costs an ignition, honours minThrottle)
//   fc.onNotice = (type, data) => {...}            // EVERY flight notice, for HUD/sound (not on the bus)
//
// ShipSpec units follow src/core/contract.js: masses in kg, thrust in N. shipSpec.launch.tempC = launch weather.
//
// On the bus (only names from contract.js):
//   flight:phase  { phase }                 'prelaunch'|'ascent'|'orbit'|'coast'|'entry'|'landing'|'landed'
//   flight:event  { type, t, data }         only FLIGHT_EVENT_TYPES: 'maxq', 'debris_hit', 'blackout', 'skip_off'
//   flight:landed { touchdownSpeed }          touchdown also shuts the engine down (throttle 0, not lit: engine-stop on the
//                                              contact light) and stands the ship upright on its legs within ~1 s
//   flight:failed { endingId, cause, causeId, historyHint }   endingId is a key of ENDINGS, cause is one sentence
// Local notices (fc.onNotice) also include: liftoff, fairing_sep, parachute, maxq_warning, heat_warning, engine_hot,
//   g_high, orbit_achieved, fuel_empty, ignition, no_ignition, debris_near_miss.

import {
  v3, add, sub, scale, dot, cross, len, norm, clone,
  quat, qMul, qNorm, qFromAxisAngle, qRotate, qFromTo,
  LOCAL_FORWARD, LOCAL_UP, LOCAL_RIGHT,
} from './vec.js';
import {
  airDensity, pressureRatio, dynamicPressure, heatFlux, atmosphereTop, HEAT_REAL_SCALE,
} from './atmosphere.js';
import { closestApproach } from './debris.js';
import { createPartEffects } from './effects/index.js';

export const FIXED_DT = 1 / 120;
export const WARP_IN_AIR = 4; // max time warp inside the atmosphere
export const WARP_THIN_AIR = 10; // max time warp where the air is almost vacuum (density below WARP_THIN_DENSITY)
export const WARP_THIN_DENSITY = 1e-4; // kg/m³
/** Heat flux the shield can take. planned: what the flight computer believes (an unseen gouge is not in its plan). */
export function heatLimitFor(ship, { planned = false } = {}) {
  const L = TUNING.heatLimit;
  if (!ship.hasHeatShield) return L.none;
  if (!ship.heatShieldDamaged || (planned && ship.heatShieldUnseen)) return L.shield;
  return ship.heatShieldInspected ? L.damagedMapped : L.damaged;
}

export const TRIM_ACCEL = 6; // m/s²: RCS-style corridor trim before entry (W/S), costs real fuel

// Local notice → contract flight:event type (contract.js FLIGHT_EVENT_TYPES). Others stay local.
const BUS_FLIGHT_EVENTS = { maxq_warning: 'maxq', debris_hit: 'debris_hit', blackout: 'blackout', skip_off: 'skip_off', part_failure: 'part_failure' }; // part_failure: a chosen part failed (./effects/)

// Plain-sentence causes for flight:failed (contract: "cause is one plain sentence").
const CAUSES = {
  engine_overheat: 'The engine ran too hot for too long and blew apart.',
  max_q_exceeded: 'The rocket went too fast in thick air and the aerodynamic load tore it apart.',
  g_force_blackout: 'The g-force was so high that the pilot blacked out and lost the ship.',
  no_heat_shield: 'With no heat shield, the ship burned up on atmospheric entry.',
  heat_shield_damaged: 'The damaged heat shield let hot plasma in during entry.',
  heat_shield_unseen: 'A debris strike in Earth orbit had damaged the heat shield, and no one inspected it. On entry, hot gas got in.',
  pad_fire: 'A wiring spark in a pure-oxygen cabin started a fire during the pad test; in pure oxygen it spread in seconds.',
  heat_overload: 'The entry was too fast and steep, and the heat shield could not take it.',
  seal_failure_cold: 'The cheap seals went stiff in the cold, leaked hot gas, and the rocket broke up.',
  crash_landing: 'The ship hit the ground too fast.',
  tipped_over: 'The ship landed tilted and fell over.',
  debris_impact: 'A piece of space debris hit the ship.',
  out_of_fuel: 'Out of fuel on a path that never comes back: the ship drifts forever.',
  skipped_off: 'The entry was too shallow, so the ship skipped off the atmosphere into deep space.',
};

// Tunables (TODO tune in playtests). Heat limits are in GAME units (see atmosphere.js).
export const TUNING = {
  maxQ: 40000, // Pa structural limit (real rockets see ~30–35 kPa at Max-Q)
  maxQWarnFrac: 0.8,
  gWarn: 4, // g: vision starts tunnelling
  gSustainedLimit: 6, // g held for gSustainedTime → blackout → loss of vehicle
  gSustainedTime: 4,
  gInstantLimit: 12,
  // W/m² (game units); a good Mars entry peaks ≈ 1e4. damagedMapped: the gouge was found by inspection, so the computer
  // knows where it is and rolls the ship to keep that edge out of the hottest flow (a little better than blind damage).
  heatLimit: { none: 4e3, damaged: 7e3, damagedMapped: 1e4, shield: 2e5 },
  chuteMaxSpeed: 500, // m/s: supersonic chute (Perseverance opened at about Mach 1.7)
  chuteMaxAltitude: 15000, // m
  heatGrace: 1.0, // s above the limit before failure
  touchdownLimit: { legs: 3, noLegs: 1 }, // m/s
  uprightCos: Math.cos((20 * Math.PI) / 180),
  turnAccel: { rcs: 0.8, noRcs: 0.15 }, // rad/s²
  maxTurnRate: 0.6, // rad/s
  throttleRate: 0.6, // per second while Q/E held
  engineHeatPerSec: { S: 0.0015, M: 0.002, L: 0.004 }, // at 100% throttle: L overheats after ~250 s, M ~500 s
  engineCoolPerSec: 0.01,
  strandedGrace: 5, // s with no fuel on a trajectory that never comes back
  coldSealFailWindow: [55, 75], // s after liftoff (Challenger broke up at T+73 s)
  heatWarnFrac: 0.7,
  nearMissDistance: 15, // m
  rcsAccel: { rcs: 3, noRcs: 1 }, // m/s²: sideways RCS push requested with input.rcs (debris dodge)
  collisionWarnTime: 20, // s: warn when a piece will pass closer than its danger radius within this time
};

// Convert a ShipSpec (contract units: kg, N) into internal physics params with safe defaults.
export function shipParams(spec = {}) {
  const s = spec.stats ?? {};
  const pump = spec.engines?.[0]?.pump ?? 'M';
  return {
    // guards: a half-built ShipSpec must never divide by zero or go negative
    dryMass: Math.max(100, Number(s.dryMass) || 6000),
    fuelMass: Math.max(0, Number(s.fuelMass ?? 14000) || 0),
    thrustVac: Math.max(0, Number(s.thrust ?? 300000) || 0),
    ispSL: Math.max(1, Number(s.ispSL) || 300),
    ispVac: Math.max(1, Number(s.ispVac) || 330),
    // m² (drag coefficient × reference area). A heat shield is a wide aeroshell: Mars air is so thin
    // that real landers need a big blunt shield + a supersonic parachute + engines.
    cdA: s.cdA ?? ((s.hasHeatShield ?? true) ? 80 : 3),
    ascentCdA: s.ascentCdA ?? 3, // on the way up the shield sits inside a slim fairing
    chuteCdA: (s.hasParachute ?? true) ? (s.chuteCdA ?? 300) : 0,
    noseRadius: s.noseRadius ?? 1.5, // m (blunt capsule)
    hasRCS: s.hasRCS ?? true,
    hasLegs: s.hasLegs ?? true,
    hasHeatShield: s.hasHeatShield ?? true,
    heatShieldDamaged: s.heatShieldDamaged ?? false,
    heatShieldInspected: false, // the strike gouge was found by the RCS camera sweep
    heatShieldUnseen: false, // true while a debris-strike gouge has not been found: the flight computer's corridor ignores it
    coldRatedSeals: s.coldRatedSeals ?? true,
    armorHits: s.armorHits ?? 0,
    radius: s.radius ?? 2, // m, collision radius of the ship
    // Real engines: most can't throttle below ~40 % and have a limited number of restarts.
    // Defaults keep the arcade-friendly behaviour; Role 1's ShipSpec can set them per engine.
    minThrottle: s.minThrottle ?? 0,
    ignitions: s.ignitions ?? Infinity,
    pump,
  };
}

export class FlightController {
  constructor({ bus, planets, g0, planetId = 'earth', shipSpec, start = 'pad', scenario, fuel, rng = Math.random } = {}) {
    if (!planets?.[planetId]) throw new Error(`FlightController: unknown planet "${planetId}"`);
    if (!(g0 > 0)) throw new Error('FlightController: pass g0 (standard gravity G0 from core)');
    this.g0 = g0;
    this.bus = bus ?? { emit() {} };
    this.onNotice = null;
    this.planetId = planetId;
    this.planet = planets[planetId];
    this.mu = this.planet.g * this.planet.radius ** 2; // GM = g·R²
    // the parts the player chose act in flight (./effects/, built by Role 1 with all roles' agreement): a launch from
    // the pad starts a new flight record; the later scenes of the same launch carry on with it
    // (not enumerable: it holds functions, and prediction copies and snapshots take only plain fields)
    Object.defineProperty(this, 'fx', { value: createPartEffects(shipSpec, { fresh: start === 'pad' && planetId === 'earth', rng }), writable: true, enumerable: false });
    this.ship = this.fx.value('params', shipParams(shipSpec), { fc: this });
    this.scenario = scenario ?? { tempC: shipSpec?.launch?.tempC ?? 15 }; // launch weather (Cold Morning ending)
    this.rng = rng;

    this.fuel = fuel ?? this.ship.fuelMass; // carry leftover fuel between scenes
    this.throttle = 0;
    this.engineLit = false;
    this.holdDown = false; // launch clamps: while true the rocket stays on the pad whatever the thrust (countdown)
    this.ignitionsLeft = this.ship.ignitions;
    this.armorLeft = this.ship.armorHits;
    this.obstacles = [];
    this.engineTemp = 0; // 0..1, 1 = failure
    this.omega = v3(); // world-frame angular velocity (rad/s)
    this.t = 0; // mission time since controller start
    this.liftoffT = null;
    this.accumulator = 0;
    this.warpEffective = 1;
    this.trimmedDv = 0; // m/s spent on corridor trim
    this.rcsDv = 0; // m/s spent on input.rcs pushes (debris dodge)
    this.failed = null;
    this.chuteOpen = false;
    this.landed = false;
    this.onGround = false;
    this.phase = null;
    this._flags = {};
    this._timers = { g: 0, heat: 0, stranded: 0 };
    this._wasInAtmosphere = false;
    this._coldSealFailAt = null;
    this._lastAccel = v3();
    this._lastNonGravAccel = 0;

    this.setStart(start);
  }

  // --- start conditions -----------------------------------------------------
  // 'pad': standing on the surface. {altitude, speed, flightPathDeg, facing?}: free flight (e.g. Mars entry).
  setStart(start) {
    const R = this.planet.radius;
    const up = v3(0, 1, 0);
    if (start === 'pad') {
      this.pos = scale(up, R);
      this.vel = v3();
      this.orient = quat(); // nose (+Y local) = up
      this.onGround = true;
      this.inFairing = true;
      this._setPhase('prelaunch');
      return;
    }
    const alt = start.altitude ?? 50000;
    const speed = start.speed ?? 0;
    const fpa = ((start.flightPathDeg ?? 0) * Math.PI) / 180; // negative = descending
    this.pos = scale(up, R + alt);
    // horizontal direction = +X
    this.vel = v3(Math.cos(fpa) * speed, Math.sin(fpa) * speed, 0);
    // default: heat shield (tail) along velocity, nose retrograde (entry). start.facing = 'prograde' for orbits.
    const along = start.facing === 'prograde' ? norm(this.vel) : norm(scale(this.vel, -1));
    this.orient = qFromTo(LOCAL_FORWARD, speed > 0 ? along : up);
    this.onGround = false;
    this.inFairing = false;
    this._setPhase(this._computePhase());
  }

  // --- derived quantities ---------------------------------------------------
  get mass() { return this.ship.dryMass + this.fuel; }
  get forward() { return qRotate(this.orient, LOCAL_FORWARD); }
  get up() { return norm(this.pos); }
  get altitude() { return len(this.pos) - this.planet.radius; }

  isp(altitude = this.altitude) {
    const p = pressureRatio(this.planet, altitude);
    return this.ship.ispVac + (this.ship.ispSL - this.ship.ispVac) * p;
  }

  // Thrust at current conditions (N). Thrust scales with Isp at constant mass flow.
  thrustNow(altitude = this.altitude) {
    if (this.fuel <= 0) return 0;
    return this.ship.thrustVac * (this.isp(altitude) / this.ship.ispVac);
  }

  deltaVLeft() {
    return this.ship.ispVac * this.g0 * Math.log(this.mass / this.ship.dryMass);
  }

  orbit() {
    const r = len(this.pos);
    const v = len(this.vel);
    const h = len(cross(this.pos, this.vel));
    const energy = (v * v) / 2 - this.mu / r;
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (this.mu * this.mu)));
    const R = this.planet.radius;
    if (Math.abs(energy) < 1e-9) return { a: Infinity, e: 1, periapsis: (h * h) / (2 * this.mu) - R, apoapsis: Infinity };
    const a = -this.mu / (2 * energy);
    if (energy < 0) {
      const eb = Math.min(e, 1); // bound orbit (e can round to 1 for a straight up/down path)
      return { a, e, periapsis: a * (1 - eb) - R, apoapsis: a * (1 + eb) - R };
    }
    return { a, e, periapsis: (h * h) / (this.mu * (1 + e)) - R, apoapsis: Infinity };
  }

  get telemetry() {
    const alt = this.altitude;
    const up = this.up;
    const speed = len(this.vel);
    const vVert = dot(this.vel, up);
    const vHoriz = len(sub(this.vel, scale(up, vVert)));
    const rho = airDensity(this.planet, alt);
    const r = len(this.pos);
    const orb = this.orbit();
    const fxCtx = { fc: this, dt: 0, alt, speed, phase: this.phase };
    const thrust = Math.max(0, this.fx.value('thrust', this.thrustNow(alt) * this.throttle, fxCtx)); // what the engines really give (an engine out, the pad holding back)
    const gLocal = this.mu / (r * r);
    const hf = vVert < 0 ? heatFlux(this.planetId, rho, speed, this.ship.noseRadius) : 0;
    return {
      t: this.t,
      phase: this.phase,
      altitude: alt,
      speed,
      verticalSpeed: vVert,
      horizontalSpeed: vHoriz,
      throttle: this.throttle,
      fuel: this.fuel,
      fuelFrac: this.ship.fuelMass > 0 ? this.fuel / this.ship.fuelMass : 0,
      mass: this.mass,
      deltaVLeft: this.deltaVLeft(),
      isp: this.isp(alt),
      thrust,
      twr: Math.max(0, this.fx.value('thrust', this.thrustNow(alt), fxCtx)) / (this.mass * gLocal),
      gravity: gLocal,
      airDensity: rho,
      dynamicPressure: dynamicPressure(rho, speed),
      maxQ: this._maxQNow ?? TUNING.maxQ,
      gLoad: this._lastNonGravAccel / this.g0,
      heatFlux: hf,
      heatFluxRealEq: hf * HEAT_REAL_SCALE,
      heatLimit: this._heatLimit(),
      engineTemp: this.engineTemp,
      engineLit: this.engineLit,
      ignitionsLeft: this.ignitionsLeft,
      minThrottle: this.ship.minThrottle,
      armorLeft: this.armorLeft,
      obstacles: this.obstacles.length,
      collisionWarning: this.obstacles.length ? this._collisionWarning() : null,
      apoapsis: orb.apoapsis,
      periapsis: orb.periapsis,
      eccentricity: orb.e,
      circularSpeed: Math.sqrt(this.mu / r),
      escapeSpeed: Math.sqrt((2 * this.mu) / r),
      onGround: this.onGround,
      landed: this.landed,
      failed: this.failed,
    };
  }

  // --- main loop -------------------------------------------------------------
  // input: { pitch, yaw, throttleUp, throttleDown, cutoff, brake } (see cockpitControls.js)
  // opts.timeWarp: requested warp. Honoured as follows (physics is ALWAYS sub-stepped at FIXED_DT, never a bigger dt):
  //   on the ground: 1x · inside the atmosphere: up to WARP_IN_AIR (4x), up to WARP_THIN_AIR (10x) where the air is
  //   almost vacuum · above the atmosphere with the engine off and no brake: whatever was asked (the pacer uses ≤ 100x).
  // opts.stopOnNotice: end this call right after a flight notice fired while warping, so the HUD can slow down at once.
  // opts.maxSteps: physics steps allowed per call (default 1500). When a slow machine would need more, the extra game
  // time is dropped instead of spiralling, and the effective warp (this.warpEffective) goes down.
  allowedWarp(requested, input = {}) {
    const warp = Math.max(1, Number(requested) || 1);
    if (this.onGround) return 1;
    const alt = this.altitude;
    if (alt < atmosphereTop(this.planet)) {
      const thin = airDensity(this.planet, alt) < WARP_THIN_DENSITY;
      return Math.min(warp, thin ? WARP_THIN_AIR : WARP_IN_AIR);
    }
    const coasting = this.throttle === 0 && !input.brake;
    return coasting ? warp : Math.min(warp, WARP_IN_AIR);
  }

  update(dt, input = {}, opts = {}) {
    if (this.failed || dt <= 0) return;
    const warp = this.allowedWarp(opts.timeWarp ?? 1, input);
    const maxSteps = opts.maxSteps ?? 1500;
    const frame = Math.min(dt, 0.25);
    this.accumulator += frame * warp;
    let steps = 0;
    this._noticeSeen = false;
    while (this.accumulator >= FIXED_DT && steps < maxSteps && !this.failed) {
      this._step(FIXED_DT, input);
      this.accumulator -= FIXED_DT;
      steps++;
      if (opts.stopOnNotice && this._noticeSeen && warp > 1) { this.accumulator = 0; break; } // a notice: let the pacer drop to 1× now
    }
    if (steps >= maxSteps && this.accumulator >= FIXED_DT) this.accumulator = 0; // over budget: drop the rest
    this.warpEffective = frame > 0 ? Math.max(1, Math.min(warp, (steps * FIXED_DT) / frame)) : 1;
  }

  _step(dt, input) {
    this.t += dt;
    const T = TUNING;

    // throttle (min throttle + limited ignitions; X is the only way to shut down below min throttle)
    const minT = this.ship.minThrottle;
    if (this.landed) input = { ...input, throttleUp: false, throttleDown: false, throttleTarget: undefined, cutoff: true }; // landed: engine stays off (no Mars liftoff is flown here)
    if (input.cutoff) this.throttle = 0;
    if (input.throttleUp) {
      if (this.throttle === 0 && !this.engineLit && !this._ignite()) {
        // no restart left: throttle stays at 0
      } else {
        this.throttle = Math.min(1, Math.max(minT, this.throttle + T.throttleRate * dt));
      }
    }
    if (input.throttleDown && this.throttle > 0) this.throttle = Math.max(minT > 0 ? minT : 0, this.throttle - T.throttleRate * dt);
    const target = input.throttleTarget;
    if (Number.isFinite(target)) {
      if (target <= 0) this.throttle = 0;
      else if (this.throttle === 0 && !this.engineLit && !this._ignite()) this.throttle = 0; // no restart left
      else this.throttle = Math.min(1, Math.max(minT, target));
    }

    // rotation (brake = auto-point retrograde, then burn)
    let throttle = this.throttle;
    const speed = len(this.vel);
    if (input.brake && !this.onGround && speed > 0.5) {
      const retro = norm(scale(this.vel, -1));
      this._steerToward(retro, dt);
      const aligned = dot(this.forward, retro) > Math.cos((8 * Math.PI) / 180);
      throttle = aligned && (this.engineLit || this._ignite()) ? 1 : 0;
      this._braking = true;
    } else {
      const aim = input.aim;
      if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y) && Number.isFinite(aim.z) && (aim.x || aim.y || aim.z)) this._steerToward(norm(aim), dt);
      else this._steerInput(input.pitch ?? 0, input.yaw ?? 0, dt);
      this._braking = false;
    }
    this._integrateRotation(dt);
    if (input.trim) this._trimNudge(input.trim, dt);
    if (input.rcs) this._rcsPush(input.rcs, dt);
    // engine stays "lit" while the throttle is up or a brake burn is in progress
    if (this.throttle === 0 && !this._braking) this.engineLit = false;
    else if (this.throttle > 0) this.engineLit = this.engineLit || this._ignite();

    // forces
    const alt = this.altitude;
    const up = this.up;
    const r = len(this.pos);
    const gravityAcc = scale(up, -this.mu / (r * r));
    const fxCtx = { fc: this, dt, alt, speed, phase: this.phase };
    const thrustN = Math.max(0, this.fx.value('thrust', this.thrustNow(alt) * throttle, fxCtx)); // an engine out, the pad holding back…
    const thrustAcc = scale(this.forward, thrustN / this.mass);
    const rho = airDensity(this.planet, alt);
    this._updateParachute(alt, speed);
    if (this.inFairing && (this.phase === 'orbit' || (alt > atmosphereTop(this.planet) && dot(this.vel, up) < 0))) {
      this.inFairing = false; // fairing jettisoned in space: the wide entry shield is exposed
      this._event('fairing_sep');
    }
    const bodyCdA = this.inFairing ? this.ship.ascentCdA : this.ship.cdA;
    const cdA = bodyCdA + (this.chuteOpen ? this.fx.value('chuteCdA', this.ship.chuteCdA, fxCtx) : 0); // only the canopies open and whole (./effects/landing.js)
    const dragN = 0.5 * rho * speed * speed * cdA;
    const dragAcc = speed > 0 ? scale(norm(this.vel), -dragN / this.mass) : v3();
    const nonGrav = add(thrustAcc, dragAcc);
    let acc = add(gravityAcc, nonGrav);

    // fuel burn: mdot = F / (Isp · g0)
    if (thrustN > 0) {
      this.fuel = Math.max(0, this.fuel - (thrustN / (this.isp(alt) * this.g0)) * dt);
      if (this.fuel === 0) this._event('fuel_empty');
    }

    // ground contact
    if (this.onGround) {
      if (dot(acc, up) <= 0 || this.holdDown) {
        // held by the ground (or by the launch clamps during the countdown)
        this.vel = v3();
        this.pos = scale(up, this.planet.radius);
        if (this.landed) this._levelOnLegs(dt);
        this._lastNonGravAccel = this.mu / (r * r); // you feel 1 local g standing
        this._updateEngineHeat(thrustN > 0 ? throttle : 0, dt);
        return;
      }
      this.onGround = false;
      this.landed = false;
      if (this.liftoffT === null) {
        this.liftoffT = this.t;
        this._event('liftoff');
        this._scheduleColdSealFailure();
        this.fx.fire('liftoff', fxCtx);
      }
    }

    // semi-implicit Euler
    this.vel = add(this.vel, scale(acc, dt));
    this.pos = add(this.pos, scale(this.vel, dt));
    this._lastNonGravAccel = len(nonGrav);
    this._lastAccel = acc;

    this._updateEngineHeat(thrustN > 0 ? throttle : 0, dt);
    this._checkLimits(dt, rho);
    if (this.failed) return;
    this._moveObstacles(dt);
    if (this.failed) return;
    // what the chosen parts do this step (an engine failing, a structure giving way…): may end the flight
    const partFailure = this.fx.fire('step', { ...fxCtx, rho, q: dynamicPressure(rho, speed) });
    if (partFailure) return this._fail(partFailure.endingId, partFailure.cause, partFailure.data ?? {}, partFailure.historyHint ?? null);
    this._checkTouchdown();
    if (this.failed || this.onGround) return;
    this._checkStranded(dt);
    this._setPhase(this._computePhase());
  }

  // Corridor trim (Mars approach, above the atmosphere, engine off): a small RCS-style push perpendicular to the
  // velocity, in the orbit plane. dir +1 = toward 'up' (shallower entry), -1 = toward the planet (steeper).
  // Costs real fuel through the rocket equation (dm = m · Δv / ve). Pure physics: velocity changes, nothing else.
  _trimNudge(dir, dt) {
    if (this.onGround || this.fuel <= 0 || !this.ship.hasRCS || this.throttle > 0 || !this.planet.seaLevelDensity) return;
    if (this.altitude < atmosphereTop(this.planet)) return;
    const vh = norm(this.vel);
    const up = this.up;
    const perp = sub(up, scale(vh, dot(up, vh)));
    if (len(perp) < 1e-6) return;
    const dv = TRIM_ACCEL * dt * Math.sign(dir);
    this.vel = add(this.vel, scale(norm(perp), dv));
    this.fuel = Math.max(0, this.fuel - this.mass * (Math.abs(dv) / (this.ship.ispVac * this.g0)));
    this.trimmedDv = (this.trimmedDv ?? 0) + Math.abs(dv);
  }

  // RCS push: input.rcs = { x, y, z } planet-centred acceleration request (m/s²), clamped to the ship's RCS limit
  // (TUNING.rcsAccel). No rotation needed (thrusters fire on every side). Costs fuel through the rocket equation.
  _rcsPush(req, dt) {
    if (this.onGround || this.fuel <= 0) return;
    const a = v3(Number(req.x) || 0, Number(req.y) || 0, Number(req.z) || 0);
    const m = len(a);
    if (m < 1e-9) return;
    const limit = this.ship.hasRCS ? TUNING.rcsAccel.rcs : TUNING.rcsAccel.noRcs;
    const dv = Math.min(m, limit) * dt;
    this.vel = add(this.vel, scale(a, dv / m));
    this.fuel = Math.max(0, this.fuel - this.mass * (dv / (this.ship.ispVac * this.g0)));
    this.rcsDv = (this.rcsDv ?? 0) + dv;
  }

  // --- rotation ----------------------------------------------------------------
  _turnAccel() { return this.fx.value('turnAccel', this.ship.hasRCS ? TUNING.turnAccel.rcs : TUNING.turnAccel.noRcs, { fc: this }); } // the steering the player chose (gimbal, RCS)

  _steerInput(pitch, yaw, dt) {
    const a = this._turnAccel();
    // W (pitch -1) = nose down: rotation about local +X by a negative angle (Y → -Z).
    const desired = add(
      scale(qRotate(this.orient, LOCAL_RIGHT), pitch * TUNING.maxTurnRate),
      scale(qRotate(this.orient, LOCAL_UP), -yaw * TUNING.maxTurnRate),
    );
    // No input → stability assist damps rotation to zero.
    this._approachOmega(desired, a * dt);
  }

  _steerToward(dir, dt) {
    const f = this.forward;
    const axis = cross(f, dir);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(f, dir))));
    let desired;
    if (len(axis) < 1e-6) {
      desired = angle > 3 ? scale(qRotate(this.orient, LOCAL_RIGHT), TUNING.maxTurnRate) : v3();
    } else {
      desired = scale(norm(axis), Math.min(TUNING.maxTurnRate, 1.5 * angle));
    }
    this._approachOmega(desired, this._turnAccel() * dt);
  }

  _approachOmega(target, maxDelta) {
    const diff = sub(target, this.omega);
    const d = len(diff);
    this.omega = d <= maxDelta ? target : add(this.omega, scale(diff, maxDelta / d));
  }

  _integrateRotation(dt) {
    const w = len(this.omega);
    if (w < 1e-9) return;
    this.orient = qNorm(qMul(qFromAxisAngle(this.omega, w * dt), this.orient));
  }

  // Auto-deploys on descent below the chute's speed/altitude limits (Tier 0; a key/button later).
  _updateParachute(alt, speed) {
    if (this.chuteOpen || !this.ship.chuteCdA || this.inFairing) return;
    if (this.onGround || dot(this.vel, this.up) >= 0) return;
    const lim = this.fx.value('chuteDeploy', { maxSpeed: TUNING.chuteMaxSpeed, maxAltitude: TUNING.chuteMaxAltitude }, { fc: this, alt, speed }); // the chutes the player chose (./effects/landing.js)
    if (alt < lim.maxAltitude && speed < lim.maxSpeed && airDensity(this.planet, alt) > 0) {
      this.chuteOpen = true;
      this._event('parachute', { altitude: alt, speed });
    }
  }

  // --- engine ignitions -----------------------------------------------------------
  _ignite() {
    if (this.engineLit) return true;
    if (this.fuel <= 0) return false;
    if (this.ignitionsLeft <= 0) {
      this._event('no_ignition');
      return false;
    }
    this.ignitionsLeft -= 1;
    if (!this.fx.value('ignite', true, { fc: this })) { // the igniter is spent, but the engine did not light
      this._flags.ignition_failed = false;
      this._event('ignition_failed', { left: this.ignitionsLeft });
      return false;
    }
    this.engineLit = true;
    this._flags.ignition = false; // every ignition is reported
    this._event('ignition', { left: this.ignitionsLeft });
    return true;
  }

  // --- obstacles (debris) ----------------------------------------------------------
  setObstacles(list) {
    this.obstacles = list.map((o) => ({ ...o, pos: { ...o.pos }, vel: { ...o.vel } }));
  }

  _moveObstacles(dt) {
    if (!this.obstacles.length) return;
    const keep = [];
    for (const o of this.obstacles) {
      // debris orbits too: same gravity as the ship (otherwise the "falling" ship drifts away from it)
      const ro = len(o.pos);
      o.vel = add(o.vel, scale(o.pos, (-this.mu / (ro * ro * ro)) * dt));
      o.pos = add(o.pos, scale(o.vel, dt));
      const d = len(sub(o.pos, this.pos));
      if (!(d >= o.minDist)) o.minDist = d; // closest centre distance so far (rating)
      if (d <= o.radius + this.ship.radius) {
        // what the hit does depends on the armour, the skin and the shield the player chose (./effects/structure.js)
        const hit = this.fx.value('debrisHit', { absorbed: this.armorLeft > 0, armorUsed: this.armorLeft > 0 ? 1 : 0, damage: 0 }, { fc: this, obstacle: o });
        if (hit.absorbed) {
          this.armorLeft = Math.max(0, this.armorLeft - (hit.armorUsed ?? 0));
          this._flags.debris_hit = false;
          // An Earth-orbit strike also gouges the heat shield, on the side the crew cannot see (Columbia, 2003).
          let shield = false;
          if (this.planetId === 'earth' && this.ship.hasHeatShield && !this.ship.heatShieldDamaged) {
            this.ship.heatShieldDamaged = true;
            this.ship.heatShieldUnseen = true;
            shield = true;
          }
          this._event('debris_hit', { id: o.id, armorLeft: this.armorLeft, radius: o.radius, armorUsed: hit.armorUsed ?? 0, ...(shield && { heatShieldDamaged: true }) }); // armorUsed 0: the skin or wall took it
          continue; // absorbed: the piece is gone
        }
        this._fail('rud', 'debris_impact', { id: o.id, radius: o.radius });
        return;
      }
      if (!o.nearMissed && d < TUNING.nearMissDistance + o.radius) {
        o.nearMissed = true;
        this._flags.debris_near_miss = false;
        this._event('debris_near_miss', { id: o.id, distance: d });
      }
      if (d < 50000) keep.push(o); // forget pieces far behind
    }
    this.obstacles = keep;
  }

  // Most dangerous piece ahead: will pass inside its danger radius soonest.
  _collisionWarning() {
    let best = null;
    for (const o of this.obstacles) {
      const ca = closestApproach(this.pos, this.vel, o);
      const danger = (o.radius + this.ship.radius) * 1.5;
      if (ca.timeToClosest > 0 && ca.timeToClosest < TUNING.collisionWarnTime && ca.missDistance < danger) {
        if (!best || ca.timeToClosest < best.timeToClosest) best = { id: o.id, ...ca };
      }
    }
    return best;
  }

  // --- limits & failures -------------------------------------------------------
  _heatLimit() {
    // base limit from the shield state (damaged / damaged but inspected and mapped: heatLimitFor), then the shield the
    // player chose (./effects/structure.js)
    return this.fx.value('heatLimit', heatLimitFor(this.ship), { fc: this });
  }

  _updateEngineHeat(throttle, dt) {
    const T = TUNING;
    if (throttle > 0.9) {
      this.engineTemp += (T.engineHeatPerSec[this.ship.pump] ?? T.engineHeatPerSec.M) * (throttle - 0.9) * 10 * dt;
    } else if (throttle < 0.8) {
      this.engineTemp = Math.max(0, this.engineTemp - T.engineCoolPerSec * dt);
    }
    if (this.engineTemp > 0.8) this._event('engine_hot', { temp: this.engineTemp });
    else if (this.engineTemp < 0.7) this._flags.engine_hot = false;
    if (this.engineTemp >= 1) this._fail('rud', 'engine_overheat');
  }

  _checkLimits(dt, rho) {
    const T = TUNING;
    const speed = len(this.vel);
    const q = dynamicPressure(rho, speed);
    const maxQ = this._maxQNow = this.fx.value('maxQ', T.maxQ, { fc: this, dt, rho, speed, q }); // the structure the player chose
    if (q > maxQ * T.maxQWarnFrac) this._event('maxq_warning', { q });
    else if (q < maxQ * 0.6) this._flags.maxq_warning = false;
    if (q > maxQ) return this._fail('rud', 'max_q_exceeded', { q });

    const g = this._lastNonGravAccel / this.g0;
    if (g > T.gWarn) this._event('g_high', { g });
    else if (g < T.gWarn * 0.8) this._flags.g_high = false;
    this._timers.g = g > T.gSustainedLimit ? this._timers.g + dt : 0;
    if (g > T.gInstantLimit || this._timers.g > T.gSustainedTime) {
      this._event('blackout', { g });
      return this._fail('rud', 'g_force_blackout', { g });
    }

    // Entry heating: only while descending (the nose cone/fairing protects on ascent).
    if (dot(this.vel, this.up) < 0) {
      const hf = heatFlux(this.planetId, rho, speed, this.ship.noseRadius);
      if (hf > this._heatLimit() * T.heatWarnFrac) this._event('heat_warning', { heatFlux: hf, limit: this._heatLimit() });
      else if (hf < this._heatLimit() * 0.5) this._flags.heat_warning = false;
      this._timers.heat = hf > this._heatLimit() ? this._timers.heat + dt : 0;
      if (this._timers.heat > T.heatGrace) {
        if (!this.ship.hasHeatShield) return this._fail('burnup', 'no_heat_shield');
        if (this.ship.heatShieldDamaged) return this._fail('theFoam', this.ship.heatShieldUnseen ? 'heat_shield_unseen' : 'heat_shield_damaged', {}, 'columbia');
        return this._fail('burnup', 'heat_overload');
      }
    }

    // Challenger demo: cheap seals + cold launch → failure a minute into flight.
    if (this._coldSealFailAt !== null && this.t >= this._coldSealFailAt) {
      return this._fail('coldMorning', 'seal_failure_cold', { tempC: this.scenario.tempC }, 'challenger');
    }
  }

  _scheduleColdSealFailure() {
    const cold = (this.scenario.tempC ?? 15) < 5;
    if (cold && !this.ship.coldRatedSeals) {
      const [a, b] = TUNING.coldSealFailWindow;
      this._coldSealFailAt = this.t + a + (b - a) * this.rng();
    }
  }

  _checkTouchdown() {
    if (this.altitude > 0) return;
    const up = this.up;
    const speed = len(this.vel);
    const limit = this.fx.value('touchdownLimit', this.ship.hasLegs ? TUNING.touchdownLimit.legs : TUNING.touchdownLimit.noLegs, { fc: this }); // the legs the player chose
    const upright = dot(this.forward, up) >= TUNING.uprightCos;
    this.pos = scale(up, this.planet.radius);
    if (speed <= limit && upright) {
      this.landingSpeed = speed;
      this.throttle = 0; // engine cut at contact (Apollo's contact light, Falcon's shutdown): a landed ship stays down
      this.engineLit = false;
      this.vel = v3();
      this.omega = v3();
      this.onGround = true;
      this.landed = true;
      this.throttle = 0; // engine-stop on touchdown: a hover throttle left on would lift the ship straight off again
      this.engineLit = false;
      this._braking = false;
      this._setPhase('landed');
      this.fx.fire('end', { fc: this, landed: true, touchdownSpeed: speed });
      this.bus.emit('flight:landed', { touchdownSpeed: speed });
    } else {
      this._fail('rud', speed > limit ? 'crash_landing' : 'tipped_over', { touchdownSpeed: speed });
    }
  }

  // Landed ships sit upright on their legs: ease the nose onto local up (time constant 0.25 s, so ~1 s to settle).
  _levelOnLegs(dt) {
    const up = this.up;
    const f = this.forward;
    const axis = cross(f, up);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(f, up))));
    if (angle < 1e-4) return;
    const step = angle < 1e-3 ? angle : angle * (1 - Math.exp(-dt / 0.25));
    const ax = len(axis) < 1e-9 ? qRotate(this.orient, LOCAL_RIGHT) : axis;
    this.orient = qNorm(qMul(qFromAxisAngle(ax, step), this.orient));
    this.omega = v3();
  }

  // No fuel + a trajectory that never re-enters the atmosphere = stranded → Adrift.
  _checkStranded(dt) {
    if (this.fuel > 0) { this._timers.stranded = 0; return; }
    const orb = this.orbit();
    const top = atmosphereTop(this.planet);
    const escaping = orb.e >= 1 && dot(this.vel, this.up) > 0 && this.altitude > top;
    const neverReturns = escaping || orb.periapsis > top;
    this._timers.stranded = neverReturns ? this._timers.stranded + dt : 0;
    if (this._timers.stranded > TUNING.strandedGrace) {
      const skipped = this._wasInAtmosphere && orb.e >= 1;
      if (skipped) this._event('skip_off');
      this._fail('adrift', skipped ? 'skipped_off' : 'out_of_fuel');
    }
  }

  _computePhase() {
    if (this.landed) return 'landed';
    if (this.onGround) return this.liftoffT === null ? 'prelaunch' : 'landed';
    const top = atmosphereTop(this.planet);
    const alt = this.altitude;
    const inAtmo = alt < top;
    if (inAtmo) this._wasInAtmosphere = true;
    const orb = this.orbit();
    if (orb.periapsis > top) {
      if (!this._flags.orbit_achieved && this.liftoffT !== null) this._event('orbit_achieved', { apoapsis: orb.apoapsis, periapsis: orb.periapsis });
      return 'orbit';
    }
    if (dot(this.vel, this.up) >= 0) return this.liftoffT !== null ? 'ascent' : 'coast';
    return alt > Math.min(10000, top * 0.15) ? 'entry' : 'landing';
  }

  _setPhase(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.bus.emit('flight:phase', { phase });
  }

  // one-shot events (re-armed by clearing the flag)
  _event(type, data = {}) {
    if (this._flags[type]) return;
    this._flags[type] = true;
    this._noticeSeen = true;
    this.onNotice?.(type, data);
    const busType = BUS_FLIGHT_EVENTS[type];
    if (busType) this.bus.emit('flight:event', { type: busType, t: this.t, data });
  }

  /** Public failure path for scripted tragic endings owned by Role 2 (pad fire). causeId is a key of CAUSES. */
  failWith(endingId, causeId, data = {}, historyHint = null) { this._fail(endingId, causeId, data, historyHint); }

  _fail(endingId, causeId, data = {}, historyHint = null) {
    if (this.failed) return;
    const cause = CAUSES[causeId] ?? causeId;
    this.failed = { endingId, cause, causeId, historyHint, t: this.t, ...data };
    this.throttle = 0;
    this.fx?.fire('end', { fc: this, failed: this.failed });
    this.onNotice?.('failed', this.failed);
    this.bus.emit('flight:failed', { endingId, cause, causeId, historyHint, t: this.t, ...data });
  }

  // Snapshot for the predicted trajectory / save / scene hand-over.
  snapshot() {
    return { pos: clone(this.pos), vel: clone(this.vel), orient: { ...this.orient }, fuel: this.fuel, t: this.t };
  }
}
