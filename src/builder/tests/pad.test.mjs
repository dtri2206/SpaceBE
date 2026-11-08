// Launch pad checks, Node only: node src/builder/tests/pad.test.mjs
// Real launch complexes (sections/pad/section.json), the pad's physical effects (sections/pad/effects.js), launch-day
// weather and HOLD (weather.js), old saves, and the presets on their pads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { PLANETS, G0 } = await imp('src/core/planets.js');
const { Assembly, createCatalog } = await imp('src/builder/assembly.js');
const { computeShipSpec } = await imp('src/builder/stats.js');
const SEC = await imp('src/builder/sections.js');
const { padEffects, padSetup, complexOf, kitFee, heatLimitOf, liftoffOn, MIN_THROTTLE, DAMAGE_CAP, REPAIR_CAP } = await imp('src/builder/sections/pad/effects.js');
const { weatherFor, ERROR_CAP } = await imp('src/builder/weather.js');

const sectionFiles = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), sectionFiles);
const sections = SEC.createSections(sectionFiles);
const catalog = createCatalog(partsJson, internalsJson);
const launchData = read('src/builder/data/launch.json');
const balance = read('src/core/balance.json');
const deps = { catalog, engines: read('src/builder/data/engines.json'), launch: launchData, balance, planets: PLANETS, g0: G0, materials: read('src/builder/data/materials.json'), pad: sections.pad, traitsData: { propulsion: read('src/builder/traits/propulsion.json') } };
const presets = Object.fromEntries(['reliable', 'workhorse', 'coldMorning', 'thinSkin'].map((k) => [k, read(`src/builder/data/presets/${k}.json`)]));
const explain = read('src/builder/sections/pad/explain.json').entries;
const pad = sections.pad;

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const spec = (json, launch) => computeShipSpec(new Assembly(launch ? { ...json, launch } : json, catalog), deps);
const nonIncreasing = (xs) => xs.every((x, i) => i === 0 || x <= xs[i - 1] + 1e-9);
const increasing = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
const increasingOrEqual = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

// ---------- data ----------
const ids = pad.sites.map((s) => s.id);
check(ids.length >= 25 && ids.length <= 35 && new Set(ids).size === ids.length, `${ids.length} launch complexes, unique ids`);
const REGIONS = ['usa', 'russia', 'europe', 'china', 'japan', 'india', 'korea', 'brazil', 'pacific'];
check(pad.sites.every((s) => REGIONS.includes(s.region) && typeof s.years === 'string' && s.years.length >= 5), 'every complex names its region and its years');
check(pad.sites.every((s, i) => i === 0 || REGIONS.indexOf(s.region) >= REGIONS.indexOf(pad.sites[i - 1].region) || s.region === pad.sites[i - 1].region), 'the complexes are listed region by region');
check(pad.sites.every((s) => !(s.designKN != null) || s.designKN > 0), 'designKN, where given, is a real liftoff thrust in kN');
const aliases = pad.sites.flatMap((s) => s.aliases ?? []);
check(new Set(aliases).size === aliases.length && !aliases.some((a) => ids.includes(a)), 'old site ids map to one complex each');
for (const s of pad.sites) {
  const where = `complex ${s.id}`;
  if (!s.name || !s.place || !s.note || !s.real || !s.rockets) fail(`${where}: needs name, place, note, real, rockets`);
  if (!(s.scale > 0) || !(s.holdFee > 0) || !(s.fee >= 0)) fail(`${where}: needs scale, holdFee and fee`);
  if (!s.facts?.length) fail(`${where}: needs real facts`);
  for (const k of ['meanC', 'swingC', 'windKts', 'windSwingKts', 'lightning']) if (!Number.isFinite(s.climate?.[k])) fail(`${where}: climate.${k} missing`);
  for (const eq of pad.equipment) if (!eq.options.some((o) => o.id === s.kit?.[eq.key])) fail(`${where}: kit has no valid ${eq.key}`);
}
const FIELDS = { mount: ['heatKN', 'debris', 'repair'], deluge: ['heatF', 'debrisF', 'acousticF'], clamps: ['catch', 'holdS'], tower: ['exposure'], lightning: ['strikeF'], access: ['escape'], propellant: ['holdF'], weather: ['errorC', 'triggerF'] };
check(Object.keys(FIELDS).every((k) => pad.equipment.some((eq) => eq.key === k)) && pad.equipment.length === 8, 'eight kinds of ground equipment');
for (const eq of pad.equipment) {
  if ((eq.options[0].fee ?? 0) !== 0 || (eq.options[0].reliability ?? 0) !== 0) fail(`equipment ${eq.key}: the first option must be free and neutral`);
  if (!increasingOrEqual(eq.options.map((o) => o.fee))) fail(`equipment ${eq.key}: fees must not fall along the list`);
  for (const o of eq.options) for (const f of FIELDS[eq.key] ?? []) if (!Number.isFinite(o[f])) fail(`equipment ${eq.key}.${o.id}: ${f} missing`);
}
ok('every option carries its physical numbers');
check(pad.equipment.find((e) => e.key === 'clamps').options.every((o) => (o.reliability ?? 0) === 0), 'clamps count once: a catch chance, no reliability bonus');
// no option is a plain loss: a dearer tower or crew access must give something back (more reliability, or less exposure / more escape)
for (const [key, better] of [['tower', (a, b) => a.reliability > b.reliability || a.exposure < b.exposure], ['access', (a, b) => a.reliability > b.reliability || a.escape > b.escape]]) {
  const os = pad.equipment.find((e) => e.key === key).options;
  const lost = os.filter((a) => os.some((b) => b !== a && b.fee < a.fee && !better(a, b) && !(key === 'tower' && b.id === 'none'))).map((o) => o.id);
  check(!lost.length, `${key}: every dearer option gives something back${lost.length ? ` (not: ${lost.join(', ')})` : ''}`);
}
{
  const ft = (o) => [o.reliability ?? 0, -(o.exposure ?? 0)];
  const tw = Object.fromEntries(pad.equipment.find((e) => e.key === 'tower').options.map((o) => [o.id, o]));
  check(!(ft(tw.gantry)[0] >= ft(tw.fixed)[0] && ft(tw.gantry)[1] >= ft(tw.fixed)[1] && ft(tw.gantry)[0] >= ft(tw.catch)[0]), 'the cheap Soyuz gantry does not beat the fixed tower and the catch tower on every count');
}
check(pad.equipment.find((e) => e.key === 'clamps').options.every((o) => !o.catch || (o.holdLine?.en?.includes('{holdS}') || o.holdBy === 'weight') && o.holdLine?.vi), 'every clamp option with a catch has its own line for the investigation board');
check(!/TODO/.test(readFileSync(path.join(ROOT, 'src/builder/sections/pad/section.json'), 'utf8') + readFileSync(path.join(ROOT, 'src/builder/sections/pad/explain.json'), 'utf8')), 'no TODO in text the player reads');

// ---------- effects: monotonic ----------
const mounts = pad.equipment.find((e) => e.key === 'mount').options;
const deluges = pad.equipment.find((e) => e.key === 'deluge').options;
check(increasing(mounts.map((o) => o.heatKN)) && increasing(mounts.map((o) => o.fee)), 'mounts: dearer takes more fire');
check(increasing(deluges.map((o) => o.heatF)) && nonIncreasing(deluges.map((o) => o.debrisF)) && nonIncreasing(deluges.map((o) => o.acousticF)), 'water: more water, more heat limit, less debris and less roar');
{
  const thrustSL = 4.2e6; // a heavy ship, over every mount at SLC-40
  const row = mounts.map((o) => {
    const launch = { site: 'slc40', pad: { mount: o.id } };
    const w = weatherFor(launch, { pad, launchData });
    return padEffects(launch, { pad, weather: w, thrustSL, engineCount: 9, g: PLANETS.earth.g });
  });
  check(increasing(row.map((r) => r.heatLimitKN)), 'a better trench: a higher heat limit');
  check(nonIncreasing(row.map((r) => r.excess)) && nonIncreasing(row.map((r) => r.liftoffLossMps)), 'a better trench: less excess, a smaller liftoff loss');
  check(nonIncreasing(row.map((r) => r.damageChance)) && nonIncreasing(row.map((r) => r.repairFee)), 'a better trench: less engine damage, smaller repairs');
  check(row[0].excess > 0 && row[0].liftoffLossMps > 0 && row[0].damageChance > 0 && row[0].repairFee > 0, 'over the limit: throttle loss, damage chance and repairs all appear');
  const wet = deluges.map((o) => { const launch = { site: 'slc40', pad: { mount: 'slab', deluge: o.id } }; return padEffects(launch, { pad, weather: weatherFor(launch, { pad, launchData }), thrustSL: 1.2e6, g: PLANETS.earth.g }); });
  check(increasing(wet.map((r) => r.heatLimitKN)) && nonIncreasing(wet.map((r) => r.damageChance)) && increasing(wet.map((r) => r.reliability)), 'water: higher limit, less damage, less acoustic loss');
  const clamps = pad.equipment.find((e) => e.key === 'clamps').options.map((o) => padEffects({ site: 'slc40', pad: { clamps: o.id } }, { pad, thrustSL: 1e6 }).holdDownCatch);
  check(clamps[0] === 0 && increasing(clamps), 'better hold-down clamps catch more bad engines');
  const arms = padEffects({ site: 'gagarin' }, { pad, thrustSL: 3e5 }), held = padEffects({ site: 'slc40' }, { pad, thrustSL: 1e6 });
  check(arms.notes.some((n) => /support arms/.test(n)) && !arms.notes.some((n) => /clamps kept/.test(n)) && held.notes.some((n) => /clamps kept the ship on the pad for 3 s/.test(n)) && arms.notesI18n.every((l) => l.vi && !/\{holdS\}/.test(l.vi + l.en)), 'the board names the support arms at a Soyuz pad and the clamps elsewhere');
  const lightning = pad.equipment.find((e) => e.key === 'lightning').options.map((o) => padEffects({ site: 'ela3', pad: { lightning: o.id } }, { pad, weather: { lightning: 0.4 }, thrustSL: 1e6 }).lightningRisk);
  check(lightning[0] > 0 && lightning.every((x, i) => i === 0 || x < lightning[i - 1]), 'lightning protection lowers the lightning risk');
  const l = liftoffOn(1000, 3000, { g: PLANETS.earth.g });
  check(l.throttle === MIN_THROTTLE && l.residual > 0 && l.lossMps > 0, 'far over the limit the engines stop at their lowest throttle and the pad is still overloaded');
  check(liftoffOn(1000, 900, { g: PLANETS.earth.g }).excess === 0 && liftoffOn(1000, 900, { g: PLANETS.earth.g }).lossMps === 0, 'under the limit: no excess, no loss');
  const nog = padEffects({ site: 'slc40', pad: { mount: 'slab' } }, { pad, thrustSL: 1.5e6 });
  check(nog.excess > 0 && nog.liftoffLossMps === 0 && nog.throttle === 1, 'without g from the caller: nothing is held back and no Δv is lost (no gravity literal)');
  const mild = padEffects({ site: 'slc40', pad: { mount: 'slab', deluge: 'none' } }, { pad, thrustSL: 1.5 * heatLimitOf(padSetup({ site: 'slc40', pad: { mount: 'slab', deluge: 'none' } }, pad)) * 1000, g: PLANETS.earth.g });
  check(mild.damageChance > 0 && mild.damageChance < DAMAGE_CAP, `half over a bare slab: damage ${Math.round(mild.damageChance * 100)} %, under the ${DAMAGE_CAP * 100} % cap`);
  const worst = padEffects({ site: 'mahia' }, { pad, thrustSL: 5e6, g: PLANETS.earth.g });
  check(worst.repairFee > 0 && worst.repairFee <= REPAIR_CAP && REPAIR_CAP <= 300000, `repairs stay a sting: at most $${REPAIR_CAP / 1000}k`);
}

// ---------- the presets on their pads ----------
const first = pad.sites[0];
for (const key of ['reliable', 'workhorse']) {
  const r = spec(presets[key], { site: first.id });
  const fx = r.breakdown.padFx;
  check(fx.excess === 0 && fx.liftoffLossMps === 0 && fx.damageChance === 0 && fx.repairFee === 0, `${key} on the default complex (${first.id}): no excess, no loss`);
  const own = spec(presets[key]);
  check(own.breakdown.padFx.excess === 0 && own.breakdown.weather.forecastC >= 10 && own.spec.warnings.length === 0, `${key} on its own pad: no excess, a mild day (${own.breakdown.weather.forecastC} °C), no warnings`);
  check(own.spec.stats.cost + own.breakdown.launchFee <= balance.startMoney, `${key}: ship + launch fees within the $${balance.startMoney / 1e6}M budget`);
  check(own.spec.launch.complex === own.breakdown.padFx.complex.id && Number.isFinite(own.spec.launch.tempC), `${key}: spec.launch carries tempC and the complex id`);
}
{
  const atBase = spec(presets.workhorse, { site: 'slc40' }), atSmall = spec(presets.workhorse, { site: 'slc4e' });
  const fx = atSmall.breakdown.padFx;
  check(fx.excess > 0 && fx.liftoffLossMps > 0 && fx.damageChance > 0 && fx.repairFee > 0 && fx.holdDownCatch > 0, `Workhorse on SLC-4E's smaller trench: over the limit by ${Math.round(fx.excess * 100)} % (held at ${Math.round(fx.throttle * 100)} %, loss ${fx.liftoffLossMps} m/s, damage ${Math.round(fx.damageChance * 100)} %, repairs $${fx.repairFee / 1000}k)`);
  // the flight holds the thrust back itself (traits.propulsion.pad); the builder no longer burns propellant for it
  const held = atSmall.spec.stats.traits?.propulsion?.pad;
  check(atSmall.breakdown.liftoffBurn === 0 && Math.abs(atSmall.spec.stats.fuelMass - atBase.spec.stats.fuelMass) < 1e-6, 'the held-back liftoff costs no propellant in the builder (the flight realises it)');
  check(fx.heldBackMps === fx.liftoffLossMps && fx.liftoffLossMps > 0, `the Δv the slow climb costs stays as an estimate for the words (${fx.heldBackMps} m/s)`);
  check((held && Math.abs(held.heldThrottle - fx.throttle) < 1e-3 && held.heldThrottle < 1 && held.clearM > 0), 'the flight gets the held throttle and the height of the tower to clear');
  check(spec(presets.coldMorning).breakdown.padFx.excess === 0, 'Cold Morning (a small engine) fits the bare slab it launches from');
  // the big solid-booster tails (2–3 MN) overload the ordinary pads and need LC-39A or Starbase with its water plate
  for (const id of ['atlas_v', 'ariane_5', 'space_shuttle']) {
    const shape = sections.tail.shapes.find((x) => x.id === id);
    if (!shape) continue;
    const on = (launch) => { const a = new Assembly({ ...presets.reliable, launch }, catalog); SEC.applyShape(a, sections.tail, shape); return computeShipSpec(a, deps).breakdown.padFx.excess; };
    check(on({ site: 'slc40' }) > 0 && on({ site: 'lc39a' }) === 0 && on({ site: 'starbase' }) === 0 && on({ site: 'starbase', pad: { deluge: 'none' } }) >= 0, `tail ${id}: over SLC-40's limit, fine on LC-39A and on Starbase with water`);
  }
}
{
  const cm = spec(presets.coldMorning);
  check(cm.spec.launch.tempC < 5 && cm.breakdown.weather.actualC < 5 && cm.spec.warnings.includes('COLD_SEALS'), `Cold Morning stays cold (forecast ${cm.spec.launch.tempC} °C, actual ${cm.breakdown.weather.actualC} °C) and warns COLD_SEALS`);
  check(cm.spec.warnings.includes('LOW_RELIABILITY'), 'Cold Morning keeps LOW_RELIABILITY (a skimped pad)');
  const held = spec(presets.coldMorning, { ...presets.coldMorning.launch, day: 1 });
  check(held.breakdown.weather.forecastC > cm.breakdown.weather.forecastC, 'Cold Morning: holding a day lets the cold front pass');
  const next = spec(presets.coldMorning, { ...presets.coldMorning.launch, seed: 1 });
  check(next.breakdown.weather.forecastC !== cm.breakdown.weather.forecastC, 'the cold front belongs to one campaign: the next one (a new launch.seed) gets fresh weather');
}

// ---------- weather: deterministic, HOLD ----------
{
  const a = weatherFor({ site: 'lc39a', day: 3 }, { pad, launchData }), b = weatherFor({ site: 'lc39a', day: 3 }, { pad, launchData });
  check(JSON.stringify({ ...a, site: null }) === JSON.stringify({ ...b, site: null }), 'weather: the same complex and day give the same weather');
  const days = [0, 1, 2, 3, 4, 5].map((d) => weatherFor({ site: 'lc39a', day: d }, { pad, launchData }).forecastC);
  check(new Set(days).size > 3, `weather changes from day to day (${days.join(', ')} °C)`);
  check(weatherFor({ site: 'lc39a', day: 3, seed: 7 }, { pad, launchData }).forecastC !== a.forecastC, 'launch.seed gives another weather');
  const src = readFileSync(path.join(ROOT, 'src/builder/weather.js'), 'utf8') + readFileSync(path.join(ROOT, 'src/builder/sections/pad/effects.js'), 'utf8');
  check(!/Math\.random\s*\(/.test(src),'weather.js and effects.js never call Math.random');
  let worst = 0;
  for (const s of pad.sites) for (const w of ['none', 'balloons', 'radar']) for (let d = 0; d < 30; d++) {
    const x = weatherFor({ site: s.id, day: d, pad: { weather: w } }, { pad, launchData });
    worst = Math.max(worst, Math.abs(x.actualC - x.forecastC) / x.errorC);
    if (!(x.lightning >= 0 && x.lightning <= 1 && x.windKts >= 0)) fail(`weather ${s.id} day ${d}: lightning or wind out of range`);
  }
  check(worst <= ERROR_CAP + 0.05, `forecast errors stay within ±${ERROR_CAP} × the weather watch's typical error`);
  const errs = ['none', 'balloons', 'radar'].map((w) => weatherFor({ site: 'slc40', pad: { weather: w } }, { pad, launchData }).errorC);
  check(errs[0] > errs[1] && errs[1] > errs[2] && errs[0] >= 2.5, `a cheap weather watch can be several degrees wrong (±${errs.join(' / ±')} °C)`);
  // HOLD: one more day costs the complex's hold fee, paid at confirm with the other fees
  const d = new Assembly(presets.reliable, catalog);
  const r0 = computeShipSpec(d, deps);
  d.setLaunch({ day: r0.breakdown.weather.day + 1 });
  const r1 = computeShipSpec(d, deps);
  check(r1.breakdown.weather.day === 1 && r1.breakdown.launchFee - r0.breakdown.launchFee === r0.breakdown.weather.holdFee && r0.breakdown.weather.holdFee > 0, `HOLD: day 1, launch fees +$${r0.breakdown.weather.holdFee / 1000}k`);
  d.setLaunch({ day: 2 });
  check(computeShipSpec(d, deps).breakdown.weather.fee === 2 * r0.breakdown.weather.holdFee, 'HOLD fees add up day by day');
  check(new Assembly(d.toJSON(), catalog).launch.day === 2, 'the launch day survives save and share codes');
  const lg = weatherFor({ site: 'slc40', pad: { propellant: 'loadgo' } }, { pad, launchData }).holdFee, man = weatherFor({ site: 'slc40', pad: { propellant: 'manual' } }, { pad, launchData }).holdFee;
  check(lg < man, 'load-and-go propellant makes a day of waiting cheaper than hand-loading');
}

// ---------- old saves ----------
{
  const cases = [
    [{ slot: 'cold' }, first.id, (r) => r.spec.launch.tempC < 5],
    [{ slot: 'mild' }, first.id, () => true],
    [{ site: 'cape', slot: 'warm' }, 'slc40', () => true],
    [{ site: 'baikonur', slot: 'bk_winter' }, 'gagarin', (r) => r.spec.launch.tempC < 5],
    [{ site: 'plesetsk' }, 'plesetsk', () => true],
    [{ site: 'proton' }, 'site81', () => true],
    [{ site: 'kourou', slot: 'kr_morning' }, 'ela3', () => true],
    [{ site: 'vandenberg' }, 'slc4e', () => true],
    [{ site: 'nowhere', slot: 'nope', pad: { tower: 'warp', mount: 'mlp' } }, first.id, (r) => r.breakdown.padFx.choices.find((c) => c.eq.key === 'mount').option.id === 'mlp' && r.breakdown.padFx.choices.find((c) => c.eq.key === 'tower').option.id === first.kit.tower],
    [null, first.id, () => true],
  ];
  let good = 0;
  for (const [launch, want, extra] of cases) {
    try {
      const json = { ...presets.reliable, launch };
      const r = computeShipSpec(new Assembly(json, catalog), deps);
      if (r.breakdown.padFx.complex?.id === want && extra(r) && !r.blocks.length) good += 1; else fail(`old save ${JSON.stringify(launch)}: landed on ${r.breakdown.padFx.complex?.id}, expected ${want}`);
    } catch (e) { fail(`old save ${JSON.stringify(launch)} crashed: ${e.message}`); }
  }
  check(good === cases.length, `old saves land on a sensible complex (${good}/${cases.length})`);
  check(complexOf({}, { sites: [] }) === null && padSetup(null, null).choices.length === 0, 'no pad data: no crash');
  check(padEffects(undefined, {}).fee === 0 && weatherFor(undefined, {}).tempC != null, 'missing launch block: neutral numbers');
}

// ---------- prices ----------
{
  const fees = Object.fromEntries(pad.sites.map((s) => [s.id, kitFee(s, pad)]));
  check(fees.lc39a === Math.max(...Object.values(fees)) && fees.mahia === Math.min(...Object.values(fees)), `LC-39A is the dearest complex, Rocket Lab LC-1 the cheapest ($${fees.lc39a / 1000}k … $${fees.mahia / 1000}k)`);
  const limits = Object.fromEntries(pad.sites.map((s) => [s.id, heatLimitOf(padSetup({ site: s.id }, pad))]));
  const strongest = Math.max(...Object.values(limits));
  check(Math.max(limits.starbase, limits.starbase2) === strongest && limits.mahia === Math.min(...Object.values(limits)), `a Starbase pad takes the most fire (Pad 1 ${Math.round(limits.starbase)}, Pad 2 ${Math.round(limits.starbase2)} kN), LC-1 the least (${Math.round(limits.mahia)} kN)`);
  const bareStarbase = heatLimitOf(padSetup({ site: 'starbase', pad: { deluge: 'none' } }, pad));
  check(bareStarbase < limits.starbase / 2 && bareStarbase < limits.lc39a, `Starbase's water is a real step: ${Math.round(bareStarbase)} kN bare, ${Math.round(limits.starbase)} kN with the plate`);
  check(fees.slc40 >= 150000 && fees.slc40 <= 200000 && fees.lc39a <= 320000, `fees are a tax: SLC-40 kit $${fees.slc40 / 1000}k, LC-39A kit $${fees.lc39a / 1000}k`);
  // every complex with a design thrust: its kit takes about one tenth of it (SLC-40 is kept a little higher so Workhorse fits)
  const tenth = pad.sites.filter((s) => s.designKN > 0).filter((s) => !(limits[s.id] >= 0.08 * s.designKN && limits[s.id] <= 0.14 * s.designKN)).map((s) => `${s.id} ${Math.round(limits[s.id])}/${s.designKN}`);
  check(!tenth.length && pad.sites.filter((s) => s.designKN > 0).length >= 25, `every kit takes about a tenth of its rocket's real liftoff thrust${tenth.length ? ` (off: ${tenth.join(', ')})` : ''}`);
  const real = { lc39a: [3500, 4000], slc40: [1800, 2100], slc4e: [1500, 1700], ela3: [1400, 1600], wenchang: [1000, 1200], tanegashima: [900, 1100], gagarin: [400, 500], mahia: [15, 30], starbase: [7500, 9000], starbase2: [8500, 9500], lc39b: [3700, 4100] };
  const off = Object.entries(real).filter(([id, [a, b]]) => !(limits[id] >= a && limits[id] <= b)).map(([id]) => `${id} ${Math.round(limits[id])}`);
  check(!off.length, `kit heat limits about one tenth of the real pads${off.length ? ` (off: ${off.join(', ')})` : ''}`);
}

// ---------- explanations ----------
{
  const keys = [...pad.sites.map((s) => `pad:${s.id}`), ...pad.equipment.flatMap((eq) => [`equip:${eq.key}`, ...eq.options.map((o) => `equip:${eq.key}/${o.id}`)])];
  const missing = keys.filter((k) => !explain[k]?.en?.what || !explain[k]?.vi?.what);
  check(!missing.length, `explain.json: ${keys.length} entries in English and Vietnamese${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  const len = (x) => (x ?? []).length;
  const viBad = [...pad.sites.filter((st) => { const v = explain[`pad:${st.id}`]?.vi ?? {}; return len(v.pros) !== len(st.pros) || len(v.cons) !== len(st.cons) || len(v.facts) !== len(st.facts); }).map((st) => st.id),
    ...pad.equipment.flatMap((eq) => eq.options.filter((o) => { const v = explain[`equip:${eq.key}/${o.id}`]?.vi ?? {}; return len(v.pros) !== len(o.pros) || len(v.cons) !== len(o.cons); }).map((o) => `${eq.key}/${o.id}`))];
  check(!viBad.length, `Vietnamese pros, cons and facts for every complex and option${viBad.length ? ` (missing ${viBad.join(', ')})` : ''}`);
  const viText = Object.values(explain).map((e) => Object.values(e.vi ?? {}).join(' ')).join(' ');
  check(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(viText), 'the Vietnamese has its diacritics');
  const noName = keys.filter((k) => !explain[k]?.vi?.name);
  check(!noName.length, `every complex, equipment and option has its Vietnamese name${noName.length ? ` (missing ${noName.join(', ')})` : ''}`);
  // a full stop (or ? !) glued to the next sentence: "Virginia.The"
  const glued = [JSON.stringify(pad.sites), JSON.stringify(pad.equipment), JSON.stringify(explain)].join(' ').match(/[^\s\d.][.!?]\p{Lu}/gu) ?? [];
  check(!glued.length, `every sentence is followed by a space${glued.length ? ` (not: ${glued.join(', ')})` : ''}`);
  const arms = explain['equip:clamps/tulip'];
  check(arms?.en?.why && arms?.vi?.why && !/clamp|kẹp/i.test(arms.en.why + arms.vi.why), 'the support arms explain themselves without calling themselves clamps');
}

console.log(failures ? `\n${failures} pad failure(s).` : '\nAll pad checks passed.');
process.exit(failures ? 1 : 0);
