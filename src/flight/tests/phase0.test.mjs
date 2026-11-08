// Node tests for Phase 0 logic. Run: node src/flight/tests/phase0.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as contract from '../../core/contract.js';
import { CABIN_OPTIONS, CHECKLIST_STEPS, PHASE0_TIMING, boardingPath, buildPoll, createChecklist, hasNoGo, phase0Plan, aimInfo, buttonIdOfName, fallbackLabel, nextButtonId, pollLinesShown, promptAt, scrubAvailable, scrubFee } from '../phase0.js';

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

test('aim: node names map to checklist ids in both cockpits', () => {
  for (const n of ['btn:hatch', 'btnhatch', 'btnCap.hatch', 'btnCaphatch', 'btnLamp.hatch', 'btnLamphatch']) assert.equal(buttonIdOfName(n), 'hatch', n);
  assert.equal(buttonIdOfName('btn:arm'), 'arm');
  for (const n of ['btn:fire', 'btnCap.fire', 'btnCap', 'btnLamp', 'hatch', '', null]) assert.equal(buttonIdOfName(n), null, String(n));
});

test('aim: next / blocked / done labels follow the checklist order', () => {
  const c = createChecklist();
  assert.equal(nextButtonId(c), 'hatch');
  assert.deepEqual([aimInfo(c, 'hatch').kind, aimInfo(c, 'hatch').clickable, aimInfo(c, 'hatch').tone], ['next', true, 'ok']);
  assert.equal(aimInfo(c, 'hatch').label, 'HATCH · click to close the hatch');
  const b = aimInfo(c, 'cabin');
  assert.deepEqual([b.kind, b.clickable, b.tone, b.label], ['blocked', false, 'warn', 'CABIN · close the hatch first']);
  assert.equal(aimInfo(c, 'arm').label, 'ARM ENGINE · close the hatch first');
  c.press(1);
  assert.equal(aimInfo(c, 'hatch').kind, 'done');
  assert.equal(aimInfo(c, 'cabin').kind, 'next'); assert.equal(aimInfo(c, 'o2').label, 'O2 · pressurise the cabin first');
  c.complete();
  assert.equal(aimInfo(c, 'arm').kind, 'none'); assert.equal(nextButtonId(c), null);
  assert.equal(aimInfo(createChecklist(), 'bogus').kind, 'none');
});

test('aim: fallback label names the key only for that item', () => {
  assert.equal(fallbackLabel(CHECKLIST_STEPS[0]), 'HATCH · press 1');
  assert.equal(fallbackLabel(CHECKLIST_STEPS[3]), 'ARM ENGINE · press 4');
});

test('no on-screen copy mentions keys 1-4', () => {
  const copy = JSON.parse(readFileSync(new URL('../phase0.json', import.meta.url))).copy;
  assert.doesNotMatch(`${copy.checklistKeys} ${copy.checklistFact}`, /\b[1-4]\b|1–4/);
});

test('poll: pure oxygen + wiring fault adds an ECLSS NO-GO, only when asked for; no ShipSpec warning does', () => {
  const clean = buildPoll(mock('ship.reliable'));
  assert.ok(!clean.some((x) => x.station === 'ECLSS'));
  const p = buildPoll(mock('ship.reliable'), { pureOxygenFault: true });
  const e = p.find((x) => x.station === 'ECLSS');
  assert.equal(e.go, false); assert.equal(e.reason, 'pure-oxygen cabin with a wiring fault'); assert.equal(p.filter((x) => !x.go).length, 1);
  const cold = buildPoll(mock('ship.coldMorning'), { pureOxygenFault: true });
  assert.ok(cold.find((x) => x.station === 'Weather' && !x.go) && cold.find((x) => x.station === 'ECLSS' && !x.go));
});

test('cabin options: air mix 20 s, pure oxygen 5 s, keys 1 and 2', () => {
  assert.equal(CABIN_OPTIONS.air.simSeconds, 20); assert.equal(CABIN_OPTIONS.pure.simSeconds, 5);
  assert.deepEqual([CABIN_OPTIONS.air.key, CABIN_OPTIONS.pure.key], ['1', '2']);
  assert.ok(PHASE0_TIMING.fillAir > PHASE0_TIMING.fillPure && PHASE0_TIMING.fillAir <= 6 && PHASE0_TIMING.purge <= 6);
});

let failed = 0;
for (const [status, name, error] of results) {
  if (status === 'FAIL') { failed++; console.log(`FAIL ${name}\n  ${error?.stack ?? error}`); } else console.log(`ok   ${name}`);
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
