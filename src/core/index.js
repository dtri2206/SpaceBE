// The ONLY file other roles import from core. What it exports is listed in contract.js (PUBLIC_EXPORTS).
import * as contract from './contract.js';
import * as events from './events.js';
import { getState, requestState } from './state.js';
import { input } from './input.js';
import { ui } from './ui.js';
import { economy } from './economy.js';
import { save } from './save.js';
import { getShip, setShip } from './ship.js';
import { PLANETS, G0 } from './planets.js';

export { events, getState, requestState, input, ui, economy, save, getShip, setShip, PLANETS, G0, contract };
