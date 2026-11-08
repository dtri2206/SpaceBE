// What the launch pad does to the ship (Role 1, the pad section). Pure and deterministic: no browser or core imports.
//
// The pad is the ground hardware under the rocket, at a real launch complex (sections/pad/section.json: `sites` are the
// complexes, `equipment` the eight kinds of ground hardware). Each complex comes with its own kit of equipment; the
// player may swap any piece (launch.pad = { equipmentKey: optionId } overrides the kit).
//
// The heat limit is the thrust the pad takes at full power without damage:
//   heatLimitKN = mount.heatKN × complex.scale × (deluge.heatF + mount.waterPlate when there is water)
// A ship pushing more on the pad (thrustSL) than that gets all four consequences the user chose (NOTES.md, "Heat limit"):
//   (a) the engines are held back until the ship clears the tower (about CLEAR_S seconds): the flight does it for real
//       (traits.propulsion.pad, src/flight/effects/propulsion.js), so the climb off a cheap pad is visibly slow; the Δv it
//       costs (liftoffLossMps, alias heldBackMps) is an estimate for the words only, nothing is subtracted in the builder,
//   (b) hot gas and flying concrete may hurt an engine: damageChance (asBuilt.js rolls it),
//   (c) the pad needs repairs, charged with the next launch: repairFee,
//   (d) hold-down clamps check the engines at full thrust before release: holdDownCatch (any bad engine, debris or not).
// Every formula and its real basis is in NOTES.md.

// ---------- model constants (game values; the real basis of each is in NOTES.md) ----------
/** Seconds the plume plays on the pad: until the ship clears its tower (the Shuttle cleared it about 7 s in). The rough Δv
 * estimate when the ship's mass is not known. */
export const CLEAR_S = 7;
/**
 * Height of the tower the held ship must clear for the Δv estimate (m): 1.2 × the 20 m reference ship of the pad models
 * (the pad art's real proportion, tower 1.1–1.3 × the rocket). The flight uses the real ship's height
 * (traits.propulsion.pad.clearM).
 */
export const CLEAR_M = 24;
/** Booster engines at liftoff are not run below about 60 % (the RS-25 throttled to 67 %, Merlin and Raptor lower). */
export const MIN_THROTTLE = 0.6;
/** Even held back, the slower climb keeps the fire on the pad longer: half of the overload's heat dose remains. */
export const DOSE_SHARE = 0.5;
/** Chance an engine is hurt by debris per unit of overload, before the mount and water factors; and its cap. */
export const DEBRIS_K = 0.25;
export const DAMAGE_CAP = 0.5;
/**
 * Pad repairs per unit of overload and their cap: deliberate game values. STS-124 tore 3,500 bricks out of LC-39A's
 * trench (about $2.5M on a roughly $450M flight); here repairs stay a sting next to a $3–5M ship.
 */
export const REPAIR_PER = 250000;
export const REPAIR_CAP = 280000;
/** Acoustic load: reliability lost per 1,000 kN on the pad with no water (sound power grows with jet power), and its cap. */
export const ACOUSTIC_PER_MN = 0.004;
export const ACOUSTIC_CAP = 0.015;
/** A lightning risk is half a strike on the pad (lightning protection) and half a strike set off in flight (weather watch). */
export const STRIKE_SHARE = 0.5;
/** With the ship's mass known, the throttled thrust never drops below this thrust-to-weight ratio. */
export const MIN_TWR_HELD = 1.15;

const sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = (x, step) => Math.round(x / step) * step;

/** The launch complex of a launch block: its id (`site`, or `complex`), an old site id (aliases), else the first. */
export function complexOf(launch, pad) {
  const sites = pad?.sites ?? [];
  const id = launch?.site ?? launch?.complex ?? null;
  return sites.find((s) => s.id === id) ?? sites.find((s) => (s.aliases ?? []).includes(id)) ?? sites[0] ?? null;
}

/**
 * The pad as set up: the complex and every piece of equipment with the option in use.
 * An option comes from launch.pad (the player's choice) when it exists, else from the complex's kit, else the first.
 * → { complex, choices: [{ eq, option, fromKit }], day }
 */
export function padSetup(launch, pad) {
  const complex = complexOf(launch, pad);
  const choices = (pad?.equipment ?? []).map((eq) => {
    const own = eq.options.find((o) => o.id === launch?.pad?.[eq.key]);
    const kit = eq.options.find((o) => o.id === complex?.kit?.[eq.key]);
    const option = own ?? kit ?? eq.options[0];
    return { eq, option, fromKit: !own || own.id === kit?.id };
  }).filter((c) => c.option);
  const day = Math.max(0, Math.floor(Number(launch?.day) || 0));
  return { complex, choices, day };
}

/** The option in use for one equipment key (from padSetup's choices), or null. */
export const optionFor = (setup, key) => setup.choices.find((c) => c.eq.key === key)?.option ?? null;

/** Fees of a complex with its own kit (what the complex list shows as its price). */
export function kitFee(complex, pad) {
  const setup = padSetup({ site: complex?.id }, pad);
  return (complex?.fee ?? 0) + sum(setup.choices, (c) => c.option.fee ?? 0);
}

/**
 * Heat limit (kN of sea-level thrust) of a complex with these choices. Water multiplies what the mount takes; on a mount
 * with no trench (waterPlate) the water-cooled steel plate also turns the fire, so water counts for more there.
 */
export function heatLimitOf(setup) {
  const mount = optionFor(setup, 'mount'), deluge = optionFor(setup, 'deluge');
  const water = deluge?.heatF ?? 1;
  return (mount?.heatKN ?? 320) * (setup.complex?.scale ?? 1) * (water + (water > 1 ? (mount?.waterPlate ?? 0) : 0));
}

/**
 * The liftoff on a pad of heat limit `limitKN` with `thrustKN` on it. Pure numbers.
 * g (m/s²) is Earth's surface gravity from the caller; the ship's weight (wetMass × g) sets how far the engines may be
 * held back. Without g nothing is held back: no loss, and the pad takes the whole overload.
 * → { excess, throttle, residual, overload, lossMps }
 */
export function liftoffOn(limitKN, thrustKN, { g = null, wetMass = null } = {}) {
  const r = limitKN > 0 ? thrustKN / limitKN : 0;
  const excess = Math.max(0, r - 1);
  if (!(excess > 0)) return { excess: 0, throttle: 1, residual: 0, overload: 0, lossMps: 0 };
  if (!(g > 0)) return { excess, throttle: 1, residual: excess, overload: excess, lossMps: 0 };
  // the lowest the engines may go: MIN_THROTTLE, and (when the mass is known) enough to climb away at MIN_TWR_HELD
  const weight = wetMass > 0 ? wetMass * g : 0;
  const floorTwr = weight > 0 && thrustKN > 0 ? (MIN_TWR_HELD * weight) / (thrustKN * 1000) : 0;
  const throttle = clamp(Math.max(1 / r, MIN_THROTTLE, floorTwr), 0, 1);
  const residual = Math.max(0, r * throttle - 1); // still over the limit at that throttle
  const overload = residual + DOSE_SHARE * (excess - residual);
  // what the slow climb costs, as the flight flies it (held until the ship clears the tower, then full thrust): against
  // a full-thrust start, the extra time under gravity to the tower top, g · (t_held − t_full), plus the speed still
  // missing there, √(2 a_full H) − √(2 a_held H) (a = (TWR × throttle − 1) g, H = CLEAR_M). Without the mass: the rough
  // g · CLEAR_S · (1 − throttle).
  const twr = weight > 0 && thrustKN > 0 ? (thrustKN * 1000) / weight : 0;
  let lossMps = g * CLEAR_S * (1 - throttle);
  if (twr > 1 && twr * throttle > 1) {
    const aFull = (twr - 1) * g, aHeld = (twr * throttle - 1) * g;
    lossMps = g * (Math.sqrt((2 * CLEAR_M) / aHeld) - Math.sqrt((2 * CLEAR_M) / aFull)) + (Math.sqrt(2 * aFull * CLEAR_M) - Math.sqrt(2 * aHeld * CLEAR_M));
  }
  return { excess, throttle, residual, overload, lossMps };
}

const pct = (x, d = 0) => `${(x * 100).toFixed(d)} %`;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const kn = (n) => `${Math.round(n).toLocaleString('en-US')} kN`;

/**
 * padEffects(launch, { pad, weather, thrustSL, engineCount, g?, wetMass? }) → {
 *   choices: [{ eq, option, fromKit }] the equipment in use,
 *   fee: launch fees paid at confirm (complex + equipment + days of HOLD from weather.fee + launch.repairDue),
 *   reliability: added to the ship's reliability as (1 + reliability) (equipment bonuses minus the acoustic load),
 *   heatLimitKN, excess (share of thrust over the limit, 0..), throttle (the held throttle the flight flies),
 *   liftoffLossMps (estimate of the Δv the slow climb costs, for the words; alias heldBackMps; the flight realises it),
 *   damageChance (0..1, an engine hurt by debris), repairFee (charged before the next launch),
 *   holdDownCatch (0..1, chance a bad engine is caught on the pad), lightningRisk (0..1),
 *   notes: [] plain English lines for the investigation board, notesI18n: [{ en, vi }] the same lines in both languages,
 *   launch: the ShipSpec launch block ({ tempC, complex, site, day, pad }),
 *   extras: complex, throttle, overload, acoustic, crewEscape, holdS, feeParts: { complex, equipment, hold, repairDue }
 * }
 * g (m/s², planets.earth.g) and wetMass (kg) come from stats.js; without g the engines are not held back (no loss).
 */
export function padEffects(launch, { pad = null, weather = null, thrustSL = 0, engineCount = 0, g = null, wetMass = null } = {}) {
  const setup = padSetup(launch, pad);
  const { complex, choices } = setup;
  const opt = (key) => optionFor(setup, key) ?? {};
  const mount = opt('mount'), deluge = opt('deluge'), clamps = opt('clamps'), tower = opt('tower');
  const lightningGear = opt('lightning'), watch = opt('weather'), access = opt('access');

  // fees: the complex, every piece of equipment, the days of HOLD (weather.js) and repairs left from the last launch
  const equipmentFee = sum(choices, (c) => c.option.fee ?? 0);
  const repairDue = Math.max(0, Number(launch?.repairDue) || 0);
  const feeParts = { complex: complex?.fee ?? 0, equipment: equipmentFee, hold: weather?.fee ?? 0, repairDue };
  const fee = feeParts.complex + feeParts.equipment + feeParts.hold + feeParts.repairDue;

  // heat limit and the liftoff
  const thrustKN = Math.max(0, thrustSL) / 1000;
  const heatLimitKN = heatLimitOf(setup);
  const lift = liftoffOn(heatLimitKN, thrustKN, { g: Number.isFinite(g) && g > 0 ? g : null, wetMass });
  const liftoffLossMps = Math.round(lift.lossMps * 10) / 10;
  const damageChance = lift.overload > 0 ? Math.round(clamp(DEBRIS_K * lift.overload * (mount.debris ?? 1) * (deluge.debrisF ?? 1), 0, DAMAGE_CAP) * 1000) / 1000 : 0;
  const repairRaw = lift.overload > 0 ? REPAIR_PER * lift.overload * (mount.repair ?? 1) * (deluge.debrisF ?? 1) * (1 + 0.25 * (tower.exposure ?? 0)) : 0;
  const repairFee = repairRaw > 0 ? Math.max(5000, round(Math.min(REPAIR_CAP, repairRaw), 5000)) : 0;
  const holdDownCatch = clamp(clamps.catch ?? 0, 0, 1);

  // reliability: the equipment's own bonuses, minus the sound load that grows with thrust and that water soaks up
  const bonus = sum(choices, (c) => c.option.reliability ?? 0);
  const acoustic = Math.min(ACOUSTIC_CAP, ACOUSTIC_PER_MN * thrustKN / 1000 * (deluge.acousticF ?? 1));
  const reliability = Math.round((bonus - acoustic) * 100000) / 100000;

  // lightning on launch day: a strike on the pad (protection) or one set off by the climbing ship (weather watch)
  const dayLightning = clamp(weather?.lightning ?? 0, 0, 1);
  const lightningRisk = Math.round(clamp(dayLightning * (STRIKE_SHARE * (lightningGear.strikeF ?? 1) + (1 - STRIKE_SHARE) * (watch.triggerF ?? 1)), 0, 1) * 1000) / 1000;

  // plain lines for the investigation board
  const lines = [];
  const say = (en, vi) => lines.push({ en, vi });
  if (complex) say(`${complex.name}, ${complex.place}. Heat limit ${kn(heatLimitKN)}; the ship pushed ${kn(thrustKN)} on the pad.`, `${complex.name}, ${complex.placeVi ?? complex.place}. Bệ chịu được ${kn(heatLimitKN)}; tàu đẩy ${kn(thrustKN)} lên bệ.`);
  if (lift.excess > 0) {
    say(`The engines were held at ${pct(lift.throttle)} until the ship cleared the tower, to spare the pad: the slow climb costs about ${Math.round(liftoffLossMps)} m/s of Δv.`, `Động cơ bị giữ ở ${pct(lift.throttle)} lực đẩy cho tới khi tàu vượt khỏi tháp, để đỡ hại bệ: leo chậm như vậy tốn khoảng ${Math.round(liftoffLossMps)} m/s Δv.`);
    if (damageChance > 0) say(`Fire and flying concrete under the engines: about ${pct(damageChance)} chance of hurting an engine.`, `Lửa và bê tông văng dưới động cơ: khoảng ${pct(damageChance)} khả năng làm hỏng một động cơ.`);
    if (repairFee > 0) say(`The pad needs about ${money(repairFee)} of repairs before the next launch.`, `Bệ cần sửa khoảng ${money(repairFee)} trước lần phóng sau.`);
  }
  // each clamps option carries its own line (holdLine, {holdS} = its seconds): the Soyuz support arms are not clamps
  const holdText = (lang, fallback) => String(clamps.holdLine?.[lang] ?? fallback).replace(/\{holdS\}/g, String(clamps.holdS ?? 3));
  if (holdDownCatch > 0) say(holdText('en', 'Hold-down clamps kept the ship on the pad for {holdS} s while the computer checked every engine.'), holdText('vi', 'Kẹp giữ ghì tàu trên bệ {holdS} giây trong lúc máy tính kiểm tra từng động cơ.'));
  else say('No hold-down: the ship left as soon as it could lift, whatever the engines were doing.', 'Không có kẹp giữ: tàu rời bệ ngay khi đủ sức nâng, bất kể động cơ đang thế nào.');
  if (weather) say(`Forecast ${weather.forecastC} °C, actual ${weather.actualC} °C (weather watch good to about ±${weather.errorC ?? '?'} °C). Wind ${weather.windKts} kt, lightning risk ${pct(lightningRisk, 1)}.`, `Dự báo ${weather.forecastC} °C, thực tế ${weather.actualC} °C (trạm thời tiết sai khoảng ±${weather.errorC ?? '?'} °C). Gió ${weather.windKts} hải lý/giờ, nguy cơ sét ${pct(lightningRisk, 1)}.`);
  if (acoustic > 0.002) say(`The roar of the engines shook the ship: reliability −${pct(acoustic, 1)}.`, `Tiếng gầm của động cơ làm rung tàu: độ tin cậy −${pct(acoustic, 1)}.`);
  if (repairDue > 0) say(`Repairs left from the last launch: ${money(repairDue)}.`, `Tiền sửa bệ còn nợ từ lần phóng trước: ${money(repairDue)}.`);

  return {
    choices, fee, reliability, heatLimitKN, excess: Math.round(lift.excess * 1000) / 1000, liftoffLossMps, heldBackMps: liftoffLossMps, damageChance, repairFee, holdDownCatch, lightningRisk,
    notes: lines.map((l) => l.en), notesI18n: lines,
    launch: {
      tempC: weather?.tempC ?? 15,
      ...(complex ? { complex: complex.id, site: complex.id } : {}),
      day: setup.day,
      ...(choices.length ? { pad: Object.fromEntries(choices.map((c) => [c.eq.key, c.option.id])) } : {}),
    },
    complex, throttle: lift.throttle, overload: Math.round(lift.overload * 1000) / 1000, acoustic, crewEscape: access.escape ?? 0, holdS: clamps.holdS ?? 0, feeParts, engineCount,
  };
}
