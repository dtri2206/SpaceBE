// Role 2: exploring Mars. Pure logic (no three.js, no DOM), testable in Node.
//   1. REACH: how far can the astronaut still go AND come back, on foot (current suit tank) or by rover (battery)?
//   2. FIRST STEP: the once-per-mission scripted moment at the foot of the ladder + "your first words on Mars".
import { WALK_TUNING } from './WalkController.js';

// ---------- reach (oxygen & battery budget) ----------
export const REACH_MARGIN = 0.8; // keep 20 % in reserve
export const TERRAIN_FACTOR = 1.5; // rover: hills, acceleration and turns cost more than flat cruising (energy per metre x1.5)
export const WALK_SPEED = WALK_TUNING.walkSpeed.suit; // m/s; reach assumes a calm walk, not a run (running burns O2 1.6x)

/** Metres you can walk out and still get back on the CURRENT tank (spare tanks are not counted). */
export function walkReachMetres(secondsLeft, { speed = WALK_SPEED, margin = REACH_MARGIN } = {}) {
  if (!(secondsLeft > 0) || !(speed > 0)) return 0;
  return (secondsLeft * speed / 2) * margin;
}

/** Battery energy per metre on flat regolith at cruise (Wh/m): the motors only fight rolling resistance (see RoverController). */
export function roverWhPerMetre(spec, gravity, factor = TERRAIN_FACTOR) {
  return (spec.rollingResistance * spec.mass * gravity) / spec.efficiency / 3600 * factor;
}

/** Metres a rover can go out and come back on the remaining battery. */
export function roverReachMetres(spec, batteryWh, gravity, { margin = REACH_MARGIN, factor = TERRAIN_FACTOR } = {}) {
  const perMetre = roverWhPerMetre(spec, gravity, factor);
  if (!(batteryWh > 0) || !(perMetre > 0)) return 0;
  return (batteryWh / perMetre / 2) * margin;
}

/** 210 m (rounded to 10 m, 5 m under 50 m), 4.2 km from 1 km. */
export function formatReach(m) {
  if (!(m > 0)) return '0 m';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  const step = m < 50 ? 5 : 10;
  return `${Math.floor(m / step) * step} m`;
}

/** The HUD line, e.g. `REACH · walk 210 m · LRV 4.2 km`. */
export function reachLine({ walkMetres, roverMetres = null, roverName = null }) {
  return `REACH · walk ${formatReach(walkMetres)}${roverName && roverMetres != null ? ` · ${roverName} ${formatReach(roverMetres)}` : ''}`;
}

/** Role 4's HUD writes "<label> · 123 m" into .role4-mission-target; read the distance back (null if unknown). */
export function parseTargetDistance(text) {
  const m = /·\s*(\d+(?:\.\d+)?)\s*m\s*$/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

/** Amber when the next mission target is farther than we can walk and come back. */
export const targetBeyondReach = (targetMetres, walkMetres) => targetMetres != null && targetMetres > walkMetres;

// ---------- first step on Mars ----------
export const DEFAULT_FIRST_WORDS = 'Hello, Mars.';
export const MAX_FIRST_WORDS = 80;
export const FIRST_STEP_LINE = (sol = 1) => `FIRST STEP · Jezero Crater, Mars · Sol ${sol}`;
// seconds into the scripted moment
export const FIRST_STEP_TIMING = { print: 2.2, line: 3.4, words: 6.5 };

/** Trim, collapse whitespace, strip control characters, cap the length. Returns '' for nothing usable. */
export function sanitizeWords(text) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FIRST_WORDS).trim();
}

/** Per-mission explore memory (reset by astronaut.reset()). */
export const exploration = {
  firstStepDone: false,
  firstWords: null,
  reset() { this.firstStepDone = false; this.firstWords = null; },
  /** True once per mission, the first time you step out through the airlock. Marks it done. */
  claimFirstStep(fromAirlock = true) {
    if (this.firstStepDone || !fromAirlock) return false;
    this.firstStepDone = true;
    return true;
  },
  /** Store the typed words (empty or skipped = the default). Returns what was stored. */
  setFirstWords(text) {
    this.firstWords = sanitizeWords(text) || DEFAULT_FIRST_WORDS;
    return this.firstWords;
  },
};

/** The timeline: phases 'scene' (tilt, boot print, line) -> 'words' (typing) -> 'done'. skip() jumps scene -> words. */
export function createFirstStepSequence(timing = FIRST_STEP_TIMING) {
  let t = 0, phase = 'scene', printed = false;
  const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  return {
    get phase() { return phase; },
    get t() { return t; },
    /** advance; returns { stamp: true } on the frame the boot print should appear */
    update(dt) {
      const out = { stamp: false };
      if (phase !== 'scene') return out;
      t += dt;
      if (!printed && t >= timing.print) { printed = true; out.stamp = true; }
      if (t >= timing.words) phase = 'words';
      return out;
    },
    /** E / Space during the scene: jump to the typing prompt (the print still appears). */
    skip() {
      if (phase !== 'scene') return { stamp: false };
      const stamp = !printed;
      printed = true;
      t = timing.words;
      phase = 'words';
      return { stamp };
    },
    finish() { phase = 'done'; },
    /** 0..1 how far the head has bowed to the boots (down quickly, back up slowly after the print) */
    get tilt() {
      if (phase === 'done') return 0;
      if (phase === 'words') return 0.0;
      return smooth(t / 1.2) * (1 - smooth((t - (timing.words - 1.4)) / 1.2));
    },
    /** opacity of the FIRST STEP line */
    get lineAlpha() { return phase === 'scene' ? smooth((t - timing.line) / 1.0) : phase === 'words' ? 1 : 0; },
  };
}
