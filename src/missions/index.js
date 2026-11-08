// Role 4 missions: Mars tasks (spec §9), Mars Exploration %, rewards, and the mission HUD on Mars.
// Owns no state. It places Role 3's mission props in the shared Mars scene when SURFACE starts, registers them with
// Role 2's registerInteractable, and listens for task:completed. Halcyon-1 logs are recovered on Mars and count once
// they are uploaded at the ship's comms console. The discovery rock opens once both logs are recovered.
import * as THREE from 'three';
import { contract, economy, events, getState, ui } from '/src/core/index.js';
import { assets, getTerrainHeight, graphics } from '/src/graphics/index.js';
import * as surface from '/src/surface/index.js';
import { registerInteractable } from '/src/surface/index.js';
import { classifyTasks, summarise } from './reach.js';
import placement from './tasks.json';
import './missions.css';

const TASK_IDS = Object.keys(contract.TASKS);
const LOG_IDS = ['log1', 'log2'];
const done = new Set();
const carried = new Set(); // logs recovered on Mars, not yet uploaded
const energyParts = new Set(); // 'panels' and 'ice'
let percent = 0;

const group = new THREE.Group();
group.name = 'role4-mission-props';
const spots = []; // { def, prop, used }
let hud = null;

// Recompute from the finished set instead of adding weights one by one: the three samples weigh 25/3 each, and
// summing floats in some orders ends at 99.99999999999999, which would block the return (it needs percent >= 100).
function computePercent() {
  if (done.size === TASK_IDS.length) return 100;
  let sum = 0;
  for (const id of done) sum += contract.TASKS[id].weight;
  return Math.min(100, Math.round(sum * 100) / 100);
}

/** Current Mars Exploration progress: { percent, completed }. percent is exactly 100 once every task is done. */
export function getProgress() {
  return { percent, completed: [...done] };
}

const logsFound = () => LOG_IDS.filter((id) => carried.has(id) || done.has(id)).length;

function complete(taskId) {
  if (done.has(taskId)) return;
  const task = contract.TASKS[taskId];
  events.emit('task:completed', { taskId, category: task.category, reward: task.reward });
}

function spotDone(spot) {
  if (spot.def.prop === 'dataLog' || spot.def.prop === 'sampleRock') return spot.used; // picked up
  if (spot.def.part) return energyParts.has(spot.def.part);
  return done.has(spot.def.taskId);
}

function refreshProps() {
  for (const spot of spots) {
    const finished = spotDone(spot);
    // collected logs and samples leave the ground; scans, panels and ice stay and turn green
    spot.prop.visible = !(finished && (spot.def.prop === 'dataLog' || spot.def.prop === 'sampleRock'));
    const locked = spot.def.taskId === 'discovery' && logsFound() < 2;
    spot.prop.userData.setState?.(finished ? 'done' : locked ? 'idle' : 'active');
  }
}

function use(spot) {
  if (spot.used) return;
  const { taskId, part, prop, entry } = spot.def;
  spot.used = true;
  if (prop === 'dataLog') {
    carried.add(taskId);
    events.emit('story:log', { logId: taskId });
  } else if (part) {
    energyParts.add(part);
    if (energyParts.has('panels') && energyParts.has('ice')) complete('energy');
  } else {
    complete(taskId);
  }
  if (entry && prop !== 'dataLog') events.emit('guidebook:open', { entryId: entry });
  refreshProps();
  renderHud();
}

function placeProps() {
  for (const def of placement.tasks) {
    const y = getTerrainHeight(def.x, def.z);
    const prop = assets.get(def.prop);
    prop.position.set(def.x, y, def.z);
    prop.rotation.y = (def.x * 0.37 + def.z * 0.11) % (Math.PI * 2);
    group.add(prop);
    const spot = { def, prop, used: false };
    spots.push(spot);
    const height = prop.userData.height ?? 0.6;
    registerInteractable({
      id: `role4-${def.taskId}${def.part ? `-${def.part}` : ''}`,
      state: 'SURFACE',
      position: { x: def.x, y: y + Math.min(height, 1.2) * 0.6, z: def.z },
      radius: placement.radius,
      hold: def.hold,
      prompt: def.prompt,
      enabled: () => !spotDone(spot) && (def.taskId !== 'discovery' || logsFound() >= 2),
      onUse: () => use(spot),
    });
  }
  const w = placement.wreck;
  const wreck = assets.get(w.prop);
  wreck.position.set(w.x, getTerrainHeight(w.x, w.z), w.z);
  wreck.rotation.y = w.rotation;
  group.add(wreck);
  refreshProps();
}

function resetMission() {
  done.clear();
  carried.clear();
  energyParts.clear();
  percent = 0;
  for (const spot of spots) spot.used = false;
  refreshProps();
  renderHud();
  events.emit('progress:changed', { percent });
}

// ---------- the mission HUD (SURFACE and INTERIOR) ----------

function nextObjective() {
  if (percent >= 100) return null;
  for (const spot of spots) {
    if (spotDone(spot)) continue;
    if (spot.def.taskId === 'discovery' && logsFound() < 2) continue;
    if (LOG_IDS.includes(spot.def.taskId) && done.has(spot.def.taskId)) continue;
    return spot;
  }
  return spots.find((s) => s.def.taskId === 'discovery' && !spotDone(s)) ?? null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function mountHud(state) {
  hud = el('div', 'hud hud-panel role4-mission');
  hud.dataset.role4 = 'missions';
  hud.style.pointerEvents = 'none';
  hud.append(el('div', 'hud-label', 'Mars exploration'));
  hud.percentEl = hud.appendChild(el('div', 'hud-value'));
  const bar = hud.appendChild(el('div', 'hud-bar'));
  hud.bar = bar;
  hud.list = hud.appendChild(el('div', 'role4-mission-list'));
  hud.target = hud.appendChild(el('div', 'role4-mission-target'));
  hud.arrow = hud.target.appendChild(el('span', 'role4-arrow', '▲'));
  hud.targetText = hud.target.appendChild(el('span'));
  hud.reach = hud.appendChild(el('div', 'role4-reach'));
  hud.reach.style.display = 'none';
  hud.hint = hud.appendChild(el('div', 'role4-mission-hint'));
  hud.state = state;
  ui.mount(hud, { layer: 'hud' });
  hud.style.pointerEvents = 'none';
  renderHud();
}

const CATEGORY_LABELS = { scan: 'Terrain scans', energy: 'Energy', sample: 'Samples', log: 'Halcyon-1 logs', discovery: 'The discovery' };

function renderHud() {
  if (!hud?.isConnected) return;
  hud.percentEl.textContent = `${Math.floor(percent)} %`;
  hud.bar.style.setProperty('--value', String(percent / 100));

  hud.list.replaceChildren();
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const ids = TASK_IDS.filter((id) => contract.TASKS[id].category === category);
    const n = ids.filter((id) => done.has(id)).length;
    const row = el('div', n === ids.length ? 'hud-good' : '', `${n === ids.length ? '✓' : '·'} ${label} ${n}/${ids.length}`);
    hud.list.append(row);
  }

  const inside = hud.state === 'INTERIOR';
  const target = inside ? null : nextObjective();
  hud.target.style.display = target ? '' : 'none';
  if (target) hud.targetText.textContent = target.def.label;

  let hint = '';
  if (percent >= 100) hint = 'All tasks done. Take the pilot seat to go home.';
  else if (carried.size) hint = `Carrying ${carried.size} Halcyon-1 log${carried.size > 1 ? 's' : ''}: upload at the comms console in the ship.`;
  else if (inside && done.size === 0) hint = 'Suit up at the locker, then use the airlock.';
  hud.hint.textContent = hint;
  updateBearing();
}

// ---------- reach rings (Role 2's surface.getReach, optional) ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Remaining tasks with their reach class, or [] when getReach is missing or returns nothing. */
function remainingWithReach() {
  let reach = null;
  try { reach = (window.__role4?.reachOverride ?? surface.getReach)?.() ?? null; } catch { /* optional */ } // reachOverride: debug=1 test hook only
  if (!reach) return { reach: null, list: [] };
  const todo = spots.filter((s) => !spotDone(s)).map((s) => ({ label: s.def.label, x: s.def.x, z: s.def.z, locked: s.def.taskId === 'discovery' && logsFound() < 2 }));
  return { reach, list: classifyTasks(todo, reach) };
}

function renderReach() {
  if (!hud?.isConnected || hud.state !== 'SURFACE') return;
  const { reach, list } = remainingWithReach();
  if (!reach || !list.length) { hud.reach.style.display = 'none'; return; }
  const n = summarise(list);
  const roverName = reach.roverName ?? 'rover';
  hud.reach.replaceChildren();
  hud.reach.style.display = '';
  // A small top-down map: lander at the ship mark, rings around the player, one dot per remaining task.
  const map = svgEl('svg', { viewBox: '-130 -165 350 335', class: 'role4-reach-map' });
  const rr = (r) => svgEl('circle', { cx: reach.origin.x, cy: reach.origin.z, r, class: 'ring' });
  const rover = rr(reach.roverMetres); rover.classList.add('rover');
  const walk = rr(reach.walkMetres); walk.classList.add('walk');
  map.append(rover, walk);
  for (const t of list) map.append(svgEl('circle', { cx: t.x, cy: t.z, r: 7, class: `task ${t.reachClass}` }));
  map.append(svgEl('rect', { x: reach.ship.x - 6, y: reach.ship.z - 6, width: 12, height: 12, class: 'ship' }));
  map.append(svgEl('circle', { cx: reach.origin.x, cy: reach.origin.z, r: 6, class: 'you' }));
  hud.reach.append(map);
  const sum = el('div', 'role4-reach-sum', `${n.walk} on foot · ${n.rover} by ${roverName} · ${n.out} too far`);
  hud.reach.append(sum);
  hud.reach.append(el('div', 'role4-reach-key', `Rings: walk ${Math.round(reach.walkMetres)} m · ${roverName} ${Math.round(reach.roverMetres)} m (out and back)`));
  const next = nextObjective();
  const nextInfo = next && list.find((t) => t.label === next.def.label);
  if (nextInfo) hud.targetText.textContent += ` · ${nextInfo.reachLabel}`;
}

const forward = new THREE.Vector3();
function updateBearing() {
  if (!hud?.isConnected || hud.state !== 'SURFACE') return;
  const target = nextObjective();
  if (!target) return;
  const cam = graphics.camera;
  cam.getWorldDirection(forward);
  const dx = target.def.x - cam.position.x;
  const dz = target.def.z - cam.position.z;
  const dist = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, -dz) - Math.atan2(forward.x, -forward.z); // 0 = straight ahead, + = to the right
  hud.arrow.style.transform = `rotate(${angle}rad)`;
  hud.targetText.textContent = `${target.def.label} · ${Math.round(dist)} m`;
  renderReach();
}

export default {
  init() {
    placeProps();

    events.on('task:completed', ({ taskId }) => {
      const task = contract.TASKS[taskId];
      if (!task || done.has(taskId)) return;
      done.add(taskId);
      carried.delete(taskId);
      economy.reward(task.reward, `task:${taskId}`);
      percent = computePercent();
      events.emit('progress:changed', { percent });
      if (percent === 100) events.emit('mission:complete', {});
      refreshProps();
      renderHud();
    });

    // Halcyon-1 logs count once they are uploaded at the comms console (spec §9: carry back, then upload).
    events.on('interior:interact', ({ stationId }) => {
      if (stationId !== 'commsConsole' || !carried.size) return;
      for (const logId of [...carried]) complete(logId);
    });

    // A new ship is a new mission: Mars progress starts again from 0.
    events.on('ship:built', resetMission);

    events.on('state:changed', ({ to }) => {
      // main.js has already run the new owner's enter(), so in SURFACE graphics.scene is Role 2's shared Mars scene.
      if (to === 'SURFACE' && group.parent !== graphics.scene) graphics.scene.add(group);
      if (to === 'SURFACE' || to === 'INTERIOR') mountHud(to);
      else hud = null;
    });

    // Role 2 sends telemetry twice a second on Mars: a cheap tick for the direction arrow.
    events.on('flight:telemetry', () => {
      if (getState() === 'SURFACE') updateBearing();
    });

    if (new URLSearchParams(location.search).get('debug') === '1') {
      window.__role4 = { ...(window.__role4 ?? {}), missions: { spots, done, carried, complete, use, getProgress, renderReach } };
    }
  },
};
