// Debris conjunction panel: drawn over the cockpit's centre display while the debris dodge window is active.
// Plane perpendicular to the velocity, ship at the centre (x = orbit normal →, y = radial ↑). Red circles = where each
// piece will be relative to the ship at its closest approach (radius = danger radius); the cyan ○ is the thrust command.
//
//   const panel = createConjunctionPanel({ parent });
//   panel.update(readout | null, rect | null, callout);   // readout = createDebrisWindow().readout(); rect in CSS px
//   panel.dispose();
const NS = 'http://www.w3.org/2000/svg';
const CYAN = '#72e6e0', AMBER = '#ffbe75', RED = '#ff6978';
const HORIZON = 20; // s: pieces fade in as they come within this time

export function createConjunctionPanel({ parent = document.body } = {}) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;display:none;pointer-events:none;overflow:hidden;box-sizing:border-box;border:1px solid #72e6e066;background:rgba(4,14,18,0.985);color:#d8eff1;font:12px/1.4 ui-monospace,monospace;container-type:size';
  el.innerHTML = `<div style="position:absolute;inset:0">
<div data-id="label" style="position:absolute;left:3%;top:2%;color:${CYAN};letter-spacing:.14em;font-size:max(9px,3.4cqh)"></div>
<div data-id="time" style="position:absolute;right:3%;top:2%;color:${AMBER};letter-spacing:.1em;font-size:max(9px,3.4cqh)"></div>
<div data-id="callout" style="position:absolute;left:3%;right:3%;top:6.2%;color:${AMBER};font-size:max(8px,3cqh);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
<svg data-id="svg" viewBox="-1 -1 2 2" preserveAspectRatio="xMidYMid meet" style="position:absolute;left:0;top:10%;width:100%;height:68%"></svg>
<div data-id="scale" style="position:absolute;right:3%;top:10.5%;color:#8daeb8;font-size:max(8px,2.8cqh)"></div>
<div data-id="stats" style="position:absolute;left:3%;right:3%;top:80%;color:${CYAN};font-size:max(9px,3.4cqh);letter-spacing:.06em"></div>
<div data-id="msg" style="position:absolute;left:0;right:0;top:87%;text-align:center;font-size:max(10px,4cqh);letter-spacing:.12em;color:${AMBER}">DODGE · keep the centre clear</div>
<div style="position:absolute;left:0;right:0;bottom:1.5%;text-align:center;color:#8daeb8;font-size:max(8px,2.8cqh);letter-spacing:.08em">move ○ to a clear gap · F · give it back to the computer</div>
</div>`;
  parent.append(el);
  const q = (id) => el.querySelector(`[data-id=${id}]`);
  const svg = q('svg');
  const mk = (tag, attrs, into = svg) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); into.append(n); return n; };
  const ns = { fill: 'none', 'vector-effect': 'non-scaling-stroke' };
  mk('rect', { x: -1, y: -1, width: 2, height: 2, stroke: '#72e6e044', 'stroke-width': 1, ...ns });
  for (const r of [1 / 3, 2 / 3, 1]) mk('circle', { r, stroke: '#72e6e028', 'stroke-width': 1, ...ns });
  mk('line', { x1: -1, y1: 0, x2: 1, y2: 0, stroke: '#72e6e044', 'stroke-width': 1, ...ns });
  mk('line', { x1: 0, y1: -1, x2: 0, y2: 1, stroke: '#72e6e044', 'stroke-width': 1, ...ns });
  const dyn = mk('g', {});
  const piecesG = mk('g', {}, dyn);
  const ship = mk('g', {}, dyn);
  mk('path', { d: 'M0 -0.07 L0.055 0.05 L-0.055 0.05 Z', fill: AMBER, stroke: '#000', 'stroke-width': 0.5, 'vector-effect': 'non-scaling-stroke' }, ship);
  const link = mk('line', { x1: 0, y1: 0, x2: 0, y2: 0, stroke: CYAN, 'stroke-width': 1, 'stroke-dasharray': '4 4', ...ns }, dyn);
  const aim = mk('circle', { r: 0.06, stroke: CYAN, 'stroke-width': 2.5, ...ns }, dyn);
  const count = mk('text', { fill: '#fff', 'font-size': 0.085, 'font-family': 'ui-monospace,monospace' }, dyn);
  const circles = [];
  let shown = false;
  return {
    update(readout, rect, callout = null) {
      if (!readout) { if (shown) { el.style.display = 'none'; shown = false; } return; }
      shown = true;
      el.style.display = 'block';
      let r = rect;
      if (!r || !(r.width > 40 && r.height > 40)) {
        const h = window.innerHeight * 0.6;
        r = { left: (window.innerWidth - h) / 2, top: (window.innerHeight - h) / 2, width: h, height: h };
      }
      el.style.left = `${r.left}px`; el.style.top = `${r.top}px`; el.style.width = `${r.width}px`; el.style.height = `${r.height}px`;
      q('callout').textContent = callout ? `MISSION CONTROL · ${callout}` : '';
      q('label').textContent = readout.label ?? '';
      q('time').textContent = `${Math.ceil(readout.timeLeft)} s`;
      q('scale').textContent = `±${readout.range} m`;
      q('stats').textContent = `Δv ${readout.dv.toFixed(1)} m/s · passed ${readout.passed}/${readout.total} · hits ${readout.hits}`;
      const R = readout.range;
      const list = readout.pieces;
      while (circles.length < list.length) circles.push(mk('circle', { fill: '#ff697833', 'vector-effect': 'non-scaling-stroke' }, piecesG));
      circles.forEach((c, i) => {
        const p = list[i];
        if (!p) { c.style.display = 'none'; return; }
        const k = Math.max(0, Math.min(1, 1 - p.t / HORIZON)); // 0 far in time → 1 arriving
        const rad = Math.max(0.035, p.danger / R) * (0.6 + 0.4 * k);
        c.style.display = '';
        c.setAttribute('cx', p.x / R); c.setAttribute('cy', -p.y / R); c.setAttribute('r', rad);
        c.setAttribute('stroke', RED); c.setAttribute('stroke-width', 1 + 1.5 * k);
        c.setAttribute('opacity', (0.3 + 0.7 * k).toFixed(2));
      });
      const near = list[0];
      if (near) { count.style.display = ''; count.setAttribute('x', near.x / R + 0.07); count.setAttribute('y', -near.y / R - 0.07); count.textContent = `${near.t.toFixed(1)} s`; }
      else count.style.display = 'none';
      aim.setAttribute('cx', readout.aim.x); aim.setAttribute('cy', -readout.aim.y);
      link.setAttribute('x2', readout.aim.x); link.setAttribute('y2', -readout.aim.y);
    },
    dispose() { el.remove(); },
  };
}
