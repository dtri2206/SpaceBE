// Launch-day weather (Role 1, the pad section). Pure and deterministic: no browser or core imports, no random calls.
//
// The player does not pick a date. The game gives a forecast for launch day at the chosen complex, from its climate
// (sections/pad/section.json, `climate` of each site: a January day, as in a northern-winter Mars window). The readiness
// poll offers HOLD: wait one more day (launch.day + 1) for the complex's hold fee. Money is only spent at confirm, so the
// days waited add up in `fee`, which padEffects puts into the launch fees.
//
// What really happens (actualC) differs from the forecast by an error whose size depends on the weather watch: a cheap
// one can be several degrees wrong. Everything is a hash of the complex id, the day and an optional launch.seed, so the
// same save always gets the same weather. The ShipSpec and the poll use the forecast (tempC); asBuilt.js may fly the
// actual temperature (spec.launch.tempC = actualC) at confirm.
//
// Old saves: launch.slot 'cold' (the old Cape free window, the Challenger setup) becomes a cold front on day 0, read from
// data/launch.json; old site ids land on a complex through its `aliases` (effects.js complexOf).
import { padSetup, optionFor } from './sections/pad/effects.js';

/** Day-to-day weather persists: tomorrow's departure from normal is this share of today's plus fresh noise. */
export const PERSISTENCE = 0.6;
/** The forecast error is drawn within ± this many times the weather watch's typical error. */
export const ERROR_CAP = 2;

// ---------- a small deterministic hash PRNG ----------
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A bell-shaped number of mean 0 and spread 1 (sum of four uniforms, within ±3.46) for one channel of one day. */
export function noise(complexId, day, seed, channel) {
  const r = mulberry(fnv(`${complexId}|${day}|${seed ?? 0}|${channel}`));
  return (r() + r() + r() + r() - 2) * Math.sqrt(3);
}

const round1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DEFAULT_CLIMATE = { meanC: 15, swingC: 3, windKts: 8, windSwingKts: 4, lightning: 0.05, sky: 'clear' };

/**
 * The forecast override, if any: an explicit launch.forecast ({ day, tempC, windKts?, lightning?, label?, seed? }), or
 * the old cold window of data/launch.json (on day 0). It belongs to one launch campaign: once a flight has gone and the
 * next campaign starts with a new launch.seed (index.js), the weather is the climate's again.
 */
function overrideOf(launch, launchData) {
  const seed = Number(launch?.seed) || 0;
  const f = launch?.forecast;
  if (f && typeof f === 'object' && Number.isFinite(f.tempC)) return (Number(f.seed) || 0) === seed ? { ...f, day: Math.max(0, Math.floor(Number(f.day) || 0)) } : null;
  const slot = (launchData?.slots ?? []).find((s) => s.id === launch?.slot);
  if (slot && slot.legacyFront && seed === 0) return { day: 0, tempC: slot.tempC, windKts: slot.windKts, lightning: slot.lightning, label: slot.label ?? slot.note ?? '' };
  return null;
}

/** A short line for the weather, from the temperature, wind, lightning and the climate's usual sky. */
export function weatherLabel(tempC, windKts, lightning, sky = 'clear') {
  const t = tempC < 0 ? 'Freezing' : tempC < 5 ? 'Near freezing' : tempC < 12 ? 'Cool' : tempC < 22 ? 'Mild' : tempC < 28 ? 'Warm' : 'Hot';
  const bits = [];
  if (lightning >= 0.3) bits.push('thunderstorms about');
  else if (lightning >= 0.12) bits.push('showers about');
  else if (tempC < 0 && windKts >= 12) bits.push('blowing snow');
  else bits.push(sky);
  if (windKts >= 25) bits.push('gusty');
  else if (windKts <= 5) bits.push('still');
  return `${t}, ${bits.join(', ')}`;
}

/** When launch day is, in words: day 0 is tomorrow. */
export const dayName = (day) => (day <= 0 ? 'Tomorrow' : `In ${day + 1} days`);

/**
 * weatherFor(launch, { pad, launchData }) → {
 *   day, tempC (what the poll and the ShipSpec use: the forecast), forecastC, actualC (what really happens, may differ
 *   from the forecast), windKts, lightning (0..1, chance of lightning near the pad that day), label (one short line),
 *   fee (hold fees for the days already waited), holdFee (cost of waiting one more day), site (the complex), slot (a
 *   window object { id, name, tempC, fee, note } for old screens),
 *   extras: complex (id), errorC (typical forecast error of the weather watch, °C), when ('Tomorrow'…), climate (name)
 * }
 */
export function weatherFor(launch, { pad = null, launchData = null } = {}) {
  const setup = padSetup(launch, pad);
  const complex = setup.complex;
  const id = complex?.id ?? 'none';
  const day = setup.day;
  const seed = launch?.seed ?? 0;
  const c = { ...DEFAULT_CLIMATE, ...(complex?.climate ?? {}) };
  const watch = optionFor(setup, 'weather');
  const errorC = watch?.errorC ?? 3;
  const ov = overrideOf(launch, launchData);

  // temperature: the climate's mean plus a departure that carries over from day to day (AR(1) from day 0)
  const k = Math.sqrt(1 - PERSISTENCE * PERSISTENCE);
  let anomaly = ov && ov.day === 0 ? ov.tempC - c.meanC : c.swingC * noise(id, 0, seed, 't');
  for (let d = 1; d <= day; d++) {
    anomaly = PERSISTENCE * anomaly + c.swingC * k * noise(id, d, seed, 't');
    if (ov && ov.day === d) anomaly = ov.tempC - c.meanC;
  }
  const here = ov && ov.day === day ? ov : null;
  const forecastC = round1(here ? here.tempC : c.meanC + anomaly);
  const windKts = Math.round(here && Number.isFinite(here.windKts) ? here.windKts : Math.max(0, c.windKts + c.windSwingKts * noise(id, day, seed, 'w')));
  const lightning = Math.round(clamp(here && Number.isFinite(here.lightning) ? here.lightning : c.lightning * (1 + 0.8 * noise(id, day, seed, 'l')), 0, 1) * 100) / 100;
  const actualC = round1(forecastC + clamp(errorC * noise(id, day, seed, 'e'), -ERROR_CAP * errorC, ERROR_CAP * errorC));
  const label = here?.label || weatherLabel(forecastC, windKts, lightning, c.sky);

  // HOLD: each day waited costs the complex's hold fee (less where propellant is loaded late or topped up automatically)
  const holdFee = Math.round((complex?.holdFee ?? 30000) * (optionFor(setup, 'propellant')?.holdF ?? 1));
  const fee = holdFee * day;
  const when = dayName(day);
  const slot = { id: `day${day}`, name: when, tempC: forecastC, fee, note: label };
  return { day, tempC: forecastC, forecastC, actualC, windKts, lightning, label, fee, holdFee, site: complex, slot, complex: complex?.id ?? null, errorC, when, climate: c.name ?? '' };
}
