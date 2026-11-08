// Short-horizon guidance, in the same downrange/altitude frame and scale for BOTH lines.
// Cyan is a real FlightController rollout holding the current controls (including rotation,
// throttle, drag, fuel and the chute). White dashes are a guidance continuation, not a promised orbit.
import tuning from './steering.json' with { type: 'json' };
import { ascentGuide, landingGuide } from './flightAssist.js';
import { atmosphereTop } from './atmosphere.js';
import { corridorGauge } from './corridor.js';
import { cross, dot, len, norm, qRotate, scale, sub, v3, LOCAL_RIGHT, LOCAL_UP } from './vec.js';

const finiteVector = (v) => v && [v.x, v.y, v.z].every(Number.isFinite);
const rad = Math.PI / 180;

// Controller fields are plain structured data except these three collaborators.
// Never reuse live flags, timers, ship, obstacles, bus callbacks or random state.
export function copyForPrediction(fc) {
  const copy = Object.create(Object.getPrototypeOf(fc));
  for (const [key, value] of Object.entries(fc)) {
    if (['bus', 'onNotice', 'rng', 'fx'].includes(key) || typeof value === 'function') continue;
    copy[key] = structuredClone(value);
  }
  copy.bus = { emit() {} }; copy.onNotice = null; copy.rng = () => 0.5;
  copy.fx = fc.fx?.quiet ?? null; // the part effects' limits and thrust, without their dice, records or failures
  copy.accumulator = 0;
  return copy;
}

function frameFor(fc) {
  const up = norm(fc.pos);
  let east = norm(sub(fc.vel, scale(up, dot(fc.vel, up))));
  if (len(east) < 0.5) east = norm(v3(up.y, -up.x, 0));
  if (len(east) < 0.5) east = norm(cross(up, v3(0, 1, 0)));
  return { up, east };
}

function attitudeError(fc, direction) {
  const axis = cross(fc.forward, direction);
  const along = dot(fc.forward, direction);
  return {
    pitch: Math.atan2(dot(axis, qRotate(fc.orient, LOCAL_RIGHT)), along),
    yaw: -Math.atan2(dot(axis, qRotate(fc.orient, LOCAL_UP)), along),
  };
}

const command = (angle) => Math.abs(angle) <= tuning.angleToleranceDegrees * rad ? 0 : Math.sign(angle);
// What the flight computer would do from here on the guided plan (the dashed reference line). Uses the controller's
// own computer inputs: aim (the ship turns toward it within its turn rate) and throttleTarget.
function guidanceInput(fc, corridor, entryTrim) {
  const ascent = fc.planetId === 'earth' ? ascentGuide(fc) : null, landing = landingGuide(fc);
  const control = {};
  if (ascent) {
    control.aim = ascent.direction;
    control.throttleTarget = ascent.step === 'coast' ? 0 : fc.telemetry.dynamicPressure > fc.telemetry.maxQ * .8 ? 0.5 : 1;
  } else if (fc.phase === 'orbit') control.throttleTarget = 0;
  else if (fc.altitude > atmosphereTop(fc.planet) && corridor) {
    control.trim = entryTrim;
  } else if (landing?.step === 'burn') control.brake = true;
  else if (landing?.step === 'touchdown') {
    control.brake = fc.telemetry.verticalSpeed < -3;
    control.throttleDown = !control.brake;
  } else if (landing) control.throttleTarget = 0;
  return control;
}

export function steeringHint(fc, { corridor = null, countdown = false, manualOffer = false, manual = null, debris = null } = {}) {
  const words = tuning.hint;
  if (debris === 'dodge') return { text: words.debrisDodge, level: 'warn' };
  if (manual?.free) return { text: words.manualFree, level: 'ok' };
  if (manual) return manual.lockReady ? { text: words.manualLock, level: 'ok' } : { text: words.manualFly, level: 'warn' };
  if (countdown) return { text: words.countdown, level: 'ok' };
  if (fc.failed) return { text: words.failed, level: 'warn' };
  if (fc.landed) return { text: words.landed, level: 'ok' };
  if (debris === 'offer') return { text: words.debrisOffer, level: 'ok' };
  if (manualOffer) return { text: words.manualOffer, level: 'ok' };
  if (corridor && fc.altitude > atmosphereTop(fc.planet)) {
    const gauge = corridorGauge(fc, corridor);
    if (gauge.status !== 'ok') return { text: gauge.angleDeg > corridor.centreDeg ? words.steeper : words.shallower, level: 'warn' };
    return { text: words.entry, level: 'ok' };
  }
  const guide = (fc.planetId === 'earth' ? ascentGuide(fc) : null) ?? landingGuide(fc);
  if (guide?.direction) {
    const error = attitudeError(fc, guide.direction);
    if (Math.max(Math.abs(error.pitch), Math.abs(error.yaw)) > tuning.angleToleranceDegrees * rad) {
      return { text: Math.abs(error.pitch) >= Math.abs(error.yaw) ? (error.pitch > 0 ? words.up : words.down) : (error.yaw > 0 ? words.right : words.left), level: 'warn' };
    }
  }
  return { text: words[guide?.step] ?? (fc.phase === 'orbit' ? words.orbit : words.aligned), level: 'ok' };
}

function rollout(fc, controls, corridor, reference, horizon) {
  const copy = copyForPrediction(fc), points = [{ ...copy.pos }];
  // Re-evaluate on the next display refresh; avoid running an interface predictor at every physics sample.
  const entryTrim = reference && corridor && fc.altitude > atmosphereTop(fc.planet)
    ? command((corridor.centreDeg - corridorGauge(fc, corridor).angleDeg) * rad) : 0;
  for (let t = 0; t < horizon && !copy.failed && !copy.landed; t += tuning.sampleSeconds) {
    copy.update(tuning.sampleSeconds, reference ? guidanceInput(copy, corridor, entryTrim) : controls);
    if (!finiteVector(copy.pos)) break;
    points.push({ ...copy.pos });
  }
  return points;
}

export function steeringReadout(fc, controls = {}, options = {}) {
  if (!finiteVector(fc?.pos) || !finiteVector(fc?.vel) || !finiteVector(fc?.forward) || !(fc.planet?.radius > 0)) return null;
  const { up, east } = frameFor(fc);
  const horizon = tuning.horizon;
  const predicted = rollout(fc, controls, options.corridor, false, horizon);
  const reference = options.reference ?? fc;
  let planned;
  if (fc.phase === 'orbit') {
    // Circular reference at the anchored orbit-entry radius, from GM/r (same units as the physics).
    const r = len(reference.pos), rate = Math.sqrt(fc.mu / r ** 3);
    const anchor = frameFor(reference);
    const elapsed = fc.t - reference.t;
    planned = Array.from({ length: predicted.length }, (_, i) => {
      const angle = rate * (elapsed + i * tuning.sampleSeconds);
      return { x: r * (anchor.up.x * Math.cos(angle) + anchor.east.x * Math.sin(angle)), y: r * (anchor.up.y * Math.cos(angle) + anchor.east.y * Math.sin(angle)), z: r * (anchor.up.z * Math.cos(angle) + anchor.east.z * Math.sin(angle)) };
    });
  } else planned = rollout(reference, {}, options.corridor, true, horizon);
  const local = (p) => [Math.atan2(dot(p, east), dot(p, up)) * fc.planet.radius, len(p) - fc.planet.radius];
  const raw = [planned.map(local), predicted.map(local)];
  const all = [...raw.flat(), local(fc.pos)];
  if (!all.length || all.some((p) => !p.every(Number.isFinite))) return null;
  const lower = [0, 1].map((axis) => Math.min(...all.map((p) => p[axis])));
  const spans = [0, 1].map((axis) => Math.max(tuning.minimumSpanMetres, Math.max(...all.map((p) => p[axis])) - lower[axis]));
  const size = 1 - 2 * tuning.padding;
  const project = (p) => p.map((value, axis) => tuning.padding + size * (value - lower[axis]) / spans[axis]);
  const ship = project(local(fc.pos));
  const plannedPlot = raw[0].map(project);
  const distance = plannedPlot.reduce((nearest, point, i) => {
    const next = plannedPlot[i + 1] ?? point;
    const dx = next[0] - point[0], dy = next[1] - point[1];
    const fraction = Math.max(0, Math.min(1, ((ship[0] - point[0]) * dx + (ship[1] - point[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.min(nearest, Math.hypot(ship[0] - point[0] - fraction * dx, ship[1] - point[1] - fraction * dy));
  }, Infinity);
  let hint = steeringHint(fc, options);
  if (!options.manual && hint.level === 'ok' && distance > tuning.offTrackTolerance) hint = { text: tuning.hint.offTrack, level: 'warn' };
  return {
    view: 'side', planned: plannedPlot, predicted: raw[1].map(project),
    ship: { x: ship[0], y: ship[1], heading: Math.atan2(dot(fc.forward, up) / spans[1], dot(fc.forward, east) * fc.planet.radius / len(fc.pos) / spans[0]) },
    hint,
  };
}

// This reference survives camera switches and F toggles. A pilot error moves the amber ship
// away from the reference; it cannot drag the dashed path along with it at the next refresh.
export function createGuidanceReference() {
  let source = null, reference = null, leg = null;
  return {
    readout(fc, controls, options = {}) {
      const nextLeg = fc.phase === 'orbit' ? 'orbit' : fc.planetId;
      if (source !== fc || leg !== nextLeg) { source = fc; reference = null; leg = nextLeg; }
      if (options.countdown) return steeringReadout(fc, controls, options);
      if (!reference) {
        reference = copyForPrediction(fc);
        reference.holdDown = false;
      }
      if (leg !== 'orbit') {
        let remaining = Math.min(tuning.referenceCatchupSeconds, Math.max(0, fc.t - reference.t));
        const trim = options.corridor && reference.altitude > atmosphereTop(reference.planet)
          ? command((options.corridor.centreDeg - corridorGauge(reference, options.corridor).angleDeg) * rad) : 0;
        while (remaining > 1e-6 && !reference.failed && !reference.landed) {
          const dt = Math.min(tuning.sampleSeconds, remaining);
          reference.update(dt, guidanceInput(reference, options.corridor, trim));
          remaining -= dt;
        }
      }
      return steeringReadout(fc, controls, { ...options, reference });
    },
  };
}

// The active cockpit alone owns the overlay. Clear old displays on every switch and exit.
export function createSteeringDisplay() {
  let active = null, last = -Infinity, failed = false;
  const clear = () => { try { active?.userData?.setTrajectory?.(null); } catch { /* unsupported cockpit: HUD remains available */ } };
  return {
    update(cockpit, enabled, makeData, now) {
      if (active !== cockpit) { clear(); active = cockpit; last = -Infinity; failed = false; }
      if (!enabled) { clear(); last = -Infinity; return { monitor: false, fallback: false }; }
      if (typeof active?.userData?.setTrajectory !== 'function' || failed) return { monitor: false, fallback: true };
      if (now - last >= tuning.refreshSeconds) {
        try {
          const data = makeData();
          if (!data) { clear(); return { monitor: false, fallback: true }; }
          active.userData.setTrajectory(data); last = now;
        } catch { clear(); failed = true; return { monitor: false, fallback: true }; }
      }
      return { monitor: true, fallback: false };
    },
    dispose() { clear(); active = null; last = -Infinity; failed = false; },
  };
}
