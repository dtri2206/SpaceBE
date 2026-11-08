// Role 4 Guidebook (spec §13): short fact cards with real numbers and a source, from entries.json.
// guidebook:open { entryId } shows one card in the corner without blocking the game (the player is usually walking
// with the mouse locked); Q or Close closes it, and it hides itself after 20 s or on a state change.
// guidebook:open { entryId: 'index' } opens the whole Guidebook, grouped by category. Entries you have read are saved.
import { events, input, save, ui } from '/src/core/index.js';
import entries from './entries.json';
import { fatalTributes, showTribute, tributes } from '/src/story/index.js';
import './guidebook.css';

let overlay = null;
let offKey = null;
let timer = null;

function close() {
  if (overlay) ui.unmount(overlay);
  offKey?.();
  clearTimeout(timer);
  overlay = offKey = timer = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, onClick) {
  const b = el('button', 'hud-button', label);
  b.type = 'button';
  b.style.pointerEvents = 'auto';
  b.addEventListener('click', onClick);
  return b;
}

const seen = () => new Set(save.load().guidebookSeen ?? []);
function markSeen(id) {
  if (!entries[id]) return;
  const set = seen();
  if (set.has(id)) return;
  set.add(id);
  save.update({ guidebookSeen: [...set] });
}

/** The body of one entry: title, text, a "Real numbers" box and the source. */
function entryBody(entryId) {
  const entry = entries[entryId];
  const body = el('div', 'role4-guide-body');
  body.append(el('div', 'hud-label', `Guidebook · ${entry?.category ?? 'Entry'}`));
  body.append(el('div', 'hud-value', entry?.title ?? entryId));
  if (!entry) {
    console.warn(`[guidebook] no entry "${entryId}" in src/guidebook/entries.json`);
    body.append(el('div', null, 'This entry has not been written yet.'));
    return body;
  }
  body.append(el('div', 'role4-guide-text', entry.body));
  if (entry.numbers?.length) {
    const box = el('div', 'role4-guide-numbers');
    box.append(el('div', 'hud-label', 'Real numbers'));
    for (const line of entry.numbers) box.append(el('div', null, line));
    body.append(box);
  }
  if (entry.source) body.append(el('div', 'role4-guide-source', `Source: ${entry.source}`));
  markSeen(entryId);
  return body;
}

// Wall of Remembrance: every fatal tribute, always visible. Opening one shows the memorial in read-only mode.
const REMEMBER = 'Wall of Remembrance';
const wallItems = () => fatalTributes();
const wallTitle = ([, t]) => `${t.mission} · ${t.dateText}`;

function wallBody(id) {
  const t = tributes[id];
  const body = el('div', 'role4-guide-body');
  body.append(el('div', 'hud-label', `Guidebook · ${REMEMBER}`), el('div', 'hud-value', `${t.mission} · ${t.vehicle}`));
  body.append(el('div', 'role4-guide-text', `${t.dateText}. ${t.place}.`));
  body.append(el('div', 'role4-guide-text', t.crew.map((c) => c.name).join(', ')));
  body.append(button('Open memorial', () => showTribute(t, { readOnly: true, zIndex: 25 })));
  return body;
}

function card(entryId) {
  const panel = el('div', 'hud hud-panel role4-guide-card');
  panel.dataset.guidebook = entryId;
  panel.style.pointerEvents = 'none'; // only the buttons are clickable
  panel.append(entryBody(entryId));
  const row = el('div', 'role4-guide-row');
  row.append(button('Close [Q]', close), button('All entries', () => openIndex(entryId)));
  panel.append(row);
  return panel;
}

function openIndex(selected) {
  close();
  const panel = el('div', 'hud hud-panel role4-guide-index');
  panel.dataset.guidebook = 'index';
  const list = el('div', 'role4-guide-list');
  const view = el('div', 'role4-guide-view');
  const read = seen();
  const byCategory = {};
  for (const [id, entry] of Object.entries(entries)) (byCategory[entry.category] ??= []).push([id, entry]);
  const show = (id) => {
    view.replaceChildren(id.startsWith('tribute:') ? wallBody(id.slice(8)) : entryBody(id));
    list.querySelectorAll('button').forEach((b) => b.classList.toggle('hud-ok', b.dataset.entry === id));
  };
  for (const [category, items] of Object.entries(byCategory)) {
    list.append(el('div', 'hud-label', category));
    for (const [id, entry] of items) {
      const b = el('button', 'role4-guide-link', `${read.has(id) ? '✓ ' : ''}${entry.title}`);
      b.type = 'button';
      b.dataset.entry = id;
      b.addEventListener('click', () => show(id));
      list.append(b);
    }
  }
  list.append(el('div', 'hud-label', REMEMBER));
  for (const item of wallItems()) {
    const b = el('button', 'role4-guide-link', wallTitle(item));
    b.type = 'button';
    b.dataset.entry = `tribute:${item[0]}`;
    b.addEventListener('click', () => show(`tribute:${item[0]}`));
    list.append(b);
  }
  const head = el('div', 'role4-guide-row');
  head.append(el('div', 'hud-value', 'Guidebook'), el('div', 'role4-guide-count hud-label', `${read.size} / ${Object.keys(entries).length} read`), button('Close [Q]', close));
  panel.append(head, el('div', 'role4-guide-split'));
  panel.lastChild.append(list, view);
  const wall = selected === 'remembrance' ? wallItems()[0] : null;
  show(wall ? `tribute:${wall[0]}` : entries[selected] ? selected : Object.keys(entries)[0]);
  overlay = ui.mount(panel);
  offKey = input.onPress('KeyQ', close);
}

export default {
  init() {
    events.on('guidebook:open', ({ entryId }) => {
      if (entryId === 'index') return openIndex();
      if (entryId === 'remembrance') return openIndex('remembrance');
      close();
      overlay = card(entryId);
      ui.mount(overlay, { layer: 'hud' }); // removed on the next state change
      overlay.style.pointerEvents = 'none';
      offKey = input.onPress('KeyQ', close); // input handlers are also cleared on state change
      timer = setTimeout(close, 20000);
    });
  },
};
