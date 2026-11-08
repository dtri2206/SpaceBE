// Suit oxygen (Role 2). TEAM_PROMPT §7.2.
//   cautions: 30% amber, 15% red (beeping + loud breathing), 5% critical (vignette/blur) → 0% = "Out of Breath"
//   no drain inside the ship (pressurised cabin) · running drains faster · swap tanks at the O₂ station
//
// const o2 = createOxygen({ bus, tankSeconds: 300, spareTanks: shipSpec.stats.spareO2Tanks });
// each frame: o2.update(dt, { inside, running, suited })
//
// Emits: eva:oxygen { percent, level, spareTanks }   (on every whole-percent or level change)
//        flight:failed { endingId: 'outOfBreath', cause }   (contract ENDINGS)
//
// Oxygen in kilograms (Role 1 wave 5, all four roles agreed; numbers and sources in src/builder/traits/life.json):
// pass `life` (from ShipSpec.stats.traits.life, see lifeOxygen below) and the suit holds the EMU's real 0.544 kg of O₂,
// burnt at the real metabolic rate (293 W walking, 469 W running: 0.075 and 0.12 kg/h), shown 87 times faster (7.3 h
// of walking = 300 s). The O₂ station tops the suit up from the ship's spare tanks, each with its real kg, down to the
// suit's 62 bar fill pressure. Every trip out through the airlock (useAirlock) vents the cabin's (or the airlock's)
// oxygen and nitrogen, and pays the cabin's breathing for the rest of that sol (none with the regenerative loop); with
// no nitrogen left the cabin is refilled with 5 psi of pure oxygen, which costs more oxygen. spareTanks = how many
// more full trips outside the tanks still give. Without `life`: as before.

/** Full trips outside left (the same count as src/builder/traits/life.js tripsLeft). */
export function tripsLeft(o2Kg, n2Kg, { tripKg, n2PerTrip = 0, tripKgNoN2 = tripKg } = {}) {
  if (!(tripKg > 0)) return 0;
  const byO2 = Math.floor(Math.max(0, o2Kg) / tripKg + 1e-9);
  if (!(n2PerTrip > 0)) return byO2;
  const byN2 = Math.floor(Math.max(0, n2Kg) / n2PerTrip + 1e-9);
  if (byO2 <= byN2) return byO2;
  return byN2 + Math.floor(Math.max(0, o2Kg - byN2 * tripKg) / Math.max(1e-9, tripKgNoN2) + 1e-9);
}

export const O2_LEVELS = [
  { id: 'critical', below: 5 },
  { id: 'warning', below: 15 },
  { id: 'caution', below: 30 },
];

export function levelFor(percent) {
  for (const l of O2_LEVELS) if (percent < l.below) return l.id;
  return 'ok';
}

/**
 * The kg settings for createOxygen from ShipSpec.stats.traits.life (null without them: the seconds model as before).
 * cruise (optional): the tanks' kg on arrival ({ tanks: [{ partId, unit, kg }], n2Kg }, from src/cruise via save).
 */
export function lifeOxygen(life, cruise = null) {
  const suit = life?.suit, o2 = life?.o2;
  if (!(suit?.primaryO2Kg > 0) || !(suit?.gameSecondsPerFill > 0) || !o2) return null;
  const arrived = new Map((cruise?.tanks ?? []).map((t) => [`${t.partId}#${t.unit ?? 0}`, t.kg]));
  const tanks = (o2.tanks ?? []).map((t) => {
    const kg = arrived.get(`${t.partId}#${t.unit ?? 0}`);
    return { partId: t.partId, unit: t.unit ?? 0, kind: t.kind, kg: Number.isFinite(kg) ? kg : t.kg, residualKg: t.residualKg ?? 0 };
  });
  return {
    suitKg: suit.primaryO2Kg,
    kgPerSecond: suit.primaryO2Kg / suit.gameSecondsPerFill, // walking, game seconds
    runMultiplier: suit.runMultiplier ?? 1.6,
    evaScale: suit.evaScale ?? 1, // real seconds per game second (for the records)
    exitKg: o2.exitKg ?? 0,
    cabinKgPerTrip: o2.cabinKgPerTrip ?? 0, // the cabin's breathing for the rest of the sol
    n2: o2.n2 ? { kg: Number.isFinite(cruise?.n2Kg) ? cruise.n2Kg : o2.n2.kg, perTripKg: o2.n2.perTripKg ?? 0, exitKgNoN2: o2.n2.exitKgNoN2 ?? o2.exitKg ?? 0 } : null,
    tanks,
  };
}

export function createOxygen({ bus, tankSeconds = 300, spareTanks = 2, runMultiplier = 1.6, life = null, onRecord = null } = {}) {
  bus = bus ?? { emit() {} };
  if (life) return createKgOxygen({ bus, life, onRecord });
  const state = { remaining: tankSeconds, spareTanks, depleted: false, lastPercent: 100, lastLevel: 'ok', leak: 1 };

  const percent = () => (100 * state.remaining) / tankSeconds;
  const publish = (force = false) => {
    const p = Math.ceil(percent());
    const level = levelFor(percent());
    if (force || p !== state.lastPercent || level !== state.lastLevel) {
      state.lastPercent = p;
      state.lastLevel = level;
      bus.emit('eva:oxygen', { percent: p, level, spareTanks: state.spareTanks });
    }
  };

  return {
    get percent() { return percent(); },
    get level() { return levelFor(percent()); },
    get spareTanks() { return state.spareTanks; },
    get secondsLeft() { return state.remaining; },
    get depleted() { return state.depleted; },
    get leaking() { return state.leak > 1; },

    update(dt, { inside = false, running = false, suited = true } = {}) {
      if (state.depleted || inside || !suited || dt <= 0) return;
      state.remaining = Math.max(0, state.remaining - dt * (running ? runMultiplier : 1) * state.leak);
      publish();
      if (state.remaining === 0) {
        state.depleted = true;
        bus.emit('flight:failed', { endingId: 'outOfBreath', cause: 'The suit ran out of oxygen before you got back to the ship.', causeId: 'suit_o2_depleted' });
      }
    },

    // Suit breach (e.g. a bad fall): O₂ drains `multiplier` times faster until the suit is serviced.
    setLeak(multiplier = 1) { state.leak = Math.max(1, multiplier); },

    // O₂ station: put on a full spare tank (and patch the suit). Returns false if none left.
    swapTank() {
      state.leak = 1;
      if (state.depleted || state.spareTanks <= 0) return false;
      state.spareTanks -= 1;
      state.remaining = tankSeconds;
      publish(true);
      return true;
    },

    // Energy tasks (MOXIE / ice electrolysis) can refill a spare tank.
    addSpareTank(n = 1) { state.spareTanks += n; publish(true); },

    // Debug (presenter shortcut): set the current tank to `p` percent (0..100); never revives a depleted suit.
    debugSetPercent(p) {
      if (state.depleted) return;
      state.remaining = (Math.min(100, Math.max(0, Number(p) || 0)) / 100) * tankSeconds;
      publish(true);
    },

    // Debug: infinite O₂
    refill() { state.remaining = tankSeconds; state.depleted = false; publish(true); },
  };
}

/** The same suit, counted in kilograms of oxygen (see the header). */
function createKgOxygen({ bus, life, onRecord }) {
  const suitKg = life.suitKg;
  const rate = life.kgPerSecond; // kg per game second, walking
  const runMultiplier = life.runMultiplier;
  const exitKg = Math.max(0, life.exitKg ?? 0);
  const cabinKg = Math.max(0, life.cabinKgPerTrip ?? 0);
  const tripKg = suitKg + exitKg + cabinKg;
  const n2PerTrip = Math.max(0, life.n2?.perTripKg ?? 0);
  const exitKgNoN2 = Math.max(0, life.n2?.exitKgNoN2 ?? exitKg);
  const tripKgNoN2 = suitKg + exitKgNoN2 + cabinKg;
  const tanks = life.tanks.map((t) => ({ ...t }));
  const usable = () => tanks.reduce((t, k) => t + Math.max(0, k.kg - k.residualKg), 0);
  const draw = (kg, { residual = false } = {}) => { // from the tanks in order; the suit cannot take gas below its fill pressure
    let left = kg;
    for (const t of tanks) {
      if (left <= 1e-12) break;
      const take = Math.min(left, Math.max(0, t.kg - (residual ? 0 : t.residualKg)));
      t.kg -= take; left -= take;
    }
    return kg - left;
  };
  const state = {
    remaining: suitKg, depleted: false, lastPercent: 100, lastLevel: 'ok', leak: 1,
    breathedKg: 0, ventedKg: 0, cabinKg: 0, n2VentedKg: 0, n2OutAfter: null, outsideS: 0, exits: 0, refills: 0, wasOutside: false,
    n2Kg: Math.max(0, life.n2?.kg ?? 0), availableS: 0,
  };
  const spare = () => tripsLeft(usable(), state.n2Kg, { tripKg, n2PerTrip, tripKgNoN2 });
  // what this landing allowed: the suit's own fill plus every full trip the tanks gave
  const allowed = () => { state.availableS = (suitKg + spare() * suitKg) / rate; };
  allowed();
  const percent = () => (100 * state.remaining) / suitKg;
  const publish = (force = false) => {
    const p = Math.ceil(percent());
    const level = levelFor(percent());
    if (force || p !== state.lastPercent || level !== state.lastLevel) {
      state.lastPercent = p;
      state.lastLevel = level;
      bus.emit('eva:oxygen', { percent: p, level, spareTanks: spare() });
    }
  };
  const record = (why) => {
    if (!onRecord) return;
    try { onRecord(api.stats(why)); } catch { /* records never break the walk */ }
  };

  const api = {
    get percent() { return percent(); },
    get level() { return levelFor(percent()); },
    get spareTanks() { return spare(); },
    get secondsLeft() { return state.remaining / rate; },
    get depleted() { return state.depleted; },
    get leaking() { return state.leak > 1; },
    get kg() { return state.remaining; },
    get storeKg() { return usable(); },

    update(dt, { inside = false, running = false, suited = true } = {}) {
      if (state.wasOutside && inside) { state.wasOutside = false; record('inside'); }
      if (state.depleted || inside || !suited || dt <= 0) return;
      state.wasOutside = true;
      const use = Math.min(state.remaining, dt * rate * (running ? runMultiplier : 1) * state.leak);
      state.remaining = Math.max(0, state.remaining - use);
      state.breathedKg += use;
      state.outsideS += dt;
      publish();
      if (state.remaining <= 1e-12) {
        state.remaining = 0;
        state.depleted = true;
        record('depleted');
        bus.emit('flight:failed', { endingId: 'outOfBreath', cause: 'The suit ran out of oxygen before you got back to the ship.', causeId: 'suit_o2_depleted' });
      }
    },

    setLeak(multiplier = 1) { state.leak = Math.max(1, multiplier); },

    // O₂ station: top the suit up from the spare tanks (and patch it). Returns false when the tanks have nothing left.
    swapTank() {
      state.leak = 1;
      if (state.depleted) return false;
      const need = suitKg - state.remaining;
      if (need > 1e-9 && usable() < Math.min(need, 0.01 * suitKg)) return false;
      const got = draw(need);
      state.remaining += got;
      if (got > 0) state.refills += 1;
      publish(true);
      record('refill');
      return true;
    },

    // The airlock opened to Mars: the cabin's (or the airlock's) air is vented and refilled from the tanks, and the
    // crew breathes the cabin's air until the next walk. Cabin make-up can use the gas the suit cannot.
    useAirlock() {
      let o2 = exitKg;
      if (n2PerTrip > 0) {
        const n2 = Math.min(state.n2Kg, n2PerTrip);
        const share = n2 / n2PerTrip; // the part of the refill the nitrogen still covers; the rest is 5 psi of oxygen
        state.n2Kg -= n2; state.n2VentedKg += n2;
        o2 = exitKg * share + exitKgNoN2 * (1 - share);
        if (share < 1 && state.n2OutAfter == null) state.n2OutAfter = state.exits;
      }
      const vented = draw(o2, { residual: true });
      const breathed = draw(cabinKg, { residual: true });
      state.ventedKg += vented;
      state.cabinKg += breathed;
      state.exits += 1;
      publish(true);
      return vented + breathed;
    },

    // Energy tasks (MOXIE / ice electrolysis) can refill a spare tank: one full trip's worth of oxygen.
    addSpareTank(n = 1) { tanks.push({ partId: 'isru', unit: tanks.length, kind: 'isru', kg: n * tripKg, residualKg: 0 }); publish(true); },

    debugSetPercent(p) {
      if (state.depleted) return;
      state.remaining = (Math.min(100, Math.max(0, Number(p) || 0)) / 100) * suitKg;
      publish(true);
    },

    refill() { state.remaining = suitKg; state.depleted = false; publish(true); },

    /** Replace the tanks' kg and the nitrogen left (the cruise's leaks and losses, applied once on arrival). */
    setTanks(list = [], n2Kg = null) {
      const kg = new Map(list.map((t) => [`${t.partId}#${t.unit ?? 0}`, t.kg]));
      for (const t of tanks) { const v = kg.get(`${t.partId}#${t.unit ?? 0}`); if (Number.isFinite(v)) t.kg = Math.max(0, v); }
      if (Number.isFinite(n2Kg)) state.n2Kg = Math.max(0, n2Kg);
      allowed();
      publish(true);
    },

    /** For the hangar's analysis: kg breathed, vented and used by the cabin, kg left, minutes outside (real) used and allowed. */
    stats(why = null) {
      const toMin = (s) => (s * (life.evaScale ?? 1)) / 60;
      return {
        why, breathedKg: state.breathedKg, ventedKg: state.ventedKg, cabinKg: state.cabinKg, usableKg: usable(), suitKg: state.remaining,
        n2Kg: state.n2Kg, n2VentedKg: state.n2VentedKg, n2OutAfter: state.n2OutAfter,
        exits: state.exits, refills: state.refills, exitKg, minutesOutside: toMin(state.outsideS), minutesAvailable: toMin(state.availableS),
      };
    },
  };
  return api;
}
