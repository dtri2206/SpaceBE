// Formula Lens (spec §5.4): the five MVP formulas with the player's own numbers, live. Click a variable to make the
// parts behind it glow on the rocket. Pure DOM + SVG; g0 and the planets are passed in, never written here.
import './formulaLens.css';
import { fmtInt, fmtMass } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const h = (tag, className, textContent) => Object.assign(document.createElement(tag), { className: className ?? '', textContent: textContent ?? '' });
const txt = (s) => document.createTextNode(s);
const kms = (ms) => `${(ms / 1000).toFixed(1)}`;

export function createFormulaLens({ parent, g0, planets, balance, text, onHighlight, onGuidebook }) {
  const root = h('div', 'lens-root');
  parent.append(root);
  const T = (key) => text?.[key] ?? { title: key, formula: '', real: '', guidebook: null };

  function card(key) {
    const t = T(key);
    const el = h('section', 'lens-card hud-panel');
    el.dataset.formula = key;
    const formula = h('div', 'lens-formula', t.formula);
    const numbers = h('div', 'lens-numbers');
    const result = h('div', 'lens-result');
    const body = h('div', 'lens-body');
    const real = h('div', 'lens-real', t.real);
    el.append(h('div', 'hud-label', t.title), formula, numbers, result, body);
    if (t.plain) el.append(h('p', 'lens-plain', t.plain));
    el.append(real);
    if (t.guidebook) {
      const link = h('button', 'lens-link', 'Guidebook ›');
      link.type = 'button';
      link.addEventListener('click', () => onGuidebook?.(t.guidebook));
      el.append(link);
    }
    root.append(el);
    return { el, numbers, result, body };
  }

  function variable(label, ids, kind = 'mass') {
    const b = h('button', 'lens-var', label);
    b.type = 'button';
    b.dataset.kind = kind;
    b.title = 'Show these parts on the rocket';
    b.addEventListener('click', () => onHighlight?.(ids));
    return b;
  }

  // ---------- 1. Weight ----------
  const weight = card('weight');
  const wCols = h('div', 'lens-weight');
  const wEarth = h('div', 'lens-weight-col');
  const wMars = h('div', 'lens-weight-col');
  const wEarthBar = h('div', 'lens-bar');
  const wMarsBar = h('div', 'lens-bar');
  const wEarthVal = h('div', 'lens-weight-value');
  const wMarsVal = h('div', 'lens-weight-value');
  wEarth.append(h('div', 'hud-label', `Earth · g ${planets.earth.g}`), wEarthBar, wEarthVal);
  wMars.append(h('div', 'hud-label', `Mars · g ${planets.mars.g}`), wMarsBar, wMarsVal);
  wCols.append(wEarth, wMars);
  weight.body.append(wCols);

  // ---------- 2. TWR ----------
  const twr = card('twr');
  const gauge = svg('svg', { class: 'lens-gauge', viewBox: '0 0 300 46', preserveAspectRatio: 'none' });
  const zone = (x0, x1, cls) => svg('rect', { x: x0, y: 14, width: x1 - x0, height: 12, class: `lens-zone ${cls}` });
  const gx = (v) => 8 + (Math.min(3, Math.max(0, v)) / 3) * 284;
  gauge.append(zone(gx(0), gx(1), 'lens-zone--bad'), zone(gx(1), gx(1.2), 'lens-zone--warn'), zone(gx(1.2), gx(3), 'lens-zone--ok'));
  for (const v of [1, 1.2, 2, 3]) {
    gauge.append(svg('line', { x1: gx(v), x2: gx(v), y1: 10, y2: 30, class: 'lens-tick' }));
    const label = svg('text', { x: gx(v), y: 42, class: 'lens-tick-label', 'text-anchor': 'middle' });
    label.textContent = String(v);
    gauge.append(label);
  }
  const needle = svg('polygon', { points: '0,0 -6,-10 6,-10', class: 'lens-needle', transform: `translate(${gx(0)},14)` });
  gauge.append(needle);
  const ghost = h('div', 'lens-ghost');
  const ghostSvg = svg('svg', { viewBox: '0 0 40 70', class: 'lens-ghost-svg' });
  ghostSvg.append(
    svg('path', { d: 'M20 4 L28 22 L28 50 L12 50 L12 22 Z', class: 'lens-ghost-body' }),
    svg('path', { d: 'M12 44 L4 58 L12 54 Z M28 44 L36 58 L28 54 Z', class: 'lens-ghost-fin' }),
    svg('path', { d: 'M14 50 L26 50 L22 64 L18 64 Z', class: 'lens-ghost-flame' }),
  );
  const ghostLabel = h('div', 'lens-ghost-label');
  ghost.append(ghostSvg, ghostLabel);
  const twrRow = h('div', 'lens-twr-row');
  twrRow.append(gauge, ghost);
  twr.body.append(twrRow);

  // ---------- 3. Rocket equation graph ----------
  const rocket = card('rocketEquation');
  const G = { w: 320, h: 150, l: 40, r: 10, t: 10, b: 26 };
  const graph = svg('svg', { class: 'lens-graph', viewBox: `0 0 ${G.w} ${G.h}` });
  const axisX = svg('line', { x1: G.l, x2: G.w - G.r, y1: G.h - G.b, y2: G.h - G.b, class: 'lens-axis' });
  const axisY = svg('line', { x1: G.l, x2: G.l, y1: G.t, y2: G.h - G.b, class: 'lens-axis' });
  const curve = svg('path', { class: 'lens-curve', d: '' });
  const needLine = svg('line', { class: 'lens-need', x1: G.l, x2: G.w - G.r });
  const needLabel = svg('text', { class: 'lens-tick-label', x: G.w - G.r, 'text-anchor': 'end' });
  const tripLine = svg('line', { class: 'lens-need lens-need--trip', x1: G.l, x2: G.w - G.r });
  const tripLabel = svg('text', { class: 'lens-tick-label', x: G.w - G.r, 'text-anchor': 'end' });
  const dot = svg('circle', { class: 'lens-dot', r: 4.5 });
  const dotLabel = svg('text', { class: 'lens-dot-label' });
  const xLabel = svg('text', { class: 'lens-tick-label', x: G.w - G.r, y: G.h - 6, 'text-anchor': 'end' });
  xLabel.textContent = 'fuel mass (t) →';
  const yLabel = svg('text', { class: 'lens-tick-label', x: 4, y: G.t + 8 });
  yLabel.textContent = 'Δv km/s';
  const yTicks = [0, 1, 2, 3].map(() => svg('text', { class: 'lens-tick-label', x: G.l - 4, 'text-anchor': 'end' }));
  graph.append(axisX, axisY, needLine, needLabel, tripLine, tripLabel, curve, dot, dotLabel, xLabel, yLabel, ...yTicks);
  rocket.body.append(graph);

  // ---------- 4. Centre of mass ----------
  const com = card('centerOfMass');
  const S = { w: 150, h: 180, cx: 55, top: 12, bottom: 168 };
  const sil = svg('svg', { class: 'lens-silhouette', viewBox: `0 0 ${S.w} ${S.h}` });
  const silParts = svg('g');
  const comMark = svg('g', { class: 'lens-com' });
  comMark.append(svg('circle', { r: 5, cx: 0, cy: 0 }), svg('line', { x1: -5, x2: 5, y1: 0, y2: 0 }), svg('line', { x1: 0, x2: 0, y1: -5, y2: 5 }));
  const comLabel = svg('text', { class: 'lens-mark-label lens-mark-label--com', x: 0, y: 4 });
  const copMark = svg('polygon', { class: 'lens-cop', points: '0,-6 6,4 -6,4' });
  const copLabel = svg('text', { class: 'lens-mark-label lens-mark-label--cop', x: 0, y: 4 });
  const arrow = svg('path', { class: 'lens-stability-arrow', d: '' });
  sil.append(silParts, arrow, comMark, comLabel, copMark, copLabel);
  const comRow = h('div', 'lens-com-row');
  const comText = h('div', 'lens-com-text');
  comRow.append(sil, comText);
  com.body.append(comRow);

  // ---------- 5. Δv budget ----------
  const budget = card('deltaVBudget');
  const legsEl = h('div', 'lens-budget');
  const track = h('div', 'lens-budget-track');
  const LEG_ORDER = ['ascent', 'transfer', 'landing', 'return'];
  const segs = Object.fromEntries(LEG_ORDER.map((k) => [k, h('div', `lens-seg lens-seg--${k}`)]));
  const have = h('div', 'lens-have');
  const haveLabel = h('div', 'lens-have-label');
  have.append(haveLabel);
  track.append(...LEG_ORDER.map((k) => segs[k]), have);
  const legend = h('div', 'lens-legend');
  const legendRows = Object.fromEntries(LEG_ORDER.map((k) => {
    const row = h('div', 'lens-legend-row');
    const sw = h('span', `lens-swatch lens-seg--${k}`);
    const name = h('span', 'lens-legend-name', k);
    const val = h('span', 'lens-legend-value');
    row.append(sw, name, val);
    legend.append(row);
    return [k, val];
  }));
  legsEl.append(track, legend);
  budget.body.append(legsEl);

  // ---------- update ----------
  function update(spec, b) {
    const s = spec.stats;
    const all = b.parts.map((p) => p.id);
    const structure = all.filter((id) => !b.fuelPartIds.includes(id));
    const dvNeedOne = b.oneWay ?? 0;
    const dvNeedTrip = b.roundTrip ?? (dvNeedOne + (b.dvNeeded?.return ?? 0));

    // 1 weight
    weight.numbers.replaceChildren(variable(`m = ${fmtMass(s.wetMass)}`, all), txt(' · g'));
    const wE = s.wetMass * planets.earth.g, wM = s.wetMass * planets.mars.g;
    weight.result.textContent = `${fmtInt(wE / 1000)} kN on Earth, ${fmtInt(wM / 1000)} kN on Mars (${Math.round((planets.mars.g / planets.earth.g) * 100)} %)`;
    wEarthBar.style.setProperty('--value', '1');
    wMarsBar.style.setProperty('--value', String(planets.mars.g / planets.earth.g));
    wEarthVal.textContent = `${fmtInt(wE / 1000)} kN`;
    wMarsVal.textContent = `${fmtInt(wM / 1000)} kN`;

    // 2 twr
    const thrustSL = s.thrust * (s.ispVac ? s.ispSL / s.ispVac : 1);
    const a = s.wetMass ? thrustSL / s.wetMass - planets.earth.g : 0;
    twr.numbers.replaceChildren(
      txt('a = '), variable(`${fmtInt(thrustSL / 1000)} kN`, b.enginePartIds, 'engine'), txt(' / '), variable(fmtMass(s.wetMass), all), txt(` − ${planets.earth.g}`),
    );
    const state = s.twrEarth < 1 ? 'bad' : s.twrEarth < 1.2 ? 'warn' : 'ok';
    twr.result.textContent = `a = ${a.toFixed(2)} m/s² · TWR ${s.twrEarth.toFixed(2)}`;
    twr.el.dataset.state = state;
    needle.setAttribute('transform', `translate(${gx(s.twrEarth)},14)`);
    ghost.classList.toggle('lens-ghost--lift', s.twrEarth > 1);
    ghostLabel.textContent = s.twrEarth > 1.2 ? 'lifts off' : s.twrEarth > 1 ? 'crawls up' : 'stays on the pad';

    // 3 rocket equation
    rocket.numbers.replaceChildren(
      txt(`Δv = ${fmtInt(s.ispVac)} · ${g0} · ln(`), variable(fmtMass(s.wetMass), all), txt(' / '), variable(fmtMass(s.dryMass), structure), txt(')  ·  '),
      variable(`m_fuel ${fmtMass(s.fuelMass)}`, b.fuelPartIds, 'fuel'), txt('  '), variable(`Isp ${fmtInt(s.ispVac)} s`, b.enginePartIds, 'engine'),
    );
    rocket.result.textContent = `Δv = ${fmtInt(s.deltaV)} m/s`;
    rocket.el.dataset.state = s.deltaV >= dvNeedTrip ? 'ok' : s.deltaV >= dvNeedOne ? 'warn' : 'bad';
    drawGraph(s, dvNeedOne, dvNeedTrip);

    // 4 centre of mass / pressure
    const stable = b.copY < b.comY;
    com.numbers.replaceChildren(
      txt(`CoM ${b.comY.toFixed(2)} m · CoP ${b.copY.toFixed(2)} m · stack ${b.stackHeight.toFixed(1)} m  ·  `),
      variable('fins', b.finPartIds, 'fins'), txt(' pull the CoP back'),
    );
    com.result.textContent = stable ? `STABLE · margin ${(b.comY - b.copY).toFixed(2)} m` : `UNSTABLE · CoP ${(b.copY - b.comY).toFixed(2)} m ahead of CoM`;
    com.el.dataset.state = stable ? 'ok' : 'bad';
    drawSilhouette(b, stable);
    comText.textContent = stable
      ? 'Air pushes on the centre of pressure. Behind the centre of mass it straightens the rocket like the feathers of an arrow.'
      : 'With the centre of pressure ahead, any wobble grows: the tail wants to swap places with the nose. Add fins low on the stack.';

    // 5 budget
    const need = b.dvNeeded ?? {};
    const total = Math.max(dvNeedTrip, s.deltaV, 1) * 1.06;
    for (const k of LEG_ORDER) {
      const v = need[k] ?? 0;
      segs[k].style.width = `${(v / total) * 100}%`;
      legendRows[k].textContent = `${fmtInt(v)} m/s`;
    }
    have.style.left = `${Math.min(100, (s.deltaV / total) * 100)}%`;
    haveLabel.textContent = `you: ${kms(s.deltaV)} km/s`;
    budget.numbers.textContent = `one-way ${kms(dvNeedOne)} km/s · round trip ${kms(dvNeedTrip)} km/s`;
    budget.result.textContent = s.deltaV >= dvNeedTrip ? `${fmtInt(s.deltaV - dvNeedTrip)} m/s spare for the whole trip` : s.deltaV >= dvNeedOne ? `Reaches Mars. ${fmtInt(dvNeedTrip - s.deltaV)} m/s short of coming home (make methane on Mars)` : `${fmtInt(dvNeedOne - s.deltaV)} m/s short of Mars`;
    budget.el.dataset.state = s.deltaV >= dvNeedTrip ? 'ok' : s.deltaV >= dvNeedOne ? 'warn' : 'bad';
  }

  function drawGraph(s, dvNeedOne, dvNeedTrip) {
    const dry = Math.max(1, s.dryMass);
    const ve = (s.ispVac || 1) * g0;
    const fuelMax = Math.max(s.fuelMass * 3, dry * 2.5, 20000);
    const dvAt = (fuel) => ve * Math.log((dry + fuel) / dry);
    const yMax = Math.max(dvAt(fuelMax), dvNeedTrip, 1000) * 1.08;
    const X = (f) => G.l + (f / fuelMax) * (G.w - G.l - G.r);
    const Y = (dv) => G.h - G.b - (dv / yMax) * (G.h - G.t - G.b);
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const f = (fuelMax * i) / 48;
      pts.push(`${i ? 'L' : 'M'}${X(f).toFixed(1)},${Y(dvAt(f)).toFixed(1)}`);
    }
    curve.setAttribute('d', pts.join(' '));
    const fuel = Math.min(fuelMax, Math.max(0, s.fuelMass));
    dot.setAttribute('cx', X(fuel));
    dot.setAttribute('cy', Y(s.deltaV));
    dotLabel.setAttribute('x', Math.min(X(fuel) + 8, G.w - 70));
    dotLabel.setAttribute('y', Math.max(G.t + 12, Y(s.deltaV) - 8));
    dotLabel.textContent = `${kms(s.deltaV)} km/s`;
    needLine.setAttribute('y1', Y(dvNeedOne));
    needLine.setAttribute('y2', Y(dvNeedOne));
    needLabel.setAttribute('y', Y(dvNeedOne) - 3);
    needLabel.textContent = `Mars ${kms(dvNeedOne)}`;
    tripLine.setAttribute('y1', Y(dvNeedTrip));
    tripLine.setAttribute('y2', Y(dvNeedTrip));
    tripLabel.setAttribute('y', Y(dvNeedTrip) - 3);
    tripLabel.textContent = `home ${kms(dvNeedTrip)}`;
    const step = yMax > 9000 ? 3000 : yMax > 5000 ? 2000 : 1000;
    yTicks.forEach((tick, i) => {
      const v = step * (i + 1);
      tick.textContent = v < yMax ? kms(v) : '';
      tick.setAttribute('y', Y(v) + 4);
    });
  }

  function drawSilhouette(b, stable) {
    silParts.replaceChildren();
    const H = Math.max(1, b.stackHeight);
    const scale = (S.bottom - S.top) / H;
    const Yof = (m) => S.bottom - m * scale;
    const parts = [...b.parts].sort((p, q) => (p.attach === 'radial') - (q.attach === 'radial'));
    let side = 0;
    for (const p of parts) {
      const axial = p.attach !== 'radial';
      const hh = Math.max(2, p.height * scale);
      let x, w;
      if (axial) {
        w = p.sideArea > 4 ? 26 : 18;
        x = S.cx - w / 2;
      } else {
        w = 8;
        x = side % 2 === 0 ? S.cx + 15 : S.cx - 23; // alternate sides so the side-mounted parts read as a cluster
        side += 1;
      }
      silParts.append(svg('rect', {
        x, y: axial ? Yof(p.y + p.height) : Yof(p.y) - hh / 2, width: w, height: hh, rx: 1.5,
        class: `lens-sil ${axial ? 'lens-sil--axial' : 'lens-sil--radial'} ${p.fuel ? 'lens-sil--fuel' : ''}`,
      }));
    }
    const yc = Yof(b.comY), yp = Yof(b.copY);
    comMark.setAttribute('transform', `translate(${S.cx + 44},${yc})`);
    comLabel.setAttribute('x', S.cx + 54);
    comLabel.setAttribute('y', yc + 4);
    comLabel.textContent = 'CoM';
    copMark.setAttribute('transform', `translate(${S.cx + 44},${yp})`);
    copLabel.setAttribute('x', S.cx + 54);
    copLabel.setAttribute('y', yp + 4 + (Math.abs(yp - yc) < 12 ? (yp >= yc ? 10 : -10) : 0));
    copLabel.textContent = 'CoP';
    arrow.setAttribute('d', `M${S.cx + 44},${yc} L${S.cx + 44},${yp}`);
    arrow.setAttribute('class', `lens-stability-arrow ${stable ? 'lens-stability-arrow--ok' : 'lens-stability-arrow--bad'}`);
  }

  function dispose() {
    root.remove();
  }

  return { update, dispose };
}
