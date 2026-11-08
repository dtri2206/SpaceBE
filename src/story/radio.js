// Radio and log messages: a queue of short panels at the bottom centre. They stay across state changes
// (mountPersistent) and remove themselves. Text lines come from data.json.
import { ui } from '/src/core/index.js';
import { audio } from '/src/audio/index.js';

const queue = [];
let current = null;
let timer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function next() {
  clearTimeout(timer);
  if (current) ui.unmount(current);
  current = null;
  const msg = queue.shift();
  if (!msg) return;
  const panel = el('div', `hud hud-panel role4-radio${msg.kind === 'log' ? ' role4-radio-log' : ''}`);
  panel.style.pointerEvents = 'none';
  const head = msg.kind === 'log' ? msg.title : `${msg.from}${msg.delayMin ? ` · sent ${msg.delayMin} min ago` : ''}`;
  panel.append(el('div', 'hud-label', head), el('div', 'role4-radio-text', msg.text));
  current = ui.mountPersistent(panel, { layer: 'hud' });
  panel.style.pointerEvents = 'none';
  try { audio.play('radio.blip'); } catch { /* audio is optional */ }
  // reading time: about 15 characters a second, at least 6 s
  timer = setTimeout(next, Math.max(6000, (msg.text.length / 15) * 1000 + 3000));
}

/** Queue a message: { from, text, delayMin? } or a log: { kind: 'log', title, text }. */
export function radio(msg) {
  queue.push(msg);
  if (!current) next();
}

/** Drop everything (endings are quiet). */
export function clearRadio() {
  queue.length = 0;
  next();
}
