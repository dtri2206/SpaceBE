// Suit oxygen (Role 2). TEAM_PROMPT §7.2.
//   cautions: 30% amber, 15% red (beeping + loud breathing), 5% critical (vignette/blur) → 0% = "Out of Breath"
//   no drain inside the ship (pressurised cabin) · running drains faster · swap tanks at the O₂ station
//
// const o2 = createOxygen({ bus, tankSeconds: 300, spareTanks: shipSpec.stats.spareO2Tanks });
// each frame: o2.update(dt, { inside, running, suited })
//
// Emits: eva:oxygen { percent, level, spareTanks }   (on every whole-percent or level change)
//        flight:failed { endingId: 'outOfBreath', cause }   (contract ENDINGS)

export const O2_LEVELS = [
  { id: 'critical', below: 5 },
  { id: 'warning', below: 15 },
  { id: 'caution', below: 30 },
];

export function levelFor(percent) {
  for (const l of O2_LEVELS) if (percent < l.below) return l.id;
  return 'ok';
}

export function createOxygen({ bus, tankSeconds = 300, spareTanks = 2, runMultiplier = 1.6 } = {}) {
  bus = bus ?? { emit() {} };
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
