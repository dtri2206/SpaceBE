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
  const cls = msg.kind === 'log' ? ' role4-radio-log' : msg.kind === 'static' ? ' role4-radio-static' : '';
  const panel = el('div', `hud hud-panel role4-radio${cls}`);
  panel.dataset.kind = msg.kind ?? 'voice';
  panel.style.pointerEvents = 'none';
  const head = msg.kind === 'log' ? msg.title : `${msg.from}${msg.delayMin ? ` · sent ${msg.delayMin} min ago` : ''}`;
  if (msg.kind === 'static') panel.append(el('div', 'hud-label', head), el('div', 'role4-radio-nosignal', `░▒▓ ${msg.text} ▓▒░`));
  else
  panel.append(el('div', 'hud-label', head), el('div', 'role4-radio-text', msg.text));
  current = ui.mountPersistent(panel, { layer: 'hud' });
  panel.style.pointerEvents = 'none';
  try { audio.play('radio.blip'); } catch { /* audio is optional */ }
  // reading time: about 15 characters a second, at least 6 s
  timer = setTimeout(next, msg.holdMs ?? Math.max(6000, (msg.text.length / 15) * 1000 + 3000));
}

/**
 * Queue a message: { from, text, delayMin? } or a log: { kind: 'log', title, text }, or radio silence:
 * { kind: 'static', from, text, holdMs? } (a "NO SIGNAL" panel). With `urgent` it cuts in front of the queue.
 */
export function radio(msg) {
  if (msg.urgent) {
    queue.unshift(msg);
    next();
    return;
  }
  queue.push(msg);
  if (!current) next();
}

/** Drop everything (endings are quiet). */
export function clearRadio() {
  queue.length = 0;
  next();
}
