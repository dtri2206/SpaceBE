// Role 3 (taken from Role 2's folder): the scripted float between the Apollo couch and the living cabin.
//
//   const route = createCabinRoute({ cockpit, cabin, audio, mode, pose: { pos: Vector3, yaw, pitch } });
//   const r = route.update(dt);   // { pos, yaw, pitch, roll, done } in the cockpit frame (camera child of the rig, rig child-less offset = the commander's eye)
//
// mode 'out'  : harness off, aft hatch opens, cabin attached, float over the couches, through the hatch, to cabinEntry facing down the aisle (about 7.2 s)
// mode 'back' : the reverse (about 6 s): cabin door shuts behind you, you settle in the commander's couch looking forward, harness on, aft hatch closes
// Everything it touches goes through cockpit.userData (harness, openHatch, attachCabin, floatPath) and cabin.userData (openBulkheadHatch, zeroG),
// so it is a no-op on a cockpit without them. Pure of flight state: index.js decides when to start it and what to do when it is done.

import * as THREE from 'three';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const TAU = Math.PI * 2;
const unwrap = (a, near) => a + Math.round((near - a) / TAU) * TAU;

// seconds on the route's own clock
export const ROUTE_OUT = { harness: [0, 1.3], hatch: [1.0, 2.4], push: 1.5, travel: [1.5, 6.5], bulk: [2.8, 4.0], settle: 7.2, fans: 1.2 };
export const ROUTE_BACK = { travel: [0, 4.2], bulk: [1.8, 3.0], harness: [4.2, 5.2], hatch: [4.6, 5.8], settle: 6.0, push: 0 };

const _m = new THREE.Matrix4();
/** Position of an Object3D in the cockpit group's frame (walks the parents up to the cockpit, ignores the rig above it). */
export function inCockpitFrame(obj, cockpit, out = new THREE.Vector3()) {
  _m.identity();
  for (let n = obj; n && n !== cockpit; n = n.parent) { n.updateMatrix(); _m.premultiply(n.matrix); }
  return out.setFromMatrixPosition(_m);
}

export function createCabinRoute({ cockpit, cabin, audio, mode = 'out', pose, entry = false, seatYaw = 0 }) {
  const ud = cockpit.userData;
  const cab = cabin?.userData;
  const T = mode === 'out' ? ROUTE_OUT : ROUTE_BACK;
  if (entry) { // ENTRY start: everything is open already, the camera starts in the aisle
    ud.attachCabin?.(cabin); cab?.onFrame?.(); cab?.zeroG?.(true); // onFrame first: resets the cabin's own clock so the first drift step is not one long dt
    ud.harness?.(1); ud.openHatch?.(1); cab?.openBulkheadHatch?.(1);
    audio?.play('cabin.fans', { loop: true });
  } else if (mode === 'out') {
    ud.attachCabin?.(cabin); cab?.onFrame?.(); cab?.zeroG?.(true);
  }
  // path: the player's own start, then the cockpit's float path (couch, over, front, mouth, collar end, cabin entry)
  const wps = (ud.floatPath ?? []).map((o) => inCockpitFrame(o, cockpit));
  const start = entry && wps.length ? wps[wps.length - 1].clone() : pose.pos.clone(); // ENTRY: begin at cabinEntry
  let pts;
  let finalYaw, finalPitch;
  if (mode === 'out') {
    pts = [start, ...wps.filter((p) => p.distanceTo(start) > 0.08)];
    finalYaw = Math.PI; finalPitch = 0; // facing down the aisle (+Z)
  } else {
    const rev = wps.slice().reverse();
    // skip the waypoints already behind the start (a player in the aisle near the hatch, or inside the cockpit, does not float out to them first)
    while (rev.length > 1 && rev[0].z > start.z + 0.05) rev.shift();
    pts = [start, ...rev.filter((p) => p.distanceTo(start) > 0.08)];
    finalYaw = seatYaw; finalPitch = 0; // the commander's eye, turned onto the console (flight passes APOLLO_LOOK_YAW)
  }
  if (pts.length < 2) pts.push(start.clone().add(new THREE.Vector3(0, 0, 0.01)));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = 120;
  const mouthZ = wps.length > 3 ? wps[3].z : 0.56;
  let t = 0, yaw = pose.yaw, pitch = pose.pitch, roll = 0, prevZ = start.z;
  const fired = new Set();
  const fire = (key, fn) => { if (!fired.has(key)) { fired.add(key); fn(); } };
  const pos = start.clone();
  let done = false;
  const ahead = new THREE.Vector3(), dir = new THREE.Vector3();

  return {
    get done() { return done; },
    get time() { return t; },
    get duration() { return T.settle; },
    update(dt) {
      t += Math.min(dt, 0.05);
      // ---- doors and harness
      if (mode === 'out') {
        if (t >= 0) fire('harness', () => audio?.play('crew.harness'));
        ud.harness?.(smooth(seg(t, ...T.harness)));
        if (t >= T.hatch[0]) fire('hatchSound', () => audio?.play('cockpit.hatch'));
        ud.openHatch?.(smooth(seg(t, ...T.hatch)));
        cab?.openBulkheadHatch?.(smooth(seg(t, ...T.bulk)));
        if (t >= T.fans) fire('fans', () => audio?.play('cabin.fans', { loop: true }));
      } else {
        if (t >= T.bulk[0]) fire('bulkSound', () => audio?.play('cockpit.hatch', { volume: 0.5 }));
        cab?.openBulkheadHatch?.(1 - smooth(seg(t, ...T.bulk)));
        if (t >= T.harness[0]) fire('harness', () => audio?.play('crew.harness'));
        ud.harness?.(1 - smooth(seg(t, ...T.harness)));
        if (t >= T.hatch[0]) fire('hatchSound', () => audio?.play('cockpit.hatch'));
        ud.openHatch?.(1 - smooth(seg(t, ...T.hatch)));
      }
      if (t >= T.push) fire('push', () => audio?.play('crew.push'));
      // ---- position along the path (eased, arc-length parametrised)
      const u = smooth(seg(t, ...T.travel));
      curve.getPointAt(u, pos);
      // small natural bob while moving; fades to nothing at both ends
      const env = Math.sin(Math.PI * seg(t, ...T.travel));
      pos.y += 0.012 * env * Math.sin(t * 2.3);
      pos.x += 0.008 * env * Math.sin(t * 1.7 + 1);
      if ((prevZ - mouthZ) * (pos.z - mouthZ) <= 0 && t > T.travel[0] + 0.3) fire('rail', () => audio?.play('handrail.grab'));
      prevZ = pos.z;
      // ---- look: leads along the path, then eases onto the final facing
      curve.getPointAt(Math.min(1, u + 0.05), ahead);
      dir.copy(ahead).sub(curve.getPointAt(u));
      let ty = yaw, tp = pitch;
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        ty = Math.atan2(-dir.x, -dir.z);
        tp = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 0.5, -0.45, 0.45);
      }
      const hold = seg(t, 0, 0.7); // unbuckling: keep the starting look for a moment
      const w = smooth(seg(u, 0.72, 0.97)); // arrival: blend onto the final facing
      const lead = Math.min(hold, 1 - 0.2 * (1 - w));
      ty = unwrap(ty, yaw); tp = pitch + (tp - pitch) * lead;
      const fy = unwrap(finalYaw, yaw);
      ty = ty * (1 - w) + fy * w; tp = tp * (1 - w) + finalPitch * w;
      if (hold < 1) ty = yaw + (ty - yaw) * hold;
      const k = 1 - Math.exp(-dt * (t > T.travel[1] ? 7 : 3.2));
      yaw += (ty - yaw) * k; pitch += (tp - pitch) * k;
      roll = 0.03 * env * Math.sin(t * 1.3 + 0.5);
      if (t >= T.settle) {
        done = true;
        yaw = fy; pitch = finalPitch; roll = 0;
        curve.getPointAt(1, pos);
        if (mode === 'out') ud.harness?.(1);
        else { ud.harness?.(0); ud.openHatch?.(0); cab?.openBulkheadHatch?.(0); }
      }
      return { pos, yaw, pitch, roll, done };
    },
  };
}
