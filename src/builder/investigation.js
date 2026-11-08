// The accident investigation board (Role 1 agent "luck"). Opens in the hangar after a flight that failed, beside the
// stand where the parts to look at glow. It explains in plain words what happened and why: the ending and its cause,
// what went wrong on this ship (the defect behind the ending first), the ship on paper against the ship as built and
// only now the trip's real need, launch day (the weather forecast against what really happened, and the pad when it
// mattered), the warnings the player overrode, the parts to look at, and one question for next time. It fits one
// screen (1440×860). English or Vietnamese (EN | VI, saved as builderLang through i18n.js), numbers in each language's
// style. The words are in data/text.json (board, luck.defects); the reasoning is asBuilt.js investigate(), so Node can
// test it.
// The flight analysis (createFlightAnalysis, below) is its sibling in the same style: after every flight, success or
// failure, what each part did and how it wore, section by section; the reasoning is flightAnalysis.js.
import './investigation.css';
import './flightAnalysis.css';
import { getLang, onLang, setLang, tr } from './i18n.js';
import { describeDefect, investigate, localNumber } from './asBuilt.js';
import { analyseFlight } from './flightAnalysis.js';
import { WEATHER_RULES } from './gonogo.js';

const h = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const btn = (className, label, onClick, attrs = {}) => {
  const b = h('button', className, label);
  b.type = 'button';
  Object.assign(b.dataset, attrs);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick?.(e); });
  return b;
};
const fill = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const pct = (x, lang) => `${x >= 0 ? '+' : '−'}${localNumber(Math.abs(x * 100), lang, 1)} %`;

// the three numbers that tell the story; for each, more is better
const ROWS = [
  ['deltaV', (v, l) => `${localNumber(v, l)} m/s`],
  ['twrEarth', (v, l) => localNumber(v, l, 2)],
  ['fuelMass', (v, l) => `${localNumber(v, l)} kg`],
];
const SPREAD_SHOWN = 0.01; // the factory spread is listed only for parts off their rating by 1 % or more
const GLOW_EVERY = 1.4; // s: the stand's glow lasts 1.6 s per builder:highlightPart, so it is renewed while open

/**
 * createInvestigation({ record, text, onHighlight(partIds), onClose, onSound, onAnalysis }) → { el, update(dt), dispose, partIds }
 *   record: a flight record from the builder save (index.js recordFlight), with outcome set
 *   text: data/text.json (board and luck.defects are used)
 *   onAnalysis: when given, the board ends with a button to the flight analysis (how each part did)
 */
export function createInvestigation({ record, text, onHighlight, onClose, onSound, onAnalysis }) {
  const B = text.board ?? {};
  const T = (entry, vars = {}) => fill(tr(entry), vars);
  const a = investigate(record);
  const el = h('section', 'inv-root hud-panel');
  el.dataset.board = 'investigation';
  let glow = 0;
  let focus = null; // one part picked from the list glows alone for a moment

  function render() {
    const lang = getLang();
    const n = (v, digits = 0) => localNumber(v, lang, digits);
    el.lang = lang;
    el.replaceChildren();
    const ending = B.endings?.[record.outcome?.endingId] ?? null;

    // header: title, flight, EN | VI, close
    const head = h('header', 'inv-head');
    const titles = h('div', 'inv-titles');
    titles.append(h('div', 'inv-kicker', T(B.title)), h('div', 'inv-title', ending ? tr(ending) : record.outcome?.endingId ?? ''), h('div', 'inv-sub', T(B.flight, { n: record.n, ship: record.name ?? '' })));
    const langs = h('div', 'inv-lang');
    for (const l of ['en', 'vi']) langs.append(btn(`inv-lang-btn${l === lang ? ' is-on' : ''}`, l.toUpperCase(), () => { setLang(l); onSound?.('ui.click'); }, { lang: l }));
    head.append(titles, langs, btn('hud-button inv-close', T(B.close), () => onClose?.(), { action: 'close-board' }));
    el.append(head);

    // what happened: Role 2's cause in this language when it is known, else the ending's own line
    const what = section(T(B.happened));
    const cause = B.causes?.[record.outcome?.causeId];
    what.append(h('p', 'inv-lead', cause ? tr(cause) : ending?.what ? tr(ending.what) : record.outcome?.cause ?? ''));
    const small = [];
    if (record.outcome?.cost > 0) small.push(T(B.cost, { cost: `$${n(record.outcome.cost)}` }));
    if (record.reflight) small.push(T(B.reflight, { flights: record.reflight.flights, wear: n(Math.round((record.reflight.wear ?? 0) * 100)) }));
    if (small.length) what.append(h('p', 'inv-p inv-muted', small.join(' ')));

    // what went wrong on this ship: the defect behind the ending first, then what the factory delivered (1 % off or more)
    const def = section(T(B.defects));
    if (a.defects.length) { const ul = h('ul', 'inv-list'); for (const d of a.defects) ul.append(h('li', `inv-item is-${d.source}`, describeDefect(d, text.luck?.defects, lang))); def.append(ul); }
    else def.append(h('p', 'inv-p', T(B.noDefects)));
    const spread = (record.units ?? []).map((u) => spreadLine(u, B, lang)).filter(Boolean);
    if (spread.length) def.append(h('p', 'inv-p inv-muted', T(B.spread, { list: spread.join('; ') })));

    // on paper and as built, then the trip's real need (a coloured verdict only when fuel or landing is the question)
    const nums = section(T(B.numbers));
    const table = h('table', 'inv-table');
    const hr = h('tr');
    hr.append(h('th', null, ''), h('th', null, T(B.colPaper)), h('th', null, T(B.colBuilt)));
    table.append(hr);
    for (const [key, fmt] of ROWS) {
      const p = record.designed?.[key], b = record.asBuilt?.[key];
      if (!Number.isFinite(p) && !Number.isFinite(b)) continue;
      const row = h('tr');
      const diff = Number.isFinite(p) && p !== 0 && Number.isFinite(b) ? b / p - 1 : 0;
      const cell = h('td', 'inv-built', fmt(b, lang));
      if (Math.abs(diff) >= 0.0005) cell.append(h('span', `inv-diff ${diff < 0 ? 'is-down' : 'is-up'}`, pct(diff, lang)));
      row.append(h('td', 'inv-k', T(B.rows?.[key])), h('td', null, fmt(p, lang)), cell);
      table.append(row);
    }
    nums.append(table);
    if (a.need > 0) {
      nums.append(h('p', a.numbersFirst ? 'inv-lead' : 'inv-p inv-muted', T(B.need, { oneWay: n(a.need), roundTrip: n(record.need?.roundTrip ?? 0), built: n(a.built) })));
      if (a.numbersFirst && a.verdict && B.verdict?.[a.verdict]) nums.append(h('p', `inv-p inv-verdict is-${a.verdict}`, T(B.verdict[a.verdict], { short: n(a.shortBy) })));
    }

    // launch day: the weather (wind and storms when they broke the rules), and the pad only when it mattered
    const day = section(T(B.launchDay));
    const w = record.weather ?? {};
    const sky = [T(B.weatherLine, { forecastC: n(w.forecastC, decimals(w.forecastC)), actualC: n(w.actualC, decimals(w.actualC)) })];
    if ((w.windKts ?? 0) > WEATHER_RULES.windKts) sky.push(T(B.windLine, { windKts: n(w.windKts) }));
    if ((w.lightning ?? 0) >= WEATHER_RULES.lightning) sky.push(T(B.stormLine));
    else if (w.label && lang === 'en') sky.push(`${w.label}.`); // weather.js labels are English
    day.append(h('p', `inv-p${w.actualC !== w.forecastC ? ' inv-strong' : ''}`, sky.join(' ')));
    // the pad, in a few plain lines: over its heat limit (held back, Δv lost), debris that missed, repairs, scrubs
    const pad = record.pad ?? {};
    const scrubs = record.scrubs ?? [];
    const lines = [];
    if ((pad.excess ?? 0) > 0) lines.push(T(B.overload, { excess: n(Math.round(pad.excess * 100)), mps: n(pad.liftoffLossMps ?? 0) }));
    if ((pad.damageChance ?? 0) > 0 && !(record.defects ?? []).some((d) => d.kind === 'debris')) lines.push(T(B.debrisMissed));
    if ((pad.repairFee ?? 0) > 0) lines.push(T(B.repairs, { money: n(pad.repairFee) }));
    if (scrubs.length) lines.push(T(B.scrubs, { n: scrubs.length, list: scrubs.flatMap((x) => x.defects ?? []).map((d) => describeDefect(d, text.luck?.defects, lang)).join(' ') }));
    if (lines.length) { const ul = h('ul', 'inv-list'); lines.forEach((s) => ul.append(h('li', 'inv-item', s))); day.append(ul); }

    // the warnings the player overrode, on one line
    const over = section(T(B.overridden));
    over.append(record.overridden?.length
      ? h('p', 'inv-p inv-warned', record.overridden.map((id) => (B.warnings?.[id] ? tr(B.warnings[id]) : id)).join(' · '))
      : h('p', 'inv-p', T(B.noneOverridden)));

    // the parts to look at (they glow on the stand through builder:highlightPart)
    const parts = section(T(B.parts));
    if (a.partIds.length) {
      const chips = h('div', 'inv-chips');
      for (const id of a.partIds) chips.append(btn(`inv-chip${focus === id ? ' is-on' : ''}`, record.partNames?.[id] ?? id, () => { focus = focus === id ? null : id; glow = 0; onSound?.('ui.click'); render(); }, { part: id }));
      parts.append(chips);
    } else parts.append(h('p', 'inv-p', T(B.noParts)));

    // one question for next time
    const next = section(T(B.next));
    next.append(h('p', 'inv-question', T(B.questions?.[a.question] ?? B.questions?.other)));

    // fuel and landing failures lead with the numbers; every other ending leads with what broke
    el.append(what, ...(a.numbersFirst ? [nums, def] : [def, nums]), day, over, parts, next);
    if (onAnalysis) {
      const foot = h('div', 'inv-foot');
      foot.append(btn('hud-button inv-to-analysis', T(B.toAnalysis), () => { onSound?.('ui.click'); onAnalysis(); }, { action: 'open-analysis' }));
      el.append(foot);
    }
  }

  function section(title) {
    const s = h('div', 'inv-section');
    s.append(h('div', 'inv-h', title));
    return s;
  }

  render();
  const offLang = onLang(() => render());
  return {
    el,
    get partIds() { return a.partIds; },
    update(dt) {
      glow -= dt;
      if (glow > 0) return;
      glow = GLOW_EVERY;
      const ids = focus ? [focus] : a.partIds;
      if (ids.length) onHighlight?.(ids);
    },
    dispose() { offLang(); el.remove(); },
  };
}

const decimals = (c) => (Number.isFinite(c) && Math.round(c) !== c ? 1 : 0);
/** "Engine, large pump: thrust +1.2 %" for one part as it came from the factory, only what is 1 % or more off. */
function spreadLine(u, B, lang) {
  const w = B.words ?? {};
  const bits = [];
  const add = (x, word, fallback) => { if (Number.isFinite(x) && Math.abs(x) >= SPREAD_SHOWN) bits.push(`${tr(word) || fallback} ${pct(x, lang)}`); };
  add(u.thrustPct, w.thrust, 'thrust');
  add(u.ispPct, w.isp, 'Isp');
  add(u.fuelPct, w.propellant, 'propellant');
  return bits.length ? `${u.name}${u.count > 1 ? ` ×${u.count}` : ''}: ${bits.join(', ')}` : '';
}

// ---------- the flight analysis ----------
const SVG = 'http://www.w3.org/2000/svg';
/**
 * createFlightAnalysis({ record, effects, history, catalog, deps, traitsData, text, onHighlight, onClose, onBack,
 * onSound }) → { el, update(dt), dispose }
 *   record: the builder's flight record (index.js recordFlight, closed by flightAnalysis.js closeFlight at the ending)
 *   effects: that flight's part-effects record (save.partEffects.flights); history: the builder's flight records
 *   onBack: when given (opened from the investigation board), a button back to the board
 * Calm by default (src/builder/CLAUDE.md §2): two summary lines, then one table per section (the whole ship, nose,
 * body, tail, launch pad) where each part is one line (the most telling thing it did) and its wear this flight, with a
 * few bars for a reflown ship. A click on a part opens the rest (every line, what the other choices would have done,
 * the total wear) and makes it glow on the stand. A lost ship has no wear column: it flies no more.
 */
export function createFlightAnalysis({ record, effects = null, history = [], catalog, deps, traitsData = {}, text, onHighlight, onClose, onBack, onSound }) {
  const A = text.analysis ?? {};
  const el = h('section', 'inv-root fa-root hud-panel');
  el.dataset.board = 'analysis';
  const cache = {}; // the ship and every alternative, built once
  let glow = 0;
  let open = null; // the row opened: its details show and its parts glow on the stand

  function render() {
    const lang = getLang();
    const T = (entry, vars = {}) => fill(tr(entry, lang), vars);
    const n = (v, d = 0) => localNumber(v, lang, d);
    const pctOf = (x) => n(x * 100, x < 0.1 ? 1 : 0);
    const m = analyseFlight({ record, effects, history, catalog, deps, traitsData, text, lang, cache });
    const scroll = el.scrollTop;
    el.lang = lang;
    el.replaceChildren();

    const head = h('header', `inv-head fa-head${onBack ? ' has-back' : ''}`);
    const titles = h('div', 'inv-titles');
    titles.append(h('div', 'inv-kicker', m.title), h('div', 'inv-title', m.sub), h('div', `inv-sub fa-outcome is-${m.outcome}`, m.outcomeText));
    const langs = h('div', 'inv-lang');
    for (const l of ['en', 'vi']) langs.append(btn(`inv-lang-btn${l === lang ? ' is-on' : ''}`, l.toUpperCase(), () => { setLang(l); onSound?.('ui.click'); }, { lang: l }));
    head.append(titles, langs);
    if (onBack) head.append(btn('hud-button fa-back', T(A.back), () => { onSound?.('ui.click'); onBack(); }, { action: 'back-to-board' }));
    head.append(btn('hud-button inv-close', T(A.close), () => onClose?.(), { action: 'close-analysis' }));
    el.append(head);

    const top = h('div', 'fa-summary');
    for (const line of m.summary) top.append(h('p', `fa-sum is-${line.tone}`, line.text));
    const trends = m.showWear && m.sections.some((s) => s.rows.some((r) => r.wear?.trend?.length >= 2));
    const hint = h('p', 'fa-hint');
    hint.append(h('span', null, T(A.more)));
    if (trends) hint.append(h('span', 'fa-legend', ` ${T(A.wear?.legend)}`));
    top.append(hint);
    el.append(top);

    m.sections.forEach((sec, i) => {
      const box = h('div', 'inv-section fa-section');
      box.dataset.section = sec.id;
      box.append(h('div', 'inv-h', sec.title));
      const table = h('table', `fa-table${m.showWear ? '' : ' no-wear'}`);
      if (i === 0) {
        const hr = h('tr', 'fa-cols');
        hr.append(h('th', 'fa-c-part', T(A.cols?.part)), h('th', 'fa-c-did', T(A.cols?.did)));
        if (m.showWear) hr.append(h('th', 'fa-c-wear', T(A.cols?.wear)));
        table.append(hr);
      }
      for (const row of sec.rows) table.append(rowEl(row, m, T, pctOf, n));
      box.append(table);
      el.append(box);
    });
    el.scrollTop = scroll;
  }

  /** One part: closed, its most telling line and its wear; open, everything. A click toggles it. */
  function rowEl(row, m, T, pctOf, n) {
    const isOpen = open === row.key;
    const lines = [...row.did.map((x) => ({ ...x, kind: 'did' })), ...row.whatIf.map((x) => ({ ...x, kind: 'if' }))];
    const first = row.did.find((x) => x.tone === 'bad') ?? row.did[0] ?? row.whatIf[0] ?? null;
    const more = lines.length > 1 || (first?.text?.length ?? 0) > 60 || (row.wear && row.wear.total > row.wear.delta + 0.0005);
    const tr_ = h('tr', `fa-row${isOpen ? ' is-open' : ''}${more ? ' has-more' : ''}`);
    tr_.dataset.row = row.key;
    if (row.partIds?.length) tr_.dataset.part = row.partIds.join(' ');
    const part = h('td', 'fa-part');
    part.append(h('span', 'fa-chev', more ? (isOpen ? '▾' : '▸') : ''), h('span', 'fa-name', row.name));
    const did = h('td', 'fa-did');
    if (!isOpen) { if (first) did.append(h('div', `fa-line fa-headline is-${first.tone}`, first.text)); }
    else for (const x of lines) did.append(h('div', `${x.kind === 'if' ? 'fa-if' : 'fa-line'} is-${x.tone}`, x.text));
    tr_.append(part, did);
    if (m.showWear) {
      const wear = h('td', 'fa-wear');
      const w = row.wear;
      const line = h('div', 'fa-wearline');
      if (!w) line.append(h('span', 'fa-delta is-none', '—'));
      else if (w.consumed > 0) line.append(h('span', 'fa-delta', T(A.wear?.consumed, { pct: pctOf(w.consumed) })));
      else {
        line.append(h('span', 'fa-delta', T(A.wear?.delta, { pct: pctOf(w.delta) })));
        if (w.trend?.length >= 2) line.append(spark(w.trend, (p) => T(A.wear?.trendBar, { n: n(p.n), pct: pctOf(p.w) }), T(A.wear?.trend)));
      }
      wear.append(line);
      if (isOpen && w?.consumed > 0) wear.append(h('div', 'fa-total', T(A.wear?.replaced)));
      else if (isOpen && w && w.total > w.delta + 0.0005) wear.append(h('div', 'fa-total', T(A.wear?.total, { pct: pctOf(w.total) })));
      tr_.append(wear);
    }
    if (more || row.partIds?.length) {
      tr_.addEventListener('click', (e) => {
        e.stopPropagation();
        open = isOpen ? null : row.key;
        glow = 0;
        onSound?.('ui.click');
        render();
      });
    }
    return tr_;
  }

  /** The wear after each flight of a reflown ship: a few thin bars, the last one bright; hovering one gives its value. */
  function spark(points, label, caption) {
    const max = Math.max(0.1, ...points.map((p) => p.w));
    const bw = 5, gap = 2, H = 14;
    const shown = points.slice(-6);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('width', String(shown.length * (bw + gap) - gap));
    svg.setAttribute('height', String(H));
    svg.setAttribute('class', 'fa-spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${caption}: ${shown.map(label).join(', ')}`);
    shown.forEach((p, i) => {
      const hgt = Math.max(2, (p.w / max) * H);
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', String(i * (bw + gap)));
      r.setAttribute('y', String(H - hgt));
      r.setAttribute('width', String(bw));
      r.setAttribute('height', String(hgt));
      r.setAttribute('rx', '1.5');
      if (i === shown.length - 1) r.setAttribute('class', 'is-last');
      const t = document.createElementNS(SVG, 'title');
      t.textContent = label(p);
      r.append(t);
      svg.append(r);
    });
    return svg;
  }

  render();
  const offLang = onLang(() => render());
  const idsOf = (key) => ([...el.querySelectorAll('.fa-row')].find((r) => r.dataset.row === key)?.dataset.part ?? '').split(' ').filter(Boolean);
  return {
    el,
    update(dt) {
      if (!open) return;
      glow -= dt;
      if (glow > 0) return;
      glow = GLOW_EVERY;
      const ids = idsOf(open);
      if (ids.length) onHighlight?.(ids);
    },
    dispose() { offLang(); el.remove(); },
  };
}
