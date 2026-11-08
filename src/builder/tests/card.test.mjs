// The big explanation card, Node only: node src/builder/tests/card.test.mjs
// 1. everyday.js: the comparisons give the right numbers, in English and Vietnamese, with g0 passed in.
// 2. partCard.js: every kind of target renders in a small DOM stub (no browser), in both languages, and its button works.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { G0 } = await load('src/core/planets.js');
const E = await load('src/builder/everyday.js');
const { createCatalog } = await load('src/builder/assembly.js');
const { partFigures } = await load('src/builder/stats.js');
const SEC = await load('src/builder/sections.js');

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const eq = (got, want, msg) => check(got === want, `${msg}${got === want ? '' : `: got "${got}", want "${want}"`}`);
const near = (got, want, tol, msg) => check(Math.abs(got - want) <= tol, `${msg}${Math.abs(got - want) <= tol ? '' : `: got ${got}, want ${want} ± ${tol}`}`);

// ---------- 1. everyday.js ----------
eq(E.num(1234.5, 'en', 1), '1,234.5', 'num: English separators');
eq(E.num(1234.5, 'vi', 1), '1.234,5', 'num: Vietnamese separators');
eq(E.num(2.0, 'en', 1), '2', 'num: trailing zeros dropped');
eq(E.niceCount(0.9), 1, 'niceCount: about one');
eq(E.niceCount(2.8), 3, 'niceCount: halves under 3 round to the nearest half (2.8 → 3)');
eq(E.niceCount(2.6), 2.5, 'niceCount: 2.6 → 2.5');
eq(E.niceCount(17.4), 17, 'niceCount: whole numbers under 20');
eq(E.niceCount(123), 120, 'niceCount: two significant figures above 20');

eq(E.massWords(4200, 'en'), 'As heavy as 3 family cars.', 'mass: 4.2 t = 2.8 cars of 1.5 t, said as 3');
eq(E.massWords(4200, 'vi'), 'Nặng bằng 3 chiếc ô tô gia đình.', 'mass: the same in Vietnamese');
eq(E.massWords(0.4, 'en'), 'Lighter than a bag of sugar.', 'mass: below the smallest thing');
eq(E.massWords(24000, 'en'), 'As heavy as 2 city buses.', 'mass: 24 t = 2 buses of 12 t');
eq(E.massWords(36000, 'en'), 'As heavy as about one fully loaded truck.', 'mass: 36 t is about one 40 t truck');
eq(E.massValue(56000, 'vi'), '56 tấn', 'mass value in tonnes (Vietnamese)');
eq(E.massValue(850, 'en'), '850 kg', 'mass value in kg');

// thrust: F / g0 is the mass whose weight equals the push
const held = 1e6 / G0;
near(held, 101972, 1, 'thrust: 1,000 kN holds 101,972 kg against g0');
const tw = E.thrustWords(1e6, G0, 'en');
check(tw.includes('2.5 fully loaded trucks') && tw.includes('102 t'), `thrust words, English: "${tw}"`);
const twVi = E.thrustWords(1e6, G0, 'vi');
check(twVi.includes('2,5 chiếc xe tải chở đầy hàng') && twVi.includes('102 tấn'), `thrust words, Vietnamese: "${twVi}"`);
check(E.thrustWords(1e6, G0 / 2, 'en').includes('204 t'), 'thrust words use the g0 passed in (half the gravity holds twice the mass)');
check(E.thrustWords(1e6, 0, 'en') === '', 'thrust words need g0');

const ex = E.exhaustWords(311, G0, 'en');
check(ex.includes('3.0 km/s') && ex.includes('9 times the speed of sound'), `Isp 311 s = 3.05 km/s, 8.9 × 343 m/s: "${ex}"`);
check(E.exhaustWords(311, G0, 'vi').includes('3,0 km/s'), 'exhaust speed with a Vietnamese decimal comma');

eq(E.flightsPerFailure(0.98), 50, 'reliability 98 % = 1 failure in 50');
eq(E.flightsPerFailure(0.85), 7, 'reliability 85 % = 1 failure in 6.7, said as 7');
eq(E.flightsPerFailure(0.995), 200, 'reliability 99.5 % = 1 failure in 200');
eq(E.flightsPerFailure(1), Infinity, 'reliability 100 % never fails');
eq(E.reliabilityWords(0.98, 'en'), 'Fails about 1 time in 50 flights.', 'reliability words, English');
eq(E.reliabilityWords(0.98, 'vi'), 'Cứ khoảng 50 chuyến bay thì hỏng 1 lần.', 'reliability words, Vietnamese');

eq(E.priceWords(1.2e6, { budget: 5e6, lang: 'en' }), 'The price of 3 houses. That is 24 % of the $5M you have.', 'price: 3 houses of $400k, 24 % of $5M');
eq(E.priceWords(1.2e6, { budget: 5e6, lang: 'vi' }), 'Bằng giá 3 căn nhà. Bằng 24 % số tiền bạn đang có ($5 triệu).', 'price, Vietnamese');
check(E.priceWords(6e6, { budget: 5e6, lang: 'en' }).includes('More than all the money'), 'price above the budget says so');
eq(E.moneyValue(1.25e6, 'vi'), '$1,25 triệu', 'money in Vietnamese millions');
eq(E.moneyValue(300000, 'vi'), '$300 nghìn', 'money in Vietnamese thousands');

eq(E.powerWords(110, 'en'), 'Enough to run 2 laptops at once.', 'power: 110 W = 1.8 laptops of 60 W');
check(E.powerWords(5000, 'vi').includes('2,5 ấm siêu tốc'), 'power: 5 kW = 2.5 kettles (Vietnamese)');
eq(E.areaWords(780, 'en'), 'As big as 3 tennis courts.', 'area: 780 m² = 3 courts of 261 m²');
check(E.sizeWords({ height: 1.98, diameter: 2.5 }, 'en') === 'About as tall as a grown-up and about as wide as a truck.', 'size words');
check(E.sizeWords({ height: 12 }, 'vi').includes('tòa nhà 4 tầng'), 'size words: 12 m = 4 storeys (Vietnamese)');
check(E.heatWords(150, 'en').includes('boiling water') && E.heatWords(150, 'en').includes('kitchen oven'), 'heat: 150 °C sits between boiling water and an oven');
const pw = E.pressureWords(35, G0, 'en');
check(pw.includes('2.5 family cars'), `pressure: 35 kPa = 3,569 kg per m² = 2.4 cars: "${pw}"`);
check(E.weatherWords(2, 'en').includes('fridge'), 'weather: 2 °C is fridge-cold');

const cw = E.compareWords({ now: { mass: 3000, cost: 1e6, reliability: 0.97, power: 0 }, next: { mass: 4500, cost: 1.3e6, reliability: 0.98, power: 0 }, name: 'Engine, medium pump', g0: G0, lang: 'en' });
check(cw.some((s) => s.startsWith('1.5 t heavier than your Engine, medium pump: about one family car more')), `compare: heavier by 1.5 t (${cw[0]})`);
check(cw.some((s) => s === '$300k more expensive than your Engine, medium pump.'), 'compare: pricier by $300k');
check(cw.some((s) => s.includes('1 time in 50 flights') && s.includes('1 in 33')), 'compare: failures 1 in 50 against 1 in 33');
const cwVi = E.compareWords({ now: { mass: 3000, cost: 1e6, reliability: 0.97, power: 0 }, next: { mass: 4500, cost: 1.3e6, reliability: 0.98, power: 0 }, name: 'Engine, medium pump', g0: G0, lang: 'vi' });
check(cwVi.some((s) => s.startsWith('Nặng hơn Engine, medium pump đang lắp 1,5 tấn')), 'compare in Vietnamese');
const thr = E.compareWords({ now: { mass: 1, cost: 1, reliability: 1, engine: { thrustSL: 300e3, ispVac: 350 } }, next: { mass: 1, cost: 1, reliability: 1, engine: { thrustSL: 1e6, ispVac: 350 } }, name: 'X', g0: G0, lang: 'en' });
check(thr.includes('Pushes 3.3 times as hard as your X.'), 'compare: thrust ratio 1,000 / 300 kN = 3.3 times');
const fx = E.effectWords({ now: { mass: 1000, cost: 5e5, reliability: 0.98, power: 0, chuteCdA: 0, engine: { thrust: 1e6, ispVac: 311 } }, next: { mass: 1120, cost: 7e5, reliability: 0.975, power: 0, chuteCdA: 0, engine: { thrust: 1e6, ispVac: 323 } }, lang: 'en' });
eq(fx.join(' · '), 'fails 1 in 40 (now 1 in 50) · Isp +12 s · 120 kg heavier · $200k more', 'effect words of one choice: what matters most first');
eq(E.effectWords({ now: { mass: 1, cost: 1, reliability: 0.98, power: 0, chuteCdA: 0 }, next: { mass: 1, cost: 1, reliability: 0.975, power: 0, chuteCdA: 0 }, lang: 'vi' })[0], 'cứ 40 chuyến hỏng 1 lần (hiện là 50)', 'effect words in Vietnamese');
eq(E.moneyValue(1500, 'en'), '$1.5k', 'money: one decimal under $10k');
eq(E.moneyValue(2.5e9, 'en'), '$2.5B', 'money: billions');
eq(E.moneyValue(2.5e9, 'vi'), '$2,5 tỷ', 'money: billions in Vietnamese (tỷ)');
const cmp = E.compareWords({ now: { mass: 3000, cost: 1184000, reliability: 1, power: 0 }, next: { mass: 3000, cost: 263400, reliability: 1, power: 0 }, name: 'X', g0: G0, lang: 'en' });
check(cmp.includes('$917k cheaper than your X.'), `compare: the difference of the shown prices ($1.18M − $263k = $917k): ${cmp.join(' / ')}`);
eq(E.exhaustValue(350, G0, 'en'), '3.4 km/s', 'exhaust speed value from Isp 350 s');

// every catalogue part gets number lines without NaN or undefined, in both languages
const sectionFiles = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), sectionFiles);
const sections = SEC.createSections(sectionFiles);
const catalog = createCatalog(partsJson, internalsJson);
const engines = read('src/builder/data/engines.json');
const materials = read('src/builder/data/materials.json');
const figuresOf = (def, part = null) => partFigures(def, { engines, g0: G0, materials, catalog, materialId: part?.material ?? null, options: part?.options ?? null, engineDef: part?.engine ?? null, count: 1 });
let bad = [];
for (const def of catalog.parts) {
  for (const lang of ['en', 'vi']) {
    const lines = E.numbersFor({ def, fig: figuresOf(def), g0: G0, lang, budget: 5e6, diameter: def.attach === 'axial' && !def.engine ? 2.5 : 0 });
    const text = lines.map((l) => `${l.label} ${l.value} ${l.words} ${l.meaning ?? ''}`).join(' | ');
    if (!lines.length || /NaN|undefined|Infinity/.test(text)) bad.push(`${def.id}/${lang}: ${text.slice(0, 120)}`);
  }
}
check(!bad.length, `number lines for all ${catalog.parts.length} parts, English and Vietnamese${bad.length ? `: ${bad.slice(0, 3).join(' ; ')}` : ''}`);
const engL = catalog.get('engine_l');
const engLines = E.numbersFor({ def: engL, fig: figuresOf(engL), g0: G0, lang: 'en', budget: 5e6 });
check(['mass', 'thrust', 'exhaust', 'height', 'reliability', 'price'].every((id) => engLines.some((l) => l.id === id)), 'an engine shows weight, push, exhaust speed, height, reliability and price');

// ---------- 2. partCard.js in a DOM stub ----------
class Node {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.className = ''; this.hidden = false; this._text = ''; this.style = {}; this.scrollTop = 0; }
  append(...nodes) { for (const n of nodes) { if (n == null) continue; const c = typeof n === 'string' ? Object.assign(new Node('#text'), { _text: n }) : n; c.parent?.remove?.(c); c.parent = this; this.children.push(c); } }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; }
  replaceChildren(...nodes) { for (const c of this.children) c.parent = null; this.children = []; this.append(...nodes); }
  insertBefore(n, ref) { this.append(n); const i = this.children.indexOf(ref); if (i >= 0) { this.children.pop(); this.children.splice(i, 0, n); } }
  set textContent(v) { this.children = []; this._text = v == null ? '' : String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, extra = {}) { for (const fn of this.listeners[type] ?? []) fn({ type, target: this, stopPropagation() {}, preventDefault() {}, ...extra }); }
  click() { this.dispatch('click'); }
  get classList() { const n = this; return { contains: (c) => n.className.split(/\s+/).includes(c), add: (c) => { n.className = `${n.className} ${c}`.trim(); }, remove: (c) => { n.className = n.className.split(/\s+/).filter((x) => x !== c).join(' '); } }; }
  getContext() { return null; }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  // tiny selector: ".a.b", "[data-x='y']" and "tag", one compound only
  matches(sel) {
    const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:=['"]?[^\]'"]*['"]?)?\])*)$/i);
    if (!m) return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    for (const a of m[3].match(/\[[^\]]+\]/g) ?? []) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:=['"]?([^'"]*)['"]?)?\]$/);
      const val = k.startsWith('data-') ? this.dataset[k.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())] : this.attrs[k];
      if (val == null || (v != null && String(val) !== v)) return false;
    }
    return true;
  }
  querySelectorAll(sel) { const parts = sel.trim().split(/\s+/); let set = [this]; for (const p of parts) set = set.flatMap((n) => n.all((c) => c.matches(p))); return [...new Set(set)]; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
globalThis.document = { createElement: (tag) => new Node(tag) };

const i18n = await load('src/builder/i18n.js');
const { createPartCard, CARD_TEXT } = await load('src/builder/partCard.js');
// the real explanations plus a few sample entries of our own (the content agent fills the real files in parallel)
const files = ['src/builder/data/explain-general.json', 'src/builder/data/explain-hull.json', ...['nose', 'body', 'tail', 'pad'].map((s) => `src/builder/sections/${s}/explain.json`)];
const EXPLAIN = Object.assign({}, ...files.map((f) => read(f).entries ?? {}));
const SAMPLE = {
  'part:engine_l': { en: { what: 'SAMPLE what it does', why: 'SAMPLE why', without: 'SAMPLE without', inside: 'SAMPLE inside', analogy: 'SAMPLE like a garden hose' }, vi: { what: 'MẪU nó làm gì', why: 'MẪU vì sao', name: 'Động cơ lớn MẪU', pros: ['MẪU điểm mạnh'] } },
  'part:engine_m': { en: { what: 'SAMPLE medium engine' }, vi: { what: 'MẪU động cơ vừa' } }, // no vi.pros on purpose
  'slot:engine/cycle': { en: { what: 'SAMPLE the pump drive' }, vi: { what: 'MẪU bơm' } },
  'term:thrust': { en: { what: 'SAMPLE term thrust' }, vi: { what: 'MẪU lực đẩy' } },
};
const explainFor = (key) => SAMPLE[key] ?? EXPLAIN[key] ?? null;

const ran = [];
const installedEngine = { id: 'p9', type: 'engine_l', engine: { fuel: 'methalox', nozzle: 'sl', pump: 'L' }, options: {} };
const ctx = {
  explainFor, catalog, sections, g0: G0, getMoney: () => 5e6,
  figuresOf, diameterOf: (def) => (def.attach === 'axial' && !def.engine ? 2.5 : 0), entryOf: () => null,
  optionsOf: (def, opts) => catalog.optionsOf(def, opts),
  currentOption: (part, slot) => catalog.optionsOf(catalog.get(part.type), part.options)[slot.key],
  installedFor: (def) => (def.engine && def.id !== 'engine_l' ? { def: catalog.get('engine_l'), part: installedEngine } : null),
  actionFor: (tg) => {
    if (tg.kind === 'part' && tg.part) return { status: 'installed' };
    if (tg.kind === 'shape') return { kind: 'useShape', tool: 'useshape', run: () => ran.push(`shape:${tg.shape.id}`) };
    return { kind: tg.kind === 'part' ? 'install' : 'choose', tool: 'install', run: () => ran.push(`${tg.kind}`) };
  },
  shapeFigures: (sec, shape) => ({ cost: 2.7e6, mass: 7500, propellant: 0, thrustSL: 816e3, height: 2.6, diameter: 2.5 }),
  currentShape: () => null,
  hullNow: () => ({ id: 'al2219', name: 'Aluminium 2219 skin', massPerM2: 13, maxTempC: 175, costPerM2: 3000 }),
  padFigures: () => ({ current: false, fee: 335000, feeLabel: 'kitFee', heatLimitKN: 3380, holdFee: 35000, forecastC: 16, climate: 'Florida winter' }),
  equipFigures: (key, o) => ({ heatLimitKN: 3380, heatLabel: 'heatHere', ownHeatKN: o.heatKN ?? null, holdFee: null }),
  padNow: () => ({ site: sections.pad.sites?.[0] ?? null, equipment: (sections.pad.equipment ?? []).map((eq) => ({ eq, option: eq.options[0] })) }),
};
const card = createPartCard(ctx);
check(card.el && typeof card.open === 'function' && typeof card.close === 'function' && typeof card.update === 'function' && 'isOpen' in card, 'createPartCard returns { el, open, close, isOpen, update }');
const text = () => card.el.textContent;
const kindsDone = [];
function render(tg, name, want = []) {
  for (const lang of ['en', 'vi']) {
    i18n.setLang(lang);
    card.open(tg);
    const t = text();
    const err = card.el.dataset.error;
    check(!err && card.isOpen && !card.el.hidden, `${name} (${lang}) renders${err ? `: ${err}` : ''}`);
    check(!/NaN|undefined|\[object Object\]/.test(t), `${name} (${lang}) has no NaN / undefined`);
    for (const w of want.filter((x) => x.lang === lang)) check(t.includes(w.text), `${name} (${lang}) says "${w.text}"`);
    check(t.includes(CARD_TEXT.b1[lang]) || t.includes(CARD_TEXT.b1option[lang]) || t.includes(CARD_TEXT.b1shape[lang]) || t.includes(CARD_TEXT.b1equip[lang]), `${name} (${lang}) has block 1 in its language`);
  }
  i18n.setLang('en');
  kindsDone.push(tg.kind);
}
render({ kind: 'part', def: catalog.get('engine_l'), part: installedEngine }, 'installed engine', [
  { lang: 'en', text: 'SAMPLE what it does' }, { lang: 'en', text: 'SAMPLE like a garden hose' }, { lang: 'en', text: 'SAMPLE the pump drive' }, { lang: 'en', text: 'INSTALLED ON YOUR SHIP' },
  { lang: 'en', text: 'Pushes as hard as the weight of' }, { lang: 'en', text: 'SAMPLE term thrust' },
  { lang: 'vi', text: 'MẪU nó làm gì' }, { lang: 'vi', text: 'SAMPLE without' }, { lang: 'vi', text: 'ĐÃ LẮP TRÊN TÀU' }, { lang: 'vi', text: 'Đẩy mạnh bằng sức nặng của' },
]);
// the pieces open to their choices
i18n.setLang('en');
card.open({ kind: 'part', def: catalog.get('engine_l'), part: installedEngine });
const pieceRow = card.el.querySelector('.pc-piece[data-piece=cycle] .pc-piece-row');
check(!!pieceRow, 'the engine card lists its pieces (Turbopump cycle)');
pieceRow?.click();
check(card.el.querySelectorAll('.pc-piece--open .pc-choice').length >= 3, 'clicking a piece shows its choices');
check(card.el.querySelectorAll('.pc-choice .pc-use').length >= 1 || card.el.querySelectorAll('.pc-choice .pc-status').length >= 1, 'each choice has USE THIS (or its FITTED tag)');
card.close();
check(!card.isOpen && card.el.hidden, 'close() hides the card');

// a candidate compared with the engine fitted now; its button installs and closes
render({ kind: 'part', def: catalog.get('engine_m') }, 'candidate engine', [{ lang: 'en', text: 'Compared with what is on your ship now' }, { lang: 'en', text: 'than your Engine, large pump' }, { lang: 'vi', text: 'So với cái đang lắp trên tàu' }]);
card.open({ kind: 'part', def: catalog.get('engine_m') });
const main = card.el.querySelector('.pc-foot .pc-action');
check(main?.textContent.trim() === 'INSTALL' && main.dataset.tool === 'install', 'the main button reads INSTALL');
main?.click();
check(ran.includes('part') && !card.isOpen, 'INSTALL runs the action and closes the card');

const capsule = catalog.parts.find((d) => d.flags?.capsule && d.internals);
const kit = catalog.kit(capsule);
render({ kind: 'option', def: capsule, slot: kit.slots[0], option: kit.slots[0].options[1] ?? kit.slots[0].options[0], part: { id: 'p1', type: capsule.id, options: {} } }, 'capsule option', [{ lang: 'en', text: kit.slots[0].name }]);
const tank = catalog.parts.find((d) => d.fuel);
render({ kind: 'part', def: tank }, 'tank', [{ lang: 'en', text: 'Propellant it holds' }, { lang: 'vi', text: 'Nhiên liệu chứa được' }]);
const shape = sections.tail.shapes[0];
render({ kind: 'shape', section: 'tail', shape }, 'tail shape', [{ lang: 'en', text: shape.name }, { lang: 'en', text: 'USE THIS SHAPE' }, { lang: 'vi', text: 'DÙNG HÌNH DÁNG NÀY' }]);
card.open({ kind: 'shape', section: 'tail', shape });
card.el.querySelector('.pc-foot .pc-action')?.click();
check(ran.includes(`shape:${shape.id}`), 'USE THIS SHAPE runs the action');
render({ kind: 'hull', section: 'body', material: { id: 'cfrp', name: 'Carbon-fibre sandwich skin', short: 'Carbon fibre', note: 'Light and dear.', pros: ['Light'], cons: ['Dear'], massPerM2: 7, costPerM2: 7000, maxTempC: 120, strengthKPa: 55 } }, 'outer-skin material', [{ lang: 'en', text: 'Takes heat up to' }, { lang: 'en', text: 'Each square metre is 6 kg lighter' }]);
if (sections.pad.sites?.length) render({ kind: 'pad', pad: sections.pad.sites[0] }, 'launch complex', [{ lang: 'en', text: sections.pad.sites[0].name }, { lang: 'en', text: '3,380 kN' }, { lang: 'en', text: '$335k' }, { lang: 'en', text: '$35k' }, { lang: 'vi', text: '3.380 kN' }]);
if (sections.pad.equipment?.length) {
  const e0 = sections.pad.equipment[0];
  render({ kind: 'equip', key: e0.key }, 'pad equipment', [{ lang: 'en', text: e0.options[0].name }]);
  render({ kind: 'equip', key: e0.key, option: e0.options.at(-1) }, 'pad equipment option', [{ lang: 'en', text: e0.options.at(-1).name }]);
}
check(['part', 'option', 'shape', 'hull', 'pad', 'equip'].every((k) => kindsDone.includes(k)), 'all six kinds of target rendered');
// the EN | VI buttons switch the language and re-render
card.open({ kind: 'part', def: catalog.get('engine_l'), part: installedEngine });
card.el.querySelector('.pc-lang-btn[data-lang=vi]')?.click();
check(i18n.getLang() === 'vi' && text().includes('MẪU nó làm gì'), 'the VI button switches the card to Vietnamese');
card.el.querySelector('.pc-lang-btn[data-lang=en]')?.click();
check(i18n.getLang() === 'en' && text().includes('SAMPLE what it does'), 'the EN button switches back');
// Vietnamese never mixes in the data's English pros, cons or real-world line; it uses the entry's own when there is one
const engL2 = catalog.get('engine_l'), engM = catalog.get('engine_m');
i18n.setLang('vi');
card.open({ kind: 'part', def: engL2, part: installedEngine });
check(card.el.querySelector('.pc-title')?.textContent === 'Động cơ lớn MẪU', 'VI: the title uses the entry\'s vi.name');
check(text().includes('MẪU điểm mạnh') && !engL2.cons.some((c) => text().includes(c)), 'VI: vi.pros shown, the English cons hidden (no vi.cons)');
check(!engL2.real || !text().includes(engL2.real), 'VI: the English real-world line is hidden without vi.real');
card.open({ kind: 'part', def: engM });
check(!engM.pros.some((p) => text().includes(p)), 'VI: a part with no Vietnamese pros shows none of its English ones');
i18n.setLang('en');
card.open({ kind: 'part', def: engM });
check(engM.pros.every((p) => text().includes(p)), 'EN: the part\'s own pros are shown');
const mount = sections.pad.equipment?.find((e) => e.options.some((o) => o.heatKN > 0 && Math.round(o.heatKN) !== 3380));
if (mount) {
  const o = mount.options.find((x) => x.heatKN > 0 && Math.round(x.heatKN) !== 3380);
  card.open({ kind: 'equip', key: mount.key, option: o });
  check(text().includes('3,380 kN') && text().includes('on its own'), 'equipment: the pad\'s total heat limit, and the option\'s own number marked "on its own"');
}
card.el.querySelector('.pc-backdrop')?.click();
check(!card.isOpen, 'a click on the dimmed backdrop closes the card');
card.update(0.016); // closed: nothing to do, must not throw
ok('update(dt) while closed does nothing');

console.log(failures ? `\n${failures} card check(s) failed` : '\nAll card checks passed');
process.exit(failures ? 1 : 0);
