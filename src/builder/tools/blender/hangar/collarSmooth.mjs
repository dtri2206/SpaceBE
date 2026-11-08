// Hangar v5 smooth collars. Pure data API (no three.js, no DOM).
// fitCollarSmooth(levelY, segment, entries, hull, cfg) -> {angles, radii, retract}
//   levelY   absolute world Y of the deck top (metres); entries/hull use metres above ML_TOP, as in collarFit.mjs.
//   segment  {arc:[a0,a1]} in degrees, 0 = +X, 90 = -Z, 180 = -X, 270 = +Z (Assembly convention).
//   angles   every <= cfg.sampleStep degrees over the arc, both ends included.
//   radii    inner edge of the deck band at each angle: the outline at this height (hull + measured sections,
//            radial parts such as boosters) grown by cfg.clearance in every direction (round notches), clamped to
//            cfg.slideLimits. The polyline through the samples never cuts into the grown outline.
//   retract  true above the ship top, below ML_TOP, or when the outline inside this arc needs more than the notch.
// The outline itself comes from collarFit.mjs (unchanged), evaluated on fine 1-degree wedges.
import {fitCollar} from './collarFit.mjs';

const D2R = Math.PI / 180;
const memo = new WeakMap();

function shipTop(entries, hull) {
  return Math.max(0, ...entries.filter(e => e.attach !== 'radial').map(e => e.y + e.height), ...hull.map(s => s.y1));
}

// Raw outline radius (no clearance) on wedges of `step` degrees; wedge i is centred at (i + .5) * step - 90.
// The deck band spans about [y - .45, y + .13]; probing at y and y - probeDepth covers cones and skirts below the deck.
function rawOutline(levelY, entries, hull, cfg) {
  const step = cfg.fineStep ?? 1, probe = cfg.probeDepth ?? .3;
  let byHull = memo.get(entries);
  if (!byHull) { byHull = new WeakMap(); memo.set(entries, byHull); }
  let byLevel = byHull.get(hull);
  if (!byLevel) { byLevel = new Map(); byHull.set(hull, byLevel); }
  const key = `${levelY}|${step}|${probe}|${cfg.ML_TOP ?? 7}|${cfg.clearance ?? .25}`;
  if (byLevel.has(key)) return byLevel.get(key);
  const count = Math.round(360 / step);
  const fine = {...cfg, plateCount: count, clearance: 0, slideLimits: [0, 1e6]};
  const a = fitCollar(levelY, entries, hull, fine).plateRadii;
  const b = probe > 0 ? fitCollar(levelY - probe, entries, hull, fine).plateRadii : a;
  const radii = a.map((r, i) => Math.max(r, b[i]));
  // Widest sideways reach of a grown wedge: asin(c / r) for the smallest outline radius (a full quarter when r <= c).
  const c = cfg.clearance ?? .25, rmin = Math.min(...radii.filter(r => r > 0), Infinity);
  const reach = rmin > c ? Math.asin(c / rmin) / D2R : 90;
  const raw = {step, radii, span: Math.ceil((reach + step / 2) / step) + 1};
  byLevel.set(key, raw);
  return raw;
}

const wrap180 = d => ((d % 360) + 540) % 360 - 180;

// Radius along direction `theta` of the outline grown by a disc of radius c (Minkowski sum), from wedge samples.
function grown(raw, theta, c) {
  const {step, radii, span} = raw, n = radii.length;
  let best = 0;
  const centre = Math.round((theta + 90) / step - .5);
  for (let k = -span; k <= span; k++) {
    const i = ((centre + k) % n + n) % n, r = radii[i];
    if (!(r > 0)) { if (c > best && k === 0) best = c; continue; }
    const phi = (i + .5) * step - 90;
    // The wedge is an arc of radius r over phi +- step/2: use the nearest point of that arc.
    const delta = Math.max(0, Math.abs(wrap180(theta - phi)) - step / 2) * D2R;
    if (delta === 0) { best = Math.max(best, r + c); continue; }
    if (delta >= Math.PI / 2) continue;
    const side = r * Math.sin(delta);
    if (side > c) continue;
    best = Math.max(best, r * Math.cos(delta) + Math.sqrt(c * c - side * side));
  }
  return Math.max(best, c);
}

export function sampleAngles(arc, step = 1.5) {
  const [a0, a1] = arc, n = Math.max(1, Math.ceil((a1 - a0) / step - 1e-9));
  return Array.from({length: n + 1}, (_, k) => a0 + (a1 - a0) * k / n);
}

export function fitCollarSmooth(levelY, segment, entries, hull, cfg) {
  const ML = cfg.ML_TOP ?? 7, y = (typeof levelY === 'number' ? levelY : levelY.y) - ML;
  const [min, max] = cfg.slideLimits ?? [.35, cfg.notchRadius ?? 6], c = cfg.clearance ?? .25;
  const angles = sampleAngles(segment.arc, cfg.sampleStep ?? 1.5);
  const top = shipTop(entries, hull);
  let retract = y < 0 || y > top + 1e-6;
  const raw = rawOutline(ML + y, entries, hull, cfg);
  // Grown outline on a fine grid, then each output sample takes the maximum over one output step on each side,
  // so the straight polyline between neighbouring samples stays outside the grown outline.
  const fineStep = Math.min(raw.step, .5);
  const out = angles[1] - angles[0] || 0;
  const radii = angles.map(theta => {
    let r = 0;
    const n = Math.max(1, Math.ceil(out / fineStep));
    for (let k = -n; k <= n; k++) r = Math.max(r, grown(raw, theta + k * out / n, c));
    return r;
  });
  if (radii.some(r => r > max + 1e-6)) retract = true;
  return {angles, radii: radii.map(r => retract ? max : Math.min(max, Math.max(min, r))), retract};
}

// Convenience: every segment of every level, as the sandbox stores it (fits[level][segmentId]).
export function fitAllSmooth(levels, segments, entries, hull, cfg) {
  return levels.map(level => Object.fromEntries(segments.map(s => [s.id, fitCollarSmooth(typeof level === 'number' ? level : level.y, s, entries, hull, cfg)])));
}
