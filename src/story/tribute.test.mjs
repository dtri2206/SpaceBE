import assert from 'node:assert/strict';
import test from 'node:test';
import data from './data.json' with { type: 'json' };
import tributes from './tributes.json' with { type: 'json' };
import {
  CLOSING_MS, CONTINUE_HOLD_MS, CREW_STEP_MS, RETRY_LABEL, canContinue, choiceFromKey, failureForChoice,
  fatalTributes, retryLabel, tributeFor, tributeSchedule, visibleHappened,
} from './tributeFlow.js';

// Same map as src/story/index.js (kept in sync by the check below that every mapped lesson exists in data.lessons)
const LESSONS = {
  coldMorning: 'challenger', theFoam: 'columbia', pureOxygen: 'apollo1', successfulFailure: 'apollo13',
  silentReturn: 'soyuz11', unitError: 'marsClimateOrbiter', falseTouchdown: 'marsPolarLander', spin: 'gemini8', beagle: 'beagle2',
};

test('crew sizes match the official lists', () => {
  const sizes = { challenger: 7, columbia: 7, apollo1: 3, soyuz11: 3 };
  for (const [id, n] of Object.entries(sizes)) {
    assert.equal(tributes[id].crew.length, n, id);
    assert.equal(tributeFor(tributes, id)?.mission, tributes[id].mission);
  }
});

test('schema: every fatal tribute has the required fields', () => {
  for (const [id, t] of fatalTributes(tributes)) {
    for (const k of ['mission', 'vehicle', 'date', 'dateText', 'place', 'opening', 'lesson']) assert.ok(t[k], `${id}.${k}`);
    assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(t.happened) && Array.isArray(t.changed) && Array.isArray(t.sources));
    for (const c of t.crew) assert.ok(c.name && c.role, `${id} crew`);
  }
  assert.ok(tributes.closing.text);
});

test('every ending whose lesson is a real fatal event has a tribute; non-fatal ones have none', () => {
  const fatalLessons = ['challenger', 'columbia', 'apollo1', 'soyuz11'];
  for (const [ending, lesson] of Object.entries(LESSONS)) {
    assert.ok(data.lessons[lesson], `${ending} lesson exists`);
    assert.equal(!!tributeFor(tributes, lesson), fatalLessons.includes(lesson), `${ending} -> ${lesson}`);
  }
  assert.equal(tributeFor(tributes, 'closing'), null);
  assert.equal(tributeFor(tributes, 'apollo13'), null);
  assert.equal(tributeFor(tributes, null), null);
});

test('tribute endings are serious, not comic', () => {
  for (const e of ['coldMorning', 'theFoam', 'pureOxygen', 'silentReturn']) assert.equal(data.endings[e].tone, 'serious', e);
});

test('schedule: names 0.9 s apart, Continue only after the quiet hold', () => {
  const s = tributeSchedule(tributes.challenger);
  const crew = s.steps.filter((x) => x.id === 'crew');
  assert.equal(crew.length, 7);
  for (let i = 1; i < crew.length; i++) assert.equal(crew[i].at - crew[i - 1].at, CREW_STEP_MS);
  assert.equal(CREW_STEP_MS, 900);
  assert.ok(s.steps[0].id === 'opening' && s.steps[0].at > 0);
  assert.equal(s.continueAt, s.completeAt + CONTINUE_HOLD_MS);
  assert.equal(canContinue(s.continueAt - 1, s), false);
  assert.equal(canContinue(s.continueAt, s), true);
  assert.equal(CLOSING_MS, 5000);
  assert.ok(tributeSchedule(tributes.challenger, { readOnly: true }).continueAt < s.continueAt);
});

test('empty changed/quote/sources are left out and the page still works', () => {
  const fixtures = [
    { ...tributes.apollo1, changed: [], quote: { text: '', by: '', source: '' }, sources: [] },
    { ...tributes.apollo1, changed: [], quote: null, sources: [] },
  ];
  for (const t of fixtures) {
    const s = tributeSchedule(t);
    const ids = s.steps.map((x) => x.id);
    for (const gone of ['changed', 'quote', 'sources']) assert.ok(!ids.includes(gone), gone);
    assert.ok(ids.includes('happened') && ids.includes('lesson'));
    assert.ok(Number.isFinite(s.continueAt));
  }
  const full = tributeSchedule(tributes.apollo1).steps.map((x) => x.id);
  assert.ok(full.includes('changed') && full.includes('quote') && full.includes('sources'));
  assert.ok(!tributeSchedule(tributes.soyuz11).steps.map((x) => x.id).includes('quote'));
});

test('skipSensitive hides only sensitive sentences', () => {
  const list = ['a', { text: 'b', sensitive: true }, { text: 'c' }];
  assert.deepEqual(visibleHappened(list, true), ['a', 'c']);
  assert.deepEqual(visibleHappened(list, false), ['a', 'b', 'c']);
});

test('retry label only for tribute endings', () => {
  assert.equal(retryLabel(true), RETRY_LABEL);
  assert.equal(retryLabel(false), null);
});

test('Silent Return choice: keys 1/2 only, Enter never decides, skip fails with silentReturn', () => {
  assert.equal(choiceFromKey('Digit1'), 'suitUp');
  assert.equal(choiceFromKey('Numpad2'), 'skip');
  assert.equal(choiceFromKey('Enter'), null);
  assert.equal(choiceFromKey('Space'), null);
  assert.equal(failureForChoice('suitUp'), null);
  const f = failureForChoice('skip');
  assert.equal(f.endingId, 'silentReturn');
  assert.ok(f.cause.length > 10);
  assert.equal(data.returnTrip.filter((x) => x.choice === 'suitUp').length, 1);
});
