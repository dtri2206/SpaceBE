// Node tests for walking, oxygen, interactables and the cabin. Run: node src/surface/tests/surface.test.mjs
import assert from 'node:assert/strict';
import { WalkController, WALK_TUNING } from '../WalkController.js';
import { createOxygen, levelFor } from '../oxygen.js';
import { createInteractables } from '../interactables.js';
import { createShipInterior, CABIN, AIRLOCK_CYCLE_SECONDS } from '../shipInterior.js';
import { PLANETS } from '../../core/planets.js';
const gE = PLANETS.earth.g, gM = PLANETS.mars.g;

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const mkBus = () => { const log = []; return { log, emit: (n, p) => log.push([n, p]), names: () => log.map(([n]) => n) }; };
const step = (w, s, input = {}, dt = 1 / 120) => { for (let t = 0; t < s; t += dt) w.update(dt, input); };

function jump(gravity) {
  const w = new WalkController({ gravity });
  w.update(1 / 120, { jump: true });
  let apex = 0, air = 0;
  while (!w.onGround && air < 10) { w.update(1 / 240, {}); apex = Math.max(apex, w.pos.y); air += 1 / 240; }
  return { apex, air };
}

test('Mars jump goes ~2.64× higher and lasts ~2.64× longer than on Earth (same legs)', () => {
  const e = jump(gE), m = jump(gM);
  const ratio = gE / gM;
  assert.ok(Math.abs(m.apex / e.apex - ratio) < 0.05, `height ratio ${(m.apex / e.apex).toFixed(2)}`);
  assert.ok(Math.abs(m.air / e.air - ratio) < 0.05, `airtime ratio ${(m.air / e.air).toFixed(2)}`);
  assert.ok(Math.abs(e.apex - 0.45) < 0.02, `earth jump ${e.apex.toFixed(2)} m`);
});

test('grip = μ·g: you need longer to reach walking speed on Mars (mass same, weight lower)', () => {
  const time = (g) => { const w = new WalkController({ gravity: g }); let t = 0; while (w.telemetry.speed < WALK_TUNING.walkSpeed.suit * 0.99 && t < 5) { w.update(1 / 120, { forward: 1 }); t += 1 / 120; } return t; };
  const te = time(gE), tm = time(gM);
  assert.ok(tm > te * 2, `earth ${te.toFixed(2)} s, mars ${tm.toFixed(2)} s`);
});

test('walking forward with yaw 0 moves toward −z; cabin walls stop you', () => {
  const w = new WalkController({ gravity: gM, bounds: CABIN.bounds, mode: 'cabin', start: { x: 0, z: 0 } });
  step(w, 10, { forward: 1 });
  assert.ok(Math.abs(w.pos.z - (CABIN.bounds.minZ + WALK_TUNING.radius)) < 1e-6, `z=${w.pos.z}`);
});

test('fall damage uses impact speed: a 4 m drop hurts on Earth but not on Mars', () => {
  const drop = (g) => {
    const notes = [];
    let ground = 4;
    const w = new WalkController({ onNotice: (type) => notes.push(type), gravity: g, getGroundHeight: () => ground });
    ground = 0; // the ledge disappears under you
    step(w, 5, {});
    return notes.includes('fall');
  };
  assert.equal(drop(gE), true);
  assert.equal(drop(gM), false);
});

test('oxygen: drains outside only, cautions at 30/15/5 %, running drains faster, 0 % = out_of_breath', () => {
  const bus = mkBus();
  const o2 = createOxygen({ bus, tankSeconds: 100, spareTanks: 1 });
  o2.update(50, { inside: true });
  assert.equal(o2.percent, 100);
  o2.update(10, { running: true });
  assert.ok(Math.abs(o2.percent - 84) < 1e-9);
  assert.equal(levelFor(29), 'caution'); assert.equal(levelFor(14), 'warning'); assert.equal(levelFor(4), 'critical'); assert.equal(levelFor(30), 'ok');
  for (let i = 0; i < 100; i++) o2.update(1, {});
  const levels = bus.log.filter(([n]) => n === 'eva:oxygen').map(([, p]) => p.level);
  for (const l of ['caution', 'warning', 'critical']) assert.ok(levels.includes(l), l);
  assert.ok(bus.log.some(([n, p]) => n === 'flight:failed' && p.endingId === 'outOfBreath'));
});

test('oxygen: swapping uses a spare tank, fails when none left', () => {
  const o2 = createOxygen({ tankSeconds: 100, spareTanks: 1 });
  o2.update(80, {});
  assert.equal(o2.swapTank(), true);
  assert.equal(o2.percent, 100);
  assert.equal(o2.swapTank(), false);
});

test('interactables: must be near AND looking at it; hold items need the full hold time', () => {
  const ia = createInteractables();
  let used = 0;
  ia.register({ id: 'scan', position: { x: 0, y: 1.6, z: -1.5 }, hold: 2, onUse: () => used++, prompt: 'Hold E' });
  const eye = { x: 0, y: 1.6, z: 0 };
  assert.equal(ia.update(0.1, eye, { x: 0, y: 0, z: 1 }).focused, null); // looking away
  let ui = ia.update(0.1, eye, { x: 0, y: 0, z: -1 }, true);
  assert.equal(ui.focused.id, 'scan');
  for (let i = 0; i < 25; i++) ui = ia.update(0.1, eye, { x: 0, y: 0, z: -1 }, true);
  assert.equal(used, 1);
  assert.equal(ia.update(0.1, { x: 0, y: 1.6, z: 5 }, { x: 0, y: 0, z: -1 }).focused, null); // too far
});

test('cabin: airlock needs the suit, cycles for 3 s, then onExit; seat calls onSeat only without the suit', () => {
  const bus = mkBus();
  const ia = createInteractables();
  const o2 = createOxygen({ bus, spareTanks: 2 });
  let exits = 0, seats = 0;
  const cabin = createShipInterior({ bus, interactables: ia, oxygen: o2, prebreatheSeconds: 0, onExit: () => exits++, onSeat: () => seats++ });
  const lookAt = (pos) => {
    const eye = { x: pos.x * 0.6, y: pos.y, z: Math.abs(pos.x) > 1 ? pos.z : pos.z - Math.sign(pos.z) * 0.8 };
    const d = { x: pos.x - eye.x, y: 0, z: pos.z - eye.z };
    const l = Math.hypot(d.x, d.z);
    return [eye, { x: d.x / l, y: 0, z: d.z / l }];
  };
  const useAt = (pos) => { const [eye, dir] = lookAt(pos); ia.press(); return ia.update(0.016, eye, dir); };
  const S = CABIN.stations;
  useAt(S.airlock); cabin.update(5);
  assert.equal(exits, 0, 'no exit without the suit');
  useAt(S.suitLocker);
  assert.equal(cabin.suited, true);
  useAt(S.airlock);
  cabin.update(AIRLOCK_CYCLE_SECONDS / 2);
  assert.ok(cabin.airlockProgress > 0.4 && cabin.airlockProgress < 0.6);
  cabin.update(AIRLOCK_CYCLE_SECONDS);
  assert.equal(exits, 1);
  o2.update(100, {});
  useAt(S.o2Station);
  assert.equal(o2.percent, 100); assert.equal(o2.spareTanks, 1);
  useAt(S.pilotSeat);
  assert.equal(seats, 0, 'suited: cannot sit and fly');
  cabin.suited = false;
  useAt(S.pilotSeat);
  assert.equal(seats, 1);
  const ids = bus.log.filter(([n]) => n === 'interior:interact').map(([, p]) => p.stationId);
  for (const id of ids) assert.ok(['pilotSeat', 'o2Station', 'suitLocker', 'commsConsole', 'sampleStorage', 'airlock', 'bunk'].includes(id), id);
});

test('cabin uses Role 3 station positions (userData.stations names) when given', () => {
  const ia = createInteractables();
  const role3 = { pilotSeat: { x: 0, y: 1.2, z: -3.3 }, suitLocker: { x: -1.7, y: 1.2, z: 0.7 }, o2Station: { x: -1.72, y: 1.2, z: -1.1 },
    commsConsole: { x: 1.7, y: 1.2, z: -1.3 }, sampleStorage: { x: 1.72, y: 1.2, z: 0.9 }, airlock: { x: 0, y: 1.2, z: 3.86 }, bunk: { x: -1.55, y: 1.2, z: -2.75 } };
  const cabin = createShipInterior({ interactables: ia, stations: role3, props: { familyPhoto: { x: -1, y: 1.2, z: -3 } } });
  assert.deepEqual(cabin.stations.airlock, { x: 0, y: 1.2, z: 3.86 });
  assert.ok(ia.get('bunk') && ia.get('prop:familyPhoto') && ia.get('pilotSeat'));
});

test('colliders: you cannot walk through the lander', () => {
  const w = new WalkController({ gravity: gM, colliders: [{ x: 0, z: -5, r: 3 }], start: { x: 0, z: 0 } });
  step(w, 10, { forward: 1 });
  assert.ok(w.pos.z > -5 + 3 + WALK_TUNING.radius - 1e-6 - 0.001 || Math.hypot(w.pos.x, w.pos.z + 5) >= 3.3 - 1e-6, `pos ${w.pos.x},${w.pos.z}`);
});

test('suit breach: a leak drains O₂ faster until the suit is serviced at the O₂ station', () => {
  const o2 = createOxygen({ tankSeconds: 100, spareTanks: 1 });
  o2.setLeak(3);
  assert.equal(o2.leaking, true);
  o2.update(10, {});
  assert.ok(Math.abs(o2.percent - 70) < 1e-9, `${o2.percent}`);
  o2.swapTank();
  assert.equal(o2.leaking, false);
  o2.update(10, {});
  assert.ok(Math.abs(o2.percent - 90) < 1e-9);
});

let fails = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? '  ✓' : '  ✗'} ${name}`); if (e) { fails++; console.log('     ', e.message); } }
console.log(`\n${results.length - fails}/${results.length} surface tests passed`);
process.exit(fails ? 1 : 0);
