import assert from 'node:assert/strict';
import test from 'node:test';
import { SCROLL_TEXT, TIMINGS, lineOrder, lineDelayMs, revealEndMs, scrollSchedule, scrollOffset } from '../demo/scroll.js';

test('the approved text, in order', () => {
  assert.deepEqual(lineOrder().map((l) => l.text), [
    'IN MEMORIAM',
    'Valentin Cheredintsev / TASS · CC BY 4.0',
    'Your parachute failed. On 24 April 1967, his did too.',
    'Vladimir Komarov',
    'Soyuz 1 · 24 April 1967',
    'He left behind his wife, Valentina, and their children, Yevgeny and Irina.',
    'A solar panel failed to open. Power and control slipped away.',
    'Ordered home early, Soyuz 1 fell into a steep re-entry.',
    'The main parachute never came out. The reserve tangled.',
    '1st', '0', '18 months',
    'Engineers wanted one more test flight. Soyuz 1 flew without it.',
    '❦',
    'In this game, you can press Try again. He could not.',
  ]);
  assert.deepEqual(SCROLL_TEXT.stats.map((s) => s.label), ['person to die during a spaceflight', 'main parachutes opened', 'before Soyuz flew a crew again']);
  assert.equal(SCROLL_TEXT.hint, 'Hold C + R + 7 to replay');
});

test('timings: 1.6 s unroll, lines 0.3 s apart, indexes never go backwards', () => {
  assert.equal(TIMINGS.unrollMs, 1600);
  assert.equal(lineDelayMs(1) - lineDelayMs(0), 300);
  const idx = lineOrder().map((l) => l.i);
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.equal(revealEndMs(), 1300 + 13 * 300 + 600);
});

test('scroll schedule: starts after the reveal, 15 s, eased, clamped, none when it fits', () => {
  const s = scrollSchedule({ contentHeight: 2200, viewHeight: 720 });
  assert.equal(s.startMs, revealEndMs());
  assert.equal(s.distance, 1480);
  assert.equal(s.durationMs, 15000);
  assert.equal(scrollOffset(0, s), 0);
  assert.equal(scrollOffset(7500, s), 740);
  assert.equal(scrollOffset(99999, s), 1480);
  assert.ok(scrollOffset(3000, s) < scrollOffset(12000, s));
  assert.equal(scrollSchedule({ contentHeight: 500, viewHeight: 720 }).distance, 0);
  assert.equal(scrollSchedule({ contentHeight: 2000, viewHeight: 700, reducedMotion: true }).startMs, 500);
});
