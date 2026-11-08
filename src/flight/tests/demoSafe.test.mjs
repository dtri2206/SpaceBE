// Run: node src/flight/tests/demoSafe.test.mjs
import assert from 'node:assert/strict';
import { FlightController, FIXED_DT } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS } from '../presets.js';

const circ = (altitude) => ({ altitude, speed: Math.sqrt((PLANETS.earth.g * PLANETS.earth.radius ** 2) / (PLANETS.earth.radius + altitude)), flightPathDeg: 0, facing: 'prograde' });
function strike(demoSafe, armorHits) {
  const log = [];
  const ship = { ...MOCK_SHIPS.reliable, stats: { ...MOCK_SHIPS.reliable.stats, armorHits } };
  const fc = new FlightController({ bus: { emit: (n, p) => log.push([n, p]) }, g0: G0, planets: PLANETS, shipSpec: ship, start: circ(200000) });
  fc.demoSafe = demoSafe;
  fc.setObstacles([{ id: 'x1', radius: 1, minDist: Infinity, pos: { x: fc.pos.x, y: fc.pos.y + 2, z: fc.pos.z }, vel: { ...fc.vel } }]);
  const notes = []; fc.onNotice = (t) => notes.push(t);
  for (let t = 0; t < 3; t += FIXED_DT) fc.update(FIXED_DT, {});
  return { fc, log, notes };
}
for (const armor of [1, 0]) {
  const on = strike(true, armor);
  assert.ok(!on.fc.failed, 'demo: flight alive');
  assert.ok(!on.fc.ship.heatShieldDamaged && !on.fc.ship.heatShieldUnseen, 'demo: shield intact');
  assert.ok(on.notes.includes('debris_hit'), 'demo: hit feedback kept');
  on.fc.failWith('rud', 'engine_overheat'); assert.ok(!on.fc.failed, 'demo: other failure ignored');
  on.fc.failWith('lastDescent', 'debris_impact'); assert.ok(on.fc.failed, 'demo: planned ending still fires');
}
const offNoArmor = strike(false, 0);
assert.equal(offNoArmor.fc.failed?.causeId, 'debris_impact', 'off: unarmoured hit fails');
const offArmor = strike(false, 1);
assert.ok(!offArmor.fc.failed && offArmor.fc.ship.heatShieldDamaged, 'off: armoured hit gouges shield');
console.log('demoSafe ok');
