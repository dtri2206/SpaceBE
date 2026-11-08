// Outside ("chase") camera maths: an orbit camera around the rocket in a horizon-level frame. Pure functions and
// plain data, no scene access, so it is unit-tested in Node (tests/chaseCam.test.mjs).
// Frame: up = away from the planet's centre, heading = the direction of travel flattened onto the horizon plane.
// The camera orbits inside this steady frame, so it never rolls with the ship.
import * as THREE from 'three';

export const ZOOM_MIN = 12;
export const ZOOM_MAX = 400;
export const ZOOM_DEFAULT = 45;
export const ZOOM_PAD = 60; // on the launch pad, far enough to see the tower
export const PITCH_LIMIT = THREE.MathUtils.degToRad(80);
export const RESET_PITCH = THREE.MathUtils.degToRad(15);
export const SMOOTH_SECONDS = 0.15;
const MOUSE_SENSITIVITY = 0.0025;
const HEADING_MIN_SPEED = 5; // below this horizontal speed the nose direction decides "behind"

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function clampDist(d) {
  return clamp(Number.isFinite(d) ? d : ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX);
}

/** One wheel step: exponential, clamped. undefined / NaN / 0 leaves the distance unchanged. */
export function stepZoom(dist, wheelDelta) {
  if (!Number.isFinite(wheelDelta) || wheelDelta === 0) return clampDist(dist);
  return clampDist(dist * 1.1 ** clamp(wheelDelta / 100, -50, 50));
}

export function createOrbit(dist = ZOOM_DEFAULT) {
  return { yaw: 0, pitch: RESET_PITCH, dist: clampDist(dist) };
}

/** Behind and slightly above; the zoom distance is kept. */
export function resetOrbit(orbit) {
  orbit.yaw = 0;
  orbit.pitch = RESET_PITCH;
  return orbit;
}

/** Mouse right swings the view to the right, mouse down looks down (camera rises). Pitch is clamped. */
export function applyMouse(orbit, dx, dy) {
  orbit.yaw += dx * MOUSE_SENSITIVITY;
  orbit.pitch = clamp(orbit.pitch + dy * MOUSE_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  return orbit;
}

/**
 * Horizon frame { up, heading, right }. heading = velocity flattened onto the horizon when it is fast enough,
 * else the ship's forward flattened, else the previous heading, else any horizontal direction.
 */
export function horizonFrame(up, vel, forward, lastHeading) {
  const u = up.clone().normalize();
  const heading = new THREE.Vector3();
  const flat = (v) => heading.copy(v).addScaledVector(u, -v.dot(u));
  if (vel && flat(vel).length() >= HEADING_MIN_SPEED) { /* velocity */ }
  else if (forward && flat(forward).length() > 0.15) { /* nose */ }
  else if (lastHeading && flat(lastHeading).lengthSq() > 1e-6) { /* keep */ }
  else heading.set(Math.abs(u.x) < 0.9 ? 1 : 0, Math.abs(u.x) < 0.9 ? 0 : 1, 0).addScaledVector(u, -(Math.abs(u.x) < 0.9 ? u.x : u.y));
  heading.normalize();
  const right = new THREE.Vector3().crossVectors(heading, u);
  return { up: u, heading, right };
}

/** Camera offset from the rocket centre for an orbit (yaw 0 = behind the heading). */
export function orbitOffset(frame, yaw, pitch, dist, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(0, 0, 0)
    .addScaledVector(frame.heading, -Math.cos(yaw) * cp * dist)
    .addScaledVector(frame.right, -Math.sin(yaw) * cp * dist)
    .addScaledVector(frame.up, Math.sin(pitch) * dist);
}

/** Frame-rate independent exponential easing factor (~0.15 s). */
export function smoothFactor(dt, seconds = SMOOTH_SECONDS) {
  return 1 - Math.exp(-Math.max(0, dt) / seconds);
}

export function createChaseState() {
  return { yaw: 0, pitch: RESET_PITCH, dist: ZOOM_DEFAULT, heading: new THREE.Vector3(), ready: false };
}

/**
 * Ease the smoothed orbit (yaw, pitch, log-distance, heading) towards the commanded one. snap=true jumps.
 * Returns the world-space camera offset from the rocket centre.
 */
export function updateChase(state, orbit, frame, dt, snap = false, out = new THREE.Vector3()) {
  const k = snap || !state.ready ? 1 : smoothFactor(dt);
  state.ready = true;
  state.yaw += (orbit.yaw - state.yaw) * k;
  state.pitch += (orbit.pitch - state.pitch) * k;
  state.dist = Math.exp(Math.log(state.dist) + (Math.log(orbit.dist) - Math.log(state.dist)) * k);
  // heading eases too (the direction of travel turns during a gravity turn)
  const h = frame.heading;
  if (k >= 1 || state.heading.lengthSq() < 0.5) state.heading.copy(h);
  else {
    state.heading.lerp(h, k);
    if (state.heading.lengthSq() < 1e-4) state.heading.copy(h);
  }
  state.heading.addScaledVector(frame.up, -state.heading.dot(frame.up)).normalize();
  const eased = { up: frame.up, heading: state.heading, right: new THREE.Vector3().crossVectors(state.heading, frame.up) };
  return orbitOffset(eased, state.yaw, state.pitch, state.dist, out);
}

/** Keep the camera above the ground near the pad: lifts only the vertical part of the offset. */
export function liftAboveGround(offset, up, rocketHeightOverGround, minClearance) {
  const h = offset.dot(up) + rocketHeightOverGround;
  if (h < minClearance) offset.addScaledVector(up, minClearance - h);
  return offset;
}
