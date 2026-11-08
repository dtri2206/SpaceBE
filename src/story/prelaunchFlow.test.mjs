import assert from 'node:assert/strict';
import test from 'node:test';
import data from './data.json' with { type: 'json' };
import { canQuickStart, finalMessage, quickStartData, scheduleBriefAdvance, stepIndex } from './prelaunchFlow.js';

test('first visit with an empty save runs the full ritual', () => {
  assert.equal(canQuickStart({ visits: 1, saved: {} }), false);
  assert.equal(canQuickStart({ visits: 1, saved: { familyPhoto: 'sister' } }), false);
  assert.equal(canQuickStart({ visits: 1, saved: { messageHome: '   ' , familyPhoto: 'sister' } }), false);
  assert.equal(canQuickStart(), false);
});
test('second visit in a session can skip', () => {
  assert.equal(canQuickStart({ visits: 2, saved: {} }), true);
});
test('a previous save does not skip the first visit in a new session', () => {
  assert.equal(canQuickStart({ visits: 1, saved: { familyPhoto: 'parents', messageHome: 'Love you' } }), false);
});
test('quickStart data and message fallback', () => {
  assert.deepEqual(quickStartData(), { quickStart: true });
  assert.equal(finalMessage('  hi ', 'x'), 'hi');
  assert.equal(finalMessage('   ', 'x'), 'x');
  assert.equal(finalMessage(undefined, 'x'), 'x');
});
test('stepIndex wraps', () => {
  assert.equal(stepIndex(0, -1, 3), 2);
  assert.equal(stepIndex(2, 1, 3), 0);
});

function clock() {
  let now = 0, serial = 0;
  const jobs = new Map();
  return {
    setTimer(fn, delay) { const id = ++serial; jobs.set(id, { fn, at: now + delay }); return id; },
    clearTimer(id) { jobs.delete(id); },
    advance(ms) { now += ms; for (const [id, job] of [...jobs]) if (job.at <= now) { jobs.delete(id); job.fn(); } },
    get pending() { return jobs.size; },
  };
}

test('full intro automatically advances to photo at eight wall seconds, once', () => {
  const time = clock(); let step = 'brief'; let changes = 0;
  scheduleBriefAdvance({ ...time, delayMs: data.prelaunch.briefDurationMs, onAdvance: () => { step = 'photo'; changes++; } });
  time.advance(7999); assert.equal(step, 'brief');
  time.advance(1); assert.equal(step, 'photo');
  time.advance(9000); assert.equal(changes, 1);
});

test('manual navigation or state exit cancels the pending intro, including a stale queued callback', () => {
  for (const action of ['manual navigation', 'state exit']) {
    const time = clock(); let advances = 0, queued;
    const cancel = scheduleBriefAdvance({ ...time, delayMs: 8000, onAdvance: () => advances++, setTimer: (fn, ms) => { queued = fn; return time.setTimer(fn, ms); } });
    time.advance(2000); cancel();
    time.advance(9000); queued();
    assert.equal(advances, 0, action); assert.equal(time.pending, 0);
  }
});

test('retry brief schedules nothing and cannot auto-launch or skip the retry choice', () => {
  const time = clock(); let advances = 0;
  const cancel = scheduleBriefAdvance({ ...time, quick: true, delayMs: 8000, onAdvance: () => advances++ });
  assert.equal(time.pending, 0); time.advance(9000); cancel(); assert.equal(advances, 0);
});
