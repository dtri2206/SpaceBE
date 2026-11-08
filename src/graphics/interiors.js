import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRenderer, sharedUniforms } from './shared.js';
import { buildCockpitInterior, buildWindow, DASH } from './cockpitParts.js';
import { events, getShip } from '/src/core/index.js';

let environment = null;

// A soft studio reflection, so metal and paint still read inside a dark ship.
export function interiorEnvironment() {
  if (!environment) {
    const pmrem = new THREE.PMREMGenerator(getRenderer());
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return environment;
}

export const pbr = (color, roughness = 0.55, metalness = 0.1, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: interiorEnvironment(), envMapIntensity: 0.3, ...extra });

const glow = (color, power = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) });

function box(w, h, d, material, x = 0, y = 0, z = 0, radius = 0.025) {
  const geometry = radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, Math.min(w, h, d) / 2)) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

// A faint diagonal sheen over the black glass.
function reflectionTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, 'rgba(180,220,255,.07)'); g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(180,220,255,.05)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function screen(width, height, draw, power = 1.5, res = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = Math.round(res * height / width);
  const c = canvas.getContext('2d');
  c.fillStyle = '#04100f';
  c.fillRect(0, 0, canvas.width, canvas.height);
  draw(c, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(power, power, power) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.userData.redraw = () => { // clear and draw again (cockpit screens with live data)
    c.fillStyle = '#04100f';
    c.fillRect(0, 0, canvas.width, canvas.height);
    draw(c, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  mesh.userData.canvas = canvas;
  return mesh;
}

const CYAN = '#67e8f9', AMBER = '#fbbf24';

// ---- Live cockpit data ----------------------------------------------------------------------------------------
// Latest values from flight:telemetry (sent about twice a second). Missing fields stay null and print as "--".
const MAXQ_PA = 40000; // matches the flight model's structural limit; used when telemetry sends no maxQ
const HISTORY = 240; // altitude samples kept for the plot (about 2 minutes)
const live = { version: 0, t: null, altitude: null, speed: null, gForce: null, q: null, maxQ: null, fuelKg: null, fuelMax: 0, engineTemp: null, history: [] };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function resetLive() {
  Object.assign(live, { t: null, altitude: null, speed: null, gForce: null, q: null, maxQ: null, fuelKg: null, fuelMax: 0, engineTemp: null, history: [] });
  live.version++;
}

events.on('state:changed', ({ to }) => { if (to === 'LAUNCH') resetLive(); });
events.on('flight:telemetry', (p) => {
  const t = num(p.t);
  if (t !== null && live.t !== null && t < live.t - 1) resetLive(); // a new flight started
  live.t = t;
  live.altitude = num(p.altitude);
  live.speed = num(p.speed);
  live.gForce = num(p.gForce);
  live.q = num(p.q);
  live.maxQ = num(p.maxQ);
  live.fuelKg = num(p.fuelKg);
  live.engineTemp = num(p.engineTemp);
  if (live.fuelKg !== null) live.fuelMax = Math.max(live.fuelMax, live.fuelKg); // fallback when the ship has no tank size
  if (live.altitude !== null) {
    live.history.push(live.altitude);
    if (live.history.length > HISTORY) live.history.shift();
  }
  live.version++;
});

const fmt = (v, digits = 0, unit = '') => (v === null ? '--' : v.toFixed(digits) + unit);
const clamp01 = (v) => (v === null ? null : Math.min(1, Math.max(0, v)));
const RED = '#f87171';

// ---- Glass-cockpit UI: dark panels, thin cyan lines, large white numerals (Crew Dragon style) --------------------
const UI = { cyan: '#7ee7f7', dim: 'rgba(126,231,247,.35)', faint: 'rgba(126,231,247,.12)', white: '#eef8fc', amber: '#fbbf24', red: '#f87171' };
const UI_FONT = '"IBM Plex Mono", monospace';

// Dark gradient backdrop with a thin title row and corner ticks.
function uiBackdrop(c, w, h, title, right = '') {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#030a10');
  g.addColorStop(1, '#071a24');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = UI.dim;
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(24, 62); c.lineTo(w - 24, 62); c.stroke();
  c.fillStyle = UI.cyan;
  c.fillRect(24, 28, 8, 8);
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.font = `500 22px ${UI_FONT}`;
  c.fillText(title, 44, 44);
  c.textAlign = 'right';
  c.fillStyle = UI.dim;
  c.fillText(right, w - 24, 44);
  c.textAlign = 'left';
  c.strokeStyle = UI.cyan;
  c.lineWidth = 3;
  for (const [x, y, dx, dy] of [[4, 4, 1, 1], [w - 4, 4, -1, 1], [4, h - 4, 1, -1], [w - 4, h - 4, -1, -1]]) {
    c.beginPath(); c.moveTo(x + dx * 22, y); c.lineTo(x, y); c.lineTo(x, y + dy * 22); c.stroke();
  }
}

// One gauge: small label, large numerals, a thin tick bar. `zone` (0..1) picks the colour; `fill` (0..1) is the bar length.
function gauge(c, w, y, label, value, unit, sub, fill, zone, amberAt, redAt) {
  const x = 34, bw = w - 68;
  const col = zone === null ? UI.dim : zone >= redAt ? UI.red : zone >= amberAt ? UI.amber : UI.cyan;
  c.textAlign = 'left';
  c.fillStyle = UI.cyan;
  c.font = `500 24px ${UI_FONT}`;
  c.fillText(label, x, y);
  c.textAlign = 'right';
  c.fillStyle = UI.dim;
  c.font = `500 22px ${UI_FONT}`;
  c.fillText(sub, w - 34, y);
  c.textAlign = 'left';
  c.fillStyle = col === UI.dim ? UI.dim : UI.white;
  c.font = `600 86px ${UI_FONT}`;
  c.fillText(value, x, y + 84);
  const vw = c.measureText(value).width;
  c.fillStyle = UI.cyan;
  c.font = `500 28px ${UI_FONT}`;
  c.fillText(unit, x + vw + 12, y + 84);
  const by = y + 112;
  c.fillStyle = UI.faint;
  c.fillRect(x, by, bw, 8);
  if (fill !== null) {
    c.fillStyle = col;
    c.fillRect(x, by, bw * fill, 8);
    c.fillRect(x + bw * fill - 2, by - 8, 4, 24); // marker
  }
  c.fillStyle = UI.dim;
  for (let i = 0; i <= 10; i++) c.fillRect(x + (bw * i) / 10 - 1, by + 14, 2, i % 5 === 0 ? 12 : 6);
  if (amberAt < 1) { c.fillStyle = 'rgba(251,191,36,.7)'; c.fillRect(x + bw * amberAt - 1, by - 6, 2, 8); }
  if (redAt < 1) { c.fillStyle = 'rgba(248,113,113,.8)'; c.fillRect(x + bw * redAt - 1, by - 6, 2, 8); }
}

function drawReadout(c, w, h) {
  // The tank size from the ship's stats is the real 100 %; without it the highest fuel seen this flight stands in.
  const tank = getShip()?.stats?.fuelMass;
  const capacity = typeof tank === 'number' && tank > 0 ? tank : live.fuelMax;
  const fuel = live.fuelKg !== null && capacity > 0 ? clamp01(live.fuelKg / capacity) : null;
  uiBackdrop(c, w, h, 'PROPULSION', 'MAIN ENGINE');
  gauge(c, w, 112, 'FUEL', fuel === null ? '--' : (fuel * 100).toFixed(0), '%', fuel === null ? '' : `${fmt(live.fuelKg / 1000, 1)} t`, fuel, fuel === null ? null : 1 - fuel, 0.6, 0.85);
  // engineTemp is 0..1 where 1 is engine failure
  const heat = clamp01(live.engineTemp);
  gauge(c, w, 112 + (h - 112) / 2, 'ENG HEAT', heat === null ? '--' : (heat * 100).toFixed(0), '%', 'LIMIT 100', heat, heat, 0.7, 0.85);
}

function drawTrajectory(c, w, h) {
  uiBackdrop(c, w, h, 'TRAJECTORY', 'ALTITUDE / TIME');
  const alt = live.altitude === null ? '--' : live.altitude >= 10000 ? `${(live.altitude / 1000).toFixed(1)}` : `${live.altitude.toFixed(0)}`;
  const altUnit = live.altitude !== null && live.altitude >= 10000 ? 'km' : 'm';
  const spd = live.speed === null ? '--' : live.speed.toFixed(0);
  c.textAlign = 'left';
  c.fillStyle = UI.cyan;
  c.font = `500 22px ${UI_FONT}`;
  c.fillText('ALT', 34, 100);
  c.fillText('SPD', w / 2 + 14, 100);
  c.fillStyle = UI.white;
  c.font = `600 64px ${UI_FONT}`;
  c.fillText(alt, 34, 160);
  const aw = c.measureText(alt).width;
  c.fillText(spd, w / 2 + 14, 160);
  const sw = c.measureText(spd).width;
  c.fillStyle = UI.cyan;
  c.font = `500 26px ${UI_FONT}`;
  c.fillText(altUnit, 34 + aw + 10, 160);
  c.fillText('m/s', w / 2 + 14 + sw + 10, 160);
  // map: a stylised planet limb with orbit rings behind the altitude curve
  const top = 190, bottom = h - 30, left = 34, right = w - 34;
  c.save();
  c.beginPath(); c.rect(left, top, right - left, bottom - top); c.clip();
  const cx = (left + right) / 2, cy = bottom + (right - left) * 0.9, R = (right - left) * 1.05;
  const planet = c.createRadialGradient(cx, cy - R * 0.2, R * 0.2, cx, cy, R);
  planet.addColorStop(0, '#0e3d5e'); planet.addColorStop(0.9, '#082436'); planet.addColorStop(1, '#4cc3e6');
  c.fillStyle = planet;
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  c.strokeStyle = UI.faint; c.lineWidth = 1.5;
  for (let k = 1; k <= 3; k++) { c.beginPath(); c.ellipse(cx, cy, R + k * 46, R * 0.9 + k * 40, 0, 0, Math.PI * 2); c.stroke(); }
  for (let x = left; x <= right; x += (right - left) / 8) { c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); }
  for (let y = top; y <= bottom; y += (bottom - top) / 4) { c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke(); }
  c.restore();
  c.strokeStyle = UI.dim; c.lineWidth = 2;
  c.strokeRect(left, top, right - left, bottom - top);
  const data = live.history;
  if (data.length >= 2) {
    const max = Math.max(...data, 1);
    const px = (i) => left + ((right - left) * i) / (HISTORY - 1);
    const py = (v) => bottom - ((bottom - top - 14) * v) / max - 7;
    c.strokeStyle = 'rgba(126,231,247,.25)'; c.lineWidth = 9; c.lineJoin = 'round';
    c.beginPath(); data.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v)))); c.stroke();
    c.strokeStyle = UI.white; c.lineWidth = 3;
    c.beginPath(); data.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v)))); c.stroke();
    const last = data.length - 1;
    c.strokeStyle = UI.amber; c.lineWidth = 3;
    c.beginPath(); c.arc(px(last), py(data[last]), 10, 0, Math.PI * 2); c.stroke();
    c.fillStyle = UI.amber;
    c.beginPath(); c.arc(px(last), py(data[last]), 4, 0, Math.PI * 2); c.fill();
  } else {
    c.fillStyle = UI.dim;
    c.font = `500 22px ${UI_FONT}`;
    c.textAlign = 'center';
    c.fillText('WAITING FOR DATA', (left + right) / 2, (top + bottom) / 2);
    c.textAlign = 'left';
  }
}

// ---- Steering display (cockpit.userData.setTrajectory) ---------------------------------------------------------------
// STABLE API: flight steering depends on it. Every cockpit redesign must keep setControls and setTrajectory working with the same
// arguments, keep this display large and readable from the default pilot view, and keep the planned line dashed and the predicted line solid.
// Coordinates are screen units 0..1 of the plot area, x to the right and y UP; ship.heading is in radians, 0 = pointing right (+x),
// counter-clockwise positive (pi/2 = pointing up).
const OK_GREEN = '#4ade80';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
function cleanLine(points) {
  const out = [];
  if (Array.isArray(points)) for (const p of points) if (Array.isArray(p) && finite(p[0]) && finite(p[1])) out.push([p[0], p[1]]);
  return out.length > 600 ? out.filter((_, i) => i % Math.ceil(out.length / 600) === 0) : out;
}
function normaliseTrajectory(d) {
  const ship = d.ship && finite(d.ship.x) && finite(d.ship.y) ? { x: d.ship.x, y: d.ship.y, heading: finite(d.ship.heading) ? d.ship.heading : 0 } : null;
  const hint = d.hint && typeof d.hint.text === 'string' ? { text: d.hint.text, level: d.hint.level === 'warn' ? 'warn' : 'ok' } : null;
  const t = { planned: cleanLine(d.planned), predicted: cleanLine(d.predicted), ship, view: d.view === 'top' ? 'top' : 'side', hint };
  let sig = `${t.view}|${hint ? hint.level + hint.text : ''}|${ship ? [ship.x, ship.y, ship.heading].map((v) => v.toFixed(4)).join() : ''}`;
  for (const line of [t.planned, t.predicted]) {
    let acc = line.length;
    line.forEach((p, i) => { acc += (p[0] * 31 + p[1] * 17) * ((i % 7) + 1); });
    sig += `|${acc.toFixed(5)}`;
  }
  t.sig = sig;
  return t;
}
function drawSteering(c, w, h, t, aim = null) {
  uiBackdrop(c, w, h, 'TRAJECTORY', t.view === 'top' ? 'TOP VIEW' : 'SIDE VIEW');
  const left = 34, right = w - 34, top = 78, bottom = h - 110;
  const px = (x) => left + x * (right - left), py = (y) => bottom - y * (bottom - top);
  c.save();
  c.beginPath(); c.rect(left, top, right - left, bottom - top); c.clip();
  c.fillStyle = 'rgba(8,36,54,.55)'; c.fillRect(left, top, right - left, bottom - top);
  c.strokeStyle = UI.faint; c.lineWidth = 1.5;
  for (let k = 1; k < 8; k++) { c.beginPath(); c.moveTo(px(k / 8), top); c.lineTo(px(k / 8), bottom); c.stroke(); }
  for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(left, py(k / 4)); c.lineTo(right, py(k / 4)); c.stroke(); }
  const stroke = (line) => { c.beginPath(); line.forEach((p, i) => (i ? c.lineTo(px(p[0]), py(p[1])) : c.moveTo(px(p[0]), py(p[1])))); c.stroke(); };
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (t.planned.length > 1) { // planned: pale white dashes
    c.setLineDash([16, 11]); c.strokeStyle = 'rgba(238,248,252,.85)'; c.lineWidth = 3.5; c.lineCap = 'butt';
    stroke(t.planned);
    c.setLineDash([]); c.lineCap = 'round';
  }
  if (t.predicted.length > 1) { // predicted: solid, thicker, bright cyan with a soft glow
    c.strokeStyle = 'rgba(126,231,247,.28)'; c.lineWidth = 12; stroke(t.predicted);
    c.strokeStyle = '#7ee7f7'; c.lineWidth = 5.5; stroke(t.predicted);
  }
  if (t.ship) { // ship icon: amber triangle pointing along the heading (y is up on screen, so the angle is negated)
    const x = Math.min(right - 8, Math.max(left + 8, px(t.ship.x))), y = Math.min(bottom - 8, Math.max(top + 8, py(t.ship.y)));
    c.save();
    c.translate(x, y); c.rotate(-t.ship.heading);
    c.beginPath(); c.moveTo(27, 0); c.lineTo(-17, -17); c.lineTo(-9, 0); c.lineTo(-17, 17); c.closePath();
    c.fillStyle = UI.amber; c.fill();
    c.strokeStyle = '#04100f'; c.lineWidth = 3; c.stroke();
    c.restore();
  }
  c.restore();
  c.strokeStyle = UI.dim; c.lineWidth = 2;
  c.strokeRect(left, top, right - left, bottom - top);
  // hint band
  const hint = t.hint, warn = hint?.level === 'warn';
  const col = warn ? UI.amber : OK_GREEN;
  const bandTop = bottom + 14, bandH = h - 20 - bandTop;
  c.fillStyle = warn ? 'rgba(251,191,36,.12)' : 'rgba(74,222,128,.10)';
  c.fillRect(left, bandTop, right - left, bandH);
  c.strokeStyle = hint ? col : UI.dim; c.lineWidth = 2.5;
  c.strokeRect(left, bandTop, right - left, bandH);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (hint?.text) {
    let size = 46;
    c.font = `700 ${size}px ${UI_FONT}`;
    while (size > 24 && c.measureText(hint.text).width > right - left - 30) { size -= 2; c.font = `700 ${size}px ${UI_FONT}`; }
    c.fillStyle = col;
    c.fillText(hint.text, w / 2, bandTop + bandH / 2 + 2);
  }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  if (aim) drawAim(c, aim, { left, right, top, bottom });
}

// ---- Aim overlay (cockpit.userData.setAim): target +, aim circle, accuracy bar, seconds left, title, LOCK READY cue --------
const AIM_EMPTY = { planned: [], predicted: [], ship: null, view: 'side', hint: null, sig: 'empty' };
const unit01 = (v, d) => (finite(v) ? Math.min(1, Math.max(0, v)) : d);
function normaliseAim(d) {
  const pt = (p, dx, dy) => ({ x: unit01(p?.x, dx), y: unit01(p?.y, dy) });
  const a = {
    target: pt(d.target, 0.5, 0.5), aim: pt(d.aim, 0.5, 0.5),
    radius: finite(d.radius) ? Math.min(0.5, Math.max(0.01, d.radius)) : 0.06,
    accuracy: unit01(d.accuracy, 0),
    timeLeft: finite(d.timeLeft) ? Math.max(0, d.timeLeft) : null,
    lockReady: !!d.lockReady,
    label: typeof d.label === 'string' ? d.label.slice(0, 40) : '',
  };
  a.sig = [a.target.x, a.target.y, a.aim.x, a.aim.y, a.radius, a.accuracy].map((v) => v.toFixed(3)).join() +
    `|${a.timeLeft === null ? '-' : Math.ceil(a.timeLeft)}|${a.lockReady}|${a.label}`;
  return a;
}
function drawAim(c, a, { left, right, top, bottom }) {
  const px = (x) => left + x * (right - left), py = (y) => bottom - y * (bottom - top);
  c.save();
  c.beginPath(); c.rect(left, top, right - left, bottom - top); c.clip();
  c.lineCap = 'round';
  // target: crisp white + with a dark outline so it reads over the cyan line
  const tx = px(a.target.x), ty = py(a.target.y), arm = 26;
  c.strokeStyle = '#04100f'; c.lineWidth = 9;
  c.beginPath(); c.moveTo(tx - arm, ty); c.lineTo(tx + arm, ty); c.moveTo(tx, ty - arm); c.lineTo(tx, ty + arm); c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(tx - arm, ty); c.lineTo(tx + arm, ty); c.moveTo(tx, ty - arm); c.lineTo(tx, ty + arm); c.stroke();
  // aim circle (radius in plot-width units so it stays round)
  const ax = px(a.aim.x), ay = py(a.aim.y), r = Math.max(8, a.radius * (right - left));
  c.strokeStyle = '#04100f'; c.lineWidth = 9;
  c.beginPath(); c.arc(ax, ay, r, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = a.lockReady ? OK_GREEN : UI.cyan; c.lineWidth = 4.5;
  c.beginPath(); c.arc(ax, ay, r, 0, Math.PI * 2); c.stroke();
  c.fillStyle = c.strokeStyle; c.beginPath(); c.arc(ax, ay, 4, 0, Math.PI * 2); c.fill();
  // bottom strip inside the plot: accuracy bar and seconds left
  const sh = 46, sy = bottom - sh;
  c.fillStyle = 'rgba(3,10,16,.82)'; c.fillRect(left, sy, right - left, sh);
  c.textBaseline = 'middle'; c.textAlign = 'left';
  c.font = `600 22px ${UI_FONT}`; c.fillStyle = UI.cyan;
  c.fillText('ACCURACY', left + 14, sy + sh / 2);
  const bx = left + 164, bw = right - left - 164 - 150, bh = 16;
  c.fillStyle = UI.faint; c.fillRect(bx, sy + sh / 2 - bh / 2, bw, bh);
  const k = a.accuracy, hue = 40 + 90 * k; // amber (40) to green (130)
  c.fillStyle = `hsl(${hue} 90% 55%)`; c.fillRect(bx, sy + sh / 2 - bh / 2, bw * k, bh);
  c.strokeStyle = UI.dim; c.lineWidth = 2; c.strokeRect(bx, sy + sh / 2 - bh / 2, bw, bh);
  c.textAlign = 'right'; c.font = `700 32px ${UI_FONT}`; c.fillStyle = UI.white;
  if (a.timeLeft !== null) c.fillText(`${Math.ceil(a.timeLeft)} s`, right - 14, sy + sh / 2 + 1);
  // banner across the top of the plot: the title on the left; when guidance can be locked it turns green and shows the cue on the right
  const bh2 = 42;
  c.fillStyle = a.lockReady ? 'rgba(6,52,30,.94)' : 'rgba(3,10,16,.82)'; c.fillRect(left, top, right - left, bh2);
  if (a.lockReady) { c.strokeStyle = OK_GREEN; c.lineWidth = 3; c.strokeRect(left + 1.5, top + 1.5, right - left - 3, bh2 - 3); }
  c.textAlign = 'left'; c.textBaseline = 'middle';
  let size = 22;
  c.font = `600 ${size}px ${UI_FONT}`;
  const room = right - left - 28 - (a.lockReady ? 390 : 0);
  while (size > 14 && c.measureText(a.label).width > room) { size -= 2; c.font = `600 ${size}px ${UI_FONT}`; }
  c.fillStyle = UI.cyan;
  if (a.label) c.fillText(a.label, left + 14, top + bh2 / 2 + 1);
  if (a.lockReady) {
    c.textAlign = 'right'; c.font = `700 30px ${UI_FONT}`; c.fillStyle = OK_GREEN;
    c.fillText('LOCK READY \u00b7 SPACE', right - 14, top + bh2 / 2 + 2);
  }
  c.restore();
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}

function drawBars(c, w, h) {
  const maxQ = live.maxQ ?? MAXQ_PA;
  const g = live.gForce;
  const q = live.q;
  uiBackdrop(c, w, h, 'LOADS', 'STRUCTURE');
  gauge(c, w, 112, 'G-FORCE', g === null ? '--' : g.toFixed(1), 'g', 'LIMIT 9', g === null ? null : clamp01(g / 9), g === null ? null : clamp01(g / 9), 4.5 / 9, 7 / 9);
  const qf = q === null ? null : clamp01(q / maxQ / 1.25);
  gauge(c, w, 112 + (h - 112) / 2, 'MAX-Q', q === null ? '--' : (q / 1000).toFixed(1), 'kPa', `LIMIT ${(maxQ / 1000).toFixed(0)}`, qf, qf, 0.8 / 1.25, 1 / 1.25);
}

// Everything heavy (canvas textures, merged geometry, materials) is built once; each createCockpit() clones the group, which
// shares them. Flight makes a new cockpit on every LAUNCH, ORBIT and ENTRY, so this keeps those frames short.
let cockpitTemplate = null;
export function warmCockpit() {
  cockpitTemplate ??= buildCockpitTemplate();
  return cockpitTemplate;
}

// Uploads the shared textures and geometry and compiles the shaders by drawing the cockpit once into a tiny target, so
// the first real frame after LAUNCH or ORBIT has nothing left to upload. Runs in idle time after boot.
let cockpitUploaded = false;
export function uploadCockpit() {
  if (cockpitUploaded) return;
  const renderer = getRenderer();
  if (!renderer) return;
  cockpitUploaded = true;
  const probe = createCockpit();
  const scene = new THREE.Scene();
  scene.add(probe);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 20);
  const target = new THREE.WebGLRenderTarget(32, 32);
  const lookDirs = [[0, 0, -1], [0, -1, -0.2], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 1, 0]]; // every part gets drawn once
  const previous = renderer.getRenderTarget();
  try {
    for (const d of lookDirs) {
      camera.lookAt(d[0], d[1], d[2]);
      camera.updateMatrixWorld();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
  }
}
if (typeof window !== 'undefined') { // build, then upload, in idle time soon after boot, long before the first LAUNCH
  const idle = (fn) => (window.requestIdleCallback ?? setTimeout)(fn);
  setTimeout(() => idle(() => {
    try { warmCockpit(); } catch (err) { console.error('[cockpit] warm failed', err); return; }
    setTimeout(() => idle(() => { try { uploadCockpit(); } catch (err) { console.error('[cockpit] upload failed', err); } }), 300);
  }), 1500);
}

/** Seated cockpit. The group's origin is the pilot's eye and forward is -Z. Add it under the camera's parent. */
export function createCockpit() {
  const t = warmCockpit();
  const group = t.group.clone(true); // shares geometry, materials and textures with the template
  const ctl = t.bind(group);
  // STABLE API (flight depends on it; every cockpit redesign must keep these arguments working):
  group.userData.setControls = ctl.setControls; // ({ pitch -1..1, yaw -1..1, throttle 0..1, cutoff, brake, assist: booleans }), smoothed; omitted keys keep their value
  group.userData.setButton = ctl.setButton; // (id, 'off' | 'amber' | 'green' | 'red'), id with or without 'btn:'
  group.userData.press = ctl.press; // (id), short press-in animation
  // setTrajectory({ planned, predicted, ship, view, hint }) or null: see drawSteering above. The canvas and texture are per instance
  // (the template's screens are shared), made on the first call, redrawn only when the data changed and at most 10 times a second.
  let traj = null, trajSig = '', trajDirty = false, trajMesh = null, trajAt = 0;
  let aim = null, aimSig = '';
  const centre = group.getObjectByName('centreDisplay');
  const syncDisplay = () => { // the steering canvas shows while there is a trajectory or an aim; otherwise the telemetry plot returns
    const on = !!(traj || aim);
    if (trajMesh) trajMesh.visible = on;
    if (centre) centre.visible = !on;
  };
  const ensureMesh = () => {
    if (trajMesh || !centre) return;
    trajMesh = screen(0.6, 0.38, (c, w, h) => drawSteering(c, w, h, traj ?? AIM_EMPTY, aim), 1.2, 768);
    trajMesh.position.copy(centre.position);
    centre.parent.add(trajMesh);
    trajAt = performance.now();
  };
  group.userData.setTrajectory = (data) => {
    if (data == null) {
      traj = null; trajSig = '';
      if (aim) trajDirty = true; else trajDirty = false;
      syncDisplay();
      return;
    }
    const next = normaliseTrajectory(data);
    const first = !trajMesh;
    traj = next; // set before ensureMesh(): the first draw happens inside it and must already show this data
    ensureMesh();
    if (!first && next.sig !== trajSig) trajDirty = true;
    trajSig = next.sig;
    syncDisplay();
  };
  // setAim({ target: {x,y}, aim: {x,y}, radius, accuracy 0..1, timeLeft (s), lockReady, label }) or null. Units 0..1 of the plot area, y UP.
  // Drawn on top of the trajectory plot (or on an empty plot when no trajectory is set); same per-instance canvas, redraw only on change, at most 10 a second.
  group.userData.setAim = (data) => {
    if (data == null) {
      if (aim) trajDirty = !!traj;
      aim = null; aimSig = '';
      if (trajMesh && traj) trajMesh.userData.redraw(); // drop the overlay at once
      syncDisplay();
      return;
    }
    const next = normaliseAim(data);
    const first = !trajMesh;
    aim = next; // set before ensureMesh(), as in setTrajectory
    ensureMesh();
    if (!first && next.sig !== aimSig) trajDirty = true;
    aimSig = next.sig;
    syncDisplay();
  };
  const blinkers = [];
  group.traverse((o) => { if (o.name === 'blinker') blinkers.push(o); });
  const cabinLight = group.getObjectByName('cabinLight'), alarmLight = group.getObjectByName('alarmLight');
  const { liveScreens } = t;
  let alarm = false;
  group.userData.setAlarm = (on) => { alarm = on; };
  let drawnVersion = -1, drawnAt = 0, lastFrame = performance.now();
  group.userData.onFrame = () => {
    const tm = sharedUniforms.uTime.value;
    const now = performance.now();
    if (trajMesh && (trajMesh.visible !== !!(traj || aim) || (centre && centre.visible === !!(traj || aim)))) syncDisplay(); // flight's showModel() can re-show every mesh
    ctl.update((now - lastFrame) / 1000);
    lastFrame = now;
    if (live.version !== drawnVersion && now - drawnAt >= 250) { // at most 4 redraws a second, only when the data changed
      drawnVersion = live.version;
      drawnAt = now;
      liveScreens.forEach((m) => { if (!((traj || aim) && m.name === 'centreDisplay')) m.userData.redraw(); }); // the hidden telemetry plot is skipped
    }
    if ((traj || aim) && trajMesh && trajDirty && now - trajAt >= 100) { // steering display: at most 10 redraws a second
      trajDirty = false;
      trajAt = now;
      trajMesh.userData.redraw();
    }
    blinkers.forEach((lamp, i) => { lamp.visible = Math.sin(tm * (1.3 + i * 0.37) + i) > -0.3; });
    alarmLight.intensity = alarm ? 3 * (0.5 + 0.5 * Math.sign(Math.sin(tm * 5))) : 0;
    cabinLight.intensity = alarm ? 0.35 : 2.6;
  };
  return group;
}

function buildCockpitTemplate() {
  const group = new THREE.Group();
  group.name = 'cockpit';
  const shell = pbr(0x20252b, 0.62, 0.35);
  const panel = pbr(0x14181d, 0.48, 0.5);
  const trim = pbr(0x5b636d, 0.38, 0.85);
  const matte = pbr(0x0f1317, 0.95, 0.05, { envMapIntensity: 0.1 }); // under the HUD text: sun must not wash it out

  // Everything below the window sits under the default view (about -38 degrees and lower): look down to read it.
  group.add(box(2.1, 0.6, 0.48, matte, 0, -0.77, -1.19, 0.05)); // dash hood under the glare shield
  group.add(box(2.1, 0.3, 0.9, panel, 0, -1.3, -0.85, 0.05)); // footwell, so looking down never shows a void
  group.add(box(2.1, 0.07, 0.56, matte, 0, -0.44, -1.07, 0.03)); // glare shield, its top is the window sill
  [-1.08, 1.08].forEach((x) => group.add(box(0.22, 1.9, 2.4, shell, x, -0.05, -0.55, 0.06)));
  // Two-tone cabin: light padded ceiling and rear wall, dark everything under the window (the HTML HUD sits over it).
  const lightShell = pbr(0x6a7078, 0.7, 0.05, { envMapIntensity: 0.15 });
  group.add(box(2.4, 0.2, 2.2, lightShell, 0, 0.94, -0.65, 0.06)); // overhead
  group.add(box(2.4, 2.2, 0.15, lightShell, 0, -0.05, 0.75, 0.05)); // rear bulkhead

  // One panoramic window in a soft, curved, padded surround (no bars, no hard square cut).
  group.add(buildWindow({
    plateMat: pbr(0x161a1f, 0.8, 0.1, { envMapIntensity: 0.1 }),
    padMat: pbr(0x757b83, 0.75, 0.05, { envMapIntensity: 0.15 }),
    revealMat: pbr(0x2b3036, 0.8, 0.1, { envMapIntensity: 0.1 }),
    sealMat: pbr(0x050607, 0.9, 0.0, { envMapIntensity: 0.05 }),
  }));

  // Glass cockpit: one black-glass panel with three displays, tilted towards the pilot, under the glare shield.
  const dash = new THREE.Group();
  dash.name = 'dash';
  dash.position.set(DASH.x, DASH.y, DASH.z);
  dash.rotation.x = -DASH.tilt;
  group.add(dash);
  dash.add(box(1.92, 0.66, 0.3, matte, 0, -0.08, -0.17, 0.04)); // housing behind the glass
  dash.add(box(1.84, 0.52, 0.03, pbr(0x1b2128, 0.4, 0.7, { envMapIntensity: 0.4 }), 0, 0, -0.012, 0.03)); // bezel
  const blackGlass = pbr(0x020407, 0.1, 0.5, { envMapIntensity: 0.7 });
  dash.add(box(1.78, 0.46, 0.02, blackGlass, 0, 0, 0.0, 0.025));
  const screens = [
    [screen(0.52, 0.38, drawReadout, 1.2, 768), -0.57],
    [screen(0.6, 0.38, drawTrajectory, 1.2, 768), 0],
    [screen(0.52, 0.38, drawBars, 1.2, 768), 0.57],
  ];
  const liveScreens = screens.map(([mesh]) => mesh);
  screens[1][0].name = 'centreDisplay'; // setTrajectory swaps this one for a per-instance steering display
  if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1') window.__cockpitCanvases = liveScreens.map((m) => m.userData.canvas); // for tests
  for (const [mesh, x] of screens) {
    mesh.position.set(x, 0, 0.0115);
    dash.add(mesh);
  }
  const reflection = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 0.46), new THREE.MeshBasicMaterial({ map: reflectionTexture(), transparent: true, depthWrite: false }));
  reflection.position.z = 0.013;
  dash.add(reflection);

  // Recessed dark switch panels on both side walls, with small lamps sitting flush in a grid.
  const lamps = [glow('#22d3ee', 2.4), glow('#fbbf24', 2.4), glow('#34d399', 2.2), glow('#f87171', 2.6)];
  const blinkers = [];
  const button = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  // Seat, suited body, controllers, pedestal, consoles, floor and lower walls (cockpitParts.js).
  const low = typeof location !== 'undefined' && new URLSearchParams(location.search).get('q') === 'low';
  let interior;
  try {
    interior = buildCockpitInterior({ pbr, glow, matte, trim, panel, shell, low });
  } catch (err) { // the seat and controls are decoration: never let them stop a state from starting
    console.error('[cockpit] interior failed', err);
    interior = { group: new THREE.Group(), blinkers: [], bind: () => ({ setControls() {}, setButton() { return false; }, press() { return false; }, update() {} }) };
  }
  group.add(interior.group);
  group.userData.triangles = interior.group.userData.triangles;
  blinkers.push(...interior.blinkers);
  const darkPanel = pbr(0x090c0f, 0.9, 0.1, { envMapIntensity: 0.05 });
  [-1, 1].forEach((side) => {
    group.add(box(0.012, 0.3, 0.9, pbr(0x1b2026, 0.9, 0.1, { envMapIntensity: 0.1 }), side * 0.964, -0.71, -0.79, 0.004)); // bezel
    group.add(box(0.014, 0.27, 0.87, darkPanel, side * 0.96, -0.71, -0.79, 0.003)); // the recessed panel
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 9; col++) {
        const seed = (row * 7 + col * 3 + (side > 0 ? 5 : 0)) % 11;
        if (seed === 2) continue;
        const material = seed < 7 ? lamps[0] : lamps[1 + (seed % 3)];
        const lamp = new THREE.Mesh(button, material.clone());
        lamp.position.set(side * 0.951, -0.65 - row * 0.06, -1.15 + col * 0.09);
        group.add(lamp);
        if (seed === 5 || seed === 9) blinkers.push(lamp);
      }
    }
  });

  const hoodZ = -0.95;
  for (let i = 0; i < 12; i++) {
    const lamp = new THREE.Mesh(button, lamps[(i * 5) % 3].clone());
    lamp.position.set(-0.55 + i * 0.1, 0.835, -0.95);
    group.add(lamp);
  }

  const cabinLight = new THREE.PointLight(0xfff0e2, 2.6, 5, 1.6);
  cabinLight.position.set(0, 0.45, 0.05);
  const screenLight = new THREE.PointLight(0x67e8f9, 0.22, 2.0, 2);
  screenLight.position.set(0, -0.6, -0.6);
  const alarmLight = new THREE.PointLight(0xff2a1f, 0, 5, 2);
  alarmLight.position.set(0, 0.75, -0.4);
  cabinLight.name = 'cabinLight';
  alarmLight.name = 'alarmLight';
  group.add(cabinLight, screenLight, alarmLight);

  blinkers.forEach((m) => { m.name = 'blinker'; });
  return { group, liveScreens, bind: interior.bind };
}


// ---- Cabin -----------------------------------------------------------------------------------------------------

const W = 4, L = 8, H = 2.6, WALL_H = 2.15; // the walls stop where the 45 degree chamfer to the ceiling begins
const MONO = '"IBM Plex Mono", monospace';

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function canvasTexture(canvas, { srgb = true, repeat = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function stencil(c, text, x, y, size, color) {
  c.textAlign = 'center';
  c.font = `700 ${size}px ${MONO}`;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(text, x, y);
}

/**
 * Riveted wall panels, 256 px per metre, with a matching bump map. Labels are { text, x, y, size } in metres from the
 * top-left, so each one lands next to the station it names.
 */
function panelTextures(wm, hm, labels = []) {
  const ppm = 256, rnd = seeded(wm * 31 + hm * 7);
  const w = Math.round(wm * ppm), h = Math.round(hm * ppm);
  const color = makeCanvas(w, h), bump = makeCanvas(w, h);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  b.fillStyle = '#808080';
  b.fillRect(0, 0, w, h);
  const cols = Math.round(wm), rows = Math.max(1, Math.round(hm / 1.075));
  const pw = w / cols, ph = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const tone = 128 + rnd() * 12;
      c.fillStyle = `rgb(${tone - 2}, ${tone}, ${tone + 8})`;
      c.fillRect(i * pw, j * ph, pw, ph);
      // Grime builds up toward the floor.
      const grime = c.createLinearGradient(0, j * ph, 0, (j + 1) * ph);
      grime.addColorStop(0, 'rgba(20,24,30,0)');
      grime.addColorStop(1, `rgba(20,24,30,${j === rows - 1 ? 0.32 : 0.12})`);
      c.fillStyle = grime;
      c.fillRect(i * pw, j * ph, pw, ph);
    }
  }
  c.lineWidth = 5;
  b.lineWidth = 7;
  for (let i = 0; i <= cols; i++) {
    c.strokeStyle = '#242a31'; b.strokeStyle = '#1c1c1c';
    c.beginPath(); c.moveTo(i * pw, 0); c.lineTo(i * pw, h); c.stroke();
    b.beginPath(); b.moveTo(i * pw, 0); b.lineTo(i * pw, h); b.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    c.beginPath(); c.moveTo(0, j * ph); c.lineTo(w, j * ph); c.stroke();
    b.beginPath(); b.moveTo(0, j * ph); b.lineTo(w, j * ph); b.stroke();
  }
  // Rivets along every seam, and a few scratches so the paint isn't perfect.
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      for (let k = 0; k < 8; k++) {
        for (const [x, y] of [[i * pw + 14 + k * (pw - 28) / 7, j * ph + 14], [i * pw + 14 + k * (pw - 28) / 7, (j + 1) * ph - 14]]) {
          c.fillStyle = '#3a424b'; c.beginPath(); c.arc(x, y, 4.5, 0, 6.3); c.fill();
          c.fillStyle = 'rgba(255,255,255,.28)'; c.beginPath(); c.arc(x - 1, y - 1, 2, 0, 6.3); c.fill();
          b.fillStyle = '#e6e6e6'; b.beginPath(); b.arc(x, y, 5, 0, 6.3); b.fill();
        }
      }
    }
  }
  for (let k = 0; k < w / 24; k++) {
    const x = rnd() * w, y = rnd() * h, len = 20 + rnd() * 70, a = rnd() * 6.3;
    c.strokeStyle = 'rgba(210,220,230,.10)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
    b.strokeStyle = 'rgba(40,40,40,.5)'; b.lineWidth = 2;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); b.stroke();
  }
  for (const { text, x, y, size } of labels) {
    stencil(c, text, x * ppm, y * ppm, size, 'rgba(226,212,170,.82)');
    stencil(b, text, x * ppm, y * ppm, size, '#505050');
  }
  return { map: canvasTexture(color), bump: canvasTexture(bump, { srgb: false }) };
}

// A darker, plainer tile for the ceiling and chamfers: one tile is 2 m.
function hullTexture() {
  const canvas = makeCanvas(512, 512), c = canvas.getContext('2d');
  c.fillStyle = '#69737f';
  c.fillRect(0, 0, 512, 512);
  c.strokeStyle = '#242a31';
  c.lineWidth = 5;
  c.strokeRect(0, 0, 512, 512);
  c.beginPath(); c.moveTo(256, 0); c.lineTo(256, 512); c.stroke();
  c.fillStyle = '#343b43';
  for (let i = 0; i < 16; i++) for (const y of [14, 498]) { c.beginPath(); c.arc(14 + i * 32, y, 4, 0, 6.3); c.fill(); }
  return canvasTexture(canvas, { repeat: true });
}

// Non-slip deck plate: a grid of punched slots. One tile is 1 m.
function gratingTextures() {
  const color = makeCanvas(512, 512), bump = makeCanvas(512, 512);
  const c = color.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = '#3b4249'; c.fillRect(0, 0, 512, 512);
  b.fillStyle = '#b0b0b0'; b.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      c.fillStyle = '#272c32'; c.beginPath(); c.roundRect(i * 32 + 5, j * 32 + 7, 22, 18, 7); c.fill();
      b.fillStyle = '#707070'; b.beginPath(); b.roundRect(i * 32 + 5, j * 32 + 7, 22, 18, 7); b.fill();
    }
  }
  return { map: canvasTexture(color, { repeat: true }), bump: canvasTexture(bump, { srgb: false, repeat: true }) };
}

function hazardTexture() {
  const canvas = makeCanvas(512, 256), c = canvas.getContext('2d');
  c.fillStyle = '#15171a'; c.fillRect(0, 0, 512, 256);
  c.fillStyle = '#d9a91c';
  for (let x = -256; x < 512 + 256; x += 64) {
    c.beginPath(); c.moveTo(x, 256); c.lineTo(x + 32, 256); c.lineTo(x + 32 + 256, 0); c.lineTo(x + 256, 0); c.fill();
  }
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 3;
  for (let k = 0; k < 40; k++) { c.beginPath(); c.moveTo(Math.random() * 512, Math.random() * 256); c.lineTo(Math.random() * 512, Math.random() * 256); c.stroke(); }
  return canvasTexture(canvas);
}

// A soft gradient used as an alpha map: fake ambient occlusion where surfaces meet.
function occlusionTexture() {
  const canvas = makeCanvas(4, 64), c = canvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#9a9a9a'); g.addColorStop(0.35, '#4a4a4a'); g.addColorStop(1, '#000');
  c.fillStyle = g; c.fillRect(0, 0, 4, 64);
  return canvasTexture(canvas, { srgb: false });
}

function drawWave(c, w, h) {
  c.strokeStyle = 'rgba(103,232,249,.2)'; c.lineWidth = 1;
  for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.strokeStyle = '#34d399'; c.lineWidth = 4;
  c.beginPath();
  for (let x = 0; x <= w; x += 4) {
    const k = x / w, y = h / 2 + Math.sin(k * 38) * Math.sin(k * 5 + 1) * h * 0.3 * (0.4 + Math.sin(k * 9) ** 2);
    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
}

function drawLink(c, w, h) {
  c.font = `700 40px ${MONO}`; c.textBaseline = 'top';
  c.fillStyle = CYAN; c.fillText('EARTH LINK', 24, 18);
  c.font = `500 30px ${MONO}`;
  c.fillStyle = AMBER; c.fillText('DELAY 08:32', 24, 82);
  c.fillStyle = CYAN;
  c.fillText('SIGNAL', 24, 134);
  for (let i = 0; i < 8; i++) { c.globalAlpha = i < 5 ? 1 : 0.25; c.fillRect(190 + i * 30, 138, 22, 26); }
  c.globalAlpha = 1;
  c.fillText('MSG QUEUE  03', 24, 190);
  c.fillStyle = 'rgba(103,232,249,.5)'; c.fillText('> _', 24, h - 52);
}

function drawKeys(c, w, h) {
  c.fillStyle = '#10161a'; c.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) {
    c.fillStyle = (k + r) % 5 === 0 ? '#7a8590' : '#4b545d';
    c.fillRect(10 + k * 35.5, 10 + r * 24, 31, 19);
  }
}

function drawGauge(c, w, h) {
  c.strokeStyle = 'rgba(52,211,153,.25)'; c.lineWidth = 14;
  c.beginPath(); c.arc(w / 2, h * 0.92, h * 0.7, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
  c.strokeStyle = '#34d399';
  c.beginPath(); c.arc(w / 2, h * 0.92, h * 0.7, Math.PI * 1.1, Math.PI * 1.78); c.stroke();
  c.font = `700 52px ${MONO}`; c.fillStyle = '#34d399'; c.textAlign = 'center';
  c.fillText('O2 92%', w / 2, h * 0.74);
}

function drawWater(c, w, h) {
  c.font = `700 36px ${MONO}`; c.textBaseline = 'top'; c.fillStyle = '#7dd3fc';
  c.fillText('H2O  94%', 22, 16);
  c.fillStyle = 'rgba(125,211,252,.2)'; c.fillRect(22, 74, w - 44, 28);
  c.fillStyle = '#7dd3fc'; c.fillRect(22, 74, (w - 44) * 0.94, 28);
  c.font = `500 28px ${MONO}`; c.fillStyle = AMBER;
  c.fillText('RECYCLE  CYCLE 3', 22, 128);
  c.fillStyle = CYAN; c.fillText('FILTER OK', 22, h - 50);
}

function drawAirlockSign(c, w, h) {
  c.font = `700 56px ${MONO}`; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillStyle = '#f87171'; c.fillText('AIRLOCK', w / 2, h * 0.36);
  c.font = `500 34px ${MONO}`; c.fillStyle = AMBER; c.fillText('PRESSURE  1.01 BAR', w / 2, h * 0.74);
}

function drawBikeStats(c, w, h) {
  c.font = `700 70px ${MONO}`; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillStyle = AMBER; c.fillText('82', w * 0.3, h * 0.45);
  c.fillStyle = CYAN; c.fillText('16.4', w * 0.7, h * 0.45);
  c.font = `500 28px ${MONO}`; c.fillText('RPM            KM', w / 2, h * 0.82);
}

const POUCHES = [['STEW', '#b45309'], ['OATS', '#a16207'], ['COFFEE', '#44403c'], ['RICE', '#0f766e'], ['CURRY', '#c2410c'], ['APPLE', '#65a30d']];

// One atlas of pouch labels; each pouch picks a cell through its UVs, so every label shares a material.
function pouchAtlas() {
  const canvas = makeCanvas(768, 512), c = canvas.getContext('2d');
  POUCHES.forEach(([name, color], i) => {
    const x = (i % 3) * 256, y = Math.floor(i / 3) * 256;
    c.fillStyle = '#e9e4d6'; c.fillRect(x, y, 256, 256);
    c.fillStyle = color; c.fillRect(x, y, 256, 96);
    c.fillStyle = '#16181b'; c.font = `700 46px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(name, x + 128, y + 160);
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x + 40, y + 206, 176, 8);
  });
  return canvasTexture(canvas);
}

// A small framed photo: simple silhouettes of two adults and a child at sunset, nobody identifiable.
function familyPhotoTexture() {
  const canvas = makeCanvas(256, 320), c = canvas.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, 320);
  sky.addColorStop(0, '#3f5f86'); sky.addColorStop(0.55, '#f0a35e'); sky.addColorStop(1, '#8a4a2e');
  c.fillStyle = sky; c.fillRect(0, 0, 256, 320);
  c.fillStyle = '#fde9b0'; c.beginPath(); c.arc(190, 150, 24, 0, 6.3); c.fill();
  c.fillStyle = '#4a3326'; c.beginPath(); c.moveTo(0, 230); c.quadraticCurveTo(80, 190, 150, 225); c.quadraticCurveTo(210, 245, 256, 215); c.lineTo(256, 320); c.lineTo(0, 320); c.fill();
  c.fillStyle = '#1c1613';
  const person = (x, base, height, width) => {
    c.beginPath(); c.arc(x, base - height, width * 0.34, 0, 6.3); c.fill();
    c.beginPath(); c.roundRect(x - width / 2, base - height * 0.82, width, height * 0.82, width * 0.3); c.fill();
  };
  person(86, 300, 118, 52); person(150, 300, 124, 56); person(118, 300, 66, 34);
  return canvasTexture(canvas);
}

// A quad from four corners and their UVs, wound so it faces the middle of the room.
function quad(corners, uvs) {
  const v = corners.map((p) => new THREE.Vector3(...p));
  const normal = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).normalize();
  const toRoom = new THREE.Vector3(0, 1.3, 0).sub(v[0].clone().add(v[2]).multiplyScalar(0.5));
  const flip = normal.dot(toRoom) < 0;
  if (flip) normal.negate();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((p) => p.toArray()), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(v.flatMap(() => normal.toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  return g;
}

const cyl = (radius, height, material, x, y, z, axis = 'y', seg = 20) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, seg), material);
  mesh.position.set(x, y, z);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
};

const sphere = (radius, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
};

const torus = (radius, tube, material, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 40), material);
  mesh.position.set(x, y, z);
  return mesh;
};

const rod = (a, b, radius, material) => {
  const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, p0.distanceTo(p1), 10), material);
  mesh.position.copy(p0).add(p1).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.sub(p0).normalize());
  return mesh;
};

const place = (mesh, rx = 0, ry = 0, rz = 0) => { mesh.rotation.set(rx, ry, rz); return mesh; };

/** Merges every static mesh into one mesh per material, so a detailed cabin costs a few dozen draw calls. */
function bake(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const meshes = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.dynamic) return;
    meshes.push(o);
    // Rounded boxes come indexed or not depending on the three.js version, and a merge needs them all alike.
    const source = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const geometry = source.applyMatrix4(o.matrixWorld);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geometry);
  });
  meshes.forEach((o) => { o.geometry.dispose(); o.removeFromParent(); });
  for (const [material, geometries] of buckets) {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = material.transparent ? 1 : 0;
    group.add(mesh);
  }
}

/**
 * Walkable cabin, 4 m wide and 8 m long. The origin is the middle of the floor, +Y up, pilot seat at -Z, airlock at +Z.
 * Station positions are in group.userData.stations, ready for registerInteractable(). Crew-life props are in
 * group.userData.props. setAlarm(true) dims the warm lights and pulses a red one.
 */
export function createCabin() {
  const group = new THREE.Group();
  group.name = 'cabin';
  const b = (w, h, d, material, x, y, z, r = 0) => box(w, h, d, material, x, y, z, r);

  // Lit materials are cached by colour so the baked cabin keeps one mesh per colour.
  const litCache = new Map();
  const lit = (color, power = 2) => {
    const key = `${color}:${power}`;
    if (!litCache.has(key)) litCache.set(key, glow(color, power));
    return litCache.get(key);
  };
  const pulsing = (color, power) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), glow(color, power));
    mesh.userData.dynamic = true;
    return mesh;
  };

  const M = {
    dark: pbr(0x1d2126, 0.5, 0.5),
    panel: pbr(0x3a424b, 0.45, 0.6),
    rib: pbr(0x535b64, 0.45, 0.7),
    metal: pbr(0x9aa3ab, 0.3, 0.9),
    fabric: pbr(0x44566a, 0.9, 0),
    orange: pbr(0xc4622c, 0.55, 0.2),
    green: pbr(0x2f7d55, 0.4, 0.5),
    hose: pbr(0xd9c24a, 0.6, 0.1),
    cream: pbr(0xd8cdb6, 0.85, 0),
    blanket: pbr(0x93463a, 0.95, 0),
    curtain: pbr(0x6d5f7e, 0.95, 0, { side: THREE.DoubleSide }),
    wood: pbr(0x7b5a3e, 0.7, 0.05),
    copper: pbr(0xb4713f, 0.35, 0.9),
    suit: pbr(0xe4e2dc, 0.7, 0.05),
    gold: pbr(0xd9a521, 0.15, 1),
    cabinet: pbr(0x59656f, 0.5, 0.45),
    leaf: pbr(0x4f9a4a, 0.7, 0),
    noteY: pbr(0xf2e27a, 0.9, 0),
    notePink: pbr(0xf0a0b0, 0.9, 0),
    glass: new THREE.MeshStandardMaterial({ color: 0xbcd6e8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, envMap: interiorEnvironment(), envMapIntensity: 0.12, depthWrite: false }),
  };
  const foil = [pbr(0xb8bec6, 0.35, 0.8), pbr(0xc4622c, 0.45, 0.4), pbr(0x6d8a55, 0.5, 0.3)];

  // Shell: floor, walls, chamfers and ceiling, each facing into the room.
  const side = panelTextures(L, WALL_H, []);
  const left = panelTextures(L, WALL_H, [{ text: 'O2', x: 5.1, y: 0.3, size: 70 }, { text: 'DECK 2', x: 4.3, y: 0.55, size: 56 }]);
  const right = panelTextures(L, WALL_H, [{ text: 'COMMS', x: 2.7, y: 0.28, size: 50 }, { text: 'SAMPLES', x: 4.9, y: 0.5, size: 46 }, { text: 'EVA', x: 7.2, y: 0.45, size: 60 }]);
  const endFront = panelTextures(W, WALL_H, [{ text: 'FLIGHT DECK', x: 2, y: 0.28, size: 54 }]);
  const endBack = panelTextures(W, WALL_H, [{ text: 'HATCH', x: 0.65, y: 0.6, size: 74 }, { text: 'EVA ONLY', x: 3.35, y: 0.6, size: 50 }]);
  const wallMat = (t) => pbr(0xffffff, 0.72, 0.05, { map: t.map, bumpMap: t.bump, bumpScale: 2.2 });
  const grating = gratingTextures();
  const floorMat = pbr(0xffffff, 0.55, 0.55, { map: grating.map, bumpMap: grating.bump, bumpScale: 1 });
  const hull = hullTexture();
  const hullMat = pbr(0xffffff, 0.6, 0.35, { map: hull });
  const hazardMat = pbr(0xffffff, 0.6, 0.1, { map: hazardTexture() });
  const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: occlusionTexture(), transparent: true, depthWrite: false, opacity: 0.85 });

  const hw = W / 2, hl = L / 2, cx = hw - 0.45; // the chamfer runs from the wall top (x = hw) in to x = cx at the ceiling
  const shell = [
    [quad([[-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl]], [[0, 0], [W, 0], [W, L], [0, L]]), floorMat],
    [quad([[-cx, H, -hl], [cx, H, -hl], [cx, H, hl], [-cx, H, hl]], [[0, 0], [cx, 0], [cx, L / 2], [0, L / 2]]), hullMat],
    [quad([[-hw, 0, hl], [-hw, 0, -hl], [-hw, WALL_H, -hl], [-hw, WALL_H, hl]], [[0, 0], [1, 0], [1, 1], [0, 1]]), wallMat(left)],
    [quad([[hw, 0, -hl], [hw, 0, hl], [hw, WALL_H, hl], [hw, WALL_H, -hl]], [[0, 0], [1, 0], [1, 1], [0, 1]]), wallMat(right)],
    [quad([[-hw, 0, -hl], [hw, 0, -hl], [hw, WALL_H, -hl], [-hw, WALL_H, -hl]], [[0, 0], [1, 0], [1, 1], [0, 1]]), wallMat(endFront)],
    [quad([[hw, 0, hl], [-hw, 0, hl], [-hw, WALL_H, hl], [hw, WALL_H, hl]], [[0, 0], [1, 0], [1, 1], [0, 1]]), wallMat(endBack)],
    [quad([[-hw, WALL_H, -hl], [-hw, WALL_H, hl], [-cx, H, hl], [-cx, H, -hl]], [[0, 0], [L / 2, 0], [L / 2, 0.32], [0, 0.32]]), hullMat],
    [quad([[hw, WALL_H, hl], [hw, WALL_H, -hl], [cx, H, -hl], [cx, H, hl]], [[0, 0], [L / 2, 0], [L / 2, 0.32], [0, 0.32]]), hullMat],
    [quad([[-hw, WALL_H, -hl], [hw, WALL_H, -hl], [cx, H, -hl], [-cx, H, -hl]], [[0, 0], [2, 0], [1.8, 0.32], [0.2, 0.32]]), hullMat],
    [quad([[hw, WALL_H, hl], [-hw, WALL_H, hl], [-cx, H, hl], [cx, H, hl]], [[0, 0], [2, 0], [1.8, 0.32], [0.2, 0.32]]), hullMat],
    // Hazard stripes in front of the airlock.
    [quad([[-0.9, 0.004, 3.3], [0.9, 0.004, 3.3], [0.9, 0.004, 3.84], [-0.9, 0.004, 3.84]], [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]), hazardMat],
  ];
  for (const [geometry, material] of shell) group.add(new THREE.Mesh(geometry, material));

  // Fake ambient occlusion: strips that darken wall-to-floor and wall-to-ceiling corners. The V coordinate is 1 at the corner.
  const ao = (corners) => group.add(new THREE.Mesh(quad(corners, [[0, 1], [1, 1], [1, 0], [0, 0]]), aoMat));
  const o = 0.006, aoH = 0.55, aoF = 0.5;
  ao([[-hw + o, 0, hl], [-hw + o, 0, -hl], [-hw + o, aoH, -hl], [-hw + o, aoH, hl]]);
  ao([[hw - o, 0, -hl], [hw - o, 0, hl], [hw - o, aoH, hl], [hw - o, aoH, -hl]]);
  ao([[-hw, 0, -hl + o], [hw, 0, -hl + o], [hw, aoH, -hl + o], [-hw, aoH, -hl + o]]);
  ao([[hw, 0, hl - o], [-hw, 0, hl - o], [-hw, aoH, hl - o], [hw, aoH, hl - o]]);
  ao([[-hw, o, hl], [-hw, o, -hl], [-hw + aoF, o, -hl], [-hw + aoF, o, hl]]);
  ao([[hw, o, -hl], [hw, o, hl], [hw - aoF, o, hl], [hw - aoF, o, -hl]]);
  ao([[-hw, o, -hl], [hw, o, -hl], [hw, o, -hl + aoF], [-hw, o, -hl + aoF]]);
  ao([[hw, o, hl], [-hw, o, hl], [-hw, o, hl - aoF], [hw, o, hl - aoF]]);
  ao([[-hw + o, WALL_H, hl], [-hw + o, WALL_H, -hl], [-hw + o, WALL_H - 0.35, -hl], [-hw + o, WALL_H - 0.35, hl]]);
  ao([[hw - o, WALL_H, -hl], [hw - o, WALL_H, hl], [hw - o, WALL_H - 0.35, hl], [hw - o, WALL_H - 0.35, -hl]]);
  ao([[-cx, H - o, -hl], [-cx, H - o, hl], [-cx + 0.35, H - o, hl], [-cx + 0.35, H - o, -hl]]);
  ao([[cx, H - o, hl], [cx, H - o, -hl], [cx - 0.35, H - o, -hl], [cx - 0.35, H - o, hl]]);

  // Ribs follow the fuselage section: wall post, chamfer brace and ceiling beam.
  for (let z = -hl + 0.8; z < hl; z += 1.6) {
    [-1, 1].forEach((s) => {
      group.add(b(0.1, WALL_H, 0.14, M.rib, s * (hw - 0.05), WALL_H / 2, z));
      group.add(place(b(0.66, 0.09, 0.14, M.rib, s * (hw - 0.225), WALL_H + 0.225, z), 0, 0, s * -Math.PI / 4));
      [1.28, 1.14].forEach((x) => group.add(b(0.1, 0.1, 0.08, M.dark, s * x, H - 0.13, z + 0.1)));
    });
    group.add(b(2 * cx, 0.09, 0.14, M.rib, 0, H - 0.045, z));
  }
  [-1, 1].forEach((s) => {
    group.add(b(0.06, 0.08, L, M.rib, s * (hw - 0.03), 0.04, 0));
    // Ceiling pipes and a cable bundle hugging the chamfers.
    group.add(cyl(0.05, L - 0.1, M.metal, s * 1.28, H - 0.13, 0, 'z'));
    group.add(cyl(0.032, L - 0.1, M.copper, s * 1.14, H - 0.1, 0, 'z'));
  });
  [0xe5484d, 0x3b82f6, 0xf5c542, 0x34d399, 0x111418].forEach((color, i) => {
    group.add(cyl(0.02, L - 0.1, pbr(color, 0.6, 0.1), -1.74 + (i - 2) * 0.026 + 0.03, 2.4 - 0.03 + (i - 2) * 0.026, 0, 'z', 8));
  });
  group.add(cyl(0.05, L - 0.1, M.orange, 1.78, 2.4 - 0.04, 0, 'z'));
  // Handrails between the stations, standing off the wall on small brackets.
  [[-1, -0.6, 0.1], [-1, 2.75, 3.65], [1, -0.55, 0.3], [1, 2.95, 3.65]].forEach(([s, z0, z1]) => {
    group.add(cyl(0.025, z1 - z0, M.metal, s * 1.9, 1.1, (z0 + z1) / 2, 'z', 12));
    [z0 + 0.06, z1 - 0.06].forEach((z) => group.add(b(0.1, 0.04, 0.04, M.dark, s * 1.94, 1.1, z)));
  });

  const stripMat = glow('#fff1dc', 2.4);
  const warm = [];
  [-2.4, -0.8, 0.8, 2.4].forEach((z) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.018, 1.2), stripMat);
    strip.position.set(0, H - 0.012, z);
    group.add(strip);
    group.add(b(0.46, 0.03, 1.32, M.dark, 0, H - 0.03, z));
  });
  [-2.4, 0, 2.4].forEach((z) => {
    const light = new THREE.PointLight(0xffd9b0, 8, 8, 2);
    light.position.set(0, H - 0.3, z);
    warm.push(light);
    group.add(light);
  });
  const alarmLight = new THREE.PointLight(0xff2a1f, 0, 7, 2);
  alarmLight.position.set(0, H - 0.4, 0);
  group.add(alarmLight);

  // Stations: each model is built facing +Z with its back at -Z, then turned to face the aisle.
  const stations = {}, props = {};
  const blinkers = [];
  const addAt = (registry, id, x, z, rotY, build) => {
    const anchor = new THREE.Group();
    anchor.name = `${registry === stations ? 'station' : 'prop'}:${id}`;
    anchor.position.set(x, 0, z);
    anchor.rotation.y = rotY;
    build(anchor);
    group.add(anchor);
    registry[id] = new THREE.Vector3(x, 1.2, z);
    return anchor;
  };
  const facingRoom = { left: Math.PI / 2, right: -Math.PI / 2 };

  addAt(stations, 'pilotSeat', 0, -3.3, Math.PI, (s) => {
    s.add(b(0.7, 0.04, 0.7, M.dark, 0, 0.02, 0));
    s.add(cyl(0.09, 0.3, M.metal, 0, 0.19, 0));
    s.add(b(0.54, 0.1, 0.52, M.fabric, 0, 0.42, 0.02, 0.04));
    s.add(place(b(0.52, 0.72, 0.12, M.fabric, 0, 0.88, -0.26, 0.05), -0.12));
    s.add(place(b(0.2, 0.5, 0.012, M.orange, 0, 0.9, -0.195), -0.12));
    s.add(place(b(0.3, 0.2, 0.1, M.fabric, 0, 1.34, -0.31, 0.05), -0.12));
    [-1, 1].forEach((x) => {
      s.add(b(0.07, 0.05, 0.42, M.dark, x * 0.32, 0.64, -0.02, 0.02));
      s.add(b(0.04, 0.2, 0.04, M.dark, x * 0.32, 0.52, -0.12));
    });
    s.add(cyl(0.014, 0.16, M.metal, 0.32, 0.74, 0.1));
    s.add(sphere(0.03, M.dark, 0.32, 0.84, 0.1));
    s.add(b(1.5, 0.72, 0.26, M.dark, 0, 0.36, 0.57));
    s.add(b(1.5, 0.05, 0.3, M.rib, 0, 0.74, 0.56, 0.015));
    s.add(b(1.44, 0.07, 0.05, M.rib, 0, 0.98, 0.62));
    [[-0.48, 0.46, 0.3, drawReadout], [0, 0.56, 0.34, drawTrajectory], [0.5, 0.46, 0.3, drawBars]].forEach(([x, w, h, draw]) => {
      const mesh = place(screen(w, h, draw), 0, Math.PI, 0);
      mesh.position.set(x, 1.17, 0.59);
      s.add(mesh);
      s.add(b(w + 0.04, h + 0.04, 0.02, M.rib, x, 1.17, 0.61, 0.008));
    });
    const lamps = ['#22d3ee', '#fbbf24', '#34d399', '#f87171'];
    for (let i = 0; i < 14; i++) {
      const lamp = b(0.03, 0.03, 0.012, lit(lamps[i % 4], 2.4), -0.65 + i * 0.1, 0.6, 0.44);
      s.add(lamp);
    }
    [0.28, 0.58].forEach((x, i) => {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.012), glow(i ? '#fbbf24' : '#f87171', 2.8));
      lamp.position.set(x, 0.5, 0.44);
      lamp.userData.dynamic = true;
      blinkers.push(lamp);
      s.add(lamp);
    });
  });

  addAt(stations, 'suitLocker', -1.7, 0.7, facingRoom.left, (s) => {
    s.add(b(0.86, 1.95, 0.012, lit('#ff8a1f', 1.9), 0, 1.07, -0.205));
    s.add(b(1, 2.1, 0.06, M.cabinet, 0, 1.05, -0.245));
    [-1, 1].forEach((x) => s.add(b(0.07, 2.1, 0.55, M.cabinet, x * 0.465, 1.05, 0)));
    s.add(b(1, 0.06, 0.55, M.cabinet, 0, 2.07, 0));
    s.add(b(1, 0.12, 0.55, M.dark, 0, 0.06, 0));
    s.add(b(0.8, 0.02, 0.12, lit('#ffb347', 2), 0, 2.03, 0.16));
    // The suit hangs from its backpack, lit from behind so it reads as a silhouette.
    s.add(b(0.34, 0.46, 0.2, M.suit, 0, 1.36, -0.04, 0.06));
    s.add(b(0.3, 0.42, 0.12, M.panel, 0, 1.38, -0.18, 0.04));
    s.add(b(0.3, 0.14, 0.18, M.suit, 0, 1.08, -0.04, 0.05));
    [-1, 1].forEach((x) => {
      s.add(b(0.13, 0.7, 0.14, M.suit, x * 0.08, 0.68, -0.04, 0.04));
      s.add(b(0.14, 0.1, 0.2, M.dark, x * 0.08, 0.3, 0, 0.03));
      s.add(rod([x * 0.2, 1.52, -0.04], [x * 0.27, 1.08, -0.02], 0.055, M.suit));
      s.add(sphere(0.06, M.dark, x * 0.27, 1.04, -0.02));
    });
    s.add(cyl(0.09, 0.06, M.metal, 0, 1.62, -0.04));
    s.add(sphere(0.17, M.suit, 0, 1.78, -0.04));
    s.add(sphere(0.135, M.gold, 0, 1.78, 0.06, 1, 0.8, 0.6));
    s.add(b(0.88, 1.92, 0.012, M.glass, 0, 1.06, 0.262));
    [[0, 2.03, 0.92, 0.04], [0, 0.1, 0.92, 0.04]].forEach(([x, y, w, h]) => s.add(b(w, h, 0.03, M.metal, x, y, 0.265)));
    [-1, 1].forEach((x) => s.add(b(0.04, 1.96, 0.03, M.metal, x * 0.45, 1.06, 0.265)));
    s.add(b(0.02, 0.22, 0.03, M.metal, 0.38, 1.05, 0.29));
  });

  addAt(stations, 'o2Station', -1.72, -1.1, facingRoom.left, (s) => {
    s.add(b(0.8, 0.22, 0.5, M.dark, 0, 0.11, 0));
    s.add(b(0.8, 1.7, 0.04, M.cabinet, 0, 0.95, -0.23));
    [-1, 0, 1].forEach((i) => {
      const x = i * 0.25;
      s.add(cyl(0.095, 1, M.green, x, 0.72, -0.04, 'y', 24));
      s.add(sphere(0.095, M.green, x, 1.22, -0.04, 1, 0.55, 1));
      s.add(cyl(0.03, 0.08, M.metal, x, 1.3, -0.04));
      s.add(b(0.1, 0.02, 0.02, M.orange, x, 1.36, -0.04));
      s.add(b(0.04, 0.12, 0.02, lit('#34d399', 2.4), x, 0.95, 0.056));
    });
    [0.46, 0.96].forEach((y) => s.add(b(0.78, 0.05, 0.1, M.dark, 0, y, -0.14)));
    s.add(cyl(0.02, 0.5, M.metal, 0, 1.33, -0.1, 'x', 10));
    s.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.25, 1.33, -0.04), new THREE.Vector3(0.38, 1.1, 0.12), new THREE.Vector3(0.34, 0.6, 0.2), new THREE.Vector3(0.4, 0.28, 0.14),
    ]), 24, 0.018, 8), M.hose));
    s.add(cyl(0.035, 0.07, M.dark, 0.4, 0.24, 0.14));
    const gauge = screen(0.26, 0.16, drawGauge);
    gauge.position.set(0, 1.58, -0.205);
    s.add(gauge, b(0.3, 0.2, 0.02, M.rib, 0, 1.58, -0.218, 0.01));
    s.add(b(0.6, 0.025, 0.012, lit('#34d399', 2.5), 0, 1.78, -0.205));
  });

  addAt(stations, 'commsConsole', 1.7, -1.3, facingRoom.right, (s) => {
    s.add(b(1.2, 0.05, 0.55, M.panel, 0, 0.76, 0, 0.015));
    [-1, 1].forEach((x) => s.add(b(0.05, 0.74, 0.5, M.dark, x * 0.575, 0.37, 0)));
    s.add(b(1.1, 0.6, 0.03, M.dark, 0, 0.45, -0.25));
    s.add(b(0.44, 0.2, 0.02, M.rib, 0.3, 0.6, 0.0));
    [[-0.3, 0.2, drawWave], [0.3, -0.2, drawLink]].forEach(([x, ry, draw]) => {
      const mesh = place(screen(0.46, 0.3, draw), 0, ry, 0);
      mesh.position.set(x, 1.06, -0.04);
      s.add(mesh, place(b(0.5, 0.34, 0.04, M.dark, x, 1.06, -0.07, 0.012), 0, ry, 0), b(0.06, 0.2, 0.06, M.dark, x, 0.9, -0.12));
    });
    s.add(b(1.1, 0.28, 0.2, M.dark, 0, 1.5, -0.17, 0.02));
    [-0.35, -0.2, 0.3, 0.45].forEach((x) => s.add(cyl(0.025, 0.03, M.metal, x, 1.5, -0.05, 'z', 14)));
    for (let i = 0; i < 6; i++) s.add(b(0.03, 0.03, 0.012, lit(i % 2 ? '#34d399' : '#fbbf24', 2.4), -0.1 + i * 0.06, 1.5, -0.065));
    s.add(b(0.44, 0.02, 0.16, M.dark, 0, 0.785, 0.15));
    const keys = place(screen(0.42, 0.14, drawKeys, 0.9), -Math.PI / 2, 0, 0);
    keys.position.set(0, 0.797, 0.15);
    s.add(keys);
    // A microphone on a gooseneck, and a mug that has been there all shift.
    s.add(cyl(0.05, 0.02, M.metal, 0.46, 0.8, 0.18));
    s.add(rod([0.46, 0.8, 0.18], [0.4, 1.0, 0.1], 0.008, M.metal));
    s.add(sphere(0.03, M.dark, 0.39, 1.03, 0.09, 1, 1.7, 1));
    s.add(cyl(0.035, 0.09, M.cream, -0.46, 0.835, 0.2, 'y', 16), b(0.012, 0.05, 0.03, M.cream, -0.5, 0.835, 0.2));
    s.add(place(b(0.1, 0.1, 0.004, M.noteY, 0.1, 1.28, -0.255), 0, 0, 0.1), place(b(0.09, 0.09, 0.004, M.notePink, -0.05, 1.18, -0.255), 0, 0, -0.14));
  });

  addAt(stations, 'sampleStorage', 1.72, 0.9, facingRoom.right, (s) => {
    s.add(b(1.1, 0.8, 0.5, M.dark, 0, 0.4, 0, 0.02));
    [0.15, 0.4, 0.65].forEach((y) => {
      s.add(b(1.02, 0.22, 0.02, M.panel, 0, y, 0.255));
      s.add(b(0.3, 0.025, 0.03, M.metal, 0, y + 0.03, 0.28));
      s.add(b(0.03, 0.03, 0.012, lit('#a78bfa', 2.6), 0.46, y, 0.268));
    });
    s.add(b(0.96, 0.05, 0.22, M.dark, 0, 0.825, 0.08));
    s.add(b(1, 0.025, 0.025, lit('#c4b5fd', 2.5), 0, 1.34, -0.18));
    ['#a855f7', '#c084fc', '#7c3aed', '#d8b4fe', '#9333ea'].forEach((color, i) => {
      const x = -0.36 + i * 0.18, fill = 0.07 + (i % 3) * 0.04;
      s.add(cyl(0.03, 0.26, M.glass, x, 0.98, 0.08, 'y', 14));
      s.add(cyl(0.02, fill, lit(color, 1.4), x, 0.86 + fill / 2, 0.08, 'y', 12));
      s.add(cyl(0.033, 0.03, M.dark, x, 1.12, 0.08, 'y', 14));
    });
    s.add(b(0.96, 0.03, 0.03, M.metal, 0, 1.0, 0.18));
  });

  addAt(stations, 'airlock', 0, 3.86, Math.PI, (s) => {
    const hatch = pbr(0x9aa1a8, 0.4, 0.7);
    [-1, 1].forEach((x) => s.add(b(0.16, 2.3, 0.25, M.rib, x * 0.57, 1.15, 0, 0.02)));
    s.add(b(1.3, 0.16, 0.25, M.rib, 0, 2.22, 0, 0.02));
    s.add(b(1.3, 0.06, 0.25, M.dark, 0, 0.03, 0));
    s.add(cyl(0.52, 0.1, hatch, 0, 1.1, 0, 'z', 48));
    s.add(torus(0.5, 0.035, M.orange, 0, 1.1, 0.06));
    s.add(torus(0.34, 0.02, M.metal, 0, 1.1, 0.055));
    s.add(cyl(0.13, 0.06, M.dark, 0, 1.43, 0.06, 'z', 24), cyl(0.1, 0.02, M.glass, 0, 1.43, 0.095, 'z', 24));
    s.add(torus(0.17, 0.02, M.metal, 0, 0.98, 0.1), cyl(0.045, 0.06, M.metal, 0, 0.98, 0.1, 'z', 16));
    [0, 1, 2].forEach((i) => s.add(place(b(0.34, 0.022, 0.022, M.metal, 0, 0.98, 0.1), 0, 0, i * Math.PI / 3)));
    [0.65, 1.55].forEach((y) => s.add(b(0.06, 0.14, 0.05, M.dark, -0.5, y, 0.07)));
    const sign = screen(0.5, 0.14, drawAirlockSign);
    sign.position.set(0, 1.85, 0.131);
    s.add(sign, b(0.54, 0.18, 0.02, M.dark, 0, 1.85, 0.12));
    [['#fbbf24', -1], ['#f87171', 1]].forEach(([color, x]) => {
      const lamp = pulsing(color, 3);
      lamp.position.set(x * 0.57, 1.95, 0.14);
      blinkers.push(lamp);
      s.add(lamp, b(0.1, 0.1, 0.04, M.dark, x * 0.57, 1.95, 0.12));
    });
  });

  addAt(stations, 'bunk', -1.55, -2.75, facingRoom.left, (s) => {
    s.add(b(1.9, 0.26, 0.85, M.dark, 0, 0.13, 0, 0.02));
    s.add(b(1.84, 0.14, 0.8, M.cream, 0, 0.33, 0, 0.05));
    s.add(place(b(0.42, 0.1, 0.34, M.cream, 0.68, 0.45, 0, 0.05), 0, 0.08, 0));
    s.add(b(1.1, 0.09, 0.82, M.blanket, -0.32, 0.43, 0, 0.04), place(b(0.1, 0.12, 0.84, M.blanket, 0.26, 0.45, 0, 0.04), 0, 0, 0.1));
    s.add(b(1.9, 0.06, 0.85, M.dark, 0, 2.0, 0), b(0.2, 0.02, 0.1, lit('#ffd9a0', 2.2), 0.55, 1.96, 0.2));
    s.add(cyl(0.012, 1.9, M.metal, 0, 1.95, 0.43, 'x', 12));
    // A curtain half drawn across the foot of the bunk, folded by a sine along its width.
    const folds = new THREE.PlaneGeometry(1, 1.5, 28, 1);
    const pos = folds.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 36) * 0.035);
    folds.computeVertexNormals();
    const curtain = new THREE.Mesh(folds, M.curtain);
    curtain.position.set(-0.43, 1.2, 0.43);
    s.add(curtain);
    s.add(b(0.5, 0.035, 0.2, M.wood, 0.6, 1.15, -0.325));
    const frame = place(b(0.2, 0.26, 0.02, M.wood, 0.6, 1.29, -0.33, 0.01), -0.12);
    const photo = place(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.21), new THREE.MeshBasicMaterial({ map: familyPhotoTexture(), color: new THREE.Color(0.85, 0.85, 0.85) })), -0.12);
    photo.position.set(0.6, 1.29, -0.318);
    s.add(frame, photo);
  });

  // Crew-life props.
  addAt(props, 'foodRack', 1.72, 2.3, facingRoom.right, (s) => {
    const labels = new THREE.MeshBasicMaterial({ map: pouchAtlas(), color: new THREE.Color(0.8, 0.8, 0.8) });
    s.add(b(1, 1.9, 0.02, M.dark, 0, 0.95, -0.24));
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => s.add(b(0.04, 1.9, 0.04, M.rib, x * 0.48, 0.95, z * 0.22)));
    const rnd = seeded(5);
    [0.3, 0.7, 1.1, 1.5].forEach((y) => {
      s.add(b(1, 0.025, 0.5, M.rib, 0, y, 0));
      s.add(b(1, 0.04, 0.02, M.orange, 0, y + 0.02, 0.255));
      for (let i = 0; i < 6; i++) {
        const x = -0.4 + i * 0.16, tilt = (rnd() - 0.5) * 0.12, cell = Math.floor(rnd() * 6);
        const pouch = place(b(0.13, 0.2, 0.06, foil[Math.floor(rnd() * 3)], x, y + 0.115, 0.05), 0, 0, tilt);
        const label = new THREE.PlaneGeometry(0.115, 0.115);
        const uv = label.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, ((cell % 3) + uv.getX(k)) / 3, 1 - (Math.floor(cell / 3) + 1 - uv.getY(k)) / 2);
        const tag = place(new THREE.Mesh(label, labels), 0, 0, tilt);
        tag.position.set(x, y + 0.115, 0.082);
        s.add(pouch, tag);
      }
    });
    s.add(b(0.26, 0.14, 0.34, M.orange, 0.3, 1.77, 0, 0.02));
  });

  addAt(props, 'waterRecycler', -1.72, 2.2, facingRoom.left, (s) => {
    s.add(b(0.9, 1.1, 0.5, M.cabinet, 0, 0.55, 0, 0.03));
    s.add(cyl(0.2, 0.72, M.glass, -0.15, 1.46, 0, 'y', 24));
    s.add(cyl(0.18, 0.5, lit('#3aa0ff', 0.7), -0.15, 1.37, 0, 'y', 24));
    s.add(cyl(0.21, 0.04, M.dark, -0.15, 1.84, 0, 'y', 24), cyl(0.21, 0.04, M.dark, -0.15, 1.12, 0, 'y', 24));
    const display = screen(0.3, 0.2, drawWater);
    display.position.set(0.17, 0.85, 0.256);
    s.add(display, b(0.34, 0.24, 0.02, M.dark, 0.17, 0.85, 0.248, 0.01));
    s.add(rod([-0.36, 1.1, 0.15], [-0.36, 0.3, 0.27], 0.025, M.copper), rod([-0.36, 0.3, 0.27], [0.1, 0.3, 0.27], 0.025, M.copper), sphere(0.035, M.copper, -0.36, 0.3, 0.27));
    s.add(torus(0.05, 0.012, M.orange, 0.1, 0.3, 0.3), cyl(0.045, 0.02, M.metal, -0.15, 1.9, 0));
    s.add(cyl(0.06, 0.4, M.suit, 0.32, 0.4, 0.28), cyl(0.06, 0.4, M.suit, 0.4, 0.4, 0.24));
    s.add(cyl(0.06, 0.06, M.orange, 0.3, 1.13, 0.0, 'y', 14));
    [[0, 0.16], [0.07, 0.14], [-0.06, 0.13], [0.04, 0.2]].forEach(([dx, h], i) => s.add(place(sphere(0.05, M.leaf, 0.3 + dx, 1.2 + h / 2, (i % 2 - 0.5) * 0.06, 0.6, 1.4, 0.6), 0, 0, dx * 3)));
  });

  addAt(props, 'exerciseBike', 1.45, -3.1, Math.PI, (s) => {
    [-0.4, 0.4].forEach((z) => s.add(b(0.55, 0.04, 0.08, M.dark, 0, 0.02, z)));
    s.add(rod([0, 0.1, -0.4], [0, 0.1, 0.4], 0.03, M.orange));
    s.add(rod([0, 0.1, -0.36], [0, 0.78, -0.3], 0.025, M.metal));
    s.add(b(0.22, 0.06, 0.3, M.dark, 0, 0.82, -0.3, 0.03));
    s.add(rod([0, 0.1, 0.36], [0, 0.98, 0.3], 0.025, M.metal));
    s.add(rod([-0.22, 1, 0.3], [0.22, 1, 0.3], 0.018, M.dark));
    s.add(cyl(0.22, 0.07, M.rib, 0, 0.32, 0.26, 'x', 32), cyl(0.15, 0.08, M.orange, 0, 0.32, 0.26, 'x', 24));
    s.add(cyl(0.03, 0.2, M.metal, 0, 0.3, 0, 'x', 12));
    s.add(rod([0.1, 0.3, 0], [0.1, 0.16, 0], 0.015, M.metal), rod([-0.1, 0.3, 0], [-0.1, 0.44, 0], 0.015, M.metal));
    s.add(b(0.1, 0.025, 0.06, M.dark, 0.15, 0.16, 0), b(0.1, 0.025, 0.06, M.dark, -0.15, 0.44, 0));
    const stats = place(screen(0.2, 0.12, drawBikeStats), 0, Math.PI, 0);
    stats.position.set(0, 1.07, 0.27);
    s.add(stats, b(0.23, 0.15, 0.02, M.dark, 0, 1.07, 0.285, 0.008));
  });
  // The photo's world position: on the bunk shelf, local (0.6, 1.2, -0.33) of the bunk anchor.
  props.familyPhoto = group.getObjectByName('station:bunk').localToWorld(new THREE.Vector3(0.6, 1.2, -0.33));

  bake(group);

  // Fixed meshes are merged, so only the dimmable and blinking lamps stay live.
  let alarm = false;
  group.userData.stations = stations;
  group.userData.props = props;
  group.userData.setAlarm = (on) => { alarm = on; };
  group.userData.onFrame = () => {
    const t = sharedUniforms.uTime.value;
    blinkers.forEach((lamp, i) => { lamp.visible = Math.sin(t * (1.1 + i * 0.43) + i * 2) > -0.35; });
    const pulse = 0.5 + 0.5 * Math.sign(Math.sin(t * 5));
    alarmLight.intensity = alarm ? 9 * pulse : 0;
    warm.forEach((light) => { light.intensity = alarm ? 1.8 : 8; });
    stripMat.color.setRGB(...(alarm ? [0.6 + 1.2 * pulse, 0.08, 0.06] : [2.4, 2.4 * 0.945, 2.4 * 0.863]));
  };
  return group;
}
