import assert from 'node:assert/strict';
import { RETURN_SCRIPT, chaseState, chaseTimes, chaseTime, buildSchedule, segmentAt, startOf, panicPressTimes, lampsAt, reminderLinesAt, entryLevels, cutsAfter } from '../demo/returnHome.js';

const sched = buildSchedule();
// order
assert.deepEqual(sched.segments.map((s) => s.id), ['liftoff', 'skip', 'flyby', 'entry', 'pushin', 'parachute', 'panic', 'impact', 'reminder', 'analysis']);
// durations of the approved script, lengthened to fit the voice lines (audio.js RETURN_CUES)
const dur = Object.fromEntries(sched.segments.map((s) => [s.id, s.dur]));
assert.deepEqual([dur.liftoff, dur.skip, dur.flyby, dur.entry, dur.pushin, dur.parachute, dur.panic, dur.impact], [12, 3, 16, 15, 1.5, 11, 14, 4]);
assert.ok(sched.total >= 80 && sched.total <= 120, `total ${sched.total}`);
assert.ok(dur.flyby >= 12 && dur.entry >= 10 && dur.panic >= 6 && dur.impact >= 4 && dur.impact <= 5);
// where each segment is seen from
const view = Object.fromEntries(RETURN_SCRIPT.segments.map((s) => [s.id, s.view]));
for (const id of ['liftoff', 'flyby', 'entry', 'pushin', 'impact']) assert.equal(view[id], 'outside', id);
for (const id of ['parachute', 'panic']) assert.equal(view[id], 'cockpit', id);
assert.equal(view.reminder, 'text');
assert.equal(view.analysis, 'text');
assert.equal(sched.total, sched.segments.reduce((a, s) => a + s.dur, 0));
for (let i = 1; i < sched.segments.length; i += 1) assert.equal(sched.segments[i].start, sched.segments[i - 1].end); // contiguous
// segmentAt
assert.equal(segmentAt(sched, 0).id, 'liftoff');
assert.equal(segmentAt(sched, 11.99).id, 'liftoff');
assert.equal(segmentAt(sched, 12).id, 'skip');
assert.equal(segmentAt(sched, startOf(sched, 'panic') + 1).local, 1);
assert.equal(segmentAt(sched, sched.total), null);
assert.equal(segmentAt(sched, -1), null);
// impact: a hard cut in from the cockpit; black (a hard cut) before the reminder; the hit happens inside the 4 s
assert.equal(cutsAfter('panic'), true);
assert.equal(cutsAfter('impact'), true);
assert.equal(cutsAfter('entry'), false);
assert.equal(cutsAfter('flyby'), false); // flyby flows into the entry
assert.equal(cutsAfter('pushin'), false);
const ids = sched.segments.map((s) => s.id);
assert.equal(ids[ids.indexOf('impact') - 1], 'panic');
assert.equal(ids[ids.indexOf('reminder') - 1], 'impact'); // then black, and the text only
assert.ok(RETURN_SCRIPT.impact.hitAt > 1 && RETURN_SCRIPT.impact.hitAt < dur.impact - 1);
assert.ok(RETURN_SCRIPT.reminder.blackSilence >= 1);
// the analysis hands over to the scroll after its readout, with time for the 1 s crossfade
assert.ok(RETURN_SCRIPT.analysis.handoffAt + RETURN_SCRIPT.analysis.fadeOutS <= dur.analysis + 1e-9);
assert.equal(ids.at(-1), 'analysis');
// panic presses: faster and faster, 0.35 s -> 0.15 s
const presses = panicPressTimes();
assert.equal(presses[0], 0);
const gaps = presses.slice(1).map((t, i) => t - presses[i]);
assert.ok(Math.abs(gaps[0] - 0.35) < 0.02);
assert.ok(gaps.at(-1) < 0.2 && gaps.at(-1) >= 0.15);
for (let i = 1; i < gaps.length; i += 1) assert.ok(gaps[i] <= gaps[i - 1] + 1e-9);
assert.ok(presses.at(-1) < dur.panic);
// lamps
const chute = RETURN_SCRIPT.parachute.lamps;
assert.deepEqual(lampsAt(chute, 1), []);
assert.deepEqual(lampsAt(chute, 4.5), [{ text: 'DROGUE · OPEN', state: 'green' }]);
assert.equal(lampsAt(chute, 6).at(-1).text, 'MAIN CHUTE · NO DEPLOY');
assert.equal(lampsAt(chute, 6).at(-1).state, 'red');
const lamps = lampsAt(RETURN_SCRIPT.panic.lamps, 12.5);
assert.equal(lamps.find((l) => l.text.startsWith('RESERVE')).text, 'RESERVE CHUTE · TANGLED'); // DEPLOYED then TANGLED
assert.ok(RETURN_SCRIPT.panic.lamps.findIndex((l) => l.text.endsWith('DEPLOYED')) < RETURN_SCRIPT.panic.lamps.findIndex((l) => l.text.endsWith('TANGLED')));
assert.ok(lampsAt(RETURN_SCRIPT.entry.lamps, 99).every((l) => l.state === 'green')); // entry: everything calm
// entry levels rise
assert.ok(entryLevels(1).shake > entryLevels(0).shake);
// reminder text order, and it fits inside its segment after 2 s of silence
const lines = RETURN_SCRIPT.reminder.lines;
assert.deepEqual(lines.map((l) => l.id), ['warning', 'nogo', 'said-go']);
assert.deepEqual(lines.map((l) => l.style), ['serif', 'warn', 'serif']);
assert.equal(lines[1].text, 'RECOVERY · NO-GO · parachute not proven');
assert.equal(lines[2].text, 'You saw this warning before launch. You said GO.');
assert.ok(lines[0].at >= RETURN_SCRIPT.reminder.blackSilence);
assert.ok(lines.every((l, i) => i === 0 || l.at > lines[i - 1].at));
assert.ok(lines.at(-1).at < dur.reminder);
assert.deepEqual(reminderLinesAt(11).length, 0); // the radio and the echo from home come first
assert.deepEqual(reminderLinesAt(15).map((l) => l.id), ['warning', 'nogo']);
// the chase shot: nose first, camera trailing, continuous across flyby -> entry -> push-in
const T = chaseTimes();
assert.equal(T.fly, 16);
assert.equal(T.total, dur.flyby + dur.entry + dur.pushin);
assert.equal(ids[ids.indexOf('flyby') + 1], 'entry');
assert.equal(ids[ids.indexOf('entry') + 1], 'pushin');
assert.equal(ids[ids.indexOf('pushin') + 1], 'parachute');
assert.equal(chaseTime('entry', 0), T.fly);
assert.equal(chaseTime('pushin', 0), T.fly + T.entry);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
let prev = chaseState(0);
let prevAlt = prev.altitude;
for (let t = 0; t <= T.total; t += 0.25) {
  const s = chaseState(t);
  assert.ok(Math.abs(len(s.forward) - 1) < 1e-9, 'forward is a unit vector');
  assert.ok(dot(s.forward, s.velocity) / len(s.velocity) > 0.95, `velocity along the nose at ${t}`);
  assert.ok(dot(s.camOffset, s.forward) < 0, `camera behind the ship at ${t}`);
  // the real motion of the ship (finite difference of its position) also points along the nose
  const next = chaseState(Math.min(T.total, t + 0.1));
  const d = sub(next.pos, s.pos);
  if (len(d) > 0) assert.ok(dot(d, s.forward) / len(d) > 0.95, `moves nose first at ${t}`);
  assert.ok(s.altitude <= prevAlt + 1e-12, 'never climbs');
  prevAlt = s.altitude;
  // no jump from one step to the next (no cut between flyby and entry)
  assert.ok(len(sub(s.pos, prev.pos)) < 0.05 && dot(s.forward, prev.forward) > 0.99 && len(sub(s.camOffset, prev.camOffset)) < 1, `continuous at ${t}`);
  prev = s;
}
const atFlyEnd = chaseState(T.fly - 1e-3);
const atEntryStart = chaseState(T.fly + 1e-3);
assert.ok(len(sub(atFlyEnd.pos, atEntryStart.pos)) < 1e-3 && dot(atFlyEnd.forward, atEntryStart.forward) > 0.9999);
assert.ok(len(sub(atFlyEnd.camOffset, atEntryStart.camOffset)) < 0.01);
// the ship pitches down and descends into the atmosphere during the entry, level in the flyby
assert.ok(chaseState(5).gamma < 1e-9 && chaseState(T.total).gamma > 0.2);
assert.ok(chaseState(T.total).altitude < 0.002 && chaseState(0).altitude > 0.1);
// the push-in to the window and the hot glare are in the script
assert.ok(RETURN_SCRIPT.pushin.glare[0] < RETURN_SCRIPT.pushin.glare[1] && RETURN_SCRIPT.pushin.glare[1] <= 1);
console.log('returnHome tests passed');
