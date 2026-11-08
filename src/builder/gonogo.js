// Go / No-Go evaluation (spec §5.5). Pure JS. Text comes from data/text.json so Role 4 can rewrite every line.
// The consoles speak like flight controllers (src/builder/CLAUDE.md §6): no design numbers and no fixes, a soft word
// when a margin is thin ("Margins are thin."), NO-GO for each warning, BLOCK for each hard block. The weather console
// still names the temperature at the pad (the Challenger lesson needs it), and the bill is in money.
import { fmtInt, fmtMoney } from './format.js';

// Launch commit criteria for the weather console (not contract WARNINGS, so they never enter spec.warnings): NO-GO,
// overridable, with thunderstorms near the pad (NASA's lightning rules hold a launch for storms within about 10 nautical
// miles; weather.js lightning ≥ 0.3 is "thunderstorms about") or ground winds over 30 kt (Falcon 9's published
// ground-wind limit at liftoff is about 30 kt, TODO verify).
export const WEATHER_RULES = Object.freeze({ lightning: 0.3, windKts: 30 });
/** The weather calls of a launch day: ['lightning', 'wind'] or fewer. */
export function weatherCalls(weather) {
  const out = [];
  if ((weather?.lightning ?? 0) >= WEATHER_RULES.lightning) out.push('lightning');
  if ((weather?.windKts ?? 0) > WEATHER_RULES.windKts) out.push('wind');
  return out;
}

// When a console that says GO still sounds a little worried (text.json gonogo.thin). Game judgement, not rules.
export const THIN = Object.freeze({ dv: 1.025, twr: 1.3, stability: 0.02, reliability: 0.88, coldC: 10, budget: 0.85 });

/**
 * evaluate(spec, { blocks, money, fee, extra, price, text, oneWay, roundTrip, breakdown })
 *   blocks  hard blocks from stats.computeShipSpec (OVER_BUDGET is added here)
 *   money   the agency's funds; fee the launch fees (pad, site, days on HOLD, repairs due); extra other fees owed
 *           (new units fitted after a test or a scrub); price what the vehicle costs this time (spec.stats.cost, or the
 *           refurbishment fee of a ship that came home)
 *   breakdown (optional) lets the guidance console judge the stability margin
 * → { blocks, warnings, calls, lines, total, vehicle, fee, extra, canConfirm, needsOverride }
 *   calls: the weather console's own NO-GO calls (lightning, wind), overridable like warnings
 *   lines: [{ console, consoleId, status: 'GO' | 'NO-GO' | 'BLOCK', text, guidebook, problem, thin }] in console order
 */
export function evaluate(spec, { blocks = [], money = 0, fee = 0, extra = 0, price = null, text, oneWay = 0, roundTrip = 0, breakdown = null }) {
  const vehicle = Number.isFinite(price) ? price : spec.stats.cost;
  const total = vehicle + fee + extra;
  const allBlocks = [...blocks];
  if (total > money) allBlocks.push('OVER_BUDGET');
  const warnings = [...(spec.warnings ?? [])];
  const weather = breakdown?.weather ?? null;
  const calls = weatherCalls(weather);

  const vars = {
    deltaV: fmtInt(spec.stats.deltaV), needed: fmtInt(oneWay), neededRoundTrip: fmtInt(roundTrip),
    twrEarth: spec.stats.twrEarth.toFixed(2), twrMars: spec.stats.twrMars.toFixed(2),
    tempC: fmtInt(spec.launch?.tempC ?? 15).replace('-', '−'), // a real minus sign, as on the board reliability: fmtInt(spec.stats.reliability * 100),
    cost: fmtMoney(total), money: fmtMoney(money), spareO2Tanks: String(spec.stats.spareO2Tanks), shipName: spec.name ?? 'Ship',
    windKts: fmtInt(weather?.windKts ?? 0),
  };
  const fill = (s) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const thin = thinConsoles(spec, { oneWay, breakdown, total, money });

  const problems = { ...(text.gonogo.calls ?? {}), ...(text.gonogo.problems ?? {}) };
  const lines = [];
  for (const console of text.gonogo.consoles ?? []) {
    const here = [
      ...allBlocks.filter((id) => problems[id]?.console === console.id).map((id) => ({ id, status: 'BLOCK' })),
      ...[...warnings, ...calls].filter((id) => problems[id]?.console === console.id).map((id) => ({ id, status: 'NO-GO' })),
    ];
    if (!here.length) {
      const soft = thin.has(console.id) ? text.gonogo.thin?.[console.id] : null;
      lines.push({ console: console.name, consoleId: console.id, status: 'GO', text: fill(soft ?? text.gonogo.go?.[console.id] ?? 'GO.'), guidebook: null, problem: null, thin: !!soft });
      continue;
    }
    for (const { id, status } of here) {
      lines.push({ console: console.name, consoleId: console.id, status, text: fill(problems[id].text), guidebook: problems[id].guidebook ?? null, problem: id });
    }
  }
  // Problems whose console is unknown still get a line, so nothing is silently hidden.
  for (const id of [...allBlocks, ...warnings]) {
    if (!problems[id] || (text.gonogo.consoles ?? []).some((c) => c.id === problems[id].console)) continue;
    lines.push({ console: 'FLIGHT DIRECTOR', consoleId: 'other', status: allBlocks.includes(id) ? 'BLOCK' : 'NO-GO', text: fill(problems[id].text), guidebook: problems[id].guidebook ?? null, problem: id });
  }
  for (const id of [...allBlocks, ...warnings]) {
    if (problems[id]) continue;
    lines.push({ console: 'FLIGHT DIRECTOR', consoleId: 'other', status: allBlocks.includes(id) ? 'BLOCK' : 'NO-GO', text: id.replace(/_/g, ' ').toLowerCase(), guidebook: null, problem: id });
  }

  return { blocks: allBlocks, warnings, calls, lines, total, vehicle, fee, extra, canConfirm: allBlocks.length === 0, needsOverride: allBlocks.length === 0 && warnings.length + calls.length > 0 };
}

/** The consoles that say GO but sound a little worried. */
export function thinConsoles(spec, { oneWay = 0, breakdown = null, total = 0, money = 0 } = {}) {
  const s = spec.stats;
  const out = new Set();
  if ((oneWay > 0 && s.deltaV < oneWay * THIN.dv) || s.twrEarth < THIN.twr) out.add('propulsion');
  if (breakdown && Number.isFinite(breakdown.stabilityMargin) && breakdown.stabilityMargin < THIN.stability) out.add('guidance');
  if (s.hasHeatShield && s.heatShieldDamaged) out.add('thermal'); // chipped tiles: "they always are" (Columbia)
  if (!s.hasParachute) out.add('recovery');
  if (s.spareO2Tanks === 1) out.add('life');
  if ((spec.launch?.tempC ?? 15) < THIN.coldC) out.add('weather');
  if (s.reliability < THIN.reliability) out.add('quality');
  if (money > 0 && total > money * THIN.budget) out.add('budget');
  if ((breakdown?.padFx?.excess ?? 0) > 0) out.add('pad'); // more thrust than the pad takes: a slow start, debris, repairs
  return out;
}

/**
 * HOLD: wait one more day. weather is weatherFor's result (weather.js): the day waited is paid through its `fee`
 * (holdFee × day) in the launch fees at confirm, so nothing is spent here.
 * → { patch for assembly.setLaunch, day, fee (what one more day adds) }
 */
export function holdPlan(launch, weather) {
  const day = (Number.isFinite(weather?.day) ? weather.day : Number(launch?.day) || 0) + 1;
  return { patch: { day }, day, fee: Math.max(0, weather?.holdFee ?? 0) };
}

/** Sum of fees owed and not yet paid ([{ amount }]). */
export const owed = (list) => (list ?? []).reduce((t, x) => t + (Number(x?.amount) || 0), 0);
