/**
 * THE CONTRACT: single source of truth for every name and data shape in SpaceB&E.
 * Pure data. No imports, no browser APIs, so Node (scripts/check-static.mjs) can import it.
 * Changing this file needs all four people to agree.
 */

// Game title shown in the menu.
export const GAME_TITLE = 'SpaceB&E';
// Name of the player's space agency (placeholder until the team picks one).
export const AGENCY_NAME = 'TBD';

// Every game state. Exactly one is active at a time; src/core/state.js owns the switch.
export const STATES = Object.freeze({
  MENU: 'MENU', HANGAR: 'HANGAR', GONOGO: 'GONOGO', PRELAUNCH: 'PRELAUNCH', LAUNCH: 'LAUNCH',
  ORBIT: 'ORBIT', CRUISE: 'CRUISE', ENTRY: 'ENTRY', LANDING: 'LANDING', INTERIOR: 'INTERIOR',
  SURFACE: 'SURFACE', RETURN: 'RETURN', ENDING: 'ENDING', REPORT: 'REPORT',
});

// Allowed state changes: from -> list of states it may go to. Additionally ANY state may go to ENDING.
export const TRANSITIONS = Object.freeze({
  MENU: Object.freeze(['HANGAR']),
  HANGAR: Object.freeze(['GONOGO']),
  GONOGO: Object.freeze(['HANGAR', 'PRELAUNCH']),
  PRELAUNCH: Object.freeze(['LAUNCH']),
  LAUNCH: Object.freeze(['ORBIT']),
  ORBIT: Object.freeze(['CRUISE']),
  CRUISE: Object.freeze(['ENTRY']),
  ENTRY: Object.freeze(['LANDING']),
  LANDING: Object.freeze(['INTERIOR']),
  INTERIOR: Object.freeze(['SURFACE', 'RETURN', 'LANDING']),
  SURFACE: Object.freeze(['INTERIOR']),
  RETURN: Object.freeze(['ENDING']),
  ENDING: Object.freeze(['REPORT', 'HANGAR', 'MENU']),
  REPORT: Object.freeze(['HANGAR']),
});

// Which module (a key of MODULES) runs enter/update/exit for each state. Core holds plumbing only, no game screens.
export const STATE_OWNERS = Object.freeze({
  MENU: 'builder', HANGAR: 'builder', GONOGO: 'builder',
  PRELAUNCH: 'story', RETURN: 'story', ENDING: 'story',
  LAUNCH: 'flight', ORBIT: 'flight', ENTRY: 'flight', LANDING: 'flight',
  CRUISE: 'cruise',
  INTERIOR: 'surface', SURFACE: 'surface',
  REPORT: 'report',
});

// Feature modules. Each lives in src/<name>/index.js and default-exports MODULE_SHAPE.
export const MODULES = Object.freeze(['builder', 'flight', 'surface', 'cruise', 'story', 'missions', 'guidebook', 'report']);

// File path -> export names that file must have. Checked by scripts/check-static.mjs.
export const PUBLIC_EXPORTS = Object.freeze({
  'src/core/index.js': Object.freeze(['events', 'getState', 'requestState', 'input', 'ui', 'economy', 'save', 'getShip', 'setShip', 'PLANETS', 'G0', 'contract']),
  'src/builder/index.js': Object.freeze(['default']),
  'src/flight/index.js': Object.freeze(['default', 'FlightController']),
  'src/surface/index.js': Object.freeze(['default', 'registerInteractable']),
  'src/cruise/index.js': Object.freeze(['default']),
  'src/story/index.js': Object.freeze(['default']),
  'src/missions/index.js': Object.freeze(['default', 'getProgress']),
  'src/guidebook/index.js': Object.freeze(['default']),
  'src/report/index.js': Object.freeze(['default', 'getReport']),
  'src/graphics/index.js': Object.freeze(['graphics', 'assets', 'getTerrainHeight', 'cinematic', 'createMarsScene', 'createSpaceScene']),
  'src/audio/index.js': Object.freeze(['audio']),
});

// Role number -> folders that role may edit.
export const ROLE_FOLDERS = Object.freeze({
  1: Object.freeze(['src/builder']),
  2: Object.freeze(['src/flight', 'src/surface']),
  3: Object.freeze(['src/core', 'src/graphics', 'src/audio', 'src/ui']),
  4: Object.freeze(['src/cruise', 'src/story', 'src/missions', 'src/guidebook', 'src/report']),
});

// Every event: name -> required payload keys. Emitting an unknown name or missing a key logs console.error.
export const EVENTS = Object.freeze({
  'state:request': Object.freeze(['to']), // ask core to change state; optional `data` is passed to the new owner's enter()
  'state:changed': Object.freeze(['from', 'to']), // core emits after a valid change
  'ship:built': Object.freeze(['shipSpec']), // builder confirmed a ShipSpec (see SHIP_SPEC_SHAPE)
  'flight:phase': Object.freeze(['phase']), // flight phase name, e.g. 'launch', 'orbit', 'entry', 'landing'
  'flight:event': Object.freeze(['type', 't']), // type is one of FLIGHT_EVENT_TYPES, t is mission seconds; optional data
  'flight:landed': Object.freeze(['touchdownSpeed']), // touchdown speed in m/s
  'flight:failed': Object.freeze(['endingId', 'cause']), // endingId is a key of ENDINGS, cause is one plain sentence
  // Emitted about 2 times per second by whoever owns the current flight state. t is mission seconds, phase is the
  // flight phase. Optional fields: altitude, speed, gForce, q, fuelKg, engineTemp, radiationMsv, o2Percent, co2,
  // suitTemp, heartRate. This is what the black box records.
  'flight:telemetry': Object.freeze(['t', 'phase']),
  'interior:interact': Object.freeze(['stationId']), // player used a station (a key of STATIONS)
  'eva:oxygen': Object.freeze(['percent']), // suit oxygen left, 0 to 100
  'task:completed': Object.freeze(['taskId', 'category', 'reward']), // taskId is a key of TASKS, reward in dollars
  'progress:changed': Object.freeze(['percent']), // Mars Exploration %, 0 to 100
  'story:log': Object.freeze(['logId']), // a Halcyon-1 log was read
  'mission:complete': Object.freeze([]), // Mars Exploration reached 100%
  'economy:changed': Object.freeze(['money']), // new balance in dollars
  'ending:show': Object.freeze(['endingId', 'cause', 'cost', 'historyLessonId']), // cost is the penalty charged; historyLessonId may be null
  'guidebook:open': Object.freeze(['entryId']), // open this Guidebook entry
  'builder:highlightPart': Object.freeze(['partId']), // make this part glow in the builder
});

// Allowed `type` values of the flight:event event.
export const FLIGHT_EVENT_TYPES = Object.freeze(['maxq', 'debris_hit', 'malfunction', 'solar_storm', 'part_failure', 'blackout', 'skip_off']);

// Every ending id, used by flight:failed and ending:show.
export const ENDINGS = Object.freeze({
  adrift: 'adrift', rud: 'rud', burnup: 'burnup', outOfBreath: 'outOfBreath', bankrupt: 'bankrupt',
  homecoming: 'homecoming', coldMorning: 'coldMorning', theFoam: 'theFoam', pureOxygen: 'pureOxygen',
  successfulFailure: 'successfulFailure', silentReturn: 'silentReturn', unitError: 'unitError',
  falseTouchdown: 'falseTouchdown', spin: 'spin', beagle: 'beagle', lastDescent: 'lastDescent',
});

// Lessons from real history, shown on ending screens (historyLessonId of ending:show).
export const HISTORY_LESSONS = Object.freeze({
  challenger: 'challenger', columbia: 'columbia', apollo1: 'apollo1', apollo13: 'apollo13', soyuz11: 'soyuz11',
  marsClimateOrbiter: 'marsClimateOrbiter', marsPolarLander: 'marsPolarLander', gemini8: 'gemini8', beagle2: 'beagle2', soyuz1: 'soyuz1',
});

// Mars tasks (spec section 9). weight = share of Mars Exploration % (all weights sum to 100), reward in dollars.
export const TASKS = Object.freeze({
  scan1: Object.freeze({ category: 'scan', weight: 10, reward: 200000 }), // terrain scan point 1 (20% for the 2 scans)
  scan2: Object.freeze({ category: 'scan', weight: 10, reward: 200000 }), // terrain scan point 2
  energy: Object.freeze({ category: 'energy', weight: 20, reward: 250000 }), // solar panels and buried ice
  sampleBasalt: Object.freeze({ category: 'sample', weight: 25 / 3, reward: 150000 }), // 25% for the 3 samples
  sampleClay: Object.freeze({ category: 'sample', weight: 25 / 3, reward: 150000 }),
  sampleHematite: Object.freeze({ category: 'sample', weight: 25 / 3, reward: 150000 }),
  log1: Object.freeze({ category: 'log', weight: 12.5, reward: 300000 }), // Halcyon-1 data log 1 (25% for the 2 logs)
  log2: Object.freeze({ category: 'log', weight: 12.5, reward: 300000 }),
  discovery: Object.freeze({ category: 'discovery', weight: 10, reward: 500000 }), // the final rock in the delta
});

// Ship interior stations (interior:interact stationId).
export const STATIONS = Object.freeze(['pilotSeat', 'o2Station', 'suitLocker', 'commsConsole', 'sampleStorage', 'airlock', 'bunk']);

// Go/No-Go problems that stop the player confirming a build.
export const HARD_BLOCKS = Object.freeze(['NO_CAPSULE', 'NO_ENGINE', 'NO_FUEL', 'NOT_CONNECTED', 'OVER_BUDGET']);

// Go/No-Go warnings the player may override. Overriding is where many endings come from.
export const WARNINGS = Object.freeze(['LOW_DV', 'LOW_TWR', 'NO_HEAT_SHIELD', 'NO_LEGS', 'UNSTABLE', 'LOW_O2', 'NO_ANTENNA', 'NO_SHELTER', 'COLD_SEALS', 'LOW_RELIABILITY', 'CHUTE_UNTESTED']);

// Engine options.
export const FUELS = Object.freeze(['kerolox', 'methalox', 'hydrolox']); // propellant chemistry
export const NOZZLES = Object.freeze(['sl', 'vac']); // sea-level or vacuum nozzle (no 'mid')
export const PUMPS = Object.freeze(['S', 'M', 'L']); // turbopump size: small, medium, large

/**
 * ShipSpec (Builder -> Flight). Documentation only, written as an example shape.
 * parts are in metres; y runs along the rocket axis, so radial symmetry can be expressed with x and z.
 * launch.tempC is the launch-site weather that the Cold Morning ending needs.
 */
export const SHIP_SPEC_SHAPE = Object.freeze({
  name: 'string, shown in the UI',
  parts: [{ id: 'string, unique', type: 'string, e.g. capsule_m, tank_l, engine_s, heat_shield', x: 0, y: 0, z: 0, rotation: 0, variant: 'string or null' }],
  engines: [{ fuel: 'one of FUELS', nozzle: 'one of NOZZLES', pump: 'one of PUMPS' }],
  stats: {
    cost: 'dollars', wetMass: 'kg', dryMass: 'kg', fuelMass: 'kg', thrust: 'N', ispSL: 's', ispVac: 's', deltaV: 'm/s',
    twrEarth: 'number', twrMars: 'number', comOffset: 'm', copOffset: 'm', reliability: '0..1',
    hasHeatShield: 'boolean', heatShieldDamaged: 'boolean', hasLegs: 'boolean', hasRCS: 'boolean',
    hasParachute: 'boolean', hasAntenna: 'boolean', hasShelter: 'boolean', coldRatedSeals: 'boolean',
    armorHits: 'integer', spareO2Tanks: 'integer', power: 'W',
  },
  warnings: ['values from WARNINGS'],
  launch: { tempC: 'number, launch-site temperature in Celsius' },
});

/**
 * What `export default` of every module in MODULES must look like. All members are optional.
 * { init?(), enter?(state, data), update?(dt, state), exit?(state) }
 * init runs once at boot; enter runs when a state this module owns becomes active (data comes from requestState);
 * update runs every frame while it owns the current state (dt in seconds); exit runs when leaving that state.
 */
export const MODULE_SHAPE = Object.freeze({ init: 'function?', enter: 'function?', update: 'function?', exit: 'function?' });
