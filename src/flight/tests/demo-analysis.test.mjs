import assert from 'node:assert/strict';
import { ANALYSIS_LINES, ANALYSIS_TIMING, typingSchedule, typingEnd, visibleCounts } from '../demo/analysis.js';
import { RETURN_SCRIPT } from '../demo/returnHome.js';

assert.deepEqual(ANALYSIS_LINES.map((l) => l.text), [
  'ACCIDENT ANALYSIS · FLIGHT RECORDER',
  'LAUNCH    RECOVERY · NO-GO · parachute not proven · OVERRIDDEN',
  'ENTRY     heat shield nominal · attitude nominal',
  'E+04:10   DROGUE CHUTE · OPEN',
  'E+04:12   MAIN CHUTE · NO DEPLOY',
  'E+04:16   RESERVE CHUTE · DEPLOYED · TANGLED',
  'E+04:31   IMPACT · ~50 m/s',
  '',
  'ROOT CAUSE   the main parachute was never proven in a drop test',
  'CONTRIBUTING the NO-GO warning was overridden to keep the schedule',
]);
const sched = typingSchedule();
// each line starts after the previous one ended, in order
for (let i = 1; i < sched.length; i += 1) assert.ok(sched[i].start > sched[i - 1].end);
assert.equal(sched[0].start, ANALYSIS_TIMING.startAt);
// all typed in about 8 s after the lead-in, then a hold of 2 s, before the scroll takes over
const end = typingEnd(sched);
assert.ok(end - ANALYSIS_TIMING.startAt <= 8.5 && end - ANALYSIS_TIMING.startAt >= 6, `typing took ${end}`);
assert.ok(RETURN_SCRIPT.analysis.handoffAt >= end + ANALYSIS_TIMING.holdAfter - 0.3);
const seg = RETURN_SCRIPT.segments.find((s) => s.id === 'analysis');
assert.ok(seg.dur >= RETURN_SCRIPT.analysis.handoffAt + RETURN_SCRIPT.analysis.fadeOutS - 1e-9);
// times consistent: E+ times increase
const times = ANALYSIS_LINES.map((l) => /^E\+(\d\d):(\d\d)/.exec(l.text)).filter(Boolean).map((m) => +m[1] * 60 + +m[2]);
assert.deepEqual(times, [...times].sort((a, b) => a - b));
// visible counts
assert.deepEqual(visibleCounts(0, sched), ANALYSIS_LINES.map(() => 0));
assert.deepEqual(visibleCounts(end + 1, sched), ANALYSIS_LINES.map((l) => l.text.length));
const mid = visibleCounts(sched[2].start + 0.2, sched);
assert.equal(mid[0], ANALYSIS_LINES[0].text.length);
assert.ok(mid[2] > 0 && mid[2] < ANALYSIS_LINES[2].text.length);
assert.equal(mid[3], 0);
console.log('analysis tests passed');
