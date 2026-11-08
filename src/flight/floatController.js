// Role 3: zero-g float controller. Free movement of the player's eye inside the Apollo cockpit, the 0.25 m collar and the attached living cabin.
// Exported from src/flight/index.js for Role 4's cruise.
//
//   const fc = createFloatController({ camera, cockpit, cabin, input, audio, pos, yaw, pitch, onSeat });
//   fc.update(dt, mouse?)      // call every frame; sets camera.position / quaternion in the cockpit frame (camera = child of the rig, same frame as the cockpit)
//   fc.hint()                  // { text, level } the one line to show now (grab / let go / back to the couch), or null
//   fc.dispose()
//
// Keys: mouse look (pointer lock), WASD thrust along the view, Space up, C down (camera up axis), E: grab the nearest handrail (within 0.6 m) / let go
// (push off); E when looking at the flight-deck hatch within 1.2 m calls onSeat() (the owner plays the route back to the couch).
// Zero g: you keep drifting, only gentle damping, max speed 1.2 m/s, sphere radius 0.22 m, slide + soft bounce on the cabin's floatColliders,
// the cockpit box and the collar. Anything not given (cabin, audio, onSeat) is simply skipped.

import * as THREE from 'three';

export const FLOAT = {
  radius: 0.22, maxSpeed: 1.2, accel: 1.5, damping: 0.14, bounce: 0.3,
  grabReach: 0.6, seatReach: 1.2, seatCone: Math.cos(THREE.MathUtils.degToRad(42)), pushOff: 0.5, sensitivity: 0.002, maxMouseStep: 300,
  // cockpit interior (cockpit frame, the sphere centre stays radius inside) and the collar from the aft hatch to the cabin's bulkhead hatch
  cockpitBox: { min: [-0.95, -0.7, -1.7], max: [1.45, 1.05, 0.5] },
  collar: { x: 0.54, y: 0.48, r: 0.375, z0: 0.0, z1: 0.76 },
  // solid furniture in the cockpit: the three couches (below the eye line, so the aft hatch above them stays open) and the main display console
  cockpitSolids: [{ min: [-0.4, -1.6, -0.05], max: [1.46, -0.05, 0.55] }, { min: [0.4, -1.0, -1.62], max: [1.58, 0.19, -0.1] }],
};

const FWD = new THREE.Vector3(), RIGHT = new THREE.Vector3(), UP = new THREE.Vector3(), WANT = new THREE.Vector3();

function toBoxes(colliders, off) {
  return (colliders ?? []).map((b) => ({ min: [b.min.x + off.x, b.min.y + off.y, b.min.z + off.z], max: [b.max.x + off.x, b.max.y + off.y, b.max.z + off.z] }));
}

// sphere (p, r) against a solid box: push p out, return the contact normal in n and the depth, or 0
const _n = new THREE.Vector3();
function pushOutOfBox(p, r, box, n) {
  const c = [Math.max(box.min[0], Math.min(box.max[0], p.x)), Math.max(box.min[1], Math.min(box.max[1], p.y)), Math.max(box.min[2], Math.min(box.max[2], p.z))];
  const dx = p.x - c[0], dy = p.y - c[1], dz = p.z - c[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return 0;
  if (d2 > 1e-10) { const d = Math.sqrt(d2); n.set(dx / d, dy / d, dz / d); return r - d; }
  // the centre is inside the box: leave through the nearest face
  let best = Infinity, axis = 0, sign = 1;
  const pv = [p.x, p.y, p.z];
  for (let a = 0; a < 3; a++) {
    const lo = pv[a] - box.min[a], hi = box.max[a] - pv[a];
    if (lo < best) { best = lo; axis = a; sign = -1; }
    if (hi < best) { best = hi; axis = a; sign = 1; }
  }
  n.set(0, 0, 0); n.setComponent(axis, sign);
  return best + r;
}

export function createFloatController({ camera, cockpit, cabin, input, audio, pos, yaw = Math.PI, pitch = 0, onSeat, speed = FLOAT.maxSpeed } = {}) {
  if (!camera) throw new Error('createFloatController: pass the camera');
  const off = cabin && cabin.parent === cockpit ? cabin.position.clone() : null; // the cabin has no rotation: cabin-local + off = cockpit frame
  const boxes = off ? toBoxes(cabin.userData.floatColliders, off) : [];
  const rails = off ? (cabin.userData.handrails ?? []).map((h) => ({ a: h.a.clone().add(off), b: h.b.clone().add(off) })) : [];
  const bh = cabin?.userData.bulkheadHatch ?? { x: 0, y: 0.925, z: -4, r: 0.375 };
  const hatch = off ? new THREE.Vector3(bh.x, bh.y, bh.z).add(off) : new THREE.Vector3(FLOAT.collar.x, FLOAT.collar.y, FLOAT.collar.z1);
  const R = FLOAT.radius;
  const state = { pos: pos ? pos.clone() : new THREE.Vector3(), vel: new THREE.Vector3(), yaw, pitch, roll: 0, grabbed: null, push: 0 };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const nearestRail = (p, out) => {
    let best = null, bd = Infinity;
    for (const r of rails) {
      const ab = _ab.subVectors(r.b, r.a);
      const tt = THREE.MathUtils.clamp(_ap.subVectors(p, r.a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
      const q = _q.copy(r.a).addScaledVector(ab, tt);
      const d = q.distanceTo(p);
      if (d < bd) { bd = d; best = out.copy(q); }
    }
    return best ? { point: best, dist: bd } : null;
  };
  const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _q = new THREE.Vector3();
  const railPt = new THREE.Vector3();

  function forwardOf(y, p, out) { return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)); }

  function canSeat() {
    const d = state.pos.distanceTo(hatch);
    if (d > FLOAT.seatReach) return false;
    if (state.pos.z < hatch.z - 0.05) return true; // already in the collar or the cockpit
    FWD.set(hatch.x - state.pos.x, hatch.y - state.pos.y, hatch.z - state.pos.z).normalize();
    return forwardOf(state.yaw, state.pitch, RIGHT).dot(FWD) > FLOAT.seatCone;
  }
  function release(dirPush) {
    if (!state.grabbed) return;
    state.grabbed = null;
    state.vel.copy(dirPush);
    audio?.play('crew.push');
  }
  function onE() {
    if (state.grabbed) {
      // let go: a soft push away from the rail
      const dirAway = _n.copy(state.pos).sub(state.grabbed.point);
      if (dirAway.lengthSq() < 1e-6) dirAway.copy(forwardOf(state.yaw, state.pitch, RIGHT)).negate();
      release(dirAway.normalize().multiplyScalar(FLOAT.pushOff * 0.6));
      return;
    }
    if (canSeat()) { onSeat?.(); return; }
    const r = nearestRail(state.pos, railPt);
    if (r && r.dist <= FLOAT.grabReach) {
      state.grabbed = { point: r.point.clone() };
      state.vel.multiplyScalar(0.5); // damps to zero over the next few frames
      audio?.play('handrail.grab');
    }
  }
  const offs = [input?.onPress?.('KeyE', onE)];

  function collide() {
    const p = state.pos, v = state.vel;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      const react = (depth) => {
        p.addScaledVector(_n, depth);
        const vn = v.dot(_n);
        if (vn < 0) v.addScaledVector(_n, -vn * (1 + (vn < -0.15 ? FLOAT.bounce : 0))); // soft bounce only for a real hit, else just slide
        hit = true;
      };
      for (const b of boxes) { const d = pushOutOfBox(p, R, b, _n); if (d > 0) react(d); }
      if (p.z < 0.8) for (const b of FLOAT.cockpitSolids) { const d = pushOutOfBox(p, R, b, _n); if (d > 0) react(d); }
      if (p.z < 0.8) { // the cockpit box and the collar are the only places the player may be there
        const bx = FLOAT.cockpitBox, c = FLOAT.collar;
        const cb = [Math.max(bx.min[0] + R, Math.min(bx.max[0] - R, p.x)), Math.max(bx.min[1] + R, Math.min(bx.max[1] - R, p.y)), Math.max(bx.min[2] + R, Math.min(bx.max[2] - R, p.z))];
        const dBox = Math.hypot(p.x - cb[0], p.y - cb[1], p.z - cb[2]);
        if (dBox > 1e-5) {
          // collar: a cylinder along +Z, radius c.r - R, from the aft hatch to the bulkhead hatch (open into the cabin when one is attached)
          const rx = p.x - c.x, ry = p.y - c.y, rr = Math.hypot(rx, ry), maxR = c.r - R;
          const k = rr > maxR ? maxR / rr : 1;
          const cz = Math.max(c.z0, Math.min(off ? 1.0 : c.z1 - R, p.z));
          const ct = [c.x + rx * k, c.y + ry * k, cz];
          const dCol = Math.hypot(p.x - ct[0], p.y - ct[1], p.z - ct[2]);
          const t = dCol < dBox ? ct : cb;
          _n.set(p.x - t[0], p.y - t[1], p.z - t[2]);
          const d = _n.length();
          if (d > 1e-6) { _n.divideScalar(d); p.set(t[0], t[1], t[2]); const vn = v.dot(_n); if (vn < 0) v.addScaledVector(_n, -vn * (1 + (vn < -0.15 ? FLOAT.bounce : 0))); hit = true; }
        }
      }
      if (!hit) break;
    }
  }

  function apply() {
    euler.set(state.pitch, state.yaw, state.roll, 'YXZ');
    camera.position.copy(state.pos);
    camera.quaternion.setFromEuler(euler);
  }
  apply();

  return {
    state,
    get position() { return state.pos; },
    get velocity() { return state.vel; },
    get yaw() { return state.yaw; },
    get pitch() { return state.pitch; },
    get grabbed() { return !!state.grabbed; },
    set yaw(v) { state.yaw = v; }, set pitch(v) { state.pitch = v; },
    /** one line for the HUD: what E does right now */
    hint() {
      if (state.grabbed) return { text: 'E · let go (any move key pushes off)', level: 'amber' };
      if (canSeat()) return { text: 'E · float back to the commander\'s couch', level: 'amber' };
      const r = nearestRail(state.pos, railPt);
      if (r && r.dist <= FLOAT.grabReach) return { text: 'E · grab the rail', level: 'amber' };
      return null;
    },
    update(dt, mouse) {
      dt = Math.min(dt, 0.05);
      const m = mouse ?? input?.mouseDelta?.() ?? { x: 0, y: 0 };
      if (Math.abs(m.x) < FLOAT.maxMouseStep && Math.abs(m.y) < FLOAT.maxMouseStep) {
        state.yaw -= m.x * FLOAT.sensitivity;
        state.pitch = THREE.MathUtils.clamp(state.pitch - m.y * FLOAT.sensitivity, -1.5, 1.5);
      }
      forwardOf(state.yaw, state.pitch, FWD);
      RIGHT.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
      UP.crossVectors(RIGHT, FWD).normalize();
      const down = (c) => !!input?.isDown?.(c);
      WANT.set(0, 0, 0);
      if (down('KeyW')) WANT.add(FWD); if (down('KeyS')) WANT.sub(FWD);
      if (down('KeyD')) WANT.add(RIGHT); if (down('KeyA')) WANT.sub(RIGHT);
      if (down('Space')) WANT.add(UP); if (down('KeyC')) WANT.sub(UP);
      const thrust = WANT.lengthSq() > 0;
      if (thrust) WANT.normalize();
      if (state.grabbed) {
        if (thrust) release(WANT.clone().multiplyScalar(FLOAT.pushOff));
        else { state.vel.multiplyScalar(Math.exp(-10 * dt)); if (state.vel.lengthSq() < 1e-5) state.vel.set(0, 0, 0); }
      }
      if (!state.grabbed) {
        if (thrust) state.vel.addScaledVector(WANT, FLOAT.accel * dt);
        state.vel.multiplyScalar(Math.exp(-FLOAT.damping * dt)); // gentle: it is zero g, you keep drifting
        const sp = state.vel.length();
        if (sp > speed) state.vel.multiplyScalar(speed / sp);
        state.pos.addScaledVector(state.vel, dt);
        collide();
      }
      state.roll += (0 - state.roll) * Math.min(1, dt * 3);
      apply();
      return state;
    },
    dispose() { offs.forEach((f) => f?.()); },
  };
}
