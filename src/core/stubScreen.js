// One look for every stub screen, so they are consistent and easy to delete.
// Mounts a .hud-panel that says it is a stub, who owns it, and action buttons with key shortcuts.
import { input } from './input.js';
import { ui } from './ui.js';

/**
 * stubScreen({ title, owner, notes, actions, extra })
 *   owner:   'Role 2 (Flight)' and so on
 *   notes:   a string or an array of short lines
 *   actions: [{ label, key: 'Enter' | 'KeyG' | ..., onClick }]  (key is a KeyboardEvent.code)
 *   extra:   an optional element placed above the buttons
 * Returns the mounted element (removed automatically on the next state change).
 */
export function stubScreen({ title, owner, notes = [], actions = [], extra = null }) {
  const panel = document.createElement('div');
  panel.className = 'hud-panel';
  panel.dataset.stub = title;
  panel.style.cssText = 'position:absolute;left:24px;top:24px;width:min(420px,calc(100vw - 48px));display:grid;gap:10px';

  const label = document.createElement('div');
  label.className = 'hud-label';
  label.textContent = `STUB screen. Owner: ${owner}`;

  const heading = document.createElement('div');
  heading.className = 'hud-value';
  heading.textContent = title;

  panel.append(label, heading);

  for (const line of Array.isArray(notes) ? notes : [notes]) {
    const p = document.createElement('div');
    p.textContent = line;
    panel.append(p);
  }
  if (extra) panel.append(extra);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  for (const action of actions) {
    const button = document.createElement('button');
    button.className = 'hud-button';
    button.type = 'button';
    button.textContent = action.key ? `${action.label} [${action.key.replace(/^(Key|Digit)/, '')}]` : action.label;
    button.dataset.action = action.label;
    button.addEventListener('click', () => action.onClick());
    row.append(button);
    if (action.key) input.onPress(action.key, () => action.onClick());
  }
  panel.append(row);

  ui.mount(panel);
  return panel;
}
