// The black-box accident analysis: amber monospace text typed out line by line on black, like a flight-recorder readout.
// The top half (lines + typing schedule) is pure (Node tests it: analysis.test.mjs); the DOM part is browser-only.
// Times (E+mm:ss) count from the start of atmospheric entry in the pitch's return sequence.

import { playSfx } from './audio.js'; // the flight-recorder printer under the typing

export const ANALYSIS_LINES = Object.freeze([
  Object.freeze({ id: 'title', tone: 'head', text: 'ACCIDENT ANALYSIS · FLIGHT RECORDER' }),
  Object.freeze({ id: 'launch', tone: 'warn', text: 'LAUNCH    RECOVERY · NO-GO · parachute not proven · OVERRIDDEN' }),
  Object.freeze({ id: 'entry', tone: 'ok', text: 'ENTRY     heat shield nominal · attitude nominal' }),
  Object.freeze({ id: 'drogue', tone: 'ok', text: 'E+04:10   DROGUE CHUTE · OPEN' }),
  Object.freeze({ id: 'main', tone: 'bad', text: 'E+04:12   MAIN CHUTE · NO DEPLOY' }),
  Object.freeze({ id: 'reserve', tone: 'bad', text: 'E+04:16   RESERVE CHUTE · DEPLOYED · TANGLED' }),
  Object.freeze({ id: 'impact', tone: 'bad', text: 'E+04:31   IMPACT · ~50 m/s' }),
  Object.freeze({ id: 'gap', tone: 'ok', text: '' }),
  Object.freeze({ id: 'root', tone: 'head', text: 'ROOT CAUSE   the main parachute was never proven in a drop test' }),
  Object.freeze({ id: 'contrib', tone: 'head', text: 'CONTRIBUTING the NO-GO warning was overridden to keep the schedule' }),
]);

export const ANALYSIS_TIMING = Object.freeze({ startAt: 1.0, charsPerSec: 62, linePause: 0.12, holdAfter: 2 });

/** [{ index, id, text, start, end }]: when each line starts and finishes typing (s from the start of the segment). */
export function typingSchedule(lines = ANALYSIS_LINES, timing = ANALYSIS_TIMING) {
  let t = timing.startAt;
  return lines.map((line, index) => {
    const start = t;
    const end = start + line.text.length / timing.charsPerSec;
    t = end + timing.linePause;
    return { index, id: line.id, text: line.text, start, end };
  });
}

/** When the last character is typed. */
export const typingEnd = (schedule = typingSchedule()) => schedule.at(-1).end;

/** How many characters of each line are typed at local time t. */
export function visibleCounts(t, schedule = typingSchedule(), timing = ANALYSIS_TIMING) {
  return schedule.map((s) => {
    if (t <= s.start) return 0;
    if (t >= s.end) return s.text.length;
    return Math.min(s.text.length, Math.floor((t - s.start) * timing.charsPerSec));
  });
}

// ---- browser part ----
/** Builds the readout inside `parent` (hidden until update() is called). update(local) types; dispose() removes it. */
export function createAnalysis(parent) {
  const schedule = typingSchedule();
  const root = document.createElement('div');
  root.className = 'rh-analysis';
  const pre = document.createElement('div');
  pre.className = 'rh-analysis-pre';
  const rows = ANALYSIS_LINES.map((line) => {
    const row = document.createElement('div');
    row.className = `rh-an-line rh-an-${line.tone}`;
    row.textContent = ' ';
    pre.append(row);
    return row;
  });
  const cursor = document.createElement('span');
  cursor.className = 'rh-an-cursor';
  root.append(pre);
  parent.append(root);
  let last = '';
  let printer = null; // sfx_data_printer, quietly, while characters are being typed
  const stopPrinter = (ms = 400) => { printer?.stop(ms); printer = null; };
  return {
    root,
    update(local) {
      const typing = local >= schedule[0].start && local < typingEnd(schedule);
      if (typing && !printer) printer = playSfx('sfx_data_printer', { loop: true, volume: 0.22 });
      else if (!typing && printer) stopPrinter();
      const counts = visibleCounts(local, schedule);
      const key = counts.join(',');
      if (key === last) return;
      last = key;
      const active = counts.findIndex((n, i) => n < schedule[i].text.length);
      rows.forEach((row, i) => {
        row.textContent = ANALYSIS_LINES[i].text.slice(0, counts[i]) || ' ';
        if (i === (active === -1 ? rows.length - 1 : active)) row.append(cursor);
      });
    },
    fadeOut(seconds) { stopPrinter(300); root.style.transition = `opacity ${seconds}s ease`; root.style.opacity = '0'; },
    dispose() { stopPrinter(200); root.remove(); },
  };
}
