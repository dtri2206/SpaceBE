// Debris encounters (Role 2 logic). TEAM_PROMPT §6.3 "Cruise": orbital debris near Earth.
// Used by the Earth-orbit scene and by Role 4's cruise encounter (it drives a FlightController).
//
//   const field = createDebrisField({ fc, aheadDistance: 3000, count: 40 });
//   fc.setObstacles(field);           // FlightController moves them + checks collisions every physics step
//   fc.telemetry.collisionWarning      // { distance, timeToClosest, missDistance } for the HUD, or null
//
// Realism note (for the Guidebook): real orbital debris hits at ~10 km/s relative speed, far too fast to
// see or dodge. The game slows the encounter down (default 120 m/s) so the player can react, and says so.

import { v3, add, sub, scale, norm, cross, len, dot } from './vec.js';

// Small deterministic RNG so a seeded field is the same every run (good for demos and tests).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pieces are placed in a disc across the ship's path `aheadDistance` metres ahead and drift toward it.
// A fraction (`onPath`) sits right on the current path so doing nothing WILL cause hits.
export function createDebrisField({
  fc, aheadDistance = 3000, count = 40, spread = 350, depth = 600, relSpeed = 120, onPath = 0.15,
  minRadius = 0.3, maxRadius = 2.5, seed = 1,
} = {}) {
  const rng = mulberry32(seed);
  const dir = len(fc.vel) > 1 ? norm(fc.vel) : fc.forward;
  // two axes perpendicular to the path
  let side = cross(dir, fc.up);
  if (len(side) < 1e-6) side = cross(dir, v3(1, 0, 0));
  side = norm(side);
  const lift = norm(cross(side, dir));
  const center = add(fc.pos, scale(dir, aheadDistance));
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const r = rng() < onPath ? rng() * 4 : Math.sqrt(rng()) * spread; // uniform in a disc, some on the path
    const a = rng() * Math.PI * 2;
    const along = (rng() - 0.5) * depth;
    const offset = add(add(scale(side, Math.cos(a) * r), scale(lift, Math.sin(a) * r)), scale(dir, along));
    // tiny velocity scatter: 1 m/s would already drift a piece ~25 m off course before it arrives
    const tumble = v3((rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1);
    pieces.push({
      id: `debris-${seed}-${i}`,
      pos: add(center, offset),
      vel: add(sub(fc.vel, scale(dir, relSpeed)), tumble), // coming toward the ship
      radius: minRadius + (maxRadius - minRadius) * rng() ** 2, // mostly small pieces
      spin: v3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1), // for Role 3's tumbling meshes
    });
  }
  return pieces;
}

// Closest approach of a straight-line relative motion (pieces and ship both ~straight over a few seconds).
export function closestApproach(shipPos, shipVel, piece) {
  const r = sub(piece.pos, shipPos);
  const v = sub(piece.vel, shipVel);
  const vv = dot(v, v);
  const t = vv > 1e-9 ? -dot(r, v) / vv : 0;
  const miss = len(add(r, scale(v, Math.max(0, t))));
  return { timeToClosest: t, missDistance: miss, distance: len(r) };
}

// The Earth-orbit encounter the player can dodge (index.js, tests): 45 pieces in a disc ~250 m wide, spread over ~1000 m
// of depth so they arrive one after another over ~8 s at 120 m/s; the first one ~14 s after the field is placed.
// Only a few sit on the current path, so doing nothing costs 1-2 hits; a sideways Δv of a few m/s clears them all.
export const DEBRIS_ENCOUNTER = { aheadDistance: 2200, count: 45, spread: 250, depth: 1000, relSpeed: 120, onPath: 0.12, seed: 2041 };
