// PRELAUNCH (spec §3): choose the family photo you carry and write a message home, then launch.
// Both are saved (familyPhoto, messageHome) because the Adrift ending plays them back.
import { requestState, save, ui } from '/src/core/index.js';
import data from './data.json';
import { button, el } from './dom.js';

/** A small drawn photo: sky, ground, and one or two figures. No image files needed. */
function photoArt(photo, index) {
  const [sky, ground] = photo.colors;
  const people = index === 2 ? [[34, 1], [52, 0.55]] : index === 1 ? [[50, 1]] : [[40, 1], [58, 0.95]];
  const figures = people
    .map(([x, s]) => `<g transform="translate(${x} ${62 - 28 * s}) scale(${s})" fill="#1e1b22" opacity="0.82">
        <circle cx="0" cy="0" r="5"/><path d="M-7 30 Q-7 8 0 7 Q7 8 7 30 Z"/></g>`)
    .join('');
  return `<svg viewBox="0 0 100 75" aria-hidden="true">
    <defs><linearGradient id="sky${index}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#fff6e8"/></linearGradient></defs>
    <rect width="100" height="75" fill="url(#sky${index})"/>
    <circle cx="78" cy="18" r="8" fill="#fff3c4" opacity="0.9"/>
    <path d="M0 60 Q30 52 60 58 T100 56 V75 H0 Z" fill="${ground}"/>
    ${figures}
  </svg>`;
}

export function showPrelaunch() {
  const saved = save.load();
  let chosen = saved.familyPhoto ?? data.photos[0].id;

  const root = el('div', 'role4-screen');
  root.dataset.screen = 'PRELAUNCH';
  const card = el('div', 'hud hud-panel role4-card');
  root.append(card);

  card.append(el('div', 'hud-label', 'Pre-launch · T minus 2 hours'));
  card.append(el('div', 'role4-title', 'Before you go'));
  card.append(el('div', 'role4-text', data.prelaunch.brief));

  card.append(el('div', 'hud-label', 'The photo you carry'));
  const photos = el('div', 'role4-photos');
  const cards = data.photos.map((photo, i) => {
    const b = el('button', 'role4-photo');
    b.type = 'button';
    b.style.setProperty('--tilt', `${[-2.5, 1.5, -1][i]}deg`);
    b.innerHTML = photoArt(photo, i);
    b.append(el('b', null, photo.label), el('span', null, photo.caption));
    b.addEventListener('click', () => {
      chosen = photo.id;
      save.update({ familyPhoto: chosen });
      cards.forEach((c, j) => c.setAttribute('aria-pressed', String(data.photos[j].id === chosen)));
    });
    b.setAttribute('aria-pressed', String(photo.id === chosen));
    photos.append(b);
    return b;
  });
  card.append(photos);

  card.append(el('div', 'hud-label', 'Message home'));
  const message = el('textarea');
  message.placeholder = data.prelaunch.messagePlaceholder;
  message.maxLength = 400;
  message.value = saved.messageHome ?? '';
  message.addEventListener('input', () => save.update({ messageHome: message.value }));
  card.append(message);

  const row = el('div', 'role4-row');
  row.append(button('Launch', () => {
    save.update({ familyPhoto: chosen, messageHome: message.value.trim() || data.prelaunch.defaultMessage });
    requestState('LAUNCH');
  }, { key: 'Enter', primary: true }));
  row.append(el('span', 'role4-muted', 'Your message is sent when you launch.'));
  card.append(row);

  save.update({ familyPhoto: chosen });
  ui.mount(root);
}
