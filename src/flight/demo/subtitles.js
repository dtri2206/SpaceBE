// Pitch demo subtitles: bottom-centre, large, white on a dark translucent band, speaker label in small caps; they fade.
// Mode 'scroll' (the memorial scroll): only the narrator is shown, small (the paper already carries the text).
// Also the small "message from home" card. Browser only, but safe to import in Node (nothing runs at import).
let root = null;
let band = null;
let label = null;
let text = null;
let card = null;
let currentId = null;
let mode = 'normal';
let hideTimer = null;

function ensure() {
  if (root || typeof document === 'undefined') return !!root;
  import('./subtitles.css');
  root = document.createElement('div');
  root.className = 'dsub-root';
  band = document.createElement('div');
  band.className = 'dsub';
  label = document.createElement('div');
  label.className = 'dsub-who';
  text = document.createElement('div');
  text.className = 'dsub-text';
  band.append(label, text);
  root.append(band);
  card = document.createElement('div');
  card.className = 'dsub-card';
  document.body.append(root, card);
  return true;
}

export function setSubtitleMode(value) {
  mode = value === 'scroll' ? 'scroll' : 'normal';
  if (root) root.classList.toggle('dsub-small', mode === 'scroll');
}

/** Shows a line: { id, speaker, voice, text }. In scroll mode only the narrator shows (small). */
export function showSubtitle({ id, speaker, voice, text: line }) {
  if (mode === 'scroll' && voice !== 'narrator') return;
  if (!ensure()) return;
  clearTimeout(hideTimer);
  currentId = id;
  label.textContent = speaker ?? '';
  text.textContent = line ?? '';
  band.classList.toggle('dsub-home', speaker === 'HOME');
  root.classList.add('on');
}

/** Hides the subtitle if it still shows line `id` (a newer line keeps it up). */
export function hideSubtitle(id) {
  if (!root || (id && id !== currentId)) return;
  currentId = null;
  root.classList.remove('on');
}

export function clearSubtitles() {
  currentId = null;
  if (root) root.classList.remove('on');
  hideCard();
}

export function showCard(title) {
  if (!ensure()) return;
  card.textContent = title;
  card.classList.add('on');
}

export function hideCard() { card?.classList.remove('on'); }
