// Tiny dependency-free vector + quaternion math for the physics (testable in node, no three.js).
// Vectors are plain {x, y, z}; quaternions are {x, y, z, w}.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.sqrt(dot(a, a));
export const norm = (a) => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : v3(0, 0, 0);
};
export const clone = (a) => v3(a.x, a.y, a.z);

// --- quaternions ---
export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

export function qMul(a, b) {
  return quat(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

export function qNorm(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return quat(q.x / l, q.y / l, q.z / l, q.w / l);
}

export function qFromAxisAngle(axis, angle) {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return quat(a.x * s, a.y * s, a.z * s, Math.cos(angle / 2));
}

// Rotate vector v by quaternion q.
export function qRotate(q, v) {
  const u = v3(q.x, q.y, q.z);
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

// Shortest-arc rotation that turns unit vector a into unit vector b.
export function qFromTo(a, b) {
  const d = dot(a, b);
  if (d < -0.999999) {
    let axis = cross(v3(1, 0, 0), a);
    if (len(axis) < 1e-6) axis = cross(v3(0, 1, 0), a);
    return qFromAxisAngle(axis, Math.PI);
  }
  const c = cross(a, b);
  return qNorm(quat(c.x, c.y, c.z, 1 + d));
}

// Ship-local axes: +Y = nose (thrust direction), +Z = "belly/up in cockpit view", +X = right.
export const LOCAL_FORWARD = v3(0, 1, 0);
export const LOCAL_UP = v3(0, 0, 1);
export const LOCAL_RIGHT = v3(1, 0, 0);
