// The Go/No-Go poll (spec §5.5): consoles report in turn, "PROPULSION… GO". Driven only by update(dt).
// Line statuses: GO, NO-GO (a warning), BLOCK (a hard block), and the launch director's HOLD, SCRUB and INFO lines.
import { events } from '/src/core/index.js';

const STATUS_CLASS = { GO: 'hud-good', 'NO-GO': 'hud-caution', BLOCK: 'hud-alert', HOLD: 'hud-caution', SCRUB: 'hud-alert', INFO: 'gng-line--info' };
const CALL = 0.32; // s between the console calling and its answer
const GAP = 0.75; // s between consoles

export function createGonogoView({ parent, lines, onReveal, onDone }) {
  const root = document.createElement('div');
  root.className = 'gng-lines';
  parent.append(root);
  let index = 0; // next line to call
  let pending = null; // { el, status, text, line } waiting for its answer
  let clock = 0;
  let done = false;

  function make(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function call() {
    const line = lines[index];
    const el = make('div', 'gng-line gng-line--calling');
    el.dataset.status = line.status;
    const consoleEl = make('span', 'gng-line-console', `${line.console}…`);
    const status = make('span', 'gng-status', '');
    status.append(make('span', 'gng-cursor'));
    const text = make('span', 'gng-line-text', '');
    el.append(consoleEl, status, text);
    root.append(el);
    pending = { el, status, text, line };
    index += 1;
  }

  function answer() {
    const { el, status, text, line } = pending;
    el.classList.remove('gng-line--calling');
    el.classList.add(STATUS_CLASS[line.status] ?? 'hud-ok');
    if (line.status === 'BLOCK' || line.status === 'SCRUB') el.classList.add('gng-line--flash');
    if (line.thin) el.classList.add('gng-line--thin');
    status.textContent = line.status;
    text.textContent = line.text;
    if (line.guidebook) {
      const link = make('button', 'gng-link', '?');
      link.type = 'button';
      link.title = 'Open the Guidebook';
      link.addEventListener('click', () => events.emit('guidebook:open', { entryId: line.guidebook }));
      text.append(link);
    }
    onReveal?.(line, index - 1);
    pending = null;
    if (index >= lines.length) finish();
  }

  function finish() {
    if (done) return;
    done = true;
    onDone?.();
  }

  return {
    update(dt) {
      if (done) return;
      clock += dt;
      if (pending) {
        if (clock >= CALL) { clock = 0; answer(); }
      } else if (index === 0 || clock >= GAP) {
        clock = 0;
        if (index < lines.length) call(); else finish();
      }
    },
    skip() {
      if (pending) answer();
      while (!done && index < lines.length) { call(); answer(); }
      finish();
    },
    dispose() {
      root.remove();
    },
  };
}
