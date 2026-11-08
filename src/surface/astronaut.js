// The astronaut's state shared by flight (src/flight) and surface (src/surface): suit O₂, body stats, suit on/off.
// Both folders are Role 2, so src/flight/index.js may import this file.
import { events, getShip } from '/src/core/index.js';
import { createOxygen } from './oxygen.js';
import { createBodyStats } from './bodyStats.js';
import { createVisorDust } from './visorDust.js';
import { resetPrebreathe } from './shipInterior.js';

const TANK_SECONDS = 300; // one suit tank ≈ 5 real minutes (gameplay value, TODO tune)

let oxygen = null;
let body = null;
let suited = false;
const dust = createVisorDust(); // Mars dust on the visor; the airlock brushes it off

/** Fresh astronaut for a new mission: spare tanks come from the ship (ShipSpec.stats.spareO2Tanks). */
function reset(shipSpec = getShip()) {
  oxygen = createOxygen({ bus: events, tankSeconds: TANK_SECONDS, spareTanks: shipSpec?.stats?.spareO2Tanks ?? 2 });
  body = createBodyStats();
  suited = false;
  dust.clear();
  resetPrebreathe(); // a new mission needs a new prebreathe
}

export const astronaut = {
  reset,
  get oxygen() { if (!oxygen) reset(); return oxygen; },
  get body() { if (!body) reset(); return body; },
  dust,
  get suited() { return suited; },
  set suited(v) { suited = !!v; },
};
