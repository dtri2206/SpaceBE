import assert from 'node:assert/strict';
import { BEAT, BEATS, TIMING, autoNext, createDirector, createHoldTrigger, landingExit } from '../demo/director.js';

// hold-to-trigger: needs all three keys for 1 s, fires once, re-arms on release
{
  const hold = createHoldTrigger();
  const all = () => true;
  const two = (code) => code !== 'Digit7';
  assert.deepEqual(hold.update(all, 0), { progress: 0, fired: false });
  assert.equal(hold.update(all, 500).progress, 0.5);
  assert.equal(hold.update(all, 999).fired, false);
  assert.equal(hold.update(all, 1000).fired, true);
  assert.equal(hold.update(all, 1500).fired, false); // once per hold
  hold.update(two, 1600); // a key released: re-arm
  assert.equal(hold.update(all, 1700).fired, false);
  assert.equal(hold.update(all, 2700).fired, true);
  hold.update(all, 3000);
  hold.update(two, 3200); // released early: restarts
  assert.equal(hold.update(all, 3300).progress, 0);
  assert.equal(hold.update(all, 3800).progress, 0.5);
}

// beat order and automatic advance
{
  const entered = [];
  const d = createDirector({ onEnter: (b, via) => entered.push([b, via]) });
  assert.equal(d.next(), null); // not running: N does nothing
  d.start();
  assert.deepEqual(entered, [[0, 'start']]);
  assert.equal(d.update(4.9, { state: 'HANGAR' }), null);
  assert.equal(d.update(0.2, { state: 'HANGAR' }), BEAT.hangar); // title is 5 s
  assert.equal(d.update(1, { state: 'GONOGO' }), null);
  assert.equal(d.update(1, { state: 'LAUNCH', flight: { phase0Active: true } }), null);
  assert.equal(d.update(1, { state: 'LAUNCH', flight: { phase0Active: false } }), BEAT.launch);
  assert.equal(d.update(1, { state: 'ORBIT' }), BEAT.debris);
  // debris: waits for the window to close, then a pause
  assert.equal(d.update(1, { state: 'ORBIT', flight: { debrisPlaced: true, debrisBusy: true } }), null);
  assert.equal(d.update(TIMING.debrisIdle - 0.1, { state: 'ORBIT', flight: { debrisPlaced: true, debrisBusy: false } }), null);
  assert.equal(d.update(0.2, { state: 'ORBIT', flight: { debrisPlaced: true, debrisBusy: false } }), BEAT.cruise);
  assert.equal(d.update(TIMING.cruiseCard + 0.1, { state: 'ENTRY' }), BEAT.entry);
  assert.equal(d.update(1, { state: 'LANDING' }), null);
  assert.equal(d.update(1, { state: 'SURFACE' }), BEAT.firstHumans);
  assert.equal(d.update(1, { state: 'SURFACE' }), null);
  assert.equal(d.update(1, { state: 'SURFACE', firstHumansDone: true }), BEAT.return);
  assert.equal(d.update(1, { state: 'RETURN', returnPhase: 'descent' }), BEAT.earthLanding);
  assert.equal(d.update(1, { state: 'RETURN', returnPhase: 'scroll' }), BEAT.scroll);
  assert.equal(d.next(), null); // the last beat stays
  assert.deepEqual(entered.map(([b]) => b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

// debris failsafe: the beat cannot hang when the window never opens
{
  const d = createDirector();
  d.start();
  d.next(); d.next(); d.next();
  assert.equal(d.beat, BEAT.debris);
  assert.equal(d.update(TIMING.debrisFailsafe + 1, { state: 'ORBIT', flight: { debrisPlaced: false } }), BEAT.cruise);
}

// N skips one beat at a time, from any beat, whatever the game state
{
  const entered = [];
  const d = createDirector({ onEnter: (b, via) => entered.push([b, via]) });
  d.start();
  for (let i = 1; i < BEATS.length; i += 1) assert.equal(d.next(), i);
  assert.equal(d.next(), null);
  assert.ok(entered.slice(1).every(([, via]) => via === 'skip'));
}

// restart: start() again goes back to beat 0 with fresh timers
{
  const d = createDirector();
  d.start();
  d.next(); d.next();
  d.update(10, { state: 'LAUNCH' });
  d.start();
  assert.equal(d.beat, 0);
  assert.equal(d.update(4.9, {}), null); // title timer restarted
  assert.equal(d.update(0.2, {}), BEAT.hangar);
  d.stop();
  assert.equal(d.active, false);
  assert.equal(d.next(), null);
}

// walking out after touchdown
{
  assert.equal(landingExit({ state: 'LANDING', landedFor: 1 }), null);
  assert.equal(landingExit({ state: 'LANDING', landedFor: TIMING.landedWait }), 'INTERIOR');
  assert.equal(landingExit({ state: 'INTERIOR', stateTime: 0.5 }), null);
  assert.equal(landingExit({ state: 'INTERIOR', stateTime: TIMING.interiorWait }), 'SURFACE');
  assert.equal(landingExit({ state: 'ENTRY', landedFor: 99 }), null);
}

assert.equal(autoNext(BEAT.scroll, { state: 'ENDING' }, { beatTime: 99, debrisIdle: 0 }), null);
console.log('director tests passed');
