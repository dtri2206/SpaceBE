// The vehicle design page. The ship turns in 3D in the middle (drag, wheel, click a part). On the right, four cards:
// Nose, Body, Tail, Launch pad. Open one and it becomes a vertical list: first the shape (taken from real vehicles),
// then every component of that section, then each component's choices, and inside the part, its own internals.
// Nothing floats over the ship except the big explanation card (partCard.js): clicking a part, on the ship or by its
// picture or name in the column, opens it in the middle of the screen. The column stays a clean list (picture, name,
// one line, price, a small INSTALL / USE button); an installed part's own controls stay in its view. One card open at a time.
import { partFigures, seriesFactor } from './stats.js';
import { createPadViews } from './designPad.js';
import { hullChoices, hullHasSkin, hullMaterial } from './hull.js';
import { internalsArt } from './bay/internalsArt.js';
import { BASE_RADIUS, SIZE_SCALE } from './assembly.js';
import { explainFor } from './explain.js';
import { createPartCard } from './partCard.js';
import { effectWords } from './everyday.js';
import { heatLimitOf, kitFee, padEffects, padSetup } from './sections/pad/effects.js';
import { padArt } from './sections/pad/art.js';
import { weatherFor } from './weather.js';
import { hullArt } from './bay/hullArt.js';
import launchData from './data/launch.json';
import './partCard.css';
import {
  VEHICLE_SECTIONS, WARNING_SECTION, addThroughRow, applyShape, clearSection, currentShape, rowCandidates, rowItems, rowOf, sectionParts,
} from './sections.js';
import { fmtInt, fmtKN, fmtMass, fmtMoney, fmtMoneyShort, fmtPct } from './format.js';

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
  if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
};
const signed = (n, f) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${f(Math.abs(n))}`;
const WARN = { LOW_DV: 'Not enough Δv to reach Mars: add propellant or a better engine', LOW_TWR: 'Too heavy for the engines (TWR under 1.2)', NO_HEAT_SHIELD: 'No heat shield under the capsule', NO_LEGS: 'No landing gear', UNSTABLE: 'Unstable in thick air: add fins low on the tail, or steering (an engine gimbal)', LOW_O2: 'No spare oxygen', NO_ANTENNA: 'No antenna', NO_SHELTER: 'No radiation shelter', COLD_SEALS: 'Cheap seals in a cold launch window', LOW_RELIABILITY: 'Reliability below 80 %', NO_CAPSULE: 'No crew capsule', NO_ENGINE: 'No engine', NO_FUEL: 'No propellant the engines can burn', NOT_CONNECTED: 'Parts not connected', OVER_BUDGET: 'Over budget' };
const SECTION_NUM = { nose: '1', body: '2', tail: '3', pad: '4' };
const FUEL_WORDS = { kerolox: 'kerosene', methalox: 'methane', hydrolox: 'hydrogen' }; // an option that needs a propellant

export function createDesignPage({ assembly, catalog, sections, materials, engines, icons, scene3d, g0, getMoney, hooks }) {
  const el = h('section', 'vd-root hud');
  el.hidden = true;
  const state = { open: null, path: [], focus: null, lens: false };
  let last = null;
  let cardApi = null; // the big explanation card (partCard.js), made once the helpers below exist

  // ---------- top bar ----------
  const top = h('header', 'vd-top');
  const title = h('div', 'vd-title');
  const shipName = btn('vd-ship-name', assembly.name, () => hooks.onRename?.());
  title.append(h('span', 'vd-kicker', 'Vehicle design'), shipName);
  const stats = h('div', 'vd-stats');
  const undoBtn = btn('vd-btn vd-btn--ghost', 'UNDO', () => { if (assembly.undo()) { sound('ui.click'); changed(); } }, { tool: 'undo' });
  const actions = h('div', 'vd-actions');
  actions.append(
    undoBtn,
    btn('vd-btn vd-btn--ghost', 'CLEAR ALL', () => hooks.onConfirm?.('Take the whole vehicle off the stand and start from nothing?', () => { assembly.clear(); closeAll(); changed(); sound('ui.click'); }), { tool: 'clearall' }),
    btn('vd-btn vd-btn--ghost', 'MORE ▾', () => hooks.onMore?.(), { tool: 'more' }),
    btn('vd-btn vd-btn--test', 'TEST FIRE', () => hooks.onTest?.(), { tool: 'test' }),
    btn('vd-btn vd-btn--go', 'READINESS POLL →', () => hooks.onGonogo?.(), { tool: 'gonogo' }),
    btn('vd-btn vd-btn--ghost vd-btn--x', '✕', () => hooks.onClose?.(), { tool: 'close' }),
  );
  top.append(title, stats, actions);

  // ---------- stage: 3D view + card dock ----------
  const stage = h('main', 'vd-stage');
  const view = h('div', 'vd-view');
  view.draggable = true; // HTML5 drag turns the vehicle (the pointer stream the static check allows outside core/input.js)
  const emptyHint = h('div', 'vd-empty-hint');
  emptyHint.append(h('div', 'vd-empty-title', 'The stand is empty'), h('div', 'vd-empty-sub', 'Open a card on the right to start: Nose, Body, Tail and Launch pad, in any order. Each card starts with a shape taken from a real rocket.'));
  emptyHint.hidden = true;
  const viewbar = h('div', 'vd-viewbar');
  const turn = h('input', 'vd-turn');
  turn.type = 'range';
  turn.min = '0'; turn.max = '360'; turn.step = '1'; turn.value = '0';
  turn.title = 'Turn the vehicle';
  turn.addEventListener('input', () => { scene3d.orbit.yaw = (Number(turn.value) * Math.PI) / 180; scene3d.orbit.idle = 0; });
  const autoBtn = btn('vd-icon', '⟲', () => { scene3d.orbit.auto = !scene3d.orbit.auto; autoBtn.setAttribute('aria-pressed', String(scene3d.orbit.auto)); }, { tool: 'auto' });
  autoBtn.title = 'Turn on its own';
  autoBtn.setAttribute('aria-pressed', 'true');
  const fitBtn = btn('vd-icon', '⤢', () => { scene3d.fit(); sound('ui.click'); }, { tool: 'zoomfit' });
  fitBtn.title = 'Show the whole vehicle';
  viewbar.append(fitBtn, turn, autoBtn, h('span', 'vd-view-hint', 'drag to turn · wheel to zoom · click a part'));
  view.append(emptyHint, viewbar);

  const dock = h('aside', 'vd-dock');
  const cardsEl = h('div', 'vd-sections');
  const dockFoot = h('div', 'vd-dock-foot');
  const lensBtn = btn('vd-link', 'Show the formulas ▸', () => { state.lens = !state.lens; lensWrap.hidden = !state.lens; lensBtn.textContent = state.lens ? 'Hide the formulas ▾' : 'Show the formulas ▸'; }, { tool: 'numbers' });
  const lensWrap = h('div', 'vd-lens');
  lensWrap.hidden = true;
  const lensHost = h('div', 'bld-lens');
  lensWrap.append(lensHost);
  dockFoot.append(lensBtn, lensWrap);
  dock.append(cardsEl, dockFoot);
  stage.append(view, dock);
  el.append(top, stage);

  // ---------- helpers ----------
  const sound = (id) => hooks.onSound?.(id);
  const changed = () => hooks.onChange?.();
  const toast = (m, kind) => hooks.onToast?.(m, kind);
  const kitOf = (def) => catalog.kit?.(def) ?? null;
  const materialFamily = (def) => materials?.families?.[def.materialFamily] ?? null;
  const materialOf = (part, def) => { const fam = materialFamily(def); return fam ? (fam.options.find((o) => o.id === part?.material) ?? fam.options.find((o) => o.id === def.defaultMaterial) ?? fam.options[0]) : null; };
  const entryOf = (id) => assembly.layout().find((e) => e.id === id) ?? null;
  const figuresOf = (def, part = null) => partFigures(def, { engines, g0, materials, catalog, materialId: part?.material ?? null, options: part?.options ?? null, engineDef: part?.engine ?? null, count: part ? (entryOf(part.id)?.cluster?.count ?? 1) : 1 });
  const dims = (def) => ({ radius: BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1), height: def.height });
  const optionIcon = (def, slot, option) => icons.objectIcon(`int:${def.internals}:${slot.key}:${option.id}`, () => {
    const opts = { ...catalog.optionsOf(def, null), [slot.key]: option };
    const all = internalsArt(def, opts, dims(def));
    return (all.find((p) => p.key === slot.key) ?? all[0])?.object;
  }, { pad: 1.25 });
  scene3d.setOptionsResolver((id) => assembly.options(id));
  const sectionWarnings = (id) => {
    if (!last) return { blocks: [], warnings: [] };
    return { blocks: last.blocks.filter((w) => WARNING_SECTION[w] === id), warnings: last.spec.warnings.filter((w) => WARNING_SECTION[w] === id) };
  };
  const priceOfShape = (shape) => {
    let cost = 0, mass = 0;
    for (const t of shape.stack) { const d = catalog.get(t); if (!d) continue; const f = figuresOf(d); const n = d.engine ? (catalog.get(shape.stack[shape.stack.indexOf(t) - 1])?.mounts?.count ?? 1) : 1; cost += f.cost * (d.engine ? seriesFactor(n) : n); mass += f.wet === f.mass ? f.mass * n : f.wet; } // a cluster is priced as a series (stats.js seriesFactor)
    for (const r of shape.radial ?? []) { const d = catalog.get(r.type); if (!d) continue; const f = figuresOf(d); cost += f.cost * (d.booster ? seriesFactor(r.symmetry ?? 1) : (r.symmetry ?? 1)); mass += f.wet * (r.symmetry ?? 1); }
    return { cost, mass };
  };
  const shapeIcon = (shape) => {
    const pick = shape.icon ?? shape.stack.find((t) => catalog.get(t)?.flags?.capsule || catalog.get(t)?.mounts || catalog.get(t)?.fuel) ?? shape.stack[0];
    const d = catalog.get(pick);
    return d ? icons.iconFor(d) : '';
  };

  // ---------- navigation ----------
  const here = () => state.path[state.path.length - 1] ?? { view: 'home' };
  function openSection(id, view = { view: 'home' }) {
    cardApi?.close();
    state.open = id;
    state.path = [{ view: 'home' }];
    if (view.view !== 'home') state.path.push(view);
    state.focus = null;
    sync3d();
    render();
  }
  function go(view) { state.path.push(view); state.focus = null; sync3d(); render(); dockScrollTop(); }
  function back() {
    if (state.path.length > 1) state.path.pop(); else { closeAll(); return; }
    state.focus = null;
    sync3d();
    render();
  }
  function closeAll() {
    cardApi?.close();
    state.open = null;
    state.path = [];
    state.focus = null;
    sync3d();
    render();
  }
  function dockScrollTop() { const body = cardsEl.querySelector('.vd-sec-body'); if (body) body.scrollTop = 0; }
  function sync3d() {
    const v = here();
    scene3d.setActiveSection(state.open);
    if (v.view === 'part' || v.view === 'slot') {
      scene3d.select(v.id);
      if (v.view === 'slot') { scene3d.focusOn(v.id, { exploded: true }); scene3d.highlightPiece(v.key); } else { scene3d.focusOn(v.id); scene3d.highlightPiece(null); }
    } else {
      scene3d.select(null);
      scene3d.highlightPiece(null);
      if (state.open) scene3d.focusSection(state.open); else scene3d.fit();
    }
  }

  // ---------- generic list item ----------
  // A clean row: picture, name, one short line, price, then a small action button (quick) or a tag. With onOpen the
  // row opens the big explanation card (an "i" marks it); onToggle alone keeps the older expand-in-place form
  // (expanded, detail, action) for any card that still uses it.
  function item({ id, img = null, name, sub = '', price = '', tag = null, on = false, expanded = false, onToggle, onOpen = null, quick = null, chevron = null, detail = null, action = null, hot = false, twoLines = false }) {
    const wrap = h('div', `vd-item${on ? ' vd-item--on' : ''}${expanded ? ' vd-item--open' : ''}${hot ? ' vd-item--hot' : ''}${onOpen ? ' vd-item--card' : ''}${twoLines ? ' vd-item--two' : ''}`);
    wrap.dataset.item = id;
    const line = h('div', 'vd-item-line');
    const row = btn('vd-item-row', null, onOpen ?? onToggle, { item: id });
    if (onOpen) row.title = 'What it is, in plain words';
    if (img !== null) {
      const im = h('img', 'vd-item-img');
      im.src = img || '';
      im.alt = '';
      im.draggable = false;
      row.append(im);
    }
    const txt = h('span', 'vd-item-txt');
    txt.append(h('span', 'vd-item-name', name), h('span', 'vd-item-sub', sub));
    row.append(txt);
    const right = h('span', 'vd-item-right');
    if (tag) right.append(h('span', `vd-tag vd-tag--${tag.kind ?? 'info'}`, tag.text));
    if (price) right.append(h('span', 'vd-item-price', price));
    if (chevron) right.append(h('span', 'vd-item-chev', chevron));
    else if (onOpen) right.append(h('span', 'vd-item-info', 'i'));
    else right.append(h('span', 'vd-item-chev', expanded ? '▾' : '▸'));
    row.append(right);
    line.append(row);
    if (quick) line.append(btn('vd-quick', quick.label, () => quick.run(), { quick: quick.tool ?? 'install' }));
    wrap.append(line);
    if (expanded && (detail || action)) {
      const d = h('div', 'vd-item-detail');
      if (detail) d.append(...[].concat(detail).filter(Boolean));
      if (action) d.append(action);
      wrap.append(d);
    }
    return wrap;
  }
  const fact = (k, v, cls = '') => { const r = h('div', 'vd-fact'); r.append(h('span', 'vd-fact-k', k), h('span', `vd-fact-v ${cls}`, v)); return r; };
  const facts = (...rows) => { const f = h('div', 'vd-facts'); f.append(...rows.filter(Boolean)); return f; };
  const prosCons = (pros = [], cons = []) => {
    const w = h('div', 'vd-proscons');
    const p = h('ul', 'vd-pros'); for (const x of pros) p.append(h('li', null, x));
    const c = h('ul', 'vd-cons'); for (const x of cons) c.append(h('li', null, x));
    w.append(p, c);
    return w;
  };
  const para = (text, cls = 'vd-text') => h('p', cls, text);
  const primary = (label, onClick, tool) => btn('vd-btn vd-btn--choose', label, onClick, { tool });
  const toggleFocus = (id) => { state.focus = state.focus === id ? null : id; sound('ui.click'); render(); };

  // facts about a part definition (optionally an installed part)
  function partFacts(def, fig, part = null) {
    const rows = [];
    if (def.engine && fig.engine) {
      const e = fig.engine, n = e.count ?? 1;
      rows.push(fact(n > 1 ? `Thrust (${n} engines, sea level / vacuum)` : 'Thrust (sea level / vacuum)', `${fmtKN(e.thrustSL * n)} / ${fmtKN(e.thrust * n)}`));
      rows.push(fact('Isp (sea level / vacuum)', `${fmtInt(e.ispSL)} / ${fmtInt(e.ispVac)} s`));
      rows.push(fact('Engine', `${e.fuel} · ${e.nozzle === 'sl' ? 'sea-level' : 'vacuum'} nozzle · pump ${e.pump}`));
    }
    if (def.booster && fig.booster) {
      rows.push(fact('Thrust', fmtKN(fig.booster.thrust)), fact('Isp (sea level / vacuum)', `${fmtInt(fig.booster.ispSL)} / ${fmtInt(fig.booster.ispVac)} s`), fact('Propellant · burn', `${fmtMass(fig.booster.propellant)} · ${fmtInt(fig.booster.burnTime)} s`));
    }
    if (def.mounts) rows.push(fact('Engine positions', String(def.mounts.count ?? 1)));
    if (def.fuel) rows.push(fact('Propellant', `${fmtMass(def.fuel.mass)} of ${def.fuel.type}`));
    rows.push(fact(def.fuel || def.booster ? 'Dry mass' : 'Mass', fmtMass(fig.mass)), fact('Price', fmtMoney(fig.cost)), fact('Reliability', fmtPct(fig.reliability), fig.reliability < 0.95 ? 'vd-warn' : ''));
    if (fig.power) rows.push(fact('Power', `${fmtInt(fig.power)} W at Earth`));
    if (fig.chuteCdA) rows.push(fact('Parachute drag area', `${fmtInt(fig.chuteCdA)} m²`));
    if (def.flags?.spareO2Tanks) rows.push(fact('Spare oxygen', `${def.flags.spareO2Tanks} refill${def.flags.spareO2Tanks > 1 ? 's' : ''}`));
    if (def.flags?.armorHits) rows.push(fact('Debris hits absorbed', String(def.flags.armorHits)));
    if (def.flags?.reliabilityBonus) rows.push(fact('Whole-ship reliability', `+${(def.flags.reliabilityBonus * 100).toFixed(1)} %`));
    if (def.aero?.cdA) rows.push(fact('Drag area on ascent', `${def.aero.cdA} m²`));
    if (def.aero?.entryCdA) rows.push(fact('Drag area on entry', `${def.aero.entryCdA} m²`));
    rows.push(fact('Size', `${def.height.toFixed(2)} m · ${def.size.toUpperCase()} diameter`));
    if (def.real) rows.push(fact('Real-world reference', def.real));
    if (part) { const mat = materialOf(part, def); if (mat) rows.push(fact('Material', mat.name)); }
    return facts(...rows);
  }
  // a part from a list: the row opens the explanation card, the small button installs it straight away
  function candidateItem(def, { installed = null, installedPart = null, onInstall, label = 'INSTALL' }) {
    const fig = figuresOf(def);
    const isOn = installed?.id === def.id;
    const sub = def.fuel ? `${fmtMass(def.fuel.mass)} ${def.fuel.type}` : def.booster ? fmtKN(fig.booster.thrust) : def.engine ? `${fmtKN(fig.engine.thrust)} each` : def.mounts ? `${def.mounts.count} engine${def.mounts.count > 1 ? 's' : ''}` : (def.desc || def.role || '');
    const run = () => onInstall(def);
    const kind = label === 'SWAP' ? 'swap' : 'install';
    return item({
      id: def.id, img: icons.iconFor(def), name: def.name, sub, price: `${def.engine ? 'from ' : ''}${fmtMoneyShort(fig.cost)}`,
      on: isOn, tag: isOn ? { text: 'INSTALLED', kind: 'on' } : null,
      onOpen: () => { sound('ui.click'); openCard({ kind: 'part', def, install: { kind, tool: 'install', run }, compareWith: installed && !isOn ? { def: installed, part: installedPart } : null }); },
      quick: isOn ? null : { label, tool: 'install', run },
    });
  }

  // ---------- views of a vehicle section ----------
  function viewHome(sec) {
    const out = [];
    const w = sectionWarnings(sec.id);
    if (w.blocks.length) {
      const box = h('div', 'vd-issues');
      for (const id of w.blocks) box.append(h('div', 'vd-issue vd-issue--block', WARN[id] ?? id));
      out.push(box);
    }
    const parts = sectionParts(assembly, sec.id);
    const empty = !parts.axial.length;
    // 1. the shape
    const shape = currentShape(assembly, sec);
    const shapeBlock = h('div', 'vd-block');
    shapeBlock.append(h('div', 'vd-label', '1 · Shape'));
    if (empty) {
      shapeBlock.append(para('Nothing here yet. Pick a shape to start: each one is a real rocket\'s layout, and every part in it can be changed afterwards.', 'vd-muted'));
      shapeBlock.append(...shapeItems(sec));
    } else {
      shapeBlock.append(item({ id: 'shape', img: shape ? shapeIcon(shape) : icons.iconFor(catalog.get(parts.axial[0].type)), name: shape?.name ?? 'Custom', sub: shape?.real ?? 'Your own layout', price: '', onToggle: () => go({ view: 'shapes' }) }));
    }
    out.push(shapeBlock);
    // 2. the components
    if (!empty || sec.rows.some((r) => r.mode === 'radial')) {
      const comp = h('div', 'vd-block');
      comp.append(h('div', 'vd-label', '2 · Components'));
      for (const row of sec.rows) {
        const items = rowItems(assembly, sec, row);
        if (row.mode === 'auto' && !items.length) continue;
        const group = h('div', 'vd-row');
        const head = h('div', 'vd-row-head');
        head.append(h('span', 'vd-row-name', row.name), h('span', 'vd-row-role', row.role ?? ''));
        group.append(head);
        for (const { part, twins } of items) {
          const def = catalog.get(part.type);
          const fig = figuresOf(def, part);
          const e = entryOf(part.id);
          const n = e?.cluster?.count ?? 1;
          const mat = materialOf(part, def);
          const sub = def.engine ? `${n > 1 ? `${n} × ` : ''}${part.engine?.fuel ?? ''} · ${part.engine?.nozzle === 'vac' ? 'vacuum' : 'sea-level'} nozzle` : mat?.name ?? def.role ?? '';
          // clicking an installed part opens its controls in the column and its explanation card in the middle
          group.append(item({ id: part.id, img: icons.iconFor(def), name: `${def.name}${twins > 1 ? ` ×${twins}` : ''}`, sub, price: fmtMoneyShort(fig.cost * twins), chevron: '▸', onOpen: () => { sound('ui.click'); go({ view: 'part', id: part.id }); openCard({ kind: 'part', def, part }); } }));
        }
        const canAdd = row.mode === 'radial' || (row.mode === 'stack' && (row.multi || row.id === 'tanks' || row.id === 'structure' || row.id === 'payload' || !items.length));
        if (canAdd && rowCandidates(catalog, sec, row).length) {
          const required = !items.length && ['capsule', 'engines', 'tanks'].includes(row.id);
          group.append(btn(`vd-add${required ? ' vd-add--required' : ''}`, `+ ${items.length ? 'Add another' : required ? 'Add (required)' : 'Add'}`, () => { sound('ui.click'); go({ view: 'add', row: row.id }); }, { add: row.id }));
        }
        comp.append(group);
      }
      out.push(comp);
    }
    // the skin row only where this section has a skin (a material choice there would change nothing otherwise)
    if (!empty && hullHasSkin(assembly.layout(), sec.id)) {
      const skin = h('div', 'vd-block');
      skin.append(h('div', 'vd-label', '3 · Outer skin'));
      const mat = hullMaterial(assembly.hull, sec.id);
      const fig = last?.breakdown.hull?.bySection?.[sec.id];
      skin.append(item({ id: 'hull', img: null, name: mat?.name ?? 'Skin', sub: fig?.mass ? `${fmtMass(fig.mass)} · covers the gaps between parts` : (mat?.note ?? ''), price: fig?.cost ? fmtMoneyShort(fig.cost) : '', onToggle: () => { sound('ui.click'); go({ view: 'hull' }); } }));
      out.push(skin);
    }
    if (!empty) out.push(btn('vd-btn vd-btn--danger vd-btn--wide', `REMOVE THE WHOLE ${sec.short.toUpperCase()}`, () => hooks.onConfirm?.(`Take the ${sec.short.toLowerCase()} off the vehicle?`, () => { clearSection(assembly, sec); sound('ui.click'); changed(); }), { tool: 'clearsection' }));
    return out;
  }

  function useShape(sec, shape) {
    applyShape(assembly, sec, shape);
    sound('ui.snap');
    toast(`${sec.short}: ${shape.name}`);
    state.open = sec.id;
    state.path = [{ view: 'home' }];
    state.focus = null;
    changed();
    sync3d();
  }
  function shapeItems(sec) {
    const cur = currentShape(assembly, sec);
    return sec.shapes.map((shape) => {
      const { cost } = priceOfShape(shape);
      const isOn = cur?.id === shape.id;
      return item({
        id: shape.id, img: shapeIcon(shape), name: shape.name, sub: shape.real ?? '', price: fmtMoneyShort(cost), on: isOn, tag: isOn ? { text: 'IN USE', kind: 'on' } : null,
        onOpen: () => { sound('ui.click'); openCard({ kind: 'shape', section: sec.id, shape }); },
        quick: isOn ? null : { label: 'USE', tool: 'useshape', run: () => useShape(sec, shape) },
      });
    });
  }

  function viewShapes(sec) {
    return [para(`Each shape is the layout of a real rocket's ${sec.short.toLowerCase()}. Choosing one replaces this section; the other sections and the equipment you added stay.`, 'vd-muted'), ...shapeItems(sec)];
  }

  function viewAdd(sec, rowId) {
    const row = sec.rows.find((r) => r.id === rowId);
    if (!row) return [];
    const defs = rowCandidates(catalog, sec, row);
    return [para(row.role ?? '', 'vd-muted'), ...defs.map((def) => candidateItem(def, { onInstall: (d) => addPart(sec, row, d) }))];
  }
  /** Adds a part through its row (as + Add does) and shows it; false when it does not fit. */
  function addPart(sec, row, d) {
    const { ids, message } = addThroughRow(assembly, sec, row, d.id);
    if (!ids.length) { sound('ui.error'); toast(message, 'bad'); return false; }
    sound('ui.snap');
    toast(message);
    changed();
    state.open = sec.id;
    state.path = [{ view: 'home' }, { view: 'part', id: ids[0] }];
    state.focus = null;
    sync3d();
    render();
    return true;
  }
  /** Swaps an installed part for another of the same row; false when it does not fit. */
  function swapPart(id, to) {
    const from = catalog.get(assembly.part(id)?.type);
    if (!assembly.replace(id, to.id)) { sound('ui.error'); toast('That part does not fit in this place.', 'bad'); return false; }
    sound('ui.snap');
    toast(`${from?.name ?? 'Part'} → ${to.name}`);
    state.focus = null;
    changed();
    return true;
  }

  function viewPart(sec, id) {
    const part = assembly.part(id);
    const def = part && catalog.get(part.type);
    if (!def) { back(); return []; }
    const fig = figuresOf(def, part);
    const out = [];
    // the picture and the name open the explanation card; the rest of this view is the part's own controls
    const explainIt = () => { sound('ui.click'); openCard({ kind: 'part', def, part }); };
    const head = btn('vd-part-head', null, explainIt, { tool: 'explain' });
    head.title = 'What it is, in plain words';
    const im = h('img', 'vd-part-img');
    im.src = icons.iconFor(def);
    im.alt = def.name;
    im.draggable = false;
    const ht = h('span', 'vd-part-title');
    ht.append(h('span', 'vd-part-name', def.name), h('span', 'vd-role', def.role ?? ''), h('span', 'vd-explain-link', 'What it does, in plain words ▸'));
    head.append(im, ht);
    out.push(head, partFacts(def, fig, part));
    // material
    const fam = materialFamily(def);
    if (fam) {
      const cur = materialOf(part, def);
      const box = h('div', 'vd-block');
      box.append(h('div', 'vd-label', `Material · ${fam.name}`));
      const chips = h('div', 'vd-chips');
      for (const o of fam.options) {
        const c = btn('vd-chip-btn', o.name, () => { assembly.setMaterial(id, o.id); sound('ui.click'); changed(); }, { material: o.id });
        c.setAttribute('aria-pressed', String(cur?.id === o.id));
        chips.append(c);
      }
      box.append(chips);
      if (cur) box.append(para(`${cur.note ?? ''} ${cur.facts ? `(${cur.facts})` : ''}`, 'vd-muted'), h('div', 'vd-small', `mass ×${cur.mass} · cost ×${cur.cost} · reliability ${signed(cur.reliability * 100, (n) => `${n.toFixed(1)} %`)}`));
      out.push(box);
    }
    // inside
    const kit = kitOf(def);
    if (kit) {
      const box = h('div', 'vd-block');
      box.append(h('div', 'vd-label', `Inside · ${kit.name}`), para('Open a line to look inside: the part comes apart on the left and you choose each piece.', 'vd-muted'));
      const opts = assembly.options(id);
      for (const slot of kit.slots) box.append(item({ id: `slot:${slot.key}`, img: optionIcon(def, slot, opts[slot.key] ?? slot.options[0]), name: slot.name, sub: opts[slot.key]?.name ?? '', onToggle: () => { sound('ui.click'); go({ view: 'slot', id, key: slot.key }); } }));
      out.push(box);
    }
    // engine templates and workbench
    if (def.engine) {
      const box = h('div', 'vd-block');
      box.append(h('div', 'vd-label', 'Set it up like a real engine'));
      const chips = h('div', 'vd-chips');
      for (const ref of engines.references ?? []) {
        const c = btn('vd-chip-btn', ref.name, () => {
          assembly.setEngine(id, { fuel: ref.fuel, nozzle: ref.nozzle, pump: ref.pump });
          for (const [k, v] of Object.entries(ref.options ?? {})) assembly.setOption(id, k, v);
          sound('ui.snap');
          toast(`${ref.name}: ${ref.facts}`);
          changed();
        }, { template: ref.id });
        c.title = ref.facts;
        chips.append(c);
      }
      box.append(chips, btn('vd-btn vd-btn--wide', 'ENGINE WORKBENCH: chamber · nozzle · pump', () => hooks.onWorkbench?.(id), { tool: 'workbench' }));
      out.push(box);
    }
    // swap
    const row = rowOf(sec, def);
    const swaps = row ? rowCandidates(catalog, sec, row).filter((d) => d.id !== def.id && canReplace(part, def, d)) : [];
    if (swaps.length) {
      const box = h('div', 'vd-block');
      box.append(h('div', 'vd-label', 'Swap it for'));
      box.append(...swaps.map((d) => candidateItem(d, { installed: def, installedPart: part, label: 'SWAP', onInstall: (to) => swapPart(id, to) })));
      out.push(box);
    }
    out.push(btn('vd-btn vd-btn--danger vd-btn--wide', 'REMOVE THIS PART', () => { assembly.remove(id); sound('ui.click'); toast(`${def.name} removed.`); state.path.pop(); changed(); sync3d(); }, { tool: 'remove' }));
    return out;
  }

  function canReplace(part, def, to) {
    if (!to || def.attach !== to.attach) return false;
    if (to.attach === 'axial') {
      if (part.parent !== null && part.node !== 'radial' && !to.nodes.includes(part.node === 'top' ? 'bottom' : 'top')) return false;
      for (const c of assembly.children(part.id)) if (!to.nodes.includes(c.node)) return false;
    }
    return true;
  }

  function deltaLine(o) {
    const bits = [];
    if (o.massF && o.massF !== 1) bits.push(`mass ×${o.massF}`);
    if (o.massD) bits.push(signed(o.massD, fmtMass));
    if (o.costF && o.costF !== 1) bits.push(`cost ×${o.costF}`);
    if (o.costD) bits.push(signed(o.costD, fmtMoneyShort));
    if (o.isp) bits.push(`Isp ${signed(o.isp, (n) => `${n} s`)}`);
    if (o.thrustF && o.thrustF !== 1) bits.push(`thrust ×${o.thrustF}`);
    if (o.powerF && o.powerF !== 1) bits.push(`power ×${o.powerF}`);
    if (o.chuteF && o.chuteF !== 1) bits.push(`drag ×${o.chuteF}`);
    if (o.rel) bits.push(`reliability ${signed(o.rel * 100, (n) => `${n.toFixed(1)} %`)}`);
    return bits.length ? bits.join(' · ') : 'baseline';
  }

  function viewSlot(sec, id, key) {
    const part = assembly.part(id);
    const def = part && catalog.get(part.type);
    const slot = def && kitOf(def)?.slots.find((s) => s.key === key);
    if (!slot) { back(); return []; }
    const current = assembly.options(id)[key] ?? slot.options[0];
    const out = [para(slot.role ?? '', 'vd-muted')];
    const now = figuresOf(def, part);
    const fuel = assembly.fuelFor(id);
    for (const o of slot.options) {
      const isOn = current?.id === o.id;
      // an option that cannot burn this ship's propellant is shown greyed, with what it needs (stats falls back too)
      const fits = catalog.fitsFuel?.(o, fuel) ?? true;
      const then = figuresOf(def, { ...part, options: { ...(part.options ?? {}), [key]: o.id } });
      const fx = isOn ? 'fitted now' : !fits ? `Needs ${o.fuels.map((f) => FUEL_WORDS[f] ?? f).join(' or ')}` : effectWords({ now, next: then, lang: 'en' }).join(' · ') || deltaLine(o);
      const row = item({
        id: o.id, img: optionIcon(def, slot, o), name: o.name, sub: fx, twoLines: true, on: isOn, tag: isOn ? { text: 'FITTED', kind: 'on' } : !fits ? { text: 'WRONG FUEL', kind: 'off' } : null,
        onOpen: () => { sound('ui.click'); openCard({ kind: 'option', def, slot, option: o, part }); },
        quick: isOn || !fits ? null : { label: 'USE THIS', tool: 'useoption', run: () => { assembly.setOption(id, key, o.id); sound('ui.snap'); state.focus = null; changed(); } },
      });
      if (!fits) row.classList.add('vd-item--off');
      out.push(row);
    }
    return out;
  }

  // ---------- outer skin of a section (hull.js) ----------
  function viewHull(sec) {
    const cur = hullMaterial(assembly.hull, sec.id);
    const out = [para('Real rockets are one smooth body: skirts, interstages and fairings cover every narrower part. Pick what this section\'s skin is made of.', 'vd-muted')];
    for (const m of hullChoices(sec.id)) {
      const isOn = m.id === cur?.id;
      const bits = [m.short, Number.isFinite(m.maxTempC) ? `up to ${fmtInt(m.maxTempC)} °C` : null, m.massPerM2 ? `${m.massPerM2} kg/m²` : null].filter(Boolean);
      out.push(item({
        id: m.id, img: skinIcon(m), name: m.name, sub: bits.join(' · '), price: m.costPerM2 ? `${fmtMoneyShort(m.costPerM2)}/m²` : '', on: isOn, tag: isOn ? { text: 'CHOSEN', kind: 'on' } : null,
        onOpen: () => { sound('ui.click'); openCard({ kind: 'hull', section: sec.id, material: m }); },
        quick: isOn ? null : { label: 'USE', tool: 'choose', run: () => useSkin(sec.id, m) },
      }));
    }
    return out;
  }
  function useSkin(sectionId, m) { assembly.setHull(sectionId, m.id); sound('ui.click'); state.focus = null; changed(); }

  // ---------- the launch pad card (designPad.js) ----------
  // ---------- the big explanation card (partCard.js) ----------
  // openCard({ kind: 'part' | 'option' | 'shape' | 'pad' | 'equip' | 'hull', ... }). A target may carry its own
  // `action: { kind, run, tool }`; otherwise actionFor() below decides what its main button does.
  const openCard = (target) => cardApi?.open?.(target);
  /** The part fitted now in the same row as def (one kind only), to compare with; null when def itself is fitted. */
  function installedFor(def) {
    const sec = sections[def?.section];
    const row = sec && rowOf(sec, def);
    if (!row) return null;
    const items = rowItems(assembly, sec, row);
    if (!items.length || items.some((x) => x.part.type === def.id)) return null;
    const kinds = new Set(items.map((x) => x.part.type));
    if (kinds.size !== 1) return null;
    return { def: catalog.get(items[0].part.type), part: items[0].part };
  }
  /** A part reached from inside the card (a shape's list): add it as + Add would, or swap the one in its place. */
  function defaultInstall(def) {
    const sec = sections[def?.section];
    const row = sec && rowOf(sec, def);
    if (!row) return null;
    const items = rowItems(assembly, sec, row);
    if (items.some((x) => x.part.type === def.id)) return { status: 'installed' };
    const canAdd = row.mode === 'radial' || (row.mode === 'stack' && (row.multi || ['tanks', 'structure', 'payload'].includes(row.id) || !items.length));
    if (canAdd) return { kind: 'install', tool: 'install', run: () => addPart(sec, row, def) };
    const one = items.find((x) => canReplace(x.part, catalog.get(x.part.type), def));
    return one ? { kind: 'swap', tool: 'install', run: () => swapPart(one.part.id, def) } : null;
  }
  /** What the card's main button does for a target: { kind, run, tool } or { status } (INSTALLED, FITTED…). */
  function actionFor(tg) {
    if (tg.action) return tg.action;
    if (tg.kind === 'part') {
      if (tg.part && assembly.part(tg.part.id)) return { status: 'installed' };
      return tg.install ?? defaultInstall(tg.def);
    }
    if (tg.kind === 'option') {
      const part = tg.part && assembly.part(tg.part.id);
      if (!part) return null;
      const cur = assembly.options(part.id)[tg.slot.key] ?? tg.slot.options[0];
      if (cur?.id === tg.option.id) return { status: 'fitted' };
      return { kind: 'use', tool: 'useoption', run: () => { assembly.setOption(part.id, tg.slot.key, tg.option.id); sound('ui.snap'); changed(); } };
    }
    if (tg.kind === 'shape') {
      const sec = typeof tg.section === 'string' ? sections[tg.section] : tg.section;
      if (!sec) return null;
      if (currentShape(assembly, sec)?.id === tg.shape.id) return { status: 'inUse' };
      return { kind: 'useShape', tool: 'useshape', run: () => useShape(sec, tg.shape) };
    }
    if (tg.kind === 'hull') {
      const sid = typeof tg.section === 'string' ? tg.section : tg.section?.id;
      if (hullMaterial(assembly.hull, sid)?.id === tg.material.id) return { status: 'chosen' };
      return { kind: 'useSkin', tool: 'choose', run: () => useSkin(sid, tg.material) };
    }
    if (tg.kind === 'pad') {
      if (padNow().site?.id === tg.pad?.id) return { status: 'chosen' };
      if (!assembly.setLaunch || !tg.pad?.id) return null;
      // as the pad card does: a new complex brings its own kit and weather, so the old choices and forecast go
      return { kind: 'choose', tool: 'choose', run: () => { assembly.setLaunch({ site: tg.pad.id, complex: undefined, slot: undefined, forecast: undefined, day: 0, pad: {} }); sound('ui.click'); changed(); } };
    }
    if (tg.kind === 'equip') {
      const id = typeof tg.option === 'string' ? tg.option : tg.option?.id;
      if (!id) return null;
      const now = padNow().equipment.find((c) => c.eq.key === tg.key)?.option;
      if (now?.id === id) return { status: 'chosen' };
      if (!assembly.setPadOption) return null;
      return { kind: 'choose', tool: 'choose', run: () => { assembly.setPadOption(tg.key, id); sound('ui.click'); changed(); } };
    }
    return null;
  }
  /** The launch complex and the equipment in use: the player's own choice, else the complex's kit, else the first option. */
  function padNow() {
    const st = padSetup(assembly.launch, sections.pad);
    return { site: st.complex, equipment: st.choices, setup: st };
  }
  /** A launch complex's numbers as the pad card shows them: fees, heat limit, a day of waiting, the forecast. */
  function padFigures(c) {
    const pad = sections.pad;
    const st = padSetup(assembly.launch, pad);
    const b = last?.breakdown;
    if (st.complex?.id === c.id) {
      const weather = b?.weather?.complex === c.id ? b.weather : weatherFor(assembly.launch, { pad, launchData });
      const fx = b?.padFx && b.padFx.complex?.id === c.id ? b.padFx : padEffects(assembly.launch, { pad, weather, thrustSL: b?.thrustSL ?? 0, g: g0 });
      return { current: true, fee: fx.fee - (fx.feeParts?.hold ?? 0) - (fx.feeParts?.repairDue ?? 0), feeLabel: 'feeNow', heatLimitKN: fx.heatLimitKN ?? heatLimitOf(st), holdFee: weather.holdFee, forecastC: weather.forecastC, climate: weather.climate ?? c.climate?.name ?? null };
    }
    const w = weatherFor({ site: c.id, seed: assembly.launch?.seed }, { pad, launchData });
    return { current: false, fee: kitFee(c, pad), feeLabel: 'kitFee', heatLimitKN: heatLimitOf(padSetup({ site: c.id }, pad)), holdFee: w.holdFee, forecastC: w.forecastC, climate: w.climate ?? c.climate?.name ?? null };
  }
  /** One equipment option at the complex chosen now: the pad's heat limit with it, its own number, a day of waiting. */
  function equipFigures(key, o) {
    const st = padSetup(assembly.launch, sections.pad);
    const choices = st.choices.map((c) => (c.eq.key === key ? { ...c, option: o } : c));
    const heat = key === 'mount' || key === 'deluge';
    return {
      heatLimitKN: heat ? heatLimitOf({ ...st, choices }) : null, heatLabel: 'heatHere', ownHeatKN: o.heatKN ?? null,
      holdFee: o.holdF != null ? Math.round((st.complex?.holdFee ?? 0) * o.holdF) : null,
    };
  }
  // pictures: the same cache keys and art as the pad card (designPad.js), so each picture is rendered once
  const padIcon = (c) => icons?.objectIcon?.(`pad:${c.id}`, () => padArt({ site: c, slot: { tempC: 10 }, equipment: padSetup({ site: c.id }, sections.pad).choices }, { radius: 1.25, height: 14, icon: true }).object, { pad: 1.02 }) ?? '';
  const equipIcon = (key, o) => icons?.objectIcon?.(`padeq:${key}:${o.id}`, () => padArt({ site: null, slot: { tempC: 10 }, equipment: [{ eq: { key }, option: o }] }, { radius: 1.25, height: 14, icon: true, only: key }).object, { pad: 1.05 }) ?? '';
  /** A swatch of a skin material: a short ring of the real skin art. */
  function skinIcon(m) {
    return icons?.objectIcon?.(`skin:${m.id}`, () => hullArt([{ kind: 'skirt', y0: 0, y1: 1.3, r0: 0.9, r1: 0.9, material: m.id, section: 'body' }]), { pad: 1.05 }) ?? '';
  }
  /** A shape's totals for the card: price, mass with propellant, propellant, push at sea level, height. */
  function shapeFigures(section, shape) {
    const { cost, mass } = priceOfShape(shape);
    let propellant = 0, thrustSL = 0, height = 0;
    shape.stack.forEach((t, i) => {
      const d = catalog.get(t);
      if (!d) return;
      height += d.height ?? 0;
      propellant += d.fuel?.mass ?? 0;
      if (d.engine) {
        const n = catalog.get(shape.stack[i - 1])?.mounts?.count ?? 1;
        const f = partFigures(d, { engines, g0, materials, catalog, engineDef: { fuel: shape.engine?.fuel ?? 'methalox', nozzle: shape.engine?.nozzle ?? 'sl', pump: String(d.size).toUpperCase() }, count: n });
        thrustSL += f.engine?.totalThrustSL ?? 0;
      }
    });
    for (const r of shape.radial ?? []) {
      const d = catalog.get(r.type);
      if (!d?.booster) continue;
      const f = figuresOf(d);
      propellant += (d.booster.propellant ?? 0) * (r.symmetry ?? 1);
      thrustSL += f.booster.thrust * (f.booster.ispVac > 0 ? f.booster.ispSL / f.booster.ispVac : 1) * (r.symmetry ?? 1);
    }
    const size = shape.diameter ?? shape.stack.map((t) => catalog.get(t)?.size).find(Boolean) ?? 'm';
    return { cost, mass, propellant, thrustSL, height, diameter: 2 * BASE_RADIUS * (SIZE_SCALE[size] ?? 1) };
  }
  cardApi = createPartCard({
    explainFor, catalog, sections, g0, getMoney, icons,
    figuresOf: (def, part = null) => figuresOf(def, part),
    diameterOf: (def) => (def.attach === 'axial' && !def.engine ? 2 * BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1) : 0), // an engine or a side part is not as wide as the stage
    entryOf,
    optionsOf: (def, opts) => catalog.optionsOf?.(def, opts) ?? {},
    currentOption: (part, slot) => assembly.options(part.id)[slot.key] ?? slot.options[0],
    installedFor, actionFor, shapeFigures,
    currentShape: (sid) => (sections[sid] ? currentShape(assembly, sections[sid]) : null),
    hullNow: (sid) => hullMaterial(assembly.hull, sid),
    padNow, padFigures, equipFigures, padIcon, equipIcon, skinIcon,
    partExists: (id) => !!assembly.part(id),
    freshPart: (id) => assembly.part(id),
    onSound: (id) => sound(id),
  });
  stage.insertBefore(cardApi.el, dock);
  const padViews = createPadViews({ assembly, sections, h, item, fact, facts, para, prosCons, primary, signed, go, back, state, sound, changed, toggleFocus, getLast: () => last, icons, openCard, g: g0 });

  // ---------- cards ----------
  function sectionSummary(id) {
    if (id === 'pad') return padViews.summary();
    const sec = sections[id];
    const { axial, radial } = sectionParts(assembly, id);
    if (!axial.length && !radial.length) return { line: 'Not built yet: click to start', built: false, img: null };
    const shape = currentShape(assembly, sec);
    const cost = (last?.breakdown.parts ?? []).filter((p) => catalog.get(p.type)?.section === id).reduce((t, p) => t + (p.cost ?? 0), 0);
    let detail = `${axial.length + radial.length} parts`;
    if (id === 'body') detail = `${fmtMass(axial.reduce((t, p) => t + (catalog.get(p.type)?.fuel?.mass ?? 0), 0))} propellant`;
    if (id === 'tail') { const eng = axial.find((p) => catalog.get(p.type)?.engine); const n = eng ? entryOf(eng.id)?.cluster?.count ?? 1 : 0; detail = eng ? `${n > 1 ? `${n} × ` : ''}${catalog.get(eng.type).name.replace('Engine, ', '')}` : 'no engine'; }
    const main = axial.find((p) => catalog.get(p.type)?.flags?.capsule) ?? axial.find((p) => catalog.get(p.type)?.mounts) ?? axial.find((p) => catalog.get(p.type)?.fuel) ?? axial[0];
    return { line: `${shape?.name ?? 'Custom'} · ${detail} · ${fmtMoneyShort(cost)}`, built: true, img: main ? icons.iconFor(catalog.get(main.type)) : null };
  }
  function crumbs(id) {
    const sec = sections[id];
    const names = [sec.short];
    for (const v of state.path.slice(1)) {
      if (id === 'pad') { names.push(padViews.crumb(v)); continue; }
      if (v.view === 'hull') names.push('Outer skin');
      else if (v.view === 'shapes') names.push('Shape');
      else if (v.view === 'add') names.push(`Add: ${sec.rows.find((r) => r.id === v.row)?.name ?? ''}`);
      else if (v.view === 'part') names.push(catalog.get(assembly.part(v.id)?.type)?.name ?? 'Part');
      else if (v.view === 'slot') names.push(kitOf(catalog.get(assembly.part(v.id)?.type))?.slots.find((s) => s.key === v.key)?.name ?? 'Inside');
    }
    return names;
  }
  function bodyFor(id) {
    const v = here();
    if (id === 'pad') return padViews.body(v);
    const sec = sections[id];
    if (v.view === 'hull') return viewHull(sec);
    if (v.view === 'shapes') return viewShapes(sec);
    if (v.view === 'add') return viewAdd(sec, v.row);
    if (v.view === 'part') return viewPart(sec, v.id);
    if (v.view === 'slot') return viewSlot(sec, v.id, v.key);
    return viewHome(sec);
  }
  function render() {
    if (el.hidden) return;
    const keepScroll = cardsEl.querySelector('.vd-sec-body')?.scrollTop ?? 0;
    const samePlace = render.lastKey === `${state.open}:${state.path.length}:${JSON.stringify(here())}`;
    render.lastKey = `${state.open}:${state.path.length}:${JSON.stringify(here())}`;
    cardsEl.replaceChildren();
    for (const id of [...VEHICLE_SECTIONS, 'pad']) {
      const sec = sections[id];
      const open = state.open === id;
      const sum = sectionSummary(id);
      const w = sectionWarnings(id);
      const issues = w.blocks.length;
      const card = h('article', `vd-sec${open ? ' vd-sec--open' : ''}${!sum.built ? ' vd-sec--empty' : ''}`);
      card.dataset.section = id;
      const head = btn('vd-sec-head', null, () => { sound('ui.click'); if (open) closeAll(); else openSection(id); }, { section: id });
      head.append(h('span', 'vd-sec-num', SECTION_NUM[id]));
      if (sum.img) { const im = h('img', 'vd-sec-img'); im.src = sum.img; im.alt = ''; im.draggable = false; head.append(im); } else head.append(h('span', `vd-sec-img vd-sec-img--${id}`));
      const t = h('span', 'vd-sec-txt');
      t.append(h('span', 'vd-sec-name', sec.name), h('span', 'vd-sec-line', sum.line));
      head.append(t);
      head.append(h('span', `vd-sec-status ${!sum.built ? 'vd-sec-status--empty' : w.blocks.length ? 'vd-sec-status--block' : issues ? 'vd-sec-status--warn' : 'vd-sec-status--ok'}`, !sum.built ? '' : issues ? `! ${issues}` : '✓'));
      head.append(h('span', 'vd-sec-chev', open ? '▾' : '▸'));
      card.append(head);
      if (open) {
        const nav = h('div', 'vd-crumbs');
        nav.append(btn('vd-icon vd-back', '◂', () => { sound('ui.click'); back(); }, { tool: 'back' }), h('span', 'vd-crumb', crumbs(id).join('  ›  ')));
        const body = h('div', 'vd-sec-body');
        body.append(...bodyFor(id));
        card.append(nav, body);
        if (samePlace) queueMicrotask(() => { body.scrollTop = keepScroll; });
      }
      cardsEl.append(card);
    }
  }

  // ---------- top-bar numbers ----------
  function chip(label, value, st, sub = null) {
    const c = h('div', 'vd-chip');
    c.dataset.state = st;
    c.append(h('span', 'vd-chip-label', label), h('span', 'vd-chip-value', value));
    if (sub) { c.append(h('span', 'vd-chip-sub', sub)); c.title = sub; } // the small line hides on narrow windows; the tooltip keeps it
    return c;
  }
  function renderStats(result) {
    const s = result.spec.stats, b = result.breakdown;
    const money = getMoney(), fee = b.launchFee ?? b.slot?.fee ?? 0;
    stats.replaceChildren(
      result.reuse
        ? chip('Cost', fmtMoneyShort(result.price ?? s.cost), (result.price ?? s.cost) + fee + (result.pending ?? 0) > money ? 'bad' : 'ok', `refurbished, flight ${(result.reuse.flights ?? 1) + 1}`)
        : chip('Cost', fmtMoneyShort(s.cost), s.cost + fee + (result.pending ?? 0) > money ? 'bad' : 'ok', fee ? `+${fmtMoneyShort(fee)} launch fees` : 'no launch fees'),
      chip('Funds', fmtMoneyShort(money), money < (result.reuse ? result.price ?? s.cost : s.cost) + fee + (result.pending ?? 0) ? 'bad' : 'ok'),
      chip('Δv', fmtInt(s.deltaV), 'ok', 'm/s'),
      chip('TWR', s.twrEarth.toFixed(2), s.twrEarth >= 1 ? 'ok' : 'bad', `${fmtKN(b.thrustSL)} on the pad`),
      chip('Reliability', fmtPct(s.reliability), s.reliability >= 0.9 ? 'good' : s.reliability >= 0.8 ? 'ok' : 'bad'),
    );
    shipName.textContent = assembly.name;
    undoBtn.disabled = !assembly.canUndo;
  }

  // ---------- pointer on the 3D view ----------
  view.addEventListener('click', (e) => {
    if (e.target !== view) return;
    const hit = scene3d.pick(e.clientX, e.clientY, view.getBoundingClientRect());
    if (!hit) return;
    sound('ui.click');
    // the column goes to what was clicked, and the explanation card opens over the ship
    if (hit.pad) {
      openSection('pad');
      const site = padNow().site;
      if (site) openCard({ kind: 'pad', pad: site });
      return;
    }
    if (hit.hull) {
      const sid = hit.section ?? hit.hull;
      const material = (typeof hit.material === 'object' && hit.material) || hullChoices(sid).find((m) => m.id === hit.material) || hullMaterial(assembly.hull, sid);
      if (sections[sid]) openSection(sid);
      if (material) openCard({ kind: 'hull', section: sid, material });
      return;
    }
    const part = assembly.part(hit.partId);
    const def = catalog.get(part?.type);
    if (hit.internal) {
      state.path = [{ view: 'home' }, { view: 'part', id: hit.partId }, { view: 'slot', id: hit.partId, key: hit.internal }];
      state.focus = null;
      sync3d();
      render();
      const slot = def && kitOf(def)?.slots.find((s) => s.key === hit.internal);
      if (slot) openCard({ kind: 'option', def, slot, option: assembly.options(part.id)[slot.key] ?? slot.options[0], part });
      return;
    }
    if (def?.section) {
      openSection(def.section, { view: 'part', id: hit.partId });
      openCard({ kind: 'part', def, part });
    }
  });
  view.addEventListener('wheel', (e) => { e.preventDefault(); scene3d.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  const ghost = document.createElement('canvas');
  ghost.width = ghost.height = 1;
  let drag = null;
  view.addEventListener('dragstart', (e) => {
    if (e.target !== view) { e.preventDefault(); return; }
    e.dataTransfer.setDragImage(ghost, 0, 0);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'turn'); } catch { /* some browsers refuse */ }
    drag = { x: e.clientX, y: e.clientY };
    view.classList.add('vd-view--turning');
  });
  el.addEventListener('dragenter', (e) => { if (drag) e.preventDefault(); });
  el.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    if (!e.clientX && !e.clientY) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (dx || dy) { scene3d.rotateBy(dx, dy); drag = { x: e.clientX, y: e.clientY }; }
  });
  el.addEventListener('drop', (e) => { if (drag) e.preventDefault(); });
  view.addEventListener('dragend', () => { drag = null; view.classList.remove('vd-view--turning'); });

  // ---------- refresh ----------
  let padKey = '';
  function refresh(result) {
    last = result;
    renderStats(result);
    scene3d.setLayout(assembly.layout());
    // the pad is redrawn when its own choices or the ship's size change (the tower and its arms fit the ship)
    const lay = scene3d.layout.filter((e) => e.attach === 'axial');
    const radius = lay.reduce((r, e) => Math.max(r, e.radius), 1.25);
    const height = lay.reduce((t, e) => Math.max(t, e.y + e.height), 0);
    const key = padViews.artKey({ radius, height });
    if (key !== padKey) {
      padKey = key;
      scene3d.setPad(padViews.art({ radius, height, layout: scene3d.layout }));
    }
    if (scene3d.missingArt.length) hooks.onNeedArt?.(scene3d.missingArt);
    emptyHint.hidden = assembly.parts.length > 0;
    // a part that disappeared (undo, swap, clear) closes its views
    while (state.path.length > 1 && ['part', 'slot'].includes(here().view) && !assembly.part(here().id)) state.path.pop();
    render();
    cardApi?.refresh();
  }

  function update(dt) {
    if (el.hidden) return;
    const v = here();
    const part = (v.view === 'part' || v.view === 'slot') ? assembly.part(v.id) : null;
    const canExplode = part && kitOf(catalog.get(part.type));
    scene3d.setExplode(!canExplode ? 0 : v.view === 'slot' ? 1 : scene3d.zoomFraction());
    const rect = view.getBoundingClientRect();
    if (rect.width && rect.height) scene3d.setViewCentre(rect.left + rect.width / 2, rect.top + rect.height / 2, window.innerWidth, window.innerHeight);
    scene3d.update(dt);
    turn.value = String(((((scene3d.orbit.yaw * 180) / Math.PI) % 360) + 360) % 360);
    cardApi?.update(dt); // the card's turning view renders only while the card is open
  }

  function show({ card = null, view: v = null } = {}) {
    el.hidden = false;
    hooks.onOpen3d?.(scene3d.scene, scene3d.camera);
    scene3d.setEnvironment();
    padKey = '';
    refresh(last ?? hooks.compute?.());
    if (card) openSection(card, v ?? { view: 'home' }); else { closeAll(); scene3d.fit(); }
  }
  function hide() {
    if (el.hidden) return;
    cardApi?.close();
    el.hidden = true;
    state.open = null;
    state.path = [];
    scene3d.select(null);
    scene3d.setActiveSection(null);
    scene3d.clearViewCentre();
    hooks.onClose3d?.();
  }

  return {
    el, lensHost, refresh, show, hide, update,
    /** Esc: close the explanation card first, then one step back inside the open card, then close the card. Returns true when it did something. */
    back: () => {
      if (cardApi?.isOpen) { cardApi.close(); return true; }
      if (!state.open) return false;
      back();
      return true;
    },
    /** The big explanation card: open(target), close(), isOpen. */
    card: cardApi,
    openCard,
    closePicker: () => closeAll(),
    rotateBy: (deg) => { scene3d.orbit.yaw += (deg * Math.PI) / 180; scene3d.orbit.idle = 0; },
    openSection,
    get open() { return !el.hidden; },
    get pickerOpen() { return !!state.open; },
  };
}
