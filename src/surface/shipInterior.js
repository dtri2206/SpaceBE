// Walkable ship cabin (Role 2). TEAM_PROMPT §7.1.
// Registers the cabin stations on the interactable system and runs the suit/airlock logic.
// Station ids are contract.js STATIONS: pilotSeat, o2Station, suitLocker, commsConsole, sampleStorage, airlock, bunk.
// Positions come from Role 3's cabin art (assets.get('cabin').userData.stations / .props); CABIN is the fallback.
//
// Cabin (Role 3 interiors.js): 4 m wide (x −2..2) × 8 m long (z −4..4), origin = middle of the floor,
// pilot seat at −Z, airlock at +Z, height 2.6 m (walls 2.15 m, then a chamfer).
//
// const cabin = createShipInterior({ bus: events, interactables, oxygen, stations: art.userData.stations, props: art.userData.props,
//                                    onSeat, onExit, onNotice });
// On the bus: interior:interact { stationId }   (every station use; Role 4 listens for commsConsole, sampleStorage, bunk)
// Callbacks:  onSeat() when the unsuited player sits in the pilot seat; onExit() when the airlock cycle finishes.
// Local notices (onNotice): 'suit' { suited }, 'airlock' { stage: 'cycling' | 'open', progress }, 'o2Empty', 'prop' { id }, 'prebreathe' { stage: 'start' | 'running' | 'done' | 'cancelled' }.

export const STATION_IDS = ['pilotSeat', 'o2Station', 'suitLocker', 'commsConsole', 'sampleStorage', 'airlock', 'bunk'];

export const CABIN = {
  bounds: { minX: -2, maxX: 2, minZ: -4, maxZ: 4, ceiling: 2.5 },
  spawn: { x: 0, z: -2.4 }, // standing behind the pilot seat, facing the airlock (+Z)
  spawnYaw: Math.PI, // yaw π = looking toward +Z
  stations: {
    pilotSeat: { x: 0, y: 1.2, z: -3.3 },
    suitLocker: { x: -1.7, y: 1.2, z: 0.7 },
    o2Station: { x: -1.72, y: 1.2, z: -1.1 },
    commsConsole: { x: 1.7, y: 1.2, z: -1.3 },
    sampleStorage: { x: 1.72, y: 1.2, z: 0.9 },
    airlock: { x: 0, y: 1.2, z: 3.86 },
    bunk: { x: -1.55, y: 1.2, z: -2.75 },
  },
  props: {
    familyPhoto: { x: -0.95, y: 1.2, z: -3.08 },
  },
};

// Walk boxes (cabin-local, floor to ceiling, half sizes): the flight-deck bulkhead hatch and its step at the -Z wall (cabin.js BH) is 1.1 m x 0.4 m.
export const CABIN_BOXES = [{ x: 0, z: -3.8, hx: 0.55, hz: 0.2 }];
export const LADDER_BOTTOM_FALLBACK = { x: 0, z: -3.2 }; // cabin.js: ladderBottom = (0, -hl + 0.8)

export const AIRLOCK_CYCLE_SECONDS = 3;
// Real procedure: suits run at low pressure, so astronauts breathe pure O₂ first to purge nitrogen (no "bends").
export const PREBREATHE_S = 10; // easy to tune; ?debug=1 shortens it (index.js passes PREBREATHE_DEBUG_S)
export const PREBREATHE_DEBUG_S = 1;
export const PREBREATHE_MAX_DISTANCE = 3; // m from the airlock: walking away cancels
// Once per Mars visit-day: after a completed prebreathe, later exits in the same mission skip it.
const missionPrebreathe = { done: false };
export const resetPrebreathe = () => { missionPrebreathe.done = false; };
// The cabin air the player chose (Role 1 wave 5, ShipSpec.stats.traits.life.cabin.prebreathe): 1 = sea-level air, the
// full prebreathe; 0 = pure oxygen at a third of an atmosphere (Mercury, Gemini, Apollo), no nitrogen to purge, none.
const cabinAir = { prebreathe: 1 };
export const setCabinAir = ({ prebreathe } = {}) => { cabinAir.prebreathe = Number.isFinite(prebreathe) ? Math.min(1, Math.max(0, prebreathe)) : 1; };
/** The prebreathe this ship's cabin air needs, in game seconds. */
export const prebreatheFor = (full = PREBREATHE_S) => full * cabinAir.prebreathe;

const xyz = (v) => ({ x: v.x, y: v.y, z: v.z });

export function resolveStations(stations) {
  const out = {};
  for (const id of STATION_IDS) out[id] = xyz(stations?.[id] ?? CABIN.stations[id]);
  return out;
}

export function createShipInterior({ bus, interactables, oxygen, stations, props, canExit = () => true, prebreatheSeconds = prebreatheFor(), prebreatheState = missionPrebreathe, onSeat, onExit, onNotice } = {}) {
  bus = bus ?? { emit() {} };
  const notify = onNotice ?? (() => {});
  const st = { suited: false, airlock: null, prebreathe: null, offs: [] }; // airlock: null | { t }; prebreathe: null | { t }
  const S = resolveStations(stations);
  const P = Object.fromEntries(Object.entries(props ?? CABIN.props).map(([k, v]) => [k, xyz(v)]));
  const reg = (def) => st.offs.push(interactables.register(def));
  const use = (stationId) => bus.emit('interior:interact', { stationId });

  reg({
    id: 'pilotSeat', position: S.pilotSeat, prompt: () => (st.suited ? 'Take off the suit before flying' : 'E: sit in the pilot seat'),
    onUse: () => {
      use('pilotSeat');
      if (!st.suited) onSeat?.();
    },
  });
  reg({
    id: 'suitLocker', position: S.suitLocker, prompt: () => (st.suited ? 'E: take off the suit' : 'E: put on the spacesuit'),
    onUse: () => {
      st.suited = !st.suited;
      use('suitLocker');
      notify('suit', { suited: st.suited });
    },
  });
  reg({
    id: 'o2Station', position: S.o2Station,
    prompt: () => (oxygen ? `E: swap the O₂ tank (${oxygen.spareTanks} spare)` : 'O₂ station'),
    onUse: () => {
      use('o2Station');
      if (oxygen && !oxygen.swapTank()) notify('o2Empty');
    },
  });
  reg({ id: 'commsConsole', position: S.commsConsole, prompt: 'E: comms console', onUse: () => use('commsConsole') });
  reg({ id: 'sampleStorage', position: S.sampleStorage, prompt: 'E: sample storage', onUse: () => use('sampleStorage') });
  reg({ id: 'bunk', position: S.bunk, prompt: 'E: bunk', onUse: () => use('bunk') });
  reg({
    id: 'airlock', position: S.airlock,
    prompt: () => (!st.suited ? 'Put on the suit before using the airlock' : st.airlock ? 'Cycling…' : st.prebreathe ? 'Prebreathing… E: cancel' : 'E: cycle the airlock'),
    onUse: () => {
      use('airlock');
      if (!st.suited || st.airlock) return;
      if (st.prebreathe) { cancelPrebreathe('pressed E'); return; }
      if (!canExit()) return;
      if (prebreatheState.done || !(prebreatheSeconds > 0)) st.airlock = { t: 0 };
      else {
        st.prebreathe = { t: 0 };
        notify('prebreathe', { stage: 'start', seconds: prebreatheSeconds });
      }
    },
  });
  function cancelPrebreathe(reason) {
    if (!st.prebreathe) return;
    st.prebreathe = null;
    notify('prebreathe', { stage: 'cancelled', reason });
  }
  // Crew-life props that are not contract stations: local notice only (e.g. the family photo).
  for (const [id, position] of Object.entries(P)) {
    reg({ id: `prop:${id}`, position, radius: 1.4, prompt: 'E: look', onUse: () => notify('prop', { id }) });
  }

  return {
    stations: S,
    get suited() { return st.suited; },
    set suited(v) { st.suited = !!v; notify('suit', { suited: st.suited }); },
    get airlockProgress() { return st.airlock ? Math.min(1, st.airlock.t / AIRLOCK_CYCLE_SECONDS) : 0; },
    get prebreathe() {
      if (!st.prebreathe) return null;
      const remaining = Math.max(0, prebreatheSeconds - st.prebreathe.t);
      return { seconds: prebreatheSeconds, remaining, progress: Math.min(1, st.prebreathe.t / prebreatheSeconds) };
    },
    cancelPrebreathe,
    // playerPos (optional {x,z}): walking more than PREBREATHE_MAX_DISTANCE m from the airlock cancels the prebreathe
    update(dt, playerPos) {
      if (st.prebreathe) {
        if (!st.suited) cancelPrebreathe('suit off');
        else if (playerPos && Math.hypot(playerPos.x - S.airlock.x, playerPos.z - S.airlock.z) > PREBREATHE_MAX_DISTANCE) cancelPrebreathe('moved away');
        else {
          st.prebreathe.t += dt;
          if (st.prebreathe.t >= prebreatheSeconds) {
            st.prebreathe = null;
            prebreatheState.done = true;
            notify('prebreathe', { stage: 'done' });
            st.airlock = { t: 0 };
          } else notify('prebreathe', { stage: 'running', progress: st.prebreathe.t / prebreatheSeconds });
        }
      }
      if (!st.airlock) return;
      st.airlock.t += dt;
      const progress = Math.min(1, st.airlock.t / AIRLOCK_CYCLE_SECONDS);
      notify('airlock', { stage: progress < 1 ? 'cycling' : 'open', progress });
      if (progress >= 1) {
        st.airlock = null;
        oxygen?.useAirlock?.(); // the air let out to Mars is made up from the spare oxygen (kg model only)
        onExit?.();
      }
    },
    dispose() { st.offs.forEach((off) => off()); st.offs = []; },
  };
}
