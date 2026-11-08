// The astronaut's state shared by flight (src/flight) and surface (src/surface): suit O₂, body stats, suit on/off.
// Both folders are Role 2, so src/flight/index.js may import this file.
//
// Life support (Role 1 wave 5, all four roles agreed): with ShipSpec.stats.traits.life the suit counts real kilograms
// of oxygen (oxygen.js lifeOxygen), the prebreathe follows the cabin air (shipInterior.js setCabinAir), the spare
// tanks arrive with what the cruise left in them (record.life.cruise, written by src/cruise into the flight's record in
// save.partEffects), and the walks outside are noted on that record for the hangar's analysis. Without traits: as before.
import { events, getShip, save } from '/src/core/index.js';
import { createOxygen, lifeOxygen } from './oxygen.js';
import { createBodyStats } from './bodyStats.js';
import { createVisorDust } from './visorDust.js';
import { resetPrebreathe, setCabinAir } from './shipInterior.js';
import { mr01Unlock } from './rovers.js';
import { resetFastDusk } from './dusk.js';
import { exploration } from './explore.js';

const TANK_SECONDS = 300; // one suit tank ≈ 5 real minutes (gameplay value; with traits: the EMU's 7.3 h, 87× faster)
const CRUISE_CHECK_MS = 1000; // how often to look for the cruise's record until it is found

let oxygen = null;
let body = null;
let suited = false;
const dust = createVisorDust(); // Mars dust on the visor; the airlock brushes it off
// this mission's life support: the ship's traits, the record that was last before launch, whether the cruise is applied
const mission = { life: null, ship: null, before: null, cruiseApplied: false, checkedAt: 0 };

/** The last flight record in save, if it belongs to this mission (made after this reset, for this ship). */
function missionRecord() {
  try {
    const flights = save.load().partEffects?.flights;
    const rec = flights?.[flights.length - 1] ?? null;
    if (!rec || rec.id === mission.before) return null;
    if (rec.name != null && mission.ship?.name != null && rec.name !== mission.ship.name) return null;
    return rec;
  } catch { return null; }
}

/** Notes about the walks outside (via: 'save', so the flight's recorder keeps them), replacing the last ones. */
function recordEva(stats) {
  const life = mission.life;
  if (!life) return;
  try {
    const all = save.load();
    const flights = all.partEffects?.flights;
    const rec = missionRecord();
    if (!rec || !flights?.length) return;
    const where = life.words?.[life.cabin?.exitVia === 'airlock' ? 'airlock' : 'cabin'] ?? { en: 'cabin air', vi: 'không khí trong khoang' };
    const r1 = (x) => Math.round(x * 10) / 10;
    const notes = [
      { group: 'life', what: 'evaMinutes', value: Math.round(stats.minutesOutside), available: Math.round(stats.minutesAvailable) },
      { group: 'life', what: 'o2Used', value: r1(stats.breathedKg + stats.ventedKg + (stats.cabinKg ?? 0)), left: r1(stats.usableKg) },
      ...(stats.exits > 0 ? [{ group: 'life', what: 'exitGas', value: Math.round(stats.exitKg * 100) / 100, where: where.en, whereVi: where.vi, exits: stats.exits, ...(life.cabin?.airlockPartId ? { partId: life.cabin.airlockPartId } : {}) }] : []),
      ...(stats.n2OutAfter != null ? [{ group: 'life', what: 'n2Out', value: stats.n2OutAfter }] : []),
    ].map((n) => ({ ...n, via: 'save', src: 'surface' }));
    const kept = (rec.notes ?? []).filter((n) => !(n.via === 'save' && n.src === 'surface'));
    const next = { ...rec, notes: [...kept, ...notes].slice(-300), life: { ...(rec.life ?? {}), surface: { ...stats } } };
    save.update({ partEffects: { ...all.partEffects, flights: [...flights.slice(0, -1), next] } });
  } catch { /* the record is a bonus */ }
}

/** Once the cruise has written what it left in the tanks, the suit's spare oxygen is that. */
function applyCruise() {
  if (mission.cruiseApplied || !mission.life || !oxygen?.setTanks) return;
  const now = Date.now();
  if (now - mission.checkedAt < CRUISE_CHECK_MS) return;
  mission.checkedAt = now;
  const cruise = missionRecord()?.life?.cruise;
  if (!Array.isArray(cruise?.tanks)) return;
  oxygen.setTanks(cruise.tanks, cruise.n2Kg);
  mission.cruiseApplied = true;
}

/** Fresh astronaut for a new mission: spare tanks come from the ship (ShipSpec.stats.spareO2Tanks). */
function reset(shipSpec = getShip()) {
  const life = shipSpec?.stats?.traits?.life ?? null;
  const kg = lifeOxygen(life);
  let before = null;
  try { before = save.load().partEffects?.flights?.at?.(-1)?.id ?? null; } catch { /* no save */ }
  Object.assign(mission, { life: kg ? life : null, ship: shipSpec ?? null, before, cruiseApplied: false, checkedAt: 0 });
  oxygen = kg
    ? createOxygen({ bus: events, life: kg, onRecord: recordEva })
    : createOxygen({ bus: events, tankSeconds: TANK_SECONDS, spareTanks: shipSpec?.stats?.spareO2Tanks ?? 2 });
  setCabinAir({ prebreathe: life?.cabin?.prebreathe });
  body = createBodyStats();
  suited = false;
  dust.clear();
  resetPrebreathe(); // a new mission needs a new prebreathe
  resetFastDusk(); // the fast dusk (Pale Blue Dot) may run once per mission
  exploration.reset(); // the first step on Mars and the first words happen once per mission
  mr01Unlock.reset(); // and MR-01 is locked again until 50 % Mars Exploration
}

export const astronaut = {
  reset,
  get oxygen() { if (!oxygen) reset(); applyCruise(); return oxygen; },
  get body() { if (!body) reset(); return body; },
  dust,
  get suited() { return suited; },
  set suited(v) { suited = !!v; },
};
