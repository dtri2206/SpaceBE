// Engine workbench (spec §5.2): chamber (fuel) + nozzle + turbopump, with live stats and the formulas behind them.
import { fmtInt, fmtKN, fmtMass, fmtMoney } from './format.js';

const h = (tag, className, textContent) => Object.assign(document.createElement(tag), { className: className ?? '', textContent: textContent ?? '' });

export function createWorkbench({ parent, engines, current, compute, onApply, onClose }) {
  const def = { fuel: current?.fuel ?? 'methalox', nozzle: current?.nozzle ?? 'vac', pump: current?.pump ?? 'M' };
  const start = compute({ ...def });
  const root = h('div', 'wb-root');
  parent.append(root);

  const rows = {};
  const row = (label, key, options, describe) => {
    const el = h('div', 'wb-row');
    el.append(h('span', 'hud-label wb-row-label', label));
    const group = h('div', 'wb-choices');
    const buttons = Object.entries(options).map(([id, opt]) => {
      const b = h('button', 'wb-choice');
      b.type = 'button';
      b.dataset.value = id;
      b.append(h('span', 'wb-choice-name', opt.name ?? id), h('span', 'wb-choice-meta', describe(id, opt)));
      b.setAttribute('aria-pressed', String(def[key] === id));
      b.addEventListener('click', () => {
        def[key] = id;
        buttons.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === id)));
        render();
      });
      return b;
    });
    group.append(...buttons);
    el.append(group);
    root.append(el);
    rows[key] = el;
  };
  row('Chamber', 'fuel', engines.fuels, (id, f) => `Isp ${f.isp.sl[0]}–${f.isp.vac[1]} s · ${fmtMoney(f.chamberCost)}`);
  row('Nozzle', 'nozzle', engines.nozzles, (id, n) => `${fmtMass(n.mass)} · ${fmtMoney(n.cost)}`);
  row('Turbopump', 'pump', engines.pumps, (id, p) => `${fmtKN(p.thrust)} · ${fmtMass(p.mass)} · ${fmtMoney(p.cost)}`);

  const stats = h('div', 'wb-stats');
  const formulas = h('div', 'wb-formulas');
  const note = h('div', 'wb-note');
  const delta = h('div', 'wb-delta');
  const actions = h('div', 'bld-dialog-actions');
  const cancel = h('button', 'hud-button', 'CANCEL');
  cancel.type = 'button';
  cancel.addEventListener('click', () => onClose?.());
  const apply = h('button', 'hud-button hud-good', 'APPLY');
  apply.type = 'button';
  apply.addEventListener('click', () => onApply?.({ ...def }));
  actions.append(cancel, apply);
  root.append(stats, formulas, note, delta, actions);

  const stat = (label, value, state = 'ok') => {
    const el = h('div', 'bld-stat');
    el.dataset.state = state;
    el.append(h('span', 'bld-stat-label', label), h('span', 'bld-stat-value', value));
    return el;
  };
  const line = (formula, numbers) => {
    const el = h('div', 'wb-formula');
    el.append(h('span', 'wb-formula-symbolic', formula), h('span', 'wb-formula-numbers', numbers));
    return el;
  };

  function render() {
    const s = compute({ ...def });
    const slLoss = 1 - s.thrustSL / s.thrust;
    stats.replaceChildren(
      stat('Thrust vacuum', fmtKN(s.thrust)),
      stat('Thrust sea level', fmtKN(s.thrustSL), slLoss > 0.3 ? 'warn' : 'ok'),
      stat('Isp sea level / vacuum', `${fmtInt(s.ispSL)} / ${fmtInt(s.ispVac)} s`),
      stat('Engine mass', fmtMass(s.mass)),
      stat('Engine cost', fmtMoney(s.cost)),
      stat('Fuel flow at 100 %', `${s.mdotVac.toFixed(1)} kg/s`),
    );
    formulas.replaceChildren(
      line('v_e = Isp · g0', `vacuum ${fmtInt(s.ispVac)} s → ${fmtInt(s.veVac)} m/s · sea level ${fmtInt(s.ispSL)} s → ${fmtInt(s.veSL)} m/s`),
      line('ṁ = F / v_e', `${fmtInt(s.thrust)} N / ${fmtInt(s.veVac)} m/s = ${s.mdotVac.toFixed(1)} kg/s of propellant`),
      line('F = ṁ·v_e + (p_e − p_a)·A_e', def.nozzle === 'vac'
        ? `A long bell expands the exhaust to near-vacuum pressure. At sea level the air (p_a) pushes back and the flow separates: thrust drops ${Math.round(slLoss * 100)} %.`
        : `A short bell leaves the exhaust at about 1 atm. Perfect on the pad; in vacuum it wastes the last bit of expansion, so Isp stays at ${fmtInt(s.ispVac)} s instead of ${fmtInt(engines.fuels[def.fuel].isp.vac[1])} s.`),
    );
    note.textContent = `${engines.fuels[def.fuel]?.special ?? ''} ${engines.nozzles[def.nozzle]?.note ?? ''} A ${def.pump} pump at full throttle overheats at ${s.heatRate}/s: throttle down on long burns.`;
    const dMass = s.mass - start.mass, dCost = s.cost - start.cost, dThrust = s.thrust - start.thrust;
    delta.textContent = dMass || dCost || dThrust
      ? `vs current engine: ${dThrust >= 0 ? '+' : ''}${fmtKN(dThrust)}, ${dMass >= 0 ? '+' : ''}${fmtMass(dMass)}, ${dCost >= 0 ? '+' : ''}${fmtMoney(dCost)}`
      : 'This is the engine already installed.';
  }
  render();

  return { dispose: () => root.remove() };
}
