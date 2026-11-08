// Headless "player" for the pacing tests and for measuring REAL playing time (60 fps frames, the pacer's warp policy).
// Real time = number of 1/60 s frames. The autopilot follows the same guides the HUD shows.
import { FlightController as RawFC } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { ascentGuide, landingGuide, assistReadout } from '../flightAssist.js';
import { createPacer, createEventDetector, paceContext } from '../pacing.js';
import { approachBack, computeCorridor, predictInterface, flightPathDeg } from '../corridor.js';
import { createPhaseTracker } from '../rating.js';
import { createChecklist } from '../objectives.js';
import { v3, norm, qFromTo, LOCAL_FORWARD, dot } from '../vec.js';

export const FRAME = 1 / 60;
export const ENTRY_FPA = -22.8; // what src/flight/index.js starts the Mars approach with (inside the corridor, off its centre)
export const APPROACH_SECONDS = 40;
const mk = (o) => new RawFC({ g0: G0, planets: PLANETS, ...o });

// Pre-launch countdown is 10 s of real time. reaction = seconds of delay a human needs to act on a new guide step.
export function simulateAscent({ ship, warp = true, reaction = 1.0 } = {}) {
  const fc = mk({ shipSpec: ship ?? MOCK_SHIPS.reliable });
  const pacer = createPacer(), det = createEventDetector(), tracker = createPhaseTracker();
  const check = createChecklist('ascent');
  fc.throttle = 1;
  let frames = 0, warpFrames = {}, stepSince = 0, lastStep = null, circ = false;
  const marks = {};
  let ratings = [];
  while (!fc.failed && fc.phase !== 'orbit' && frames < 60 * 900) {
    const guide = ascentGuide(fc);
    const up = fc.up, east = norm(v3(up.y, -up.x, 0));
    const step = guide?.step ?? null;
    if (step !== lastStep) { stepSince = 0; lastStep = step; if (step && marks[step] === undefined && fc.liftoffT !== null) marks[step] = { real: frames * FRAME, game: fc.t - fc.liftoffT }; }
    stepSince += FRAME;
    if (fc.liftoffT !== null && guide) {
      const tel = fc.telemetry;
      if (step === 'climb' || step === 'turn') {
        fc.orient = qFromTo(LOCAL_FORWARD, norm(guide.direction));
        fc.throttle = tel.dynamicPressure > 30000 ? 0.5 : tel.gLoad > 4.5 ? 0.6 : 1;
      } else if (step === 'coast') {
        if (stepSince > reaction) fc.throttle = 0;
      } else if (step === 'circularise') {
        if (stepSince > reaction) { fc.orient = qFromTo(LOCAL_FORWARD, east); fc.throttle = 1; }
      }
    }
    const aligned = guide ? dot(fc.forward, norm(guide.direction)) > Math.cos(6 * Math.PI / 180) : true;
    const ctx = paceContext(fc, { ascent: guide, landing: null, aligned });
    for (const e of det.update(ctx)) pacer.event(e, ctx.t);
    const d = warp ? pacer.decide(ctx, FRAME) : { warp: 1, reason: null };
    fc.update(FRAME, {}, { timeWarp: d.warp });
    const k = `${step}:${Math.round(fc.warpEffective)}x`;
    warpFrames[k] = (warpFrames[k] ?? 0) + 1;
    ratings.push(...tracker.update(fc, { guideDir: guide?.direction ?? null, guideStep: step }));
    frames++;
  }
  return {
    fc, ok: fc.phase === 'orbit' && !fc.failed, failed: fc.failed,
    realSeconds: frames * FRAME, countdownPlusReal: 10 + frames * FRAME, gameSeconds: fc.liftoffT === null ? 0 : fc.t - fc.liftoffT,
    marks, warpFrames, ratings, fuelLeft: fc.telemetry.fuelFrac,
  };
}

// Mars entry from the approach to touchdown. trimToCentre: hold W/S during the first real seconds like a careful pilot.
export function simulateEntry({ ship, warp = true, trimToCentre = true, fuel = 5000, startFpa = ENTRY_FPA, approach = APPROACH_SECONDS, reaction = 0.3 } = {}) {
  const fc = mk({ shipSpec: ship ?? MOCK_SHIPS.reliable, planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: startFpa }, fuel });
  approachBack(fc, approach);
  const corridor = computeCorridor(fc);
  const pacer = createPacer(), det = createEventDetector(), tracker = createPhaseTracker();
  let frames = 0, burnSince = 0, ratings = [], warpFrames = {}, input = {};
  const marks = {};
  while (!fc.failed && !fc.landed && frames < 60 * 900) {
    const tel = fc.telemetry;
    const landing = landingGuide(fc);
    input = {};
    let trimming = false;
    const pred = tel.altitude > fc.planet.scaleHeight * 9 ? predictInterface(fc) : null;
    if (trimToCentre && pred && Math.abs(pred.fpaDeg - corridor.centreDeg) > 0.4) { input.trim = pred.fpaDeg > corridor.centreDeg ? -1 : 1; trimming = true; }
    // powered descent as a human would fly it (same as the "whole mission is winnable" test)
    if (tel.altitude <= 3000) {
      const a = assistReadout(fc);
      if ((a.burnNow || tel.horizontalSpeed > 2) && tel.verticalSpeed < -4) {
        burnSince += FRAME;
        if (burnSince > reaction || tel.horizontalSpeed > 2) input.brake = true;
      } else {
        fc.orient = qFromTo(LOCAL_FORWARD, fc.up);
        if (tel.altitude < 60 || tel.verticalSpeed > -4) {
          const want = tel.altitude > 15 ? -4 : -1.5;
          fc.throttle = Math.max(0, Math.min(1, (tel.gravity + (want - tel.verticalSpeed) * 3) / (fc.thrustNow() / fc.mass)));
        } else fc.throttle = 0;
      }
    }
    const ctx = paceContext(fc, { ascent: null, landing, trimming });
    for (const e of det.update(ctx)) { pacer.event(e, ctx.t); marks[e] ??= frames * FRAME; }
    const d = warp ? pacer.decide(ctx, FRAME) : { warp: 1, reason: null };
    if (landing && marks[landing.step + (landing.blackout ? '+bo' : '')] === undefined) marks[landing.step + (landing.blackout ? '+bo' : '')] = frames * FRAME;
    fc.update(FRAME, input, { timeWarp: d.warp });
    const k = `${Math.round(fc.warpEffective)}x`;
    warpFrames[k] = (warpFrames[k] ?? 0) + 1;
    ratings.push(...tracker.update(fc, { corridor, interfaceAngleDeg: pred ? pred.fpaDeg : null }));
    frames++;
  }
  return { fc, ok: fc.landed && !fc.failed, failed: fc.failed, realSeconds: frames * FRAME, gameSeconds: fc.t, corridor, marks, warpFrames, ratings, trimDv: fc.trimmedDv };
}

if (process.argv[1]?.endsWith('paceSim.mjs')) {
  const fmt = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
  const base = simulateAscent({ warp: false }), fast = simulateAscent();
  console.log('ASCENT no warp', base.ok, 'real', base.realSeconds.toFixed(0), 's (+10 s countdown)');
  console.log('ASCENT paced  ', fast.ok, fast.failed, 'real', fast.realSeconds.toFixed(0), 's (+10 s countdown =', fast.countdownPlusReal.toFixed(0), ') game', fast.gameSeconds.toFixed(0), 'fuel', fast.fuelLeft.toFixed(2));
  console.log(fmt(fast.marks), fmt(fast.warpFrames), fast.ratings.map((r) => r.text));
  const eb = simulateEntry({ warp: false, trimToCentre: false, startFpa: -26, approach: 0 }), ef = simulateEntry();
  console.log('ENTRY no warp ', eb.ok, 'real', eb.realSeconds.toFixed(0));
  console.log('ENTRY paced   ', ef.ok, ef.failed, 'real', ef.realSeconds.toFixed(0), 's game', ef.gameSeconds.toFixed(0), 'trimDv', ef.trimDv?.toFixed(1));
  console.log(fmt(ef.marks), fmt(ef.warpFrames), ef.ratings.map((r) => r.text));
}
