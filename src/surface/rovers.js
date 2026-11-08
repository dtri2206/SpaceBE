// MR-01 unlock logic (Role 2), pure JS, testable in node.
// The futuristic MR-01 rover stays locked until Mars Exploration reaches 50 %, then unlocks once per mission.
// Feed it percentages from getProgress() / the `progress:changed` event; reset() with the astronaut for a new mission.
//
// The rovers' power from the ship (Role 1 wave 5, all four roles agreed; numbers and sources in
// src/builder/traits/landing.json). With ShipSpec.stats.traits.landing.power:
//  - energy on Mars runs on the suit's clock (87 times faster than real time: 7.3 h of walking on one fill last 300 s),
//    so every stored Wh (the rovers' batteries, the ship's batteries and fuel-cell reactants) is divided by 87 while
//    powers stay real watts and driving costs its real Wh per metre: a rover's range is 87 times shorter than the real
//    machine's, and a full LRV battery drives about 1.3 km;
//  - the rovers ride to Mars inside the ship: they arrive full if the ship makes power on the way, else 16 % down;
//  - parked within cableReachM (15 m) of the lander and standing still, a rover charges from the ship: its solar
//    (43 % of Earth's sunlight, then air, night and dust: a sol average) and RTG first, then the ship's batteries and
//    fuel-cell reactants, never faster than the rover's own charger (LRV 870 W, MR-01 10 kW; both estimates: Apollo's
//    LRV had primary silver-zinc batteries that could not be recharged). Both rovers share it.
// Without the traits (core mocks, old saves, Node tests): as before, the rover's real battery and no charging.
export const MR01_UNLOCK_PERCENT = 50;
export const MR01_LOCKED_PROMPT = `MR-01 locked: reach ${MR01_UNLOCK_PERCENT}% Mars Exploration`;
export const MR01_UNLOCKED_NOTICE = 'MR-01 unlocked: faster rover available by the lander';

export function createMr01Unlock({ threshold = MR01_UNLOCK_PERCENT, onUnlock } = {}) {
  let percent = 0, unlocked = false, noticePending = false;
  const open = () => { if (unlocked) return false; unlocked = true; noticePending = true; onUnlock?.(); return true; };
  return {
    get unlocked() { return unlocked; },
    get percent() { return percent; },
    /** latest Mars Exploration percent (any junk is ignored); returns true on the call that unlocks */
    setPercent(p) {
      const n = Number(p);
      if (!Number.isFinite(n)) return false;
      percent = n;
      return n >= threshold ? open() : false;
    },
    /** debug only (?debug=1): unlock right now */
    debugUnlock: open,
    /** true exactly once after unlocking: show the "unlocked" notice then (when the player is outside to see it) */
    takeNotice() { const v = noticePending; noticePending = false; return v; },
    reset() { percent = 0; unlocked = false; noticePending = false; },
  };
}

// Shared by the surface module and astronaut.reset(): one unlock state per mission.
export const mr01Unlock = createMr01Unlock();

// ---------------------------------------------------------------- power from the ship -------------------------------
const fin = Number.isFinite;
const num = (x, d = 0) => (fin(Number(x)) ? Number(x) : d);
export const LANDER_AT = Object.freeze({ x: 0, z: 0 }); // the lander stands at the Mars scene's origin (surface/index.js)
const MAX_GAP_S = 900; // a longer gap between two looks (a sleeping tab) counts as 15 minutes
const STEP_S = 5; // the charging is integrated in steps this long
const RECORD_EVERY_S = 10; // the record in save is refreshed at most this often (a save write is a whole JSON string)

// In the browser the ship and the save come from core; this file stays importable by Node (the tests set them).
const env = { ship: null, save: null, clock: null };
let core = null;
if (typeof window !== 'undefined') import('/src/core/index.js').then((m) => { core = m; }).catch(() => { /* no core: as before */ });
/** For tests (and anyone who wants another source): ship() → ShipSpec, save { load, update }, clock() → seconds. */
export function configureRoverPower({ ship, save, clock } = {}) {
  if (ship !== undefined) env.ship = ship;
  if (save !== undefined) env.save = save;
  if (clock !== undefined) env.clock = clock;
  bus = null;
}
export const currentShip = () => { try { return env.ship ? env.ship() : core?.getShip?.() ?? null; } catch { return null; } };
const saveRef = () => env.save ?? core?.save ?? null;
export const clockNow = () => (env.clock ? env.clock() : (globalThis.performance?.now?.() ?? Date.now()) / 1000);

/**
 * The ship's power for the rovers in surface units (stored Wh already divided by the surface time scale), or null when
 * the ship has no landing traits (as before). p = ShipSpec.stats.traits.landing.power.
 */
export function roverPowerFor(ship) {
  const p = ship?.stats?.traits?.landing?.power;
  if (!p || typeof p !== 'object') return null;
  const scale = num(p.surfaceTime, 87) > 0 ? num(p.surfaceTime, 87) : 87;
  return {
    scale,
    solarW: num(p.solarMarsW), rtgW: num(p.rtgW), dustPerSol: num(p.dustPerSol, 0.0028), solLengthS: num(p.solLengthS, 88775),
    batteryWh: num(p.batteryWh) / scale, batteryMaxW: num(p.batteryMaxW),
    fuelWh: num(p.fuelCellWh) / scale, fuelMaxW: num(p.fuelCellW),
    arrivalFrac: Math.min(1, Math.max(0, num(p.arrivalFrac, 1))), reachM: num(p.cableReachM, 15),
    chargeW: Object.fromEntries(Object.entries(p.rovers ?? {}).map(([k, v]) => [k, num(v?.chargeW)])),
  };
}

let bus = null;
/** The ship's power bus on Mars: one per ship, shared by the rovers parked at it. */
export function landerPowerFor(ship, model) {
  if (!bus || bus.ship !== ship) bus = createLanderPower(model, { ship });
  return bus;
}

/**
 * createLanderPower(model, { ship }) → { model, battery, fuel, add(rover), accrue(), used(wh), stats }. Lazy: it adds up the time
 * since it was last asked (clockNow), so the rovers charge while the player is inside the ship too. Generation goes to
 * the parked rovers first, then refills the ship's batteries; what the rovers still want comes from the batteries, then
 * from the fuel-cell reactants. Energies in surface Wh, powers in real W.
 */
export function createLanderPower(model, { ship = null } = {}) {
  const rovers = new Set();
  const state = { last: clockNow(), elapsed: 0, recordedAt: -Infinity, recordedKey: '' };
  const p = {
    ship, model, rovers,
    battery: model.batteryWh * model.arrivalFrac, batteryCap: model.batteryWh, fuel: model.fuelWh,
    stats: { usedWh: 0, chargedWh: 0 },
    add(r) { rovers.add(r); },
    /** generation now (W): solar after the dust that settled since landing, plus the RTG */
    get generationW() {
      const sols = (state.elapsed * model.scale) / model.solLengthS;
      return model.solarW * Math.max(0, 1 - model.dustPerSol * sols) + model.rtgW;
    },
    accrue() {
      const now = clockNow();
      let dt = Math.min(MAX_GAP_S, Math.max(0, now - state.last));
      state.last = now;
      while (dt > 1e-9) {
        const h = Math.min(STEP_S, dt);
        dt -= h;
        chargeStep(h);
        state.elapsed += h;
      }
      record(now);
    },
    /** called by a rover for the energy its motors used (surface Wh) */
    used(wh) { if (wh > 0) p.stats.usedWh += wh; },
  };
  function chargeStep(h) {
    const hours = h / 3600;
    let gen = p.generationW;
    const want = [];
    for (const r of rovers) {
      if (!r.pluggedIn) continue;
      const room = Math.max(0, r.capacityWh - r._wh);
      if (room <= 1e-9) continue;
      want.push({ r, w: Math.min(r.chargeW, room / hours) });
    }
    const need = want.reduce((t, x) => t + x.w, 0);
    if (need > 0) {
      // the watts the ship can give right now: generation, then the batteries, then the fuel cells
      const fromGen = Math.min(gen, need);
      const fromBattery = Math.min(need - fromGen, model.batteryMaxW, p.battery / hours);
      const fromFuel = Math.min(need - fromGen - fromBattery, model.fuelMaxW, p.fuel / hours);
      const share = (fromGen + fromBattery + fromFuel) / need;
      for (const x of want) { const wh = x.w * share * hours; x.r._wh = Math.min(x.r.capacityWh, x.r._wh + wh); p.stats.chargedWh += wh; }
      p.battery = Math.max(0, p.battery - fromBattery * hours);
      p.fuel = Math.max(0, p.fuel - fromFuel * hours);
      gen -= fromGen;
    }
    // what the rovers did not take refills the ship's batteries (as fast as they take a charge)
    if (gen > 0 && p.battery < p.batteryCap) p.battery = Math.min(p.batteryCap, p.battery + Math.min(gen, model.batteryMaxW || gen) * hours);
  }
  // the hangar's analysis: one line for the whole stay (replaced as it grows), in the flight's record in save
  function record(now) {
    const save = saveRef();
    if (!save || now - state.recordedAt < RECORD_EVERY_S) return;
    let km = 0;
    for (const r of rovers) km += num(r.odometer) / 1000;
    // in surface Wh: what the rovers' batteries (stored energy ÷ the surface time scale) gave and got back
    const used = p.stats.usedWh, charged = p.stats.chargedWh;
    const key = `${used.toFixed(0)}|${charged.toFixed(0)}|${km.toFixed(2)}`;
    if (key === state.recordedKey) return;
    state.recordedAt = now;
    state.recordedKey = key;
    appendSurfaceNote(save, ship, { group: 'landing', what: 'roverEnergy', value: Math.round(used), chargedWh: Math.round(charged), km: Math.round(km * 100) / 100 });
  }
  return p;
}

/**
 * Puts one note on this mission's flight record in save (save.partEffects.flights, last entry, when its name is the
 * ship's), replacing an older note of the same group and `what` from the surface (via: 'save', so the flight's
 * recorder keeps it). Quietly does nothing without a record.
 */
export function appendSurfaceNote(save, ship, n) {
  try {
    const all = save.load();
    const flights = all.partEffects?.flights;
    const rec = flights?.[flights.length - 1];
    if (!rec || (rec.name != null && ship?.name != null && rec.name !== ship.name)) return false;
    const mine = { ...n, via: 'save', src: 'rovers' };
    const kept = (rec.notes ?? []).filter((x) => !(x.via === 'save' && x.group === mine.group && x.what === mine.what && x.src === mine.src));
    save.update({ partEffects: { ...all.partEffects, flights: [...flights.slice(0, -1), { ...rec, notes: [...kept, mine].slice(-300) }] } });
    return true;
  } catch { return false; }
}
