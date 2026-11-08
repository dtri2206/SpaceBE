// Manual-control windows: short stretches where the player may take the stick from the flight computer.
// Pure (no three.js), testable in node. index.js owns the camera, HUD and sounds; this file owns the rules.
//
//   const w = createManualWindow('ascent', config.windows.ascent);
//   w.offer();                                   // offered for offerSeconds, then 'declined'
//   w.take();                                    // F → 'active'
//   const r = w.update(dtReal, { mouse, noseOffset });   // every frame; r.events lists transitions this frame
//   w.lock();                                    // Space (accepted only when r.lockReady) → 'locked'
//   w.result() → { flown, accuracyPct }
//
// States: idle → offered → active → locked | cancelled | closed;  offered → declined.
// Offsets are degrees in an angular frame centred on the clean guidance direction (frameFor/dirFromOffsets):
// yaw + = to the pilot's right, pitch + = toward the local vertical.
import config from './manualControl.json' with { type: 'json' };
import { add, cross, dot, norm, scale, v3 } from './vec.js';

export const MANUAL = config;
const RAD = Math.PI / 180;

// ---- angular frame ----
// g = guide direction, p = in-plane perpendicular to g on the side of `up`, n = cross(g, p) (to the pilot's right when p is overhead).
export function frameFor(guideDir, up) {
  const g = norm(guideDir);
  const u = norm(up);
  let p = add(u, scale(g, -dot(u, g)));
  if (dot(p, p) < 1e-10) { // g ≈ up (straight climb): any stable horizontal reference
    const ref = Math.abs(u.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1);
    p = add(ref, scale(g, -dot(ref, g)));
  }
  p = norm(p);
  return { g, p, n: norm(cross(g, p)) };
}

export function dirFromOffsets(frame, yawDeg, pitchDeg) {
  const y = Math.tan(yawDeg * RAD), p = Math.tan(pitchDeg * RAD);
  return norm(add(add(frame.g, scale(frame.n, y)), scale(frame.p, p)));
}

export function offsetsFromDir(frame, dir) {
  const d = dot(dir, frame.g);
  return { yawDeg: Math.atan2(dot(dir, frame.n), d) / RAD, pitchDeg: Math.atan2(dot(dir, frame.p), d) / RAD };
}

// Angle (deg) between two directions given as offsets in the same frame.
export function offsetAngleDeg(a, b) {
  const va = norm(v3(Math.tan(a.yawDeg * RAD), Math.tan(a.pitchDeg * RAD), 1));
  const vb = norm(v3(Math.tan(b.yawDeg * RAD), Math.tan(b.pitchDeg * RAD), 1));
  return Math.acos(Math.max(-1, Math.min(1, dot(va, vb)))) / RAD;
}

const gust = (terms, t) => terms.reduce((sum, [amp, period, phase]) => sum + amp * Math.sin((2 * Math.PI * t) / period + phase), 0);
const clamp = (v, r) => Math.max(-r, Math.min(r, v));

export function createManualWindow(id, cfg = config.windows[id], options = {}) {
  const degPerPixel = options.degPerPixel ?? config.degPerPixel;
  const range = options.rangeDeg ?? config.rangeDeg;
  const tol = options.toleranceDeg ?? config.toleranceDeg;
  const w = {
    state: 'idle', offerT: 0, t: 0, onTime: 0, onFor: 0, taken: false,
    aim: { yawDeg: 0, pitchDeg: 0 }, target: { yawDeg: 0, pitchDeg: 0 }, nose: null, lockReady: false, onTarget: false,
  };
  const targetAt = (t) => ({ yawDeg: gust(cfg.gust.yaw, t), pitchDeg: gust(cfg.gust.pitch, t) });
  const accuracy = () => (w.t > 1e-9 ? Math.min(1, w.onTime / w.t) : 0);

  const api = {
    id,
    get state() { return w.state; },
    get offered() { return w.state === 'offered'; },
    get active() { return w.state === 'active'; },
    get busy() { return w.state === 'offered' || w.state === 'active'; },
    get taken() { return w.taken; },
    offer() { if (w.state === 'idle') { w.state = 'offered'; w.offerT = 0; return true; } return false; },
    take() {
      if (w.state !== 'offered') return false;
      w.state = 'active'; w.taken = true; w.t = 0; w.onTime = 0; w.onFor = 0;
      w.aim = { yawDeg: 0, pitchDeg: 0 }; w.target = targetAt(0);
      return true;
    },
    lock() {
      if (w.state !== 'active' || !w.lockReady) return false;
      w.state = 'locked';
      return true;
    },
    forceLock() { if (w.state !== 'active') return false; w.state = 'locked'; w.lockReady = false; return true; }, // the guide vanished: hand over without the lock conditions
    cancel() { if (w.state === 'active') { w.state = 'cancelled'; return true; } return false; },
    close() { if (w.state === 'offered' || w.state === 'active') w.state = 'closed'; },
    update(dtReal, { mouse = { x: 0, y: 0 }, noseOffset = null } = {}) {
      const events = [];
      if (w.state === 'offered') {
        w.offerT += dtReal;
        if (w.offerT >= cfg.offerSeconds) { w.state = 'declined'; events.push('declined'); }
      } else if (w.state === 'active') {
        w.t += dtReal;
        w.aim.yawDeg = clamp(w.aim.yawDeg + mouse.x * degPerPixel, range);
        w.aim.pitchDeg = clamp(w.aim.pitchDeg - mouse.y * degPerPixel, range); // mouse up (y < 0) = pitch up
        w.target = targetAt(w.t);
        w.nose = noseOffset;
        w.onTarget = !!noseOffset && offsetAngleDeg(noseOffset, w.target) <= tol;
        if (w.onTarget) { w.onTime += dtReal; w.onFor += dtReal; } else w.onFor = 0;
        w.lockReady = w.t >= cfg.lockReadyAfter && w.onFor >= cfg.onTargetForLock;
        if (w.t >= cfg.durationSeconds) { w.state = 'locked'; w.lockReady = false; events.push('autolocked'); }
      }
      return api.readout(events);
    },
    readout(events = []) {
      return {
        id, state: w.state, label: cfg.label, timeLeft: w.state === 'offered' ? Math.max(0, cfg.offerSeconds - w.offerT) : Math.max(0, cfg.durationSeconds - w.t),
        aim: { ...w.aim }, target: { ...w.target }, nose: w.nose ? { ...w.nose } : null, accuracy: accuracy(),
        lockReady: w.state === 'active' && w.lockReady, onTarget: w.onTarget, events,
      };
    },
    result() { return { flown: w.state === 'locked' && w.taken, accuracyPct: Math.round(accuracy() * 100) }; },
    // debug helpers
    setAim(yawDeg, pitchDeg) { w.aim = { yawDeg: clamp(yawDeg, range), pitchDeg: clamp(pitchDeg, range) }; },
    get target() { return { ...w.target }; },
    get constants() { return { range, tol, durationSeconds: cfg.durationSeconds }; },
  };
  return api;
}
