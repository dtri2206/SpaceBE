// Cockpit display pages (pure Canvas 2D, no three.js, no DOM). Glass-cockpit look (Shuttle MEDS / Orion): black ground, thin lines,
// white = structure, green = normal, cyan = predicted/selected, amber = caution, red = warning, magenta = target.
//
// Sizes: centre display 1024x826, left/right 640x640 squares. Every page keeps 5 soft-key labels down each side, in the bezel margin.
// `live` is the flight:telemetry payload (all optional, SI units; missing -> "--"):
//   t (s, MET), altitude (m), speed, verticalSpeed (m/s), throttle (0..1), fuelKg, fuelMax, fuelFrac (0..1), thrust (N), twr, isp (s),
//   deltaVLeft (m/s), gForce | gLoad (g), q | dynamicPressure (Pa), maxQ (Pa), engineTemp (K), engineTempMax (K, default 3600),
//   engineLit (bool), ignitionsLeft, phase (string), history (altitude samples, m), apoapsis, periapsis (m),
//   pitch (deg above the local horizon, 90 = straight up), yaw (deg, heading in the orbit plane, 0 = along the horizontal velocity,
//   + toward the orbit normal), roll (deg, -180..180, 0 = pilot's head away from the planet), pitchRate/yawRate/rollRate (deg/s).
//   The pages prefer these live values; before the first telemetry they show "--" (or the static ship stats the flight deck fills in).

export const SCREEN_FONT = '"IBM Plex Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const F = SCREEN_FONT;
export const COL = {
  bg: '#000', white: '#f2f5f7', dim: '#8d979d', faint: '#2a3236', grid: '#1b2327',
  green: '#3df07a', cyan: '#35e6ff', amber: '#ffb41f', red: '#ff4d3d', magenta: '#ff52e0', sky: '#173a66', ground: '#5a3a1c',
};

// ---- data normalisers (same contract as interiors.js) -----------------------------------------------------------------
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const unit01 = (v, d) => (finite(v) ? Math.min(1, Math.max(0, v)) : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function cleanLine(points) {
  const out = [];
  if (Array.isArray(points)) for (const p of points) if (Array.isArray(p) && finite(p[0]) && finite(p[1])) out.push([p[0], p[1]]);
  return out.length > 600 ? out.filter((_, i) => i % Math.ceil(out.length / 600) === 0) : out;
}
export function normaliseTrajectory(d) {
  if (!d) return null;
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
// Debris conjunction view: objects {x,y,r,t} in 0..1 (y UP), t = seconds to closest approach, aim {x,y}, range (m) plot centre to edge.
export function normaliseConjunction(d) {
  if (!d) return null;
  const objects = [];
  if (Array.isArray(d.objects)) for (const o of d.objects.slice(0, 40)) {
    if (o && finite(o.x) && finite(o.y)) objects.push({ x: o.x, y: o.y, r: finite(o.r) ? clamp(o.r, 0.005, 0.5) : 0.04, t: finite(o.t) ? Math.max(0, o.t) : null });
  }
  const c = {
    objects, aim: d.aim && finite(d.aim.x) && finite(d.aim.y) ? { x: unit01(d.aim.x, 0.5), y: unit01(d.aim.y, 0.5) } : null,
    range: finite(d.range) && d.range > 0 ? d.range : null,
    label: typeof d.label === 'string' ? d.label.slice(0, 40) : '',
    dv: finite(d.dv) ? d.dv : null, hits: finite(d.hits) ? Math.max(0, Math.round(d.hits)) : 0, passed: finite(d.passed) ? Math.max(0, Math.round(d.passed)) : 0,
  };
  c.sig = JSON.stringify(c);
  return c;
}
export function normaliseAim(d) {
  if (!d) return null;
  const pt = (p, dx, dy) => ({ x: unit01(p?.x, dx), y: unit01(p?.y, dy) });
  const a = {
    target: pt(d.target, 0.5, 0.5), aim: pt(d.aim, 0.5, 0.5),
    radius: finite(d.radius) ? clamp(d.radius, 0.01, 0.5) : 0.06,
    accuracy: unit01(d.accuracy, 0),
    timeLeft: finite(d.timeLeft) ? Math.max(0, d.timeLeft) : null,
    lockReady: !!d.lockReady,
    label: typeof d.label === 'string' ? d.label.slice(0, 40) : '',
    nose: d.nose && finite(d.nose.x) && finite(d.nose.y) ? pt(d.nose, 0.5, 0.5) : null, // where the ship's nose really points (optional)
  };
  a.sig = [a.target.x, a.target.y, a.aim.x, a.aim.y, a.radius, a.accuracy, a.nose ? a.nose.x : -1, a.nose ? a.nose.y : -1].map((v) => v.toFixed(3)).join() +
    `|${a.timeLeft === null ? '-' : Math.ceil(a.timeLeft)}|${a.lockReady}|${a.label}`;
  return a;
}

// ---- drawing helpers --------------------------------------------------------------------------------------------------
// Text with an optional horizontal squeeze (cond < 1 fakes a condensed face so long lines fit at a big size).
function txt(c, s, x, y, size, color, align = 'left', weight = 600, cond = 1) {
  c.font = `${weight} ${size}px ${F}`;
  c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
  if (cond === 1) { c.fillText(s, x, y); return; }
  c.save(); c.translate(x, y); c.scale(cond, 1); c.fillText(s, 0, 0); c.restore();
}
// Largest size <= max (>= min) at which `s` fits `maxW`, with squeeze `cond`.
function fitSize(c, s, maxW, max, min, cond, weight = 700) {
  let size = max;
  c.font = `${weight} ${size}px ${F}`;
  const w1 = c.measureText(s).width * cond;
  if (w1 <= maxW) return size;
  size = Math.max(min, Math.floor((max * maxW) / w1));
  return size;
}
const fmt = (v, d = 0) => (finite(v) ? v.toFixed(d) : '--');
function metString(t) {
  if (!finite(t)) return 'MET --:--:--';
  const s = Math.max(0, Math.floor(t)), p = (n) => String(n).padStart(2, '0');
  return `MET ${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
const line = (c, x1, y1, x2, y2, col, lw = 2) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };

// Page chrome: background, title bar, MET, soft keys. Returns the content box between the key margins.
function chrome(c, w, h, title, met, keysL, keysR, selL = -1, selR = -1, titleCol = COL.white) {
  const big = w > 800;
  const km = big ? 84 : 66, barH = big ? 50 : 44, keyH = big ? 38 : 34, fs = big ? 22 : 20;
  c.fillStyle = COL.bg; c.fillRect(0, 0, w, h);
  c.lineCap = 'butt'; c.lineJoin = 'miter'; c.setLineDash([]);
  // title bar
  line(c, 0, barH, w, barH, COL.dim, 2);
  txt(c, title, km + 6, barH - 14, big ? 30 : 28, titleCol, 'left', 700, 0.92);
  txt(c, met, w - km - 6, barH - 14, big ? 30 : 28, COL.green, 'right', 700, 0.92);
  // soft keys: 5 evenly spaced down each side, over the area below the title bar
  const y0 = barH + 6, span = h - y0 - 6, step = span / 5;
  const keys = (list, side, sel) => {
    for (let i = 0; i < 5; i++) {
      const cy = y0 + step * (i + 0.5), x = side < 0 ? 5 : w - km + 5, kw = km - 10;
      const on = i === sel;
      if (on) { c.fillStyle = COL.cyan; c.fillRect(x, cy - keyH / 2, kw, keyH); }
      c.strokeStyle = on ? COL.cyan : COL.dim; c.lineWidth = 2; c.strokeRect(x + 1, cy - keyH / 2 + 1, kw - 2, keyH - 2);
      if (list[i]) txt(c, list[i], x + kw / 2, cy + fs * 0.35, fs, on ? '#000' : COL.white, 'center', 700, 0.9);
    }
    // thin rule between key column and content
  };
  keys(keysL, -1, selL); keys(keysR, 1, selR);
  return { x0: km + 6, x1: w - km - 6, y0: barH + 8, y1: h - 8, km, barH };
}

// Labelled number cell: small label above, big value, unit after it.
function cell(c, x, y, cw, label, value, unit, col, vs = 50, ls = 22) {
  txt(c, label, x, y + ls, ls, COL.dim, 'left', 600, 0.92);
  c.font = `700 ${vs}px ${F}`;
  const vw = c.measureText(value).width;
  txt(c, value, x, y + ls + vs + 2, vs, col, 'left', 700);
  if (unit) txt(c, unit, x + vw + 8, y + ls + vs + 2, Math.round(vs * 0.5), COL.dim, 'left', 600, 0.92);
}
function hbar(c, x, y, bw, bh, frac, col, marks = []) {
  c.strokeStyle = COL.white; c.lineWidth = 2; c.strokeRect(x, y, bw, bh);
  if (finite(frac)) { c.fillStyle = col; c.fillRect(x + 2, y + 2, Math.max(0, (bw - 4) * clamp(frac, 0, 1)), bh - 4); }
  for (const m of marks) { line(c, x + bw * m.at, y - 5, x + bw * m.at, y + bh + 5, m.col, 3); }
}
function vbar(c, x, y, bw, bh, frac, col, ticks = 10, marks = []) {
  c.strokeStyle = COL.white; c.lineWidth = 2; c.strokeRect(x, y, bw, bh);
  if (finite(frac)) { const fh = (bh - 4) * clamp(frac, 0, 1); c.fillStyle = col; c.fillRect(x + 2, y + bh - 2 - fh, bw - 4, fh); }
  for (let i = 0; i <= ticks; i++) { const ty = y + bh - (bh * i) / ticks; line(c, x + bw, ty, x + bw + (i % 5 === 0 ? 14 : 8), ty, COL.white, 2); }
  for (const m of marks) { const my = y + bh - bh * m.at; line(c, x - 6, my, x + bw + 6, my, m.col, 3); }
}
const levelCol = (f, warnAt, redAt) => (f >= redAt ? COL.red : f >= warnAt ? COL.amber : COL.green);

// ---- centre display: trajectory / aim --------------------------------------------------------------------------------
const TRAJ_L = ['TRAJ', 'ORBIT', 'ENTRY', 'LAND', 'MAN'];
const TRAJ_R = ['SIDE', 'TOP', 'ZOOM', 'DATA', 'MENU'];

// opts: { live, met (s), phase ('ASCENT'), axes: { x, y, xMax, yMax } }
export function drawTrajectoryPage(c, w, h, traj, aim, opts = {}) {
  const live = opts.live || {};
  const t = traj ? (traj.sig ? traj : normaliseTrajectory(traj)) : null;
  const a = aim ? (aim.sig ? aim : normaliseAim(aim)) : null;
  const met = metString(finite(opts.met) ? opts.met : live.t);
  if (!t && !a) return drawTelemetryPage(c, w, h, live, met, opts);
  const view = t ? t.view : 'side';
  const phase = opts.phase || 'ASCENT';
  const manual = !!a;
  const title = `${manual ? 'MAN' : 'TRAJ'} · ${phase} · ${view === 'top' ? 'TOP' : 'SIDE'}`;
  const box = chrome(c, w, h, title, met, TRAJ_L, TRAJ_R, manual ? 4 : 0, view === 'top' ? 1 : 0);
  const L = box.x0, R = box.x1, T = box.y0 + 2, B = T + 480;
  const pw = R - L, ph = B - T;
  const px = (x) => L + x * pw, py = (y) => B - y * ph;
  // plot frame + grid + scales (fine detail for the zoomed view)
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
  c.lineWidth = 1;
  for (let k = 1; k < 10; k++) line(c, px(k / 10), T, px(k / 10), B, COL.grid, 1);
  for (let k = 1; k < 6; k++) line(c, L, py(k / 6), R, py(k / 6), COL.grid, 1);
  for (let k = 1; k < 4; k++) line(c, px(k / 4), T, px(k / 4), B, COL.faint, 1.5);
  for (let k = 1; k < 3; k++) line(c, L, py(k / 3), R, py(k / 3), COL.faint, 1.5);
  const stroke = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(px(p[0]), py(p[1])) : c.moveTo(px(p[0]), py(p[1])))); c.stroke(); };
  c.lineJoin = 'round';
  if (view === 'side') { c.fillStyle = '#16100a'; c.fillRect(L, B - 4, pw, 4); } // ground line
  if (t && t.planned.length > 1) { c.setLineDash([18, 11]); c.strokeStyle = COL.white; c.lineWidth = 4; stroke(t.planned); c.setLineDash([]); }
  if (t && t.predicted.length > 1) { c.strokeStyle = COL.cyan; c.lineWidth = 6; c.lineCap = 'round'; stroke(t.predicted); c.lineCap = 'butt'; }
  if (t && t.ship) {
    const x = clamp(px(t.ship.x), L + 14, R - 14), y = clamp(py(t.ship.y), T + 14, B - 14);
    c.save(); c.translate(x, y); c.rotate(-t.ship.heading);
    c.beginPath(); c.moveTo(34, 0); c.lineTo(-20, -20); c.lineTo(-9, 0); c.lineTo(-20, 20); c.closePath();
    c.fillStyle = COL.white; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 4; c.stroke();
    c.restore();
    c.strokeStyle = COL.white; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 34, 0, Math.PI * 2); c.stroke();
  }
  c.restore();
  c.strokeStyle = COL.white; c.lineWidth = 2; c.strokeRect(L, T, pw, ph);
  // axis ticks and labels (small: only meant for the zoomed view)
  const ax = opts.axes || {};
  const xMax = ax.xMax ?? 600, yMax = ax.yMax ?? (view === 'top' ? 300 : 140);
  const xl = ax.x ?? (view === 'top' ? 'DOWNRANGE KM' : 'DOWNRANGE KM'), yl = ax.y ?? (view === 'top' ? 'CROSS KM' : 'ALT KM');
  for (let k = 0; k <= 4; k++) {
    const x = px(k / 4); line(c, x, B, x, B + 8, COL.white, 2);
    txt(c, String(Math.round((xMax * k) / 4)), clamp(x, L + 14, R - 14), B + 28, 22, COL.dim, k === 0 ? 'left' : k === 4 ? 'right' : 'center', 600, 0.9);
  }
  txt(c, xl, px(0.375), B + 28, 22, COL.dim, 'center', 600, 0.9);
  for (let k = 1; k <= 3; k++) {
    const y = py(k / 4); line(c, L, y, L + 10, y, COL.white, 2);
    txt(c, String(Math.round((yMax * k) / 4)), L + 14, y + 8, 22, COL.dim, 'left', 600, 0.9);
  }
  txt(c, yl + ' (MAX ' + yMax + ')', L + 14, T + 28, 22, COL.dim, 'left', 600, 0.9);
  if (a) drawAimOverlay(c, a, L, T, pw, ph);
  // hint / lock band
  const bandT = B + 40, bandH = 92;
  drawBand(c, L, bandT, pw, bandH, a, t);
  // key numbers
  const rowY = bandT + bandH + 8, cw = pw / 4;
  const alt = finite(live.altitude) ? live.altitude / 1000 : null;
  const gf = finite(live.gForce) ? live.gForce : finite(live.gLoad) ? live.gLoad : null;
  const fuelPct = finite(live.fuelFrac) ? live.fuelFrac * 100 : finite(live.fuelKg) && live.fuelMax > 0 ? (live.fuelKg / live.fuelMax) * 100 : null;
  if (a) {
    cell(c, L, rowY, cw, 'ACCURACY', fmt(a.accuracy * 100), '%', a.accuracy > 0.85 ? COL.green : a.accuracy > 0.5 ? COL.amber : COL.red);
    hbar(c, L, rowY + 88, cw - 24, 14, a.accuracy, a.accuracy > 0.85 ? COL.green : a.accuracy > 0.5 ? COL.amber : COL.red);
    cell(c, L + cw, rowY, cw, 'TIME LEFT', a.timeLeft === null ? '--' : String(Math.ceil(a.timeLeft)), 's', a.timeLeft !== null && a.timeLeft < 5 ? COL.amber : COL.white);
  } else {
    cell(c, L, rowY, cw, 'ALT', fmt(alt, 1), 'km', COL.white);
    cell(c, L + cw, rowY, cw, 'SPEED', fmt(live.speed), 'm/s', COL.white);
  }
  if (a) cell(c, L + cw * 2, rowY, cw, 'ALT', fmt(alt, 1), 'km', COL.white);
  else cell(c, L + cw * 2, rowY, cw, 'G', fmt(gf, 1), 'g', gf !== null && gf > 5 ? COL.amber : COL.white);
  cell(c, L + cw * 3, rowY, cw, a ? 'SPEED' : 'FUEL', a ? fmt(live.speed) : fmt(fuelPct), a ? 'm/s' : '%', a ? COL.white : fuelPct !== null && fuelPct < 15 ? COL.amber : COL.white);
}

// ---- centre display: debris conjunction view ---------------------------------------------------------------------------
// View along the velocity, ship in the centre (x = orbit normal, y = radial up). Each piece: red circle at its predicted miss point,
// danger radius growing as it nears; countdown on the nearest; cyan aim circle; bottom line with delta-v used and hits.
export function drawConjunctionPage(c, w, h, conj, opts = {}) {
  const k = conj ? (conj.sig ? conj : normaliseConjunction(conj)) : null;
  const live = opts.live || {};
  const met = metString(finite(opts.met) ? opts.met : live.t);
  const box = chrome(c, w, h, 'CONJUNCTION · DEBRIS', met, TRAJ_L, TRAJ_R, 4, -1, COL.red);
  const L = box.x0, R = box.x1, T = box.y0 + 2, B = T + 480, pw = R - L, ph = B - T;
  const px = (x) => L + x * pw, py = (y) => B - y * ph;
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
  c.lineWidth = 1;
  for (let i = 1; i < 10; i++) line(c, px(i / 10), T, px(i / 10), B, COL.grid, 1);
  for (let i = 1; i < 6; i++) line(c, L, py(i / 6), R, py(i / 6), COL.grid, 1);
  line(c, px(0.5), T, px(0.5), B, COL.faint, 1.5); line(c, L, py(0.5), R, py(0.5), COL.faint, 1.5);
  // range rings
  c.strokeStyle = COL.faint; c.lineWidth = 1.5; c.setLineDash([6, 8]);
  for (const f of [0.25, 0.5]) { c.beginPath(); c.ellipse(px(0.5), py(0.5), pw * f, pw * f, 0, 0, Math.PI * 2); c.stroke(); }
  c.setLineDash([]);
  const objs = k ? k.objects : [];
  let nearest = null;
  for (const o of objs) if (o.t !== null && (!nearest || o.t < nearest.t)) nearest = o;
  for (const o of objs) {
    const x = px(o.x), y = py(o.y), r = Math.max(8, o.r * pw), near = o === nearest;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = near ? 'rgba(255,77,61,.30)' : 'rgba(255,77,61,.14)'; c.fill();
    c.strokeStyle = '#000'; c.lineWidth = 14; c.stroke(); c.strokeStyle = COL.red; c.lineWidth = near ? 8 : 5; c.stroke();
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fillStyle = COL.red; c.fill();
    if (near && o.t !== null) {
      const label = `${o.t.toFixed(1)} s`, sz = 34;
      c.font = `700 ${sz}px ${F}`; const tw = c.measureText(label).width * 0.9 + 16;
      const lx = clamp(x - tw / 2, L + 4, R - tw - 4), ly = clamp(y - r - 12 - sz, T + 4, B - sz - 8);
      c.fillStyle = 'rgba(0,0,0,.85)'; c.fillRect(lx, ly, tw, sz + 8);
      txt(c, label, lx + tw / 2, ly + sz - 2, sz, COL.amber, 'center', 700, 0.9);
    }
  }
  // ship at the centre
  const sx = px(0.5), sy = py(0.5);
  c.strokeStyle = COL.white; c.lineWidth = 2.5; c.beginPath(); c.arc(sx, sy, 22, 0, Math.PI * 2); c.stroke();
  c.fillStyle = COL.white; c.fillRect(sx - 5, sy - 5, 10, 10);
  // aim circle (cyan)
  if (k && k.aim) {
    const ax = px(k.aim.x), ay = py(k.aim.y);
    line(c, sx, sy, ax, ay, COL.dim, 2);
    c.beginPath(); c.arc(ax, ay, 26, 0, Math.PI * 2); c.strokeStyle = '#000'; c.lineWidth = 14; c.stroke(); c.strokeStyle = COL.cyan; c.lineWidth = 7; c.stroke();
    c.beginPath(); c.arc(ax, ay, 5, 0, Math.PI * 2); c.fillStyle = COL.cyan; c.fill();
  }
  if (k && k.label) { c.fillStyle = 'rgba(0,0,0,.85)'; c.font = `700 26px ${F}`; const lw = c.measureText(k.label).width * 0.9 + 24; c.fillRect(L + 1, T + 1, lw, 40); txt(c, k.label, L + 12, T + 30, 26, COL.cyan, 'left', 700, 0.9); }
  c.restore();
  c.strokeStyle = COL.white; c.lineWidth = 2; c.strokeRect(L, T, pw, ph);
  if (k && k.range) {
    const half = k.range >= 1000 ? `${(k.range / 1000).toFixed(k.range >= 10000 ? 0 : 1)} KM` : `${Math.round(k.range)} M`;
    txt(c, `± ${half}`, R - 8, T + 28, 22, COL.dim, 'right', 600, 0.9);
    txt(c, 'RADIAL ↑', L + 8, B - 10, 22, COL.dim, 'left', 600, 0.9);
    txt(c, 'ORBIT NORMAL →', R - 8, B - 10, 22, COL.dim, 'right', 600, 0.9);
  }
  // band: count of pieces / nearest
  const bandT = B + 16, bandH = 92;
  const warn = nearest && nearest.t !== null && nearest.t < 5;
  const text = !objs.length ? 'ALL CLEAR' : nearest && nearest.t !== null ? `CLOSEST ${nearest.t.toFixed(1)} s · PUSH ○ AWAY` : `${objs.length} PIECES INBOUND`;
  if (warn) { c.fillStyle = COL.amber; c.fillRect(L, bandT, pw, bandH); } else { c.strokeStyle = objs.length ? COL.red : COL.green; c.lineWidth = 3; c.strokeRect(L + 1, bandT + 1, pw - 2, bandH - 2); }
  const sz = fitSize(c, text, pw - 28, 64, 36, 0.8);
  txt(c, text, L + pw / 2, bandT + bandH / 2 + sz * 0.34, sz, warn ? '#000' : objs.length ? COL.red : COL.green, 'center', 700, 0.8);
  const rowY = bandT + bandH + 8, cw = pw / 4;
  cell(c, L, rowY, cw, 'ΔV USED', k && k.dv !== null ? fmt(k.dv, 1) : '--', 'm/s', COL.white);
  cell(c, L + cw, rowY, cw, 'HITS', String(k ? k.hits : 0), '', k && k.hits > 0 ? COL.red : COL.green);
  cell(c, L + cw * 2, rowY, cw, 'PASSED', String(k ? k.passed : 0), '', COL.white);
  cell(c, L + cw * 3, rowY, cw, 'PIECES', String(objs.length), '', COL.white);
}

// Band under the plot: hint (auto) or aim status (manual). >= 64 px text so it reads at 0.23 scale.
function drawBand(c, x, y, bw, bh, a, t) {
  let text = '', fill = null, col = COL.green, edge = COL.green;
  if (a && a.lockReady) { text = 'LOCK READY · SPACE'; fill = COL.green; col = '#000'; }
  else if (a) {
    const h = t && t.hint;
    text = h ? h.text : 'PUT ○ ON +';
    if (h && h.level === 'warn') { fill = COL.amber; col = '#000'; } else { col = COL.cyan; edge = COL.cyan; }
  } else if (t && t.hint) {
    text = t.hint.text;
    if (t.hint.level === 'warn') { fill = COL.amber; col = '#000'; }
  } else { edge = COL.dim; col = COL.dim; }
  if (fill) { c.fillStyle = fill; c.fillRect(x, y, bw, bh); } else { c.strokeStyle = edge; c.lineWidth = 3; c.strokeRect(x + 1, y + 1, bw - 2, bh - 2); }
  if (!text) return;
  const cond = 0.8, size = fitSize(c, text, bw - 28, 70, 40, cond);
  txt(c, text, x + bw / 2, y + bh / 2 + size * 0.34, size, col, 'center', 700, cond);
}

// Aim overlay: magenta target +, circle (cyan, green when ready), offset line, label. Sized to read at 0.23 scale.
function drawAimOverlay(c, a, L, T, pw, ph) {
  const px = (x) => L + x * pw, py = (y) => T + ph - y * ph;
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip(); c.lineCap = 'round';
  const tx = px(a.target.x), ty = py(a.target.y), ax = px(a.aim.x), ay = py(a.aim.y), r = Math.max(14, a.radius * pw);
  const ready = a.lockReady, ring = ready ? COL.green : COL.cyan;
  // error line from aim to target
  c.setLineDash([8, 8]); line(c, ax, ay, tx, ty, COL.dim, 2); c.setLineDash([]);
  // target +
  const arm = 44;
  c.beginPath(); c.moveTo(tx - arm, ty); c.lineTo(tx + arm, ty); c.moveTo(tx, ty - arm); c.lineTo(tx, ty + arm);
  c.strokeStyle = '#000'; c.lineWidth = 16; c.stroke(); c.strokeStyle = COL.magenta; c.lineWidth = 8; c.stroke();
  // aim circle with centre tick marks
  c.beginPath(); c.arc(ax, ay, r, 0, Math.PI * 2); c.strokeStyle = '#000'; c.lineWidth = 16; c.stroke(); c.strokeStyle = ring; c.lineWidth = 8; c.stroke();
  c.beginPath(); c.arc(ax, ay, 6, 0, Math.PI * 2); c.fillStyle = ring; c.fill();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) line(c, ax + dx * r, ay + dy * r, ax + dx * (r + 14), ay + dy * (r + 14), ring, 5);
  if (ready) { c.beginPath(); c.arc(ax, ay, r + 22, 0, Math.PI * 2); c.strokeStyle = COL.green; c.lineWidth = 3; c.setLineDash([10, 8]); c.stroke(); c.setLineDash([]); }
  // nose marker: small amber triangle where the ship's nose really points (lags the aim circle)
  if (a.nose) {
    const nx = px(a.nose.x), ny = py(a.nose.y);
    c.beginPath(); c.moveTo(nx, ny - 24); c.lineTo(nx - 18, ny + 14); c.lineTo(nx + 18, ny + 14); c.closePath();
    c.strokeStyle = '#000'; c.lineWidth = 12; c.lineJoin = 'round'; c.stroke(); c.fillStyle = COL.amber; c.fill();
  }
  // label chip, top-left of the plot
  if (a.label) { c.fillStyle = 'rgba(0,0,0,.85)'; c.font = `700 26px ${F}`; const lw = c.measureText(a.label).width * 0.9 + 24; c.fillRect(L + 1, T + 1, lw, 40); txt(c, a.label, L + 12, T + 30, 26, COL.cyan, 'left', 700, 0.9); }
  c.restore();
}

// ---- telemetry fallback (centre display, no trajectory) --------------------------------------------------------------
function drawTelemetryPage(c, w, h, live, met, opts) {
  const box = chrome(c, w, h, `TELEMETRY · ${opts.phase || live.phase || 'ASCENT'}`, met, TRAJ_L, TRAJ_R, -1, 3);
  const L = box.x0, R = box.x1, pw = R - L, cw = pw / 3;
  const gf = finite(live.gForce) ? live.gForce : finite(live.gLoad) ? live.gLoad : null;
  const q = finite(live.q) ? live.q : live.dynamicPressure;
  const fuelPct = finite(live.fuelFrac) ? live.fuelFrac * 100 : finite(live.fuelKg) && live.fuelMax > 0 ? (live.fuelKg / live.fuelMax) * 100 : null;
  const maxQ = finite(live.maxQ) ? live.maxQ : 40000;
  const row = (y, items) => items.forEach((it, i) => { cell(c, L + cw * i + 4, y, cw, ...it, 78, 24); });
  row(box.y0 + 6, [['ALTITUDE', finite(live.altitude) ? fmt(live.altitude / 1000, 1) : '--', 'km', COL.white], ['SPEED', fmt(live.speed), 'm/s', COL.white], ['VERT SPD', fmt(live.verticalSpeed), 'm/s', COL.white]]);
  row(box.y0 + 150, [['G-LOAD', fmt(gf, 1), 'g', gf !== null && gf > 5 ? COL.amber : COL.white], ['DYN PRESS', finite(q) ? fmt(q / 1000, 1) : '--', 'kPa', finite(q) && q > maxQ * 0.8 ? COL.amber : COL.white], ['FUEL', fmt(fuelPct), '%', fuelPct !== null && fuelPct < 15 ? COL.amber : COL.white]]);
  // altitude history strip
  const sy = box.y0 + 300, sh = 130;
  c.strokeStyle = COL.dim; c.lineWidth = 2; c.strokeRect(L, sy, pw, sh);
  txt(c, 'ALT HISTORY', L + 8, sy + 24, 22, COL.dim, 'left', 600, 0.9);
  const hist = live.history;
  if (hist && hist.length > 1) {
    const mx = Math.max(1, ...hist);
    c.strokeStyle = COL.cyan; c.lineWidth = 3.5; c.lineJoin = 'round'; c.beginPath();
    hist.forEach((v, i) => { const x = L + 6 + ((pw - 12) * i) / (hist.length - 1), y = sy + sh - 8 - ((sh - 40) * v) / mx; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();
  }
  // status band
  const bandT = sy + sh + 14, bandH = 92;
  c.strokeStyle = COL.green; c.lineWidth = 3; c.strokeRect(L + 1, bandT + 1, pw - 2, bandH - 2);
  const msg = 'COMPUTER FLYING', sz = fitSize(c, msg, pw - 28, 68, 40, 0.8);
  txt(c, msg, L + pw / 2, bandT + bandH / 2 + sz * 0.34, sz, COL.green, 'center', 700, 0.8);
  const rowY = bandT + bandH + 8, c4 = pw / 4;
  cell(c, L, rowY, c4, 'THROTTLE', fmt(finite(live.throttle) ? live.throttle * 100 : null), '%', COL.white);
  cell(c, L + c4, rowY, c4, 'TWR', fmt(live.twr, 2), '', COL.white);
  cell(c, L + c4 * 2, rowY, c4, 'ΔV LEFT', fmt(live.deltaVLeft), 'm/s', COL.white);
  cell(c, L + c4 * 3, rowY, c4, 'ISP', fmt(live.isp), 's', COL.white);
}

// ---- propulsion page (left display) ------------------------------------------------------------------------------------
export function drawPropulsionPage(c, w, h, live = {}) {
  const box = chrome(c, w, h, 'PROPULSION', metString(live.t), ['MAIN', 'RCS', 'OMS', 'TANK', 'VALVE'], ['PAGE', 'BIAS', 'TEST', 'DATA', 'MENU'], 0, -1);
  const L = box.x0, R = box.x1, T = box.y0 + 6, pw = R - L;
  const thr = finite(live.throttle) ? live.throttle : null;
  const fuelFrac = finite(live.fuelFrac) ? live.fuelFrac : finite(live.fuelKg) && live.fuelMax > 0 ? live.fuelKg / live.fuelMax : null;
  const tempMax = live.engineTempMax ?? 3600, tf = finite(live.engineTemp) ? live.engineTemp / tempMax : null;
  // two tall bars: throttle and propellant
  const bh = 250, by = T + 60, bw = 70;
  const col1 = L + 20, col2 = L + pw / 2 + 24;
  txt(c, 'THROTTLE', col1, T + 24, 26, COL.dim, 'left', 600, 0.9);
  vbar(c, col1, by, bw, bh, thr, COL.green, 10, [{ at: 1, col: COL.white }]);
  txt(c, fmt(thr === null ? null : thr * 100), col1 + bw + 34, by + 70, 72, COL.white, 'left', 700);
  txt(c, '%', col1 + bw + 34, by + 106, 30, COL.dim, 'left', 600);
  txt(c, 'PROPELLANT', col2, T + 24, 26, COL.dim, 'left', 600, 0.9);
  vbar(c, col2, by, bw, bh, fuelFrac, fuelFrac !== null ? levelCol(1 - fuelFrac, 0.8, 0.92) : COL.green, 10, [{ at: 0.15, col: COL.amber }]);
  txt(c, fmt(fuelFrac === null ? null : fuelFrac * 100), col2 + bw + 34, by + 70, 72, fuelFrac !== null && fuelFrac < 0.15 ? COL.amber : COL.white, 'left', 700);
  txt(c, '%', col2 + bw + 34, by + 106, 30, COL.dim, 'left', 600);
  txt(c, finite(live.fuelKg) ? `${Math.round(live.fuelKg / 1000)} t` : '-- t', col2 + bw + 34, by + 150, 34, COL.white, 'left', 600, 0.9);
  // engine status chip
  const lit = live.engineLit !== false && (thr === null || thr > 0.01);
  c.strokeStyle = lit ? COL.green : COL.amber; c.lineWidth = 3; c.strokeRect(col1 + bw + 34, by + 190, 130, 46);
  txt(c, lit ? 'ENG LIT' : 'ENG OFF', col1 + bw + 99, by + 222, 28, lit ? COL.green : COL.amber, 'center', 700, 0.9);
  // temperature bar
  const ty = by + bh + 50;
  txt(c, 'ENG TEMP', L + 20, ty - 12, 26, COL.dim, 'left', 600, 0.9);
  hbar(c, L + 20, ty, pw - 220, 34, tf, tf !== null ? levelCol(tf, 0.85, 0.95) : COL.green, [{ at: 0.85, col: COL.amber }, { at: 0.95, col: COL.red }]);
  txt(c, fmt(live.engineTemp), R - 8, ty + 30, 44, COL.white, 'right', 700);
  // lower numbers
  const ny = ty + 56, cw = pw / 3;
  cell(c, L + 6, ny, cw, 'THRUST', finite(live.thrust) ? fmt(live.thrust / 1000) : '--', 'kN', COL.white, 46, 22);
  cell(c, L + cw + 6, ny, cw, 'TWR', fmt(live.twr, 2), '', finite(live.twr) && live.twr < 1 ? COL.amber : COL.white, 46, 22);
  cell(c, L + cw * 2 + 6, ny, cw, 'ΔV', fmt(live.deltaVLeft), 'm/s', COL.white, 46, 22);
}

// ---- attitude / loads page (right display) ----------------------------------------------------------------------------
export function drawAttitudePage(c, w, h, live = {}) {
  const box = chrome(c, w, h, 'ATT · LOADS', metString(live.t), ['ADI', 'RATE', 'LOADS', 'THERM', 'RCS'], ['INRTL', 'LVLH', 'REF', 'DATA', 'MENU'], 0, 1);
  const L = box.x0, R = box.x1, pw = R - L;
  const pitch = finite(live.pitch) ? live.pitch : 0, roll = finite(live.roll) ? live.roll : 0, yaw = finite(live.yaw) ? live.yaw : 0;
  const cx = (L + R) / 2, cy = box.y0 + 190, r = 172;
  // ADI ball: sky/ground rotated by roll, shifted by pitch (3.4 px/deg), with a 10-degree ladder
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  c.translate(cx, cy); c.rotate((-roll * Math.PI) / 180);
  const off = pitch * 3.8;
  c.fillStyle = COL.sky; c.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  c.fillStyle = COL.ground; c.fillRect(-r * 2, off, r * 4, r * 3);
  line(c, -r * 2, off, r * 2, off, COL.white, 3);
  for (let p = -80; p <= 80; p += 10) {
    if (p === 0) continue;
    const y = off - p * 3.8, half = p % 30 === 0 ? 62 : 34;
    line(c, -half, y, half, y, COL.white, 2.5);
    if (p % 30 === 0) { txt(c, String(Math.abs(p)), -half - 8, y + 8, 24, COL.white, 'right', 600, 0.9); txt(c, String(Math.abs(p)), half + 8, y + 8, 24, COL.white, 'left', 600, 0.9); }
  }
  c.restore();
  c.strokeStyle = COL.white; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  // roll scale (fixed) with pointer
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const ang = ((d - 90) * Math.PI) / 180, l = d % 30 === 0 ? 20 : 12;
    line(c, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, cx + Math.cos(ang) * (r + l), cy + Math.sin(ang) * (r + l), COL.white, 2.5);
  }
  c.save(); c.translate(cx, cy); c.rotate((-roll * Math.PI) / 180);
  c.beginPath(); c.moveTo(0, -r + 2); c.lineTo(-12, -r + 22); c.lineTo(12, -r + 22); c.closePath(); c.fillStyle = COL.amber; c.fill(); c.restore();
  // fixed aircraft symbol
  c.strokeStyle = '#000'; c.lineWidth = 11; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 90, cy); c.lineTo(cx + s * 40, cy); c.lineTo(cx + s * 40, cy + 16); c.stroke(); }
  c.strokeStyle = COL.amber; c.lineWidth = 6; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + s * 90, cy); c.lineTo(cx + s * 40, cy); c.lineTo(cx + s * 40, cy + 16); c.stroke(); }
  c.fillStyle = COL.amber; c.fillRect(cx - 5, cy - 5, 10, 10);
  // attitude readouts in the corners beside the ball
  const rd = (lbl, v, x, y, al) => { txt(c, lbl, x, y, 22, COL.dim, al, 600, 0.9); txt(c, fmt(v), x, y + 40, 40, COL.white, al, 700); };
  rd('PITCH', pitch, L + 2, box.y0 + 40, 'left'); rd('ROLL', roll, R - 2, box.y0 + 40, 'right'); rd('YAW', yaw, L + 2, box.y0 + 300, 'left');
  // body rates (deg/s), stacked in the bottom-right corner beside the ball
  txt(c, 'RATE °/s', R - 2, box.y0 + 296, 22, COL.dim, 'right', 600, 0.9);
  [['P', live.pitchRate], ['Y', live.yawRate], ['R', live.rollRate]].forEach(([n, v], i) => txt(c, `${n} ${finite(v) ? fmt(v, 1) : '--'}`, R - 2, box.y0 + 326 + i * 28, 26, COL.white, 'right', 700, 0.9));
  // loads: G and Q bars
  const gf = finite(live.gForce) ? live.gForce : finite(live.gLoad) ? live.gLoad : null;
  const q = finite(live.q) ? live.q : live.dynamicPressure, maxQ = finite(live.maxQ) ? live.maxQ : 40000;
  const gy = box.y0 + 392, qy = gy + 82, bx = L + 8, bwid = pw - 190;
  txt(c, 'G', bx, gy + 30, 28, COL.dim, 'left', 700);
  hbar(c, bx + 36, gy + 6, bwid - 36, 30, finite(gf) ? gf / 9 : null, finite(gf) ? levelCol(gf / 9, 0.5, 0.78) : COL.green, [{ at: 0.5, col: COL.amber }, { at: 0.78, col: COL.red }]);
  txt(c, fmt(gf, 1), R - 4, gy + 38, 46, COL.white, 'right', 700);
  txt(c, 'Q', bx, qy + 30, 28, COL.dim, 'left', 700);
  const qf = finite(q) ? q / maxQ : null;
  hbar(c, bx + 36, qy + 6, bwid - 36, 30, qf !== null ? qf / 1.25 : null, qf !== null ? levelCol(qf, 0.8, 1) : COL.green, [{ at: 0.8 / 1.25, col: COL.amber }, { at: 1 / 1.25, col: COL.red }]);
  txt(c, finite(q) ? fmt(q / 1000, 1) : '--', R - 4, qy + 38, 46, COL.white, 'right', 700);
  txt(c, 'kPa', R - 4, qy + 60, 20, COL.dim, 'right', 600);
}

// ---- static system pages ----------------------------------------------------------------------------------------------
// Deterministic sample values so the pages look alive; no input needed.
const SYS = {
  eps: { title: 'EPS · ELECTRICAL', L: ['FC', 'BUS', 'BATT', 'LOAD', 'XFER'], R: ['PAGE', 'RESET', 'TEST', 'DATA', 'MENU'] },
  eclss: { title: 'ECLSS · CABIN', L: ['ATM', 'O2', 'CO2', 'H2O', 'THRM'], R: ['PAGE', 'FAN', 'TEST', 'DATA', 'MENU'] },
  comm: { title: 'COMM · LINKS', L: ['S-BD', 'UHF', 'KU', 'TDRS', 'VOICE'], R: ['PAGE', 'ANT', 'TEST', 'DATA', 'MENU'] },
  nav: { title: 'NAV · STATE', L: ['IMU', 'STAR', 'GPS', 'ALIGN', 'REF'], R: ['PAGE', 'SEL', 'TEST', 'DATA', 'MENU'] },
  rcs: { title: 'RCS · THRUSTERS', L: ['FWD', 'AFT', 'L', 'R', 'XFD'], R: ['PAGE', 'ISOL', 'TEST', 'DATA', 'MENU'] },
  cw: { title: 'C&W · SUMMARY', L: ['ACK', 'CLR', 'HIST', 'TEST', 'INH'], R: ['PAGE', 'DIM', 'TEST', 'DATA', 'MENU'] },
  apu: { title: 'APU · AUX POWER', L: ['APU1', 'APU2', 'APU3', 'FUEL', 'OIL'], R: ['PAGE', 'START', 'STOP', 'DATA', 'MENU'] },
  hyd: { title: 'HYD · HYDRAULICS', L: ['SYS1', 'SYS2', 'SYS3', 'ACCU', 'RSVR'], R: ['PAGE', 'ISOL', 'TEST', 'DATA', 'MENU'] },
};

function column(c, x, y, bw, bh, frac, col, label, value, unit, sub) {
  txt(c, label, x + bw / 2, y - 14, 26, COL.white, 'center', 700, 0.9);
  vbar(c, x, y, bw, bh, frac, col, 10);
  txt(c, value, x + bw / 2, y + bh + 48, 44, col === COL.green ? COL.white : col, 'center', 700, 0.95);
  if (unit) txt(c, unit, x + bw / 2, y + bh + 74, 22, COL.dim, 'center', 600, 0.9);
  if (sub) txt(c, sub, x + bw / 2, y + bh + 98, 22, COL.dim, 'center', 600, 0.9);
}
function badge(c, x, y, bw, bh, label, col, filled = false) {
  if (filled) { c.fillStyle = col; c.fillRect(x, y, bw, bh); } else { c.strokeStyle = col; c.lineWidth = 3; c.strokeRect(x + 1, y + 1, bw - 2, bh - 2); }
  txt(c, label, x + bw / 2, y + bh / 2 + 9, 26, filled ? '#000' : col, 'center', 700, 0.9);
}
function arcGauge(c, cx, cy, r, frac, col, value, label, unit) {
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  c.lineWidth = 4; c.strokeStyle = COL.faint; c.beginPath(); c.arc(cx, cy, r, a0, a0 + span); c.stroke();
  c.strokeStyle = col; c.lineWidth = 12; c.beginPath(); c.arc(cx, cy, r, a0, a0 + span * clamp(frac, 0, 1)); c.stroke();
  for (let i = 0; i <= 10; i++) { const an = a0 + (span * i) / 10; line(c, cx + Math.cos(an) * (r + 8), cy + Math.sin(an) * (r + 8), cx + Math.cos(an) * (r + (i % 5 === 0 ? 24 : 16)), cy + Math.sin(an) * (r + (i % 5 === 0 ? 24 : 16)), COL.white, 2); }
  txt(c, value, cx, cy + 14, 46, COL.white, 'center', 700);
  txt(c, label, cx, cy + r + 44, 24, COL.white, 'center', 700, 0.9);
  if (unit) txt(c, unit, cx, cy + 44, 20, COL.dim, 'center', 600, 0.9);
}

export function drawSystemPage(c, w, h, kind = 'eps') {
  const s = SYS[kind] || SYS.eps;
  const box = chrome(c, w, h, s.title, metString(15720 + (kind.length * 37)), s.L, s.R, kind === 'cw' ? 0 : 0, -1);
  const L = box.x0, R = box.x1, T = box.y0 + 8, pw = R - L, mid = (L + R) / 2;
  const bh = 230, by = T + 70;
  if (kind === 'eps') {
    const v = [[0.93, '28.4', 'FC 1', COL.green], [0.92, '28.3', 'FC 2', COL.green], [0.78, '27.1', 'FC 3', COL.amber]];
    v.forEach((a, i) => column(c, L + 30 + i * 150, by, 64, bh, a[0], a[3], a[2], a[1], 'V', i === 0 ? '62 A' : i === 1 ? '60 A' : '41 A'));
    txt(c, 'BATT SOC', L + 8, T + 460, 26, COL.white, 'left', 700, 0.9); hbar(c, L + 8, T + 474, pw - 190, 32, 0.87, COL.green, [{ at: 0.2, col: COL.amber }]);
    txt(c, '87%', R - 4, T + 504, 52, COL.white, 'right', 700);
    ['MN A', 'MN B', 'MN C'].forEach((n, i) => badge(c, L + 8 + i * 150, T + 530, 130, 40, n, COL.green, true));
  } else if (kind === 'eclss') {
    arcGauge(c, L + 120, T + 170, 90, 0.98, COL.green, '14.7', 'CABIN P', 'psi');
    arcGauge(c, R - 120, T + 170, 90, 0.52, COL.green, '22.1', 'CABIN T', '°C');
    txt(c, 'O2', L + 8, T + 340, 26, COL.white, 'left', 700); hbar(c, L + 70, T + 316, pw - 250, 30, 0.7, COL.green, [{ at: 0.3, col: COL.amber }]); txt(c, '3.1 psi', R - 4, T + 344, 36, COL.white, 'right', 700);
    txt(c, 'CO2', L + 8, T + 410, 26, COL.white, 'left', 700); hbar(c, L + 70, T + 386, pw - 250, 30, 0.22, COL.green, [{ at: 0.6, col: COL.amber }]); txt(c, '2.4 mmHg', R - 4, T + 414, 36, COL.white, 'right', 700, 0.9);
    txt(c, 'H2O', L + 8, T + 480, 26, COL.white, 'left', 700); hbar(c, L + 70, T + 456, pw - 250, 30, 0.64, COL.green); txt(c, '64 %', R - 4, T + 484, 36, COL.white, 'right', 700);
    badge(c, L + 8, T + 520, 140, 44, 'FAN 1', COL.green, true); badge(c, L + 160, T + 520, 140, 44, 'FAN 2', COL.green); badge(c, L + 312, T + 520, 150, 44, 'SCRUB A', COL.green, true);
  } else if (kind === 'comm') {
    const links = [['S-BAND', 'LOCKED', COL.green, 0.9], ['UHF', 'LOCKED', COL.green, 0.7], ['KU', 'STBY', COL.amber, 0.0]];
    links.forEach((l, i) => {
      const y = T + 10 + i * 100;
      txt(c, l[0], L + 8, y + 42, 40, COL.white, 'left', 700); badge(c, L + 190, y + 6, 150, 48, l[1], l[2], l[1] === 'LOCKED');
      for (let b = 0; b < 5; b++) { const bh2 = 14 + b * 9; c.fillStyle = b / 5 < l[3] ? l[2] : COL.faint; c.fillRect(L + 370 + b * 24, y + 56 - bh2, 16, bh2); }
    });
    txt(c, 'DATA RATE', L + 8, T + 350, 26, COL.dim, 'left', 600, 0.9); txt(c, '192', L + 8, T + 412, 64, COL.white, 'left', 700); txt(c, 'kbps', L + 170, T + 412, 30, COL.dim, 'left', 600);
    txt(c, 'STATION', L + 260, T + 350, 26, COL.dim, 'left', 600, 0.9); txt(c, 'TDRS-W', L + 260, T + 412, 52, COL.green, 'left', 700, 0.9);
    arcGauge(c, L + 110, T + 520, 70, 0.62, COL.cyan, '218', 'ANT AZ', '');
    badge(c, L + 260, T + 480, 200, 50, 'VOICE OPEN', COL.green, true);
  } else if (kind === 'nav') {
    const ims = [['IMU 1', COL.green], ['IMU 2', COL.green], ['IMU 3', COL.amber]];
    ims.forEach((m, i) => { badge(c, L + 8 + i * 150, T + 10, 138, 50, m[0], m[1], m[1] === COL.green); });
    c.strokeStyle = COL.white; c.lineWidth = 2.5; c.beginPath(); c.arc(mid, T + 240, 150, 0, Math.PI * 2); c.stroke(); c.lineWidth = 1.5; c.strokeStyle = COL.faint; c.beginPath(); c.arc(mid, T + 240, 75, 0, Math.PI * 2); c.stroke();
    line(c, mid - 150, T + 240, mid + 150, T + 240, COL.faint, 1.5); line(c, mid, T + 90, mid, T + 390, COL.faint, 1.5);
    const stars = [[-60, -90], [70, -40], [30, 80], [-100, 40], [10, -20], [95, 95]];
    stars.forEach((p, i) => { c.fillStyle = i < 3 ? COL.cyan : COL.white; c.beginPath(); c.arc(mid + p[0], T + 240 + p[1], i < 3 ? 9 : 5, 0, Math.PI * 2); c.fill(); });
    cell(c, L + 8, T + 420, 220, 'STAR TRK', '3', 'LOCK', COL.green, 52); cell(c, L + 250, T + 420, 220, 'GPS SATS', '9', '', COL.green, 52);
    cell(c, L + 250, T + 420, 220, 'ALIGN ERR', '0.04', '°', COL.white, 52);
  } else if (kind === 'rcs') {
    // vehicle top-view schematic with three clusters
    c.strokeStyle = COL.white; c.lineWidth = 3; c.beginPath(); c.moveTo(mid, T + 20); c.lineTo(mid + 60, T + 120); c.lineTo(mid + 60, T + 340); c.lineTo(mid - 60, T + 340); c.lineTo(mid - 60, T + 120); c.closePath(); c.stroke();
    const th = (x, y, ok) => { c.fillStyle = ok ? COL.green : COL.amber; c.fillRect(x - 10, y - 10, 20, 20); };
    [[-26, 50], [26, 50], [-26, 66], [26, 66]].forEach((p, i) => th(mid + p[0], T + p[1], true));
    [[-72, 140], [-72, 160], [72, 140], [72, 160]].forEach((p, i) => th(mid + p[0], T + p[1], i !== 3));
    [[-34, 350], [34, 350], [-50, 350], [50, 350]].forEach((p) => th(mid + p[0], T + p[1], true));
    txt(c, 'FWD', L + 20, T + 70, 24, COL.dim, 'left', 600); txt(c, 'L', L + 20, T + 160, 24, COL.dim, 'left', 600); txt(c, 'R', R - 20, T + 160, 24, COL.dim, 'right', 600); txt(c, 'AFT', L + 20, T + 360, 24, COL.dim, 'left', 600);
    const q = [['FWD', 0.82], ['L', 0.76], ['R', 0.74]];
    q.forEach((a, i) => { txt(c, a[0] + ' PROP', L + 8, T + 440 + i * 56, 26, COL.white, 'left', 700, 0.9); hbar(c, L + 150, T + 418 + i * 56, pw - 320, 28, a[1], COL.green, [{ at: 0.2, col: COL.amber }]); txt(c, Math.round(a[1] * 100) + ' %', R - 4, T + 444 + i * 56, 38, COL.white, 'right', 700); });
  } else if (kind === 'cw') {
    const tiles = [['MAIN ENG', 0], ['FUEL', 0], ['O2', 0], ['CABIN P', 0], ['FC 3', 1], ['BUS B', 0], ['APU 2', 0], ['HYD 1', 0], ['COMM', 0], ['IMU 3', 1], ['RCS', 0], ['THERM', 0], ['G LOAD', 0], ['SMOKE', 0], ['GNC', 0], ['FLT CMP', 0]];
    const tw = (pw - 12) / 4, th = 96;
    tiles.forEach((t, i) => {
      const x = L + (i % 4) * (tw + 4), y = T + 6 + Math.floor(i / 4) * (th + 8);
      if (t[1]) { c.fillStyle = COL.amber; c.fillRect(x, y, tw, th); txt(c, t[0], x + tw / 2, y + 58, 28, '#000', 'center', 700, 0.9); }
      else { c.strokeStyle = COL.faint; c.lineWidth = 2; c.strokeRect(x, y, tw, th); txt(c, t[0], x + tw / 2, y + 58, 26, COL.dim, 'center', 600, 0.9); line(c, x + 12, y + 80, x + tw - 12, y + 80, COL.green, 3); }
    });
    txt(c, '2 CAUTION  0 WARNING', L + 8, T + 490, 38, COL.amber, 'left', 700, 0.85);
    badge(c, L + 8, T + 520, 150, 46, 'MASTER', COL.amber); txt(c, 'ACK TO SILENCE', L + 180, T + 553, 26, COL.dim, 'left', 600, 0.9);
  } else if (kind === 'apu') {
    [['APU 1', 0.98, '99', COL.green], ['APU 2', 0.98, '99', COL.green], ['APU 3', 0.0, '0', COL.dim]].forEach((a, i) => {
      arcGauge(c, L + 80 + i * 170, T + 130, 62, a[1], a[3] === COL.dim ? COL.faint : COL.green, a[2], a[0], '% RPM');
    });
    const rows = [['EGT', 0.55, '1080', '°F'], ['OIL T', 0.4, '172', '°F'], ['FUEL', 0.71, '71', '%']];
    rows.forEach((r, i) => { txt(c, r[0], L + 8, T + 340 + i * 70, 28, COL.white, 'left', 700); hbar(c, L + 120, T + 316 + i * 70, pw - 320, 30, r[1], COL.green, [{ at: 0.9, col: COL.red }]); txt(c, r[2], R - 4, T + 342 + i * 70, 44, COL.white, 'right', 700); });
    badge(c, L + 8, T + 540, 150, 40, 'APU 1 ON', COL.green, true); badge(c, L + 170, T + 540, 150, 40, 'APU 2 ON', COL.green, true); badge(c, L + 332, T + 540, 140, 40, 'APU 3 OFF', COL.dim);
  } else { // hyd
    [['SYS 1', 0.99, '3010', COL.green], ['SYS 2', 0.98, '2990', COL.green], ['SYS 3', 0.82, '2480', COL.amber]].forEach((a, i) => {
      column(c, L + 34 + i * 150, by, 64, bh, a[1], a[3], a[0], a[2], 'psi', i === 2 ? 'LOW' : 'OK');
    });
    txt(c, 'RESERVOIR', L + 8, T + 490, 26, COL.white, 'left', 700, 0.9); hbar(c, L + 8, T + 504, pw - 190, 30, 0.78, COL.green, [{ at: 0.2, col: COL.amber }]); txt(c, '78 %', R - 4, T + 534, 50, COL.white, 'right', 700);
  }
}
