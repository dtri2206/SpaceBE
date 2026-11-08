// The Launch pad card of the design page (Role 1, the pad section; designPage.js only calls it).
// The pad is the ground hardware under the rocket at a real launch complex. Row 1: the complex (with its own kit and
// climate). Row 2: the eight kinds of ground equipment, each changeable. Below them, plain facts: the heat limit, the
// launch-day forecast and the fees. No hints: the numbers only. Clicking a complex or an option opens the big
// explanation card (ui.openCard); a small CHOOSE button in the row makes the change.
import { padArt } from './sections/pad/art.js';
import { padSetup, kitFee, heatLimitOf, padEffects } from './sections/pad/effects.js';
import { weatherFor } from './weather.js';
import { fmtKN, fmtMoney, fmtMoneyShort } from './format.js';
import launchData from './data/launch.json';
import './designPad.css';

const pct = (x) => `${Math.round(x * 100)} %`;
const deg = (c) => `${Number(c).toFixed(Math.abs(c) < 10 && c % 1 ? 1 : 0)} °C`;
/** A quiet heading over each region's complexes in the list (section.json keeps them region by region). */
export const REGION_NAMES = Object.freeze({
  usa: 'United States', russia: 'Russia and Kazakhstan', europe: 'Europe, at Kourou', china: 'China', japan: 'Japan',
  india: 'India', korea: 'South Korea', brazil: 'Brazil', pacific: 'Pacific Ocean and New Zealand',
});
/** How a clamps option holds the ship: by clamps at full thrust, or (the Soyuz arms) by its own weight. */
const byWeight = (o) => o?.holdBy === 'weight';

/**
 * createPadViews(ui) → { body(view), crumb(view), summary(), artKey(dims), art(dims) }
 * ui: { assembly, sections, h, item, fact, facts, para, prosCons, primary, signed, go, back, state, sound, changed, icons, openCard, g,
 *       toggleFocus, getLast } (the design page's own helpers, so the card looks like the other three)
 */
export function createPadViews(ui) {
  const { assembly, sections, h, item, fact, facts, para, signed, go, back, state, sound, changed, getLast, icons, openCard } = ui;
  const pad = () => sections.pad;
  const setup = () => padSetup(assembly.launch, pad());
  /** The launch day as the last ShipSpec saw it, or computed now (before the first refresh). */
  const now = () => {
    const b = getLast()?.breakdown;
    const weather = b?.weather?.complex === setup().complex?.id ? b.weather : weatherFor(assembly.launch, { pad: pad(), launchData });
    const fx = b?.padFx && b.padFx.complex?.id === setup().complex?.id ? b.padFx : padEffects(assembly.launch, { pad: pad(), weather, thrustSL: b?.thrustSL ?? 0, g: ui.g ?? null });
    return { weather, fx };
  };
  const artState = (complex, choices, tempC) => ({ site: complex, slot: { tempC }, equipment: choices });

  // ---------- pictures: the pad art, rendered small ----------
  const complexIcon = (c) => icons?.objectIcon?.(`pad:${c.id}`, () => padArt(artState(c, padSetup({ site: c.id }, pad()).choices, 10), { radius: 1.25, height: 14, icon: true }).object, { pad: 1.02 }) ?? '';
  const equipIcon = (key, o) => icons?.objectIcon?.(`padeq:${key}:${o.id}`, () => {
    const eqs = [{ eq: { key }, option: o }];
    return padArt({ site: null, slot: { tempC: 10 }, equipment: eqs }, { radius: 1.25, height: 14, icon: true, only: key }).object;
  }, { pad: 1.05 }) ?? '';

  // ---------- what one option does, in numbers ----------
  function effectLine(key, o, complex) {
    const st = setup();
    if (key === 'mount') return `Takes ${fmtKN(heatLimitOf({ ...st, complex, choices: swap(st.choices, 'mount', o) }) * 1000)} here`;
    if (key === 'deluge' && o.heatF > 1) return `The pad takes ${fmtKN(heatLimitOf({ ...st, complex, choices: swap(st.choices, 'deluge', o) }) * 1000)} · ${pct(o.acousticF)} of the roar`;
    if (key === 'deluge') return `The pad takes ${fmtKN(heatLimitOf({ ...st, complex, choices: swap(st.choices, 'deluge', o) }) * 1000)} · the full roar`;
    if (key === 'clamps' && byWeight(o)) return `Hangs by its weight ${o.holdS} s · finds about ${pct(o.catch)} of bad engines`;
    if (key === 'clamps') return o.catch ? `Holds ${o.holdS} s · finds about ${pct(o.catch)} of bad engines` : 'Lets go at once';
    if (key === 'tower') return o.id === 'none' ? 'Nothing reaches the upper ship' : `Reliability +${(o.reliability * 100).toFixed(1)} %`;
    if (key === 'lightning') return o.strikeF < 1 ? `Stops about ${pct(1 - o.strikeF)} of strikes on the ship` : 'The ship is the tallest thing around';
    if (key === 'access') return o.escape ? `Crew gets off the pad: about ${pct(o.escape)}` : 'The escape rocket is the only way out';
    if (key === 'propellant') return `A day of waiting: ${fmtMoneyShort(Math.round((complex?.holdFee ?? 0) * (o.holdF ?? 1)))}`;
    if (key === 'weather') return `Forecast good to ±${o.errorC} °C`;
    return '';
  }
  const swap = (choices, key, option) => choices.map((c) => (c.eq.key === key ? { ...c, option } : c));
  function effectFacts(key, o, complex) {
    const st = setup();
    const rows = [];
    if (key === 'mount' || key === 'deluge') {
      rows.push(fact('Heat limit at this complex', fmtKN(heatLimitOf({ ...st, complex, choices: swap(st.choices, key, o) }) * 1000)));
      if (key === 'deluge') rows.push(fact('Roar reaching the ship', pct(o.acousticF)));
    }
    if (key === 'clamps') rows.push(byWeight(o) ? fact('Engines run before the lift', `${o.holdS} s, the ship held by its weight`) : fact('Held at full thrust', o.holdS ? `${o.holdS} s` : 'no'), fact('Bad engines found on the pad', o.catch ? `about ${pct(o.catch)}` : 'none'));
    if (key === 'lightning') rows.push(fact('Strikes that reach the ship', pct(o.strikeF)));
    if (key === 'access') rows.push(fact('Crew gets away from a pad emergency', o.escape ? `about ${pct(o.escape)}` : 'escape rocket only'));
    if (key === 'propellant') rows.push(fact('A day of waiting', fmtMoney(Math.round((complex?.holdFee ?? 0) * (o.holdF ?? 1)))));
    if (key === 'weather') rows.push(fact('Forecast good to', `±${o.errorC} °C`));
    if (o.reliability) rows.push(fact('Reliability', signed(o.reliability * 100, (n) => `${n.toFixed(1)} %`)));
    rows.push(fact('Fee', o.fee ? fmtMoney(o.fee) : 'free'));
    if (complex?.kit?.[key] === o.id) rows.push(fact(`Standard at ${complex.name}`, 'yes'));
    return facts(...rows);
  }

  /**
   * A row of a list: clicking it opens the big explanation card (with a CHOOSE action on the card), and a small CHOOSE
   * button beside it makes the change at once. Uses the design page's item() `onOpen` / `quick`; if that page has no
   * quick button, adds one itself.
   */
  function choice({ id, isOn, card, onPick, ...rest }) {
    const action = isOn ? undefined : { kind: 'choose', run: onPick, tool: 'choose' };
    const open = () => { sound('ui.click'); openCard?.({ ...card, ...(action ? { action } : {}) }); };
    const el = item({ id, on: isOn, tag: isOn ? { text: 'CHOSEN', kind: 'on' } : null, onOpen: open, onToggle: open, quick: isOn ? null : { label: 'CHOOSE', run: onPick, tool: 'choose' }, ...rest });
    return isOn || el.querySelector('.vd-quick') ? el : withPick(el, onPick);
  }
  function withPick(el, onPick) {
    el.classList.add('vp-pickable');
    const b = h('button', 'vp-pick', 'CHOOSE');
    b.type = 'button';
    b.dataset.tool = 'choose';
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(); });
    el.append(b);
    return el;
  }
  const done = () => { sound('ui.snap'); state.focus = null; changed(); };

  // ---------- views ----------
  function home() {
    const st = setup();
    const { weather, fx } = now();
    const c = st.complex;
    const out = [];
    if (!c) return [para('No launch complex in the data.', 'vd-muted')];
    const where = h('div', 'vd-block');
    where.append(h('div', 'vd-label', '1 · Launch complex'));
    where.append(item({ id: 'complex', img: complexIcon(c), name: c.name, sub: `${c.place} · ${c.rockets}`, price: fmtMoneyShort(fx.fee - (fx.feeParts?.hold ?? 0) - (fx.feeParts?.repairDue ?? 0)), onToggle: () => { sound('ui.click'); go({ view: 'complexes' }); } }));
    out.push(where);
    const eqBox = h('div', 'vd-block');
    eqBox.append(h('div', 'vd-label', '2 · Ground equipment'));
    for (const { eq, option } of st.choices) eqBox.append(item({ id: `eq:${eq.key}`, img: equipIcon(eq.key, option), name: eq.name, sub: option.name, price: option.fee ? fmtMoneyShort(option.fee) : 'free', onToggle: () => { sound('ui.click'); go({ view: 'equipment', key: eq.key }); } }));
    out.push(eqBox);
    const day = h('div', 'vd-block');
    day.append(h('div', 'vd-label', 'Launch day'));
    day.append(facts(
      fact('Forecast', `${weather.when} · ${deg(weather.forecastC)} · wind ${weather.windKts} kt`),
      fact('Sky', `${weather.label} · lightning ${pct(weather.lightning)}`),
      fact('Heat limit of the pad', `takes ${fmtKN(fx.heatLimitKN * 1000)}`),
      fact('Launch fees, paid at confirm', fmtMoney(getLast()?.breakdown.launchFee ?? fx.fee)),
      weather.fee > 0 ? fact(`Waiting so far (${weather.day} day${weather.day > 1 ? 's' : ''})`, fmtMoney(weather.fee)) : null,
    ));
    out.push(day);
    return out;
  }

  function complexes() {
    const cur = setup().complex;
    const out = [para('Real launch complexes, past and present. Each comes with its own ground equipment and its own weather; any piece can be changed afterwards.', 'vd-muted')];
    let region = null;
    for (const c of pad().sites) {
      if (c.region && c.region !== region) { region = c.region; out.push(h('div', 'vp-region', REGION_NAMES[region] ?? region)); }
      const isOn = c.id === cur?.id;
      const limit = heatLimitOf(padSetup({ site: c.id }, pad()));
      const w = isOn ? now().weather : weatherFor({ site: c.id, seed: assembly.launch?.seed }, { pad: pad(), launchData });
      out.push(choice({
        id: c.id, isOn, img: complexIcon(c), name: c.name, sub: `takes ${fmtKN(limit * 1000)} · ${deg(w.forecastC)} · ${c.place}${c.years ? ` · ${c.years}` : ''}`, price: fmtMoneyShort(kitFee(c, pad())),
        card: { kind: 'pad', pad: { ...c, heatLimitKN: Math.round(limit) } },
        onPick: () => { assembly.setLaunch({ site: c.id, complex: undefined, slot: undefined, forecast: undefined, day: 0, pad: {} }); done(); },
      }));
    }
    return out;
  }

  function equipment(key) {
    const st = setup();
    const c = st.choices.find((x) => x.eq.key === key);
    if (!c) { back(); return []; }
    const head = h('button', 'vp-eqhead');
    head.type = 'button';
    const im = h('img', 'vd-item-img');
    im.src = equipIcon(key, c.option);
    im.alt = '';
    im.draggable = false;
    const txt = h('span', 'vp-eqhead-txt');
    txt.append(h('span', 'vd-item-name', c.eq.name), h('span', 'vd-role', c.eq.role ?? ''));
    head.append(im, txt);
    head.addEventListener('click', () => { sound('ui.click'); openCard?.({ kind: 'equip', key }); });
    const out = [head];
    for (const o of c.eq.options) {
      out.push(choice({
        id: o.id, isOn: o.id === c.option.id, img: equipIcon(key, o), name: o.name, sub: effectLine(key, o, st.complex), price: o.fee ? fmtMoneyShort(o.fee) : 'free',
        card: { kind: 'equip', key, option: o },
        onPick: () => { assembly.setPadOption(key, o.id); done(); },
      }));
    }
    // the numbers of the piece in use, for this ship at this complex
    const now0 = h('div', 'vd-block');
    now0.append(h('div', 'vd-label', `In use · ${c.option.name}`), effectFacts(key, c.option, st.complex));
    out.push(now0);
    return out;
  }

  return {
    /** The card's body for the current view ({ view: 'home' } or one of this card's own views). */
    body(v) {
      if (v.view === 'complexes') return complexes();
      if (v.view === 'equipment') return equipment(v.key);
      return home();
    },
    /** Breadcrumb name of a view of this card. */
    crumb(v) {
      if (v.view === 'complexes') return 'Launch complex';
      if (v.view === 'equipment') return pad().equipment?.find((e) => e.key === v.key)?.name ?? 'Equipment';
      return '';
    },
    /** The one-line summary on the closed card: { line, built, img }. */
    summary() {
      const c = setup().complex;
      if (!c) return { line: 'No launch complex', built: false, img: null };
      const { weather, fx } = now();
      return { line: `${c.name} · ${deg(weather.forecastC)} · ${fmtMoneyShort(getLast()?.breakdown.launchFee ?? fx.fee)}`, built: true, img: complexIcon(c) || null };
    },
    /** A key that changes whenever the pad art must be redrawn; dims: { radius, height } of the ship. */
    artKey({ radius, height }) {
      const st = setup();
      return `${st.complex?.id}:${st.choices.map((c) => c.option?.id).join(',')}:${now().weather.forecastC < 0 ? 'snow' : ''}:${radius.toFixed(2)}:${height.toFixed(1)}`;
    },
    /** The pad's 3D art under a ship of these dims ({ radius, height, layout }). */
    art(dims) {
      const st = setup();
      return padArt(artState(st.complex, st.choices, now().weather.forecastC), dims);
    },
  };
}
