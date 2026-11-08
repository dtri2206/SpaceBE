// Part effects in flight, structure: skin, structure and heat shield (traits.structure): the max-Q the structure stands, heating on the climb, what a debris hit does to this skin, how much heat the shield absorbs on entry, wear.
// Owner: the wave-5 structure agent (Role 1, src/builder/CLAUDE.md §8). Hooks: see ./index.js. Every hook is optional;
// with none the flight behaves exactly as before. Record what happened with note() for the hangar's flight analysis.
//
// What the player feels (no messages; the numbers and their sources are in src/builder/traits/structure.json):
//   maxQ       the ship breaks up (rud, max_q_exceeded) above its weakest skin's rating / 1.4, about 41 kPa for
//              aluminium 2219, 36 kPa for steel, 44 kPa for carbon; less once the skin is hot or wrinkled at confirm.
//   step       the skins heat on the climb (hull.js's thin-skin model in the real 1976 air, at the ship's own speed);
//              a nose skin far past its limit sheds pieces onto the heat shield (the Columbia ending on entry).
//   debrisHit  NASA's ballistic limits decide a hit: bounced off, dented, holed (a cabin leak for the life group, a
//              propellant leak that drains the tanks) or burst. Armour still takes a hit as before when the piece is
//              within what it stops; a bigger one goes through and the wall behind decides.
//   heatLimit  the shield's real peak heat flux (PICA 1,100 W/cm², Avcoat 500, SLA-561V 200, HIAD 80…), and in step its
//              heat load: an ablator that runs out burns through (burnup). A damaged shield keeps the flight's own
//              damaged limit, so the Columbia path (fragile tiles → theFoam) is unchanged.
// Value hooks (params, maxQ, heatLimit, debrisHit) are pure: they read flight.state.structure, never write it. Dice
// come from flight.rng in begin only (a seed that places each hit); everything after is deterministic physics.
// flight.state.structure (saved with the flight record): peakQ, peakC, hits, heatLoad, cabinLeak { holeMm2, kgPerDay,
// t, partId } for the life group, tankLeak, shieldDamaged.
import { note } from './index.js';
import { heatFlux, HEAT_REAL_SCALE, SPEED_REAL_SCALE } from '../atmosphere.js';
import { dot, len, sub, scale } from '../vec.js';

const G = 'structure';
const SECTIONS = ['nose', 'body', 'tail'];
const LOAD_REAL_SCALE = HEAT_REAL_SCALE / SPEED_REAL_SCALE; // game heat load → real-equivalent (same air, ⅓ speed, 3× as long)
const SIGMA_SB = 5.670374e-8;
const fin = (x) => Number.isFinite(x);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const traitsOf = (flight) => {
  const S = flight?.traits?.structure;
  return S && S.version >= 1 && S.skin ? S : null;
};
const stateOf = (flight) => flight?.state?.[G] ?? null;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------
// Physics helpers (the same formulas as src/builder/traits/structure.js; the flight cannot import the builder)
// ---------------------------------------------------------------------------------------------------------------
/** Kinetic energy (J) of a sphere of diameter d (cm), density rho (g/cm³) at V (km/s). */
const energyOf = (d, rho, V) => 0.5 * (Math.PI / 6) * rho * d ** 3 * (V * 1000) ** 2 * 1e-3;
const diameterOf = (E, rho, V) => Math.cbrt(Math.max(0, E) / (0.5 * (Math.PI / 6) * rho * (V * 1000) ** 2 * 1e-3));
/** A deterministic number in [0, 1) from the flight's seed and a piece of debris (FNV-1a, then mixed). */
function hash01(seed, id, salt) {
  let h = (2166136261 ^ seed ^ (salt * 0x9e3779b9)) >>> 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Share of the room-temperature value left at tempC (linear in the material's table: its stiffness, for buckling). */
function strengthAt(table, tempC) {
  if (!Array.isArray(table) || !table.length || !fin(tempC)) return 1;
  if (tempC <= table[0][0]) return table[0][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, f0] = table[i], [t1, f1] = table[i + 1];
    if (tempC <= t1) return f0 + ((f1 - f0) * (tempC - t0)) / (t1 - t0);
  }
  return table[table.length - 1][1];
}
/** The real air (1976 standard atmosphere, traits.structure.climb.atmosphere) at altitude h: { rho, T }. */
function realAir(climb, h) {
  const t = climb.atmosphere;
  if (h <= t[0][0]) return { rho: t[0][1], T: t[0][2] };
  for (let i = 0; i < t.length - 1; i++) {
    const [h0, r0, T0] = t[i], [h1, r1, T1] = t[i + 1];
    if (h <= h1) { const f = (h - h0) / (h1 - h0); return { rho: Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * f), T: T0 + (T1 - T0) * f }; }
  }
  const [hl, rl, Tl] = t[t.length - 1];
  return { rho: rl * Math.exp(-(h - hl) / (climb.topScaleM ?? 6000)), T: Tl };
}

// ---------------------------------------------------------------------------------------------------------------
// What a hit does (pure: the same inputs give the same answer, in the hook and when step records it)
// ---------------------------------------------------------------------------------------------------------------
/**
 * assessHit(S, seed, { rel, forward, armorLeft }, { id, radius }) → { outcome: 'survive' | 'dent' | 'absorbed' |
 * 'puncture' | 'fatal', section, wall, kind, partId, energyJ (normal), limitJ, damage 0..1, armorUsed, holeCm, armorIdx }.
 * rel: the piece's velocity relative to the ship (m/s); forward: the ship's nose direction.
 */
export function assessHit(S, seed, ship, piece) {
  const D = S.debris;
  const speed = len(ship.rel);
  const dir = speed > 1e-6 ? scale(ship.rel, 1 / speed) : scale(ship.forward, -1);
  const c = dot(ship.forward, dir); // < 0: the piece comes at the nose, > 0: at the tail
  const ac = Math.abs(c), as = Math.sqrt(Math.max(0, 1 - c * c));
  // where it lands: the faces it can reach, by their area seen along its path
  const options = [];
  const frontSec = c < 0 ? 'nose' : 'tail';
  const front = S.skin[frontSec]?.frontArea ?? (c >= 0 ? S.skin.body?.backArea : 0) ?? 0;
  const frontAt = S.skin[frontSec] ? frontSec : 'body';
  if (front > 0 && ac > 0) options.push({ sec: frontAt, w: front * ac, cos: ac });
  for (const sec of SECTIONS) if (S.skin[sec]?.sideArea > 0 && as > 0) options.push({ sec, w: S.skin[sec].sideArea * as, cos: as });
  if (!options.length) for (const sec of SECTIONS) if (S.skin[sec]) options.push({ sec, w: 1, cos: 1 });
  const total = options.reduce((t, o) => t + o.w, 0);
  let u = hash01(seed, piece.id, 1) * total, at = options[options.length - 1];
  for (const o of options) { if (u < o.w) { at = o; break; } u -= o.w; }
  const sk = S.skin[at.sec];
  const walls = (sk.walls ?? []).filter((w) => w.area > 0);
  const wArea = walls.reduce((t, w) => t + w.area, 0);
  let v = hash01(seed, piece.id, 2) * wArea, wall = walls[walls.length - 1] ?? null;
  for (const w of walls) { if (v < w.area) { wall = w; break; } v -= w.area; }
  const out = { section: at.sec, wall: wall?.id ?? null, kind: wall?.kind ?? 'dry', partId: wall?.partId ?? null, armorUsed: 0, armorIdx: null, holeCm: 0 };
  // the piece: an aluminium fragment (game scaling in structure.json), its energy normal to the wall
  const d = (D.cmPerGameM ?? 0.3) * Math.max(0, piece.radius ?? 0);
  const V = clamp((D.speedKmS ?? 9) * (speed / (D.refRelSpeed ?? 120)), 2, 16);
  const En = energyOf(d, D.density ?? 2.8, V) * at.cos * at.cos;
  out.energyJ = Math.round(En * 10) / 10;
  if (!wall) { out.outcome = 'survive'; out.limitJ = null; out.damage = 0; return out; }
  const dn = diameterOf(En, D.density ?? 2.8, D.speedKmS ?? 9); // the normal-equivalent particle at the reference speed
  const armorTotal = S.armor?.length ?? 0;
  const idx = ship.armorLeft > 0 ? clamp(armorTotal - ship.armorLeft, 0, armorTotal - 1) : -1;
  const sysJ = idx >= 0 && armorTotal ? wall.armorJ?.[idx] : null;
  const burst = (hole) => wall.pressurised && fin(wall.critHoleCm) && hole >= wall.critHoleCm;
  if (ship.armorLeft > 0) {
    // armour takes the hit as before; a piece beyond what it stops sends its debris cloud into the wall behind
    out.armorUsed = 1;
    out.armorIdx = idx;
    out.limitJ = fin(sysJ) ? sysJ : null;
    if (!fin(sysJ) || En < sysJ) { out.outcome = 'absorbed'; out.damage = 0.02; return out; }
    out.holeCm = (D.cloudHoleK ?? 1) * dn * Math.cbrt(1 - sysJ / En);
    out.outcome = burst(out.holeCm) ? 'fatal' : 'puncture';
  } else {
    out.limitJ = wall.perforateJ;
    if (En < wall.incipientJ) { out.outcome = 'survive'; out.damage = 0; return out; } // it bounced off (notes contract: 0)
    if (En < wall.perforateJ) { out.outcome = 'dent'; out.damage = r2(0.05 + 0.25 * (En - wall.incipientJ) / Math.max(1e-6, wall.perforateJ - wall.incipientJ)); return out; }
    out.holeCm = (D.holeK ?? 2.5) * dn * Math.cbrt(1 - wall.perforateJ / En);
    out.outcome = burst(out.holeCm) ? 'fatal' : 'puncture';
  }
  out.holeCm = Math.round(out.holeCm * 1000) / 1000;
  out.damage = out.outcome === 'fatal' ? 1 : r2(clamp(0.3 + 0.5 * (fin(wall.critHoleCm) ? out.holeCm / wall.critHoleCm : out.holeCm / 5), 0.3, 0.8));
  return out;
}
const shipNow = (fc) => ({ rel: null, forward: fc.forward, armorLeft: fc.armorLeft });

// ---------------------------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------------------------
export function begin(flight) {
  const S = traitsOf(flight);
  if (!S) return;
  flight.state[G] = {
    seed: Math.floor((typeof flight.rng === "function" ? flight.rng() : 0.5) * 4294967296) >>> 0,
    peakQ: 0, peakQT: null, peakQLimit: null,
    skinK: {}, peakC: {}, hotS: {}, shed: [],
    hits: [], near: {},
    heatLoad: 0, peakHf: 0, entered: false,
    shieldDamaged: false, cabinLeak: null, tankLeak: null,
    written: { ascent: false, entry: false, leak: false },
  };
}

/** A nose skin that shed pieces on the climb has damaged the heat shield: the next scene enters with it damaged. */
export function params(p, ctx, flight) {
  const st = stateOf(flight);
  if (st?.shieldDamaged && p.hasHeatShield && !p.heatShieldDamaged) return { ...p, heatShieldDamaged: true };
  return p;
}

/**
 * The dynamic pressure the structure stands now (Pa): the weakest skin; a skin the climb has heated is less stiff, so it
 * buckles sooner (only on Earth, where it heated: the temperatures are the climb's); a panel wrinkled at confirm is weaker.
 */
export function maxQ(pa, ctx, flight) {
  const S = traitsOf(flight);
  if (!S || !fin(S.maxQ?.limitPa)) return pa;
  const st = stateOf(flight);
  const climbing = (ctx?.fc?.planetId ?? 'earth') === 'earth';
  let lim = Infinity;
  for (const sec of SECTIONS) {
    const s = S.skin[sec];
    if (!fin(s?.qLimitPa)) continue;
    const temps = climbing ? st?.skinK?.[sec] : null;
    const hot = Array.isArray(temps) && temps.length ? Math.max(...temps) - 273.15 : null;
    lim = Math.min(lim, s.qLimitPa * strengthAt(s.heatStiffness ?? s.heatStrength, hot));
  }
  if (!fin(lim)) return pa;
  const cdA = ctx?.fc?.ship?.ascentCdA;
  if (fin(S.designAscentCdA) && fin(cdA) && cdA > S.designAscentCdA * (S.maxQ.wrinkleDetect ?? 1.1)) lim *= S.maxQ.wrinkledShare ?? 0.8; // asBuilt's wrinkled panel
  return lim;
}

/** The entry heat flux the shield stands (game units): its material's real peak flux. A damaged shield stays damaged. */
export function heatLimit(x, ctx, flight) {
  const sh = traitsOf(flight)?.shield;
  const ship = ctx?.fc?.ship;
  if (!sh || !fin(sh.peakWcm2) || !ship?.hasHeatShield || ship.heatShieldDamaged) return x;
  return (sh.peakWcm2 * 1e4) / HEAT_REAL_SCALE;
}

/** What a debris hit does: armour, then the wall it lands on (pure; step records it). */
export function debrisHit(r, ctx, flight) {
  const S = traitsOf(flight), st = stateOf(flight);
  const fc = ctx?.fc, o = ctx?.obstacle;
  if (!S || !st || !fc || !o) return r;
  const res = assessHit(S, st.seed, { ...shipNow(fc), rel: sub(o.vel, fc.vel) }, o);
  return { ...r, absorbed: res.outcome !== 'fatal', armorUsed: res.armorUsed, damage: res.damage };
}

export function step(ctx, flight) {
  const S = traitsOf(flight), st = stateOf(flight);
  if (!S || !st) return null;
  const fc = ctx.fc, dt = ctx.dt ?? 0;
  const earth = fc.planetId === 'earth';
  // 1. the highest air load on the structure
  if (fin(ctx.q) && ctx.q > st.peakQ) { st.peakQ = ctx.q; st.peakQT = fc.t; st.peakQLimit = fc._maxQNow ?? null; }
  // 2. the skins heat on the climb
  if (earth && !fc.onGround) heatSkins(S, st, fc, ctx, dt);
  // 3. debris: a piece that was about to touch the ship and is gone was a hit the ship took
  // a new controller (a new scene: the clock restarts, or another planet) never inherits the last one's nearby pieces
  if (fc.planetId !== st.nearPlanet || fc.t < (st.nearT ?? 0)) st.near = {};
  st.nearPlanet = fc.planetId;
  st.nearT = fc.t;
  if (fc.obstacles?.length || Object.keys(st.near).length) trackHits(S, st, fc, dt);
  // 4. a holed tank drains while its pressurant lasts
  if (st.tankLeak && fc.fuel > 0) drainTank(st, fc, dt);
  // 5. the entry: the shield's heat load
  const failure = entryHeat(S, st, fc, ctx, dt);
  if (failure) return failure;
  // milestones: what the analysis reads, written once
  if (!st.written.ascent && earth && st.peakQ > 0 && (fc.phase === 'orbit' || ctx.alt > (S.climb.aboveTopKm ?? 85) * 1000)) writeAscent(S, st, fc);
  if (!st.written.entry && st.entered && st.peakHf > 0 && dot(fc.vel, fc.up) < 0 && currentHf(fc, ctx) < 0.02 * st.peakHf) writeEntry(S, st, fc); // the heating is over (else end() writes it)
  return null;
}

export function end(ctx, flight) {
  const S = traitsOf(flight), st = stateOf(flight);
  if (!S || !st) return;
  const fc = ctx.fc;
  const failed = ctx.failed ?? null;
  if (failed?.causeId === 'debris_impact' && failed.id != null && st.near[failed.id]) {
    recordHit(S, st, fc, failed.id, st.near[failed.id], st.near[failed.id].armorLeft);
    delete st.near[failed.id];
  }
  if (!st.written.ascent && st.peakQ > 0 && fc.planetId === 'earth') writeAscent(S, st, fc, failed);
  if (!st.written.entry && st.entered) writeEntry(S, st, fc);
  if (st.tankLeak && !st.written.leak && st.tankLeak.lostKg > 0) { st.written.leak = true; note({ group: G, what: 'tankLeak', partId: st.tankLeak.partId, value: Math.round(st.tankLeak.lostKg), t: fc.t }); }
}

// ---------------------------------------------------------------------------------------------------------------
// Step parts
// ---------------------------------------------------------------------------------------------------------------
function heatSkins(S, st, fc, ctx, dt) {
  const alt = ctx.alt ?? fc.altitude;
  const C = S.climb;
  if (alt > 140000) return; // above the air: nothing heats (radiative cooling there does not matter for the climb)
  const v = ctx.speed ?? 0;
  const { rho, T: Ta } = realAir(C, alt);
  const mach = v / Math.sqrt(1.4 * 287.05 * Ta);
  const Taw = Ta * (1 + (C.recovery ?? 0.89) * 0.2 * mach * mach); // adiabatic wall (recovery) temperature
  const mu = (1.458e-6 * Ta ** 1.5) / (Ta + 110.4); // Sutherland
  const eps = C.emissivity ?? 0.8;
  for (const sec of SECTIONS) {
    const s = S.skin[sec];
    if (!s?.heat?.length) continue;
    const temps = (st.skinK[sec] ??= s.heat.map(() => (C.launchTempC ?? 15) + 273.15));
    let peak = -Infinity;
    for (let i = 0; i < s.heat.length; i++) {
      const g = s.heat[i];
      let Tw = temps[i];
      const re = Math.max(1, (rho * v * g.x) / mu);
      const local = 1 + (g.factor - 1) * clamp(mach - 1, 0, 1);
      const stanton = re < (C.transitionRe ?? 0) ? 0.332 * re ** -0.5 : 0.0296 * re ** -0.2; // laminar below the transition (hull.json physics.transitionRe)
      const hc = v > 1 ? stanton * 0.72 ** (-2 / 3) * rho * v * 1005 * local : 0; // W/m²/K
      const q = (hc > 0 ? (Taw - Tw) / (1 / hc + (g.corkR ?? 0)) : 0) - eps * SIGMA_SB * (Tw ** 4 - Ta ** 4);
      Tw += (q * dt) / Math.max(1, g.heatCap);
      temps[i] = Tw;
      peak = Math.max(peak, Tw - 273.15);
    }
    if (peak > (st.peakC[sec] ?? -Infinity)) st.peakC[sec] = peak;
    // far past its limit for a while, the skin gives way and sheds pieces
    if (fin(s.maxTempC) && !st.shed.includes(sec)) {
      st.hotS[sec] = peak > s.maxTempC + (C.overheatC ?? 50) ? (st.hotS[sec] ?? 0) + dt : 0;
      if (st.hotS[sec] > (C.overheatS ?? 2)) shedSkin(S, st, fc, sec, peak);
    }
  }
}

function shedSkin(S, st, fc, sec, tempC) {
  st.shed.push(sec);
  // the nose skin encloses the capsule's heat shield on the climb: pieces of it strike the shield (Columbia, 2003)
  if (sec === 'nose' && fc.ship.hasHeatShield && S.shield) {
    st.shieldDamaged = true;
    fc.ship.heatShieldDamaged = true; // this controller too (a later scene gets it through params)
  }
  note({ group: G, what: 'skinShed', section: sec, value: Math.round(tempC), t: fc.t });
}

function trackHits(S, st, fc, dt) {
  const now = new Set();
  const near = {};
  for (const o of fc.obstacles ?? []) {
    now.add(o.id);
    const rel = sub(o.vel, fc.vel);
    // touching distance by the next step: the FlightController removes a piece that hits (d <= radius + ship radius)
    const reach = o.radius + (fc.ship.radius ?? 2) + len(rel) * dt * 3 + 1;
    if (len(sub(o.pos, fc.pos)) < reach) near[o.id] = { radius: o.radius, rel, forward: fc.forward, armorLeft: fc.armorLeft };
  }
  // pieces that were touching distance a step ago and are gone now hit the ship (the armour count is replayed in order)
  let armorLeft = null;
  for (const [id, snap] of Object.entries(st.near)) {
    if (now.has(id)) continue;
    if (armorLeft === null) armorLeft = snap.armorLeft;
    const res = recordHit(S, st, fc, id, snap, armorLeft);
    armorLeft = Math.max(0, armorLeft - (res?.armorUsed ?? 0));
  }
  st.near = near;
}

function recordHit(S, st, fc, id, snap, armorLeft) {
  const res = assessHit(S, st.seed, { rel: snap.rel, forward: snap.forward, armorLeft }, { id, radius: snap.radius });
  const sk = S.skin[res.section];
  const W0 = { tank: ['tank wall', 'thành bình'], cabin: ['cabin wall', 'vỏ khoang lái'], skin: ['skin', 'lớp vỏ'], dry: ['wall', 'thành vỏ'] }[res.kind] ?? ['wall', 'thành vỏ'];
  const W = res.armorUsed ? ['armour and the ' + W0[0] + ' behind it', 'lớp giáp và ' + W0[1] + ' phía sau'] : W0; // the limit is then the armour's
  const O = { survive: ['it bounced off', 'nó bật ra'], dent: ['a dent, no hole', 'một vết lõm, không thủng'], absorbed: ['the shield stopped it', 'tấm chắn đã chặn được'], puncture: ['it punched a hole', 'nó xuyên một lỗ'], fatal: ['the wall burst', 'thành vỏ bị vỡ toác'] }[res.outcome];
  st.hits.push({ id, t: r2(fc.t), section: res.section, wall: res.wall, kind: res.kind, partId: res.partId, outcome: res.outcome, energyJ: res.energyJ, limitJ: res.limitJ, damage: res.damage, holeCm: res.holeCm, armorUsed: res.armorUsed });
  if (res.outcome === 'puncture') {
    const holeMm2 = (Math.PI / 4) * (res.holeCm * 10) ** 2;
    if (res.kind === 'cabin') {
      const L = S.leak?.cabin ?? {};
      const A = (st.cabinLeak?.holeMm2 ?? 0) + holeMm2;
      // choked flow of cabin air through the hole (Cd 0.6, γ 1.4, R 287): about 12 kg a day per mm² at 101.3 kPa
      const kgPerS = 0.6 * A * 1e-6 * (L.pressureKPa ?? 101.3) * 1000 * Math.sqrt(1.4 / (287 * (L.airTempK ?? 293))) * 0.5787;
      st.cabinLeak = { holeMm2: r2(A), kgPerDay: r2(kgPerS * 86400), t: r2(fc.t), partId: res.partId };
    } else if (res.kind === 'tank') {
      const L = S.leak?.tank ?? {};
      const A = (st.tankLeak?.holeMm2 ?? 0) + holeMm2;
      const kgPerS = (L.leakCd ?? 0.6) * A * 1e-6 * Math.sqrt(2 * (L.liquidDensity ?? 1000) * (L.pressureKPa ?? 300) * 1000); // orifice flow
      // the ullage gas vents through the same hole: the blowdown time goes as the ullage volume over the hole area, so
      // every holed tank loses about kgPerS x blowdownS x (A_ref / A), some 1.7 t, whatever the hole
      const blowdownS = ((L.blowdownS ?? 1500) * (L.refHoleCm2 ?? 0.785) * 100) / Math.max(1e-6, A);
      st.tankLeak = { holeMm2: r2(A), kgPerS: Math.round(kgPerS * 1000) / 1000, t: r2(fc.t), partId: res.partId, planet: fc.planetId, pressure: st.tankLeak?.pressure ?? 1, lostKg: st.tankLeak?.lostKg ?? 0, blowdownS: Math.round(blowdownS) };
    }
  }
  const unarmoured = !res.armorUsed && res.wall && sk?.byPart?.[res.wall] != null;
  note({ group: G, what: 'impact', section: res.section, partId: res.partId, wall: res.wall, value: Math.round(res.energyJ), limit: res.limitJ, limitJ: fin(res.limitJ) ? Math.round(res.limitJ) : null, ...(unarmoured ? { trait: `skin.${res.section}.byPart.${res.wall}` } : {}), outcome: res.outcome, wallText: W[0], wallVi: W[1], t: fc.t });
  note({ group: G, what: 'hit', section: res.section, partId: res.partId, value: res.damage, outcome: res.outcome, outcomeText: O[0], outcomeVi: O[1], t: fc.t });
  if (res.outcome === 'puncture' && res.kind === 'cabin') note({ group: G, what: 'cabinLeak', partId: res.partId, value: st.cabinLeak.holeMm2, kgPerDay: st.cabinLeak.kgPerDay, t: fc.t });
  return res;
}

function drainTank(st, fc, dt) {
  const L = st.tankLeak;
  if (!(L.pressure > 1e-4)) return;
  if (L.planet && L.planet !== fc.planetId) {
    // the ship is at another planet: the months of cruise let the leak run its course (the rest of the blowdown)
    const rest = Math.min(fc.fuel, L.kgPerS * L.blowdownS * L.pressure);
    fc.fuel -= rest;
    L.lostKg += rest;
    L.pressure = 0;
    return;
  }
  const lost = Math.min(fc.fuel, L.kgPerS * L.pressure * dt); // the flow falls with the ullage pressure
  L.pressure *= Math.exp(-dt / Math.max(1, L.blowdownS));
  fc.fuel -= lost;
  L.lostKg += lost;
}

function currentHf(fc, ctx) {
  return fin(ctx.rho) && ctx.rho > 0 ? heatFlux(fc.planetId, ctx.rho, ctx.speed ?? 0, fc.ship.noseRadius) : 0;
}

function entryHeat(S, st, fc, ctx, dt) {
  if (!(ctx.rho > 0) || fc.onGround || dot(fc.vel, fc.up) >= 0) return null;
  // an entry: arriving at another planet, or falling back into Earth's air below 60 km (the game's exponential air is
  // too dense at 90-100 km, where the climb's coast dips; real air there heats nothing)
  if (fc.planetId === 'earth' && (ctx.alt ?? fc.altitude) > 60000) return null;
  const hf = currentHf(fc, ctx);
  if (!(hf > 0)) return null;
  st.entered = true;
  st.heatLoad += hf * dt;
  if (hf > st.peakHf) st.peakHf = hf;
  const sh = S.shield;
  if (!sh || !fc.ship.hasHeatShield || fc.ship.heatShieldDamaged || !fin(sh.loadJcm2)) return null;
  const loadJcm2 = (st.heatLoad * LOAD_REAL_SCALE) / 1e4;
  if (loadJcm2 > sh.loadJcm2) {
    writeEntry(S, st, fc);
    note({ group: G, what: 'burnThrough', partId: sh.partId, value: Math.round(loadJcm2), limit: sh.loadJcm2, t: fc.t });
    return { endingId: 'burnup', cause: "The heat shield's ablator was used up before the ship slowed down, and the heat burned through.", data: { causeId: 'heat_overload' } };
  }
  return null;
}

function writeAscent(S, st, fc, failed = null) {
  st.written.ascent = true;
  const lim = fin(st.peakQLimit) ? st.peakQLimit : S.maxQ.limitPa;
  if (st.peakQ > 0) note({ group: G, what: 'peakQ', section: S.maxQ.section ?? null, value: Math.round(failed?.q ?? st.peakQ), limit: fin(lim) ? Math.round(lim) : null, limitKPa: fin(lim) ? Math.round(lim / 100) / 10 : null, ...(fin(S.maxQ.limitPa) ? { trait: 'maxQ.limitPa' } : {}), t: st.peakQT });
  for (const sec of SECTIONS) {
    const s = S.skin[sec];
    if (!fin(st.peakC[sec]) || !s) continue;
    note({ group: G, what: 'skinTemp', section: sec, value: Math.round(st.peakC[sec]), limit: s.maxTempC, ...(fin(s.maxTempC) ? { trait: `skin.${sec}.maxTempC` } : {}) });
  }
}

function writeEntry(S, st, fc) {
  if (st.written.entry) return;
  st.written.entry = true;
  const sh = S.shield;
  const loadJcm2 = (st.heatLoad * LOAD_REAL_SCALE) / 1e4;
  const peakWcm2 = (st.peakHf * HEAT_REAL_SCALE) / 1e4;
  if (!sh) return;
  const use = sh.type === 'tiles' ? peakWcm2 / Math.max(1, sh.peakWcm2) : loadJcm2 / Math.max(1, sh.loadJcm2);
  note({ group: G, what: 'heatPeak', partId: sh.partId, value: Math.round(peakWcm2), limit: sh.peakWcm2, trait: 'shield.peakWcm2' });
  note({ group: G, what: 'heatLoad', partId: sh.partId, value: Math.round(loadJcm2), limit: sh.loadJcm2, trait: 'shield.loadJcm2' });
  note({ group: G, what: 'shieldUse', partId: sh.partId, value: r2(clamp(use, 0, 1)), t: fc.t });
}

