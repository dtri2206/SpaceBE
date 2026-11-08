// Part effects in flight: what each part the player chose does while the ship flies, read from ShipSpec.stats.traits
// (computed by the builder, src/builder/traits/). Built by Role 1 with the agreement of all four roles (2026-11-08,
// docs/DECISIONS.md); FlightController calls the hooks below. One file per group (propulsion.js, structure.js,
// landing.js); each exports any of:
//   begin(flight)                         once per launch (LAUNCH from the pad), to roll what this flight holds
//   params(p, ctx, flight)     → p        adjust shipParams() (limits, thrust, ignitions…)
//   thrust(N, ctx, flight)     → N        the thrust this step (an engine out, the pad holding the ship back…)
//   ignite(ok, ctx, flight)    → ok       may an ignition fail?
//   maxQ(pa, ctx, flight)      → pa       the dynamic pressure the structure stands
//   heatLimit(x, ctx, flight)  → x        the entry heating the shield stands (game units, see atmosphere.js)
//   touchdownLimit(v, ctx, flight) → v    the touchdown speed the legs stand (m/s)
//   turnAccel(a, ctx, flight)  → a        how fast the ship can start and stop turning (rad/s²): gimbal, RCS
//   chuteDeploy(lim, ctx, flight) → lim  { maxSpeed, maxAltitude } at which the chutes may open (canopy type, Mach limit)
//   chuteCdA(m², ctx, flight)  → m²       the drag area of the canopies open and whole
//   debrisHit(r, ctx, flight)  → r        r = { absorbed, damage }: what a hit does (armour, skin, shield)
//   step(ctx, flight)          → failure? every physics step; may return { endingId, cause, historyHint? }
//   liftoff(ctx, flight)                  at liftoff
//   end(ctx, flight)                      the flight scene ends (landed, failed or handed over)
// ctx = { fc (the FlightController), dt, alt, rho, speed, q, phase }. A missing hook means "as before".
// Value hooks must be pure (no dice, no note(), no state change): the trajectory prediction calls them on a copy of the
// controller. Roll dice and record in begin, liftoff, step and end.
// Failures use only ENDINGS ids from contract.js and a plain-sentence cause.
// The flight's record (flight.notes) is handed to a recorder that src/flight/index.js sets (it keeps it in save as
// partEffects, for the hangar's flight analysis); this file imports nothing from core, so Node tests can run it.
import * as propulsion from './propulsion.js';
import * as structure from './structure.js';
import * as landing from './landing.js';

const GROUPS = { propulsion, structure, landing };
const MAX_KEPT = 5; // flights kept in save

let flight = null; // the launch now flying: its state carries across LAUNCH → ORBIT → ENTRY → LANDING

/** Starts the record of a new launch (FlightController on the pad) or returns the one already flying. */
export function flightFor(spec, { fresh = false, rng = Math.random } = {}) {
  if (!flight || fresh || flight.spec !== spec) {
    flight = { id: `f${Date.now().toString(36)}`, spec, traits: spec?.stats?.traits ?? {}, state: {}, notes: [], rng };
    for (const [name, g] of Object.entries(GROUPS)) safe(name, () => g.begin?.(flight));
    persist();
  }
  return flight;
}

/** The effects object one FlightController uses. */
export function createPartEffects(spec, { fresh = false, rng = Math.random } = {}) {
  const f = flightFor(spec, { fresh, rng });
  const fx = {
    flight: f,
    /** A value hook: every group may change the value in turn. */
    value(hook, base, ctx) {
      let v = base;
      for (const [name, g] of Object.entries(GROUPS)) if (g[hook]) { const out = safe(name, () => g[hook](v, ctx, f)); if (out !== undefined) v = out; }
      return v;
    },
    /** An event hook: the first group that returns a failure wins. */
    fire(hook, ctx) {
      for (const [name, g] of Object.entries(GROUPS)) if (g[hook]) { const out = safe(name, () => g[hook](ctx, f)); if (out?.endingId) return out; }
      return null;
    },
  };
  // for a prediction copy of the controller (steering.js): the same limits and thrust, no events, records or failures
  fx.quiet = { flight: f, value: fx.value, fire: () => null };
  fx.quiet.quiet = fx.quiet;
  return fx;
}

/** Adds a line to this flight's record (for the hangar's analysis): { group, partId?, what, value?, t? }. */
export function note(entry) {
  if (!flight) return;
  flight.notes.push({ ...entry });
  persist();
}

let recorder = null;
/** src/flight/index.js passes a function that stores a flight's record: fn({ id, name, notes, state }). */
export function setPartEffectsRecorder(fn) { recorder = fn; }

function persist() {
  if (!flight || !recorder) return;
  try { recorder({ id: flight.id, name: flight.spec?.name ?? null, notes: flight.notes.slice(-200), state: plain(flight.state) }); } catch { /* the record stays in memory */ }
}

/**
 * The record kept in save: save.partEffects = { flights: [the last MAX_KEPT records] } (newest last). The cruise and the
 * surface append their notes to the last record directly, marked via: 'save', and may add their own fields (life).
 * For src/flight/index.js: recordInSave(save) returns the recorder function.
 */
export function recordInSave(save) {
  return (rec) => {
    const flights = save.load().partEffects?.flights ?? [];
    const old = flights.find((x) => x.id === rec.id);
    // notes the cruise and the surface appended straight to save (via: 'save') and their own fields (e.g. life) stay
    const added = (old?.notes ?? []).filter((n) => n.via === 'save');
    const kept = flights.filter((x) => x.id !== rec.id);
    save.update({ partEffects: { flights: [...kept, { ...old, ...rec, notes: [...rec.notes, ...added].slice(-300) }].slice(-MAX_KEPT) } });
  };
}

const plain = (o) => { try { return JSON.parse(JSON.stringify(o ?? {})); } catch { return {}; } };

const warned = new Set();
function safe(name, fn) {
  try { return fn(); } catch (e) {
    if (!warned.has(name)) { warned.add(name); console.warn(`[part effects] ${name}: ${e.message}`); }
    return undefined;
  }
}

/** For tests: forget the flight in progress. */
export function resetPartEffects() { flight = null; }
