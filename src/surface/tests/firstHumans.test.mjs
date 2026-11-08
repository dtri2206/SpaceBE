// Node tests: first-humans timeline. Run: node src/surface/tests/firstHumans.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { firstHumansPose, firstHumansEvents, FH_EVENTS, FH_TOTAL, FH_CAPTIONS } from '../firstHumans.js';

const FIELDS = ['x', 'z', 'dy', 'pitch', 'yaw', 'fade', 'shoulder'];

test('pose is continuous (no jumps, also across segment borders)', () => {
  const dt = 1 / 600;
  let prev = firstHumansPose(0);
  for (let t = dt; t <= FH_TOTAL; t += dt) {
    const p = firstHumansPose(t);
    for (const f of FIELDS) assert.ok(Math.abs(p[f] - prev[f]) < 0.02, `${f} jumps at t=${t.toFixed(3)}: ${prev[f]} -> ${p[f]}`);
    for (const f of ['reach', 'lift', 'spin', 'away', 'reachBack', 'draw', 'place', 'poleAway', 'grip']) assert.ok(Math.abs(p.hand[f] - prev.hand[f]) < 0.05, `hand.${f} at ${t}`);
    assert.ok(Math.abs(p.pole.h - prev.pole.h) < 0.01 && Math.abs(p.pole.tele - prev.pole.tele) < 0.01 && Math.abs(p.pole.rod - prev.pole.rod) < 0.01 && Math.abs(p.flag.unfurl - prev.flag.unfurl) < 0.01);
    prev = p;
  }
  for (const e of FH_EVENTS) { // and tight around every event time
    const a = firstHumansPose(e.t - 1e-6), b = firstHumansPose(e.t + 1e-6);
    for (const f of FIELDS) assert.ok(Math.abs(a[f] - b[f]) < 1e-3, `${f} at event ${e.name}`);
  }
});

test('events fire exactly once when stepped at any frame rate', () => {
  for (const step of [1 / 144, 1 / 60, 1 / 20, 0.5]) {
    const seen = [];
    let t = 0;
    while (t < FH_TOTAL + 1) { seen.push(...firstHumansEvents(t, Math.min(FH_TOTAL, t + step))); t += step; }
    assert.deepEqual(seen.slice().sort(), FH_EVENTS.map((e) => e.name).sort());
  }
});

test('starts at the hatch, ends faded to black, flag planted and quiet caption gap', () => {
  const a = firstHumansPose(0), z = firstHumansPose(FH_TOTAL);
  assert.ok(a.dy > 0.8 && a.fade === 0 && a.caption === '');
  assert.equal(z.fade, 1); assert.ok(z.done);
  assert.ok(z.flag.unfurl === 1 && z.rock === 'gone');
  assert.ok(Math.abs(firstHumansPose(3.0).dy) < 0.1); // boots on the ground
  assert.equal(firstHumansPose(3.3).caption, 'Jezero Crater, Mars · Sol 1');
  assert.equal(firstHumansPose(29.5).caption, ''); assert.equal(firstHumansPose(30.9).caption, '');
  assert.equal(firstHumansPose(32).caption, 'Time to go home.');
  assert.equal(FH_CAPTIONS.length, 4);
});

test('draw-from-backpack events fire once and in order, before the plant', () => {
  const order = FH_EVENTS.map((e) => e.name);
  const seq = ['grab', 'rockStow', 'flagGrab', 'poleExtend', 'unfurl', 'plant', 'done'];
  const idx = seq.map((n) => { assert.equal(order.filter((x) => x === n).length, 1, n); return order.indexOf(n); });
  assert.deepEqual(idx.slice().sort((a, b) => a - b), idx);
  assert.ok(FH_TOTAL <= 31 + 3.01);
});

test('flag is stowed, then drawn, extended and unfurled to full size before the plant; the cloth is never scaled', () => {
  const ev = Object.fromEntries(FH_EVENTS.map((e) => [e.name, e.t]));
  const at = (t) => firstHumansPose(t);
  assert.ok(!at(ev.flagGrab - 0.01).pole.visible && at(ev.flagGrab + 0.01).pole.visible);
  assert.equal(at(ev.flagGrab).pole.tele, 0); assert.equal(at(ev.flagGrab).flag.unfurl, 0);
  assert.ok(at(ev.flagGrab).shoulder > 0.99 && at(ev.poleExtend).shoulder === 0); // looks over the shoulder, back to forward
  assert.ok(Math.abs(at(ev.flagGrab).yaw - at(ev.flagGrab - 0.8).yaw) > 0.3);
  const e = at(ev.unfurl + 1.2);
  assert.ok(e.pole.tele === 1 && e.pole.rod === 1 && e.flag.unfurl === 1);
  assert.ok(at(ev.plant).pole.h < 0.01 + 0 && at(ev.plant).flag.unfurl === 1);
  assert.ok(at(ev.poleExtend - 0.01).hand.place === 0 && at(ev.plant - 1.9).hand.place === 1);
  // static check of the scene source: the flag cloth is animated by vertices only
  const src = readFileSync(new URL('../firstHumans.js', import.meta.url), 'utf8');
  assert.ok(!/cloth\.scale|flag\.cloth\.scale/.test(src));
});
