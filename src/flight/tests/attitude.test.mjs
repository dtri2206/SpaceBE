// Run: node src/flight/tests/attitude.test.mjs
import assert from 'node:assert/strict';
import { attitudeDeg } from '../attitude.js';
import { qFromAxisAngle, qMul, qFromTo, v3, LOCAL_FORWARD } from '../vec.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const fcAt = (orient, vel = v3(), omega = v3()) => ({ up: v3(0, 1, 0), vel, orient, omega });
const rad = (d) => (d * Math.PI) / 180;

// straight up, head toward -Z (any horizontal): pitch 90, no NaN
let a = attitudeDeg(fcAt(qFromTo(LOCAL_FORWARD, v3(0, 1, 0))));
near(a.pitch, 90);
for (const k of Object.keys(a)) assert.ok(Number.isFinite(a[k]), k);
// nose along east (x) with the head up: pitch 0, yaw 0, roll 0
const east = qFromAxisAngle(v3(0, 0, 1), -Math.PI / 2); // +Y → +X, head (+Z) unchanged
a = attitudeDeg(fcAt(east, v3(100, 0, 0)));
near(a.pitch, 0); near(a.yaw, 0);
// nose east, head pointing +Y (up): body Z → +Y needs a roll of -90 about the nose (+X) from the head=+Z start
const upright = qMul(qFromAxisAngle(v3(1, 0, 0), -Math.PI / 2), east);
near(attitudeDeg(fcAt(upright, v3(100, 0, 0))).roll, 0);
const r30 = qMul(qFromAxisAngle(v3(1, 0, 0), rad(30)), upright);
const rm30 = qMul(qFromAxisAngle(v3(1, 0, 0), rad(-30)), upright);
near(attitudeDeg(fcAt(r30, v3(100, 0, 0))).roll, -attitudeDeg(fcAt(rm30, v3(100, 0, 0))).roll);
near(Math.abs(attitudeDeg(fcAt(r30, v3(100, 0, 0))).roll), 30);
near(attitudeDeg(fcAt(r30, v3(100, 0, 0))).pitch, 0);
// yaw toward the orbit normal (up × east = -Z): nose toward -Z gives +90
a = attitudeDeg(fcAt(qFromTo(LOCAL_FORWARD, v3(0, 0, -1)), v3(100, 0, 0)));
near(a.yaw, 90); near(a.pitch, 0);
// 45 deg up toward east
a = attitudeDeg(fcAt(qFromTo(LOCAL_FORWARD, v3(Math.SQRT1_2, Math.SQRT1_2, 0)), v3(100, 0, 0)));
near(a.pitch, 45); near(a.yaw, 0);
// rates: omega 0.1 rad/s about body X (pitch), Y (roll), Z (yaw) with identity orient
a = attitudeDeg(fcAt({ x: 0, y: 0, z: 0, w: 1 }, v3(), v3(0.1, 0.2, 0.3)));
near(a.pitchRate, 0.1 * 180 / Math.PI); near(a.rollRate, 0.2 * 180 / Math.PI); near(a.yawRate, 0.3 * 180 / Math.PI);
console.log('attitude ok');
