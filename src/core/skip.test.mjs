import assert from 'node:assert/strict';
import test from 'node:test';

const win = new EventTarget();
const doc = new EventTarget();
doc.pointerLockElement = null; doc.activeElement = null; doc.body = {};
globalThis.window = win; globalThis.document = doc; win.innerHeight = 720;
const { SKIP_NEXT, handleSkipKey } = await import('./skip.js');
const { TRANSITIONS } = await import('./contract.js');
const { getState, debugJump } = await import('./state.js');

test('every mapped pair is an allowed transition', () => {
  for (const [from, to] of Object.entries(SKIP_NEXT)) assert.ok(TRANSITIONS[from].includes(to), `${from}->${to}`);
  for (const s of ['RETURN', 'ENDING', 'REPORT']) assert.equal(SKIP_NEXT[s], undefined);
});

test('Enter skips; guards block it', () => {
  const key = (o = {}) => ({ code: 'Enter', repeat: false, ...o });
  debugJump('ORBIT');
  doc.activeElement = { tagName: 'INPUT' };
  assert.equal(handleSkipKey(key()), false);
  doc.activeElement = { tagName: 'DIV', isContentEditable: true };
  assert.equal(handleSkipKey(key()), false);
  doc.activeElement = null;
  assert.equal(handleSkipKey(key({ repeat: true })), false);
  assert.equal(handleSkipKey(key({ shiftKey: true })), false);
  assert.equal(getState(), 'ORBIT');
  assert.equal(handleSkipKey(key()), true);
  assert.equal(getState(), 'CRUISE');
  debugJump('RETURN');
  assert.equal(handleSkipKey(key()), false);
});
