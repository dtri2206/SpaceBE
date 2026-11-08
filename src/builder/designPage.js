// The vehicle design page: an engineering diagram of the stack, top to bottom, like a launch-vehicle cutaway.
// Click any part (or an empty slot) and a row of replacement cards opens at the top: picture, what it is for,
// pros and cons, material and price. The wheel zooms the diagram. Few buttons, one idea at a time.
import { autoAttach } from './autoplace.js';
import { engineStats } from './stats.js';
import { fmtInt, fmtKN, fmtMass, fmtMoney, fmtMoneyShort, fmtPct } from './format.js';

const PPM = 42; // pixels per metre in the diagram at zoom 1
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
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const ZONES = [
  { id: 'head', name: 'HEAD', hint: 'Nose cone or crew capsule. The trip starts here.', families: ['structure', 'command'], axialOnly: true },
  { id: 'body', name: 'BODY', hint: 'Propellant tanks and the heat shield.', families: ['tanks', 'thermal'], axialOnly: true },
  { id: 'tail', name: 'TAIL', hint: 'The engine. Legs and fins clamp around it.', families: ['engines'], axialOnly: true },
];
const CHECKLIST = [
  { id: 'nose', label: 'Nose cone', test: (s, l) => l.some((e) => /nose/.test(e.type)), family: 'structure', pick: (p) => /nose/.test(p.id) },
  { id: 'capsule', label: 'Crew capsule', test: (s) => s.parts.some((p) => /capsule/.test(p.type)), family: 'command', pick: (p) => !!p.flags.capsule },
  { id: 'shield', label: 'Heat shield', test: (s) => s.stats.hasHeatShield, family: 'thermal', pick: (p) => !!p.flags.heatShield },
  { id: 'tank', label: 'Propellant tanks', test: (s) => s.stats.fuelMass > 0, family: 'tanks', pick: (p) => !!p.fuel },
  { id: 'engine', label: 'Engine', test: (s) => s.engines.length > 0, family: 'engines', pick: (p) => !!p.engine },
  { id: 'legs', label: 'Landing legs', test: (s) => s.stats.hasLegs, family: 'recovery', pick: (p) => !!p.flags.legs },
  { id: 'fins', label: 'Fins', test: (s, l) => l.some((e) => /fin/.test(e.type)), family: 'structure', pick: (p) => /fin/.test(p.id) },
  { id: 'rcs', label: 'Thrusters (RCS)', test: (s) => s.stats.hasRCS, family: 'control', pick: (p) => !!p.flags.rcs },
  { id: 'antenna', label: 'Antenna', test: (s) => s.stats.hasAntenna, family: 'comms', pick: (p) => !!p.flags.antenna },
  { id: 'o2', label: 'Spare oxygen', test: (s) => s.stats.spareO2Tanks > 0, family: 'life', pick: (p) => !!p.flags.spareO2Tanks },
  { id: 'shelter', label: 'Radiation shelter', test: (s) => s.stats.hasShelter, family: 'life', pick: (p) => !!p.flags.shelter },
  { id: 'chute', label: 'Parachute', test: (s) => s.stats.hasParachute, family: 'recovery', pick: (p) => !!p.flags.parachute },
  { id: 'power', label: 'Power', test: (s) => s.stats.power >= 1500, family: 'power', pick: (p) => !!p.flags.power },
  { id: 'science', label: 'Science instruments', test: (s, l) => l.some((e) => e.def.flags?.science), family: 'science', pick: (p) => !!p.flags.science },
];

export function createDesignPage({ assembly, catalog, materials, engines, text, icons, getMoney, hooks }) {
  const el = h('section', 'vd-root hud');
  el.hidden = true;
  const state = { selected: null, slot: null, zone: null, family: null, zoom: 1, numbers: false };
  let last = null;

  // ---------- header ----------
  const top = h('header', 'vd-top');
  const title = h('div', 'vd-title');
  const shipName = h('button', 'vd-ship-name', assembly.name);
  shipName.type = 'button';
  shipName.addEventListener('click', () => hooks.onRename?.());
  title.append(h('span', 'vd-kicker', 'Vehicle design'), shipName);
  const stats = h('div', 'vd-stats');
  const actions = h('div', 'vd-actions');
  const undoBtn = btn('vd-btn', 'UNDO', () => { if (assembly.undo()) { hooks.onSound?.('ui.click'); changed(); } }, { tool: 'undo' });
  actions.append(
    undoBtn,
    btn('vd-btn', 'PRESETS', () => hooks.onPresets?.(), { tool: 'presets' }),
    btn('vd-btn', 'MORE ▾', () => openMore(), { tool: 'more' }),
    btn('vd-btn vd-btn--test', 'TEST FIRE', () => hooks.onTest?.(), { tool: 'test' }),
    btn('vd-btn vd-btn--go', 'READINESS POLL →', () => hooks.onGonogo?.(), { tool: 'gonogo' }),
    btn('vd-btn', 'CLOSE  [Esc]', () => hooks.onClose?.(), { tool: 'close' }),
  );
  top.append(title, stats, actions);

  // ---------- picker ----------
  const picker = h('section', 'vd-picker');
  picker.hidden = true;
  const pickerHead = h('div', 'vd-picker-head');
  const pickerTitle = h('div', 'vd-picker-title');
  const pickerTabs = h('div', 'vd-picker-tabs');
  const pickerClose = btn('vd-btn vd-btn--ghost', '✕', () => closePicker(), { tool: 'pickerclose' });
  pickerHead.append(pickerTitle, pickerTabs, pickerClose);
  const cards = h('div', 'vd-cards');
  const detail = h('div', 'vd-detail'); // the selected installed part: material + remove + workbench
  picker.append(pickerHead, cards, detail);

  // ---------- stage ----------
  const stage = h('main', 'vd-stage');
  const canvas = h('div', 'vd-canvas');
  const sizer = h('div', 'vd-sizer'); // takes the zoomed size so the canvas scrolls to every corner of the drawing
  const diagram = h('div', 'vd-diagram');
  const lines = svgEl('svg', { class: 'vd-lines' });
  const layer = h('div', 'vd-layer');
  diagram.append(lines, layer);
  sizer.append(diagram);
  canvas.append(sizer);
  const zoomBar = h('div', 'vd-zoom');
  const clampBtn = btn('vd-btn', '+ CLAMP EQUIPMENT TO THE BODY', null, { tool: 'clamp' });
  zoomBar.append(
    btn('vd-btn vd-btn--ghost', '−', () => setZoom(state.zoom / 1.25), { tool: 'zoomout' }),
    btn('vd-btn vd-btn--ghost', 'FIT', () => setZoom(1), { tool: 'zoomfit' }),
    btn('vd-btn vd-btn--ghost', '+', () => setZoom(state.zoom * 1.25), { tool: 'zoomin' }),
    h('span', 'vd-zoom-hint', 'wheel: zoom'),
    clampBtn,
  );
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // zoom about the pointer: keep the point under the mouse where it is
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const before = state.zoom;
    setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    const k = state.zoom / before;
    canvas.scrollLeft = (canvas.scrollLeft + px) * k - px;
    canvas.scrollTop = (canvas.scrollTop + py) * k - py;
  }, { passive: false });
  const side = h('aside', 'vd-side');
  const checklist = h('div', 'vd-checklist');
  const warnings = h('div', 'vd-warnings');
  const numbersToggle = btn('vd-btn vd-btn--ghost', 'SHOW THE NUMBERS', () => { state.numbers = !state.numbers; lensWrap.hidden = !state.numbers; numbersToggle.textContent = state.numbers ? 'HIDE THE NUMBERS' : 'SHOW THE NUMBERS'; }, { tool: 'numbers' });
  const lensWrap = h('div', 'vd-lens');
  lensWrap.hidden = true;
  const lensHost = h('div', 'bld-lens');
  lensWrap.append(lensHost);
  side.append(h('div', 'hud-label', 'Build checklist'), checklist, warnings, numbersToggle, lensWrap);
  stage.append(canvas, zoomBar, side);
  el.append(top, picker, stage);

  // ---------- helpers ----------
  const sound = (id) => hooks.onSound?.(id);
  const changed = () => hooks.onChange?.();
  const materialFamily = (def) => materials?.families?.[def.materialFamily] ?? null;
  const materialOf = (part, def) => { const fam = materialFamily(def); return fam ? (fam.options.find((o) => o.id === part.material) ?? fam.options[0]) : null; };
  const baseEngine = (def) => engineStats({ fuel: 'methalox', nozzle: 'sl', pump: String(def.size).toUpperCase() }, engines, 1);
  const partCost = (def) => (def.engine ? baseEngine(def).cost : def.cost);
  const partMass = (def) => (def.engine ? baseEngine(def).mass : def.mass + (def.fuel?.mass ?? 0));

  function setSize(w, hgt) {
    state.size = { w, h: hgt };
    diagram.style.width = `${w}px`;
    diagram.style.height = `${hgt}px`;
    lines.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    lines.setAttribute('width', w);
    lines.setAttribute('height', hgt);
    applyZoom();
  }
  function applyZoom() {
    const { w, h: hgt } = state.size ?? { w: 720, h: 620 };
    sizer.style.width = `${w * state.zoom}px`;
    sizer.style.height = `${hgt * state.zoom}px`;
    diagram.style.transform = `scale(${state.zoom})`;
  }
  function setZoom(z) {
    state.zoom = Math.min(2.6, Math.max(0.35, z));
    applyZoom();
  }

  function canReplace(part, def, to) {
    if (!to || def.attach !== to.attach || to.id === def.id) return false;
    if (to.attach === 'axial') {
      if (part.parent !== null && !to.nodes.includes(part.node === 'top' ? 'bottom' : 'top')) return false;
      for (const c of assembly.children(part.id)) if (!to.nodes.includes(c.node)) return false;
    }
    return true;
  }

  // ---------- cards ----------
  function card(def, { chosen = false, onChoose, label = 'CHOOSE' } = {}) {
    const c = h('article', 'vd-card');
    c.dataset.part = def.id;
    if (chosen) c.classList.add('vd-card--chosen');
    const img = h('img', 'vd-card-img');
    img.alt = def.name;
    img.src = icons?.iconFor(def) || '';
    img.draggable = false;
    const pros = h('ul', 'vd-pros');
    for (const p of def.pros ?? []) pros.append(h('li', null, p));
    const cons = h('ul', 'vd-cons');
    for (const p of def.cons ?? []) cons.append(h('li', null, p));
    const meta = h('div', 'vd-card-meta', `${fmtMass(partMass(def))} · ${def.engine ? 'from ' : ''}${fmtMoneyShort(partCost(def))}${def.fuel ? ` · ${def.fuel.type}` : ''}`);
    c.append(img, h('div', 'vd-card-name', def.name), h('div', 'vd-card-role', def.role ?? def.desc ?? ''), pros, cons, meta);
    if (onChoose) c.append(btn(`vd-btn ${chosen ? 'vd-btn--ghost' : 'vd-btn--choose'}`, chosen ? 'INSTALLED' : label, () => onChoose(def), { tool: 'choose' }));
    return c;
  }

  function materialCard(option, { chosen, onChoose, def }) {
    const c = h('article', `vd-card vd-card--material${chosen ? ' vd-card--chosen' : ''}`);
    const pros = h('ul', 'vd-pros');
    for (const p of option.pros ?? []) pros.append(h('li', null, p));
    const cons = h('ul', 'vd-cons');
    for (const p of option.cons ?? []) cons.append(h('li', null, p));
    const baseCost = partCost(def);
    c.append(
      h('div', 'vd-card-name', option.name),
      h('div', 'vd-card-role', option.note ?? ''),
      pros, cons,
      h('div', 'vd-card-meta', `mass ×${option.mass} · ${fmtMoneyShort(baseCost * option.cost)} · reliability ${option.reliability >= 0 ? '+' : ''}${(option.reliability * 100).toFixed(1)} %`),
      btn(`vd-btn ${chosen ? 'vd-btn--ghost' : 'vd-btn--choose'}`, chosen ? 'IN USE' : 'USE THIS', () => onChoose(option), { tool: 'material' }),
    );
    return c;
  }

  // ---------- picker modes ----------
  function openPickerForPart(id) {
    const part = assembly.part(id);
    const def = part && catalog.get(part.type);
    if (!def) return;
    state.selected = id;
    state.slot = null;
    state.zone = null;
    const candidates = catalog.parts.filter((p) => canReplace(part, def, p) || p.id === def.id);
    renderPicker({
      title: `${def.name}`, subtitle: 'Replace it with…', candidates,
      onChoose: (to) => { if (assembly.replace(id, to.id)) { sound('ui.snap'); hooks.onToast?.(`${def.name} → ${to.name}`); changed(); openPickerForPart(id); } else { sound('ui.error'); hooks.onToast?.('That part does not fit in this place.', 'bad'); } },
      chosenId: def.id,
    });
    // detail: material, workbench, remove
    detail.replaceChildren();
    const fam = materialFamily(def);
    if (fam) {
      const current = materialOf(part, def);
      const row = h('div', 'vd-material-row');
      row.append(h('div', 'hud-label', `${fam.name}: material`));
      const mats = h('div', 'vd-cards vd-cards--materials');
      for (const option of fam.options) mats.append(materialCard(option, { chosen: current?.id === option.id, def, onChoose: (o) => { assembly.setMaterial(id, o.id); sound('ui.click'); changed(); openPickerForPart(id); } }));
      row.append(mats);
      detail.append(row);
    }
    const tools = h('div', 'vd-detail-tools');
    if (def.engine) tools.append(btn('vd-btn', 'ENGINE WORKBENCH: chamber · nozzle · pump', () => hooks.onWorkbench?.(id), { tool: 'workbench' }));
    tools.append(btn('vd-btn vd-btn--danger', 'REMOVE THIS PART', () => { assembly.remove(id); sound('ui.click'); hooks.onToast?.(`${def.name} removed.`); closePicker(); changed(); }, { tool: 'remove' }));
    detail.append(tools);
    detail.hidden = false;
    renderDiagram();
  }

  function openPickerForSlot(partId, node) {
    state.selected = null;
    state.zone = null;
    state.slot = { partId, node };
    const host = assembly.def(partId);
    const candidates = catalog.parts.filter((p) => assembly.canAttach(p.id, partId, node).ok);
    renderPicker({
      title: node === 'radial' ? `Clamp something to the ${host?.name}` : `Add ${node === 'top' ? 'above' : 'below'} the ${host?.name}`,
      subtitle: 'Pick a part', candidates,
      onChoose: (to) => {
        const ids = node === 'radial' ? assembly.attach(to.id, partId, node, { symmetry: /fin/.test(to.id) ? 4 : 1 }) : assembly.attach(to.id, partId, node);
        if (!ids.length) { sound('ui.error'); return; }
        sound('ui.snap');
        hooks.onToast?.(`${to.name} attached.`);
        changed();
        // keep building downwards: select the new part's far node
        if (to.attach === 'axial') {
          const far = node === 'top' ? 'top' : 'bottom';
          if (to.nodes.includes(far)) { openPickerForSlot(ids[0], far); return; }
        }
        closePicker();
      },
    });
    detail.hidden = true;
    renderDiagram();
  }

  function openPickerForZone(zone) {
    state.selected = null;
    state.slot = null;
    state.zone = zone.id;
    const candidates = catalog.parts.filter((p) => p.attach === 'axial' && zone.families.includes(p.family))
      .sort((a, b) => zone.families.indexOf(a.family) - zone.families.indexOf(b.family)); // the zone's own family first (nose cones before capsules)
    renderPicker({
      title: `${zone.name}: ${zone.hint}`, subtitle: 'Pick the first part. The rest stacks under it.', candidates,
      onChoose: (to) => {
        const ids = assembly.attach(to.id);
        if (!ids.length) { sound('ui.error'); return; }
        sound('ui.snap');
        hooks.onToast?.(`${to.name} placed on the stand.`);
        changed();
        if (to.nodes.includes('bottom')) openPickerForSlot(ids[0], 'bottom'); else closePicker();
      },
    });
    detail.hidden = true;
  }

  function openPickerForFamily(item) {
    state.selected = null;
    state.slot = null;
    state.zone = null;
    const candidates = catalog.parts.filter((p) => item.pick(p));
    renderPicker({
      title: item.label, subtitle: 'Pick one and it goes where a technician would put it.', candidates,
      onChoose: (to) => {
        const { ids, message } = autoAttach(assembly, to.id);
        if (!ids.length) { sound('ui.error'); hooks.onToast?.(message, 'bad'); return; }
        sound('ui.snap');
        hooks.onToast?.(message);
        changed();
        closePicker();
      },
    });
    detail.hidden = true;
  }

  function renderPicker({ title: t, subtitle, candidates, onChoose, chosenId = null }) {
    picker.hidden = false;
    pickerTitle.replaceChildren(h('strong', null, t), h('span', null, subtitle));
    const families = catalog.families.filter((f) => candidates.some((c) => c.family === f.id));
    if (!families.some((f) => f.id === state.family)) state.family = families.length > 1 ? null : families[0]?.id ?? null;
    pickerTabs.replaceChildren();
    if (families.length > 1) {
      const all = btn('vd-tab', 'ALL', () => { state.family = null; renderPicker({ title: t, subtitle, candidates, onChoose, chosenId }); });
      all.setAttribute('aria-pressed', String(state.family === null));
      pickerTabs.append(all);
      for (const f of families) {
        const b = btn('vd-tab', f.name, () => { state.family = f.id; renderPicker({ title: t, subtitle, candidates, onChoose, chosenId }); });
        b.setAttribute('aria-pressed', String(state.family === f.id));
        pickerTabs.append(b);
      }
    }
    const shown = candidates.filter((c) => !state.family || c.family === state.family);
    cards.replaceChildren(...shown.map((def) => card(def, { chosen: def.id === chosenId, onChoose })));
    if (!shown.length) cards.append(h('div', 'vd-empty-note', 'Nothing fits here.'));
    cards.scrollLeft = 0;
  }

  function closePicker() {
    picker.hidden = true;
    state.selected = null;
    state.slot = null;
    state.zone = null;
    renderDiagram();
  }

  function openMore() {
    hooks.onMore?.();
  }

  // ---------- diagram ----------
  function renderDiagram() {
    if (!last) return;
    layer.replaceChildren();
    lines.replaceChildren();
    const lay = assembly.layout();
    const axial = lay.filter((e) => e.attach === 'axial');
    if (!axial.length) {
      renderEmpty();
      return;
    }
    const stackHeight = axial.reduce((t, e) => Math.max(t, e.y + e.height), 0);
    const maxR = axial.reduce((r, e) => Math.max(r, e.radius), 1.25);
    const colW = 260; // label columns
    const bodyW = Math.max(220, maxR * 2 * PPM + 160);
    const totalW = colW * 2 + bodyW;
    const pad = 70;
    let totalH = stackHeight * PPM + pad * 2;
    const cx = colW + bodyW / 2;
    const yTop = (m) => pad + (stackHeight - m) * PPM;
    let side = 0;
    // Labels are queued, then laid out per column so none overlaps: sorted by where they want to be, pushed
    // apart to LABEL_H, and pulled back up as a block when the column runs past the bottom of the drawing.
    const LABEL_H = 46;
    const pending = { left: [], right: [] };
    const placeLabel = (which, wantedY, text, sub, onClick, selected, tipX, tipY) => pending[which].push({ wantedY, text, sub, onClick, selected, tipX, tipY });
    const leader = (x1, y1, x2, y2) => lines.append(svgEl('polyline', { points: `${x1},${y1} ${x2},${y2}`, class: 'vd-leader' }));
    const layoutLabels = () => {
      let lowest = 0;
      for (const which of ['left', 'right']) {
        const list = pending[which].sort((a, b) => a.wantedY - b.wantedY);
        let y = -Infinity;
        for (const it of list) { it.y = Math.max(it.wantedY, y + LABEL_H); y = it.y; }
        let limit = totalH - LABEL_H / 2 - 8;
        for (let i = list.length - 1; i >= 0; i--) { list[i].y = Math.min(list[i].y, limit); limit = list[i].y - LABEL_H; }
        for (const it of list) {
          const label = btn(`vd-label${it.selected ? ' vd-label--selected' : ''}`, null, it.onClick);
          label.append(h('span', 'vd-label-name', it.text), h('span', 'vd-label-sub', it.sub));
          label.style.top = `${it.y - 20}px`;
          label.style.left = which === 'left' ? '8px' : `${colW + bodyW + 8}px`;
          layer.append(label);
          leader(which === 'left' ? colW - 4 : colW + bodyW + 4, it.y, it.tipX, it.tipY);
          lowest = Math.max(lowest, it.y + LABEL_H / 2);
        }
      }
      return lowest;
    };

    for (const e of axial) {
      const view = icons.sideViewFor(e.def, PPM * 2);
      const wPx = view.widthM * PPM, hPx = Math.max(6, e.height * PPM);
      const img = h('img', `vd-part${state.selected === e.id ? ' vd-part--selected' : ''}`);
      img.src = view.url;
      img.alt = e.def.name;
      img.draggable = false;
      img.style.left = `${cx - wPx / 2}px`;
      img.style.top = `${yTop(e.y + e.height)}px`;
      img.style.width = `${wPx}px`;
      img.style.height = `${hPx}px`;
      img.addEventListener('click', () => { sound('ui.click'); openPickerForPart(e.id); });
      layer.append(img);
      const which = side++ % 2 === 0 ? 'left' : 'right';
      const mat = materialOf(assembly.part(e.id), e.def);
      const sub = e.engine ? `${e.engine.fuel} · ${e.engine.nozzle} nozzle · pump ${e.engine.pump}` : mat ? mat.name : e.def.role ?? '';
      placeLabel(which, yTop(e.centerY), e.def.name, sub, () => { sound('ui.click'); openPickerForPart(e.id); }, state.selected === e.id, which === 'left' ? cx - wPx / 2 - 6 : cx + wPx / 2 + 6, yTop(e.centerY));
    }
    // side-mounted parts: grouped by symmetry group, drawn once beside the body
    const seen = new Set();
    for (const e of lay.filter((x) => x.attach === 'radial')) {
      if (e.group && seen.has(e.group)) continue;
      if (e.group) seen.add(e.group);
      const view = icons.sideViewFor(e.def, PPM * 2);
      const scale = Math.min(1, 1.6 / Math.max(view.heightM, 0.3));
      const wPx = view.widthM * PPM * scale, hPx = Math.max(10, view.heightM * PPM * scale);
      const right = (e.angle % 360) < 180;
      const host = lay.find((x) => x.id === e.parentId);
      const bodyEdge = (host?.radius ?? 1.25) * PPM;
      const img = h('img', `vd-part vd-part--side${state.selected === e.id ? ' vd-part--selected' : ''}`);
      img.src = view.url;
      img.alt = e.def.name;
      img.draggable = false;
      img.style.left = `${right ? cx + bodyEdge + 10 : cx - bodyEdge - 10 - wPx}px`;
      img.style.top = `${yTop(e.y) - hPx / 2}px`;
      img.style.width = `${wPx}px`;
      img.style.height = `${hPx}px`;
      img.addEventListener('click', () => { sound('ui.click'); openPickerForPart(e.id); });
      layer.append(img);
      const twins = e.group ? assembly.parts.filter((p) => p.group === e.group).length : 1;
      const which = right ? 'right' : 'left';
      placeLabel(which, yTop(e.y), `${e.def.name}${twins > 1 ? ` ×${twins}` : ''}`, e.def.role ?? '', () => { sound('ui.click'); openPickerForPart(e.id); }, state.selected === e.id, right ? cx + bodyEdge + 10 + wPx + 4 : cx - bodyEdge - 10 - wPx - 4, yTop(e.y));
    }
    totalH = Math.max(totalH, layoutLabels() + 12);
    setSize(totalW, totalH);
    // free slots: dashed buttons at the top and bottom of the stack, and one "clamp" slot on the biggest body
    for (const { partId, node } of assembly.freeNodes()) {
      const e = axial.find((x) => x.id === partId);
      if (!e) continue;
      if (node === 'radial') continue;
      const slot = btn(`vd-slot${state.slot?.partId === partId && state.slot?.node === node ? ' vd-slot--selected' : ''}`, node === 'top' ? '+ Add a part on top' : '+ Add a part below', () => { sound('ui.click'); openPickerForSlot(partId, node); }, { node, part: partId });
      slot.style.left = `${cx - 110}px`;
      slot.style.top = `${node === 'top' ? yTop(e.y + e.height) - 44 : yTop(e.y) + 10}px`;
      layer.append(slot);
    }
    const biggest = axial.filter((e) => e.def.nodes.includes('radial')).sort((a, b) => b.height - a.height)[0];
    clampBtn.hidden = !biggest;
    clampBtn.onclick = biggest ? () => { sound('ui.click'); openPickerForSlot(biggest.id, 'radial'); } : null;
    clampBtn.setAttribute('aria-pressed', String(!!biggest && state.slot?.partId === biggest.id && state.slot?.node === 'radial'));
  }

  function renderEmpty() {
    setSize(720, 620);
    clampBtn.hidden = true;
    const wrap = h('div', 'vd-empty');
    wrap.append(h('div', 'vd-empty-title', 'Nothing on the stand yet'), h('div', 'vd-empty-sub', 'A rocket is built from the top down. Pick where to start.'));
    for (const zone of ZONES) {
      const z = btn(`vd-zone${state.zone === zone.id ? ' vd-zone--selected' : ''}`, null, () => { sound('ui.click'); openPickerForZone(zone); }, { zone: zone.id });
      z.append(h('span', 'vd-zone-name', zone.name), h('span', 'vd-zone-hint', zone.hint));
      wrap.append(z);
    }
    layer.append(wrap);
  }

  // ---------- header stats, checklist, warnings ----------
  function chip(label, value, st) {
    const c = h('div', 'vd-chip');
    c.dataset.state = st;
    c.append(h('span', 'vd-chip-label', label), h('span', 'vd-chip-value', value));
    return c;
  }
  function renderStats(result) {
    const s = result.spec.stats;
    const b = result.breakdown;
    const money = getMoney();
    const fee = b.slot?.fee ?? 0;
    stats.replaceChildren(
      chip('Cost', `${fmtMoneyShort(s.cost)}${fee ? ` +${fmtMoneyShort(fee)}` : ''}`, s.cost + fee > money ? 'bad' : 'ok'),
      chip('Funds', fmtMoneyShort(money), money < s.cost + fee ? 'bad' : 'ok'),
      chip('Δv / needed', `${fmtInt(s.deltaV)} / ${fmtInt(b.oneWay)}`, s.deltaV >= b.roundTrip ? 'good' : s.deltaV >= b.oneWay ? 'ok' : 'bad'),
      chip('TWR', s.twrEarth.toFixed(2), s.twrEarth >= 1.2 ? 'ok' : s.twrEarth >= 1 ? 'warn' : 'bad'),
      chip('Mass', `${fmtMass(s.wetMass)} · ${fmtKN(s.thrust * (s.ispVac ? s.ispSL / s.ispVac : 1))}`, 'ok'),
      chip('Reliability', fmtPct(s.reliability), s.reliability >= 0.9 ? 'good' : s.reliability >= 0.8 ? 'ok' : 'bad'),
      chip('Stable', b.copY < b.comY ? 'yes' : 'no', b.copY < b.comY ? 'ok' : 'bad'),
    );
    shipName.textContent = assembly.name;
    undoBtn.disabled = !assembly.canUndo;
    const lay = assembly.layout();
    checklist.replaceChildren(...CHECKLIST.map((item) => {
      const done = item.test(result.spec, lay);
      const row = btn(`vd-check${done ? ' vd-check--done' : ''}`, null, () => { sound('ui.click'); openPickerForFamily(item); }, { check: item.id });
      row.append(h('span', 'vd-check-mark', done ? '✓' : '○'), h('span', 'vd-check-label', item.label));
      return row;
    }));
    const WARN = { LOW_DV: 'Not enough Δv to reach Mars', LOW_TWR: 'Too heavy for the engine (TWR < 1.2)', NO_HEAT_SHIELD: 'No heat shield', NO_LEGS: 'No landing legs', UNSTABLE: 'Unstable: fins too high or missing', LOW_O2: 'No spare oxygen', NO_ANTENNA: 'No antenna', NO_SHELTER: 'No radiation shelter', COLD_SEALS: 'Cheap seals in a cold launch window', LOW_RELIABILITY: 'Reliability below 80 %', NO_CAPSULE: 'No crew capsule', NO_ENGINE: 'No engine', NO_FUEL: 'No usable propellant', NOT_CONNECTED: 'Parts not connected', OVER_BUDGET: 'Over budget' };
    warnings.replaceChildren(
      ...result.blocks.map((id) => h('div', 'vd-warning vd-warning--block', WARN[id] ?? id)),
      ...result.spec.warnings.map((id) => h('div', 'vd-warning', WARN[id] ?? id)),
    );
    if (!result.blocks.length && !result.spec.warnings.length) warnings.append(h('div', 'vd-warning vd-warning--ok', 'All consoles would say GO.'));
  }

  function refresh(result) {
    last = result;
    renderStats(result);
    renderDiagram();
    if (state.selected && !assembly.part(state.selected)) closePicker();
  }

  function show({ family = null } = {}) {
    el.hidden = false;
    state.family = family;
    state.zoom = 1; // every visit starts fitted; the wheel zooms from there
    canvas.scrollTop = 0;
    if (family) {
      const item = CHECKLIST.find((c) => c.family === family);
      if (item) openPickerForFamily(item);
    }
    refresh(last ?? hooks.compute?.());
  }
  function hide() {
    el.hidden = true;
    closePicker();
  }

  return { el, lensHost, refresh, show, hide, closePicker, get open() { return !el.hidden; }, get pickerOpen() { return !picker.hidden; } };
}
