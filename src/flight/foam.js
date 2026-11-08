// "The Foam" (Columbia, 2003): a debris strike in Earth orbit gouges the heat shield where nobody can see it.
// Pure logic (no DOM, no three.js). The strike itself is FlightController's (it sets ship.heatShieldDamaged and
// ship.heatShieldUnseen, the one source of truth the entry check and the corridor read). This module only runs the
// player's choice afterwards:
//
//   hit()          a strike damaged the shield → an inspection offer follows once the dodge window is over
//   update(dt, { busy }) → events: 'offered' | 'ignored' | 'found'    (busy: the debris window / manual flying is open)
//   take()         the player takes the offer (F) → the sweep starts
//   applyTo(fc)    copy the state onto a (new) controller: the damage stays with the ship across scene changes
//
//   state: 'idle' | 'pending' | 'offered' | 'scanning' | 'known' | 'ignored'

export const FOAM = Object.freeze({
  offerSeconds: 12,
  sweepSeconds: 4, // real seconds of the camera sweep...
  sweepGameSeconds: 40, // ...which cost this much mission time (flown at 10x)
  sweepFuelKg: 6, // a little RCS propellant
  copy: Object.freeze({
    impact: 'Impact on the heat-shield side. We can\'t see it from here.',
    offer: 'INSPECT THE HEAT SHIELD? · press F (the RCS camera sweep costs 40 s and a little fuel)',
    scanning: 'Scanning the heat shield…',
    found: 'Damage found on the leading edge: a 15 cm gouge.',
    warning: 'Damaged heat shield: shallow entry planned',
  }),
});

export function createFoam(cfg = FOAM) {
  let state = 'idle', t = 0;
  return {
    get state() { return state; },
    get offered() { return state === 'offered'; },
    get scanning() { return state === 'scanning'; },
    get damaged() { return state !== 'idle'; },
    get inspected() { return state === 'known'; },
    get timeLeft() { return state === 'offered' ? Math.max(0, cfg.offerSeconds - t) : 0; },
    hit() { if (state === 'idle') { state = 'pending'; t = 0; } },
    take() { if (state !== 'offered') return false; state = 'scanning'; t = 0; return true; },
    update(dt, { busy = false } = {}) {
      const events = [];
      if (state === 'pending' && !busy) { state = 'offered'; t = 0; events.push('offered'); }
      else if (state === 'offered') { t += dt; if (t >= cfg.offerSeconds) { state = 'ignored'; events.push('ignored'); } }
      else if (state === 'scanning') { t += dt; if (t >= cfg.sweepSeconds) { state = 'known'; events.push('found'); } }
      return events;
    },
    /** Put the remembered damage onto a controller. */
    applyTo(fc) {
      if (state === 'idle' || !fc?.ship?.hasHeatShield) return;
      fc.ship.heatShieldDamaged = true;
      fc.ship.heatShieldUnseen = state !== 'known';
      fc.ship.heatShieldInspected = state === 'known';
    },
    /** Debug / test: damage the shield of fc now, as a strike would. */
    strike(fc) { if (fc?.ship?.hasHeatShield) { fc.ship.heatShieldDamaged = true; fc.ship.heatShieldUnseen = true; } this.hit(); },
    /** The sweep found the gouge: the flight computer now knows. */
    reveal(fc) { if (fc?.ship) { fc.ship.heatShieldUnseen = false; fc.ship.heatShieldInspected = true; } },
  };
}
