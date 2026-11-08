// Role 1: Rocket Builder. Owns MENU, HANGAR and GONOGO (contract.js STATE_OWNERS). See README-ARCH.md.
// HANGAR is the engineering bay: a round integration hall the engineer walks through in first person, with one
// machine per job (integration stand, propulsion, structures, crew systems, warehouse, test stand, range, handbook).
import './builder.css';
import { assets, graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { G0, PLANETS, contract, economy, events, getShip, input, requestState, save, setShip, ui } from '/src/core/index.js';
import engines from './data/engines.json';
import launch from './data/launch.json';
import materials from './data/materials.json';
import text from './data/text.json';
import reliable from './data/presets/reliable.json';
import coldMorning from './data/presets/coldMorning.json';
import thinSkin from './data/presets/thinSkin.json';
import workhorse from './data/presets/workhorse.json';
import apollo from './data/presets/apollo.json'; // the hackathon demo ship: Role 3's interior is built for the Apollo cabin
import { Assembly, createCatalog } from './assembly.js';
import { internalsJson, partsJson, sections, traitsData } from './catalogData.js';
import { computeShipSpec, engineStats } from './stats.js';
import { evaluate, holdPlan, owed } from './gonogo.js';
import { buildAsFlown, describeDefect, designSignature, meanWear, partGroups, refurbFee, staticFireFee, wearAfterFlight } from './asBuilt.js';
import { createFlightAnalysis, createInvestigation } from './investigation.js';
import { closeFlight, createFlightLog, matchEffects } from './flightAnalysis.js';
import { fmtInt, fmtMoney, fmtMoneyShort } from './format.js';
import { createHangarScene } from './hangarScene.js';
import { createDesignScene } from './designScene.js';
import { createHangarScreen, DESIGN_STATIONS } from './hangarScreen.js';
import { createFormulaLens } from './formulaLens.js';
import { createGonogoView } from './gonogoView.js';
import { createWorkbench } from './workbench.js';
import { createIconRenderer } from './partIcons.js';
import { NASA_PARTS, hasNasaArt, nasaFailures, preloadNasaParts, registerNasaModels } from './bay/nasa.js';
import { menu } from './menu.js';
import { openPauseMenu, openSettings } from './settings.js';
import { initLang } from './i18n.js';
import { registerFlightArt } from './flightArt.js';

export { openPauseMenu, openSettings }; // other roles may open the Esc menu and settings from their states

const catalog = createCatalog(partsJson, internalsJson);
registerNasaModels(catalog);
const PRESETS = { reliable, workhorse, coldMorning, thinSkin, apollo };
const deps = { catalog, engines, launch, balance: economy.balance, planets: PLANETS, g0: G0, materials, pad: sections.pad, traitsData };

let assembly = null; // the vehicle being built, kept across states
let bay = null; // the engineering bay scene, built once
let scene3d = null; // the design studio (3D view of the design page), built once
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

// ---------- luck: the ship as built, flight records, reuse (asBuilt.js, src/builder/CLAUDE.md §6) ----------
// builder.luck in the save: { serial (build serial, +1 after each flight), units ({ partId: replacements }), seenIds and
// gone (parts taken off and put back are new units), pending ([{ kind, amount, label }] owed at the next confirm; nothing
// adds to it now, old saves may hold some), scrubs (launch attempts stopped on the pad since the last flight), flights
// ([records], the last 12), current (the record of the flight in the air), fleet (the ship that came home) }
const luck = () => {
  const l = builderSave().luck ?? {};
  return { serial: Number(l.serial) || 1, units: { ...(l.units ?? {}) }, seenIds: l.seenIds ?? null, gone: { ...(l.gone ?? {}) }, pending: [...(l.pending ?? [])], scrubs: [...(l.scrubs ?? [])], flights: [...(l.flights ?? [])], current: l.current ?? null, fleet: l.fleet ?? null };
};
const saveLuck = (patch) => save.update({ builder: { ...builderSave(), luck: { ...luck(), ...patch } } });
const unitsKey = () => JSON.stringify(Object.entries(luck().units).sort());
const isFailure = (endingId) => !!endingId && endingId !== contract.ENDINGS.homecoming && endingId !== contract.ENDINGS.bankrupt;
const lastFailed = () => [...luck().flights].reverse().find((f) => f.outcome?.final && isFailure(f.outcome.endingId)) ?? null;
const lastFlown = () => [...luck().flights].reverse().find((f) => f.outcome?.final && f.design) ?? null; // records from before the analysis have no design

/** A part taken off the stand and put back later is a new unit from the warehouse, so it rolls again. */
function trackUnits() {
  const l = luck();
  const now = ensureAssembly().parts.map((p) => p.id);
  if (!l.seenIds) { saveLuck({ seenIds: now }); return; }
  const here = new Set(now);
  const gone = { ...l.gone }, units = { ...l.units };
  for (const id of l.seenIds) if (!here.has(id)) gone[id] = true;
  for (const id of now) if (gone[id]) { units[id] = (units[id] ?? 0) + 1; delete gone[id]; }
  if (now.join() !== l.seenIds.join() || JSON.stringify(gone) !== JSON.stringify(l.gone)) saveLuck({ seenIds: now, gone, units });
}

/** The ship that came home, when this design is that ship: { flights, wear, serial, mean }. Parts replaced since are new. */
function reuseOf(a, l = luck()) {
  const f = l.fleet;
  if (!f || f.sig !== designSignature(a.toJSON())) return null;
  const parts = Object.fromEntries(Object.entries(f.wear?.parts ?? {}).filter(([id]) => (l.units[id] ?? 0) === (f.units?.[id] ?? 0)));
  const wear = { parts, hull: { ...(f.wear?.hull ?? {}) } };
  return { flights: f.flights ?? 1, wear, consumed: { ...(f.wear?.consumed ?? {}) }, serial: f.serial ?? l.serial, mean: meanWear(wear) };
}
/** Everything asBuilt.js needs to roll this build: the same build always gives the same ship. */
function luckCtx(a, stage = 'flight') {
  const l = luck();
  const reuse = reuseOf(a, l);
  return { g0: G0, planets: PLANETS, layout: a.layout(), catalog, engines, materials, hull: a.hull, serial: l.serial, buildSerial: reuse?.serial ?? l.serial, units: l.units, wear: reuse?.wear ?? null, stage };
}

function compute() {
  const a = ensureAssembly();
  const result = computeShipSpec(a, deps);
  const fee = result.breakdown.launchFee ?? result.breakdown.slot?.fee ?? 0;
  const l = luck();
  const reuse = reuseOf(a, l);
  const price = reuse ? refurbFee(result.spec.stats.cost, reuse.flights, { wear: { ...reuse.wear, consumed: reuse.consumed }, breakdown: result.breakdown }) : result.spec.stats.cost;
  const pending = owed(l.pending);
  const poll = evaluate(result.spec, { blocks: result.blocks, money: economy.getMoney(), fee, extra: pending, price, text, oneWay: result.breakdown.oneWay, roundTrip: result.breakdown.roundTrip, breakdown: result.breakdown });
  return { ...result, poll, fee, pending, price, reuse };
}

/** The flight record kept in the save: on paper against as built, what went wrong, the weather, the warnings overridden. */
function recordFlight(result, flown, a) {
  const l = luck();
  const layout = a.layout();
  const reuse = result.reuse;
  const n = (l.flights.at(-1)?.n ?? 0) + 1;
  const sig = designSignature(a.toJSON());
  const record = {
    n, at: Date.now(), name: a.name, sig, serial: l.serial, seed: flown.seed, design: a.toJSON(),
    designed: flown.designed, asBuilt: flown.asBuilt, need: flown.need, defects: flown.defects, notes: flown.notes, units: flown.units,
    weather: flown.weather, pad: flown.pad, scrubs: l.scrubs, overridden: result.poll.needsOverride ? [...result.poll.warnings, ...(result.poll.calls ?? [])] : [],
    paid: { vehicle: result.price, fees: result.fee, owed: result.pending, total: result.poll.total },
    reflight: reuse ? { flights: reuse.flights, wear: reuse.mean } : null,
    groups: partGroups(layout), partNames: Object.fromEntries(layout.map((e) => [e.id, e.def.name])),
    // what the fleet holds if the ship comes home: the same physical ship, one flight older
    // (a nominal flight's wear for now: closeFlight replaces it with what the flight really did, at the ending)
    home: { sig, name: a.name, serial: reuse?.serial ?? l.serial, flights: (reuse?.flights ?? 0) + 1, before: reuse?.wear ?? null, wear: wearAfterFlight(reuse?.wear ?? null, { layout, hull: a.hull, breakdown: result.breakdown, materials }), units: { ...l.units } },
    outcome: null, seen: false,
  };
  saveLuck({ serial: l.serial + 1, flights: [...l.flights, record].slice(-12), current: n, pending: [], scrubs: [] });
  flightLog.reset();
}
/** What the flight did, from the telemetry every flight scene sends (Δv left, Max-Q, engine heat, hits, touchdown). */
const flightLog = createFlightLog();

/** How a flight ended (ending:show, with Role 2's causeId from flight:failed when there was one). */
let lastFailure = null;
function noteFailure(p) {
  lastFailure = p;
  const l = luck();
  const rec = l.flights.at(-1);
  // ending:show may have come first: add the cause to the record it closed
  if (rec?.outcome?.final && !rec.outcome.causeId && rec.outcome.endingId === p.endingId && p.causeId) { rec.outcome.causeId = p.causeId; saveLuck({ flights: l.flights }); }
}
function noteEnding(p) {
  const l = luck();
  if (l.current == null) return; // no flight of ours in the air (the boot check, a bankruptcy in the bay)
  const rec = l.flights.find((f) => f.n === l.current);
  if (!rec) return;
  const f = lastFailure && lastFailure.endingId === p.endingId ? lastFailure : null;
  rec.outcome = { endingId: p.endingId, cause: p.cause ?? '', cost: p.cost ?? 0, causeId: f?.causeId ?? null, t: Number.isFinite(f?.t) ? f.t : null, final: true };
  lastFailure = null;
  // what the flight did and the wear it caused; the outcome and the fleet are saved whatever happens here
  try { Object.assign(rec, closeFlight(rec, { effects: matchEffects(rec, save.load().partEffects?.flights ?? []), flown: flightLog.summary(), catalog, deps })); } catch (e) { console.warn('[builder] flight analysis:', e.message); }
  saveLuck({ flights: l.flights, current: null, fleet: p.endingId === contract.ENDINGS.homecoming ? rec.home : null });
}
function markSeen(n) {
  const l = luck();
  const rec = l.flights.find((f) => f.n === n);
  if (!rec || rec.seen) return;
  rec.seen = true;
  saveLuck({ flights: l.flights });
}

function loadAssembly(json) {
  assembly = new Assembly(json, catalog);
  if (!assembly.parts.length) assembly = new Assembly(reliable, catalog);
  persistDraft();
}

let modelsPromise = null;
const artRequested = new Set(); // part types whose real model has been asked for
function ensureBay() {
  if (!bay) bay = createHangarScene({ renderer: graphics.renderer });
  if (!scene3d) scene3d = createDesignScene();
  if (!icons) icons = createIconRenderer({ renderer: graphics.renderer });
  if (!modelsPromise) {
    // only the models of the parts on the stand download now; the rest arrive when a part is placed or looked at
    const onStand = [...new Set(ensureAssembly().parts.map((p) => p.type))];
    modelsPromise = requestArt(onStand).then(() => bay.decorate(catalog));
  }
  return bay;
}

/** Downloads the real models for these part types (once each); rebuilds the vehicle and the pictures when they arrive. */
function requestArt(ids) {
  const fresh = ids.filter((id) => !artRequested.has(id));
  if (!fresh.length) return Promise.resolve(0);
  fresh.forEach((id) => artRequested.add(id));
  return preloadNasaParts(catalog, fresh).then((n) => {
    if (n) { icons?.reset(); scene3d?.invalidate(); screen?.refresh?.(); }
    return n;
  });
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
  station('integration')?.setScreen({ lines: [`Vehicle: ${a.name}`, `${a.parts.length} parts · ${fmtInt(stackHeight * 10) / 10} m tall`, `Δv ${fmtInt(s.deltaV)} m/s · TWR ${s.twrEarth.toFixed(2)}`, `Cost ${fmtMoney(s.cost)}`], status: { text: result.blocks.length ? 'BLOCKED' : 'READY', color: result.blocks.length ? '#f87171' : '#4ade80' } }); // hard blocks only: no hints while building
  const eng = result.breakdown.engineSpecs[0];
  station('propulsion')?.setScreen({ lines: eng ? [`Engine: ${eng.fuel} · ${eng.nozzle} nozzle · pump ${eng.pump}`, `Thrust ${fmtInt(eng.thrust / 1000)} kN · Isp ${eng.ispSL}/${eng.ispVac} s`, `Propellant ${fmtInt(s.fuelMass)} kg`] : ['No engine installed.'] });
  station('structures')?.setScreen({ lines: [`Heat shield: ${s.hasHeatShield ? (s.heatShieldDamaged ? 'ceramic tiles (fragile)' : 'ablative') : 'NONE'}`, `Legs: ${s.hasLegs ? 'yes' : 'NO'} · Parachute: ${s.hasParachute ? 'yes' : 'no'}`, `Stability: ${result.breakdown.copY < result.breakdown.comY ? 'stable' : 'UNSTABLE'}`] });
  station('crew')?.setScreen({ lines: [`Spare O₂ ${s.spareO2Tanks} · Shelter ${s.hasShelter ? 'yes' : 'NO'}`, `Antenna ${s.hasAntenna ? 'yes' : 'NO'} · Power ${fmtInt(s.power)} W`, `Reliability ${fmtInt(s.reliability * 100)} %`] });
  station('teststand')?.setScreen({ lines: [`TWR ${s.twrEarth.toFixed(2)} · Δv ${fmtInt(s.deltaV)} m/s`, `Static fire ${fmtMoneyShort(staticFireFee(result.breakdown))}`, result.poll.blocks.length ? `${result.poll.blocks.length} hard block(s)` : 'Stand ready'] });
  station('launchwindow')?.setScreen({ lines: [`Window: ${result.breakdown.slot?.name}`, `${fmtInt(result.breakdown.slot?.tempC)} °C · fees ${fmtMoney(result.breakdown.slot?.fee ?? 0)}`, s.coldRatedSeals ? 'Seals: cold-rated' : 'Seals: CHEAP, not rated below 5 °C'] });
  station('warehouse')?.setScreen({ lines: [`${catalog.parts.length} part types in stock`, `Funds ${fmtMoney(economy.getMoney())}`] });
  b.player.setTablet({ title: a.name, lines: [`Cost ${fmtMoney(s.cost)} · Funds ${fmtMoney(economy.getMoney())}`, `Δv ${fmtInt(s.deltaV)} m/s`, `TWR ${s.twrEarth.toFixed(2)} · Reliability ${fmtInt(s.reliability * 100)} %`, result.blocks.length ? `Blocked: ${result.blocks.join(', ')}` : result.reuse ? `Reflight ${result.reuse.flights + 1} · wear ${fmtInt(result.reuse.mean * 100)} %` : 'Ready for the poll'] });
}

// ---------- HANGAR ----------
function enterHangar() {
  const a = ensureAssembly();
  const b = ensureBay();
  graphics.setView(b.scene, b.camera);
  audio.play('ambience.ship', { loop: true, volume: 0.3 });

  const hangar = createHangarScreen({
    assembly: a, catalog, sections, materials, engines, launch, text, scene: b, scene3d, g0: G0, icons, stations: b.stations, getMoney: () => economy.getMoney(), insolvencyFloor: economy.balance.insolvencyFloor ?? 0,
    hooks: {
      onChange: refresh,
      onView: (s, c) => graphics.setView(s, c),
      onViewRestore: () => graphics.setView(b.scene, b.camera),
      onNeedArt: (ids) => requestArt(ids),
      onSound: (id) => audio.play(id),
      onGonogo: () => { audio.play('ui.click'); requestState('GONOGO'); },
      onWorkbench: openWorkbench,
      onPresets: openPresets,
      onBlueprints: openBlueprints,
      onShare: openShare,
      onBankrupt: declareBankruptcy,
      onGuidebook: (entryId) => events.emit('guidebook:open', { entryId }),
      onStartTest: startTest,
      onReplaceUnit: replaceUnit,
      unitsKey,
      hasRecords: () => !!lastFailed(),
      onRecords: () => { hangar.closeDialog(); const rec = lastFailed(); if (rec) openBoard(rec); },
      hasAnalysis: () => !!lastFlown(),
      onAnalysis: () => { hangar.closeDialog(); const rec = lastFlown(); if (rec) openAnalysis(rec); },
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
    trackUnits();
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

  /**
   * Static fire (spec §5.3): paid on the button press (a test day on the stand), never on entering a state. The stand
   * measures the ship as built (asBuilt.js stage 'stand'), so it finds the factory's bad engines and leaky tanks that
   * would fly with this build, and the player may fit a new unit.
   */
  function startTest() {
    const result = compute();
    if (b.test.active) return;
    if (!result.breakdown.engineSpecs?.length || !(result.spec.stats.fuelMass > 0)) { audio.play('ui.error'); hangar.say('The stand needs an engine and propellant to fire.', 'bad'); return; }
    const fee = staticFireFee(result.breakdown);
    if (!economy.canAfford(fee)) { audio.play('ui.error'); hangar.say(`A static fire costs ${fmtMoney(fee)}; the agency has ${fmtMoney(economy.getMoney())}.`, 'bad'); return; }
    economy.spend(fee, 'static fire');
    const flown = buildAsFlown(result, luckCtx(a, 'stand'));
    // a solid motor burns once: it cannot be fired on the stand, so a void in its grain stays hidden
    const found = flown.defects.filter((d) => d.source === 'factory' && d.kind !== 'grain').map((d) => ({ ...d, text: describeDefect(d, text.luck.defects, 'en') }));
    const noLight = found.some((d) => d.kind === 'noLight');
    const version = a.version, unitsAt = unitsKey();
    hangar.closeStation();
    // step up to the railing on the test conductor's side, where the engine and the clamps are in view
    const st = b.stations.find((s) => s.id === 'teststand');
    if (st) { const p = b.hall.pitRadius + 1.4; b.player.teleport(Math.cos(st.deg * Math.PI / 180) * p, Math.sin(st.deg * Math.PI / 180) * p); }
    b.player.lookAt(0, 0, -0.12);
    const phaseText = { countdown: 'T-3… hold-down clamps locked', ignition: noLight ? 'IGNITION… an engine will not come up' : 'IGNITION', hold: 'Full thrust · clamps holding · measuring', release: 'CLAMPS RELEASED', cutoff: 'CUTOFF', settle: 'Securing the vehicle' };
    b.test.start({
      spec: flown.spec, breakdown: result.breakdown, layout: a.layout(),
      thrustFactor: flown.designed.thrust > 0 ? flown.asBuilt.thrust / flown.designed.thrust : 1,
      onPhase: (phase) => hangar.setTestStatus(`STATIC FIRE · ${phaseText[phase] ?? phase}`),
      onDone: (report) => { hangar.showTestResult({ ...report, fee, found, rated: flown.designed, version, units: unitsAt }); hangar.openStation('teststand'); input.unlockPointer(); },
    });
    hangar.setTestStatus('STATIC FIRE · T-3… hold-down clamps locked');
  }

  /** Pull a unit the static fire found bad and fit a fresh one from the factory: it comes with its own luck. */
  function replaceUnit(partId) {
    const l = luck();
    saveLuck({ units: { ...l.units, [partId]: (l.units[partId] ?? 0) + 1 } });
    audio.play('ui.snap');
    hangar.say('A fresh unit from the factory is fitted. It has its own luck: fire again to see how it came out.');
    refresh();
  }

  // ---------- the accident investigation board (after a failed flight) and the flight analysis (after every flight) ----------
  let board = null, boardRec = null;
  function standBack(rec) {
    closeBoard();
    boardRec = rec;
    hangar.closeStation();
    input.unlockPointer();
    // stand back from the stand so the whole vehicle shows on the right of the board, where the parts to look at glow
    const deg = (22 * Math.PI) / 180, r = b.hall.pitRadius + 4.5;
    const x = Math.cos(deg) * r, z = Math.sin(deg) * r;
    b.player.teleport(x, z, Math.atan2(x, z) + 0.3);
    b.player.setPitch(0.3);
  }
  function openBoard(rec) {
    if (!rec) return;
    standBack(rec);
    board = createInvestigation({ record: rec, text, onHighlight: highlight, onSound: (id) => audio.play(id), onClose: () => { dismissBoard(); audio.play('ui.click'); }, onAnalysis: rec.design ? () => openAnalysis(rec, { back: () => openBoard(rec) }) : null });
    hangar.el.append(board.el);
  }
  function openAnalysis(rec, { back = null } = {}) {
    if (!rec) return;
    standBack(rec);
    const l = luck();
    const next = l.flights.find((x) => x.n === rec.n + 1) ?? null;
    board = createFlightAnalysis({ record: rec, effects: matchEffects(rec, save.load().partEffects?.flights ?? [], next), history: l.flights, catalog, deps, traitsData, text, onHighlight: highlight, onSound: (id) => audio.play(id), onClose: () => { dismissBoard(); audio.play('ui.click'); }, onBack: back });
    hangar.el.append(board.el);
  }
  function closeBoard() {
    board?.dispose();
    board = null;
  }
  function dismissBoard() {
    const n = boardRec?.n;
    closeBoard();
    boardRec = null;
    if (n != null) markSeen(n);
  }

  function rebind() {
    screen.dispose();
    enterHangar();
  }

  const sensitivity = () => save.load().sensitivity ?? 1;
  const invertY = () => !!save.load().invertY;
  // ?debug=1: let the console (and screenshot scripts) walk to a machine and open it: window.__game.builder.placeAt('propulsion')
  if (new URLSearchParams(location.search).get('debug') === '1' && window.__game) {
    window.__game.builder = { openStation: hangar.openStation, closeStation: hangar.closeStation, placeAt: (id) => b.placeAtStation(id), startTest, bay: b, scene3d, assembly: a, catalog, sections, icons, refresh, requestArt, reloadArt: (ids) => { ids.forEach((id) => artRequested.delete(id)); return requestArt(ids); }, nasa: { hasNasaArt, nasaFailures, NASA_PARTS }, luck, investigate: () => openBoard(lastFailed()), analysis: () => openAnalysis(lastFlown()), closeBoard };
  }
  const lockOnClick = () => { if (!hangar.station && !b.test.active && !board) input.lockPointer(); };
  window.addEventListener('click', lockOnClick);

  const offs = [
    input.onPress('KeyE', () => {
      if (hangar.station || b.test.active || board) return;
      const s = b.nearestStation();
      if (s) hangar.openStation(s.id);
    }),
    input.onPress('KeyH', () => { if (hangar.station === 'handbook') hangar.closeStation(); else if (!b.test.active && !board) { hangar.openStation('handbook'); } }),
    input.onPress('KeyZ', () => { if (DESIGN_STATIONS.includes(hangar.station) && a.undo()) { audio.play('ui.click'); refresh(); } }),
    input.onPress('KeyY', () => { if (DESIGN_STATIONS.includes(hangar.station) && a.redo()) { audio.play('ui.click'); refresh(); } }),
    input.onPress('KeyQ', () => { if (hangar.designOpen) hangar.rotateDesign(-45); }),
    input.onPress('KeyE', () => { if (hangar.designOpen) hangar.rotateDesign(45); }),
    events.on('economy:changed', () => hangar.renderMoney()),
  ];
  const esc = () => {
    if (board) { dismissBoard(); return; }
    if (hangar.dialogOpen) { hangar.closeDialog(); return; }
    if (hangar.station && hangar.designOpen && hangar.designBack()) return;
    if (hangar.station) { hangar.closeStation(); return; }
    closePause = openPauseMenu({ onResume: () => { closePause = null; input.onEscape(esc); } });
  };
  input.onEscape(esc);

  screen = {
    refresh,
    update: (dt) => {
      const frozen = !!hangar.station || b.test.active || !!closePause || !!board;
      board?.update(dt);
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
      closeBoard();
      lens.dispose();
      hangar.dispose();
      audio.stop('ambience.ship');
      graphics.setEffects({ shake: 0 });
    },
  };
  refresh();
  // back from a flight: the investigation board (a failure) or the flight analysis (a success) opens beside the stand
  const due = luck().flights.at(-1);
  if (due?.outcome?.final && !due.seen) {
    if (isFailure(due.outcome.endingId)) openBoard(due);
    else if (due.outcome.endingId === contract.ENDINGS.homecoming && due.design) openAnalysis(due);
  }
  // ?debug=1&station=integration: open a machine straight away (handy while the page reloads on every change)
  const startAt = new URLSearchParams(location.search).get('station');
  if (window.__game?.builder && startAt && b.stations.some((st) => st.id === startAt)) { b.placeAtStation(startAt); hangar.openStation(startAt); }
}

// ---------- GONOGO ----------
// The poll: the consoles call in turn (soft words, no numbers, text.json), then the bill and BACK / HOLD / CONFIRM or
// OVERRIDE. HOLD waits one day (assembly.setLaunch({ day: day + 1 }); weather.js counts the days into the pad fees) and
// polls again. CONFIRM builds the ship as flown (asBuilt.js): when the hold-down clamps catch a bad engine, or one will
// not light, the launch scrubs on the pad, nothing is paid, a new unit goes in overnight and the poll runs for tomorrow.
function enterGonogo() {
  const a = ensureAssembly();
  const b = ensureBay();
  b.setLayout(a.layout(), []);
  b.select(null);
  b.placeAtStation('teststand');
  b.update(0, { frozen: true });
  graphics.setView(b.scene, b.camera);
  audio.play('ambience.ship', { loop: true, volume: 0.3 });

  const make = (tag, className, textContent) => Object.assign(document.createElement(tag), { className, ...(textContent != null ? { textContent } : {}) });
  const root = make('div', 'gng-root hud');
  root.dataset.screen = 'gonogo';
  root.dataset.stub = 'gonogo';
  const header = make('div', 'gng-header');
  const consoleEl = make('div', 'gng-console hud-panel');
  const summary = make('div', 'gng-summary');
  const bill = make('div', 'gng-bill');
  const actions = make('div', 'gng-actions');
  root.append(header, consoleEl, summary, bill, actions);
  ui.mount(root);

  const D = text.gonogo.director ?? {};
  const fillIn = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const director = (status, line) => ({ console: D.name ?? 'LAUNCH DIRECTOR', consoleId: 'director', status, text: line, guidebook: null, problem: null });
  let result = null;
  let view = null;
  let done = false;
  let launching = false;

  function runPoll(preface = []) {
    view?.dispose();
    actions.replaceChildren();
    bill.replaceChildren();
    done = false;
    result = compute();
    const w = result.breakdown.weather ?? {};
    header.textContent = `Launch readiness poll · ${result.spec.name}${w.when ? ` · ${w.when}` : ''}`;
    summary.textContent = 'Flight controllers, report. (Space skips.)';
    const extra = [];
    if (result.reuse) {
      const n = result.reuse.flights;
      extra.push(director('INFO', fillIn(D.reflight, { flights: n, times: n === 1 ? 'time' : 'times', price: fmtMoney(result.price), full: fmtMoney(result.spec.stats.cost), wear: fmtInt(result.reuse.mean * 100) })));
    }
    if (result.pending > 0) extra.push(director('INFO', fillIn(D.owed, { owed: fmtMoney(result.pending) })));
    view = createGonogoView({
      parent: consoleEl,
      lines: [...preface, ...extra, ...result.poll.lines],
      onReveal: (line) => audio.play(line.status === 'GO' || line.status === 'INFO' ? 'gonogo.tick' : 'ui.error'),
      onDone: () => { done = true; renderEnd(); },
    });
  }

  function renderEnd() {
    const { poll, fee, pending, price, reuse } = result;
    const w = result.breakdown.weather ?? {};
    summary.textContent = poll.canConfirm
      ? (poll.needsOverride ? `${poll.warnings.length + (poll.calls?.length ?? 0)} NO-GO call(s). Overriding warnings is how real accidents started.` : 'All consoles GO.')
      : `${poll.blocks.length} hard block(s). The launch director refuses. Fix them in the bay.`;
    const item = (label, value, className = '') => bill.append(make('span', className, `${label} ${value}`));
    item(reuse ? 'Vehicle, refurbished' : 'Vehicle', fmtMoney(price));
    // pad fees, saying briefly what is in them: days on hold, repairs the last launch did to the pad
    const parts = result.breakdown.padFx?.feeParts ?? {};
    const why = [w.day > 0 ? `${w.day} day${w.day === 1 ? '' : 's'} on hold` : '', parts.repairDue > 0 ? `${fmtMoneyShort(parts.repairDue)} pad repairs` : ''].filter(Boolean).join(', ');
    if (fee) item(why ? `Pad fees (${why})` : 'Pad fees', fmtMoney(fee));
    if (pending) item('Owed from the bay', fmtMoney(pending));
    item('Total', fmtMoney(poll.total), 'gng-bill-total');
    item('Funds', fmtMoney(economy.getMoney()));
    const button = (label, className, action, onClick) => {
      const el = make('button', `hud-button ${className}`.trim(), label);
      el.type = 'button';
      el.dataset.action = action;
      el.addEventListener('click', onClick);
      actions.append(el);
      return el;
    };
    button('BACK TO THE BAY [B]', '', 'back', () => requestState('HANGAR'));
    if (canHold()) button(`HOLD ONE DAY · +${fmtMoneyShort(w.holdFee ?? 0)} [H]`, '', 'hold', hold);
    if (poll.canConfirm) button(`${poll.needsOverride ? 'OVERRIDE & LAUNCH' : 'CONFIRM & LAUNCH'} · ${fmtMoney(poll.total)} [Enter]`, poll.needsOverride ? 'hud-caution' : 'hud-good', poll.needsOverride ? 'override' : 'confirm', confirmLaunch);
  }

  /** HOLD never locks the player out: it is offered only while the launch stays affordable after one more day. */
  const canHold = () => result.poll.canConfirm && result.poll.total + (result.breakdown.weather?.holdFee ?? 0) <= economy.getMoney();
  function hold() {
    if (!done || launching || !canHold()) return;
    const plan = holdPlan(a.launch, result.breakdown.weather);
    a.setLaunch(plan.patch);
    persistDraft();
    audio.play('ui.click');
    runPoll([director('HOLD', fillIn(D.hold, { fee: fmtMoney(plan.fee) }))]);
  }

  function confirmLaunch() {
    if (!done || launching || !result.poll.canConfirm) return;
    const { poll } = result;
    if (!economy.canAfford(poll.total)) { audio.play('ui.error'); return; }
    const flown = buildAsFlown(result, luckCtx(a));
    if (flown.scrub) { scrub(flown); return; }
    launching = true;
    economy.spend(poll.total, 'ship');
    recordFlight(result, flown, a);
    // the next launch campaign starts tomorrow with fresh weather, and owes the repairs this launch did to the pad
    a.setLaunch({ day: 0, seed: (Number(a.launch.seed) || 0) + 1, repairDue: flown.pad.repairFee || 0 });
    persistDraft();
    setShip(flown.spec);
    events.emit('ship:built', { shipSpec: flown.spec });
    audio.play('ui.snap');
    requestState('PRELAUNCH');
  }

  /**
   * Abort on the pad: nothing is paid now; the bad units are swapped for fresh ones overnight and the poll runs for
   * tomorrow (one more day of pad fees through weather.js). The pad needs repairs only if the engines really fired.
   */
  function scrub(flown) {
    const s = flown.scrub;
    const l = luck();
    const units = { ...l.units };
    for (const id of s.partIds) units[id] = (units[id] ?? 0) + 1;
    const words = s.defects.map((d) => describeDefect(d, text.luck.defects, 'en')).join(' ');
    saveLuck({ units, scrubs: [...l.scrubs, { reason: s.reason, partIds: s.partIds, defects: s.defects }] });
    const plan = holdPlan(a.launch, result.breakdown.weather);
    const repair = s.reason !== 'noLight' ? flown.pad.repairFee || 0 : 0;
    a.setLaunch({ ...plan.patch, ...(repair ? { repairDue: (Number(a.launch.repairDue) || 0) + repair } : {}) });
    persistDraft();
    audio.play('ui.error');
    runPoll([director('SCRUB', fillIn(D.scrub?.[s.reason], { defect: words }))]);
  }

  input.onPress('Space', () => view?.skip());
  input.onPress('Enter', () => (done ? confirmLaunch() : view?.skip()));
  input.onPress('KeyB', () => requestState('HANGAR'));
  input.onPress('KeyH', () => hold());
  const esc = () => { closePause = openPauseMenu({ onResume: () => { closePause = null; input.onEscape(esc); } }); };
  input.onEscape(esc);
  runPoll();

  screen = {
    update: (dt) => { view?.update(dt); b.update(dt, { frozen: true }); },
    dispose: () => { view?.dispose(); root.remove(); audio.stop('ambience.ship'); },
  };
}

// ---------- module ----------
export default {
  init() {
    initLang(save);
    // the flight scenes draw the ship and its launch pad with Role 1's art (agreed by all four roles, docs/DECISIONS.md)
    registerFlightArt({ assets, getAssembly: () => assembly, getSpec: () => getShip(), padSection: sections.pad });
    events.on('builder:highlightPart', ({ partId }) => bay?.highlight([partId]));
    // how our flight ended: the record gets its outcome; a ship that came home may fly again (reuse with wear)
    events.on('flight:failed', (p) => noteFailure(p));
    events.on('flight:telemetry', (t) => flightLog.telemetry(t));
    events.on('flight:event', (e) => flightLog.event(e));
    events.on('flight:landed', (p) => flightLog.landed(p));
    events.on('ending:show', (p) => { save.update({ lastEnding: p.endingId }); noteEnding(p); });
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
