// Node tests for the chase camera maths. Run: node src/flight/tests/chaseCam.test.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, PITCH_LIMIT, stepZoom, createOrbit, resetOrbit, applyMouse, horizonFrame,
  orbitOffset, smoothFactor, createChaseState, updateChase, liftAboveGround,
} from '../chaseCam.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok', name); } catch (e) { failed++; console.log('FAIL', name, e.message); }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('wheel undefined / NaN / 0 leaves the distance alone', () => {
  assert.equal(stepZoom(45, undefined), 45);
  assert.equal(stepZoom(45, NaN), 45);
  assert.equal(stepZoom(45, 0), 45);
});
test('zoom steps exponentially and clamps to 12..400', () => {
  assert.ok(Math.abs(stepZoom(45, 100) - 49.5) < 1e-9);
  assert.ok(stepZoom(45, -100) < 45);
  assert.equal(stepZoom(45, 1e6), ZOOM_MAX);
  assert.equal(stepZoom(45, -1e6), ZOOM_MIN);
  assert.equal(createOrbit(5).dist, ZOOM_MIN);
});
test('pitch clamps to +-80 degrees', () => {
  const o = createOrbit();
  applyMouse(o, 0, 1e5);
  assert.equal(o.pitch, PITCH_LIMIT);
  applyMouse(o, 0, -1e6);
  assert.equal(o.pitch, -PITCH_LIMIT);
});
test('reset: behind and above, zoom kept', () => {
  const o = createOrbit(120);
  applyMouse(o, 500, -300);
  resetOrbit(o);
  assert.equal(o.yaw, 0);
  assert.ok(Math.abs(o.pitch - THREE.MathUtils.degToRad(15)) < 1e-9);
  assert.equal(o.dist, 120);
});
test('yaw 0 is behind the velocity on the horizon plane', () => {
  const up = V(0, 1, 0);
  const f = horizonFrame(up, V(100, 300, 0), V(0, 1, 0), null); // climbing and moving +X
  const off = orbitOffset(f, 0, 0, 50);
  assert.ok(Math.abs(off.x + 50) < 1e-9 && Math.abs(off.y) < 1e-9 && Math.abs(off.z) < 1e-9);
});
test('speed ~0 falls back to the nose, then to the last heading', () => {
  const up = V(0, 1, 0);
  const f1 = horizonFrame(up, V(0, 0, 0), V(0, 0.5, -0.8), null);
  assert.ok(f1.heading.z < -0.99);
  const f2 = horizonFrame(up, V(0, 0, 0), V(0, 1, 0), V(1, 0, 0));
  assert.ok(f2.heading.x > 0.99);
  const f3 = horizonFrame(up, V(0, 0, 0), V(0, 1, 0), null);
  assert.ok(Math.abs(f3.heading.length() - 1) < 1e-9 && Math.abs(f3.heading.dot(up)) < 1e-9);
});
test('horizon level: camera up . radial up > 0 and no roll, any radial direction', () => {
  for (const up of [V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), V(1, 1, 1).normalize(), V(-0.3, 0.2, 0.9).normalize()]) {
    const vel = V(3, -7, 11);
    const f = horizonFrame(up, vel, V(0, 0, 1), null);
    for (const [yaw, pitch] of [[0, 0.26], [1.2, -0.5], [-2.8, 1.3], [3.1, 0]]) {
      const off = orbitOffset(f, yaw, pitch, 80);
      assert.ok(Math.abs(off.length() - 80) < 1e-9);
      const cam = new THREE.Camera();
      cam.up.copy(up);
      cam.position.copy(off);
      cam.lookAt(0, 0, 0);
      const camUp = V(0, 1, 0).applyQuaternion(cam.quaternion);
      assert.ok(camUp.dot(up) > 0, 'camera up toward the sky');
      const camRight = V(1, 0, 0).applyQuaternion(cam.quaternion);
      assert.ok(Math.abs(camRight.dot(up)) < 1e-9, 'no roll: camera right stays level');
    }
  }
});
test('smoothing converges, is frame-rate independent, and snaps on first use', () => {
  assert.ok(Math.abs(smoothFactor(0.15) - (1 - Math.exp(-1))) < 1e-12);
  const a = 1 - smoothFactor(0.05) ** 1, b = (1 - smoothFactor(0.025)) ** 2;
  assert.ok(Math.abs(a - b) < 1e-12);
  const st = createChaseState();
  const o = createOrbit(45);
  const f = horizonFrame(V(0, 1, 0), V(10, 0, 0), null, null);
  const first = updateChase(st, o, f, 0.016);
  assert.ok(Math.abs(first.length() - 45) < 1e-9, 'first call snaps');
  o.yaw = 1; o.dist = 200;
  let off;
  for (let i = 0; i < 200; i++) off = updateChase(st, o, f, 0.016);
  assert.ok(Math.abs(off.length() - 200) < 0.5);
  assert.ok(Math.abs(st.yaw - 1) < 1e-3);
});
test('ground clamp lifts only when below the clearance', () => {
  const up = V(0, 1, 0);
  assert.equal(liftAboveGround(V(10, -30, 0), up, 3, 1.5).y, -1.5);
  assert.equal(liftAboveGround(V(10, 30, 0), up, 3, 1.5).y, 30);
});
test('default zoom constant', () => assert.equal(ZOOM_DEFAULT, 45));

process.exit(failed ? 1 : 0);
