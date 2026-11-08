// Node tests for the reach classification. Run: node src/missions/reach.test.mjs
import assert from 'node:assert/strict';
import { classifyTask, classifyTasks, summarise, tripMetres, validReach } from './reach.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const reach = { walkMetres: 100, roverMetres: 400, roverName: 'LRV', origin: { x: 0, z: 0 }, ship: { x: 0, z: 0 } };

test('with origin = ship, a task is walk/rover/out by its distance', () => {
  assert.equal(classifyTask({ x: 60, z: 0 }, reach), 'walk');
  assert.equal(classifyTask({ x: 100, z: 0 }, reach), 'walk');
  assert.equal(classifyTask({ x: 0, z: 250 }, reach), 'rover');
  assert.equal(classifyTask({ x: 300, z: 300 }, reach), 'out');
});

test('the way back counts: a task past the ship is further than it looks from the player', () => {
  const far = { ...reach, origin: { x: 80, z: 0 }, ship: { x: 0, z: 0 } };
  const task = { x: 150, z: 0 }; // 70 m from the player, 150 m from the ship
  assert.equal(tripMetres(task, far), 220);
  assert.equal(classifyTask(task, far), 'rover'); // 220 > 200
  assert.equal(classifyTask({ x: 100, z: 0 }, far), 'walk'); // 20 + 100 = 120
});

test('classifyTasks adds labels and counts; missing or broken reach gives []', () => {
  const list = classifyTasks([{ label: 'A', x: 10, z: 0 }, { label: 'B', x: 0, z: 300 }, { label: 'C', x: 900, z: 0 }], reach);
  assert.deepEqual(list.map((t) => t.reachLabel), ['in walking reach', 'rover needed', 'out of reach']);
  assert.deepEqual(summarise(list), { walk: 1, rover: 1, out: 1 });
  assert.deepEqual(classifyTasks([{ x: 1, z: 1 }], null), []);
  assert.deepEqual(classifyTasks([{ x: 1, z: 1 }], { walkMetres: 5 }), []);
  assert.equal(validReach(reach), true);
  assert.equal(validReach({ ...reach, origin: { x: NaN, z: 0 } }), false);
});

for (const r of results) console.log(r[0] === 'ok' ? `ok   ${r[1]}` : `FAIL ${r[1]}\n${r[2]?.stack ?? r[2]}`);
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
