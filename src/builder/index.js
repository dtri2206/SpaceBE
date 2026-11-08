// Role 1: Rocket Builder. Owns MENU, HANGAR and GONOGO (contract.js STATE_OWNERS). See README-ARCH.md.
// HANGAR is the engineering bay: a round integration hall the engineer walks through in first person, with one
// machine per job (integration stand, propulsion, structures, crew systems, warehouse, test stand, range, handbook).
import './builder.css';
import { graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { G0, PLANETS, contract, economy, events, input, requestState, save, setShip, ui } from '/src/core/index.js';
import partsJson from './data/parts.json';
import engines from './data/engines.json';
import launch from './data/launch.json';
import materials from './data/materials.json';
import text from './data/text.json';
import reliable from './data/presets/reliable.json';
import coldMorning from './data/presets/coldMorning.json';
import thinSkin from './data/presets/thinSkin.json';
import { Assembly, createCatalog } from './assembly.js';
import { computeShipSpec, engineStats } from './stats.js';
import { evaluate } from './gonogo.js';
import { fmtInt, fmtMoney } from './format.js';
import { createHangarScene } from './hangarScene.js';
import { createHangarScreen, DESIGN_STATIONS } from './hangarScreen.js';
import { createFormulaLens } from './formulaLens.js';
import { createGonogoView } from './gonogoView.js';
import { createWorkbench } from './workbench.js';
import { createIconRenderer } from './partIcons.js';
import { NASA_PARTS, hasNasaArt, nasaFailures, preloadNasaParts } from './bay/nasa.js';
import { menu } from './menu.js';
import { openPauseMenu, openSettings } from './settings.js';

export { openPauseMenu, openSettings }; // other roles may open the Esc menu and settings from their states

const catalog = createCatalog(partsJson);
const PRESETS = { reliable, coldMorning, thinSkin };
const deps = { catalog, engines, launch, balance: economy.balance, planets: PLANETS, g0: G0, materials };

let assembly = null; // the vehicle being built, kept across states
let bay = null; // the engineering bay scene, built once
let icons = null; // part pictures, rendered once
let screen = null; // { update, dispose } of the active state
let closePause = null;

// ---------- the current vehicle ----------
const builderSave = () => save.load().builder ?? {};

function ensureAssembly() {
  if (assembly) return assembly;
  assembly = new Assembly(builderSave().draft ?? reliable, catalog);
  if (!assembly.parts.length) assembly = new Assembly(reliable, catalog);
  return assembly;
}

function persistDraft() {
  save.update({ builder: { ...builderSave(), draft: assembly.toJSON() } });
}

function compute() {
  const result = computeShipSpec(ensureAssembly(), deps);
  const slot = result.breakdown.slot;
  const poll = evaluate(result.spec, { blocks: result.blocks, money: economy.getMoney(), fee: slot?.fee ?? 0, text, oneWay: result.breakdown.oneWay, roundTrip: result.breakdown.roundTrip });
  return { ...result, poll, fee: slot?.fee ?? 0 };
}

function loadAssembly(json) {
  assembly = new Assembly(json, catalog);
  if (!assembly.parts.length) assembly = new Assembly(reliable, catalog);
  persistDraft();
}

let modelsPromise = null;
function ensureBay() {
  if (!bay) bay = createHangarScene({ renderer: graphics.renderer });
  if (!icons) icons = createIconRenderer({ renderer: graphics.renderer });
  if (!modelsPromise) {
    // real NASA hardware arrives a moment after the bay opens; rebuild the vehicle and its pictures when it does
    modelsPromise = preloadNasaParts(catalog).then((n) => { icons.reset(); bay.decorate(catalog); if (n && screen?.refresh) screen.refresh(); });
  }
  return bay;
}

function highlight(ids) {
  for (const partId of ids) events.emit('builder:highlightPart', { partId });
}

/** Pushes the current vehicle to the stand, the wall screen, the station screens and the tablet. */
function syncBay(result) {
  const b = ensureBay();
  const a = ensureAssembly();
  b.setLayout(a.layout(), a.freeNodes());
  const stackHeight = a.stackHeight;
  b.wall.setTelemetry({ spec: result.spec, breakdown: result.breakdown, poll: result.poll, money: economy.getMoney() });
  b.wall.refresh(stackHeight);
  const s = result.spec.stats;
  const station = (id) => b.stations.find((st) => st.id === id);
  station('integration')?.setScreen({ lines: [`Vehicle: ${a.name}`, `${a.parts.length} parts · ${fmtInt(stackHeight * 10) / 10} m tall`, `Δv ${fmtInt(s.deltaV)} m/s · TWR ${s.twrEarth.toFixed(2)}`, `Cost ${fmtMoney(s.cost)}`], status: { text: result.blocks.length ? 'BLOCKED' : result.spec.warnings.length ? 'NO-GO ×' + result.spec.warnings.length : 'GO', color: result.blocks.length ? '#f87171' : result.spec.warnings.length ? '#fbbf24' : '#4ade80' } });
  const eng = result.breakdown.engineSpecs[0];
  station('propulsion')?.setScreen({ lines: eng ? [`Engine: ${eng.fuel} · ${eng.nozzle} nozzle · pump ${eng.pump}`, `Thrust ${fmtInt(eng.thrust / 1000)} kN · Isp ${eng.ispSL}/${eng.ispVac} s`, `Propellant ${fmtInt(s.fuelMass)} kg`] : ['No engine installed.'] });
  station('structures')?.setScreen({ lines: [`Heat shield: ${s.hasHeatShield ? (s.heatShieldDamaged ? 'ceramic tiles (fragile)' : 'ablative') : 'NONE'}`, `Legs: ${s.hasLegs ? 'yes' : 'NO'} · Parachute: ${s.hasParachute ? 'yes' : 'no'}`, `Stability: ${result.breakdown.copY < result.breakdown.comY ? 'stable' : 'UNSTABLE'}`] });
  station('crew')?.setScreen({ lines: [`Spare O₂ ${s.spareO2Tanks} · Shelter ${s.hasShelter ? 'yes' : 'NO'}`, `Antenna ${s.hasAntenna ? 'yes' : 'NO'} · Power ${fmtInt(s.power)} W`, `Reliability ${fmtInt(s.reliability * 100)} %`] });
  station('teststand')?.setScreen({ lines: [`TWR ${s.twrEarth.toFixed(2)} · Δv ${fmtInt(s.deltaV)} / ${fmtInt(result.breakdown.oneWay)} m/s`, result.poll.blocks.length ? `${result.poll.blocks.length} hard block(s)` : `${result.spec.warnings.length} warning(s)`] });
  station('launchwindow')?.setScreen({ lines: [`Window: ${result.breakdown.slot?.name}`, `${fmtInt(result.breakdown.slot?.tempC)} °C · fees ${fmtMoney(result.breakdown.slot?.fee ?? 0)}`, s.coldRatedSeals ? 'Seals: cold-rated' : 'Seals: CHEAP, not rated below 5 °C'] });
  station('warehouse')?.setScreen({ lines: [`${catalog.parts.length} part types in stock`, `Funds ${fmtMoney(economy.getMoney())}`] });
  b.player.setTablet({ title: a.name, lines: [`Cost ${fmtMoney(s.cost)} · Funds ${fmtMoney(economy.getMoney())}`, `Δv ${fmtInt(s.deltaV)} m/s (Mars ${fmtInt(result.breakdown.oneWay)})`, `TWR ${s.twrEarth.toFixed(2)} · Reliability ${fmtInt(s.reliability * 100)} %`, result.blocks.length ? `Blocked: ${result.blocks.join(', ')}` : result.spec.warnings.length ? `Warnings: ${result.spec.warnings.length}` : 'Ready for the poll'] });
}

// ---------- HANGAR ----------
function enterHangar() {
  const a = ensureAssembly();
  const b = ensureBay();
  graphics.setView(b.scene, b.camera);
  audio.play('ambience.ship', { loop: true, volume: 0.3 });

  const hangar = createHangarScreen({
    assembly: a, catalog, materials, engines, launch, text, scene: b, icons, stations: b.stations, getMoney: () => economy.getMoney(), insolvencyFloor: economy.balance.insolvencyFloor ?? 0,
    hooks: {
      onChange: refresh,
      onSound: (id) => audio.play(id),
      onGonogo: () => { audio.play('ui.click'); requestState('GONOGO'); },
      onWorkbench: openWorkbench,
      onPresets: openPresets,
      onBlueprints: openBlueprints,
      onShare: openShare,
      onBankrupt: declareBankruptcy,
      onGuidebook: (entryId) => events.emit('guidebook:open', { entryId }),
      onStartTest: startTest,
      onStationOpen: (id) => {
        input.unlockPointer();
        audio.play('ui.click');
        if (id === 'teststand' || DESIGN_STATIONS.includes(id)) b.player.lookAt(0, 0, 0.1);
      },
      onStationClose: () => audio.play('ui.click'),
    },
  });
  ui.mount(hangar.el);
  const lens = createFormulaLens({
    parent: hangar.lensHost, g0: G0, planets: PLANETS, balance: economy.balance, text: text.formulas,
    onHighlight: highlight, onGuidebook: (entryId) => events.emit('guidebook:open', { entryId }),
  });

  function refresh() {
    persistDraft();
    const result = compute();
    hangar.refresh(result);
    lens.update(result.spec, result.breakdown);
    syncBay(result);
  }

  function openWorkbench(partId) {
    const part = a.part(partId);
    if (!part) return;
    let wb = null;
    const body = hangar.openDialog({ title: 'Engine workbench', body: null, actions: [] });
    wb = createWorkbench({
      parent: body, engines, current: part.engine, compute: (def) => engineStats(def, engines, G0),
      onApply: (def) => { a.setEngine(partId, def); audio.play('ui.snap'); wb.dispose(); hangar.closeDialog(); hangar.say('Engine rebuilt.'); refresh(); },
      onClose: () => { wb.dispose(); hangar.closeDialog(); },
    });
  }

  function listDialog(title, items, { empty = 'Nothing here yet.', footer = null } = {}) {
    hangar.openDialog({
      title,
      body: (body) => {
        const list = document.createElement('div');
        list.className = 'bld-list';
        if (!items.length) list.append(Object.assign(document.createElement('div'), { className: 'bld-list-meta', textContent: empty }));
        for (const item of items) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'bld-list-item';
          row.innerHTML = `<span>${item.label}</span><span class="bld-list-meta">${item.meta ?? ''}</span>`;
          row.addEventListener('click', () => item.onClick());
          if (item.extra) row.append(item.extra);
          list.append(row);
        }
        body.append(list);
        if (footer) footer(body);
      },
      actions: [{ label: 'CLOSE' }],
    });
  }

  function openPresets() {
    listDialog('Preset vehicles', Object.values(PRESETS).map((json) => {
      const { spec } = computeShipSpec(new Assembly(json, catalog), deps);
      return { label: json.name, meta: `${fmtMoney(spec.stats.cost)} · ${spec.warnings.length ? spec.warnings.length + ' warning(s)' : 'no warnings'}`, onClick: () => { loadAssembly(json); hangar.closeDialog(); audio.play('ui.snap'); rebind(); } };
    }));
  }

  function openBlueprints() {
    const blueprints = builderSave().blueprints ?? [];
    listDialog('Blueprints', blueprints.map((json, index) => {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bld-tool';
      del.textContent = 'DELETE';
      del.addEventListener('click', (e) => { e.stopPropagation(); save.update({ builder: { ...builderSave(), blueprints: blueprints.filter((_, i) => i !== index) } }); hangar.closeDialog(); openBlueprints(); });
      return { label: json.name, meta: `${json.parts?.length ?? 0} parts`, extra: del, onClick: () => { loadAssembly(json); hangar.closeDialog(); audio.play('ui.snap'); rebind(); } };
    }), {
      empty: 'No saved blueprints yet.',
      footer: (body) => {
        const name = document.createElement('input');
        name.className = 'bld-input';
        name.placeholder = 'Save the current vehicle as…';
        name.value = a.name;
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'hud-button';
        saveBtn.textContent = 'SAVE BLUEPRINT';
        saveBtn.addEventListener('click', () => {
          a.rename(name.value || a.name);
          save.update({ builder: { ...builderSave(), blueprints: [...(builderSave().blueprints ?? []).filter((b) => b.name !== a.name), a.toJSON()] } });
          audio.play('ui.snap');
          hangar.closeDialog();
          hangar.say(`Blueprint "${a.name}" saved.`);
          refresh();
        });
        body.append(name, saveBtn);
      },
    });
  }

  function openShare() {
    hangar.openDialog({
      title: 'Share code',
      body: (body) => {
        const out = document.createElement('textarea');
        out.className = 'bld-code';
        out.readOnly = true;
        out.value = a.toShareCode();
        out.addEventListener('click', () => out.select());
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'hud-button';
        copy.textContent = 'COPY';
        copy.addEventListener('click', () => { out.select(); navigator.clipboard?.writeText(out.value).catch(() => {}); copy.textContent = 'COPIED'; });
        const inp = document.createElement('textarea');
        inp.className = 'bld-code';
        inp.placeholder = 'Paste a share code here to load it';
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'hud-button';
        load.textContent = 'LOAD CODE';
        load.addEventListener('click', () => {
          const loaded = Assembly.fromShareCode(inp.value, catalog);
          if (!loaded || !loaded.parts.length) { audio.play('ui.error'); load.textContent = 'NOT A VALID CODE'; return; }
          loadAssembly(loaded.toJSON());
          hangar.closeDialog();
          audio.play('ui.snap');
          rebind();
        });
        body.append(out, copy, inp, load);
      },
      actions: [{ label: 'CLOSE' }],
    });
  }

  function declareBankruptcy() {
    events.emit('ending:show', { endingId: contract.ENDINGS.bankrupt, cause: 'The agency can no longer afford a vehicle.', cost: 0, historyLessonId: null });
    requestState('ENDING');
  }

  function startTest() {
    const result = compute();
    hangar.closeStation();
    // step up to the railing on the test conductor's side, where the engine and the clamps are in view
    const st = b.stations.find((s) => s.id === 'teststand');
    if (st) { const p = b.hall.pitRadius + 1.4; b.player.teleport(Math.cos(st.deg * Math.PI / 180) * p, Math.sin(st.deg * Math.PI / 180) * p); }
    b.player.lookAt(0, 0, -0.12);
    const phaseText = { countdown: 'T-3… hold-down clamps locked', ignition: 'IGNITION', hold: 'Full thrust · clamps holding', release: 'CLAMPS RELEASED', cutoff: 'CUTOFF', settle: 'Securing the vehicle' };
    b.test.start({
      spec: result.spec, breakdown: result.breakdown, layout: a.layout(),
      onPhase: (phase) => hangar.setTestStatus(`STATIC FIRE · ${phaseText[phase] ?? phase}`),
      onDone: (report) => { hangar.showTestResult(report); hangar.openStation('teststand'); input.unlockPointer(); },
    });
    hangar.setTestStatus('STATIC FIRE · T-3… hold-down clamps locked');
  }

  function rebind() {
    screen.dispose();
    enterHangar();
  }

  const sensitivity = () => save.load().sensitivity ?? 1;
  const invertY = () => !!save.load().invertY;
  // ?debug=1: let the console (and screenshot scripts) walk to a machine and open it: window.__game.builder.placeAt('propulsion')
  if (new URLSearchParams(location.search).get('debug') === '1' && window.__game) {
    window.__game.builder = { openStation: hangar.openStation, closeStation: hangar.closeStation, placeAt: (id) => b.placeAtStation(id), startTest, bay: b, refresh, nasa: { hasNasaArt, nasaFailures, NASA_PARTS } };
  }
  const lockOnClick = () => { if (!hangar.station && !b.test.active) input.lockPointer(); };
  window.addEventListener('click', lockOnClick);

  const offs = [
    input.onPress('KeyE', () => {
      if (hangar.station || b.test.active) return;
      const s = b.nearestStation();
      if (s) hangar.openStation(s.id);
    }),
    input.onPress('KeyH', () => { if (hangar.station === 'handbook') hangar.closeStation(); else if (!b.test.active) { hangar.openStation('handbook'); } }),
    input.onPress('KeyZ', () => { if (DESIGN_STATIONS.includes(hangar.station) && a.undo()) { audio.play('ui.click'); refresh(); } }),
    input.onPress('KeyY', () => { if (DESIGN_STATIONS.includes(hangar.station) && a.redo()) { audio.play('ui.click'); refresh(); } }),
    events.on('economy:changed', () => hangar.renderMoney()),
  ];
  const esc = () => {
    if (hangar.dialogOpen) { hangar.closeDialog(); return; }
    if (hangar.station && hangar.pickerOpen) { hangar.closePicker(); return; }
    if (hangar.station) { hangar.closeStation(); return; }
    closePause = openPauseMenu({ onResume: () => { closePause = null; input.onEscape(esc); } });
  };
  input.onEscape(esc);

  screen = {
    refresh,
    update: (dt) => {
      const frozen = !!hangar.station || b.test.active || !!closePause;
      const k = input.isDown;
      const delta = input.mouseDelta();
      b.update(dt, {
        forward: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
        right: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
        run: k('ShiftLeft') || k('ShiftRight'),
        jump: k('Space'),
        lookDelta: frozen || !input.isLocked() ? { x: 0, y: 0 } : delta,
        sensitivity: sensitivity(), invertY: invertY(), frozen,
      });
      hangar.update(dt, { prompt: frozen ? null : b.nearestStation()?.prompt ?? null });
    },
    dispose: () => {
      offs.forEach((off) => off());
      window.removeEventListener('click', lockOnClick);
      b.test.cancel();
      lens.dispose();
      hangar.dispose();
      audio.stop('ambience.ship');
      graphics.setEffects({ shake: 0 });
    },
  };
  refresh();
}

// ---------- GONOGO ----------
function enterGonogo() {
  const a = ensureAssembly();
  const b = ensureBay();
  const result = compute();
  const { spec, poll, fee } = result;
  b.setLayout(a.layout(), []);
  b.select(null);
  b.placeAtStation('teststand');
  b.update(0, { frozen: true });
  graphics.setView(b.scene, b.camera);
  audio.play('ambience.ship', { loop: true, volume: 0.3 });

  const root = document.createElement('div');
  root.className = 'gng-root hud';
  root.dataset.screen = 'gonogo';
  root.dataset.stub = 'gonogo';
  const header = document.createElement('div');
  header.className = 'gng-header';
  header.textContent = `Launch readiness poll · ${spec.name}`;
  const consoleEl = document.createElement('div');
  consoleEl.className = 'gng-console hud-panel';
  const summary = document.createElement('div');
  summary.className = 'gng-summary';
  summary.textContent = 'Flight controllers, report. (Space skips.)';
  const actions = document.createElement('div');
  actions.className = 'gng-actions';
  root.append(header, consoleEl, summary, actions);
  ui.mount(root);

  let done = false;
  const view = createGonogoView({
    parent: consoleEl,
    lines: poll.lines,
    onReveal: (line) => audio.play(line.status === 'GO' ? 'gonogo.tick' : 'ui.error'),
    onDone: () => {
      done = true;
      summary.textContent = poll.canConfirm
        ? `${poll.needsOverride ? `${poll.warnings.length} NO-GO call(s). Overriding warnings is how real accidents started.` : 'All consoles GO.'} Vehicle ${fmtMoney(spec.stats.cost)}${fee ? ` + pad fees ${fmtMoney(fee)}` : ''} = ${fmtMoney(poll.total)}. Funds ${fmtMoney(economy.getMoney())}.`
        : `${poll.blocks.length} hard block(s). The launch director refuses. Fix them in the bay.`;
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'hud-button';
      back.dataset.action = 'back';
      back.textContent = 'BACK TO THE BAY [B]';
      back.addEventListener('click', () => requestState('HANGAR'));
      actions.append(back);
      if (poll.canConfirm) {
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = `hud-button ${poll.needsOverride ? 'hud-caution' : 'hud-good'}`;
        confirm.dataset.action = poll.needsOverride ? 'override' : 'confirm';
        confirm.textContent = `${poll.needsOverride ? 'OVERRIDE & LAUNCH' : 'CONFIRM & LAUNCH'} · ${fmtMoney(poll.total)} [Enter]`;
        confirm.addEventListener('click', confirmLaunch);
        actions.append(confirm);
      }
    },
  });

  function confirmLaunch() {
    if (!done || !poll.canConfirm) return;
    if (!economy.canAfford(poll.total)) { audio.play('ui.error'); return; }
    economy.spend(poll.total, 'ship');
    setShip(spec);
    events.emit('ship:built', { shipSpec: spec });
    audio.play('ui.snap');
    requestState('PRELAUNCH');
  }

  input.onPress('Space', () => view.skip());
  input.onPress('Enter', () => (done ? confirmLaunch() : view.skip()));
  input.onPress('KeyB', () => requestState('HANGAR'));
  const esc = () => { closePause = openPauseMenu({ onResume: () => { closePause = null; input.onEscape(esc); } }); };
  input.onEscape(esc);

  screen = {
    update: (dt) => { view.update(dt); b.update(dt, { frozen: true }); },
    dispose: () => { view.dispose(); root.remove(); audio.stop('ambience.ship'); },
  };
}

// ---------- module ----------
export default {
  init() {
    events.on('builder:highlightPart', ({ partId }) => bay?.highlight([partId]));
    events.on('ending:show', ({ endingId }) => save.update({ lastEnding: endingId }));
    const volume = save.load().volume;
    if (typeof volume === 'number') audio.setVolume(volume);
  },

  enter(state) {
    if (state === contract.STATES.MENU) return menu.enter();
    if (state === contract.STATES.HANGAR) return enterHangar();
    if (state === contract.STATES.GONOGO) return enterGonogo();
  },

  update(dt, state) {
    if (state === contract.STATES.MENU) return menu.update?.(dt);
    screen?.update(dt);
  },

  exit(state) {
    if (state === contract.STATES.MENU) return menu.exit?.();
    closePause?.();
    closePause = null;
    screen?.dispose();
    screen = null;
  },
};
