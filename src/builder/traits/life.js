// Flight traits, life: the crew's life support: oxygen in kilograms (minutes of spacewalk), carbon-dioxide scrubbing, water, the radiation dose behind the shelter on the way to Mars.
// Pure (Node-testable, no browser or core imports). Owner: the wave-5 life agent (see src/builder/CLAUDE.md §8).
// Real numbers live in life.json next to this file (per part id and per kit option id), never in the section folders;
// they arrive as `data` (catalogData.js imports the JSON for the game, the tests read it), so this file stays pure.
// Returns plain JSON (no Infinity: use null for "unlimited"), so it survives save() and the flight scenes.
//
// What the readers do with it (each one falls back to today's behaviour when a field is missing):
//   src/surface/oxygen.js + astronaut.js  the suit holds suit.primaryO2Kg and burns it at the real metabolic rate; the
//                                         o2Station tops it up from o2.tanks; every trip outside vents cabin.exitKg
//   src/surface/shipInterior.js           the prebreathe lasts cabin.prebreathe × the full time (none in pure oxygen)
//   src/cruise/life.js                    tank seep and boil-off, the cabin leak, the oxygen-tank emergency, CO₂
//                                         scrubbing and its backups, water, the radiation dose behind the shielding
//
// A trip outside costs: the suit's fill (0.544 kg), the cabin's (or airlock's) oxygen vented to Mars, and the cabin
// breathing for the rest of that sol (0.61 kg; none with the regenerative loop). A sea-level cabin also vents its
// nitrogen (0.91 kg/m³) from a 30 kg allowance; with none left it is refilled with 5 psi of pure oxygen instead.
// The trade-offs (each option is best at something):
//   o2_bottle        cheap 50 L steel cylinder at 150 bar: 10.4 kg, but 41 % of it is below the suit's 62 bar; a
//                    separate valve per bottle (the oxygen-tank emergency cannot reach the others)
//   o2_tank_l        composite tank at 414 bar (NORS class): 36.3 kg, 85 % usable, a fifth of the seep per kg; dear,
//                    and one valve: the emergency reaches all of it
//   cryogenic (SM)   by far the most oxygen per kg, but it boils off about 1 %/day: made for weeks, not months
//   airlock          a few hundred kg, but only the airlock's air (and nitrogen) is lost each trip, not the cabin's
//   pure-O₂ cabin    no prebreathe and no nitrogen to run out, but more oxygen vented per trip (and Apollo 1's fire risk)
//   regenerative     makes the cabin's oxygen from water (fewer kg a trip), no LiOH to run out, 98 % of the water
//                    back; but a failure needs a backup scrubber it does not carry
//   LiOH canisters   cheap backup that needs no power, but it lasts about 16 crew-days
//   shelter          600 kg of water walls: a solar storm gives under a third of the unshielded dose
//   water_recycler   no felt effect yet (the planned stores cover the water); the hangar shows the water it saved

const R = 8.314; // J/(mol·K)
const M_O2 = 0.032; // kg/mol
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const num = (x, fallback = 0) => (Number.isFinite(Number(x)) ? Number(x) : fallback);

/** O₂ use in kg/h at a metabolic rate in watts (Weir: 20.2 kJ per litre of O₂, 699.8 L per kg). */
export function o2KgPerHour(watts, body = {}) {
  const kJPerL = num(body.kJPerLitreO2, 20.2), lPerKg = num(body.litresPerKgO2, 699.8);
  return (num(watts) * 3.6) / kJPerL / lPerKg;
}

/** kg of O₂ in one m³ of cabin air with this oxygen partial pressure (kPa) at kelvin. */
export const o2KgPerM3 = (o2kPa, kelvin = 295) => (num(o2kPa) * 1000 * M_O2) / (R * kelvin);

/** Usable oxygen of a tank list: what can still flow into the suit (above its fill pressure). */
export const usableKg = (tanks = []) => tanks.reduce((t, k) => t + Math.max(0, num(k.kg) - num(k.residualKg)), 0);

/**
 * Full trips outside that `o2Kg` of usable oxygen and `n2Kg` of nitrogen still give. Each trip costs `tripKg` of
 * oxygen and `n2PerTrip` of nitrogen; once the nitrogen is gone the cabin is refilled with pure oxygen at 5 psi, a
 * trip then costs `tripKgNoN2`. (src/surface/oxygen.js counts the same way.)
 */
export function tripsLeft(o2Kg, n2Kg, { tripKg, n2PerTrip = 0, tripKgNoN2 = tripKg } = {}) {
  if (!(tripKg > 0)) return 0;
  const byO2 = Math.floor(Math.max(0, o2Kg) / tripKg + 1e-9);
  if (!(n2PerTrip > 0)) return byO2;
  const byN2 = Math.floor(Math.max(0, n2Kg) / n2PerTrip + 1e-9);
  if (byO2 <= byN2) return byO2;
  return byN2 + Math.floor(Math.max(0, o2Kg - byN2 * tripKg) / Math.max(1e-9, tripKgNoN2) + 1e-9);
}

/**
 * lifeTraits(layout, ctx, data) → this group's traits for ShipSpec.stats.traits.life.
 * layout: assembly.layout() entries; ctx: { catalog, engines, materials, hull, padFx, stats, optionsOf(entry) };
 * data: the parsed life.json ({ neutral, suit, tanks, … }). With no data: the neutral values (the game as before).
 */
export function lifeTraits(layout, ctx, data) {
  if (!data?.suit || !Array.isArray(layout)) return { ...(data?.neutral ?? {}) };
  const opts = (e) => (e?.def?.internals && ctx?.optionsOf ? ctx.optionsOf(e) ?? {} : {});
  const flag = (e, k) => e?.def?.flags?.[k];
  const body = data.body ?? {};

  // ---- the suit (the game's suit is one EMU for every ship) ----
  const s = data.suit;
  const walkKgPerH = o2KgPerHour(s.walkW, body), runKgPerH = o2KgPerHour(s.runW, body);
  const hours = s.primaryO2Kg / walkKgPerH;
  const gameSeconds = num(s.gameSecondsPerFill, 300);
  const suit = {
    id: s.id, name: s.name, primaryO2Kg: s.primaryO2Kg, primaryBar: s.primaryBar,
    walkKgPerH: round(walkKgPerH, 4), runKgPerH: round(runKgPerH, 4), hours: round(hours, 2),
    runMultiplier: round(s.runW / s.walkW, 3), gameSecondsPerFill: gameSeconds,
    evaScale: round((hours * 3600) / gameSeconds, 2), // real seconds of suit time in one game second
  };

  // ---- the cabin: its air, its volume, and what each trip outside vents ----
  const capsule = layout.find((e) => flag(e, 'capsule')) ?? null;
  const kit = opts(capsule);
  const loop = kit.lifeSupport?.id === 'regenerative' ? 'regenerative' : 'open';
  const atmosphere = data.air?.[kit.atmosphere?.id] ? kit.atmosphere.id : 'mixed';
  const air = data.air?.[atmosphere] ?? { o2kPa: 21.3, o2MassShare: 0.232, prebreathe: 1 };
  const kelvin = num(data.air?.kelvin, 295);
  const cabinRow = (capsule && data.cabins?.[capsule.type]) || data.cabins?.default || { m3: 4 };
  const airlockEntry = layout.find((e) => flag(e, 'airlock')) ?? null;
  const airlockM3 = airlockEntry ? num(data.airlocks?.[airlockEntry.type]?.m3, 3) : (Number.isFinite(cabinRow.airlockM3) ? cabinRow.airlockM3 : null);
  const exitM3 = airlockM3 ?? num(cabinRow.m3, 4);
  const exitKg = exitM3 * o2KgPerM3(air.o2kPa, kelvin);
  // the nitrogen of a sea-level cabin goes out with it; without nitrogen left, refill with 5 psi of pure oxygen
  const n2kPa = Math.max(0, num(air.totalkPa, air.o2kPa) - num(air.o2kPa));
  const n2PerTrip = (exitM3 * n2kPa * 1000 * 0.028) / (R * kelvin);
  const exitKgNoN2 = exitM3 * o2KgPerM3(num(data.air?.pure_o2?.o2kPa, 34.5), kelvin);
  // between walks the crew breathes the cabin's air for the rest of the sol: from the spare tanks, unless the
  // regenerative loop's oxygen generator makes it from water
  const cabinKgPerTrip = loop === 'regenerative' ? 0 : num(body.restO2KgPerDay, 0.84) * Math.max(0, num(data.mars?.solHours, 24.66) - hours) / 24;
  const cabin = {
    capsuleId: capsule?.id ?? null, capsuleType: capsule?.type ?? null, loop, atmosphere,
    o2kPa: air.o2kPa, o2MassShare: air.o2MassShare, prebreathe: num(air.prebreathe, 1),
    cabinM3: num(cabinRow.m3, 4), airlockPartId: airlockEntry?.id ?? null, airlockM3, exitM3, exitKg: round(exitKg, 3),
    exitVia: airlockM3 != null ? 'airlock' : 'cabin',
  };

  // ---- the spare oxygen: one entry per physical tank (each has its own valve) ----
  const tanks = [];
  for (const e of layout) {
    const n = Number(flag(e, 'spareO2Tanks')) || 0;
    if (n <= 0) continue;
    const known = data.tanks?.[e.type];
    const row = known ?? data.fallbackTank ?? { kind: 'steel_hp', kg: 14, bar: 200, leakPerDay: 0.000015, tanks: 1 };
    const count = Math.max(1, known ? num(row.tanks, 1) : n);
    const kgEach = (known ? num(row.kg) : num(row.kg) * n) / count;
    const kind = data.tankKinds?.[row.kind] ?? {};
    const residualShare = Number.isFinite(kind.residualShare) ? kind.residualShare : Math.min(1, num(s.primaryBar, 62) / Math.max(1, num(row.bar, 200)));
    for (let i = 0; i < count; i++) {
      tanks.push({
        partId: e.id, type: e.type, name: e.def?.name ?? e.type, unit: i, kind: row.kind, bar: num(row.bar),
        kg: round(kgEach, 3), residualKg: round(kgEach * residualShare, 3), leakPerDay: num(row.leakPerDay),
      });
    }
  }
  const storeKg = tanks.reduce((t, k) => t + k.kg, 0);
  const usable = usableKg(tanks);
  const tripKg = s.primaryO2Kg + exitKg + cabinKgPerTrip;
  const tripKgNoN2 = s.primaryO2Kg + exitKgNoN2 + cabinKgPerTrip;
  const n2 = n2PerTrip > 0 ? { kg: num(data.nitrogen?.allowanceKg, 30), perTripKg: round(n2PerTrip, 3), exitKgNoN2: round(exitKgNoN2, 3) } : null;
  const o2 = {
    tanks, storeKg: round(storeKg, 2), usableKg: round(usable, 2), suitFillKg: s.primaryO2Kg, exitKg: round(exitKg, 3),
    cabinKgPerTrip: round(cabinKgPerTrip, 3), tripKg: round(tripKg, 3), tripKgNoN2: round(tripKgNoN2, 3), n2,
    refills: tripsLeft(usable, n2?.kg ?? 0, { tripKg, n2PerTrip, tripKgNoN2 }),
    leakKgPerDay: round(tanks.reduce((t, k) => t + k.kg * k.leakPerDay, 0), 5),
    separateTanks: tanks.length,
  };

  // ---- CO₂: the cabin loop, and the parts that back it up ----
  const sc = data.scrubbers ?? {};
  const unit = (id, row, extra = {}) => ({ id, kind: row.kind, regenerable: !!row.regenerable, crewDays: null, failPerTrip: num(row.failPerTrip, 0.001), mmHg: num(row.mmHg, 2), peakmmHg: num(row.peakmmHg, num(row.mmHg, 2)), ...extra });
  const units = [unit('loop', sc[`loop_${loop}`] ?? sc.loop_open ?? { kind: 'lioh' }, { planned: true })];
  for (const e of layout) {
    if (!flag(e, 'scrubber')) continue;
    const row = sc[e.type];
    if (!row) { units.push(unit(e.id, { kind: 'amine', regenerable: true, failPerTrip: 1 - num(e.def?.reliability, 0.995), mmHg: 2.5 })); continue; }
    if (row.regenerable) { units.push(unit(e.id, row, { partId: e.id, type: e.type })); continue; }
    const co2Kg = num(e.def?.mass) * num(row.liohShare, 0.6) * 0.919 * num(row.utilisation, 0.75);
    units.push(unit(e.id, row, { partId: e.id, type: e.type, crewDays: round(co2Kg / num(body.co2KgPerDay, 1.04), 1) }));
  }
  // the primary is the first unit that regenerates (it saves the canisters); the others are backups
  const firstRegen = units.findIndex((u) => u.regenerable);
  if (firstRegen > 0) units.unshift(...units.splice(firstRegen, 1));
  const co2 = {
    units, primary: units[0].id, backups: units.length - 1, regenerable: units[0].regenerable,
    afterFailuremmHg: num(sc.afterFailuremmHg, 4), riggedmmHg: num(sc.rigged?.peakmmHg, 15),
    lethalmmHg: num(sc.lethalmmHg, 60), limitmmHg: num(sc.limitmmHg, 3), co2KgPerDay: num(body.co2KgPerDay, 1.04),
  };

  // ---- water ----
  const w = data.water ?? {};
  const recovery = Math.max(num(w[`loop_${loop}`]?.recovery), ...layout.filter((e) => flag(e, 'waterRecycler')).map((e) => num(w[e.type]?.recovery, 0.9)));
  const water = { recovery: round(recovery, 3), needKgPerDay: num(body.waterKgPerDay, 3), bufferDays: num(w.bufferDays, 7) };

  // ---- radiation shielding (g/cm², aluminium-equivalent) ----
  const rd = data.radiation ?? {};
  const hf = num(rd.hydrogenFactor, 1.3);
  const gcm2 = (kg, m2) => (num(kg) / Math.max(0.1, num(m2, 1))) / 10; // kg/m² → g/cm²
  const waterWalls = layout.filter((e) => opts(e).stowage?.id === 'water_wall').length;
  const waterWallGcm2 = gcm2(waterWalls * num(rd.waterWallKg, 150), rd.cabinM2 ?? 20);
  const wall = num(rd.wallGcm2, 5) + waterWallGcm2 * hf;
  let shelterWater = null, shelterPartId = null;
  for (const e of layout) {
    if (!flag(e, 'shelter')) continue;
    const g = gcm2(rd.shelterParts?.[e.type]?.waterKg ?? 600, rd.nookM2 ?? 8);
    if (shelterWater == null || g > shelterWater) { shelterWater = g; shelterPartId = e.id; }
  }
  const radiation = {
    wallGcm2: round(wall, 2), shelterGcm2: shelterWater == null ? null : round(wall + shelterWater * hf, 2), shelterPartId,
    improvisedGcm2: round(wall + num(rd.atHandWaterGcm2, 4) * hf, 2),
    gcrFactor: round(Math.max(num(rd.gcrFloor, 0.7), 1 - num(rd.gcrPerGcm2Water, 0.01) * (waterWallGcm2 + num(rd.gcrSleepShare, 0.33) * (shelterWater ?? 0))), 4),
    careerLimitMsv: num(rd.careerLimitMsv, 600), thirtyDayLimitMsv: num(rd.thirtyDayLimitMsv, 250),
  };

  return { version: 1, crew: num(data.crew, 1), suit, cabin, o2, co2, water, radiation, restO2KgPerDay: num(body.restO2KgPerDay, 0.84), words: data.words ?? {} };
}
