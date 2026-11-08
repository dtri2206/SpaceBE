// Role 2: first-person egress cinematic, part 1 (cockpit, LANDING) timeline math + the shared "egress pending" flag
// read by the INTERIOR arrival (src/surface/egressArrival.js). Pure functions: no DOM, no three.js.
// Rig frame: -Z forward, +Y up, metres and radians. Yaw turns left (+) about +Y, pitch up (+), roll about -Z.

let pending = false;
export function markEgressPending() { pending = true; }
export function takeEgressPending() { const p = pending; pending = false; return p; }
export function clearEgressPending() { pending = false; }

const D2R = Math.PI / 180;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));

export const T = { harness: 1.0, stand: 3.2, turn: 5.0, walk: 6.6, fadeStart: 6.8, end: 7.6 };
export const EGRESS_SECONDS = T.end;
const STAND_UP = 0.45, STAND_BACK = 0.15, WALK_DIST = 1.2, STOP_SHORT = 0.4, BOB_PERIOD = 0.7, BOB = 0.02;
const STEP_TIMES = [0, 1, 2].map((k) => T.turn + BOB_PERIOD / 2 * (k + 1)); // one footfall per half bob, inside the walk

export const CAPTIONS = [
  { from: 0, to: T.harness, text: 'Harness off.' },
  { from: T.harness, to: T.turn, text: 'Mars gravity: 0.38 g. After seven months of floating, your legs feel like lead.' },
];

// Event names fire once, at these times: 'harness', 'step', 'hatch', 'done'.
export const EVENTS = [
  { t: 0, name: 'harness' },
  ...STEP_TIMES.map((t) => ({ t, name: 'step' })),
  { t: T.walk, name: 'hatch' },
  { t: T.end, name: 'done' },
];

/** Standing eye position after part 1b, and the yaw/distance toward the aft point (aftLocal = {x,z} in the rig frame, default behind the seat). */
function plan(aftLocal) {
  const ax = Number.isFinite(aftLocal?.x) ? aftLocal.x : 0;
  const az = Number.isFinite(aftLocal?.z) ? aftLocal.z : 1;
  const sx = 0, sz = STAND_BACK;
  let dx = ax - sx, dz = az - sz;
  let dist = Math.hypot(dx, dz);
  if (dist < 1e-3) { dx = 0; dz = 1; dist = 1; }
  const yaw = Math.atan2(-dx / dist, -dz / dist); // forward = (-sin yaw, 0, -cos yaw)
  const walk = Math.min(WALK_DIST, Math.max(0, dist - STOP_SHORT));
  return { sx, sz, yaw, fx: -Math.sin(yaw), fz: -Math.cos(yaw), walk };
}

/** Camera pose in the rig frame at time t (seconds). events = names of every event whose time has been reached. */
export function egressPose(t, aftLocal) {
  const p = plan(aftLocal);
  const env = (a, b) => Math.sin(Math.PI * seg(t, a, b)); // 0 at both ends of a segment
  let x = 0, y = 0, z = 0, roll = 0;
  const dip = -0.03 * env(0, T.harness);
  const up = ease(seg(t, T.harness, T.stand));
  const sway = env(T.harness, T.stand);
  y = dip + STAND_UP * up;
  z = STAND_BACK * up;
  x = 0.012 * Math.sin(2 * Math.PI * 1.5 * seg(t, T.harness, T.stand)) * sway;
  roll = 1.5 * D2R * Math.sin(2 * Math.PI * 2 * seg(t, T.harness, T.stand)) * sway;
  const yaw = p.yaw * ease(seg(t, T.stand, T.turn));
  const w = ease(seg(t, T.turn, T.walk)) * p.walk;
  x += p.fx * w;
  z += p.fz * w;
  y += BOB * Math.sin(2 * Math.PI * (t - T.turn) / BOB_PERIOD) * env(T.turn, T.walk) * (t >= T.turn && t <= T.walk ? 1 : 0);
  const pitch = -50 * D2R * ease(seg(t, T.walk, T.fadeStart + 0.4));
  const fade = ease(seg(t, T.fadeStart, T.end));
  const cap = CAPTIONS.find((c) => t >= c.from && t < c.to);
  return { pos: { x, y, z }, yaw, pitch, roll, caption: cap ? cap.text : null, fade, events: EVENTS.filter((e) => t >= e.t).map((e) => e.name), done: t >= T.end };
}

/** Stateful driver: update(dt) → { pose, fired: [names fired this call], skipped }. skip() jumps to the hatch. */
export function createEgress(aftLocal) {
  let t = 0, fired = 0, hatchSeen = false;
  const nextEvents = () => {
    const out = [];
    while (fired < EVENTS.length && EVENTS[fired].t <= t) { out.push(EVENTS[fired].name); fired++; }
    return out;
  };
  return {
    get t() { return t; },
    get done() { return t >= T.end; },
    skip() { // end of the current part: part 1 is one part, so go straight to the hatch (earlier sounds are not replayed)
      if (t >= T.walk) return;
      while (fired < EVENTS.length && EVENTS[fired].t < T.walk) fired++;
      t = T.walk;
    },
    update(dt) {
      t = Math.min(T.end, t + Math.max(0, dt));
      return { pose: egressPose(t, aftLocal), fired: nextEvents() };
    },
  };
}
