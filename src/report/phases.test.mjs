// Node tests for the Flight Report phases formatting. Run: node src/report/phases.test.mjs
import assert from 'node:assert/strict';
import { formatPhases, starString, statLabel, statValue } from './phases.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };

test('stars', () => {
  assert.equal(starString(2), '★★☆');
  assert.equal(starString(3), '★★★');
  assert.equal(starString(0), '★☆☆');
  assert.equal(starString(9), '★★★');
  assert.equal(starString(undefined), '★☆☆');
});

test('labels and values', () => {
  assert.equal(statLabel('peakG'), 'peak G');
  assert.equal(statLabel('touchdown_speed'), 'touchdown speed');
  assert.equal(statLabel('maxQKpa'), 'max q (kPa)');
  assert.equal(statLabel('fuelLeftPct'), 'fuel left (%)');
  assert.equal(statValue(3.14159), '3.1');
  assert.equal(statValue(1234.5), '1235');
  assert.equal(statValue(null), '—');
  assert.equal(statValue(true), 'yes');
});

test('formatPhases handles missing data and caps stats at 4', () => {
  assert.deepEqual(formatPhases(undefined), []);
  assert.deepEqual(formatPhases([]), []);
  assert.deepEqual(formatPhases([null, {}, 5]), []);
  const [a] = formatPhases([{ phase: 'landing', stars: 3, text: 'Soft.', stats: { a: 1, b: 2, c: 3, d: 4, e: 5 } }]);
  assert.equal(a.name, 'Landing');
  assert.equal(a.stars, '★★★');
  assert.equal(a.stats.length, 4);
  assert.deepEqual(formatPhases([{ phase: 'entry', stars: 1 }])[0].stats, []);
});

for (const r of results) console.log(r[0] === 'ok' ? `ok   ${r[1]}` : `FAIL ${r[1]}\n${r[2]?.stack ?? r[2]}`);
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
