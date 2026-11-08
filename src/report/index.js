// Role 4 report: the black box (blackbox.js) and the Flight Report screen (spec §8), shown after every mission.
// A recommendation with a part opens the hangar and makes that part glow (builder:highlightPart, Role 1).
import * as THREE from 'three';
import { assets, createSpaceScene, graphics } from '/src/graphics/index.js';
import { PLANETS, events, input, requestState, ui } from '/src/core/index.js';
import { getReport, startBlackBox } from './blackbox.js';
import './report.css';

export { getReport };

let scene = null;
// Our own camera: graphics.camera is whatever the last state left. graphics.setView sets its aspect.
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e10);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, onClick, key) {
  const b = el('button', 'hud-button', key ? `${label} [${key}]` : label);
  b.type = 'button';
  b.dataset.action = label;
  b.addEventListener('click', onClick);
  return b;
}

const fmtT = (t) => `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const num = (v, digits = 0, unit = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit}`);

function statsBox(title, rows) {
  const box = el('div', 'role4-report-box');
  box.append(el('div', 'hud-label', title));
  const grid = el('div', 'role4-report-stats');
  for (const [label, value] of rows) grid.append(el('span', 'role4-muted', label), el('span', null, value));
  box.append(grid);
  return box;
}

function backdrop() {
  if (!scene) {
    scene = createSpaceScene();
    const earth = assets.get('planet:earth');
    earth.scale.setScalar(PLANETS.earth.radius);
    earth.position.set(0, -0.6, -0.8).normalize().multiplyScalar(PLANETS.earth.radius + 400e3);
    scene.add(earth);
  }
  graphics.setSunDirection(new THREE.Vector3(0.86, 0.36, -0.36));
  camera.position.set(0, 0, 0);
  camera.lookAt(0, -0.3, -1);
  graphics.setView(scene, camera);
}

function highlight(partId) {
  requestState('HANGAR');
  // after the hangar has been built and shown, so the glow is not reset by its enter()
  setTimeout(() => events.emit('builder:highlightPart', { partId }), 600);
}

function showReport() {
  const r = getReport();
  const root = el('div', 'role4-report');
  root.dataset.screen = 'REPORT';
  const card = el('div', 'hud hud-panel role4-report-card');
  root.append(card);

  const head = el('div', 'role4-report-head');
  head.append(el('div', 'hud-label', 'Flight Report · black box'));
  const outcome = el('div', `hud-value ${r.outcome === 'success' ? 'hud-good' : r.outcome === 'failure' ? 'hud-alert' : ''}`,
    r.outcome === 'success' ? 'Mission success' : r.outcome === 'failure' ? 'Mission lost' : 'Mission in progress');
  head.append(outcome);
  if (r.rootCause) head.append(el('div', 'role4-report-cause', `Root cause · ${r.rootCause}`));
  card.append(head);

  const cols = el('div', 'role4-report-cols');
  const timeline = el('div', 'role4-report-box');
  timeline.append(el('div', 'hud-label', 'Timeline'));
  const list = el('ol', 'role4-report-timeline');
  const events_ = r.timeline.length ? r.timeline.slice(-14) : [{ t: 0, label: 'Nothing recorded yet' }];
  for (const e of events_) {
    const li = el('li');
    li.append(el('span', 'role4-muted', fmtT(e.t)), el('span', null, e.label));
    list.append(li);
  }
  timeline.append(list);
  cols.append(timeline);

  const side = el('div', 'role4-report-side');
  const a = r.astronaut;
  side.append(statsBox('Astronaut', [
    ['Peak g-force', num(a.peakGForce, 1, ' g')],
    ['Radiation dose', num(a.radiationMsv, 1, ' mSv')],
    ['Suit O₂ used', a.o2UsedPercent == null ? '—' : `${a.o2UsedPercent} %`],
    ['Peak heart rate', num(a.peakHeartRate, 0, ' bpm')],
  ]));
  const s = r.ship;
  side.append(statsBox('Ship', [
    ['Max-Q', num(s.maxQKpa, 1, ' kPa')],
    ['Peak engine heat', s.peakEngineTempPercent == null ? '—' : `${s.peakEngineTempPercent} % of limit`],
    ['Highest altitude', num(s.peakAltitudeKm, 1, ' km')],
    ['Debris hits', String(s.hits)],
    ['Touchdown', s.touchdownSpeed == null ? '—' : `${Number(s.touchdownSpeed).toFixed(1)} m/s`],
    ['Mars tasks done', String(r.tasks.length)],
  ]));
  cols.append(side);
  card.append(cols);

  const recs = el('div', 'role4-report-box');
  recs.append(el('div', 'hud-label', 'Engineering recommendations'));
  if (!r.recommendations.length) recs.append(el('div', 'role4-muted', 'No recommendations yet.'));
  for (const rec of r.recommendations) {
    const row = el('div', 'role4-report-rec');
    row.append(el('span', null, rec.text));
    if (rec.partId) row.append(button('Show part', () => highlight(rec.partId)));
    recs.append(row);
  }
  card.append(recs);

  const actions = el('div', 'role4-report-actions');
  actions.append(button('Guidebook', () => events.emit('guidebook:open', { entryId: 'index' })), button('Back to hangar', () => requestState('HANGAR'), 'Enter'));
  input.onPress('Enter', () => requestState('HANGAR'));
  card.append(actions);
  ui.mount(root);
}

export default {
  init() {
    startBlackBox();
  },

  enter() {
    backdrop();
    showReport();
  },
};
