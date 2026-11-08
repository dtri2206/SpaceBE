// Zero-g float controller: drift, speed cap, wall collision, rail grab, back-to-couch trigger (no renderer needed).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFloatController, FLOAT } from '../floatController.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const keys = new Set(); const presses = {};
const input = { isDown: (c) => keys.has(c), onPress: (c, fn) => { presses[c] = fn; return () => { delete presses[c]; }; }, mouseDelta: () => ({ x: 0, y: 0 }) };
const played = [];
const audio = { play: (n) => played.push(n) };
const cockpit = new THREE.Group();
const cabin = new THREE.Group();
cabin.position.set(0.54, -0.445, 4.76);
cockpit.add(cabin);
cabin.userData.floatColliders = [{ min: V(-2, 0, 3.9), max: V(2, 3, 4.5) }]; // the end wall, cabin z 3.9..4.5
cabin.userData.handrails = [{ a: V(0, 2, 0), b: V(0, 2, 1) }];
cabin.userData.bulkheadHatch = { x: 0, y: 0.925, z: -4, r: 0.375 };
const camera = new THREE.PerspectiveCamera();
let seat = 0;
const mk = (pos) => createFloatController({ camera, cockpit, cabin, input, audio, pos, yaw: Math.PI, pitch: 0, onSeat: () => { seat++; } });
const run = (c, s, dt = 1 / 60) => { for (let i = 0; i < s / dt; i++) c.update(dt, { x: 0, y: 0 }); };

// drift: thrust, release, keep moving, slowly slow down, never above the cap
let c = mk(V(0.54, 1.2, 2));
keys.add('KeyW'); run(c, 3); keys.clear();
assert.ok(c.velocity.length() <= FLOAT.maxSpeed + 1e-6 && c.velocity.length() > 0.8, 'speed capped near 1.2 m/s');
assert.ok(c.position.z > 2, 'W with yaw PI moves toward +Z');
const v1 = c.velocity.length(); run(c, 1); const v2 = c.velocity.length();
assert.ok(v2 < v1 && v2 > v1 * 0.8, 'gentle damping: keeps drifting');

// wall: sphere stops at its surface (cabin z 3.9 -> cockpit z 8.66)
c = mk(V(0.54, 1.2, 8)); keys.add('KeyW'); run(c, 4); keys.clear();
assert.ok(c.position.z <= 8.66 - FLOAT.radius + 1e-6 && c.position.z > 8.2, 'the wall stops the sphere at its surface');

// rail grab with E, velocity damped to zero, push off with a move key
c = mk(V(0.54 + 0, 1.6 - 0.445 + 0.2, 4.76 + 0.3)); // 0.3 m from the rail
presses.KeyE(); assert.ok(c.grabbed, 'grabbed the rail'); assert.ok(played.includes('handrail.grab'));
run(c, 0.5); assert.ok(c.velocity.length() < 1e-3, 'velocity damps to zero');
keys.add('KeyD'); run(c, 0.1); keys.clear(); assert.ok(!c.grabbed && c.velocity.length() > 0.3, 'a move key pushes off'); assert.ok(played.includes('crew.push'));

// back to the couch: close to the bulkhead hatch (cockpit z 0.76) and looking at it
c = mk(V(0.54, 0.48 + 0.2, 1.5)); c.yaw = 0; c.pitch = 0;
presses.KeyE(); assert.equal(seat, 1, 'E at the hatch calls onSeat');
c.dispose(); assert.ok(!presses.KeyE, 'dispose removes the E handler');
console.log('floatController ok');
