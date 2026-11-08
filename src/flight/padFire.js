// Apollo 1 (1967): the pad fire. Pure logic for the countdown (no DOM, no three.js).
// Only created when the player gave GO with a pure-oxygen cabin and an ignored wiring caution (phase0Ritual).
//
//   const fire = createPadFire();
//   each frame of the countdown:  for (const e of fire.update(secondsToLiftoff, wallSeconds)) ...
//     'alarm'  the first thing the crew notices (sudden alarm, Mission Control: "Fire in the cockpit!", the screen flashes)
//     'fail'   ~2 s later: the screen has faded to black → FlightController.failWith('pureOxygen', 'pad_fire', {}, 'apollo1')
// Nothing graphic: a flash and a fade to black, no flames and no people.

export const PAD_FIRE = Object.freeze({ alarmAt: 6.5, fadeSeconds: 2 }); // alarm at T-6.5; the engine would only start at T-3

export function createPadFire(cfg = PAD_FIRE) {
  let alarmedAt = null, failed = false;
  return {
    get alarmed() { return alarmedAt !== null; },
    get failed() { return failed; },
    update(countdown, now) {
      const events = [];
      if (failed) return events;
      if (alarmedAt === null && countdown <= cfg.alarmAt) { alarmedAt = now; events.push('alarm'); }
      else if (alarmedAt !== null && now - alarmedAt >= cfg.fadeSeconds) { failed = true; events.push('fail'); }
      return events;
    },
  };
}
