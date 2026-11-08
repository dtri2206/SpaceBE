// Autopilot ("the flight computer") — flies the whole mission through FlightController inputs only.
// Pure JS, no three.js, testable in node.
//
//   const ap = createAutopilot();
//   every frame, BEFORE fc.update:  const input = ap.update(fc, { countdown, corridor });  fc.update(dt, input, opts)
//   ap.status → { step, text }  what the computer is doing right now (for the HUD)
//
// Returned input: { aim, throttleTarget, brake, trim }  (aim / throttleTarget may be undefined = hands off).
// It flies the same plan as the Flight Assist guides: gravity-turn ascent, MECO, coast, circularise, debris dodge,
// Mars corridor trim, entry (hands off), retro burn, hover-down (or one hoverslam burn when the engines cannot throttle low
// enough to hover). The turn-rate limits of the ship still apply.

import { v3, scale, cross, len, norm } from './vec.js';
import { ascentGuide, assistReadout, ASCENT_PROFILE } from './flightAssist.js';
import { predictInterface } from './corridor.js';
import { atmosphereTop } from './atmosphere.js';
import { TUNING } from './FlightController.js';

const MAX_DODGE_BURN = 4; // s of sideways burn per warning
const TRIM_BAND = 0.4; // deg off the corridor centre before trimming
const MECO_OVERSHOOT = 13000; // m above the target apoapsis before cutting: the air still drags ~11 km off it after MECO (keeps the guide on 'coast', so no re-light chatter)
const RELIGHT_DROP = 8000; // m below the target apoapsis before relighting after MECO
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Engine starts a ship in orbit keeps for the rest of the mission instead of spending one on a debris dodge: the
// transfer burn and a landing that may need a drift brake and a landing burn (part effects, wave 5, Role 1)
const RESERVE_STARTS = 3;
// Hoverslam for engines with a throttle floor (part effects, wave 5, Role 1; agreed by all four roles, 2026-11-08).
// A ship whose engines at their lowest throttle still push harder than it weighs cannot hover (a single Merlin 1D
// cannot hover an empty Falcon 9 booster, so it lands on one late burn). Ships with minThrottle 0 never use it.
//   hoverMargin: floor thrust above this × the weight → hoverslam (below 1: the hover path must be able to sink at its
//   floor, since a ship rising on Mars is flown as an Earth ascent) · height: m above the ground where the stop is aimed
//   touchdown: m/s aimed at the ground · lightAt: light when the stop needs this far up the [floor, 1] range (control
//   both ways) · onOff: the throttle an on/off engine lights at · gLimit: g the crew may take (TUNING.gWarn region) ·
//   upSpeed: m/s the aim leads the retrograde direction upward · upAt: m/s below which the nose stands up, leaning
//   driftLean rad per m/s against the last drift · relightAt: null = a relight after a short stop lights like the
//   first burn, a number = at that much above the floor ·
//   cutFrames: s of the deceleration now kept as margin when cutting at the stop · brakeDrift: m/s of sideways drift
//   above which a ship higher than brakeAlt brakes it first (until brakeDone m/s, at brakeG × gLimit, more when the
//   stop would take more than the height / brakeRoom) · driftGain:
//   weight of the drift in the aim (1 = retrograde) · brakeAimDeg: the brake lights once the nose is this close to
//   retrograde · fallShare: the share of the legs' touchdown limit a free fall may reach the ground at without a relight ·
//   keepLitBelow: m under which a hover-capable engine with a floor stays lit at its floor instead of cutting
export const SLAM = Object.freeze({ hoverMargin: 0.95, height: 0.5, touchdown: 1.0, lightAt: 0.5, onOff: 0.97, gLimit: 4.5, upSpeed: 3, upAt: 3, driftLean: 0.08, driftGain: 1, relightAt: null, cutFrames: 0.03, brakeDrift: 40, brakeAlt: 1200, brakeDone: 3, brakeG: 0.7, brakeRoom: 1.2, brakeAimDeg: 30, fallShare: 0.8, keepLitBelow: 500 });

export function createAutopilot(options = {}) {
  const maxQLimit = options.maxQPa ?? 30000;
  const gLimit = options.gLoad ?? 4.5;
  const SL = { ...SLAM, ...(options.slam ?? {}) }; // hoverslam tunables (tests may override)
  const input = { aim: undefined, throttleTarget: undefined, brake: false, trim: 0 };
  let step = 'standby';
  let arg = 0; // number shown in the status text (degrees, km)
  let burning = false; // we lit the engine ourselves and must shut it down
  let circ = false; // circularise burn started: stay on it until the orbit is round
  let coastLatch = false; // after MECO: stay engine-off until the circularise burn
  let landedOn = null; // planet the mission touched down on (the ascent guide never runs there)
  let dodgeId = null, dodgeStart = 0, dodgeDone = false;
  let slamBurns = 0; // hoverslam burns made this descent (a relight after a short stop lights at the floor)
  let guided = false; // the guided powered descent has started (stays on until the ground)
  let slamBrake = false, slamBraked = false; // a hoverslam ship drifting fast first brakes the drift high up, then lands
  let prevQ = null, prevQT = 0, dqdt = 0; // dynamic pressure and its rate of rise (Pa/s): the look-ahead of the burn limiter

  // How much throttle the ship can take right now, from ITS OWN limits (burn limiter of every powered ascent step):
  //  - dynamic pressure: look ahead (rate of rise x about 2 s plus the length of the frame being flown, a warped frame is long)
  //    and fade the throttle out before the real structural limit (telemetry.maxQ, part effects included);
  //  - g load: the throttle at which the engines give gLimit (a strong ship cannot hold full throttle, not even in the
  //    circularise burn where there is no air; 6 g for 4 s is a blackout);
  //  - engine heat: it only builds above 90 % throttle, so past half-hot the engine is held at 90 %.
  function burnLimit(fc, tel) {
    const dtFrame = prevQ === null ? 0 : fc.t - prevQT;
    if (prevQ !== null && dtFrame > 1e-6 && dtFrame < 5) dqdt = (tel.dynamicPressure - prevQ) / dtFrame; else if (!(dtFrame === 0 && prevQ !== null)) dqdt = 0; // same instant: keep the last rate
    prevQ = tel.dynamicPressure; prevQT = fc.t;
    let lim = 1;
    const qCap = Math.min(maxQLimit, 0.8 * tel.maxQ);
    const qPred = tel.dynamicPressure + Math.max(0, dqdt) * (2 + 2 * Math.max(0, dtFrame));
    if (qPred > 0.85 * qCap) lim = Math.min(lim, Math.max(0.15, 1 - 0.85 * (qPred - 0.85 * qCap) / (0.15 * qCap)));
    const gFull = (tel.twr * tel.gravity) / fc.g0; // g of the engines at full throttle (drag only lowers what is felt)
    if (gFull > 0) lim = Math.min(lim, Math.max(0.02, gLimit / gFull)); // (the engine's own throttle floor, if any, is applied by the controller)
    if (tel.engineTemp > 0.5) lim = Math.min(lim, 0.9);
    return lim;
  }

  function set(id, n = 0) { step = id; arg = n; }
  function reset() {
    step = 'standby'; arg = 0; burning = false; coastLatch = false; circ = false; landedOn = null; dodgeId = null; dodgeStart = 0; dodgeDone = false; slamBurns = 0; slamBrake = false; slamBraked = false; guided = false; prevQ = null; dqdt = 0;
    input.aim = undefined; input.throttleTarget = undefined; input.brake = false; input.trim = 0;
  }

  function update(fc, ctx = {}) {
    input.aim = undefined; input.throttleTarget = undefined; input.brake = false; input.trim = 0;
    if (ctx.countdown || fc.failed) { set('standby'); return input; }
    // Landed: engine off, no aim. Remember it: the ascent program is for the Earth pad only, never a liftoff from Mars.
    if (fc.landed || fc.phase === 'landed') { landedOn = fc.planetId; burning = false; input.throttleTarget = 0; set('landed'); return input; }
    if (fc.phase === 'prelaunch' || (fc.onGround && fc.liftoffT === null)) {
      // clamps released and the engine is up: a very strong ship must not leave the pad at an instant 12 g (blackout limit)
      if (fc.planetId === 'earth' && fc.throttle > 0 && !fc.holdDown) input.throttleTarget = burnLimit(fc, fc.telemetry);
      set('standby'); return input;
    }

    const tel = fc.telemetry;
    const guide = fc.planetId === 'earth' && landedOn !== fc.planetId ? ascentGuide(fc) : null;

    // ---- Earth ascent (guide applies) ----
    // debris met while coasting up to the apoapsis above the air (the encounter can come before the orbit is round):
    // the same dodge or brace as in orbit (part effects, wave 5, Role 1)
    if (guide && coastLatch && !ctx.holdDodge && tel.collisionWarning && tel.altitude > atmosphereTop(fc.planet)) {
      const avoid = avoidDebris(fc, tel, 1); // the circularisation burn is still to come: one more start kept
      if (avoid) return avoid;
    }
    if (guide) {
      const target = ASCENT_PROFILE.targetApoapsis;
      // near the apoapsis the guide says 'circularise'; if drag left the apoapsis a bit under the target it still says 'turn',
      // so after MECO we decide ourselves (rising slowly or close to the apoapsis = time to burn sideways)
      const atApo = coastLatch && (tel.verticalSpeed <= 15 || tel.altitude >= tel.apoapsis - 3000);
      if (circ || guide.step === 'circularise' || atApo) {
        coastLatch = false; circ = true;
        const up = fc.up;
        const vh = v3(fc.vel.x - up.x * tel.verticalSpeed, fc.vel.y - up.y * tel.verticalSpeed, fc.vel.z - up.z * tel.verticalSpeed);
        input.aim = guide.step === 'circularise' || len(vh) < 5 ? guide.direction : norm(vh); input.throttleTarget = burnLimit(fc, tel); burning = true; set('circularise');
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
        input.aim = guide.direction; input.throttleTarget = burnLimit(fc, tel);
        const asked = fc.thrustNow() * fc.throttle;
        set('climb', asked > 0 && tel.thrust < 0.98 * asked ? 1 : 0); // 1: the thrust is held back (a pad that cannot take it)
      } else { // turn, or still burning toward the overshoot margin
        input.aim = guide.step === 'turn' ? guide.direction : (tel.speed > 1 ? norm(fc.vel) : guide.direction);
        input.throttleTarget = burnLimit(fc, tel);
        if (input.throttleTarget < 0.95) set('maxq'); else set('turn', guide.pitchDeg ?? 89);
      }
      return input;
    }

    coastLatch = false; circ = false;
    const top = atmosphereTop(fc.planet);
    const alt = tel.altitude;
    const prograde = tel.speed > 1 ? norm(fc.vel) : undefined;

    // ---- Orbit / coast above the atmosphere ----
    if (alt > top && (tel.phase === 'orbit' || tel.phase === 'coast' || tel.phase === 'ascent')) {
      // holdDodge: the player is offered / flying the dodge (Role 2). Otherwise dodge if the ship can burn, else hold the
      // nose into the stream (part effects, wave 5, Role 1)
      const avoid = !ctx.holdDodge && tel.collisionWarning ? avoidDebris(fc, tel) : null;
      if (avoid) return avoid;
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
        const band = Math.min(TRIM_BAND, (ctx.corridor.halfWidthDeg ?? Infinity) * 0.25); // a narrow (damaged-shield) corridor needs a tighter aim
        if (pred && Math.abs(pred.fpaDeg - ctx.corridor.centreDeg) > band) {
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
      guided = false;
      if (burning) { input.throttleTarget = 0; burning = false; }
      set(fc.chuteOpen ? 'chute' : 'entry');
      return input;
    }

    // ---- Powered descent ----
    const vz = tel.verticalSpeed;
    // hoverslam for engines with a throttle floor: part effects, wave 5, Role 1 (see SLAM above)
    const floor = fc.ship?.minThrottle ?? 0;
    const aFull = fc.thrustNow() / fc.mass;
    if (floor > 0 && aFull * floor > tel.gravity * SL.hoverMargin) return slam(fc, tel, floor, aFull);
    if (guided || ((assistReadout(fc).burnNow || guidedDue(fc, tel, aFull)) && vz < -4)) return guidedDescent(fc, tel, floor, aFull);
    input.aim = fc.up;
    // an engine with a throttle floor (part effects, wave 5) that can still hover stays lit at its floor rather than
    // cut and relight: each relight costs a start (a TEA-TEB cluster would spend them all); floor 0 as before. High up
    // a lit engine is still cut for the fall (hovering down from kilometres at the floor would empty the tanks)
    const keepLit = floor > 0 && fc.engineLit;
    const keepLitHere = keepLit && alt < SL.keepLitBelow;
    if (alt < 60 || vz > -4) {
      const want = alt > 15 ? -4 : -1.5;
      const t = clamp01((tel.gravity + (want - vz) * 3) / (fc.thrustNow() / fc.mass));
      input.throttleTarget = keepLit ? Math.max(floor, t) : t;
    } else {
      input.throttleTarget = keepLitHere ? floor : 0;
    }
    set('descent');
    return input;
  }

  // ---- Guided powered descent (Apollo / Falcon 9 style) ----
  // Kill the sideways speed high up, follow a vertical-speed profile that ends at ~1.5 m/s and pitch over to near vertical
  // for touchdown. Thrust direction = desired acceleration minus gravity, its tilt from the local vertical limited by
  // altitude (a retrograde brake would fly nearly horizontal while the ship still drifts sideways).
  function tiltLimitDeg(alt) { return alt > 2000 ? 45 : alt > 1000 ? 30 : alt > 200 ? 20 : alt > 30 ? 8 : 3; }
  function descentProfile(alt, tel, aFull) {
    const aD = Math.max(0.3, 0.55 * 0.9 * aFull - tel.gravity); // a deceleration the engines can really hold with margin
    return -Math.max(1.5, Math.min(Math.sqrt(2 * aD * Math.max(0, alt - 3)), 200));
  }
  function guidedDue(fc, tel, aFull) {
    const vzT = descentProfile(tel.altitude, tel, aFull);
    if (tel.verticalSpeed < vzT) return true;
    return tel.altitude < 2500 && tel.horizontalSpeed > 3; // time to kill the drift before the last kilometre
  }
  function guidedDescent(fc, tel, floor, aFull) {
    guided = true;
    const up = fc.up, alt = tel.altitude, vz = tel.verticalSpeed, g = tel.gravity;
    const vh = v3(fc.vel.x - up.x * vz, fc.vel.y - up.y * vz, fc.vel.z - up.z * vz);
    const vhm = len(vh);
    const vzT = descentProfile(alt, tel, aFull);
    // a drift far too fast to turn away within the height left (a ship that arrives without its parachute doing much):
    // full thrust toward "no drift, sinking 10 m/s" until it is within reach of the tilt limits below
    const hard = alt > 30 && vhm > 3 + 0.5 * Math.tan((tiltLimitDeg(alt) * Math.PI) / 180) * g * (alt / Math.max(10, -vz));
    let T, azNeed;
    if (hard) {
      const err = v3(-vh.x - up.x * (10 + vz), -vh.y - up.y * (10 + vz), -vh.z - up.z * (10 + vz));
      const e = norm(err), eu = e.x * up.x + e.y * up.y + e.z * up.z, tmax = 0.95 * aFull;
      const a = Math.min(len(err) / 1.5, -g * eu + Math.sqrt(Math.max(0, (g * eu) ** 2 + tmax * tmax - g * g)));
      T = v3(up.x * g + e.x * a, up.y * g + e.y * a, up.z * g + e.z * a);
      azNeed = Math.max(0.1, T.x * up.x + T.y * up.y + T.z * up.z);
    } else {
      const aD = Math.max(0.3, 0.55 * 0.9 * aFull - g);
      const ff = vzT < -1.6 && vzT > -199 ? aD * clamp01(1 - (vz - vzT) / 3) : 0; // the profile's own deceleration (feed-forward)
      azNeed = Math.max(0.1, g + ff + (vzT - vz) / 1.0); // vertical thrust acceleration wanted
      if (alt > 400 && vhm > 2) azNeed = Math.max(azNeed, 1.1 * g); // at least hover thrust while turning the drift away high up
      const tgo = Math.max(0, alt - 300) / Math.max(10, -vz);
      const tauH = Math.max(2, Math.min(15, 0.5 * tgo));
      const azAim = Math.max(azNeed, g); // (a coasting ship keeps its nose up instead of swinging with the drift)
      const ahNeed = Math.min(vhm / tauH, Math.tan((tiltLimitDeg(alt) * Math.PI) / 180) * azAim);
      const dirH = vhm > 0.05 ? scale(vh, -1 / vhm) : v3();
      T = v3(up.x * azAim + dirH.x * ahNeed, up.y * azAim + dirH.y * ahNeed, up.z * azAim + dirH.z * ahNeed);
    }
    input.aim = norm(T);
    // the thrust's vertical share: what the nose really has once lit
    const cosNose = Math.max(0.5 * azNeed / len(T), fc.forward.x * up.x + fc.forward.y * up.y + fc.forward.z * up.z);
    const thr = Math.min(1, azNeed / cosNose / aFull);
    if (fc.engineLit || alt < 500 || vz < vzT || (alt > 400 && vhm > 2)) {
      if (!fc.engineLit) { // light once the nose is within reach of the aim, a far-off nose would push the wrong way
        const cosA = fc.forward.x * input.aim.x + fc.forward.y * input.aim.y + fc.forward.z * input.aim.z;
        if (cosA < Math.cos((35 * Math.PI) / 180) && alt > 400) { input.throttleTarget = 0; set('descent'); return input; }
      }
      input.throttleTarget = Math.max(floor, 0.02, Math.min(1, thr));
      burning = true;
    } else input.throttleTarget = 0;
    set('burn');
    return input;
  }

  // Debris ahead (tel.collisionWarning): dodge sideways with a short burn, as Role 2 built it. With no burn possible (no
  // starts left, no propellant, no working engine: part effects, wave 5, Role 1) hold the nose into the stream instead
  // of turning broadside, so the smallest face and the capsule's double wall take what hits (the Shuttle flew a
  // debris-protective attitude the same way). A ship with few starts left keeps the ones the rest of the mission needs
  // (the transfer burn and the landing, plus `more`) and braces too. → the input, or null once the dodge is done.
  function avoidDebris(fc, tel, more = 0) {
    const warn = tel.collisionWarning;
    if (warn.id !== dodgeId) { dodgeId = warn.id; dodgeStart = fc.t; dodgeDone = false; }
    const spare = Number.isFinite(fc.ignitionsLeft) ? fc.ignitionsLeft - RESERVE_STARTS - more : Infinity;
    const canBurn = fc.fuel > 0 && (fc.engineLit || spare > 0) && tel.twr > 0;
    const piece = canBurn ? null : fc.obstacles?.find((o) => o.id === warn.id);
    if (piece) {
      const into = v3(fc.vel.x - piece.vel.x, fc.vel.y - piece.vel.y, fc.vel.z - piece.vel.z); // toward where it comes from
      if (len(into) > 0.1) {
        input.aim = norm(into);
        if (burning) { input.throttleTarget = 0; burning = false; }
        set('brace');
        return input;
      }
    }
    if (!dodgeDone && fc.t - dodgeStart < MAX_DODGE_BURN) {
      input.aim = norm(cross(fc.pos, fc.vel)); input.throttleTarget = 1; burning = true; set('dodge');
      return input;
    }
    dodgeDone = true;
    return null;
  }

  // Hoverslam (part effects, wave 5, Role 1): engine off until the stop needs the middle of the throttle range, then
  // one burn that tracks the vertical deceleration stopping the fall at the touchdown speed right at the ground,
  // (v² − v_td²) / 2h + g, within [floor, 1]; cut once stopped. A stop short of the ground falls and lights again
  // (another ignition). The nose points retrograde while the ship is fast (a gravity-turn descent kills the sideways
  // speed with the fall) and leads the path upward by SL.upSpeed (−v + up · upSpeed), so the ship stands up as it
  // slows instead of lagging the path that gravity steepens at the end; slow, it stands up against the last drift.
  // Arriving with a fast sideways drift high up (a heavy ship under its parachute), it first brakes the drift (one more
  // ignition): a gravity-turn burn from a 45° path would still be leaning at the ground.
  function slam(fc, tel, floor, aFull) {
    const vz = tel.verticalSpeed, alt = tel.altitude;
    const h = Math.max(0.05, alt - SL.height);
    const up = fc.up, f = fc.forward;
    const drift = v3(fc.vel.x - up.x * vz, fc.vel.y - up.y * vz, fc.vel.z - up.z * vz);
    // retrograde, with the drift weighted SL.driftGain times so it dies before the fall does, led upward by upSpeed
    const lead = v3(-drift.x * SL.driftGain + up.x * (SL.upSpeed - vz), -drift.y * SL.driftGain + up.y * (SL.upSpeed - vz), -drift.z * SL.driftGain + up.z * (SL.upSpeed - vz));
    const stand = v3(up.x - drift.x * SL.driftLean, up.y - drift.y * SL.driftLean, up.z - drift.z * SL.driftLean);
    const aim = tel.speed > SL.upAt && len(lead) > 0.1 ? norm(lead) : norm(stand);
    input.aim = aim;
    // drifting fast high up: brake it first, retrograde at a moderate throttle, cut once the drift is gone (it then
    // falls nearly straight down and lands on a second burn), like the hover-capable path brakes before hovering
    input.brake = false;
    const vh = len(drift);
    if (slamBrake || (!fc.engineLit && slamBurns === 0 && !slamBraked && vh > SL.brakeDrift && alt > SL.brakeAlt && vz < -SL.touchdown)) {
      const r = tel.speed > 0.5 ? norm(scale(fc.vel, -1)) : up;
      input.aim = r;
      const aNow = Math.max(0, fc.throttle * aFull * Math.max(0.2, f.x * up.x + f.y * up.y + f.z * up.z) - tel.gravity);
      if (slamBrake && (vh < SL.brakeDone || vz > -(SL.touchdown + aNow * SL.cutFrames))) {
        slamBrake = false; input.throttleTarget = 0; burning = false; set('descent');
        return input;
      }
      // light only once the nose is within brakeAimDeg of retrograde (thrust at an angle would push the drift the wrong
      // way); once lit it keeps burning while the nose follows the path
      const cosR = f.x * r.x + f.y * r.y + f.z * r.z;
      if (!slamBrake && cosR < Math.cos((SL.brakeAimDeg * Math.PI) / 180)) { input.throttleTarget = 0; set('descent'); return input; }
      if (!slamBrake) { slamBrake = true; slamBraked = true; }
      // a moderate throttle (brakeG × gLimit) saves propellant; more when the drift could not be stopped before the
      // ground otherwise: along the path the stop takes v² / 2a, of which the share |vz| / v is lost in height
      const needA = (tel.speed * Math.max(0, -vz)) / (SL.brakeRoom * Math.max(1, alt)) + tel.gravity;
      input.throttleTarget = Math.max(floor, Math.min(1, Math.max(SL.gLimit * fc.g0 * SL.brakeG, needA) / aFull));
      burning = true; set('burn');
      return input;
    }
    const need = (vz * vz - SL.touchdown ** 2) / (2 * h) + tel.gravity;
    // the thrust's vertical share: the aim's before lighting, the attitude the ship really has once lit
    const cosAim = Math.max(0.2, aim.x * up.x + aim.y * up.y + aim.z * up.z);
    const cosUp = Math.max(0.2, f.x * up.x + f.y * up.y + f.z * up.z);
    const u = need / (aFull * (fc.engineLit ? cosUp : cosAim));
    if (!fc.engineLit) {
      const gCap = (SL.gLimit * fc.g0) / aFull; // the throttle that keeps the crew under gLimit
      // light mid-range (room to throttle both ways), at most at what keeps the crew under gLimit
      const light = floor >= 0.999 ? SL.onOff : slamBurns > 0 && SL.relightAt != null ? Math.min(1, floor + SL.relightAt) : Math.max(floor, Math.min(floor + (1 - floor) * SL.lightAt, gCap));
      // a ship that would reach the ground slowly enough in free fall is left to touch down: a relight in the last
      // centimetres would push it back up (and a ship rising on Mars is flown as an Earth ascent)
      const freeFall = Math.sqrt(vz * vz + 2 * tel.gravity * Math.max(0, alt));
      const legs = fc.fx?.value ? fc.fx.value('touchdownLimit', fc.ship.hasLegs ? TUNING.touchdownLimit.legs : TUNING.touchdownLimit.noLegs, { fc }) : TUNING.touchdownLimit.legs;
      if (vz < -SL.touchdown && u >= light && freeFall > SL.fallShare * legs) { input.throttleTarget = Math.max(floor, Math.min(1, u)); burning = true; slamBurns += 1; set('burn'); }
      else { input.throttleTarget = 0; set('descent'); }
      return input;
    }
    // cut once stopped, before the floor thrust can push the ship back up (never climb: a ship rising on Mars would
    // be flown as an Earth ascent): about two frames (60 fps) of the deceleration now of margin
    const aNet = Math.max(0, fc.throttle * aFull * cosUp - tel.gravity);
    const margin = SL.touchdown * 0.5 + aNet * SL.cutFrames;
    if (vz > -margin || alt < 0.3) { input.throttleTarget = 0; burning = false; set('descent'); return input; }
    input.throttleTarget = Math.max(floor, Math.min(1, u));
    set('burn');
    return input;
  }

  return {
    update,
    reset,
    get status() {
      let text;
      switch (step) {
        case 'standby': text = 'Standing by for launch'; break;
        case 'climb': text = arg ? 'Climbing straight up' : 'Climbing straight up at full throttle'; break;
        case 'turn': text = `Gravity turn: tipping ${arg.toFixed(0)}° toward the horizon`; break;
        case 'maxq': text = 'Max-Q: throttling down'; break;
        case 'coast': text = `MECO: coasting up to the apoapsis (${arg.toFixed(0)} km)`; break;
        case 'circularise': text = 'Circularising: burning prograde'; break;
        case 'orbit': text = 'In orbit: holding prograde'; break;
        case 'dodge': text = 'Debris ahead: dodging sideways'; break;
        case 'brace': text = 'Debris ahead: nose into the stream'; break;
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
