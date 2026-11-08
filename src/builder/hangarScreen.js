// The engineering-bay UI layer (state HANGAR): the walking HUD (crosshair, prompt, status chip, toasts) and the
// stations: the vehicle design page (any design machine), the test console, the range terminal and the handbook.
// No hints while building (src/builder/CLAUDE.md §6): the screens show the ship's own numbers, hard blocks only, and
// never the trip's need; the investigation board reveals it after a failed flight.
import { createDesignPage } from './designPage.js';
import { createHandbook } from './handbook.js';
import { staticFireFee } from './asBuilt.js';
import { fmtInt, fmtKN, fmtMass, fmtMoney, fmtMoneyShort, fmtPct } from './format.js';

export const DESIGN_STATIONS = ['integration', 'propulsion', 'structures', 'crew', 'warehouse', 'launchwindow'];
// which card each desk opens on the design page (the integration console and the warehouse show the whole vehicle)
const STATION_START = { propulsion: { card: 'tail' }, structures: { card: 'body' }, crew: { card: 'nose' }, launchwindow: { card: 'pad' }, warehouse: {}, integration: {} };

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

export function createHangarScreen({ assembly, catalog, sections, materials, engines, launch, text, scene, scene3d, g0, getMoney, insolvencyFloor = 0, icons, stations, hooks }) {
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
    assembly, catalog, sections, materials, engines, text, icons, scene3d, g0, getMoney,
    hooks: {
      onChange: () => hooks.onChange?.(),
      onSound: (id) => hooks.onSound?.(id),
      onToast: (m, kind) => say(m, kind),
      onClose: () => closeStation(),
      onGonogo: () => hooks.onGonogo?.(),
      onTest: () => openStation('teststand'), // the test console, where a static fire is paid for and started
      onPresets: () => hooks.onPresets?.(),
      onWorkbench: (id) => hooks.onWorkbench?.(id),
      onRename: () => openRename(),
      onConfirm: (q, yes) => openConfirm(q, yes),
      onMore: () => openMore(),
      onOpen3d: (s, c) => hooks.onView?.(s, c),
      onClose3d: () => hooks.onViewRestore?.(),
      onNeedArt: (ids) => hooks.onNeedArt?.(ids),
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
    const fee = breakdown.launchFee ?? breakdown.slot?.fee ?? 0;
    const price = Number.isFinite(result.price) ? result.price : s.cost;
    const owedNow = result.pending ?? 0;
    const stat = (label, value, st = 'ok') => {
      const el_ = h('div', 'bld-stat');
      el_.dataset.state = st;
      el_.append(h('span', 'bld-stat-label', label), h('span', 'bld-stat-value', value));
      grid.append(el_);
    };
    stat(result.reuse ? 'Refurbishment' : 'Cost', `${fmtMoney(price)}${fee ? ` + ${fmtMoneyShort(fee)} pad` : ''}${owedNow ? ` + ${fmtMoneyShort(owedNow)} owed` : ''}`, price + fee + owedNow > getMoney() ? 'bad' : 'ok');
    stat('Mass wet / dry', `${fmtMass(s.wetMass)} / ${fmtMass(s.dryMass)}`);
    stat('Propellant', fmtMass(s.fuelMass), s.fuelMass > 0 ? 'ok' : 'bad');
    stat('Thrust at sea level', fmtKN(s.thrust * (s.ispVac ? s.ispSL / s.ispVac : 1)), s.thrust > 0 ? 'ok' : 'bad');
    stat('Δv', `${fmtInt(s.deltaV)} m/s`); // the ship's own number only: what the trip needs stays hidden
    stat('TWR on Earth', s.twrEarth.toFixed(2), s.twrEarth >= 1 ? 'ok' : 'bad');
    stat('Reliability', fmtPct(s.reliability));
    stat('Stability', breakdown.copY < breakdown.comY ? 'Stable' : 'Unstable');
    if (result.reuse) stat('Flights / wear', `${result.reuse.flights} · ${fmtPct(result.reuse.mean)}`);
    const warnings = h('div', 'bld-warnings');
    warnings.append(...blocks.map((id) => h('div', 'bld-warning hud-alert', `BLOCK: ${id.replace(/_/g, ' ')}`))); // hard blocks only
    const wrap = h('div', 'bay-stats');
    wrap.append(grid, warnings);
    return wrap;
  }

  // ---------- station bodies ----------
  function renderTest() {
    body.replaceChildren();
    body.className = 'bay-station-body bay-station-body--test';
    const r = state.testResult;
    const fee = staticFireFee(last?.breakdown);
    const intro = h('p', 'bay-test-intro', 'The stand holds the vehicle down with four clamps. We load the propellant, light the engines, run them at full throttle and measure what the factory really delivered, then release the clamps for two seconds. Every liquid engine is checked, and every tank while it is loaded; a solid motor burns only once, so it cannot be fired here.');
    const actions = h('div', 'bay-detail-actions');
    const fire = btn('hud-button hud-caution', `STATIC FIRE · ${fmtMoneyShort(fee)}`, () => hooks.onStartTest?.(), { tool: 'test' });
    fire.title = 'A test day on the stand: crew, propellant and the range. Paid now.';
    fire.disabled = !assembly.parts.some((p) => catalog.get(p.type)?.engine) || !(last?.spec.stats.fuelMass > 0) || getMoney() < fee;
    const poll = btn('hud-button hud-good', 'READINESS POLL →', () => hooks.onGonogo?.(), { tool: 'gonogo' });
    poll.disabled = !assembly.parts.length;
    actions.append(fire, poll);
    body.append(intro, actions);
    if (last) body.append(statsGrid(last));
    if (r) {
      const res = h('div', 'bay-test-result hud-panel');
      res.classList.add(r.found?.length ? 'hud-caution' : r.lifted ? 'hud-good' : 'hud-alert');
      const line = (k, v, st) => { const row = h('div', 'bay-fact'); row.append(h('span', 'bay-fact-k', k), h('span', `bay-fact-v ${st ?? ''}`, v)); res.append(row); };
      const vs = (now, rated) => (Number.isFinite(rated) && rated > 0 ? ` (${signedPct(now / rated - 1)} vs rating)` : '');
      res.append(h('div', 'hud-label', `Test report · static fire ${fmtMoney(r.fee ?? 0)}`));
      if (r.version !== assembly.version || r.units !== hooks.unitsKey?.()) res.append(h('div', 'bay-fact', 'The vehicle has changed since this test: fire again to measure the new build.'));
      line('Hold-down release', r.lifted ? 'VEHICLE LIFTED' : 'VEHICLE STAYED ON THE STAND', r.lifted ? 'hud-good' : 'hud-alert');
      line('Thrust at sea level, measured', `${fmtKN(r.thrustSL)}${vs(r.thrustSL, r.rated?.thrustSL)}`);
      line('Weight on the pad', fmtKN(r.weight));
      line('Thrust ÷ weight', `${r.twr.toFixed(2)} ${r.twr >= 1.2 ? '(brisk)' : r.twr > 1 ? '(barely)' : '(cannot lift)'}`);
      line('Net acceleration', `${r.netAccel.toFixed(2)} m/s²`);
      line('Propellant loaded', `${fmtMass(r.fuelMass)}${vs(r.fuelMass, r.rated?.fuelMass)}`);
      line('Propellant flow', `${r.mdot.toFixed(0)} kg/s · full tank in ${fmtInt(r.burnTime)} s`);
      line('Δv of this ship as built', `${fmtInt(r.deltaV)} m/s${vs(r.deltaV, r.rated?.deltaV)}`);
      line('Aerodynamically stable', r.stable ? 'yes' : 'no', r.stable ? 'hud-good' : 'hud-alert');
      const found = h('div', 'bay-test-found');
      if (r.found?.length) {
        for (const d of r.found) {
          const row = h('div', 'bay-test-defect');
          row.append(h('span', null, d.text));
          if (d.partId && !d.replaced) row.append(btn('hud-button', 'FIT A NEW UNIT', () => { d.replaced = true; hooks.onReplaceUnit?.(d.partId); }, { tool: 'replace', part: d.partId }));
          found.append(row);
        }
        found.append(h('div', 'bay-fact', 'Fitting a new unit swaps in a fresh one from the factory, free: it comes with its own luck, so fire again to see how it came out.'));
      } else found.append(h('div', 'bay-test-clean', 'Every engine came up to full thrust and ran clean. No leaks while loading.'));
      res.append(found);
      body.append(res);
    }
  }
  const signedPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} %`;

  // the range terminal (launch window, site and pad equipment) is the Launch pad card of the design page now

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
    hud.classList.toggle('bay-hud--design', DESIGN_STATIONS.includes(id));
    if (DESIGN_STATIONS.includes(id)) {
      panel.hidden = true;
      design.show(STATION_START[id] ?? {});
    } else {
      design.hide();
      title.textContent = st.name;
      role.textContent = st.role;
      panel.hidden = false;
      panel.dataset.station = id;
      if (id === 'teststand') renderTest();
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
    hud.classList.remove('bay-hud--station', 'bay-hud--design');
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
        item('Preset vehicles', 'Reliable, Workhorse, Cold Morning, Thin Skin', () => hooks.onPresets?.());
        item('Blueprints', 'save and load your designs', () => hooks.onBlueprints?.());
        item('Share code', 'copy a code for a friend, or paste one', () => hooks.onShare?.());
        item('Redo', 'put back what you undid', () => { if (assembly.redo()) { sound('ui.click'); changed(); } });
        if (hooks.hasAnalysis?.()) item('Last flight analysis', 'what each part did on the last flight, and how it wore', () => hooks.onAnalysis?.());
        if (hooks.hasRecords?.()) item('Last investigation', 'what the board found after the last failed flight', () => hooks.onRecords?.());
        b.append(list);
      },
      actions: [{ label: 'CLOSE' }],
    });
  }

  // ---------- refresh ----------
  function renderMoney() {
    const m = getMoney();
    chipFunds.textContent = fmtMoney(m);
    chipFunds.dataset.state = last && m < last.spec.stats.cost + (last.breakdown.launchFee ?? last.breakdown.slot?.fee ?? 0) ? 'bad' : m < insolvencyFloor * 1.5 ? 'low' : 'ok';
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
    chipStats.textContent = `${fmtMoney(Number.isFinite(result.price) ? result.price : s.cost)} · Δv ${fmtInt(s.deltaV)} · TWR ${s.twrEarth.toFixed(2)} · ${result.blocks.length ? `${result.blocks.length} block(s)` : 'ready for the poll'}`;
    renderMoney();
    renderInsolvency();
    design.refresh(result);
    if (state.station === 'teststand') renderTest();
  }

  function update(dt, { prompt: p = null } = {}) {
    if (design.open) design.update(dt);
    if (!state.station) {
      prompt.textContent = p ? `E · ${p}` : '';
      prompt.classList.toggle('bay-prompt--show', !!p);
    }
  }

  function setTestStatus(txt) {
    testStatus.hidden = !txt;
    testStatus.textContent = txt;
  }
  /** The static fire report (null clears it, e.g. after a new unit is fitted). */
  function showTestResult(result) {
    state.testResult = result ?? null;
    setTestStatus('');
    if (state.station === 'teststand') renderTest();
    if (!result) return;
    if (result.found?.length) say(`Static fire: ${result.found.length} problem(s) found. See the test report.`, 'bad');
    else say(result.lifted ? 'Static fire: every engine ran clean and the vehicle lifted.' : 'Static fire: the engines ran clean, but the vehicle stayed on the stand.', result.lifted ? 'ok' : 'bad');
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
    get designOpen() { return design.open; },
    designBack: () => design.back(),
    closePicker: () => design.closePicker(),
    rotateDesign: (deg) => design.rotateBy(deg),
  };
}
