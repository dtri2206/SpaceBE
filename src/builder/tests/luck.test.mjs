// Luck checks (FIFA-style as-built variation, defects, soft Go/No-Go, HOLD, reuse with wear), Node only:
//   node src/builder/tests/luck.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const contract = await imp('src/core/contract.js');
const { PLANETS, G0 } = await imp('src/core/planets.js');
const { Assembly, createCatalog } = await imp('src/builder/assembly.js');
const { computeShipSpec } = await imp('src/builder/stats.js');
const SEC = await imp('src/builder/sections.js');
const { evaluate, holdPlan, owed, thinConsoles, weatherCalls } = await imp('src/builder/gonogo.js');
const L = await imp('src/builder/asBuilt.js');
const H = await imp('src/builder/hull.js');

const files = Object.fromEntries(SEC.SECTION_IDS.map((id) => [id, { parts: read(`src/builder/sections/${id}/parts.json`), internals: read(`src/builder/sections/${id}/internals.json`), section: read(`src/builder/sections/${id}/section.json`) }]));
const { partsJson, internalsJson } = SEC.mergeSectionData(read('src/builder/data/families.json'), files);
const sections = SEC.createSections(files);
const catalog = createCatalog(partsJson, internalsJson);
const engines = read('src/builder/data/engines.json');
const materials = read('src/builder/data/materials.json');
const text = read('src/builder/data/text.json');
const balance = read('src/core/balance.json');
const deps = { catalog, engines, launch: read('src/builder/data/launch.json'), balance, planets: PLANETS, g0: G0, materials, pad: sections.pad };
const preset = (key) => read(`src/builder/data/presets/${key}.json`);

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const pc = (x) => `${(x * 100).toFixed(1)} %`;

const build = (json) => new Assembly(json, catalog);
const ctxOf = (a, extra = {}) => ({ g0: G0, planets: PLANETS, layout: a.layout(), catalog, engines, materials, hull: a.hull, serial: 1, ...extra });
const flyMany = (result, a, n, extra = {}) => Array.from({ length: n }, (_, i) => L.buildAsFlown(result, ctxOf(a, { serial: i + 1, ...extra })));
const N = 3000;

// ---------- determinism ----------
{
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const one = L.buildAsFlown(r, ctxOf(a, { serial: 7 }));
  const two = L.buildAsFlown(r, ctxOf(a, { serial: 7 }));
  check(JSON.stringify(one) === JSON.stringify(two), 'the same build and serial give the same ship (TEST FIRE can show what will fly)');
  const other = L.buildAsFlown(r, ctxOf(a, { serial: 8 }));
  check(other.seed !== one.seed && JSON.stringify(other.units) !== JSON.stringify(one.units), 'the next build serial rolls a different ship');
  const engineId = r.breakdown.enginePartIds[0];
  const swapped = L.buildAsFlown(r, ctxOf(a, { serial: 7, units: { [engineId]: 1 } }));
  const row = (f, id) => JSON.stringify(f.units.find((u) => u.partId === id));
  const tankId = r.breakdown.fuelPartIds[0];
  check(row(swapped, engineId) !== row(one, engineId) && row(swapped, tankId) === row(one, tankId), 'replacing a part rolls only that part again');
  const stand = L.buildAsFlown(r, ctxOf(a, { serial: 7, stage: 'stand' }));
  check(JSON.stringify(stand.units) === JSON.stringify(one.units) && stand.scrub === null, 'the static fire sees the same factory ship that flies');
  check(one.spec.stats.cost === r.spec.stats.cost && Object.keys(one.spec).join() === Object.keys(r.spec).join(), 'the flown ShipSpec keeps its shape and its cost');
  const sig = L.designSignature(a.toJSON());
  const b = build(preset('reliable'));
  b.setLaunch({ day: 3 });
  b.rename('Another name');
  check(L.designSignature(b.toJSON()) === sig, 'the design signature ignores the name and the launch day');
  b.setMaterial(engineId, 'inconel');
  check(L.designSignature(b.toJSON()) !== sig, 'the design signature changes with any part choice');
  // with every part exactly at its rating, the recomputed numbers are the designed ones
  const flat = L.buildAsFlown({ ...r, breakdown: { ...r.breakdown, parts: r.breakdown.parts } }, { ...ctxOf(a), layout: [] });
  check(Math.abs(flat.asBuilt.deltaV - r.spec.stats.deltaV) < 1e-6, 'no parts to vary: the designed Δv stands');
}

// ---------- the spread ----------
{
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const flights = flyMany(r, a, N, { stage: 'stand' });
  let inBounds = true, spreadOk = true;
  const dv = [];
  for (const f of flights) {
    for (const u of f.units) {
      if (!(u.spread >= L.LUCK.spreadMin - 1e-12 && u.spread <= L.LUCK.spreadMax + 1e-12)) spreadOk = false;
      for (const k of ['thrustPct', 'ispPct', 'fuelPct']) if (Number.isFinite(u[k]) && Math.abs(u[k]) > u.spread + 1e-12) inBounds = false;
    }
    if (!f.defects.length) dv.push(f.asBuilt.deltaV / f.designed.deltaV - 1);
  }
  check(spreadOk, `every part's spread is between ±${pc(L.LUCK.spreadMin)} and ±${pc(L.LUCK.spreadMax)}`);
  check(inBounds, 'Isp, thrust and propellant of every unit stay within its spread');
  dv.sort((x, y) => x - y);
  const p5 = dv[Math.floor(dv.length * 0.05)], p95 = dv[Math.floor(dv.length * 0.95)];
  check(Math.max(Math.abs(dv[0]), Math.abs(dv.at(-1))) < 0.03 && p95 - p5 < 0.04, `Reliable as built without a defect: Δv ${pc(dv[0])}..${pc(dv.at(-1))}, 90 % within ${pc(p5)}..${pc(p95)}`);

  // quality: the dearer, more reliable version of the same engine wanders less than the cheap one
  const eng = r.breakdown.enginePartIds[0];
  const good = build(preset('reliable')); good.setMaterial(eng, 'inconel'); good.setOption(eng, 'igniter', 'tea_teb'); good.setOption(eng, 'injector', 'pintle');
  const cheap = build(preset('reliable')); cheap.setMaterial(eng, 'printed'); cheap.setOption(eng, 'injector', 'impinging'); cheap.setOption(eng, 'nozzleExt', 'ablative');
  const spreadOf = (asm) => L.buildAsFlown(computeShipSpec(asm, deps), ctxOf(asm)).units.find((u) => u.partId === eng).spread;
  const sGood = spreadOf(good), sStd = spreadOf(a), sCheap = spreadOf(cheap);
  check(sGood < sStd && sStd < sCheap, `engine spread: premium ±${pc(sGood)} < standard ±${pc(sStd)} < cheap ±${pc(sCheap)}`);
  check(L.partQuality({ reliability: 0.99, baseReliability: 0.97, costRatio: 1.4 }) > 0.9 && L.partQuality({ reliability: 0.94, baseReliability: 0.97, costRatio: 0.7 }) < 0.1, 'quality runs from cheap and unreliable (0) to dear and reliable (1)');
}

// ---------- defects follow reliability ----------
{
  const eng = 'p4';
  const good = build(preset('reliable')); good.setMaterial(eng, 'inconel'); good.setOption(eng, 'igniter', 'tea_teb'); good.setOption(eng, 'injector', 'pintle');
  const bad = build(preset('reliable')); bad.setMaterial(eng, 'printed'); bad.setOption(eng, 'injector', 'impinging'); bad.setOption(eng, 'nozzleExt', 'extendable');
  const count = (asm) => { const r = computeShipSpec(asm, deps); return { n: flyMany(r, asm, N, { stage: 'stand' }).filter((f) => f.defects.some((d) => d.partId === eng)).length, rel: r.breakdown.parts.find((p) => p.id === eng).reliability }; };
  const g = count(good), b = count(bad);
  check(g.n < b.n, `engine defects over ${N} builds: reliability ${pc(g.rel)} → ${g.n}, reliability ${pc(b.rel)} → ${b.n}`);
  const k = L.LUCK.factoryShare;
  check(Math.abs(b.n / N - k * (1 - b.rel)) < 0.015, `the defect rate is the factory's share of 1 − reliability (${pc(b.n / N)} for ${k} × ${pc(1 - b.rel)})`);
}

// ---------- Reliable makes it; a gamble 2 % short sometimes does ----------
{
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const flown = flyMany(r, a, N).filter((f) => !f.scrub);
  const reach = flown.filter((f) => f.asBuilt.deltaV >= r.breakdown.oneWay).length / flown.length;
  check(reach >= 0.99, `Reliable reaches the one-way Δv in ${pc(reach)} of ${flown.length} flown builds (designed margin ${pc(r.spec.stats.deltaV / r.breakdown.oneWay - 1)})`);
  const factory = flyMany(r, a, N, { stage: 'stand' }).filter((f) => f.asBuilt.deltaV >= r.breakdown.oneWay).length / N;
  console.log(`      (factory only, before the pad: ${pc(factory)}; scrubbed on the pad: ${pc(1 - flown.length / N)})`);

  // a cheap ship whose designed Δv is 2 % short of the trip (extra dead weight sets the shortfall exactly)
  const shortBy = (asm, share) => {
    const res = computeShipSpec(asm, deps);
    const s = res.spec.stats;
    const target = res.breakdown.oneWay * (1 - share);
    const dry = s.fuelMass / (Math.exp(target / (s.ispVac * G0)) - 1);
    const wet = dry + s.fuelMass;
    const stats = { ...s, dryMass: dry, wetMass: wet, deltaV: target, twrEarth: res.breakdown.thrustSL / (wet * PLANETS.earth.g), twrMars: s.thrust / (wet * PLANETS.mars.g) };
    return { ...res, spec: { ...res.spec, stats } };
  };
  const cheap = build(preset('reliable'));
  cheap.setMaterial('p4', 'printed'); cheap.setOption('p4', 'injector', 'impinging'); cheap.setOption('p4', 'nozzleExt', 'ablative');
  for (const t of ['p3', 'p21']) { cheap.setMaterial(t, 'stainless'); cheap.setOption(t, 'baffles', 'none'); cheap.setOption(t, 'pressurisation', 'nitrogen'); }
  const rate = (asm, share) => {
    const res = shortBy(asm, share);
    const fl = flyMany(res, asm, N).filter((f) => !f.scrub);
    return fl.filter((f) => f.asBuilt.deltaV >= res.breakdown.oneWay).length / fl.length;
  };
  const r2 = rate(cheap, 0.02), r1 = rate(cheap, 0.01), r0 = rate(cheap, 0.005);
  check(r2 >= 0.08 && r2 <= 0.2, `a cheap ship 2 % short makes it about one time in eight: ${pc(r2)} (1 % short: ${pc(r1)}, 0.5 % short: ${pc(r0)})`);
  const premium = build(preset('reliable'));
  premium.setMaterial('p4', 'inconel'); premium.setOption('p4', 'igniter', 'tea_teb'); premium.setOption('p4', 'injector', 'pintle');
  for (const t of ['p3', 'p21']) { premium.setMaterial(t, 'titanium'); premium.setOption(t, 'feedline', 'dual'); premium.setOption(t, 'baffles', 'antivortex'); }
  const rp = rate(premium, 0.02);
  check(rp < r2, `a premium ship 2 % short makes it less often (${pc(rp)}): good parts fly as rated`);
}

// ---------- Workhorse (its preset margin is thin until the lead raises it after the hull agent's work) ----------
{
  const a = build(preset('workhorse'));
  const r = computeShipSpec(a, deps);
  const fl = flyMany(r, a, N).filter((f) => !f.scrub);
  const reach = fl.filter((f) => f.asBuilt.deltaV >= r.breakdown.oneWay).length / fl.length;
  check(reach >= 0.97, `Workhorse reaches the one-way Δv in ${pc(reach)} of flown builds (designed margin ${pc(r.spec.stats.deltaV / r.breakdown.oneWay - 1)})`);
}

// ---------- scrubs on the pad stay rare; engine trouble in flight keeps the drama ----------
{
  const rate = (asm) => {
    const r = computeShipSpec(asm, deps);
    const fl = flyMany(r, asm, N);
    const flown = fl.filter((f) => !f.scrub);
    return { scrub: 1 - flown.length / N, out: flown.filter((f) => f.defects.some((d) => d.kind === 'out' || d.kind === 'outPair' || (d.kind === 'noLight' && d.count > 1))).length / N, weak: flown.filter((f) => f.defects.some((d) => d.kind === 'weak')).length / N, n: r.breakdown.engineCount, c: r.breakdown.padFx.holdDownCatch };
  };
  const single = rate(build(preset('reliable')));
  check(single.scrub >= 0.005 && single.scrub <= 0.025, `a single-engine Reliable (clamps catch ${single.c}) scrubs ${pc(single.scrub)} of attempts (target about 1–2 %)`);
  const shape = sections.tail.shapes.find((x) => x.id === 'octaweb');
  if (shape) {
    const nine = build(preset('reliable'));
    SEC.applyShape(nine, sections.tail, shape);
    const best = sections.pad.equipment.find((e) => e.key === 'clamps')?.options.reduce((m, o) => ((o.catch ?? 0) > (m?.catch ?? 0) ? o : m), null);
    if (best) nine.setPadOption('clamps', best.id);
    const r9 = rate(nine);
    check(r9.n === 9 && r9.scrub <= 0.055, `a 9-engine cluster on the best clamps (catch ${r9.c}) scrubs ${pc(r9.scrub)} (the Shuttle: 5 pad aborts in 135 launches, 3.7 %)`);
    check(r9.out >= 0.015 && r9.weak >= 0.015, `… and still flies with an engine out ${pc(r9.out)} and a weak engine ${pc(r9.weak)} of the time`);
  } else ok('octaweb shape not found: cluster scrub check skipped');
}

// ---------- the engine trouble the flight plays out (stats.asBuiltDefects, for src/flight/effects/propulsion.js) ----------
{
  const a = build(preset('reliable'));
  const base = computeShipSpec(a, deps);
  const shape = (d) => Object.keys(d).join() === 'kind,partId,unit,count,pct' && ['out', 'outPair', 'debris'].includes(d.kind) && Number.isFinite(d.pct);
  const plain = (x) => JSON.stringify(JSON.parse(JSON.stringify(x))) === JSON.stringify(x);
  const hit = flyMany({ ...base, breakdown: { ...base.breakdown, padFx: { ...base.breakdown.padFx, holdDownCatch: 0, damageChance: 1 } } }, a, 50).filter((f) => !f.scrub);
  check(hit.length && hit.every((f) => Array.isArray(f.spec.stats.asBuiltDefects) && f.spec.stats.asBuiltDefects.some((d) => d.kind === 'debris') && f.spec.stats.asBuiltDefects.every(shape) && plain(f.spec.stats.asBuiltDefects)), 'pad debris goes to stats.asBuiltDefects as plain { kind, partId, unit, count, pct }');
  const clean = flyMany(base, a, 200).filter((f) => !f.scrub);
  check(clean.every((f) => Array.isArray(f.spec.stats.asBuiltDefects) && f.spec.stats.asBuiltDefects.length === f.defects.filter((d) => ['out', 'outPair', 'debris'].includes(d.kind)).length), 'every flown ship carries the list, empty when nothing will quit');
  check(!('asBuiltDefects' in L.buildAsFlown(base, ctxOf(a, { stage: 'stand' })).spec.stats), 'the static fire does not carry it (nothing flies)');
  const shape9 = sections.tail.shapes.find((x) => x.id === 'octaweb');
  if (shape9) {
    const nine = build(preset('reliable'));
    SEC.applyShape(nine, sections.tail, shape9);
    const r9 = computeShipSpec(nine, deps);
    const out = flyMany(r9, nine, 1500).find((f) => !f.scrub && f.defects.some((d) => d.kind === 'out' || d.kind === 'outPair'));
    const d = out?.defects.find((x) => x.kind === 'out' || x.kind === 'outPair');
    check(!!out && out.spec.stats.asBuiltDefects.some((x) => x.kind === d.kind && x.partId === d.partId && x.unit === d.unit && x.count === 9) && out.asBuilt.thrust < r9.spec.stats.thrust, `an engine that will quit on the climb is listed (${d?.kind}, engine ${(d?.unit ?? 0) + 1}/9), its thrust already out of the flown totals`);
  }
}

// ---------- the pad: hold-down clamps, debris; the weather ----------
{
  const a = build(preset('reliable'));
  const base = computeShipSpec(a, deps);
  const withPad = (padFx) => ({ ...base, breakdown: { ...base.breakdown, padFx: { ...base.breakdown.padFx, ...padFx } } });
  const caught = flyMany(withPad({ holdDownCatch: 1, damageChance: 0 }), a, N).filter((f) => f.scrub);
  const loose = flyMany(withPad({ holdDownCatch: 0, damageChance: 0 }), a, N).filter((f) => f.scrub);
  check(caught.length > loose.length && caught.some((f) => f.scrub.reason === 'holdDown') && loose.every((f) => f.scrub.reason !== 'holdDown'), `good clamps catch bad engines on the pad (${caught.length} scrubs against ${loose.length} engines that would not light)`);
  check(caught.every((f) => f.scrub.partIds.length > 0), 'every scrub names the parts to replace');
  const hit = flyMany(withPad({ holdDownCatch: 0, damageChance: 1 }), a, 200).filter((f) => !f.scrub);
  check(hit.every((f) => f.defects.some((d) => d.kind === 'debris')) && hit.every((f) => f.asBuilt.thrust < f.designed.thrust * 1.03), 'pad debris hurts an engine when the dice say so');
  const skin = { ...base, breakdown: { ...base.breakdown, hull: { ...(base.breakdown.hull ?? {}), risk: { maxQ: 1, heat: 1, notes: [] } } } };
  const f = L.buildAsFlown(skin, ctxOf(a));
  check(f.scrub || (f.spec.stats.heatShieldDamaged && f.spec.stats.ascentCdA > base.spec.stats.ascentCdA), 'a skin that overheats damages the heat shield (The Foam); one that wrinkles adds drag');
  const w = { ...base, breakdown: { ...base.breakdown, weather: { ...base.breakdown.weather, forecastC: 12, tempC: 12, actualC: 4 } } };
  check(L.buildAsFlown(w, ctxOf(a)).spec.launch.tempC === 4, 'the real temperature replaces the forecast in the flown ShipSpec');
}

// ---------- Cold Morning (the Challenger demo) ----------
{
  const a = build(preset('coldMorning'));
  const r = computeShipSpec(a, deps);
  const poll = evaluate(r.spec, { blocks: r.blocks, money: balance.startMoney, fee: r.breakdown.launchFee, text, oneWay: r.breakdown.oneWay, roundTrip: r.breakdown.roundTrip, breakdown: r.breakdown });
  const line = poll.lines.find((l) => l.problem === 'COLD_SEALS');
  check(poll.warnings.includes('COLD_SEALS') && line?.status === 'NO-GO' && /°C/.test(line.text) && /seal/.test(line.text), `Cold Morning still warns COLD_SEALS: "WEATHER… NO-GO ${line?.text}"`);
  check(poll.needsOverride && poll.canConfirm, 'Cold Morning can still be overridden');
  const flown = flyMany(r, a, 200).filter((x) => !x.scrub);
  check(flown.every((x) => x.spec.launch.tempC < 5 && !x.spec.stats.coldRatedSeals && x.defects.some((d) => d.kind === 'coldSeals')), 'Cold Morning flies cold with cheap seals, and the board will say why');
}

// ---------- the soft poll: no design numbers, no fixes ----------
{
  for (const key of ['reliable', 'workhorse', 'thinSkin', 'coldMorning']) {
    const a = build(preset(key));
    const r = computeShipSpec(a, deps);
    const poll = evaluate(r.spec, { blocks: r.blocks, money: balance.startMoney, fee: r.breakdown.launchFee, text, oneWay: r.breakdown.oneWay, roundTrip: r.breakdown.roundTrip, breakdown: r.breakdown });
    const numbered = poll.lines.filter((l) => l.consoleId !== 'weather' && l.status !== 'BLOCK' && /\d/.test(l.text));
    check(!numbered.length, `${key}: no console but the weather speaks a number${numbered.length ? ` (${numbered.map((l) => l.text).join(' | ')})` : ''}`);
  }
  for (const id of contract.WARNINGS) check(!/\b(add|fit|install|use a|try)\b/i.test(text.gonogo.problems[id].text), `${id}: the NO-GO call names no fix`);
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const thinSpec = { ...r.spec, stats: { ...r.spec.stats, deltaV: r.breakdown.oneWay * 1.01 } };
  check(thinConsoles(thinSpec, { oneWay: r.breakdown.oneWay }).has('propulsion'), 'a thin Δv margin makes Propulsion say "Margins are thin."');
  const priced = evaluate(r.spec, { blocks: [], money: 1e9, fee: 100, extra: 50, price: 1000, text, oneWay: r.breakdown.oneWay });
  check(priced.total === 1150 && priced.vehicle === 1000, 'the bill is vehicle price + launch fees + what is owed');
  check(owed([{ amount: 2 }, { amount: 3 }, {}]) === 5, 'owed() sums the fees still due');
}

// ---------- launch commit weather (lightning, wind), a strike after liftoff, the pad console ----------
{
  check(weatherCalls({ lightning: 0.4, windKts: 10 }).join() === 'lightning' && weatherCalls({ lightning: 0.1, windKts: 35 }).join() === 'wind' && !weatherCalls({ lightning: 0.1, windKts: 12 }).length, 'storms near the pad and ground winds over 30 kt are weather calls');
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const stormy = { ...r.breakdown, weather: { ...r.breakdown.weather, lightning: 0.5, windKts: 38 } };
  const poll = evaluate(r.spec, { blocks: r.blocks, money: balance.startMoney, fee: r.breakdown.launchFee, text, oneWay: r.breakdown.oneWay, breakdown: stormy });
  const calls = poll.lines.filter((l) => l.consoleId === 'weather' && l.status === 'NO-GO');
  check(calls.length === 2 && poll.needsOverride && poll.canConfirm && !poll.warnings.length && poll.calls.length === 2, `the weather console calls NO-GO, overridable, without a new contract warning: "${calls.map((l) => l.text).join(' | ')}"`);
  const calm = evaluate(r.spec, { blocks: r.blocks, money: balance.startMoney, fee: r.breakdown.launchFee, text, oneWay: r.breakdown.oneWay, breakdown: r.breakdown });
  check(!calm.calls.length, `Reliable's launch day is inside the weather rules (lightning ${r.breakdown.weather.lightning}, wind ${r.breakdown.weather.windKts} kt)`);
  const struck = L.buildAsFlown({ ...r, breakdown: { ...r.breakdown, padFx: { ...r.breakdown.padFx, lightningRisk: 1, holdDownCatch: 0 } } }, ctxOf(a));
  check(struck.scrub || (struck.defects.some((d) => d.kind === 'lightning') && Math.abs(struck.spec.stats.reliability - r.spec.stats.reliability * L.LUCK.lightningHit) < 1e-9), 'a lightning strike after liftoff costs the electronics (reliability × 0.9), as on Apollo 12');
  const over = { ...r.breakdown, padFx: { ...r.breakdown.padFx, excess: 0.3 } };
  check(thinConsoles(r.spec, { breakdown: over }).has('pad') && !thinConsoles(r.spec, { breakdown: r.breakdown }).has('pad'), 'the pad console says so when the ship pushes harder than the pad takes');
}

// ---------- HOLD ----------
{
  const a = build(preset('reliable'));
  const r0 = computeShipSpec(a, deps);
  const w0 = r0.breakdown.weather;
  const temps = [w0.forecastC];
  let feeOk = true;
  let prev = r0;
  for (let i = 0; i < 5; i++) {
    const plan = holdPlan(a.launch, prev.breakdown.weather);
    a.setLaunch(plan.patch);
    const next = computeShipSpec(a, deps);
    if (next.breakdown.weather.day !== prev.breakdown.weather.day + 1) feeOk = false;
    if (Math.abs(next.breakdown.launchFee - prev.breakdown.launchFee - plan.fee) > 1) feeOk = false;
    temps.push(next.breakdown.weather.forecastC);
    prev = next;
  }
  check(feeOk && (w0.holdFee ?? 0) > 0, `HOLD moves launch day on by one and adds the hold fee (${w0.holdFee}) to the launch fees each time`);
  check(new Set(temps).size > 1, `HOLD changes the weather: ${temps.map((t) => `${t} °C`).join(', ')}`);
}

// ---------- reuse with wear ----------
{
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const cost = r.spec.stats.cost;
  const fees = [1, 2, 3, 6, 20].map((n) => L.refurbFee(cost, n));
  check(fees.every((x, i) => i === 0 || x > fees[i - 1]) && fees[0] < cost * 0.5 && fees.at(-1) <= cost, `refurbishment grows per flight: ${fees.map((x) => `$${(x / 1e6).toFixed(2)}M`).join(', ')} (new: $${(cost / 1e6).toFixed(2)}M)`);
  let wear = null;
  const means = [];
  for (let i = 0; i < 6; i++) { wear = L.wearAfterFlight(wear, { layout: a.layout(), hull: a.hull }); means.push(L.meanWear(wear)); }
  check(means.every((m, i) => i === 0 || m > means[i - 1]), `wear grows per flight: ${means.map(pc).join(', ')}`);
  check(L.defectChance(0.97, 0.3) > L.defectChance(0.97, 0) && L.wornRisk(0, 0.3) > 0, 'wear makes defects and skin failures more likely');
  // (wave 5: wear adds risk as wear⁴, so six flights add almost nothing, as with real boosters; a ship near the end of
  // its rated life, 20 flights here, shows the extra defects)
  const old = (() => { let x = null; for (let i = 0; i < 20; i++) x = L.wearAfterFlight(x, { layout: a.layout(), hull: a.hull }); return x; })();
  const fresh = flyMany(r, a, N, { stage: 'stand' }).filter((f) => f.defects.length).length;
  const six = flyMany(r, a, N, { stage: 'stand', wear }).filter((f) => f.defects.length).length;
  const worn = flyMany(r, a, N, { stage: 'stand', wear: old }).filter((f) => f.defects.length).length;
  check(worn > fresh && six >= fresh && six - fresh < (worn - fresh) / 2, `a ship near the end of its life (20 flights) has more defects: ${worn} against ${fresh} new, ${six} after six flights, in ${N} builds`);
  check(L.staticFireFee(r.breakdown) > 0 && L.staticFireFee(r.breakdown) < cost * 0.1, `a static fire is a small fee ($${L.staticFireFee(r.breakdown).toLocaleString('en-US')})`);
}

// ---------- wear follows the material and what the flight did (wave 5) ----------
{
  const a = build(preset('reliable'));
  const r = computeShipSpec(a, deps);
  const layout = a.layout();
  const ctx = { layout, hull: a.hull, breakdown: r.breakdown, materials };
  const tank = layout.find((e) => e.id === 'p3'), engine = layout.find((e) => e.id === 'p4');
  const tankWear = (m, loads = {}) => L.partWear({ ...tank, material: m }, loads, { materials }).delta;
  const tw = Object.fromEntries(['titanium', 'stainless', 'al2219', 'al_li', 'carbon'].map((m) => [m, tankWear(m)]));
  // Al-Li resists fatigue cracks a little better than 2219, as the skins in hull.json have it (2195 3 %, 2219 4 %)
  check(tw.titanium < tw.stainless && tw.stainless < tw.al_li && tw.al_li < tw.al2219 && tw.al2219 < tw.carbon, `tank wear per flight by metal: titanium ${pc(tw.titanium)} < steel ${pc(tw.stainless)} < Al-Li ${pc(tw.al_li)} < Al 2219 ${pc(tw.al2219)} < carbon ${pc(tw.carbon)}`);
  check(Math.abs(1 / L.WEAR.tank.base - 40) < 1e-9 && Math.abs(1 / L.WEAR.engine.base - 25) < 1e-9 && Math.abs(1 / L.WEAR.capsule - 15) < 1e-9, 'rated lives: a stage 40 flights (Falcon 9), an engine 25 (the number in SpaceX accounts), a capsule 15 (Crew Dragon)');
  const ew = Object.fromEntries(['inconel', 'copper', 'printed'].map((m) => [m, L.partWear({ ...engine, material: m }, {}, { materials }).delta]));
  check(ew.inconel < ew.copper && ew.copper < ew.printed && Math.abs(ew.copper - L.WEAR.engine.base) < 1e-9, `engine wear per flight: Inconel ${pc(ew.inconel)} < copper ${pc(ew.copper)} < printed ${pc(ew.printed)}`);
  check(tankWear('al_li', { peakQ: 40000 }) > tankWear('al_li', { peakQ: 30000 }) && tankWear('al_li', { peakQ: 30000 }) > tankWear('al_li', { peakQ: 15000 }), 'a harder Max-Q wears the tanks faster (fatigue ∝ stress³)');
  const starts = (n, hot) => L.partWear(engine, { starts: n, engineTempPeak: hot }, { materials }).delta;
  check(starts(6, 0.5) > starts(3, 0.5) && starts(3, 0.95) > starts(3, 0.5), 'every engine start past three, and running near the heat limit, wears the engine faster');
  // the skin: its own fatigue rate, heat near its limit, hits by toughness
  const mats = Object.fromEntries(H.hullChoices('body').map((m) => [m.id, m]));
  const sw = (id, loads) => L.skinWear(mats[id], 'body', loads, { info: r.breakdown.hull.bySection.body }).delta;
  check(sw('steel', {}) < sw('al2219', {}) && sw('al2219', {}) < sw('honeycomb', {}), `skin wear per flight: steel ${pc(sw('steel', {}))} < Al 2219 ${pc(sw('al2219', {}))} < honeycomb ${pc(sw('honeycomb', {}))}`);
  check(sw('al2195', { skinTempC: { body: 145 } }) > 1.5 * sw('al2195', { skinTempC: { body: 60 } }), 'a skin near its rated temperature wears faster (Al-Li at 145 °C against 60 °C)');
  const hit = { hits: [{ section: 'body', damage: 1 }] };
  check(sw('carbon', hit) - sw('carbon', {}) > sw('steel', hit) - sw('steel', {}), 'a hit wears a carbon skin more than a steel one (toughness)');
  check(L.skinToughness(mats.al2219, 'body', { structure: { skin: { body: { toughness: 3 } } } }) === 3 && L.skinToughness(mats.al2219, 'body', { structure: { skin: { body: { toughness: 80 } } } }) === 5, 'the structure group may give the skin its own toughness (a bounded factor)');
  // heat shields: an ablator is consumed and replaced; tiles stay and crack
  const shield = layout.find((e) => e.def.flags?.heatShield && !e.def.flags?.capsule);
  const ab = L.partWear(shield, {}, { materials });
  check(ab.consumed === L.WEAR.shield.ablator.avcoat && !(L.wearOfFlight(ctx).parts[shield.id] > 0) && L.wearOfFlight(ctx).consumed[shield.id] === ab.consumed, `an Avcoat ablator is consumed (${pc(ab.consumed)}) and replaced, not carried as wear`);
  check(L.partWear({ ...shield, options: { ...(shield.options ?? {}), ablator: 'pica' } }, {}, { materials }).consumed < ab.consumed, 'PICA burns away less than Avcoat');
  check(L.partWear(shield, { entered: false }, { materials }).consumed === 0 && L.partWear(shield, { shieldUse: 0.8 }, { materials }).consumed === 0.8, 'a shield that never entered is not used; a measured use is taken as it is');
  const tiles = { ...shield, def: { ...shield.def, flags: { ...shield.def.flags, fragileShield: true } } };
  check(L.partWear(tiles, { hits: [{ section: 'nose' }] }, { materials, sectionOf: () => 'nose' }).delta > L.partWear(tiles, {}, { materials }).delta && !(L.partWear(tiles, {}, { materials }).consumed > 0), 'tiles stay on the ship and crack more for each hit');
  const legs = layout.find((e) => e.def.flags?.legs);
  check(L.partWear(legs, { landed: false }, {}).delta === 0 && L.partWear(legs, { touchdownSpeed: 2.8, touchdownLimit: 3 }, {}).delta > L.partWear(legs, { touchdownSpeed: 1, touchdownLimit: 3 }, {}).delta, 'legs wear only on a touchdown, more on a hard one');
  // a section without skin does not wear; with no flight given, the old nominal wear stays
  const d = L.wearOfFlight(ctx);
  check(!('tail' in d.hull) && d.hull.body > 0, 'only the sections with a skin wear');
  // the refurbishment follows the wear; what was consumed is paid for in full
  const cost = r.spec.stats.cost;
  let w = null;
  const fees = [];
  for (let i = 0; i < 8; i++) { w = L.wearAfterFlight(w ? { parts: w.parts, hull: w.hull } : null, ctx); fees.push(L.refurbFee(cost, i + 1, { wear: w, breakdown: r.breakdown })); }
  check(fees.every((x, i) => i === 0 || x > fees[i - 1]) && fees[0] < cost * 0.4 && fees.at(-1) <= cost * L.LUCK.refurb.max, `refurbishment follows the wear: ${fees.map((x) => `$${(x / 1e6).toFixed(2)}M`).join(', ')} (new: $${(cost / 1e6).toFixed(2)}M)`);
  const plan = L.refurbish(cost, { wear: w, breakdown: r.breakdown });
  check(plan.lines.some((l) => l.kind === 'replace' && l.partId === shield.id) && plan.lines.some((l) => l.kind === 'repair' && l.partId === 'p4') && plan.lines.some((l) => l.kind === 'skin'), 'the refurbishment bill: inspection, repairs by wear, the skin, a new ablator');
  const steel = build(preset('reliable')); steel.setHull('body', 'steel'); steel.setHull('nose', 'steel');
  for (const t of ['p3', 'p21']) steel.setMaterial(t, 'titanium');
  const rs = computeShipSpec(steel, deps);
  const ws = L.wearAfterFlight(null, { layout: steel.layout(), hull: steel.hull, breakdown: rs.breakdown, materials });
  const wa = L.wearAfterFlight(null, ctx);
  check(L.meanWear(ws) < L.meanWear(wa), `a steel skin with titanium tanks wears less per flight (${pc(L.meanWear(ws))} against ${pc(L.meanWear(wa))})`);
  // reliability falls with wear, as buildAsFlown rolls it
  const rel = r.spec.stats.reliability;
  const r1 = L.wornReliability(rel, r.breakdown, { parts: w.parts, hull: w.hull }, layout);
  check(L.wornReliability(rel, r.breakdown, null, layout) === rel && r1 < rel, `reliability with wear after 8 flights: ${pc(r1)} (new ${pc(rel)})`);
  // wear-out: almost no added risk for most of a part's life, climbing near its end (Weibull shape about 4)
  const extra = (w) => L.defectChance(0.97, w) - L.defectChance(0.97, 0);
  check(extra(0.3) < 0.002 && extra(0.5) < 0.01 && extra(0.9) > 5 * extra(0.5) && L.wornRisk(0, 1) === L.LUCK.wearFloor, `wear-out curve: added defect chance ${pc(extra(0.3))} at 30 % of life, ${pc(extra(0.5))} at half, ${pc(extra(0.9))} at 90 %`);
  const relAfter = (k) => { let x = null; for (let i = 0; i < k; i++) x = L.wearAfterFlight(x ? { parts: x.parts, hull: x.hull } : null, ctx); return L.wornReliability(rel, r.breakdown, { parts: x.parts, hull: x.hull }, layout); };
  check(rel - relAfter(10) < 0.01 && relAfter(20) < relAfter(10) - 0.03, `like a Falcon 9 booster: reliability ${pc(relAfter(5))} after 5 flights, ${pc(relAfter(10))} after 10, ${pc(relAfter(20))} after 20 (new ${pc(rel)})`);
}

// ---------- the investigation ----------
{
  const rec = { need: { oneWay: 5400 }, designed: { deltaV: 5500 }, asBuilt: { deltaV: 5350 }, outcome: { endingId: 'adrift', causeId: 'out_of_fuel' }, groups: { engines: ['p4'], tanks: ['p3'] }, defects: [{ kind: 'leak', partId: 'p21' }] };
  const v = L.investigate(rec);
  check(v.verdict === 'builtShort' && v.question === 'margin' && v.partIds.includes('p4') && v.partIds.includes('p21') && Math.round(v.shortBy) === 50, 'the board finds "enough on paper, short as built", the parts and the question');
  check(L.investigate({ ...rec, designed: { deltaV: 5000 }, asBuilt: { deltaV: 5100 } }).verdict === 'paperShort', 'and "short even on paper"');
  const cold = L.investigate({ need: { oneWay: 5400 }, designed: { deltaV: 3400 }, asBuilt: { deltaV: 3390 }, outcome: { endingId: 'coldMorning', causeId: 'seal_failure_cold' }, groups: { seals: ['p12'] }, defects: [{ kind: 'leak', partId: 'p3' }, { kind: 'coldSeals', partId: null }] });
  check(!cold.numbersFirst && cold.defects[0].kind === 'coldSeals' && cold.question === 'cold', 'on a cold morning the seals are the headline, not the Δv gap');
  check(L.localNumber(5400, 'vi') === '5.400' && L.localNumber(-0.21, 'vi', 1) === '−0,2' && L.localNumber(-4, 'en') === '−4' && L.localText('3,380 kN, 0.2 %', 'vi') === '3.380 kN, 0,2 %', 'numbers in each language: 5,400 / 5.400, −0,2, a real minus');
  check(L.describeDefect({ kind: 'coldSeals', tempC: -4, forecastC: 2 }, text.luck.defects, 'en').startsWith('−4 °C'), 'defect text uses a real minus sign');
  const words = L.describeDefect({ kind: 'weak', name: 'Engine', unit: 2, count: 9, pct: 0.09 }, text.luck.defects, 'vi');
  check(/động cơ số 3\/9/.test(words) && /9 %/.test(words), `defects in Vietnamese: "${words}"`);
  const b = text.board;
  const missing = [];
  const walk = (o, at) => { if (o && typeof o === 'object') { if ('en' in o && !o.vi) missing.push(at); for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`); } };
  walk(b, 'board'); walk(text.luck.defects, 'luck.defects');
  check(!missing.length, `every board and defect text has Vietnamese${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  const endings = Object.keys(contract.ENDINGS).filter((id) => !b.endings?.[id]);
  check(!endings.length, `every ending has a board title${endings.length ? `: missing ${endings.join(', ')}` : ''}`);
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll luck checks passed.');
process.exit(failures ? 1 : 0);
