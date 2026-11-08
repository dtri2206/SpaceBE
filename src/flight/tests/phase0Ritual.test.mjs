import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhase0Ritual } from '../phase0Ritual.js';

function rig({ attempt = 1, data, warnings = [], site = {}, allowScrub = false, pendingFade = false, funds = true, o2Sound = false } = {}) {
  let time = 0, resolve, resolveFade, count = 0, stopCount = 0, scrubCount = 0;
  const handlers = new Map(), calls = [], panel = { root: { dataset: {} } };
  for (const name of ['setChecklist', 'setFact', 'setKeys', 'setSkip', 'setCaption', 'setPoll', 'showAsk', 'answer', 'finish', 'dispose']) panel[name] = (...args) => calls.push([name, ...args]);
  const camera = {}, buttons = [];
  site = site && { camera, rocketBase: { x: 0, y: 3, z: 0 }, eyeY: 14, cockpit: { userData: { setButton: (...args) => buttons.push(args), press: (id) => buttons.push(['press', id]) } }, ...site };
  const input = { onPress(key, fn) { handlers.set(key, fn); return () => handlers.delete(key); } };
  const sounds = [], stoppedSounds = [], fades = [], spent = [];
  const ritual = createPhase0Ritual({
    parent: null, hud: null, input,
    audio: { ids: () => ['ui.click', 'gonogo.tick', ...(o2Sound ? ['suit.o2flow'] : [])], play: (id) => sounds.push(id), stop: (id) => stoppedSounds.push(id) },
    graphics: { fade: (opts) => { fades.push(opts); if (pendingFade && opts.to === 1) return new Promise((r) => { resolveFade = r; }); } },
    cinematic: { play: () => new Promise((r) => { resolve = r; }), stop: () => { stopCount++; resolve?.(); } },
    contract: { TRANSITIONS: { LAUNCH: allowScrub ? ['ORBIT', 'HANGAR'] : ['ORBIT'] } },
    economy: { balance: { scrubFee: 123 }, canAfford: () => funds, spend: (...args) => spent.push(args) },
    ship: { warnings, launch: { tempC: 2 } }, attempt, data, getSite: () => site,
    setBoardingView: () => {}, onCountdown: () => count++, onScrub: () => scrubCount++,
    now: () => time, createPanel: () => panel,
  });
  return { ritual, calls, buttons, sounds, stoppedSounds, fades, spent, get count() { return count; }, get stops() { return stopCount; }, get scrubs() { return scrubCount; },
    press: (key) => handlers.get(key)?.(), advance(seconds) { time += seconds; ritual.update(); }, resolve: () => resolve?.(), resolveFade: () => resolveFade?.(), handlers };
}

async function toChecklist(r) { r.advance(0); r.press('Enter'); await Promise.resolve(); r.advance(3.81); assert.equal(r.ritual.stage, 'checklist'); }

test('full ritual: boarding skip, ordered controls, station timing, crew GO, one countdown', async () => {
  const r = rig();
  r.advance(0); assert.equal(r.ritual.stage, 'boarding');
  r.press('Enter'); await Promise.resolve(); assert.equal(r.ritual.stage, 'seat'); assert.equal(r.stops, 1);
  r.advance(3.81); r.press('Digit3'); assert.equal(r.ritual.stage, 'checklist');
  r.press('Digit1'); r.press('Digit2'); r.press('Digit3'); r.press('Digit4');
  assert.equal(r.ritual.stage, 'poll'); assert.ok(r.buttons.some(([id, state]) => id === 'btn:arm' && state === 'red'));
  assert.ok(r.sounds.includes('ui.click')); r.advance(.8); assert.equal(r.sounds.filter((id) => id === 'gonogo.tick').length, 1);
  r.press('Enter'); assert.equal(r.count, 0); r.advance(6); assert.equal(r.ritual.stage, 'ask');
  assert.equal(r.ritual.objective, 'Give the GO'); r.press('KeyS'); assert.equal(r.scrubs, 0);
  r.press('Enter'); assert.equal(r.ritual.stage, 'cleared'); r.advance(1.59); assert.equal(r.count, 0);
  r.advance(.02); assert.equal(r.count, 1); r.advance(99); r.press('Enter'); assert.equal(r.count, 1);
  r.ritual.dispose(); assert.equal(r.handlers.size, 0);
});

test('quick path keeps cold and thermal NO-GOs for two wall seconds', () => {
  const r = rig({ data: { quickStart: true }, warnings: ['COLD_SEALS', 'NO_HEAT_SHIELD'] });
  const lines = r.calls.find(([name]) => name === 'setPoll')[1];
  assert.equal(lines.length, 2); assert.ok(lines.some((line) => line.reason.includes('2 °C'))); assert.ok(lines.some((line) => line.station === 'Thermal'));
  r.advance(1.99); r.press('Enter'); assert.equal(r.count, 0); r.advance(.02); assert.equal(r.count, 1);
});

test('second launch offers Enter skip and cancels its cinematic callback', async () => {
  const r = rig({ attempt: 2 }); r.advance(0); r.press('Enter'); await Promise.resolve();
  assert.equal(r.ritual.stage, 'quick'); assert.equal(r.stops, 1); r.advance(2.01); assert.equal(r.count, 1);
});

test('leaving during boarding cancels cinematic and stale resolution changes nothing', async () => {
  const r = rig(); r.advance(0); r.ritual.dispose(); const before = r.calls.length;
  r.resolve(); await Promise.resolve(); r.advance(30);
  assert.equal(r.calls.length, before); assert.equal(r.count, 0); assert.equal(r.stops, 1);
  assert.deepEqual(r.fades.at(-1), { to: 0, duration: 0 });
});

test('unavailable site falls back to seat and checklist within five seconds', () => {
  const r = rig({ site: null }); r.advance(5.01); assert.equal(r.ritual.stage, 'seat');
  r.advance(3.81); assert.equal(r.ritual.stage, 'checklist');
});

test('SCRUB is offered and charged only when permitted by contract', async () => {
  const r = rig({ allowScrub: true }); await toChecklist(r);
  for (let i = 1; i <= 4; i++) r.press(`Digit${i}`);
  r.advance(7); r.press('KeyS'); assert.deepEqual(r.spent, [[123, 'launch scrub']]); assert.equal(r.scrubs, 1);
});

test('pending seat fade never resumes after skip or exit', async () => {
  for (const action of ['skip', 'dispose']) {
    const r = rig({ pendingFade: true }); r.advance(0); r.press('Enter'); await Promise.resolve();
    assert.equal(r.ritual.stage, 'seat'); r.ritual[action](); const count = r.fades.length;
    r.resolveFade(); await Promise.resolve(); assert.equal(r.fades.length, count);
  }
});

test('insufficient funds cannot charge a fee or scrub', async () => {
  const r = rig({ allowScrub: true, funds: false }); await toChecklist(r);
  for (let i = 1; i <= 4; i++) r.press(`Digit${i}`);
  r.advance(7); r.press('KeyS'); assert.deepEqual(r.spent, []); assert.equal(r.scrubs, 0);
});

test('Phase0 owns only its O2 loop and stops it on finish, quick skip or state exit', async () => {
  for (const action of ['finish', 'skip', 'dispose']) {
    const r = rig({ o2Sound: true }); await toChecklist(r);
    r.press('Digit1'); r.press('Digit2'); r.press('Digit3');
    assert.ok(r.sounds.includes('suit.o2flow'));
    assert.deepEqual(r.stoppedSounds, []);
    if (action === 'finish') { r.press('Digit4'); r.advance(7); r.press('Enter'); r.advance(1.61); }
    else r.ritual[action]();
    assert.deepEqual(r.stoppedSounds, ['suit.o2flow']);
    r.ritual.dispose(); assert.deepEqual(r.stoppedSounds, ['suit.o2flow']);
  }
  const fallback = rig(); await toChecklist(fallback);
  fallback.press('Digit1'); fallback.press('Digit2'); fallback.press('Digit3'); fallback.ritual.dispose();
  assert.deepEqual(fallback.stoppedSounds, [], 'ui.click fallback never claims ownership of another loop');
});
