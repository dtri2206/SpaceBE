// The engineering-bay UI layer (state HANGAR): the walking HUD (crosshair, prompt, status chip, toasts) and the
// stations: the vehicle design page (any design machine), the test console, the range terminal and the handbook.
import { createDesignPage } from './designPage.js';
import { createHandbook } from './handbook.js';
import { fmtInt, fmtKN, fmtMass, fmtMoney, fmtMoneyShort, fmtPct } from './format.js';

export const DESIGN_STATIONS = ['integration', 'propulsion', 'structures', 'crew', 'warehouse'];
const STATION_FAMILY = { propulsion: 'engines', structures: 'structure', crew: 'command', warehouse: null, integration: null };

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

export function createHangarScreen({ assembly, catalog, materials, engines, launch, text, scene, getMoney, insolvencyFloor = 0, icons, stations, hooks }) {
  const el = h('div', 'bay-root hud');
  el.dataset.screen = 'hangar';
  el.dataset.stub = 'hangar'; // check:boot looks for [data-stub] in every state
  const state = { station: null, testResult: null };
  let last = null;

  // ---------- walking HUD ----------
  const hud = h('div', 'bay-hud');
  const crosshair = h('div', 'bay-crosshair');
  const prompt = h('div', 'bay-prompt');
  const chip = h('div', 'bay-chip hud-panel');
  const chipShip = h('span', 'bay-chip-ship');
  const chipStats = h('span', 'bay-chip-stats');
  const chipFunds = h('span', 'bay-chip-funds');
  chip.append(chipShip, chipStats, chipFunds);
  const hint = h('div', 'bay-hint', 'Click to look around · WASD walk · Shift run · Space jump · E use a machine · H handbook · Esc menu');
  const toast = h('div', 'bay-toast');
  const testStatus = h('div', 'bay-test-status hud-panel hud-caution');
  testStatus.hidden = true;
  hud.append(crosshair, prompt, chip, hint, toast, testStatus);

  // ---------- station panel (test, range, handbook) ----------
  const panel = h('section', 'bay-station hud-panel');
  panel.hidden = true;
  const head = h('header', 'bay-station-head');
  const title = h('div', 'bay-station-title');
  const role = h('div', 'bay-station-role');
  const closeBtn = btn('hud-button bay-station-close', 'CLOSE  [Esc]', () => closeStation());
  head.append(title, role, closeBtn);
  const body = h('div', 'bay-station-body');
  panel.append(head, body);

  // ---------- dialog ----------
  const backdrop = h('div', 'bld-dialog-backdrop');
  backdrop.hidden = true;
  const dialog = h('div', 'bld-dialog hud-panel');
  backdrop.append(dialog);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });

  // ---------- the design page ----------
  const design = createDesignPage({
    assembly, catalog, materials, engines, text, icons, getMoney,
    hooks: {
      onChange: () => hooks.onChange?.(),
      onSound: (id) => hooks.onSound?.(id),
      onToast: (m, kind) => say(m, kind),
      onClose: () => closeStation(),
      onGonogo: () => hooks.onGonogo?.(),
      onTest: () => hooks.onStartTest?.(),
      onPresets: () => hooks.onPresets?.(),
      onWorkbench: (id) => hooks.onWorkbench?.(id),
      onRename: () => openRename(),
      onMore: () => openMore(),
      compute: () => last,
    },
  });

  el.append(hud, panel, design.el, backdrop);

  let toastTimer = null;
  function say(message, kind = 'ok') {
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.classList.add('bay-toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('bay-toast--show'), 2600);
  }
  const sound = (id) => hooks.onSound?.(id);
  const changed = () => hooks.onChange?.();

  // ---------- shared pieces ----------
  function statsGrid(result) {
    const { spec, breakdown, blocks } = result;
    const s = spec.stats;
    const grid = h('div', 'bld-stat-grid');
    const fee = breakdown.slot?.fee ?? 0;
    const stat = (label, value, st = 'ok') => {
      const el_ = h('div', 'bld-stat');
      el_.dataset.state = st;
      el_.append(h('span', 'bld-stat-label', label), h('span', 'bld-stat-value', value));
      grid.append(el_);
    };
    stat('Cost', `${fmtMoney(s.cost)}${fee ? ` + ${fmtMoneyShort(fee)} pad` : ''}`, s.cost + fee > getMoney() ? 'bad' : 'ok');
    stat('Mass wet / dry', `${fmtMass(s.wetMass)} / ${fmtMass(s.dryMass)}`);
    stat('Propellant', fmtMass(s.fuelMass), s.fuelMass > 0 ? 'ok' : 'bad');
    stat('Thrust at sea level', fmtKN(s.thrust * (s.ispVac ? s.ispSL / s.ispVac : 1)), s.thrust > 0 ? 'ok' : 'bad');
    stat('Δv', `${fmtInt(s.deltaV)} m/s`, s.deltaV >= breakdown.roundTrip ? 'good' : s.deltaV >= breakdown.oneWay ? 'ok' : 'bad');
    stat('TWR on Earth', s.twrEarth.toFixed(2), s.twrEarth >= 1.2 ? 'ok' : s.twrEarth >= 1 ? 'warn' : 'bad');
    stat('Reliability', fmtPct(s.reliability), s.reliability >= 0.9 ? 'good' : s.reliability >= 0.8 ? 'ok' : 'bad');
    stat('Stability', breakdown.copY < breakdown.comY ? 'Stable' : 'Unstable', breakdown.copY < breakdown.comY ? 'ok' : 'bad');
    const warnings = h('div', 'bld-warnings');
    warnings.append(
      ...blocks.map((id) => h('div', 'bld-warning hud-alert', `BLOCK: ${id.replace(/_/g, ' ')}`)),
      ...spec.warnings.map((id) => h('div', 'bld-warning hud-caution', id.replace(/_/g, ' '))),
    );
    const wrap = h('div', 'bay-stats');
    wrap.append(grid, warnings);
    return wrap;
  }

  // ---------- station bodies ----------
  function renderTest() {
    body.replaceChildren();
    body.className = 'bay-station-body bay-station-body--test';
    const r = state.testResult;
    const intro = h('p', 'bay-test-intro', 'The stand holds the vehicle down with four clamps. We light the engine, run it at full throttle, then release the clamps for two seconds: a vehicle that cannot lift here will not lift on the pad.');
    const actions = h('div', 'bay-detail-actions');
    const fire = btn('hud-button hud-caution', 'STATIC FIRE + HOLD-DOWN TEST', () => hooks.onStartTest?.(), { tool: 'test' });
    fire.disabled = !assembly.parts.some((p) => catalog.get(p.type)?.engine) || !(last?.spec.stats.fuelMass > 0);
    const poll = btn('hud-button hud-good', 'READINESS POLL →', () => hooks.onGonogo?.(), { tool: 'gonogo' });
    poll.disabled = !assembly.parts.length;
    actions.append(fire, poll);
    body.append(intro, actions);
    if (last) body.append(statsGrid(last));
    if (r) {
      const res = h('div', 'bay-test-result hud-panel');
      res.classList.add(r.lifted ? 'hud-good' : 'hud-alert');
      const line = (k, v, st) => { const row = h('div', 'bay-fact'); row.append(h('span', 'bay-fact-k', k), h('span', `bay-fact-v ${st ?? ''}`, v)); res.append(row); };
      res.append(h('div', 'hud-label', 'Test report'));
      line('Hold-down release', r.lifted ? 'VEHICLE LIFTED' : 'VEHICLE STAYED ON THE STAND', r.lifted ? 'hud-good' : 'hud-alert');
      line('Thrust at sea level', fmtKN(r.thrustSL));
      line('Weight on the pad', fmtKN(r.weight));
      line('Thrust ÷ weight', `${r.twr.toFixed(2)} ${r.twr >= 1.2 ? '(brisk)' : r.twr > 1 ? '(barely)' : '(cannot lift)'}`);
      line('Net acceleration', `${r.netAccel.toFixed(2)} m/s²`);
      line('Propellant flow', `${r.mdot.toFixed(0)} kg/s · full tank in ${fmtInt(r.burnTime)} s`);
      line('Δv available', `${fmtInt(r.deltaV)} m/s`);
      line('Reaches Mars', r.reachesMars ? 'yes' : `no, ${fmtInt(r.oneWay - r.deltaV)} m/s short`, r.reachesMars ? 'hud-good' : 'hud-alert');
      line('Comes home on its own fuel', r.comesHome ? 'yes' : 'no (make methane on Mars)', r.comesHome ? 'hud-good' : 'hud-caution');
      line('Aerodynamically stable', r.stable ? 'yes' : 'no: add fins low on the stack', r.stable ? 'hud-good' : 'hud-alert');
      body.append(res);
    }
  }

  function renderLaunchWindow() {
    body.replaceChildren();
    body.className = 'bay-station-body bay-station-body--range';
    const list = h('div', 'bld-list');
    for (const slot of launch.slots) {
      const item = btn('bld-list-item', null, () => { assembly.setLaunchSlot(slot.id); sound('ui.click'); changed(); renderLaunchWindow(); });
      item.setAttribute('aria-pressed', String(assembly.launch.slot === slot.id));
      item.append(h('span', null, `${slot.name} · ${fmtInt(slot.tempC)} °C`), h('span', 'bld-list-meta', `${slot.fee ? fmtMoneyShort(slot.fee) + ' pad fees' : 'no fees'} · ${slot.note}`));
      list.append(item);
    }
    body.append(h('p', 'bay-test-intro', 'The range gives you three windows. The first is tomorrow at dawn, free, and cold. Seals that are not rated for cold lose their flexibility below 5 °C. That is the whole story of Challenger.'), list);
  }

  let handbook = null;
  function renderHandbook() {
    body.replaceChildren();
    body.className = 'bay-station-body bay-station-body--handbook';
    handbook?.dispose();
    handbook = createHandbook({ parent: body });
  }

  function openStation(id) {
    const st = stations.find((s) => s.id === id);
    if (!st) return;
    state.station = id;
    hud.classList.add('bay-hud--station');
    if (DESIGN_STATIONS.includes(id)) {
      panel.hidden = true;
      design.show({ family: STATION_FAMILY[id] ?? null });
    } else {
      design.hide();
      title.textContent = st.name;
      role.textContent = st.role;
      panel.hidden = false;
      panel.dataset.station = id;
      if (id === 'teststand') renderTest();
      else if (id === 'launchwindow') renderLaunchWindow();
      else if (id === 'handbook') renderHandbook();
    }
    hooks.onStationOpen?.(id);
  }

  function closeStation() {
    if (!state.station) return;
    const id = state.station;
    state.station = null;
    panel.hidden = true;
    design.hide();
    hud.classList.remove('bay-hud--station');
    handbook?.dispose();
    handbook = null;
    closeDialog();
    hooks.onStationClose?.(id);
  }

  // ---------- dialogs ----------
  function openDialog({ title: t, body: content, actions = [] }) {
    dialog.replaceChildren(h('div', 'bld-dialog-title', t));
    const b = h('div', 'bld-dialog-body');
    if (typeof content === 'function') content(b); else if (content) b.append(content);
    dialog.append(b);
    if (actions.length) {
      const row = h('div', 'bld-dialog-actions');
      for (const a of actions) row.append(btn('hud-button', a.label, () => { a.onClick?.(); if (a.close !== false) closeDialog(); }));
      dialog.append(row);
    }
    backdrop.hidden = false;
    return b;
  }
  function closeDialog() {
    backdrop.hidden = true;
    dialog.replaceChildren();
  }
  function openConfirm(question, onYes) {
    openDialog({ title: 'Confirm', body: h('div', null, question), actions: [{ label: 'CANCEL' }, { label: 'YES', onClick: onYes }] });
  }
  function openRename() {
    const input = h('input', 'bld-input');
    input.value = assembly.name;
    input.maxLength = 40;
    openDialog({ title: 'Vehicle name', body: input, actions: [{ label: 'CANCEL' }, { label: 'OK', onClick: () => { assembly.rename(input.value); changed(); } }] });
    input.focus();
    input.select();
  }
  function openMore() {
    openDialog({
      title: 'More',
      body: (b) => {
        const list = h('div', 'bld-list');
        const item = (label, meta, fn) => { const r = btn('bld-list-item', null, () => { closeDialog(); fn(); }); r.append(h('span', null, label), h('span', 'bld-list-meta', meta)); list.append(r); };
        item('Blueprints', 'save and load your designs', () => hooks.onBlueprints?.());
        item('Share code', 'copy a code for a friend, or paste one', () => hooks.onShare?.());
        item('Launch window', `${launch.slots.find((s) => s.id === assembly.launch.slot)?.name ?? ''} · change the date and the weather`, () => openStation('launchwindow'));
        item('Redo', 'put back what you undid', () => { if (assembly.redo()) { sound('ui.click'); changed(); } });
        item('Clear the stand', 'start again from nothing', () => openConfirm('Take the whole vehicle off the stand?', () => { assembly.clear(); changed(); }));
        b.append(list);
      },
      actions: [{ label: 'CLOSE' }],
    });
  }

  // ---------- refresh ----------
  function renderMoney() {
    const m = getMoney();
    chipFunds.textContent = fmtMoney(m);
    chipFunds.dataset.state = last && m < last.spec.stats.cost + (last.breakdown.slot?.fee ?? 0) ? 'bad' : m < insolvencyFloor * 1.5 ? 'low' : 'ok';
  }
  let insolventEl = null;
  function renderInsolvency() {
    const broke = getMoney() < insolvencyFloor;
    if (broke && !insolventEl) {
      insolventEl = h('div', 'bay-insolvent hud-panel hud-alert');
      insolventEl.append(h('span', null, text.hangar?.insolvent ?? 'Insolvent.'), btn('hud-button', 'DECLARE BANKRUPTCY', () => hooks.onBankrupt?.(), { tool: 'bankrupt' }));
      hud.append(insolventEl);
    } else if (!broke && insolventEl) {
      insolventEl.remove();
      insolventEl = null;
    }
  }
  function refresh(result) {
    last = result;
    scene.setLayout(assembly.layout(), assembly.freeNodes());
    const s = result.spec.stats;
    chipShip.textContent = assembly.name;
    chipStats.textContent = `${fmtMoney(s.cost)} · Δv ${fmtInt(s.deltaV)} · TWR ${s.twrEarth.toFixed(2)} · ${result.blocks.length ? `${result.blocks.length} block(s)` : result.spec.warnings.length ? `${result.spec.warnings.length} warning(s)` : 'ready'}`;
    renderMoney();
    renderInsolvency();
    design.refresh(result);
    if (state.station === 'teststand') renderTest();
  }

  function update(dt, { prompt: p = null } = {}) {
    void dt;
    if (!state.station) {
      prompt.textContent = p ? `E · ${p}` : '';
      prompt.classList.toggle('bay-prompt--show', !!p);
    }
  }

  function setTestStatus(txt) {
    testStatus.hidden = !txt;
    testStatus.textContent = txt;
  }
  function showTestResult(result) {
    state.testResult = result;
    setTestStatus('');
    say(result.lifted ? 'Hold-down test: the vehicle lifted.' : 'Hold-down test: the vehicle stayed on the stand.', result.lifted ? 'ok' : 'bad');
  }

  function dispose() {
    clearTimeout(toastTimer);
    handbook?.dispose();
    el.remove();
  }

  return {
    el, lensHost: design.lensHost, update, refresh, openStation, closeStation, openDialog, closeDialog, openConfirm, dispose, renderMoney, say, setTestStatus, showTestResult,
    get station() { return state.station; },
    get dialogOpen() { return !backdrop.hidden; },
    get pickerOpen() { return design.pickerOpen; },
    closePicker: () => design.closePicker(),
  };
}
