// Go / No-Go evaluation (spec §5.5). Pure JS. Text comes from data/text.json so Role 4 can rewrite every line.
import { fmtInt, fmtMoney } from './format.js';

/**
 * evaluate(spec, { blocks, money, fee, text })
 *   blocks  hard blocks from stats.computeShipSpec (OVER_BUDGET is added here)
 *   money   the agency's funds; fee the launch-slot fee
 * → { blocks, warnings, lines, total, canConfirm, needsOverride }
 *   lines: [{ console, consoleId, status: 'GO' | 'NO-GO' | 'BLOCK', text, guidebook, problem }] in console order
 */
export function evaluate(spec, { blocks = [], money = 0, fee = 0, text, oneWay = 0, roundTrip = 0 }) {
  const total = spec.stats.cost + fee;
  const allBlocks = [...blocks];
  if (total > money) allBlocks.push('OVER_BUDGET');
  const warnings = [...(spec.warnings ?? [])];

  const vars = {
    deltaV: fmtInt(spec.stats.deltaV), needed: fmtInt(oneWay), neededRoundTrip: fmtInt(roundTrip),
    twrEarth: spec.stats.twrEarth.toFixed(2), twrMars: spec.stats.twrMars.toFixed(2),
    tempC: fmtInt(spec.launch?.tempC ?? 15), reliability: fmtInt(spec.stats.reliability * 100),
    cost: fmtMoney(total), money: fmtMoney(money), spareO2Tanks: String(spec.stats.spareO2Tanks), shipName: spec.name ?? 'Ship',
  };
  const fill = (s) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  const problems = text.gonogo.problems ?? {};
  const lines = [];
  for (const console of text.gonogo.consoles ?? []) {
    const here = [
      ...allBlocks.filter((id) => problems[id]?.console === console.id).map((id) => ({ id, status: 'BLOCK' })),
      ...warnings.filter((id) => problems[id]?.console === console.id).map((id) => ({ id, status: 'NO-GO' })),
    ];
    if (!here.length) {
      lines.push({ console: console.name, consoleId: console.id, status: 'GO', text: fill(text.gonogo.go?.[console.id] ?? 'GO.'), guidebook: null, problem: null });
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

  return { blocks: allBlocks, warnings, lines, total, canConfirm: allBlocks.length === 0, needsOverride: allBlocks.length === 0 && warnings.length > 0 };
}
