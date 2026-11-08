import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhase0Ritual } from '../phase0Ritual.js';

function rig({ attempt = 1, data, warnings = [], site = {}, allowScrub = false, pendingFade = false, funds = true, o2Sound = false, reach, hasButton } = {}) {
  let time = 0, resolve, resolveFade, countdownInfo, count = 0, stopCount = 0, scrubCount = 0;
  const handlers = new Map(), calls = [], panel = { root: { dataset: {} } };
  for (const name of ['setChecklist', 'setFact', 'setKeys', 'setSkip', 'setCaption', 'setPoll', 'showAsk', 'answer', 'finish', 'dispose', 'setReticle', 'setChoice', 'setCaution', 'setProgress']) panel[name] = (...args) => calls.push([name, ...args]);
  const camera = {}, buttons = [];
  site = site && { camera, rocketBase: { x: 0, y: 3, z: 0 }, eyeY: 14, cockpit: { userData: { ...(reach && { reach: (id) => { buttons.push(['reach', id]); return reach; } }), setButton: (...args) => buttons.push(args), press: (id) => buttons.push(['press', id]) } }, ...site };
  const input = { onPress(key, fn) { handlers.set(key, fn); return () => handlers.delete(key); } };
  const sounds = [], stoppedSounds = [], fades = [], spent = [];
  const ritual = createPhase0Ritual({
    parent: null, hud: null, input,
    audio: { ids: () => ['ui.click', 'gonogo.tick', ...(o2Sound ? ['suit.o2flow'] : [])], play: (id) => sounds.push(id), stop: (id) => stoppedSounds.push(id) },
    graphics: { fade: (opts) => { fades.push(opts); if (pendingFade && opts.to === 1) return new Promise((r) => { resolveFade = r; }); } },
    cinematic: { play: () => new Promise((r) => { resolve = r; }), stop: () => { stopCount++; resolve?.(); } },
    contract: { TRANSITIONS: { LAUNCH: allowScrub ? ['ORBIT', 'HANGAR'] : ['ORBIT'] } },
    economy: { balance: { scrubFee: 123 }, canAfford: () => funds, spend: (...args) => spent.push(args) },
    ship: { warnings, launch: { tempC: 2 } }, attempt, data, hasButton, getSite: () => site,
    setBoardingView: () => {}, onCountdown: (info) => { count++; countdownInfo = info; }, onScrub: () => scrubCount++,
    now: () => time, createPanel: () => panel,
  });
  return { ritual, calls, buttons, sounds, stoppedSounds, fades, spent, get count() { return count; }, get countdownInfo() { return countdownInfo; }, get stops() { return stopCount; }, get scrubs() { return scrubCount; },
    press: (key) => handlers.get(key)?.(), advance(seconds) { time += seconds; ritual.update(); }, resolve: () => resolve?.(), resolveFade: () => resolveFade?.(), handlers };
}

// the CABIN item opens a choice: option 1 = air mix (fills in ~6 wall seconds), option 2 = pure oxygen (~1.5)
const chooseCabin = (r, key = 'Digit1', wait = 6.01) => { r.press(key); r.advance(wait); };
const allFour = (r) => { r.press('Digit1'); r.press('Digit2'); chooseCabin(r); r.press('Digit3'); r.press('Digit4'); };

async function toChecklist(r) { r.advance(0); r.press('Enter'); await Promise.resolve(); r.advance(3.81); assert.equal(r.ritual.stage, 'checklist'); }

test('full ritual: boarding skip, ordered controls, station timing, crew GO, one countdown', async () => {
  const r = rig();
  r.advance(0); assert.equal(r.ritual.stage, 'boarding');
  r.press('Enter'); await Promise.resolve(); assert.equal(r.ritual.stage, 'seat'); assert.equal(r.stops, 1);
  r.advance(3.81); r.press('Digit3'); assert.equal(r.ritual.stage, 'checklist');
  allFour(r);
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
  allFour(r);
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
  allFour(r);
  r.advance(7); r.press('KeyS'); assert.deepEqual(r.spent, []); assert.equal(r.scrubs, 0);
});

test('Phase0 owns only its O2 loop and stops it on finish, quick skip or state exit', async () => {
  for (const action of ['finish', 'skip', 'dispose']) {
    const r = rig({ o2Sound: true }); await toChecklist(r);
    r.press('Digit1'); r.press('Digit2'); chooseCabin(r); r.press('Digit3');
    assert.ok(r.sounds.includes('suit.o2flow'));
    assert.deepEqual(r.stoppedSounds, []);
    if (action === 'finish') { r.press('Digit4'); r.advance(7); r.press('Enter'); r.advance(1.61); }
    else r.ritual[action]();
    assert.deepEqual(r.stoppedSounds, ['suit.o2flow']);
    r.ritual.dispose(); assert.deepEqual(r.stoppedSounds, ['suit.o2flow']);
  }
  const fallback = rig(); await toChecklist(fallback);
  fallback.press('Digit1'); fallback.press('Digit2'); chooseCabin(fallback); fallback.press('Digit3'); fallback.ritual.dispose();
  assert.deepEqual(fallback.stoppedSounds, [], 'ui.click fallback never claims ownership of another loop');
});

test('aim and click: next button works, wrong order errors, elsewhere does nothing', async () => {
  const r = rig({ o2Sound: false }); await toChecklist(r);
  const reticle = () => r.calls.filter(([n]) => n === 'setReticle').at(-1)[1];
  r.ritual.setAim('cabin'); assert.deepEqual(reticle(), { tone: 'warn', label: 'CABIN · close the hatch first' });
  r.press('Mouse0'); assert.equal(r.ritual.nextButton, 'hatch'); assert.ok(r.sounds.includes('ui.click'));
  assert.ok(!r.buttons.some(([id]) => id === 'press'));
  r.ritual.setAim(null); r.press('Mouse0'); assert.equal(r.ritual.nextButton, 'hatch');
  r.ritual.setAim('hatch'); assert.equal(reticle().tone, 'ok'); r.press('Mouse0');
  assert.equal(r.ritual.nextButton, 'cabin'); assert.deepEqual(r.buttons.filter(([id]) => id === 'press'), [['press', 'btn:hatch']]);
  for (const id of ['cabin', 'o2', 'arm']) { r.ritual.setAim(id); assert.equal(r.ritual.click(), true); if (id === 'cabin') chooseCabin(r); }
  assert.equal(r.ritual.stage, 'poll'); assert.equal(r.ritual.nextButton, null);
});

test('aim and click: reach() delays the action and the cockpit presses itself', async () => {
  const r = rig({ reach: 0.5 }); await toChecklist(r);
  r.ritual.setAim('hatch'); const sounds = r.sounds.length; r.press('Mouse0');
  assert.deepEqual(r.buttons.filter(([id]) => id === 'reach'), [['reach', 'hatch']]);
  assert.equal(r.sounds.length, sounds); r.press('Mouse0'); // a second click while the glove is moving is ignored
  r.advance(0.49); assert.equal(r.sounds.length, sounds);
  r.advance(0.02); assert.equal(r.sounds.length, sounds + 1);
  assert.ok(!r.buttons.some(([id]) => id === 'press')); assert.equal(r.ritual.nextButton, 'cabin');
});

test('aim and click: keys 1-4 still work, and a missing mesh is not clickable', async () => {
  const r = rig({ hasButton: (id) => id !== 'cabin' }); await toChecklist(r);
  r.press('Digit1'); assert.equal(r.ritual.nextButton, 'cabin');
  r.ritual.setAim('cabin'); assert.equal(r.ritual.click(), false); assert.equal(r.ritual.nextButton, 'cabin');
  const rows = r.calls.filter(([n]) => n === 'setChecklist').at(-1)[1];
  assert.deepEqual(rows.map((x) => x.fallback), [false, true, false, false]);
  r.press('Digit2'); assert.equal(r.ritual.nextButton, 'o2');
});

// ---- Apollo 1: the cabin choice, the wiring caution and the pad fire ----
const last = (r, name) => r.calls.filter(([n]) => n === name).at(-1)?.[1];
const toO2 = async (r, key) => { await toChecklist(r); r.press('Digit1'); r.press('Digit2'); chooseCabin(r, key, key === 'Digit2' ? 1.51 : 6.01); r.press('Digit3'); };
const finishPoll = (r) => { r.advance(8); assert.equal(r.ritual.stage, 'ask'); };

test('CABIN opens a two-option choice; keys 1/2 or a click pick it; air fills in ~6 s, pure in ~1.5 s', async () => {
  const r = rig(); await toChecklist(r); r.press('Digit1'); r.press('Digit2');
  assert.equal(r.ritual.stage, 'cabin');
  const choice = last(r, 'setChoice');
  assert.deepEqual(choice.options.map((o) => o.label), ['Air mix (N₂/O₂), 20 s to fill', 'Pure oxygen, fills in 5 s (saves time)']);
  r.press('Digit3'); assert.equal(r.ritual.stage, 'cabin', 'O2 cannot be opened before the cabin is filled');
  choice.options[0].onPick(); assert.equal(r.ritual.stage, 'fill'); // a click on the option
  r.advance(5.9); assert.equal(r.ritual.stage, 'fill'); r.advance(0.2); assert.equal(r.ritual.stage, 'checklist');
  assert.deepEqual(r.ritual.cabin, { atmosphere: 'air', purged: false, caution: false, fireRisk: false });
  const pure = rig(); await toChecklist(pure); pure.press('Digit1'); pure.press('Digit2'); pure.press('Digit2');
  pure.advance(1.4); assert.equal(pure.ritual.stage, 'fill'); pure.advance(0.2); assert.equal(pure.ritual.stage, 'checklist');
  assert.equal(pure.ritual.cabin.atmosphere, 'pure');
});

test('the wiring caution appears only with pure oxygen, after O2 and before ARM ENGINE', async () => {
  const air = rig(); await toO2(air, 'Digit1');
  assert.equal(air.calls.filter(([n]) => n === 'setCaution').some(([, c]) => c), false);
  const pure = rig(); await toChecklist(pure); pure.press('Digit1'); pure.press('Digit2'); chooseCabin(pure, 'Digit2', 1.6);
  assert.equal(pure.ritual.cabin.caution, false, 'not before O2');
  pure.press('Digit3');
  const lamp = last(pure, 'setCaution');
  assert.equal(lamp.text, 'CAUTION · WIRING · intermittent short under the left seat');
  assert.ok(lamp.button.startsWith('Vent and purge with air (costs 60 s)'));
  assert.equal(pure.ritual.cabin.caution, true); assert.equal(pure.ritual.stage, 'checklist'); assert.equal(pure.ritual.nextButton, 'arm');
});

test('pure oxygen, caution carried on: poll has the ECLSS NO-GO, GO starts the pad-fire countdown', async () => {
  const r = rig(); await toO2(r, 'Digit2'); r.press('Digit4'); assert.equal(r.ritual.stage, 'poll');
  finishPoll(r);
  const lines = last(r, 'setPoll');
  const eclss = r.calls.filter(([n]) => n === 'setPoll').flatMap(([, l]) => l).find((p) => p.station === 'ECLSS');
  assert.ok(eclss && !eclss.go && eclss.reason === 'pure-oxygen cabin with a wiring fault'); assert.ok(lines.length >= 6);
  assert.equal(last(r, 'setCaution'), null);
  r.press('Enter'); r.advance(1.61);
  assert.equal(r.count, 1); assert.deepEqual(r.countdownInfo, { padFire: true });
});

test('purging (F or the button) costs ~6 wall seconds and removes the risk and the poll line', async () => {
  for (const how of ['key', 'click']) {
    const r = rig(); await toO2(r, 'Digit2');
    if (how === 'key') r.press('KeyF'); else last(r, 'setCaution').onPurge();
    assert.equal(r.ritual.stage, 'purge'); r.press('Digit4'); assert.equal(r.ritual.stage, 'purge', 'nothing else while purging');
    r.advance(5.9); assert.equal(r.ritual.stage, 'purge'); r.advance(0.2); assert.equal(r.ritual.stage, 'checklist');
    assert.deepEqual(r.ritual.cabin, { atmosphere: 'air', purged: true, caution: false, fireRisk: false });
    assert.equal(last(r, 'setCaution'), null);
    r.press('Digit4'); finishPoll(r);
    assert.ok(!r.calls.filter(([n]) => n === 'setPoll').flatMap(([, l]) => l).some((p) => p.station === 'ECLSS'));
    r.press('Enter'); r.advance(1.61); assert.deepEqual(r.countdownInfo, { padFire: false });
  }
});

test('air mix never carries the risk, and neither does the quick path', async () => {
  const r = rig(); await toO2(r, 'Digit1'); r.press('F'); r.press('KeyF'); r.press('Digit4'); finishPoll(r);
  r.press('Enter'); r.advance(1.61); assert.deepEqual(r.countdownInfo, { padFire: false });
  const q = rig({ attempt: 2 }); q.advance(0); q.press('Enter'); await Promise.resolve(); q.advance(2.01);
  assert.deepEqual(q.countdownInfo, { padFire: false }); assert.equal(q.ritual.cabin.fireRisk, false);
  const mid = rig({ attempt: 2, site: null }); mid.advance(5.01); mid.advance(3.81); assert.equal(mid.ritual.stage, 'checklist'); mid.press('Digit1'); mid.press('Digit2'); mid.press('Digit2'); mid.press('Enter');
  mid.advance(2.01); assert.deepEqual(mid.countdownInfo, { padFire: false });
});

test('Challenger path is unchanged: cold seals stay a NO-GO and the Weather line is still read', async () => {
  const r = rig({ warnings: ['COLD_SEALS'] }); await toChecklist(r); allFour(r); finishPoll(r);
  const lines = r.calls.filter(([n]) => n === 'setPoll').flatMap(([, l]) => l);
  assert.ok(lines.some((p) => p.station === 'Weather' && !p.go && p.reason.includes('2 °C')));
  assert.ok(!lines.some((p) => p.station === 'ECLSS'));
  r.press('Enter'); r.advance(1.61); assert.deepEqual(r.countdownInfo, { padFire: false });
});
