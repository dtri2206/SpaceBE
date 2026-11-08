// Phase 0 of LAUNCH: "strap in", the ritual before flight (pure logic, no DOM, no three.js).
//
//   B  board the ship   camera rises up the tower, then the pilot's seat (cinematic, skippable)
//   C  checklist        the player presses 1-4 in order: HATCH, CABIN, O2, ARM ENGINE
//   D  GO / NO-GO poll  the launch director polls the stations, then asks the crew: GO or SCRUB
//   CABIN is a choice (air mix or pure oxygen). Pure oxygen + an ignored wiring caution + GO = the Apollo 1 pad fire.
// Then the countdown (index.js) starts exactly as before. Nothing here can fail a flight: it teaches, the later
// failure logic does the rest.
//
//   CHECKLIST_STEPS                      the four steps (key, label, fact, cockpit button id, sound id)
//   createChecklist()                    → { press(n), complete(), status(i), index, done }
//   buildPoll(ship, { needDv })          → [{ station, go, reason, text }] built from ShipSpec.warnings + stats
//   phase0Plan({ attempt, data })        → { quick, offerSkip }
//   scrubAvailable(contract)             → true only if the contract allows LAUNCH → HANGAR
//   scrubFee(balance)                    → money charged for a scrub
//   pollLinesShown(elapsed)              → how many poll lines are on screen after `elapsed` seconds

import phase0Data from './phase0.json' with { type: 'json' };

export const PHASE0_TIMING = Object.freeze(phase0Data.timing);
export const CHECKLIST_STEPS = Object.freeze(phase0Data.steps);
export const CABIN_OPTIONS = Object.freeze({ air: Object.freeze(phase0Data.cabin.air), pure: Object.freeze(phase0Data.cabin.pure) });

/** Checklist state machine: steps must be done in order; a wrong key changes nothing and returns a hint. */
export function createChecklist(steps = CHECKLIST_STEPS) {
  let index = 0;
  return {
    steps,
    get index() { return index; },
    get done() { return index >= steps.length; },
    /** n: 1-based key number. → { result: 'ok'|'wrong'|'repeat'|'finished', step, expected, hint? } */
    press(n) {
      const wanted = steps[n - 1];
      if (!wanted) return { result: 'wrong', step: null, expected: steps[index] ?? null };
      if (index >= steps.length) return { result: 'finished', step: wanted, expected: null };
      if (n - 1 < index) return { result: 'repeat', step: wanted, expected: steps[index] };
      if (n - 1 > index) {
        return { result: 'wrong', step: wanted, expected: steps[index], hint: `Not yet. Do it in order: next is ${steps[index].key} ${steps[index].label}.` };
      }
      index += 1;
      return { result: 'ok', step: wanted, expected: steps[index] ?? null, last: index >= steps.length };
    },
    complete() { index = steps.length; },
    status(i) { return i < index ? 'done' : i === index ? 'current' : 'todo'; },
  };
}

const BASE_STATIONS = ['Booster', 'Guidance', 'Propulsion', 'Life support', 'Weather', 'Range'];
// extra stations appear (before Weather) only when the ship has the matching warning
const EXTRA_STATIONS = { NO_HEAT_SHIELD: 'Thermal', NO_LEGS: 'Recovery', NO_SHELTER: 'Surface ops' };

const num = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : null);

// warning → [station, plain reason]
function reasonFor(warning, ship, needDv) {
  const st = ship?.stats ?? {};
  const temp = ship?.launch?.tempC;
  switch (warning) {
    case 'LOW_DV': {
      const have = num(st.deltaV);
      return ['Propulsion', have ? `${have} m/s of delta-v, the mission needs about ${num(needDv)} m/s` : 'not enough delta-v for the whole mission'];
    }
    case 'LOW_TWR': {
      const twr = num(st.twrEarth, 2);
      return ['Booster', twr ? `thrust-to-weight ${twr}: too weak to lift off safely` : 'thrust-to-weight too low to lift off safely'];
    }
    case 'LOW_RELIABILITY': {
      const r = Number.isFinite(st.reliability) ? `${Math.round(st.reliability * 100)} %` : null;
      return ['Booster', r ? `engine reliability only ${r}` : 'engine reliability is low'];
    }
    case 'UNSTABLE': return ['Guidance', 'the rocket is aerodynamically unstable'];
    case 'LOW_O2': return ['Life support', 'not enough spare oxygen for the whole trip'];
    case 'COLD_SEALS': return ['Weather', Number.isFinite(temp) ? `${num(temp)} °C, seals not rated for cold` : 'cold morning, seals not rated for cold'];
    case 'NO_ANTENNA': return ['Range', 'no antenna: Mission Control could not track or talk to you'];
    case 'NO_HEAT_SHIELD': return ['Thermal', 'no heat shield'];
    case 'NO_LEGS': return ['Recovery', 'no landing legs'];
    case 'NO_SHELTER': return ['Surface ops', 'no shelter for the crew on Mars'];
    case 'PURE_O2_WIRING': return [phase0Data.copy.eclssStation, phase0Data.copy.eclssReason]; // Apollo 1: added by the ritual, never a ShipSpec warning
    default: return ['Flight director', String(warning).toLowerCase().replace(/_/g, ' ')];
  }
}

/** The poll the launch director reads out: one entry per station, in order. */
export function buildPoll(ship, { needDv = 5400, pureOxygenFault = false } = {}) {
  const warnings = [...new Set([...(ship?.warnings ?? []), ...(pureOxygenFault ? ['PURE_O2_WIRING'] : [])])];
  const reasons = new Map(); // station → [reasons]
  for (const w of warnings) {
    const [station, reason] = reasonFor(w, ship, needDv);
    if (!reasons.has(station)) reasons.set(station, []);
    reasons.get(station).push(reason);
  }
  const extras = warnings.map((w) => EXTRA_STATIONS[w]).filter(Boolean);
  const stray = [...reasons.keys()].filter((k) => !BASE_STATIONS.includes(k) && !extras.includes(k));
  const order = [...BASE_STATIONS.slice(0, 4), ...extras, ...stray, ...BASE_STATIONS.slice(4)];
  return order.map((station) => {
    const list = reasons.get(station);
    const go = !list;
    const reason = list ? list.join('; ') : null;
    return { station, go, reason, text: go ? `${station}… GO` : `${station}… NO-GO: ${reason}` };
  });
}

export const hasNoGo = (poll) => poll.some((p) => !p.go);

/** quick: skip everything now (state data { quickStart: true }); offerSkip: from the 2nd attempt, show the Enter hint. */
export function phase0Plan({ attempt = 1, data = null } = {}) {
  const quick = data?.quickStart === true;
  return { quick, offerSkip: !quick && attempt >= 2 };
}

/** SCRUB only exists when the contract allows LAUNCH → HANGAR. */
export function scrubAvailable(contract) {
  return !!contract?.TRANSITIONS?.LAUNCH?.includes?.('HANGAR');
}

export function scrubFee(balance) {
  const fee = balance?.scrubFee;
  return Number.isFinite(fee) && fee >= 0 ? fee : 100000;
}

/** Number of poll lines on screen after `elapsed` seconds of the poll (0 until the first station answers). */
export function pollLinesShown(elapsed, total, { start = PHASE0_TIMING.pollStart, every = PHASE0_TIMING.pollEvery } = {}) {
  if (elapsed < start) return 0;
  return Math.min(total, Math.floor((elapsed - start) / every) + 1);
}

/** Seconds from the start of the poll until the "are you GO?" prompt appears. */
export function promptAt(total, { start = PHASE0_TIMING.pollStart, every = PHASE0_TIMING.pollEvery, delay = PHASE0_TIMING.promptDelay } = {}) {
  return start + (Math.max(1, total) - 1) * every + delay;
}

/**
 * Camera path up the tower to the crew level, from the rocket's own size. base: rocketBase {x,y,z}; eyeY: height of
 * the capsule window above the base. Returns [{ position: [x,y,z], lookAt: [x,y,z] }] for cinematic.play.
 */
export function boardingPath(base, eyeY) {
  const top = Math.max(6, eyeY);
  const y = (f) => base.y + top * f;
  const [bx, bz] = [base.x, base.z];
  return [
    { position: [bx + 15, base.y + 1.8, bz + 19], lookAt: [bx, y(0.3), bz] },
    { position: [bx + 12, y(0.28), bz + 14], lookAt: [bx, y(0.5), bz] },
    { position: [bx + 8, y(0.62), bz + 10], lookAt: [bx, y(0.78), bz] },
    { position: [bx + 5, y(0.93), bz + 6.2], lookAt: [bx, y(1), bz] },
    { position: [bx + 2.6, y(1.02), bz + 3.4], lookAt: [bx, y(1), bz] },
  ];
}

// ---------- aim-and-click (mouse) ----------
export const normaliseNodeName = (name) => String(name ?? '').replace(/[.:\[\]\s]/g, '').toLowerCase();

/** Which checklist button id a scene node belongs to ('btn:hatch' / 'btnhatch' group, 'btnCap.hatch', 'btnLamp.hatch'), or null. */
export function buttonIdOfName(name, steps = CHECKLIST_STEPS) {
  const n = normaliseNodeName(name);
  for (const step of steps) {
    const id = step.id.toLowerCase();
    if (n === `btn${id}` || n === `btncap${id}` || n === `btnlamp${id}`) return step.id;
  }
  return null;
}

/**
 * What the reticle shows when it rests on button `id`.
 * → { id, kind: 'next'|'blocked'|'done'|'none', tone: 'ok'|'warn'|'done'|null, label: string|null, clickable }
 */
export function aimInfo(checklist, id, steps = CHECKLIST_STEPS) {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0 || checklist.done) return { id: null, kind: 'none', tone: null, label: null, clickable: false };
  const step = steps[i];
  if (i < checklist.index) return { id, kind: 'done', tone: 'done', label: `${step.name} · done`, clickable: false };
  if (i === checklist.index) return { id, kind: 'next', tone: 'ok', label: `${step.name} · ${step.aim}`, clickable: true };
  return { id, kind: 'blocked', tone: 'warn', label: `${step.name} · ${steps[checklist.index].first}`, clickable: false };
}

/** The button the player should hit next ('hatch' ...), or null when the checklist is finished. */
export const nextButtonId = (checklist, steps = CHECKLIST_STEPS) => (checklist.done ? null : steps[checklist.index].id);

/** Fallback label for an item whose button mesh could not be found: 'HATCH · press 1'. */
export const fallbackLabel = (step, tpl = phase0Data.copy.pressHint) => `${step.name} · ${tpl.replace('{key}', step.key)}`;
