// Part effects in flight, propulsion: engines and the launch pad (traits.propulsion): throttle depth and ignitions (shipParams already reads them), steering authority, an engine failing in flight by its reliability (a cluster with engine-out keeps going), the pad holding a strong ship back at liftoff (a cheap pad: a slow climb).
// Owner: the wave-5 propulsion agent (Role 1, src/builder/CLAUDE.md §8). Hooks: see ./index.js. Every hook is optional;
// with none the flight behaves exactly as before. Record what happened with note() for the hangar's flight analysis.
//
// What each hook does (the numbers and their sources: src/builder/traits/propulsion.json):
//   begin     rolls, with flight.rng, when each engine and solid motor would fail in flight (its in-flight share of
//             1 − reliability, spread over the rated burn time) and the dice for every restart. The factory defects were
//             rolled at confirm (asBuilt.js); stats.asBuiltDefects, when the builder passes them, are realised in time.
//   params    carries the engine starts across the scenes of one launch (and the transfer burn, made outside a controller)
//   thrust    the pad holds a ship it cannot take at its throttle until it clears the tower; engines lost; jet vanes' drag
//   ignite    a restart in flight may fail to light (more often in free fall with nothing to settle the propellant)
//   turnAccel the steering the player chose: gimbals and vanes by the thrust now, verniers, solid nozzles, RCS by the mass
//   step      burn time, engine failures (contained: thrust lost; uncontained: the ship is lost), starts, the record
//   liftoff   the pad start, the lift-off acceleration, the held thrust
//   end       the flight's summary for the hangar (starts, throttle floor, hover)
// Value hooks are pure (they only read flight.state.propulsion); dice and records live in begin, liftoff, step and end.
import { note } from './index.js';
import { atmosphereTop } from '../atmosphere.js';

const GROUP = 'propulsion';
const UNSET = 1e-9;
const LANDING_ALT = 3000; // m: below this a Mars controller charges every start (the powered descent)
const fin = (x) => Number.isFinite(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const traitsOf = (flight) => flight?.traits?.propulsion ?? null;
const stateOf = (flight) => flight?.state?.propulsion ?? null;
const live = (p) => !!(p && (p.engines?.length || p.boosters?.length));
const mainEngine = (p) => p?.engines?.[0]?.partId ?? null;
/** Time for the record: seconds since lift-off on Earth, else the controller's own clock. */
const tOf = (fc) => Math.round((fc.liftoffT != null ? fc.t - fc.liftoffT : fc.t) * 10) / 10;
const onEarth = (fc) => fc?.planetId === 'earth';

// per controller (a launch has several: the pad and orbit on Earth, the entry and landing on Mars)
const perFc = new WeakMap();
// a controller starts with its engine off (FlightController's constructor), so the first light it makes is a start
const pcOf = (fc) => { let pc = perFc.get(fc); if (!pc) { pc = { lit: false, noIgn: false, first: true }; perFc.set(fc, pc); } return pc; };

function add(entry) { note({ group: GROUP, ...entry }); }
/** flight:event part_failure through the controller (BUS_FLIGHT_EVENTS maps it to the bus); no text on screen. */
function partFailure(fc, part, kind) {
  try { if (fc._flags) fc._flags.part_failure = false; fc._event?.('part_failure', { part, kind }); } catch { /* the record still has it */ }
}

// ---------- begin: what this flight holds ----------
export function begin(flight) {
  const p = traitsOf(flight);
  if (!live(p)) return;
  const rng = typeof flight.rng === 'function' ? flight.rng : Math.random;
  const units = [];
  const T = p.burnRefS > 0 ? p.burnRefS : null;
  for (const e of p.engines ?? []) {
    const lam = T && e.inFlightFail > 0 ? -Math.log(1 - Math.min(0.99, e.inFlightFail)) / T : 0; // per engine, per second of firing
    for (let j = 0; j < (e.count ?? 1); j++) {
      const u = rng(), m = rng();
      const at = lam > 0 ? -Math.log(1 - u) / lam : Infinity;
      if (!(at < 4 * T)) continue; // never within this flight's propellant
      const mode = m < e.catastrophic ? 'burst' : e.engineOut ? (e.pairOut ? 'pair' : 'out') : e.count > 1 ? 'pair' : 'shutdown';
      units.push({ kind: 'engine', partId: e.partId, unit: j, at: Math.round(at * 10) / 10, mode, share: mode === 'pair' ? Math.min(e.thrustShare, 2 * e.unitShare) : e.unitShare, done: false });
    }
  }
  for (const b of p.boosters ?? []) {
    const u = rng(), m = rng();
    const T2 = b.burnTime > 0 ? b.burnTime : null;
    const lam = T2 && b.inFlightFail > 0 ? -Math.log(1 - Math.min(0.99, b.inFlightFail)) / T2 : 0;
    const at = lam > 0 ? -Math.log(1 - u) / lam : Infinity;
    if (at < T2) units.push({ kind: 'booster', partId: b.partId, unit: 0, at: Math.round(at * 10) / 10, mode: m < b.catastrophic ? 'burst' : 'out', share: b.thrustShare, done: false });
  }
  // the as-built engine defects the builder rolled at confirm (the flown thrust already lacks them): they happen now
  const defects = [];
  for (const d of flight.spec?.stats?.asBuiltDefects ?? []) {
    const e = (p.engines ?? []).find((x) => x.partId === d.partId);
    if (!e || !['out', 'outPair', 'debris'].includes(d.kind)) continue;
    const share = d.kind === 'out' ? e.unitShare : d.kind === 'outPair' ? Math.min(e.thrustShare, 2 * e.unitShare) : e.unitShare * clamp(d.pct ?? 0, 0, 1);
    const at = d.kind === 'debris' ? null : Math.round((10 + rng() * Math.max(0, 0.5 * (T ?? 120) - 10)) * 10) / 10;
    defects.push({ kind: d.kind, partId: d.partId, unit: d.unit ?? 0, share, pct: d.pct ?? null, at, done: false });
  }
  flight.state.propulsion = {
    burnS: 0, lost: 0, lostLiquid: 0, lostBy: {}, units, defects,
    pendingShare: defects.reduce((t, d) => t + d.share, 0),
    ign: { n: 0, lights: 0, failed: 0, refunded: 0, u: Array.from({ length: 32 }, () => rng()) },
    minThr: null, padLaunch: false, transferDone: false,
    pad: { cleared: false, liftoffT: null },
    dead: false, deadFor: 0, vanesGone: false, hover: null, summed: false,
  };
}

// ---------- value hooks (pure) ----------
/** Starts carry across the scenes of one launch; a Mars controller also pays for the transfer burn made in between. */
export function params(sp, ctx, flight) {
  const p = traitsOf(flight), st = stateOf(flight);
  if (!p || !st || !fin(sp.ignitions)) return sp;
  const onMars = ctx?.fc?.planetId && !onEarth(ctx.fc);
  const used = st.ign.lights + st.ign.failed - st.ign.refunded + (onMars && st.padLaunch && !st.transferDone ? 1 : 0);
  return { ...sp, ignitions: Math.max(0, sp.ignitions - used) };
}

/** Share of the liquid thrust (of the total) the ship has. */
const liquidShare = (p) => (p.engines ?? []).reduce((t, e) => t + (e.thrustShare ?? 0), 0);

/** The pad's hold on the thrust now (1 = full thrust). */
function padHold(fc, alt, p, st, n) {
  const pad = p.pad;
  if (!onEarth(fc) || !pad || !(pad.heldThrottle < 1) || st.pad.cleared) return 1;
  const onPad = fc.onGround && fc.liftoffT == null;
  const climbing = !fc.onGround && fc.liftoffT != null && alt < pad.clearM && fc.t - fc.liftoffT < pad.maxHoldS;
  if (!onPad && !climbing) return 1;
  // the computer never holds the engines below what lifts the ship
  const r = Math.hypot(fc.pos.x, fc.pos.y, fc.pos.z);
  const weight = fc.mass * (fc.mu / (r * r));
  if (n * pad.heldThrottle < (pad.minHeldTwr ?? 1.02) * weight) return 1;
  return pad.heldThrottle;
}

export function thrust(n, ctx, flight) {
  const p = traitsOf(flight), st = stateOf(flight);
  if (!live(p) || !st || !(n > 0)) return n;
  if (st.dead) return 0;
  const fc = ctx.fc;
  let m = 1;
  if (st.pendingShare > 0) m /= Math.max(0.05, 1 - st.pendingShare); // as-built defects still to come: the engine still runs
  m *= Math.max(0, 1 - st.lost);
  const v = p.steering?.vanes;
  if (v && !st.vanesGone) m *= 1 - (v.loss ?? 0); // graphite vanes in the jet cost a little thrust while they last
  m *= padHold(fc, ctx.alt ?? fc.altitude, p, st, n * m);
  return n * m;
}

/** Chance that a restart now fails to light. */
function restartFailure(p, fc) {
  let ok = 1;
  for (const e of p.engines ?? []) ok *= 1 - (e.restartFail ?? 0);
  let f = 1 - ok;
  const inSpace = fc.altitude > atmosphereTop(fc.planet);
  if (inSpace && !p.settle) f *= p.restart?.spaceUnsettled ?? 3;
  return clamp(f, 0, 0.9);
}

export function ignite(ok, ctx, flight) {
  if (!ok) return ok;
  const p = traitsOf(flight), st = stateOf(flight);
  if (!p?.engines?.length || !st) return ok;
  const fc = ctx.fc;
  if (st.lostLiquid >= liquidShare(p) - UNSET) return false; // no working engine left
  if (onEarth(fc) && fc.onGround && fc.liftoffT == null) return true; // the pad start: the clamps and the pad checked it (asBuilt.js)
  const u = st.ign.u[st.ign.n % st.ign.u.length];
  return !(u < restartFailure(p, fc));
}

/** Steering authority now, relative to the game's tuned value (1 = a standard hydraulic gimbal at a 1.4 g lift-off). */
export function steerFactor(fc, flight) {
  const p = traitsOf(flight), s = p?.steering, st = stateOf(flight);
  if (!s) return null;
  const firing = fc.engineLit && fc.fuel > 0 && (fc.throttle > 0 || fc._braking);
  const thr = firing ? (fc._braking ? 1 : fc.throttle) : 0;
  const lost = st ? 1 - st.lost : 1;
  const aFull = (fc.thrustNow() * lost) / fc.mass; // m/s² at full throttle now
  const refA = (s.refTwr ?? 1.4) * fc.g0;
  const liq = 1 - (s.solids?.share ?? 0);
  const vanes = s.vanes && !(st?.vanesGone) ? s.vanes.k ?? 0 : 0;
  let k = 0;
  if (firing) {
    k += ((s.tvc ?? 0) + vanes) * liq * thr * aFull / refA; // gimbals and vanes: by the thrust now
    k += (s.verniers ?? 0) * liq * aFull / refA; // verniers: at their own thrust
    k += (s.solids?.k ?? 0) * (s.solids?.share ?? 0) * thr * aFull / refA;
  }
  const rcs = (s.rcs ?? 0) * clamp(fc.ship.dryMass / fc.mass, s.rcsMassFloor ?? 0.25, 1); // a full ship is heavy to turn
  return k + rcs;
}

export function turnAccel(a, ctx, flight) {
  const s = traitsOf(flight)?.steering;
  const f = s ? steerFactor(ctx.fc, flight) : null;
  if (f == null) return a;
  return clamp((s.base ?? 0.8) * f, s.min ?? 0.15, (s.base ?? 0.8) * (s.max ?? 1.6));
}

// ---------- event hooks ----------
function countStart(fc, st, p, pc, { failed = false } = {}) {
  st.ign.n += 1;
  if (failed) st.ign.failed += 1; else st.ign.lights += 1;
  // stop-gap until Role 2 fixes the entry phase flicker (SHARE_PROBLEMS: 'ascentGuide fires one-frame burns on a lofted
  // Mars entry'): a start made above 3 km on Mars is not charged nor worn, whatever the igniter (by altitude alone)
  const refund = !onEarth(fc) && fc.altitude > LANDING_ALT;
  if (refund) { if (fin(fc.ignitionsLeft)) fc.ignitionsLeft += 1; st.ign.refunded += 1; }
  // one 'ignition' note per start for the wear model (the notes contract); a start given back by the stop-gap is the
  // autopilot's one-frame flicker, not a real start, so it is kept apart and wears nothing
  add({ partId: mainEngine(p), what: refund ? 'ignitionRefunded' : failed ? 'ignitionFailed' : 'ignition', value: st.ign.n, t: tOf(fc) });
}

function trackStarts(fc, st, p, pc) {
  if (pc.first) {
    pc.first = false;
    // the transfer burn to Mars was made between the scenes, outside any controller: one start
    if (!onEarth(fc) && st.padLaunch && !st.transferDone) {
      st.transferDone = true; st.ign.n += 1; st.ign.lights += 1;
      add({ partId: mainEngine(p), what: 'ignition', value: st.ign.n, transfer: true });
    }
  }
  if (!pc.lit && fc.engineLit) countStart(fc, st, p, pc);
  if (fc._flags?.ignition_failed) {
    fc._flags.ignition_failed = false; // re-armed, so the next failure shows too (FlightController re-arms it the same way)
    countStart(fc, st, p, pc, { failed: true });
    partFailure(fc, mainEngine(p), 'noLight');
  }
  if (fc._flags?.no_ignition && !pc.noIgn) { pc.noIgn = true; add({ partId: mainEngine(p), what: 'noIgnition', t: tOf(fc) }); }
  pc.lit = !!fc.engineLit;
}

export function liftoff(ctx, flight) {
  const p = traitsOf(flight), st = stateOf(flight);
  if (!live(p) || !st) return;
  const fc = ctx.fc;
  const pc = pcOf(fc);
  pc.first = false;
  st.padLaunch = onEarth(fc);
  st.pad.liftoffT = fc.t;
  if (fc.engineLit && st.ign.n === 0) { st.ign.n = 1; st.ign.lights = 1; add({ partId: mainEngine(p), what: 'ignition', value: 1, t: 0, pad: true }); }
  pc.lit = !!fc.engineLit;
  // how hard the ship leaves the pad: the net upward acceleration with the thrust the hooks give now
  const r = Math.hypot(fc.pos.x, fc.pos.y, fc.pos.z), g = fc.mu / (r * r);
  const n = fc.fx?.value ? fc.fx.value('thrust', fc.thrustNow(ctx.alt) * fc.throttle, ctx) : fc.thrustNow(ctx.alt) * fc.throttle;
  const a = n / fc.mass - g;
  add({ what: 'liftoff', section: 'pad', value: Math.round(a * 100) / 100, gs: Math.round((a / fc.g0) * 100) / 100, twr: Math.round((n / (fc.mass * g)) * 100) / 100, t: 0 });
  const pad = p.pad;
  if (pad && pad.heldThrottle < 1 && padHold(fc, 0, p, st, fc.thrustNow(ctx.alt) * fc.throttle) < 1) {
    add({ what: 'padHeld', section: 'pad', value: pad.thrustKN, limit: pad.heatLimitKN, trait: 'pad.heatLimitKN', held: Math.round(pad.heldThrottle * 100), t: 0 });
  }
  // the steering the ship has at lift-off, against a standard hydraulic gimbal
  const f = steerFactor(fc, flight);
  if (f != null) {
    const dev = p.steering?.devices?.[0]?.partId;
    add({ partId: dev ?? mainEngine(p), what: dev ? 'steering' : 'steeringRcs', value: Math.round(f * 100) / 100, t: 0 });
  }
}

function resolveUnit(u, fc, st, p) {
  u.done = true;
  const t = tOf(fc);
  if (u.mode === 'burst') {
    add({ partId: u.partId, what: u.kind === 'booster' ? 'boosterBurst' : 'engineBurst', t, unit: u.unit });
    partFailure(fc, u.partId, 'burst');
    return u.kind === 'booster'
      ? { endingId: 'rud', cause: 'A solid booster burst in flight and destroyed the ship.', data: { partId: u.partId } }
      : { endingId: 'rud', cause: 'An engine failed in flight and burst, and nothing contained it.', data: { partId: u.partId } };
  }
  // contained: the engine (and, without engine-out, the one opposite) shuts down for good
  const e = (p.engines ?? []).find((x) => x.partId === u.partId);
  const typeShare = u.kind === 'booster' ? u.share : e?.thrustShare ?? u.share;
  const already = st.lostBy[u.partId] ?? 0;
  const share = Math.max(0, Math.min(u.share, typeShare - already));
  if (!(share > UNSET)) return null; // that cluster was already shut down
  st.lostBy[u.partId] = already + share;
  st.lost = Math.min(1, st.lost + share);
  if (u.kind === 'engine') st.lostLiquid += share;
  const what = u.kind === 'booster' ? 'engineShutdown' : u.mode === 'out' ? 'engineOut' : u.mode === 'pair' ? 'enginePair' : 'engineShutdown';
  add({ partId: u.partId, what, value: Math.round(share * 1000) / 1000, t, unit: u.unit });
  partFailure(fc, u.partId, u.mode);
  return null;
}

export function step(ctx, flight) {
  const p = traitsOf(flight), st = stateOf(flight);
  if (!live(p) || !st) return null;
  const fc = ctx.fc, dt = ctx.dt ?? 0;
  const pc = pcOf(fc);
  trackStarts(fc, st, p, pc);

  const firing = fc.engineLit && fc.fuel > 0 && (fc.throttle > 0 || fc._braking);
  if (firing) {
    st.burnS += dt;
    const thr = fc._braking ? 1 : fc.throttle;
    if (st.minThr == null || thr < st.minThr) st.minThr = thr;
  }
  const v = p.steering?.vanes;
  if (v && !st.vanesGone && fin(v.lifeS) && st.burnS >= v.lifeS) {
    st.vanesGone = true;
    add({ partId: p.steering.devices?.find((d) => d.type === 'jet_vanes')?.partId ?? mainEngine(p), what: 'vanesGone', value: Math.round(st.burnS), t: tOf(fc) });
  }

  // the tower: cleared once the ship is above it
  if (st.padLaunch && !st.pad.cleared && onEarth(fc) && fc.liftoffT != null && p.pad && (ctx.alt ?? fc.altitude) >= p.pad.clearM) {
    st.pad.cleared = true;
    add({ what: 'towerClear', section: 'pad', value: Math.round((fc.t - fc.liftoffT) * 10) / 10, towerM: Math.round(p.pad.clearM), t: tOf(fc) });
  }

  // as-built defects: debris from the pad hits an engine just after lift-off; a bad engine quits during the climb
  for (const d of st.defects) {
    if (d.done) continue;
    const due = d.kind === 'debris' ? onEarth(fc) && fc.liftoffT != null && fc.t - fc.liftoffT >= (p.pad?.debrisAfterS ?? 1) : st.burnS >= d.at;
    if (!due) continue;
    d.done = true;
    st.pendingShare = Math.max(0, st.pendingShare - d.share);
    if (d.kind === 'debris') add({ partId: d.partId, what: 'debrisHit', value: d.pct ?? d.share, t: tOf(fc), unit: d.unit });
    else add({ partId: d.partId, what: d.kind === 'out' ? 'engineOut' : 'enginePair', value: Math.round(d.share * 1000) / 1000, t: tOf(fc), unit: d.unit, asBuilt: true });
    partFailure(fc, d.partId, d.kind);
  }

  // engines and solid motors failing in flight (rolled in begin)
  for (const u of st.units) {
    if (u.done) continue;
    const due = u.kind === 'booster' ? onEarth(fc) && fc.liftoffT != null && fc.t - fc.liftoffT >= u.at : firing && st.burnS >= u.at;
    if (!due) continue;
    const out = resolveUnit(u, fc, st, p);
    if (out) return out;
  }

  // no working engine left: on a path that never comes back, the ship drifts
  const liq = liquidShare(p);
  if (!st.dead && liq > 0 && st.lostLiquid >= liq - UNSET && !(p.boosters ?? []).some((b) => onEarth(fc) && fc.liftoffT != null && fc.t - fc.liftoffT < (b.burnTime ?? 0) && !(st.lostBy[b.partId] > 0))) st.dead = true;
  if (st.dead) {
    const top = atmosphereTop(fc.planet);
    const orb = fc.orbit();
    const never = fc.altitude > top && (orb.periapsis > top || (orb.e >= 1 && ctx.speed > 0 && (fc.vel.x * fc.pos.x + fc.vel.y * fc.pos.y + fc.vel.z * fc.pos.z) > 0));
    st.deadFor = never ? st.deadFor + dt : 0;
    if (st.deadFor > (p.deadDriftS ?? 5)) {
      add({ partId: mainEngine(p), what: 'drift', t: tOf(fc) });
      return { endingId: 'adrift', cause: 'The engines failed and could not be restarted, so the ship drifts on a path that never comes back.', data: { partId: mainEngine(p) } };
    }
  }

  // landing on another world: what throttle hovering would take (the weight over the full thrust)
  if (!onEarth(fc) && (ctx.alt ?? fc.altitude) < 200 && fc.vel && (fc.vel.x * fc.pos.x + fc.vel.y * fc.pos.y + fc.vel.z * fc.pos.z) < 0) {
    const full = fc.thrustNow() * Math.max(0, 1 - st.lost);
    if (full > 0) {
      const r = Math.hypot(fc.pos.x, fc.pos.y, fc.pos.z);
      st.hover = { need: (fc.mass * (fc.mu / (r * r))) / full };
    }
  }
  return null;
}

export function end(ctx, flight) {
  const p = traitsOf(flight), st = stateOf(flight);
  if (!live(p) || !st || st.summed) return;
  st.summed = true;
  const id = mainEngine(p);
  if (!id) return;
  const starts = st.ign.n - st.ign.refunded; // the starts that count (not the stop-gap's)
  if (starts > 0) {
    if (fin(p.ignitions)) add({ partId: id, what: 'ignitions', value: starts, failed: st.ign.failed, limit: p.ignitions, trait: 'ignitions' });
    else add({ partId: id, what: 'ignitionsFree', value: starts, failed: st.ign.failed });
  }
  if (st.minThr != null) add({ partId: id, what: 'throttleFloor', value: Math.round(st.minThr * 1000) / 1000, floor: Math.round((p.minThrottle ?? 0) * 100) });
  if (st.hover && fin(st.hover.need)) {
    const need = clamp(st.hover.need, 0, 1);
    const floor = p.minThrottle ?? 0;
    // value > limit = the engines could not go deep enough (the notes contract): depth needed against the depth they have
    add({ partId: id, what: need < floor ? 'hover' : 'hoverOk', value: Math.round((1 - need) * 1000) / 1000, limit: p.throttleDepth ?? 1 - floor, trait: 'throttleDepth', need: Math.round(need * 100), floor: Math.round(floor * 100) });
  }
}
