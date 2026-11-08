// Autopilot ("the flight computer") — flies the whole mission through FlightController inputs only.
// Pure JS, no three.js, testable in node.
//
//   const ap = createAutopilot();
//   every frame, BEFORE fc.update:  const input = ap.update(fc, { countdown, corridor });  fc.update(dt, input, opts)
//   ap.status → { step, text }  what the computer is doing right now (for the HUD)
//
// Returned input: { aim, throttleTarget, brake, trim }  (aim / throttleTarget may be undefined = hands off).
// It flies the same plan as the Flight Assist guides: gravity-turn ascent, MECO, coast, circularise, debris dodge,
// Mars corridor trim, entry (hands off), retro burn, hover-down. The turn-rate limits of the ship still apply.

import { v3, scale, cross, len, norm } from './vec.js';
import { ascentGuide, assistReadout, ASCENT_PROFILE } from './flightAssist.js';
import { predictInterface } from './corridor.js';
import { atmosphereTop } from './atmosphere.js';

const MAX_DODGE_BURN = 4; // s of sideways burn per warning
const TRIM_BAND = 0.4; // deg off the corridor centre before trimming
const MECO_OVERSHOOT = 13000; // m above the target apoapsis before cutting: the air still drags ~11 km off it after MECO (keeps the guide on 'coast', so no re-light chatter)
const RELIGHT_DROP = 8000; // m below the target apoapsis before relighting after MECO
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function createAutopilot(options = {}) {
  const maxQLimit = options.maxQPa ?? 30000;
  const gLimit = options.gLoad ?? 4.5;
  const input = { aim: undefined, throttleTarget: undefined, brake: false, trim: 0 };
  let step = 'standby';
  let arg = 0; // number shown in the status text (degrees, km)
  let burning = false; // we lit the engine ourselves and must shut it down
  let circ = false; // circularise burn started: stay on it until the orbit is round
  let coastLatch = false; // after MECO: stay engine-off until the circularise burn
  let dodgeId = null, dodgeStart = 0, dodgeDone = false;

  function set(id, n = 0) { step = id; arg = n; }
  function reset() {
    step = 'standby'; arg = 0; burning = false; coastLatch = false; circ = false; dodgeId = null; dodgeStart = 0; dodgeDone = false;
    input.aim = undefined; input.throttleTarget = undefined; input.brake = false; input.trim = 0;
  }

  function update(fc, ctx = {}) {
    input.aim = undefined; input.throttleTarget = undefined; input.brake = false; input.trim = 0;
    if (ctx.countdown || fc.failed) { set('standby'); return input; }
    if (fc.landed || fc.phase === 'landed') { set('landed'); return input; }
    if (fc.phase === 'prelaunch' || (fc.onGround && fc.liftoffT === null)) { set('standby'); return input; }

    const tel = fc.telemetry;
    const guide = ascentGuide(fc);

    // ---- Earth ascent (guide applies) ----
    if (guide) {
      const target = ASCENT_PROFILE.targetApoapsis;
      // near the apoapsis the guide says 'circularise'; if drag left the apoapsis a bit under the target it still says 'turn',
      // so after MECO we decide ourselves (rising slowly or close to the apoapsis = time to burn sideways)
      const atApo = coastLatch && (tel.verticalSpeed <= 15 || tel.altitude >= tel.apoapsis - 3000);
      if (circ || guide.step === 'circularise' || atApo) {
        coastLatch = false; circ = true;
        const up = fc.up;
        const vh = v3(fc.vel.x - up.x * tel.verticalSpeed, fc.vel.y - up.y * tel.verticalSpeed, fc.vel.z - up.z * tel.verticalSpeed);
        input.aim = guide.step === 'circularise' || len(vh) < 5 ? guide.direction : norm(vh); input.throttleTarget = 1; burning = true; set('circularise');
        return input;
      }
      if (coastLatch && tel.apoapsis < target - RELIGHT_DROP) coastLatch = false; // drag pulled it too low: relight
      if (!coastLatch && guide.step === 'coast' && tel.apoapsis >= target + MECO_OVERSHOOT) coastLatch = true; // MECO
      if (coastLatch) {
        input.throttleTarget = 0; burning = false;
        input.aim = tel.speed > 1 ? norm(fc.vel) : undefined;
        set('coast', tel.apoapsis / 1000);
        return input;
      }
      burning = true;
      if (guide.step === 'climb') {
        input.aim = guide.direction; input.throttleTarget = 1; set('climb');
      } else { // turn, or still burning toward the overshoot margin
        input.aim = guide.step === 'turn' ? guide.direction : (tel.speed > 1 ? norm(fc.vel) : guide.direction);
        if (tel.dynamicPressure > maxQLimit) { input.throttleTarget = 0.5; set('maxq'); }
        else if (tel.gLoad > gLimit) { input.throttleTarget = 0.6; set('maxq'); }
        else { input.throttleTarget = 1; set('turn', guide.pitchDeg ?? 89); }
      }
      return input;
    }

    coastLatch = false; circ = false;
    const top = atmosphereTop(fc.planet);
    const alt = tel.altitude;
    const prograde = tel.speed > 1 ? norm(fc.vel) : undefined;

    // ---- Orbit / coast above the atmosphere ----
    if (alt > top && (tel.phase === 'orbit' || tel.phase === 'coast' || tel.phase === 'ascent')) {
      const warn = tel.collisionWarning;
      if (warn) {
        if (warn.id !== dodgeId) { dodgeId = warn.id; dodgeStart = fc.t; dodgeDone = false; }
        if (!dodgeDone && fc.t - dodgeStart < MAX_DODGE_BURN) {
          input.aim = norm(cross(fc.pos, fc.vel)); input.throttleTarget = 1; burning = true; set('dodge');
          return input;
        }
        dodgeDone = true;
      }
      if (burning) { input.throttleTarget = 0; burning = false; }
      input.aim = prograde;
      set('orbit');
      return input;
    }

    // ---- Mars (or any planet) approach, above the atmosphere, falling in ----
    if (alt > top) {
      if (burning) { input.throttleTarget = 0; burning = false; }
      if (ctx.corridor && alt > fc.planet.scaleHeight * 9) {
        const pred = predictInterface(fc);
        if (pred && Math.abs(pred.fpaDeg - ctx.corridor.centreDeg) > TRIM_BAND) {
          input.trim = pred.fpaDeg > ctx.corridor.centreDeg ? -1 : 1;
          set('trim');
          return input;
        }
      }
      set('entry');
      return input;
    }

    // ---- Descent through the air ----
    if (alt > 3000) {
      if (burning) { input.throttleTarget = 0; burning = false; }
      set(fc.chuteOpen ? 'chute' : 'entry');
      return input;
    }

    // ---- Powered descent ----
    const vz = tel.verticalSpeed;
    if ((assistReadout(fc).burnNow || tel.horizontalSpeed > 2) && vz < -4) {
      input.brake = true; set('burn');
      return input;
    }
    input.aim = fc.up;
    if (alt < 60 || vz > -4) {
      const want = alt > 15 ? -4 : -1.5;
      input.throttleTarget = clamp01((tel.gravity + (want - vz) * 3) / (fc.thrustNow() / fc.mass));
    } else {
      input.throttleTarget = 0;
    }
    set('descent');
    return input;
  }

  return {
    update,
    reset,
    get status() {
      let text;
      switch (step) {
        case 'standby': text = 'Standing by for launch'; break;
        case 'climb': text = 'Climbing straight up at full throttle'; break;
        case 'turn': text = `Gravity turn: tipping ${arg.toFixed(0)}° toward the horizon`; break;
        case 'maxq': text = 'Max-Q: throttling down'; break;
        case 'coast': text = `MECO: coasting up to the apoapsis (${arg.toFixed(0)} km)`; break;
        case 'circularise': text = 'Circularising: burning prograde'; break;
        case 'orbit': text = 'In orbit: holding prograde'; break;
        case 'dodge': text = 'Debris ahead: dodging sideways'; break;
        case 'trim': text = 'Approach: trimming the entry angle'; break;
        case 'entry': text = 'Entry: heat shield first, hands off'; break;
        case 'chute': text = 'Parachute descent'; break;
        case 'burn': text = 'Retro burn'; break;
        case 'descent': text = 'Hover-down to touchdown'; break;
        case 'landed': text = 'Landed'; break;
        default: text = step;
      }
      return { step, text };
    },
  };
}
