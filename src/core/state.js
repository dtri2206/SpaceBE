// The state machine. Only core switches state; other modules call requestState or emit 'state:request'.
import { STATES, TRANSITIONS } from './contract.js';
import { emit, on } from './events.js';

let current = STATES.MENU;

export function getState() {
  return current;
}

// Any state may go to ENDING (except ENDING itself), otherwise TRANSITIONS decides.
function isAllowed(from, to) {
  return to === STATES.ENDING ? from !== STATES.ENDING : (TRANSITIONS[from] ?? []).includes(to);
}

function change(from, to, data) {
  current = to;
  emit('state:changed', { from, to, data });
}

/** Ask for a state change. Returns true if it happened. Invalid requests log console.error and are refused. */
export function requestState(to, data) {
  if (!(to in STATES)) {
    console.error(`[state] unknown state "${to}". Valid states are in src/core/contract.js (STATES).`);
    return false;
  }
  if (!isAllowed(current, to)) {
    console.error(`[state] refused ${current} -> ${to}. Allowed from ${current}: ${(TRANSITIONS[current] ?? []).join(', ')}, ENDING.`);
    return false;
  }
  change(current, to, data);
  return true;
}

/** Debug only: jump to any state without checking TRANSITIONS. */
export function debugJump(to, data) {
  if (!(to in STATES)) {
    console.error(`[state] debugJump: unknown state "${to}".`);
    return false;
  }
  change(current, to, data);
  return true;
}

on('state:request', (payload) => requestState(payload.to, payload.data));
