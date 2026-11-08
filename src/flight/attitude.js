// Pure attitude maths for the flight deck: fc → degrees. No THREE, no DOM.
import { cross, dot, len, norm, qRotate, scale, sub, v3, LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP } from './vec.js';

const DEG = 180 / Math.PI;
const finite = (x) => (Number.isFinite(x) ? x : 0);

// pitch: nose above the local horizon (90 = straight up).
// yaw: heading of the nose's horizontal part, 0 = prograde horizontal ("east"), + toward the orbit normal (up × east).
// roll: rotation of the pilot's head axis (body LOCAL_UP) about the nose, 0 = head as far from the planet as possible; right-handed about the nose.
// rates (deg/s): pitchRate nose-up +, rollRate right-handed about nose, yawRate right-handed about the head axis (nose-left +).
export function attitudeDeg(fc) {
  const up = fc.up;
  const f = qRotate(fc.orient, LOCAL_FORWARD);
  const head = qRotate(fc.orient, LOCAL_UP);
  const right = qRotate(fc.orient, LOCAL_RIGHT);
  const sinP = Math.max(-1, Math.min(1, dot(f, up)));
  const pitch = Math.asin(sinP) * DEG;

  const vh = sub(fc.vel, scale(up, dot(fc.vel, up)));
  let east = len(vh) > 5 ? norm(vh) : sub(v3(up.y, -up.x, 0), scale(up, 0));
  east = sub(east, scale(up, dot(east, up)));
  east = len(east) < 0.5 ? norm(sub(v3(1, 0, 0), scale(up, up.x))) : norm(east);
  const normal = cross(up, east);
  const fh = sub(f, scale(up, sinP));
  let yaw = 0;
  if (len(fh) > 1e-3) yaw = Math.atan2(dot(fh, normal), dot(fh, east)) * DEG;

  const ref = sub(up, scale(f, sinP));
  let roll = 0;
  if (len(ref) > 1e-3) {
    const r = norm(ref);
    roll = Math.atan2(dot(cross(r, head), f), dot(r, head)) * DEG;
  }
  const w = fc.omega ?? v3();
  return {
    pitch: finite(pitch), roll: finite(roll), yaw: finite(yaw),
    pitchRate: finite(dot(w, right) * DEG), rollRate: finite(dot(w, f) * DEG), yawRate: finite(dot(w, head) * DEG),
  };
}
