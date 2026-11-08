// Manual-control aim panel: drawn over the cockpit's centre display while the player holds the stick.
// Shows the angular frame (±range°), the moving target +, the aim ○ (radius = tolerance) and the ship's real nose.
//
//   const panel = createManualAimPanel({ parent });
//   panel.update(readout | null, rect | null);   // rect = { left, top, width, height } in CSS px (null = centred square)
//   panel.dispose();
import manual from '../manualControl.json' with { type: 'json' };

const NS = 'http://www.w3.org/2000/svg';
const CYAN = '#72e6e0', AMBER = '#ffbe75', GREEN = '#7dffa8';

export function createManualAimPanel({ parent = document.body } = {}) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;display:none;pointer-events:none;overflow:hidden;box-sizing:border-box;border:1px solid #72e6e066;background:rgba(4,14,18,0.985);color:#d8eff1;font:12px/1.4 ui-monospace,monospace;container-type:size';
  el.innerHTML = `<style>
@keyframes manual-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.manual-aim-panel .lock{animation:manual-pulse .7s infinite}
</style>
<div class="manual-aim-panel" style="position:absolute;inset:0">
<div data-id="label" style="position:absolute;left:3%;top:2%;color:${CYAN};letter-spacing:.14em;font-size:max(9px,3.4cqh)"></div>
<div data-id="time" style="position:absolute;right:3%;top:2%;color:${AMBER};letter-spacing:.1em;font-size:max(9px,3.4cqh)"></div>
<div data-id="callout" style="position:absolute;left:3%;right:3%;top:6.2%;color:${AMBER};font-size:max(8px,3cqh);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
<svg data-id="svg" viewBox="-1 -1 2 2" preserveAspectRatio="xMidYMid meet" style="position:absolute;left:0;top:10%;width:100%;height:67%"></svg>
<div style="position:absolute;left:3%;right:3%;top:79%;height:3.4cqh;border:1px solid #72e6e055"><div data-id="bar" style="height:100%;width:0;background:${CYAN}"></div></div>
<div data-id="acc" style="position:absolute;left:3%;top:83.5%;color:${CYAN};font-size:max(9px,3.4cqh)"></div>
<div data-id="msg" style="position:absolute;left:0;right:0;top:88%;text-align:center;font-size:max(10px,4cqh);letter-spacing:.14em"></div>
<div style="position:absolute;left:0;right:0;bottom:1.5%;text-align:center;color:#8daeb8;font-size:max(8px,2.8cqh);letter-spacing:.08em">ESC · give it back to the computer</div>
</div>`;
  el.classList.add('manual-aim-root');
  parent.append(el);
  const q = (id) => el.querySelector(`[data-id=${id}]`);
  const svg = q('svg');
  const R = manual.rangeDeg, tol = manual.toleranceDeg;
  const px = (deg) => deg / R; // −1..1 in the svg frame (x right, y up → flipped on draw)
  const mk = (tag, attrs, into = svg) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); into.append(n); return n; };
  const stroke = { fill: 'none', 'vector-effect': 'non-scaling-stroke' };

  // static grid: ±10° frame, ticks every 5°, centre cross
  mk('rect', { x: -1, y: -1, width: 2, height: 2, stroke: '#72e6e044', 'stroke-width': 1, ...stroke });
  for (const d of [-R, -R / 2, 0, R / 2, R]) {
    const v = px(d);
    mk('line', { x1: v, y1: -1, x2: v, y2: 1, stroke: d === 0 ? '#72e6e055' : '#72e6e022', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
    mk('line', { x1: -1, y1: v, x2: 1, y2: v, stroke: d === 0 ? '#72e6e055' : '#72e6e022', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  }
  const dyn = mk('g', {});
  const target = mk('g', { stroke: '#ffffff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, dyn);
  const tl = 0.12;
  mk('line', { x1: -tl, y1: 0, x2: tl, y2: 0, stroke: '#fff', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }, target);
  mk('line', { x1: 0, y1: -tl, x2: 0, y2: tl, stroke: '#fff', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }, target);
  const aim = mk('circle', { r: px(tol), stroke: CYAN, 'stroke-width': 2.5, ...stroke }, dyn);
  const nose = mk('path', { d: 'M0 -0.06 L0.05 0.04 L-0.05 0.04 Z', fill: AMBER, stroke: '#000', 'stroke-width': 0.5, 'vector-effect': 'non-scaling-stroke' }, dyn);

  const place = (node, o) => {
    const x = Math.max(-1.2, Math.min(1.2, px(o.yawDeg))), y = -Math.max(-1.2, Math.min(1.2, px(o.pitchDeg)));
    node.setAttribute('transform', `translate(${x} ${y})`);
  };
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
      place(target, readout.target); place(aim, readout.aim);
      nose.style.display = readout.nose ? '' : 'none';
      if (readout.nose) place(nose, readout.nose);
      q('bar').style.width = `${Math.round(readout.accuracy * 100)}%`;
      q('acc').textContent = `ACCURACY ${Math.round(readout.accuracy * 100)} %`;
      const msg = q('msg');
      msg.textContent = readout.lockReady ? 'LOCK READY · SPACE or CLICK' : 'Keep ○ on +';
      msg.style.color = readout.lockReady ? GREEN : AMBER;
      msg.classList.toggle('lock', !!readout.lockReady);
    },
    dispose() { el.remove(); },
  };
}
