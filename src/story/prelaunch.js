// PRELAUNCH, the last calm moment at home. Three quiet steps: the mission brief, the photo you carry, the
// message home (sent when you launch). Both choices are saved (familyPhoto, messageHome) because the Adrift
// ending plays them back. From the 2nd visit in this session the ritual can be skipped:
// LAUNCH is then requested with { quickStart: true }, which Role 2's LAUNCH reads.
import { input, requestState, save, ui } from '/src/core/index.js';
import data from './data.json';
import { button, el } from './dom.js';
import { canQuickStart, finalMessage, quickStartData, scheduleBriefAdvance, stepIndex } from './prelaunchFlow.js';

let visits = 0; // PRELAUNCH entries this session

/** Mission patch drawn in SVG (no image files). */
function patchArt() {
  return `<svg viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="37" fill="#0b1a22" stroke="#67e8f9" stroke-width="1.5"/>
    <circle cx="40" cy="40" r="31" fill="none" stroke="#67e8f9" stroke-opacity="0.35" stroke-dasharray="2 3"/>
    <circle cx="40" cy="42" r="13" fill="#c4705a"/>
    <path d="M27 46 Q40 40 53 47" fill="none" stroke="#7a3d33" stroke-width="2"/>
    <path d="M14 58 Q40 22 66 30" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
    <circle cx="66" cy="30" r="2.6" fill="#fbbf24"/>
    <path d="M40 8 l1.6 4 4 .3 -3 2.7 1 4 -3.6 -2.2 -3.6 2.2 1 -4 -3 -2.7 4 -.3z" fill="#d9f4f7" transform="scale(.8) translate(10 -1)"/>
  </svg>`;
}

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
  visits += 1;
  const saved = save.load();
  const quick = canQuickStart({ visits, saved });
  let chosen = data.photos.some((p) => p.id === saved.familyPhoto) ? saved.familyPhoto : data.photos[0].id;
  let step = 'brief'; // 'brief' | 'photo' | 'message'
  let launched = false;
  let cancelBrief = () => {};

  const root = el('div', 'role4-screen role4-prelaunch');
  root.dataset.screen = 'PRELAUNCH';
  root.dataset.step = step;
  const stage = el('div', 'role4-pl');
  root.append(stage);

  const launch = (quickStart) => {
    if (launched) return;
    launched = true;
    cancelBrief();
    save.update({ familyPhoto: chosen, messageHome: finalMessage(message.value, data.prelaunch.defaultMessage) });
    requestState('LAUNCH', quickStart ? quickStartData() : undefined);
  };

  /* ---- step 1: mission brief ---- */
  const brief = el('section', 'role4-pl-step role4-pl-brief');
  const patch = el('div', 'role4-pl-patch');
  patch.innerHTML = patchArt();
  const crew = el('ul', 'role4-pl-crew');
  data.halcyon.crew.forEach((c) => {
    const li = el('li');
    li.append(el('b', null, c.name), el('span', null, c.role));
    crew.append(li);
  });
  const dest = el('div', 'role4-pl-dest');
  dest.append(el('span', 'hud-label', data.prelaunch.destinationLabel), el('b', null, data.prelaunch.briefDestination));
  const crewBox = el('div', 'role4-pl-crewbox');
  crewBox.append(el('span', 'hud-label', data.prelaunch.crewLabel), crew);
  const briefRow = el('div', 'role4-row role4-pl-actions');
  brief.append(
    patch,
    el('div', 'hud-label role4-pl-label', data.prelaunch.briefLabel),
    el('div', 'role4-pl-lead role4-pl-fade', data.prelaunch.brief),
    crewBox, dest,
    el('div', 'role4-pl-quiet role4-pl-fade', data.prelaunch.briefAfter),
    briefRow,
  );

  /* ---- step 2: photo ---- */
  const photoStep = el('section', 'role4-pl-step');
  photoStep.append(el('div', 'hud-label', data.prelaunch.photoStep), el('div', 'role4-pl-title', data.prelaunch.photoTitle),
    el('div', 'role4-pl-quiet', data.prelaunch.photoHint));
  const photos = el('div', 'role4-photos');
  const paint = () => cards.forEach((c, j) => c.setAttribute('aria-pressed', String(data.photos[j].id === chosen)));
  const pick = (i) => { chosen = data.photos[i].id; save.update({ familyPhoto: chosen }); paint(); cards[i].focus({ preventScroll: true }); };
  const cards = data.photos.map((photo, i) => {
    const b = el('button', 'role4-photo');
    b.type = 'button';
    b.style.setProperty('--tilt', `${[-2.5, 1.5, -1][i]}deg`);
    b.innerHTML = photoArt(photo, i);
    b.append(el('b', null, photo.label), el('span', null, photo.caption));
    b.addEventListener('click', () => pick(i));
    photos.append(b);
    return b;
  });
  const photoRow = el('div', 'role4-row role4-pl-actions');
  photoStep.append(photos, photoRow);

  /* ---- step 3: message ---- */
  const messageStep = el('section', 'role4-pl-step');
  const message = el('textarea');
  message.placeholder = data.prelaunch.messagePlaceholder;
  message.maxLength = 400;
  message.rows = 5;
  message.value = saved.messageHome ?? '';
  message.setAttribute('aria-label', data.prelaunch.messageTitle);
  const msgRow = el('div', 'role4-row role4-pl-actions');
  messageStep.append(el('div', 'hud-label', data.prelaunch.messageStep), el('div', 'role4-pl-title', data.prelaunch.messageTitle),
    el('div', 'role4-pl-quiet', data.prelaunch.messageHint), message, msgRow);
  // Enter inside the text box is an HTML input event (game keys are blocked while typing).
  message.onkeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      launch(false);
    }
  };
  message.addEventListener('input', () => save.update({ messageHome: message.value }));

  /* ---- navigation ---- */
  const show = (next) => {
    cancelBrief();
    step = next;
    root.dataset.step = next;
    stage.replaceChildren({ brief, photo: photoStep, message: messageStep }[next]);
    if (next === 'photo') cards[data.photos.findIndex((p) => p.id === chosen)]?.focus({ preventScroll: true });
    if (next === 'message') message.focus({ preventScroll: true });
  };
  const nav = (label, onClick, primary) => {
    const b = button(label, onClick, { primary });
    return b;
  };
  const advance = () => {
    if (step === 'brief') show('photo');
    else if (step === 'photo') show('message');
    else launch(false);
  };

  if (quick) {
    const carried = data.photos.find((p) => p.id === chosen) ?? data.photos[0];
    const mine = el('div', 'role4-pl-carry role4-pl-fade');
    mine.append(el('span', 'hud-label', data.prelaunch.carrying), el('b', null, `${carried.label}`),
      el('span', 'role4-pl-quiet', `"${finalMessage(saved.messageHome, data.prelaunch.defaultMessage)}"`));
    brief.insertBefore(mine, briefRow);
    briefRow.append(
      nav(data.prelaunch.skip, () => launch(true), true),
      nav(data.prelaunch.change, () => show('photo'), false),
    );
  } else {
    briefRow.append(nav(data.prelaunch.continue, () => show('photo'), true));
  }
  photoRow.append(nav(data.prelaunch.back, () => show('brief'), false), nav(data.prelaunch.continue, () => show('message'), true));
  msgRow.append(nav(data.prelaunch.back, () => show('photo'), false), nav(data.prelaunch.launch, () => launch(false), true));

  // Enter continues (a quick start skips straight to the countdown on the brief). Debounced: a focused
  // button also turns Enter into a click, and that must not advance twice.
  let last = 0;
  input.onPress('Enter', () => {
    const now = performance.now();
    if (now - last < data.prelaunch.enterDebounceMs || launched) return;
    last = now;
    // Suppress the focused button's native Enter click after moving to the next step.
    if (root.contains(document.activeElement)) document.activeElement.blur();
    if (step === 'brief' && quick) launch(true);
    else advance();
  });
  const arrow = (d) => () => { if (step === 'photo') pick(stepIndex(data.photos.findIndex((p) => p.id === chosen), d, data.photos.length)); };
  input.onPress('ArrowLeft', arrow(-1));
  input.onPress('ArrowRight', arrow(1));
  data.photos.forEach((_, i) => input.onPress(`Digit${i + 1}`, () => step === 'photo' && pick(i)));

  paint();
  show('brief');
  cancelBrief = scheduleBriefAdvance({ quick, delayMs: data.prelaunch.briefDurationMs, onAdvance: () => show('photo') });
  ui.mount(root);
  return () => { cancelBrief(); launched = true; };
}
