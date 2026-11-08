// The big explanation card (Role 1, card agent). It opens in the middle of the design page when the player clicks a
// part (on the ship or in the card column), a shape, a piece inside a part, a choice, a launch complex, a piece of
// pad equipment or a skin material. Large, calm type in English or Vietnamese (EN | VI in its header, i18n.js).
// Three blocks: (1) what it does and why the ship needs it, (2) how it works inside (a turning 3D view pulled apart,
// each piece numbered, named and explained, with its choices), (3) its numbers in everyday words, compared with what
// is fitted now. Then the price and one button (INSTALL / USE THIS / CHOOSE). It explains and installs; tuning an
// installed part stays in the card column on the right.
//
// createPartCard(ctx) → { el, open(target), close(), refresh(), isOpen, update(dt) }
// Targets: { kind: 'part', def, part? }  { kind: 'option', def, slot, option, part? }  { kind: 'shape', section, shape }
//          { kind: 'pad', pad }  { kind: 'equip', key, option? }  { kind: 'hull', section, material }
//          Any target may carry `action: { kind, run, tool }` for its main button; designPage adds the rest.
// No 3D or JSON imports, so Node can test it with a small DOM stub: the turning view comes from ctx.icons.preview()
// and ctx.icons.partModel() (partIcons.js), the explanations from ctx.explainFor (explain.js).
import { getLang, onLang, setLang } from './i18n.js';
import {
  compareWords, effectWords, heatWords, kNValue, labelFor, massValue, massWords, MEANINGS, metres, moneyShown, moneyValue, num, numbersFor, pctValue,
  pressureWords, priceWords, sizeWords, thrustWords, weatherWords,
} from './everyday.js';

/** The card's own words, in both languages. */
export const CARD_TEXT = {
  close: { en: 'Close', vi: 'Đóng' },
  lang: { en: 'Language', vi: 'Ngôn ngữ' },
  b1: { en: 'What it does and why you need it', vi: 'Nó làm gì và vì sao cần nó' },
  b1option: { en: 'What this piece does', vi: 'Mảnh này làm gì' },
  b1shape: { en: 'What this shape is', vi: 'Hình dáng này là gì' },
  b1equip: { en: 'What it does and why the pad needs it', vi: 'Nó làm gì và vì sao bệ phóng cần nó' },
  what: { en: 'What it does', vi: 'Nó làm gì' },
  whatShape: { en: 'What it is', vi: 'Nó là gì' },
  why: { en: 'Why you need it', vi: 'Vì sao cần nó' },
  without: { en: 'Without it, or with a cheap one', vi: 'Nếu thiếu nó, hoặc dùng loại rẻ' },
  analogy: { en: 'Think of it like this', vi: 'Hãy hình dung thế này' },
  thisChoice: { en: 'This choice', vi: 'Lựa chọn này' },
  good: { en: 'Good at', vi: 'Điểm mạnh' },
  bad: { en: 'Weak at', vi: 'Điểm yếu' },
  real: { en: 'The real thing', vi: 'Ngoài đời thật' },
  b2: { en: 'How it works inside', vi: 'Bên trong hoạt động thế nào' },
  b2option: { en: 'Where it sits, and the other choices', vi: 'Nó nằm ở đâu, và các lựa chọn khác' },
  b2shape: { en: 'What it is made of', vi: 'Nó gồm những gì' },
  b2equip: { en: 'The choices', vi: 'Các lựa chọn' },
  b2pad: { en: 'What comes with it', vi: 'Đi kèm những gì' },
  pieces: { en: 'The pieces inside', vi: 'Các mảnh bên trong' },
  onePiece: { en: 'This part is one solid piece: there is nothing inside to choose.', vi: 'Bộ phận này là một khối liền: bên trong không có gì để chọn.' },
  turnHint: { en: 'Drag the picture to turn it. Click a piece below to light it up.', vi: 'Kéo hình để xoay. Bấm vào một mảnh bên dưới để tô sáng nó.' },
  loading: { en: 'Getting the 3D view ready…', vi: 'Đang chuẩn bị hình 3D…' },
  now: { en: 'Now', vi: 'Đang dùng' },
  installFirst: { en: 'Install the part first; then you can choose each piece.', vi: 'Hãy lắp bộ phận này vào tàu trước, rồi mới chọn được từng mảnh.' },
  same: { en: 'Same numbers as the one fitted now.', vi: 'Số liệu giống cái đang dùng.' },
  b3: { en: 'The numbers in plain words', vi: 'Các con số nói bằng lời dễ hiểu' },
  compare: { en: 'Compared with what is on your ship now', vi: 'So với cái đang lắp trên tàu' },
  price: { en: 'Price', vi: 'Giá' },
  perEngine: { en: 'per engine', vi: 'mỗi động cơ' },
  forAll: { en: 'for all', vi: 'cho cả' },
  free: { en: 'Free', vi: 'Miễn phí' },
  // the main button and the tags that replace it
  install: { en: 'INSTALL', vi: 'LẮP VÀO' },
  swap: { en: 'SWAP', vi: 'THAY' },
  use: { en: 'USE THIS', vi: 'DÙNG CÁI NÀY' },
  useShape: { en: 'USE THIS SHAPE', vi: 'DÙNG HÌNH DÁNG NÀY' },
  useSkin: { en: 'USE THIS SKIN', vi: 'DÙNG VỎ NÀY' },
  choose: { en: 'CHOOSE', vi: 'CHỌN' },
  installed: { en: 'INSTALLED ON YOUR SHIP', vi: 'ĐÃ LẮP TRÊN TÀU' },
  fitted: { en: 'FITTED NOW', vi: 'ĐANG DÙNG' },
  inUse: { en: 'IN USE', vi: 'ĐANG DÙNG' },
  chosen: { en: 'CHOSEN', vi: 'ĐÃ CHỌN' },
  // kickers
  shape: { en: 'Shape', vi: 'Hình dáng' },
  skin: { en: 'Outer skin', vi: 'Lớp vỏ ngoài' },
  inside: { en: 'Inside the', vi: 'Bên trong' },
  padKicker: { en: 'Launch pad · launch complex', vi: 'Bệ phóng · khu phóng' },
  equipKicker: { en: 'Launch pad · equipment', vi: 'Bệ phóng · thiết bị' },
  sections: { nose: { en: 'Nose', vi: 'Mũi tàu' }, body: { en: 'Body', vi: 'Thân tàu' }, tail: { en: 'Tail', vi: 'Đuôi tàu' }, pad: { en: 'Launch pad', vi: 'Bệ phóng' } },
};
/** term: keys the content agent may write for the words under the numbers (the first one found is used). */
const TERM_KEYS = {
  thrust: ['term:thrust'], exhaust: ['term:isp', 'term:specific-impulse', 'term:exhaust-speed'], reliability: ['term:reliability'],
  power: ['term:power', 'term:electric-power'], propellant: ['term:propellant'], chute: ['term:drag', 'term:drag-area'], strength: ['term:max-q', 'term:maxq'],
};

const h = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};

/**
 * ctx: {
 *   explainFor(key) → { en, vi } | null       (explain.js)
 *   catalog, sections, g0, getMoney()        (catalogue for kits and shapes; g0 for thrust and Isp in words)
 *   icons                                    (partIcons: iconFor(def), preview(), partModel(def, { entry, options }))
 *   figuresOf(def, part?) → partFigures      (stats.js through designPage, with the part's material, options, cluster)
 *   diameterOf(def) → metres                 entryOf(partId) → layout entry      optionsOf(def, partOptions) → { slot: option }
 *   actionFor(target) → { kind, run, tool } | { status } | null   (what the main button does; run() returning false keeps the card)
 *   installedFor(def) → { def, part } | null  (the part fitted in the same place now, to compare with)
 *   currentOption(part, slot) → option        shapeFigures(section, shape) → { cost, mass, thrustSL, propellant, height }
 *   currentShape(sectionId) → shape | null    hullNow(sectionId) → material      padNow() → { site, equipment: [{ eq, option }] }
 *   onOpenTarget(target)                     (a link inside the card, e.g. a shape's part: defaults to opening it here)
 *   onSound(id), onOpen(), onClose()
 * }
 */
export function createPartCard(ctx = {}) {
  const L = () => (getLang() === 'vi' ? 'vi' : 'en');
  const t = (entry) => (entry ? entry[L()] ?? entry.en ?? '' : '');
  const T = (id) => t(CARD_TEXT[id]);
  /** An explanation entry in the current language, missing Vietnamese fields filled from English. */
  const explain = (key) => {
    const e = ctx.explainFor?.(key);
    if (!e) return null;
    return L() === 'vi' ? { ...(e.en ?? {}), ...(e.vi ?? {}) } : { ...(e.en ?? {}) };
  };
  /** An entry's fields in the current language only (never English under Vietnamese). */
  const own = (key) => { const e = ctx.explainFor?.(key); return e ? (L() === 'vi' ? e.vi ?? null : e.en ?? null) : null; };
  /** A name: the Vietnamese one when the entry has it, else the data's own (names may stay English). */
  const nameOf = (key, fallback) => (L() === 'vi' ? own(key)?.name : null) ?? fallback;
  /** Pros, cons, real, facts, short: the data's own in English; in Vietnamese only the entry's, else nothing (not mixed). */
  const listOf = (key, field, ownData) => (L() === 'en' ? ownData ?? null : own(key)?.[field] ?? null);
  const meaningOf = (id) => {
    for (const k of TERM_KEYS[id] ?? []) { const e = explain(k); if (e?.what) return e.what; }
    return MEANINGS[id] ? t(MEANINGS[id]) : null;
  };
  const sound = (id) => ctx.onSound?.(id);
  const g0 = () => ctx.g0;
  const budget = () => ctx.getMoney?.() ?? null;

  // ---------- frame ----------
  const el = h('div', 'pc-root');
  el.hidden = true;
  el.dataset.card = 'explain';
  const backdrop = h('div', 'pc-backdrop');
  backdrop.addEventListener('click', () => close());
  const card = h('article', 'pc-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const head = h('header', 'pc-head');
  const headImg = h('img', 'pc-head-img');
  headImg.alt = '';
  headImg.draggable = false;
  const headTxt = h('div', 'pc-head-txt');
  const kicker = h('div', 'pc-kicker');
  const title = h('h2', 'pc-title');
  const sub = h('p', 'pc-sub');
  headTxt.append(kicker, title, sub);
  const tools = h('div', 'pc-head-tools');
  const langBox = h('div', 'pc-lang');
  const langBtns = ['en', 'vi'].map((l) => {
    const b = h('button', 'pc-lang-btn', l.toUpperCase());
    b.type = 'button';
    b.dataset.lang = l;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (getLang() !== l) { setLang(l); sound('ui.click'); } });
    return b;
  });
  langBox.append(langBtns[0], h('span', 'pc-lang-sep', '|'), langBtns[1]);
  const closeBtn = h('button', 'pc-x', '✕');
  closeBtn.type = 'button';
  closeBtn.dataset.tool = 'closecard';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  tools.append(langBox, closeBtn);
  head.append(headImg, headTxt, tools);
  const body = h('div', 'pc-body');
  const foot = h('footer', 'pc-foot');
  card.append(head, body, foot);
  el.append(backdrop, card);

  // ---------- state ----------
  let target = null;
  let openSlot = null; // the piece whose choices are shown (and lit in the 3D view)
  let preview = null; // the turning view, made on first use
  let previewKey = '';
  let previewShown = false;
  let lastTargetKey = '';
  const offLang = onLang(() => { if (target) render(); });

  // HTML5 drag turns the 3D view (the pointer stream the static check allows outside core/input.js)
  let drag = null;
  const ghost = typeof document.createElement === 'function' ? document.createElement('canvas') : null;
  if (ghost) { ghost.width = 1; ghost.height = 1; }
  el.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    if (!e.clientX && !e.clientY) return;
    const dx = e.clientX - drag.x;
    if (dx) { preview?.rotateBy(dx); drag = { x: e.clientX }; }
  });
  el.addEventListener('drop', (e) => { if (drag) e.preventDefault(); });

  function ensurePreview() {
    if (preview || !ctx.icons?.preview) return preview;
    try { preview = ctx.icons.preview({ width: 720, height: 320 }); } catch { preview = null; }
    if (!preview?.canvas) return (preview = null);
    const c = preview.canvas;
    el.preview = preview; // for screenshots and debugging (state: explode, shell opacity)
    c.className = 'pc-3d';
    c.draggable = true;
    c.addEventListener('dragstart', (e) => {
      if (ghost) e.dataTransfer?.setDragImage?.(ghost, 0, 0);
      try { e.dataTransfer?.setData?.('text/plain', 'turn'); } catch { /* some browsers refuse */ }
      drag = { x: e.clientX };
    });
    c.addEventListener('dragend', () => { drag = null; });
    return preview;
  }

  // ---------- small builders ----------
  const para = (text, cls = 'pc-text') => h('p', cls, text);
  function block(n, heading) {
    const b = h('section', 'pc-block');
    b.dataset.block = String(n);
    const hd = h('h3', 'pc-block-head');
    hd.append(h('span', 'pc-block-num', String(n)), h('span', 'pc-block-title', heading));
    b.append(hd);
    return b;
  }
  function said(label, text, cls = '') {
    if (!text) return null;
    const w = h('div', `pc-said ${cls}`.trim());
    w.append(h('div', 'pc-said-label', label), para(text));
    return w;
  }
  function prosCons(pros = [], cons = []) {
    if (!pros?.length && !cons?.length) return null;
    const w = h('div', 'pc-proscons');
    const col = (label, list, cls) => {
      const c = h('div', `pc-pc ${cls}`);
      c.append(h('div', 'pc-said-label', label));
      const ul = h('ul', 'pc-list');
      for (const x of list ?? []) ul.append(h('li', null, x));
      c.append(ul);
      return c;
    };
    if (pros?.length) w.append(col(T('good'), pros, 'pc-pc--good'));
    if (cons?.length) w.append(col(T('bad'), cons, 'pc-pc--bad'));
    return w;
  }
  function numberRows(lines) {
    const w = h('div', 'pc-numbers');
    for (const ln of lines) {
      const r = h('div', 'pc-num');
      r.dataset.num = ln.id;
      const left = h('div', 'pc-num-left');
      left.append(h('div', 'pc-num-label', ln.label), h('div', 'pc-num-value', ln.value));
      if (ln.note) left.append(h('div', 'pc-num-note', ln.note));
      const right = h('div', 'pc-num-right');
      if (ln.words) right.append(para(ln.words, 'pc-num-words'));
      const m = ln.meaningId ? meaningOf(ln.meaningId) : ln.meaning;
      if (m) right.append(para(m, 'pc-num-meaning'));
      r.append(left, right);
      w.append(r);
    }
    return w;
  }
  function factList(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const ul = h('ul', 'pc-list pc-list--facts');
    for (const x of list) ul.append(h('li', null, x));
    return ul;
  }
  function compareBox(sentences, heading = T('compare')) {
    if (!sentences?.length) return null;
    const w = h('div', 'pc-compare');
    w.append(h('div', 'pc-said-label', heading));
    const ul = h('ul', 'pc-list pc-list--compare');
    for (const s of sentences) ul.append(h('li', null, s));
    w.append(ul);
    return w;
  }
  /** The main button (or the tag that replaces it) for a target: designPage's actionFor decides. */
  function actionButton(tg, { small = false, keepOpen = false } = {}) {
    const a = tg.action ?? ctx.actionFor?.(tg) ?? null;
    if (!a) return null;
    if (a.status) return h('span', `pc-status${small ? ' pc-status--small' : ''}`, T(a.status) || a.status);
    const label = T(a.kind) || a.label || T('install');
    const b = h('button', small ? 'pc-use' : 'vd-btn pc-action', label);
    b.type = 'button';
    if (a.tool) b.dataset.tool = small ? `card-${a.tool}` : a.tool;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = a.run?.();
      if (r === false) return;
      if (keepOpen) { sound('ui.snap'); render(); } else close();
    });
    return b;
  }
  const sectionId = (s) => (typeof s === 'string' ? s : s?.id ?? null);
  const sectionOf = (s) => (typeof s === 'string' ? ctx.sections?.[s] : s) ?? null;
  const sectionName = (id) => t(CARD_TEXT.sections[id]) || id || '';

  // ---------- the 3D block shared by parts and options ----------
  function modelKey(def, part, options) {
    return `${def.id}|${JSON.stringify(part?.engine ?? null)}|${part?.material ?? ''}|${Object.entries(options ?? {}).map(([k, o]) => `${k}:${o?.id}`).join(',')}`;
  }
  function show3d(def, part, options) {
    const p = ensurePreview();
    if (!p || !ctx.icons?.partModel) { previewShown = false; return null; }
    const key = modelKey(def, part, options);
    if (key !== previewKey) {
      previewKey = key;
      const entry = part ? ctx.entryOf?.(part.id) ?? null : null;
      try { p.set(ctx.icons.partModel(def, { entry, options }), { loading: T('loading') }); } catch { p.clear?.(); }
    }
    p.highlight(openSlot);
    previewShown = true;
    const w = h('div', 'pc-3d-wrap');
    w.append(p.canvas, h('div', 'pc-3d-hint', T('turnHint')));
    return w;
  }

  /** The numbered list of a part's pieces; each opens to show its choices with USE THIS. */
  function pieceList(def, part, kit, { only = null } = {}) {
    const list = h('ol', 'pc-pieces');
    const optsNow = part ? ctx.optionsOf?.(def, part.options) ?? {} : ctx.optionsOf?.(def, null) ?? {};
    kit.slots.forEach((slot, i) => {
      if (only && slot.key !== only) return;
      const li = h('li', `pc-piece${openSlot === slot.key ? ' pc-piece--open' : ''}`);
      li.dataset.piece = slot.key;
      const row = h('button', 'pc-piece-row');
      row.type = 'button';
      row.append(h('span', 'pc-piece-num', String(i + 1)));
      const txt = h('span', 'pc-piece-txt');
      const slotKey = `slot:${def.internals}/${slot.key}`;
      const ex = explain(slotKey);
      const cur = optsNow[slot.key] ?? slot.options[0];
      txt.append(h('span', 'pc-piece-name', nameOf(slotKey, slot.name)), h('span', 'pc-piece-what', ex?.what ?? (L() === 'en' ? slot.role : '') ?? ''));
      const now = h('span', 'pc-piece-now');
      now.append(h('span', 'pc-piece-now-k', T('now')), h('span', 'pc-piece-now-v', cur ? nameOf(`option:${def.internals}/${slot.key}/${cur.id}`, cur.name) : ''));
      row.append(txt, now, h('span', 'pc-piece-chev', openSlot === slot.key ? '▾' : '▸'));
      row.addEventListener('click', (e) => { e.stopPropagation(); openSlot = openSlot === slot.key ? null : slot.key; sound('ui.click'); render(); });
      li.append(row);
      if (openSlot === slot.key || only) li.append(choiceList(def, part, slot, cur));
      list.append(li);
    });
    return list;
  }
  function choiceList(def, part, slot, cur) {
    const w = h('div', 'pc-choices');
    if (!part) w.append(para(T('installFirst'), 'pc-muted'));
    const figNow = ctx.figuresOf?.(def, part) ?? null;
    for (const o of slot.options) {
      const c = h('div', `pc-choice${o.id === cur?.id ? ' pc-choice--on' : ''}`);
      c.dataset.choice = o.id;
      const top = h('div', 'pc-choice-top');
      const optKey = `option:${def.internals}/${slot.key}/${o.id}`;
      const name = h('button', 'pc-choice-name', nameOf(optKey, o.name));
      name.type = 'button';
      name.addEventListener('click', (e) => { e.stopPropagation(); sound('ui.click'); go({ kind: 'option', def, slot, option: o, part }); });
      top.append(name);
      if (part) { const a = actionButton({ kind: 'option', def, slot, option: o, part }, { small: true, keepOpen: true }); if (a) top.append(a); }
      c.append(top);
      const ex = explain(optKey);
      const what = ex?.what ?? (L() === 'en' ? o.note : null);
      if (what) c.append(para(what, 'pc-choice-what'));
      if (figNow && o.id !== cur?.id) {
        const then = ctx.figuresOf?.(def, { ...(part ?? {}), options: { ...(part?.options ?? {}), [slot.key]: o.id } });
        const fx = effectWords({ now: figNow, next: then, lang: L() });
        c.append(para(fx.length ? fx.join(' · ') : T('same'), 'pc-choice-fx'));
      }
      w.append(c);
    }
    return w;
  }

  // ---------- one view per kind ----------
  function viewPart(tg) {
    const { def } = tg;
    const part = tg.part ?? null;
    const fig = ctx.figuresOf?.(def, part) ?? null;
    const key = `part:${def.id}`;
    const ex = explain(key) ?? {};
    const sec = def.section;
    const fam = ctx.catalog?.families?.find?.((f) => f.id === def.family);
    const famName = fam ? nameOf(`family:${fam.id}`, fam.name) : '';
    const out = { kicker: [sectionName(sec), famName].filter(Boolean).join(' · '), title: nameOf(key, def.name), sub: ex.what && L() === 'en' ? (def.role ?? '') : '', img: ctx.icons?.iconFor?.(def) ?? '' };
    // 1
    const b1 = block(1, T('b1'));
    const famEx = explain(`family:${def.family}`);
    b1.append(...[
      said(T('what'), ex.what ?? (L() === 'en' ? def.role ?? def.desc : null) ?? famEx?.what ?? ''),
      said(T('why'), ex.why ?? (ex.what || L() !== 'en' ? null : def.detail ?? null)),
      said(T('without'), ex.without),
      said(T('analogy'), ex.analogy, 'pc-said--analogy'),
      prosCons(listOf(key, 'pros', def.pros), listOf(key, 'cons', def.cons)),
      said(T('real'), listOf(key, 'real', def.real), 'pc-said--real'),
    ].filter(Boolean));
    // 2
    const b2 = block(2, T('b2'));
    const kit = ctx.catalog?.kit?.(def) ?? null;
    const options = ctx.optionsOf?.(def, part?.options ?? null) ?? null;
    if (ex.inside) b2.append(para(ex.inside));
    const v = show3d(def, part, options);
    if (v) b2.append(v);
    if (kit?.slots?.length) b2.append(pieceList(def, part, kit));
    else b2.append(para(T('onePiece'), 'pc-muted'));
    // 3
    const b3 = block(3, T('b3'));
    const n = fig?.engine?.count ?? 1;
    b3.append(numberRows(withMeanings(numbersFor({ def, fig, g0: g0(), lang: L(), budget: budget(), diameter: ctx.diameterOf?.(def) ?? 0, count: n }))));
    const inst = tg.compareWith ?? (!part ? ctx.installedFor?.(def) : null);
    if (inst?.def && fig && inst.def.id !== def.id) {
      const now = ctx.figuresOf?.(inst.def, inst.part ?? null);
      b3.append(compareBox(compareWords({ now, next: fig, name: nameOf(`part:${inst.def.id}`, inst.def.name), g0: g0(), lang: L(), propellantNow: inst.def.fuel?.mass ?? 0, propellantNext: def.fuel?.mass ?? 0 })));
    }
    out.blocks = [b1, b2, b3];
    const note = def.engine && n <= 1 && !part ? T('perEngine') : n > 1 ? (L() === 'vi' ? `cho cả ${n} động cơ` : `for all ${n} engines`) : '';
    out.price = fig ? { value: fig.cost, note } : null;
    return out;
  }

  function viewOption(tg) {
    const { def, slot, option } = tg;
    const part = tg.part ?? null;
    const kit = ctx.catalog?.kit?.(def) ?? null;
    const cur = part ? ctx.currentOption?.(part, slot) ?? ctx.optionsOf?.(def, part.options)?.[slot.key] : slot.options[0];
    const slotKey = `slot:${def.internals}/${slot.key}`, optKey = `option:${def.internals}/${slot.key}/${option.id}`;
    const exSlot = explain(slotKey) ?? {};
    const exOpt = explain(optKey) ?? {};
    openSlot = slot.key;
    const partName = nameOf(`part:${def.id}`, def.name), slotName = nameOf(slotKey, slot.name);
    const out = { kicker: `${T('inside')} ${partName} · ${slotName}`, title: nameOf(optKey, option.name), sub: exSlot.what ?? (L() === 'en' ? slot.role : '') ?? '', img: ctx.icons?.iconFor?.(def) ?? '' };
    const b1 = block(1, T('b1option'));
    b1.append(...[
      said(T('thisChoice'), exOpt.what ?? (L() === 'en' ? option.note : null) ?? ''),
      said(T('why'), exSlot.why ?? null),
      said(T('without'), exSlot.without ?? null),
      said(T('analogy'), exOpt.analogy ?? exSlot.analogy ?? null, 'pc-said--analogy'),
      prosCons(listOf(optKey, 'pros', option.pros), listOf(optKey, 'cons', option.cons)),
      said(T('real'), listOf(optKey, 'real', option.real), 'pc-said--real'),
    ].filter(Boolean));
    const b2 = block(2, T('b2option'));
    const options = { ...(ctx.optionsOf?.(def, part?.options ?? null) ?? {}), [slot.key]: option };
    const v = show3d(def, part, options);
    if (v) b2.append(v);
    if (kit) b2.append(pieceList(def, part, kit, { only: slot.key }));
    const b3 = block(3, T('b3'));
    const figThen = ctx.figuresOf?.(def, { ...(part ?? {}), options: { ...(part?.options ?? {}), [slot.key]: option.id } }) ?? null;
    const figNow = ctx.figuresOf?.(def, part) ?? null;
    b3.append(numberRows(withMeanings(numbersFor({ def, fig: figThen, g0: g0(), lang: L(), budget: budget(), diameter: ctx.diameterOf?.(def) ?? 0 }))));
    if (cur && cur.id !== option.id && figNow && figThen) {
      const curName = nameOf(`option:${def.internals}/${slot.key}/${cur.id}`, cur.name);
      const subject = L() === 'vi' ? `${curName} đang dùng` : `the ${curName} fitted now`;
      b3.append(compareBox(compareWords({ now: figNow, next: figThen, subject, g0: g0(), lang: L() }).filter((s) => !/^About|^Nặng gần|^Giá gần/.test(s))));
    }
    out.blocks = [b1, b2, b3];
    const dc = figThen && figNow ? moneyShown(figThen.cost) - moneyShown(figNow.cost) : 0;
    const diff = Math.abs(dc) >= 1 ? ` (${dc > 0 ? '+' : '−'}${moneyValue(Math.abs(dc), L())})` : '';
    out.price = figThen ? { value: figThen.cost, note: L() === 'vi' ? `cả ${partName} với lựa chọn này${diff}` : `the whole ${partName} with this choice${diff}` } : null;
    return out;
  }

  function viewShape(tg) {
    const sid = sectionId(tg.section);
    const { shape } = tg;
    const key = `shape:${sid}/${shape.id}`;
    const ex = explain(key) ?? {};
    const pick = shape.icon ?? shape.stack?.find((x) => { const d = ctx.catalog?.get?.(x); return d?.flags?.capsule || d?.mounts || d?.fuel; }) ?? shape.stack?.[0];
    const iconDef = pick ? ctx.catalog?.get?.(pick) : null;
    const out = { kicker: `${sectionName(sid)} · ${T('shape')}`, title: nameOf(key, shape.name), sub: listOf(key, 'real', shape.real) ?? '', img: iconDef ? ctx.icons?.iconFor?.(iconDef) ?? '' : '' };
    const b1 = block(1, T('b1shape'));
    b1.append(...[
      said(T('whatShape'), ex.what ?? (L() === 'en' ? shape.desc : null) ?? ''),
      said(T('why'), ex.why ?? null),
      said(T('analogy'), ex.analogy ?? null, 'pc-said--analogy'),
      prosCons(listOf(key, 'pros', shape.pros), listOf(key, 'cons', shape.cons)),
    ].filter(Boolean));
    const b2 = block(2, T('b2shape'));
    const list = h('ul', 'pc-made');
    const row = (d, times = 1) => {
      const li = h('li', 'pc-made-item');
      const b = h('button', 'pc-made-btn');
      b.type = 'button';
      const im = h('img', 'pc-made-img');
      im.src = ctx.icons?.iconFor?.(d) ?? '';
      im.alt = '';
      im.draggable = false;
      const txt = h('span', 'pc-made-txt');
      const pex = explain(`part:${d.id}`);
      txt.append(h('span', 'pc-made-name', `${nameOf(`part:${d.id}`, d.name)}${times > 1 ? ` ×${times}` : ''}`), h('span', 'pc-made-what', pex?.what ?? (L() === 'en' ? d.role : '') ?? ''));
      b.append(im, txt, h('span', 'pc-piece-chev', '▸'));
      b.addEventListener('click', (e) => { e.stopPropagation(); sound('ui.click'); go({ kind: 'part', def: d }); });
      li.append(b);
      list.append(li);
    };
    (shape.stack ?? []).forEach((id, i) => {
      const d = ctx.catalog?.get?.(id);
      if (!d) return;
      const n = d.engine ? (ctx.catalog?.get?.(shape.stack[i - 1])?.mounts?.count ?? 1) : 1;
      row(d, n);
    });
    for (const r of shape.radial ?? []) { const d = ctx.catalog?.get?.(r.type); if (d) row(d, r.symmetry ?? 1); }
    b2.append(list);
    const b3 = block(3, T('b3'));
    const f = ctx.shapeFigures?.(tg.section, shape) ?? null;
    if (f) {
      const lines = [{ id: 'wet', label: labelFor('wet', L()), value: massValue(f.mass, L()), words: massWords(f.mass, L()) }];
      if (f.propellant > 0) lines.push({ id: 'propellant', label: labelFor('propellant', L()), value: massValue(f.propellant, L()), words: massWords(f.propellant, L()), meaningId: 'propellant' });
      if (f.thrustSL > 0) lines.push({ id: 'thrust', label: labelFor('thrust', L()), value: kNValue(f.thrustSL, L()), words: thrustWords(f.thrustSL, g0(), L()), meaningId: 'thrust' });
      if (f.height > 0) lines.push({ id: 'size', label: labelFor(f.diameter > 0 ? 'size' : 'height', L()), value: `${metres(f.height, L())}${f.diameter > 0 ? ` × ${metres(f.diameter, L())}` : ''}`, words: sizeWords({ height: f.height, diameter: f.diameter ?? 0 }, L()) });
      lines.push({ id: 'price', label: labelFor('price', L()), value: moneyValue(f.cost, L()), words: priceWords(f.cost, { budget: budget(), lang: L() }) });
      b3.append(numberRows(lines));
      const cur = ctx.currentShape?.(sid);
      if (cur && cur.id !== shape.id) {
        const fc = ctx.shapeFigures?.(tg.section, cur);
        if (fc) {
          const asFig = (x) => ({ mass: x.mass, cost: x.cost, reliability: NaN, power: 0, engine: x.thrustSL > 0 ? { thrustSL: x.thrustSL, totalThrustSL: x.thrustSL } : null });
          const curName = nameOf(`shape:${sid}/${cur.id}`, cur.name);
          const subject = L() === 'vi' ? `${curName} đang dùng` : `the ${curName} you have now`;
          b3.append(compareBox(compareWords({ now: asFig(fc), next: asFig(f), subject, g0: g0(), lang: L(), propellantNow: fc.propellant, propellantNext: f.propellant })));
        }
      }
      out.price = { value: f.cost, note: '' };
    }
    out.blocks = [b1, b2, b3];
    return out;
  }

  function viewHull(tg) {
    const sid = sectionId(tg.section);
    const m = tg.material;
    const key = `hull:${m.id}`;
    const ex = explain(key) ?? {};
    const out = { kicker: `${sectionName(sid)} · ${T('skin')}`, title: nameOf(key, m.name), sub: listOf(key, 'short', m.short) ?? '', img: ctx.skinIcon?.(m) ?? '' };
    const b1 = block(1, T('b1'));
    b1.append(...[
      said(T('what'), ex.what ?? (L() === 'en' ? m.note : null) ?? ''),
      said(T('why'), ex.why ?? null),
      said(T('without'), ex.without ?? null),
      said(T('analogy'), ex.analogy ?? null, 'pc-said--analogy'),
      prosCons(listOf(key, 'pros', m.pros), listOf(key, 'cons', m.cons)),
      said(T('real'), listOf(key, 'real', m.real), 'pc-said--real'),
    ].filter(Boolean));
    const b3 = block(2, T('b3'));
    const lines = [];
    if (m.massPerM2 > 0) lines.push({ id: 'areal', label: labelFor('areal', L()), value: `${num(m.massPerM2, L(), 1)} kg`, words: massWords(m.massPerM2, L()) });
    if (Number.isFinite(m.maxTempC)) lines.push({ id: 'heat', label: labelFor('heat', L()), value: `${num(m.maxTempC, L())} °C`, words: heatWords(m.maxTempC, L()) });
    if (m.strengthKPa > 0) lines.push({ id: 'strength', label: labelFor('strength', L()), value: `${num(m.strengthKPa, L())} kPa`, words: pressureWords(m.strengthKPa, g0(), L()), meaningId: 'strength' });
    if (m.costPerM2 > 0) lines.push({ id: 'price', label: `${labelFor('price', L())} / m²`, value: moneyValue(m.costPerM2, L()), words: priceWords(m.costPerM2, { lang: L() }) });
    if (lines.length) b3.append(numberRows(lines));
    const cur = ctx.hullNow?.(sid);
    if (cur && cur.id !== m.id) {
      const s = [];
      const vi = L() === 'vi';
      const curName = nameOf(`hull:${cur.id}`, cur.name);
      const yours = vi ? `${curName} đang dùng` : `the ${curName} you have now`;
      const dm = (m.massPerM2 ?? 0) - (cur.massPerM2 ?? 0);
      if (Math.abs(dm) >= 0.05) s.push(vi ? `Mỗi mét vuông ${dm > 0 ? 'nặng' : 'nhẹ'} hơn ${yours} ${num(Math.abs(dm), 'vi', 1)} kg.` : `Each square metre is ${num(Math.abs(dm), 'en', 1)} kg ${dm > 0 ? 'heavier' : 'lighter'} than ${yours}.`);
      const dt = (m.maxTempC ?? 0) - (cur.maxTempC ?? 0);
      if (Number.isFinite(dt) && Math.abs(dt) >= 1) s.push(vi ? `Chịu nóng ${dt > 0 ? 'hơn' : 'kém hơn'} ${num(Math.abs(dt), 'vi')} °C.` : `Takes ${num(Math.abs(dt), 'en')} °C ${dt > 0 ? 'more' : 'less'} heat.`);
      const dc = moneyShown(m.costPerM2 ?? 0) - moneyShown(cur.costPerM2 ?? 0);
      if (Math.abs(dc) >= 1) s.push(vi ? `Mỗi mét vuông ${dc > 0 ? 'đắt' : 'rẻ'} hơn ${moneyValue(Math.abs(dc), 'vi')}.` : `Each square metre costs ${moneyValue(Math.abs(dc), 'en')} ${dc > 0 ? 'more' : 'less'}.`);
      b3.append(compareBox(s));
    }
    out.blocks = [b1, b3];
    out.price = m.costPerM2 > 0 ? { value: m.costPerM2, note: L() === 'vi' ? 'mỗi m²' : 'per m²' } : null;
    return out;
  }

  /** Number lines for the pad, from designPage's padFigures / equipFigures (the same pure functions as the pad card). */
  function padLines(o, fig = null) {
    const lines = [];
    if (!o) return lines;
    const vi = L() === 'vi';
    const fee = fig?.fee ?? o.fee ?? null;
    if (fee != null) lines.push({ id: 'fee', label: labelFor(fig?.feeLabel ?? 'fee', L()), value: fee ? moneyValue(fee, L()) : T('free'), words: fee ? priceWords(fee, { budget: budget(), lang: L() }) : '' });
    if (fig?.heatLimitKN > 0) {
      const ownDiffers = fig.ownHeatKN > 0 && Math.round(fig.ownHeatKN) !== Math.round(fig.heatLimitKN);
      lines.push({
        id: 'heatLimit', label: labelFor(fig.heatLabel ?? 'heatLimit', L()), value: kNValue(fig.heatLimitKN * 1000, L()), words: thrustWords(fig.heatLimitKN * 1000, g0(), L()), meaningId: 'heatLimit',
        note: ownDiffers ? (vi ? `riêng nó: ${kNValue(fig.ownHeatKN * 1000, 'vi')}` : `on its own: ${kNValue(fig.ownHeatKN * 1000, 'en')}`) : null,
      });
    } else if (o.heatKN > 0) lines.push({ id: 'heatLimit', label: labelFor('heatLimit', L()), value: kNValue(o.heatKN * 1000, L()), words: thrustWords(o.heatKN * 1000, g0(), L()), note: vi ? 'riêng nó' : 'on its own' });
    if (fig?.holdFee > 0 || o.holdFee > 0) { const hf = fig?.holdFee ?? o.holdFee; lines.push({ id: 'holdFee', label: labelFor('holdFee', L()), value: moneyValue(hf, L()), words: priceWords(hf, { lang: L() }) }); }
    if (o.catch > 0) lines.push({ id: 'catch', label: labelFor('catch', L()), value: pctValue(o.catch, L()), words: o.holdBy === 'weight'
      ? (vi ? `Các tay đỡ giữ tàu bằng chính sức nặng của nó khoảng ${num(o.holdS ?? 0, 'vi')} giây trong lúc động cơ tăng dần lực đẩy, đủ để thấy khoảng ${num(Math.round(o.catch * 100), 'vi')} trong 100 động cơ hỏng trước khi tàu bay lên.` : `The arms hold the ship by its own weight for about ${num(o.holdS ?? 0, 'en')} s while the engines come up: enough to catch about ${num(Math.round(o.catch * 100), 'en')} in 100 bad engines before it rises.`)
      : (vi ? `Kẹp giữ tàu thêm ${num(o.holdS ?? 0, 'vi')} giây khi động cơ đã chạy, đủ để thấy khoảng ${num(Math.round(o.catch * 100), 'vi')} trong 100 động cơ hỏng trước khi thả.` : `Holds the ship ${num(o.holdS ?? 0, 'en')} s with the engines running: enough to catch about ${num(Math.round(o.catch * 100), 'en')} in 100 bad engines before letting go.`) });
    if (o.reliability) lines.push({ id: 'padRel', label: labelFor('padRel', L()), value: `${o.reliability > 0 ? '+' : '−'}${num(Math.abs(o.reliability) * 100, L(), 1)} %`, words: '' });
    if (Number.isFinite(fig?.forecastC)) lines.push({ id: 'tempC', label: labelFor('forecast', L()), value: `${num(fig.forecastC, L())} °C`, words: [fig.climate, weatherWords(fig.forecastC, L())].filter(Boolean).join(': ') });
    else if (Number.isFinite(o.climate?.meanC)) lines.push({ id: 'climate', label: labelFor('climate', L()), value: `${num(o.climate.meanC, L())} °C`, words: [o.climate.name, weatherWords(o.climate.meanC, L())].filter(Boolean).join(': ') });
    return lines;
  }
  const padIconOf = (p) => ctx.padIcon?.(p) ?? '';

  function viewPad(tg) {
    const p = tg.pad ?? {};
    const key = `pad:${p.id}`;
    const ex = explain(key) ?? {};
    const place = L() === 'vi' ? p.placeVi ?? null : [p.place, p.rockets].filter(Boolean).join(' · ');
    const out = { kicker: T('padKicker'), title: nameOf(key, p.name ?? ''), sub: place ?? '', img: padIconOf(p) };
    const b1 = block(1, T('b1equip'));
    b1.append(...[
      said(T('what'), ex.what ?? (L() === 'en' ? p.note : null) ?? ''),
      said(T('why'), ex.why ?? null),
      said(T('without'), ex.without ?? null),
      said(T('analogy'), ex.analogy ?? null, 'pc-said--analogy'),
      prosCons(listOf(key, 'pros', p.pros), listOf(key, 'cons', p.cons)),
      said(T('real'), listOf(key, 'real', p.real), 'pc-said--real'),
      factList(listOf(key, 'facts', p.facts)),
    ].filter(Boolean));
    const blocks = [b1];
    // what comes with it: { equipmentKey: optionId } on the complex, named from the pad section
    const kitOf = p.kit ?? p.equipment ?? null;
    const eqList = ctx.sections?.pad?.equipment ?? [];
    if (kitOf && typeof kitOf === 'object' && !Array.isArray(kitOf) && Object.keys(kitOf).length) {
      const b2 = block(2, T('b2pad'));
      const ul = h('ul', 'pc-made');
      for (const [k, optId] of Object.entries(kitOf)) {
        const eq = eqList.find((e) => e.key === k);
        const o = eq?.options?.find((x) => x.id === optId);
        const li = h('li', 'pc-made-item');
        const b = h('button', 'pc-made-btn');
        b.type = 'button';
        const icon = o ? ctx.equipIcon?.(k, o) : '';
        if (icon) { const im = h('img', 'pc-made-img'); im.src = icon; im.alt = ''; im.draggable = false; b.append(im); }
        const txt = h('span', 'pc-made-txt');
        txt.append(h('span', 'pc-made-name', nameOf(`equip:${k}`, eq?.name ?? k)), h('span', 'pc-made-what', o ? nameOf(`equip:${k}/${o.id}`, o.name) : String(optId)));
        b.append(txt, h('span', 'pc-piece-chev', '▸'));
        b.addEventListener('click', (e) => { e.stopPropagation(); sound('ui.click'); go({ kind: 'equip', key: k, option: o ?? null }); });
        li.append(b);
        ul.append(li);
      }
      b2.append(ul);
      blocks.push(b2);
    }
    const fig = ctx.padFigures?.(p) ?? null;
    const lines = padLines(p, fig);
    if (lines.length) { const b3 = block(blocks.length + 1, T('b3')); b3.append(numberRows(withMeanings(lines))); blocks.push(b3); }
    out.blocks = blocks;
    out.price = fig ? { value: fig.fee, note: t(fig.current ? { en: 'launch fees as set up now', vi: 'phí phóng theo thiết bị đang chọn' } : { en: 'launch fees with its own equipment', vi: 'phí phóng, gồm cả thiết bị của nó' }) } : (p.fee != null ? { value: p.fee, note: '' } : null);
    return out;
  }

  function viewEquip(tg) {
    const eq = tg.eq ?? ctx.sections?.pad?.equipment?.find?.((e) => e.key === tg.key) ?? null;
    const opts = eq?.options ?? [];
    const now = ctx.padNow?.()?.equipment?.find?.((c) => c.eq?.key === tg.key)?.option ?? null;
    const o = typeof tg.option === 'string' ? opts.find((x) => x.id === tg.option) : tg.option ?? now ?? opts[0] ?? null;
    const eqKey = `equip:${tg.key}`, optKey = o ? `equip:${tg.key}/${o.id}` : null;
    const exEq = explain(eqKey) ?? {};
    const exOpt = optKey ? explain(optKey) ?? {} : {};
    const eqName = nameOf(eqKey, eq?.name ?? tg.key);
    const out = { kicker: `${T('equipKicker')} · ${eqName}`, title: o ? nameOf(optKey, o.name) : eqName, sub: (exOpt.why ? exOpt.what : null) ?? exEq.what ?? (L() === 'en' ? eq?.role : '') ?? '', img: o ? ctx.equipIcon?.(tg.key, o) ?? '' : '' };
    const b1 = block(1, T('b1equip'));
    b1.append(...[
      said(T('thisChoice'), exOpt.what ?? (L() === 'en' ? o?.note : null) ?? null),
      said(T('why'), exOpt.why ?? exEq.why ?? null),
      said(T('without'), exOpt.without ?? exEq.without ?? null),
      said(T('analogy'), exOpt.analogy ?? exEq.analogy ?? null, 'pc-said--analogy'),
      optKey ? prosCons(listOf(optKey, 'pros', o?.pros), listOf(optKey, 'cons', o?.cons)) : null,
      optKey ? said(T('real'), listOf(optKey, 'real', o?.real), 'pc-said--real') : null,
    ].filter(Boolean));
    const b2 = block(2, T('b2equip'));
    const w = h('div', 'pc-choices');
    for (const x of opts) {
      const c = h('div', `pc-choice${x.id === now?.id ? ' pc-choice--on' : ''}${x.id === o?.id ? ' pc-choice--here' : ''}`);
      c.dataset.choice = x.id;
      const top = h('div', 'pc-choice-top');
      const name = h('button', 'pc-choice-name', nameOf(`equip:${tg.key}/${x.id}`, x.name));
      name.type = 'button';
      name.addEventListener('click', (e) => { e.stopPropagation(); sound('ui.click'); go({ kind: 'equip', key: tg.key, eq, option: x }); });
      top.append(name);
      const a = actionButton({ kind: 'equip', key: tg.key, eq, option: x }, { small: true, keepOpen: true });
      if (a) top.append(a);
      c.append(top);
      const xe = explain(`equip:${tg.key}/${x.id}`);
      const what = xe?.what ?? (L() === 'en' ? x.note : null);
      if (what) c.append(para(what, 'pc-choice-what'));
      w.append(c);
    }
    b2.append(w);
    const b3 = block(3, T('b3'));
    const lines = padLines(o, o ? ctx.equipFigures?.(tg.key, o) ?? null : null);
    if (lines.length) b3.append(numberRows(withMeanings(lines)));
    out.blocks = lines.length ? [b1, b2, b3] : [b1, b2];
    out.price = o && (o.fee ?? null) != null ? { value: o.fee, note: '' } : null;
    out.target = { kind: 'equip', key: tg.key, eq, option: o };
    return out;
  }

  /** Lines from numbersFor carry a meaning already; give them the content agent's term: text when there is one. */
  function withMeanings(lines) {
    return lines.map((ln) => ({ ...ln, meaningId: ln.meaningId ?? (TERM_KEYS[ln.id] || MEANINGS[ln.id] ? ln.id : null), meaning: ln.meaning ?? null }));
  }

  // ---------- render ----------
  const VIEWS = { part: viewPart, option: viewOption, shape: viewShape, hull: viewHull, pad: viewPad, equip: viewEquip };
  function render() {
    if (!target) return;
    const keep = body.scrollTop;
    const view = VIEWS[target.kind];
    let out;
    previewShown = false;
    delete el.dataset.error;
    try { out = view ? view(target) : null; } catch (err) {
      el.dataset.error = String(err?.message ?? err); // the tests look for this; the player still gets a card with the name
      out = { kicker: '', title: target.def?.name ?? target.shape?.name ?? target.pad?.name ?? '', sub: '', blocks: [] };
    }
    if (!out) return;
    el.dataset.kind = target.kind;
    el.dataset.lang = L();
    card.setAttribute('lang', L());
    for (const b of langBtns) b.setAttribute('aria-pressed', String(b.dataset.lang === L()));
    langBox.title = T('lang');
    closeBtn.title = T('close');
    closeBtn.setAttribute('aria-label', T('close'));
    kicker.textContent = out.kicker ?? '';
    title.textContent = out.title ?? '';
    sub.textContent = out.sub ?? '';
    sub.hidden = !out.sub;
    headImg.hidden = !out.img;
    if (out.img) headImg.src = out.img;
    body.replaceChildren(...(out.blocks ?? []).filter(Boolean));
    // footer: the price and the one button
    foot.replaceChildren();
    const price = h('div', 'pc-price');
    if (out.price && Number.isFinite(out.price.value)) {
      price.append(h('span', 'pc-price-label', T('price')), h('span', 'pc-price-value', out.price.value ? moneyValue(out.price.value, L()) : T('free')));
      if (out.price.note) price.append(h('span', 'pc-price-note', out.price.note));
    }
    foot.append(price);
    const a = actionButton(out.target ?? target);
    if (a) foot.append(a);
    const key = targetKey(target);
    body.scrollTop = key === lastTargetKey ? keep : 0;
    lastTargetKey = key;
  }
  const targetKey = (tg) => `${tg.kind}:${tg.def?.id ?? ''}:${tg.part?.id ?? ''}:${tg.slot?.key ?? ''}:${tg.option?.id ?? tg.option ?? ''}:${tg.shape?.id ?? ''}:${tg.pad?.id ?? ''}:${tg.key ?? ''}:${tg.material?.id ?? ''}`;

  /** Open another target from inside the card (a shape's part, a piece's choice). */
  function go(tg) {
    if (ctx.onOpenTarget) ctx.onOpenTarget(tg); else open(tg);
  }
  function open(tg) {
    if (!tg || !VIEWS[tg.kind]) return;
    const fresh = !target || targetKey(tg) !== targetKey(target);
    target = tg;
    if (fresh) openSlot = tg.kind === 'option' ? tg.slot?.key ?? null : tg.focusSlot ?? null;
    const was = !el.hidden;
    el.hidden = false;
    render();
    if (!was) ctx.onOpen?.();
  }
  function close() {
    if (el.hidden && !target) return;
    el.hidden = true;
    target = null;
    openSlot = null;
    drag = null;
    preview?.clear?.();
    previewKey = '';
    previewShown = false;
    ctx.onClose?.();
  }
  return {
    el,
    open,
    close,
    /** Re-render after the vehicle changed (a part was installed, a choice made); a vanished part shows as a catalogue part. */
    refresh() {
      if (!target) return;
      if (target.part && ctx.partExists && !ctx.partExists(target.part.id)) target = { ...target, part: null };
      else if (target.part && ctx.freshPart) target = { ...target, part: ctx.freshPart(target.part.id) ?? target.part };
      render();
    },
    update(dt) {
      if (el.hidden || !target || !previewShown || !preview) return;
      // only while the turning view is scrolled into sight
      const r = preview.canvas.getBoundingClientRect?.(), b = body.getBoundingClientRect?.();
      if (r && b && (r.bottom < b.top || r.top > b.bottom)) return;
      preview.update?.(dt);
    },
    get isOpen() { return !el.hidden && !!target; },
    get target() { return target; },
    dispose() { offLang(); preview?.dispose?.(); },
  };
}
