// Debris conjunction view: pure logic (no three.js, no DOM), testable in node. index.js owns the camera and HUD.
//
// Plane = perpendicular to the ship's velocity, centred on the ship: x = orbit normal (out of plane), y = radial (up).
// Every piece that will pass within `showMissMetres` in the next `horizonSeconds` is a point: its predicted miss vector
// at closest approach (straight-line relative motion), projected into that plane. The player's aim ○ is a THRUST
// COMMAND in the same plane (panel units −1..1, magnitude ≤ 1): sideways RCS acceleration = rcsAccel · aim.
// A burst of Δv = u (m/s) shifts the miss vector of a piece that arrives in t seconds by −u·t: the circles slide
// away from the centre, the near ones slowly, the far ones fast. Keep the centre clear when each piece arrives.
//
//   const axes = conjunctionAxes(fc.pos, fc.vel);
//   const pieces = conjunctionPieces(fc, fc.obstacles)          // [{ id, t, x, y, miss, radius, danger, hitRadius }] by t
//   const win = createDebrisWindow(cfg); win.offer(); win.take(); win.update(dt, { mouse, pieces, ... })
//   rcsRequest(axes, win.aim, rcsAccel)                          // → fc.update(dt, { rcs })
//   findDodge(pieces) → { ux, uy, minRatio }                     // simple "steer to the largest gap" (tests, ?debug track)
//   createEncounterTracker() → numbers for the 'debris' rating
import { add, cross, dot, len, norm, scale, sub } from './vec.js';
import MANUAL from './manualControl.json' with { type: 'json' };

export const DEBRIS_WINDOW = MANUAL.windows.debris;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function conjunctionAxes(pos, vel) {
  const vhat = norm(vel);
  const n = norm(cross(pos, vel)); // orbit normal
  return { vhat, n, up: cross(vhat, n) }; // radial, pointing away from the planet
}

// Pieces still ahead that will pass within maxMiss metres in the next `horizon` seconds, soonest first.
export function conjunctionPieces(ship, obstacles, { horizon = DEBRIS_WINDOW.horizonSeconds, maxMiss = DEBRIS_WINDOW.showMissMetres, axes = null } = {}) {
  const ax = axes ?? conjunctionAxes(ship.pos, ship.vel);
  const shipR = ship.ship?.radius ?? ship.radius ?? 2;
  const out = [];
  for (const o of obstacles) {
    const r = sub(o.pos, ship.pos);
    const v = sub(o.vel, ship.vel);
    const vv = dot(v, v);
    if (vv < 1e-9) continue;
    const t = -dot(r, v) / vv;
    if (!(t > 0) || t > horizon) continue;
    const m = add(r, scale(v, t));
    const miss = len(m);
    if (miss > maxMiss) continue;
    out.push({ id: o.id, t, x: dot(m, ax.n), y: dot(m, ax.up), miss, radius: o.radius, hitRadius: o.radius + shipR, danger: (o.radius + shipR) * DEBRIS_WINDOW.dangerFactor });
  }
  return out.sort((a, b) => a.t - b.t);
}

// aim = { x, y } panel units (|aim| ≤ 1) → planet-centred acceleration request (m/s²)
export function rcsRequest(axes, aim, rcsAccel) {
  const m = Math.hypot(aim.x, aim.y);
  const k = m > 1 ? 1 / m : 1;
  return add(scale(axes.n, aim.x * k * rcsAccel), scale(axes.up, aim.y * k * rcsAccel));
}

// "Steer toward the largest gap": the smallest velocity change u = (ux, uy) m/s that makes every piece pass
// with at least `margin` × its danger radius (else the best compromise). Grid search, cheap enough for ~20 pieces.
export function findDodge(pieces, { margin = 2.2, maxDv = 12, step = 0.5 } = {}) {
  let best = null;
  const n = Math.round(maxDv / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const ux = i * step, uy = j * step;
      let pen = 0, minRatio = Infinity;
      for (const p of pieces) {
        const ratio = Math.hypot(p.x - ux * p.t, p.y - uy * p.t) / p.danger;
        if (ratio < minRatio) minRatio = ratio;
        if (ratio < margin) pen += (margin - ratio) ** 2;
      }
      const cost = pen * 1000 + ux * ux + uy * uy;
      if (!best || cost < best.cost) best = { cost, ux, uy, minRatio };
    }
  }
  return best ? { ux: best.ux, uy: best.uy, minRatio: best.minRatio } : { ux: 0, uy: 0, minRatio: Infinity };
}

// The aim ○ a scripted/auto-tracking pilot would hold: thrust to make the wanted Δv in about `seconds`.
export function trackAim(pieces, rcsAccel, { seconds = 1.5, ...opts } = {}) {
  if (!pieces.length) return { x: 0, y: 0 };
  const d = findDodge(pieces, opts);
  const k = 1 / (rcsAccel * seconds);
  const x = d.ux * k, y = d.uy * k, m = Math.hypot(x, y);
  return m > 1 ? { x: x / m, y: y / m } : { x, y };
}

// Window state (same shape as createManualWindow for the parts index.js needs):
// idle → offered → active → ended | cancelled;  offered → declined;  closed. Mouse px → aim ○ (accumulating, clamped to the unit disc).
export function createDebrisWindow(cfg = DEBRIS_WINDOW) {
  const w = { state: 'idle', offerT: 0, t: 0, taken: false, aim: { x: 0, y: 0 }, last: null };
  const api = {
    id: 'debris',
    get state() { return w.state; },
    get offered() { return w.state === 'offered'; },
    get active() { return w.state === 'active'; },
    get busy() { return w.state === 'offered' || w.state === 'active'; },
    get taken() { return w.taken; },
    get aim() { return { ...w.aim }; },
    offer() { if (w.state === 'idle') { w.state = 'offered'; w.offerT = 0; return true; } return false; },
    take() { if (w.state !== 'offered') return false; w.state = 'active'; w.taken = true; w.t = 0; w.aim = { x: 0, y: 0 }; return true; },
    cancel() { if (w.state === 'active') { w.state = 'cancelled'; return true; } return false; },
    close() { if (w.busy) w.state = 'closed'; },
    setAim(x, y) { const m = Math.hypot(x, y); const k = m > 1 ? 1 / m : 1; w.aim = { x: x * k, y: y * k }; },
    // snap = { pieces (conjunctionPieces, for drawing), ahead (count still to come, long horizon), dv, hits, passed, total }
    update(dt, { mouse = { x: 0, y: 0 }, ...snap } = {}) {
      const events = [];
      w.last = snap;
      if (w.state === 'offered') {
        w.offerT += dt;
        if (w.offerT >= cfg.offerSeconds) { w.state = 'declined'; events.push('declined'); }
      } else if (w.state === 'active') {
        w.t += dt;
        api.setAim(w.aim.x + mouse.x / cfg.pixelsPerUnit, w.aim.y - mouse.y / cfg.pixelsPerUnit); // mouse up = thrust up
        if (w.t >= 1 && (snap.ahead ?? 1) === 0) { w.state = 'ended'; events.push('clear'); }
        else if (w.t >= cfg.maxSeconds) { w.state = 'ended'; events.push('timeout'); }
      }
      return api.readout(events);
    },
    readout(events = []) {
      const s = w.last ?? {};
      return {
        id: 'debris', state: w.state, label: cfg.label, range: cfg.rangeMetres, aim: { ...w.aim },
        timeLeft: w.state === 'offered' ? Math.max(0, cfg.offerSeconds - w.offerT) : Math.max(0, cfg.maxSeconds - w.t),
        pieces: s.pieces ?? [], dv: s.dv ?? 0, hits: s.hits ?? 0, passed: s.passed ?? 0, total: s.total ?? 0, events,
      };
    },
    result() { return { flown: w.state === 'ended' && w.taken }; },
  };
  return api;
}

// Numbers for the 'debris' rating, collected from the first frame the field exists.
// update(fc) every frame; finished = nothing left that will pass within showMissMetres (after a short grace).
export function createEncounterTracker() {
  const seen = new Map(); // id → { minDist, danger }
  const dangerous = new Set();
  let armor0 = null, t = 0, dv0 = null;
  const api = {
    update(fc, dt = 0) {
      t += dt;
      armor0 ??= fc.armorLeft + (fc.failed?.causeId === 'debris_impact' ? 1 : 0);
      dv0 ??= fc.rcsDv ?? 0;
      const shipR = fc.ship.radius;
      for (const o of fc.obstacles) {
        const e = seen.get(o.id) ?? { minDist: Infinity, danger: (o.radius + shipR) * DEBRIS_WINDOW.dangerFactor };
        if (o.minDist < e.minDist) e.minDist = o.minDist;
        seen.set(o.id, e);
      }
      const ahead = conjunctionPieces(fc, fc.obstacles, { horizon: 60 });
      for (const p of ahead) dangerous.add(p.id);
      const aheadIds = new Set(ahead.map((p) => p.id));
      return {
        ahead: ahead.length, total: dangerous.size, passed: [...dangerous].filter((id) => !aheadIds.has(id)).length,
        hits: api.hits(fc), dv: (fc.rcsDv ?? 0) - dv0,
      };
    },
    hits(fc) { return Math.max(0, (armor0 ?? fc.armorLeft) - fc.armorLeft) + (fc.failed?.causeId === 'debris_impact' ? 1 : 0); },
    // { hits, closestM, minRatio (closest ÷ danger radius, over the pieces that came dangerously close), dvMs }
    stats(fc) {
      let closest = Infinity, minRatio = Infinity;
      for (const e of seen.values()) {
        if (e.minDist < closest) closest = e.minDist;
        minRatio = Math.min(minRatio, e.minDist / e.danger);
      }
      return { hits: api.hits(fc), closestM: closest, minRatio, dvMs: (fc.rcsDv ?? 0) - (dv0 ?? 0) };
    },
  };
  return api;
}
