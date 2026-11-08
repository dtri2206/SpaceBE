// The black box (spec §8): listens to the events every role already emits and keeps what a flight data recorder
// would. Nobody calls it; it only listens. getReport() returns the shape of src/core/mocks/report.json plus the raw
// counts, peaks and log.
import { contract, events, getShip, getState } from '/src/core/index.js';

// causeId (from Role 2's flight:failed) -> root-cause category and an engineering recommendation for a part type.
const CAUSES = {
  engine_overheat: { category: 'Propulsion', part: 'engine', advice: 'The engine ran too hot: choose a smaller turbopump or a heat-resistant chamber metal, and throttle back when it heats up.' },
  max_q_exceeded: { category: 'Structural', part: 'engine', advice: 'Max-Q was exceeded: throttle down through the thick lower air, or fit a less powerful engine.' },
  g_force_blackout: { category: 'Human', part: 'engine', advice: 'The pilot blacked out: lower the thrust-to-weight ratio, or throttle down as the tanks empty.' },
  no_heat_shield: { category: 'Thermal', part: 'capsule', advice: 'No heat shield: every entry into an atmosphere needs one under the capsule.' },
  heat_shield_damaged: { category: 'Thermal', part: 'heat', advice: 'The heat shield was damaged on the way up and never inspected: replace it or add armor.' },
  heat_overload: { category: 'Thermal', part: 'heat', advice: 'Entry was too steep and fast: aim for a shallower entry and slow down with the chute and engine.' },
  seal_failure_cold: { category: 'Structural', part: 'tank', advice: 'Cheap seals failed in the cold: buy cold-rated seals, or pick a warmer launch window.' },
  crash_landing: { category: 'Landing', part: 'engine', advice: 'Touchdown was too fast: start the landing burn at the BURN NOW marker and keep fuel for it.' },
  tipped_over: { category: 'Landing', part: 'leg', advice: 'The ship tipped over: add landing legs and touch down upright and slow.' },
  debris_impact: { category: 'Structural', part: 'capsule', advice: 'Debris hit the ship: add armor, or dodge the debris field.' },
  out_of_fuel: { category: 'Propulsion', part: 'tank', advice: 'Not enough Δv to get home: add a bigger tank or use a vacuum nozzle for a higher Isp.' },
  transfer_short: { category: 'Propulsion', part: 'tank', advice: 'Not enough Δv for the transfer to Mars: add fuel, or use a vacuum nozzle for a higher Isp.' },
  skipped_off: { category: 'Navigation', part: 'capsule', advice: 'The entry was too shallow and skipped off the atmosphere: aim a little steeper.' },
  suit_o2_depleted: { category: 'Life support', part: 'capsule', advice: 'The suit ran out of oxygen: watch the 30 % warning, plan the walk back, and carry spare O₂ tanks.' },
};

const PHASE_LABELS = { prelaunch: 'Pre-launch', ascent: 'Liftoff', orbit: 'Orbit reached', coast: 'Coast', entry: 'Atmospheric entry', landing: 'Landing burn', landed: 'Touchdown' };
const EVENT_LABELS = { maxq: 'Max-Q', debris_hit: 'Debris hit', malfunction: 'Malfunction', solar_storm: 'Solar storm', part_failure: 'Part failure', blackout: 'G-force blackout', skip_off: 'Skipped off the atmosphere' };

let rec;
function reset() {
  rec = {
    start: null, outcome: 'none', rootCause: null, causeId: null, endingId: null,
    timeline: [], counts: {}, peaks: {}, mins: {}, log: [], fuelByPhase: {}, hits: 0, touchdownSpeed: null,
    tasks: [], logs: [], partFailures: [], lastPhase: null, lastFuel: null,
  };
}
reset();

const now = () => (rec.start == null ? 0 : (performance.now() - rec.start) / 1000);
const mark = (label) => {
  if (rec.timeline.at(-1)?.label === label) return; // the same thing twice in a row (e.g. a phase sent again)
  rec.timeline.push({ t: Math.round(now()), label });
};

function record(name, payload) {
  rec.counts[name] = (rec.counts[name] ?? 0) + 1;
  if (rec.log.length < 600) rec.log.push({ t: Math.round(now()), name, payload });
}

function peak(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  rec.peaks[key] = Math.max(rec.peaks[key] ?? -Infinity, value);
  rec.mins[key] = Math.min(rec.mins[key] ?? Infinity, value);
}

function partFor(type) {
  const parts = getShip()?.parts ?? [];
  return parts.find((p) => String(p.type).includes(type))?.id ?? null;
}

function recommendations() {
  const out = [];
  const add = (text, type) => { if (!out.some((r) => r.text === text)) out.push({ text, partId: type ? partFor(type) : null }); };
  const cause = CAUSES[rec.causeId];
  if (cause) add(cause.advice, cause.part);
  const g = rec.peaks.gForce;
  if (g > 4) add(`Peak ${g.toFixed(1)} g: vision tunnels above about 4 g. Lower the thrust-to-weight ratio.`, 'engine');
  const q = rec.peaks.q;
  if (q > 32000) add(`Max-Q reached ${(q / 1000).toFixed(0)} kPa, close to the 40 kPa limit: throttle down near Max-Q.`, 'engine');
  if (rec.peaks.engineTemp > 0.85) add('The engine came within 15 % of its heat limit: a smaller pump or a better chamber metal runs cooler.', 'engine');
  const dose = rec.peaks.radiationMsv;
  // the cruise alone is about 466 mSv (1.8 mSv/day for 259 days); more than that came from the solar storm
  if (dose > 520) add(`Radiation dose ${Math.round(dose)} mSv, more than the cruise alone: add a radiation shelter and use it during solar storms.`, 'capsule');
  if (rec.hits > 0) add(`${rec.hits} debris hit${rec.hits > 1 ? 's' : ''}: armor absorbs small hits.`, 'capsule');
  if (rec.mins.o2Percent != null && rec.mins.o2Percent < 15 && rec.causeId !== 'suit_o2_depleted') add(`Suit O₂ fell to ${Math.round(rec.mins.o2Percent)} %: turn back at 30 %.`, null);
  if (!out.length && rec.outcome === 'success') add('A clean mission. Try a cheaper ship, or carry more samples home.', null);
  return out;
}

/** The black box so far, in the shape of src/core/mocks/report.json (plus counts, peaks and log). */
export function getReport() {
  const p = rec.peaks;
  return {
    outcome: rec.outcome === 'none' ? 'in progress' : rec.outcome,
    endingId: rec.endingId,
    rootCause: rec.rootCause,
    timeline: [...rec.timeline],
    astronaut: {
      peakGForce: p.gForce ?? null,
      radiationMsv: p.radiationMsv ?? null,
      o2UsedPercent: rec.mins.o2Percent != null ? Math.round(100 - rec.mins.o2Percent) : null,
      peakHeartRate: p.heartRate ?? null,
    },
    ship: {
      maxQKpa: p.q != null ? Math.round(p.q / 100) / 10 : null,
      peakEngineTempPercent: p.engineTemp != null ? Math.round(p.engineTemp * 100) : null,
      peakAltitudeKm: p.altitude != null ? Math.round(p.altitude / 100) / 10 : null,
      peakSpeed: p.speed ?? null,
      hits: rec.hits,
      partFailures: [...rec.partFailures],
      touchdownSpeed: rec.touchdownSpeed,
      fuelByPhase: { ...rec.fuelByPhase },
    },
    tasks: [...rec.tasks],
    logs: [...rec.logs],
    recommendations: recommendations(),
    counts: { ...rec.counts },
    peaks: { ...rec.peaks },
    log: [...rec.log],
  };
}

export function startBlackBox() {
  // A new mission starts at PRELAUNCH (or when a ship is confirmed).
  events.on('ship:built', reset);
  events.on('state:changed', ({ from, to }) => {
    if (to === 'PRELAUNCH') reset();
    if (to === 'LAUNCH' && rec.start == null) { rec.start = performance.now(); mark('Ignition'); }
    if (rec.start == null) return;
    if (to === 'CRUISE') mark('Transfer burn: cruise to Mars');
    if (to === 'SURFACE' && from === 'INTERIOR' && !rec.timeline.some((e) => e.label === 'First steps on Mars')) mark('First steps on Mars');
    if (to === 'RETURN') mark('Liftoff from Mars: heading home');
  });

  // Every flight:*, eva:* and interior:* event (events.js has no wildcards, so subscribe to each contract name).
  for (const name of Object.keys(contract.EVENTS)) {
    if (/^(flight|eva|interior):/.test(name)) events.on(name, (payload) => record(name, payload));
  }

  events.on('flight:telemetry', (t) => {
    for (const key of ['altitude', 'speed', 'gForce', 'q', 'engineTemp', 'radiationMsv', 'heartRate', 'o2Percent', 'co2', 'suitTemp']) peak(key, t[key]);
    if (typeof t.fuelKg === 'number') rec.lastFuel = t.fuelKg;
  });
  events.on('flight:phase', ({ phase }) => {
    if (rec.lastPhase && rec.lastFuel != null) rec.fuelByPhase[rec.lastPhase] = Math.round(rec.lastFuel);
    rec.lastPhase = phase;
    if (rec.start == null) rec.start = performance.now();
    if (PHASE_LABELS[phase]) mark(PHASE_LABELS[phase]);
  });
  events.on('flight:event', ({ type, data }) => {
    if (type === 'debris_hit') rec.hits += 1;
    if (type === 'part_failure') rec.partFailures.push({ part: data?.part ?? null, t: Math.round(now()) });
    if (EVENT_LABELS[type]) mark(EVENT_LABELS[type]);
  });
  events.on('flight:landed', ({ touchdownSpeed }) => {
    rec.touchdownSpeed = touchdownSpeed;
    mark(`Touchdown at ${Number(touchdownSpeed).toFixed(1)} m/s`);
  });
  events.on('flight:failed', ({ endingId, cause, causeId }) => {
    rec.outcome = 'failure';
    rec.endingId = endingId;
    rec.causeId = causeId ?? null;
    const category = CAUSES[causeId]?.category ?? 'Failure';
    rec.rootCause = `${category}: ${cause} (T+${Math.round(now())} s)`;
    mark(`Loss of mission: ${category.toLowerCase()}`);
  });
  events.on('task:completed', ({ taskId }) => { rec.tasks.push(taskId); mark(`Mars task: ${taskId}`); });
  events.on('story:log', ({ logId }) => { rec.logs.push(logId); });
  events.on('ending:show', ({ endingId, cause }) => {
    rec.endingId = endingId;
    if (endingId === 'homecoming') { rec.outcome = 'success'; mark('Splashdown: home'); }
    else if (rec.outcome !== 'failure') { rec.outcome = 'failure'; rec.rootCause = cause || endingId; }
  });

  if (getState() !== 'MENU') rec.start = performance.now();
}
