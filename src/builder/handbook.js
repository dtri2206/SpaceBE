// The engineer's handbook: chapters for ordinary readers on the left page, the player's own notes on the right.
import { save } from '/src/core/index.js';
import handbook from './data/handbook.json';

const h = (tag, className, textContent) => Object.assign(document.createElement(tag), { className: className ?? '', textContent: textContent ?? '' });

export function createHandbook({ parent }) {
  const root = h('div', 'hb-root');
  const left = h('div', 'hb-page hb-page--left');
  const right = h('div', 'hb-page hb-page--right');
  const nav = h('nav', 'hb-nav');
  const content = h('div', 'hb-content');
  left.append(h('div', 'hb-page-label', "Engineer's handbook"), nav, content);
  const notesLabel = h('div', 'hb-page-label', 'My notes');
  const notes = h('textarea', 'hb-notes');
  notes.placeholder = 'What worked, what did not, what to try next mission…';
  notes.value = save.load().builderNotes ?? '';
  notes.addEventListener('input', () => save.update({ builderNotes: notes.value }));
  const savedHint = h('div', 'hb-hint', 'Saved with your agency as you type.');
  right.append(notesLabel, notes, savedHint);
  root.append(left, right);
  parent.append(root);

  let current = handbook.chapters[0]?.id;
  function show(id) {
    current = id;
    const chapter = handbook.chapters.find((c) => c.id === id);
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.chapter === id)));
    content.replaceChildren(h('h3', 'hb-title', chapter?.title ?? ''), ...(chapter?.paragraphs ?? []).map((p) => h('p', 'hb-paragraph', p)));
    content.scrollTop = 0;
  }
  for (const c of handbook.chapters) {
    const b = h('button', 'hb-chapter', c.title);
    b.type = 'button';
    b.dataset.chapter = c.id;
    b.addEventListener('click', () => show(c.id));
    nav.append(b);
  }
  show(current);

  return { el: root, show, dispose: () => root.remove() };
}
