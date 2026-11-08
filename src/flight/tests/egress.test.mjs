import assert from 'node:assert/strict';
import { egressPose, createEgress, T, EGRESS_SECONDS, markEgressPending, takeEgressPending } from '../egress.js';

const aft = { x: 0.3, z: 2.5 };
const diff = (a, b) => Math.max(Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y), Math.abs(a.pos.z - b.pos.z), Math.abs(a.yaw - b.yaw), Math.abs(a.pitch - b.pitch), Math.abs(a.roll - b.roll));
for (const b of [T.harness, T.stand, T.turn, T.walk, T.fadeStart]) {
  assert.ok(diff(egressPose(b - 1e-4, aft), egressPose(b + 1e-4, aft)) < 1e-3, `continuous at ${b}`);
}
for (let t = 0; t < EGRESS_SECONDS; t += 0.01) assert.ok(diff(egressPose(t, aft), egressPose(t + 0.01, aft)) < 0.12, `smooth at ${t}`);
assert.equal(egressPose(0, aft).fade, 0);
assert.equal(egressPose(EGRESS_SECONDS, aft).fade, 1);
assert.ok(egressPose(T.stand, aft).pos.y > 0.44);
// facing: default aft = behind the seat → yaw 180 deg; walk ends 0.4 m short, never more than 1.2 m
const behind = egressPose(T.walk, null);
assert.ok(Math.abs(Math.abs(behind.yaw) - Math.PI) < 1e-6);
assert.ok(Math.abs(behind.pos.z - 0.6) < 1e-6); // 0.85 m to a point 1 m behind: stops 0.4 m short
assert.ok(Math.abs(egressPose(T.walk, { x: 0, z: 5 }).pos.z - 1.35) < 1e-6);
const near = egressPose(T.walk, { x: 0, z: 0.9 });
assert.ok(Math.abs(near.pos.z - 0.5) < 1e-6);
assert.ok(egressPose(T.walk + 1, aft).pitch < -0.8);
// events fire once, in order
const eg = createEgress(aft);
const all = [];
for (let i = 0; i < 2000 && !eg.done; i++) all.push(...eg.update(1 / 60).fired);
assert.equal(all[0], 'harness');
assert.equal(all.filter((n) => n === 'hatch').length, 1);
assert.equal(all.filter((n) => n === 'done').length, 1);
assert.ok(all.filter((n) => n === 'step').length >= 2);
assert.equal(all.at(-1), 'done');
// skip goes to the hatch without replaying earlier sounds
const sk = createEgress(aft); sk.update(0.5); sk.skip();
const f = sk.update(0.01).fired;
assert.deepEqual(f, ['hatch']);
// pending flag
assert.equal(takeEgressPending(), false); markEgressPending(); assert.equal(takeEgressPending(), true); assert.equal(takeEgressPending(), false);
console.log('egress ok');
