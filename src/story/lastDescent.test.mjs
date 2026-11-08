import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
import { lastDescentSchedule, useLastDescent } from './lastDescent.js';

const ids = (s) => s.steps.map((x) => x.id);

test('the lamps and captions come in the verified order, with rising times', () => {
  const s = lastDescentSchedule();
  assert.deepEqual(ids(s), ['entry', 'attitude', 'drogue', 'main', 'reserve', 'tangled', 'tilt', 'silence']);
  assert.deepEqual(s.steps.map((x) => x.state).filter(Boolean), ['calm', 'amber', 'green', 'red', 'amber', 'red']);
  for (let i = 1; i < s.steps.length; i++) assert.ok(s.steps[i].at > s.steps[i - 1].at);
  assert.equal(s.steps.find((x) => x.id === 'main').lamp, 'MAIN CHUTE · NO DEPLOY');
  assert.ok(s.steps.find((x) => x.id === 'main').alarm);
  assert.match(s.steps.find((x) => x.id === 'attitude').caption, /ballistic re-entry/);
});

test('the black cut is before the end of the fall, after every step, and the whole thing is 35-45 s of fall', () => {
  const s = lastDescentSchedule();
  assert.ok(s.blackAt < s.fallMs);
  assert.ok(s.steps.every((x) => x.at < s.blackAt));
  assert.ok(s.blackAt >= 35000 && s.fallMs <= 45000);
  assert.equal(s.totalMs, s.blackAt + 3000 + 4000);
});

test('skipSensitive ends right after MAIN CHUTE · NO DEPLOY', () => {
  const s = lastDescentSchedule({ skipSensitive: true });
  const n = lastDescentSchedule();
  assert.equal(ids(s).at(-1), 'main');
  assert.ok(s.blackAt < n.blackAt && s.blackAt > s.steps.at(-1).at);
  assert.ok(s.blackAt < s.fallMs);
});

test('without the contract names the return stays the normal one', () => {
  const ship = { warnings: ['CHUTE_UNTESTED'] };
  assert.equal(useLastDescent({ contract: { WARNINGS: ['LOW_DV'], ENDINGS: {}, HISTORY_LESSONS: {} }, ship }), false);
  assert.equal(useLastDescent({ contract: {}, ship }), false);
  assert.equal(useLastDescent({ ship }), false);
  assert.equal(useLastDescent(), false);
  const full = { WARNINGS: ['CHUTE_UNTESTED'], ENDINGS: { lastDescent: 'lastDescent' }, HISTORY_LESSONS: { soyuz1: 'soyuz1' } };
  assert.equal(useLastDescent({ contract: full, ship: { warnings: [] } }), false);
  assert.equal(useLastDescent({ contract: { ...full, HISTORY_LESSONS: {} }, ship }), false);
  assert.equal(useLastDescent({ contract: full, ship }), true);
});

test('the lines come from data.json', () => {
  assert.equal(data.lastDescent.coincidence, 'Coincidentally, history has seen an astronaut die exactly like this.');
  assert.match(data.lastDescent.closing, /remembered\.$/);
});
