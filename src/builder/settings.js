// Settings and the Esc pause menu, usable from any state (other roles import them from /src/builder/index.js).
// Persistent overlays through ui.mountPersistent; everything is saved through core's save.
import { graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { economy, events, input, save, ui } from '/src/core/index.js';

let settingsEl = null;
let pauseEl = null;

const h = (tag, className, textContent) => Object.assign(document.createElement(tag), { className: className ?? '', textContent: textContent ?? '' });
const button = (label, onClick, extra = '') => {
  const b = h('button', `hud-button ${extra}`, label);
  b.type = 'button';
  b.addEventListener('click', () => { audio.play('ui.click'); onClick(); });
  return b;
};

function overlay(className, title) {
  const root = h('div', `${className}-root hud`);
  const panel = h('div', `${className}-panel hud-panel`);
  panel.append(h('div', `${className}-title hud-label`, title));
  root.append(panel);
  return { root, panel };
}

/** Opens the settings overlay. Returns a close() function. */
export function openSettings({ onClose } = {}) {
  if (settingsEl) return close;
  const s = save.load();
  const { root, panel } = overlay('settings', 'Settings');

  const row = (label, control, hint) => {
    const r = h('label', 'settings-row');
    const l = h('span', 'settings-label', label);
    if (hint) l.append(h('small', 'settings-hint', hint));
    r.append(l, control);
    panel.append(r);
    return r;
  };
  const range = (key, min, max, step, fallback, format, apply) => {
    const wrap = h('span', 'settings-range');
    const i = h('input');
    i.type = 'range';
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(s[key] ?? fallback);
    const out = h('span', 'settings-out', format(Number(i.value)));
    i.addEventListener('input', () => {
      const v = Number(i.value);
      out.textContent = format(v);
      save.update({ [key]: v });
      apply?.(v);
    });
    wrap.append(i, out);
    return wrap;
  };
  const check = (key, apply) => {
    const i = h('input', 'settings-check');
    i.type = 'checkbox';
    i.checked = !!s[key];
    i.addEventListener('change', () => { save.update({ [key]: i.checked }); apply?.(i.checked); });
    return i;
  };
  const choice = (key, options, fallback, apply) => {
    const wrap = h('span', 'settings-choice');
    const buttons = options.map((o) => {
      const b = h('button', 'settings-option', o.toUpperCase());
      b.type = 'button';
      b.setAttribute('aria-pressed', String((s[key] ?? fallback) === o));
      b.addEventListener('click', () => {
        buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        save.update({ [key]: o });
        apply?.(o);
      });
      return b;
    });
    wrap.append(...buttons);
    return wrap;
  };

  row('Mouse sensitivity', range('sensitivity', 0.2, 3, 0.1, 1, (v) => `${v.toFixed(1)}×`), 'cockpit and EVA look');
  row('Invert Y', check('invertY'));
  row('Graphics quality', choice('quality', ['high', 'low'], 'high', (q) => graphics.setQuality(q)), 'low: no lens effects, fewer pixels');
  row('Volume', range('volume', 0, 1, 0.05, 1, (v) => `${Math.round(v * 100)} %`, (v) => audio.setVolume(v)));
  row('Skip sensitive scenes', check('skipSensitive'), 'the Adrift ending simply runs out of air');

  const danger = h('div', 'settings-danger');
  const reset = button('RESET SAVE', () => {
    if (reset.dataset.armed !== '1') {
      reset.dataset.armed = '1';
      reset.textContent = 'CLICK AGAIN TO ERASE EVERYTHING';
      reset.classList.add('hud-alert');
      return;
    }
    save.reset();
    economy.reset();
    audio.play('ui.error');
    close();
  });
  danger.append(reset, h('span', 'settings-hint', 'Money, blueprints and progress go back to the start.'));
  const actions = h('div', 'settings-actions');
  actions.append(button('CLOSE  [Esc]', () => close(), 'settings-close'));
  panel.append(danger, actions);

  settingsEl = ui.mountPersistent(root);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  input.onEscape(() => close()); // the caller restores its own Esc handler in onClose

  function close() {
    if (!settingsEl) return;
    ui.unmount(settingsEl);
    settingsEl = null;
    onClose?.();
  }
  return close;
}

/** Opens the Esc pause menu. Returns a close() function. */
export function openPauseMenu({ onResume } = {}) {
  if (pauseEl) return close;
  const { root, panel } = overlay('pause', 'Paused');
  const buttons = h('div', 'pause-buttons');
  buttons.append(
    button('RESUME  [Esc]', () => close(), 'pause-primary'),
    button('GUIDEBOOK', () => events.emit('guidebook:open', { entryId: 'newtons-laws' })),
    button('SETTINGS', () => openSettings({ onClose: () => input.onEscape(() => close()) })),
    button('QUIT TO MENU', () => location.reload(), 'pause-quit'),
  );
  panel.append(buttons, h('div', 'pause-hint', 'Quitting keeps your money, blueprints and progress.'));
  pauseEl = ui.mountPersistent(root);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  input.onEscape(() => close());

  function close() {
    if (!pauseEl) return;
    ui.unmount(pauseEl);
    pauseEl = null;
    onResume?.();
  }
  return close;
}
