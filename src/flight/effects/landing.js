// Part effects in flight, landing: landing (traits.landing): the touchdown speed the legs stand, the chutes.
// Owner: the wave-5 landing agent (Role 1, src/builder/CLAUDE.md §8). Hooks: see ./index.js. Every hook is optional;
// with none the flight behaves exactly as before. Record what happened with note() for the hangar's flight analysis.
//
// What the player feels (no message, only the physics; src/builder/traits/landing.json has the real numbers):
//  - touchdownLimit: the legs take the energy they were built for, so a heavy ship on light legs must touch down
//    softer, and a light ship on heavy legs may come down harder (½·M·v² + M·g·s at the design point).
//  - step, at touchdown: a tall ship on a narrow stance tips over when it lands moving sideways, or leaning past the
//    edge between two feet; folding legs may fail to lock (Falcon 9 / Jason-3, 2016) and then the ship falls.
//  - chuteDeploy, chuteCdA (FlightController hooks): the computer fires each canopy when the
//    ship is slow enough for its type (a disk-gap-band at Mach 2.2, a ringsail only below Mach 0.7); below
//    chute.floorM it fires whatever is left, and a canopy fired beyond its Mach limit tears. A cluster lands on one
//    canopy less when one fails; Soyuz' single main has a reserve.
// Random failures follow the part's own reliability (1 − reliability per flight), rolled once in begin().
import { note } from './index.js';

const fin = Number.isFinite;
const num = (x, d = 0) => (fin(Number(x)) ? Number(x) : d);
const DEG = 180 / Math.PI;
const DRIFT_MIN = 0.05; // m/s: slower than this sideways, the touchdown is judged on the ship's lean alone

const L = (flight) => flight?.traits?.landing ?? null;
const S = (flight) => (flight.state.landing ??= { canopies: {}, legDefect: null, touch: null, noted: {} });

// ---------- the physics (the same formulas as src/builder/traits/landing.js, which the flight may not import) ----------
function legEnergy(leg, g) {
  if (fin(leg?.energyJ)) return leg.energyJ;
  const M = num(leg?.designMassKg), v = num(leg?.designMps), s = num(leg?.strokeM);
  return (0.5 * M * v * v + M * g * s) * num(leg?.energyF, 1);
}
/** Touchdown speed (m/s) the legs stand at mass m: √(2·(f·E − m·g·s) / m), capped at maxOverDesign × design speed. */
export function legLimit(leg, m, g, f = 1) {
  if (!leg || !(m > 0) || !(g > 0)) return null;
  const v = Math.sqrt(Math.max(0, (2 * (legEnergy(leg, g) * f - m * g * num(leg.strokeM))) / m));
  return leg.designMps > 0 ? Math.min(v, leg.designMps * num(leg.maxOverDesign, 2)) : v;
}
/**
 * Sideways speed (m/s) that tips the ship over the edge between two feet when it leans leanDeg along its drift
 * (negative: leaning back against the drift, which helps). 0: it leans past the edge, or has no stance on that side
 * (a missing leg: edgeF ≈ 0).
 */
export function tipLimit(leg, g, leanDeg = 0, edgeF = 1) {
  const edge = num(leg?.edgeM) * edgeF, cg = num(leg?.cgM);
  if (!(cg > 0) || !(g > 0) || !fin(edge)) return null;
  if (edge <= 1e-6) return 0;
  const Lp = Math.hypot(edge, cg);
  const margin = Math.min(Math.atan2(edge, cg) - num(leanDeg) / DEG, 89 / DEG);
  if (margin <= 0) return 0;
  const h = Lp * Math.cos(margin);
  const k2 = (num(leg.heightM, 2 * cg) ** 2) / 12;
  return (Math.sqrt(2 * g * (Lp - h) * (k2 + Lp * Lp)) / h) * num(leg.slideF, 1);
}

// a leg set's state after the dice: energy factor (a weak strut, a torn bag: traits.landing.touchdown.defects) and
// stance factor (a leg that did not lock: the edge between the two neighbours of the missing foot, r·cos(2π/n), which
// is at or behind the centre for 3 or 4 legs: the ship falls)
function legCondition(leg, defect) {
  if (defect === 'weakCore') return { f: num(leg?.defects?.weakCore, 0.75), edgeF: 1 };
  if (defect === 'bagTear') return { f: num(leg?.defects?.bagTear, 0.5), edgeF: 1 };
  if (defect === 'legLock') {
    const n = Math.max(3, num(leg.count, 4));
    const edgeF = Math.max(0, Math.cos((2 * Math.PI) / n) / Math.cos(Math.PI / n));
    return { f: (n - 1) / n, edgeF: edgeF <= 1e-6 ? 0 : edgeF };
  }
  return { f: 1, edgeF: 1 };
}

// ---------- hooks ----------
/** Once per launch: which leg, canopy or antenna is the one in a hundred that fails (its 1 − reliability). */
export function begin(flight) {
  const land = L(flight);
  if (!land) return;
  const st = S(flight);
  const rng = flight.rng ?? Math.random;
  const td = land.touchdown;
  if (td?.kind && rng() < 1 - num(td.reliability, 1)) {
    st.legDefect = td.kind === 'airbags' ? 'bagTear' : td.deploys ? 'legLock' : 'weakCore';
  }
  for (const c of land.chute?.canopies ?? []) {
    st.canopies[c.partId] = { state: 'packed', fails: rng() < 1 - num(c.reliability, 1) };
  }
  st.antennaFailed = (land.comms?.antennas ?? []).filter((a) => rng() < 1 - num(a.reliability, 1)).map((a) => a.partId);
}

/** The touchdown speed the legs stand at this landed mass (FlightController compares the total speed with it). */
export function touchdownLimit(v, ctx, flight) {
  const td = L(flight)?.touchdown;
  const fc = ctx?.fc;
  if (!td?.kind || !fc) return v;
  const { f } = legCondition(td, flight.state.landing?.legDefect);
  const lim = legLimit(td, fc.mass, fc.planet?.g, f);
  return fin(lim) ? lim : v;
}

/**
 * FlightController._updateParachute (hook requested from the lead): the speed below which the computer starts the chute
 * sequence = the fastest trigger of the canopies on board (their Mach limit); below chute.floorM it fires anyway.
 */
export function chuteDeploy(lim, ctx, flight) {
  const ch = L(flight)?.chute;
  if (!ch?.canopies?.length) return lim;
  const a = num(ch.soundSpeedMps, 232);
  const fastest = Math.max(...ch.canopies.map((c) => c.maxMach * a));
  if (fin(ctx?.alt) && ctx.alt < num(ch.floorM, 300)) return { ...lim, maxSpeed: Infinity };
  return { ...lim, maxSpeed: fastest };
}

/**
 * FlightController drag: the drag area of the canopies open and whole right now, plus any packed canopy that does not
 * fail and that the ship is now slow enough for (step() opens it this very step; the trajectory prediction, which
 * runs no step(), sees it open on time).
 */
export function chuteCdA(cdA, ctx, flight) {
  const ch = L(flight)?.chute;
  const st = flight.state.landing;
  if (!ch?.canopies?.length || !st?.canopies) return cdA;
  const a = num(ch.soundSpeedMps, 232);
  const speed = num(ctx?.speed, NaN);
  let sum = 0;
  for (const c of ch.canopies) {
    const s = st.canopies[c.partId];
    if (s?.state === 'open') sum += c.cdA * num(s.share, 1);
    else if ((!s || s.state === 'packed') && !s?.fails && fin(speed) && speed <= c.maxMach * a) sum += c.cdA;
  }
  return sum;
}

/** Every physics step: open the canopies the ship is slow enough for, and judge the touchdown sideways. */
export function step(ctx, flight) {
  const land = L(flight);
  const fc = ctx?.fc;
  if (!land || !fc) return null;
  const st = S(flight);
  if (land.chute?.canopies?.length) stepChutes(fc, land.chute, st);
  if (fc.altitude <= 0 && !fc.onGround && land.touchdown?.kind) return judgeTouchdown(fc, land.touchdown, st);
  return null;
}

function stepChutes(fc, ch, st) {
  const canopies = st.canopies;
  // a new descent (another FlightController, e.g. the LANDING scene after a debug jump): the canopies are packed again
  if (!fc.chuteOpen) {
    if (Object.values(canopies).some((c) => c.state !== 'packed')) for (const c of Object.values(canopies)) { c.state = 'packed'; delete c.share; }
    return;
  }
  const a = num(ch.soundSpeedMps, 232);
  const speed = Math.hypot(fc.vel.x, fc.vel.y, fc.vel.z);
  const alt = fc.altitude;
  const floor = alt < num(ch.floorM, 300);
  for (const c of ch.canopies) {
    const s = (canopies[c.partId] ??= { state: 'packed', fails: false });
    if (s.state !== 'packed') continue;
    if (!(speed <= c.maxMach * a) && !floor) continue; // still too fast for this canopy: the computer waits
    const mach = speed / a;
    const base = { group: 'landing', partId: c.partId, value: round(mach, 2), limit: c.maxMach, trait: 'chute.byPart.{partId}.maxMach', altitudeM: Math.round(alt), speedMps: Math.round(speed), t: round(fc.t, 1) };
    if (mach > c.maxMach) { s.state = 'torn'; note({ ...base, what: 'chuteTorn' }); continue; }
    s.state = 'open';
    note({ ...base, what: 'chuteOpen' });
    if (s.fails) {
      if (c.count > 1) { s.share = (c.count - 1) / c.count; note({ group: 'landing', partId: c.partId, what: 'chuteLostOne', canopies: c.count, t: base.t }); }
      else if (c.reserve > 0) { s.share = c.reserve; note({ group: 'landing', partId: c.partId, what: 'chuteReserve', value: c.reserve, t: base.t }); }
      else { s.state = 'failed'; note({ group: 'landing', partId: c.partId, what: 'chuteLost', t: base.t }); }
    }
  }
}

function judgeTouchdown(fc, td, st) {
  const up = fc.up;
  const v = fc.vel;
  const vVert = v.x * up.x + v.y * up.y + v.z * up.z;
  const h = { x: v.x - up.x * vVert, y: v.y - up.y * vVert, z: v.z - up.z * vVert };
  const vHoriz = Math.hypot(h.x, h.y, h.z);
  const f = fc.forward;
  const fUp = f.x * up.x + f.y * up.y + f.z * up.z;
  const tiltDeg = Math.acos(Math.max(-1, Math.min(1, fUp))) * DEG;
  // the lean along the drift: + the nose leans the way the ship slides (toward the edge it pivots on), − against it
  const fh = { x: f.x - up.x * fUp, y: f.y - up.y * fUp, z: f.z - up.z * fUp };
  const leanDeg = vHoriz > DRIFT_MIN ? Math.asin(Math.max(-1, Math.min(1, (fh.x * h.x + fh.y * h.y + fh.z * h.z) / vHoriz))) * DEG : tiltDeg;
  const g = fc.planet?.g;
  const cond = legCondition(td, st.legDefect);
  const still = tipLimit(td, g, tiltDeg, cond.edgeF); // 0: it leans past the edge (any way), or a leg is missing
  const tip = vHoriz > DRIFT_MIN ? tipLimit(td, g, leanDeg, cond.edgeF) : still;
  st.touch = { vVert: round(-vVert, 2), vHoriz: round(vHoriz, 2), tiltDeg: round(tiltDeg, 1), leanDeg: round(leanDeg, 1), massKg: Math.round(fc.mass), tipMps: round(tip, 2), t: round(fc.t, 1) };
  if (st.legDefect === 'legLock' && !st.noted.legLock) { st.noted.legLock = true; note({ group: 'landing', partId: td.partId, what: 'legLock', legs: td.count, t: st.touch.t }); }
  if (st.legDefect === 'weakCore' || st.legDefect === 'bagTear') {
    if (!st.noted.legWeak) { st.noted.legWeak = true; note({ group: 'landing', partId: td.partId, what: 'legWeak', value: cond.f, t: st.touch.t }); }
  }
  // too fast for the legs at all: FlightController's crash (touchdownLimit); here only what topples a ship that held
  const lim = legLimit(td, fc.mass, g, cond.f);
  if (fin(lim) && Math.hypot(vVert, vHoriz) > lim) return null;
  const fell = { endingId: 'rud', cause: 'tipped_over', data: { touchdownSpeed: round(Math.hypot(vVert, vHoriz), 2) } };
  if (still === 0) {
    // leaning past the edge between two feet (or standing on one leg less): it falls whatever its speed
    if (st.legDefect !== 'legLock') noteTilt(td, st, tipAngle(td, cond.edgeF));
    return fell;
  }
  if (fin(tip) && vHoriz > tip) {
    const bucket = Math.min(30, Math.max(0, 5 * Math.round(leanDeg / 5)));
    note({ group: 'landing', partId: td.partId, what: 'tipOver', value: round(vHoriz, 2), limit: round(tip, 2), trait: `touchdown.byPart.{partId}.tipByTiltDeg.${bucket}`, spanM: td.spanM, tiltDeg: st.touch.tiltDeg, leanDeg: st.touch.leanDeg, t: st.touch.t, tone: 'bad' });
    st.noted.tipOver = true;
    return fell;
  }
  return null;
}

/** The angle (°) the stance stands before its centre of mass passes the edge between two feet. */
function tipAngle(td, edgeF = 1) {
  const edge = num(td?.edgeM) * edgeF, cg = num(td?.cgM);
  return cg > 0 ? Math.atan2(Math.max(0, edge), cg) * DEG : null;
}
function noteTilt(td, st, limitDeg) {
  if (st.noted.tipOver || st.noted.tipTilt) return;
  st.noted.tipTilt = true;
  note({ group: 'landing', partId: td.partId, what: 'tipTilt', value: round(st.touch?.tiltDeg, 1), limit: round(limitDeg, 1), spanM: td.spanM, t: st.touch?.t ?? null, tone: 'bad' });
}

/** The flight scene ends: the touchdown and the ship's power on Mars go into the record. */
export function end(ctx, flight) {
  const land = L(flight);
  const fc = ctx?.fc;
  if (!land || !fc) return;
  const st = S(flight);
  const failed = ctx.failed ?? null;
  const touched = ctx.landed || ['crash_landing', 'tipped_over'].includes(failed?.causeId);
  if (!touched) return;
  const td = land.touchdown;
  const speed = num(ctx.touchdownSpeed, num(failed?.touchdownSpeed, NaN));
  // FlightController's own upright check (over 20°) ended it: say so, the touchdown itself is not the story
  if (td?.kind && failed?.causeId === 'tipped_over' && st.legDefect !== 'legLock') noteTilt(td, st, Math.min(20, num(tipAngle(td), 20)));
  if (td?.kind && fin(speed)) {
    const g = fc.planet?.g;
    const m = st.touch?.massKg ?? fc.mass;
    const lim = legLimit(td, m, g, legCondition(td, st.legDefect).f);
    const bucket = Math.min(100, Math.max(2, 2 * Math.round(m / 2000)));
    note({
      group: 'landing', partId: td.partId, what: 'touchdown', value: round(speed, 2), limit: round(lim, 2),
      trait: `touchdown.byPart.{partId}.limitByMassT.${bucket}`, massT: round(m / 1000, 1),
      vVert: st.touch?.vVert ?? null, vHoriz: st.touch?.vHoriz ?? null, tiltDeg: st.touch?.tiltDeg ?? null,
      energyUsed: fin(lim) && lim > 0 ? round(Math.min(1, (speed / lim) ** 2), 2) : null,
      tone: failed || (fin(lim) && speed > lim) ? 'bad' : fin(lim) && speed > 0.8 * lim ? 'info' : 'good', t: round(fc.t, 1),
    });
  }
  const p = land.power;
  if (ctx.landed && p && !st.noted.power) {
    st.noted.power = true;
    note({ group: 'landing', what: 'power', value: Math.round(num(p.generationW)), solarW: Math.round(num(p.solarMarsW)), rtgW: Math.round(num(p.rtgW)), storeKWh: round(num(p.storeWh) / 1000, 1), t: round(fc.t, 1) });
  }
}

function round(x, k = 2) { return fin(x) ? Math.round(x * 10 ** k) / 10 ** k : null; }
