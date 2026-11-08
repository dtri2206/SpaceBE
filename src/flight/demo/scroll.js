// The memorial scroll: a full-screen overlay (parchment that unrolls over a starfield) shown at the end of the pitch.
// Ported from the approved mockup. Pure data/schedule helpers are exported for tests; the DOM part is browser-only.

import { cue as audioCue, playLine } from './audio.js'; // memorial music + the narrator, timed to the paper

export const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap';
export const PHOTO_SRC = '/assets/tributes/soyuz1-komarov.jpg';

export const SCROLL_TEXT = {
  top: 'IN MEMORIAM',
  coincidence: 'Your parachute failed. On 24 April 1967, his did too.',
  name: 'Vladimir Komarov',
  sub: 'Soyuz 1 · 24 April 1967',
  family: 'He left behind his wife, Valentina, and their children, Yevgeny and Irina.',
  story: [
    'A solar panel failed to open. Power and control slipped away.',
    'Ordered home early, Soyuz 1 fell into a steep re-entry.',
    'The main parachute never came out. The reserve tangled.',
  ],
  stats: [
    { num: '1st', label: 'person to die during a spaceflight' },
    { num: '0', label: 'main parachutes opened' },
    { num: '18 months', label: 'before Soyuz flew a crew again', long: true },
  ],
  lesson: 'Engineers wanted one more test flight. Soyuz 1 flew without it.',
  ornament: '❦',
  closing: 'In this game, you can press Try again. He could not.',
  credit: 'Valentin Cheredintsev / TASS · CC BY 4.0',
  hint: 'Hold C + R + 7 to replay',
  audioCredit: 'Voices, sound effects and music: ElevenLabs (elevenlabs.io)',
};

// The narrator reads these as their line fades in on the paper (the --i index of lineOrder; lines queue, never overlap).
export const NARRATION = Object.freeze([
  { line: 'n_komarov', i: 3 }, // the name
  { line: 'n_family', i: 4 },
  { line: 'n_testflight', i: 11 }, // the lesson
  { line: 'n_tryagain', i: 13 }, // the closing line
]);

export const TIMINGS = { unrollMs: 1600, lineStartMs: 1300, lineStepMs: 300, lineFadeMs: 600, scrollMs: 15000 };

// Fade-in order (the --i index of each element in the mockup).
export function lineOrder() {
  const T = SCROLL_TEXT;
  return [
    { i: 0, text: T.top },
    { i: 1, text: T.credit }, // the photo
    { i: 2, text: T.coincidence },
    { i: 3, text: T.name },
    { i: 4, text: T.sub },
    { i: 4, text: T.family },
    { i: 5, text: T.story[0] },
    { i: 6, text: T.story[1] },
    { i: 7, text: T.story[2] },
    { i: 8, text: T.stats[0].num },
    { i: 9, text: T.stats[1].num },
    { i: 10, text: T.stats[2].num },
    { i: 11, text: T.lesson },
    { i: 13, text: T.ornament },
    { i: 13, text: T.closing },
  ];
}

export const lineDelayMs = (i, t = TIMINGS) => t.lineStartMs + i * t.lineStepMs;
export const revealEndMs = (t = TIMINGS) => Math.max(...lineOrder().map((l) => lineDelayMs(l.i, t))) + t.lineFadeMs;

/** When the slow auto-scroll starts and how far it goes. Reduced motion: no unroll, starts almost at once. */
export function scrollSchedule({ contentHeight, viewHeight, reducedMotion = false, t = TIMINGS } = {}) {
  const distance = Math.max(0, Math.round(contentHeight - viewHeight));
  return { startMs: reducedMotion ? 500 : revealEndMs(t), durationMs: t.scrollMs, distance };
}

/** Scroll offset at `elapsedMs` after the auto-scroll starts (ease in-out, clamped to [0, distance]). */
export function scrollOffset(elapsedMs, { distance, durationMs }) {
  if (distance <= 0 || durationMs <= 0) return 0;
  const p = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
  return Math.round(distance * e);
}

// ---- browser part ----

function h(tag, cls, text, style) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (style) n.style.cssText = style;
  return n;
}
const r = (tag, cls, text, i) => h(tag, `${cls} r`, text, `--i:${i}`);

function ensureFonts() {
  if (document.querySelector('link[data-bm-fonts]')) return;
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://fonts.googleapis.com';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  link.dataset.bmFonts = '1';
  document.head.append(pre, link);
}

function drawStars(c) {
  const w = (c.width = innerWidth);
  const hh = (c.height = innerHeight);
  const x = c.getContext('2d');
  if (!x) return;
  const g = x.createRadialGradient(w * 0.5, hh * 0.35, 0, w * 0.5, hh * 0.5, Math.max(w, hh) * 0.8);
  g.addColorStop(0, '#10122a');
  g.addColorStop(1, '#05060d');
  x.fillStyle = g;
  x.fillRect(0, 0, w, hh);
  x.fillStyle = '#e9e4d6';
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 140; k++) {
    const a = rnd(); const b = rnd(); const q = rnd();
    x.globalAlpha = 0.25 + q * 0.6;
    x.beginPath();
    x.arc(a * w, b * hh, 0.4 + q * 1.3, 0, 7);
    x.fill();
  }
  x.globalAlpha = 1;
}

/**
 * Shows the scroll. Returns dispose(). onDone() is called once, when the auto-scroll reaches the bottom.
 * fadeIn (ms): fade the whole overlay in instead of appearing at once (the pitch's return home hands over this way).
 */
export function showMemorialScroll({ onDone, fadeIn = 0 } = {}) {
  const T = SCROLL_TEXT;
  ensureFonts();
  import('./scroll.css');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = h('div', 'bm-scroll');
  root.dataset.block = 'memorial-scroll';
  const bg = h('canvas');
  bg.id = 'bm-bg';
  const wrap = h('div', 'wrap');
  const sheet = h('div', 'sheet');
  const reveal = h('div', 'reveal');
  const paper = h('div', 'paper');
  const content = h('div', 'content');

  const hero = h('div', 'hero');
  const fig = r('figure', 'photo-col', undefined, 1);
  const img = h('img', 'photo');
  img.src = PHOTO_SRC;
  img.alt = T.name;
  fig.append(img, h('figcaption', '', T.credit));
  const col = h('div');
  const story = h('ul', 'story');
  T.story.forEach((s, k) => story.append(r('li', '', s, 5 + k)));
  col.append(
    r('p', 'coinc', T.coincidence, 2),
    r('h1', '', T.name, 3),
    r('p', 'sub', T.sub, 4),
    r('p', 'family', T.family, 4),
    story,
  );
  hero.append(fig, col);

  const stats = h('div', 'stats');
  T.stats.forEach((s, k) => {
    const st = r('div', `stat${s.long ? ' long' : ''}`, undefined, 8 + k);
    st.append(h('span', 'num', s.num), h('span', 'lbl', s.label));
    stats.append(st);
  });
  const orn = r('div', 'orn', T.ornament, 13);
  orn.setAttribute('aria-hidden', 'true');
  const credit = r('p', 'audio-credit', T.audioCredit, 13);
  credit.style.cssText += ';margin:2.4em 0 0;text-align:center;font-size:12px;letter-spacing:.04em;opacity:.62';
  content.append(r('p', 'top', T.top, 0), hero, stats, r('p', 'lesson', T.lesson, 11), orn, r('p', 'closing', T.closing, 13), credit);
  paper.append(content);
  reveal.append(paper);
  sheet.append(reveal, h('div', 'roll'));
  wrap.append(sheet);
  root.append(bg, wrap, h('div', 'bm-hint', T.hint));
  if (fadeIn > 0) { root.style.opacity = '0'; root.style.transition = `opacity ${fadeIn}ms ease`; }
  document.body.append(root);
  if (fadeIn > 0) { void root.offsetWidth; root.style.opacity = '1'; } // fades in from the dark starfield, then unrolls as designed

  // sound: the memorial music, then the narrator as the lines appear (after the fade-in and the unroll)
  audioCue('scroll');
  const lead = (fadeIn > 0 ? fadeIn : 0) / 1000;
  for (const n of NARRATION) playLine(n.line, { delay: lead + (reduced ? 0.6 : lineDelayMs(n.i) / 1000) });

  const onResize = () => drawStars(bg);
  drawStars(bg);
  addEventListener('resize', onResize);
  if (!reduced) root.classList.add('animate');

  let alive = true;
  let userTook = false;
  let done = false;
  let timer = null;
  let tick = null;
  const finish = () => { if (done || !alive) return; done = true; onDone?.(); };
  const atBottom = () => root.scrollTop >= root.scrollHeight - root.clientHeight - 2;
  const stopAuto = () => { userTook = true; clearInterval(tick); };
  for (const ev of ['wheel', 'touchmove', 'pointerdown']) root.addEventListener(ev, stopAuto, { passive: true });
  root.addEventListener('scroll', () => { if (userTook && atBottom()) finish(); });

  const sch = scrollSchedule({ contentHeight: 0, viewHeight: 0, reducedMotion: reduced });
  timer = setTimeout(() => {
    if (!alive || userTook) return;
    const s = scrollSchedule({ contentHeight: root.scrollHeight, viewHeight: root.clientHeight, reducedMotion: reduced });
    if (s.distance <= 0) return finish();
    const t0 = performance.now();
    tick = setInterval(() => {
      if (!alive || userTook) return clearInterval(tick);
      const el = performance.now() - t0;
      root.scrollTop = scrollOffset(el, s);
      if (el >= s.durationMs) { clearInterval(tick); finish(); }
    }, 16);
  }, sch.startMs);

  return () => {
    alive = false;
    clearTimeout(timer);
    clearInterval(tick);
    removeEventListener('resize', onResize);
    root.remove();
  };
}
