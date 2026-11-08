// Memorial sequence: a quiet tribute to the real people behind a fatal history lesson (data-driven, tributes.json).
// Shown before the normal ending screen, and read-only from the Guidebook's Wall of Remembrance. No humour, no music.
import { audio } from '/src/audio/index.js';
import { input, save, ui } from '/src/core/index.js';
import tributes from './tributes.json';
import { button, el, wait } from './dom.js';
import { CLOSING_MS, canContinue, tributeSchedule, visibleHappened } from './tributeFlow.js';

const SVG = 'http://www.w3.org/2000/svg';

/** A simple original emblem (never a real patch): a ring, a few stars and the mission name. */
export function emblem(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'role4-emblem');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${name} emblem`);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text) n.textContent = text;
    svg.append(n);
  };
  add('circle', { cx: 60, cy: 60, r: 56, fill: '#05070b', stroke: '#c9b88a', 'stroke-width': 2 });
  add('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#c9b88a', 'stroke-width': 0.6, opacity: 0.6 });
  [[36, 38], [58, 28], [82, 40], [92, 62], [28, 62]].forEach(([x, y], i) => add('circle', { cx: x, cy: y, r: i % 2 ? 1.6 : 1.1, fill: '#f1e7c8' }));
  add('text', { x: 60, y: 74, 'text-anchor': 'middle', fill: '#f1e7c8', 'font-size': name.length > 10 ? 9 : 12, 'font-family': 'Georgia, serif' }, name);
  return svg;
}

function paragraph(className, text) { return el('p', className, text); }

function section(label) {
  const s = el('section', 'role4-tribute-block');
  s.append(el('h3', 'role4-tribute-label', label));
  return s;
}

/**
 * Builds every block of the memorial. Returns { blocks: { id: Node | Node[] } } keyed like tributeSchedule steps.
 * Empty parts simply produce no block.
 */
export function buildBlocks(t, { skipSensitive = false } = {}) {
  const blocks = {};
  if (t.opening) blocks.opening = el('p', 'role4-tribute-opening', t.opening);

  const card = el('section', 'role4-tribute-block role4-tribute-card');
  card.append(emblem(t.mission));
  const facts = el('div', 'role4-tribute-facts');
  facts.append(el('div', 'role4-tribute-mission', t.mission));
  for (const text of [t.vehicle, t.dateText, t.place]) if (text) facts.append(el('div', 'role4-tribute-fact', text));
  card.append(facts);
  blocks.mission = card;

  blocks.crew = (t.crew ?? []).map((c) => {
    const row = el('div', 'role4-tribute-crew');
    row.append(el('span', 'role4-flame'));
    const text = el('div');
    text.append(el('div', 'role4-tribute-name', c.name), el('div', 'role4-tribute-role', c.role));
    if (c.line) text.append(el('div', 'role4-tribute-line', c.line));
    row.append(text);
    return row;
  });

  const happened = visibleHappened(t.happened, skipSensitive);
  if (happened.length) {
    const s = section('What happened');
    happened.forEach((x) => s.append(paragraph('role4-tribute-text', x)));
    blocks.happened = s;
  }
  if (t.changed?.length) {
    const s = section('What their loss changed');
    const ul = el('ul', 'role4-tribute-list');
    t.changed.forEach((x) => ul.append(el('li', null, x)));
    s.append(ul);
    blocks.changed = s;
  }
  if (t.lesson) {
    const s = section('The lesson they left us');
    s.append(paragraph('role4-tribute-lesson', t.lesson));
    blocks.lesson = s;
  }
  if (t.quote?.text) {
    const s = el('section', 'role4-tribute-block');
    s.append(el('blockquote', 'role4-tribute-quote', `“${t.quote.text}”`));
    if (t.quote.by) s.append(el('div', 'role4-tribute-by', t.quote.by));
    blocks.quote = s;
  }
  if (t.sources?.length) {
    const s = el('section', 'role4-tribute-block role4-tribute-sources');
    s.append(el('h3', 'role4-tribute-label', 'Sources'));
    for (const src of t.sources) {
      if (!src?.url) continue;
      const a = el('a', null, src.title || src.url);
      a.href = src.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      s.append(a);
    }
    blocks.sources = s;
  }
  return blocks;
}

/** Silence: stop everything that is playing (music, radio, loops). Read-only use of the audio API. */
function hush() {
  try { for (const id of audio.playing?.() ?? []) audio.stop(id, { fade: 1.2 }); } catch { /* audio is optional */ }
}

/**
 * Shows the memorial. Options: readOnly (Guidebook: no closing line, button says Close), onDone (called after it,
 * and after the closing line unless readOnly), layer z-index above other overlays.
 * Returns dispose().
 */
export function showTribute(t, { readOnly = false, onDone = () => {}, zIndex } = {}) {
  let alive = true;
  const skipSensitive = !!save.load().skipSensitive;
  const schedule = tributeSchedule(t, { skipSensitive, readOnly });
  const blocks = buildBlocks(t, { skipSensitive });

  const root = el('div', 'role4-tribute');
  root.dataset.screen = 'ENDING';
  root.dataset.tribute = t.mission;
  const page = el('div', 'role4-tribute-page');
  root.append(page);
  const actions = el('div', 'role4-tribute-actions');
  ui.mount(root);
  if (zIndex) root.style.zIndex = String(zIndex);

  if (!readOnly) {
    hush();
    setTimeout(() => alive && hush(), 600); // an audio director may start something on the state change
  }
  setTimeout(() => root.classList.add('role4-tribute-on'), 30); // black fades in

  let cleanups = [];
  const reveal = (node) => {
    page.append(node);
    void node.offsetWidth;
    node.classList.add('role4-tribute-show');
    root.scrollTo?.({ top: root.scrollHeight, behavior: 'smooth' });
  };

  const finishTo = async () => {
    if (!alive) return;
    cleanups.forEach((f) => f());
    cleanups = [];
    actions.remove();
    if (readOnly) { dispose(); onDone(); return; }
    // The closing line on black, then the normal ending screen.
    page.replaceChildren();
    const closing = el('p', 'role4-tribute-opening', tributes.closing?.text ?? '');
    page.append(closing);
    root.scrollTo?.({ top: 0 });
    void closing.offsetWidth;
    closing.classList.add('role4-tribute-show');
    await wait(CLOSING_MS);
    if (!alive) return;
    dispose();
    onDone();
  };

  const showContinue = () => {
    if (!alive) return;
    const go = () => finishTo();
    const b = button(readOnly ? 'Close' : 'Continue', go, { primary: true });
    actions.append(b);
    actions.classList.add('role4-tribute-show');
    page.append(actions);
    cleanups.push(input.onPress('Enter', go), input.onPress('Space', go));
    root.scrollTo?.({ top: root.scrollHeight, behavior: 'smooth' });
  };

  const timers = [];
  for (const step of schedule.steps) {
    timers.push(setTimeout(() => {
      if (!alive) return;
      if (step.id === 'crew') reveal(blocks.crew[step.index]);
      else if (blocks[step.id]) reveal(blocks[step.id]);
    }, step.at));
  }
  timers.push(setTimeout(() => alive && canContinue(schedule.continueAt, schedule) && showContinue(), schedule.continueAt));

  function dispose() {
    alive = false;
    timers.forEach(clearTimeout);
    cleanups.forEach((f) => f?.());
    cleanups = [];
    ui.unmount(root);
  }
  return dispose;
}
