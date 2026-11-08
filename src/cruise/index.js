// Role 4 cruise (spec §6.3 step 4): the trip from Earth orbit to Mars on a real Hohmann transfer, compressed in time.
// Map with Earth, Mars and the ship, a day counter, time warp, growing comms delay, radiation dose (1.8 mSv/day, measured
// by Curiosity's RAD on the way to Mars), a solar storm and an Apollo 13-style malfunction. Arrival requests ENTRY.
import * as THREE from 'three';
import { assets, createSpaceScene, graphics } from '/src/graphics/index.js';
import { PLANETS, events, getShip, input, requestState, ui } from '/src/core/index.js';
import data from './data.json';
import './cruise.css';

// Hohmann transfer from 1 AU to Mars' 1.524 AU orbit: half an ellipse, about 259 days.
const R_MARS = 1.524;
const A = (1 + R_MARS) / 2;
const E = (R_MARS - 1) / (R_MARS + 1);
const AU_KM = 1.496e8;
const LIGHT_SECONDS_PER_AU = 499;
const V_EARTH = 29.78; // km/s, Earth's orbital speed

const deg = THREE.MathUtils.degToRad;
const earthAngle = (day) => deg((360 * day) / 365.25);
const marsAngle = (day) => deg(data.marsLeadDeg + (360 * day) / 687);

/** Ship on the transfer ellipse after `day` days: { x, y } in AU (Sun at 0, Earth at departure on +x), r, speed. */
function shipAt(day) {
  const M = Math.PI * Math.min(1, day / data.tripDays);
  let ecc = M;
  for (let i = 0; i < 8; i++) ecc -= (ecc - E * Math.sin(ecc) - M) / (1 - E * Math.cos(ecc));
  const nu = 2 * Math.atan2(Math.sqrt(1 + E) * Math.sin(ecc / 2), Math.sqrt(1 - E) * Math.cos(ecc / 2));
  const r = A * (1 - E * Math.cos(ecc));
  return { x: r * Math.cos(nu), y: r * Math.sin(nu), r, speed: V_EARTH * Math.sqrt(2 / r - 1 / A) };
}

let s = null;
let scene = null;
let rig = null;
let earth = null;
let mars = null;
// Our own camera: graphics.camera is whatever the last state left. graphics.setView sets its aspect.
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1e10);

function buildScene() {
  scene = createSpaceScene();
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
  sun.position.set(0.7, 0.3, 0.4).multiplyScalar(100);
  scene.add(sun, new THREE.AmbientLight(0x30405a, 0.35));
  rig = new THREE.Group();
  const engine = assets.get('rocketPart:engine_m');
  const capsule = assets.get('rocketPart:capsule_m');
  capsule.position.y = engine.userData.height ?? 2.2;
  rig.add(engine, capsule);
  rig.rotation.set(0, 0, -Math.PI / 2); // flying sideways across the view
  scene.add(rig);
  earth = assets.get('planet:earth');
  earth.scale.setScalar(PLANETS.earth.radius);
  mars = assets.get('planet:mars');
  mars.scale.setScalar(PLANETS.mars.radius);
  scene.add(earth, mars);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, onClick, key) {
  const b = el('button', 'hud-button', key ? `${label} [${key.replace(/^(Key|Digit)/, '')}]` : label);
  b.type = 'button';
  b.dataset.action = label;
  b.addEventListener('click', onClick);
  if (key) input.onPress(key, () => b.isConnected && onClick());
  return b;
}

// ---------- the map ----------

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function buildMap() {
  const scale = 60;
  const map = svg('svg', { viewBox: '-105 -105 210 210', class: 'role4-cruise-map' });
  map.append(svg('circle', { r: scale, class: 'orbit' }), svg('circle', { r: R_MARS * scale, class: 'orbit' }));
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const p = shipAt((data.tripDays * i) / 60);
    pts.push(`${(p.x * scale).toFixed(1)},${(-p.y * scale).toFixed(1)}`);
  }
  map.append(svg('polyline', { points: pts.join(' '), class: 'transfer' }));
  map.append(svg('circle', { r: 5, class: 'sun' }));
  const dot = (cls, r) => map.appendChild(svg('circle', { r, class: cls }));
  const earthDot = dot('earth', 3.5);
  const marsDot = dot('mars', 3);
  const shipDot = dot('ship', 2.6);
  const place = (node, angle, radius) => {
    node.setAttribute('cx', (Math.cos(angle) * radius * scale).toFixed(1));
    node.setAttribute('cy', (-Math.sin(angle) * radius * scale).toFixed(1));
  };
  return {
    map,
    update(day) {
      place(earthDot, earthAngle(day), 1);
      place(marsDot, marsAngle(day), R_MARS);
      const p = shipAt(day);
      shipDot.setAttribute('cx', (p.x * scale).toFixed(1));
      shipDot.setAttribute('cy', (-p.y * scale).toFixed(1));
    },
  };
}

// ---------- the HUD ----------

function buildHud() {
  const root = el('div', 'role4-cruise');
  root.dataset.screen = 'CRUISE';
  root.style.pointerEvents = 'none';

  const top = el('div', 'hud hud-panel role4-cruise-top');
  top.append(el('div', 'hud-label', 'Cruise to Mars'));
  const day = top.appendChild(el('div', 'hud-value'));
  const bar = top.appendChild(el('div', 'hud-bar'));
  root.append(top);

  const left = el('div', 'hud hud-panel role4-cruise-left');
  const row = (label) => {
    left.append(el('span', 'hud-label', label));
    return left.appendChild(el('span', 'hud-value role4-cruise-num'));
  };
  const delay = row('Comms delay, one way');
  const dist = row('Distance from Earth');
  const speed = row('Speed around the Sun');
  const dose = row('Radiation dose');
  root.append(left);

  const right = el('div', 'hud hud-panel role4-cruise-right');
  right.append(el('div', 'hud-label', 'Transfer orbit'));
  const map = buildMap();
  right.append(map.map);
  const legend = el('div', 'role4-cruise-legend');
  legend.innerHTML = '<span class="earth">●</span> Earth <span class="mars">●</span> Mars <span class="ship">●</span> You';
  right.append(legend);
  root.append(right);

  const controls = el('div', 'hud hud-panel role4-cruise-controls');
  controls.append(el('span', 'hud-label', 'Time warp'));
  const warpButtons = data.daysPerSecond.map((d, i) => button(`${d} days/s`, () => setWarp(i), `Digit${i + 1}`));
  controls.append(...warpButtons);
  if (new URLSearchParams(location.search).get('debug') === '1') controls.append(button('Skip to Mars', () => requestState('ENTRY'), 'Enter'));
  root.append(controls);

  const note = el('div', 'hud hud-panel role4-cruise-note');
  note.style.display = 'none';
  root.append(note);

  const modal = el('div', 'hud hud-panel role4-cruise-modal');
  modal.style.display = 'none';
  root.append(modal);

  ui.mount(root, { layer: 'hud' });
  root.style.pointerEvents = 'none';
  return { root, day, bar, delay, dist, speed, dose, map, warpButtons, modal, note };
}

// Pacing rule: every minute has a decision, a sensation or a lesson. Between the two big encounters the cruise shows
// short lesson notes (data.notes), drops the time warp to the default at every event, and never leaves more than
// MAX_QUIET_SECONDS of real time empty: a slow warp over a long quiet stretch is raised once by itself.
const DEFAULT_WARP = 1;
const MAX_QUIET_SECONDS = 30;
const NOTE_SECONDS = 9;

/** Days of every upcoming event, in order: notes, storm, malfunction, arrival. */
function eventDays() {
  return [...data.notes.map((n) => n.day), data.solarStorm.day, data.malfunction.day, data.tripDays].sort((a, b) => a - b);
}

function showNote(n) {
  s.hud.note.replaceChildren(el('div', 'hud-label', n.title), el('div', 'role4-cruise-text', n.text));
  s.hud.note.style.display = '';
  s.noteLeft = NOTE_SECONDS;
}

/** At an event: back to the default warp if the player was going faster. */
function dropWarp() {
  if (s.warp > DEFAULT_WARP) setWarp(DEFAULT_WARP);
}

function setWarp(i) {
  if (!s || s.encounter) return;
  s.warp = i;
  s.hud.warpButtons.forEach((b, j) => b.classList.toggle('hud-ok', j === i));
}

function render() {
  const { hud, day } = s;
  const p = shipAt(day);
  const ea = earthAngle(day);
  const distAu = Math.hypot(p.x - Math.cos(ea), p.y - Math.sin(ea));
  const delaySec = distAu * LIGHT_SECONDS_PER_AU;
  hud.day.textContent = `Day ${Math.floor(day)} / ${data.tripDays}`;
  hud.bar.style.setProperty('--value', String(Math.min(1, day / data.tripDays)));
  hud.delay.textContent = delaySec < 60 ? `${delaySec.toFixed(0)} s` : `${Math.floor(delaySec / 60)} min ${String(Math.round(delaySec % 60)).padStart(2, '0')} s`;
  hud.dist.textContent = `${((distAu * AU_KM) / 1e6).toFixed(1)} million km`;
  hud.speed.textContent = `${p.speed.toFixed(1)} km/s`;
  hud.dose.textContent = `${s.dose.toFixed(0)} mSv`;
  hud.map.update(day);
  return { p, speedMs: p.speed * 1000 };
}

// ---------- encounters ----------

function openModal(title, body) {
  const m = s.hud.modal;
  m.replaceChildren(el('div', 'hud-label hud-alert', title));
  for (const line of [].concat(body)) m.append(typeof line === 'string' ? el('div', 'role4-cruise-text', line) : line);
  m.style.display = '';
  m.style.pointerEvents = 'auto';
  return m;
}

function closeModal() {
  s.hud.modal.style.display = 'none';
  s.encounter = null;
}

function solarStorm() {
  const cfg = data.solarStorm;
  s.encounter = { type: 'storm', left: cfg.seconds, sheltered: false };
  const count = el('div', 'hud-value');
  const m = openModal(cfg.title, [cfg.text, count]);
  const act = el('div', 'role4-cruise-actions');
  act.append(button('Go to the shelter', () => resolveStorm(true), 'KeyS'));
  m.append(act);
  s.encounter.count = count;
  try { graphics.setEffects({ vignette: 0.25 }); } catch { /* optional */ }
}

function resolveStorm(sheltered) {
  if (s?.encounter?.type !== 'storm') return;
  const cfg = data.solarStorm;
  const hasShelter = !!getShip()?.stats?.hasShelter;
  const dose = sheltered ? (hasShelter ? cfg.doseShelter : cfg.doseImprovised) : cfg.doseIgnored;
  s.dose += dose;
  const text = (sheltered ? (hasShelter ? cfg.resultShelter : cfg.resultImprovised) : cfg.resultIgnored).replace('{dose}', dose);
  events.emit('flight:event', { type: 'solar_storm', t: s.t, data: { doseMsv: dose, sheltered, hasShelter } });
  graphics.setEffects({ vignette: 0 });
  s.encounter = { type: 'result' };
  const m = openModal(cfg.title, text);
  const act = el('div', 'role4-cruise-actions');
  act.append(button('Continue', () => { closeModal(); events.emit('guidebook:open', { entryId: cfg.entry }); }, 'Space'));
  m.append(act);
}

function malfunction() {
  const cfg = data.malfunction;
  s.encounter = { type: 'malfunction', attempts: 0 };
  try { graphics.setEffects({ shake: 0.4 }); } catch { /* optional */ }
  setTimeout(() => graphics.setEffects({ shake: 0 }), 600);
  const readings = el('ul', 'role4-cruise-readings');
  for (const r of cfg.readings) readings.append(el('li', r.includes('falling') || r.includes('dropping') ? 'hud-alert' : '', r));
  const result = el('div', 'role4-cruise-text');
  const m = openModal(cfg.title, [cfg.text, readings, result]);
  const act = el('div', 'role4-cruise-actions role4-cruise-options');
  cfg.options.forEach((opt, i) => {
    act.append(button(opt.label, () => {
      if (s?.encounter?.type !== 'malfunction') return;
      s.encounter.attempts += 1;
      result.textContent = opt.result;
      result.className = `role4-cruise-text ${opt.correct ? 'hud-good' : 'hud-caution'}`;
      if (opt.correct) {
        events.emit('flight:event', { type: 'malfunction', t: s.t, data: { fixed: true, attempts: s.encounter.attempts } });
        act.replaceChildren(button('Continue', () => { closeModal(); events.emit('guidebook:open', { entryId: cfg.entry }); }, 'Space'));
        s.encounter.type = 'result';
      }
    }, `Digit${i + 4}`));
  });
  m.append(act);
}

export default {
  enter() {
    if (!scene) buildScene();
    graphics.setSunDirection(new THREE.Vector3(0.7, 0.3, 0.4));
    graphics.setView(scene, camera);
    s = { day: 0, t: 0, warp: 1, dose: 0, sinceTelemetry: 0, encounter: null, stormDone: false, malfunctionDone: false, notesShown: new Set(), noteLeft: 0, autoFor: null, arrived: false, hud: buildHud() };
    setWarp(1);
    render();
  },

  update(dt) {
    if (!s) return;
    s.t += dt;
    const enc = s.encounter;
    if (enc?.type === 'storm') {
      enc.left -= dt;
      enc.count.textContent = `${Math.max(0, enc.left).toFixed(0)} s`;
      if (enc.left <= 0) resolveStorm(false);
    }
    if (s.noteLeft > 0 && (s.noteLeft -= dt) <= 0) s.hud.note.style.display = 'none';
    if (!enc) {
      const before = s.day;
      s.day = Math.min(data.tripDays, s.day + dt * data.daysPerSecond[s.warp]);
      s.dose += (s.day - before) * data.doseMsvPerDay;
      const note = data.notes.find((n) => !s.notesShown.has(n.day) && s.day >= n.day);
      if (note) { s.notesShown.add(note.day); dropWarp(); showNote(note); }
      if (!s.stormDone && s.day >= data.solarStorm.day) { s.stormDone = true; dropWarp(); solarStorm(); }
      else if (!s.malfunctionDone && s.day >= data.malfunction.day) { s.malfunctionDone = true; dropWarp(); malfunction(); }
      else if (!s.arrived && s.day >= data.tripDays) { s.arrived = true; requestState('ENTRY'); return; }
    }

    // Auto-warp: a slow warp over a quiet stretch longer than MAX_QUIET_SECONDS goes up one step, once per stretch.
    if (!s.encounter) {
      const nextDay = eventDays().find((d) => d > s.day);
      if (nextDay != null && nextDay !== s.autoFor && s.warp < DEFAULT_WARP && (nextDay - s.day) / data.daysPerSecond[s.warp] > MAX_QUIET_SECONDS) {
        s.autoFor = nextDay;
        setWarp(DEFAULT_WARP);
      }
    }

    const { speedMs } = render();
    // Earth shrinks behind, Mars grows ahead. Planets move, the camera stays near the origin (precision).
    const p = s.day / data.tripDays;
    earth.position.set(0.55, -0.12, 1).normalize().multiplyScalar(PLANETS.earth.radius * (5 + 900 * p));
    mars.position.set(-0.45, -0.18, -1).normalize().multiplyScalar(PLANETS.mars.radius * (6 + 700 * (1 - p)));
    const a = s.t * 0.05;
    camera.position.set(Math.sin(a) * 8, 2.2 + Math.sin(a * 0.7) * 0.8, Math.cos(a) * 8);
    camera.lookAt(0, 0, 0);
    rig.rotation.x += dt * 0.03;

    s.sinceTelemetry += dt;
    if (s.sinceTelemetry >= 0.5) {
      s.sinceTelemetry = 0;
      events.emit('flight:telemetry', { t: s.t, phase: 'cruise', speed: speedMs, radiationMsv: s.dose });
    }
  },

  exit() {
    if (!s) return;
    graphics.setEffects({ vignette: 0, shake: 0 });
    s = null;
  },
};
