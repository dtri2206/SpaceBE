// The pitch demo's beat logic: pure, no browser APIs, no game imports (Node tests it: director.test.mjs).
// src/flight/demo/index.js wires it to the game (states, overlays, keys).

/** Beats in order. Index = the beat number of the pitch script. */
export const BEATS = Object.freeze(['title', 'hangar', 'launch', 'debris', 'cruise', 'entry', 'firstHumans', 'return', 'earthLanding', 'scroll']);
export const BEAT = Object.freeze(Object.fromEntries(BEATS.map((name, i) => [name, i])));

export const HOLD_CODES = Object.freeze(['KeyC', 'KeyR', 'Digit7']);
export const HOLD_MS = 1000;

export const TIMING = Object.freeze({
  title: 5, // s
  cruiseCard: 3.2, // s the "259 days later" card stays
  debrisIdle: 2.5, // s after the debris window closes before the cruise card
  debrisFailsafe: 90, // s in the debris beat before we move on anyway
  landedWait: 3.5, // s after touchdown before going out
  interiorWait: 1.2, // s in the cabin before the airlock door
});

/**
 * Hold-to-trigger. update(isDown, nowMs) -> { progress 0..1, fired }. `fired` is true once per hold, on the frame
 * the hold reaches holdMs; the keys must be released before it can fire again.
 */
export function createHoldTrigger({ codes = HOLD_CODES, holdMs = HOLD_MS } = {}) {
  let since = null;
  let latched = false;
  return {
    update(isDown, nowMs) {
      if (!codes.every((code) => isDown(code))) {
        since = null;
        latched = false;
        return { progress: 0, fired: false };
      }
      if (since === null) since = nowMs;
      const progress = Math.min(1, (nowMs - since) / holdMs);
      const fired = progress >= 1 && !latched;
      if (fired) latched = true;
      return { progress, fired };
    },
  };
}

/** Which beat follows by itself, from the facts in ctx (null = stay). `mem` holds the director's timers. */
export function autoNext(beat, ctx, mem) {
  switch (beat) {
    case BEAT.title: return mem.beatTime >= TIMING.title ? BEAT.hangar : null;
    case BEAT.hangar: return ctx.state === 'LAUNCH' && ctx.flight && !ctx.flight.phase0Active ? BEAT.launch : null;
    case BEAT.launch: return ctx.state === 'ORBIT' ? BEAT.debris : null;
    case BEAT.debris: return mem.debrisIdle >= TIMING.debrisIdle || mem.beatTime >= TIMING.debrisFailsafe ? BEAT.cruise : null;
    case BEAT.cruise: return mem.beatTime >= TIMING.cruiseCard ? BEAT.entry : null;
    case BEAT.entry: return ctx.state === 'SURFACE' ? BEAT.firstHumans : null;
    case BEAT.firstHumans: return ctx.firstHumansDone ? BEAT.return : null;
    case BEAT.return: return ctx.state === 'ENDING' ? BEAT.scroll : ctx.returnPhase === 'descent' ? BEAT.earthLanding : null;
    case BEAT.earthLanding: return ctx.state === 'ENDING' || ctx.returnPhase === 'scroll' ? BEAT.scroll : null;
    default: return null;
  }
}

/** After touchdown the demo walks out by itself: LANDING -> INTERIOR -> SURFACE. Returns the state to request, or null. */
export function landingExit({ state, stateTime = 0, landedFor = 0 }) {
  if (state === 'LANDING' && landedFor >= TIMING.landedWait) return 'INTERIOR';
  if (state === 'INTERIOR' && stateTime >= TIMING.interiorWait) return 'SURFACE';
  return null;
}

/**
 * The beat machine. onEnter(beat, via) runs on every entry; via is 'start' | 'auto' | 'skip'.
 * N = next(); the trigger = start() (which also restarts).
 */
export function createDirector({ onEnter = () => {} } = {}) {
  let active = false;
  let beat = -1;
  const mem = { beatTime: 0, debrisIdle: 0 };

  function enter(index, via) {
    beat = index;
    mem.beatTime = 0;
    mem.debrisIdle = 0;
    onEnter(index, via);
  }

  return {
    get active() { return active; },
    get beat() { return beat; },
    start() { active = true; enter(0, 'start'); },
    stop() { active = false; beat = -1; },
    /** N: the next beat (the last one stays). Returns the new beat, or null when not running or already last. */
    next() {
      if (!active || beat >= BEATS.length - 1) return null;
      enter(beat + 1, 'skip');
      return beat;
    },
    /** Every frame. ctx: { state, flight, firstHumansDone, returnPhase }. Returns the new beat if it changed. */
    update(dt, ctx) {
      if (!active) return null;
      mem.beatTime += dt;
      if (beat === BEAT.debris && ctx.flight?.debrisPlaced && !ctx.flight.debrisBusy) mem.debrisIdle += dt;
      else mem.debrisIdle = 0;
      const target = autoNext(beat, ctx, mem);
      if (target === null || target === beat) return null;
      enter(target, 'auto');
      return beat;
    },
  };
}
