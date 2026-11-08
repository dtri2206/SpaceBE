// Run: node src/flight/tests/demo-inert.test.mjs
// Without C+R+7 the pitch demo must leave the game exactly as it was: no frame wrapper, no extra warnings, no timer in
// Node, the GO/NO-GO poll and the flight unchanged.
import assert from 'node:assert/strict';
import { createFrameDriver, startPolling, withDemoWarnings, MAX_DT } from '../demo/driver.js';
import { createHoldTrigger, HOLD_CODES } from '../demo/director.js';
import { buildPoll } from '../phase0.js';
import { FlightController } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import { MOCK_SHIPS } from '../presets.js';

// ---- the frame driver: idle = core's graphics.render is untouched ----
class FakeGraphics { constructor() { this.rendered = []; } render(dt) { this.rendered.push(dt); } }
{
  const g = new FakeGraphics();
  const ticks = [];
  let want = false;
  const d = createFrameDriver({ target: () => g, tick: (dt) => ticks.push(dt), wanted: () => want });
  for (let i = 0; i < 20; i += 1) { d.poll(); g.render(1 / 60); }
  assert.equal(d.attached, false, 'idle: never attached');
  assert.equal(Object.prototype.hasOwnProperty.call(g, 'render'), false, 'idle: render is the class method');
  assert.equal(g.render, FakeGraphics.prototype.render);
  assert.equal(ticks.length, 0, 'idle: the demo never ticks');
  assert.equal(g.rendered.length, 20, 'idle: every frame rendered');

  // triggered: ticks before each render with core's dt (clamped), then takes itself off
  want = true;
  d.poll();
  assert.equal(d.attached, true);
  g.render(0.016); g.render(5);
  assert.deepEqual(ticks, [0.016, MAX_DT], 'tick gets dt, clamped like core');
  assert.deepEqual(g.rendered.slice(-2), [0.016, 5], 'render still gets core\'s own dt');
  want = false;
  g.render(0.02); // last tick (hides the ring), then detaches
  assert.equal(ticks.length, 3);
  assert.equal(d.attached, false, 'detached when no longer wanted');
  assert.equal(Object.prototype.hasOwnProperty.call(g, 'render'), false, 'detached: the object is as it was');
  g.render(0.02);
  assert.equal(ticks.length, 3, 'no tick after detach');

  // a throwing tick never stops the frame
  const errs = [];
  const d2 = createFrameDriver({ target: g, tick: () => { throw new Error('x'); }, wanted: () => true, onError: (e) => errs.push(e) });
  d2.attach(); const before = g.rendered.length; g.render(0.01);
  assert.equal(g.rendered.length, before + 1); assert.equal(errs.length, 1);
  d2.detach();
  assert.equal(Object.prototype.hasOwnProperty.call(g, 'render'), false);
}

// ---- no timer outside a browser page (Node, tests), and only one per page ----
{
  const calls = [];
  assert.equal(startPolling({ poll() {} }, { env: { setInterval: (...a) => calls.push(a) } }), false, 'no window/document: no timer');
  const env = { window: {}, document: {}, setInterval: (...a) => calls.push(a) };
  assert.equal(startPolling({ poll() {} }, { env }), true);
  assert.equal(startPolling({ poll() {} }, { env }), false, 'second start ignored');
  assert.equal(calls.length, 1);
}

// ---- the trigger only fires on all three keys held for HOLD_MS ----
{
  const t = createHoldTrigger({ holdMs: 1000 });
  const down = new Set(['KeyC', 'KeyR']); // two of three: never
  for (let ms = 0; ms <= 3000; ms += 100) assert.equal(t.update((c) => down.has(c), ms).fired, false);
  assert.deepEqual([...HOLD_CODES], ['KeyC', 'KeyR', 'Digit7']);
}

// ---- warnings: CHUTE_UNTESTED only for the demo ship, once ----
{
  const ship = MOCK_SHIPS.reliable;
  assert.ok(!ship.warnings.includes('CHUTE_UNTESTED'));
  const demoShip = withDemoWarnings(ship);
  assert.deepEqual(demoShip.warnings, [...ship.warnings, 'CHUTE_UNTESTED']);
  assert.equal(withDemoWarnings(demoShip), demoShip, 'no duplicate');
  assert.ok(!ship.warnings.includes('CHUTE_UNTESTED'), 'original spec not mutated');

  // the launch ritual's poll is unchanged for a normal ship, and says the demo line for the demo ship
  const normal = buildPoll(ship);
  assert.ok(normal.every((l) => !/parachute/.test(l.text)));
  const demo = buildPoll(demoShip);
  const rec = demo.find((l) => l.station === 'Recovery');
  assert.ok(rec && !rec.go && rec.text === 'Recovery… NO-GO: parachute not proven', JSON.stringify(rec));
  const both = buildPoll({ ...demoShip, warnings: [...demoShip.warnings, 'NO_LEGS'] });
  assert.equal(both.filter((l) => l.station === 'Recovery').length, 1, 'one Recovery station for NO_LEGS + CHUTE_UNTESTED');
}

// ---- the flight: demoSafe is off unless the demo sets it ----
{
  const fc = new FlightController({ bus: { emit() {} }, g0: G0, planets: PLANETS, shipSpec: MOCK_SHIPS.reliable, start: { altitude: 0, speed: 0 } });
  assert.equal(fc.demoSafe, false);
  assert.equal(globalThis.__demo, undefined, 'nothing sets window.__demo without the trigger');
}

console.log('demo-inert ok');
