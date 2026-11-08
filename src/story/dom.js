// Tiny DOM helpers for Role 4's story screens.
import { input } from '/src/core/index.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A .hud-button. With `key` (a KeyboardEvent.code) the key works too and the label shows it. */
export function button(label, onClick, { key, primary = false } = {}) {
  const b = el('button', `hud-button${primary ? ' role4-primary' : ''}`, key ? `${label} [${key.replace(/^(Key|Digit)/, '')}]` : label);
  b.type = 'button';
  b.dataset.action = label;
  let used = false;
  const run = () => {
    if (used || b.disabled || !b.isConnected) return;
    used = true;
    onClick();
    setTimeout(() => { used = false; }, 250); // one action per press, even with a key and a click together
  };
  b.addEventListener('click', run);
  if (key) input.onPress(key, run);
  return b;
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Types text into a node, a few characters at a time. Resolves when done or when `alive()` turns false. */
export async function typeInto(node, text, { cps = 40, alive = () => true } = {}) {
  node.textContent = '';
  for (let i = 0; i < text.length && alive(); i += 2) {
    node.textContent = text.slice(0, i + 2);
    await wait(2000 / cps);
  }
  if (alive()) node.textContent = text;
}

/** Fill {family} and similar placeholders. */
export function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
