import assert from 'node:assert/strict';
import test from 'node:test';

// Minimal browser stand-ins: window and document are plain event targets.
const win = new EventTarget();
const doc = new EventTarget();
doc.pointerLockElement = null;
doc.activeElement = null;
doc.body = {};
globalThis.window = win;
globalThis.document = doc;
win.innerHeight = 720;
const { input } = await import('./input.js');

const fire = (target, type, props = {}) => {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, props);
  target.dispatchEvent(e);
  return e;
};
const lock = (on) => { doc.pointerLockElement = on ? {} : null; fire(doc, 'pointerlockchange'); };

test('mouse buttons are ignored while the pointer is not locked (the locking click does not count)', () => {
  let n = 0;
  input.onPress('Mouse0', () => n++);
  fire(win, 'mousedown', { button: 0 });
  assert.equal(input.isDown('Mouse0'), false);
  assert.equal(n, 0);
  fire(win, 'mouseup', { button: 0 });
  input.clear();
});

test('Mouse0/1/2 behave like keys while locked', () => {
  lock(true);
  let n = 0;
  input.onPress('Mouse0', () => n++);
  fire(win, 'mousedown', { button: 0 });
  fire(win, 'mousedown', { button: 0 }); // no repeat
  assert.equal(input.isDown('Mouse0'), true);
  assert.equal(input.isDown('Mouse1'), false);
  assert.equal(n, 1);
  fire(win, 'mousedown', { button: 1 });
  fire(win, 'mousedown', { button: 2 });
  assert.ok(input.isDown('Mouse1') && input.isDown('Mouse2'));
  fire(win, 'mouseup', { button: 0 });
  assert.equal(input.isDown('Mouse0'), false);
  input.clear();
  assert.equal(input.isDown('Mouse1'), false, 'clear() releases mouse buttons');
  fire(win, 'mousedown', { button: 0 });
  assert.equal(n, 1, 'clear() removed the onPress handler');
  input.clear();
  lock(false);
});

test('losing pointer lock or window focus releases held buttons', () => {
  lock(true);
  fire(win, 'mousedown', { button: 0 });
  lock(false);
  assert.equal(input.isDown('Mouse0'), false);
  lock(true);
  fire(win, 'mousedown', { button: 2 });
  fire(win, 'blur');
  assert.equal(input.isDown('Mouse2'), false);
  lock(false);
});

test('context menu is prevented only while locked', () => {
  assert.equal(fire(win, 'contextmenu').defaultPrevented, false);
  lock(true);
  assert.equal(fire(win, 'contextmenu').defaultPrevented, true);
  lock(false);
});
