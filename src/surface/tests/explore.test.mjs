// Node tests: reach maths and the first-step logic. Run: node src/surface/tests/explore.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  walkReachMetres, roverReachMetres, roverWhPerMetre, formatReach, reachLine, parseTargetDistance, targetBeyondReach,
  exploration, sanitizeWords, createFirstStepSequence, DEFAULT_FIRST_WORDS, MAX_FIRST_WORDS, FIRST_STEP_TIMING, REACH_MARGIN,
} from '../explore.js';
import { ROVER, ROVER_MR01 } from '../RoverController.js';

const MARS_G = 3.71;

test('walking reach = seconds x speed / 2 x 0.8', () => {
  assert.equal(walkReachMetres(300), 300 * 1.5 / 2 * REACH_MARGIN); // a full tank: 180 m
  assert.equal(Math.round(walkReachMetres(300)), 180);
  assert.equal(walkReachMetres(0), 0);
  assert.equal(walkReachMetres(-5), 0);
  assert.ok(walkReachMetres(150) < walkReachMetres(300));
});

test('rover reach follows the battery and is larger for the MR-01', () => {
  const full = roverReachMetres(ROVER, ROVER.batteryWh, MARS_G);
  assert.ok(full > 10000 && full < 200000, `${full} m`);
  assert.ok(Math.abs(roverReachMetres(ROVER, ROVER.batteryWh / 2, MARS_G) - full / 2) < 1e-6);
  assert.equal(roverReachMetres(ROVER, 0, MARS_G), 0);
  assert.ok(roverReachMetres(ROVER_MR01, ROVER_MR01.batteryWh, MARS_G) > full);
  assert.ok(roverWhPerMetre(ROVER, MARS_G) > 0.05 && roverWhPerMetre(ROVER, MARS_G) < 0.2); // tens of Wh per km
});

test('distances read well', () => {
  assert.equal(formatReach(212), '210 m');
  assert.equal(formatReach(23), '20 m');
  assert.equal(formatReach(4217), '4.2 km');
  assert.equal(formatReach(51000), '51 km');
  assert.equal(formatReach(0), '0 m');
  assert.equal(reachLine({ walkMetres: 212, roverMetres: 4217, roverName: 'LRV' }), 'REACH · walk 210 m · LRV 4.2 km');
  assert.equal(reachLine({ walkMetres: 90 }), 'REACH · walk 90 m');
});

test('amber when the next target is beyond walking reach', () => {
  assert.equal(parseTargetDistance('Scan the dune · 250 m'), 250);
  assert.equal(parseTargetDistance('Scan the dune'), null);
  assert.equal(parseTargetDistance(null), null);
  assert.equal(targetBeyondReach(250, 180), true);
  assert.equal(targetBeyondReach(120, 180), false);
  assert.equal(targetBeyondReach(null, 180), false);
});

test('the first step happens once per mission, only through the airlock', () => {
  exploration.reset();
  assert.equal(exploration.claimFirstStep(false), false); // direct debug start: no scene
  assert.equal(exploration.claimFirstStep(true), true);
  assert.equal(exploration.claimFirstStep(true), false); // second time out: nothing
  exploration.reset(); // new mission
  assert.equal(exploration.claimFirstStep(true), true);
  assert.equal(exploration.firstWords, null);
});

test('first words: typed text is cleaned and capped, skip gives the default, reset clears it', () => {
  exploration.reset();
  assert.equal(exploration.setFirstWords('  One   small step\n'), 'One small step');
  assert.equal(exploration.firstWords, 'One small step');
  assert.equal(exploration.setFirstWords(''), DEFAULT_FIRST_WORDS);
  assert.equal(exploration.setFirstWords('   '), 'Hello, Mars.');
  assert.equal(exploration.setFirstWords(undefined), 'Hello, Mars.');
  assert.equal(sanitizeWords('x'.repeat(200)).length, MAX_FIRST_WORDS);
  exploration.reset();
  assert.equal(exploration.firstWords, null);
});

test('the scripted moment: print at ~2 s, typing prompt at ~6.5 s, E/Space skips to it', () => {
  const seq = createFirstStepSequence();
  assert.equal(seq.phase, 'scene');
  let stamps = 0, t = 0;
  while (seq.phase === 'scene' && t < 20) { if (seq.update(0.1).stamp) stamps++; t += 0.1; }
  assert.equal(stamps, 1);
  assert.ok(t >= FIRST_STEP_TIMING.words - 0.2 && t <= 8, `${t} s`);
  assert.equal(seq.phase, 'words');
  seq.finish();
  assert.equal(seq.phase, 'done');
  assert.equal(seq.tilt, 0);

  const early = createFirstStepSequence();
  early.update(0.5);
  assert.equal(early.skip().stamp, true); // skipped before the print: it still appears
  assert.equal(early.phase, 'words');
  assert.equal(early.skip().stamp, false); // nothing more to skip
  const late = createFirstStepSequence();
  late.update(3);
  assert.equal(late.skip().stamp, false); // print already made
});
