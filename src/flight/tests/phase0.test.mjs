// Node tests for Phase 0 logic. Run: node src/flight/tests/phase0.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as contract from '../../core/contract.js';
import { CHECKLIST_STEPS, PHASE0_TIMING, boardingPath, buildPoll, createChecklist, hasNoGo, phase0Plan, pollLinesShown, promptAt, scrubAvailable, scrubFee } from '../phase0.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const mock = (name) => JSON.parse(readFileSync(new URL(`../../core/mocks/${name}.json`, import.meta.url)));

test('checklist has the four steps in order', () => {
  assert.deepEqual(CHECKLIST_STEPS.map((s) => s.key), ['1', '2', '3', '4']);
  assert.deepEqual(CHECKLIST_STEPS.map((s) => s.button), ['btn:hatch', 'btn:cabin', 'btn:o2', 'btn:arm']);
});

test('checklist: correct order completes, each step returns its fact', () => {
  const c = createChecklist();
  for (let n = 1; n <= 4; n++) {
    const r = c.press(n);
    assert.equal(r.result, 'ok');
    assert.equal(r.step.id, CHECKLIST_STEPS[n - 1].id);
  }
  assert.equal(c.done, true);
  assert.equal(c.press(2).result, 'finished');
});

test('checklist: wrong order gives a hint and changes nothing', () => {
  const c = createChecklist();
  const r = c.press(3);
  assert.equal(r.result, 'wrong');
  assert.match(r.hint, /1 HATCH/);
  assert.equal(c.index, 0);
  c.press(1);
  assert.equal(c.press(1).result, 'repeat');
  assert.equal(c.press(9).result, 'wrong');
  assert.equal(c.index, 1);
  assert.deepEqual([0, 1, 2, 3].map((i) => c.status(i)), ['done', 'current', 'todo', 'todo']);
});

test('checklist: complete() finishes instantly', () => {
  const c = createChecklist();
  c.complete();
  assert.equal(c.done, true);
  assert.equal(c.status(3), 'done');
});

test('poll: a clean ship is GO at all six stations, in order', () => {
  const p = buildPoll(mock('ship.reliable'));
  assert.deepEqual(p.map((x) => x.station), ['Booster', 'Guidance', 'Propulsion', 'Life support', 'Weather', 'Range']);
  assert.ok(p.every((x) => x.go));
  assert.equal(p[0].text, 'Booster… GO');
  assert.equal(hasNoGo(p), false);
});

test('poll: cold seals make Weather NO-GO with the temperature', () => {
  const p = buildPoll(mock('ship.coldMorning'));
  const w = p.find((x) => x.station === 'Weather');
  assert.equal(w.go, false);
  assert.equal(w.text, 'Weather… NO-GO: 2 °C, seals not rated for cold');
  assert.ok(p.find((x) => x.station === 'Booster').reason.includes('74 %'));
  assert.ok(p.find((x) => x.station === 'Surface ops'));
  assert.ok(hasNoGo(p));
});

test('poll: every contract warning maps to a NO-GO station', () => {
  for (const w of contract.WARNINGS) {
    const p = buildPoll({ warnings: [w], stats: {}, launch: {} });
    assert.equal(p.filter((x) => !x.go).length, 1, w);
    assert.ok(p.find((x) => !x.go).reason.length > 3, w);
  }
  const p = buildPoll({ warnings: ['NO_HEAT_SHIELD'], stats: {} });
  assert.ok(p.some((x) => x.text === 'Thermal… NO-GO: no heat shield'));
  assert.ok(p.map((x) => x.station).indexOf('Thermal') < p.map((x) => x.station).indexOf('Weather'));
});

test('poll: several warnings on one station are joined; missing ship is all GO', () => {
  const p = buildPoll({ warnings: ['LOW_TWR', 'LOW_RELIABILITY'], stats: { twrEarth: 0.9, reliability: 0.5 } });
  const b = p.find((x) => x.station === 'Booster');
  assert.match(b.reason, /0\.90.*; .*50 %/);
  assert.ok(buildPoll(null).every((x) => x.go));
});

test('poll timeline: one line per second, prompt after the last', () => {
  assert.equal(pollLinesShown(0, 6), 0);
  assert.equal(pollLinesShown(PHASE0_TIMING.pollStart, 6), 1);
  assert.equal(pollLinesShown(PHASE0_TIMING.pollStart + 2.1, 6), 3);
  assert.equal(pollLinesShown(99, 6), 6);
  assert.ok(promptAt(6) > PHASE0_TIMING.pollStart + 5);
});

test('plan: first attempt is the full ritual, later ones offer the skip, quickStart is immediate', () => {
  assert.deepEqual(phase0Plan({ attempt: 1 }), { quick: false, offerSkip: false });
  assert.deepEqual(phase0Plan({ attempt: 2 }), { quick: false, offerSkip: true });
  assert.deepEqual(phase0Plan({ attempt: 1, data: { quickStart: true } }), { quick: true, offerSkip: false });
  assert.deepEqual(phase0Plan({ attempt: 3, data: { other: 1 } }), { quick: false, offerSkip: true });
});

test('scrub: only when the contract allows LAUNCH → HANGAR; fee from balance or 100000', () => {
  assert.equal(scrubAvailable({ TRANSITIONS: { LAUNCH: ['ORBIT'] } }), false);
  assert.equal(scrubAvailable({ TRANSITIONS: { LAUNCH: ['ORBIT', 'HANGAR'] } }), true);
  assert.equal(scrubAvailable(undefined), false);
  assert.equal(scrubFee({}), 100000);
  assert.equal(scrubFee({ scrubFee: 50000 }), 50000);
  assert.ok(scrubFee(JSON.parse(readFileSync(new URL('../../core/balance.json', import.meta.url)))) > 0);
});

test('boarding path: rises to the capsule height and ends beside it', () => {
  const path = boardingPath({ x: 0, y: 3, z: 0 }, 14);
  assert.ok(path.length >= 3);
  const ys = path.map((p) => p.position[1]);
  assert.ok(ys.every((y, i) => i === 0 || y >= ys[i - 1] - 3), 'mostly rising');
  assert.ok(Math.abs(ys.at(-1) - (3 + 14)) < 1);
  assert.ok(path.at(-1).position[2] > 0 && path.at(-1).position[2] < 6);
});

let failed = 0;
for (const [status, name, error] of results) {
  if (status === 'FAIL') { failed++; console.log(`FAIL ${name}\n  ${error?.stack ?? error}`); } else console.log(`ok   ${name}`);
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
