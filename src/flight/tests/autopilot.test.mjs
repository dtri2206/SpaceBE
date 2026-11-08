// Node tests for the autopilot. Run: node src/flight/tests/autopilot.test.mjs
import assert from 'node:assert/strict';
import { FlightController as RawFC, FIXED_DT, TUNING } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { createAutopilot } from '../autopilot.js';
import { createPacer, createEventDetector, paceContext } from '../pacing.js';
import { ascentGuide, landingGuide } from '../flightAssist.js';
import { approachBack, computeCorridor, predictInterface } from '../corridor.js';
import { createDebrisField } from '../debris.js';
import { len, dot, norm, v3 } from '../vec.js';

const FRAME = 1 / 60;
const mk = (o) => new RawFC({ g0: G0, planets: PLANETS, ...o });
const results = [];
function test(name, fn) {
  try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); }
}

function flyAscent(ship, timeWarp) {
  const fc = mk({ shipSpec: ship });
  const ap = createAutopilot();
  const pacer = createPacer(), det = createEventDetector();
  fc.throttle = 1;
  let frames = 0, mecos = 0, wasBurning = false;
  let ignitions = 0;
  fc.onNotice = (t) => { if (t === 'ignition') ignitions++; };
  while (!fc.failed && fc.phase !== 'orbit' && frames < 60 * 900) {
    const input = ap.update(fc, {});
    const guide = ascentGuide(fc);
    const aligned = guide ? dot(fc.forward, norm(guide.direction)) > Math.cos((6 * Math.PI) / 180) : true;
    const ctx = paceContext(fc, { ascent: guide, landing: null, aligned });
    for (const e of det.update(ctx)) pacer.event(e, ctx.t);
    const w = timeWarp ?? pacer.decide(ctx, FRAME).warp;
    fc.update(FRAME, input, { timeWarp: w, stopOnNotice: timeWarp === undefined });
    if (fc.liftoffT !== null) { const b = fc.throttle > 0; if (wasBurning && !b) mecos++; wasBurning = b; }
    frames++;
  }
  return { mecos, ignitions, fc, real: frames * FRAME, game: fc.t - (fc.liftoffT ?? 0), fuel: fc.telemetry.fuelFrac };
}

const ships = { reliable: MOCK_SHIPS.reliable, thinSkin: MOCK_SHIPS.thinSkin, noShield: MOCK_SHIPS.noShield };
for (const [name, ship] of Object.entries(ships)) {
  for (const tw of [undefined, 1]) {
    test(`autopilot flies ${name} to orbit (${tw ? 'no warp' : 'paced'})`, () => {
      const r = flyAscent(ship, tw);
      console.log(`    (${name} ${tw ? '1x' : 'paced'}: real ${r.real.toFixed(0)} s, game ${r.game.toFixed(0)} s, fuel left ${r.fuel.toFixed(2)}, MECOs ${r.mecos})`);
      assert.equal(r.fc.failed, null, JSON.stringify(r.fc.failed));
      assert.equal(r.fc.phase, 'orbit');
      assert.ok(r.fuel > 0);
      assert.ok(r.game < 900, `game time ${r.game}`);
      assert.ok(r.ignitions <= 2, `ignitions used ${r.ignitions}`);
      assert.equal(r.mecos, 1, `MECO count ${r.mecos}`);
      if (!tw) assert.ok(r.real <= 150, `paced real time ${r.real}`);
    });
  }
}

test('Mars entry to landing, paced like the game: lands softly in <= 150 s real', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel: 5000 });
  approachBack(fc, 40);
  const corridor = computeCorridor(fc);
  const ap = createAutopilot();
  const pacer = createPacer(), det = createEventDetector();
  let frames = 0;
  while (!fc.failed && !fc.landed && frames < 60 * 900) {
    const input = ap.update(fc, { corridor });
    const ctx = paceContext(fc, { ascent: null, landing: landingGuide(fc), trimming: !!input.trim });
    for (const e of det.update(ctx)) pacer.event(e, ctx.t);
    const d = pacer.decide(ctx, FRAME);
    fc.update(FRAME, input, { timeWarp: d.warp, stopOnNotice: true });
    frames++;
  }
  console.log(`    (paced entry: real ${(frames * FRAME).toFixed(0)} s, game ${fc.t.toFixed(0)} s, touchdown ${fc.landingSpeed?.toFixed(2)} m/s)`);
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  assert.equal(fc.landed, true);
  assert.ok(fc.landingSpeed <= 3);
  assert.ok(frames * FRAME <= 150, `real ${frames * FRAME}`);
});

test('autopilot does nothing during the countdown / before liftoff', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable });
  const ap = createAutopilot();
  let i = ap.update(fc, { countdown: true });
  assert.equal(i.aim, undefined); assert.equal(i.throttleTarget, undefined); assert.equal(i.brake, false); assert.equal(i.trim, 0);
  i = ap.update(fc, {});
  assert.equal(i.throttleTarget, undefined);
  assert.equal(ap.status.step, 'standby');
});

test('autopilot flies the Mars entry to a soft landing, only through inputs', () => {
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, planetId: 'mars', start: { ...STARTS.marsEntry, flightPathDeg: -22.8 }, fuel: 5000 });
  approachBack(fc, 40);
  const corridor = computeCorridor(fc);
  const ap = createAutopilot();
  let frames = 0, ifaceFpa = null;
  const steps = new Set();
  while (!fc.failed && !fc.landed && frames < 60 * 900) {
    if (fc.altitude > fc.planet.scaleHeight * 9) { const p = predictInterface(fc); if (p) ifaceFpa = p.fpaDeg; }
    const input = ap.update(fc, { corridor });
    steps.add(ap.status.step);
    fc.update(FRAME, input, { timeWarp: 1 });
    frames++;
  }
  console.log(`    (entry: touchdown ${fc.landingSpeed?.toFixed(2)} m/s, ${(frames * FRAME).toFixed(0)} s, interface ${ifaceFpa?.toFixed(2)} deg, centre ${corridor.centreDeg.toFixed(2)}, steps ${[...steps]})`);
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  assert.equal(fc.landed, true);
  assert.ok(fc.landingSpeed <= 3, `touchdown ${fc.landingSpeed}`);
  assert.ok(Math.abs(ifaceFpa - corridor.centreDeg) <= 0.6, `interface ${ifaceFpa} vs centre ${corridor.centreDeg}`);
  assert.ok(steps.has('entry') && steps.has('descent'));
});

test('autopilot dodges the debris field in orbit', () => {
  const p = PLANETS.earth;
  const alt = 200000;
  const start = { altitude: alt, speed: Math.sqrt((p.g * p.radius ** 2) / (p.radius + alt)), flightPathDeg: 0, facing: 'prograde' };
  const fc = mk({ shipSpec: MOCK_SHIPS.reliable, start });
  fc.setObstacles(createDebrisField({ fc, aheadDistance: 3600, count: 45, seed: 2041 }));
  const ap = createAutopilot();
  let hits = 0, dodged = false;
  fc.onNotice = (t) => { if (t === 'debris_hit') hits++; };
  for (let f = 0; f < 60 * 120 && !fc.failed; f++) {
    const input = ap.update(fc, {});
    if (ap.status.step === 'dodge') dodged = true;
    fc.update(FRAME, input, { timeWarp: 1 });
  }
  console.log(`    (debris: dodged ${dodged}, hits ${hits}, armor left ${fc.armorLeft}, failed ${fc.failed?.causeId ?? 'no'})`);
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  assert.ok(hits <= fc.ship.armorHits);
});

// ---- FlightController inputs ----
const orbitFc = (stats = {}) => {
  const p = PLANETS.earth;
  const alt = 200000;
  const ship = { ...MOCK_SHIPS.reliable, stats: { ...MOCK_SHIPS.reliable.stats, ...stats } };
  return mk({ shipSpec: ship, start: { altitude: alt, speed: Math.sqrt((p.g * p.radius ** 2) / (p.radius + alt)), flightPathDeg: 0, facing: 'prograde' } });
};

test('input.aim turns the nose toward the aim, within maxTurnRate', () => {
  const fc = orbitFc();
  const aim = norm(v3(0, 1, 0.0)); // radial up
  const start = dot(fc.forward, aim);
  let maxRate = 0;
  for (let i = 0; i < 120 * 30; i++) {
    fc.update(FIXED_DT, { aim });
    maxRate = Math.max(maxRate, len(fc.omega));
  }
  assert.ok(start < 0.5);
  assert.ok(dot(fc.forward, aim) > 0.99, `aligned ${dot(fc.forward, aim)}`);
  assert.ok(maxRate <= TUNING.maxTurnRate + 1e-9, `rate ${maxRate}`);
});

test('input.aim ignored when invalid; zero aim falls back to damping', () => {
  const fc = orbitFc();
  const f0 = fc.forward;
  for (let i = 0; i < 120; i++) fc.update(FIXED_DT, { aim: { x: 0, y: 0, z: 0 } });
  assert.ok(dot(fc.forward, f0) > 0.9999);
  for (let i = 0; i < 120; i++) fc.update(FIXED_DT, { aim: { x: NaN, y: 1, z: 0 } });
  assert.ok(dot(fc.forward, f0) > 0.9999);
});

test('input.throttleTarget: 0 shuts the engine, minThrottle is honoured, relight costs an ignition', () => {
  const fc = orbitFc({ minThrottle: 0.4, ignitions: 2 });
  fc.update(FIXED_DT, { throttleTarget: 0.3 });
  assert.equal(fc.throttle, 0.4);
  assert.equal(fc.ignitionsLeft, 1);
  fc.update(FIXED_DT, { throttleTarget: 0.8 });
  assert.equal(fc.throttle, 0.8);
  assert.equal(fc.ignitionsLeft, 1);
  fc.update(FIXED_DT, { throttleTarget: 0 });
  assert.equal(fc.throttle, 0);
  fc.update(FIXED_DT, {});
  assert.equal(fc.engineLit, false);
  fc.update(FIXED_DT, { throttleTarget: 1 });
  assert.equal(fc.throttle, 1);
  assert.equal(fc.ignitionsLeft, 0);
  fc.update(FIXED_DT, { throttleTarget: 0 });
  fc.update(FIXED_DT, {});
  fc.update(FIXED_DT, { throttleTarget: 1 });
  assert.equal(fc.throttle, 0, 'no ignition left: stays off');
});

let fails = 0;
for (const [s, name, e] of results) {
  console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`);
  if (e) { fails++; console.log('     ', e.message); }
}
console.log(`\n${results.length - fails}/${results.length} autopilot tests passed`);
process.exit(fails ? 1 : 0);
